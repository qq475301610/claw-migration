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
