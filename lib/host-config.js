const fs = require("node:fs");
const { HOST_CONFIG_LOCAL_PATH, HOST_CONFIG_EXAMPLE_PATH } = require("./paths");
const { loadEnvFile, expandEnv } = require("./env");

function getHostConfigPath() {
  if (fs.existsSync(HOST_CONFIG_LOCAL_PATH)) {
    return HOST_CONFIG_LOCAL_PATH;
  }
  return HOST_CONFIG_EXAMPLE_PATH;
}

function readHostConfig() {
  loadEnvFile();
  return normalizeHostConfig(expandEnv(JSON.parse(fs.readFileSync(getHostConfigPath(), "utf8"))));
}

function normalizeHostConfig(config) {
  const rawAgents = config.agents || {};
  const agents = Object.fromEntries(
    Object.entries(rawAgents).map(([id, agent]) => [
      id,
      {
        ...agent,
        enabled: agent.enabled !== false,
      },
    ])
  );

  return {
    ...config,
    port: Number(config.port) || 4320,
    agents,
  };
}

module.exports = {
  readHostConfig,
};
