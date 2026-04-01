import path from 'node:path';
import { disableAgentBindings, enableAgentBindings } from './binding-state.js';
import { createMigrationArchive } from './export-service.js';
import { formatPreview, formatVerify } from './format.js';
import { restartGateway } from './gateway.js';
import { importMigrationPackage } from './import-service.js';
import { backupPath, restoreBackup } from './import-support.js';
import { ensurePluginConfigShape, getAgentBindings, loadOpenClawConfigForPlugin, resolveRemoteConfig } from './plugin-config.js';
import { createProvider } from './providers.js';
import { previewMigrationImport, verifyMigrationPackage } from './preview-service.js';
import { findAgent } from './openclaw-state.js';
import { readJson, writeJson } from './utils.js';

function summarizeBindingTargets(bindings) {
  return bindings.map((binding) => ({
    channel: binding?.match?.channel ?? null,
    accountId: binding?.match?.accountId ?? null
  }));
}

function describeCommandFailure(error) {
  const parts = [error.message];
  if (error.stderr) {
    parts.push(`[stderr]\n${String(error.stderr).trimEnd()}`);
  }
  if (error.stdout) {
    parts.push(`[stdout]\n${String(error.stdout).trimEnd()}`);
  }
  return parts.join('\n');
}

async function buildProviderContext(options) {
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
    willRestartGateway: context.pluginConfig.restartGatewayOnPush,
    blockers,
    warnings,
    cleanup: archiveCleanup
  };
}

export async function pushAgentMigration(options) {
  const preview = await previewPush(options);
  try {
    if (preview.blockers.length > 0) {
      const error = new Error(`Push blocked:\n- ${preview.blockers.join('\n- ')}`);
      error.preview = preview;
      throw error;
    }

    const context = await buildProviderContext(options);
    const archive = await createMigrationArchive({
      openClawDir: context.openClawDir,
      agentId: options.agentId,
      includeTranscripts: context.pluginConfig.transfer.includeTranscripts,
      notes: options.notes
    });

    try {
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
      try {
        if (context.pluginConfig.switchBindingsOnPush || remoteResult.id) {
          configBackup = await backupPath(configPath, `push-bak-${Date.now()}`);
          const currentConfig = await readJson(configPath);
          let nextConfig = currentConfig;

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

        let restartedGateway = false;
        if (context.pluginConfig.restartGatewayOnPush) {
          try {
            await (options.restartGateway ?? restartGateway)({ runner: options.commandRunner });
            restartedGateway = true;
          } catch (error) {
            warnings.push(`Gateway restart reported an error after push, but migration changes were kept.\n${describeCommandFailure(error)}`);
          }
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

  if (context.provider) {
    const providerPreview = await context.provider.previewPull({ options, remoteConfig: context.remoteConfig, remoteName: context.remoteName });
    blockers.push(...(providerPreview.blockers ?? []));
    warnings.push(...(providerPreview.notes ?? []));
  }

  if (blockers.length === 0) {
    const remotePackage = await context.provider.pullPackage({ remoteConfig: context.remoteConfig, remoteName: context.remoteName });
    sourceCleanup = remotePackage.cleanup ?? sourceCleanup;
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
    willRestartGateway: context.pluginConfig.restartGatewayOnPull,
    blockers,
    warnings,
    sourceCleanup,
    packageCleanup
  };
}

export async function pullAgentMigration(options) {
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
    const remotePackage = await context.provider.pullPackage({ remoteConfig: context.remoteConfig, remoteName: context.remoteName });
    try {
      const importResult = await importMigrationPackage({
        from: 'local',
        inputPath: remotePackage.packagePath,
        agentId: options.agentId,
        openClawDir: context.openClawDir,
        confirm: true,
        skipReindex: options.skipReindex
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
            gistId: remotePackage.gistId ?? context.remoteConfig?.settings?.gistId ?? null
          }
        };
        if (context.remoteConfig?.provider === 'github' && remotePackage.gistId) {
          currentPluginConfig.remotes[context.remoteName].settings ??= {};
          currentPluginConfig.remotes[context.remoteName].settings.gistId = remotePackage.gistId;
        }
        await writeJson(configPath, nextConfig);

        let restartedGateway = false;
        if (context.pluginConfig.restartGatewayOnPull) {
          try {
            await (options.restartGateway ?? restartGateway)({ runner: options.commandRunner });
            restartedGateway = true;
          } catch (error) {
            warnings.push(`Gateway restart reported an error after pull, but imported changes were kept.\n${describeCommandFailure(error)}`);
          }
        }

        return {
          ok: true,
          action: 'pull',
          agentId: options.agentId,
          remote: {
            name: context.remoteName,
            provider: context.remoteConfig.provider,
            id: remotePackage.gistId ?? context.remoteConfig?.settings?.gistId ?? null
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
      await remotePackage.cleanup?.();
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

  const remotePackage = await context.provider.pullPackage({ remoteConfig: context.remoteConfig, remoteName: context.remoteName });
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



