import { stdin as input, stdout as output } from 'node:process';
import { createInterface } from 'node:readline/promises';
import { DEFAULT_REMOTE_NAME, ensurePluginConfigShape, loadOpenClawConfigForPlugin } from './plugin-config.js';
import { writeJson } from './utils.js';

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
        ...(remoteKey ? { remoteKey } : {}),
        ...(token ? { token } : {})
      }
    };
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
    },
    { commands: ['migration'] }
  );
}
