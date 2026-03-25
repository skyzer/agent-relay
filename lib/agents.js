const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { RELAY_RESULT_SCHEMA_PATH } = require("./paths");

function commandExists(command, cwd) {
  return new Promise((resolve) => {
    const child = spawn("zsh", ["-lc", `command -v ${shellEscape(command)} >/dev/null 2>&1`], {
      cwd,
      stdio: "ignore",
    });
    child.on("close", (code) => resolve(code === 0));
  });
}

function shellEscape(value) {
  return `'${String(value).replace(/'/g, `'\"'\"'`)}'`;
}

function withTimeout(promise, timeoutMs, onTimeout) {
  if (!timeoutMs || timeoutMs <= 0) {
    return promise;
  }
  let timer = null;
  return Promise.race([
    promise.finally(() => {
      if (timer) {
        clearTimeout(timer);
      }
    }),
    new Promise((resolve) => {
      timer = setTimeout(async () => {
        await onTimeout();
        resolve({ timeout: true });
      }, timeoutMs);
    }),
  ]);
}

function parseJsonLoose(text) {
  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch {}

  const fenced = text.match(/```json\s*([\s\S]*?)```/i);
  if (fenced) {
    try {
      return JSON.parse(fenced[1]);
    } catch {}
  }

  const first = text.indexOf("{");
  const last = text.lastIndexOf("}");
  if (first >= 0 && last > first) {
    try {
      return JSON.parse(text.slice(first, last + 1));
    } catch {}
  }

  return null;
}

function unwrapStructuredOutput(parsed) {
  if (!parsed || typeof parsed !== "object") {
    return null;
  }
  if (parsed.structured_output && typeof parsed.structured_output === "object") {
    return parsed.structured_output;
  }
  return parsed;
}

function getLauncher(worker) {
  return worker.launcher;
}

function getTimeoutMs(worker) {
  const seconds = Number(worker.timeoutSec);
  if (Number.isFinite(seconds) && seconds > 0) {
    return seconds * 1000;
  }
  return null;
}

function getTimeoutLabel(worker) {
  const seconds = Number(worker.timeoutSec);
  if (Number.isFinite(seconds) && seconds > 0) {
    return `${seconds}s`;
  }
  return "no timeout configured";
}

function buildRemoteUrl(baseUrl, requestPath) {
  const url = new URL(baseUrl);
  const basePath = url.pathname.endsWith("/") ? url.pathname.slice(0, -1) : url.pathname;
  const suffix = requestPath.startsWith("/") ? requestPath : `/${requestPath}`;
  url.pathname = `${basePath}${suffix}` || "/";
  url.search = "";
  url.hash = "";
  return url;
}

function extractSessionId(...texts) {
  const patterns = [
    /session id:\s*([a-z0-9-]+)/i,
    /session[_ -]?id["'\s:=]+([a-z0-9-]+)/i,
    /"sessionId"\s*:\s*"([^"]+)"/i,
  ];

  for (const text of texts) {
    if (!text) {
      continue;
    }
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match) {
        return match[1];
      }
    }
  }

  return null;
}

async function fetchRemoteLogs(worker, jobId) {
  const http = worker.baseUrl.startsWith("https:") ? require("node:https") : require("node:http");
  return new Promise((resolve, reject) => {
    const url = buildRemoteUrl(worker.baseUrl, `/jobs/${jobId}/logs`);
    const req = http.request(
      {
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port,
        path: url.pathname,
        method: "GET",
        headers: {
          authorization: `Bearer ${worker.authToken}`,
        },
      },
      (res) => {
        let data = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          data += chunk;
        });
        res.on("end", () => {
          if (res.statusCode !== 200) {
            reject(new Error(`remote worker logs failed: ${res.statusCode}`));
            return;
          }
          resolve(JSON.parse(data));
        });
      }
    );
    req.on("error", reject);
    req.end();
  });
}

async function flushRemoteLogDiff(worker, jobId, seenLogs, hooks = {}) {
  if (!hooks.onRemoteLog) {
    return;
  }

  try {
    const logs = await fetchRemoteLogs(worker, jobId);
    for (const [remoteWorkerId, text] of Object.entries(logs || {})) {
      const previous = seenLogs.get(remoteWorkerId) || "";
      if (typeof text !== "string" || text.length <= previous.length) {
        continue;
      }
      const delta = text.slice(previous.length);
      seenLogs.set(remoteWorkerId, text);
      hooks.onRemoteLog(delta);
    }
  } catch {
    // Keep remote log forwarding best-effort. Status polling is still authoritative.
  }
}

async function healthCheckWorker(worker) {
  if (!worker.enabled) {
    return { ok: false, reason: "disabled" };
  }

  const launcher = getLauncher(worker);

  if (launcher === "codex-local" || launcher === "claude-local" || launcher === "shell-json") {
    const ok = await commandExists(worker.command, worker.cwd || process.cwd());
    return ok ? { ok: true } : { ok: false, reason: `command not found: ${worker.command}` };
  }

  if (launcher === "http-json") {
    if (!worker.baseUrl) {
      return { ok: false, reason: "baseUrl not configured" };
    }
    try {
      return await new Promise((resolve) => {
        const http = worker.baseUrl.startsWith("https:") ? require("node:https") : require("node:http");
        const url = buildRemoteUrl(worker.baseUrl, "/health");
        const req = http.request(
          {
            protocol: url.protocol,
            hostname: url.hostname,
            port: url.port,
            path: url.pathname,
            method: "GET",
            timeout: 5000,
            headers: {
              authorization: `Bearer ${worker.authToken}`,
            },
          },
          (res) => {
            resolve(res.statusCode === 200 ? { ok: true } : { ok: false, reason: `worker unhealthy: ${worker.baseUrl}` });
          }
        );
        req.on("error", () => resolve({ ok: false, reason: `worker unreachable: ${worker.baseUrl}` }));
        req.on("timeout", () => {
          req.destroy();
          resolve({ ok: false, reason: `worker timeout: ${worker.baseUrl}` });
        });
        req.end();
      });
    } catch (error) {
      return { ok: false, reason: `invalid worker URL: ${worker.baseUrl}` };
    }
  }

  if (launcher === "ssh-codex") {
    return new Promise((resolve) => {
      const child = spawn("ssh", [
        "-o",
        "BatchMode=yes",
        "-o",
        "ConnectTimeout=5",
        "-o",
        "StrictHostKeyChecking=accept-new",
        worker.host,
        `command -v ${worker.command || "codex"} >/dev/null 2>&1`,
      ]);
      child.on("close", (code) => {
        resolve(code === 0 ? { ok: true } : { ok: false, reason: `ssh unavailable: ${worker.host}` });
      });
    });
  }

  return { ok: false, reason: `unknown launcher: ${launcher}` };
}

async function runCodexLocal(worker, prompt, hooks = {}) {
  const outputPath = path.join(os.tmpdir(), `agent-relay-codex-${Date.now()}.json`);
  const args = [
    "exec",
    "--skip-git-repo-check",
    "--dangerously-bypass-approvals-and-sandbox",
    "--output-schema",
    RELAY_RESULT_SCHEMA_PATH,
    "-o",
    outputPath,
    "-",
  ];
  const timeoutMs = getTimeoutMs(worker);
  const child = spawn(worker.command, args, {
    cwd: worker.cwd,
    env: process.env,
    stdio: ["pipe", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => {
    stdout += chunk.toString();
    if (hooks.onStdout) {
      hooks.onStdout(chunk.toString());
    }
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
    if (hooks.onStderr) {
      hooks.onStderr(chunk.toString());
    }
  });
  child.stdin.write(prompt);
  child.stdin.end();

  const result = await withTimeout(
    new Promise((resolve) => {
      child.on("close", (code, signal) => resolve({ code, signal }));
    }),
    timeoutMs,
    async () => {
      child.kill("SIGTERM");
    }
  );

  if (result.timeout) {
    return {
      status: "error",
      error: `timed out after ${getTimeoutLabel(worker)}`,
      raw: { stdout, stderr },
    };
  }

  const parsed = fs.existsSync(outputPath)
    ? parseJsonLoose(fs.readFileSync(outputPath, "utf8"))
    : parseJsonLoose(stdout);

  if (fs.existsSync(outputPath)) {
    fs.unlinkSync(outputPath);
  }

  if (result.code !== 0) {
    return {
      status: "error",
      error: stderr.trim() || `codex exited with code ${result.code}`,
      raw: { stdout, stderr },
    };
  }

  if (!parsed) {
    return {
      status: "error",
      error: "codex returned non-JSON output",
      raw: { stdout, stderr },
    };
  }

  return {
    status: "success",
    output: unwrapStructuredOutput(parsed),
    sessionId: extractSessionId(stdout, stderr),
    raw: { stdout, stderr },
  };
}

async function runClaudeLocal(worker, prompt, hooks = {}) {
  const args = [
    "--print",
    "--output-format",
    "json",
    "--json-schema",
    fs.readFileSync(RELAY_RESULT_SCHEMA_PATH, "utf8"),
    "--dangerously-skip-permissions",
    prompt,
  ];

  const timeoutMs = getTimeoutMs(worker);
  const child = spawn(worker.command, args, {
    cwd: worker.cwd,
    env: process.env,
    stdio: ["pipe", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => {
    stdout += chunk.toString();
    if (hooks.onStdout) {
      hooks.onStdout(chunk.toString());
    }
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
    if (hooks.onStderr) {
      hooks.onStderr(chunk.toString());
    }
  });
  const result = await withTimeout(
    new Promise((resolve) => {
      child.on("close", (code, signal) => resolve({ code, signal }));
    }),
    timeoutMs,
    async () => {
      child.kill("SIGTERM");
    }
  );

  if (result.timeout) {
    return {
      status: "error",
      error: `timed out after ${getTimeoutLabel(worker)}`,
      raw: { stdout, stderr },
    };
  }

  const parsed = parseJsonLoose(stdout);
  if (result.code !== 0) {
    return {
      status: "error",
      error: stderr.trim() || `claude exited with code ${result.code}`,
      raw: { stdout, stderr },
    };
  }

  if (!parsed) {
    return {
      status: "error",
      error: "claude returned non-JSON output",
      raw: { stdout, stderr },
    };
  }

  return {
    status: "success",
    output: unwrapStructuredOutput(parsed),
    sessionId: extractSessionId(stdout, stderr),
    raw: { stdout, stderr },
  };
}

async function runShellJson(worker, prompt, hooks = {}) {
  const args = [...(worker.args || []), prompt];
  const timeoutMs = getTimeoutMs(worker);
  const child = spawn(worker.command, args, {
    cwd: worker.cwd,
    env: process.env,
    stdio: ["pipe", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => {
    stdout += chunk.toString();
    if (hooks.onStdout) {
      hooks.onStdout(chunk.toString());
    }
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
    if (hooks.onStderr) {
      hooks.onStderr(chunk.toString());
    }
  });
  const result = await withTimeout(
    new Promise((resolve) => {
      child.on("close", (code, signal) => resolve({ code, signal }));
    }),
    timeoutMs,
    async () => {
      child.kill("SIGTERM");
    }
  );

  if (result.timeout) {
    return {
      status: "error",
      error: `timed out after ${getTimeoutLabel(worker)}`,
      raw: { stdout, stderr },
    };
  }

  const parsed = parseJsonLoose(stdout);
  if (result.code !== 0) {
    return {
      status: "error",
      error: stderr.trim() || `${worker.command} exited with code ${result.code}`,
      raw: { stdout, stderr },
    };
  }

  if (!parsed) {
    return {
      status: "error",
      error: `${worker.command} returned non-JSON output`,
      raw: { stdout, stderr },
    };
  }

  return {
    status: "success",
    output: unwrapStructuredOutput(parsed),
    sessionId: extractSessionId(stdout, stderr),
    raw: { stdout, stderr },
  };
}

async function runSshCodex(worker, prompt, hooks = {}) {
  const remoteCommand = [
    worker.command || "codex",
    "exec",
    "--skip-git-repo-check",
    "--dangerously-bypass-approvals-and-sandbox",
    "-C",
    worker.cwd || "~",
    "-",
  ].join(" ");

  const timeoutMs = getTimeoutMs(worker);
  const child = spawn(
    "ssh",
    [
      "-o",
      "BatchMode=yes",
      "-o",
      "ConnectTimeout=10",
      "-o",
      "StrictHostKeyChecking=accept-new",
      worker.host,
      remoteCommand,
    ],
    {
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"],
    }
  );

  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => {
    stdout += chunk.toString();
    if (hooks.onStdout) {
      hooks.onStdout(chunk.toString());
    }
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
    if (hooks.onStderr) {
      hooks.onStderr(chunk.toString());
    }
  });
  child.stdin.write(prompt);
  child.stdin.end();

  const result = await withTimeout(
    new Promise((resolve) => {
      child.on("close", (code, signal) => resolve({ code, signal }));
    }),
    timeoutMs,
    async () => {
      child.kill("SIGTERM");
    }
  );

  if (result.timeout) {
    return {
      status: "error",
      error: `timed out after ${getTimeoutLabel(worker)}`,
      raw: { stdout, stderr },
    };
  }

  const parsed = parseJsonLoose(stdout);
  if (result.code !== 0) {
    return {
      status: "error",
      error: stderr.trim() || `ssh codex exited with code ${result.code}`,
      raw: { stdout, stderr },
    };
  }

  if (!parsed) {
    return {
      status: "error",
      error: "remote codex returned non-JSON output",
      raw: { stdout, stderr },
    };
  }

  return {
    status: "success",
    output: unwrapStructuredOutput(parsed),
    sessionId: extractSessionId(stdout, stderr),
    raw: { stdout, stderr },
  };
}

async function runSshShellJson(worker, prompt, hooks = {}) {
  const remoteCommand = [worker.command, ...(worker.args || [])].join(" ");
  const timeoutMs = getTimeoutMs(worker);
  const child = spawn(
    "ssh",
    [
      "-o",
      "BatchMode=yes",
      "-o",
      "ConnectTimeout=10",
      "-o",
      "StrictHostKeyChecking=accept-new",
      worker.host,
      `cd ${shellEscape(worker.cwd || "~")} && ${remoteCommand}`,
    ],
    {
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"],
    }
  );

  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => {
    stdout += chunk.toString();
    if (hooks.onStdout) {
      hooks.onStdout(chunk.toString());
    }
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
    if (hooks.onStderr) {
      hooks.onStderr(chunk.toString());
    }
  });
  child.stdin.write(prompt);
  child.stdin.end();

  const result = await withTimeout(
    new Promise((resolve) => {
      child.on("close", (code, signal) => resolve({ code, signal }));
    }),
    timeoutMs,
    async () => {
      child.kill("SIGTERM");
    }
  );

  if (result.timeout) {
    return {
      status: "error",
      error: `timed out after ${getTimeoutLabel(worker)}`,
      raw: { stdout, stderr },
    };
  }

  const parsed = parseJsonLoose(stdout);
  if (result.code !== 0) {
    return {
      status: "error",
      error: stderr.trim() || `ssh ${worker.command} exited with code ${result.code}`,
      raw: { stdout, stderr },
    };
  }

  if (!parsed) {
    return {
      status: "error",
      error: `remote ${worker.command} returned non-JSON output`,
      raw: { stdout, stderr },
    };
  }

  return {
    status: "success",
    output: parsed,
    sessionId: extractSessionId(stdout, stderr),
    raw: { stdout, stderr },
  };
}

async function runHttpJson(worker, prompt, hooks = {}) {
  const http = worker.baseUrl.startsWith("https:") ? require("node:https") : require("node:http");

  const created = await new Promise((resolve, reject) => {
    const url = buildRemoteUrl(worker.baseUrl, "/run");
    const body = JSON.stringify({
      agentKey: worker.remoteAgentKey,
      prompt,
    });
    const req = http.request(
      {
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port,
        path: url.pathname,
        method: "POST",
        headers: {
          authorization: `Bearer ${worker.authToken}`,
          "content-type": "application/json",
          "content-length": Buffer.byteLength(body),
        },
      },
      (res) => {
        let data = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          data += chunk;
        });
        res.on("end", () => {
          if (res.statusCode !== 201) {
            reject(new Error(`remote worker create failed: ${res.statusCode} ${data}`));
            return;
          }
          resolve(JSON.parse(data));
        });
      }
    );
    req.on("error", reject);
    req.write(body);
    req.end();
  });

  return waitForRemoteJob(worker, created.id, hooks);
}

async function waitForRemoteJob(worker, jobId, hooks = {}) {
  const http = worker.baseUrl.startsWith("https:") ? require("node:https") : require("node:http");
  const timeoutMs = getTimeoutMs(worker);
  const deadline = timeoutMs ? Date.now() + timeoutMs : null;
  const seenLogs = new Map();

  while (!deadline || Date.now() < deadline) {
    await flushRemoteLogDiff(worker, jobId, seenLogs, hooks);

    const job = await new Promise((resolve, reject) => {
      const url = buildRemoteUrl(worker.baseUrl, `/jobs/${jobId}`);
      const req = http.request(
        {
          protocol: url.protocol,
          hostname: url.hostname,
          port: url.port,
          path: url.pathname,
          method: "GET",
          headers: {
            authorization: `Bearer ${worker.authToken}`,
          },
        },
        (res) => {
          let data = "";
          res.setEncoding("utf8");
          res.on("data", (chunk) => {
            data += chunk;
          });
          res.on("end", () => {
            if (res.statusCode !== 200) {
              reject(new Error(`remote worker fetch failed: ${res.statusCode}`));
              return;
            }
            resolve(JSON.parse(data));
          });
        }
      );
      req.on("error", reject);
      req.end();
    });

    if (job.status === "done" || job.status === "failed") {
      await flushRemoteLogDiff(worker, jobId, seenLogs, hooks);
      if (!job.result) {
        return {
          status: "error",
          error: job.error || "remote worker finished without result",
          raw: {},
        };
      }
      return job.result;
    }

    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  return {
    status: "error",
    error: `remote worker timed out after ${getTimeoutLabel(worker)}`,
    raw: {},
  };
}

async function runWorker(worker, prompt, hooks = {}) {
  switch (getLauncher(worker)) {
    case "codex-local":
      return runCodexLocal(worker, prompt, hooks);
    case "claude-local":
      return runClaudeLocal(worker, prompt, hooks);
    case "shell-json":
      return runShellJson(worker, prompt, hooks);
    case "ssh-codex":
      return runSshCodex(worker, prompt, hooks);
    case "ssh-shell-json":
      return runSshShellJson(worker, prompt, hooks);
    case "http-json":
      return runHttpJson(worker, prompt, hooks);
    default:
      return {
        status: "error",
        error: `unsupported launcher: ${getLauncher(worker)}`,
      };
  }
}

module.exports = {
  healthCheckWorker,
  runWorker,
};
