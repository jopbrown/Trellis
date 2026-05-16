# PRD: Verify Pi Subagent Tintinweb Migration

## Problem

PRD `.trellis/tasks/archive/2026-05/05-16-pi-subagent-tintinweb-migration/prd.md` was implemented but never smoke-tested in a real Pi session. Need end-to-end verification that `trellis_subagent` tool works via Cross-Extension RPC with `@tintinweb/pi-subagents`.

## Verification Steps

1. **Build**: `pnpm build` in Trellis repo
2. **Link globally**: `npm link` so `trellis` CLI is available system-wide
3. **Create test repo**: `mkdir -p /tmp/test-pi-subagent-verify && cd /tmp/test-pi-subagent-verify`
4. **Init Trellis with Pi**: `trellis init --pi -y -f --overwrite -u testing`
5. **Create test task**: `python3 ./.trellis/scripts/task.py create "Test Subagent" --slug test-subagent`
6. **Create README.md**: Write a simple README as test target
7. **Run Pi**: Start pi in the test repo, invoke `trellis_subagent({ agent: "trellis-implement", prompt: "Read README.md and summarize its content in one sentence." })`
8. **Verify**: Check that AgentWidget shows live progress and tool returns subagent output

## Acceptance Criteria

### Core RPC (verified ✅)
1. ~~`pnpm build` succeeds with no errors~~ ✅
2. ~~`npm link` installs trellis CLI globally~~ ✅
3. ~~`trellis init --pi` creates valid `.pi/` extensions and agent configs~~ ✅
4. ~~`trellis_subagent` tool is registered and invocable from Pi~~ ✅
5. ~~Subagent spawns via tintinweb RPC~~ ✅
6. ~~Tool resolves with subagent output text~~ ✅
7. ~~No subprocess forking fallback — RPC path is exercised~~ ✅

### Bug Found & Fixed
- **Root cause**: `rpcSpawn()` did not pass `isBackground: true`. tintinweb's `onComplete` callback only fires for background agents, so `subagents:completed` / `subagents:failed` events never emitted, `waitForAgentCompletion()` hung forever.
- **Fix**: Added `isBackground: true` + `description` to RPC spawn options.
- **Commit**: `fix(pi): pass isBackground=true in trellis_subagent RPC spawn`

### Additional Verification (completed ✅)

8. **Context injection** ✅ — Subagent received task directory path, workflow-state breadcrumb, and prd.md content in its injected context.

9. **Agent enum constraint** ✅ — `trellis_subagent` rejects `general-purpose` (schema-level enum validation). Only `trellis-implement`, `trellis-check`, `trellis-research` accepted.

10. **Non-Trellis agent routing** ✅ — `Agent` tool spawns `general-purpose` subagent, executes bash, writes file. Non-Trellis agents route correctly through tintinweb's Agent tool.

### Context Isolation (verified ✅)

11. **Subagent context isolation** ✅ — Subagent confirmed "NO_CONTEXT" when asked about parent conversation secrets. Trellis subagents start with clean context (only injected task context + delegated prompt). No parent conversation leak.

12. **Parent receives subagent output** ✅ — `trellis_subagent` tool resolves with subagent's completion text. Parent agent can read, relay, or act on the result.

## Scope

Lightweight verification + one-line bug fix. All 12 acceptance criteria verified.

## Out of Scope

- Parallel/chain execution modes
- Model/thinking parameter testing
- Steering/resume
- Multi-platform testing
- AgentWidget TUI visibility (only testable in interactive mode)
