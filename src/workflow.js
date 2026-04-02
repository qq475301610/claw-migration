import path from 'node:path';
import { disableAgentBindings, enableAgentBindings } from './binding-state.js';
import { createMigrationArchive } from './export-service.js';
import { formatPreview, formatVerify } from './format.js';
import { importMigrationPackage, importMigrationPackageFromPreview } from './import-service.js';
import { backupPath, restoreBackup } from './import-support.js';
import { ensurePluginConfigShape, getAgentBindings, loadOpenClawConfigForPlugin, resolveRemoteConfig } from './plugin-config.js';
import { createProvider } from './providers.js';
import { previewMigrationImport, verifyMigrationPackage } from './preview-service.js';
import { findAgent } from './openclaw-state.js';
import { readJson, writeJson } from './utils.js';
import { emitProgress } from './progress.js';

function summarizeBindingTargets(bindings) {
  return bindings.map((binding) => ({
    channel: binding?.match?.channel ?? null,
    accountId: binding?.match?.accountId ?? null
  }));
}


async function buildProviderContext(options) {
  emitProgress(options, 'Loading plugin config', options.openClawDir ?? '~/.openclaw');
  const loaded = await loadOpenClawConfigForPlugin({ openClawDir: options.openClawDir });
  const remoteSelection = resolveRemoteConfig(loaded.pluginConfig, options.remoteName);
  const blockers = [...remoteSelection.blockers];
  const remoteConfig = remoteSelection.remoteConfig;
  const provider = remoteConfig ? createProvider(remoteConfig, { fetchImpl: options.fetchImpl, env: options.env }) : null;
  if (provider) {
    const validation = await provider.validateConfig(remoteConfig, { options, loaded });
    blockers.push(...(validation.blockers ?? []));
  }

  return {
    ...loaded,
    remoteName: remoteSelection.remoteName,
    remoteConfig,
    provider,
    blockers
  };
}

export async function previewPush(options) {
  const context = await buildProviderContext(options);
  const agent = findAgent(context.config, options.agentId);
  const blockers = [...context.blockers];
  if (!agent) {
    blockers.push(`Agent not found: ${options.agentId}`);
  }

  const bindings = getAgentBindings(context.config, options.agentId);
  let manifest = null;
  let archiveCleanup = async () => {};
  const warnings = [];
  if (blockers.length === 0) {
    emitProgress(options, 'Creating migration archive', options.agentId);
    const archive = await createMigrationArchive({
      openClawDir: context.openClawDir,
      agentId: options.agentId,
      includeTranscripts: context.pluginConfig.transfer.includeTranscripts,
      notes: options.notes
    });
    manifest = archive.manifest;
    archiveCleanup = archive.cleanup;
    const previewResult = await context.provider.previewPush({ manifest, options, remoteConfig: context.remoteConfig });
    blockers.push(...(previewResult.blockers ?? []));
    warnings.push(...(previewResult.notes ?? []));
    if (context.pluginConfig.restartGatewayOnPush) {
      warnings.push('Manual gateway restart is disabled; if OpenClaw gateway is already running, rely on its config watcher to reload changes.');
    }
  }

  return {
    ok: blockers.length === 0,
    action: 'push',
    agentId: options.agentId,
    manifest,
    remoteName: context.remoteName,
    provider: context.remoteConfig?.provider ?? null,
    bindings: summarizeBindingTargets(bindings),
    willDisableBindings: context.pluginConfig.switchBindingsOnPush,
    willRestartGateway: false,
    blockers,
    warnings,
    cleanup: archiveCleanup
  };
}

export async function pushAgentMigration(options) {
  emitProgress(options, 'Preparing push preview', options.agentId);
  const preview = await previewPush(options);
  try {
    if (preview.blockers.length > 0) {
      const error = new Error(`Push blocked:\n- ${preview.blockers.join('\n- ')}`);
      error.preview = preview;
      throw error;
    }

    const context = await buildProviderContext(options);
    emitProgress(options, 'Creating migration archive', options.agentId);
    const archive = await createMigrationArchive({
      openClawDir: context.openClawDir,
      agentId: options.agentId,
      includeTranscripts: context.pluginConfig.transfer.includeTranscripts,
      notes: options.notes
    });

    try {
      emitProgress(options, 'Pushing package to remote', context.remoteName);
      const remoteResult = await context.provider.pushPackage({
        zipPath: archive.zipPath,
        manifest: archive.manifest,
        remoteConfig: context.remoteConfig,
        remoteName: context.remoteName
      });

      let disabledBindings = [];
      let configBackup = null;
      const warnings = [];
      const configPath = path.join(context.openClawDir, 'openclaw.json');
      let nextConfig = null;
      try {
        if (context.pluginConfig.switchBindingsOnPush || remoteResult.id) {
          configBackup = await backupPath(configPath, `push-bak-${Date.now()}`);
          const currentConfig = await readJson(configPath);
          nextConfig = currentConfig;

          if (context.pluginConfig.switchBindingsOnPush) {
            const disabled = disableAgentBindings(nextConfig, options.agentId);
            nextConfig = disabled.config;
            disabledBindings = disabled.disabledBindings;
          }

          const currentPluginConfig = ensurePluginConfigShape(nextConfig);
          currentPluginConfig.state.remotes[context.remoteName] = {
            lastPushAt: new Date().toISOString(),
            lastPackage: {
              gistId: remoteResult.id ?? context.remoteConfig?.settings?.gistId ?? null,
              url: remoteResult.url ?? null
            }
          };
          if (context.remoteConfig?.provider === 'github' && remoteResult.id) {
            currentPluginConfig.remotes[context.remoteName].settings ??= {};
            currentPluginConfig.remotes[context.remoteName].settings.gistId = remoteResult.id;
          }

        await writeJson(configPath, nextConfig);
        }
        const restartedGateway = false;
        if (context.pluginConfig.restartGatewayOnPush) {
          warnings.push('Manual gateway restart is disabled after push; if OpenClaw gateway is already running, rely on its config watcher to reload changes.');
        }

        return {
          ok: true,
          action: 'push',
          remote: {
            name: context.remoteName,
            provider: context.remoteConfig.provider,
            id: remoteResult.id ?? null,
            url: remoteResult.url ?? null
          },
          agentId: options.agentId,
          disabledBindings: summarizeBindingTargets(disabledBindings),
          restartedGateway,
          warnings
        };
      } catch (error) {
        if (configBackup) {
          await restoreBackup(configBackup, configPath);
        }
        throw error;
      }
    } finally {
      await archive.cleanup();
    }
  } finally {
    await preview.cleanup?.();
  }
}

export async function previewPull(options) {
  const context = await buildProviderContext(options);
  const blockers = [...context.blockers];
  const warnings = [];
  let sourceCleanup = async () => {};
  let packageCleanup = async () => {};
  let importPreview = null;
  let remotePackageId = null;

  if (context.provider) {
    const providerPreview = await context.provider.previewPull({ options, remoteConfig: context.remoteConfig, remoteName: context.remoteName });
    blockers.push(...(providerPreview.blockers ?? []));
    warnings.push(...(providerPreview.notes ?? []));
    if (context.pluginConfig.restartGatewayOnPull) {
      warnings.push('Manual gateway restart is disabled; if OpenClaw gateway is already running, rely on its config watcher to reload changes.');
    }
  }

  if (blockers.length === 0) {
    emitProgress(options, 'Pulling package from remote', context.remoteName);
    const remotePackage = await context.provider.pullPackage({ remoteConfig: context.remoteConfig, remoteName: context.remoteName, onProgress: options.onProgress });
    remotePackageId = remotePackage.gistId ?? null;
    sourceCleanup = remotePackage.cleanup ?? sourceCleanup;
    emitProgress(options, 'Previewing imported package', options.agentId);
    importPreview = await previewMigrationImport({
      from: 'local',
      inputPath: remotePackage.packagePath,
      agentId: options.agentId,
      openClawDir: context.openClawDir
    });
    blockers.push(...importPreview.blockers);
    warnings.push(...importPreview.warnings);
    packageCleanup = async () => {
      await importPreview.sourceCleanup?.();
      await importPreview.packageCleanup?.();
      await remotePackage.cleanup?.();
    };
  }

  return {
    ok: blockers.length === 0,
    action: 'pull',
    agentId: options.agentId,
    remoteName: context.remoteName,
    provider: context.remoteConfig?.provider ?? null,
    importPreview,
    willEnableBindings: context.pluginConfig.switchBindingsOnPull,
    willRestartGateway: false,
    blockers,
    warnings,
    remotePackageId,
    sourceCleanup,
    packageCleanup
  };
}

export async function pullAgentMigration(options) {
  emitProgress(options, 'Preparing pull preview', options.agentId);
  const preview = await previewPull(options);
  try {
    if (preview.blockers.length > 0) {
      const error = new Error(`Pull blocked:\n- ${preview.blockers.join('\n- ')}`);
      error.preview = preview;
      throw error;
    }
    if (!options.confirm) {
      const error = new Error('Pull requires confirmation. Re-run with --yes after previewing.');
      error.preview = preview;
      throw error;
    }

    const context = await buildProviderContext(options);
    if (!preview.importPreview) {
      throw new Error('Pull preview did not produce an import preview.');
    }
    emitProgress(options, 'Applying import', options.agentId);
    const importResult = await importMigrationPackageFromPreview(preview.importPreview, {
      openClawDir: context.openClawDir,
      confirm: true,
      skipReindex: options.skipReindex,
      onProgress: options.onProgress
    });

      const configPath = path.join(context.openClawDir, 'openclaw.json');
      const configBackup = await backupPath(configPath, `pull-bak-${Date.now()}`);
      let enabledBindings = [];
      const warnings = [];
      try {
        const currentConfig = await readJson(configPath);
        let nextConfig = currentConfig;
        if (context.pluginConfig.switchBindingsOnPull) {
          const enabled = enableAgentBindings(nextConfig, options.agentId);
          nextConfig = enabled.config;
          enabledBindings = enabled.enabledBindings;
        }

        const currentPluginConfig = ensurePluginConfigShape(nextConfig);
        currentPluginConfig.state.remotes[context.remoteName] = {
          lastPullAt: new Date().toISOString(),
          lastPackage: {
            gistId: preview.remotePackageId ?? context.remoteConfig?.settings?.gistId ?? null
          }
        };
        if (context.remoteConfig?.provider === 'github' && preview.remotePackageId) {
          currentPluginConfig.remotes[context.remoteName].settings ??= {};
          currentPluginConfig.remotes[context.remoteName].settings.gistId = preview.remotePackageId;
        }
        await writeJson(configPath, nextConfig);
        const restartedGateway = false;
        if (context.pluginConfig.restartGatewayOnPull) {
          warnings.push('Manual gateway restart is disabled after pull; if OpenClaw gateway is already running, rely on its config watcher to reload changes.');
        }

        return {
          ok: true,
          action: 'pull',
          agentId: options.agentId,
          remote: {
            name: context.remoteName,
            provider: context.remoteConfig.provider,
            id: preview.remotePackageId ?? context.remoteConfig?.settings?.gistId ?? null
          },
          importResult,
          enabledBindings: summarizeBindingTargets(enabledBindings),
          restartedGateway,
          warnings
        };
      } catch (error) {
        if (configBackup) {
          await restoreBackup(configBackup, configPath);
        }
        throw error;
      }
  } finally {
    await preview.sourceCleanup?.();
    await preview.packageCleanup?.();
  }
}

export async function verifyMigration(options) {
  if (options.inputPath) {
    return verifyMigrationPackage({
      from: 'local',
      inputPath: options.inputPath,
      agentId: options.agentId
    });
  }

  const context = await buildProviderContext(options);
  if (context.blockers.length > 0) {
    return {
      ok: false,
      blockers: context.blockers,
      warnings: [],
      files: [],
      manifest: null
    };
  }

  emitProgress(options, 'Pulling package from remote', context.remoteName);
  const remotePackage = await context.provider.pullPackage({ remoteConfig: context.remoteConfig, remoteName: context.remoteName, onProgress: options.onProgress });
  try {
    return verifyMigrationPackage({
      from: 'local',
      inputPath: remotePackage.packagePath,
      agentId: options.agentId
    });
  } finally {
    await remotePackage.cleanup?.();
  }
}

export function formatActionPreview(preview) {
  if (preview.action === 'push') {
    return [
      `Action: push`,
      `Agent: ${preview.agentId}`,
      `Remote: ${preview.remoteName} (${preview.provider ?? 'unknown'})`,
      `Will disable bindings: ${preview.willDisableBindings ? 'yes' : 'no'}`,
      `Will restart gateway: ${preview.willRestartGateway ? 'yes' : 'no'}`,
      `Bindings: ${preview.bindings.map((item) => `${item.channel}:${item.accountId}`).join(', ') || 'none'}`,
      ...(preview.manifest ? [`Manifest created: ${preview.manifest.createdAt}`] : []),
      ...(preview.warnings.length > 0 ? [`Warnings: ${preview.warnings.join(' | ')}`] : []),
      ...(preview.blockers.length > 0 ? [`Blockers: ${preview.blockers.join(' | ')}`] : [])
    ].join('\n');
  }

  return [
    `Action: pull`,
    `Agent: ${preview.agentId}`,
    `Remote: ${preview.remoteName} (${preview.provider ?? 'unknown'})`,
    `Will enable bindings: ${preview.willEnableBindings ? 'yes' : 'no'}`,
    `Will restart gateway: ${preview.willRestartGateway ? 'yes' : 'no'}`,
    ...(preview.importPreview ? [formatPreview(preview.importPreview)] : []),
    ...(preview.warnings.length > 0 ? [`Warnings: ${preview.warnings.join(' | ')}`] : []),
    ...(preview.blockers.length > 0 ? [`Blockers: ${preview.blockers.join(' | ')}`] : [])
  ].join('\n');
}

export function formatVerification(result) {
  return formatVerify(result);
}







