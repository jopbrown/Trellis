import { describe, expect, it } from "vitest";
import {
  getAllAgents,
  getExtensionTemplate,
  getSettingsTemplate,
} from "../../src/templates/pi/index.js";

describe("pi templates", () => {
  it("provides the three Trellis sub-agent definitions", () => {
    const agents = getAllAgents();
    expect(agents.map((agent) => agent.name).sort()).toEqual([
      "trellis-check",
      "trellis-implement",
      "trellis-research",
    ]);

    for (const agent of agents) {
      expect(agent.content).toContain(`name: ${agent.name}`);
      expect(agent.content).not.toContain("inject-subagent-context.py");
      expect(agent.content).toContain("display_name");
      expect(agent.content).toContain("find_files");
      expect(agent.content).toContain("grep");
    }
  });

  it("settings keep Pi-owned skills until shared Agent Skills are platform-neutral", () => {
    const settings = JSON.parse(getSettingsTemplate().content) as {
      enableSkillCommands?: boolean;
      extensions?: string[];
      skills?: string[];
      prompts?: string[];
      packages?: (
        | string
        | {
            source?: string;
            extensions?: unknown[];
            skills?: unknown[];
            prompts?: unknown[];
            themes?: unknown[];
          }
      )[];
    };

    expect(settings.enableSkillCommands).toBe(true);
    expect(settings.extensions).toEqual(["./extensions/trellis/index.ts"]);
    expect(settings.skills).toEqual(["./skills"]);
    expect(settings.skills).not.toEqual(["../.agents/skills"]);
    expect(settings.prompts).toEqual(["./prompts"]);
    const subagentsPkg = settings.packages?.find(
      (p) => typeof p === "object" && p.source === "npm:@tintinweb/pi-subagents",
    );
    expect(subagentsPkg).toEqual({
      source: "npm:@tintinweb/pi-subagents",
    });
  });

  it("extension registers trellis_subagent tool and hook-equivalent Pi events", () => {
    const extension = getExtensionTemplate();

    expect(extension).toContain('name: "trellis_subagent"');
    expect(extension).not.toContain(
      '["--mode", "json", "-p", "--no-session", toPiPromptArgument(prompt)]',
    );
    expect(extension).toContain("sessionManager?:");
    expect(extension).toContain("getSessionId?: () => string");
    expect(extension).toContain('pi.on?.("session_start"');
    expect(extension).toContain('pi.on?.("input"');
    expect(extension).toContain('pi.on?.("before_agent_start"');
    expect(extension).toContain('pi.on?.("context"');
    expect(extension).toContain('pi.on?.("tool_call"');
    expect(extension).not.toContain("inject-subagent-context.py");
  });

  it("extension resolves active task from session runtime only", () => {
    const extension = getExtensionTemplate();

    expect(extension).toContain('".runtime", "sessions"');
    expect(extension).toContain("function resolveContextKey");
    expect(extension).toContain("ctx?.sessionManager?.getSessionId");
    expect(extension).toContain("process.env.PI_SESSIONID");
    expect(extension).toContain("function adoptExistingContextKey");
    expect(extension).toContain("function activeRuntimeContextKeys");
    expect(extension).toContain('key.startsWith("pi_process_")');
    expect(extension).not.toContain(".current-task");
    expect(extension).not.toContain("global fallback");
  });

  it("extension injects Trellis context into Pi bash tool calls", () => {
    const extension = getExtensionTemplate();

    expect(extension).toContain("function injectTrellisContextIntoBash");
    expect(extension).toContain('toolCall.toolName !== "bash"');
    expect(extension).toContain(
      "toolCall.input.command = `export TRELLIS_CONTEXT_ID=",
    );
    expect(extension).toContain("function commandStartsWithTrellisContext");
    expect(extension).toContain("function shellQuote");
    expect(extension).toContain(
      "injectTrellisContextIntoBash(event, contextKey)",
    );
  });

  it("extension does NOT include subprocess spawning code", () => {
    const extension = getExtensionTemplate();

    // Removed: manual Pi subprocess management
    expect(extension).not.toContain("function resolvePiInvocation");
    expect(extension).not.toContain("TRELLIS_PI_CLI_JS");
    expect(extension).not.toContain("PI_CLI_JS_SEGMENTS");
    expect(extension).not.toContain("process.env.APPDATA");
    expect(extension).not.toContain("pathValue.split(delimiter)");
    expect(extension).not.toContain('return { command: "pi", argsPrefix: [] }');
    expect(extension).not.toContain("class BoundedBufferCollector");
    expect(extension).not.toContain("MAX_SUBAGENT_STDOUT_BYTES");
    expect(extension).not.toContain("MAX_SUBAGENT_STDERR_BYTES");
    expect(extension).not.toContain('spawn(invocation.command');
    expect(extension).not.toContain('"pi subagent cancelled"');
    expect(extension).not.toContain("toPiPromptArgument");

    // Kept: session overview (still uses spawnSync)
    expect(extension).toContain("import { spawnSync } from");
  });

  it("extension uses RPC to spawn sub-agents via tintinweb", () => {
    const extension = getExtensionTemplate();

    expect(extension).toContain("trellis_subagent");
    expect(extension).toContain("subagents:rpc:spawn");
    expect(extension).toContain("function rpcSpawn");
    expect(extension).toContain("function waitForAgentCompletion");
    expect(extension).toContain("subagents:completed");
    expect(extension).toContain("subagents:failed");
    expect(extension).toContain("randomUUID } from \"node:crypto\"");

    // Only allows Trellis agents (defined in VALID_TRELLIS_AGENTS array)
    expect(extension).toContain("VALID_TRELLIS_AGENTS");
    expect(extension).toContain('"trellis-implement"');
    expect(extension).toContain('"trellis-check"');
    expect(extension).toContain('"trellis-research"');

    // No subprocess-based agent spawning
    expect(extension).not.toContain("function runSubagent");
    expect(extension).not.toContain("function runPi");
    expect(extension).not.toContain("buildSubagentPrompt");
    expect(extension).not.toContain("child.kill()");
  });

  it("trellis_subagent tool schema accepts model and thinking overrides", () => {
    const extension = getExtensionTemplate();

    expect(extension).toContain(
      "Optional Pi model override",
    );
    expect(extension).toContain("Optional Pi thinking level override");
    expect(extension).toContain(
      'enum: ["off", "minimal", "low", "medium", "high", "xhigh"]',
    );
  });

  it("extension uses Pi runtime-safe event and tool result shapes", () => {
    const extension = getExtensionTemplate();

    expect(extension).toContain("Promise<PiToolResult>");
    expect(extension).toContain("details: {");
    expect(extension).toContain("ctx?.ui?.notify?.(");
    expect(extension).toContain("systemPrompt:");
    expect(extension).toContain('pi.on?.("input", (event, ctx) => {');
    expect(extension).toContain('action: "continue"');
    expect(extension).not.toContain("message: buildTrellisContext");
    expect(extension).not.toContain('message:\n      "Trellis project context');
    expect(extension).not.toContain("persistent: true");
  });

  it("extension injects per-turn workflow-state breadcrumb from workflow.md tags", () => {
    const extension = getExtensionTemplate();

    expect(extension).toContain("WORKFLOW_STATE_TAG_RE");
    expect(extension).toContain("workflow-state:([A-Za-z0-9_-]+)");
    expect(extension).toContain("function loadWorkflowBreadcrumbs");
    expect(extension).toContain("function buildWorkflowStateBreadcrumb");
    expect(extension).toContain("<workflow-state>");
    expect(extension).toContain("Refer to workflow.md for current step.");
    expect(extension).toContain("no_task");
  });

  it("extension injects per-turn session-overview via get_context.py", () => {
    const extension = getExtensionTemplate();

    expect(extension).toContain("function buildSessionOverview");
    expect(extension).toContain('"get_context.py"');
    expect(extension).toContain("<session-overview>");
    expect(extension).toContain("spawnSync");
    expect(extension).toContain("class TurnContextCache");
    expect(extension).toContain("buildPerTurnInjection");
    expect(extension).toContain("turnContextCache.get");
  });

  it("input and before_agent_start hooks both surface workflow-state breadcrumb", () => {
    const extension = getExtensionTemplate();

    expect(extension).toContain(
      "[current, context, perTurn].filter(Boolean).join",
    );
    expect(extension).toContain(
      "additionalContext, systemPrompt: additionalContext",
    );
    expect(extension).toContain('buildTrellisContext(\n      projectRoot,\n      "trellis-implement"');
  });
});
