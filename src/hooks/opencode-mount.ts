/**
 * OpenCode plugin adapter — mounts nexus hooks into OpenCode's plugin API.
 *
 * 결정 참조: plan.json Issue #1 (3-레이어 책임 분담),
 *            Issue #3 (OpenCode 2단 처리 — SubagentStart/Stop, agent-tracker),
 *            Issue #6 (additional_context 주입 우회 — SubagentStop output.output append)
 */

import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { updateJsonFileLocked } from "../shared/json-store.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface OpenCodeHookManifestEntry {
  name: string;
  /** Nexus standard event names (PascalCase). */
  events: string[];
  /** Glob/regex pattern matched against tool_name or source. */
  matcher: string;
  /** Absolute path to the compiled handler .js shell wrapper. */
  handlerPath: string;
  priority: number;
  /** Timeout in seconds; defaults to 30. */
  timeout?: number;
}

export interface OpenCodeHookManifest {
  hooks: OpenCodeHookManifestEntry[];
}

// ---------------------------------------------------------------------------
// resolveManifestPath — handlerPath absolutizer
// ---------------------------------------------------------------------------

/**
 * Resolve a manifest-relative handlerPath to an absolute filesystem path.
 *
 * The manifest JSON lives at dist/manifests/opencode-manifest.json.
 * This module lives at dist/src/hooks/opencode-mount.js.
 * We construct the manifest's URL relative to this module, then resolve
 * the handlerPath relative to that manifest URL.
 */
function resolveManifestPath(relPath: string): string {
  const manifestUrl = new URL("../../manifests/opencode-manifest.json", import.meta.url);
  return fileURLToPath(new URL(relPath, manifestUrl));
}

// ---------------------------------------------------------------------------
// mountHooks — primary export
// ---------------------------------------------------------------------------

/**
 * Mount nexus hooks into OpenCode's plugin API.
 *
 * Returns an object whose keys are OpenCode plugin hook names. Each value is
 * the async handler function OpenCode calls when the corresponding event fires.
 *
 * @param pluginCtx  OpenCode plugin context (must expose `.directory: string`)
 * @param manifest   Hook manifest produced by build-hooks.ts
 */
export function mountHooks(
  pluginCtx: { directory: string },
  manifest: OpenCodeHookManifest,
): Record<string, (...args: unknown[]) => Promise<void>> {
  // Resolve all handlerPaths to absolute paths so spawn() works regardless of CWD.
  const resolvedManifest: OpenCodeHookManifest = {
    hooks: manifest.hooks.map((h) => ({ ...h, handlerPath: resolveManifestPath(h.handlerPath) })),
  };

  // Buffer for additional_context produced by SessionStart / UserPromptSubmit hooks.
  // Flushed into the system prompt on each LLM call via chat.system.transform.
  const systemTransformBuffer: string[] = [];

  return {
    // ------------------------------------------------------------------
    // session.created → SessionStart
    // ------------------------------------------------------------------
    "event": async (input: unknown): Promise<void> => {
      const ev = input as Record<string, unknown>;
      if ((ev["event"] as Record<string, unknown> | undefined)?.["type"] !== "session.created") {
        return;
      }
      const sessionEvent = ev["event"] as Record<string, unknown>;
      const sessionId = (sessionEvent["sessionID"] as string | undefined) ?? "";

      await dispatchEvent(
        "SessionStart",
        resolvedManifest,
        {
          hook_event_name: "SessionStart" as const,
          session_id: sessionId,
          cwd: pluginCtx.directory,
          source: "startup" as const,
        },
        { systemTransformBuffer },
      );
    },

    // ------------------------------------------------------------------
    // chat.message → UserPromptSubmit
    // ------------------------------------------------------------------
    "chat.message": async (input: unknown): Promise<void> => {
      const msg = input as Record<string, unknown>;
      const sessionId = (msg["sessionID"] as string | undefined) ?? "";
      const prompt = (msg["message"] as string | undefined) ?? "";

      await dispatchEvent(
        "UserPromptSubmit",
        resolvedManifest,
        {
          hook_event_name: "UserPromptSubmit" as const,
          session_id: sessionId,
          cwd: pluginCtx.directory,
          prompt,
        },
        { systemTransformBuffer },
      );
    },

    // ------------------------------------------------------------------
    // tool.execute.before → PreToolUse  (or SubagentStart when tool=task)
    // ------------------------------------------------------------------
    "tool.execute.before": async (input: unknown, output: unknown): Promise<void> => {
      const inp = input as Record<string, unknown>;
      const out = output as Record<string, unknown>;
      const sessionId = (inp["sessionID"] as string | undefined) ?? "";
      const toolName = (inp["tool"] as string | undefined) ?? "";
      const isTask = toolName === "task";
      const args = (out["args"] as Record<string, unknown> | undefined) ?? {};

      if (isTask) {
        await dispatchEvent(
          "SubagentStart",
          resolvedManifest,
          {
            hook_event_name: "SubagentStart" as const,
            session_id: sessionId,
            cwd: pluginCtx.directory,
            // agent_id is unknown until tool.execute.after resolves the subagent session
            agent_id: "",
            agent_type: (args["subagent_type"] as string | undefined) ?? "",
          },
          { outputArgsRef: args },
        );
      } else {
        await dispatchEvent(
          "PreToolUse",
          resolvedManifest,
          {
            hook_event_name: "PreToolUse" as const,
            session_id: sessionId,
            cwd: pluginCtx.directory,
            tool_name: normalizeOpenCodeToolName(toolName),
            tool_input: args,
          },
          { outputArgsRef: args },
        );
      }
    },

    // ------------------------------------------------------------------
    // tool.execute.after → PostToolUse  (or SubagentStop when tool=task)
    // ------------------------------------------------------------------
    "tool.execute.after": async (input: unknown, output: unknown): Promise<void> => {
      const inp = input as Record<string, unknown>;
      const out = output as Record<string, unknown>;
      const sessionId = (inp["sessionID"] as string | undefined) ?? "";
      const toolName = (inp["tool"] as string | undefined) ?? "";
      const isTask = toolName === "task";
      const args = (out["args"] as Record<string, unknown> | undefined) ?? {};
      const metadata = (out["metadata"] as Record<string, unknown> | undefined) ?? {};
      const agentId = (metadata["sessionId"] as string | undefined) ?? "";

      if (isTask) {
        // Register / update agent-tracker before dispatching SubagentStop
        await upsertAgentTracker(
          pluginCtx.directory,
          sessionId,
          agentId,
          (args["subagent_type"] as string | undefined) ?? "",
        );

        await dispatchEvent(
          "SubagentStop",
          resolvedManifest,
          {
            hook_event_name: "SubagentStop" as const,
            session_id: sessionId,
            cwd: pluginCtx.directory,
            agent_id: agentId,
            agent_type: (args["subagent_type"] as string | undefined) ?? "",
            last_assistant_message: (out["output"] as string | undefined) ?? "",
          },
          // additional_context appended to output.output (bypass #6)
          { outputOutputRef: out },
        );
      } else {
        await dispatchEvent(
          "PostToolUse",
          resolvedManifest,
          {
            hook_event_name: "PostToolUse" as const,
            session_id: sessionId,
            cwd: pluginCtx.directory,
            tool_name: normalizeOpenCodeToolName(toolName),
            tool_input: args,
            tool_response: (out["output"] as string | undefined) ?? "",
          },
          {},
        );
      }
    },

    // ------------------------------------------------------------------
    // experimental.chat.system.transform — flush buffer into system prompt
    // ------------------------------------------------------------------
    "experimental.chat.system.transform": async (
      _input: unknown,
      output: unknown,
    ): Promise<void> => {
      const out = output as { system?: unknown[] };
      if (!Array.isArray(out.system)) return;
      while (systemTransformBuffer.length > 0) {
        out.system.push(systemTransformBuffer.shift());
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Side-effect descriptors
// ---------------------------------------------------------------------------

interface SideEffects {
  /** Buffer for SessionStart / UserPromptSubmit additional_context → system.transform */
  systemTransformBuffer?: string[];
  /** Output args object for SubagentStart (prepend additional_context to args.prompt)
   *  and PreToolUse (updated_input mutation). */
  outputArgsRef?: Record<string, unknown>;
  /** Output object for SubagentStop — additional_context appended to output.output */
  outputOutputRef?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// dispatchEvent
// ---------------------------------------------------------------------------

async function dispatchEvent(
  nexusEventName: string,
  manifest: OpenCodeHookManifest,
  nexusInput: Record<string, unknown>,
  sideEffects: SideEffects,
): Promise<void> {
  // Sort hooks by priority (ascending) so lower numbers run first
  const candidates = manifest.hooks
    .filter((h) => h.events.includes(nexusEventName))
    .sort((a, b) => a.priority - b.priority);

  for (const hook of candidates) {
    const toolOrSource = (nexusInput["tool_name"] as string | undefined) ??
      (nexusInput["source"] as string | undefined) ??
      "";

    if (!matchesPattern(hook.matcher, toolOrSource)) continue;

    const timeoutMs = (hook.timeout ?? 30) * 1000;
    const result = await spawnHandler(hook.handlerPath, nexusInput, timeoutMs);
    if (result == null) continue;

    applyResult(result, nexusEventName, sideEffects);
  }
}

// ---------------------------------------------------------------------------
// spawnHandler
// ---------------------------------------------------------------------------

async function spawnHandler(
  handlerPath: string,
  nexusInput: Record<string, unknown>,
  timeoutMs: number,
): Promise<Record<string, unknown> | null> {
  return new Promise((resolve) => {
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn("node", [handlerPath], {
        env: { ...process.env, NEXUS_HARNESS: "opencode" },
        stdio: ["pipe", "pipe", "pipe"],
      });
    } catch {
      // spawn itself threw (e.g. node not found) — silent
      resolve(null);
      return;
    }

    let stdout = "";
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      try {
        child.kill();
      } catch {
        // ignore
      }
      resolve(null);
    }, timeoutMs);

    if (!child.stdout || !child.stdin) {
      clearTimeout(timer);
      resolve(null);
      return;
    }

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });

    child.stdin.write(JSON.stringify(nexusInput));
    child.stdin.end();

    child.on("exit", () => {
      clearTimeout(timer);
      if (timedOut) return;
      try {
        resolve(stdout ? (JSON.parse(stdout) as Record<string, unknown>) : null);
      } catch {
        resolve(null);
      }
    });

    child.on("error", () => {
      clearTimeout(timer);
      resolve(null); // spawn failure — silent, keep OpenCode turn alive
    });
  });
}

// ---------------------------------------------------------------------------
// applyResult — convert nexus output to OpenCode API side effects
// ---------------------------------------------------------------------------

function applyResult(
  result: Record<string, unknown>,
  nexusEventName: string,
  sideEffects: SideEffects,
): void {
  // decision:block → throw (OpenCode sees an error and halts the turn)
  if (result["decision"] === "block") {
    const reason = (result["block_reason"] as string | undefined) ?? "Blocked by nexus hook";
    throw new Error(reason);
  }

  // continue:false → throw
  if (result["continue"] === false) {
    const msg = (result["system_message"] as string | undefined) ?? "Hook requested stop";
    throw new Error(msg);
  }

  // additional_context
  const additionalContext = result["additional_context"] as string | undefined;
  if (additionalContext) {
    if (nexusEventName === "SessionStart" || nexusEventName === "UserPromptSubmit") {
      // Push to system.transform buffer
      sideEffects.systemTransformBuffer?.push(additionalContext);
    } else if (nexusEventName === "SubagentStart") {
      // Prepend to args.prompt so the subagent receives the context
      if (sideEffects.outputArgsRef) {
        const existing = (sideEffects.outputArgsRef["prompt"] as string | undefined) ?? "";
        sideEffects.outputArgsRef["prompt"] = additionalContext + "\n\n" + existing;
      }
    } else if (nexusEventName === "SubagentStop") {
      // Append to output.output (bypass #6)
      if (sideEffects.outputOutputRef) {
        const existing = (sideEffects.outputOutputRef["output"] as string | undefined) ?? "";
        sideEffects.outputOutputRef["output"] = existing + "\n\n" + additionalContext;
      }
    }
  }

  // updated_input → mutate output.args (PreToolUse only)
  const updatedInput = result["updated_input"] as Record<string, unknown> | undefined;
  if (updatedInput && nexusEventName === "PreToolUse" && sideEffects.outputArgsRef) {
    Object.assign(sideEffects.outputArgsRef, updatedInput);
  }
}

// ---------------------------------------------------------------------------
// upsertAgentTracker
// ---------------------------------------------------------------------------

async function upsertAgentTracker(
  cwd: string,
  sessionId: string,
  agentId: string,
  agentType: string,
): Promise<void> {
  if (!agentId) return; // agent_id not yet resolved — skip silently

  const trackerPath = join(
    cwd,
    ".nexus",
    "state",
    sessionId,
    "agent-tracker.json",
  );

  try {
    mkdirSync(dirname(trackerPath), { recursive: true });
    await updateJsonFileLocked(trackerPath, [] as AgentTrackerEntry[], (tracker) => {
      const existing = tracker.find((e) => e.agent_id === agentId);
      if (!existing) {
        tracker.push({
          agent_id: agentId,
          agent_type: agentType,
          started_at: new Date().toISOString(),
          resume_count: 0,
          status: "running",
        });
      } else {
        existing.resume_count = (existing.resume_count ?? 0) + 1;
        existing.last_resumed_at = new Date().toISOString();
      }
      return tracker;
    });
  } catch {
    // tracker update failure must never disrupt the OpenCode turn
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

interface AgentTrackerEntry {
  agent_id: string;
  agent_type: string;
  started_at: string;
  resume_count: number;
  status: "running" | "completed";
  last_resumed_at?: string;
}

/**
 * Test whether a nexus matcher pattern matches the given value.
 * Pattern "*" matches everything.
 * Otherwise the pattern is treated as a pipe-separated list of literals
 * (e.g. "Read|Write|Edit") or a simple regex.
 */
function matchesPattern(pattern: string, value: string): boolean {
  if (pattern === "*") return true;
  // Try literal pipe-separated list first (most common case)
  const literals = pattern.split("|");
  if (literals.every((l) => /^[A-Za-z0-9_-]+$/.test(l))) {
    return literals.includes(value);
  }
  // Fall back to regex
  try {
    return new RegExp(pattern).test(value);
  } catch {
    return false;
  }
}

/**
 * Normalize OpenCode lowercase tool names to nexus PascalCase equivalents.
 * OpenCode uses snake_case/lowercase internally; nexus standard is PascalCase.
 */
function normalizeOpenCodeToolName(name: string): string {
  const aliasMap: Record<string, string> = {
    read: "Read",
    edit: "Edit",
    write: "Write",
    bash: "Bash",
    glob: "Glob",
    grep: "Grep",
    ls: "LS",
    task: "Task",
    web_fetch: "WebFetch",
    web_search: "WebSearch",
    patch: "Edit",
  };
  return aliasMap[name] ?? name;
}
