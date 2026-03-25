# Agent Relay

Agent Relay is a local-first control plane for your own AI agent fleet.

It does not review code itself. It accepts a task in a web UI, launches configured agents, streams their logs, and stores their final JSON results.

<img width="1252" height="682" alt="image" src="https://github.com/user-attachments/assets/2fa0480f-b950-42af-a402-aaa551f1933b" />

<img width="1253" height="643" alt="image" src="https://github.com/user-attachments/assets/271ba41e-e608-471b-85d9-8d260322d2bb" />

## Current Use Case

The main current use case is code review across your own machines and CLI agents.

Simple example:

1. A teammate sends you a GitHub PR link.
2. You paste that PR into Agent Relay.
3. Agent Relay runs your enabled agents, for example:
   - Codex on the Mac mini
   - Claude on the Mac mini
   - Codex on the MacBook Pro
4. Each agent uses its own tools and credentials to inspect the PR.
5. You watch the live logs in one place and compare the final outputs.
6. If one CLI exposes a session id, Agent Relay keeps it so you can continue later in that same session.

So the value today is not “replace GitHub review bots.”
It is “give me one place to launch and observe my own agent reviews across local and remote machines.”

## Mental Model

- `Relay`
  The coordinator and the web UI.
- `Host`
  A machine that can run agents.
- `Agent`
  One runnable entry on a host, such as Codex, Claude, or Kimi.

The important part:

- the relay can launch agents directly on the same machine it runs on
- you only need a separate host process for other machines

So your Mac mini can be:

- the relay
- a local host for local agents

And you can add any number of extra remote hosts later.

## URLs and Ports

Default local ports:

- `4310`
  The actual Agent Relay app and API.
- `4311`
  A small internal proxy used only for serving the app under a Tailscale subpath.
- `4320`
  The host API on a remote machine, if you run a separate host.

Normal local usage:

- `http://127.0.0.1:4310/`

Tailscale usage:

- Relay: `https://YOUR-HOSTNAME.ts.net/agent-relay/`
- Host: `https://YOUR-HOSTNAME.ts.net/agent-host/health`

Why two local relay ports exist:

- `4310` is the real app
- `4311` is only the subpath shim for `/agent-relay/`

You normally do not open `4311` directly.

## Quick Start

Install dependencies:

```bash
npm install
```

Create your env file:

```bash
cp .env.example .env
```

Start the relay:

```bash
npm start
```

Open:

```text
http://127.0.0.1:4310/
```

## Environment Variables

Current variables in [`.env.example`](./.env.example):

- `AGENT_RELAY_PORT`
  Relay port. Default `4310`.
- `AGENT_HOST_PORT`
  Host API port. Default `4320`.
- `AGENT_HOST_TOKEN`
  Shared bearer token used when Relay talks to a remote host.

If Relay and the agents live on the same machine, you can still keep the token set, but you do not need to run a separate host process there.

## Config Files

Committed examples:

- [`config/agent-relay.example.json`](./config/agent-relay.example.json)
- [`config/host.example.json`](./config/host.example.json)

Local machine-specific files:

- `config/agent-relay.local.json`
- `config/host.local.json`

Rule of thumb:

- commit the `*.example.json` files
- edit the `*.local.json` files on your own machines
- the local files are ignored by Git

## Relay Config

Main relay example config lives in [`config/agent-relay.example.json`](./config/agent-relay.example.json).

For your actual machine, edit:

- `config/agent-relay.local.json`

Important fields:

- `port`
  Relay port.
- `agents`
  All configured agent entries.
- `label`
  Name shown in the UI.
- `hostLabel`
  Which host group the agent appears under in the UI.
- `launcher`
  How Relay starts this agent.
- `cwd`
  Working directory before the CLI starts.
- `command`
  Executable to run for local launchers.
- `baseUrl`
  Remote host URL for `http-json` agents.
- `authToken`
  Shared token for remote hosts.
- `remoteAgentKey`
  The remote agent id on that host.
- `timeoutSec`
  Optional hard timeout in seconds. Omit it for no timeout.

### Launcher Types

Current launcher values:

- `codex-local`
  Starts local `codex`.
- `claude-local`
  Starts local `claude`.
- `shell-json`
  Starts a generic local CLI that returns JSON-like text. Good for tools like `kimi`.
- `http-json`
  Sends the task to a remote host over HTTP.

### Example: Local Agent

```json
{
  "agents": {
    "codex-mini": {
      "label": "Codex on Mac mini",
      "hostLabel": "Mac mini",
      "launcher": "codex-local",
      "cwd": "${HOME}",
      "command": "codex"
    }
  }
}
```

### Example: Local Kimi Agent

```json
{
  "agents": {
    "kimi-mini": {
      "label": "Kimi on Mac mini",
      "hostLabel": "Mac mini",
      "launcher": "shell-json",
      "cwd": "${HOME}",
      "command": "kimi",
      "args": [
        "--print",
        "--output-format",
        "text",
        "--final-message-only",
        "-p"
      ]
    }
  }
}
```

### Example: Remote Agent On Another Host

```json
{
  "agents": {
    "codex-mbp": {
      "label": "Codex on MacBook Pro",
      "hostLabel": "MacBook Pro",
      "launcher": "http-json",
      "baseUrl": "https://your-macbook-pro.ts.net/agent-host",
      "authToken": "${AGENT_HOST_TOKEN}",
      "remoteAgentKey": "codex"
    }
  }
}
```

## Host Config

Host example config lives in [`config/host.example.json`](./config/host.example.json).

You only need this on a machine that should expose a remote host API.

For your actual machine, edit:

- `config/host.local.json`

Example:

```json
{
  "port": "${AGENT_HOST_PORT}",
  "listenHost": "127.0.0.1",
  "authToken": "${AGENT_HOST_TOKEN}",
  "agents": {
    "codex": {
      "label": "Codex local agent",
      "launcher": "codex-local",
      "cwd": "${HOME}",
      "command": "codex"
    }
  }
}
```

## Recommended Setup

Use one relay, plus:

- local agents on the same machine when possible
- separate remote hosts only when you need agents on other machines

### Example: Mac mini Relay With Local Agents And One Remote MacBook Pro Host

This is the practical mixed setup:

- Relay runs on the Mac mini
- the Mac mini also runs local agents directly
- the MacBook Pro runs one separate host process

Edit these exact files:

- On the Mac mini:
  - [`.env.example`](./.env.example) copied to `.env`
  - `config/agent-relay.local.json`
- On the MacBook Pro:
  - [`.env.example`](./.env.example) copied to `.env`
  - `config/host.local.json`

### Mac mini `.env`

File:

- `.env`

Example contents:

```env
AGENT_RELAY_PORT=4310
AGENT_HOST_PORT=4320
AGENT_HOST_TOKEN=CHANGE_ME_SHARED_TOKEN
```

### Mac mini `config/agent-relay.local.json`

File:

- `config/agent-relay.local.json`

Example contents:

```json
{
  "agents": {
    "codex-mini": {
      "label": "Codex on Mac mini",
      "hostLabel": "Mac mini",
      "launcher": "codex-local",
      "cwd": "${HOME}",
      "command": "codex"
    },
    "claude-mini": {
      "label": "Claude on Mac mini",
      "hostLabel": "Mac mini",
      "launcher": "claude-local",
      "cwd": "${HOME}",
      "command": "claude"
    },
    "kimi-mini": {
      "label": "Kimi on Mac mini",
      "hostLabel": "Mac mini",
      "launcher": "shell-json",
      "cwd": "${HOME}",
      "command": "kimi",
      "args": [
        "--print",
        "--output-format",
        "text",
        "--final-message-only",
        "-p"
      ]
    },
    "codex-mbp": {
      "label": "Codex on MacBook Pro",
      "hostLabel": "MacBook Pro",
      "launcher": "http-json",
      "baseUrl": "https://your-macbook-pro.ts.net/agent-host",
      "authToken": "${AGENT_HOST_TOKEN}",
      "remoteAgentKey": "codex"
    },
    "kimi-mbp": {
      "label": "Kimi on MacBook Pro",
      "hostLabel": "MacBook Pro",
      "launcher": "http-json",
      "baseUrl": "https://your-macbook-pro.ts.net/agent-host",
      "authToken": "${AGENT_HOST_TOKEN}",
      "remoteAgentKey": "kimi"
    }
  }
}
```

Notes:

- `codex-mini`, `claude-mini`, and `kimi-mini` run directly on the Mac mini
- `codex-mbp` and `kimi-mbp` call the remote MacBook Pro host over HTTP
- if you do not want a local Kimi agent on the Mac mini, leave `"enabled": false`

### MacBook Pro `.env`

File:

- `.env`

Example contents:

```env
AGENT_RELAY_PORT=4310
AGENT_HOST_PORT=4320
AGENT_HOST_TOKEN=CHANGE_ME_SHARED_TOKEN
```

### MacBook Pro `config/host.local.json`

File:

- `config/host.local.json`

Example contents:

```json
{
  "port": "${AGENT_HOST_PORT}",
  "listenHost": "127.0.0.1",
  "authToken": "${AGENT_HOST_TOKEN}",
  "agents": {
    "codex": {
      "label": "Codex local agent",
      "launcher": "codex-local",
      "enabled": true,
      "cwd": "${HOME}",
      "command": "codex"
    },
    "kimi": {
      "label": "Kimi local agent",
      "launcher": "shell-json",
      "enabled": true,
      "cwd": "${HOME}",
      "command": "kimi",
      "args": [
        "--print",
        "--output-format",
        "text",
        "--final-message-only",
        "-p"
      ]
    }
  }
}
```

Run order in that setup:

- you run `npm start` on the Mac mini
- you do not run `npm run host` on the Mac mini unless you specifically want to expose it as a remote host too
- you run `npm run host` on the MacBook Pro

Verification:

- on Mac mini:
  - open `http://127.0.0.1:4310/`
- on MacBook Pro:
  - open `http://127.0.0.1:4320/health`

### Example: Mac mini only

This is the easiest setup.

- Relay runs on Mac mini
- Codex/Claude/Kimi are installed on Mac mini
- Relay launches them directly

Steps:

1. Add local agents to `config/agent-relay.local.json`
2. Start Relay:

```bash
npm start
```

That is all.

You do **not** need to run `npm run host` on that same machine.

### Example: Mac mini relay + MacBook Pro host

- Relay runs on Mac mini
- Mac mini can still run its own local agents directly
- MacBook Pro runs a separate host process for its own local agents

#### On the relay machine

1. Edit `config/agent-relay.local.json`
2. Add remote agents with `launcher: "http-json"` and the MacBook Pro host URL
3. Set `.env`:

```bash
cp .env.example .env
```

At minimum:

```env
AGENT_RELAY_PORT=4310
AGENT_HOST_TOKEN=CHANGE_ME
```

4. Start Relay:

```bash
npm start
```

#### On the MacBook Pro

1. Clone the repo
2. Install dependencies:

```bash
npm install
```

3. Create `.env`:

```bash
cp .env.example .env
```

At minimum:

```env
AGENT_HOST_PORT=4320
AGENT_HOST_TOKEN=THE_SAME_TOKEN_AS_THE_RELAY
```

4. Edit `config/host.local.json` so the local agents match what is installed on that MacBook Pro
5. Start the host:

```bash
npm run host
```

6. Verify:

```text
http://127.0.0.1:4320/health
```

## Tailscale

### Relay under `/agent-relay/`

Relay itself runs on:

- `http://127.0.0.1:4310/`

The local proxy on `4311` exists only to make this subpath work:

- `/agent-relay/`

The helper script:

```bash
./configure-tailscale-serve.sh
```

sets Tailscale Serve to:

```text
/agent-relay/ -> http://127.0.0.1:4311/agent-relay/
```

### Remote host over Tailscale

On the remote machine:

```bash
./host-configure-tailscale-serve.sh
```

This exposes the host under:

```text
https://YOUR-HOSTNAME.ts.net/agent-host/
```

## Session IDs

If a CLI prints a recognizable session id, Relay stores it and shows it on past jobs.

That makes it possible to continue work later in the original agent session.

## Scripts

- `npm start`
  Start Relay.
- `npm run host`
  Start the host API on a machine that should expose remote agents.
- `npm run build`
  Build the frontend into `public/`.

## Skill And Prompt Presets

This repo includes separate drafts for three integration paths:

- OpenClaw skill:
  - [`skills/agent-relay-review/SKILL.md`](./skills/agent-relay-review/SKILL.md)
- Claude Project / system prompt draft:
  - [`integrations/claude/AGENT_RELAY_PROJECT.md`](./integrations/claude/AGENT_RELAY_PROJECT.md)
- OpenAI Custom GPT / hosted agent draft:
  - [`integrations/openai/AGENT_RELAY_CUSTOM_GPT.md`](./integrations/openai/AGENT_RELAY_CUSTOM_GPT.md)

They are intended as practical starting points for running Agent Relay from other AI control surfaces.
