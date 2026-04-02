import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanupStaleMigrationTempDirs } from '../src/utils.js';

test('cleanupStaleMigrationTempDirs removes only claw-migration temp directories', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'claw-migration-temp-root-'));
  const removable = [
    'openclaw-migration-main-123',
    'openclaw-migration-output-abc',
    'openclaw-migration-gist-xyz',
    'openclaw-migration-extract-777'
  ];
  const keep = ['some-other-tool', 'migration-not-ours'];

  for (const name of [...removable, ...keep]) {
    await fs.mkdir(path.join(tempRoot, name), { recursive: true });
  }

  const removed = await cleanupStaleMigrationTempDirs({ tempRoot });

  assert.equal(removed.length, removable.length);
  for (const name of removable) {
    await assert.rejects(fs.access(path.join(tempRoot, name)));
  }
  for (const name of keep) {
    await fs.access(path.join(tempRoot, name));
  }

  await fs.rm(tempRoot, { recursive: true, force: true });
});
