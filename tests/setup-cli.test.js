import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSetupRemoteSettings, installMigrationSkill, runMigrationDoctor, runMigrationSetup } from '../src/setup-cli.js';

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function createOpenClawConfig(rootDir) {
  const openClawDir = path.join(rootDir, '.openclaw');
  await writeJson(path.join(openClawDir, 'openclaw.json'), {
    plugins: {
      entries: {
        'claw-migration': {
          enabled: true,
          config: {
            defaultRemote: 'github-main',
            remotes: {
              'github-main': {
                provider: 'github',
                settings: {}
              }
            }
          }
        }
      }
    }
  });
  return openClawDir;
}

function createFakeReadline(answers) {
  let index = 0;
  return () => ({
    async question() {
      const answer = answers[index] ?? '';
      index += 1;
      return answer;
    },
    close() {}
  });
}

test('installMigrationSkill copies the bundled skill into ~/.openclaw/skills and overwrites existing content', async () => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'claw-migration-install-skill-'));
  const openClawDir = await createOpenClawConfig(rootDir);
  const sharedSkillDir = path.join(openClawDir, 'skills', 'claw-migration');
  await fs.mkdir(sharedSkillDir, { recursive: true });
  await fs.writeFile(path.join(sharedSkillDir, 'SKILL.md'), 'old\n', 'utf8');
  await fs.writeFile(path.join(sharedSkillDir, 'stale.txt'), 'stale\n', 'utf8');

  const result = await installMigrationSkill({ openClawDir });

  assert.equal(result.ok, true);
  assert.equal(result.replaced, true);
  assert.equal(result.targetDir, sharedSkillDir);
  const skillContent = await fs.readFile(path.join(sharedSkillDir, 'SKILL.md'), 'utf8');
  assert.match(skillContent, /Claw Migration Skill/);
  await assert.rejects(fs.access(path.join(sharedSkillDir, 'stale.txt')));

  const config = JSON.parse(await fs.readFile(path.join(openClawDir, 'openclaw.json'), 'utf8'));
  assert.equal(config.skills.entries['claw-migration'].enabled, true);
  assert.match(result.outputText, /skills.entries.claw-migration.enabled = true/);

  await fs.rm(rootDir, { recursive: true, force: true });
});

test('runMigrationDoctor reports fallback guidance when only bundled skill exists', async () => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'claw-migration-doctor-'));
  const openClawDir = await createOpenClawConfig(rootDir);

  const result = await runMigrationDoctor({ openClawDir });

  assert.equal(result.ok, true);
  assert.equal(result.sourceExists, true);
  assert.equal(result.sharedExists, false);
  assert.match(result.outputText, /install-skill/);

  await fs.rm(rootDir, { recursive: true, force: true });
});

test('runMigrationDoctor reports installed shared skill when present', async () => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'claw-migration-doctor-shared-'));
  const openClawDir = await createOpenClawConfig(rootDir);
  await installMigrationSkill({ openClawDir });

  const result = await runMigrationDoctor({ openClawDir });

  assert.equal(result.sharedExists, true);
  assert.match(result.outputText, /shared skill is installed/i);

  await fs.rm(rootDir, { recursive: true, force: true });
});

test('buildSetupRemoteSettings does not copy releaseId into a new remote template', () => {
  const result = buildSetupRemoteSettings({
    owner: 'qq475301610',
    repo: 'claw-migration-store',
    token: 'secret',
    remoteKey: 'main',
    releaseId: 123
  });

  assert.deepEqual(result, {
    owner: 'qq475301610',
    repo: 'claw-migration-store',
    token: 'secret',
    remoteKey: 'main'
  });
});

test('runMigrationSetup can install the shared skill during setup', async () => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'claw-migration-setup-'));
  const openClawDir = await createOpenClawConfig(rootDir);
  const savedLogs = [];
  const installCalls = [];

  const result = await runMigrationSetup({
    openClawDir,
    logger: {
      info(message) {
        savedLogs.push(message);
      }
    },
    createReadline: createFakeReadline([
      'momiji',
      'qq475301610',
      'claw-migration-store',
      'momiji',
      'secret-token',
      'y',
      'y',
      'y',
      'n',
      'n',
      'y'
    ]),
    installSkill: async (options) => {
      installCalls.push(options);
      return {
        ok: true,
        outputText: 'installed'
      };
    }
  });

  assert.equal(result.ok, true);
  assert.equal(result.remoteName, 'momiji');
  assert.equal(result.installedSkill, true);
  assert.equal(installCalls.length, 1);

  const config = JSON.parse(await fs.readFile(path.join(openClawDir, 'openclaw.json'), 'utf8'));
  const remote = config.plugins.entries['claw-migration'].config.remotes.momiji;
  assert.equal(remote.settings.owner, 'qq475301610');
  assert.equal(remote.settings.repo, 'claw-migration-store');
  assert.equal(remote.settings.remoteKey, 'momiji');
  assert.equal(remote.settings.token, 'secret-token');
  assert.ok(savedLogs.some((line) => /Saved Claw Migration config/i.test(line)));

  await fs.rm(rootDir, { recursive: true, force: true });
});
