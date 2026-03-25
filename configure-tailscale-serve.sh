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

"${TAILSCALE_BIN}" serve --bg --set-path /agent-relay/ "http://127.0.0.1:4311/agent-relay/"
"${TAILSCALE_BIN}" serve status
