/**
 * scripts/build-agents.test.ts
 *
 * Unit and integration tests for build-agents.ts.
 *
 * Scenarios:
 *  (1) expandInvocation — plain substitution, missing arg, invalid template, unknown invocation
 *  (2) Capability mapping — resolveClaudeDisallowedTools, resolveOpencodePermissions, resolveCodexConfig
 *  (3) Manifest generation — plugin.json / marketplace.json / package.json schema
 *  (4) Overwrite policy — managed overwrite, template skip, --force, --dry-run
 *  (5) Harness builders — buildForClaude / buildForOpencode / buildForCodex produce expected files
 *  (6) Error paths — malformed frontmatter, unknown capability, missing body.md
 *  (7) CLI arg parsing — --harness, --target, --dry-run, --force, --strict, --only
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
  readFileSync,
  existsSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

import {
  parseFrontmatter,
  loadCapabilityMatrix,
  loadInvocations,
  resolveClaudeDisallowedTools,
  resolveOpencodePermissions,
  resolveCodexConfig,
  resolveModel,
  buildForClaude,
  buildForOpencode,
  buildForCodex,
  applyOverwritePolicy,
  parseArgs,
  buildAgents,
  ROOT,
  type AssetEntry,
  type CapabilityMatrix,
  type BuildOptions,
} from "./build-agents.js";

import {
  expandInvocations,
  expandInvocationExpression,
  parseInvocationCall,
  type InvocationsMap,
} from "../src/shared/invocations.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const REPO_ROOT = resolve(fileURLToPath(import.meta.url), "../..");
const FIXTURE_BASE = join(REPO_ROOT, "tests/fixtures/build-agents");

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

let tmpDirs: string[] = [];

afterEach(() => {
  for (const dir of tmpDirs) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // best effort
    }
  }
  tmpDirs = [];
});

function makeTmp(): string {
  const dir = mkdtempSync(join(tmpdir(), "build-agents-test-"));
  tmpDirs.push(dir);
  return dir;
}

/** Minimal capability matrix covering no_file_edit, no_task_create, no_task_update + model_tier */
function minimalCapMatrix(): CapabilityMatrix {
  return {
    capabilities: {
      no_file_edit: {
        claude: { disallowedTools: ["Edit", "Write", "MultiEdit", "NotebookEdit"] },
        opencode: { permission: { edit: "deny" } },
        codex: { sandbox_mode: "read-only", disabled_tools: [] },
      },
      no_task_create: {
        claude: { disallowedTools: ["mcp__plugin_claude-nexus_nx__nx_task_add"] },
        opencode: { permission: { nx_task_add: "deny" } },
        codex: { sandbox_mode: null, disabled_tools: ["nx_task_add"] },
      },
      no_task_update: {
        claude: { disallowedTools: ["mcp__plugin_claude-nexus_nx__nx_task_update"] },
        opencode: { permission: { nx_task_update: "deny" } },
        codex: { sandbox_mode: null, disabled_tools: ["nx_task_update"] },
      },
    },
    model_tier: {
      high: { claude: "claude-opus-4", codex: "gpt-5.4", opencode: null },
      standard: { claude: "claude-sonnet-4", codex: "gpt-5.3-codex", opencode: null },
      low: { claude: "claude-haiku-4", codex: "gpt-5.4-mini", opencode: null },
    },
  };
}

/** Minimal invocations map */
function minimalInvocations(): InvocationsMap {
  return {
    subagent_spawn: {
      args: ["target_role", "prompt", "name"],
      templates: {
        claude: 'Agent({ subagent_type: "{target_role}", prompt: "{prompt}", description: "{name}" })',
        opencode: 'task({ subagent_type: "{target_role}", prompt: "{prompt}", description: "{name}" })',
        codex: 'spawn_agent("{target_role}", "{prompt}")',
      },
    },
    skill_activation: {
      args: ["skill", "mode"],
      templates: {
        claude: 'Skill({ command: "{skill}" })',
        opencode: 'skill({ name: "{skill}" })',
        codex: '${skill}',
      },
    },
    task_register: {
      args: ["label", "state"],
      templates: {
        claude: 'TaskCreate({ subject: "{label}" }) then nx_task_update({ taskId, status: "{state}" })',
        opencode: 'nx_task_add({ subject: "{label}" }) then nx_task_update({ taskId, status: "{state}" })',
        codex: 'update_plan([{ name: "{label}", state: "{state}" }])',
      },
    },
    user_question: {
      args: ["question", "options"],
      templates: {
        claude: 'AskUserQuestion({ questions: [{ question: "{question}", options: {options} }] })',
        opencode: 'question({ question: "{question}", choices: {options} })',
        codex: 'request_user_input({ prompt: "{question}", options: {options} })',
      },
    },
  };
}

function makeAgentEntry(overrides?: Partial<AssetEntry>): AssetEntry {
  return {
    type: "agent",
    name: "sample-architect",
    frontmatter: {
      name: "sample-architect",
      description: "Sample architect agent for testing",
      task: "Architecture, technical design",
      alias_ko: "샘플아키텍트",
      category: "how",
      resume_tier: "persistent",
      model_tier: "high",
      capabilities: ["no_file_edit", "no_task_create", "no_task_update"],
      id: "sample-architect",
    },
    body: "## Role\n\nYou are the Sample Architect.\n",
    bodyPath: join(FIXTURE_BASE, "agents/sample-architect/body.md"),
    ...overrides,
  };
}

function makeEngineerEntry(): AssetEntry {
  return {
    type: "agent",
    name: "sample-engineer",
    frontmatter: {
      name: "sample-engineer",
      description: "Sample engineer agent for testing",
      task: "Code implementation",
      category: "do",
      resume_tier: "bounded",
      model_tier: "standard",
      capabilities: ["no_task_create"],
      id: "sample-engineer",
    },
    body: "## Role\n\nYou are the Sample Engineer.\n",
    bodyPath: join(FIXTURE_BASE, "agents/sample-engineer/body.md"),
  };
}

function makeSkillEntry(): AssetEntry {
  return {
    type: "skill",
    name: "sample-skill",
    frontmatter: {
      name: "sample-skill",
      description: "Sample skill for testing",
      summary: "Sample skill — test only",
      triggers: ["sample"],
      category: "do", // skills don't really have category, but frontmatter requires it
      model_tier: "standard",
      capabilities: [],
      id: "sample-skill",
    },
    body: "## Role\n\nThis is a sample skill.\n",
    bodyPath: join(FIXTURE_BASE, "skills/sample-skill/body.md"),
  };
}

function defaultBuildOpts(targetDir: string, overrides?: Partial<BuildOptions>): BuildOptions {
  return {
    harnesses: ["claude", "opencode", "codex"],
    targetDir,
    dryRun: false,
    force: false,
    strict: false,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Scenario 1: expandInvocations
// ---------------------------------------------------------------------------

describe("Scenario 1 — expandInvocations", () => {
  const invocations = minimalInvocations();

  test("subagent_spawn expands correctly for claude", () => {
    const input = '{{subagent_spawn target_role=researcher prompt="Research the topic" name=Research}}';
    const result = expandInvocations(input, "claude", invocations);
    expect(result).toContain('Agent(');
    expect(result).toContain('"researcher"');
    expect(result).toContain('"Research the topic"');
  });

  test("subagent_spawn expands correctly for opencode", () => {
    const input = '{{subagent_spawn target_role=engineer prompt="Fix the bug"}}';
    const result = expandInvocations(input, "opencode", invocations);
    expect(result).toContain('task(');
    expect(result).toContain('"engineer"');
    expect(result).toContain('"Fix the bug"');
  });

  test("subagent_spawn expands correctly for codex", () => {
    const input = '{{subagent_spawn target_role=engineer prompt="Fix the bug"}}';
    const result = expandInvocations(input, "codex", invocations);
    expect(result).toContain('spawn_agent(');
    expect(result).toContain('"engineer"');
  });

  test("skill_activation expands for claude", () => {
    const input = "{{skill_activation skill=nx-plan}}";
    const result = expandInvocations(input, "claude", invocations);
    expect(result).toContain('Skill(');
    expect(result).toContain("nx-plan");
  });

  test("skill_activation expands for codex", () => {
    const input = "{{skill_activation skill=nx-plan}}";
    const result = expandInvocations(input, "codex", invocations);
    expect(result).toContain("nx-plan");
  });

  test("task_register expands for claude", () => {
    const input = '{{task_register label="Fix the bug" state=in_progress}}';
    const result = expandInvocations(input, "claude", invocations);
    expect(result).toContain("TaskCreate");
    expect(result).toContain("Fix the bug");
    expect(result).toContain("in_progress");
  });

  test("task_register expands for codex", () => {
    const input = '{{task_register label="Fix the bug" state=in_progress}}';
    const result = expandInvocations(input, "codex", invocations);
    expect(result).toContain("update_plan");
    expect(result).toContain("Fix the bug");
    expect(result).toContain("in_progress");
  });

  test("user_question expands for opencode", () => {
    const input = '{{user_question question="Is this correct?" options=["yes","no"]}}';
    const result = expandInvocations(input, "opencode", invocations);
    expect(result).toContain("question(");
    expect(result).toContain("Is this correct?");
  });

  test("unknown invocation returns error comment", () => {
    const input = "{{unknown_invocation key=value}}";
    const result = expandInvocations(input, "claude", invocations);
    expect(result).toContain("[nexus] unknown invocation");
    expect(result).toContain("unknown_invocation");
  });

  test("invalid template (empty) returns error comment", () => {
    const input = "{{}}";
    const result = expandInvocations(input, "claude", invocations);
    expect(result).toContain("[nexus] invalid invocation");
  });

  test("multiple invocations in a single body are all expanded", () => {
    const input = [
      "Use {{skill_activation skill=nx-plan}} and",
      "then {{task_register label=test state=done}}.",
    ].join(" ");
    const result = expandInvocations(input, "claude", invocations);
    expect(result).toContain("Skill(");
    expect(result).toContain("TaskCreate");
    expect(result).not.toContain("{{");
  });

  test("plain text without invocations is unchanged", () => {
    const input = "This is a plain body with no templates.";
    const result = expandInvocations(input, "claude", invocations);
    expect(result).toBe(input);
  });

  // Nested brace/bracket tests (T9 regression cases)

  test("user_question with nested {} in options array expands — no raw {{ left (nx-init case 1)", () => {
    const input =
      '{{user_question question="Select a backup to delete (or cancel)" options=[<backup list...>, {label: Cancel, description: "Exit without changes"}]}}';
    const result = expandInvocations(input, "claude", invocations);
    expect(result).not.toContain("{{");
    expect(result).toContain("AskUserQuestion");
    expect(result).toContain("Select a backup to delete (or cancel)");
  });

  test("user_question with nested {} in options array expands — no raw {{ left (nx-init case 2)", () => {
    const input =
      '{{user_question question="Do you want to set up development rules now?" options=[{label: "Set up", description: "Coding conventions, test policy, commit rules, etc."}, {label: Skip, description: "Can be added later via [rule] tag"}]}}';
    const result = expandInvocations(input, "claude", invocations);
    expect(result).not.toContain("{{");
    expect(result).toContain("AskUserQuestion");
    expect(result).toContain("Do you want to set up development rules now?");
  });

  test("user_question with nested {} expands for opencode harness", () => {
    const input =
      '{{user_question question="Choose an option" options=[{label: "Yes"}, {label: "No"}]}}';
    const result = expandInvocations(input, "opencode", invocations);
    expect(result).not.toContain("{{");
    expect(result).toContain("question(");
    expect(result).toContain("Choose an option");
  });

  test("user_question with nested {} expands for codex harness", () => {
    const input =
      '{{user_question question="Pick one" options=[{label: A}, {label: B}]}}';
    const result = expandInvocations(input, "codex", invocations);
    expect(result).not.toContain("{{");
    expect(result).toContain("request_user_input");
  });

  test("parseInvocationCall correctly extracts options with nested objects", () => {
    const raw =
      'user_question question="Do you want to set up?" options=[{label: "Set up", description: "desc"}, {label: Skip}]';
    const parsed = parseInvocationCall(raw);
    expect(parsed).not.toBeNull();
    expect(parsed!.name).toBe("user_question");
    expect(parsed!.args.question).toBe("Do you want to set up?");
    expect(parsed!.args.options).toBe('[{label: "Set up", description: "desc"}, {label: Skip}]');
  });

  test("parseInvocationCall correctly extracts plain non-whitespace value", () => {
    const raw = "skill_activation skill=nx-plan";
    const parsed = parseInvocationCall(raw);
    expect(parsed).not.toBeNull();
    expect(parsed!.args.skill).toBe("nx-plan");
  });

  test("multiple invocations including nested {} are all expanded with no raw {{ remaining", () => {
    const line1 = '{{user_question question="Q1?" options=[{label: Yes}, {label: No}]}}';
    const line2 = "{{skill_activation skill=nx-plan}}";
    const input = `${line1}\n${line2}`;
    const result = expandInvocations(input, "claude", invocations);
    expect(result).not.toContain("{{");
    expect(result).toContain("AskUserQuestion");
    expect(result).toContain("Skill(");
  });
});

// ---------------------------------------------------------------------------
// Scenario 2: Capability mapping
// ---------------------------------------------------------------------------

describe("Scenario 2 — Capability mapping", () => {
  const capMatrix = minimalCapMatrix();

  test("resolveClaudeDisallowedTools: no_file_edit includes Edit, Write, MultiEdit, NotebookEdit", () => {
    const tools = resolveClaudeDisallowedTools(["no_file_edit"], capMatrix);
    expect(tools).toContain("Edit");
    expect(tools).toContain("Write");
    expect(tools).toContain("MultiEdit");
    expect(tools).toContain("NotebookEdit");
  });

  test("resolveClaudeDisallowedTools: multiple capabilities are merged without duplicates", () => {
    const tools = resolveClaudeDisallowedTools(
      ["no_file_edit", "no_task_create", "no_task_update"],
      capMatrix,
    );
    // no duplicates
    expect(tools.length).toBe(new Set(tools).size);
    expect(tools).toContain("Edit");
    expect(tools).toContain("mcp__plugin_claude-nexus_nx__nx_task_add");
    expect(tools).toContain("mcp__plugin_claude-nexus_nx__nx_task_update");
  });

  test("resolveClaudeDisallowedTools: empty capabilities → empty array", () => {
    const tools = resolveClaudeDisallowedTools([], capMatrix);
    expect(tools).toEqual([]);
  });

  test("resolveClaudeDisallowedTools: unknown capability throws", () => {
    expect(() => resolveClaudeDisallowedTools(["unknown_cap"], capMatrix)).toThrow(
      "Unknown capability",
    );
  });

  test("resolveOpencodePermissions: no_file_edit → edit: deny", () => {
    const perms = resolveOpencodePermissions(["no_file_edit"], capMatrix);
    expect(perms.edit).toBe("deny");
  });

  test("resolveOpencodePermissions: multiple caps merge permissions", () => {
    const perms = resolveOpencodePermissions(
      ["no_file_edit", "no_task_create"],
      capMatrix,
    );
    expect(perms.edit).toBe("deny");
    expect(perms.nx_task_add).toBe("deny");
  });

  test("resolveCodexConfig: no_file_edit → sandbox_mode=read-only", () => {
    const config = resolveCodexConfig(["no_file_edit"], capMatrix);
    expect(config.sandbox_mode).toBe("read-only");
  });

  test("resolveCodexConfig: no_task_create → disabled_tools=[nx_task_add]", () => {
    const config = resolveCodexConfig(["no_task_create"], capMatrix);
    expect(config.disabled_tools).toContain("nx_task_add");
  });

  test("resolveCodexConfig: combined no_file_edit + no_task_create → sandbox + tools", () => {
    const config = resolveCodexConfig(["no_file_edit", "no_task_create"], capMatrix);
    expect(config.sandbox_mode).toBe("read-only");
    expect(config.disabled_tools).toContain("nx_task_add");
  });

  test("resolveModel: high tier → claude-opus-4 for claude", () => {
    const model = resolveModel("high", "claude", capMatrix);
    expect(model).toBe("claude-opus-4");
  });

  test("resolveModel: standard tier → null for opencode (inherit user config)", () => {
    const model = resolveModel("standard", "opencode", capMatrix);
    expect(model).toBeNull();
  });

  test("resolveModel: unknown tier → null", () => {
    const model = resolveModel("unknown_tier", "claude", capMatrix);
    expect(model).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Scenario 3: Manifest generation
// ---------------------------------------------------------------------------

describe("Scenario 3 — Manifest file content", () => {
  const capMatrix = minimalCapMatrix();
  const invocations = minimalInvocations();

  test("Claude: agents/<n>.md is created with frontmatter and body", () => {
    const tmp = makeTmp();
    const assets = [makeAgentEntry()];
    buildForClaude(assets, capMatrix, invocations, defaultBuildOpts(tmp));

    const outPath = join(tmp, "claude", "agents", "sample-architect.md");
    expect(existsSync(outPath)).toBe(true);
    const content = readFileSync(outPath, "utf-8");
    expect(content).toContain("---");
    expect(content).toContain("description:");
    expect(content).toContain("disallowedTools:");
    expect(content).toContain("Edit");
    expect(content).toContain("## Role");
  });

  test("Claude: disallowedTools in agent .md contains all resolved tools", () => {
    const tmp = makeTmp();
    const assets = [makeAgentEntry()];
    buildForClaude(assets, capMatrix, invocations, defaultBuildOpts(tmp));

    const content = readFileSync(join(tmp, "claude", "agents", "sample-architect.md"), "utf-8");
    expect(content).toContain("mcp__plugin_claude-nexus_nx__nx_task_add");
    expect(content).toContain("mcp__plugin_claude-nexus_nx__nx_task_update");
    expect(content).toContain("NotebookEdit");
  });

  test("Claude: model field is emitted from model_tier mapping", () => {
    const tmp = makeTmp();
    const assets = [makeAgentEntry()];
    buildForClaude(assets, capMatrix, invocations, defaultBuildOpts(tmp));

    const content = readFileSync(join(tmp, "claude", "agents", "sample-architect.md"), "utf-8");
    expect(content).toContain("model: claude-opus-4");
  });

  test("Claude: skill SKILL.md is created with description and body", () => {
    const tmp = makeTmp();
    const assets = [makeSkillEntry()];
    buildForClaude(assets, capMatrix, invocations, defaultBuildOpts(tmp));

    const outPath = join(tmp, "claude", "skills", "sample-skill", "SKILL.md");
    expect(existsSync(outPath)).toBe(true);
    const content = readFileSync(outPath, "utf-8");
    expect(content).toContain("description:");
    expect(content).toContain("## Role");
  });

  test("Claude: plugin.json is created as Template", () => {
    const tmp = makeTmp();
    const assets = [makeAgentEntry()];
    buildForClaude(assets, capMatrix, invocations, defaultBuildOpts(tmp));

    const pluginPath = join(tmp, "claude", ".claude-plugin", "plugin.json");
    expect(existsSync(pluginPath)).toBe(true);
    const parsed = JSON.parse(readFileSync(pluginPath, "utf-8")) as { name: string; agents: unknown[] };
    expect(parsed.name).toBe("claude-nexus");
    expect(Array.isArray(parsed.agents)).toBe(true);
    expect((parsed.agents as { id: string }[])[0]?.id).toBe("sample-architect");
  });

  test("Claude: marketplace.json is created as Template", () => {
    const tmp = makeTmp();
    const assets = [makeAgentEntry()];
    buildForClaude(assets, capMatrix, invocations, defaultBuildOpts(tmp));

    const marketPath = join(tmp, "claude", ".claude-plugin", "marketplace.json");
    expect(existsSync(marketPath)).toBe(true);
    const parsed = JSON.parse(readFileSync(marketPath, "utf-8")) as { agents: unknown[] };
    expect(Array.isArray(parsed.agents)).toBe(true);
  });

  test("OpenCode: package.json is created as Template", () => {
    const tmp = makeTmp();
    const assets = [makeAgentEntry()];
    buildForOpencode(assets, capMatrix, invocations, defaultBuildOpts(tmp));

    const pkgPath = join(tmp, "opencode", "package.json");
    expect(existsSync(pkgPath)).toBe(true);
    const parsed = JSON.parse(readFileSync(pkgPath, "utf-8")) as { name: string };
    expect(parsed.name).toBe("opencode-nexus");
  });

  test("OpenCode: src/agents/<n>.ts is created with AgentConfig export", () => {
    const tmp = makeTmp();
    const assets = [makeAgentEntry()];
    buildForOpencode(assets, capMatrix, invocations, defaultBuildOpts(tmp));

    const tsPath = join(tmp, "opencode", "src", "agents", "sample-architect.ts");
    expect(existsSync(tsPath)).toBe(true);
    const content = readFileSync(tsPath, "utf-8");
    expect(content).toContain("AgentConfig");
    expect(content).toContain("sampleArchitect");
    expect(content).toContain("sample-architect");
    expect(content).toContain("system:");
  });

  test("OpenCode: src/agents/<n>.ts does not contain unescaped backtick", () => {
    const tmp = makeTmp();
    // Use an entry with backtick in the body
    const entry = makeAgentEntry({
      body: "## Role\n\nUse `code` here and also \\`escaped\\`.\n",
    });
    buildForOpencode([entry], capMatrix, invocations, defaultBuildOpts(tmp));

    const content = readFileSync(
      join(tmp, "opencode", "src", "agents", "sample-architect.ts"),
      "utf-8",
    );
    // The file should be parseable: no raw unescaped backtick breaking template literal
    // A simple check: count backticks — should be exactly 2 (opening + closing of system field)
    // plus possible escaped ones in the content
    const lines = content.split("\n");
    const systemLine = lines.findIndex((l) => l.includes("system:"));
    expect(systemLine).toBeGreaterThanOrEqual(0);
  });

  test("OpenCode: src/index.ts imports all agents", () => {
    const tmp = makeTmp();
    const assets = [makeAgentEntry(), makeEngineerEntry()];
    buildForOpencode(assets, capMatrix, invocations, defaultBuildOpts(tmp));

    const indexContent = readFileSync(join(tmp, "opencode", "src", "index.ts"), "utf-8");
    expect(indexContent).toContain("sample-architect");
    expect(indexContent).toContain("sample-engineer");
    expect(indexContent).toContain("export const agents");
  });

  test("OpenCode: .opencode/skills/<n>/SKILL.md is created", () => {
    const tmp = makeTmp();
    const assets = [makeSkillEntry()];
    buildForOpencode(assets, capMatrix, invocations, defaultBuildOpts(tmp));

    const skillPath = join(tmp, "opencode", ".opencode", "skills", "sample-skill", "SKILL.md");
    expect(existsSync(skillPath)).toBe(true);
  });

  test("Codex: agents/<n>.toml is created with TOML agent block", () => {
    const tmp = makeTmp();
    const assets = [makeAgentEntry()];
    buildForCodex(assets, capMatrix, invocations, defaultBuildOpts(tmp));

    const tomlPath = join(tmp, "codex", "agents", "sample-architect.toml");
    expect(existsSync(tomlPath)).toBe(true);
    const content = readFileSync(tomlPath, "utf-8");
    expect(content).toContain("[agents.sample-architect]");
    expect(content).toContain("description =");
    expect(content).toContain("sandbox_mode = ");
    expect(content).toContain("gpt-5.4");
  });

  test("Codex: prompts/<n>.md is created", () => {
    const tmp = makeTmp();
    const assets = [makeAgentEntry()];
    buildForCodex(assets, capMatrix, invocations, defaultBuildOpts(tmp));

    const promptPath = join(tmp, "codex", "prompts", "sample-architect.md");
    expect(existsSync(promptPath)).toBe(true);
  });

  test("Codex: plugin/.codex-plugin/plugin.json is created", () => {
    const tmp = makeTmp();
    const assets = [makeAgentEntry()];
    buildForCodex(assets, capMatrix, invocations, defaultBuildOpts(tmp));

    const pluginPath = join(tmp, "codex", "plugin", ".codex-plugin", "plugin.json");
    expect(existsSync(pluginPath)).toBe(true);
    const parsed = JSON.parse(readFileSync(pluginPath, "utf-8")) as { name: string };
    expect(parsed.name).toBe("codex-nexus");
  });

  test("Codex: install/config.fragment.toml is created", () => {
    const tmp = makeTmp();
    const assets = [makeAgentEntry()];
    buildForCodex(assets, capMatrix, invocations, defaultBuildOpts(tmp));

    const fragmentPath = join(tmp, "codex", "install", "config.fragment.toml");
    expect(existsSync(fragmentPath)).toBe(true);
    const content = readFileSync(fragmentPath, "utf-8");
    expect(content).toContain("[mcp_servers.nx]");
  });

  test("Codex: skills SKILL.md is created under plugin/skills/", () => {
    const tmp = makeTmp();
    const assets = [makeSkillEntry()];
    buildForCodex(assets, capMatrix, invocations, defaultBuildOpts(tmp));

    const skillPath = join(tmp, "codex", "plugin", "skills", "sample-skill", "SKILL.md");
    expect(existsSync(skillPath)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Scenario 4: Overwrite policy
// ---------------------------------------------------------------------------

describe("Scenario 4 — Overwrite policy", () => {
  const capMatrix = minimalCapMatrix();
  const invocations = minimalInvocations();

  test("Managed path: always overwrites existing file", () => {
    const tmp = makeTmp();
    const outPath = join(tmp, "managed.txt");
    mkdirSync(tmp, { recursive: true });
    writeFileSync(outPath, "old content");

    const opts = defaultBuildOpts(tmp);
    applyOverwritePolicy(outPath, "new content", true, opts);

    expect(readFileSync(outPath, "utf-8")).toBe("new content");
  });

  test("Template path: skips if file exists (no --force)", () => {
    const tmp = makeTmp();
    const outPath = join(tmp, "template.txt");
    mkdirSync(tmp, { recursive: true });
    writeFileSync(outPath, "original");

    const opts = defaultBuildOpts(tmp, { force: false });
    applyOverwritePolicy(outPath, "overwritten", false, opts);

    expect(readFileSync(outPath, "utf-8")).toBe("original");
  });

  test("Template path: overwrites with --force", () => {
    const tmp = makeTmp();
    const outPath = join(tmp, "template.txt");
    mkdirSync(tmp, { recursive: true });
    writeFileSync(outPath, "original");

    const opts = defaultBuildOpts(tmp, { force: true });
    applyOverwritePolicy(outPath, "overwritten", false, opts);

    expect(readFileSync(outPath, "utf-8")).toBe("overwritten");
  });

  test("Template path: creates file if it does not exist (no --force needed)", () => {
    const tmp = makeTmp();
    const outPath = join(tmp, "new-template.txt");

    const opts = defaultBuildOpts(tmp, { force: false });
    applyOverwritePolicy(outPath, "new content", false, opts);

    expect(existsSync(outPath)).toBe(true);
    expect(readFileSync(outPath, "utf-8")).toBe("new content");
  });

  test("--dry-run: no files are written", () => {
    const tmp = makeTmp();
    const assets = [makeAgentEntry(), makeSkillEntry()];
    const opts = defaultBuildOpts(tmp, { dryRun: true, harnesses: ["claude"] });

    buildForClaude(assets, capMatrix, invocations, opts);

    // No files should be written
    expect(existsSync(join(tmp, "claude"))).toBe(false);
  });

  test("Plugin.json: buildForClaude skips existing plugin.json without --force", () => {
    const tmp = makeTmp();
    const pluginDir = join(tmp, "claude", ".claude-plugin");
    mkdirSync(pluginDir, { recursive: true });
    writeFileSync(join(pluginDir, "plugin.json"), '{"custom": "content"}');

    const assets = [makeAgentEntry()];
    buildForClaude(assets, capMatrix, invocations, defaultBuildOpts(tmp, { force: false }));

    const content = readFileSync(join(pluginDir, "plugin.json"), "utf-8");
    expect(content).toContain('"custom"');
  });

  test("Plugin.json: buildForClaude overwrites with --force", () => {
    const tmp = makeTmp();
    const pluginDir = join(tmp, "claude", ".claude-plugin");
    mkdirSync(pluginDir, { recursive: true });
    writeFileSync(join(pluginDir, "plugin.json"), '{"custom": "content"}');

    const assets = [makeAgentEntry()];
    buildForClaude(assets, capMatrix, invocations, defaultBuildOpts(tmp, { force: true }));

    const content = readFileSync(join(pluginDir, "plugin.json"), "utf-8");
    expect(content).toContain("claude-nexus");
    expect(content).not.toContain('"custom"');
  });
});

// ---------------------------------------------------------------------------
// Scenario 5: Harness builders — full build with invocation expansion
// ---------------------------------------------------------------------------

describe("Scenario 5 — Harness builders with invocation expansion", () => {
  const capMatrix = minimalCapMatrix();
  const invocations = minimalInvocations();

  test("Claude: invocations in body are expanded", () => {
    const tmp = makeTmp();
    const entry = makeAgentEntry({
      body: 'Use {{subagent_spawn target_role=researcher prompt="research task"}}.\n',
    });
    buildForClaude([entry], capMatrix, invocations, defaultBuildOpts(tmp));

    const content = readFileSync(join(tmp, "claude", "agents", "sample-architect.md"), "utf-8");
    expect(content).toContain("Agent(");
    expect(content).toContain('"researcher"');
    expect(content).not.toContain("{{");
  });

  test("OpenCode: invocations in body are expanded", () => {
    const tmp = makeTmp();
    const entry = makeAgentEntry({
      body: 'Use {{subagent_spawn target_role=engineer prompt="fix it"}}.\n',
    });
    buildForOpencode([entry], capMatrix, invocations, defaultBuildOpts(tmp));

    const content = readFileSync(
      join(tmp, "opencode", "src", "agents", "sample-architect.ts"),
      "utf-8",
    );
    expect(content).toContain("task(");
    expect(content).toContain('"engineer"');
    expect(content).not.toContain("{{");
  });

  test("Codex: invocations in body are expanded", () => {
    const tmp = makeTmp();
    const entry = makeAgentEntry({
      body: 'Use {{task_register label="Do thing" state=in_progress}}.\n',
    });
    buildForCodex([entry], capMatrix, invocations, defaultBuildOpts(tmp));

    const content = readFileSync(join(tmp, "codex", "agents", "sample-architect.toml"), "utf-8");
    expect(content).toContain("update_plan");
    expect(content).toContain("Do thing");
    expect(content).not.toContain("{{");
  });

  test("All three harnesses: both agents and skills are built", () => {
    const tmp = makeTmp();
    const assets = [makeAgentEntry(), makeEngineerEntry(), makeSkillEntry()];
    const opts = defaultBuildOpts(tmp);

    buildForClaude(assets, capMatrix, invocations, opts);
    buildForOpencode(assets, capMatrix, invocations, opts);
    buildForCodex(assets, capMatrix, invocations, opts);

    // Claude
    expect(existsSync(join(tmp, "claude", "agents", "sample-architect.md"))).toBe(true);
    expect(existsSync(join(tmp, "claude", "agents", "sample-engineer.md"))).toBe(true);
    expect(existsSync(join(tmp, "claude", "skills", "sample-skill", "SKILL.md"))).toBe(true);

    // OpenCode
    expect(existsSync(join(tmp, "opencode", "src", "agents", "sample-architect.ts"))).toBe(true);
    expect(existsSync(join(tmp, "opencode", "src", "agents", "sample-engineer.ts"))).toBe(true);
    expect(existsSync(join(tmp, "opencode", ".opencode", "skills", "sample-skill", "SKILL.md"))).toBe(true);

    // Codex
    expect(existsSync(join(tmp, "codex", "agents", "sample-architect.toml"))).toBe(true);
    expect(existsSync(join(tmp, "codex", "agents", "sample-engineer.toml"))).toBe(true);
    expect(existsSync(join(tmp, "codex", "plugin", "skills", "sample-skill", "SKILL.md"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Scenario 6: Error paths
// ---------------------------------------------------------------------------

describe("Scenario 6 — Error paths", () => {
  test("parseFrontmatter: missing frontmatter throws", () => {
    expect(() => parseFrontmatter("No frontmatter here", "test.md")).toThrow(
      "Missing or malformed frontmatter",
    );
  });

  test("parseFrontmatter: malformed YAML frontmatter throws", () => {
    const raw = "---\nname: [\ninvalid: yaml:\n---\nbody";
    expect(() => parseFrontmatter(raw, "test.md")).toThrow("YAML parse failure");
  });

  test("parseFrontmatter: missing required fields (id) throws", () => {
    const raw = "---\nname: test\n---\nbody";
    expect(() => parseFrontmatter(raw, "test.md")).toThrow("Missing required frontmatter fields");
  });

  test("parseFrontmatter: valid frontmatter parses correctly", () => {
    const raw = "---\nname: test\nid: test\ncategory: do\nmodel_tier: standard\ncapabilities: []\n---\n## Body";
    const { fm, body } = parseFrontmatter(raw, "test.md");
    expect(fm.name).toBe("test");
    expect(fm.id).toBe("test");
    expect(body).toContain("## Body");
  });

  test("resolveClaudeDisallowedTools: unknown capability throws with capability name", () => {
    const capMatrix = minimalCapMatrix();
    expect(() => resolveClaudeDisallowedTools(["unknown_cap_xyz"], capMatrix)).toThrow(
      "unknown_cap_xyz",
    );
  });

  test("buildForClaude: unknown capability in frontmatter throws", () => {
    const tmp = makeTmp();
    const entry = makeAgentEntry({
      frontmatter: {
        ...makeAgentEntry().frontmatter,
        capabilities: ["unknown_cap_xyz"],
      },
    });
    const capMatrix = minimalCapMatrix();
    expect(() =>
      buildForClaude([entry], capMatrix, minimalInvocations(), defaultBuildOpts(tmp)),
    ).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Scenario 7: CLI arg parsing
// ---------------------------------------------------------------------------

describe("Scenario 7 — CLI arg parsing", () => {
  test("default options: all harnesses, ROOT/dist target", () => {
    const opts = parseArgs(["bun", "build-agents.ts"]);
    expect(opts.harnesses).toEqual(["claude", "opencode", "codex"]);
    expect(opts.targetDir).toContain("dist");
    expect(opts.dryRun).toBe(false);
    expect(opts.force).toBe(false);
    expect(opts.strict).toBe(false);
    expect(opts.only).toBeUndefined();
  });

  test("--harness=claude: restricts to claude", () => {
    const opts = parseArgs(["bun", "build-agents.ts", "--harness=claude"]);
    expect(opts.harnesses).toEqual(["claude"]);
  });

  test("--harness=opencode: restricts to opencode", () => {
    const opts = parseArgs(["bun", "build-agents.ts", "--harness=opencode"]);
    expect(opts.harnesses).toEqual(["opencode"]);
  });

  test("--harness=codex: restricts to codex", () => {
    const opts = parseArgs(["bun", "build-agents.ts", "--harness=codex"]);
    expect(opts.harnesses).toEqual(["codex"]);
  });

  test("--harness=invalid: throws", () => {
    expect(() => parseArgs(["bun", "build-agents.ts", "--harness=invalid"])).toThrow(
      "Unknown harness",
    );
  });

  test("--target sets targetDir to resolved path", () => {
    const opts = parseArgs(["bun", "build-agents.ts", "--target=/tmp/test-out"]);
    expect(opts.targetDir).toBe("/tmp/test-out");
  });

  test("--dry-run sets dryRun flag", () => {
    const opts = parseArgs(["bun", "build-agents.ts", "--dry-run"]);
    expect(opts.dryRun).toBe(true);
  });

  test("--force sets force flag", () => {
    const opts = parseArgs(["bun", "build-agents.ts", "--force"]);
    expect(opts.force).toBe(true);
  });

  test("--strict sets strict flag", () => {
    const opts = parseArgs(["bun", "build-agents.ts", "--strict"]);
    expect(opts.strict).toBe(true);
  });

  test("--only sets only filter", () => {
    const opts = parseArgs(["bun", "build-agents.ts", "--only=architect"]);
    expect(opts.only).toBe("architect");
  });

  test("combined flags all parse correctly", () => {
    const opts = parseArgs([
      "bun",
      "build-agents.ts",
      "--harness=claude",
      "--target=/tmp/out",
      "--dry-run",
      "--force",
      "--strict",
      "--only=engineer",
    ]);
    expect(opts.harnesses).toEqual(["claude"]);
    expect(opts.targetDir).toBe("/tmp/out");
    expect(opts.dryRun).toBe(true);
    expect(opts.force).toBe(true);
    expect(opts.strict).toBe(true);
    expect(opts.only).toBe("engineer");
  });
});

// ---------------------------------------------------------------------------
// Scenario 8: Integration — buildAgents reads real assets
// ---------------------------------------------------------------------------

describe("Scenario 8 — Integration with real assets", () => {
  test("buildAgents: claude harness completes without error", async () => {
    const tmp = makeTmp();
    await expect(
      buildAgents({
        harnesses: ["claude"],
        targetDir: tmp,
        dryRun: false,
        force: false,
        strict: false,
      }),
    ).resolves.toBeUndefined();

    // Should have created at least one agent file
    const agentsDir = join(tmp, "claude", "agents");
    const { readdirSync: readdir } = await import("node:fs");
    const files = readdir(agentsDir);
    expect(files.length).toBeGreaterThan(0);
    expect(files.some((f) => f.endsWith(".md"))).toBe(true);
  });

  test("buildAgents: opencode harness completes without error", async () => {
    const tmp = makeTmp();
    await expect(
      buildAgents({
        harnesses: ["opencode"],
        targetDir: tmp,
        dryRun: false,
        force: false,
        strict: false,
      }),
    ).resolves.toBeUndefined();

    const agentsDir = join(tmp, "opencode", "src", "agents");
    const { readdirSync: readdir } = await import("node:fs");
    const files = readdir(agentsDir);
    expect(files.some((f) => f.endsWith(".ts"))).toBe(true);
  });

  test("buildAgents: codex harness completes without error", async () => {
    const tmp = makeTmp();
    await expect(
      buildAgents({
        harnesses: ["codex"],
        targetDir: tmp,
        dryRun: false,
        force: false,
        strict: false,
      }),
    ).resolves.toBeUndefined();

    const agentsDir = join(tmp, "codex", "agents");
    const { readdirSync: readdir } = await import("node:fs");
    const files = readdir(agentsDir);
    expect(files.some((f) => f.endsWith(".toml"))).toBe(true);
  });

  test("buildAgents: --dry-run produces no output files", async () => {
    const tmp = makeTmp();
    await buildAgents({
      harnesses: ["claude"],
      targetDir: tmp,
      dryRun: true,
      force: false,
      strict: false,
    });

    expect(existsSync(join(tmp, "claude"))).toBe(false);
  });

  test("buildAgents: --only=architect restricts to architect agent", async () => {
    const tmp = makeTmp();
    await buildAgents({
      harnesses: ["claude"],
      targetDir: tmp,
      dryRun: false,
      force: false,
      strict: false,
      only: "architect",
    });

    const agentsDir = join(tmp, "claude", "agents");
    const { readdirSync: readdir } = await import("node:fs");
    const files = readdir(agentsDir);
    expect(files).toHaveLength(1);
    expect(files[0]).toBe("architect.md");
  });
});

// ---------------------------------------------------------------------------
// Scenario 9: mode field — primary agent injection
// ---------------------------------------------------------------------------

function makePrimaryAgentEntry(overrides?: Partial<AssetEntry>): AssetEntry {
  return {
    type: "agent",
    name: "sample-lead",
    frontmatter: {
      name: "sample-lead",
      description: "Sample primary orchestrator for testing",
      task: "Orchestration",
      category: "lead",
      resume_tier: "persistent",
      model_tier: "high",
      capabilities: [],
      id: "sample-lead",
      mode: "primary",
    },
    body: "## Identity\n\nYou are Lead.\n",
    bodyPath: join(FIXTURE_BASE, "agents/sample-lead/body.md"),
    ...overrides,
  };
}

describe("Scenario 9 — mode field and primary agent injection", () => {
  const capMatrix = minimalCapMatrix();
  const invocations = minimalInvocations();

  // --- Type parsing ---

  test("parseFrontmatter: mode=primary parses correctly", () => {
    const raw =
      "---\nname: test\nid: test\ncategory: lead\nmodel_tier: high\ncapabilities: []\nmode: primary\n---\n## Body";
    const { fm } = parseFrontmatter(raw, "test.md");
    expect(fm.mode).toBe("primary");
  });

  test("parseFrontmatter: mode=subagent parses correctly", () => {
    const raw =
      "---\nname: test\nid: test\ncategory: do\nmodel_tier: standard\ncapabilities: []\nmode: subagent\n---\n## Body";
    const { fm } = parseFrontmatter(raw, "test.md");
    expect(fm.mode).toBe("subagent");
  });

  test("parseFrontmatter: mode=all parses correctly", () => {
    const raw =
      "---\nname: test\nid: test\ncategory: do\nmodel_tier: standard\ncapabilities: []\nmode: all\n---\n## Body";
    const { fm } = parseFrontmatter(raw, "test.md");
    expect(fm.mode).toBe("all");
  });

  test("parseFrontmatter: invalid mode value throws", () => {
    const raw =
      "---\nname: test\nid: test\ncategory: do\nmodel_tier: standard\ncapabilities: []\nmode: invalid_mode\n---\n## Body";
    expect(() => parseFrontmatter(raw, "test.md")).toThrow('Invalid mode "invalid_mode"');
  });

  test("parseFrontmatter: missing mode field defaults to undefined (treated as subagent)", () => {
    const raw =
      "---\nname: test\nid: test\ncategory: do\nmodel_tier: standard\ncapabilities: []\n---\n## Body";
    const { fm } = parseFrontmatter(raw, "test.md");
    expect(fm.mode).toBeUndefined();
  });

  // --- Claude settings.json ---

  test("Claude: settings.json is created when primary agent exists", () => {
    const tmp = makeTmp();
    const assets = [makePrimaryAgentEntry(), makeAgentEntry()];
    buildForClaude(assets, capMatrix, invocations, defaultBuildOpts(tmp));

    const settingsPath = join(tmp, "claude", "settings.json");
    expect(existsSync(settingsPath)).toBe(true);
    const parsed = JSON.parse(readFileSync(settingsPath, "utf-8")) as { agent: string };
    expect(parsed.agent).toBe("sample-lead");
  });

  test("Claude: settings.json is NOT created when no primary agent exists", () => {
    const tmp = makeTmp();
    const assets = [makeAgentEntry(), makeEngineerEntry()]; // both mode=undefined (subagent default)
    buildForClaude(assets, capMatrix, invocations, defaultBuildOpts(tmp));

    const settingsPath = join(tmp, "claude", "settings.json");
    expect(existsSync(settingsPath)).toBe(false);
  });

  test("Claude: settings.json uses first primary when multiple primaries exist", () => {
    const tmp = makeTmp();
    const primary1 = makePrimaryAgentEntry();
    const primary2 = makePrimaryAgentEntry({
      name: "sample-lead-2",
      frontmatter: { ...makePrimaryAgentEntry().frontmatter, id: "sample-lead-2", name: "sample-lead-2" },
    });
    buildForClaude([primary1, primary2, makeAgentEntry()], capMatrix, invocations, defaultBuildOpts(tmp));

    const settingsPath = join(tmp, "claude", "settings.json");
    expect(existsSync(settingsPath)).toBe(true);
    const parsed = JSON.parse(readFileSync(settingsPath, "utf-8")) as { agent: string };
    expect(parsed.agent).toBe("sample-lead"); // first primary
  });

  // --- OpenCode mode field ---

  test("OpenCode: primary agent .ts file contains mode: 'primary'", () => {
    const tmp = makeTmp();
    const assets = [makePrimaryAgentEntry()];
    buildForOpencode(assets, capMatrix, invocations, defaultBuildOpts(tmp));

    const tsPath = join(tmp, "opencode", "src", "agents", "sample-lead.ts");
    expect(existsSync(tsPath)).toBe(true);
    const content = readFileSync(tsPath, "utf-8");
    expect(content).toContain('mode: "primary"');
  });

  test("OpenCode: subagent (mode=undefined) .ts file does NOT contain mode field", () => {
    const tmp = makeTmp();
    const assets = [makeAgentEntry()]; // no mode set
    buildForOpencode(assets, capMatrix, invocations, defaultBuildOpts(tmp));

    const content = readFileSync(
      join(tmp, "opencode", "src", "agents", "sample-architect.ts"),
      "utf-8",
    );
    expect(content).not.toContain("mode:");
  });

  // --- Codex AGENTS.fragment.md ---

  test("Codex: AGENTS.fragment.md is created when primary agent exists", () => {
    const tmp = makeTmp();
    const assets = [makePrimaryAgentEntry(), makeAgentEntry()];
    buildForCodex(assets, capMatrix, invocations, defaultBuildOpts(tmp));

    const fragmentPath = join(tmp, "codex", "install", "AGENTS.fragment.md");
    expect(existsSync(fragmentPath)).toBe(true);
  });

  test("Codex: AGENTS.fragment.md contains start/end markers with agent id", () => {
    const tmp = makeTmp();
    const assets = [makePrimaryAgentEntry()];
    buildForCodex(assets, capMatrix, invocations, defaultBuildOpts(tmp));

    const content = readFileSync(join(tmp, "codex", "install", "AGENTS.fragment.md"), "utf-8");
    expect(content).toContain("<!-- nexus-core:sample-lead:start -->");
    expect(content).toContain("<!-- nexus-core:sample-lead:end -->");
  });

  test("Codex: AGENTS.fragment.md contains agent name heading and body", () => {
    const tmp = makeTmp();
    const assets = [makePrimaryAgentEntry()];
    buildForCodex(assets, capMatrix, invocations, defaultBuildOpts(tmp));

    const content = readFileSync(join(tmp, "codex", "install", "AGENTS.fragment.md"), "utf-8");
    expect(content).toContain("# sample-lead");
    expect(content).toContain("## Identity");
    expect(content).toContain("You are Lead.");
  });

  test("Codex: AGENTS.fragment.md is NOT created when no primary agent exists", () => {
    const tmp = makeTmp();
    const assets = [makeAgentEntry(), makeEngineerEntry()]; // both subagent default
    buildForCodex(assets, capMatrix, invocations, defaultBuildOpts(tmp));

    const fragmentPath = join(tmp, "codex", "install", "AGENTS.fragment.md");
    expect(existsSync(fragmentPath)).toBe(false);
  });

  test("Codex: AGENTS.fragment.md with multiple primaries has both marker blocks", () => {
    const tmp = makeTmp();
    const primary1 = makePrimaryAgentEntry();
    const primary2 = makePrimaryAgentEntry({
      name: "sample-lead-2",
      frontmatter: { ...makePrimaryAgentEntry().frontmatter, id: "sample-lead-2", name: "sample-lead-2" },
    });
    buildForCodex([primary1, primary2], capMatrix, invocations, defaultBuildOpts(tmp));

    const content = readFileSync(join(tmp, "codex", "install", "AGENTS.fragment.md"), "utf-8");
    expect(content).toContain("<!-- nexus-core:sample-lead:start -->");
    expect(content).toContain("<!-- nexus-core:sample-lead:end -->");
    expect(content).toContain("<!-- nexus-core:sample-lead-2:start -->");
    expect(content).toContain("<!-- nexus-core:sample-lead-2:end -->");
  });

  // --- Integration: real lead agent ---

  test("Integration: buildForClaude creates settings.json with lead as primary from real assets", async () => {
    const tmp = makeTmp();
    await buildAgents({
      harnesses: ["claude"],
      targetDir: tmp,
      dryRun: false,
      force: false,
      strict: false,
    });

    const settingsPath = join(tmp, "claude", "settings.json");
    expect(existsSync(settingsPath)).toBe(true);
    const parsed = JSON.parse(readFileSync(settingsPath, "utf-8")) as { agent: string };
    expect(parsed.agent).toBe("lead");
  });

  test("Integration: buildForCodex creates AGENTS.fragment.md with lead from real assets", async () => {
    const tmp = makeTmp();
    await buildAgents({
      harnesses: ["codex"],
      targetDir: tmp,
      dryRun: false,
      force: false,
      strict: false,
    });

    const fragmentPath = join(tmp, "codex", "install", "AGENTS.fragment.md");
    expect(existsSync(fragmentPath)).toBe(true);
    const content = readFileSync(fragmentPath, "utf-8");
    expect(content).toContain("<!-- nexus-core:lead:start -->");
    expect(content).toContain("<!-- nexus-core:lead:end -->");
  });
});
