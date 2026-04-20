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
 *     opencode.json.fragment           (Managed — always overwrite)
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

// Track dry-run affected files
const dryRunFiles: string[] = [];

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
 * --dry-run: record path, no write
 * --strict: error if Managed path has untracked git modifications
 */
export function applyOverwritePolicy(
  filePath: string,
  content: string,
  isManaged: boolean,
  opts: BuildOptions,
): void {
  if (opts.dryRun) {
    dryRunFiles.push(filePath);
    return;
  }

  if (isManaged) {
    if (opts.strict) {
      // Check if the file is tracked by git and has local modifications
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
          // git not available or file not tracked — allow
        }
      }
    }
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, content, "utf-8");
  } else {
    // Template: skip if exists unless --force
    if (existsSync(filePath) && !opts.force) {
      return;
    }
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, content, "utf-8");
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
  const baseDir = join(opts.targetDir, "claude");
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
    `import type { AgentConfig } from "opencode";`,
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
        main: "./src/index.ts",
        exports: {
          ".": "./src/index.ts",
        },
        peerDependencies: {
          opencode: "*",
        },
      },
      null,
      2,
    ) + "\n"
  );
}

function opencodeJsonFragment(agents: AssetEntry[]): string {
  // Fragment to be merged into opencode.json
  return (
    JSON.stringify(
      {
        agents: agents.map((a) => ({
          id: a.frontmatter.id,
          module: `./src/agents/${a.name}.js`,
        })),
      },
      null,
      2,
    ) + "\n"
  );
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
  const baseDir = join(opts.targetDir, "opencode");
  const agentAssets = assets.filter((a) => a.type === "agent");
  const skillAssets = assets.filter((a) => a.type === "skill");

  // Template: package.json
  const pkgPath = join(baseDir, "package.json");
  applyOverwritePolicy(pkgPath, opencodePackageJson(agentAssets), false, opts);

  // Managed: opencode.json.fragment
  const fragmentPath = join(baseDir, "opencode.json.fragment");
  applyOverwritePolicy(fragmentPath, opencodeJsonFragment(agentAssets), true, opts);

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
    `[agents.${fm.id}]`,
    `description = ${JSON.stringify(fm.description)}`,
  ];

  if (model) lines.push(`model = ${JSON.stringify(model)}`);
  if (sandbox_mode) lines.push(`sandbox_mode = ${JSON.stringify(sandbox_mode)}`);

  if (disabled_tools.length > 0) {
    lines.push(`disabled_tools = [${disabled_tools.map((t) => JSON.stringify(t)).join(", ")}]`);
  }

  lines.push(
    ``,
    `[agents.${fm.id}.system]`,
    `content = ${tomlMultilineString(expandedBody)}`,
    ``,
  );

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
    `command = "nexus-mcp"`,
    ``,
  ];

  return lines.join("\n");
}

export function buildForCodex(
  assets: AssetEntry[],
  capMatrix: CapabilityMatrix,
  invocations: InvocationsMap,
  opts: BuildOptions,
): void {
  const baseDir = join(opts.targetDir, "codex");
  const agentAssets = assets.filter((a) => a.type === "agent");
  const skillAssets = assets.filter((a) => a.type === "skill");

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
    console.log(`[build-agents] Affected files (${dryRunFiles.length}):`);
    for (const f of dryRunFiles) {
      console.log(`  ${f}`);
    }
    // Clear for next run
    dryRunFiles.length = 0;
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
