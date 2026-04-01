# GitHub Provider Guide

This guide focuses on the v1 `github` remote for `claw-migration`.

## What the GitHub provider does

- Stores one complete migration package as a private GitHub Gist
- Creates the gist on first `push`
- Updates the same gist on later `push` runs
- Downloads that gist for `preview pull`, `pull`, and remote `verify`

The package remains a complete zip bundle. The provider only decides where that bundle is stored.

## Required config

Add this block under `plugins.entries.claw-migration.config` in `openclaw.json`:

```json
{
  "defaultRemote": "github-main",
  "remotes": {
    "github-main": {
      "provider": "github",
      "settings": {
        "gistId": ""
      }
    }
  },
  "transfer": {
    "includeTranscripts": false
  },
  "switchBindingsOnPush": true,
  "switchBindingsOnPull": true,
  "restartGatewayOnPush": true,
  "restartGatewayOnPull": true
}
```

Meaning of the key fields:
- `defaultRemote`: the remote used when `--remote` is omitted
- `provider`: `github` for the currently implemented provider
- `settings.gistId`: empty before first push, then populated after a successful push
- `includeTranscripts`: whether `*.jsonl` transcript files are packed
- `switchBindingsOnPush`: whether source-device bindings are disabled after push
- `switchBindingsOnPull`: whether target-device bindings are enabled after pull
- `restartGatewayOnPush`: whether gateway restarts after push
- `restartGatewayOnPull`: whether gateway restarts after pull

## Authentication

The provider reads an existing token from one of:
- `OPENCLAW_GITHUB_TOKEN`
- `GITHUB_TOKEN`
- `GH_TOKEN`

The token should be able to create and update private gists.

## First push

On the first source-device upload:

1. `claw-migration preview push --agent <id>`
2. `claw-migration push --agent <id>`

Expected result:
- a private gist is created
- the returned `gistId` is written into `openclaw.json`
- the current agent's bindings are disabled if configured
- gateway restarts if configured

## Pull on the target device

Before pulling on the target device:

1. Ensure the plugin config exists locally
2. Ensure the remote points to the same `gistId`
3. Export the GitHub token

Then run:

```bash
claw-migration preview pull --agent <id>
claw-migration pull --agent <id> --yes
```

Expected result:
- the gist package is downloaded
- the agent is imported into local OpenClaw state
- that agent's bindings are re-enabled if configured
- gateway restarts if configured

## Verification

You can verify either a remote package or a local zip.

Remote:

```bash
claw-migration verify --agent <id>
```

Local:

```bash
claw-migration verify --agent <id> --input ./migration.zip
```

## Common failure cases

- Missing token: preview and execution block before network operations
- Missing `defaultRemote`: preview and execution block
- Missing `gistId` on pull: preview and execution block
- Missing required plugins or skills on target: `preview pull` reports blockers and `pull` refuses to continue
- Missing agent on source: `preview push` and `push` block before package creation
