const fs = require("node:fs");
const path = require("node:path");
const { readConfig } = require("./config");
const { buildRelayPrompt } = require("./prompt");
const { healthCheckWorker, runWorker } = require("./agents");
const { updateRunningJob, finalizeJob, writeJson } = require("./jobs");
const live = require("./live");

async function resolveAgents(config) {
  const resolved = [];

  for (const [agentId, agent] of Object.entries(config.agents || {})) {
    if (!agent.enabled) {
      continue;
    }

    const health = await healthCheckWorker(agent);
    resolved.push({
      agentId,
      agent,
      available: health.ok,
      unavailableReason: health.ok ? null : health.reason || "unavailable",
    });
  }

  return resolved;
}

async function runReviewJob(runningDir, runningFile) {
  try {
    const config = readConfig();
    let job = updateRunningJob(runningFile, (draft) => {
      draft.events.push({
        ts: new Date().toISOString(),
        message: "Resolving agents",
      });
    });

    const agentPlan = await resolveAgents(config);
    if (agentPlan.length === 0) {
      updateRunningJob(runningFile, (draft) => {
        draft.error = "No enabled agents configured";
      });
      return finalizeJob(runningDir, "failed");
    }

    job = updateRunningJob(runningFile, (draft) => {
      draft.agentPlan = agentPlan.map((entry) => ({
        agentId: entry.agentId,
        agentLabel: entry.agent.label,
        unavailableReason: entry.unavailableReason,
      }));
    });

    const executions = await Promise.all(
      agentPlan.map(async (entry) => {
        if (!entry.available) {
          return {
            agentId: entry.agentId,
            agentLabel: entry.agent.label,
            status: "skipped",
            error: entry.unavailableReason,
          };
        }

        updateRunningJob(runningFile, (draft) => {
          draft.events.push({
            ts: new Date().toISOString(),
            message: `Starting agent ${entry.agentId}`,
          });
        });
        live.emit(job.id, {
          type: "worker_started",
          jobId: job.id,
          workerId: entry.agentId,
        });

        const prompt = buildRelayPrompt(job, entry.agent);
        const result = await runWorker(entry.agent, prompt, {
          onStdout: (chunk) => appendAgentLog(job.id, runningDir, entry.agentId, "stdout", chunk),
          onStderr: (chunk) => appendAgentLog(job.id, runningDir, entry.agentId, "stderr", chunk),
          onRemoteLog: (chunk) => appendRawAgentLog(job.id, runningDir, entry.agentId, chunk),
        });

        const fullResult = {
          agentId: entry.agentId,
          agentLabel: entry.agent.label,
          workerId: entry.agentId,
          workerLabel: entry.agent.label,
          ...result,
        };

        const filePath = path.join(runningDir, `${entry.agentId}.json`);
        writeJson(filePath, fullResult);

        updateRunningJob(runningFile, (draft) => {
          draft.events.push({
            ts: new Date().toISOString(),
            message: `Finished agent ${entry.agentId} with status ${fullResult.status}`,
          });
        });
        live.emit(job.id, {
          type: "worker_finished",
          jobId: job.id,
          workerId: entry.agentId,
          status: fullResult.status,
        });

        return fullResult;
      })
    );

    updateRunningJob(runningFile, (draft) => {
      draft.results = executions;
      draft.events.push({
        ts: new Date().toISOString(),
        message: "All agents finished",
      });
    });
    live.emit(job.id, {
      type: "job_completed",
      jobId: job.id,
    });

    const hasSuccess = executions.some((result) => result.status === "success");
    return finalizeJob(runningDir, hasSuccess ? "done" : "failed");
  } catch (error) {
    updateRunningJob(runningFile, (draft) => {
      draft.error = error.message || String(error);
      draft.events.push({
        ts: new Date().toISOString(),
        message: `Unhandled runner error: ${draft.error}`,
      });
    });
    live.emit(path.basename(runningDir), {
      type: "job_failed",
      jobId: path.basename(runningDir),
      error: error.message || String(error),
    });
    return finalizeJob(runningDir, "failed");
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

function appendRawAgentLog(jobId, runningDir, agentId, chunk) {
  const filePath = path.join(runningDir, `${agentId}.log`);
  fs.appendFileSync(filePath, chunk);
  live.emit(jobId, {
    type: "worker_log",
    jobId,
    workerId: agentId,
    stream: "remote",
    chunk,
  });
}

module.exports = {
  runReviewJob,
};
