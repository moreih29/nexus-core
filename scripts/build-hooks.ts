/**
 * scripts/build-hooks.ts
 *
 * Build pipeline for the nexus hook system.
 *
 * Five stages:
 *   1. Load assets/hooks/*\/meta.yml + HookMetaSchema zod validation (strict)
 *   2. Load capability-matrix.yml + validate capability IDs referenced by hooks
 *   3. Warn on event ↔ capability mismatch
 *   4. Compute harness portability with fallback policy enforcement
 *   5. Emit dist/hooks/*.js (tsc), dist/manifests/*.json, portability-report.json
 *
 * 결정 참조: plan.json Issue #5 (빌드 검증 5단계)
 */

import { HookMetaSchema } from "../src/hooks/types.js";
import type { HookMeta } from "../src/hooks/types.js";
import {
  readFileSync,
  readdirSync,
  existsSync,
  mkdirSync,
  writeFileSync,
  copyFileSync,
} from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";
import { parse as parseYaml } from "yaml";
import { findPackageRoot } from "../src/shared/package-root.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = findPackageRoot(__dirname);
const HOOKS_DIR = join(ROOT, "assets/hooks");
const CAPABILITY_MATRIX_PATH = join(HOOKS_DIR, "capability-matrix.yml");
const TOOL_NAME_MAP_PATH = join(ROOT, "assets/tools/tool-name-map.yml");
const DIST_HOOKS_DIR = join(ROOT, "dist/hooks");
const DIST_MANIFESTS_DIR = join(ROOT, "dist/manifests");

const HARNESSES = ["claude", "codex", "opencode"] as const;
type Harness = (typeof HARNESSES)[number];
type CapabilityValue = boolean | "partial";

// ---------------------------------------------------------------------------
// Data shapes
// ---------------------------------------------------------------------------

interface HookEntry {
  name: string;
  meta: HookMeta;
  handlerPath: string;
}

interface CapabilityMatrix {
  capabilities: Record<
    string,
    { claude: CapabilityValue; codex: CapabilityValue; opencode: CapabilityValue; note?: string }
  >;
}

interface ExclusionRecord {
  harness: Harness;
  missing: string[];
  reason: string;
}

interface PortabilityPlan {
  name: string;
  meta: HookMeta;
  tier: "core" | "extended" | "experimental" | "harness-specific";
  registeredIn: Harness[];
  excludedFrom: ExclusionRecord[];
  capabilitiesRequired: string[];
}

interface ToolNameMap {
  tools: Record<
    string,
    {
      claude: string | string[] | null;
      codex: string | string[] | null | { primary: string; aliases: string[] };
      opencode: string | string[] | null;
    }
  >;
}

// ---------------------------------------------------------------------------
// Stage 1: Load + validate meta.yml files
// ---------------------------------------------------------------------------

function loadAllHooks(): HookEntry[] {
  const entries = readdirSync(HOOKS_DIR, { withFileTypes: true });
  const result: HookEntry[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const metaPath = join(HOOKS_DIR, entry.name, "meta.yml");
    const handlerPath = join(HOOKS_DIR, entry.name, "handler.ts");

    if (!existsSync(metaPath) || !existsSync(handlerPath)) continue;

    const metaRaw = parseYaml(readFileSync(metaPath, "utf-8"));

    // HookMetaSchema is .strict() — portability_tier and other unknown fields
    // will throw a ZodError here (Acceptance Criteria #5)
    let meta: HookMeta;
    try {
      meta = HookMetaSchema.parse(metaRaw);
    } catch (err) {
      throw new Error(
        `[build-hooks] meta.yml validation failed for "${entry.name}": ${String(err)}`,
      );
    }

    result.push({ name: entry.name, meta, handlerPath });
  }

  // Sort by priority descending
  result.sort((a, b) => b.meta.priority - a.meta.priority);

  return result;
}

// ---------------------------------------------------------------------------
// Stage 2: Load capability matrix + validate capability IDs
// ---------------------------------------------------------------------------

function loadCapabilityMatrix(): CapabilityMatrix {
  const raw = readFileSync(CAPABILITY_MATRIX_PATH, "utf-8");
  return parseYaml(raw) as CapabilityMatrix;
}

function validateCapabilityIds(hooks: HookEntry[], matrix: CapabilityMatrix): void {
  const knownIds = new Set(Object.keys(matrix.capabilities));

  for (const hook of hooks) {
    for (const capId of hook.meta.requires_capabilities) {
      if (!knownIds.has(capId)) {
        // Acceptance Criteria #6: unknown capability ID → build failure
        throw new Error(
          `[build-hooks] "${hook.name}" requires unknown capability "${capId}". ` +
            `Known IDs: ${[...knownIds].join(", ")}`,
        );
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Stage 3: Event ↔ capability mismatch warnings
// ---------------------------------------------------------------------------

type HookEventName =
  | "SessionStart"
  | "UserPromptSubmit"
  | "PreToolUse"
  | "PostToolUse"
  | "SubagentStart"
  | "SubagentStop";

/** Capability prefix → events it belongs to */
const CAP_EVENT_MAP: Array<{ prefix: string; events: HookEventName[] }> = [
  { prefix: "event.session_start", events: ["SessionStart" as const] },
  { prefix: "event.user_prompt_submit", events: ["UserPromptSubmit" as const] },
  { prefix: "event.pre_tool_use", events: ["PreToolUse" as const] },
  { prefix: "event.post_tool_use", events: ["PostToolUse" as const] },
  { prefix: "event.subagent_start", events: ["SubagentStart" as const] },
  { prefix: "event.subagent_stop", events: ["SubagentStop" as const] },
  {
    prefix: "output.additional_context.session_start",
    events: ["SessionStart" as const, "SubagentStart" as const],
  },
  { prefix: "output.additional_context.user_prompt", events: ["UserPromptSubmit" as const] },
  { prefix: "output.additional_context.subagent_stop", events: ["SubagentStop" as const] },
  { prefix: "output.additional_context.post_tool", events: ["PostToolUse" as const] },
  { prefix: "output.additional_context.pre_tool", events: ["PreToolUse" as const] },
];

function warnOnMismatch(hooks: HookEntry[]): void {
  for (const hook of hooks) {
    const hookEvents = new Set(hook.meta.events);

    for (const capId of hook.meta.requires_capabilities) {
      for (const mapping of CAP_EVENT_MAP) {
        if (!capId.startsWith(mapping.prefix)) continue;

        const capEvents = new Set(mapping.events);
        const overlap = mapping.events.some((e) => hookEvents.has(e));

        if (!overlap) {
          process.stderr.write(
            `[build-hooks] WARN mismatch: hook "${hook.name}" listens on [${hook.meta.events.join(", ")}] ` +
              `but capability "${capId}" applies to [${mapping.events.join(", ")}]\n`,
          );
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Stage 4: Harness portability computation + fallback policy
// ---------------------------------------------------------------------------

function computePortability(hooks: HookEntry[], matrix: CapabilityMatrix): PortabilityPlan[] {
  const plans: PortabilityPlan[] = [];

  for (const hook of hooks) {
    const registeredIn: Harness[] = [];
    const excludedFrom: ExclusionRecord[] = [];

    for (const harness of HARNESSES) {
      const missingCaps: string[] = [];

      for (const capId of hook.meta.requires_capabilities) {
        const capEntry = matrix.capabilities[capId];
        if (!capEntry) continue; // already caught in validateCapabilityIds

        const support = capEntry[harness];
        // Only `true` counts as fully supported; false and partial are unsupported
        if (support !== true) {
          missingCaps.push(capId);
        }
      }

      if (missingCaps.length === 0) {
        registeredIn.push(harness);
      } else {
        // Determine reason string from capability notes
        const reasons = missingCaps
          .map((capId) => {
            const entry = matrix.capabilities[capId];
            if (!entry?.note) return capId;
            // Trim the note to a concise first sentence
            const note = entry.note.trim().split(/\.\s/)[0]?.trim() ?? capId;
            return note;
          })
          .join("; ");

        // Apply fallback policy (Acceptance Criteria #7)
        if (hook.meta.fallback === "error") {
          throw new Error(
            `[build-hooks] Hook "${hook.name}" fallback=error but harness "${harness}" ` +
              `is missing capabilities: ${missingCaps.join(", ")}`,
          );
        }

        if (hook.meta.fallback === "warn") {
          process.stderr.write(
            `[build-hooks] WARN: hook "${hook.name}" excluded from "${harness}" ` +
              `(missing: ${missingCaps.join(", ")})\n`,
          );
        }
        // fallback=skip: no warning, silently excluded

        excludedFrom.push({ harness, missing: missingCaps, reason: reasons });
      }
    }

    const tier = deriveTier(registeredIn, hook.meta.fallback);

    plans.push({
      name: hook.name,
      meta: hook.meta,
      tier,
      registeredIn,
      excludedFrom,
      capabilitiesRequired: hook.meta.requires_capabilities,
    });
  }

  return plans;
}

function deriveTier(
  registeredIn: Harness[],
  fallback: HookMeta["fallback"],
): PortabilityPlan["tier"] {
  const count = registeredIn.length;
  if (count === 3) return "core";
  if (count === 2) return "extended";
  if (count === 1) {
    // harness-specific: intentional skip-only registration in one harness
    if (fallback === "skip") return "harness-specific";
    return "experimental";
  }
  // count === 0: excluded everywhere — still experimental (build already failed if fallback=error)
  return "experimental";
}

// ---------------------------------------------------------------------------
// Stage 5a: Compile handlers via tsc
//
// Each handler.ts imports from src/ (types, shared utilities), so rootDir
// cannot be scoped to assets/hooks alone. We compile the full project tree
// (rootDir=.) into a temporary directory, then copy only the handler outputs
// to dist/hooks/<name>.js — preserving the flat dist/hooks/<name>.js layout
// required by the manifests.
// ---------------------------------------------------------------------------

/**
 * Compile handlers that are registered in at least one harness.
 *
 * Filters by portability plan so excluded hooks (e.g., post-tool-telemetry
 * missing required capabilities in all 3 harnesses) are skipped — the
 * previous unfiltered behavior produced unnecessary `bun build` invocations
 * and surfaced WARN noise in consumer output (#35 defect #1).
 */
function compileHandlers(plans: PortabilityPlan[], hookIndex: Map<string, HookEntry>): void {
  mkdirSync(DIST_HOOKS_DIR, { recursive: true });

  for (const plan of plans) {
    if (plan.registeredIn.length === 0) continue;

    const hook = hookIndex.get(plan.name);
    if (!hook) continue;

    const outFile = join(DIST_HOOKS_DIR, `${hook.name}.js`);
    try {
      execSync(
        `bun build ${hook.handlerPath} --outfile ${outFile} --target node --format esm`,
        { cwd: ROOT, stdio: "inherit" },
      );
    } catch {
      throw new Error(
        `[build-hooks] Handler compilation failed for "${hook.name}" (bun build exit non-zero)`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Stage 5b: Write harness manifests
// ---------------------------------------------------------------------------

function loadToolNameMap(): ToolNameMap {
  const raw = readFileSync(TOOL_NAME_MAP_PATH, "utf-8");
  return parseYaml(raw) as ToolNameMap;
}

/**
 * Translate a nexus PascalCase matcher token to the harness-native tool name(s).
 * Returns the original token if no mapping is found.
 *
 * Acceptance Criteria #8: Bash → shell/bash per harness.
 */
function translateMatcherToken(token: string, harness: Harness, toolMap: ToolNameMap): string {
  const entry = toolMap.tools[token];
  if (!entry) return token;

  const harnessValue = entry[harness];
  if (harnessValue === null || harnessValue === undefined) return token;

  if (typeof harnessValue === "string") return harnessValue;

  if (Array.isArray(harnessValue)) {
    return harnessValue.join("|");
  }

  // Codex primary/aliases shape
  if (typeof harnessValue === "object" && "primary" in harnessValue) {
    return (harnessValue as { primary: string }).primary;
  }

  return token;
}

/**
 * Translate a pipe-separated matcher string to harness-native names.
 * e.g. "Edit|Write|MultiEdit|ApplyPatch" → "Edit|Write|MultiEdit" (claude)
 *                                        → "apply_patch" (codex, deduped)
 *                                        → "edit|write|apply_patch" (opencode, deduped)
 */
function translateMatcher(matcher: string, harness: Harness, toolMap: ToolNameMap): string {
  if (matcher === "*") return "*";

  const tokens = matcher.split("|").map((t) => t.trim());
  const translated = new Set<string>();

  for (const token of tokens) {
    const native = translateMatcherToken(token, harness, toolMap);
    // native may itself be pipe-separated (Array case collapsed above)
    for (const part of native.split("|")) {
      if (part.trim()) translated.add(part.trim());
    }
  }

  return [...translated].join("|");
}

function hookCommand(hookName: string, harness: Harness): string {
  if (harness === "opencode") {
    // OpenCode uses mountHooks JS API — command field contains the module reference
    return `${hookName}`;
  }
  return `node \${CLAUDE_PLUGIN_ROOT}/dist/hooks/${hookName}.js`;
}

type ClaudeHooksJson = {
  hooks: Record<
    string,
    Array<{ matcher: string; hooks: Array<{ type: string; command: string; timeout: number }> }>
  >;
};

function buildClaudeManifest(plans: PortabilityPlan[], toolMap: ToolNameMap): ClaudeHooksJson {
  const hooks: ClaudeHooksJson["hooks"] = {};

  for (const plan of plans) {
    if (!plan.registeredIn.includes("claude")) continue;

    for (const event of plan.meta.events) {
      if (!hooks[event]) hooks[event] = [];

      const matcher = translateMatcher(plan.meta.matcher, "claude", toolMap);
      hooks[event].push({
        matcher,
        hooks: [
          {
            type: "command",
            command: hookCommand(plan.name, "claude"),
            timeout: plan.meta.timeout,
          },
        ],
      });
    }
  }

  // Sort events' hook arrays by priority descending (already sorted at plan level)
  return { hooks };
}

type CodexHooksJson = {
  hooks: Record<
    string,
    Array<{ matcher?: string; command: string; timeout: number }>
  >;
};

function buildCodexManifest(plans: PortabilityPlan[], toolMap: ToolNameMap): CodexHooksJson {
  const hooks: CodexHooksJson["hooks"] = {};

  for (const plan of plans) {
    if (!plan.registeredIn.includes("codex")) continue;

    for (const event of plan.meta.events) {
      if (!hooks[event]) hooks[event] = [];

      const matcher = translateMatcher(plan.meta.matcher, "codex", toolMap);
      const entry: { matcher?: string; command: string; timeout: number } = {
        command: hookCommand(plan.name, "codex"),
        timeout: plan.meta.timeout,
      };
      if (matcher !== "*") entry.matcher = matcher;
      hooks[event].push(entry);
    }
  }

  return { hooks };
}

interface OpenCodeHookManifestEntry {
  name: string;
  events: string[];
  matcher: string;
  handlerPath: string;
  priority: number;
  timeout?: number;
}

interface OpenCodeHookManifest {
  hooks: OpenCodeHookManifestEntry[];
}

function buildOpenCodeManifest(plans: PortabilityPlan[]): OpenCodeHookManifest {
  const hooks: OpenCodeHookManifestEntry[] = [];

  for (const plan of plans) {
    if (!plan.registeredIn.includes("opencode")) continue;

    const entry: OpenCodeHookManifestEntry = {
      name: plan.name,
      events: [...plan.meta.events],
      matcher: plan.meta.matcher ?? "*",
      handlerPath: `../assets/hooks/${plan.name}/handler.js`,
      priority: plan.meta.priority ?? 0,
      timeout: plan.meta.timeout,
    };
    hooks.push(entry);
  }

  return { hooks };
}

function writeManifests(plans: PortabilityPlan[]): void {
  mkdirSync(DIST_MANIFESTS_DIR, { recursive: true });

  const toolMap = loadToolNameMap();

  const claude = buildClaudeManifest(plans, toolMap);
  const codex = buildCodexManifest(plans, toolMap);
  const opencode = buildOpenCodeManifest(plans);

  writeFileSync(
    join(DIST_MANIFESTS_DIR, "claude-hooks.json"),
    JSON.stringify(claude, null, 2) + "\n",
  );
  writeFileSync(
    join(DIST_MANIFESTS_DIR, "codex-hooks.json"),
    JSON.stringify(codex, null, 2) + "\n",
  );
  writeFileSync(
    join(DIST_MANIFESTS_DIR, "opencode-manifest.json"),
    JSON.stringify(opencode, null, 2) + "\n",
  );
}

// ---------------------------------------------------------------------------
// Stage 5c: Write portability report
// ---------------------------------------------------------------------------

type PortabilityReport = Record<
  string,
  {
    tier: PortabilityPlan["tier"];
    registered_in: Harness[];
    excluded_from: Array<{ harness: Harness; missing: string[]; reason: string }>;
    capabilities_required: string[];
  }
>;

function writePortabilityReport(plans: PortabilityPlan[]): void {
  mkdirSync(DIST_MANIFESTS_DIR, { recursive: true });

  const report: PortabilityReport = {};

  for (const plan of plans) {
    report[plan.name] = {
      tier: plan.tier,
      registered_in: plan.registeredIn,
      excluded_from: plan.excludedFrom,
      capabilities_required: plan.capabilitiesRequired,
    };
  }

  writeFileSync(
    join(DIST_MANIFESTS_DIR, "portability-report.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Authoring-time build.
 *
 * Run via `bun run build` in the nexus-core dev workspace. Compiles handlers,
 * writes manifests, and produces a portability report. The published tarball
 * ships these prebuilt artifacts (`dist/hooks/*.js`, `dist/manifests/*.json`),
 * and `syncHooksToTarget()` is the consumer-side path that copies them.
 *
 * This function MUST NOT run in a consumer install context — the source tree
 * it compiles against (`src/`) is excluded from the published tarball per
 * `files: ["assets", "docs", "dist"]`.
 */
export async function buildHooks(): Promise<void> {
  // Stage 1
  const hooks = loadAllHooks();
  console.log(`[build-hooks] Loaded ${hooks.length} hooks`);

  const hookIndex = new Map<string, HookEntry>();
  for (const h of hooks) hookIndex.set(h.name, h);

  // Stage 2
  const matrix = loadCapabilityMatrix();
  validateCapabilityIds(hooks, matrix);

  // Stage 3
  warnOnMismatch(hooks);

  // Stage 4
  const plans = computePortability(hooks, matrix);

  // Stage 5 — compile only registered handlers, write manifests + report
  compileHandlers(plans, hookIndex);
  writeManifests(plans);
  writePortabilityReport(plans);

  console.log(`[build-hooks] ${hooks.length} hooks processed`);
  for (const plan of plans) {
    console.log(
      `  ${plan.name}: tier=${plan.tier} registered=[${plan.registeredIn.join(",")}]`,
    );
  }
}

// ---------------------------------------------------------------------------
// Consumer-side: copy pre-built artifacts to a target directory
// ---------------------------------------------------------------------------

/**
 * Copy the prebuilt Claude/Codex hook manifest and registered handler bundles
 * from the published package's `dist/` into the consumer target.
 *
 * Consumer sync path MUST NOT recompile handlers — the tarball's
 * `assets/hooks/*\/handler.ts` imports `../../../src/...` which is excluded
 * from the distribution (#34, #35, #36 Bug 2, #37). This function instead
 * relies on the prebuilt artifacts shipped in `dist/hooks` + `dist/manifests`.
 *
 * Layout written to the consumer target:
 *   - `hooks/hooks.json`         ← dist/manifests/<harness>-hooks.json
 *   - `dist/hooks/<name>.js`     ← dist/hooks/<name>.js (only handlers registered in <harness>)
 *
 * The Claude hooks.json command field resolves to
 * `${CLAUDE_PLUGIN_ROOT}/dist/hooks/<name>.js`, which matches the copied
 * layout at runtime.
 *
 * For OpenCode the runtime exports `@moreih29/nexus-core/hooks/opencode-manifest`
 * and `mountHooks` resolves handler paths relative to the published package
 * itself — no copy is required, so this function is a no-op for opencode.
 */
export async function syncHooksToTarget(opts: {
  targetDir: string;
  harness: "claude" | "codex" | "opencode";
  dryRun?: boolean;
}): Promise<{ written: string[]; skipped: string[] }> {
  const written: string[] = [];
  const skipped: string[] = [];

  if (opts.harness === "opencode") {
    // OpenCode consumes `@moreih29/nexus-core/hooks/opencode-manifest` at
    // runtime via mountHooks — no filesystem materialization in the target.
    skipped.push("hooks/(opencode-manifest resolved at runtime)");
    return { written, skipped };
  }

  const manifestName =
    opts.harness === "claude" ? "claude-hooks.json" : "codex-hooks.json";
  const manifestSrc = join(DIST_MANIFESTS_DIR, manifestName);

  if (!existsSync(manifestSrc)) {
    throw new Error(
      `[build-hooks] Missing prebuilt manifest ${manifestSrc}. Did you run \`bun run build\` before publish? ` +
        `(Consumer sync must only copy, never compile — see docs/contract/harness-io.md)`,
    );
  }

  // 1. Parse manifest to learn which handlers are actually registered
  const manifestRaw = readFileSync(manifestSrc, "utf-8");
  const manifest = JSON.parse(manifestRaw) as {
    hooks?: Record<
      string,
      Array<{ matcher?: string; command?: string; hooks?: Array<{ command?: string }> }>
    >;
  };

  const handlerNames = new Set<string>();
  for (const eventArr of Object.values(manifest.hooks ?? {})) {
    for (const entry of eventArr) {
      // Claude: entry.hooks[*].command
      if (Array.isArray(entry.hooks)) {
        for (const h of entry.hooks) {
          if (typeof h.command === "string") {
            const name = extractHandlerName(h.command);
            if (name) handlerNames.add(name);
          }
        }
      }
      // Codex: entry.command directly
      if (typeof entry.command === "string") {
        const name = extractHandlerName(entry.command);
        if (name) handlerNames.add(name);
      }
    }
  }

  // 2. Copy manifest → <target>/hooks/hooks.json
  const hooksJsonDest = join(opts.targetDir, "hooks", "hooks.json");
  if (!opts.dryRun) {
    mkdirSync(dirname(hooksJsonDest), { recursive: true });
    copyFileSync(manifestSrc, hooksJsonDest);
  }
  written.push("hooks/hooks.json");

  // 3. Copy each registered handler → <target>/dist/hooks/<name>.js
  for (const name of handlerNames) {
    const src = join(DIST_HOOKS_DIR, `${name}.js`);
    const dest = join(opts.targetDir, "dist", "hooks", `${name}.js`);
    if (!existsSync(src)) {
      throw new Error(
        `[build-hooks] Missing prebuilt handler ${src}. Manifest references "${name}" but the bundle is absent. ` +
          `Re-run \`bun run build\` in the nexus-core dev workspace before publishing.`,
      );
    }
    if (!opts.dryRun) {
      mkdirSync(dirname(dest), { recursive: true });
      copyFileSync(src, dest);
    }
    written.push(`dist/hooks/${name}.js`);
  }

  return { written, skipped };
}

/**
 * Extract the handler basename from a Claude/Codex hook command.
 *
 * Commands look like: `node ${CLAUDE_PLUGIN_ROOT}/dist/hooks/<name>.js`.
 * Returns the <name> portion, or null if the command doesn't match.
 */
function extractHandlerName(command: string): string | null {
  const match = command.match(/dist\/hooks\/([^/]+)\.js\s*$/);
  return match ? match[1]! : null;
}

// Run when executed directly (bun run scripts/build-hooks.ts)
if (
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith("build-hooks.ts") ||
  process.argv[1]?.endsWith("build-hooks.js")
) {
  buildHooks().catch((err: unknown) => {
    process.stderr.write(`[build-hooks] FATAL: ${String(err)}\n`);
    process.exit(1);
  });
}
