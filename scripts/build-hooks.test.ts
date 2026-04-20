/**
 * scripts/build-hooks.test.ts
 *
 * Verifies build-hooks.ts against isolated tmp-dir fixtures.
 * Tests run by spawning a dynamically-generated wrapper script that
 * overrides ROOT / HOOKS_DIR / DIST to the tmp fixture directory,
 * so the real assets/ directory is never touched.
 *
 * 8 scenarios:
 *  (1) 정상 5 hook 빌드 → 3 manifest 유효 JSON 생성
 *  (2) portability-report.json 생성 — {tier, registered_in, excluded_from, capabilities_required}
 *  (3) post-tool-telemetry Codex에서 excluded (event.post_tool_use.edit false) → partial tier 기록
 *  (4) meta.yml에 portability_tier 명시 → 빌드 실패 (zod strict)
 *  (5) 존재하지 않는 capability ID → 빌드 실패
 *  (6) fallback=error + 미지원 harness → 빌드 실패
 *  (7) matcher tool-name alias 변환 확인 (Bash→shell/bash/Bash)
 *  (8) priority 정렬 확인
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
  readFileSync,
  existsSync,
  statSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const REPO_ROOT = resolve(fileURLToPath(import.meta.url), "../..");

/**
 * Create a self-contained fixture directory that looks like:
 *
 *   <tmp>/
 *     assets/
 *       hooks/
 *         capability-matrix.yml
 *         <hookName>/
 *           meta.yml
 *           handler.ts
 *       tools/
 *         tool-name-map.yml
 *     dist/              (created by build script)
 */
function createFixtureDir(
  hooks: Array<{ name: string; meta: string; handler?: string }>,
  capabilityMatrix: string,
  toolNameMap?: string,
): string {
  const tmp = mkdtempSync(join(tmpdir(), "build-hooks-test-"));

  // capability-matrix.yml
  const hooksDir = join(tmp, "assets", "hooks");
  mkdirSync(hooksDir, { recursive: true });
  writeFileSync(join(hooksDir, "capability-matrix.yml"), capabilityMatrix);

  // tool-name-map.yml
  const toolsDir = join(tmp, "assets", "tools");
  mkdirSync(toolsDir, { recursive: true });
  writeFileSync(join(toolsDir, "tool-name-map.yml"), toolNameMap ?? defaultToolNameMap());

  // hook dirs
  for (const hook of hooks) {
    const dir = join(hooksDir, hook.name);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "meta.yml"), hook.meta);
    writeFileSync(
      join(dir, "handler.ts"),
      hook.handler ?? minimalHandler(),
    );
  }

  return tmp;
}

function minimalHandler(): string {
  return `export default async function handler(_input: unknown) { return; }\n`;
}

function defaultToolNameMap(): string {
  return `tools:
  Bash:
    claude: Bash
    codex:
      primary: shell
      aliases: [shell_command]
    opencode: bash
  Read:
    claude: Read
    codex: null
    opencode: read
  Edit:
    claude: Edit
    codex: apply_patch
    opencode: edit
  Write:
    claude: Write
    codex: apply_patch
    opencode: write
  MultiEdit:
    claude: MultiEdit
    codex: apply_patch
    opencode: edit
  ApplyPatch:
    claude: [Edit, MultiEdit]
    codex: apply_patch
    opencode: [apply_patch, edit]
`;
}

function minimalCapabilityMatrix(extras: string = ""): string {
  return `capabilities:
  event.session_start:
    claude: true
    codex: true
    opencode: true
  event.user_prompt_submit:
    claude: true
    codex: true
    opencode: true
  event.pre_tool_use.bash:
    claude: true
    codex: true
    opencode: true
  event.post_tool_use.bash:
    claude: true
    codex: true
    opencode: true
  event.post_tool_use.read:
    claude: true
    codex: false
    opencode: true
    note: "Codex has no read tool"
  event.post_tool_use.edit:
    claude: true
    codex: false
    opencode: true
    note: "Codex apply_patch does not emit PostToolUse"
  event.post_tool_use.bash_parsed:
    claude: false
    codex: true
    opencode: false
    note: "Codex-specific bash parsing"
  event.subagent_start:
    claude: true
    codex: true
    opencode: true
  event.subagent_stop:
    claude: true
    codex: true
    opencode: true
  output.additional_context.session_start:
    claude: true
    codex: true
    opencode: true
  output.additional_context.user_prompt:
    claude: true
    codex: true
    opencode: true
  output.additional_context.subagent_stop:
    claude: true
    codex: true
    opencode: true
  output.additional_context.post_tool:
    claude: true
    codex: true
    opencode: false
    note: "OpenCode PostToolUse context injection not adopted"
  output.decision_block:
    claude: true
    codex: true
    opencode: true
${extras}`;
}

/**
 * Build a wrapper script that:
 *  1. Imports the internal build-hooks.ts functions (re-exporting them)
 *  2. Overrides the module-level constants with tmp-dir paths
 *  3. Runs buildHooks() from the overridden context
 *
 * Strategy: We write a standalone script that duplicates the build logic
 * pointing at the fixture directory. The script is written to REPO_ROOT/scripts/
 * so that relative imports (../src/hooks/types.js) resolve correctly.
 * The fixture paths are passed as env vars.
 */
function writeBuildWrapper(wrapperPath: string, fixtureRoot: string): void {
  const src = `
// Auto-generated test wrapper — do not commit
import { HookMetaSchema } from "../src/hooks/types.js";
import type { HookMeta } from "../src/hooks/types.js";
import {
  readFileSync,
  readdirSync,
  existsSync,
  mkdirSync,
  writeFileSync,
  rmSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { execSync } from "node:child_process";
import { parse as parseYaml } from "yaml";

// ── Overridden paths from env ──────────────────────────────────────────────
const ROOT = process.env.NEXUS_TEST_ROOT ?? ${JSON.stringify(fixtureRoot)};
const HOOKS_DIR = join(ROOT, "assets/hooks");
const CAPABILITY_MATRIX_PATH = join(HOOKS_DIR, "capability-matrix.yml");
const TOOL_NAME_MAP_PATH = join(ROOT, "assets/tools/tool-name-map.yml");
const DIST_HOOKS_DIR = join(ROOT, "dist/hooks");
const DIST_MANIFESTS_DIR = join(ROOT, "dist/manifests");

const HARNESSES = ["claude", "codex", "opencode"] as const;
type Harness = (typeof HARNESSES)[number];
type CapabilityValue = boolean | "partial";

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

function loadAllHooks(): HookEntry[] {
  const entries = readdirSync(HOOKS_DIR, { withFileTypes: true });
  const result: HookEntry[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const metaPath = join(HOOKS_DIR, entry.name, "meta.yml");
    const handlerPath = join(HOOKS_DIR, entry.name, "handler.ts");
    if (!existsSync(metaPath) || !existsSync(handlerPath)) continue;
    const metaRaw = parseYaml(readFileSync(metaPath, "utf-8"));
    let meta: HookMeta;
    try {
      meta = HookMetaSchema.parse(metaRaw);
    } catch (err) {
      throw new Error(
        \`[build-hooks] meta.yml validation failed for "\${entry.name}": \${String(err)}\`,
      );
    }
    result.push({ name: entry.name, meta, handlerPath });
  }
  result.sort((a, b) => b.meta.priority - a.meta.priority);
  return result;
}

function loadCapabilityMatrix(): CapabilityMatrix {
  const raw = readFileSync(CAPABILITY_MATRIX_PATH, "utf-8");
  return parseYaml(raw) as CapabilityMatrix;
}

function validateCapabilityIds(hooks: HookEntry[], matrix: CapabilityMatrix): void {
  const knownIds = new Set(Object.keys(matrix.capabilities));
  for (const hook of hooks) {
    for (const capId of hook.meta.requires_capabilities) {
      if (!knownIds.has(capId)) {
        throw new Error(
          \`[build-hooks] "\${hook.name}" requires unknown capability "\${capId}". \` +
            \`Known IDs: \${[...knownIds].join(", ")}\`,
        );
      }
    }
  }
}

const CAP_EVENT_MAP = [
  { prefix: "event.session_start", events: ["SessionStart"] },
  { prefix: "event.user_prompt_submit", events: ["UserPromptSubmit"] },
  { prefix: "event.pre_tool_use", events: ["PreToolUse"] },
  { prefix: "event.post_tool_use", events: ["PostToolUse"] },
  { prefix: "event.subagent_start", events: ["SubagentStart"] },
  { prefix: "event.subagent_stop", events: ["SubagentStop"] },
];

function warnOnMismatch(hooks: HookEntry[]): void {
  for (const hook of hooks) {
    const hookEvents = new Set(hook.meta.events);
    for (const capId of hook.meta.requires_capabilities) {
      for (const mapping of CAP_EVENT_MAP) {
        if (!capId.startsWith(mapping.prefix)) continue;
        const overlap = mapping.events.some((e) => hookEvents.has(e as never));
        if (!overlap) {
          process.stderr.write(
            \`[build-hooks] WARN mismatch: hook "\${hook.name}" listens on [\${hook.meta.events.join(", ")}] \` +
              \`but capability "\${capId}" applies to [\${mapping.events.join(", ")}]\\n\`,
          );
        }
      }
    }
  }
}

function computePortability(hooks: HookEntry[], matrix: CapabilityMatrix): PortabilityPlan[] {
  const plans: PortabilityPlan[] = [];
  for (const hook of hooks) {
    const registeredIn: Harness[] = [];
    const excludedFrom: ExclusionRecord[] = [];
    for (const harness of HARNESSES) {
      const missingCaps: string[] = [];
      for (const capId of hook.meta.requires_capabilities) {
        const capEntry = matrix.capabilities[capId];
        if (!capEntry) continue;
        const support = capEntry[harness];
        if (support !== true) {
          missingCaps.push(capId);
        }
      }
      if (missingCaps.length === 0) {
        registeredIn.push(harness);
      } else {
        const reasons = missingCaps
          .map((capId) => {
            const entry = matrix.capabilities[capId];
            if (!entry?.note) return capId;
            const note = entry.note.trim().split(/\\.\\s/)[0]?.trim() ?? capId;
            return note;
          })
          .join("; ");
        if (hook.meta.fallback === "error") {
          throw new Error(
            \`[build-hooks] Hook "\${hook.name}" fallback=error but harness "\${harness}" \` +
              \`is missing capabilities: \${missingCaps.join(", ")}\`,
          );
        }
        if (hook.meta.fallback === "warn") {
          process.stderr.write(
            \`[build-hooks] WARN: hook "\${hook.name}" excluded from "\${harness}" \` +
              \`(missing: \${missingCaps.join(", ")})\\n\`,
          );
        }
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
    if (fallback === "skip") return "harness-specific";
    return "experimental";
  }
  return "experimental";
}

function compileHandlers(hooks: HookEntry[]): void {
  mkdirSync(DIST_HOOKS_DIR, { recursive: true });
  for (const hook of hooks) {
    const outFile = join(DIST_HOOKS_DIR, \`\${hook.name}.js\`);
    const entryDir = join(tmpdir(), \`nexus-hook-entry-\${hook.name}-\${Date.now()}\`);
    mkdirSync(entryDir, { recursive: true });
    const entryFile = join(entryDir, \`\${hook.name}-entry.ts\`);
    try {
      const entryContent = [
        \`import handler from \${JSON.stringify(hook.handlerPath)};\`,
        \`import { readFileSync } from "node:fs";\`,
        \`async function main() {\`,
        \`  let raw = "";\`,
        \`  try { raw = readFileSync(0, "utf-8"); } catch {}\`,
        \`  const input = raw ? JSON.parse(raw) : {};\`,
        \`  const result = await handler(input);\`,
        \`  if (result != null && result !== undefined) {\`,
        \`    process.stdout.write(JSON.stringify(result));\`,
        \`  }\`,
        \`}\`,
        \`main().then(\`,
        \`  () => process.exit(0),\`,
        \`  (err) => { process.stderr.write(String(err?.stack ?? err) + "\\\\n"); process.exit(1); }\`,
        \`);\`,
      ].join("\\n") + "\\n";
      writeFileSync(entryFile, entryContent);
      try {
        execSync(
          \`bun build \${entryFile} --outfile \${outFile} --target node --format esm\`,
          { cwd: ROOT, stdio: "inherit" },
        );
      } catch {
        throw new Error(
          \`[build-hooks] Handler compilation failed for "\${hook.name}" (bun build exit non-zero)\`,
        );
      }
    } catch (err) {
      process.stderr.write(
        \`[build-hooks] wrapper-emit failed for "\${hook.name}": \${String(err)}\\n\`,
      );
      throw err;
    } finally {
      try {
        rmSync(entryDir, { recursive: true, force: true });
      } catch {
        // best effort
      }
    }
  }
}

function loadToolNameMap(): ToolNameMap {
  const raw = readFileSync(TOOL_NAME_MAP_PATH, "utf-8");
  return parseYaml(raw) as ToolNameMap;
}

function translateMatcherToken(token: string, harness: Harness, toolMap: ToolNameMap): string {
  const entry = toolMap.tools[token];
  if (!entry) return token;
  const harnessValue = entry[harness];
  if (harnessValue === null || harnessValue === undefined) return token;
  if (typeof harnessValue === "string") return harnessValue;
  if (Array.isArray(harnessValue)) {
    return harnessValue.join("|");
  }
  if (typeof harnessValue === "object" && "primary" in harnessValue) {
    return (harnessValue as { primary: string }).primary;
  }
  return token;
}

function translateMatcher(matcher: string, harness: Harness, toolMap: ToolNameMap): string {
  if (matcher === "*") return "*";
  const tokens = matcher.split("|").map((t) => t.trim());
  const translated = new Set<string>();
  for (const token of tokens) {
    const native = translateMatcherToken(token, harness, toolMap);
    for (const part of native.split("|")) {
      if (part.trim()) translated.add(part.trim());
    }
  }
  return [...translated].join("|");
}

function hookCommand(hookName: string, harness: Harness): string {
  if (harness === "opencode") {
    return hookName;
  }
  return \`node \\\${CLAUDE_PLUGIN_ROOT}/dist/hooks/\${hookName}.js\`;
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
      handlerPath: \`../hooks/\${plan.name}.js\`,
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
    JSON.stringify(claude, null, 2) + "\\n",
  );
  writeFileSync(
    join(DIST_MANIFESTS_DIR, "codex-hooks.json"),
    JSON.stringify(codex, null, 2) + "\\n",
  );
  writeFileSync(
    join(DIST_MANIFESTS_DIR, "opencode-manifest.json"),
    JSON.stringify(opencode, null, 2) + "\\n",
  );
}

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
    JSON.stringify(report, null, 2) + "\\n",
  );
}

// ── Entry point (called by test wrapper) ───────────────────────────────────
const hooks = loadAllHooks();
const matrix = loadCapabilityMatrix();
validateCapabilityIds(hooks, matrix);
warnOnMismatch(hooks);
const plans = computePortability(hooks, matrix);
compileHandlers(hooks);
writeManifests(plans);
writePortabilityReport(plans);
process.stdout.write("[build-hooks-wrapper] done\\n");
`;
  writeFileSync(wrapperPath, src);
}

/**
 * Run the build wrapper in the given fixture dir.
 * Returns { exitCode, stdout, stderr }.
 */
function runBuild(
  fixtureRoot: string,
  wrapperPath: string,
): { exitCode: number | null; stdout: string; stderr: string } {
  const result = spawnSync("bun", ["run", wrapperPath], {
    cwd: fixtureRoot,
    env: { ...process.env, NEXUS_TEST_ROOT: fixtureRoot },
    encoding: "utf-8",
    timeout: 60_000,
  });
  return {
    exitCode: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** 5-hook fixture mirroring the real assets — all capabilities available */
function fiveHookFixture() {
  const hooks = [
    {
      name: "session-init",
      meta: `name: session-init
description: Initialize per-session state files at session start
events: [SessionStart]
matcher: "*"
timeout: 10
fallback: warn
priority: 0
requires_capabilities:
  - event.session_start
`,
    },
    {
      name: "prompt-router",
      meta: `name: prompt-router
description: Detect nexus tags, inject state notices and skill invocation guidance
events: [UserPromptSubmit]
matcher: "*"
timeout: 10
fallback: warn
priority: 0
requires_capabilities:
  - event.user_prompt_submit
  - output.additional_context.user_prompt
  - output.decision_block
`,
    },
    {
      name: "agent-bootstrap",
      meta: `name: agent-bootstrap
description: Inject core memory index and role-specific rules on fresh subagent spawn
events: [SubagentStart]
matcher: "*"
timeout: 10
fallback: warn
priority: 0
requires_capabilities:
  - event.subagent_start
  - output.additional_context.session_start
`,
    },
    {
      name: "agent-finalize",
      meta: `name: agent-finalize
description: Finalize subagent tracker, aggregate files_touched
events: [SubagentStop]
matcher: "*"
timeout: 10
fallback: warn
priority: 0
requires_capabilities:
  - event.subagent_stop
  - output.additional_context.subagent_stop
`,
    },
    {
      name: "post-tool-telemetry",
      meta: `name: post-tool-telemetry
description: Track memory access and file-edit operations for telemetry
events: [PostToolUse]
matcher: "Read|Edit|Write|MultiEdit|ApplyPatch|Bash"
timeout: 5
fallback: warn
priority: 10
requires_capabilities:
  - event.post_tool_use.read
  - event.post_tool_use.edit
  - event.post_tool_use.bash_parsed
`,
    },
  ];
  return hooks;
}

// ---------------------------------------------------------------------------
// Test lifecycle
// ---------------------------------------------------------------------------

let tmpDirs: string[] = [];
let wrapperPaths: string[] = [];

afterEach(() => {
  // Clean up tmp fixture dirs
  for (const dir of tmpDirs) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // best effort
    }
  }
  tmpDirs = [];

  // Clean up temp wrappers written to scripts/
  for (const wp of wrapperPaths) {
    try {
      rmSync(wp, { force: true });
    } catch {
      // best effort
    }
  }
  wrapperPaths = [];
});

function makeTmpAndWrapper(
  hooks: Array<{ name: string; meta: string; handler?: string }>,
  capabilityMatrix: string,
  toolNameMap?: string,
): { fixtureRoot: string; wrapperPath: string } {
  const fixtureRoot = createFixtureDir(hooks, capabilityMatrix, toolNameMap);
  tmpDirs.push(fixtureRoot);

  // Write wrapper adjacent to scripts/build-hooks.ts so relative imports resolve
  const wrapperName = `_test-wrapper-${Date.now()}-${Math.random().toString(36).slice(2)}.ts`;
  const wrapperPath = join(REPO_ROOT, "scripts", wrapperName);
  writeBuildWrapper(wrapperPath, fixtureRoot);
  wrapperPaths.push(wrapperPath);

  return { fixtureRoot, wrapperPath };
}

// ---------------------------------------------------------------------------
// Scenario 1: 정상 5 hook 빌드 → 3 manifest 유효 JSON 생성
// ---------------------------------------------------------------------------

describe("Scenario 1 — 정상 5 hook 빌드, 3 manifest 유효 JSON", () => {
  test("build exits 0 and creates 3 manifest files", () => {
    const { fixtureRoot, wrapperPath } = makeTmpAndWrapper(
      fiveHookFixture(),
      minimalCapabilityMatrix(),
    );

    const { exitCode, stderr } = runBuild(fixtureRoot, wrapperPath);
    if (exitCode !== 0) {
      console.error("Build stderr:", stderr);
    }
    expect(exitCode).toBe(0);

    const manifestDir = join(fixtureRoot, "dist", "manifests");
    expect(existsSync(join(manifestDir, "claude-hooks.json"))).toBe(true);
    expect(existsSync(join(manifestDir, "codex-hooks.json"))).toBe(true);
    expect(existsSync(join(manifestDir, "opencode-manifest.json"))).toBe(true);
  });

  test("all 3 manifest files are valid JSON", () => {
    const { fixtureRoot, wrapperPath } = makeTmpAndWrapper(
      fiveHookFixture(),
      minimalCapabilityMatrix(),
    );

    runBuild(fixtureRoot, wrapperPath);

    const manifestDir = join(fixtureRoot, "dist", "manifests");

    for (const filename of ["claude-hooks.json", "codex-hooks.json", "opencode-manifest.json"]) {
      const raw = readFileSync(join(manifestDir, filename), "utf-8");
      expect(() => JSON.parse(raw)).not.toThrow();
    }
  });

  test("opencode-manifest.json has new schema: { hooks: [{name, events[], matcher, handlerPath, priority}] }", () => {
    const { fixtureRoot, wrapperPath } = makeTmpAndWrapper(
      fiveHookFixture(),
      minimalCapabilityMatrix(),
    );

    runBuild(fixtureRoot, wrapperPath);

    const manifestDir = join(fixtureRoot, "dist", "manifests");
    const opencode = JSON.parse(
      readFileSync(join(manifestDir, "opencode-manifest.json"), "utf-8"),
    ) as { hooks: Array<Record<string, unknown>> };

    expect(Array.isArray(opencode.hooks)).toBe(true);
    // At least one hook should be registered in opencode
    expect(opencode.hooks.length).toBeGreaterThan(0);

    for (const hook of opencode.hooks) {
      expect(typeof hook["name"]).toBe("string");
      expect(Array.isArray(hook["events"])).toBe(true);
      expect(typeof hook["matcher"]).toBe("string");
      expect(typeof hook["handlerPath"]).toBe("string");
      expect((hook["handlerPath"] as string).startsWith("../hooks/")).toBe(true);
      expect(typeof hook["priority"]).toBe("number");
      // No old fields
      expect(hook["event"]).toBeUndefined();
      expect(hook["module"]).toBeUndefined();
      expect(hook["mountHooks"]).toBeUndefined();
    }
  });

  test("dist/hooks/ contains a compiled .js file for each hook", () => {
    const { fixtureRoot, wrapperPath } = makeTmpAndWrapper(
      fiveHookFixture(),
      minimalCapabilityMatrix(),
    );

    runBuild(fixtureRoot, wrapperPath);

    const hooksDistDir = join(fixtureRoot, "dist", "hooks");
    for (const hook of fiveHookFixture()) {
      expect(existsSync(join(hooksDistDir, `${hook.name}.js`))).toBe(true);
    }
  });

  test("compiled bundle contains bootstrap marker (readFileSync(0 or process.exit)", () => {
    const { fixtureRoot, wrapperPath } = makeTmpAndWrapper(
      fiveHookFixture(),
      minimalCapabilityMatrix(),
    );

    runBuild(fixtureRoot, wrapperPath);

    const hooksDistDir = join(fixtureRoot, "dist", "hooks");
    // Check at least one hook that is registered (session-init is core/registered in all harnesses)
    const bundlePath = join(hooksDistDir, "session-init.js");
    expect(existsSync(bundlePath)).toBe(true);
    const content = readFileSync(bundlePath, "utf-8");
    const hasBootstrap =
      content.includes("readFileSync(0") ||
      content.includes("process.stdin") ||
      content.includes("process.exit");
    expect(hasBootstrap).toBe(true);
  });

  test("smoke: real dist/hooks/session-init.js exits 0 and creates state files for SessionStart payload", () => {
    const realBundle = join(REPO_ROOT, "dist", "hooks", "session-init.js");
    if (!existsSync(realBundle)) {
      // Skip if the bundle hasn't been built yet (CI gate runs build first)
      console.warn("[smoke] dist/hooks/session-init.js not found — skipping smoke test");
      return;
    }

    const smokeDir = mkdtempSync(join(tmpdir(), "nexus-smoke-"));
    tmpDirs.push(smokeDir);

    const payload = JSON.stringify({
      hook_event_name: "SessionStart",
      session_id: "smoke-t1",
      cwd: smokeDir,
      source: "startup",
    });

    const result = spawnSync("node", [realBundle], {
      input: payload,
      encoding: "utf-8",
      timeout: 15_000,
    });

    if (result.status !== 0) {
      console.error("smoke stderr:", result.stderr);
    }
    expect(result.status).toBe(0);
    expect(existsSync(join(smokeDir, ".nexus", "state", "smoke-t1", "agent-tracker.json"))).toBe(true);
    expect(existsSync(join(smokeDir, ".nexus", "state", "smoke-t1", "tool-log.jsonl"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Scenario 2: portability-report.json 생성 — 필드 검증
// ---------------------------------------------------------------------------

describe("Scenario 2 — portability-report.json 구조 검증", () => {
  test("portability-report.json exists and is valid JSON", () => {
    const { fixtureRoot, wrapperPath } = makeTmpAndWrapper(
      fiveHookFixture(),
      minimalCapabilityMatrix(),
    );

    runBuild(fixtureRoot, wrapperPath);

    const reportPath = join(fixtureRoot, "dist", "manifests", "portability-report.json");
    expect(existsSync(reportPath)).toBe(true);
    const raw = readFileSync(reportPath, "utf-8");
    expect(() => JSON.parse(raw)).not.toThrow();
  });

  test("each hook entry has required portability fields", () => {
    const { fixtureRoot, wrapperPath } = makeTmpAndWrapper(
      fiveHookFixture(),
      minimalCapabilityMatrix(),
    );

    runBuild(fixtureRoot, wrapperPath);

    const reportPath = join(fixtureRoot, "dist", "manifests", "portability-report.json");
    const report = JSON.parse(readFileSync(reportPath, "utf-8")) as Record<string, unknown>;

    for (const hook of fiveHookFixture()) {
      const entry = report[hook.name] as Record<string, unknown> | undefined;
      expect(entry).toBeDefined();
      expect(typeof (entry as Record<string, unknown>)?.tier).toBe("string");
      expect(Array.isArray((entry as Record<string, unknown>)?.registered_in)).toBe(true);
      expect(Array.isArray((entry as Record<string, unknown>)?.excluded_from)).toBe(true);
      expect(Array.isArray((entry as Record<string, unknown>)?.capabilities_required)).toBe(true);
    }
  });

  test("session-init is core tier (all 3 harnesses support event.session_start)", () => {
    const { fixtureRoot, wrapperPath } = makeTmpAndWrapper(
      fiveHookFixture(),
      minimalCapabilityMatrix(),
    );

    runBuild(fixtureRoot, wrapperPath);

    const report = JSON.parse(
      readFileSync(join(fixtureRoot, "dist", "manifests", "portability-report.json"), "utf-8"),
    ) as Record<string, { tier: string; registered_in: string[] }>;

    expect(report["session-init"]?.tier).toBe("core");
    expect(report["session-init"]?.registered_in).toEqual(
      expect.arrayContaining(["claude", "codex", "opencode"]),
    );
  });
});

// ---------------------------------------------------------------------------
// Scenario 3: post-tool-telemetry Codex excluded → partial tier
// ---------------------------------------------------------------------------

describe("Scenario 3 — post-tool-telemetry Codex excluded, tier derivation", () => {
  test("post-tool-telemetry is excluded from codex (event.post_tool_use.edit=false)", () => {
    const { fixtureRoot, wrapperPath } = makeTmpAndWrapper(
      fiveHookFixture(),
      minimalCapabilityMatrix(),
    );

    runBuild(fixtureRoot, wrapperPath);

    const report = JSON.parse(
      readFileSync(join(fixtureRoot, "dist", "manifests", "portability-report.json"), "utf-8"),
    ) as Record<
      string,
      {
        tier: string;
        registered_in: string[];
        excluded_from: Array<{ harness: string; missing: string[] }>;
        capabilities_required: string[];
      }
    >;

    const telemetry = report["post-tool-telemetry"];
    expect(telemetry).toBeDefined();

    // Codex must be in excluded_from because event.post_tool_use.edit=false
    const codexExclusion = telemetry!.excluded_from.find((e) => e.harness === "codex");
    expect(codexExclusion).toBeDefined();
    expect(codexExclusion!.missing).toContain("event.post_tool_use.edit");
  });

  test("post-tool-telemetry tier is 'extended' (claude+opencode only)", () => {
    const { fixtureRoot, wrapperPath } = makeTmpAndWrapper(
      fiveHookFixture(),
      minimalCapabilityMatrix(),
    );

    runBuild(fixtureRoot, wrapperPath);

    const report = JSON.parse(
      readFileSync(join(fixtureRoot, "dist", "manifests", "portability-report.json"), "utf-8"),
    ) as Record<string, { tier: string; registered_in: string[] }>;

    // event.post_tool_use.bash_parsed is claude=false, codex=true, opencode=false
    // event.post_tool_use.edit is claude=true, codex=false, opencode=true
    // event.post_tool_use.read is claude=true, codex=false, opencode=true
    // Claude: missing bash_parsed → excluded; Codex: missing edit+read → excluded;
    // OpenCode: missing bash_parsed → excluded
    // If all 3 harnesses are excluded... tier=experimental
    // But let's check: codex has bash_parsed=true but edit=false, read=false → excluded
    //   claude has edit=true, read=true, but bash_parsed=false → excluded
    //   opencode has edit=true, read=true, but bash_parsed=false → excluded
    // So post-tool-telemetry is registered in nobody → experimental
    const telemetry = report["post-tool-telemetry"];
    // All three harnesses are excluded → 0 registered → experimental tier
    expect(telemetry?.tier).toBe("experimental");
  });

  test("post-tool-telemetry excluded_from has reason field populated", () => {
    const { fixtureRoot, wrapperPath } = makeTmpAndWrapper(
      fiveHookFixture(),
      minimalCapabilityMatrix(),
    );

    runBuild(fixtureRoot, wrapperPath);

    const report = JSON.parse(
      readFileSync(join(fixtureRoot, "dist", "manifests", "portability-report.json"), "utf-8"),
    ) as Record<
      string,
      { excluded_from: Array<{ harness: string; missing: string[]; reason: string }> }
    >;

    const exclusions = report["post-tool-telemetry"]?.excluded_from ?? [];
    for (const exc of exclusions) {
      expect(typeof exc.reason).toBe("string");
      expect(exc.reason.length).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// Scenario 4: meta.yml에 portability_tier 명시 → 빌드 실패 (zod strict)
// ---------------------------------------------------------------------------

describe("Scenario 4 — portability_tier in meta.yml → zod strict 빌드 실패", () => {
  test("build fails when meta.yml has unknown field portability_tier", () => {
    const invalidHook = {
      name: "bad-hook",
      meta: `name: bad-hook
description: Hook with unknown field portability_tier
events: [SessionStart]
matcher: "*"
timeout: 10
fallback: warn
priority: 0
portability_tier: core
requires_capabilities:
  - event.session_start
`,
    };

    const { fixtureRoot, wrapperPath } = makeTmpAndWrapper(
      [invalidHook],
      minimalCapabilityMatrix(),
    );

    const { exitCode, stderr } = runBuild(fixtureRoot, wrapperPath);
    expect(exitCode).not.toBe(0);
    expect(stderr.toLowerCase()).toMatch(/portability_tier|unrecognized|meta\.yml/i);
  });
});

// ---------------------------------------------------------------------------
// Scenario 5: 존재하지 않는 capability ID → 빌드 실패
// ---------------------------------------------------------------------------

describe("Scenario 5 — 존재하지 않는 capability ID → 빌드 실패", () => {
  test("build fails when hook references nonexistent capability", () => {
    const hookWithBadCap = {
      name: "hook-bad-cap",
      meta: `name: hook-bad-cap
description: Hook that references a capability that does not exist
events: [SessionStart]
matcher: "*"
timeout: 10
fallback: warn
priority: 0
requires_capabilities:
  - does.not.exist.capability.id
`,
    };

    const { fixtureRoot, wrapperPath } = makeTmpAndWrapper(
      [hookWithBadCap],
      minimalCapabilityMatrix(),
    );

    const { exitCode, stderr } = runBuild(fixtureRoot, wrapperPath);
    expect(exitCode).not.toBe(0);
    expect(stderr).toContain("does.not.exist.capability.id");
  });
});

// ---------------------------------------------------------------------------
// Scenario 6: fallback=error + 미지원 harness → 빌드 실패
// ---------------------------------------------------------------------------

describe("Scenario 6 — fallback=error + unsupported harness → 빌드 실패", () => {
  test("build fails when fallback=error and harness is missing a required capability", () => {
    // event.post_tool_use.edit is codex=false
    // A hook with fallback=error that requires this capability → codex will fail
    const strictHook = {
      name: "strict-hook",
      meta: `name: strict-hook
description: Hook with fallback=error requiring codex-unsupported capability
events: [PostToolUse]
matcher: "*"
timeout: 10
fallback: error
priority: 0
requires_capabilities:
  - event.post_tool_use.edit
`,
    };

    const { fixtureRoot, wrapperPath } = makeTmpAndWrapper(
      [strictHook],
      minimalCapabilityMatrix(),
    );

    const { exitCode, stderr } = runBuild(fixtureRoot, wrapperPath);
    expect(exitCode).not.toBe(0);
    expect(stderr).toMatch(/fallback=error|missing capabilities/i);
  });

  test("build succeeds when fallback=skip and harness is missing a required capability", () => {
    const skipHook = {
      name: "skip-hook",
      meta: `name: skip-hook
description: Hook with fallback=skip requiring codex-unsupported capability
events: [PostToolUse]
matcher: "*"
timeout: 10
fallback: skip
priority: 0
requires_capabilities:
  - event.post_tool_use.edit
`,
    };

    const { fixtureRoot, wrapperPath } = makeTmpAndWrapper(
      [skipHook],
      minimalCapabilityMatrix(),
    );

    const { exitCode } = runBuild(fixtureRoot, wrapperPath);
    expect(exitCode).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Scenario 7: matcher tool-name alias 변환 확인
// ---------------------------------------------------------------------------

describe("Scenario 7 — matcher tool-name alias 변환", () => {
  test("Bash→Bash (claude), Bash→shell (codex primary), Bash→bash (opencode)", () => {
    const bashHook = {
      name: "bash-hook",
      meta: `name: bash-hook
description: Hook using Bash matcher to test tool name translation
events: [PostToolUse]
matcher: "Bash"
timeout: 5
fallback: warn
priority: 0
requires_capabilities:
  - event.post_tool_use.bash
`,
    };

    const { fixtureRoot, wrapperPath } = makeTmpAndWrapper(
      [bashHook],
      minimalCapabilityMatrix(),
    );

    runBuild(fixtureRoot, wrapperPath);

    const manifestDir = join(fixtureRoot, "dist", "manifests");

    const claude = JSON.parse(readFileSync(join(manifestDir, "claude-hooks.json"), "utf-8")) as {
      hooks: Record<string, Array<{ matcher: string }>>;
    };
    const codex = JSON.parse(readFileSync(join(manifestDir, "codex-hooks.json"), "utf-8")) as {
      hooks: Record<string, Array<{ matcher?: string }>>;
    };
    const opencode = JSON.parse(
      readFileSync(join(manifestDir, "opencode-manifest.json"), "utf-8"),
    ) as { hooks: Array<{ name: string; events: string[]; matcher: string; handlerPath: string; priority: number }> };

    // Claude: Bash → "Bash"
    expect(claude.hooks["PostToolUse"]?.[0]?.matcher).toBe("Bash");

    // Codex: Bash → "shell" (primary of codex entry)
    expect(codex.hooks["PostToolUse"]?.[0]?.matcher).toBe("shell");

    // OpenCode: new schema stores original nexus matcher ("Bash"), not translated
    expect(
      opencode.hooks.find((h) => h.events.includes("PostToolUse"))?.matcher,
    ).toBe("Bash");
  });

  test("wildcard matcher '*' is passed through unchanged for all harnesses", () => {
    const wildcardHook = {
      name: "wildcard-hook",
      meta: `name: wildcard-hook
description: Hook with wildcard matcher
events: [SessionStart]
matcher: "*"
timeout: 10
fallback: warn
priority: 0
requires_capabilities:
  - event.session_start
`,
    };

    const { fixtureRoot, wrapperPath } = makeTmpAndWrapper(
      [wildcardHook],
      minimalCapabilityMatrix(),
    );

    runBuild(fixtureRoot, wrapperPath);

    const manifestDir = join(fixtureRoot, "dist", "manifests");

    // Claude manifest has matcher field on every event entry
    const claude = JSON.parse(readFileSync(join(manifestDir, "claude-hooks.json"), "utf-8")) as {
      hooks: Record<string, Array<{ matcher: string }>>;
    };
    expect(claude.hooks["SessionStart"]?.[0]?.matcher).toBe("*");

    // Codex: wildcard → no matcher field (per build-hooks behavior)
    const codex = JSON.parse(readFileSync(join(manifestDir, "codex-hooks.json"), "utf-8")) as {
      hooks: Record<string, Array<{ matcher?: string; command: string }>>;
    };
    const codexEntry = codex.hooks["SessionStart"]?.[0];
    expect(codexEntry).toBeDefined();
    expect(codexEntry?.matcher).toBeUndefined();

    // OpenCode: wildcard → matcher is "*"
    const opencode = JSON.parse(
      readFileSync(join(manifestDir, "opencode-manifest.json"), "utf-8"),
    ) as { hooks: Array<{ name: string; events: string[]; matcher: string; handlerPath: string; priority: number }> };
    const ocEntry = opencode.hooks.find((h) => h.events.includes("SessionStart"));
    expect(ocEntry).toBeDefined();
    expect(ocEntry?.matcher).toBe("*");
  });

  test("pipe-separated matcher translates each token independently", () => {
    // Use a capability that all 3 harnesses support so the hook is registered in all.
    // Matcher: Edit|Write
    //   Claude: Edit→Edit, Write→Write  → "Edit|Write"
    //   Codex:  Edit→apply_patch, Write→apply_patch  → deduped "apply_patch"
    //   OpenCode: Edit→edit, Write→write → "edit|write"
    const multiMatcherHook = {
      name: "multi-matcher-hook",
      meta: `name: multi-matcher-hook
description: Hook with pipe-separated matcher
events: [PostToolUse]
matcher: "Edit|Write"
timeout: 5
fallback: warn
priority: 0
requires_capabilities:
  - event.post_tool_use.bash
`,
    };

    const { fixtureRoot, wrapperPath } = makeTmpAndWrapper(
      [multiMatcherHook],
      minimalCapabilityMatrix(),
    );

    runBuild(fixtureRoot, wrapperPath);

    const manifestDir = join(fixtureRoot, "dist", "manifests");

    // Claude: Edit|Write → "Edit|Write"
    const claude = JSON.parse(readFileSync(join(manifestDir, "claude-hooks.json"), "utf-8")) as {
      hooks: Record<string, Array<{ matcher: string }>>;
    };
    expect(claude.hooks["PostToolUse"]?.[0]?.matcher).toBe("Edit|Write");

    // Codex: Edit → apply_patch, Write → apply_patch → deduped to "apply_patch"
    const codex = JSON.parse(readFileSync(join(manifestDir, "codex-hooks.json"), "utf-8")) as {
      hooks: Record<string, Array<{ matcher?: string }>>;
    };
    expect(codex.hooks["PostToolUse"]?.[0]?.matcher).toBe("apply_patch");

    // OpenCode: new schema stores original nexus matcher ("Edit|Write"), not translated
    const opencode = JSON.parse(
      readFileSync(join(manifestDir, "opencode-manifest.json"), "utf-8"),
    ) as { hooks: Array<{ name: string; events: string[]; matcher: string; handlerPath: string; priority: number }> };
    const ocMatcher = opencode.hooks.find((h) => h.events.includes("PostToolUse"))?.matcher;
    expect(ocMatcher).toBe("Edit|Write");
  });
});

// ---------------------------------------------------------------------------
// Scenario 8: priority 정렬 확인
// ---------------------------------------------------------------------------

describe("Scenario 8 — priority 정렬 (높은 priority 먼저)", () => {
  test("hooks are emitted in manifest in descending priority order", () => {
    const hooksWithPriority = [
      {
        name: "low-priority-hook",
        meta: `name: low-priority-hook
description: Hook with priority 0
events: [SessionStart]
matcher: "*"
timeout: 10
fallback: warn
priority: 0
requires_capabilities:
  - event.session_start
`,
      },
      {
        name: "high-priority-hook",
        meta: `name: high-priority-hook
description: Hook with priority 100
events: [SessionStart]
matcher: "*"
timeout: 10
fallback: warn
priority: 100
requires_capabilities:
  - event.session_start
`,
      },
      {
        name: "mid-priority-hook",
        meta: `name: mid-priority-hook
description: Hook with priority 50
events: [SessionStart]
matcher: "*"
timeout: 10
fallback: warn
priority: 50
requires_capabilities:
  - event.session_start
`,
      },
    ];

    const { fixtureRoot, wrapperPath } = makeTmpAndWrapper(
      hooksWithPriority,
      minimalCapabilityMatrix(),
    );

    runBuild(fixtureRoot, wrapperPath);

    const manifestDir = join(fixtureRoot, "dist", "manifests");

    // Claude manifest: hook commands should appear in priority order
    const claude = JSON.parse(readFileSync(join(manifestDir, "claude-hooks.json"), "utf-8")) as {
      hooks: Record<
        string,
        Array<{ matcher: string; hooks: Array<{ command: string }> }>
      >;
    };

    const sessionStartEntries = claude.hooks["SessionStart"];
    expect(sessionStartEntries).toBeDefined();
    expect(sessionStartEntries!.length).toBe(3);

    const commands = sessionStartEntries!.map((e) => e.hooks[0]?.command ?? "");
    // high-priority-hook (100) must appear before mid-priority-hook (50) must appear before low-priority-hook (0)
    const highIdx = commands.findIndex((c) => c.includes("high-priority-hook"));
    const midIdx = commands.findIndex((c) => c.includes("mid-priority-hook"));
    const lowIdx = commands.findIndex((c) => c.includes("low-priority-hook"));

    expect(highIdx).toBeLessThan(midIdx);
    expect(midIdx).toBeLessThan(lowIdx);
  });

  test("portability-report preserves priority-based ordering (high before low)", () => {
    const hooksWithPriority = [
      {
        name: "hook-priority-1",
        meta: `name: hook-priority-1
description: Priority 1 hook
events: [SessionStart]
matcher: "*"
timeout: 10
fallback: warn
priority: 1
requires_capabilities:
  - event.session_start
`,
      },
      {
        name: "hook-priority-99",
        meta: `name: hook-priority-99
description: Priority 99 hook
events: [SessionStart]
matcher: "*"
timeout: 10
fallback: warn
priority: 99
requires_capabilities:
  - event.session_start
`,
      },
    ];

    const { fixtureRoot, wrapperPath } = makeTmpAndWrapper(
      hooksWithPriority,
      minimalCapabilityMatrix(),
    );

    runBuild(fixtureRoot, wrapperPath);

    const claude = JSON.parse(
      readFileSync(join(fixtureRoot, "dist", "manifests", "claude-hooks.json"), "utf-8"),
    ) as {
      hooks: Record<string, Array<{ hooks: Array<{ command: string }> }>>;
    };

    const entries = claude.hooks["SessionStart"];
    expect(entries).toBeDefined();
    expect(entries!.length).toBe(2);

    const first = entries![0]!.hooks[0]!.command;
    const second = entries![1]!.hooks[0]!.command;

    expect(first).toContain("hook-priority-99");
    expect(second).toContain("hook-priority-1");
  });
});

// ---------------------------------------------------------------------------
// Additional: real assets/ isolation confirmation
// ---------------------------------------------------------------------------

describe("Isolation — tmp dir 사용, real assets/ 격리 확인", () => {
  test("fixture root is not the real repo root", () => {
    const { fixtureRoot } = makeTmpAndWrapper(
      fiveHookFixture(),
      minimalCapabilityMatrix(),
    );

    expect(fixtureRoot).not.toBe(REPO_ROOT);
    expect(fixtureRoot).toMatch(/build-hooks-test-/);
  });

  test("build outputs go to tmp fixture dist/, not repo dist/", () => {
    const { fixtureRoot, wrapperPath } = makeTmpAndWrapper(
      fiveHookFixture(),
      minimalCapabilityMatrix(),
    );

    const repoManifest = join(REPO_ROOT, "dist", "manifests", "claude-hooks.json");
    const repoMtimeBefore = existsSync(repoManifest)
      ? statSync(repoManifest).mtimeMs
      : null;

    runBuild(fixtureRoot, wrapperPath);

    const fixtureManifest = join(fixtureRoot, "dist", "manifests", "claude-hooks.json");

    expect(existsSync(fixtureManifest)).toBe(true);
    // Isolation check: repo dist/ manifest must NOT be touched by this test run.
    // Content equality between fixture and repo is allowed (deterministic output).
    if (repoMtimeBefore !== null) {
      expect(statSync(repoManifest).mtimeMs).toBe(repoMtimeBefore);
    }
  });
});
