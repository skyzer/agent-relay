#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:${PATH:-}"

NODE_BIN="${NODE_BIN:-$(command -v node)}"

if [ -z "${NODE_BIN}" ]; then
  echo "Could not find node in PATH." >&2
  exit 1
fi

RELAY_PID=""
PROXY_PID=""

cleanup() {
  if [ -n "${PROXY_PID}" ] && kill -0 "${PROXY_PID}" >/dev/null 2>&1; then
    kill "${PROXY_PID}" >/dev/null 2>&1 || true
  fi
  if [ -n "${RELAY_PID}" ] && kill -0 "${RELAY_PID}" >/dev/null 2>&1; then
    kill "${RELAY_PID}" >/dev/null 2>&1 || true
  fi
}

trap cleanup EXIT INT TERM

"${NODE_BIN}" "${SCRIPT_DIR}/agent-relay-subpath-proxy.mjs" &
PROXY_PID=$!

"${NODE_BIN}" "${SCRIPT_DIR}/server.js" &
RELAY_PID=$!

wait "${RELAY_PID}"
