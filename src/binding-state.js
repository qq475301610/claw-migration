import { deepClone } from './utils.js';
import { PLUGIN_NAME } from './plugin-config.js';

function ensureState(config) {
  config.plugins ??= {};
  config.plugins.entries ??= {};
  config.plugins.entries[PLUGIN_NAME] ??= { enabled: true, config: {} };
  const pluginConfig = config.plugins.entries[PLUGIN_NAME].config ??= {};
  pluginConfig.state ??= {};
  pluginConfig.state.disabledBindingsByAgent ??= {};
  return pluginConfig.state;
}

export function disableAgentBindings(config, agentId) {
  const nextConfig = deepClone(config);
  const state = ensureState(nextConfig);
  const currentBindings = (nextConfig.bindings ?? []).filter((binding) => binding?.agentId === agentId);
  nextConfig.bindings = (nextConfig.bindings ?? []).filter((binding) => binding?.agentId !== agentId);
  state.disabledBindingsByAgent[agentId] = currentBindings;
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

  delete state.disabledBindingsByAgent[agentId];
  return {
    config: nextConfig,
    enabledBindings: (nextConfig.bindings ?? []).filter((binding) => binding?.agentId === agentId)
  };
}
