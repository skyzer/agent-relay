function buildRelayPrompt(job, worker) {
  const targets = (job.prUrls && job.prUrls.length > 0 ? job.prUrls : [job.prUrl])
    .filter(Boolean)
    .map((url) => `- ${url}`)
    .join("\n");

  return [
    `Agent label: ${worker.label}`,
    "",
    "Targets:",
    targets || "- No explicit targets",
    "",
    "Instructions:",
    job.instructions ? job.instructions : "No extra instructions provided.",
    "",
    "Behavior:",
    "- Use your own configured tools, skills, and credentials.",
    "- Treat the Targets and Instructions above as the source of truth for what to do.",
    "- Do not assume any extra PR workflow beyond what the user explicitly asked for.",
    "- If you post any GitHub PR review, PR comment, or inline comment, identify yourself as this exact agent label.",
    `- Use this exact agent identifier in posted GitHub content: ${worker.label}`,
    "- For top-level GitHub reviews/comments, include a line like: `Agent: <agent label>` near the top.",
    "- For inline GitHub comments, prefix the comment body with `[<agent label>]`.",
    "- Return JSON only describing what you did.",
    "",
    "Required JSON shape:",
    "{\"status\":\"success|partial|failed\",\"summary\":\"short summary\",\"details\":\"optional longer details\"}",
  ].join("\n");
}

module.exports = {
  buildRelayPrompt,
};
