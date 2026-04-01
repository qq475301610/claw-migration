# Claw Migration

`claw-migration` is an OpenClaw-oriented plugin package that ships a migration CLI plus skills. It is built around remote-backed `push`/`pull` workflows configured from `openclaw.json`.

## Install shape

This plugin is intended to be packaged like an OpenClaw plugin bundle:

- CLI tool: `claw-migration`
- Skills: `skills/claw-migration/SKILL.md`
- Flake export: `openclawPlugin`

The included [flake.nix](/D:/workspace/my/claw-migration/plugins/claw-migration/flake.nix) exposes a `claw-migration-cli` package and an `openclawPlugin` definition.

## `openclaw.json` configuration

Configure the plugin under `plugins.entries.claw-migration.config`.

```json
{
  "plugins": {
    "entries": {
      "claw-migration": {
        "enabled": true,
        "config": {
          "defaultRemote": "primary",
          "remotes": {
            "primary": {
              "provider": "github",
              "settings": {
                "gistId": "YOUR_SHARED_GIST_ID"
              }
            },
            "backup-webdav": {
              "provider": "webdav",
              "settings": {
                "baseUrl": "https://dav.example.com/openclaw/"
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

Notes:
- v1 only implements the `github` provider.
- GitHub auth is read from `OPENCLAW_GITHUB_TOKEN`, `GITHUB_TOKEN`, or `GH_TOKEN`.
- `webdav` is a reserved config shape for future support and currently blocks preview/push/pull.

### Recommended GitHub config

For v1, the intended remote is a private GitHub Gist. A practical starting point is:

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

Behavior details:
- On the first successful `push`, the plugin creates a private gist and writes the returned `gistId` back into `openclaw.json`.
- After that, the same remote updates the same gist on subsequent `push` runs.
- `pull` expects `gistId` to already be present for the selected remote.
- The plugin only disables or re-enables bindings for the selected agent. It does not disable an entire channel account.

## CLI

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

## Workflow semantics

- `preview push`: validates local agent state, remote config, package creation, bindings that will be disabled, and whether gateway restart will happen.
- `push`: uploads the package, disables current agent bindings if configured, then restarts gateway if configured.
- `preview pull`: downloads the remote package, previews import impact, and reports bindings/gateway actions without writing.
- `pull`: imports the package, enables current agent bindings if configured, then restarts gateway if configured.
- `verify`: validates manifest/checksum for a local file or for the configured remote package.

## GitHub setup

1. Create a GitHub token that can create and update private gists.
2. Export one of these environment variables before using the CLI:
   - `OPENCLAW_GITHUB_TOKEN`
   - `GITHUB_TOKEN`
   - `GH_TOKEN`
3. Add the plugin config block shown above to the device's `openclaw.json`.
4. Run `claw-migration preview push --agent <id>` before the first real `push`.

## Device workflow

### Source device

This is the device currently owning the active agent state.

1. Confirm `plugins.entries.claw-migration.config` exists and points at the GitHub remote.
2. Export the GitHub token into the environment.
3. Run:
   ```bash
   claw-migration preview push --agent main
   claw-migration push --agent main
   ```
4. On success:
   - the migration package is uploaded to a private gist
   - the selected agent's bindings are disabled if configured
   - gateway is restarted if configured
   - `gistId` is persisted into `openclaw.json` if this was the first push

### Target device

This is the device that will take over the agent.

1. Copy or recreate the same `claw-migration` plugin config block in its `openclaw.json`.
2. Ensure the selected remote already has the correct `gistId`.
3. Export the same GitHub token into the environment.
4. Run:
   ```bash
   claw-migration preview pull --agent main
   claw-migration pull --agent main --yes
   ```
5. On success:
   - the remote package is downloaded
   - agent config, sessions, and workspace are imported
   - the selected agent's bindings are re-enabled if configured
   - gateway is restarted if configured

### Recommended handoff sequence

If you want the safest single-agent handoff:

1. Run `preview push` on the source device.
2. Run `push` on the source device.
3. Confirm the source device bindings are disabled.
4. Run `preview pull` on the target device.
5. Run `pull --yes` on the target device.
6. Confirm the target device bindings are enabled and gateway restarted cleanly.

## Skills

The plugin skill is at [skills/claw-migration/SKILL.md](/D:/workspace/my/claw-migration/plugins/claw-migration/skills/claw-migration/SKILL.md). It is written so an Agent will:

1. Read plugin config from `openclaw.json`
2. Run `preview` before `push` or `pull`
3. Stop and report blockers instead of forcing a write
4. Summarize remote, bindings, and gateway actions after success

## Tests

```bash
npm test --prefix plugins/claw-migration
```

## Additional guide

There is also a GitHub-focused operator guide at [docs/github-provider-guide.md](/D:/workspace/my/claw-migration/plugins/claw-migration/docs/github-provider-guide.md).
