#!/usr/bin/env node
import process from 'node:process';
import {
  formatActionPreview,
  formatVerification,
  previewPull,
  previewPush,
  pullAgentMigration,
  pushAgentMigration,
  verifyMigration
} from '../src/index.js';
import { promptYesNo } from '../src/utils.js';

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const args = { _: command ? [command] : [] };
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (!token.startsWith('--')) {
      args._.push(token);
      continue;
    }

    const key = token.slice(2);
    const next = rest[index + 1];
    if (!next || next.startsWith('--')) {
      args[key] = true;
      continue;
    }
    args[key] = next;
    index += 1;
  }
  return args;
}

function commandOptions(args) {
  return {
    agentId: args.agent,
    openClawDir: args['openclaw-dir'],
    inputPath: args.input,
    remoteName: args.remote,
    notes: args.notes,
    skipReindex: Boolean(args['skip-reindex']),
    confirm: Boolean(args.yes)
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const command = args._[0];
  const subcommand = args._[1];
  const options = commandOptions(args);

  if (command === 'push') {
    const result = await pushAgentMigration(options);
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (command === 'pull') {
    let confirm = options.confirm;
    if (!confirm) {
      const preview = await previewPull(options);
      console.log(formatActionPreview(preview));
      confirm = await promptYesNo('Apply this pull?');
      await preview.sourceCleanup?.();
      await preview.packageCleanup?.();
    }
    const result = await pullAgentMigration({ ...options, confirm });
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (command === 'preview' && subcommand === 'push') {
    const result = await previewPush(options);
    console.log(formatActionPreview(result));
    await result.cleanup?.();
    return;
  }

  if (command === 'preview' && subcommand === 'pull') {
    const result = await previewPull(options);
    console.log(formatActionPreview(result));
    await result.sourceCleanup?.();
    await result.packageCleanup?.();
    return;
  }

  if (command === 'verify') {
    const result = await verifyMigration(options);
    console.log(formatVerification(result));
    return;
  }

  console.error('Usage: claw-migration <push|pull|preview push|preview pull|verify> [options]');
  process.exitCode = 1;
}

main().catch((error) => {
  console.error(error.stack ?? error.message);
  process.exitCode = 1;
});
