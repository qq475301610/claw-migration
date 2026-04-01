import path from 'node:path';
import { resolveOpenClawDir } from './openclaw-state.js';
import { deepClone, readJson, writeJson } from './utils.js';

export const PLUGIN_NAME = 'claw-migration';
export const DEFAULT_REMOTE_NAME = 'github-main';

export function ensurePluginConfigShape(config) {
  config.plugins ??= {};
  config.plugins.entries ??= {};
  config.plugins.entries[PLUGIN_NAME] ??= {};
  config.plugins.entries[PLUGIN_NAME].enabled ??= true;
  config.plugins.entries[PLUGIN_NAME].config ??= {};

  const pluginConfig = config.plugins.entries[PLUGIN_NAME].config;
  pluginConfig.defaultRemote ??= DEFAULT_REMOTE_NAME;
  pluginConfig.remotes ??= {};
  pluginConfig.remotes[pluginConfig.defaultRemote] ??= {
    provider: 'github',
    settings: {}
  };
  pluginConfig.remotes[pluginConfig.defaultRemote].provider ??= 'github';
  pluginConfig.remotes[pluginConfig.defaultRemote].settings ??= {};
  pluginConfig.transfer ??= {};
  pluginConfig.transfer.includeTranscripts ??= false;
  pluginConfig.switchBindingsOnPush ??= true;
  pluginConfig.switchBindingsOnPull ??= true;
  pluginConfig.restartGatewayOnPush ??= true;
  pluginConfig.restartGatewayOnPull ??= true;
  pluginConfig.state ??= {};
  pluginConfig.state.disabledBindingsByAgent ??= {};
  pluginConfig.state.disabledChannelAccountsByAgent ??= {};
  pluginConfig.state.remotes ??= {};
  return pluginConfig;
}

export async function loadOpenClawConfigForPlugin(options = {}) {
  const openClawDir = resolveOpenClawDir({ openClawDir: options.openClawDir });
  const configPath = path.join(openClawDir, 'openclaw.json');
  const config = await readJson(configPath);
  const pluginConfig = ensurePluginConfigShape(config);
  return {
    openClawDir,
    configPath,
    config,
    pluginConfig
  };
}

export function resolveRemoteConfig(pluginConfig, remoteName) {
  const resolvedName = remoteName ?? pluginConfig.defaultRemote;
  if (!resolvedName) {
    return {
      remoteName: null,
      remoteConfig: null,
      blockers: ['Plugin config is missing defaultRemote.']
    };
  }

  const remoteConfig = pluginConfig.remotes?.[resolvedName] ?? null;
  if (!remoteConfig) {
    return {
      remoteName: resolvedName,
      remoteConfig: null,
      blockers: [`Remote '${resolvedName}' is not configured.`]
    };
  }

  return {
    remoteName: resolvedName,
    remoteConfig,
    blockers: []
  };
}

export async function updatePluginConfigFile({ openClawDir, mutate }) {
  const { configPath, config } = await loadOpenClawConfigForPlugin({ openClawDir });
  const nextConfig = deepClone(config);
  const pluginConfig = ensurePluginConfigShape(nextConfig);
  await mutate({ config: nextConfig, pluginConfig });
  await writeJson(configPath, nextConfig);
  return nextConfig;
}

export async function seedPluginConfigFile({ config, runtime, openClawDir } = {}) {
  const writeConfig = runtime?.config?.writeConfigFile;
  if (typeof writeConfig !== 'function') {
    return false;
  }

  const sourceConfig = config ?? (await loadOpenClawConfigForPlugin({ openClawDir })).config;
  const nextConfig = deepClone(sourceConfig);
  const before = JSON.stringify(sourceConfig);
  ensurePluginConfigShape(nextConfig);
  const after = JSON.stringify(nextConfig);
  if (before === after) {
    return false;
  }

  await writeConfig(nextConfig);
  return true;
}

export function getAgentBindings(config, agentId) {
  return (config.bindings ?? []).filter((binding) => binding?.agentId === agentId);
}
