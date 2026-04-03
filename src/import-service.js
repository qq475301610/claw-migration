import fs from 'node:fs/promises';
import path from 'node:path';
import { mergeOpenClawConfig } from './merge.js';
import { findAgent, resolveOpenClawDir } from './openclaw-state.js';
import { previewMigrationImport } from './preview-service.js';
import { backupPath, copyTree, rebuildMemoryIndex, restoreBackup } from './import-support.js';
import { pathExists, readJson, writeJson } from './utils.js';
import { emitProgress } from './progress.js';

function minimalTargetConfig(openClawDir) {
  return {
    meta: {
      lastTouchedVersion: null,
      lastTouchedAt: new Date().toISOString()
    },
    agents: {
      defaults: {
        workspace: path.join(openClawDir, 'workspace')
      },
      list: []
    },
    gateway: {
      port: 18789,
      mode: 'local',
      bind: 'loopback'
    }
  };
}

async function applyImportPreview(preview, options = {}) {
  if (preview.blockers.length > 0) {
    const error = new Error(`Import blocked:\n- ${preview.blockers.join('\n- ')}`);
    error.preview = preview;
    throw error;
  }
  if (!options.confirm) {
    const error = new Error('Import requires confirmation. Re-run with --yes after previewing.');
    error.preview = preview;
    throw error;
  }

  const openClawDir = resolveOpenClawDir({ openClawDir: options.openClawDir });
  const configPath = path.join(openClawDir, 'openclaw.json');
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  emitProgress(options, 'Creating backups', configPath);
  const configBackup = await backupPath(configPath, `migration-bak-${timestamp}`);
  let workspaceBackup = null;

  try {
    emitProgress(options, 'Loading package config', preview.extractedDir);
    const sourceConfig = await readJson(path.join(preview.extractedDir, 'openclaw.json'));
    const targetConfig = (await pathExists(configPath)) ? await readJson(configPath) : minimalTargetConfig(openClawDir);
    emitProgress(options, 'Merging openclaw.json', preview.agentId);
    const mergedConfig = mergeOpenClawConfig({
      sourceConfig,
      targetConfig,
      agentId: preview.agentId,
      openClawDir,
      skipChannels: preview.importStrategy?.skipChannels ?? [],
      skipPlugins: preview.importStrategy?.skipPlugins ?? []
    });

    const mergedAgent = findAgent(mergedConfig, preview.agentId);
    const targetWorkspace = mergedAgent?.workspace ?? preview.target.workspacePath;
    workspaceBackup = await backupPath(targetWorkspace, `migration-bak-${timestamp}`);

    emitProgress(options, 'Writing merged config', configPath);
    await writeJson(configPath, mergedConfig);

    const extractedAgentRoot = path.join(preview.extractedDir, 'agents', preview.agentId);
    const targetAgentRoot = path.join(openClawDir, 'agents', preview.agentId);
    emitProgress(options, 'Restoring agent files', targetAgentRoot);
    await copyTree(path.join(extractedAgentRoot, 'agent'), path.join(targetAgentRoot, 'agent'));
    emitProgress(options, 'Restoring sessions', path.join(targetAgentRoot, 'sessions'));
    await copyTree(path.join(extractedAgentRoot, 'sessions'), path.join(targetAgentRoot, 'sessions'));
    emitProgress(options, 'Restoring workspace', targetWorkspace);
    await copyTree(path.join(preview.extractedDir, 'workspace'), targetWorkspace);

    const indexResult = options.skipReindex ? { ok: true } : await rebuildMemoryIndex({ agentId: preview.agentId, onProgress: options.onProgress });

    emitProgress(options, 'Import complete', preview.agentId);
    return {
      ok: true,
      agentId: preview.agentId,
      configPath,
      workspacePath: targetWorkspace,
      backups: {
        config: configBackup,
        workspace: workspaceBackup
      },
      warning: indexResult.ok ? null : indexResult.warning
    };
  } catch (error) {
    if (configBackup) {
      await restoreBackup(configBackup, configPath);
    }
    if (workspaceBackup) {
      const currentConfig = (await pathExists(configPath)) ? await readJson(configPath) : null;
      const currentAgent = findAgent(currentConfig, preview.agentId);
      if (currentAgent?.workspace) {
        await restoreBackup(workspaceBackup, currentAgent.workspace);
      }
    }
    throw error;
  }
}

export async function importMigrationPackageFromPreview(preview, options) {
  try {
    return await applyImportPreview(preview, options);
  } finally {
    await preview.sourceCleanup?.();
    await preview.packageCleanup?.();
  }
}

export async function importMigrationPackage(options) {
  emitProgress(options, 'Previewing import', options.agentId);
  const preview = await previewMigrationImport(options);
  return importMigrationPackageFromPreview(preview, options);
}
