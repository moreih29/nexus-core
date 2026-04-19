import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import fs from "node:fs";
import fsPromises from "node:fs/promises";
import path from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { makeTempDir } from "../../shared/test-temp.ts";

// ---------------------------------------------------------------------------
// Test isolation: override NEXUS_ROOT resolution via process.chdir
// The plan tools call getNexusRoot() / getStateRoot() which use process.cwd()
// as fallback when no git is present.
// ---------------------------------------------------------------------------

let tmpDir: string;
let originalCwd: string;
let prevSid: string | undefined;

const TEST_SESSION_ID = "test-session";

beforeEach(() => {
  originalCwd = process.cwd();
  prevSid = process.env.NEXUS_SESSION_ID;
  process.env.NEXUS_SESSION_ID = TEST_SESSION_ID;
  tmpDir = makeTempDir("nexus-plan-");
  // Create the expected .nexus/state/<session_id> directory structure
  fs.mkdirSync(path.join(tmpDir, ".nexus", "state", TEST_SESSION_ID), { recursive: true });
  process.chdir(tmpDir);
});

afterEach(async () => {
  process.chdir(originalCwd);
  if (prevSid === undefined) delete process.env.NEXUS_SESSION_ID;
  else process.env.NEXUS_SESSION_ID = prevSid;
  await fsPromises.rm(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function planFilePath(): string {
  return path.join(tmpDir, ".nexus", "state", TEST_SESSION_ID, "plan.json");
}

function historyFilePath(): string {
  return path.join(tmpDir, ".nexus", "history.json");
}

function writePlanFixture(data: object): void {
  fs.writeFileSync(planFilePath(), JSON.stringify(data, null, 2), "utf8");
}

function readPlanFixture(): object {
  return JSON.parse(fs.readFileSync(planFilePath(), "utf8")) as object;
}

// Build a real McpServer and register plan tools, then invoke via internal
// handlers. We call the tools directly by re-exporting through a thin wrapper.
import { registerPlanTools } from "./plan.ts";

// We need a way to call the tool handlers directly.
// McpServer does not expose handlers publicly, so we capture them via monkey-patching.

type ToolHandler = (args: Record<string, unknown>) => Promise<{ content: Array<{ type: string; text: string }> }>;

function makeTestServer(): { call: (name: string, args: Record<string, unknown>) => Promise<unknown> } {
  const handlers = new Map<string, ToolHandler>();

  const fakeServer = {
    tool(name: string, _desc: string, _schema: object, handler: ToolHandler) {
      handlers.set(name, handler);
    },
  } as unknown as McpServer;

  registerPlanTools(fakeServer);

  return {
    async call(name: string, args: Record<string, unknown>): Promise<unknown> {
      const handler = handlers.get(name);
      if (!handler) throw new Error(`Tool not registered: ${name}`);
      const result = await handler(args);
      const text = result.content[0]?.text;
      if (!text) throw new Error("Empty tool response");
      return JSON.parse(text) as unknown;
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("nx_plan_start", () => {
  it("1. 정상 — plan.json 생성 및 응답 검증", async () => {
    const server = makeTestServer();
    const result = await server.call("nx_plan_start", {
      topic: "Test Topic",
      issues: ["Issue A", "Issue B"],
      research_summary: "Some research was done.",
    }) as Record<string, unknown>;

    expect(result.created).toBe(true);
    expect(result.plan_id).toBe(1);
    expect(result.topic).toBe("Test Topic");
    expect(result.issueCount).toBe(2);
    expect(result.previousArchived).toBe(false);

    const plan = readPlanFixture() as Record<string, unknown>;
    expect(plan.id).toBe(1);
    expect(plan.topic).toBe("Test Topic");
    expect(Array.isArray(plan.issues)).toBe(true);
    expect((plan.issues as unknown[]).length).toBe(2);
  });

  it("2. research_summary 빈 문자열 → throw", async () => {
    const server = makeTestServer();
    await expect(
      server.call("nx_plan_start", {
        topic: "Test",
        issues: [],
        research_summary: "",
      })
    ).rejects.toThrow("research_summary is required");
  });

  it("3. 기존 plan.json 있으면 archive 후 새로 시작", async () => {
    const server = makeTestServer();

    // Create first plan
    await server.call("nx_plan_start", {
      topic: "First Plan",
      issues: ["Old Issue"],
      research_summary: "First research.",
    });

    // Create second plan — should archive first
    const result = await server.call("nx_plan_start", {
      topic: "Second Plan",
      issues: ["New Issue"],
      research_summary: "Second research.",
    }) as Record<string, unknown>;

    expect(result.previousArchived).toBe(true);
    expect(result.plan_id).toBe(2);

    const plan = readPlanFixture() as Record<string, unknown>;
    expect(plan.topic).toBe("Second Plan");

    // History should contain the archived first plan
    const history = JSON.parse(fs.readFileSync(historyFilePath(), "utf8")) as Record<string, unknown>;
    expect(Array.isArray(history.cycles)).toBe(true);
    expect((history.cycles as unknown[]).length).toBe(1);
  });
});

describe("nx_plan_status", () => {
  it("4. plan.json 미존재 → { exists: false }", async () => {
    const server = makeTestServer();
    const result = await server.call("nx_plan_status", {}) as Record<string, unknown>;
    expect(result.exists).toBe(false);
  });

  it("5. 존재 + 일부 decided → 올바른 summary 반환", async () => {
    writePlanFixture({
      id: 1,
      topic: "My Plan",
      issues: [
        { id: 1, title: "Issue 1", status: "pending" },
        { id: 2, title: "Issue 2", status: "decided", decision: "Go ahead" },
      ],
      research_summary: "Research done.",
      created_at: new Date().toISOString(),
    });

    const server = makeTestServer();
    const result = await server.call("nx_plan_status", {}) as Record<string, unknown>;

    expect(result.exists).toBe(true);
    expect(result.topic).toBe("My Plan");
    const summary = result.summary as Record<string, number>;
    expect(summary.total).toBe(2);
    expect(summary.pending).toBe(1);
    expect(summary.decided).toBe(1);
    expect(Array.isArray(result.issues)).toBe(true);
  });
});

describe("nx_plan_update", () => {
  beforeEach(() => {
    writePlanFixture({
      id: 1,
      topic: "Update Test",
      issues: [
        { id: 1, title: "Issue One", status: "pending" },
        { id: 2, title: "Issue Two", status: "decided", decision: "Done", analysis: [{ role: "architect", summary: "Analysis", recorded_at: "2024-01-01T00:00:00.000Z" }] },
      ],
      research_summary: "Summary.",
      created_at: new Date().toISOString(),
    });
  });

  it("6. add — 새 issue 추가", async () => {
    const server = makeTestServer();
    const result = await server.call("nx_plan_update", {
      action: "add",
      title: "New Issue",
    }) as Record<string, unknown>;

    expect(result.updated).toBe(true);
    expect(result.action).toBe("add");

    const plan = readPlanFixture() as Record<string, unknown>;
    const issues = plan.issues as Array<Record<string, unknown>>;
    expect(issues.length).toBe(3);
    expect(issues[2].title).toBe("New Issue");
    expect(issues[2].id).toBe(3);
  });

  it("7. remove — issue 제거", async () => {
    const server = makeTestServer();
    const result = await server.call("nx_plan_update", {
      action: "remove",
      issue_id: 1,
    }) as Record<string, unknown>;

    expect(result.updated).toBe(true);
    expect(result.action).toBe("remove");

    const plan = readPlanFixture() as Record<string, unknown>;
    const issues = plan.issues as Array<Record<string, unknown>>;
    expect(issues.length).toBe(1);
    expect(issues[0].id).toBe(2);
  });

  it("8. modify — title 변경, analysis/status/decision 보존", async () => {
    const server = makeTestServer();
    await server.call("nx_plan_update", {
      action: "modify",
      issue_id: 2,
      title: "Modified Issue Two",
    });

    const plan = readPlanFixture() as Record<string, unknown>;
    const issues = plan.issues as Array<Record<string, unknown>>;
    const issue2 = issues.find((i) => i.id === 2) as Record<string, unknown>;

    expect(issue2.title).toBe("Modified Issue Two");
    expect(issue2.status).toBe("decided");
    expect(issue2.decision).toBe("Done");
    // analysis preserved
    expect(Array.isArray(issue2.analysis)).toBe(true);
    expect((issue2.analysis as unknown[]).length).toBe(1);
  });

  it("9. reopen — status pending, decision 제거, analysis 보존", async () => {
    const server = makeTestServer();
    const result = await server.call("nx_plan_update", {
      action: "reopen",
      issue_id: 2,
    }) as Record<string, unknown>;

    expect(result.updated).toBe(true);
    expect(result.action).toBe("reopen");
    expect(result.status).toBe("pending");

    const plan = readPlanFixture() as Record<string, unknown>;
    const issues = plan.issues as Array<Record<string, unknown>>;
    const issue2 = issues.find((i) => i.id === 2) as Record<string, unknown>;

    expect(issue2.status).toBe("pending");
    expect(issue2.decision).toBeUndefined();
    // analysis should be preserved
    expect(Array.isArray(issue2.analysis)).toBe(true);
    expect((issue2.analysis as unknown[]).length).toBe(1);
  });
});

describe("nx_plan_decide", () => {
  beforeEach(() => {
    writePlanFixture({
      id: 1,
      topic: "Decide Test",
      issues: [
        { id: 1, title: "Issue A", status: "pending" },
        { id: 2, title: "Issue B", status: "pending" },
      ],
      research_summary: "Summary.",
      created_at: new Date().toISOString(),
    });
  });

  it("10. 정상 결정", async () => {
    const server = makeTestServer();
    const result = await server.call("nx_plan_decide", {
      issue_id: 1,
      decision: "Approved",
    }) as Record<string, unknown>;

    expect(result.decided).toBe(true);
    expect(result.allComplete).toBe(false);

    const plan = readPlanFixture() as Record<string, unknown>;
    const issues = plan.issues as Array<Record<string, unknown>>;
    const issue1 = issues.find((i) => i.id === 1) as Record<string, unknown>;
    expect(issue1.status).toBe("decided");
    expect(issue1.decision).toBe("Approved");
  });

  it("11. issue_id 미존재 → throw", async () => {
    const server = makeTestServer();
    await expect(
      server.call("nx_plan_decide", { issue_id: 99, decision: "X" })
    ).rejects.toThrow("not found");
  });

  it("12. 이미 decided → 재결정 throw", async () => {
    writePlanFixture({
      id: 1,
      topic: "Decide Test",
      issues: [{ id: 1, title: "Issue A", status: "decided", decision: "Already done" }],
      research_summary: "Summary.",
      created_at: new Date().toISOString(),
    });

    const server = makeTestServer();
    await expect(
      server.call("nx_plan_decide", { issue_id: 1, decision: "New decision" })
    ).rejects.toThrow("이미 결정된 issue");
  });

  it("13. how_agents → analysis 배열 자동 변환", async () => {
    const server = makeTestServer();
    await server.call("nx_plan_decide", {
      issue_id: 1,
      decision: "Approved with analysis",
      how_agents: ["architect", "designer"],
      how_summary: {
        architect: "Architect recommended microservices",
        designer: "Designer suggested clean UI",
      },
      how_agent_ids: {
        architect: "agent-arch-001",
        designer: "agent-des-002",
      },
    });

    const plan = readPlanFixture() as Record<string, unknown>;
    const issues = plan.issues as Array<Record<string, unknown>>;
    const issue1 = issues.find((i) => i.id === 1) as Record<string, unknown>;

    expect(Array.isArray(issue1.analysis)).toBe(true);
    const analysis = issue1.analysis as Array<Record<string, unknown>>;
    expect(analysis.length).toBe(2);

    const archEntry = analysis.find((e) => e.role === "architect") as Record<string, unknown>;
    expect(archEntry.summary).toBe("Architect recommended microservices");
    expect(archEntry.agent_id).toBe("agent-arch-001");
    expect(typeof archEntry.recorded_at).toBe("string");

    const desEntry = analysis.find((e) => e.role === "designer") as Record<string, unknown>;
    expect(desEntry.summary).toBe("Designer suggested clean UI");
    expect(desEntry.agent_id).toBe("agent-des-002");
  });
});

describe("nx_plan_resume", () => {
  it("14. 매칭 entry 있음 → resumable true, agent_id 반환", async () => {
    writePlanFixture({
      id: 1,
      topic: "Resume Test",
      issues: [
        {
          id: 1,
          title: "Issue A",
          status: "decided",
          decision: "Done",
          analysis: [
            { role: "architect", agent_id: "agent-001", summary: "Analysis", recorded_at: "2024-01-01T00:00:00.000Z" },
            { role: "designer", agent_id: "agent-002", summary: "Design analysis", recorded_at: "2024-01-02T00:00:00.000Z" },
          ],
        },
      ],
      research_summary: "Summary.",
      created_at: new Date().toISOString(),
    });

    const server = makeTestServer();
    const result = await server.call("nx_plan_resume", { role: "architect" }) as Record<string, unknown>;

    expect(result.role).toBe("architect");
    expect(result.resumable).toBe(true);
    expect(result.agent_id).toBe("agent-001");
    expect(result.resume_tier).toBeNull();
    expect(result.issue_id).toBe(1);
  });

  it("15. 매칭 entry 없음 → resumable false", async () => {
    writePlanFixture({
      id: 1,
      topic: "Resume Test",
      issues: [{ id: 1, title: "Issue A", status: "pending" }],
      research_summary: "Summary.",
      created_at: new Date().toISOString(),
    });

    const server = makeTestServer();
    const result = await server.call("nx_plan_resume", { role: "architect" }) as Record<string, unknown>;

    expect(result.role).toBe("architect");
    expect(result.resumable).toBe(false);
    expect(result.agent_id).toBeNull();
    expect(result.resume_tier).toBeNull();
    expect(result.issue_id).toBeNull();
  });

  it("plan_resume 응답 정확히 5 필드 (매칭 있음)", async () => {
    writePlanFixture({
      id: 1,
      topic: "Shape Test",
      issues: [
        {
          id: 1,
          title: "Issue A",
          status: "decided",
          decision: "Done",
          analysis: [
            { role: "architect", agent_id: "agent-shape-001", summary: "Shape check", recorded_at: "2024-06-01T00:00:00.000Z" },
          ],
        },
      ],
      research_summary: "Summary.",
      created_at: new Date().toISOString(),
    });

    const server = makeTestServer();
    const result = await server.call("nx_plan_resume", { role: "architect" }) as Record<string, unknown>;
    const keys = Object.keys(result).sort();
    expect(keys).toEqual(["agent_id", "issue_id", "resumable", "resume_tier", "role"]);
  });

  it("plan_resume 응답 정확히 5 필드 (매칭 없음)", async () => {
    writePlanFixture({
      id: 1,
      topic: "Shape Test No Match",
      issues: [{ id: 1, title: "Issue B", status: "pending" }],
      research_summary: "Summary.",
      created_at: new Date().toISOString(),
    });

    const server = makeTestServer();
    const result = await server.call("nx_plan_resume", { role: "designer" }) as Record<string, unknown>;
    const keys = Object.keys(result).sort();
    expect(keys).toEqual(["agent_id", "issue_id", "resumable", "resume_tier", "role"]);
  });
});

describe("nx_plan_analysis_add", () => {
  beforeEach(() => {
    writePlanFixture({
      id: 1,
      topic: "Analysis Test",
      issues: [
        { id: 1, title: "Issue A", status: "pending" },
        { id: 2, title: "Issue B", status: "decided", decision: "Done" },
      ],
      research_summary: "Summary.",
      created_at: new Date().toISOString(),
    });
  });

  it("16. 정상 — analysis entry 추가", async () => {
    const server = makeTestServer();
    const result = await server.call("nx_plan_analysis_add", {
      issue_id: 1,
      role: "architect",
      agent_id: "agent-001",
      summary: "Architecture analysis",
    }) as Record<string, unknown>;

    expect(result.added).toBe(true);
    expect(result.issue_id).toBe(1);
    expect(result.role).toBe("architect");
    expect(typeof result.recorded_at).toBe("string");
    expect(result.total_entries).toBe(1);

    const plan = readPlanFixture() as Record<string, unknown>;
    const issues = plan.issues as Array<Record<string, unknown>>;
    const issue1 = issues.find((i) => i.id === 1) as Record<string, unknown>;
    const analysis = issue1.analysis as Array<Record<string, unknown>>;
    expect(analysis.length).toBe(1);
    expect(analysis[0].role).toBe("architect");
    expect(analysis[0].agent_id).toBe("agent-001");
  });

  it("17. issue_id 미존재 → throw", async () => {
    const server = makeTestServer();
    await expect(
      server.call("nx_plan_analysis_add", {
        issue_id: 99,
        role: "architect",
        summary: "Analysis",
      })
    ).rejects.toThrow("not found");
  });

  it("18. decided issue에도 analysis 추가 가능", async () => {
    const server = makeTestServer();
    const result = await server.call("nx_plan_analysis_add", {
      issue_id: 2,
      role: "postdoc",
      summary: "Post-decision analysis",
    }) as Record<string, unknown>;

    expect(result.added).toBe(true);
    expect(result.issue_id).toBe(2);

    const plan = readPlanFixture() as Record<string, unknown>;
    const issues = plan.issues as Array<Record<string, unknown>>;
    const issue2 = issues.find((i) => i.id === 2) as Record<string, unknown>;
    expect(issue2.status).toBe("decided"); // status unchanged
    expect((issue2.analysis as unknown[]).length).toBe(1);
  });
});

describe("concurrency", () => {
  it("19. 동시 plan_decide + plan_analysis_add race — 데이터 손실 없음", async () => {
    writePlanFixture({
      id: 1,
      topic: "Race Test",
      issues: [
        { id: 1, title: "Issue A", status: "pending" },
        { id: 2, title: "Issue B", status: "pending" },
      ],
      research_summary: "Summary.",
      created_at: new Date().toISOString(),
    });

    const server = makeTestServer();

    // Fire concurrent operations targeting different issues
    await Promise.all([
      server.call("nx_plan_decide", { issue_id: 1, decision: "Decision for A" }),
      server.call("nx_plan_analysis_add", { issue_id: 2, role: "architect", summary: "Analysis for B" }),
      server.call("nx_plan_analysis_add", { issue_id: 1, role: "designer", summary: "Analysis for A" }),
      server.call("nx_plan_decide", { issue_id: 2, decision: "Decision for B" }),
    ]);

    const plan = readPlanFixture() as Record<string, unknown>;
    const issues = plan.issues as Array<Record<string, unknown>>;

    const issue1 = issues.find((i) => i.id === 1) as Record<string, unknown>;
    const issue2 = issues.find((i) => i.id === 2) as Record<string, unknown>;

    expect(issue1.status).toBe("decided");
    expect(issue1.decision).toBe("Decision for A");

    expect(issue2.status).toBe("decided");
    expect(issue2.decision).toBe("Decision for B");

    // Analysis entries should be present
    const analysis1 = issue1.analysis as Array<unknown> | undefined;
    const analysis2 = issue2.analysis as Array<unknown> | undefined;

    expect(Array.isArray(analysis1)).toBe(true);
    expect(Array.isArray(analysis2)).toBe(true);
  }, 15_000);
});

describe("edge cases", () => {
  it("20. 빈 issues 배열로 plan_start", async () => {
    const server = makeTestServer();
    const result = await server.call("nx_plan_start", {
      topic: "Empty Plan",
      issues: [],
      research_summary: "Some research.",
    }) as Record<string, unknown>;

    expect(result.created).toBe(true);
    expect(result.issueCount).toBe(0);

    const plan = readPlanFixture() as Record<string, unknown>;
    expect((plan.issues as unknown[]).length).toBe(0);
  });

  it("21. 매우 긴 decision 문자열", async () => {
    writePlanFixture({
      id: 1,
      topic: "Long Decision",
      issues: [{ id: 1, title: "Issue", status: "pending" }],
      research_summary: "Summary.",
      created_at: new Date().toISOString(),
    });

    const longDecision = "A".repeat(10000);
    const server = makeTestServer();
    const result = await server.call("nx_plan_decide", {
      issue_id: 1,
      decision: longDecision,
    }) as Record<string, unknown>;

    expect(result.decided).toBe(true);
    const plan = readPlanFixture() as Record<string, unknown>;
    const issues = plan.issues as Array<Record<string, unknown>>;
    expect((issues[0].decision as string).length).toBe(10000);
  });

  it("22. special characters in title (한국어, emoji-like, quotes)", async () => {
    const server = makeTestServer();
    await server.call("nx_plan_start", {
      topic: "특수문자 테스트 & \"quotes\" <xml>",
      issues: ["안건 1: 한국어 제목", "Issue with 'single' & \"double\" quotes"],
      research_summary: "조사 완료.",
    });

    const plan = readPlanFixture() as Record<string, unknown>;
    const issues = plan.issues as Array<Record<string, unknown>>;
    expect(issues[0].title).toBe("안건 1: 한국어 제목");
    expect(issues[1].title).toBe("Issue with 'single' & \"double\" quotes");
  });

  it("23. plan_update add — 여러 번 add 후 id가 순차적으로 증가", async () => {
    writePlanFixture({
      id: 1,
      topic: "Sequential Add",
      issues: [{ id: 1, title: "Existing", status: "pending" }],
      research_summary: "Summary.",
      created_at: new Date().toISOString(),
    });

    const server = makeTestServer();
    const r1 = await server.call("nx_plan_update", { action: "add", title: "Second" }) as Record<string, unknown>;
    const r2 = await server.call("nx_plan_update", { action: "add", title: "Third" }) as Record<string, unknown>;

    expect((r1.issue as Record<string, unknown>).id).toBe(2);
    expect((r2.issue as Record<string, unknown>).id).toBe(3);
  });

  it("24. plan_status — plan 없을 때 다른 어떤 필드도 없음", async () => {
    const server = makeTestServer();
    const result = await server.call("nx_plan_status", {}) as Record<string, unknown>;

    expect(result.exists).toBe(false);
    expect(Object.keys(result)).toEqual(["exists"]);
  });

  it("25. plan_resume — plan.json 없을 때 → resumable false", async () => {
    const server = makeTestServer();
    const result = await server.call("nx_plan_resume", { role: "architect" }) as Record<string, unknown>;

    expect(result.resumable).toBe(false);
    expect(result.agent_id).toBeNull();
    expect(result.issue_id).toBeNull();
  });

  it("26. plan_decide allComplete — 마지막 issue 결정 시 message 포함", async () => {
    writePlanFixture({
      id: 1,
      topic: "All Complete",
      issues: [{ id: 1, title: "Only Issue", status: "pending" }],
      research_summary: "Summary.",
      created_at: new Date().toISOString(),
    });

    const server = makeTestServer();
    const result = await server.call("nx_plan_decide", {
      issue_id: 1,
      decision: "Final decision",
    }) as Record<string, unknown>;

    expect(result.allComplete).toBe(true);
    expect(typeof result.message).toBe("string");
  });
});
