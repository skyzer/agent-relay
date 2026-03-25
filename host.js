const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const { readHostConfig } = require("./lib/host-config");
const {
  ensureHostStateDirs,
  createHostJob,
  claimNextQueuedHostJob,
  updateHostJob,
  finalizeHostJob,
  getHostJobById,
  readHostJobLogs,
  recoverHostRunningJobsOnStartup,
} = require("./lib/host-jobs");
const { runWorker, healthCheckWorker } = require("./lib/agents");
const live = require("./lib/live");

const HOST_PREFIX = "/agent-host";

ensureHostStateDirs();
recoverHostRunningJobsOnStartup();

let activeJobs = 0;
let pollTimer = null;

function sendJson(res, statusCode, data) {
  const body = JSON.stringify(data, null, 2);
  res.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
  });
  res.end(body);
}

function parseJsonBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk.toString();
    });
    req.on("end", () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

function isAuthorized(req, config) {
  const auth = req.headers.authorization || "";
  return auth === `Bearer ${config.authToken}`;
}

async function maybeRunNext() {
  const config = readHostConfig();
  if (activeJobs >= 1) {
    return;
  }
  const claimed = claimNextQueuedHostJob();
  if (!claimed) {
    return;
  }

  activeJobs += 1;
  try {
    const agents = config.agents;
    const agentKey = claimed.job.agentKey;
    const worker = agents[agentKey];
    if (!worker) {
      updateHostJob(claimed.runningFile, (draft) => {
        draft.error = `Unknown agent: ${agentKey}`;
      });
      finalizeHostJob(claimed.runningDir, "failed");
      return;
    }

    const health = await healthCheckWorker(worker);
    if (!health.ok) {
      updateHostJob(claimed.runningFile, (draft) => {
        draft.error = health.reason;
      });
      finalizeHostJob(claimed.runningDir, "failed");
      return;
    }

    live.emit(claimed.job.id, {
      type: "worker_started",
      jobId: claimed.job.id,
      workerId: agentKey,
    });

    const result = await runWorker(worker, claimed.job.prompt, {
      onStdout: (chunk) => appendAgentLog(claimed.job.id, claimed.runningDir, agentKey, "stdout", chunk),
      onStderr: (chunk) => appendAgentLog(claimed.job.id, claimed.runningDir, agentKey, "stderr", chunk),
    });

    updateHostJob(claimed.runningFile, (draft) => {
      draft.result = result;
      draft.events.push({
        ts: new Date().toISOString(),
        message: `Host agent finished with status ${result.status}`,
      });
    });

    live.emit(claimed.job.id, {
      type: "worker_finished",
      jobId: claimed.job.id,
      workerId: agentKey,
      status: result.status,
    });

    finalizeHostJob(claimed.runningDir, result.status === "success" ? "done" : "failed");
  } catch (error) {
    console.error(error);
  } finally {
    activeJobs -= 1;
  }
}

function appendAgentLog(jobId, runningDir, agentId, stream, chunk) {
  const filePath = path.join(runningDir, `${agentId}.log`);
  fs.appendFileSync(filePath, `[${stream}] ${chunk}`);
  live.emit(jobId, {
    type: "worker_log",
    jobId,
    workerId: agentId,
    stream,
    chunk,
  });
}

function scheduleRunner() {
  if (pollTimer) {
    clearInterval(pollTimer);
  }
  pollTimer = setInterval(() => {
    maybeRunNext().catch((error) => console.error(error));
  }, 1000);
}

const server = http.createServer(async (req, res) => {
  try {
    const config = readHostConfig();
    const url = new URL(req.url, "http://127.0.0.1");
    const pathname = url.pathname.startsWith(HOST_PREFIX) ? url.pathname.slice(HOST_PREFIX.length) || "/" : url.pathname;

    if (pathname !== "/health" && !isAuthorized(req, config)) {
      sendJson(res, 401, { error: "Unauthorized" });
      return;
    }

    if (req.method === "GET" && pathname === "/health") {
      const agents = {};
      for (const [key, agent] of Object.entries(config.agents)) {
        agents[key] = await healthCheckWorker(agent);
      }
      sendJson(res, 200, { ok: true, agents });
      return;
    }

    if (req.method === "POST" && pathname === "/run") {
      const body = await parseJsonBody(req);
      const agentKey = body.agentKey;
      if (!agentKey || !body.prompt) {
        sendJson(res, 422, { error: "agentKey and prompt are required" });
        return;
      }
      const job = createHostJob({
        agentKey,
        prompt: body.prompt,
        metadata: body.metadata || null,
      });
      sendJson(res, 201, job);
      maybeRunNext().catch((error) => console.error(error));
      return;
    }

    if (req.method === "GET" && pathname.startsWith("/jobs/")) {
      const parts = pathname.split("/").filter(Boolean);
      const id = parts[1];
      const suffix = parts[2];

      if (suffix === "stream") {
        res.writeHead(200, {
          "content-type": "text/event-stream; charset=utf-8",
          "cache-control": "no-cache, no-store, must-revalidate",
          connection: "keep-alive",
        });
        res.write("\n");
        live.subscribe(id, res);
        req.on("close", () => {
          live.unsubscribe(id, res);
        });
        return;
      }

      if (suffix === "logs") {
        const logs = readHostJobLogs(id);
        if (logs === null) {
          sendJson(res, 404, { error: "Job not found" });
          return;
        }
        sendJson(res, 200, logs);
        return;
      }

      const job = getHostJobById(id);
      if (!job) {
        sendJson(res, 404, { error: "Job not found" });
        return;
      }
      sendJson(res, 200, job);
      return;
    }

    sendJson(res, 404, { error: "Not found" });
  } catch (error) {
    sendJson(res, 500, { error: error.message || "Internal server error" });
  }
});

scheduleRunner();

const config = readHostConfig();
server.listen(config.port, config.listenHost || "127.0.0.1", () => {
  console.log(`Host listening on http://${config.listenHost || "127.0.0.1"}:${config.port}`);
});
