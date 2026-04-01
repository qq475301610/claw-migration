# GitHub Provider Guide

This guide focuses on the v1 `github` remote for `claw-migration`.

## What the GitHub provider does

- Stores one complete migration package as a private GitHub Gist
- Uses a stable `remoteKey` to identify the same remote package across devices
- Creates the gist on first `push`
- Reuses and updates the same gist on later `push` runs
- Downloads that gist for `preview pull`, `pull`, and remote `verify`

The package remains a complete zip bundle. The provider only decides where that bundle is stored.

## Recommended setup flow

1. Install the plugin with `openclaw plugins install -l .`
2. Run `claw-migration setup`
3. Let the setup command write the GitHub remote into `~/.openclaw/openclaw.json`

If you prefer to inspect the config manually, the plugin block lives under `plugins.entries.claw-migration.config`.

## Required config

Typical GitHub config:

```json
{
  "defaultRemote": "github-main",
  "remotes": {
    "github-main": {
      "provider": "github",
      "settings": {
        "remoteKey": "main-agent",
        "token": "ghp_xxx"
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
- `settings.remoteKey`: the stable identifier shared by source and target devices
- `settings.token`: the preferred place to store the GitHub token for this remote
- `settings.gistId`: an internal cache written back automatically after a successful push or pull
- `includeTranscripts`: whether `*.jsonl` transcript files are packed
- `switchBindingsOnPush`: whether source-device bindings are disabled after push
- `switchBindingsOnPull`: whether target-device bindings are enabled after pull
- `restartGatewayOnPush`: whether gateway restarts after push
- `restartGatewayOnPull`: whether gateway restarts after pull

## Authentication

Preferred path:
- run `claw-migration setup`
- paste the GitHub token when prompted
- let the plugin save it to `remotes.<name>.settings.token`

Fallback path:
- `OPENCLAW_GITHUB_TOKEN`
- `GITHUB_TOKEN`
- `GH_TOKEN`

The token should be able to create and update private gists.

## First push

On the first source-device upload:

1. `claw-migration setup`
2. `claw-migration preview push --agent <id>`
3. `claw-migration push --agent <id>`

Expected result:
- a private gist is created
- the returned `gistId` is written back into `openclaw.json` as cache
- the configured `remoteKey` becomes the stable identifier the other device can reuse
- the current agent's bindings are disabled if configured
- if the agent is routed through `qqbot`, the linked account is also marked disabled
- gateway restarts if configured

## Pull on the target device

Before pulling on the target device:

1. Install the plugin locally with `openclaw plugins install -l .`
2. Run `claw-migration setup`
3. Ensure the target remote uses the same `remoteKey`
4. Configure the GitHub token in setup or provide it through fallback environment variables

Then run:

```bash
claw-migration preview pull --agent <id>
claw-migration pull --agent <id> --yes
```

Expected result:
- the gist package is downloaded
- the agent is imported into local OpenClaw state
- that agent's bindings are re-enabled if configured
- if the agent is routed through `qqbot`, the linked account is re-enabled when possible
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
- Missing both `remoteKey` and `gistId`: preview and execution block
- Missing required plugins or skills on target: `preview pull` reports blockers and `pull` refuses to continue
- Missing agent on source: `preview push` and `push` block before package creation

