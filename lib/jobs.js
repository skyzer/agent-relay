const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const {
  QUEUE_DIR,
  RUNNING_DIR,
  DONE_DIR,
  FAILED_DIR,
  STATE_DIR,
  TMP_DIR,
} = require("./paths");

function ensureStateDirs() {
  for (const dir of [STATE_DIR, QUEUE_DIR, RUNNING_DIR, DONE_DIR, FAILED_DIR, TMP_DIR]) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function nowIso() {
  return new Date().toISOString();
}

function slugFromPr(prUrl) {
  const match = prUrl.match(/\/pull\/(\d+)(?:\/|$)/);
  return match ? `pr-${match[1]}` : "review";
}

function createJob(input) {
  ensureStateDirs();
  const id = `${Date.now()}-${crypto.randomBytes(3).toString("hex")}`;
  const createdAt = nowIso();
  const prUrls = Array.isArray(input.prUrls)
    ? input.prUrls.filter((value) => typeof value === "string" && value.trim().length > 0)
    : typeof input.prUrl === "string" && input.prUrl.trim().length > 0
      ? [input.prUrl.trim()]
      : [];
  const job = {
    id,
    createdAt,
    updatedAt: createdAt,
    status: "queued",
    prUrl: prUrls[0] || "",
    prUrls,
    instructions: input.instructions || "",
    postToGitHub: Boolean(input.postToGitHub),
    postMode: input.postMode || "comment",
    slug: slugFromPr(prUrls[0] || "review"),
    results: [],
    aggregate: null,
    error: null,
    events: [
      {
        ts: createdAt,
        message: "Job created",
      },
    ],
  };
  const queuePath = path.join(QUEUE_DIR, `${id}.json`);
  fs.writeFileSync(queuePath, JSON.stringify(job, null, 2));
  return job;
}

function listQueueFiles() {
  ensureStateDirs();
  return fs
    .readdirSync(QUEUE_DIR)
    .filter((name) => name.endsWith(".json"))
    .map((name) => path.join(QUEUE_DIR, name))
    .sort();
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

function claimNextQueuedJob() {
  const queueFiles = listQueueFiles();
  if (queueFiles.length === 0) {
    return null;
  }
  const queueFile = queueFiles[0];
  const job = readJson(queueFile);
  const runningDir = path.join(RUNNING_DIR, job.id);
  fs.mkdirSync(runningDir, { recursive: true });
  const runningFile = path.join(runningDir, "job.json");
  job.status = "running";
  job.updatedAt = nowIso();
  job.events.push({ ts: job.updatedAt, message: "Job claimed" });
  writeJson(runningFile, job);
  fs.unlinkSync(queueFile);
  return { job, runningDir, runningFile };
}

function updateRunningJob(runningFile, mutate) {
  const job = readJson(runningFile);
  mutate(job);
  job.updatedAt = nowIso();
  writeJson(runningFile, job);
  return job;
}

function finalizeJob(runningDir, status) {
  const runningFile = path.join(runningDir, "job.json");
  const job = readJson(runningFile);
  job.status = status;
  job.updatedAt = nowIso();
  job.events.push({
    ts: job.updatedAt,
    message: `Job moved to ${status}`,
  });
  writeJson(runningFile, job);
  const targetRoot = status === "done" ? DONE_DIR : FAILED_DIR;
  const targetDir = path.join(targetRoot, job.id);
  if (fs.existsSync(targetDir)) {
    fs.rmSync(targetDir, { recursive: true, force: true });
  }
  fs.renameSync(runningDir, targetDir);
  return { job, targetDir };
}

function listJobs(limit = 50) {
  ensureStateDirs();
  const jobs = [];

  for (const file of listQueueFiles()) {
    jobs.push(readJson(file));
  }

  for (const root of [RUNNING_DIR, DONE_DIR, FAILED_DIR]) {
    for (const dirName of fs.readdirSync(root, { withFileTypes: true })) {
      if (!dirName.isDirectory()) {
        continue;
      }
      const jobFile = path.join(root, dirName.name, "job.json");
      if (fs.existsSync(jobFile)) {
        jobs.push(readJson(jobFile));
      }
    }
  }

  return jobs
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
    .slice(0, limit);
}

function getJobById(id) {
  ensureStateDirs();
  const queuePath = path.join(QUEUE_DIR, `${id}.json`);
  if (fs.existsSync(queuePath)) {
    return readJson(queuePath);
  }

  for (const root of [RUNNING_DIR, DONE_DIR, FAILED_DIR]) {
    const jobFile = path.join(root, id, "job.json");
    if (fs.existsSync(jobFile)) {
      return readJson(jobFile);
    }
  }

  return null;
}

function getJobRootById(id) {
  ensureStateDirs();
  const queuePath = path.join(QUEUE_DIR, `${id}.json`);
  if (fs.existsSync(queuePath)) {
    return { root: QUEUE_DIR, file: queuePath };
  }

  for (const root of [RUNNING_DIR, DONE_DIR, FAILED_DIR]) {
    const dir = path.join(root, id);
    const jobFile = path.join(dir, "job.json");
    if (fs.existsSync(jobFile)) {
      return { root: dir, file: jobFile };
    }
  }

  return null;
}

function readWorkerLogs(id) {
  const info = getJobRootById(id);
  if (!info) {
    return null;
  }
  if (info.root === QUEUE_DIR) {
    return {};
  }

  const job = readJson(info.file);
  const logs = {};
  for (const name of fs.readdirSync(info.root)) {
    if (!name.endsWith(".log")) {
      continue;
    }
    logs[name.replace(/\.log$/, "")] = fs.readFileSync(path.join(info.root, name), "utf8");
  }

  if (Object.keys(logs).length > 0) {
    return logs;
  }

  for (const result of job.results || []) {
    const key = result.agentId || result.workerId;
    if (!key || !result.raw) {
      continue;
    }
    const chunks = [];
    if (typeof result.raw.stdout === "string" && result.raw.stdout.trim()) {
      chunks.push(`[stdout] ${result.raw.stdout}`);
    }
    if (typeof result.raw.stderr === "string" && result.raw.stderr.trim()) {
      chunks.push(`[stderr] ${result.raw.stderr}`);
    }
    if (chunks.length > 0) {
      logs[key] = chunks.join("");
    }
  }

  return logs;
}

function recoverRunningJobsOnStartup() {
  ensureStateDirs();
  const recovered = [];

  for (const dirName of fs.readdirSync(RUNNING_DIR, { withFileTypes: true })) {
    if (!dirName.isDirectory()) {
      continue;
    }
    const runningDir = path.join(RUNNING_DIR, dirName.name);
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
      message: "Recovered from stale running state on startup",
    });
    writeJson(jobFile, job);
    const targetDir = path.join(FAILED_DIR, job.id);
    if (fs.existsSync(targetDir)) {
      fs.rmSync(targetDir, { recursive: true, force: true });
    }
    fs.renameSync(runningDir, targetDir);
    recovered.push(job.id);
  }

  return recovered;
}

module.exports = {
  ensureStateDirs,
  createJob,
  claimNextQueuedJob,
  updateRunningJob,
  finalizeJob,
  listJobs,
  getJobById,
  getJobRootById,
  readWorkerLogs,
  recoverRunningJobsOnStartup,
  readJson,
  writeJson,
  nowIso,
};
