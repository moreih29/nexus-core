import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildGeneratedFiles,
  syncSpecsToTarget,
} from "../../src/generate/index.js";

function withTempDir<T>(fn: (dir: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), "nexus-generate-"));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("buildGeneratedFiles expands codex macros and resolves target paths", () => {
  withTempDir((dir) => {
    const files = buildGeneratedFiles("codex", dir);
    const nxRun = files.find((file) =>
      file.targetPath.endsWith(".codex/skills/nx-run/SKILL.md"),
    );
    expect(nxRun).toBeDefined();
    expect(nxRun?.content).toContain("$nx-auto-plan");
    expect(nxRun?.content).toContain(
      'update_plan([{ name: "<label>", state: "pending" }])',
    );
    expect(nxRun?.content).not.toContain("{{");
  });
});

test("syncSpecsToTarget writes codex agent TOML and skill markdown", () => {
  withTempDir((dir) => {
    const result = syncSpecsToTarget({
      harness: "codex",
      target: dir,
    });

    expect(result.writtenFiles.length).toBeGreaterThan(0);

    const leadAgentPath = join(dir, ".codex/agents/lead.toml");
    const architectAgentPath = join(dir, ".codex/agents/architect.toml");
    const researcherAgentPath = join(dir, ".codex/agents/researcher.toml");
    const reviewerAgentPath = join(dir, ".codex/agents/reviewer.toml");
    const testerAgentPath = join(dir, ".codex/agents/tester.toml");
    const nxRunPath = join(dir, ".codex/skills/nx-run/SKILL.md");

    const lead = readFileSync(leadAgentPath, "utf8");
    const architect = readFileSync(architectAgentPath, "utf8");
    const researcher = readFileSync(researcherAgentPath, "utf8");
    const reviewer = readFileSync(reviewerAgentPath, "utf8");
    const tester = readFileSync(testerAgentPath, "utf8");
    expect(lead).toContain('developer_instructions = """');
    expect(lead).toContain('model = "gpt-5.4"');
    expect(architect).toContain('sandbox_mode = "read-only"');
    expect(architect).toContain("[mcp_servers.nx]");
    expect(architect).toContain('"nx_task_add"');
    expect(architect).toContain('"nx_task_update"');
    expect(architect).toContain('"nx_task_close"');
    expect(architect).toContain('"spawn_agent"');
    expect(architect).toContain('"request_user_input"');
    expect(researcher).not.toContain('sandbox_mode = "read-only"');
    expect(reviewer).not.toContain('sandbox_mode = "read-only"');
    expect(tester).not.toContain('sandbox_mode = "read-only"');
    const nxRun = readFileSync(nxRunPath, "utf8");
    expect(nxRun).toContain("$nx-auto-plan");
    expect(nxRun).toContain(
      'update_plan([{ name: "<label>", state: "pending" }])',
    );
  });
});

test("syncSpecsToTarget writes claude markdown assets", () => {
  withTempDir((dir) => {
    syncSpecsToTarget({
      harness: "claude",
      target: dir,
    });

    const leadAgentPath = join(dir, "agents/lead.md");
    const architectAgentPath = join(dir, "agents/architect.md");
    const reviewerAgentPath = join(dir, "agents/reviewer.md");
    const nxRunPath = join(dir, "skills/nx-run/SKILL.md");
    const nxPlanPath = join(dir, "skills/nx-plan/SKILL.md");
    const lead = readFileSync(leadAgentPath, "utf8");
    const architect = readFileSync(architectAgentPath, "utf8");
    const reviewer = readFileSync(reviewerAgentPath, "utf8");
    const nxRun = readFileSync(nxRunPath, "utf8");
    const nxPlan = readFileSync(nxPlanPath, "utf8");

    expect(lead).toContain("description: Primary orchestrator");
    expect(lead).toContain("model: opus");
    expect(architect).toContain("mcp__plugin_claude-nexus_nx__nx_task_close");
    expect(architect).toContain("- Agent");
    expect(architect).toContain("- AskUserQuestion");
    expect(reviewer).not.toContain("NotebookEdit");
    expect(nxRun).toContain('Skill({ command: "nx-auto-plan" })');
    expect(nxRun).toContain(
      'TaskCreate({ subject: "<label>" }) then nx_task_update({ taskId, status: "pending" })',
    );
    expect(nxRun).not.toContain("{{task_register");
    expect(nxPlan).toContain(
      'Agent({ subagent_type: "explore", prompt: "<file/code search task>" })',
    );
    expect(nxPlan).toContain(
      'Agent({ subagent_type: "researcher", prompt: "<research question>" })',
    );
  });
});

test("syncSpecsToTarget writes opencode agent modules", () => {
  withTempDir((dir) => {
    syncSpecsToTarget({
      harness: "opencode",
      target: dir,
    });

    const architectAgentPath = join(dir, "src/agents/architect.ts");
    const leadAgentPath = join(dir, "src/agents/lead.ts");
    const reviewerAgentPath = join(dir, "src/agents/reviewer.ts");
    const nxRunPath = join(dir, "skills/nx-run/SKILL.md");
    const nxPlanPath = join(dir, "skills/nx-plan/SKILL.md");
    const architect = readFileSync(architectAgentPath, "utf8");
    const lead = readFileSync(leadAgentPath, "utf8");
    const reviewer = readFileSync(reviewerAgentPath, "utf8");
    const nxRun = readFileSync(nxRunPath, "utf8");
    const nxPlan = readFileSync(nxPlanPath, "utf8");
    expect(architect).toContain("permission: {");
    expect(architect).toContain('edit: "deny"');
    expect(architect).toContain('nx_task_add: "deny"');
    expect(architect).toContain('nx_task_update: "deny"');
    expect(architect).toContain('nx_task_close: "deny"');
    expect(architect).toContain('task: "deny"');
    expect(architect).toContain('question: "deny"');
    expect(reviewer).not.toContain('edit: "deny"');
    expect(lead).toContain('mode: "primary"');
    expect(lead).toContain("export const lead");
    expect(nxRun).toContain('skill({ name: "nx-auto-plan" })');
    expect(nxPlan).toContain(
      'task({ subagent_type: "explore", prompt: "<file/code search task>", description: "explore" })',
    );
  });
});
