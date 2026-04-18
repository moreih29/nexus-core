import { test, expect, describe } from "bun:test";
import {
  ResumeTierSchema,
  PlanIssueSchema,
  PlanAnalysisEntrySchema,
  PlanFileSchema,
  TaskOwnerSchema,
  TaskItemSchema,
  TasksFileSchema,
  HistoryCycleSchema,
  HistoryFileSchema,
} from "./state.ts";

// ---------------------------------------------------------------------------
// ResumeTier
// ---------------------------------------------------------------------------

describe("ResumeTierSchema", () => {
  test("1. 유효한 enum 값 파싱", () => {
    expect(ResumeTierSchema.parse("persistent")).toBe("persistent");
    expect(ResumeTierSchema.parse("bounded")).toBe("bounded");
    expect(ResumeTierSchema.parse("ephemeral")).toBe("ephemeral");
  });

  test("2. 유효하지 않은 값 — 파싱 실패", () => {
    expect(() => ResumeTierSchema.parse("invalid")).toThrow();
    expect(() => ResumeTierSchema.parse("")).toThrow();
  });
});

// ---------------------------------------------------------------------------
// PlanIssue
// ---------------------------------------------------------------------------

describe("PlanIssueSchema", () => {
  test("3. 최소 필드 round-trip", () => {
    const input = {
      id: 1,
      title: "Test issue",
      status: "pending" as const,
    };
    const result = PlanIssueSchema.parse(input);
    expect(result.id).toBe(1);
    expect(result.title).toBe("Test issue");
    expect(result.status).toBe("pending");
    expect(result.decision).toBeUndefined();
    expect(result.analysis).toBeUndefined();
  });

  test("4. analysis 배열 포함 round-trip", () => {
    const input = {
      id: 2,
      title: "Issue with analysis",
      status: "decided" as const,
      decision: "go with option A",
      analysis: [
        {
          role: "architect",
          agent_id: "arch-1",
          summary: "Chose option A for scalability",
          recorded_at: "2026-01-01T00:00:00.000Z",
        },
      ],
    };
    const result = PlanIssueSchema.parse(input);
    expect(result.analysis).toHaveLength(1);
    expect(result.analysis?.[0].role).toBe("architect");
    expect(result.analysis?.[0].agent_id).toBe("arch-1");
  });

  test("5. legacy 필드 (how_agents 등) 포함 — zod 기본 동작 (strip) 확인", () => {
    const input = {
      id: 3,
      title: "Legacy issue",
      status: "pending" as const,
      how_agents: ["agent1"],
      how_summary: "some summary",
      how_agent_ids: ["id1"],
      discussion: "discussion text",
      task_refs: [1, 2],
      summary: "summary text",
    };
    // zod 기본은 strip — 알 수 없는 필드는 제거됨
    const result = PlanIssueSchema.parse(input);
    expect((result as Record<string, unknown>)["how_agents"]).toBeUndefined();
    expect((result as Record<string, unknown>)["how_summary"]).toBeUndefined();
    expect((result as Record<string, unknown>)["how_agent_ids"]).toBeUndefined();
    expect((result as Record<string, unknown>)["discussion"]).toBeUndefined();
    expect((result as Record<string, unknown>)["task_refs"]).toBeUndefined();
    expect((result as Record<string, unknown>)["summary"]).toBeUndefined();
  });

  test("6. strict 모드에서 legacy 필드 거부", () => {
    const input = {
      id: 4,
      title: "Strict test",
      status: "pending" as const,
      how_agents: ["agent1"],
    };
    expect(() => PlanIssueSchema.strict().parse(input)).toThrow();
  });
});

// ---------------------------------------------------------------------------
// TaskOwner
// ---------------------------------------------------------------------------

describe("TaskOwnerSchema", () => {
  test("7. role 필수 — 없으면 파싱 실패", () => {
    expect(() => TaskOwnerSchema.parse({})).toThrow();
    expect(() => TaskOwnerSchema.parse({ agent_id: "x" })).toThrow();
  });

  test("8. role만 있어도 유효", () => {
    const result = TaskOwnerSchema.parse({ role: "engineer" });
    expect(result.role).toBe("engineer");
    expect(result.agent_id).toBeUndefined();
    expect(result.resume_tier).toBeUndefined();
  });

  test("9. 전체 필드 round-trip", () => {
    const input = { role: "engineer", agent_id: "eng-1", resume_tier: "bounded" as const };
    const result = TaskOwnerSchema.parse(input);
    expect(result).toEqual(input);
  });
});

// ---------------------------------------------------------------------------
// TaskItem
// ---------------------------------------------------------------------------

describe("TaskItemSchema", () => {
  const baseTask = {
    id: 1,
    title: "Implement feature",
    status: "pending" as const,
    context: "some context",
    acceptance: "must pass tests",
    owner: { role: "engineer" },
    created_at: "2026-01-01T00:00:00.000Z",
  };

  test("10. 최소 필드 round-trip", () => {
    const result = TaskItemSchema.parse(baseTask);
    expect(result.id).toBe(1);
    expect(result.owner.role).toBe("engineer");
    expect(result.approach).toBeUndefined();
  });

  test("11. owner가 객체 형식 — 필수 검증", () => {
    const invalid = { ...baseTask, owner: "engineer" };
    expect(() => TaskItemSchema.parse(invalid)).toThrow();
  });

  test("12. status enum 검증", () => {
    expect(() => TaskItemSchema.parse({ ...baseTask, status: "unknown" })).toThrow();
    const r1 = TaskItemSchema.parse({ ...baseTask, status: "in_progress" });
    expect(r1.status).toBe("in_progress");
    const r2 = TaskItemSchema.parse({ ...baseTask, status: "completed" });
    expect(r2.status).toBe("completed");
  });
});

// ---------------------------------------------------------------------------
// HistoryCycle
// ---------------------------------------------------------------------------

describe("HistoryCycleSchema", () => {
  test("13. 최소 필드 round-trip (memoryHint 없음)", () => {
    const input = {
      completed_at: "2026-01-01T00:00:00.000Z",
      branch: "main",
    };
    const result = HistoryCycleSchema.parse(input);
    expect(result.completed_at).toBe("2026-01-01T00:00:00.000Z");
    expect(result.branch).toBe("main");
    expect((result as Record<string, unknown>)["memoryHint"]).toBeUndefined();
  });

  test("14. memoryHint 필드 — strip으로 제거됨", () => {
    const input = {
      completed_at: "2026-01-01T00:00:00.000Z",
      branch: "feat/x",
      memoryHint: "some hint that should be removed",
    };
    const result = HistoryCycleSchema.parse(input);
    expect((result as Record<string, unknown>)["memoryHint"]).toBeUndefined();
  });

  test("15. plan + tasks 포함 round-trip", () => {
    const input = {
      schema_version: "1",
      completed_at: "2026-01-01T00:00:00.000Z",
      branch: "feat/y",
      plan: {
        id: 1,
        topic: "Test plan",
        issues: [],
        created_at: "2026-01-01T00:00:00.000Z",
      },
      tasks: [
        {
          id: 1,
          title: "task",
          status: "completed",
          context: "ctx",
          acceptance: "acc",
          owner: { role: "engineer" },
          created_at: "2026-01-01T00:00:00.000Z",
        },
      ],
    };
    const result = HistoryCycleSchema.parse(input);
    expect(result.plan?.topic).toBe("Test plan");
    expect(result.tasks).toHaveLength(1);
    expect(result.tasks?.[0].owner.role).toBe("engineer");
  });
});

// ---------------------------------------------------------------------------
// HistoryFile + TasksFile (smoke)
// ---------------------------------------------------------------------------

describe("HistoryFileSchema / TasksFileSchema", () => {
  test("16. HistoryFile — 빈 cycles 배열 유효", () => {
    const result = HistoryFileSchema.parse({ cycles: [] });
    expect(result.cycles).toHaveLength(0);
  });

  test("17. TasksFile — goal·decisions optional", () => {
    const result = TasksFileSchema.parse({ tasks: [] });
    expect(result.goal).toBeUndefined();
    expect(result.decisions).toBeUndefined();
    expect(result.tasks).toHaveLength(0);
  });
});
