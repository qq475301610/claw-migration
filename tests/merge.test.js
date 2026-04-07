import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeOpenClawConfig } from '../src/merge.js';

test('mergeOpenClawConfig preserves target workspace path and replaces bindings for the agent', () => {
  const sourceConfig = {
    meta: { lastTouchedVersion: '2026.3.28' },
    agents: {
      defaults: { workspace: 'C:/source/.openclaw/workspace' },
      list: [{ id: 'main', name: 'Source Agent', workspace: 'C:/source/.openclaw/workspace' }]
    },
    bindings: [{ agentId: 'main', match: { channel: 'qqbot', accountId: 'source-bot' } }],
    session: { dmScope: 'main' },
    tools: { web: { enabled: true } }
  };

  const targetConfig = {
    agents: {
      defaults: { workspace: '/Users/example/.openclaw/workspace' },
      list: [{ id: 'main', name: 'Old Agent', workspace: '/Users/example/.openclaw/workspace' }]
    },
    bindings: [
      { agentId: 'main', match: { channel: 'discord', accountId: 'old-bot' } },
      { agentId: 'momiji', match: { channel: 'telegram', accountId: 'other' } }
    ],
    gateway: { port: 18789, auth: { token: 'keep-me' } }
  };

  const merged = mergeOpenClawConfig({
    sourceConfig,
    targetConfig,
    agentId: 'main',
    openClawDir: path.join('D:', 'target', '.openclaw')
  });

  assert.equal(merged.agents.list[0].name, 'Source Agent');
  assert.equal(merged.agents.list[0].workspace, '/Users/example/.openclaw/workspace');
  assert.deepEqual(merged.bindings, [
    { agentId: 'momiji', match: { channel: 'telegram', accountId: 'other' } },
    { agentId: 'main', match: { channel: 'qqbot', accountId: 'source-bot' } }
  ]);
  assert.equal(merged.gateway.auth.token, 'keep-me');
});

test('mergeOpenClawConfig only restores matched account config for account-scoped channels', () => {
  const sourceConfig = {
    agents: {
      defaults: { workspace: 'C:/source/.openclaw/workspace-main' },
      list: [{ id: 'main', name: 'Source Agent', workspace: 'C:/source/.openclaw/workspace-main' }]
    },
    bindings: [{ agentId: 'main', match: { channel: 'qqbot', accountId: 'marie_bot' } }],
    channels: {
      qqbot: {
        accounts: {
          marie_bot: { appId: '1', clientSecret: 'marie-secret' },
          momiji_bot: { appId: '2', clientSecret: 'momiji-secret' }
        },
        asr: { enabled: true },
        tts: { enabled: true }
      }
    }
  };

  const merged = mergeOpenClawConfig({
    sourceConfig,
    targetConfig: { channels: {} },
    agentId: 'main',
    openClawDir: path.join('D:', 'target', '.openclaw')
  });

  assert.deepEqual(merged.channels.qqbot.accounts, {
    marie_bot: { appId: '1', clientSecret: 'marie-secret' }
  });
  assert.equal(merged.channels.qqbot.asr, undefined);
  assert.equal(merged.channels.qqbot.tts, undefined);
});

test('mergeOpenClawConfig clears stale root credentials when restoring an account-scoped openclaw-china channel', () => {
  const sourceConfig = {
    agents: {
      defaults: { workspace: 'C:/source/.openclaw/workspace-main' },
      list: [{ id: 'main', name: 'Source Agent', workspace: 'C:/source/.openclaw/workspace-main' }]
    },
    bindings: [{ agentId: 'main', match: { channel: 'qqbot', accountId: 'marie_bot' } }],
    channels: {
      qqbot: {
        accounts: {
          marie_bot: {
            appId: 'source-app',
            clientSecret: 'source-secret',
            webhookPath: '/qq/source'
          }
        }
      }
    }
  };

  const targetConfig = {
    channels: {
      qqbot: {
        enabled: true,
        defaultAccount: 'marie_bot',
        appId: 'legacy-app',
        clientSecret: 'legacy-secret',
        webhookPath: '/qq/legacy'
      }
    }
  };

  const merged = mergeOpenClawConfig({
    sourceConfig,
    targetConfig,
    agentId: 'main',
    openClawDir: path.join('D:', 'target', '.openclaw')
  });

  assert.equal(merged.channels.qqbot.enabled, true);
  assert.equal(merged.channels.qqbot.defaultAccount, 'marie_bot');
  assert.equal(merged.channels.qqbot.appId, undefined);
  assert.equal(merged.channels.qqbot.clientSecret, undefined);
  assert.equal(merged.channels.qqbot.webhookPath, undefined);
  assert.deepEqual(merged.channels.qqbot.accounts, {
    marie_bot: {
      appId: 'source-app',
      clientSecret: 'source-secret',
      webhookPath: '/qq/source'
    }
  });
});

test('mergeOpenClawConfig applies the same root-field cleanup to other openclaw-china account channels', () => {
  const sourceConfig = {
    agents: {
      defaults: { workspace: 'C:/source/.openclaw/workspace-main' },
      list: [{ id: 'main', name: 'Source Agent', workspace: 'C:/source/.openclaw/workspace-main' }]
    },
    bindings: [{ agentId: 'main', match: { channel: 'dingtalk', accountId: 'corp-a' } }],
    channels: {
      dingtalk: {
        accounts: {
          'corp-a': {
            clientId: 'source-client',
            clientSecret: 'source-secret',
            gatewayToken: 'source-token'
          }
        }
      }
    }
  };

  const targetConfig = {
    channels: {
      dingtalk: {
        enabled: true,
        clientId: 'legacy-client',
        clientSecret: 'legacy-secret',
        gatewayToken: 'legacy-token'
      }
    }
  };

  const merged = mergeOpenClawConfig({
    sourceConfig,
    targetConfig,
    agentId: 'main',
    openClawDir: path.join('D:', 'target', '.openclaw')
  });

  assert.equal(merged.channels.dingtalk.enabled, true);
  assert.equal(merged.channels.dingtalk.clientId, undefined);
  assert.equal(merged.channels.dingtalk.clientSecret, undefined);
  assert.equal(merged.channels.dingtalk.gatewayToken, undefined);
  assert.deepEqual(merged.channels.dingtalk.accounts, {
    'corp-a': {
      clientId: 'source-client',
      clientSecret: 'source-secret',
      gatewayToken: 'source-token'
    }
  });
});
