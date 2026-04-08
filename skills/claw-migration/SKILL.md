---
name: claw-migration
description: Migrate a single OpenClaw agent between devices through a configured remote with preview-first push and pull workflows.
---

# Claw Migration Skill

Use this skill when the user wants to move a single OpenClaw agent between devices through a configured remote, or wants help previewing why such a migration will or will not work.

## When to use

Use this skill for requests like:
- "push my main agent to GitHub"
- "pull the latest migration package onto this device"
- "preview what a push or pull would change"
- "verify that my migration remote is configured correctly"

Do not use this skill for generic backup requests or for editing unrelated OpenClaw settings.

## Required workflow

1. Read `~/.openclaw/openclaw.json` or the user-specified OpenClaw directory.
2. Look under `plugins.entries.claw-migration.config` for:
   - `defaultRemote`
   - `remotes`
   - transfer settings
   - binding switch settings
3. Treat `--remote <name>` as the local remote name under `config.remotes`. Do not confuse it with the remote slot itself.
4. Treat `settings.remoteKey` as the remote slot identifier used on GitHub Releases.
5. Prefer `claw-migration preview push` or `claw-migration preview pull` before any write operation.
6. If preview reports blockers, stop and summarize blockers clearly.
7. If preview reports warnings only, summarize the warnings and ask for confirmation before any write operation unless the user already gave explicit approval.
8. Only run `claw-migration push` or `claw-migration pull` after a clean preview or explicit user instruction.
9. After success, summarize the fixed output items listed below.

## Decision rules

- If the user does not specify `--remote`, use `defaultRemote`.
- If the user mentions a GitHub slot such as `momiji`, confirm whether they mean the local remote name or the remote slot stored in `settings.remoteKey`.
- If the user wants to move remote agent `momiji` into local agent `main`, use the remote that points to `remoteKey = momiji`, but still set `--agent main` for the local target slot.
- If `push --agent` and `pull --agent` differ, warn that old session history may not remain directly readable under the new agent id.
- If preview shows missing plugins that will be skipped, tell the user which config will be skipped before continuing.

## Commands

```bash
claw-migration preview push --agent <agentId> [--remote <name>]
claw-migration push --agent <agentId> [--remote <name>]
claw-migration preview pull --agent <agentId> [--remote <name>]
claw-migration pull --agent <agentId> [--remote <name>] --yes
claw-migration verify --agent <agentId> [--remote <name>]
```

## Success summary requirements

After `push`, summarize:
- source agent id
- remote name
- remoteKey when available
- which bindings were disabled
- which linked channel accounts or channel flags were disabled
- any warnings about skipped config or watcher-driven reload behavior

After `pull`, summarize:
- source agent id from the package
- target agent id on this device
- remote name
- remoteKey when available
- which bindings were enabled
- which linked channel accounts or channel flags were restored
- any warnings about skipped plugin config, memory index rebuild, or watcher-driven reload behavior

## Notes

- This skill may be available either from the plugin bundle or from a shared install at `~/.openclaw/skills/claw-migration`.
- `push` uploads a complete migration package, then may disable the current agent's bindings and linked channel account state.
- `pull` downloads and imports a complete migration package, then may enable bindings and restore linked channel account state.
- OpenClaw's own config watcher is expected to notice `openclaw.json` changes when gateway is already running; this plugin no longer relies on manually calling `openclaw gateway restart`.
- `pull` can import one source agent into a different target agent slot, but old session history may not remain directly readable unless the source and target agent ids match.
- For `openclaw-china` account-scoped channels, restore only the channel/account referenced by the selected agent's bindings. Conflicting root-level legacy credentials left by setup flows are cleaned up for that channel while root control fields such as `enabled` are preserved.
- The plugin only switches bindings for the specified agent. It does not shut down an entire channel or account.
- In v1, `github` is the only implemented remote provider. `webdav` config may exist but will block execution until implemented.
