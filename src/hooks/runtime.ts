/**
 * Nexus Hook shell wrapper entry — reads stdin, normalizes for harness,
 * dispatches to handler, and serializes stdout per NEXUS_HARNESS.
 *
 * 결정 참조: plan.json Issue #1 (3-레이어 책임 분담),
 *            Issue #3 (Bash parse patterns), Issue #4 (Codex tool aliases)
 */

import { NexusHookInputSchema, NexusHookOutputSchema, HookMetaSchema } from "./types.js";
import type { NexusHookInput, NexusHookOutput, HookHandler } from "./types.js";
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { createRequire } from "node:module";
import { parse as parseYaml } from "yaml";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface RunWrapperOptions {
  /** Absolute path to the compiled handler .js file. */
  handlerPath: string;
  /** Optional absolute path to meta.yml; enables condition.state_file_exists check. */
  metaPath?: string;
}

export async function runWrapper(options: RunWrapperOptions): Promise<void> {
  try {
    const stdin = await readStdin();
    const rawInput = JSON.parse(stdin);
    const harness = resolveHarness();
    const normalized = normalizeInput(rawInput, harness);
    const validated = NexusHookInputSchema.parse(normalized);

    if (await shouldSkipByCondition(options.metaPath, validated.cwd)) {
      process.exit(0);
    }

    // Normalize Bash tool_name when applicable
    const input = normalizeBashToolName(validated, harness);

    // Dynamic import — must be file:// URL in ESM to handle absolute paths
    const handlerUrl = options.handlerPath.startsWith("file://")
      ? options.handlerPath
      : `file://${options.handlerPath}`;

    const handlerModule = await import(handlerUrl);
    const handler: HookHandler = handlerModule.default ?? handlerModule.handler;
    if (typeof handler !== "function") {
      throw new Error(`handler export not found in ${options.handlerPath}`);
    }

    const rawOutput = await handler(input);
    if (rawOutput == null) {
      process.exit(0);
    }

    const output = NexusHookOutputSchema.parse(rawOutput);
    const stdout = serializeForHarness(output, harness, input.hook_event_name);
    process.stdout.write(JSON.stringify(stdout));
    process.exit(0);
  } catch (err) {
    process.stderr.write(`[nexus-hook] ${String(err)}\n`);
    process.exit(0); // never kill the turn
  }
}

// ---------------------------------------------------------------------------
// Bash command parsing (public — used by matchers / tests)
// ---------------------------------------------------------------------------

export interface ParsedBashCommand {
  tool: string;
  target?: string;
}

/** Parse a Bash command string into a nexus standard tool name.
 *  Returns null when the command is a compound/piped command or unrecognised. */
export function parseBashCommand(command: string): ParsedBashCommand | null {
  const patterns = loadBashParsePatterns();
  const trimmed = command.trim();

  // Reject compound commands (pipes, &&, ||, ;) — best-effort single-entrypoint only
  if (/[|;&]/.test(trimmed)) {
    return null;
  }

  for (const [toolName, regexList] of Object.entries(patterns)) {
    for (const regex of regexList) {
      if (regex.test(trimmed)) {
        return { tool: toolName };
      }
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Cached bash_parse_patterns from tool-name-map.yml */
let _bashParsePatternsCache: Record<string, RegExp[]> | null = null;

function loadBashParsePatterns(): Record<string, RegExp[]> {
  if (_bashParsePatternsCache) return _bashParsePatternsCache;

  const ymlPath = resolveAssetPath("assets/tools/tool-name-map.yml");
  const raw = readFileSync(ymlPath, "utf8");
  const parsed = parseYaml(raw) as {
    bash_parse_patterns: Record<string, string[]>;
  };

  const result: Record<string, RegExp[]> = {};
  for (const [tool, patterns] of Object.entries(parsed.bash_parse_patterns ?? {})) {
    result[tool] = patterns.map((p) => new RegExp(p));
  }
  _bashParsePatternsCache = result;
  return result;
}

/** Resolve a path relative to the nexus-core package root.
 *  Works whether running from src/ (ts-node/bun) or dist/ (compiled). */
function resolveAssetPath(relativePath: string): string {
  // Try createRequire first (installed package case)
  try {
    const req = createRequire(import.meta.url);
    const pkgJson = req.resolve("@moreih29/nexus-core/manifest.json").replace(
      /\/manifest\.json$/,
      ""
    );
    const candidate = resolve(pkgJson, relativePath);
    if (existsSync(candidate)) return candidate;
  } catch {
    // Package not installed or manifest.json not resolvable — fall through to walk-up
  }

  // Fallback: walk up from current file to find package root by locating package.json
  const selfDir = new URL(".", import.meta.url).pathname;
  let dir = selfDir;
  while (dir !== "/") {
    const pkgCandidate = resolve(dir, relativePath);
    if (existsSync(pkgCandidate)) return pkgCandidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  throw new Error(`[nexus-hook] Cannot locate ${relativePath} from ${selfDir}`);
}

function resolveHarness(): string {
  return process.env["NEXUS_HARNESS"] ?? "claude";
}

/** Normalise harness-native stdin to nexus standard NexusHookInput shape.
 *
 *  - claude / codex: field names are already mostly compatible; handle known aliases
 *  - opencode: mountHooks already delivers nexus standard — pass-through
 */
function normalizeInput(raw: Record<string, unknown>, harness: string): Record<string, unknown> {
  if (harness === "opencode") {
    // pass-through — mountHooks already normalised
    return raw;
  }

  if (harness === "codex") {
    // Codex uses snake_case and sends tool_name; primary event shape is compatible.
    // Remap known Codex-native tool aliases to nexus PascalCase names.
    const out = { ...raw };
    if (typeof out["tool_name"] === "string") {
      out["tool_name"] = normalizeCodexToolName(out["tool_name"] as string);
    }
    return out;
  }

  // claude — direct pass-through; field names match nexus standard
  return raw;
}

/** Map Codex native tool aliases to nexus PascalCase equivalents. */
function normalizeCodexToolName(name: string): string {
  const aliasMap: Record<string, string> = {
    shell: "Bash",
    shell_command: "Bash",
    exec_command: "Bash",
    exec: "Bash",
    apply_patch: "Edit",
    list_dir: "LS",
    web_search: "WebSearch",
    view_image: "ViewImage",
    js_repl: "REPL",
    js_repl_reset: "REPL",
    tool_search: "ToolSearch",
    tool_suggest: "ToolSearch",
    spawn_agent: "Task",
    update_plan: "TodoWrite",
    request_user_input: "AskUserQuestion",
    request_permissions: "RequestPermissions",
  };
  return aliasMap[name] ?? name;
}

/** When tool_name is "Bash" and tool_input.command is present, attempt to
 *  resolve a more specific nexus standard tool_name via bash_parse_patterns. */
function normalizeBashToolName(input: NexusHookInput, _harness: string): NexusHookInput {
  if (
    (input.hook_event_name === "PreToolUse" || input.hook_event_name === "PostToolUse") &&
    input.tool_name === "Bash" &&
    input.tool_input &&
    typeof input.tool_input["command"] === "string"
  ) {
    const parsed = parseBashCommand(input.tool_input["command"] as string);
    if (parsed) {
      return { ...input, tool_name: parsed.tool };
    }
  }
  return input;
}

/** Check meta.yml condition.state_file_exists; returns true when the hook
 *  should be skipped (condition not met). */
async function shouldSkipByCondition(
  metaPath: string | undefined,
  cwd: string
): Promise<boolean> {
  if (!metaPath) return false;
  if (!existsSync(metaPath)) return false;

  try {
    const raw = readFileSync(metaPath, "utf8");
    const meta = HookMetaSchema.parse(parseYaml(raw));
    if (!meta.condition?.state_file_exists) return false;

    const stateFile = resolve(cwd, meta.condition.state_file_exists);
    return !existsSync(stateFile);
  } catch {
    // Malformed meta.yml — do not skip
    return false;
  }
}

/** Serialize NexusHookOutput into the harness-native stdout shape. */
function serializeForHarness(
  out: NexusHookOutput,
  harness: string,
  eventName: string
): Record<string, unknown> {
  if (harness === "opencode") {
    // nexus JSON passed through — mountHooks will parse
    return out as Record<string, unknown>;
  }

  if (harness === "codex") {
    return serializeForCodex(out, eventName);
  }

  // Default: claude
  return serializeForClaude(out, eventName);
}

function serializeForClaude(out: NexusHookOutput, eventName: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  if (out.decision === "block") {
    if (eventName === "PreToolUse") {
      result["permissionDecision"] = "deny";
      if (out.block_reason) result["permissionDecisionReason"] = out.block_reason;
    } else {
      result["decision"] = "block";
      if (out.block_reason) result["reason"] = out.block_reason;
    }
  }

  if (out.additional_context) {
    result["additionalContext"] = out.additional_context;
  }

  if (out.system_message) {
    result["systemMessage"] = out.system_message;
  }

  if (out.continue === false) {
    result["continue"] = false;
    result["stopReason"] = "system_message";
  }

  return result;
}

function serializeForCodex(out: NexusHookOutput, eventName: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  if (out.decision === "block") {
    result["decision"] = "block";
    if (out.block_reason) result["reason"] = out.block_reason;
  }

  if (out.additional_context) {
    result["hookSpecificOutput"] = {
      hookEventName: eventName,
      additionalContext: out.additional_context,
    };
  }

  if (out.system_message) {
    result["systemMessage"] = out.system_message;
  }

  if (out.continue === false) {
    result["continue"] = false;
    result["stopReason"] = "system_message";
  }

  return result;
}

/** Read all of stdin and return as string. */
async function readStdin(): Promise<string> {
  return new Promise((res, rej) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      data += chunk;
    });
    process.stdin.on("end", () => res(data));
    process.stdin.on("error", rej);
  });
}

// ---------------------------------------------------------------------------
// Test-only exports (do not use in production code)
// ---------------------------------------------------------------------------

export const __test = {
  serializeForClaude,
  serializeForCodex,
  normalizeBashToolName,
  normalizeCodexToolName,
};
