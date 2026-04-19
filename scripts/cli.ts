#!/usr/bin/env node
/**
 * scripts/cli.ts
 *
 * nexus-core CLI — subcommand dispatcher.
 *
 * Usage:
 *   nexus-core <command> [flags]
 *   bun run scripts/cli.ts <command> [flags]
 *
 * Commands:
 *   sync      Build agents + hooks (build-agents + build-hooks pipeline)
 *   init      Copy plugin template to a target directory
 *   list      List agents, skills, and hooks from assets/
 *   validate  Validate frontmatter and YAML assets
 *   mcp       Start the MCP stdio server (same as nexus-mcp)
 *
 * Flags:
 *   --help, -h    Show help for the current command
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const __dirname = dirname(fileURLToPath(import.meta.url));
export const ROOT = resolve(__dirname, "..");
export const ASSETS_DIR = join(ROOT, "assets");

// ---------------------------------------------------------------------------
// Parsed flags helpers
// ---------------------------------------------------------------------------

export interface ParsedFlags {
  harness?: string;
  target?: string;
  dryRun: boolean;
  force: boolean;
  strict: boolean;
  only?: string;
  help: boolean;
  remaining: string[];
}

export function parseFlags(argv: string[]): ParsedFlags {
  const flags: ParsedFlags = {
    dryRun: false,
    force: false,
    strict: false,
    help: false,
    remaining: [],
  };

  for (const arg of argv) {
    if (arg === "--help" || arg === "-h") {
      flags.help = true;
    } else if (arg.startsWith("--harness=")) {
      flags.harness = arg.slice("--harness=".length);
    } else if (arg.startsWith("--target=")) {
      flags.target = resolve(arg.slice("--target=".length));
    } else if (arg === "--dry-run") {
      flags.dryRun = true;
    } else if (arg === "--force") {
      flags.force = true;
    } else if (arg === "--strict") {
      flags.strict = true;
    } else if (arg.startsWith("--only=")) {
      flags.only = arg.slice("--only=".length);
    } else {
      flags.remaining.push(arg);
    }
  }

  return flags;
}

// ---------------------------------------------------------------------------
// Help messages
// ---------------------------------------------------------------------------

const HELP_MAIN = `
nexus-core — Nexus ecosystem CLI

Usage:
  nexus-core <command> [flags]

Commands:
  sync      Build agents + hooks (runs build-agents + build-hooks pipelines)
  init      Copy plugin template to a target directory
  list      List agents, skills, and hooks from assets/
  validate  Validate frontmatter and YAML assets
  mcp       Start the MCP stdio server (same as nexus-mcp)

Flags:
  --help, -h    Show help for the current command

Run \`nexus-core <command> --help\` for command-specific flags.
`.trim();

const HELP_SYNC = `
nexus-core sync — Build agents + hooks

Usage:
  nexus-core sync [flags]

Flags:
  --harness=<claude|opencode|codex>   Restrict to one harness (default: all)
  --target=<dir>                      Output directory (default: dist/)
  --dry-run                           Print affected files, no writes
  --force                             Force template file overwrite
  --strict                            Error if managed output has untracked modifications
  --only=<name>                       Restrict to a single agent or skill name
`.trim();

const HELP_INIT = `
nexus-core init — Copy plugin template to target directory

Usage:
  nexus-core init [flags]

Flags:
  --harness=<claude|opencode|codex>   Harness template to copy (default: claude)
  --target=<dir>                      Destination directory (required)
`.trim();

const HELP_LIST = `
nexus-core list — List assets from assets/

Usage:
  nexus-core list [flags]

Flags:
  (none currently)

Prints agents, skills, and hooks with their descriptions.
`.trim();

const HELP_VALIDATE = `
nexus-core validate — Validate frontmatter and YAML assets

Usage:
  nexus-core validate [flags]

Flags:
  (none currently)

Validates:
  - assets/agents/*/body.md frontmatter (required fields: id, name, category, model_tier)
  - assets/skills/*/body.md frontmatter (required fields: id, name)
  - assets/capability-matrix.yml YAML parse
  - assets/tools/tool-name-map.yml YAML parse
`.trim();

const HELP_MCP = `
nexus-core mcp — Start the MCP stdio server

Usage:
  nexus-core mcp

Starts the nexus-core MCP server on stdio. Equivalent to running nexus-mcp directly.
`.trim();

// ---------------------------------------------------------------------------
// Subcommand: sync
// ---------------------------------------------------------------------------

export async function runSync(argv: string[]): Promise<void> {
  const flags = parseFlags(argv);

  if (flags.help) {
    console.log(HELP_SYNC);
    return;
  }

  // Build argv for build-agents: reconstruct flags as process.argv-style
  // build-agents.parseArgs expects process.argv (slices [2:])
  const fakeArgv = ["node", "build-agents.ts"];
  if (flags.harness) fakeArgv.push(`--harness=${flags.harness}`);
  if (flags.target) fakeArgv.push(`--target=${flags.target}`);
  if (flags.dryRun) fakeArgv.push("--dry-run");
  if (flags.force) fakeArgv.push("--force");
  if (flags.strict) fakeArgv.push("--strict");
  if (flags.only) fakeArgv.push(`--only=${flags.only}`);

  const { buildAgents, parseArgs: parseAgentArgs } = await import("./build-agents.js");

  const agentOpts = parseAgentArgs(fakeArgv);
  await buildAgents(agentOpts);

  if (flags.dryRun) {
    console.log(`[nexus-core sync] --dry-run: skipping buildHooks (no writes)`);
    return;
  }

  const { buildHooks } = await import("./build-hooks.js");
  await buildHooks();
}

// ---------------------------------------------------------------------------
// Subcommand: init
// ---------------------------------------------------------------------------

export async function runInit(argv: string[]): Promise<void> {
  const flags = parseFlags(argv);

  if (flags.help) {
    console.log(HELP_INIT);
    return;
  }

  const harness = flags.harness ?? "claude";
  const target = flags.target;

  if (!target) {
    process.stderr.write(`[nexus-core init] --target=<dir> is required\n`);
    process.exit(1);
  }

  const templateDir = join(ROOT, "docs", "plugin-template", harness);

  if (!existsSync(templateDir)) {
    process.stderr.write(
      `[nexus-core init] Template not yet available for harness "${harness}".\n` +
        `  Expected path: ${templateDir}\n` +
        `  Templates are generated by the T5 phase. Use "nexus-core sync" to build dist/ first.\n`,
    );
    process.exit(1);
  }

  // Copy template directory to target using recursive copy
  const { cpSync } = await import("node:fs");
  cpSync(templateDir, target, { recursive: true });
  console.log(`[nexus-core init] Initialized ${harness} plugin template → ${target}`);
}

// ---------------------------------------------------------------------------
// Frontmatter parsing (lightweight, no dependency on build-agents)
// ---------------------------------------------------------------------------

const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/;

function parseFrontmatterRaw(raw: string): Record<string, unknown> | null {
  const match = FRONTMATTER_RE.exec(raw);
  if (!match) return null;
  try {
    return parseYaml(match[1]!) as Record<string, unknown>;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Subcommand: list
// ---------------------------------------------------------------------------

interface ListEntry {
  kind: "agent" | "skill" | "hook";
  name: string;
  description: string;
}

export function collectListEntries(): ListEntry[] {
  const entries: ListEntry[] = [];

  // Agents
  const agentsDir = join(ASSETS_DIR, "agents");
  if (existsSync(agentsDir)) {
    for (const entry of readdirSync(agentsDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const bodyPath = join(agentsDir, entry.name, "body.md");
      if (!existsSync(bodyPath)) continue;
      const fm = parseFrontmatterRaw(readFileSync(bodyPath, "utf-8"));
      entries.push({
        kind: "agent",
        name: entry.name,
        description: typeof fm?.description === "string" ? fm.description : "",
      });
    }
  }

  // Skills
  const skillsDir = join(ASSETS_DIR, "skills");
  if (existsSync(skillsDir)) {
    for (const entry of readdirSync(skillsDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const bodyPath = join(skillsDir, entry.name, "body.md");
      if (!existsSync(bodyPath)) continue;
      const fm = parseFrontmatterRaw(readFileSync(bodyPath, "utf-8"));
      entries.push({
        kind: "skill",
        name: entry.name,
        description: typeof fm?.description === "string" ? fm.description : "",
      });
    }
  }

  // Hooks
  const hooksDir = join(ASSETS_DIR, "hooks");
  if (existsSync(hooksDir)) {
    for (const entry of readdirSync(hooksDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const metaPath = join(hooksDir, entry.name, "meta.yml");
      if (!existsSync(metaPath)) continue;
      let description = "";
      try {
        const meta = parseYaml(readFileSync(metaPath, "utf-8")) as Record<string, unknown>;
        description = typeof meta?.description === "string" ? meta.description : "";
      } catch {
        // ignore parse errors in list
      }
      entries.push({ kind: "hook", name: entry.name, description });
    }
  }

  return entries;
}

export async function runList(argv: string[]): Promise<void> {
  const flags = parseFlags(argv);

  if (flags.help) {
    console.log(HELP_LIST);
    return;
  }

  const entries = collectListEntries();
  const agents = entries.filter((e) => e.kind === "agent");
  const skills = entries.filter((e) => e.kind === "skill");
  const hooks = entries.filter((e) => e.kind === "hook");

  console.log(`Agents (${agents.length}):`);
  for (const e of agents) {
    console.log(`  ${e.name.padEnd(20)} ${e.description}`);
  }

  console.log(`\nSkills (${skills.length}):`);
  for (const e of skills) {
    console.log(`  ${e.name.padEnd(20)} ${e.description}`);
  }

  console.log(`\nHooks (${hooks.length}):`);
  for (const e of hooks) {
    console.log(`  ${e.name.padEnd(20)} ${e.description}`);
  }
}

// ---------------------------------------------------------------------------
// Subcommand: validate
// ---------------------------------------------------------------------------

export interface ValidationResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
  checked: number;
}

export function runValidateSync(): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  let checked = 0;

  // Validate agents
  const agentsDir = join(ASSETS_DIR, "agents");
  if (existsSync(agentsDir)) {
    for (const entry of readdirSync(agentsDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const bodyPath = join(agentsDir, entry.name, "body.md");
      if (!existsSync(bodyPath)) {
        errors.push(`agents/${entry.name}: missing body.md`);
        continue;
      }
      checked++;
      const raw = readFileSync(bodyPath, "utf-8");
      const fm = parseFrontmatterRaw(raw);
      if (!fm) {
        errors.push(`agents/${entry.name}/body.md: missing or malformed frontmatter`);
        continue;
      }
      for (const field of ["id", "name", "category", "model_tier"] as const) {
        if (!fm[field]) {
          errors.push(`agents/${entry.name}/body.md: missing required field "${field}"`);
        }
      }
    }
  }

  // Validate skills
  const skillsDir = join(ASSETS_DIR, "skills");
  if (existsSync(skillsDir)) {
    for (const entry of readdirSync(skillsDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const bodyPath = join(skillsDir, entry.name, "body.md");
      if (!existsSync(bodyPath)) {
        errors.push(`skills/${entry.name}: missing body.md`);
        continue;
      }
      checked++;
      const raw = readFileSync(bodyPath, "utf-8");
      const fm = parseFrontmatterRaw(raw);
      if (!fm) {
        errors.push(`skills/${entry.name}/body.md: missing or malformed frontmatter`);
        continue;
      }
      for (const field of ["id", "name"] as const) {
        if (!fm[field]) {
          errors.push(`skills/${entry.name}/body.md: missing required field "${field}"`);
        }
      }
    }
  }

  // Validate capability-matrix.yml
  const capMatrixPath = join(ASSETS_DIR, "capability-matrix.yml");
  if (!existsSync(capMatrixPath)) {
    warnings.push(`capability-matrix.yml: not found at ${capMatrixPath}`);
  } else {
    checked++;
    try {
      const parsed = parseYaml(readFileSync(capMatrixPath, "utf-8")) as Record<string, unknown>;
      if (!parsed?.capabilities) {
        errors.push(`capability-matrix.yml: missing 'capabilities' top-level key`);
      }
    } catch (err) {
      errors.push(`capability-matrix.yml: YAML parse error — ${String(err)}`);
    }
  }

  // Validate tools/tool-name-map.yml
  const toolMapPath = join(ASSETS_DIR, "tools", "tool-name-map.yml");
  if (!existsSync(toolMapPath)) {
    warnings.push(`tool-name-map.yml: not found at ${toolMapPath}`);
  } else {
    checked++;
    try {
      const parsed = parseYaml(readFileSync(toolMapPath, "utf-8")) as Record<string, unknown>;
      if (!parsed?.tools && !parsed?.invocations) {
        warnings.push(`tool-name-map.yml: neither 'tools' nor 'invocations' top-level key found`);
      }
    } catch (err) {
      errors.push(`tool-name-map.yml: YAML parse error — ${String(err)}`);
    }
  }

  return { ok: errors.length === 0, errors, warnings, checked };
}

export async function runValidate(argv: string[]): Promise<void> {
  const flags = parseFlags(argv);

  if (flags.help) {
    console.log(HELP_VALIDATE);
    return;
  }

  const result = runValidateSync();

  console.log(`[nexus-core validate] Checked ${result.checked} assets`);

  for (const w of result.warnings) {
    process.stderr.write(`  WARN  ${w}\n`);
  }

  if (result.ok) {
    console.log(`  OK — no errors found`);
  } else {
    for (const e of result.errors) {
      process.stderr.write(`  ERROR ${e}\n`);
    }
    process.stderr.write(`[nexus-core validate] ${result.errors.length} error(s) found\n`);
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Subcommand: mcp
// ---------------------------------------------------------------------------

export async function runMcp(argv: string[]): Promise<void> {
  const flags = parseFlags(argv);

  if (flags.help) {
    console.log(HELP_MCP);
    return;
  }

  // Forward to MCP server main()
  const { main } = await import("../src/mcp/server.js");
  await main();
}

// ---------------------------------------------------------------------------
// Main dispatcher
// ---------------------------------------------------------------------------

export async function main(argv: string[]): Promise<void> {
  const cmd = argv[0];
  const rest = argv.slice(1);

  switch (cmd) {
    case "sync":
      return runSync(rest);

    case "init":
      return runInit(rest);

    case "list":
      return runList(rest);

    case "validate":
      return runValidate(rest);

    case "mcp":
      return runMcp(rest);

    case "--help":
    case "-h":
    case undefined:
      console.log(HELP_MAIN);
      return;

    default:
      process.stderr.write(`[nexus-core] Unknown command: ${cmd}\n`);
      process.stderr.write(`Run \`nexus-core --help\` for available commands.\n`);
      process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Direct execution
// ---------------------------------------------------------------------------

if (
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith("cli.ts") ||
  process.argv[1]?.endsWith("cli.js")
) {
  main(process.argv.slice(2)).catch((err: unknown) => {
    process.stderr.write(`[nexus-core] FATAL: ${String(err)}\n`);
    process.exit(1);
  });
}
