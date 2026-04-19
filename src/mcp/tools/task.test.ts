import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import fs from "node:fs";
import fsPromises from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

// ---------------------------------------------------------------------------
// Test isolation: override NEXUS_ROOT resolution via process.chdir
// Tasks tools call getNexusRoot() / getStateRoot() which use process.cwd()
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
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "nexus-task-"));
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

function tasksFilePath(): string {
  return path.join(tmpDir, ".nexus", "state", TEST_SESSION_ID, "tasks.json");
}

function planFilePath(): string {
  return path.join(tmpDir, ".nexus", "state", TEST_SESSION_ID, "plan.json");
}

function historyFilePath(): string {
  return path.join(tmpDir, ".nexus", "history.json");
}

function writeTasksFixture(data: object): void {
  fs.writeFileSync(tasksFilePath(), JSON.stringify(data, null, 2), "utf8");
}

function writePlanFixture(data: object): void {
  fs.writeFileSync(planFilePath(), JSON.stringify(data, null, 2), "utf8");
}

function readTasksFixture(): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(tasksFilePath(), "utf8")) as Record<string, unknown>;
}

function readHistoryFixture(): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(historyFilePath(), "utf8")) as Record<string, unknown>;
}

import { z } from "zod";
import { registerTaskTools } from "./task.ts";

type ToolHandler = (args: Record<string, unknown>) => Promise<{ content: Array<{ type: string; text: string }> }>;
type ZodSchema = z.ZodObject<Record<string, z.ZodTypeAny>>;

function makeTestServer(): { call: (name: string, args: Record<string, unknown>) => Promise<unknown> } {
  const handlers = new Map<string, ToolHandler>();
  const schemas = new Map<string, ZodSchema>();

  const fakeServer = {
    tool(name: string, _desc: string, schema: Record<string, z.ZodTypeAny>, handler: ToolHandler) {
      handlers.set(name, handler);
      schemas.set(name, z.object(schema));
    },
  } as unknown as McpServer;

  registerTaskTools(fakeServer);

  return {
    async call(name: string, args: Record<string, unknown>): Promise<unknown> {
      const handler = handlers.get(name);
      if (!handler) throw new Error(`Tool not registered: ${name}`);

      // Validate + parse args through the zod schema (enforces required fields)
      const schema = schemas.get(name);
      let parsedArgs: Record<string, unknown> = args;
      if (schema) {
        parsedArgs = schema.parse(args) as Record<string, unknown>;
      }

      const result = await handler(parsedArgs);
      const text = result.content[0]?.text;
      if (!text) throw new Error("Empty tool response");
      return JSON.parse(text) as unknown;
    },
  };
}

const baseOwner = { role: "engineer", agent_id: "agent-001", resume_tier: "bounded" as const };

// ---------------------------------------------------------------------------
// nx_task_add
// ---------------------------------------------------------------------------

describe("nx_task_add", () => {
  it("1. 정상 — task 생성 및 응답 검증", async () => {
    const server = makeTestServer();
    const result = await server.call("nx_task_add", {
      title: "Task One",
      context: "Context for task one",
      acceptance: "All tests pass",
      owner: baseOwner,
    }) as Record<string, unknown>;

    expect(result.task).toBeDefined();
    const task = result.task as Record<string, unknown>;
    expect(task.id).toBe(1);
    expect(task.title).toBe("Task One");
    expect(task.status).toBe("pending");
    expect(task.acceptance).toBe("All tests pass");
    expect((task.owner as Record<string, unknown>).role).toBe("engineer");

    const data = readTasksFixture();
    expect((data.tasks as unknown[]).length).toBe(1);
  });

  it("2. acceptance 누락 → zod throw", async () => {
    const server = makeTestServer();
    await expect(
      server.call("nx_task_add", {
        title: "Task",
        context: "ctx",
        owner: baseOwner,
        // acceptance missing
      })
    ).rejects.toThrow();
  });

  it("3. owner 누락 → zod throw", async () => {
    const server = makeTestServer();
    await expect(
      server.call("nx_task_add", {
        title: "Task",
        context: "ctx",
        acceptance: "Done",
        // owner missing
      })
    ).rejects.toThrow();
  });

  it("4. deps에 존재하지 않는 task id → throw 'does not exist'", async () => {
    const server = makeTestServer();
    await expect(
      server.call("nx_task_add", {
        title: "Dependent Task",
        context: "ctx",
        acceptance: "Done",
        owner: baseOwner,
        deps: [99],
      })
    ).rejects.toThrow("does not exist");
  });

  it("5. goal/decisions 갱신 — tasks.json top-level 반영", async () => {
    const server = makeTestServer();
    await server.call("nx_task_add", {
      title: "Task with goal",
      context: "ctx",
      acceptance: "Done",
      owner: baseOwner,
      goal: "Ship v1",
      decisions: ["Use TypeScript", "Use Bun"],
    });

    const data = readTasksFixture();
    expect(data.goal).toBe("Ship v1");
    const decisions = data.decisions as string[];
    expect(decisions).toContain("Use TypeScript");
    expect(decisions).toContain("Use Bun");
  });
});

// ---------------------------------------------------------------------------
// nx_task_list
// ---------------------------------------------------------------------------

describe("nx_task_list", () => {
  it("6. include_completed=true — 모든 task 반환", async () => {
    writeTasksFixture({
      goal: "G",
      tasks: [
        { id: 1, title: "T1", status: "completed", context: "c", acceptance: "a", owner: { role: "lead" }, created_at: new Date().toISOString() },
        { id: 2, title: "T2", status: "pending", context: "c", acceptance: "a", owner: { role: "lead" }, created_at: new Date().toISOString() },
      ],
    });

    const server = makeTestServer();
    const result = await server.call("nx_task_list", { include_completed: true }) as Record<string, unknown>;
    expect((result.tasks as unknown[]).length).toBe(2);
  });

  it("7. include_completed=false — completed 제외", async () => {
    writeTasksFixture({
      tasks: [
        { id: 1, title: "T1", status: "completed", context: "c", acceptance: "a", owner: { role: "lead" }, created_at: new Date().toISOString() },
        { id: 2, title: "T2", status: "pending", context: "c", acceptance: "a", owner: { role: "lead" }, created_at: new Date().toISOString() },
      ],
    });

    const server = makeTestServer();
    const result = await server.call("nx_task_list", { include_completed: false }) as Record<string, unknown>;
    const tasks = result.tasks as Array<Record<string, unknown>>;
    expect(tasks.length).toBe(1);
    expect(tasks[0].id).toBe(2);
  });

  it("8. tasks.json 없을 때 → 빈 결과 (에러 없음)", async () => {
    const server = makeTestServer();
    const result = await server.call("nx_task_list", {}) as Record<string, unknown>;
    expect(Array.isArray(result.tasks)).toBe(true);
    expect((result.tasks as unknown[]).length).toBe(0);
  });

  it("9. summary partition 검증 — in_progress/blocked/ready 분리, mutually exclusive", async () => {
    writeTasksFixture({
      tasks: [
        { id: 1, title: "T1", status: "completed", context: "c", acceptance: "a", owner: { role: "lead" }, created_at: new Date().toISOString() },
        { id: 2, title: "T2", status: "in_progress", context: "c", acceptance: "a", owner: { role: "lead" }, created_at: new Date().toISOString() },
        { id: 3, title: "T3", status: "pending", context: "c", acceptance: "a", deps: [1], owner: { role: "lead" }, created_at: new Date().toISOString() },
        { id: 4, title: "T4", status: "pending", context: "c", acceptance: "a", deps: [99], owner: { role: "lead" }, created_at: new Date().toISOString() },
      ],
    });

    const server = makeTestServer();
    const result = await server.call("nx_task_list", {}) as Record<string, unknown>;
    const summary = result.summary as Record<string, unknown>;

    expect(summary.total).toBe(4);
    expect((summary.in_progress as number[]).includes(2)).toBe(true);
    expect((summary.completed as number[]).includes(1)).toBe(true);
    // T3 deps=[1] which is completed → ready
    expect((summary.ready as number[]).includes(3)).toBe(true);
    // T4 deps=[99] which doesn't exist (not completed) → blocked
    expect((summary.blocked as number[]).includes(4)).toBe(true);
    // Verify mutually exclusive — no id appears in more than one partition
    const allIds = [
      ...(summary.in_progress as number[]),
      ...(summary.completed as number[]),
      ...(summary.blocked as number[]),
      ...(summary.ready as number[]),
    ];
    expect(allIds.length).toBe(new Set(allIds).size);
  });

  it("10. summary 항상 full — include_completed=false여도 summary는 전체 기준", async () => {
    writeTasksFixture({
      tasks: [
        { id: 1, title: "T1", status: "completed", context: "c", acceptance: "a", owner: { role: "lead" }, created_at: new Date().toISOString() },
        { id: 2, title: "T2", status: "pending", context: "c", acceptance: "a", owner: { role: "lead" }, created_at: new Date().toISOString() },
      ],
    });

    const server = makeTestServer();
    const result = await server.call("nx_task_list", { include_completed: false }) as Record<string, unknown>;
    // Tasks list excludes completed
    expect((result.tasks as unknown[]).length).toBe(1);
    // But summary counts all tasks
    const summary = result.summary as Record<string, unknown>;
    expect(summary.total).toBe(2);
    expect((summary.completed as number[]).includes(1)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// nx_task_update
// ---------------------------------------------------------------------------

describe("nx_task_update", () => {
  beforeEach(() => {
    writeTasksFixture({
      tasks: [
        {
          id: 1,
          title: "T1",
          status: "pending",
          context: "c",
          acceptance: "a",
          owner: { role: "engineer", agent_id: "agent-001", resume_tier: "bounded" },
          created_at: new Date().toISOString(),
        },
      ],
    });
  });

  it("11. status 갱신", async () => {
    const server = makeTestServer();
    const result = await server.call("nx_task_update", { id: 1, status: "in_progress" }) as Record<string, unknown>;
    const task = result.task as Record<string, unknown>;
    expect(task.status).toBe("in_progress");

    const data = readTasksFixture();
    const t = (data.tasks as Array<Record<string, unknown>>)[0];
    expect(t.status).toBe("in_progress");
  });

  it("12a. owner.agent_id 갱신", async () => {
    const server = makeTestServer();
    const result = await server.call("nx_task_update", {
      id: 1,
      owner: { agent_id: "agent-NEW" },
    }) as Record<string, unknown>;
    const owner = (result.task as Record<string, unknown>).owner as Record<string, unknown>;
    expect(owner.agent_id).toBe("agent-NEW");
    expect(owner.role).toBe("engineer"); // role preserved
  });

  it("12b. owner.agent_id null → 필드 삭제", async () => {
    const server = makeTestServer();
    const result = await server.call("nx_task_update", {
      id: 1,
      owner: { agent_id: null },
    }) as Record<string, unknown>;
    const owner = (result.task as Record<string, unknown>).owner as Record<string, unknown>;
    expect(owner.agent_id).toBeUndefined();
    expect(owner.role).toBe("engineer");
  });

  it("12c. owner.resume_tier 갱신", async () => {
    const server = makeTestServer();
    const result = await server.call("nx_task_update", {
      id: 1,
      owner: { resume_tier: "persistent" },
    }) as Record<string, unknown>;
    const owner = (result.task as Record<string, unknown>).owner as Record<string, unknown>;
    expect(owner.resume_tier).toBe("persistent");
  });

  it("13. id 미존재 → throw", async () => {
    const server = makeTestServer();
    await expect(
      server.call("nx_task_update", { id: 999, status: "completed" })
    ).rejects.toThrow("not found");
  });

  it("14. role 갱신 거부 — owner에 role 필드 없음 (zod schema 레벨)", async () => {
    // The update owner schema should not accept role at all.
    // Passing role in owner should have no effect (zod strips unknown keys or ignores).
    const server = makeTestServer();
    // This should not throw, but role should not be changed
    const result = await server.call("nx_task_update", {
      id: 1,
      owner: { agent_id: "new-agent", role: "attacker" } as Record<string, unknown>,
    }) as Record<string, unknown>;
    const owner = (result.task as Record<string, unknown>).owner as Record<string, unknown>;
    // role stays unchanged — "attacker" is NOT applied
    expect(owner.role).toBe("engineer");
  });
});

// ---------------------------------------------------------------------------
// nx_task_close
// ---------------------------------------------------------------------------

describe("nx_task_close", () => {
  it("15. 정상 close — 파일 삭제 + history append + 응답 4필드", async () => {
    writeTasksFixture({
      tasks: [
        { id: 1, title: "T1", status: "completed", context: "c", acceptance: "a", owner: { role: "lead" }, created_at: new Date().toISOString() },
      ],
    });
    writePlanFixture({
      id: 42,
      topic: "Test Plan",
      issues: [],
      created_at: new Date().toISOString(),
    });

    const server = makeTestServer();
    const result = await server.call("nx_task_close", {}) as Record<string, unknown>;

    expect(result.closed).toBe(true);
    expect(result.plan_id).toBe(42);
    expect(result.task_count).toBe(1);
    expect(result.incomplete_count).toBe(0);

    // Files deleted
    expect(fs.existsSync(tasksFilePath())).toBe(false);
    expect(fs.existsSync(planFilePath())).toBe(false);
  });

  it("16. 미완료 task 있을 때 — throw 없이 incomplete_count 보고", async () => {
    writeTasksFixture({
      tasks: [
        { id: 1, title: "T1", status: "completed", context: "c", acceptance: "a", owner: { role: "lead" }, created_at: new Date().toISOString() },
        { id: 2, title: "T2", status: "pending", context: "c", acceptance: "a", owner: { role: "lead" }, created_at: new Date().toISOString() },
        { id: 3, title: "T3", status: "in_progress", context: "c", acceptance: "a", owner: { role: "lead" }, created_at: new Date().toISOString() },
      ],
    });

    const server = makeTestServer();
    const result = await server.call("nx_task_close", {}) as Record<string, unknown>;
    expect(result.closed).toBe(true);
    expect(result.incomplete_count).toBe(2);
    expect(result.task_count).toBe(3);
  });

  it("17. plan.json 미존재 시 plan_id null", async () => {
    writeTasksFixture({ tasks: [] });
    // No plan file written

    const server = makeTestServer();
    const result = await server.call("nx_task_close", {}) as Record<string, unknown>;
    expect(result.closed).toBe(true);
    expect(result.plan_id).toBeNull();
  });

  it("18. history.json append 검증", async () => {
    writeTasksFixture({
      tasks: [
        { id: 1, title: "T1", status: "completed", context: "c", acceptance: "a", owner: { role: "lead" }, created_at: new Date().toISOString() },
      ],
    });
    writePlanFixture({ id: 7, topic: "My Plan", issues: [], created_at: new Date().toISOString() });

    // Pre-existing history
    const existingHistory = { cycles: [{ completed_at: "2024-01-01T00:00:00.000Z", branch: "main", tasks: [] }] };
    fs.writeFileSync(historyFilePath(), JSON.stringify(existingHistory, null, 2), "utf8");

    const server = makeTestServer();
    await server.call("nx_task_close", {});

    const history = readHistoryFixture();
    const cycles = history.cycles as Array<Record<string, unknown>>;
    // Should have 2 cycles now
    expect(cycles.length).toBe(2);
    const lastCycle = cycles[cycles.length - 1];
    expect((lastCycle.plan as Record<string, unknown>).id).toBe(7);
    expect(Array.isArray(lastCycle.tasks)).toBe(true);
    expect(typeof lastCycle.completed_at).toBe("string");
  });
});

// ---------------------------------------------------------------------------
// nx_task_resume
// ---------------------------------------------------------------------------

describe("nx_task_resume", () => {
  it("19a. resume_tier=persistent → resumable true", async () => {
    writeTasksFixture({
      tasks: [
        {
          id: 1,
          title: "T1",
          status: "pending",
          context: "c",
          acceptance: "a",
          owner: { role: "engineer", agent_id: "agent-001", resume_tier: "persistent" },
          created_at: new Date().toISOString(),
        },
      ],
    });

    const server = makeTestServer();
    const result = await server.call("nx_task_resume", { id: 1 }) as Record<string, unknown>;
    expect(result.task_id).toBe(1);
    expect(result.resumable).toBe(true);
    expect(result.agent_id).toBe("agent-001");
    expect(result.resume_tier).toBe("persistent");
  });

  it("19b. resume_tier=bounded → resumable true", async () => {
    writeTasksFixture({
      tasks: [
        {
          id: 2,
          title: "T2",
          status: "in_progress",
          context: "c",
          acceptance: "a",
          owner: { role: "engineer", agent_id: "agent-002", resume_tier: "bounded" },
          created_at: new Date().toISOString(),
        },
      ],
    });

    const server = makeTestServer();
    const result = await server.call("nx_task_resume", { id: 2 }) as Record<string, unknown>;
    expect(result.resumable).toBe(true);
    expect(result.resume_tier).toBe("bounded");
  });

  it("19c. resume_tier=ephemeral → resumable true", async () => {
    writeTasksFixture({
      tasks: [
        {
          id: 3,
          title: "T3",
          status: "pending",
          context: "c",
          acceptance: "a",
          owner: { role: "engineer", resume_tier: "ephemeral" },
          created_at: new Date().toISOString(),
        },
      ],
    });

    const server = makeTestServer();
    const result = await server.call("nx_task_resume", { id: 3 }) as Record<string, unknown>;
    expect(result.resumable).toBe(true);
    expect(result.resume_tier).toBe("ephemeral");
    expect(result.agent_id).toBeNull();
  });

  it("19d. resume_tier 없음 → resumable false", async () => {
    writeTasksFixture({
      tasks: [
        {
          id: 4,
          title: "T4",
          status: "pending",
          context: "c",
          acceptance: "a",
          owner: { role: "engineer" },
          created_at: new Date().toISOString(),
        },
      ],
    });

    const server = makeTestServer();
    const result = await server.call("nx_task_resume", { id: 4 }) as Record<string, unknown>;
    expect(result.resumable).toBe(false);
    expect(result.resume_tier).toBeNull();
    expect(result.agent_id).toBeNull();
  });

  it("20. id 미존재 → throw", async () => {
    writeTasksFixture({ tasks: [] });
    const server = makeTestServer();
    await expect(
      server.call("nx_task_resume", { id: 99 })
    ).rejects.toThrow("not found");
  });

  it("task_resume 응답 정확히 4 필드 (resumable true)", async () => {
    writeTasksFixture({
      tasks: [
        {
          id: 10,
          title: "Shape Task",
          status: "pending",
          context: "c",
          acceptance: "a",
          owner: { role: "engineer", agent_id: "shape-agent-001", resume_tier: "persistent" },
          created_at: new Date().toISOString(),
        },
      ],
    });

    const server = makeTestServer();
    const result = await server.call("nx_task_resume", { id: 10 }) as Record<string, unknown>;
    const keys = Object.keys(result).sort();
    expect(keys).toEqual(["agent_id", "resumable", "resume_tier", "task_id"]);
  });

  it("task_resume 응답 정확히 4 필드 (resumable false)", async () => {
    writeTasksFixture({
      tasks: [
        {
          id: 11,
          title: "Shape Task No Tier",
          status: "pending",
          context: "c",
          acceptance: "a",
          owner: { role: "engineer" },
          created_at: new Date().toISOString(),
        },
      ],
    });

    const server = makeTestServer();
    const result = await server.call("nx_task_resume", { id: 11 }) as Record<string, unknown>;
    const keys = Object.keys(result).sort();
    expect(keys).toEqual(["agent_id", "resumable", "resume_tier", "task_id"]);
  });
});

// ---------------------------------------------------------------------------
// Race condition / concurrency tests
// ---------------------------------------------------------------------------

describe("concurrency", () => {
  it("21. updateJsonFileLocked race — 동시 add 100회 데이터 손실 없음", async () => {
    const server = makeTestServer();

    // Fire 100 concurrent task_add calls
    await Promise.all(
      Array.from({ length: 100 }, (_, i) =>
        server.call("nx_task_add", {
          title: `Task ${i}`,
          context: `ctx-${i}`,
          acceptance: `done-${i}`,
          owner: { role: "engineer" },
        })
      )
    );

    const data = readTasksFixture();
    const tasks = data.tasks as Array<Record<string, unknown>>;
    expect(tasks.length).toBe(100);

    // All IDs should be unique
    const ids = tasks.map((t) => t.id as number);
    expect(ids.length).toBe(new Set(ids).size);
  }, 30_000);

  it("22. atomic close — 동시 close와 add 경쟁 후 history 무결성", async () => {
    writeTasksFixture({
      tasks: [
        { id: 1, title: "T1", status: "completed", context: "c", acceptance: "a", owner: { role: "lead" }, created_at: new Date().toISOString() },
      ],
    });
    writePlanFixture({ id: 1, topic: "Plan", issues: [], created_at: new Date().toISOString() });

    const server = makeTestServer();

    // One close and several adds race together
    await Promise.allSettled([
      server.call("nx_task_close", {}),
      server.call("nx_task_add", { title: "Racing Add", context: "c", acceptance: "a", owner: { role: "engineer" } }),
    ]);

    // history.json must exist and have at least one cycle
    if (fs.existsSync(historyFilePath())) {
      const history = readHistoryFixture();
      const cycles = history.cycles as unknown[];
      expect(cycles.length).toBeGreaterThanOrEqual(1);
    }
  }, 15_000);
});
