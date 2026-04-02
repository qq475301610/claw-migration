import { deepClone } from './utils.js';
import { PLUGIN_NAME } from './plugin-config.js';

const SUPPORTED_CHANNEL_IDS = new Set([
  'dingtalk',
  'feishu-china',
  'qqbot',
  'wechat-mp',
  'wecom',
  'wecom-app',
  'wecom-kf'
]);

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

function getChannelConfig(config, channelId) {
  const channelConfig = config?.channels?.[channelId];
  return channelConfig && typeof channelConfig === 'object' ? channelConfig : null;
}

function getChannelAccounts(channelConfig) {
  const accounts = channelConfig?.accounts;
  return accounts && typeof accounts === 'object' ? accounts : null;
}

function buildSnapshotKey(snapshot) {
  return [snapshot.channel, snapshot.scope, snapshot.accountId ?? ''].join(':');
}

function disableSupportedChannelAccounts(config, bindings, agentId) {
  const state = ensureState(config);
  const snapshots = [];
  const seen = new Set();

  for (const binding of bindings) {
    const channelId = binding?.match?.channel;
    const accountId = binding?.match?.accountId ?? null;
    if (!SUPPORTED_CHANNEL_IDS.has(channelId)) {
      continue;
    }

    const channelConfig = getChannelConfig(config, channelId);
    if (!channelConfig) {
      continue;
    }

    const accounts = getChannelAccounts(channelConfig);
    if (accountId && accounts?.[accountId] && typeof accounts[accountId] === 'object') {
      const snapshot = {
        channel: channelId,
        scope: 'account',
        accountId,
        enabled: accounts[accountId].enabled
      };
      const key = buildSnapshotKey(snapshot);
      if (!seen.has(key)) {
        seen.add(key);
        snapshots.push(snapshot);
      }
      accounts[accountId].enabled = false;
      continue;
    }

    const snapshot = {
      channel: channelId,
      scope: 'root',
      accountId,
      enabled: channelConfig.enabled
    };
    const key = buildSnapshotKey(snapshot);
    if (!seen.has(key)) {
      seen.add(key);
      snapshots.push(snapshot);
    }
    channelConfig.enabled = false;
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
  const snapshotMap = new Map(snapshots.map((snapshot) => [buildSnapshotKey(snapshot), snapshot]));

  for (const binding of bindings) {
    const channelId = binding?.match?.channel;
    const accountId = binding?.match?.accountId ?? null;
    if (!SUPPORTED_CHANNEL_IDS.has(channelId)) {
      continue;
    }

    const channelConfig = getChannelConfig(config, channelId);
    if (!channelConfig) {
      continue;
    }

    const accounts = getChannelAccounts(channelConfig);
    if (accountId && accounts?.[accountId] && typeof accounts[accountId] === 'object') {
      const snapshot = snapshotMap.get(buildSnapshotKey({ channel: channelId, scope: 'account', accountId }));
      if (snapshot && snapshot.enabled !== undefined) {
        accounts[accountId].enabled = snapshot.enabled;
      } else {
        accounts[accountId].enabled = true;
      }
      continue;
    }

    const snapshot = snapshotMap.get(buildSnapshotKey({ channel: channelId, scope: 'root', accountId }));
    if (snapshot && snapshot.enabled !== undefined) {
      channelConfig.enabled = snapshot.enabled;
    } else {
      channelConfig.enabled = true;
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
