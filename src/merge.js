import path from 'node:path';
import { findAgent } from './openclaw-state.js';
import { deepClone, mergeObjects } from './utils.js';

function ensureConfigShape(config, openClawDir) {
  const result = deepClone(config ?? {});
  result.meta ??= {};
  result.agents ??= {};
  result.agents.defaults ??= {};
  result.agents.list ??= [];
  result.gateway ??= { port: 18789, mode: 'local', bind: 'loopback' };
  result.session ??= {};
  if (!result.agents.defaults.workspace) {
    result.agents.defaults.workspace = path.join(openClawDir, 'workspace');
  }
  return result;
}

function buildWorkspacePath({ sourceConfig, sourceAgent, targetConfig, targetAgent, agentId, openClawDir }) {
  if (targetAgent?.workspace) {
    return targetAgent.workspace;
  }

  const targetDefault = targetConfig?.agents?.defaults?.workspace;
  const sourceWorkspace = sourceAgent?.workspace ?? sourceConfig?.agents?.defaults?.workspace;
  if (!sourceWorkspace && targetDefault) {
    return targetDefault;
  }

  const defaultBaseDir = targetDefault ? path.dirname(targetDefault) : openClawDir;
  if (!sourceWorkspace) {
    return path.join(defaultBaseDir, agentId === 'main' ? 'workspace' : `workspace-${agentId}`);
  }

  return path.join(defaultBaseDir, path.basename(sourceWorkspace));
}

function omitKeys(record, keysToOmit = []) {
  const source = deepClone(record ?? {});
  for (const key of keysToOmit) {
    delete source[key];
  }
  return source;
}

export function mergeOpenClawConfig({ sourceConfig, targetConfig, agentId, openClawDir, skipChannels = [], skipPlugins = [] }) {
  const source = ensureConfigShape(sourceConfig, openClawDir);
  const target = ensureConfigShape(targetConfig, openClawDir);
  const result = deepClone(target);

  const sourceAgent = findAgent(source, agentId);
  if (!sourceAgent) {
    throw new Error(`Source package does not include agent: ${agentId}`);
  }

  const targetAgentIndex = result.agents.list.findIndex((agent) => agent?.id === agentId);
  const targetAgent = targetAgentIndex >= 0 ? result.agents.list[targetAgentIndex] : null;
  const mergedAgent = deepClone(sourceAgent);
  mergedAgent.workspace = buildWorkspacePath({ sourceConfig: source, sourceAgent, targetConfig: target, targetAgent, agentId, openClawDir });
  mergedAgent.agentDir = path.join(openClawDir, 'agents', agentId);

  if (targetAgentIndex >= 0) {
    result.agents.list[targetAgentIndex] = mergedAgent;
  } else {
    result.agents.list.push(mergedAgent);
  }

  const sourceBindings = (source.bindings ?? []).filter((binding) => binding?.agentId === agentId);
  const otherBindings = (result.bindings ?? []).filter((binding) => binding?.agentId !== agentId);
  result.bindings = [...otherBindings, ...deepClone(sourceBindings)];

  result.agents.defaults = mergeObjects(result.agents.defaults, source.agents.defaults ?? {});
  result.tools = mergeObjects(result.tools ?? {}, source.tools ?? {});
  result.messages = mergeObjects(result.messages ?? {}, source.messages ?? {});
  result.hooks = mergeObjects(result.hooks ?? {}, source.hooks ?? {});
  result.models = mergeObjects(result.models ?? {}, source.models ?? {});
  result.channels = mergeObjects(result.channels ?? {}, omitKeys(source.channels ?? {}, skipChannels));

  result.plugins ??= {};
  result.plugins.entries = mergeObjects(result.plugins.entries ?? {}, omitKeys(source.plugins?.entries ?? {}, skipPlugins));
  result.skills ??= {};
  result.skills.entries = mergeObjects(result.skills.entries ?? {}, source.skills?.entries ?? {});

  if (source.session) {
    result.session = deepClone(source.session);
  }

  if (!target.gateway && source.gateway) {
    result.gateway = deepClone(source.gateway);
    delete result.gateway.auth;
  }

  result.meta.lastTouchedVersion = source.meta?.lastTouchedVersion ?? result.meta.lastTouchedVersion ?? null;
  result.meta.lastTouchedAt = new Date().toISOString();
  return result;
}
