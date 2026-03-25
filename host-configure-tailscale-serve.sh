#!/bin/bash
set -euo pipefail

TAILSCALE_BIN="/Applications/Tailscale.app/Contents/MacOS/Tailscale"

if [ ! -x "${TAILSCALE_BIN}" ]; then
  if command -v tailscale >/dev/null 2>&1; then
    TAILSCALE_BIN="$(command -v tailscale)"
  else
    echo "Could not find the Tailscale CLI." >&2
    exit 1
  fi
fi

"${TAILSCALE_BIN}" serve --bg --set-path /agent-host/ "http://127.0.0.1:4320/agent-host/"
"${TAILSCALE_BIN}" serve status
