import { deepClone } from './utils.js';
import { PLUGIN_NAME } from './plugin-config.js';

function ensureState(config) {
  config.plugins ??= {};
  config.plugins.entries ??= {};
  config.plugins.entries[PLUGIN_NAME] ??= { enabled: true, config: {} };
  const pluginConfig = config.plugins.entries[PLUGIN_NAME].config ??= {};
  pluginConfig.state ??= {};
  pluginConfig.state.disabledBindingsByAgent ??= {};
  pluginConfig.state.disabledChannelAccountsByAgent ??= {};
  return pluginConfig.state;
}

function getQqbotAccounts(config) {
  const accounts = config?.channels?.qqbot?.accounts;
  return accounts && typeof accounts === 'object' ? accounts : null;
}

function disableSupportedChannelAccounts(config, bindings, agentId) {
  const state = ensureState(config);
  const snapshots = [];
  const qqbotAccounts = getQqbotAccounts(config);

  if (qqbotAccounts) {
    for (const binding of bindings) {
      const channel = binding?.match?.channel;
      const accountId = binding?.match?.accountId;
      if (channel !== 'qqbot' || !accountId || !qqbotAccounts[accountId]) {
        continue;
      }

      snapshots.push({
        channel: 'qqbot',
        accountId,
        enabled: qqbotAccounts[accountId].enabled
      });
      qqbotAccounts[accountId].enabled = false;
    }
  }

  if (snapshots.length > 0) {
    state.disabledChannelAccountsByAgent[agentId] = snapshots;
  } else {
    delete state.disabledChannelAccountsByAgent[agentId];
  }
}

function enableSupportedChannelAccounts(config, agentId, bindings) {
  const state = ensureState(config);
  const snapshots = state.disabledChannelAccountsByAgent[agentId] ?? [];
  const qqbotAccounts = getQqbotAccounts(config);

  if (qqbotAccounts) {
    const snapshotMap = new Map(
      snapshots
        .filter((snapshot) => snapshot?.channel === 'qqbot' && snapshot?.accountId)
        .map((snapshot) => [snapshot.accountId, snapshot])
    );

    for (const binding of bindings) {
      const channel = binding?.match?.channel;
      const accountId = binding?.match?.accountId;
      if (channel !== 'qqbot' || !accountId || !qqbotAccounts[accountId]) {
        continue;
      }

      const snapshot = snapshotMap.get(accountId);
      if (snapshot && snapshot.enabled !== undefined) {
        qqbotAccounts[accountId].enabled = snapshot.enabled;
      } else {
        qqbotAccounts[accountId].enabled = true;
      }
    }
  }

  delete state.disabledChannelAccountsByAgent[agentId];
}

export function disableAgentBindings(config, agentId) {
  const nextConfig = deepClone(config);
  const state = ensureState(nextConfig);
  const currentBindings = (nextConfig.bindings ?? []).filter((binding) => binding?.agentId === agentId);
  nextConfig.bindings = (nextConfig.bindings ?? []).filter((binding) => binding?.agentId !== agentId);
  state.disabledBindingsByAgent[agentId] = currentBindings;
  disableSupportedChannelAccounts(nextConfig, currentBindings, agentId);
  return {
    config: nextConfig,
    disabledBindings: currentBindings
  };
}

export function enableAgentBindings(config, agentId) {
  const nextConfig = deepClone(config);
  const state = ensureState(nextConfig);
  const activeBindings = (nextConfig.bindings ?? []).filter((binding) => binding?.agentId === agentId);
  const disabledBindings = state.disabledBindingsByAgent[agentId] ?? [];

  if (activeBindings.length === 0 && disabledBindings.length > 0) {
    nextConfig.bindings = [...(nextConfig.bindings ?? []), ...disabledBindings];
  }

  const enabledBindings = (nextConfig.bindings ?? []).filter((binding) => binding?.agentId === agentId);
  enableSupportedChannelAccounts(nextConfig, agentId, enabledBindings);
  delete state.disabledBindingsByAgent[agentId];
  return {
    config: nextConfig,
    enabledBindings
  };
}
