import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadOpenClawConfigForPlugin } from '../src/plugin-config.js';

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

test('plugin config loader reads claw-migration config from openclaw.json', async () => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'claw-migration-config-'));
  const openClawDir = path.join(rootDir, '.openclaw');
  await writeJson(path.join(openClawDir, 'openclaw.json'), {
    plugins: {
      entries: {
        'claw-migration': {
          enabled: true,
          config: {
            defaultRemote: 'primary',
            remotes: {
              primary: {
                provider: 'github',
                settings: {
                  owner: 'octo-org',
                  repo: 'migration-store',
                  releaseId: 123
                }
              }
            },
            switchBindingsOnPush: true,
            restartGatewayOnPull: true
          }
        }
      }
    }
  });

  const loaded = await loadOpenClawConfigForPlugin({ openClawDir });
  assert.equal(loaded.pluginConfig.defaultRemote, 'primary');
  assert.equal(loaded.pluginConfig.remotes.primary.provider, 'github');
  assert.equal(loaded.pluginConfig.remotes.primary.settings.owner, 'octo-org');
  assert.equal(loaded.pluginConfig.remotes.primary.settings.repo, 'migration-store');
  assert.equal(loaded.pluginConfig.remotes.primary.settings.releaseId, 123);
  assert.equal(loaded.pluginConfig.switchBindingsOnPush, true);
  assert.equal(loaded.pluginConfig.restartGatewayOnPull, true);

  await fs.rm(rootDir, { recursive: true, force: true });
});
