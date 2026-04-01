# Claw Migration

[English](./README.md) | [简体中文](./README.zh-CN.md)

`claw-migration` is an OpenClaw plugin package for moving a single agent between devices through a remote package store.

It is designed for a handoff workflow like this:
- On the source device, `push` the current agent state to GitHub
- Automatically disable that agent's bindings on the source device
- On the target device, `pull` the package from GitHub
- Automatically restore the agent, re-enable bindings, and restart gateway

## What It Does

This project solves the “move one OpenClaw agent to another device without manually copying state” problem.

Core capabilities:
- Packages one agent's config, sessions, and workspace into a migration zip
- Stores the migration package in a private GitHub Gist
- Supports preview-first `push` / `pull` workflows
- Automatically switches bindings for the selected agent
- Restarts gateway after handoff when configured
- Provides both a CLI and a skill for Agent-driven operation

Current scope:
- Single-agent migration only
- GitHub provider implemented
- WebDAV reserved for future support
- Complete migration package, not a sanitized sharing bundle

## Quick Start

### 1. Install and prepare

This repository is structured like an OpenClaw plugin bundle:
- CLI tool: `claw-migration`
- Skill: `skills/claw-migration/SKILL.md`
- Flake export: `openclawPlugin`

The included [flake.nix](/D:/workspace/my/claw-migration/flake.nix) exports both `claw-migration-cli` and `openclawPlugin`.

### 2. Configure `openclaw.json`

Add the plugin config under `plugins.entries.claw-migration.config`.

Recommended v1 GitHub config:

```json
{
  "plugins": {
    "entries": {
      "claw-migration": {
        "enabled": true,
        "config": {
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
      }
    }
  }
}
```

Important notes:
- v1 only implements the `github` provider
- GitHub auth is read from `OPENCLAW_GITHUB_TOKEN`, `GITHUB_TOKEN`, or `GH_TOKEN`
- On the first successful `push`, the plugin creates a private gist and writes the returned `gistId` back into `openclaw.json`
- Later `push` runs update the same gist
- `pull` requires `gistId` to already exist for the selected remote

### 3. Export a GitHub token

Before using the CLI, export one of:
- `OPENCLAW_GITHUB_TOKEN`
- `GITHUB_TOKEN`
- `GH_TOKEN`

The token should be able to create and update private gists.

### 4. Run the workflow

Source device:

```bash
claw-migration preview push --agent main
claw-migration push --agent main
```

Target device:

```bash
claw-migration preview pull --agent main
claw-migration pull --agent main --yes
```

## Installation

The project is intended to be consumed as an OpenClaw plugin package, but the core user-facing entrypoint is the `claw-migration` CLI.

Repository structure:
- [package.json](/D:/workspace/my/claw-migration/package.json)
- [flake.nix](/D:/workspace/my/claw-migration/flake.nix)
- [skills/claw-migration/SKILL.md](/D:/workspace/my/claw-migration/skills/claw-migration/SKILL.md)
- [.codex-plugin/plugin.json](/D:/workspace/my/claw-migration/.codex-plugin/plugin.json)

## Usage

### CLI commands

```bash
claw-migration preview push --agent main
claw-migration push --agent main
claw-migration preview pull --agent main
claw-migration pull --agent main --yes
claw-migration verify --agent main
```

Common flags:
- `--remote <name>`: override `defaultRemote`
- `--openclaw-dir <path>`: override `~/.openclaw`
- `--skip-reindex`: skip memory index rebuild after `pull`
- `--notes <text>`: attach notes to pushed manifests
- `--input <file>`: verify a local zip instead of a remote package

### What each command means

- `preview push`: validate local agent state, remote config, package creation, binding disable action, and gateway restart plan
- `push`: upload the migration package, disable bindings for the selected agent if configured, then restart gateway if configured
- `preview pull`: download the remote package, preview import impact, and show binding/gateway actions without writing
- `pull`: import the remote package, re-enable bindings for the selected agent if configured, then restart gateway if configured
- `verify`: validate manifest and checksum for a local zip or configured remote package

### Source and target device workflow

#### Source device

Use this on the device that currently owns the active agent state.

1. Confirm `plugins.entries.claw-migration.config` points to the intended GitHub remote
2. Export the GitHub token
3. Run:
   ```bash
   claw-migration preview push --agent main
   claw-migration push --agent main
   ```
4. After success:
   - the package is uploaded to a private gist
   - the selected agent's bindings are disabled if configured
   - gateway is restarted if configured
   - `gistId` is persisted into `openclaw.json` on the first push

#### Target device

Use this on the device that will take over the agent.

1. Copy or recreate the same plugin config block in `openclaw.json`
2. Ensure the selected remote already has the correct `gistId`
3. Export the same GitHub token
4. Run:
   ```bash
   claw-migration preview pull --agent main
   claw-migration pull --agent main --yes
   ```
5. After success:
   - the remote package is downloaded
   - agent config, sessions, and workspace are imported
   - the selected agent's bindings are re-enabled if configured
   - gateway is restarted if configured

#### Recommended handoff order

1. Run `preview push` on the source device
2. Run `push` on the source device
3. Confirm the source device bindings are disabled
4. Run `preview pull` on the target device
5. Run `pull --yes` on the target device
6. Confirm the target device bindings are enabled and gateway restarted cleanly

## Skill Usage

The plugin skill is at [skills/claw-migration/SKILL.md](/D:/workspace/my/claw-migration/skills/claw-migration/SKILL.md).

The skill is written so an Agent will:
1. Read plugin config from `openclaw.json`
2. Run `preview` before `push` or `pull`
3. Stop and report blockers instead of forcing a write
4. Summarize remote, bindings, and gateway actions after success

## Testing

```bash
npm test
```

## More Documentation

- GitHub provider guide: [docs/github-provider-guide.md](/D:/workspace/my/claw-migration/docs/github-provider-guide.md)
