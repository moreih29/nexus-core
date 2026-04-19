import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import fs from "node:fs";
import fsPromises from "node:fs/promises";
import path from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { makeTempDir } from "../../shared/test-temp.ts";

// ---------------------------------------------------------------------------
// Test isolation: override root resolution via NEXUS_PROJECT_ROOT.
// ---------------------------------------------------------------------------

let tmpDir: string;
let prevRoot: string | undefined;

beforeEach(() => {
  prevRoot = process.env.NEXUS_PROJECT_ROOT;
  tmpDir = makeTempDir("nexus-history-");
  fs.mkdirSync(path.join(tmpDir, ".nexus"), { recursive: true });
  process.env.NEXUS_PROJECT_ROOT = tmpDir;
});

afterEach(async () => {
  if (prevRoot === undefined) delete process.env.NEXUS_PROJECT_ROOT;
  else process.env.NEXUS_PROJECT_ROOT = prevRoot;
  await fsPromises.rm(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function historyFilePath(): string {
  return path.join(tmpDir, ".nexus", "history.json");
}

function writeHistoryFixture(data: object): void {
  fs.writeFileSync(historyFilePath(), JSON.stringify(data, null, 2), "utf8");
}

function makeCycle(overrides: Record<string, unknown> = {}, index = 0): Record<string, unknown> {
  return {
    schema_version: "1",
    completed_at: new Date(2024, 0, index + 1).toISOString(),
    branch: `feature/branch-${index}`,
    plan: {
      id: index + 1,
      topic: `Plan topic ${index}`,
      issues: [],
      created_at: new Date(2024, 0, index + 1).toISOString(),
    },
    tasks: [
      {
        id: index + 1,
        title: `Task title ${index}`,
        status: "completed",
        context: "some context",
        acceptance: "all done",
        owner: { role: "engineer" },
        created_at: new Date(2024, 0, index + 1).toISOString(),
      },
    ],
    ...overrides,
  };
}

import { z } from "zod";
import { registerHistoryTools } from "./history.ts";

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

  registerHistoryTools(fakeServer);

  return {
    async call(name: string, args: Record<string, unknown>): Promise<unknown> {
      const handler = handlers.get(name);
      if (!handler) throw new Error(`Tool not registered: ${name}`);

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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("nx_history_search", () => {
  it("1. 빈 history (파일 없음) — total 0, showing 0, cycles []", async () => {
    const server = makeTestServer();
    const result = await server.call("nx_history_search", {}) as Record<string, unknown>;

    expect(result.total).toBe(0);
    expect(result.showing).toBe(0);
    expect(Array.isArray(result.cycles)).toBe(true);
    expect((result.cycles as unknown[]).length).toBe(0);
  });

  it("2. query 미지정 + 5 cycles — total 5, showing 5 (last_n 기본 10이라 모두 포함)", async () => {
    const cycles = Array.from({ length: 5 }, (_, i) => makeCycle({}, i));
    writeHistoryFixture({ cycles });

    const server = makeTestServer();
    const result = await server.call("nx_history_search", {}) as Record<string, unknown>;

    expect(result.total).toBe(5);
    expect(result.showing).toBe(5);
    expect((result.cycles as unknown[]).length).toBe(5);
  });

  it("3. query 미지정 + 15 cycles — total 15, showing 10 (last_n 기본)", async () => {
    const cycles = Array.from({ length: 15 }, (_, i) => makeCycle({}, i));
    writeHistoryFixture({ cycles });

    const server = makeTestServer();
    const result = await server.call("nx_history_search", {}) as Record<string, unknown>;

    expect(result.total).toBe(15);
    expect(result.showing).toBe(10);
    expect((result.cycles as unknown[]).length).toBe(10);
  });

  it("4. last_n 명시 (3) — showing 3", async () => {
    const cycles = Array.from({ length: 8 }, (_, i) => makeCycle({}, i));
    writeHistoryFixture({ cycles });

    const server = makeTestServer();
    const result = await server.call("nx_history_search", { last_n: 3 }) as Record<string, unknown>;

    expect(result.showing).toBe(3);
    expect((result.cycles as unknown[]).length).toBe(3);
  });

  it("5. last_n 0 — showing 0", async () => {
    const cycles = Array.from({ length: 5 }, (_, i) => makeCycle({}, i));
    writeHistoryFixture({ cycles });

    const server = makeTestServer();
    const result = await server.call("nx_history_search", { last_n: 0 }) as Record<string, unknown>;

    expect(result.showing).toBe(0);
    expect((result.cycles as unknown[]).length).toBe(0);
  });

  it("6. query 매칭 (대소문자 무시) — 부분 매칭 검증", async () => {
    const cycles = [
      makeCycle({ branch: "feature/auth-login" }, 0),
      makeCycle({ branch: "fix/api-refactor" }, 1),
      makeCycle({ branch: "docs/update-readme" }, 2),
    ];
    writeHistoryFixture({ cycles });

    const server = makeTestServer();

    // lowercase query matches uppercase in JSON
    const result = await server.call("nx_history_search", { query: "AUTH-LOGIN" }) as Record<string, unknown>;
    expect(result.total).toBe(1);
    const resultCycles = result.cycles as Array<Record<string, unknown>>;
    expect(resultCycles[0].branch).toBe("feature/auth-login");
  });

  it("7. query 미매칭 — total 0", async () => {
    const cycles = Array.from({ length: 3 }, (_, i) => makeCycle({}, i));
    writeHistoryFixture({ cycles });

    const server = makeTestServer();
    const result = await server.call("nx_history_search", { query: "XYZZY_NONEXISTENT_STRING" }) as Record<string, unknown>;

    expect(result.total).toBe(0);
    expect(result.showing).toBe(0);
    expect((result.cycles as unknown[]).length).toBe(0);
  });

  it("8. query 빈 문자열 — 모두 반환 (필터 안 함)", async () => {
    const cycles = Array.from({ length: 5 }, (_, i) => makeCycle({}, i));
    writeHistoryFixture({ cycles });

    const server = makeTestServer();
    const result = await server.call("nx_history_search", { query: "" }) as Record<string, unknown>;

    expect(result.total).toBe(5);
    expect(result.showing).toBe(5);
  });

  it("9. reverse 순서 검증 — completed_at이 가장 최근인 cycle이 cycles[0]", async () => {
    const cycles = [
      makeCycle({ completed_at: "2024-01-01T00:00:00.000Z", branch: "oldest" }, 0),
      makeCycle({ completed_at: "2024-06-01T00:00:00.000Z", branch: "middle" }, 1),
      makeCycle({ completed_at: "2024-12-01T00:00:00.000Z", branch: "newest" }, 2),
    ];
    writeHistoryFixture({ cycles });

    const server = makeTestServer();
    const result = await server.call("nx_history_search", {}) as Record<string, unknown>;

    const resultCycles = result.cycles as Array<Record<string, unknown>>;
    // The array was reversed — index 2 of original should come first
    expect(resultCycles[0].branch).toBe("newest");
    expect(resultCycles[1].branch).toBe("middle");
    expect(resultCycles[2].branch).toBe("oldest");
  });

  it("10. full-text 검색이 plan.topic·decisions·tasks.title 모두 포함 — 깊은 객체 매칭", async () => {
    const cycles = [
      makeCycle(
        {
          branch: "feature/search-deep",
          plan: {
            id: 1,
            topic: "DeepSearchTopic",
            issues: [{ id: 1, title: "Issue about migration", status: "decided", decision: "proceed" }],
            created_at: "2024-01-01T00:00:00.000Z",
          },
          tasks: [
            {
              id: 1,
              title: "ImplementMigration",
              status: "completed",
              context: "c",
              acceptance: "a",
              owner: { role: "engineer" },
              created_at: "2024-01-01T00:00:00.000Z",
            },
          ],
        },
        0
      ),
      makeCycle({ branch: "unrelated-branch" }, 1),
    ];
    writeHistoryFixture({ cycles });

    const server = makeTestServer();

    // Search by plan topic
    const r1 = await server.call("nx_history_search", { query: "DeepSearchTopic" }) as Record<string, unknown>;
    expect(r1.total).toBe(1);

    // Search by task title
    const r2 = await server.call("nx_history_search", { query: "ImplementMigration" }) as Record<string, unknown>;
    expect(r2.total).toBe(1);

    // Search by issue title inside plan
    const r3 = await server.call("nx_history_search", { query: "migration" }) as Record<string, unknown>;
    expect(r3.total).toBe(1);
  });

  it("11. 손상된 history.json — readJsonFile fallback 동작 (default 반환)", async () => {
    // Write invalid JSON
    fs.writeFileSync(historyFilePath(), "{ this is NOT valid JSON %%%", "utf8");

    const server = makeTestServer();
    const result = await server.call("nx_history_search", {}) as Record<string, unknown>;

    // Should return empty result without throwing
    expect(result.total).toBe(0);
    expect(result.showing).toBe(0);
    expect(Array.isArray(result.cycles)).toBe(true);
  });

  it("12. cycle에 memoryHint 필드 들어와도 오류 없이 그대로 반환", async () => {
    const cycles = [
      {
        ...makeCycle({}, 0),
        memoryHint: "some legacy hint that should be ignored by schema but passed through",
      },
    ];
    writeHistoryFixture({ cycles });

    const server = makeTestServer();
    const result = await server.call("nx_history_search", {}) as Record<string, unknown>;

    expect(result.total).toBe(1);
    const resultCycles = result.cycles as Array<Record<string, unknown>>;
    // The cycle is returned as-is (no zod validation strips it — we return raw JSON)
    expect(resultCycles[0].memoryHint).toBe(
      "some legacy hint that should be ignored by schema but passed through"
    );
  });

  it("13. last_n 명시 + query 결합 — 필터 후 limit 적용", async () => {
    const cycles = [
      makeCycle({ branch: "feature/alpha-1" }, 0),
      makeCycle({ branch: "feature/alpha-2" }, 1),
      makeCycle({ branch: "feature/alpha-3" }, 2),
      makeCycle({ branch: "fix/beta-1" }, 3),
      makeCycle({ branch: "fix/beta-2" }, 4),
    ];
    writeHistoryFixture({ cycles });

    const server = makeTestServer();
    // "alpha" matches 3 cycles, but last_n=2 limits to 2
    const result = await server.call("nx_history_search", { query: "alpha", last_n: 2 }) as Record<string, unknown>;

    expect(result.total).toBe(3);
    expect(result.showing).toBe(2);
    expect((result.cycles as unknown[]).length).toBe(2);
  });

  it("14. history.json에 cycles 키 없음 (비정상 구조) — 빈 결과 반환", async () => {
    // Write a valid JSON but without the expected `cycles` key
    fs.writeFileSync(historyFilePath(), JSON.stringify({ schema_version: "1" }), "utf8");

    const server = makeTestServer();
    const result = await server.call("nx_history_search", {}) as Record<string, unknown>;

    expect(result.total).toBe(0);
    expect(result.showing).toBe(0);
    expect((result.cycles as unknown[]).length).toBe(0);
  });
});
