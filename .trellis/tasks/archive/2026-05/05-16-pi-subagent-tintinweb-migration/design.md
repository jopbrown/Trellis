# Design: Pi Subagent Tintinweb Migration

## Component View

### Before

```
trellis/index.ts (~700 lines)
├── Context injection hooks (keep)
├── SUBAGENT_DISPATCH_PROTOCOL
├── subagent tool (rewrite)
│   ├── Schema params
│   └── execute → runSubagent → runPi → spawn("pi", ...)
├── Manual subprocess management (~400 lines, delete)
│   ├── resolvePiInvocation, candidatePiCliJsPaths
│   ├── BoundedBufferCollector
│   ├── buildPiModelArgs, resolveSubagentRunConfig
│   ├── readAgentDefinition, buildSubagentPrompt
│   └── formatPiOutput, extractFinalAssistantText
└── Bash context injection (keep)
```

### After

```
trellis/index.ts (~350 lines)
├── Context injection hooks (keep)
├── trellis_subagent tool (new)
│   ├── Schema: agent(enum), prompt, model?, thinking?
│   └── execute:
│       1. validate agent in VALID_AGENTS set
│       2. buildTrellisContext() → inject into prompt
│       3. pi.events.emit("subagents:rpc:spawn", { type, prompt })
│       4. await first matching subagents:completed/failed event
│       5. return result text or error
└── Bash context injection (keep)
```

## Data Flow: trellis_subagent.execute()

```
AI calls: trellis_subagent({ agent: "trellis-implement", prompt: "Fix the bug" })
  │
  ▼
validate: agent ∈ {"trellis-implement", "trellis-check", "trellis-research"}
  │
  ▼
buildTrellisContext(projectRoot, agent, input, ctx, contextKey)
  → reads PRD, design, implement, jsonl files
  → returns formatted context string
  │
  ▼
RPC spawn:
  pi.events.emit("subagents:rpc:spawn", {
    requestId: uuid,
    type: "trellis-implement",
    prompt: context + "\n\n## Delegated Task\n" + input.prompt
  })
  │
  ▼
await Promise: listen for reply event
  pi.events.on("subagents:rpc:spawn:reply:<requestId>", ...)
  → extract agent ID from reply.data.id
  │
  ▼
await Promise: listen for completion/failure
  pi.events.on("subagents:completed", filter by id)
  pi.events.on("subagents:failed", filter by id)
  │
  ▼
return {
  content: [{ type: "text", text: result }],
  details: { agent, agentId, status }
}
```

## RPC Protocol

### Spawn Request

```typescript
// Emit
pi.events.emit("subagents:rpc:spawn", {
  requestId: "uuid",
  type: "trellis-implement",
  prompt: "Full prompt with Trellis context + delegated task",
  options?: {
    model?: "provider/modelId",  // optional string, resolved by tintinweb
  }
});

// Reply (on "subagents:rpc:spawn:reply:<requestId>")
{ success: true, data: { id: "agent-uuid" } }
// or
{ success: false, error: "Error message" }
```

### Completion Event

```typescript
// Tintinweb emits on agent completion
pi.events.emit("subagents:completed", {
  id: "agent-uuid",
  type: "trellis-implement",
  description: "...",
  result: "Full agent output text",
  status: "completed",
  toolUses: 5,
  durationMs: 12345,
  tokens: { input: 1000, output: 500, total: 1500 }
});
```

### Failure Event

```typescript
pi.events.emit("subagents:failed", {
  id: "agent-uuid",
  type: "trellis-implement",
  description: "...",
  error: "Error message",
  status: "error",
  ...
});
```

## Agent Definition Changes

### Tool Name Mapping

| Old (Trellis) | New (Pi actual) |
|---------------|-----------------|
| `Read` | `read` |
| `Write` | `write` |
| `Edit` | `edit` |
| `Bash` | `bash` |
| `Glob` | Not available → `find_files` |
| `Grep` | `grep` |

### Frontmatter Additions

Each agent .md file adds:
- `display_name` — human-readable name for tintinweb UI
- `prompt_mode: replace` — explicit (default behavior, but good to be explicit)

### trellis-research.md Changes

```diff
- 1. Resolve the active task with `python3 ./.trellis/scripts/task.py current --source`.
+ 1. Find the task directory from the Trellis Task Context in the user message.
```

## settings.json Template Changes

```diff
  "packages": [
    {
-     "source": "npm:pi-subagents",
-     "extensions": [],
-     "skills": [],
-     "prompts": [],
-     "themes": []
+     "source": "npm:@tintinweb/pi-subagents"
    }
  ]
```

Removing empty resource arrays lets tintinweb's defaults load. The package's extensions (Agent tool, widget, commands) become active.

## Error Handling

| Scenario | Behavior |
|----------|----------|
| RPC spawn returns `success: false` | Tool returns error text |
| `subagents:failed` event received | Tool returns error text with failure details |
| Timeout (5 min default) | Tool returns timeout error |
| AbortSignal fires | Tool returns "cancelled" |
| Tintinweb not loaded (`subagents:ready` not received after 5s) | Tool returns "subagents extension not available" |
| Invalid agent name (runtime guard) | Tool returns "Unknown agent: X. Use Agent tool for non-Trellis agents." |

## Migration Impact

### Breaking Changes

- `subagent` tool renamed to `trellis_subagent`
- `mode` parameter removed (single only)
- `prompts` parameter removed
- `promptSnippet` / `promptGuidelines` removed (no longer needed)
- Sub-agent no longer receives `TRELLIS_CONTEXT_ID` env var (context is in prompt instead)

### Backward Compatibility

Users on older Trellis versions with in-progress Pi sessions: the old `subagent` tool won't exist after upgrade. They need to `/new` or restart Pi. This is acceptable for a beta (v0.6.0) migration.
