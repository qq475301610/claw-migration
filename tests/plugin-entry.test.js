import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import pluginEntry, { register } from '../src/index.js';
import { DEFAULT_REMOTE_NAME, ensurePluginConfigShape } from '../src/plugin-config.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('package.json declares an OpenClaw extension entry', async () => {
  const packageJson = JSON.parse(await fs.readFile(path.join(repoRoot, 'package.json'), 'utf8'));
  assert.deepEqual(packageJson.openclaw?.extensions, ['./src/index.js']);
  assert.equal(packageJson.openclaw?.install?.localPath, '.');
});

test('openclaw.plugin.json declares claw-migration manifest metadata', async () => {
  const manifest = JSON.parse(await fs.readFile(path.join(repoRoot, 'openclaw.plugin.json'), 'utf8'));
  assert.equal(manifest.id, 'claw-migration');
  assert.equal(Array.isArray(manifest.skills), true);
  assert.equal(manifest.skills.includes('./skills'), true);
  assert.equal(typeof manifest.configSchema, 'object');
  assert.equal(Boolean(manifest.configSchema.properties.remotes.additionalProperties.properties.settings.properties.owner), true);
  assert.equal(Boolean(manifest.configSchema.properties.remotes.additionalProperties.properties.settings.properties.repo), true);
  assert.equal(Boolean(manifest.configSchema.properties.remotes.additionalProperties.properties.settings.properties.remoteKey), true);
  assert.equal(Boolean(manifest.configSchema.properties.remotes.additionalProperties.properties.settings.properties.releaseId), true);
  assert.equal(Boolean(manifest.configSchema.properties.remotes.additionalProperties.properties.settings.properties.token), true);
});

test('plugin entry exports a register function for OpenClaw', () => {
  assert.equal(typeof register, 'function');
  assert.equal(pluginEntry.id, 'claw-migration');
  assert.equal(typeof pluginEntry.register, 'function');
});

test('ensurePluginConfigShape seeds a default github remote config', () => {
  const config = {};
  const pluginConfig = ensurePluginConfigShape(config);
  assert.equal(pluginConfig.defaultRemote, DEFAULT_REMOTE_NAME);
  assert.equal(pluginConfig.remotes[DEFAULT_REMOTE_NAME].provider, 'github');
  assert.deepEqual(pluginConfig.remotes[DEFAULT_REMOTE_NAME].settings, {});
});
