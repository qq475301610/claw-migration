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
   - gateway restart settings
3. Prefer `claw-migration preview push` or `claw-migration preview pull` before any write operation.
4. If preview reports blockers, stop and summarize blockers clearly.
5. Only run `claw-migration push` or `claw-migration pull` after a clean preview or explicit user instruction.
6. After success, summarize:
   - agent id
   - remote used
   - whether bindings were disabled/enabled
   - whether gateway was restarted

## Commands

```bash
claw-migration preview push --agent <agentId> [--remote <name>]
claw-migration push --agent <agentId> [--remote <name>]
claw-migration preview pull --agent <agentId> [--remote <name>]
claw-migration pull --agent <agentId> [--remote <name>] --yes
claw-migration verify --agent <agentId> [--remote <name>]
```

## Notes

- This skill may be available either from the plugin bundle or from a shared install at `~/.openclaw/skills/claw-migration`.
- `push` uploads a complete migration package, then may disable the current agent's bindings and linked channel account state.
- `pull` downloads and imports a complete migration package, then may enable bindings and restore linked channel account state.
- The plugin only switches bindings for the specified agent. It does not shut down an entire channel or account.
- In v1, `github` is the only implemented remote provider. `webdav` config may exist but will block execution until implemented.

