const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const {
  HOST_STATE_DIR,
  HOST_QUEUE_DIR,
  HOST_RUNNING_DIR,
  HOST_DONE_DIR,
  HOST_FAILED_DIR,
} = require("./paths");

function ensureHostStateDirs() {
  for (const dir of [
    HOST_STATE_DIR,
    HOST_QUEUE_DIR,
    HOST_RUNNING_DIR,
    HOST_DONE_DIR,
    HOST_FAILED_DIR,
  ]) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function nowIso() {
  return new Date().toISOString();
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

function createHostJob(input) {
  ensureHostStateDirs();
  const id = `${Date.now()}-${crypto.randomBytes(3).toString("hex")}`;
  const createdAt = nowIso();
  const job = {
    id,
    createdAt,
    updatedAt: createdAt,
    status: "queued",
    agentKey: input.agentKey,
    prompt: input.prompt,
    metadata: input.metadata || null,
    result: null,
    error: null,
    events: [
      {
        ts: createdAt,
        message: "Host job created",
      },
    ],
  };
  const queuePath = path.join(HOST_QUEUE_DIR, `${id}.json`);
  writeJson(queuePath, job);
  return job;
}

function listQueueFiles() {
  ensureHostStateDirs();
  return fs
    .readdirSync(HOST_QUEUE_DIR)
    .filter((name) => name.endsWith(".json"))
    .map((name) => path.join(HOST_QUEUE_DIR, name))
    .sort();
}

function claimNextQueuedHostJob() {
  const queueFiles = listQueueFiles();
  if (queueFiles.length === 0) {
    return null;
  }
  const queueFile = queueFiles[0];
  const job = readJson(queueFile);
  const runningDir = path.join(HOST_RUNNING_DIR, job.id);
  fs.mkdirSync(runningDir, { recursive: true });
  const runningFile = path.join(runningDir, "job.json");
  job.status = "running";
  job.updatedAt = nowIso();
  job.events.push({ ts: job.updatedAt, message: "Host job claimed" });
  writeJson(runningFile, job);
  fs.unlinkSync(queueFile);
  return { job, runningDir, runningFile };
}

function updateHostJob(runningFile, mutate) {
  const job = readJson(runningFile);
  mutate(job);
  job.updatedAt = nowIso();
  writeJson(runningFile, job);
  return job;
}

function finalizeHostJob(runningDir, status) {
  const runningFile = path.join(runningDir, "job.json");
  const job = readJson(runningFile);
  job.status = status;
  job.updatedAt = nowIso();
  job.events.push({
    ts: job.updatedAt,
        message: `Host job moved to ${status}`,
      });
  writeJson(runningFile, job);
  const targetRoot = status === "done" ? HOST_DONE_DIR : HOST_FAILED_DIR;
  const targetDir = path.join(targetRoot, job.id);
  if (fs.existsSync(targetDir)) {
    fs.rmSync(targetDir, { recursive: true, force: true });
  }
  fs.renameSync(runningDir, targetDir);
  return { job, targetDir };
}

function getHostJobById(id) {
  ensureHostStateDirs();
  const queuePath = path.join(HOST_QUEUE_DIR, `${id}.json`);
  if (fs.existsSync(queuePath)) {
    return readJson(queuePath);
  }
  for (const root of [HOST_RUNNING_DIR, HOST_DONE_DIR, HOST_FAILED_DIR]) {
    const jobFile = path.join(root, id, "job.json");
    if (fs.existsSync(jobFile)) {
      return readJson(jobFile);
    }
  }
  return null;
}

function getHostJobRootById(id) {
  ensureHostStateDirs();
  const queuePath = path.join(HOST_QUEUE_DIR, `${id}.json`);
  if (fs.existsSync(queuePath)) {
    return { root: HOST_QUEUE_DIR, file: queuePath };
  }
  for (const root of [HOST_RUNNING_DIR, HOST_DONE_DIR, HOST_FAILED_DIR]) {
    const dir = path.join(root, id);
    const jobFile = path.join(dir, "job.json");
    if (fs.existsSync(jobFile)) {
      return { root: dir, file: jobFile };
    }
  }
  return null;
}

function readHostJobLogs(id) {
  const info = getHostJobRootById(id);
  if (!info) {
    return null;
  }
  if (info.root === HOST_QUEUE_DIR) {
    return {};
  }
  const logs = {};
  for (const name of fs.readdirSync(info.root)) {
    if (!name.endsWith(".log")) {
      continue;
    }
    logs[name.replace(/\.log$/, "")] = fs.readFileSync(path.join(info.root, name), "utf8");
  }
  return logs;
}

function recoverHostRunningJobsOnStartup() {
  ensureHostStateDirs();
  for (const dirName of fs.readdirSync(HOST_RUNNING_DIR, { withFileTypes: true })) {
    if (!dirName.isDirectory()) {
      continue;
    }
    const runningDir = path.join(HOST_RUNNING_DIR, dirName.name);
    const jobFile = path.join(runningDir, "job.json");
    if (!fs.existsSync(jobFile)) {
      continue;
    }
    const job = readJson(jobFile);
    job.status = "failed";
    job.updatedAt = nowIso();
    job.error = job.error || "Recovered as failed after process restart";
    job.events.push({
      ts: job.updatedAt,
      message: "Recovered from stale host state on startup",
    });
    writeJson(jobFile, job);
    const targetDir = path.join(HOST_FAILED_DIR, job.id);
    if (fs.existsSync(targetDir)) {
      fs.rmSync(targetDir, { recursive: true, force: true });
    }
    fs.renameSync(runningDir, targetDir);
  }
}

module.exports = {
  ensureHostStateDirs,
  createHostJob,
  claimNextQueuedHostJob,
  updateHostJob,
  finalizeHostJob,
  getHostJobById,
  getHostJobRootById,
  readHostJobLogs,
  recoverHostRunningJobsOnStartup,
};
