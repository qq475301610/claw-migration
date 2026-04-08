# Claw Migration

[English](./README.md) | [简体中文](./README.zh-CN.md)

`claw-migration` is an OpenClaw plugin and CLI for moving one agent from one device to another.

It packages the selected agent's config, sessions, and workspace, uploads that package to GitHub Releases, and lets the target device pull it back with a preview-first workflow. After a successful handoff, it can disable bindings on the source device, disable the linked channel account when supported, and enable them again on the target device.

## What This Project Does

Use `claw-migration` when you want to:
- move one OpenClaw agent to another device without manually copying `.openclaw` state
- keep the agent's workspace, session history, and agent-local config together
- hand off the same agent between two machines through a GitHub-backed remote
- let either a human or an OpenClaw skill drive the migration flow

Current scope:
- single-agent migration only
- GitHub Release Assets provider implemented
- WebDAV reserved for a future version
- full migration package, not a sanitized sharing bundle
- channel state recovery supports official OpenClaw channel-style configs and the channel plugin set from `openclaw-china`

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

```bash
openclaw plugins install -l .
```

Optional verification:

```bash
openclaw plugins list
```

When the plugin is first loaded, it will seed a default config block into `~/.openclaw/openclaw.json` automatically.

### 4. Choose how you want to run the CLI

Option A: run directly from the repo

```bash
node ./bin/claw-migration.js preview push --agent main
```

Option B: install the command globally on this machine

```bash
npm link
claw-migration --help
```

## Quick Start

Recommended first-run flow:

```bash
claw-migration setup
claw-migration doctor
```

`claw-migration setup` now covers the full guided setup flow:
- create or update the remote config
- store the GitHub token in `openclaw.json`
- choose whether to include transcripts
- choose whether push/pull should switch bindings
- optionally install the shared `claw-migration` skill into `~/.openclaw/skills`

If a new session still does not show the skill after setup, run:

```bash
claw-migration install-skill
```

## Configuration Model

The plugin config lives in:
- `~/.openclaw/openclaw.json`
- `plugins.entries.claw-migration.config`

### GitHub remote fields and token permissions

When `claw-migration setup` asks for GitHub values, fill them like this:
- `GitHub owner`: your GitHub username or organization name, for example `qq475301610` or `my-team`
- `GitHub repo`: the repository name that stores migration release assets, for example `claw-migration-store`
- `Remote key`: a stable remote slot name used to locate the GitHub release, for example `main-agent` or `momiji`
- `GitHub token`: a Personal Access Token that can access the target repository, create releases, and upload release assets

Recommended preparation:
1. Decide whether migration files should live under your personal GitHub account or a GitHub organization.
2. Create a dedicated repository for migration packages, for example `claw-migration-store`.
3. Make sure the repository is not empty. Add at least one initial commit such as a `README.md`.
4. Create a GitHub token from `GitHub -> Settings -> Developer settings -> Personal access tokens`.
5. Paste the token directly into `claw-migration setup`.

Recommended repository setup:
- use a private repository dedicated to migration assets
- use the same `owner`, `repo`, and `remoteKey` on both devices when they should point at the same remote slot
- do not use a full URL for `owner` or `repo`; use names only

Recommended fine-grained token permissions:
1. Open `Settings -> Developer settings -> Personal access tokens -> Fine-grained tokens`
2. Choose the correct resource owner
3. Under repository access, select only the migration repository
4. Under repository permissions, give `Contents: Read and write`
5. Generate the token and paste it into setup

Common GitHub-side mistakes:
- the repository does not exist yet
- the repository is empty
- the repository is private but the token cannot access it
- `owner` or `repo` was entered as a full URL instead of a name

Typical GitHub config:

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
                "owner": "your-github-user-or-org",
                "repo": "claw-migration-store",
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
- `--remote <name>` selects the local remote entry under `config.remotes`
- `remoteKey` is the stable identifier for the GitHub release slot
- the GitHub token is read from `remotes.<name>.settings.token`
- source and target devices should use the same `remoteKey` when they should share the same remote migration slot

## Migration Workflow

If you did not run `npm link`, replace `claw-migration` below with `node ./bin/claw-migration.js`.

You can run the following steps yourself in a terminal, or let an OpenClaw Agent perform the same workflow through the bundled `claw-migration` skill.

### Device A: Push the source agent

Use this on the device that currently owns the agent state you want to hand off.

```bash
claw-migration preview push --agent main --remote main-agent
claw-migration push --agent main --remote main-agent
```

What `push` does:
- creates a migration package for the selected agent
- uploads or replaces the GitHub release asset for the selected `remoteKey`
- disables the selected agent bindings on the source device when configured
- disables the linked channel account or channel `enabled` flag when supported

### Device B: Pull into the target agent slot

Use this on the destination device after it has been configured with the same GitHub remote.

```bash
claw-migration preview pull --agent main --remote main-agent
claw-migration pull --agent main --remote main-agent --yes
```

What `pull` does:
- downloads the remote package from GitHub Releases
- previews the import before writing anything
- imports the agent config, sessions, and workspace into the selected local agent slot
- re-enables bindings and linked channel state when configured

### Example: move one agent from device A to device B

1. On both devices, install the plugin and run `claw-migration setup`.
2. On device A, configure a remote such as `main-agent` with a stable `remoteKey`.
3. On device B, configure a remote with the same `owner`, `repo`, and `remoteKey`.
4. On device A, run `preview push` and then `push`.
5. On device B, run `preview pull` and then `pull`.

Session history note:
- if you want old session history to remain easy to browse and continue, use the same agent id for both `push --agent` and `pull --agent`
- cross-agent import is supported, but old sessions may not appear under the new target agent as expected

## Command Reference

Available commands:

```bash
claw-migration setup
claw-migration doctor [--openclaw-dir <path>]
claw-migration install-skill [--openclaw-dir <path>]
claw-migration preview push --agent <id> [--remote <name>] [--openclaw-dir <path>] [--notes <text>] [--quiet]
claw-migration push --agent <id> [--remote <name>] [--openclaw-dir <path>] [--notes <text>] [--quiet]
claw-migration preview pull --agent <id> [--remote <name>] [--openclaw-dir <path>] [--quiet]
claw-migration pull --agent <id> [--remote <name>] [--openclaw-dir <path>] [--skip-reindex] [--yes] [--quiet]
claw-migration verify --agent <id> [--remote <name>] [--openclaw-dir <path>] [--input <file>] [--quiet]
```

### setup

`claw-migration setup` opens the interactive configuration wizard.

What it does:
- creates or updates `plugins.entries.claw-migration.config` in `~/.openclaw/openclaw.json`
- lets you choose the remote name, GitHub owner, GitHub repo, and stable `remoteKey`
- stores the GitHub token in plugin config
- sets transfer and gateway behavior flags
- optionally installs the shared skill and enables `skills.entries.claw-migration.enabled = true`

Common parameter:
- `--openclaw-dir <path>`: use a different OpenClaw state directory instead of `~/.openclaw`

### doctor

`claw-migration doctor` checks whether the bundled skill exists and whether a shared install already exists under `~/.openclaw/skills/claw-migration`.

What it does:
- verifies the bundled `skills/claw-migration/SKILL.md` exists
- checks for a shared copy in `~/.openclaw/skills/claw-migration`
- tells you whether you likely need the fallback install command

Parameters:
- `--openclaw-dir <path>`: optional; use a different OpenClaw state directory

### install-skill

`claw-migration install-skill` copies the bundled skill into `~/.openclaw/skills/claw-migration`.

What it does:
- copies only the `claw-migration` skill
- overwrites an existing shared copy when present
- sets `skills.entries.claw-migration.enabled = true` in `openclaw.json`
- prints source path, target path, config path, and whether an existing copy was updated
- recommends opening a new session if the skill does not appear immediately

Parameters:
- `--openclaw-dir <path>`: optional; use a different OpenClaw state directory

### preview push

`claw-migration preview push --agent <id>` builds a preview of what would be exported and uploaded.

What it does:
- validates the selected agent exists
- resolves the configured remote
- builds a migration archive and manifest
- shows which bindings would be disabled
- does not upload or write any state

Parameters:
- `--agent <id>`: required; the agent to export
- `--remote <name>`: optional; override `defaultRemote` for this run
- `--openclaw-dir <path>`: optional; use a different OpenClaw state directory
- `--notes <text>`: optional; attach notes to the generated manifest
- `--quiet`: optional; hide progress output

### push

`claw-migration push --agent <id>` exports the agent and uploads the package to the configured GitHub remote.

What it does:
- creates the migration package
- creates or updates the GitHub release asset matched by `remoteKey`
- records the latest remote package id back into plugin config
- disables the selected agent bindings on the source device if configured
- disables the linked channel account when the channel config supports an `enabled` switch
- does not manually restart the gateway

Parameters:
- `--agent <id>`: required; the agent to export
- `--remote <name>`: optional; override `defaultRemote`
- `--openclaw-dir <path>`: optional; use a different OpenClaw state directory
- `--notes <text>`: optional; attach notes to the pushed manifest
- `--quiet`: optional; hide progress output

### preview pull

`claw-migration preview pull --agent <id>` downloads the remote package and shows what would be imported.

What it does:
- resolves the remote package by `remoteKey`
- downloads and validates the package
- checks required plugins and skills
- shows what config, sessions, and workspace files would be overwritten
- does not write any state

Parameters:
- `--agent <id>`: required; the local agent slot to import into
- `--remote <name>`: optional; override `defaultRemote`
- `--openclaw-dir <path>`: optional; use a different OpenClaw state directory
- `--quiet`: optional; hide progress output

### pull

`claw-migration pull --agent <id>` imports the selected remote package into the target device.

What it does:
- runs the same preview checks internally
- imports config, sessions, and workspace
- re-enables bindings for the selected agent if configured
- re-enables the linked channel account when the channel config supports an `enabled` switch
- does not manually restart the gateway

Parameters:
- `--agent <id>`: required; the local agent slot to import into
- `--remote <name>`: optional; override `defaultRemote`
- `--openclaw-dir <path>`: optional; use a different OpenClaw state directory
- `--skip-reindex`: optional; skip rebuilding the memory index after import
- `--yes`: optional; skip the interactive confirmation prompt and apply the pull immediately after preview checks pass
- `--quiet`: optional; hide progress output

Important note about `--yes`:
- without `--yes`, `pull` first shows a preview and then asks for confirmation
- with `--yes`, `pull` still performs preview validation internally, but it does not stop for confirmation

Important note about agent ids:
- if session continuity matters, keep the `push --agent` and `pull --agent` values the same
- importing one source agent into a different target agent slot is supported, but old session records may not remain directly browsable under the new agent id

### verify

`claw-migration verify --agent <id>` validates a migration package without importing it.

What it does:
- checks required files and checksums
- can verify either the configured remote package or a local zip file
- does not write any state

Parameters:
- `--agent <id>`: required when verifying a remote package; used to validate the target package layout
- `--remote <name>`: optional; override `defaultRemote` for remote verification
- `--openclaw-dir <path>`: optional; use a different OpenClaw state directory
- `--input <file>`: optional; verify a local zip file instead of downloading from the remote
- `--quiet`: optional; hide progress output

### Shared parameter summary

- `--agent <id>`: selects which single agent to export or import
- `--remote <name>`: selects which configured remote under `plugins.entries.claw-migration.config.remotes` to use for this command
- `--openclaw-dir <path>`: points the CLI at a different OpenClaw home directory
- `--notes <text>`: writes human-readable notes into the generated manifest on push
- `--skip-reindex`: skips memory index rebuild after a pull when you want a faster import
- `--input <file>`: tells `verify` to inspect a local package file instead of a GitHub remote
- `--yes`: non-interactive confirmation for `pull`
- `--quiet`: suppresses progress lines such as download and extract stages

## Channel Support

Channel state switching during `push` and `pull` is broader than `qqbot` only.

Supported today:
- official OpenClaw channel-style configs that expose `channels.<channel>.enabled` or `channels.<channel>.accounts.<accountId>.enabled`
- the channel plugin set from `openclaw-china`, including `dingtalk`, `feishu-china`, `qqbot`, `wechat-mp`, `wecom`, `wecom-app`, and `wecom-kf`

When a supported channel account is linked to the migrated agent, `push` can mark that account as disabled on the source device and `pull` can restore it on the target device.

## OpenClaw Skill Usage

The bundled skill lives at [skills/claw-migration/SKILL.md](./skills/claw-migration/SKILL.md).

Skill lookup precedence follows the OpenClaw docs:
- `<workspace>/skills`
- `<workspace>/.agents/skills`
- `~/.agents/skills`
- `~/.openclaw/skills`
- bundled skills

Recommended flow:
1. `openclaw plugins install -l .`
2. `claw-migration setup`
3. If a new session still does not show the skill, run `claw-migration install-skill`

Once the plugin is installed, an Agent can use that skill to:
1. read `plugins.entries.claw-migration.config`
2. run preview before push or pull
3. stop on blockers instead of forcing writes
4. summarize remote, bindings, channel account state, and watcher-driven reload behavior after success

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


