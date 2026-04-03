import path from 'node:path';
import { downloadPackageFromRelease } from './github-release.js';
import { materializeLocalPackage } from './local.js';
import { extractPackageForInspection, summarizePackageContents } from './migration-package.js';
import { resolveOpenClawDir } from './openclaw-state.js';
import { findAgent } from './openclaw-state.js';
import { readJson, removeIfExists } from './utils.js';
import { emitProgress } from './progress.js';

async function materializeSourcePackage(options) {
  if (options.from === 'github') {
    return downloadPackageFromRelease({
      owner: options.owner,
      repo: options.repo,
      releaseId: options.releaseId,
      remoteKey: options.remoteKey,
      fetchImpl: options.fetchImpl,
      configuredToken: options.configuredToken,
      onProgress: options.onProgress
    });
  }
  return materializeLocalPackage({ inputPath: options.inputPath });
}

export async function verifyMigrationPackage(options) {
  emitProgress(options, 'Preparing package source', options.from ?? (options.inputPath ? 'local' : 'remote'));
  const source = await materializeSourcePackage(options);
  try {
    emitProgress(options, 'Extracting archive', source.packagePath);
    const inspection = await extractPackageForInspection({ packagePath: source.packagePath, agentId: options.agentId });
    emitProgress(options, 'Validating package', inspection.agentId);
    const files = await summarizePackageContents(inspection.packageRoot);
    return {
      ok: inspection.blockers.length === 0,
      manifest: inspection.manifest,
      blockers: inspection.blockers,
      warnings: inspection.warnings,
      files
    };
  } finally {
    await source.cleanup?.();
  }
}

export async function previewMigrationImport(options) {
  emitProgress(options, 'Preparing package source', options.from ?? (options.inputPath ? 'local' : 'remote'));
  const source = await materializeSourcePackage(options);
  try {
    emitProgress(options, 'Extracting archive', source.packagePath);
    const inspection = await extractPackageForInspection({ packagePath: source.packagePath, agentId: options.agentId });
    emitProgress(options, 'Validating package', inspection.agentId);
    const openClawDir = resolveOpenClawDir({ openClawDir: options.openClawDir });
    emitProgress(options, 'Inspecting target config', openClawDir);

    let targetConfig = null;
    try {
      targetConfig = await readJson(path.join(openClawDir, 'openclaw.json'));
    } catch {
      targetConfig = null;
    }

    const targetAgent = findAgent(targetConfig, inspection.agentId);
    const requiredChannels = inspection.manifest?.requires?.channels ?? [];
    const requiredPlugins = inspection.manifest?.requires?.plugins ?? [];

    const missingChannels = requiredChannels.filter((name) => !targetConfig?.channels?.[name]);
    const missingPlugins = requiredPlugins.filter((name) => !targetConfig?.plugins?.entries?.[name]);
    const blockers = [...inspection.blockers];
    const warnings = [...inspection.warnings];

    if (missingChannels.length > 0) {
      warnings.push(`Missing channels on target will be skipped during config merge: ${missingChannels.join(', ')}`);
    }
    if (missingPlugins.length > 0) {
      warnings.push(`Missing plugins on target will be skipped during config merge: ${missingPlugins.join(', ')}`);
    }

    return {
      ok: blockers.length === 0,
      manifest: inspection.manifest,
      agentId: inspection.agentId,
      packagePath: source.packagePath,
      extractedDir: inspection.packageRoot,
      overwrite: targetAgent
        ? ['agents.list[agentId]', 'bindings[agentId]', 'agent files', 'sessions', 'workspace files']
        : [],
      additions: targetAgent
        ? []
        : ['agents.list[agentId]', 'bindings[agentId]', 'agent files', 'sessions', 'workspace files'],
      target: {
        openClawDir,
        hasExistingAgent: Boolean(targetAgent),
        workspacePath: targetAgent?.workspace ?? targetConfig?.agents?.defaults?.workspace ?? path.join(openClawDir, inspection.agentId === 'main' ? 'workspace' : `workspace-${inspection.agentId}`)
      },
      missing: {
        channels: missingChannels,
        plugins: missingPlugins,
        skills: []
      },
      importStrategy: {
        skipChannels: missingChannels,
        skipPlugins: missingPlugins
      },
      blockers,
      warnings,
      sourceCleanup: source.cleanup ?? (async () => {}),
      packageCleanup: async () => {
        await removeIfExists(inspection.extractedDir);
      }
    };
  } catch (error) {
    await source.cleanup?.();
    throw error;
  }
}
