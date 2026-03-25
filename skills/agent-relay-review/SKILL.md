---
name: agent-relay-review
description: Submit one or more PR review jobs to Agent Relay, then poll for status and summarize the result. Use when the user wants their existing local or remote CLI agents to review code through Agent Relay.
license: MIT
metadata:
  author: Agent Relay
  version: "1.0.0"
  openclaw:
    requires:
      bins:
        - curl
---

# Agent Relay Review

Use this skill when the user wants to launch code review jobs through Agent Relay instead of reviewing code directly in the current session.

## Inputs

- One or more PR URLs
- Optional extra instructions

## Defaults

- Local Relay URL: `http://127.0.0.1:4310`
- Tailnet Relay URL: `https://YOUR-HOSTNAME.ts.net/agent-relay/`
- API base: `<relay-base-url>/api`

Prefer the local Relay URL when running on the same machine.

## Submit a Job

Send a `POST` request to `/api/reviews`.

Example:

```bash
curl -s http://127.0.0.1:4310/api/reviews \
  -H 'Content-Type: application/json' \
  -d '{
    "prUrls": [
      "https://github.com/owner/repo/pull/123"
    ],
    "instructions": "Focus on correctness and tests."
  }'
```

Expected response:

- `id`
- `status`
- `createdAt`

## Poll for Status

Poll:

```bash
curl -s http://127.0.0.1:4310/api/reviews
```

or fetch one job:

```bash
curl -s http://127.0.0.1:4310/api/reviews/<job-id>
```

Possible statuses:

- `queued`
- `running`
- `done`
- `failed`

## Important Behavior

- Do not add extra review instructions that the user did not ask for.
- Treat the user’s PR URLs and free-form instructions as the source of truth.
- If the user asks for one specific agent, tell them to disable the others in the Relay UI first.
- Do not claim that comments were posted to GitHub unless the Relay result explicitly says so.

## How to Respond

When the job is accepted:

- report the job id
- report whether it is queued or running

When the job finishes:

- summarize which agents ran
- summarize the final per-agent result
- include any session ids if present

## Failure Handling

If the Relay API returns an error:

- surface the exact error text
- do not invent fallback behavior

If a remote agent host is unhealthy:

- say which agent is unavailable
- recommend checking `/api/agents` in the Relay UI or `GET /health` on the remote host
