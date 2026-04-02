import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { exportMigrationPackage } from '../src/export-service.js';
import { previewPull, previewPush, pullAgentMigration, pushAgentMigration } from '../src/workflow.js';

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

async function createOpenClawState(rootDir, { includeAgent = true, includeSupportEntries = true } = {}) {
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
      ? [
          { agentId: 'main', match: { channel: 'qqbot', accountId: 'marie_bot' } },
          { agentId: 'momiji', match: { channel: 'telegram', accountId: 'other' } }
        ]
      : [{ agentId: 'momiji', match: { channel: 'telegram', accountId: 'other' } }],
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
        ...(includeSupportEntries ? { channels: { enabled: true } } : {}),
        'claw-migration': {
          enabled: true,
          config: {
            defaultRemote: 'primary',
            remotes: {
              primary: {
                provider: 'github',
                settings: { token: 'configured-token' }
              }
            },
            transfer: {
              includeTranscripts: false
            },
            switchBindingsOnPush: true,
            switchBindingsOnPull: true,
            restartGatewayOnPush: true,
            restartGatewayOnPull: true,
            state: {
              disabledBindingsByAgent: {},
              remotes: {}
            }
          }
        }
      }
    },
    skills: {
      entries: includeSupportEntries ? { memory: { enabled: true } } : {}
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

async function makeRemoteFetchForZip(zipPath) {
  const zipBase64 = (await fs.readFile(zipPath)).toString('base64');
  return async (url, options = {}) => {
    if ((options.method ?? 'GET') === 'POST' || (options.method ?? 'GET') === 'PATCH') {
      return {
        ok: true,
        json: async () => ({ id: 'gist-123', html_url: 'https://gist.github.com/example/gist-123' })
      };
    }

    return {
      ok: true,
      json: async () => ({
        files: {
          'migration.zip.base64': {
            content: zipBase64
          }
        }
      })
    };
  };
}

test('preview push reports remote, bindings, and gateway actions', async () => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'claw-migration-preview-push-'));
  const state = await createOpenClawState(rootDir, { includeAgent: true });

  const preview = await previewPush({
    openClawDir: state.openClawDir,
    agentId: 'main',
    env: {}
  });

  assert.equal(preview.ok, true);
  assert.equal(preview.remoteName, 'primary');
  assert.equal(preview.provider, 'github');
  assert.equal(preview.willDisableBindings, true);
  assert.equal(preview.willRestartGateway, false);
  assert.match(preview.warnings.join(' '), /manual gateway restart is disabled/i);
  assert.equal(preview.bindings.length, 1);
  await preview.cleanup?.();
  await fs.rm(rootDir, { recursive: true, force: true });
});

test('push uploads package, disables only target agent bindings, records gist id, and does not manually restart gateway', async () => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'claw-migration-push-'));
  const state = await createOpenClawState(rootDir, { includeAgent: true });
  const restartCalls = [];

  const result = await pushAgentMigration({
    openClawDir: state.openClawDir,
    agentId: 'main',
    env: {},
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({ id: 'gist-123', html_url: 'https://gist.github.com/example/gist-123' })
    }),
    restartGateway: async () => {
      restartCalls.push('restart');
    },
    isGatewayRunning: async () => false
  });

  assert.equal(result.ok, true);
  assert.equal(result.disabledBindings.length, 1);
  assert.equal(restartCalls.length, 0);
  assert.match(result.warnings.join(' '), /manual gateway restart is disabled/i);

  const config = JSON.parse(await fs.readFile(path.join(state.openClawDir, 'openclaw.json'), 'utf8'));
  assert.equal(config.bindings.some((binding) => binding.agentId === 'main'), false);
  assert.equal(config.bindings.some((binding) => binding.agentId === 'momiji'), true);
  assert.equal(config.plugins.entries['claw-migration'].config.remotes.primary.settings.gistId, 'gist-123');
  assert.equal(config.plugins.entries['claw-migration'].config.state.disabledBindingsByAgent.main.length, 1);

  await fs.rm(rootDir, { recursive: true, force: true });
});

test('preview pull reports dependency blockers from remote package', async () => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'claw-migration-preview-pull-'));
  const sourceRoot = path.join(rootDir, 'source');
  const targetRoot = path.join(rootDir, 'target');
  const sourceState = await createOpenClawState(sourceRoot, { includeAgent: true, includeSupportEntries: true });
  const targetState = await createOpenClawState(targetRoot, { includeAgent: false, includeSupportEntries: false });

  const zipPath = path.join(rootDir, 'migration.zip');
  await exportMigrationPackage({
    openClawDir: sourceState.openClawDir,
    agentId: 'main',
    to: 'local',
    outputPath: zipPath
  });

  const targetConfigPath = path.join(targetState.openClawDir, 'openclaw.json');
  const targetConfig = JSON.parse(await fs.readFile(targetConfigPath, 'utf8'));
  targetConfig.plugins.entries['claw-migration'].config.remotes.primary.settings.gistId = 'gist-123';
  await writeJson(targetConfigPath, targetConfig);

  const preview = await previewPull({
    openClawDir: targetState.openClawDir,
    agentId: 'main',
    env: {},
    fetchImpl: await makeRemoteFetchForZip(zipPath)
  });

  assert.equal(preview.ok, false);
  assert.match(preview.blockers.join(' '), /Missing required plugins/);
  assert.match(preview.blockers.join(' '), /Missing required skills/);
  await preview.sourceCleanup?.();
  await preview.packageCleanup?.();
  await fs.rm(rootDir, { recursive: true, force: true });
});

test('pull imports package, enables bindings, clears disabled snapshot, and does not manually restart gateway', async () => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'claw-migration-pull-'));
  const sourceRoot = path.join(rootDir, 'source');
  const targetRoot = path.join(rootDir, 'target');
  const sourceState = await createOpenClawState(sourceRoot, { includeAgent: true, includeSupportEntries: true });
  const targetState = await createOpenClawState(targetRoot, { includeAgent: false, includeSupportEntries: true });

  const zipPath = path.join(rootDir, 'migration.zip');
  await exportMigrationPackage({
    openClawDir: sourceState.openClawDir,
    agentId: 'main',
    to: 'local',
    outputPath: zipPath
  });

  const targetConfigPath = path.join(targetState.openClawDir, 'openclaw.json');
  const targetConfig = JSON.parse(await fs.readFile(targetConfigPath, 'utf8'));
  targetConfig.plugins.entries['claw-migration'].config.remotes.primary.settings.gistId = 'gist-123';
  targetConfig.plugins.entries['claw-migration'].config.state.disabledBindingsByAgent.main = [
    { agentId: 'main', match: { channel: 'qqbot', accountId: 'marie_bot' } }
  ];
  await writeJson(targetConfigPath, targetConfig);

  const restartCalls = [];
  const result = await pullAgentMigration({
    openClawDir: targetState.openClawDir,
    agentId: 'main',
    env: {},
    fetchImpl: await makeRemoteFetchForZip(zipPath),
    restartGateway: async () => {
      restartCalls.push('restart');
    },
    isGatewayRunning: async () => false,
    confirm: true,
    skipReindex: true
  });

  assert.equal(result.ok, true);
  assert.equal(restartCalls.length, 0);
  assert.match(result.warnings.join(' '), /manual gateway restart is disabled/i);
  assert.equal(result.enabledBindings.length, 1);

  const config = JSON.parse(await fs.readFile(path.join(targetState.openClawDir, 'openclaw.json'), 'utf8'));
  assert.equal(config.bindings.some((binding) => binding.agentId === 'main'), true);
  assert.equal(config.plugins.entries['claw-migration'].config.state.disabledBindingsByAgent.main, undefined);

  await fs.rm(rootDir, { recursive: true, force: true });
});





test('pull restores non-qqbot channel enabled state from channel snapshots', async () => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'claw-migration-pull-dingtalk-'));
  const sourceRoot = path.join(rootDir, 'source');
  const targetRoot = path.join(rootDir, 'target');
  const sourceState = await createOpenClawState(sourceRoot, { includeAgent: true, includeSupportEntries: true });
  const targetState = await createOpenClawState(targetRoot, { includeAgent: false, includeSupportEntries: true });

  const sourceConfigPath = path.join(sourceState.openClawDir, 'openclaw.json');
  const sourceConfig = JSON.parse(await fs.readFile(sourceConfigPath, 'utf8'));
  sourceConfig.bindings = [
    ...sourceConfig.bindings,
    { agentId: 'main', match: { channel: 'dingtalk', accountId: 'default' } }
  ];
  sourceConfig.channels.dingtalk = { enabled: true, clientId: 'ding-id', clientSecret: 'ding-secret' };
  await writeJson(sourceConfigPath, sourceConfig);

  const zipPath = path.join(rootDir, 'migration.zip');
  await exportMigrationPackage({
    openClawDir: sourceState.openClawDir,
    agentId: 'main',
    to: 'local',
    outputPath: zipPath
  });

  const targetConfigPath = path.join(targetState.openClawDir, 'openclaw.json');
  const targetConfig = JSON.parse(await fs.readFile(targetConfigPath, 'utf8'));
  targetConfig.plugins.entries['claw-migration'].config.remotes.primary.settings.gistId = 'gist-123';
  targetConfig.plugins.entries['claw-migration'].config.state.disabledBindingsByAgent.main = [
    { agentId: 'main', match: { channel: 'dingtalk', accountId: 'default' } }
  ];
  targetConfig.plugins.entries['claw-migration'].config.state.disabledChannelAccountsByAgent ??= {};
  targetConfig.plugins.entries['claw-migration'].config.state.disabledChannelAccountsByAgent.main = [
    { channel: 'dingtalk', scope: 'root', accountId: 'default', enabled: false }
  ];
  targetConfig.channels.dingtalk = { enabled: false, clientId: 'ding-id', clientSecret: 'ding-secret' };
  await writeJson(targetConfigPath, targetConfig);

  const result = await pullAgentMigration({
    openClawDir: targetState.openClawDir,
    agentId: 'main',
    env: {},
    fetchImpl: await makeRemoteFetchForZip(zipPath),
    restartGateway: async () => {},
    confirm: true,
    skipReindex: true
  });

  assert.equal(result.ok, true);
  const config = JSON.parse(await fs.readFile(path.join(targetState.openClawDir, 'openclaw.json'), 'utf8'));
  assert.equal(config.channels.dingtalk.enabled, false);
  assert.equal(config.plugins.entries['claw-migration'].config.state.disabledChannelAccountsByAgent.main, undefined);

  await fs.rm(rootDir, { recursive: true, force: true });
});
