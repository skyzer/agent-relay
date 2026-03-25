#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LAUNCH_AGENTS_DIR="${HOME}/Library/LaunchAgents"
LOG_DIR="${HOME}/Library/Logs/agent-relay"
SERVER_LABEL="${AGENT_RELAY_SERVER_LABEL:-com.${USER}.agent-relay}"
SERVER_AGENT="${LAUNCH_AGENTS_DIR}/${SERVER_LABEL}.plist"

mkdir -p "${LOG_DIR}"
chmod +x \
  "${SCRIPT_DIR}/run-agent-relay-server.sh" \
  "${SCRIPT_DIR}/configure-tailscale-serve.sh" \
  "${SCRIPT_DIR}/install-tailnet.sh"

if [ ! -f "${SERVER_AGENT}" ]; then
  cat >&2 <<EOF
Expected launchd plist file was not found:
  ${SERVER_AGENT}

This helper assumes you already created a user LaunchAgent for the relay.
You can either create those plist files yourself or run the relay manually and only use:
  ${SCRIPT_DIR}/configure-tailscale-serve.sh
EOF
  exit 1
fi

launchctl bootout "gui/$(id -u)" "${SERVER_AGENT}" >/dev/null 2>&1 || true
launchctl bootstrap "gui/$(id -u)" "${SERVER_AGENT}"
launchctl kickstart -k "gui/$(id -u)/${SERVER_LABEL}"

"${SCRIPT_DIR}/configure-tailscale-serve.sh"

echo
echo "Agent Relay should now be available on your configured Tailscale Serve path."
