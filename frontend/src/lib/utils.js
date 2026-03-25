import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs) {
  return twMerge(clsx(inputs));
}

export async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { "content-type": "application/json" },
    ...options,
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) {
    throw new Error((data && data.error) || `Request failed: ${response.status}`);
  }
  return data;
}

export function formatAbsoluteDate(value) {
  const date = new Date(value);
  return date.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export function formatRelativeDate(value) {
  const date = new Date(value);
  const diffMs = Date.now() - date.getTime();
  const diffSec = Math.round(diffMs / 1000);
  if (Math.abs(diffSec) < 60) {
    return `${diffSec}s ago`;
  }
  const diffMin = Math.round(diffSec / 60);
  if (Math.abs(diffMin) < 60) {
    return `${diffMin}m ago`;
  }
  const diffHour = Math.round(diffMin / 60);
  if (Math.abs(diffHour) < 24) {
    return `${diffHour}h ago`;
  }
  const diffDay = Math.round(diffHour / 24);
  return `${diffDay}d ago`;
}

export function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

export function markdownToHtml(markdown) {
  const escaped = escapeHtml(markdown || "");
  const fenced = escaped.replace(/```([\s\S]*?)```/g, (_, code) => `<pre><code>${code.trim()}</code></pre>`);
  const headers = fenced
    .replace(/^#### (.*)$/gm, "<h4>$1</h4>")
    .replace(/^### (.*)$/gm, "<h3>$1</h3>")
    .replace(/^## (.*)$/gm, "<h2>$1</h2>")
    .replace(/^# (.*)$/gm, "<h1>$1</h1>");
  const bold = headers.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  const inlineCode = bold.replace(/`([^`]+)`/g, "<code>$1</code>");
  const withLists = inlineCode.replace(/(?:^|\n)(- .+(?:\n- .+)*)/g, (block) => {
    const items = block
      .trim()
      .split("\n")
      .map((line) => line.replace(/^- /, "").trim())
      .map((line) => `<li>${line}</li>`)
      .join("");
    return `\n<ul>${items}</ul>`;
  });
  return withLists
    .split(/\n{2,}/)
    .map((block) => {
      const trimmed = block.trim();
      if (!trimmed) {
        return "";
      }
      if (trimmed.startsWith("<h") || trimmed.startsWith("<ul>") || trimmed.startsWith("<pre>")) {
        return trimmed;
      }
      return `<p>${trimmed.replace(/\n/g, "<br>")}</p>`;
    })
    .join("\n");
}

export function compactSummary(value, fallback = "No summary") {
  const text = String(value || fallback).trim().replace(/\s+/g, " ");
  return text.length > 110 ? `${text.slice(0, 107)}...` : text;
}

export function hasLogContent(job, logsByJob) {
  const cached = logsByJob[job.id];
  if (cached && Object.values(cached).some((text) => String(text || "").trim().length > 0)) {
    return true;
  }
  return (job.results || []).some(
    (result) =>
      (result.raw && typeof result.raw.stdout === "string" && result.raw.stdout.trim()) ||
      (result.raw && typeof result.raw.stderr === "string" && result.raw.stderr.trim())
  );
}

export function workerDevice(id, worker) {
  if (worker.hostLabel) {
    return worker.hostLabel;
  }
  if (id.endsWith("-mbp") || String(worker.label || "").includes("MacBook Pro")) {
    return "MacBook Pro";
  }
  return "Mac mini";
}

export function workerLocation(worker) {
  const launcher = worker.launcher;
  return launcher === "http-json" ? "Remote launch" : "Local launch";
}

export function extractSessionId(result) {
  if (result.sessionId) {
    return result.sessionId;
  }

  const texts = [result.raw?.stdout, result.raw?.stderr].filter(Boolean);
  const patterns = [
    /session id:\s*([a-z0-9-]+)/i,
    /session[_ -]?id["'\s:=]+([a-z0-9-]+)/i,
    /"sessionId"\s*:\s*"([^"]+)"/i,
  ];

  for (const text of texts) {
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match) {
        return match[1];
      }
    }
  }

  return null;
}
