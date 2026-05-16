# PRD: Migrate Pi Subagent to @tintinweb/pi-subagents

## Problem

Current `.pi/extensions/trellis/index.ts` implements custom subagent spawning by manually forking `pi` subprocesses. This causes:

1. **No live progress** — Users see a frozen tool call during long subagent runs, assume it's stuck.
2. **Community conflicts** — Custom implementation clashes with community subagent packages (`nicobailon/pi-subagents`, `tintinweb/pi-subagents`). Users must manually disable them.
3. **Ecosystem isolation** — Cannot integrate with community subagent features (AgentWidget, conversation viewer, steering, scheduling).

## Solution

Replace the custom subagent spawning with `@tintinweb/pi-subagents` integration via **Cross-Extension RPC + Event Bus**.

### Architecture

```
Trellis Extension                          @tintinweb/pi-subagents
┌──────────────────────────────┐          ┌───────────────────────────┐
│ hooks: context injection     │          │ Agent tool (general use)  │
│  - workflow-state breadcrumb │          │ AgentWidget (TUI)         │
│  - session overview          │          │ AgentManager              │
│  - task context              │          │ Custom agent types        │
│                              │          │   trellis-implement       │
│ tool: trellis_subagent       │  RPC     │   trellis-check           │
│  build Trellis context ──────▶ spawn ──▶│   trellis-research        │
│  await event ◀─────────────── completed │ Event bus:                │
│  return result               │          │  subagents:completed      │
└──────────────────────────────┘          │  subagents:failed         │
                                          └───────────────────────────┘
```

### Key Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Integration API | Cross-Extension RPC + Event Bus | Public API, low coupling. The only reason tintinweb was chosen over nicobailon. |
| Tool name | `trellis_subagent` | Avoid collision with `Agent` (tintinweb) and `subagent` (nicobailon). |
| Agent restriction | Only `trellis-implement`, `trellis-check`, `trellis-research` | Schema-level `enum` constraint prevents misuse for non-Trellis agents. |
| Context injection | Into user message (prompt parameter) | No tintinweb changes needed. Context rides the prompt string. |
| Execution mode | Single only (no parallel/chain) | Simplifies implementation; parallel/chain rarely used on Pi. |
| Progress feedback | AgentWidget + event-driven completion | Tintinweb's TUI widget shows live spinner/tool calls. Tool resolve promise on `subagents:completed` / `subagents:failed` event. |

## Scope

### In Scope

1. **settings.json template**
   - Replace `npm:pi-subagents` with `npm:@tintinweb/pi-subagents`
   - Enable extensions (remove empty `extensions: []` → allow defaults)
   - Remove empty `skills`, `prompts`, `themes` arrays

2. **Agent .md files** (`trellis-implement.md`, `trellis-check.md`, `trellis-research.md`)
   - Fix tool names to match actual Pi tool names (`Read` → `read`, `Glob` → `find_files`, `Grep` → `grep`, etc.)
   - Add `display_name` frontmatter for tintinweb UI
   - Update `trellis-research.md` to find task directory from context instead of calling `task.py current`

3. **Trellis extension rewrite** (`extensions/trellis/index.ts.txt`)
   - **REMOVE**: All manual subprocess code (~400 lines):
     - `runPi`, `runSubagent`, `BoundedBufferCollector`, `resolvePiInvocation`, `candidatePiCliJsPaths`
     - `buildPiModelArgs`, `resolveSubagentRunConfig`, `readAgentDefinition`, `buildSubagentPrompt`
     - `shellQuote`, `injectTrellisContextIntoBash`, `formatPiOutput`, `extractFinalAssistantText`
     - `commandStartsWithTrellisContext`
   - **KEEP**: Context injection hooks (`before_agent_start`, `input`, `context`, `session_start`, `tool_call`)
   - **KEEP**: Workflow-state breadcrumb, session overview, `TurnContextCache`
   - **KEEP**: `buildTrellisContext`, `readCurrentTask`, `resolveContextKey`, `normalizeAgentName`
   - **REWRITE**: `subagent` → `trellis_subagent` tool
     - Schema: `agent` with `enum` constraint, `prompt` (required), `model`, `thinking`
     - Execute: build context → RPC spawn → await `subagents:completed/failed` event → return result

4. **Spec update** (`platform-integration.md`)
   - Update "Scenario: Pi Sub-Agent Launcher" to reflect RPC-based approach
   - Document the `trellis_subagent` tool contract
   - Remove obsolete subprocess contracts

### Out of Scope

- Parallel/chain execution modes
- Model/thinking resolution from agent frontmatter (defer to tintinweb's agent config)
- `injectTrellisContextIntoBash` (bash context injection — keep as-is, unrelated to subagents)
- Scheduled subagents
- Worktree isolation
- Agent steering/resume

## Acceptance Criteria

1. `trellis_subagent` tool spawns `trellis-implement`, `trellis-check`, or `trellis-research` via tintinweb RPC
2. AgentWidget shows live progress (spinner, tool calls, tokens) during execution
3. Tool resolves with subagent output when `subagents:completed` event fires
4. Tool returns error when `subagents:failed` event fires
5. Agent .md files have correct lowercase Pi tool names
6. `settings.json` template references `@tintinweb/pi-subagents` with extensions enabled
7. Other Pi extension hooks (context injection, workflow-state, session overview) continue to work
8. `pnpm lint && pnpm typecheck` passes
9. Platform integration spec updated

## Non-Goals

- Replicating tintinweb's Agent tool features (steering, scheduling, resume, worktree)
- Supporting parallel/chain modes in `trellis_subagent`
- Auto-disabling other subagent packages (docs-only recommendation)
