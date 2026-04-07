import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { exportMigrationPackage } from '../src/export-service.js';
import { importMigrationPackage } from '../src/import-service.js';
import { previewMigrationImport, verifyMigrationPackage } from '../src/preview-service.js';

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function createWorkspace(workspacePath) {
  const files = {
    'SOUL.md': '# soul\n',
    'MEMORY.md': '# memory\n',
    'USER.md': '# user\n',
    'AGENTS.md': '# agents\n',
    'TOOLS.md': '# tools\n',
    'HEARTBEAT.md': '# heartbeat\n',
    'IDENTITY.md': '# identity\n',
    '.env': 'OPENCLAW=1\n'
  };

  await fs.mkdir(path.join(workspacePath, 'memory'), { recursive: true });
  await fs.mkdir(path.join(workspacePath, 'assets'), { recursive: true });

  for (const [name, content] of Object.entries(files)) {
    await fs.writeFile(path.join(workspacePath, name), content, 'utf8');
  }

  await fs.writeFile(path.join(workspacePath, 'memory', '2026-03-31.md'), '# day\n', 'utf8');
  await fs.writeFile(path.join(workspacePath, 'assets', 'avatar.txt'), 'asset\n', 'utf8');
}

async function createOpenClawState(rootDir, { includeAgent }) {
  const openClawDir = path.join(rootDir, '.openclaw');
  const workspacePath = path.join(openClawDir, 'workspace');
  const agentDir = path.join(openClawDir, 'agents', 'main');

  const config = {
    meta: {
      lastTouchedVersion: '2026.3.28',
      lastTouchedAt: '2026-03-31T10:00:00.000Z'
    },
    agents: {
      defaults: {
        workspace: workspacePath
      },
      list: includeAgent
        ? [{ id: 'main', name: 'Main Agent', workspace: workspacePath }]
        : []
    },
    bindings: includeAgent
      ? [{ agentId: 'main', match: { channel: 'qqbot', accountId: 'marie_bot' } }]
      : [],
    channels: {
      qqbot: {
        accounts: {
          marie_bot: {
            appId: '102877854',
            clientSecret: 'client-secret'
          }
        }
      }
    },
    models: {
      providers: {
        openai: {
          apiKey: 'sk-test'
        }
      }
    },
    plugins: {
      entries: {
        channels: { enabled: true }
      }
    },
    skills: {
      entries: {
        memory: { enabled: true }
      }
    },
    session: {
      dmScope: 'main'
    }
  };

  await writeJson(path.join(openClawDir, 'openclaw.json'), config);

  if (includeAgent) {
    await fs.mkdir(path.join(agentDir, 'agent'), { recursive: true });
    await fs.mkdir(path.join(agentDir, 'sessions'), { recursive: true });
    await writeJson(path.join(agentDir, 'agent', 'auth-profiles.json'), { profiles: {} });
    await writeJson(path.join(agentDir, 'agent', 'models.json'), { default: 'gpt-5' });
    await writeJson(path.join(agentDir, 'sessions', 'sessions.json'), {
      sessions: [{ key: 'agent:main:main', id: 'session-1' }]
    });
    await fs.writeFile(path.join(agentDir, 'sessions', 'session-1.jsonl'), '{"event":"message"}\n', 'utf8');
    await createWorkspace(workspacePath);
  }

  return { openClawDir, workspacePath };
}

test('local export, verify, preview, and import succeeds for a single agent package', async () => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'openclaw-local-flow-'));
  const sourceRoot = path.join(rootDir, 'source');
  const targetRoot = path.join(rootDir, 'target');
  await createOpenClawState(sourceRoot, { includeAgent: true });
  const targetState = await createOpenClawState(targetRoot, { includeAgent: false });

  const zipPath = path.join(rootDir, 'main-migration.zip');
  const exportResult = await exportMigrationPackage({
    openClawDir: path.join(sourceRoot, '.openclaw'),
    agentId: 'main',
    includeTranscripts: true,
    to: 'local',
    outputPath: zipPath
  });

  assert.equal(exportResult.kind, 'local');

  const verifyResult = await verifyMigrationPackage({
    from: 'local',
    inputPath: zipPath,
    agentId: 'main'
  });
  assert.equal(verifyResult.ok, true);

  const preview = await previewMigrationImport({
    from: 'local',
    inputPath: zipPath,
    agentId: 'main',
    openClawDir: targetState.openClawDir
  });

  assert.equal(preview.ok, true);
  assert.equal(preview.target.hasExistingAgent, false);

  await preview.sourceCleanup?.();
  await preview.packageCleanup?.();

  const importResult = await importMigrationPackage({
    from: 'local',
    inputPath: zipPath,
    agentId: 'main',
    openClawDir: targetState.openClawDir,
    confirm: true,
    skipReindex: true
  });

  assert.equal(importResult.ok, true);

  const targetConfig = JSON.parse(await fs.readFile(path.join(targetState.openClawDir, 'openclaw.json'), 'utf8'));
  assert.equal(targetConfig.agents.list[0].id, 'main');
  assert.equal(targetConfig.agents.list[0].workspace, targetState.workspacePath);

  const restoredSession = JSON.parse(await fs.readFile(path.join(targetState.openClawDir, 'agents', 'main', 'sessions', 'sessions.json'), 'utf8'));
  assert.equal(restoredSession.sessions[0].id, 'session-1');

  const restoredSoul = await fs.readFile(path.join(targetState.workspacePath, 'SOUL.md'), 'utf8');
  assert.match(restoredSoul, /soul/i);

  await fs.rm(rootDir, { recursive: true, force: true });
});

test('preview reports missing plugin requirements as warnings and does not block import', async () => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'openclaw-preview-block-'));
  const sourceRoot = path.join(rootDir, 'source');
  const targetRoot = path.join(rootDir, 'target');
  await createOpenClawState(sourceRoot, { includeAgent: true });
  const targetState = await createOpenClawState(targetRoot, { includeAgent: false });

  const targetConfigPath = path.join(targetState.openClawDir, 'openclaw.json');
  const targetConfig = JSON.parse(await fs.readFile(targetConfigPath, 'utf8'));
  delete targetConfig.plugins;
  delete targetConfig.skills;
  await writeJson(targetConfigPath, targetConfig);

  const zipPath = path.join(rootDir, 'main-migration.zip');
  await exportMigrationPackage({
    openClawDir: path.join(sourceRoot, '.openclaw'),
    agentId: 'main',
    to: 'local',
    outputPath: zipPath
  });

  const preview = await previewMigrationImport({
    from: 'local',
    inputPath: zipPath,
    agentId: 'main',
    openClawDir: targetState.openClawDir
  });

  assert.equal(preview.ok, true);
  assert.equal(preview.blockers.length, 0);
  assert.match(preview.warnings.join(' '), /Missing plugins on target will be skipped/);

  await preview.sourceCleanup?.();
  await preview.packageCleanup?.();
  await fs.rm(rootDir, { recursive: true, force: true });
});

test('import can create a missing channel config and restore only the matched account', async () => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'openclaw-local-channel-merge-'));
  const sourceRoot = path.join(rootDir, 'source');
  const targetRoot = path.join(rootDir, 'target');
  await createOpenClawState(sourceRoot, { includeAgent: true });
  const targetState = await createOpenClawState(targetRoot, { includeAgent: false });

  const sourceConfigPath = path.join(sourceRoot, '.openclaw', 'openclaw.json');
  const sourceConfig = JSON.parse(await fs.readFile(sourceConfigPath, 'utf8'));
  sourceConfig.channels.qqbot.accounts.momiji_bot = {
    appId: '200000000',
    clientSecret: 'other-secret'
  };
  sourceConfig.channels.qqbot.asr = { enabled: true };
  await writeJson(sourceConfigPath, sourceConfig);

  const targetConfigPath = path.join(targetState.openClawDir, 'openclaw.json');
  const targetConfig = JSON.parse(await fs.readFile(targetConfigPath, 'utf8'));
  delete targetConfig.channels;
  await writeJson(targetConfigPath, targetConfig);

  const zipPath = path.join(rootDir, 'main-migration.zip');
  await exportMigrationPackage({
    openClawDir: path.join(sourceRoot, '.openclaw'),
    agentId: 'main',
    to: 'local',
    outputPath: zipPath
  });

  const preview = await previewMigrationImport({
    from: 'local',
    inputPath: zipPath,
    agentId: 'main',
    openClawDir: targetState.openClawDir
  });

  assert.equal(preview.ok, true);
  assert.match(preview.warnings.join(' '), /Missing channel config will be created or partially restored/);
  await preview.sourceCleanup?.();
  await preview.packageCleanup?.();

  const importResult = await importMigrationPackage({
    from: 'local',
    inputPath: zipPath,
    agentId: 'main',
    openClawDir: targetState.openClawDir,
    confirm: true,
    skipReindex: true
  });

  assert.equal(importResult.ok, true);
  const mergedConfig = JSON.parse(await fs.readFile(targetConfigPath, 'utf8'));
  assert.deepEqual(mergedConfig.channels.qqbot.accounts, {
    marie_bot: {
      appId: '102877854',
      clientSecret: 'client-secret'
    }
  });
  assert.equal(mergedConfig.channels.qqbot.asr, undefined);

  await fs.rm(rootDir, { recursive: true, force: true });
});

test('import removes stale root openclaw-china credentials when restoring an account-scoped channel', async () => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'openclaw-local-channel-cleanup-'));
  const sourceRoot = path.join(rootDir, 'source');
  const targetRoot = path.join(rootDir, 'target');
  await createOpenClawState(sourceRoot, { includeAgent: true });
  const targetState = await createOpenClawState(targetRoot, { includeAgent: false });

  const sourceConfigPath = path.join(sourceRoot, '.openclaw', 'openclaw.json');
  const sourceConfig = JSON.parse(await fs.readFile(sourceConfigPath, 'utf8'));
  sourceConfig.channels.qqbot.accounts.marie_bot.webhookPath = '/qq/source';
  await writeJson(sourceConfigPath, sourceConfig);

  const targetConfigPath = path.join(targetState.openClawDir, 'openclaw.json');
  const targetConfig = JSON.parse(await fs.readFile(targetConfigPath, 'utf8'));
  targetConfig.channels.qqbot = {
    enabled: true,
    defaultAccount: 'marie_bot',
    appId: 'legacy-app',
    clientSecret: 'legacy-secret',
    webhookPath: '/qq/legacy'
  };
  await writeJson(targetConfigPath, targetConfig);

  const zipPath = path.join(rootDir, 'main-migration.zip');
  await exportMigrationPackage({
    openClawDir: path.join(sourceRoot, '.openclaw'),
    agentId: 'main',
    to: 'local',
    outputPath: zipPath
  });

  const importResult = await importMigrationPackage({
    from: 'local',
    inputPath: zipPath,
    agentId: 'main',
    openClawDir: targetState.openClawDir,
    confirm: true,
    skipReindex: true
  });

  assert.equal(importResult.ok, true);
  const mergedConfig = JSON.parse(await fs.readFile(targetConfigPath, 'utf8'));
  assert.equal(mergedConfig.channels.qqbot.enabled, true);
  assert.equal(mergedConfig.channels.qqbot.defaultAccount, 'marie_bot');
  assert.equal(mergedConfig.channels.qqbot.appId, undefined);
  assert.equal(mergedConfig.channels.qqbot.clientSecret, undefined);
  assert.equal(mergedConfig.channels.qqbot.webhookPath, undefined);
  assert.deepEqual(mergedConfig.channels.qqbot.accounts.marie_bot, {
    appId: '102877854',
    clientSecret: 'client-secret',
    webhookPath: '/qq/source'
  });

  await fs.rm(rootDir, { recursive: true, force: true });
});
