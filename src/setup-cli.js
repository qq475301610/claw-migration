import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stdin as input, stdout as output } from 'node:process';
import { createInterface } from 'node:readline/promises';
import { DEFAULT_REMOTE_NAME, ensurePluginConfigShape, loadOpenClawConfigForPlugin } from './plugin-config.js';
import { resolveOpenClawDir } from './openclaw-state.js';
import { pathExists, replaceDirectory, writeJson } from './utils.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const bundledSkillDir = path.join(repoRoot, 'skills', 'claw-migration');

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isCommandLike(value) {
  return Boolean(
    value &&
      typeof value.command === 'function' &&
      typeof value.description === 'function' &&
      typeof value.action === 'function'
  );
}

function resolveWriteConfig(runtime) {
  if (!isRecord(runtime) || !isRecord(runtime.config)) {
    return undefined;
  }
  return typeof runtime.config.writeConfigFile === 'function' ? runtime.config.writeConfigFile : undefined;
}

async function prompt(rl, message, defaultValue = '', { secret = false } = {}) {
  const suffix = defaultValue ? ` [${secret ? 'configured' : defaultValue}]` : '';
  const answer = (await rl.question(`${message}${suffix}: `)).trim();
  return answer || defaultValue;
}

async function promptBoolean(rl, message, defaultValue) {
  const label = defaultValue ? 'Y/n' : 'y/N';
  const answer = (await prompt(rl, `${message} (${label})`)).toLowerCase();
  if (!answer) {
    return defaultValue;
  }
  return answer === 'y' || answer === 'yes';
}

async function resolveSetupTarget({ config, runtime, openClawDir }) {
  const runtimeWriteConfig = resolveWriteConfig(runtime);
  if (typeof runtimeWriteConfig === 'function') {
    return {
      config: structuredClone(config ?? {}),
      save: runtimeWriteConfig
    };
  }

  const loaded = await loadOpenClawConfigForPlugin({ openClawDir });
  return {
    config: structuredClone(loaded.config ?? {}),
    save: async (nextConfig) => writeJson(loaded.configPath, nextConfig)
  };
}

export async function getSkillInstallStatus({ openClawDir } = {}) {
  const resolvedOpenClawDir = resolveOpenClawDir({ openClawDir });
  const sourceSkillPath = path.join(bundledSkillDir, 'SKILL.md');
  const sharedSkillDir = path.join(resolvedOpenClawDir, 'skills', 'claw-migration');
  const sharedSkillPath = path.join(sharedSkillDir, 'SKILL.md');

  return {
    openClawDir: resolvedOpenClawDir,
    sourceDir: bundledSkillDir,
    sourceSkillPath,
    sourceExists: await pathExists(sourceSkillPath),
    sharedDir: sharedSkillDir,
    sharedSkillPath,
    sharedExists: await pathExists(sharedSkillPath)
  };
}

export async function installMigrationSkill({ openClawDir, logger } = {}) {
  const status = await getSkillInstallStatus({ openClawDir });
  if (!status.sourceExists) {
    throw new Error(`Bundled skill not found: ${status.sourceSkillPath}`);
  }

  const replaced = await pathExists(status.sharedDir);
  await replaceDirectory(status.sourceDir, status.sharedDir);

  const lines = [
    'Claw Migration skill install',
    `Skill: claw-migration`,
    `Source: ${status.sourceDir}`,
    `Target: ${status.sharedDir}`,
    `Mode: ${replaced ? 'updated existing shared copy' : 'installed new shared copy'}`,
    'Hint: start a new session if it does not appear immediately in <available_skills>.'
  ];
  const outputText = lines.join('\n');

  logger?.info?.(outputText);
  return {
    ok: true,
    skill: 'claw-migration',
    sourceDir: status.sourceDir,
    targetDir: status.sharedDir,
    replaced,
    lines,
    outputText
  };
}

export async function runMigrationDoctor({ openClawDir, logger } = {}) {
  const status = await getSkillInstallStatus({ openClawDir });
  if (!status.sourceExists) {
    throw new Error(`Bundled skill not found: ${status.sourceSkillPath}`);
  }

  const lines = [
    'Claw Migration doctor',
    `OpenClaw dir: ${status.openClawDir}`,
    `Bundled skill: ${status.sourceSkillPath}`,
    `Shared skill: ${status.sharedSkillPath}`
  ];

  if (status.sharedExists) {
    lines.push('Status: shared skill is installed.');
  } else {
    lines.push('Status: bundled skill exists, but shared skill is not installed.');
    lines.push('Hint: normal environments often expose bundled plugin skills automatically.');
    lines.push('Hint: if a new session does not show the skill, run: claw-migration install-skill');
  }

  const outputText = lines.join('\n');
  logger?.info?.(outputText);
  return {
    ok: true,
    ...status,
    lines,
    outputText
  };
}

export async function runMigrationSetup({ config, runtime, logger, openClawDir } = {}) {
  const target = await resolveSetupTarget({ config, runtime, openClawDir });
  const nextConfig = target.config;
  const pluginConfig = ensurePluginConfigShape(nextConfig);
  const currentRemoteName = pluginConfig.defaultRemote ?? DEFAULT_REMOTE_NAME;
  const currentRemote = pluginConfig.remotes[currentRemoteName] ?? { provider: 'github', settings: {} };
  const rl = createInterface({ input, output });

  try {
    logger?.info?.('Claw Migration setup');
    const remoteName = await prompt(rl, 'Remote name', currentRemoteName);
    const provider = 'github';
    const existingRemote = pluginConfig.remotes[remoteName] ?? currentRemote;
    existingRemote.settings ??= {};

    const owner = await prompt(rl, 'GitHub owner', existingRemote.settings.owner ?? '');
    const repo = await prompt(rl, 'GitHub repo', existingRemote.settings.repo ?? '');
    const remoteKey = await prompt(rl, 'Remote key (leave blank to default to the agent id at runtime)', existingRemote.settings.remoteKey ?? '');
    const token = await prompt(rl, 'GitHub token', existingRemote.settings.token ?? '', { secret: true });
    const includeTranscripts = await promptBoolean(rl, 'Include .jsonl transcripts in exports', Boolean(pluginConfig.transfer.includeTranscripts));
    const switchBindingsOnPush = await promptBoolean(rl, 'Disable source bindings after push', Boolean(pluginConfig.switchBindingsOnPush));
    const switchBindingsOnPull = await promptBoolean(rl, 'Enable target bindings after pull', Boolean(pluginConfig.switchBindingsOnPull));
    const restartGatewayOnPush = await promptBoolean(rl, 'Restart gateway after push', Boolean(pluginConfig.restartGatewayOnPush));
    const restartGatewayOnPull = await promptBoolean(rl, 'Restart gateway after pull', Boolean(pluginConfig.restartGatewayOnPull));

    pluginConfig.defaultRemote = remoteName;
    pluginConfig.remotes[remoteName] = {
      provider,
      settings: {
        ...existingRemote.settings,
        ...(owner ? { owner } : {}),
        ...(repo ? { repo } : {}),
        ...(remoteKey ? { remoteKey } : {}),
        ...(token ? { token } : {})
      }
    };
    if (!owner) {
      delete pluginConfig.remotes[remoteName].settings.owner;
    }
    if (!repo) {
      delete pluginConfig.remotes[remoteName].settings.repo;
    }
    if (!remoteKey) {
      delete pluginConfig.remotes[remoteName].settings.remoteKey;
    }
    if (!token) {
      delete pluginConfig.remotes[remoteName].settings.token;
    }
    pluginConfig.transfer.includeTranscripts = includeTranscripts;
    pluginConfig.switchBindingsOnPush = switchBindingsOnPush;
    pluginConfig.switchBindingsOnPull = switchBindingsOnPull;
    pluginConfig.restartGatewayOnPush = restartGatewayOnPush;
    pluginConfig.restartGatewayOnPull = restartGatewayOnPull;

    await target.save(nextConfig);
    logger?.info?.(`Saved Claw Migration config to plugins.entries.claw-migration.config (defaultRemote=${remoteName}).`);
    logger?.info?.('If a new session does not show the skill, run: claw-migration install-skill');
    return true;
  } finally {
    rl.close();
  }
}

export function registerMigrationCli(api = {}) {
  if (typeof api.registerCli !== 'function') {
    return;
  }

  api.registerCli(
    (ctx = {}) => {
      if (!isCommandLike(ctx.program)) {
        return;
      }

      const logger = ctx.logger ?? api.logger ?? console;
      const root = ctx.program.command('migration').description('Claw Migration plugin commands');

      root
        .command('about')
        .description('Show Claw Migration usage hints')
        .action(() => {
          logger.info?.(
            [
              'Claw Migration is installed.',
              'Plugin defaults are seeded into plugins.entries.claw-migration.config automatically.',
              'If this OpenClaw build exposes plugin CLI injection, you can run: openclaw migration setup',
              'Fallback that always works: claw-migration setup',
              'If a new session does not show the skill, run: claw-migration install-skill',
              'Then use: claw-migration preview push --agent <id>'
            ].join('\n')
          );
        });

      root
        .command('setup')
        .description('Configure GitHub remote and token for Claw Migration')
        .action(async () => {
          await runMigrationSetup({
            config: ctx.config,
            runtime: api.runtime,
            logger
          });
        });

      root
        .command('install-skill')
        .description('Install the claw-migration skill into ~/.openclaw/skills')
        .action(async () => {
          await installMigrationSkill({ logger });
        });

      root
        .command('doctor')
        .description('Check whether the bundled and shared claw-migration skills are available')
        .action(async () => {
          await runMigrationDoctor({ logger });
        });
    },
    { commands: ['migration'] }
  );
}
