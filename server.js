const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const { readConfig, updateAgentPreferences } = require("./lib/config");
const { PUBLIC_DIR } = require("./lib/paths");
const {
  ensureStateDirs,
  createJob,
  claimNextQueuedJob,
  listJobs,
  getJobById,
  readWorkerLogs,
  recoverRunningJobsOnStartup,
} = require("./lib/jobs");
const { runReviewJob } = require("./lib/review-runner");
const live = require("./lib/live");
const { healthCheckWorker } = require("./lib/agents");

ensureStateDirs();
recoverRunningJobsOnStartup();

let activeJobs = 0;
let pollTimer = null;

async function maybeRunNext() {
  if (activeJobs >= 1) {
    return;
  }

  const claimed = claimNextQueuedJob();
  if (!claimed) {
    return;
  }

  activeJobs += 1;
  try {
    await runReviewJob(claimed.runningDir, claimed.runningFile);
  } catch (error) {
    console.error(error);
  } finally {
    activeJobs -= 1;
  }
}

function scheduleRunner() {
  if (pollTimer) {
    clearInterval(pollTimer);
  }
  pollTimer = setInterval(() => {
    maybeRunNext().catch((error) => console.error(error));
  }, 1500);
}

function sendJson(res, statusCode, data) {
  const body = JSON.stringify(data, null, 2);
  res.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
  });
  res.end(body);
}

function sendText(res, statusCode, body, type = "text/plain; charset=utf-8") {
  res.writeHead(statusCode, {
    "content-type": type,
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-cache, no-store, must-revalidate",
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

function serveStatic(req, res, pathname) {
  const requestedPath = pathname === "/" ? "index.html" : pathname.slice(1);
  const candidatePath = path.join(PUBLIC_DIR, requestedPath);
  const filePath =
    candidatePath.startsWith(PUBLIC_DIR) && fs.existsSync(candidatePath) && fs.statSync(candidatePath).isFile()
      ? candidatePath
      : path.join(PUBLIC_DIR, "index.html");

  if (!filePath.startsWith(PUBLIC_DIR) || !fs.existsSync(filePath)) {
    sendText(res, 404, "Not found\n");
    return;
  }

  const type = filePath.endsWith(".html")
    ? "text/html; charset=utf-8"
    : filePath.endsWith(".js")
      ? "text/javascript; charset=utf-8"
      : filePath.endsWith(".css")
        ? "text/css; charset=utf-8"
        : filePath.endsWith(".svg")
          ? "image/svg+xml"
          : filePath.endsWith(".json")
            ? "application/json; charset=utf-8"
            : filePath.endsWith(".ico")
              ? "image/x-icon"
              : "text/plain; charset=utf-8";

  sendText(res, 200, fs.readFileSync(filePath, "utf8"), type);
}

function serializeAgentForUi(agent) {
  return {
    label: agent.label,
    launcher: agent.launcher,
    enabled: Boolean(agent.enabled),
    cwd: agent.cwd || null,
    baseUrlConfigured: Boolean(agent.baseUrl),
    remoteAgentKey: agent.remoteAgentKey || null,
    hostLabel: agent.hostLabel || null,
  };
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://127.0.0.1");

    if (req.method === "GET" && url.pathname === "/api/reviews") {
      sendJson(res, 200, listJobs());
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/agents") {
      const config = readConfig();
      const health = {};
      for (const [id, agent] of Object.entries(config.agents)) {
        try {
          health[id] = await healthCheckWorker(agent);
        } catch (error) {
          health[id] = {
            ok: false,
            reason: error.message || "worker health check failed",
          };
        }
      }
      sendJson(res, 200, {
        agents: Object.fromEntries(
          Object.entries(config.agents).map(([id, agent]) => [id, serializeAgentForUi(agent)])
        ),
        health,
      });
      return;
    }

    if (req.method === "PUT" && url.pathname === "/api/agents") {
      const body = await parseJsonBody(req);
      const saved = updateAgentPreferences({
        enabledByAgentId: body.enabledByAgentId && typeof body.enabledByAgentId === "object" ? body.enabledByAgentId : undefined,
      });
      sendJson(res, 200, {
        ok: true,
        agents: Object.fromEntries(
          Object.entries(saved.agents).map(([id, agent]) => [id, serializeAgentForUi(agent)])
        ),
      });
      return;
    }

    if (req.method === "GET" && url.pathname.startsWith("/api/reviews/")) {
      const parts = url.pathname.split("/").filter(Boolean);
      const id = parts[2];
      const suffix = parts[3];

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
        const logs = readWorkerLogs(id);
        if (logs === null) {
          sendJson(res, 404, { error: "Job not found" });
          return;
        }
        sendJson(res, 200, logs);
        return;
      }

      const job = getJobById(id);
      if (!job) {
        sendJson(res, 404, { error: "Job not found" });
        return;
      }
      sendJson(res, 200, job);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/reviews") {
      const body = await parseJsonBody(req);
      const prUrls = Array.isArray(body.prUrls)
        ? body.prUrls.filter((value) => typeof value === "string" && value.trim().length > 0)
        : [];
      if (prUrls.length === 0 && (!body.prUrl || typeof body.prUrl !== "string")) {
        sendJson(res, 422, { error: "prUrl or prUrls is required" });
        return;
      }
      const job = createJob({
        ...body,
        prUrls: prUrls.length > 0 ? prUrls : [body.prUrl],
      });
      sendJson(res, 201, job);
      live.emit(job.id, {
        type: "job_created",
        jobId: job.id,
      });
      maybeRunNext().catch((error) => console.error(error));
      return;
    }

    if (req.method === "GET" && !url.pathname.startsWith("/api/")) {
      serveStatic(req, res, url.pathname);
      return;
    }

    sendJson(res, 404, { error: "Not found" });
  } catch (error) {
    sendJson(res, 500, { error: error.message || "Internal server error" });
  }
});

scheduleRunner();

const config = readConfig();
server.listen(config.port, "127.0.0.1", () => {
  console.log(`Agent Relay listening on http://127.0.0.1:${config.port}`);
});
