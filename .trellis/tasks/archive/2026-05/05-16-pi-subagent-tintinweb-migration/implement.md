# Implement: Pi Subagent Tintinweb Migration

## Execution Order

### Step 1: Update Agent .md Files

**Files:**
- `packages/cli/src/templates/pi/agents/trellis-implement.md`
- `packages/cli/src/templates/pi/agents/trellis-check.md`
- `packages/cli/src/templates/pi/agents/trellis-research.md`

**Changes:**
1. Add `display_name` to frontmatter
2. Fix tool names: `Read, Write, Edit, Bash, Glob, Grep` → `read, write, edit, bash, grep, find`
3. `trellis-research.md`: Update task resolution step (no more `task.py current`)
4. Add `prompt_mode: replace` (explicit)

### Step 2: Update settings.json Template

**File:** `packages/cli/src/templates/pi/settings.json`

**Changes:**
1. Replace `"npm:pi-subagents"` → `"npm:@tintinweb/pi-subagents"`
2. Remove empty `extensions: []`, `skills: []`, `prompts: []`, `themes: []` arrays
3. Keep top-level `extensions`, `skills`, `prompts` for Trellis resources

### Step 3: Rewrite Trellis Extension

**File:** `packages/cli/src/templates/pi/extensions/trellis/index.ts.txt`

**Remove (entire blocks):**
- All imports used only by subprocess management: `spawn`, `spawnSync`, `delimiter` (from path), `createHash`, `randomBytes` (from crypto)
- `BoundedBufferCollector` class
- `candidatePiCliJsPaths()`, `resolvePiInvocation()`, `isExistingFile()`
- `uniqueStrings()` (only used by candidate lookup)
- `TRELLIS_AGENT_JSONL` → keep (still needed for context building)
- `readAgentDefinition()`, `parseAgentConfig()`
- `modelHasThinkingSuffix()`, `buildPiModelArgs()`, `resolveSubagentRunConfig()`
- `buildSubagentPrompt()`
- `shellQuote()`, `injectTrellisContextIntoBash()`, `commandStartsWithTrellisContext()`
- `formatPiOutput()`, `extractFinalAssistantText()`
- `runPi()`, `runSubagent()`
- Constants: `PI_CLI_JS_SEGMENTS`, `MAX_SUBAGENT_STDOUT_BYTES`, `MAX_SUBAGENT_STDERR_BYTES`, `SESSION_OVERVIEW_TIMEOUT_MS`

**Keep (unchanged):**
- `SubagentInput` → rename to `TrellisSubagentInput` (fewer fields)
- `PiToolResult`, `PiExtensionContext`, hook event interfaces
- `findProjectRoot()`, `readText()`, `splitMarkdownFrontmatter()`, `stripMarkdownFrontmatter()`
- `isJsonObject()`, `stringValue()`
- `normalizeThinking()` (simplified)
- `resolveContextKey()`, `adoptExistingContextKey()`, `createProcessContextKey()`
- `readCurrentTask()`, `readJsonlFiles()`, `buildTrellisContext()`
- `TRELLIS_AGENT_JSONL` mapping
- `Workflow-state breadcrumb` block: `WORKFLOW_STATE_TAG_RE`, `loadWorkflowBreadcrumbs()`, `readActiveTaskStatus()`, `buildWorkflowStateBreadcrumb()`
- `Session overview` block: `pythonExecutable()`, `buildSessionOverview()`
- `TurnContextCache` class
- `normalizeAgentName()`
- `buildPerTurnInjection()`, `getContextKey()`

**Rewrite:**
- `registerTool` params: name=`trellis_subagent`, label=`Trellis Subagent`
- `description`: Explain this is for Trellis agents only; use `Agent` for others
- `parameters`:
  - `agent`: `{ type: "string", enum: ["trellis-implement", "trellis-check", "trellis-research"] }`
  - `prompt`: `{ type: "string" }`
  - `model`: `{ type: "string" }` optional
  - `thinking`: `{ type: "string", enum: [...] }` optional
  - `required: ["agent", "prompt"]`
- `execute` function:
  ```typescript
  async (toolCallId, input, signal, onUpdate, ctx) => {
    // 1. Validate agent
    const VALID_AGENTS = ["trellis-implement", "trellis-check", "trellis-research"];
    if (!VALID_AGENTS.includes(input.agent)) {
      return { content: [{ type: "text", text: `Unknown agent: ${input.agent}. Use Agent tool for non-Trellis agents.` }] };
    }

    // 2. Resolve context
    const contextKey = getContextKey(input, ctx);
    const trellisContext = buildTrellisContext(projectRoot, input.agent, input, ctx, contextKey);
    const fullPrompt = `${trellisContext}\n\n## Delegated Task\n${input.prompt ?? ""}`;

    // 3. RPC spawn via pi.events
    const requestId = crypto.randomUUID();
    const spawnResult = await rpcSpawn(pi, requestId, input.agent, fullPrompt, input.model);
    if (!spawnResult.success) {
      return { content: [{ type: "text", text: `Failed to spawn agent: ${spawnResult.error}` }] };
    }
    const agentId = spawnResult.id;

    // 4. Notify progress start
    onUpdate?.({ content: [{ type: "text", text: `Agent started (ID: ${agentId})` }] });

    // 5. Wait for completion/failure event
    const result = await waitForAgentCompletion(pi, agentId, signal);
    return {
      content: [{ type: "text", text: result.text }],
      details: { agent: input.agent, agentId, ...result.details },
    };
  };
  ```

**New helper functions:**
```typescript
const RPC_TIMEOUT_MS = 30_000; // spawn reply timeout
const AGENT_TIMEOUT_MS = 300_000; // agent completion timeout (5 min)

interface RpcSpawnResult {
  success: true; id: string;
} | {
  success: false; error: string;
}

function rpcSpawn(
  events: { emit: Function; on: Function },
  requestId: string,
  type: string,
  prompt: string,
  model?: string,
): Promise<RpcSpawnResult> {
  return new Promise((resolve) => {
    const replyChannel = `subagents:rpc:spawn:reply:${requestId}`;
    const timeout = setTimeout(() => {
      unsub();
      resolve({ success: false, error: "RPC spawn timed out" });
    }, RPC_TIMEOUT_MS);

    const unsub = events.on(replyChannel, (reply: any) => {
      clearTimeout(timeout);
      unsub();
      if (reply?.success) {
        resolve({ success: true, id: reply.data?.id ?? "" });
      } else {
        resolve({ success: false, error: reply?.error ?? "Unknown RPC error" });
      }
    });

    const options: Record<string, unknown> = {};
    if (model) options.model = model;

    events.emit("subagents:rpc:spawn", { requestId, type, prompt, options });
  });
}

function waitForAgentCompletion(
  events: { on: Function },
  agentId: string,
  signal?: AbortSignal,
): Promise<{ text: string; details: Record<string, unknown> }> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error(`Agent ${agentId} timed out after ${AGENT_TIMEOUT_MS / 1000}s`));
    }, AGENT_TIMEOUT_MS);

    const onAbort = () => {
      cleanup();
      reject(new Error("Agent cancelled"));
    };

    const onCompleted = (data: any) => {
      if (data?.id !== agentId) return;
      cleanup();
      resolve({
        text: data.result ?? "",
        details: { status: data.status, toolUses: data.toolUses, durationMs: data.durationMs },
      });
    };

    const onFailed = (data: any) => {
      if (data?.id !== agentId) return;
      cleanup();
      resolve({
        text: `Agent failed: ${data.error ?? "unknown error"}`,
        details: { status: data.status, error: data.error },
      });
    };

    const unsub1 = events.on("subagents:completed", onCompleted);
    const unsub2 = events.on("subagents:failed", onFailed);
    signal?.addEventListener("abort", onAbort, { once: true });

    const cleanup = () => {
      clearTimeout(timeout);
      unsub1();
      unsub2();
      signal?.removeEventListener("abort", onAbort);
    };
  });
}
```

**Remove from imports:**
- `delimiter` from `node:path`
- `spawn`, `spawnSync` from `node:child_process`
- `createHash`, `randomBytes` from `node:crypto`

**Keep in imports:**
- `existsSync`, `readFileSync`, `readdirSync`, `statSync` from `node:fs`
- `randomUUID` from `node:crypto` (for requestId)
- `dirname`, `join`, `resolve` from `node:path`

### Step 4: Update Platform Integration Spec

**File:** `.trellis/spec/cli/backend/platform-integration.md`

**Section to update:** "Scenario: Pi Sub-Agent Launcher"

Replace subprocess-based launch documentation with RPC-based integration:
1. Remove subprocess contracts (resolvePiInvocation, spawn, BoundedBufferCollector)
2. Document RPC spawn protocol (`subagents:rpc:spawn` → reply → event)
3. Document `trellis_subagent` tool contract
4. Document agent definition format (compatible with tintinweb's custom-agents.ts)

### Step 5: Verify

```bash
pnpm lint
pnpm typecheck
```

Note: The template file is `.txt` extension, not `.ts`. It will NOT be typechecked directly. Manual review required.

### Step 6: Update settings.json Nesting Note

The `settings.json` template currently has `"npm:pi-subagents"` with empty arrays per the platform-integration spec's "Project-local package isolation rule". Update that spec section to reflect the new `@tintinweb/pi-subagents` approach where extensions ARE enabled.
