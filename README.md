# Claw Migration

[English](./README.md) | [简体中文](./README.zh-CN.md)

`claw-migration` is an OpenClaw plugin and CLI for moving one agent from one device to another.

It packages the selected agent's config, sessions, and workspace, uploads that package to GitHub, and then lets the target device pull it back with a preview-first workflow. After a successful handoff, it can disable bindings on the source device, disable the linked channel account when supported, and enable them again on the target device.

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
claw-migration doctor
```

This command will guide you through:
- choosing a remote name
- entering a GitHub owner
- entering a GitHub repo
- setting a stable `remoteKey`
- entering your GitHub token directly into `openclaw.json`
- deciding whether to include transcripts
- deciding whether push/pull should switch bindings

After setup, `claw-migration doctor` checks whether the bundled skill is present and whether a shared copy already exists under `~/.openclaw/skills/claw-migration`. Configure `owner` and `repo` so GitHub uploads go to a dedicated release-storage repository.

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

### GitHub fields explained

When `claw-migration setup` asks for GitHub fields, use these values:
- `GitHub owner`: your GitHub username or organization name. Example: `qq475301610` or `my-team`.
- `GitHub repo`: the repository name that stores migration release assets. Example: `claw-migration-store`.
- `GitHub token`: a Personal Access Token that can create releases and upload release assets in that repository.

How to prepare them:
1. Decide whether migration files should live under your personal account or a GitHub organization.
2. Create a dedicated repository for migration packages, for example `claw-migration-store`.
3. Use the account name or organization name as `owner`.
4. Use the repository name as `repo`.
5. Create a token from `GitHub -> Settings -> Developer settings -> Personal access tokens` and paste it into setup.

Recommended repository setup:
- create a private repository just for migration assets
- do not use the plugin source repository itself unless you explicitly want migration zips stored there
- the repository must not be empty; create at least one initial commit such as a `README.md`
- use the same `owner` and `repo` on both source and target devices

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
- `remoteKey` is the primary stable identifier for a GitHub remote
- `releaseId` is an internal cache and may be written automatically after push or pull
- users should configure and remember `remoteKey`; they do not need to manage `releaseId` manually
- the GitHub token can be stored directly in `remotes.<name>.settings.token`
- GitHub token is read from `remotes.<name>.settings.token` only

### `remoteKey` vs `releaseId`

These two fields are intentionally different:
- `remoteKey`: human-controlled stable key, shared across devices, used to find the same migration slot every time
- `releaseId`: GitHub's internal numeric id for a specific release, used only as a local cache

In practice:
- source and target devices should use the same `remoteKey`
- if `releaseId` is missing, the plugin can still find the correct GitHub release by `remoteKey`
- if `releaseId` changes or is lost, you normally do not need to fix anything manually

## GitHub Token And Permissions

Recommended path:
- run `claw-migration setup`
- paste your token when prompted
- let the plugin write it into `openclaw.json`


Where to get `owner`, `repo`, and `token`:
1. Open the GitHub account or organization that will store migration files.
2. Create a repository for migration assets, for example `claw-migration-store`.
3. Copy the account or organization name as `owner`.
4. Copy the repository name as `repo`.
5. Go to `Settings -> Developer settings -> Personal access tokens` and create a token for that account.

Required token behavior:
- the token must be able to access the configured repository
- the token must be able to create releases
- the token must be able to upload and replace release assets
- for private repositories, lack of permission may appear as GitHub `404 Not Found`

Recommended fine-grained token setup:
1. Open `Settings -> Developer settings -> Personal access tokens -> Fine-grained tokens`
2. Choose the correct resource owner
3. Under repository access, select only the migration repository, for example `claw-migration-store`
4. Under repository permissions, give `Contents: Read and write`
5. Generate the token and paste it into setup

If you prefer a classic token, it must have enough repository access to create releases and upload assets in the target repository.

Common GitHub-side setup mistakes:
- the repository does not exist yet
- `owner` is correct but `repo` is wrong
- the repository is private but the token cannot access it
- the repository is empty; GitHub releases require at least one commit in the repository
- `owner` or `repo` was entered as a full URL instead of a name

GitHub docs:
- [Managing your personal access tokens](https://docs.github.com/github/extending-github/git-automation-with-oauth-tokens)
- [Permissions required for fine-grained personal access tokens](https://docs.github.com/en/rest/authentication/permissions-required-for-fine-grained-personal-access-tokens)
- [About releases](https://docs.github.com/en/repositories/releasing-projects-on-github/about-releases)

## Quick Usage

If you did not run `npm link`, replace `claw-migration` below with `node ./bin/claw-migration.js`.

### Source device

```bash
openclaw plugins install -l .
claw-migration setup
claw-migration doctor
claw-migration install-skill   # run this only if a new session still does not show the skill
claw-migration preview push --agent main
claw-migration push --agent main
```

What happens after a successful `push`:
- a GitHub release asset is created or updated for the configured `remoteKey`
- the selected agent's bindings are disabled if configured
- the linked channel account is disabled when the channel config supports an `enabled` switch
- `releaseId` is cached back into `openclaw.json`
- the plugin does not manually restart the gateway

### Target device

Before `pull`, make sure the target device has:
- the plugin installed with `openclaw plugins install -l .`
- the same `owner`, `repo`, and `remoteKey` configured through `claw-migration setup`
- a GitHub token configured in `openclaw.json`
- if a new session still does not show the skill, install the shared fallback with `claw-migration install-skill`

Then run:

```bash
claw-migration preview pull --agent main
claw-migration pull --agent main --yes
```

What happens after a successful `pull`:
- the remote package is downloaded
- the agent config, sessions, and workspace are imported
- the selected agent's bindings are re-enabled if configured
- the linked channel account is re-enabled when the channel config supports an `enabled` switch
- the plugin does not manually restart the gateway

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
- prints source path, target path, and whether an existing copy was updated
- recommends opening a new session if the skill does not appear immediately

Parameters:
- `--openclaw-dir <path>`: optional; use a different OpenClaw state directory

### preview push

`claw-migration preview push --agent <id>` builds a preview of what would be exported and uploaded.

What it does:
- validates the selected agent exists
- resolves the configured remote
- builds a migration archive and manifest
- shows which bindings would be disabled and whether gateway restart would happen
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
- records the latest release id back into plugin config
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
- resolves the remote package by `remoteKey` or cached `releaseId`
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
4. summarize remote, bindings, channel account state, and gateway actions after success

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
