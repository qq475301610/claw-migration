# Claw Migration

[English](./README.md) | [¼òÌåÖÐÎÄ](./README.zh-CN.md)

`claw-migration` is an OpenClaw plugin and CLI for moving one agent from one device to another.

It packages the selected agent's config, sessions, and workspace, uploads that package to GitHub, and then lets the target device pull it back with a preview-first workflow. After a successful handoff, it can disable bindings on the source device, disable the linked QQ bot account on the source device, enable them on the target device, and restart the gateway on both sides.

## What This Project Does

Use `claw-migration` when you want to:
- move one OpenClaw agent to another device without manually copying `.openclaw` state
- keep the agent's workspace, session history, and agent-local config together
- hand off the same agent between two machines through a GitHub-backed remote
- let either a human or an OpenClaw skill drive the migration flow

Current scope:
- single-agent migration only
- GitHub provider implemented
- WebDAV reserved for a future version
- full migration package, not a sanitized sharing bundle

## Install From Source

### 1. Download the source code

```bash
git clone https://github.com/qq475301610/claw-migration.git
cd claw-migration
```

### 2. Install dependencies

Requirements:
- Node.js 20 or newer
- npm
- OpenClaw already installed on this machine

```bash
npm install
```

There is currently no separate build step. This project runs directly from source.

Optional self-check:

```bash
npm test
```

### 3. Register the plugin with OpenClaw

This step makes OpenClaw recognize `claw-migration` as a real plugin.

```bash
openclaw plugins install -l .
```

Optional verification:

```bash
openclaw plugins list
```

When the plugin is first loaded, it will seed a default config block into `~/.openclaw/openclaw.json` automatically.

### 4. Run the guided setup

Recommended setup flow:

```bash
claw-migration setup
```

This command will guide you through:
- choosing a remote name
- setting a stable `remoteKey`
- entering your GitHub token directly into `openclaw.json`
- deciding whether to include transcripts
- deciding whether push/pull should switch bindings and restart gateway

### 5. Choose how you want to run the CLI

Option A: run directly from the repo

```bash
node ./bin/claw-migration.js preview push --agent main
```

Option B: install the command globally on this machine

```bash
npm link
claw-migration --help
```

## Configuration Model

The plugin config lives in:
- `~/.openclaw/openclaw.json`
- `plugins.entries.claw-migration.config`

Typical GitHub config now looks like this:

```json
{
  "plugins": {
    "entries": {
      "claw-migration": {
        "enabled": true,
        "config": {
          "defaultRemote": "main-agent",
          "remotes": {
            "main-agent": {
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
      }
    }
  }
}
```

Important notes:
- `remoteKey` is the primary stable identifier for a GitHub remote
- `gistId` is now treated as an internal cache and may be written automatically after push or pull
- the GitHub token can be stored directly in `remotes.<name>.settings.token`
- environment variables are still supported as a fallback, but they are no longer the recommended setup path

## GitHub Token

Recommended path:
- run `claw-migration setup`
- paste your token when prompted
- let the plugin write it into `openclaw.json`

Fallback path:
- set `OPENCLAW_GITHUB_TOKEN`
- or `GITHUB_TOKEN`
- or `GH_TOKEN`

The token must be able to create and update private gists.

Where to get the token:
1. Open GitHub.
2. Go to `Settings -> Developer settings -> Personal access tokens`.
3. Create either:
- a classic token with the `gist` scope
- or a fine-grained token with `User permissions -> Gists` set to write

GitHub docs:
- [Managing your personal access tokens](https://docs.github.com/github/extending-github/git-automation-with-oauth-tokens)
- [Permissions required for fine-grained personal access tokens](https://docs.github.com/en/rest/authentication/permissions-required-for-fine-grained-personal-access-tokens)

## Quick Usage

If you did not run `npm link`, replace `claw-migration` below with `node ./bin/claw-migration.js`. Prefer `claw-migration setup` because it works even when an OpenClaw build does not expose plugin CLI subcommands.

### Source device

Recommended first-time setup:

```bash
openclaw plugins install -l .
claw-migration setup
claw-migration preview push --agent main
claw-migration push --agent main
```

What happens after a successful `push`:
- a GitHub gist is created or updated for the configured `remoteKey`
- the selected agent's bindings are disabled if configured
- the linked `qqbot.accounts.<accountId>.enabled` is set to `false` when applicable
- the gateway is restarted if configured
- `gistId` is cached back into `openclaw.json`

### Target device

Before `pull`, make sure the target device has:
- the plugin installed with `openclaw plugins install -l .`
- the same `remoteKey` configured through `claw-migration setup`
- a GitHub token configured in `openclaw.json` or available via environment variable

Then run:

```bash
claw-migration preview pull --agent main
claw-migration pull --agent main --yes
```

What happens after a successful `pull`:
- the remote package is downloaded
- the agent config, sessions, and workspace are imported
- the selected agent's bindings are re-enabled if configured
- the linked `qqbot` account is re-enabled when applicable
- the gateway is restarted if configured

## Command Reference

```bash
claw-migration setup
claw-migration preview push --agent <id>
claw-migration push --agent <id>
claw-migration preview pull --agent <id>
claw-migration pull --agent <id> --yes
claw-migration verify --agent <id>
```

Common flags:
- `--remote <name>`: override `defaultRemote`
- `--openclaw-dir <path>`: override `~/.openclaw`
- `--skip-reindex`: skip memory index rebuild after `pull`
- `--notes <text>`: attach notes to pushed manifests
- `--input <file>`: verify a local zip instead of a remote package

## OpenClaw Skill Usage

The bundled skill lives at [skills/claw-migration/SKILL.md](./skills/claw-migration/SKILL.md).

Once the plugin is installed, an Agent can use that skill to:
1. read `plugins.entries.claw-migration.config`
2. run preview before push or pull
3. stop on blockers instead of forcing writes
4. summarize remote, bindings, qqbot account state, and gateway actions after success

## Plugin Files

The files that make this repository an OpenClaw plugin are:
- [openclaw.plugin.json](./openclaw.plugin.json)
- [package.json](./package.json)
- [src/index.js](./src/index.js)
- [src/setup-cli.js](./src/setup-cli.js)
- [skills/claw-migration/SKILL.md](./skills/claw-migration/SKILL.md)

## Testing

```bash
npm test
```

## More Documentation

- GitHub provider guide: [docs/github-provider-guide.md](./docs/github-provider-guide.md)

