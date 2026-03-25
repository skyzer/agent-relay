const fs = require("node:fs");
const { CONFIG_LOCAL_PATH, CONFIG_EXAMPLE_PATH } = require("./paths");
const { loadEnvFile, expandEnv } = require("./env");

function getConfigPath() {
  if (fs.existsSync(CONFIG_LOCAL_PATH)) {
    return CONFIG_LOCAL_PATH;
  }
  return CONFIG_EXAMPLE_PATH;
}

function readRawConfig() {
  return JSON.parse(fs.readFileSync(getConfigPath(), "utf8"));
}

function readConfig() {
  loadEnvFile();
  return normalizeConfig(expandEnv(readRawConfig()));
}

function normalizeConfig(config) {
  const rawAgents = config.agents || {};
  const agents = Object.fromEntries(
    Object.entries(rawAgents).map(([id, worker]) => [
      id,
      {
        ...worker,
        enabled: worker.enabled !== false,
      },
    ])
  );

  return {
    ...config,
    port: Number(config.port) || 4310,
    agents,
  };
}

function updateAgentPreferences({ enabledByAgentId }) {
  const configPath = getConfigPath();
  const raw = readRawConfig();
  const enabledMap = enabledByAgentId;

  if (enabledMap && typeof enabledMap === "object") {
    for (const [agentId, enabled] of Object.entries(enabledMap)) {
      if (raw.agents && raw.agents[agentId]) {
        raw.agents[agentId].enabled = Boolean(enabled);
      }
    }
  }

  fs.writeFileSync(configPath, JSON.stringify(raw, null, 2));
  return raw;
}

module.exports = {
  readConfig,
  updateAgentPreferences,
};
