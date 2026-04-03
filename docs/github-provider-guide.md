# GitHub Release Provider Guide

This guide focuses on the v1 `github` remote for `claw-migration`.

## What the GitHub provider does

- Stores one complete migration package as a GitHub release asset
- Uses a stable `remoteKey` to identify the same remote package across devices
- Maps each `remoteKey` to a stable release tag
- Creates the release on first `push`
- Reuses and updates the same release asset on later `push` runs
- Downloads that release asset for `preview pull`, `pull`, and remote `verify`

The package remains a complete zip bundle. The provider only decides where that bundle is stored.

## Required config

Typical GitHub config:

```json
{
  "defaultRemote": "github-main",
  "remotes": {
    "github-main": {
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
```

Meaning of the key fields:
- `defaultRemote`: the remote used when `--remote` is omitted
- `provider`: `github` for the currently implemented provider
- `settings.owner`: GitHub owner or organization name
- `settings.repo`: repository that stores migration release assets
- `settings.remoteKey`: stable identifier shared by source and target devices
- `settings.releaseId`: internal cache written back automatically after a successful push or pull
- `settings.token`: the preferred place to store the GitHub token for this remote
- `includeTranscripts`: whether `*.jsonl` transcript files are packed
- `switchBindingsOnPush`: whether source-device bindings are disabled after push
- `switchBindingsOnPull`: whether target-device bindings are enabled after pull

## How to choose `owner`, `repo`, and `remoteKey`

Recommended setup:
1. Create a dedicated repository for migration packages, for example `claw-migration-store`
2. Use your GitHub username or organization name as `owner`
3. Use the migration repository name as `repo`
4. Use the same `owner` and `repo` on both devices
5. Pick one stable `remoteKey` per migration slot or agent handoff lane

Examples:
- `owner = qq475301610`
- `repo = claw-migration-store`
- `remoteKey = main`

Do not use:
- full URLs as `owner`
- `owner/repo` combined into the `repo` field
- different `remoteKey` values on source and target when you want them to use the same remote package

## Authentication and permissions

Preferred path:
- run `claw-migration setup`
- enter `owner`, `repo`, and the GitHub token when prompted
- let the plugin save them to `remotes.<name>.settings`


The token must be able to:
- access the configured repository
- create releases
- upload release assets
- replace older release assets

Recommended fine-grained token setup:
1. Open `Settings -> Developer settings -> Personal access tokens -> Fine-grained tokens`
2. Choose the correct resource owner
3. Under repository access, select only the migration repository
4. Under repository permissions, give `Contents: Read and write`
5. Generate the token and paste it into setup

For private repositories:
- insufficient permission may appear as GitHub `404 Not Found`
- if release creation fails with `Repository is empty`, create at least one initial commit such as `README.md`

## Release mapping

For each configured `remoteKey`, the provider builds a stable GitHub release tag:

```text
claw-migration-<remoteKey>
```

Examples:
- `main` -> `claw-migration-main`
- `marie-bot` -> `claw-migration-marie-bot`

That means repeated `push` calls for the same `remoteKey` update the same release instead of creating a new remote object every time.

`releaseId` is only a cache:
- you should configure and remember `remoteKey`
- you normally do not need to manage `releaseId` manually
- if `releaseId` is missing, the provider can still find the release by `remoteKey`

## First push

On the first source-device upload:

1. `claw-migration setup`
2. `claw-migration preview push --agent <id>`
3. `claw-migration push --agent <id>`

Expected result:
- the release for that `remoteKey` is created if it does not already exist
- the zip package is uploaded as the release asset
- the returned `releaseId` is written back into `openclaw.json` as cache
- the current agent's bindings are disabled if configured
- linked channel account state is disabled when supported by that channel config

## Pull on the target device

Before pulling on the target device:

1. Install the plugin locally with `openclaw plugins install -l .`
2. Run `claw-migration setup`
3. Ensure the target remote uses the same `owner`, `repo`, and `remoteKey`
4. Configure the GitHub token in setup so it is stored in `remotes.<name>.settings.token`

Then run:

```bash
claw-migration preview pull --agent <id>
claw-migration pull --agent <id> --yes
```

Expected result:
- the release asset is downloaded
- the agent is imported into local OpenClaw state
- that agent's bindings are re-enabled if configured
- linked channel account state is restored when supported by that channel config

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
- Missing `owner` or `repo`: preview and execution block
- Missing both `remoteKey` and `releaseId`: preview and execution block
- Private repository without token access: GitHub may return `404`
- Empty target repository: GitHub may return `422 Repository is empty`
- Missing required plugins or skills on target: `preview pull` reports blockers and `pull` refuses to continue
- Missing agent on source: `preview push` and `push` block before package creation
