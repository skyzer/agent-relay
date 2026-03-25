const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const STATE_DIR = path.join(ROOT, "state");
const QUEUE_DIR = path.join(STATE_DIR, "queue");
const RUNNING_DIR = path.join(STATE_DIR, "running");
const DONE_DIR = path.join(STATE_DIR, "done");
const FAILED_DIR = path.join(STATE_DIR, "failed");
const TMP_DIR = path.join(ROOT, "tmp");
const PUBLIC_DIR = path.join(ROOT, "public");
const CONFIG_LOCAL_PATH = path.join(ROOT, "config", "agent-relay.local.json");
const CONFIG_EXAMPLE_PATH = path.join(ROOT, "config", "agent-relay.example.json");
const HOST_CONFIG_LOCAL_PATH = path.join(ROOT, "config", "host.local.json");
const HOST_CONFIG_EXAMPLE_PATH = path.join(ROOT, "config", "host.example.json");
const RELAY_RESULT_SCHEMA_PATH = path.join(ROOT, "schemas", "relay-result.schema.json");
const HOST_STATE_DIR = path.join(ROOT, "host-state");
const HOST_QUEUE_DIR = path.join(HOST_STATE_DIR, "queue");
const HOST_RUNNING_DIR = path.join(HOST_STATE_DIR, "running");
const HOST_DONE_DIR = path.join(HOST_STATE_DIR, "done");
const HOST_FAILED_DIR = path.join(HOST_STATE_DIR, "failed");

module.exports = {
  ROOT,
  STATE_DIR,
  QUEUE_DIR,
  RUNNING_DIR,
  DONE_DIR,
  FAILED_DIR,
  TMP_DIR,
  PUBLIC_DIR,
  CONFIG_LOCAL_PATH,
  CONFIG_EXAMPLE_PATH,
  HOST_CONFIG_LOCAL_PATH,
  HOST_CONFIG_EXAMPLE_PATH,
  RELAY_RESULT_SCHEMA_PATH,
  HOST_STATE_DIR,
  HOST_QUEUE_DIR,
  HOST_RUNNING_DIR,
  HOST_DONE_DIR,
  HOST_FAILED_DIR,
};
