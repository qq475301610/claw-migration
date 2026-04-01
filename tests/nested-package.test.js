import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { zipDirectory } from '../src/archive.js';
import { extractPackageForInspection } from '../src/migration-package.js';
import { ensureDir, writeJson } from '../src/utils.js';

async function writeNestedPackage(packageDir) {
  await ensureDir(path.join(packageDir, 'agents', 'main', 'agent'));
  await ensureDir(path.join(packageDir, 'agents', 'main', 'sessions'));
  await ensureDir(path.join(packageDir, 'workspace', 'memory'));
  await ensureDir(path.join(packageDir, 'workspace', 'assets'));

  await writeJson(path.join(packageDir, 'manifest.json'), {
    source: { agentId: 'main' },
    checksums: {},
    warnings: []
  });
  await writeJson(path.join(packageDir, 'openclaw.json'), {});
  await writeJson(path.join(packageDir, 'agents', 'main', 'agent', 'auth-profiles.json'), {});
  await writeJson(path.join(packageDir, 'agents', 'main', 'agent', 'models.json'), {});
  await writeJson(path.join(packageDir, 'agents', 'main', 'sessions', 'sessions.json'), {});
}

test('extractPackageForInspection supports packages nested under a top-level directory', async () => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'claw-migration-nested-'));
  const packageDir = path.join(rootDir, 'outer', 'bundle');
  await writeNestedPackage(packageDir);

  const zipPath = path.join(rootDir, 'nested.zip');
  await zipDirectory(path.join(rootDir, 'outer'), zipPath);

  const result = await extractPackageForInspection({ packagePath: zipPath, agentId: 'main' });
  assert.equal(path.basename(result.packageRoot), 'bundle');
  assert.equal(result.blockers.length, 0);

  await fs.rm(rootDir, { recursive: true, force: true });
});

test('extractPackageForInspection supports packages nested multiple directory levels deep', async () => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'claw-migration-nested-deep-'));
  const packageDir = path.join(rootDir, 'outer', 'level-one', 'level-two', 'bundle');
  await writeNestedPackage(packageDir);

  const zipPath = path.join(rootDir, 'nested-deep.zip');
  await zipDirectory(path.join(rootDir, 'outer'), zipPath);

  const result = await extractPackageForInspection({ packagePath: zipPath, agentId: 'main' });
  assert.equal(path.basename(result.packageRoot), 'bundle');
  assert.equal(result.blockers.length, 0);

  await fs.rm(rootDir, { recursive: true, force: true });
});
