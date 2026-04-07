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

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const ROOT_CHANNEL_KEYS_TO_PRESERVE = new Set(['enabled', 'accounts', 'defaultAccount']);

function selectBoundChannels(sourceChannels, bindings, skipChannels = []) {
  const selected = {};
  const accountScopedChannels = new Map();

  for (const binding of bindings) {
    const channelId = binding?.match?.channel;
    if (!channelId || skipChannels.includes(channelId)) {
      continue;
    }

    const sourceChannel = sourceChannels?.[channelId];
    if (!isRecord(sourceChannel)) {
      continue;
    }

    const accountId = binding?.match?.accountId ?? null;
    const sourceAccounts = isRecord(sourceChannel.accounts) ? sourceChannel.accounts : null;
    const sourceAccount = accountId && sourceAccounts && isRecord(sourceAccounts[accountId])
      ? sourceAccounts[accountId]
      : null;

    if (sourceAccount) {
      selected[channelId] ??= {};
      selected[channelId].accounts ??= {};
      selected[channelId].accounts[accountId] = deepClone(sourceAccount);
      accountScopedChannels.set(channelId, true);
      continue;
    }

    selected[channelId] = mergeObjects(selected[channelId] ?? {}, deepClone(sourceChannel));
  }

  return {
    channels: selected,
    accountScopedChannels: [...accountScopedChannels.keys()]
  };
}

function pruneRootChannelFieldsForAccountScopedImports(targetChannels, importedChannels, accountScopedChannels) {
  for (const channelId of accountScopedChannels) {
    const targetChannel = targetChannels?.[channelId];
    const importedChannel = importedChannels?.[channelId];
    if (!isRecord(targetChannel) || !isRecord(importedChannel?.accounts)) {
      continue;
    }

    const importedRootKeys = new Set();
    for (const accountConfig of Object.values(importedChannel.accounts)) {
      if (!isRecord(accountConfig)) {
        continue;
      }

      for (const key of Object.keys(accountConfig)) {
        if (!ROOT_CHANNEL_KEYS_TO_PRESERVE.has(key)) {
          importedRootKeys.add(key);
        }
      }
    }

    for (const key of importedRootKeys) {
      delete targetChannel[key];
    }
  }
}

export function mergeOpenClawConfig({ sourceConfig, targetConfig, agentId, sourceAgentId = agentId, openClawDir, skipChannels = [], skipPlugins = [] }) {
  const source = ensureConfigShape(sourceConfig, openClawDir);
  const target = ensureConfigShape(targetConfig, openClawDir);
  const result = deepClone(target);

  const sourceAgent = findAgent(source, sourceAgentId);
  if (!sourceAgent) {
    throw new Error(`Source package does not include agent: ${sourceAgentId}`);
  }

  const targetAgentIndex = result.agents.list.findIndex((agent) => agent?.id === agentId);
  const targetAgent = targetAgentIndex >= 0 ? result.agents.list[targetAgentIndex] : null;
  const mergedAgent = deepClone(sourceAgent);
  mergedAgent.id = agentId;
  mergedAgent.workspace = buildWorkspacePath({ sourceConfig: source, sourceAgent, targetConfig: target, targetAgent, agentId, openClawDir });
  mergedAgent.agentDir = path.join(openClawDir, 'agents', agentId);

  if (targetAgentIndex >= 0) {
    result.agents.list[targetAgentIndex] = mergedAgent;
  } else {
    result.agents.list.push(mergedAgent);
  }

  const sourceBindings = (source.bindings ?? [])
    .filter((binding) => binding?.agentId === sourceAgentId)
    .map((binding) => ({ ...deepClone(binding), agentId }));
  const otherBindings = (result.bindings ?? []).filter((binding) => binding?.agentId !== agentId);
  result.bindings = [...otherBindings, ...deepClone(sourceBindings)];
  const selectedChannels = selectBoundChannels(source.channels ?? {}, sourceBindings, skipChannels);

  result.agents.defaults = mergeObjects(result.agents.defaults, source.agents.defaults ?? {});
  result.tools = mergeObjects(result.tools ?? {}, source.tools ?? {});
  result.messages = mergeObjects(result.messages ?? {}, source.messages ?? {});
  result.hooks = mergeObjects(result.hooks ?? {}, source.hooks ?? {});
  result.models = mergeObjects(result.models ?? {}, source.models ?? {});
  result.channels ??= {};
  pruneRootChannelFieldsForAccountScopedImports(result.channels, selectedChannels.channels, selectedChannels.accountScopedChannels);
  result.channels = mergeObjects(result.channels, selectedChannels.channels);

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
