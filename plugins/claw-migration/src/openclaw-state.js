import os from 'node:os';
import path from 'node:path';
import { readJson } from './utils.js';

export function resolveOpenClawDir(options = {}) {
  if (options.openClawDir) {
    return path.resolve(options.openClawDir);
  }
  const homeDir = os.homedir();
  return path.join(homeDir, '.openclaw');
}

export function findAgent(config, agentId) {
  const agents = config?.agents?.list ?? [];
  return agents.find((agent) => agent?.id === agentId) ?? null;
}

export function resolveWorkspacePath(config, agent) {
  if (agent?.workspace) {
    return path.resolve(agent.workspace);
  }
  if (config?.agents?.defaults?.workspace) {
    return path.resolve(config.agents.defaults.workspace);
  }
  return null;
}

export async function loadOpenClawState({ openClawDir, agentId }) {
  const resolvedDir = resolveOpenClawDir({ openClawDir });
  const configPath = path.join(resolvedDir, 'openclaw.json');
  const config = await readJson(configPath);
  const agent = findAgent(config, agentId);
  if (!agent) {
    throw new Error(`Agent not found: ${agentId}`);
  }

  const workspacePath = resolveWorkspacePath(config, agent);
  if (!workspacePath) {
    throw new Error(`Workspace not configured for agent: ${agentId}`);
  }

  return {
    openClawDir: resolvedDir,
    config,
    configPath,
    agent,
    agentId,
    agentDir: path.join(resolvedDir, 'agents', agentId),
    workspacePath
  };
}
