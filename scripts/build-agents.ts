/**
 * scripts/build-agents.ts
 *
 * Build pipeline for nexus agents and skills.
 *
 * Inputs:
 *   assets/agents/<n>/body.md  × 9 agents
 *   assets/skills/<n>/body.md  × 4 skills
 *   assets/capability-matrix.yml
 *   assets/tools/tool-name-map.yml (invocations section)
 *
 * Outputs per harness:
 *   dist/claude/
 *     .claude-plugin/plugin.json       (Template — skip if exists, --force to overwrite)
 *     .claude-plugin/marketplace.json  (Template — skip if exists, --force to overwrite)
 *     agents/<n>.md × N
 *     skills/<n>/SKILL.md × 4
 *     settings.json                    (Managed — primary agent injection, omitted if no primary)
 *
 *   dist/opencode/
 *     package.json                     (Template — skip if exists)
 *     src/index.ts                     (Managed — always overwrite)
 *     src/agents/<n>.ts × N           (Managed — always overwrite, mode:primary gets mode field)
 *     .opencode/skills/<n>/SKILL.md × 4  (Managed)
 *
 *   dist/codex/
 *     plugin/.codex-plugin/plugin.json (Managed)
 *     plugin/skills/<n>/SKILL.md × 4  (Managed)
 *     agents/<n>.toml × N             (Managed)
 *     prompts/<n>.md × N              (Managed)
 *     install/config.fragment.toml    (Managed)
 *     install/AGENTS.fragment.md      (Managed — primary agents only, omitted if none)
 *
 * Overwrite policy:
 *   Managed paths — always overwrite (unless --dry-run)
 *   Template paths — skip if file exists (overwrite only with --force)
 *
 * CLI flags:
 *   --harness=claude|opencode|codex   (default: all)
 *   --target=<dir>                    (default: dist/)
 *   --dry-run                         print affected files, no writes
 *   --force                           force Template file overwrite
 *   --strict                          error if Managed output has untracked modifications
 *   --only=<agent|skill name>         restrict to a single asset
 */

import {
  readFileSync,
  readdirSync,
  existsSync,
  mkdirSync,
  writeFileSync,
  statSync,
} from "node:fs";
import { join, resolve, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";
import { parse as parseYaml } from "yaml";
import { expandInvocations } from "../src/shared/invocations.js";
import type { InvocationsMap, Harness } from "../src/shared/invocations.js";
import { findPackageRoot } from "../src/shared/package-root.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const __dirname = dirname(fileURLToPath(import.meta.url));
export const ROOT = findPackageRoot(__dirname);
export const AGENTS_DIR = join(ROOT, "assets/agents");
export const SKILLS_DIR = join(ROOT, "assets/skills");
export const CAPABILITY_MATRIX_PATH = join(ROOT, "assets/capability-matrix.yml");
export const TOOL_NAME_MAP_PATH = join(ROOT, "assets/tools/tool-name-map.yml");

const HARNESSES = ["claude", "opencode", "codex"] as const;
const CODEX_MCP_NX_COMMAND = "nexus-mcp";

// ---------------------------------------------------------------------------
// Data shapes
// ---------------------------------------------------------------------------

export interface AgentFrontmatter {
  name: string;
  description: string;
  task?: string;
  alias_ko?: string;
  category: "how" | "do" | "check" | "lead";
  mode?: "primary" | "subagent" | "all";
  resume_tier?: "persistent" | "bounded" | "ephemeral";
  model_tier: "high" | "standard" | "low";
  capabilities: string[];
  id: string;
  // skill-specific fields
  summary?: string;
  triggers?: string[];
  manual_only?: boolean;
  harness_docs_refs?: string[];
}

export interface AssetEntry {
  type: "agent" | "skill";
  name: string;
  frontmatter: AgentFrontmatter;
  body: string; // raw body without frontmatter
  bodyPath: string;
}

export interface CapabilityMatrixEntry {
  claude?: {
    disallowedTools?: string[];
  };
  opencode?: {
    permission?: Record<string, string>;
  };
  codex?: {
    sandbox_mode?: string | null;
    disabled_tools?: string[];
  };
}

export interface CapabilityMatrix {
  capabilities: Record<string, CapabilityMatrixEntry>;
  model_tier: Record<string, { claude: string; codex: string; opencode: string | null }>;
}

export interface ToolNameMapInvocations {
  invocations: InvocationsMap;
}

export interface BuildOptions {
  harnesses: Harness[];
  targetDir: string;
  dryRun: boolean;
  force: boolean;
  strict: boolean;
  only?: string;
}

export type DryRunKind = "managed" | "template";
export type DryRunReason =
  | "managed"
  | "template-create"
  | "template-skipped"
  | "template-force-overwrite";

export interface DryRunRecord {
  path: string;
  kind: DryRunKind;
  willWrite: boolean;
  reason: DryRunReason;
}

// Track dry-run affected files (cleared after each buildAgents call)
const dryRunRecords: DryRunRecord[] = [];

// ---------------------------------------------------------------------------
// Frontmatter parsing
// ---------------------------------------------------------------------------

const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/;

/**
 * Split a body.md file into frontmatter object and body text.
 * Throws on YAML parse failure.
 */
export function parseFrontmatter(raw: string, filePath: string): { fm: AgentFrontmatter; body: string } {
  const match = FRONTMATTER_RE.exec(raw);
  if (!match) {
    throw new Error(`[build-agents] Missing or malformed frontmatter in: ${filePath}`);
  }

  let fm: AgentFrontmatter;
  try {
    fm = parseYaml(match[1]!) as AgentFrontmatter;
  } catch (err) {
    throw new Error(
      `[build-agents] YAML parse failure in frontmatter of: ${filePath}\n  ${String(err)}`,
    );
  }

  if (!fm.id || !fm.name) {
    throw new Error(
      `[build-agents] Missing required frontmatter fields (id, name) in: ${filePath}`,
    );
  }

  const VALID_MODES = ["primary", "subagent", "all"] as const;
  if (fm.mode !== undefined && !(VALID_MODES as readonly string[]).includes(fm.mode)) {
    throw new Error(
      `[build-agents] Invalid mode "${fm.mode}" in: ${filePath}. Valid values: ${VALID_MODES.join(", ")}`,
    );
  }

  return { fm, body: (match[2] ?? "").trimStart() };
}

// ---------------------------------------------------------------------------
// Stage 1: Load assets
// ---------------------------------------------------------------------------

/**
 * Load all agents and skills from assets/, whitelisting only body.md.
 */
export function loadAssets(opts?: { only?: string }): AssetEntry[] {
  const entries: AssetEntry[] = [];

  // Load agents
  if (existsSync(AGENTS_DIR)) {
    for (const entry of readdirSync(AGENTS_DIR, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      if (opts?.only && entry.name !== opts.only) continue;

      const bodyPath = join(AGENTS_DIR, entry.name, "body.md");
      if (!existsSync(bodyPath)) {
        throw new Error(`[build-agents] Missing body.md for agent: ${entry.name}`);
      }

      const raw = readFileSync(bodyPath, "utf-8");
      const { fm, body } = parseFrontmatter(raw, bodyPath);

      entries.push({ type: "agent", name: entry.name, frontmatter: fm, body, bodyPath });
    }
  }

  // Load skills
  if (existsSync(SKILLS_DIR)) {
    for (const entry of readdirSync(SKILLS_DIR, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      if (opts?.only && entry.name !== opts.only) continue;

      const bodyPath = join(SKILLS_DIR, entry.name, "body.md");
      if (!existsSync(bodyPath)) {
        throw new Error(`[build-agents] Missing body.md for skill: ${entry.name}`);
      }

      const raw = readFileSync(bodyPath, "utf-8");
      const { fm, body } = parseFrontmatter(raw, bodyPath);

      entries.push({ type: "skill", name: entry.name, frontmatter: fm, body, bodyPath });
    }
  }

  return entries;
}

// ---------------------------------------------------------------------------
// Stage 2: Load capability matrix
// ---------------------------------------------------------------------------

export function loadCapabilityMatrix(): CapabilityMatrix {
  if (!existsSync(CAPABILITY_MATRIX_PATH)) {
    throw new Error(`[build-agents] capability-matrix.yml not found at: ${CAPABILITY_MATRIX_PATH}`);
  }
  const raw = readFileSync(CAPABILITY_MATRIX_PATH, "utf-8");
  return parseYaml(raw) as CapabilityMatrix;
}

// ---------------------------------------------------------------------------
// Stage 3: Load invocations
// ---------------------------------------------------------------------------

export function loadInvocations(): InvocationsMap {
  if (!existsSync(TOOL_NAME_MAP_PATH)) {
    throw new Error(`[build-agents] tool-name-map.yml not found at: ${TOOL_NAME_MAP_PATH}`);
  }
  const raw = readFileSync(TOOL_NAME_MAP_PATH, "utf-8");
  const parsed = parseYaml(raw) as ToolNameMapInvocations;
  if (!parsed.invocations) {
    throw new Error(`[build-agents] tool-name-map.yml missing 'invocations' section`);
  }
  return parsed.invocations;
}

// ---------------------------------------------------------------------------
// Capability resolution helpers
// ---------------------------------------------------------------------------

/**
 * Collect all Claude disallowedTools for an agent based on its capabilities[].
 */
export function resolveClaudeDisallowedTools(
  capabilities: string[],
  capMatrix: CapabilityMatrix,
): string[] {
  const tools: string[] = [];
  for (const cap of capabilities) {
    const entry = capMatrix.capabilities[cap];
    if (!entry) {
      throw new Error(`[build-agents] Unknown capability: ${cap}`);
    }
    if (entry.claude?.disallowedTools) {
      for (const t of entry.claude.disallowedTools) {
        if (!tools.includes(t)) tools.push(t);
      }
    }
  }
  return tools;
}

/**
 * Collect merged OpenCode permission block for an agent.
 */
export function resolveOpencodePermissions(
  capabilities: string[],
  capMatrix: CapabilityMatrix,
): Record<string, string> {
  const perms: Record<string, string> = {};
  for (const cap of capabilities) {
    const entry = capMatrix.capabilities[cap];
    if (!entry) {
      throw new Error(`[build-agents] Unknown capability: ${cap}`);
    }
    if (entry.opencode?.permission) {
      Object.assign(perms, entry.opencode.permission);
    }
  }
  return perms;
}

/**
 * Resolve codex sandbox_mode and disabled_tools for an agent.
 * sandbox_mode: take the most restrictive non-null value ("read-only" wins).
 */
export function resolveCodexConfig(
  capabilities: string[],
  capMatrix: CapabilityMatrix,
): { sandbox_mode: string | null; disabled_tools: string[] } {
  let sandboxMode: string | null = null;
  const disabledTools: string[] = [];

  for (const cap of capabilities) {
    const entry = capMatrix.capabilities[cap];
    if (!entry) {
      throw new Error(`[build-agents] Unknown capability: ${cap}`);
    }
    if (entry.codex?.sandbox_mode) {
      // "read-only" is the most restrictive
      sandboxMode = entry.codex.sandbox_mode;
    }
    if (entry.codex?.disabled_tools) {
      for (const t of entry.codex.disabled_tools) {
        if (t && !disabledTools.includes(t)) disabledTools.push(t);
      }
    }
  }

  return { sandbox_mode: sandboxMode, disabled_tools: disabledTools };
}

/**
 * Resolve model slug for a given model_tier and harness.
 */
export function resolveModel(
  modelTier: string,
  harness: Harness,
  capMatrix: CapabilityMatrix,
): string | null {
  const tierEntry = capMatrix.model_tier[modelTier];
  if (!tierEntry) return null;
  const val = tierEntry[harness];
  return val === null || val === undefined ? null : val;
}

// ---------------------------------------------------------------------------
// Overwrite policy
// ---------------------------------------------------------------------------

/**
 * Write a file according to the managed/template overwrite policy.
 *
 * Managed: always overwrite (unless --dry-run)
 * Template: skip if exists (overwrite only with --force)
 * --dry-run: record path and intent, no write
 * --strict: error if Managed path has untracked git modifications
 */
export function applyOverwritePolicy(
  filePath: string,
  content: string,
  isManaged: boolean,
  opts: BuildOptions,
): DryRunRecord {
  if (isManaged) {
    const record: DryRunRecord = {
      path: filePath,
      kind: "managed",
      willWrite: true,
      reason: "managed",
    };

    if (opts.dryRun) {
      dryRunRecords.push(record);
      return record;
    }

    if (opts.strict) {
      // managed 파일에 대해서만 git drift 검사 — template skip은 strict 대상 아님
      if (existsSync(filePath)) {
        try {
          const rel = filePath.startsWith(ROOT)
            ? filePath.slice(ROOT.length + 1)
            : filePath;
          const result = execSync(`git status --short -- ${JSON.stringify(rel)}`, {
            cwd: ROOT,
            encoding: "utf-8",
            stdio: ["pipe", "pipe", "pipe"],
          }).trim();
          if (result && !result.startsWith("?")) {
            throw new Error(
              `[build-agents] --strict: managed file has untracked modifications: ${filePath}`,
            );
          }
        } catch (err) {
          if (String(err).includes("--strict:")) throw err;
          // git 미설치 또는 미추적 파일 — 허용
        }
      }
    }

    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, content, "utf-8");
    return record;
  } else {
    // Template: skip if exists unless --force
    const exists = existsSync(filePath);
    let reason: DryRunReason;
    let willWrite: boolean;

    if (exists && !opts.force) {
      reason = "template-skipped";
      willWrite = false;
    } else if (exists && opts.force) {
      reason = "template-force-overwrite";
      willWrite = true;
    } else {
      reason = "template-create";
      willWrite = true;
    }

    const record: DryRunRecord = { path: filePath, kind: "template", willWrite, reason };

    if (opts.dryRun) {
      dryRunRecords.push(record);
      return record;
    }

    if (!willWrite) {
      return record;
    }

    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, content, "utf-8");
    return record;
  }
}

// ---------------------------------------------------------------------------
// Harness: Claude
// ---------------------------------------------------------------------------

function claudeAgentMarkdown(asset: AssetEntry, capMatrix: CapabilityMatrix, invocations: InvocationsMap): string {
  const fm = asset.frontmatter;
  const disallowed = resolveClaudeDisallowedTools(fm.capabilities ?? [], capMatrix);
  const model = resolveModel(fm.model_tier, "claude", capMatrix);

  const fmLines: string[] = ["---"];
  if (fm.description) fmLines.push(`description: ${JSON.stringify(fm.description)}`);
  if (model) fmLines.push(`model: ${model}`);
  if (disallowed.length > 0) {
    fmLines.push(`disallowedTools:`);
    for (const t of disallowed) {
      fmLines.push(`  - ${t}`);
    }
  }
  fmLines.push("---");
  fmLines.push("");

  const expandedBody = expandInvocations(asset.body, "claude", invocations);

  return fmLines.join("\n") + expandedBody;
}

function claudeSkillMarkdown(asset: AssetEntry, invocations: InvocationsMap): string {
  const fm = asset.frontmatter;

  const fmLines: string[] = ["---"];
  if (fm.description) fmLines.push(`description: ${JSON.stringify(fm.description)}`);
  if (fm.triggers && fm.triggers.length > 0) {
    fmLines.push(`triggers:`);
    for (const t of fm.triggers) {
      fmLines.push(`  - ${t}`);
    }
  }
  fmLines.push("---");
  fmLines.push("");

  const expandedBody = expandInvocations(asset.body, "claude", invocations);

  return fmLines.join("\n") + expandedBody;
}

function buildPluginJson(agents: AssetEntry[]): string {
  return JSON.stringify(
    {
      name: "claude-nexus",
      version: "0.13.0",
      description: "Nexus agent suite for Claude Code",
      agents: agents.map((a) => ({
        id: a.frontmatter.id,
        name: a.frontmatter.name,
        description: a.frontmatter.description,
        file: `agents/${a.name}.md`,
      })),
    },
    null,
    2,
  ) + "\n";
}

function buildMarketplaceJson(agents: AssetEntry[]): string {
  return JSON.stringify(
    {
      schema_version: "1.0",
      agents: agents.map((a) => ({
        id: a.frontmatter.id,
        name: a.frontmatter.name,
        description: a.frontmatter.description,
        category: a.frontmatter.category,
        model_tier: a.frontmatter.model_tier,
      })),
    },
    null,
    2,
  ) + "\n";
}

export function buildForClaude(
  assets: AssetEntry[],
  capMatrix: CapabilityMatrix,
  invocations: InvocationsMap,
  opts: BuildOptions,
): void {
  const baseDir = opts.targetDir;
  const agentAssets = assets.filter((a) => a.type === "agent");
  const skillAssets = assets.filter((a) => a.type === "skill");

  // Template files: .claude-plugin/plugin.json and marketplace.json
  const pluginJsonPath = join(baseDir, ".claude-plugin", "plugin.json");
  const marketplacePath = join(baseDir, ".claude-plugin", "marketplace.json");

  applyOverwritePolicy(pluginJsonPath, buildPluginJson(agentAssets), false, opts);
  applyOverwritePolicy(marketplacePath, buildMarketplaceJson(agentAssets), false, opts);

  // Managed: agents/<n>.md
  for (const agent of agentAssets) {
    const outPath = join(baseDir, "agents", `${agent.name}.md`);
    const content = claudeAgentMarkdown(agent, capMatrix, invocations);
    applyOverwritePolicy(outPath, content, true, opts);
  }

  // Managed: skills/<n>/SKILL.md
  for (const skill of skillAssets) {
    const outPath = join(baseDir, "skills", skill.name, "SKILL.md");
    const content = claudeSkillMarkdown(skill, invocations);
    applyOverwritePolicy(outPath, content, true, opts);
  }

  // Managed: settings.json (primary agent injection)
  const primaryAgents = agentAssets.filter(
    (a) => (a.frontmatter.mode ?? "subagent") === "primary",
  );
  if (primaryAgents.length > 0) {
    if (primaryAgents.length > 1) {
      console.warn(
        `[build-agents] Warning: multiple primary agents found (${primaryAgents.map((a) => a.name).join(", ")}). Using first: ${primaryAgents[0]!.name}`,
      );
    }
    const primaryAgent = primaryAgents[0]!;
    const settingsPath = join(baseDir, "settings.json");
    const settingsContent = JSON.stringify({ agent: primaryAgent.frontmatter.id }, null, 2) + "\n";
    applyOverwritePolicy(settingsPath, settingsContent, true, opts);
  }
}

// ---------------------------------------------------------------------------
// Harness: OpenCode
// ---------------------------------------------------------------------------

/**
 * Generate OpenCode src/agents/<n>.ts content.
 * Uses template literal inline. Backtick and ${ are escaped via string concatenation.
 */
function opencodeAgentTs(asset: AssetEntry, capMatrix: CapabilityMatrix, invocations: InvocationsMap): string {
  const fm = asset.frontmatter;
  const perms = resolveOpencodePermissions(fm.capabilities ?? [], capMatrix);
  const expandedBody = expandInvocations(asset.body, "opencode", invocations);

  // Build permission block
  const permEntries = Object.entries(perms);
  const permBlock =
    permEntries.length > 0
      ? `  permission: {\n${permEntries.map(([k, v]) => `    ${k}: "${v}",`).join("\n")}\n  },`
      : "";

  // Escape content for embedding in a template literal
  // We use string concatenation to avoid issues with backtick and ${ in the template
  const escapedBody = expandedBody.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$\{/g, "\\${");
  const escapedDesc = fm.description.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$\{/g, "\\${");

  const lines: string[] = [
    `// Auto-generated by build-agents.ts — do not edit`,
    `// Source: assets/agents/${asset.name}/body.md`,
    `import type { AgentConfig } from "@moreih29/nexus-core/types";`,
    ``,
    `export const ${camelCase(asset.name)}: AgentConfig = {`,
    `  id: ${JSON.stringify(fm.id)},`,
    `  name: ${JSON.stringify(fm.name)},`,
    `  description: \`${escapedDesc}\`,`,
  ];

  if (permBlock) lines.push(permBlock);

  // Emit mode field only for primary agents (subagent is the OpenCode default)
  if (fm.mode === "primary") {
    lines.push(`  mode: "primary",`);
  }

  lines.push(
    `  system: \`${escapedBody}\`,`,
    `};`,
    ``,
  );

  return lines.join("\n");
}

function opencodeIndexTs(agents: AssetEntry[]): string {
  const imports = agents
    .map((a) => `import { ${camelCase(a.name)} } from "./agents/${a.name}.js";`)
    .join("\n");
  const exports = `export const agents = [\n${agents.map((a) => `  ${camelCase(a.name)},`).join("\n")}\n];`;

  return [
    `// Auto-generated by build-agents.ts — do not edit`,
    ``,
    imports,
    ``,
    exports,
    ``,
  ].join("\n");
}

function opencodePackageJson(agents: AssetEntry[]): string {
  return (
    JSON.stringify(
      {
        name: "opencode-nexus",
        version: "0.13.0",
        description: "Nexus agent suite for OpenCode",
        type: "module",
        main: "./src/plugin.ts",
        exports: {
          ".": "./src/plugin.ts",
        },
        peerDependencies: {
          opencode: "*",
        },
        dependencies: {
          "@moreih29/nexus-core": "^0.14.0",
        },
        devDependencies: {
          "@opencode-ai/plugin": "*",
          typescript: "^5",
        },
        engines: {
          node: ">=22",
        },
      },
      null,
      2,
    ) + "\n"
  );
}

function opencodePluginTs(): string {
  return [
    `import type { Plugin } from "@opencode-ai/plugin";`,
    `import { mountHooks } from "@moreih29/nexus-core/hooks/opencode-mount";`,
    `import manifest from "@moreih29/nexus-core/hooks/opencode-manifest" with { type: "json" };`,
    ``,
    `export const OpencodeNexus: Plugin = async (ctx) => mountHooks(ctx, manifest);`,
    `export default OpencodeNexus;`,
    ``,
  ].join("\n");
}

function opencodeSkillMarkdown(asset: AssetEntry, invocations: InvocationsMap): string {
  const fm = asset.frontmatter;
  const fmLines: string[] = ["---"];
  if (fm.description) fmLines.push(`description: ${JSON.stringify(fm.description)}`);
  if (fm.triggers && fm.triggers.length > 0) {
    fmLines.push(`triggers:`);
    for (const t of fm.triggers) {
      fmLines.push(`  - ${t}`);
    }
  }
  fmLines.push("---");
  fmLines.push("");

  const expandedBody = expandInvocations(asset.body, "opencode", invocations);
  return fmLines.join("\n") + expandedBody;
}

export function buildForOpencode(
  assets: AssetEntry[],
  capMatrix: CapabilityMatrix,
  invocations: InvocationsMap,
  opts: BuildOptions,
): void {
  const baseDir = opts.targetDir;
  const agentAssets = assets.filter((a) => a.type === "agent");
  const skillAssets = assets.filter((a) => a.type === "skill");

  // Template: package.json
  const pkgPath = join(baseDir, "package.json");
  applyOverwritePolicy(pkgPath, opencodePackageJson(agentAssets), false, opts);

  // Template: src/plugin.ts (mountHooks 진입점)
  const pluginTsPath = join(baseDir, "src", "plugin.ts");
  applyOverwritePolicy(pluginTsPath, opencodePluginTs(), false, opts);

  // Managed: src/index.ts
  const indexPath = join(baseDir, "src", "index.ts");
  applyOverwritePolicy(indexPath, opencodeIndexTs(agentAssets), true, opts);

  // Managed: src/agents/<n>.ts
  for (const agent of agentAssets) {
    const outPath = join(baseDir, "src", "agents", `${agent.name}.ts`);
    const content = opencodeAgentTs(agent, capMatrix, invocations);
    applyOverwritePolicy(outPath, content, true, opts);
  }

  // Managed: .opencode/skills/<n>/SKILL.md
  for (const skill of skillAssets) {
    const outPath = join(baseDir, ".opencode", "skills", skill.name, "SKILL.md");
    const content = opencodeSkillMarkdown(skill, invocations);
    applyOverwritePolicy(outPath, content, true, opts);
  }
}

// ---------------------------------------------------------------------------
// Harness: Codex
// ---------------------------------------------------------------------------

/**
 * Escape a string for TOML multi-line literal string (''' ''').
 * Literal strings do not allow escapes, so we must not include '''.
 * Fallback: use basic multi-line string with minimal escaping.
 */
function tomlMultilineString(value: string): string {
  // Use basic multi-line string: """ ... """
  // Escape backslash and double-quote sequences
  const escaped = value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  return `"""\n${escaped}\n"""`;
}

function codexAgentToml(asset: AssetEntry, capMatrix: CapabilityMatrix, invocations: InvocationsMap): string {
  const fm = asset.frontmatter;
  const { sandbox_mode, disabled_tools } = resolveCodexConfig(fm.capabilities ?? [], capMatrix);
  const model = resolveModel(fm.model_tier, "codex", capMatrix);
  const expandedBody = expandInvocations(asset.body, "codex", invocations);

  const lines: string[] = [
    `# Auto-generated by build-agents.ts — do not edit`,
    `# Source: assets/agents/${asset.name}/body.md`,
    ``,
    `name = ${JSON.stringify(fm.id)}`,
    `description = ${JSON.stringify(fm.description)}`,
    `developer_instructions = ${tomlMultilineString(expandedBody)}`,
  ];

  if (model) lines.push(`model = ${JSON.stringify(model)}`);
  if (sandbox_mode) lines.push(`sandbox_mode = ${JSON.stringify(sandbox_mode)}`);

  if (disabled_tools.length > 0) {
    lines.push(``);
    lines.push(`[mcp_servers.nx]`);
    lines.push(`command = ${JSON.stringify(CODEX_MCP_NX_COMMAND)}`);
    lines.push(`disabled_tools = [${disabled_tools.map((t) => JSON.stringify(t)).join(", ")}]`);
  }

  lines.push(``);

  return lines.join("\n");
}

function codexPromptMarkdown(asset: AssetEntry, invocations: InvocationsMap): string {
  const expandedBody = expandInvocations(asset.body, "codex", invocations);
  const fm = asset.frontmatter;
  return [
    `---`,
    `name: ${JSON.stringify(fm.name)}`,
    `description: ${JSON.stringify(fm.description)}`,
    `---`,
    ``,
    expandedBody,
  ].join("\n");
}

function codexSkillMarkdown(asset: AssetEntry, invocations: InvocationsMap): string {
  const fm = asset.frontmatter;
  const fmLines: string[] = ["---"];
  if (fm.description) fmLines.push(`description: ${JSON.stringify(fm.description)}`);
  if (fm.triggers && fm.triggers.length > 0) {
    fmLines.push(`triggers:`);
    for (const t of fm.triggers) {
      fmLines.push(`  - ${t}`);
    }
  }
  fmLines.push("---");
  fmLines.push("");
  const expandedBody = expandInvocations(asset.body, "codex", invocations);
  return fmLines.join("\n") + expandedBody;
}

function codexPluginJson(agents: AssetEntry[]): string {
  return (
    JSON.stringify(
      {
        name: "codex-nexus",
        version: "0.13.0",
        description: "Nexus agent suite for Codex",
        agents: agents.map((a) => ({
          id: a.frontmatter.id,
          config: `agents/${a.name}.toml`,
          prompt: `prompts/${a.name}.md`,
        })),
      },
      null,
      2,
    ) + "\n"
  );
}

function codexConfigFragment(agents: AssetEntry[]): string {
  const lines: string[] = [
    `# Auto-generated by build-agents.ts — do not edit`,
    `# Merge this fragment into your codex config.toml`,
    ``,
    `[mcp_servers.nx]`,
    `command = ${JSON.stringify(CODEX_MCP_NX_COMMAND)}`,
    ``,
  ];

  return lines.join("\n");
}

function codexPackageJson(): string {
  return (
    JSON.stringify(
      {
        name: "codex-nexus",
        version: "0.13.0",
        description: "Nexus agent suite for Codex CLI",
        private: true,
        scripts: {
          sync: "bunx @moreih29/nexus-core sync --harness=codex --target=./",
          "sync:dry": "bunx @moreih29/nexus-core sync --harness=codex --target=./ --dry-run",
          build: "bun run sync",
          validate: "bunx @moreih29/nexus-core validate",
          list: "bunx @moreih29/nexus-core list",
          "install-plugin": "bash install/install.sh",
        },
        devDependencies: {
          "@moreih29/nexus-core": "^0.14.0",
        },
        engines: {
          node: ">=22",
        },
      },
      null,
      2,
    ) + "\n"
  );
}

function codexInstallSh(): string {
  return [
    `#!/usr/bin/env bash`,
    `# Codex plugin installer — block-marker merge pattern.`,
    `# nexus-core Model 2: wrapper owns integration seams.`,
    `# Merges config.fragment.toml into ~/.codex/config.toml,`,
    `# copies native agent TOMLs to ~/.codex/agents/,`,
    `# and merges AGENTS.fragment.md into ~/.codex/AGENTS.md.`,
    `set -euo pipefail`,
    ``,
    `PLUGIN_NAME="\${PLUGIN_NAME:-codex-nexus}"`,
    `CODEX_HOME="\${CODEX_HOME:-\$HOME/.codex}"`,
    `SCRIPT_DIR="\$(cd "\$(dirname "\${BASH_SOURCE[0]}")" && pwd)"`,
    `REPO_ROOT="\$(cd "\$SCRIPT_DIR/.." && pwd)"`,
    ``,
    `mkdir -p "\$CODEX_HOME" "\$CODEX_HOME/agents" "\$CODEX_HOME/plugins"`,
    ``,
    `# 1. config.toml — block-marker merge`,
    `MARKER_BEGIN="# BEGIN \${PLUGIN_NAME}"`,
    `MARKER_END="# END \${PLUGIN_NAME}"`,
    `CONFIG="\$CODEX_HOME/config.toml"`,
    `CONFIG_FRAGMENT="\$SCRIPT_DIR/config.fragment.toml"`,
    ``,
    `touch "\$CONFIG"`,
    `if grep -q "\${MARKER_BEGIN}" "\$CONFIG" 2>/dev/null; then`,
    `  sed -i.bak "/\${MARKER_BEGIN}/,/\${MARKER_END}/d" "\$CONFIG"`,
    `fi`,
    `{`,
    `  echo ""`,
    `  echo "\${MARKER_BEGIN}"`,
    `  cat "\$CONFIG_FRAGMENT"`,
    `  echo "\${MARKER_END}"`,
    `} >> "\$CONFIG"`,
    ``,
    `# 2. native agent TOMLs`,
    `cp "\$REPO_ROOT"/agents/*.toml "\$CODEX_HOME/agents/" 2>/dev/null || true`,
    ``,
    `# 3. plugin body → ~/.codex/plugins/<name>/`,
    `PLUGIN_DEST="\$CODEX_HOME/plugins/\${PLUGIN_NAME}"`,
    `rm -rf "\$PLUGIN_DEST"`,
    `mkdir -p "\$PLUGIN_DEST"`,
    `cp -R "\$REPO_ROOT"/plugin/. "\$PLUGIN_DEST/"`,
    ``,
    `# 4. AGENTS.md — block-marker merge`,
    `AGENTS_TARGET="\$CODEX_HOME/AGENTS.md"`,
    `AGENTS_FRAGMENT="\$SCRIPT_DIR/AGENTS.fragment.md"`,
    `FRAG_BEGIN="<!-- nexus-core:lead:start -->"`,
    `FRAG_END="<!-- nexus-core:lead:end -->"`,
    ``,
    `if [ -f "\$AGENTS_FRAGMENT" ]; then`,
    `  touch "\$AGENTS_TARGET"`,
    `  if grep -q "\${FRAG_BEGIN}" "\$AGENTS_TARGET" 2>/dev/null; then`,
    `    awk -v begin="\${FRAG_BEGIN}" -v end="\${FRAG_END}" '`,
    `      \$0 ~ begin { skip=1; next }`,
    `      \$0 ~ end { skip=0; next }`,
    `      !skip { print }`,
    `    ' "\$AGENTS_TARGET" > "\$AGENTS_TARGET.tmp" && mv "\$AGENTS_TARGET.tmp" "\$AGENTS_TARGET"`,
    `  fi`,
    `  cat "\$AGENTS_FRAGMENT" >> "\$AGENTS_TARGET"`,
    `fi`,
    ``,
    `echo "Installed \${PLUGIN_NAME} → \$CODEX_HOME"`,
    ``,
  ].join("\n");
}

export function buildForCodex(
  assets: AssetEntry[],
  capMatrix: CapabilityMatrix,
  invocations: InvocationsMap,
  opts: BuildOptions,
): void {
  const baseDir = opts.targetDir;
  const agentAssets = assets.filter((a) => a.type === "agent");
  const skillAssets = assets.filter((a) => a.type === "skill");

  // Template: package.json (wrapper meta)
  const pkgPath = join(baseDir, "package.json");
  applyOverwritePolicy(pkgPath, codexPackageJson(), false, opts);

  // Template: install/install.sh (block-marker merge installer)
  const installShPath = join(baseDir, "install", "install.sh");
  applyOverwritePolicy(installShPath, codexInstallSh(), false, opts);

  // Managed: plugin/.codex-plugin/plugin.json
  const pluginJsonPath = join(baseDir, "plugin", ".codex-plugin", "plugin.json");
  applyOverwritePolicy(pluginJsonPath, codexPluginJson(agentAssets), true, opts);

  // Managed: plugin/skills/<n>/SKILL.md
  for (const skill of skillAssets) {
    const outPath = join(baseDir, "plugin", "skills", skill.name, "SKILL.md");
    const content = codexSkillMarkdown(skill, invocations);
    applyOverwritePolicy(outPath, content, true, opts);
  }

  // Managed: agents/<n>.toml
  for (const agent of agentAssets) {
    const outPath = join(baseDir, "agents", `${agent.name}.toml`);
    const content = codexAgentToml(agent, capMatrix, invocations);
    applyOverwritePolicy(outPath, content, true, opts);
  }

  // Managed: prompts/<n>.md
  for (const agent of agentAssets) {
    const outPath = join(baseDir, "prompts", `${agent.name}.md`);
    const content = codexPromptMarkdown(agent, invocations);
    applyOverwritePolicy(outPath, content, true, opts);
  }

  // Managed: install/config.fragment.toml
  const fragmentPath = join(baseDir, "install", "config.fragment.toml");
  applyOverwritePolicy(fragmentPath, codexConfigFragment(agentAssets), true, opts);

  // Managed: install/AGENTS.fragment.md (primary agents only)
  const primaryAgents = agentAssets.filter(
    (a) => (a.frontmatter.mode ?? "subagent") === "primary",
  );
  if (primaryAgents.length > 0) {
    const agentsFragmentPath = join(baseDir, "install", "AGENTS.fragment.md");
    const blocks = primaryAgents.map((agent) => {
      const expandedBody = expandInvocations(agent.body, "codex", invocations);
      return [
        `<!-- nexus-core:${agent.frontmatter.id}:start -->`,
        `# ${agent.frontmatter.name}`,
        ``,
        expandedBody,
        `<!-- nexus-core:${agent.frontmatter.id}:end -->`,
      ].join("\n");
    });
    const agentsFragmentContent = blocks.join("\n\n") + "\n";
    applyOverwritePolicy(agentsFragmentPath, agentsFragmentContent, true, opts);
  }
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function camelCase(str: string): string {
  return str.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
}

// ---------------------------------------------------------------------------
// CLI arg parsing
// ---------------------------------------------------------------------------

export function parseArgs(argv: string[]): BuildOptions {
  const args = argv.slice(2); // remove node and script path

  let harnesses: Harness[] = [...HARNESSES];
  let targetDir = join(ROOT, "dist");
  let dryRun = false;
  let force = false;
  let strict = false;
  let only: string | undefined;

  for (const arg of args) {
    if (arg.startsWith("--harness=")) {
      const val = arg.slice("--harness=".length) as Harness;
      if (!HARNESSES.includes(val)) {
        throw new Error(`[build-agents] Unknown harness: ${val}. Valid: ${HARNESSES.join(", ")}`);
      }
      harnesses = [val];
    } else if (arg.startsWith("--target=")) {
      targetDir = resolve(arg.slice("--target=".length));
    } else if (arg === "--dry-run") {
      dryRun = true;
    } else if (arg === "--force") {
      force = true;
    } else if (arg === "--strict") {
      strict = true;
    } else if (arg.startsWith("--only=")) {
      only = arg.slice("--only=".length);
    }
  }

  return { harnesses, targetDir, dryRun, force, strict, only };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export async function buildAgents(opts: BuildOptions): Promise<void> {
  // Stage 1: Load assets
  const assets = loadAssets({ only: opts.only });
  const agentCount = assets.filter((a) => a.type === "agent").length;
  const skillCount = assets.filter((a) => a.type === "skill").length;
  console.log(`[build-agents] Loaded ${agentCount} agents, ${skillCount} skills`);

  // Stage 2: Load capability matrix
  const capMatrix = loadCapabilityMatrix();

  // Validate all capability IDs referenced by assets
  const knownCapIds = new Set(Object.keys(capMatrix.capabilities));
  for (const asset of assets) {
    for (const cap of asset.frontmatter.capabilities ?? []) {
      if (!knownCapIds.has(cap)) {
        throw new Error(
          `[build-agents] "${asset.name}" references unknown capability: "${cap}". ` +
            `Known: ${[...knownCapIds].join(", ")}`,
        );
      }
    }
  }

  // Stage 3: Load invocations
  const invocations = loadInvocations();

  // Stage 4: Build per harness
  if (opts.dryRun) {
    console.log(`[build-agents] --dry-run mode: listing affected files only`);
  }

  for (const harness of opts.harnesses) {
    console.log(`[build-agents] Building for harness: ${harness}`);
    if (harness === "claude") {
      buildForClaude(assets, capMatrix, invocations, opts);
    } else if (harness === "opencode") {
      buildForOpencode(assets, capMatrix, invocations, opts);
    } else if (harness === "codex") {
      buildForCodex(assets, capMatrix, invocations, opts);
    }
  }

  if (opts.dryRun) {
    const managed = dryRunRecords.filter((r) => r.reason === "managed").length;
    const templateCreate = dryRunRecords.filter((r) => r.reason === "template-create").length;
    const templateSkipped = dryRunRecords.filter((r) => r.reason === "template-skipped").length;
    const templateForce = dryRunRecords.filter((r) => r.reason === "template-force-overwrite").length;

    console.log(
      `[build-agents] ${managed} managed, ${templateCreate} template-create, ${templateSkipped} template-skipped, ${templateForce} template-force-overwrite`,
    );

    for (const r of dryRunRecords) {
      if (r.kind === "managed") {
        console.log(`  [M] ${r.path}`);
      } else if (r.reason === "template-skipped") {
        console.log(`  [T]{skip} ${r.path}`);
      } else if (r.reason === "template-force-overwrite") {
        console.log(`  [T]{force} ${r.path}`);
      } else {
        console.log(`  [T] ${r.path}`);
      }
    }

    // 다음 호출을 위해 초기화
    dryRunRecords.length = 0;
    return;
  }

  console.log(`[build-agents] Done`);
}

// Run when executed directly
if (
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith("build-agents.ts") ||
  process.argv[1]?.endsWith("build-agents.js")
) {
  const opts = parseArgs(process.argv);
  buildAgents(opts).catch((err: unknown) => {
    process.stderr.write(`[build-agents] FATAL: ${String(err)}\n`);
    process.exit(1);
  });
}
