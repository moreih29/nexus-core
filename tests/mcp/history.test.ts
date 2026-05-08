import { expect, test } from "bun:test";
import {
  createInMemoryClient,
  parseTextResult,
  withNexusEnv,
  withTempProjectRoot,
} from "./helpers.js";

async function setupCycleWithDecisionAndTask(
  client: Awaited<ReturnType<typeof createInMemoryClient>>["client"],
  {
    topic,
    decision,
    taskTitle,
    taskAcceptance,
    taskApproach,
    taskRisk,
  }: {
    topic: string;
    decision: string;
    taskTitle: string;
    taskAcceptance: string;
    taskApproach?: string;
    taskRisk?: string;
  },
) {
  await client.callTool({
    name: "nx_plan_start",
    arguments: {
      topic,
      issues: ["Issue for search test"],
      research_summary: "Search test setup.",
    },
  });

  await client.callTool({
    name: "nx_plan_decide",
    arguments: { issue_id: 1, decision },
  });

  await client.callTool({
    name: "nx_task_add",
    arguments: {
      title: taskTitle,
      context: "Search test context",
      acceptance: taskAcceptance,
      ...(taskApproach ? { approach: taskApproach } : {}),
      ...(taskRisk ? { risk: taskRisk } : {}),
      owner: { role: "engineer" },
    },
  });

  await client.callTool({ name: "nx_task_close", arguments: { force: true } });
}

test("archives a cycle and exposes it through history search (legacy compat — scope=all default)", async () => {
  await withTempProjectRoot(async (projectRoot: string) => {
    await withNexusEnv(projectRoot, async () => {
      const { client, close } = await createInMemoryClient();

      try {
        await client.callTool({
          name: "nx_plan_start",
          arguments: {
            topic: "Archive this cycle",
            issues: ["Close the cycle"],
            research_summary: "History behavior should be covered.",
          },
        });
        await client.callTool({
          name: "nx_plan_decide",
          arguments: {
            issue_id: 1,
            decision: "Proceed with archiving this cycle now",
          },
        });
        await client.callTool({
          name: "nx_task_add",
          arguments: {
            title: "Record history",
            context: "Need an archived cycle",
            acceptance: "Cycle is written to history.json",
            owner: { role: "lead" },
          },
        });
        await client.callTool({
          name: "nx_task_close",
          arguments: { force: true },
        });

        const result = await client.callTool({
          name: "nx_history_search",
          arguments: {
            query: "archiving",
            last_n: 5,
          },
        });

        const payload = parseTextResult(result) as {
          total_cycles: number;
          total_hits: number;
          hits: Array<{ cycle_id: string; path: string; excerpt: string }>;
        };

        expect(payload.total_cycles).toBe(1);
        expect(payload.total_hits).toBeGreaterThanOrEqual(1);
        expect(payload.hits[0]?.excerpt).toContain("archiving");
      } finally {
        await close();
      }
    });
  });
});

test("query absent returns metadata-only listing", async () => {
  await withTempProjectRoot(async (projectRoot: string) => {
    await withNexusEnv(projectRoot, async () => {
      const { client, close } = await createInMemoryClient();

      try {
        await setupCycleWithDecisionAndTask(client, {
          topic: "Metadata topic",
          decision: "Go with approach A",
          taskTitle: "Do the thing",
          taskAcceptance: "Thing is done",
        });

        const result = await client.callTool({
          name: "nx_history_search",
          arguments: { last_n: 5 },
        });

        const payload = parseTextResult(result) as {
          total: number;
          showing: number;
          cycles: Array<{
            cycle_id: string;
            branch: string;
            completed_at: string;
            plan_topic?: string;
            plan_issues_count: number;
            tasks_count: number;
          }>;
        };

        expect(payload.total).toBe(1);
        expect(payload.showing).toBe(1);
        const c = payload.cycles[0];
        expect(c?.plan_topic).toBe("Metadata topic");
        expect(c?.plan_issues_count).toBe(1);
        expect(c?.tasks_count).toBe(1);
        expect(c?.cycle_id).toBeDefined();
        expect(c?.completed_at).toBeDefined();
      } finally {
        await close();
      }
    });
  });
});

test("scope='decision' matches only plan.issues[].decision", async () => {
  await withTempProjectRoot(async (projectRoot: string) => {
    await withNexusEnv(projectRoot, async () => {
      const { client, close } = await createInMemoryClient();

      try {
        await setupCycleWithDecisionAndTask(client, {
          topic: "Scope test",
          decision: "uniqueDecisionToken goes here",
          taskTitle: "Some task",
          taskAcceptance: "uniqueDecisionToken also in acceptance",
        });

        const result = await client.callTool({
          name: "nx_history_search",
          arguments: {
            query: "uniqueDecisionToken",
            scope: "decision",
          },
        });

        const payload = parseTextResult(result) as {
          hits: Array<{ cycle_id: string; path: string; excerpt: string }>;
        };

        expect(payload.hits.length).toBeGreaterThanOrEqual(1);
        for (const hit of payload.hits) {
          expect(hit.path).toContain("decision");
          expect(hit.path).not.toContain("acceptance");
        }
      } finally {
        await close();
      }
    });
  });
});

test("scope='task.acceptance' matches only task acceptance fields", async () => {
  await withTempProjectRoot(async (projectRoot: string) => {
    await withNexusEnv(projectRoot, async () => {
      const { client, close } = await createInMemoryClient();

      try {
        await setupCycleWithDecisionAndTask(client, {
          topic: "Acceptance scope test",
          decision: "sharedToken in decision",
          taskTitle: "Task with shared token",
          taskAcceptance: "sharedToken in acceptance criteria",
        });

        const result = await client.callTool({
          name: "nx_history_search",
          arguments: {
            query: "sharedToken",
            scope: "task.acceptance",
          },
        });

        const payload = parseTextResult(result) as {
          hits: Array<{ cycle_id: string; path: string; excerpt: string }>;
        };

        expect(payload.hits.length).toBeGreaterThanOrEqual(1);
        for (const hit of payload.hits) {
          expect(hit.path).toContain("acceptance");
          expect(hit.path).not.toContain("decision");
        }
      } finally {
        await close();
      }
    });
  });
});

test("mode='snippet' response has path and excerpt, not full cycle", async () => {
  await withTempProjectRoot(async (projectRoot: string) => {
    await withNexusEnv(projectRoot, async () => {
      const { client, close } = await createInMemoryClient();

      try {
        await setupCycleWithDecisionAndTask(client, {
          topic: "Snippet test",
          decision: "snippetQueryWord decision text",
          taskTitle: "Task",
          taskAcceptance: "acceptance",
        });

        const result = await client.callTool({
          name: "nx_history_search",
          arguments: {
            query: "snippetQueryWord",
            mode: "snippet",
          },
        });

        const payload = parseTextResult(result) as {
          hits: Array<Record<string, unknown>>;
        };

        expect(payload.hits.length).toBeGreaterThanOrEqual(1);
        const hit = payload.hits[0];
        expect(hit).toHaveProperty("cycle_id");
        expect(hit).toHaveProperty("path");
        expect(hit).toHaveProperty("excerpt");
        expect(hit).not.toHaveProperty("plan");
        expect(hit).not.toHaveProperty("tasks");
        expect(hit).not.toHaveProperty("parent");
      } finally {
        await close();
      }
    });
  });
});

test("mode='full' response has parent object, no excerpt", async () => {
  await withTempProjectRoot(async (projectRoot: string) => {
    await withNexusEnv(projectRoot, async () => {
      const { client, close } = await createInMemoryClient();

      try {
        await setupCycleWithDecisionAndTask(client, {
          topic: "Full mode test",
          decision: "fullModeToken decision text",
          taskTitle: "Task",
          taskAcceptance: "acceptance",
        });

        const result = await client.callTool({
          name: "nx_history_search",
          arguments: {
            query: "fullModeToken",
            mode: "full",
            scope: "decision",
          },
        });

        const payload = parseTextResult(result) as {
          hits: Array<Record<string, unknown>>;
        };

        expect(payload.hits.length).toBeGreaterThanOrEqual(1);
        const hit = payload.hits[0];
        expect(hit).toHaveProperty("cycle_id");
        expect(hit).toHaveProperty("path");
        expect(hit).toHaveProperty("parent");
        expect(hit).not.toHaveProperty("excerpt");
      } finally {
        await close();
      }
    });
  });
});

test("group_by_cycle=true: last_n limits by cycle count", async () => {
  await withTempProjectRoot(async (projectRoot: string) => {
    await withNexusEnv(projectRoot, async () => {
      const { client, close } = await createInMemoryClient();

      try {
        for (let i = 0; i < 3; i++) {
          await client.callTool({
            name: "nx_plan_start",
            arguments: {
              topic: `groupCycleToken cycle ${i}`,
              issues: ["Issue"],
              research_summary: "Setup.",
            },
          });
          await client.callTool({
            name: "nx_plan_decide",
            arguments: {
              issue_id: 1,
              decision: `groupCycleToken decision ${i}`,
            },
          });
          await client.callTool({
            name: "nx_task_add",
            arguments: {
              title: `Task ${i}`,
              context: "ctx",
              acceptance: `groupCycleToken acceptance ${i}`,
              owner: { role: "engineer" },
            },
          });
          await client.callTool({
            name: "nx_task_close",
            arguments: { force: true },
          });
        }

        const result = await client.callTool({
          name: "nx_history_search",
          arguments: {
            query: "groupCycleToken",
            last_n: 2,
            group_by_cycle: true,
          },
        });

        const payload = parseTextResult(result) as {
          total_cycles: number;
          total_hits: number;
          hits: Array<{ cycle_id: string }>;
        };

        expect(payload.total_cycles).toBe(2);
        const cycleIds = new Set(payload.hits.map((h) => h.cycle_id));
        expect(cycleIds.size).toBe(2);
      } finally {
        await close();
      }
    });
  });
});

test("group_by_cycle=false: last_n limits by hit count", async () => {
  await withTempProjectRoot(async (projectRoot: string) => {
    await withNexusEnv(projectRoot, async () => {
      const { client, close } = await createInMemoryClient();

      try {
        for (let i = 0; i < 3; i++) {
          await client.callTool({
            name: "nx_plan_start",
            arguments: {
              topic: `hitLimitToken cycle ${i}`,
              issues: ["Issue"],
              research_summary: "Setup.",
            },
          });
          await client.callTool({
            name: "nx_plan_decide",
            arguments: { issue_id: 1, decision: `hitLimitToken decision ${i}` },
          });
          await client.callTool({
            name: "nx_task_add",
            arguments: {
              title: `Task ${i}`,
              context: "ctx",
              acceptance: `hitLimitToken acceptance ${i}`,
              owner: { role: "engineer" },
            },
          });
          await client.callTool({
            name: "nx_task_close",
            arguments: { force: true },
          });
        }

        const result = await client.callTool({
          name: "nx_history_search",
          arguments: {
            query: "hitLimitToken",
            last_n: 3,
            group_by_cycle: false,
          },
        });

        const payload = parseTextResult(result) as {
          total_hits: number;
          hits: Array<{ cycle_id: string; path: string }>;
        };

        expect(payload.total_hits).toBe(3);
        expect(payload.hits.length).toBe(3);
      } finally {
        await close();
      }
    });
  });
});

test("scope='task.result.outcome' with archived cycle without result: empty hits", async () => {
  await withTempProjectRoot(async (projectRoot: string) => {
    await withNexusEnv(projectRoot, async () => {
      const { client, close } = await createInMemoryClient();

      try {
        await client.callTool({
          name: "nx_plan_start",
          arguments: {
            topic: "No result cycle",
            issues: ["Issue"],
            research_summary: "Setup.",
          },
        });
        await client.callTool({
          name: "nx_task_add",
          arguments: {
            title: "Task without result",
            context: "ctx",
            acceptance: "outcomeSearchWord acceptance",
            owner: { role: "engineer" },
          },
        });
        await client.callTool({
          name: "nx_task_close",
          arguments: { force: true },
        });

        const result = await client.callTool({
          name: "nx_history_search",
          arguments: {
            query: "outcomeSearchWord",
            scope: "task.result.outcome",
          },
        });

        const payload = parseTextResult(result) as {
          total_cycles: number;
          hits: Array<unknown>;
        };

        expect(payload.total_cycles).toBe(0);
        expect(payload.hits).toHaveLength(0);
      } finally {
        await close();
      }
    });
  });
});

test("excerpt window trims to ±120 chars with ellipsis on long text", () => {
  const { snippetWindow } = (() => {
    function snippetWindow(text: string, query: string, radius = 120): string {
      const idx = text.toLowerCase().indexOf(query.toLowerCase());
      if (idx === -1) return text.slice(0, radius * 2);
      const start = Math.max(0, idx - radius);
      const end = Math.min(text.length, idx + query.length + radius);
      const prefix = start > 0 ? "…" : "";
      const suffix = end < text.length ? "…" : "";
      return `${prefix}${text.slice(start, end)}${suffix}`;
    }
    return { snippetWindow };
  })();

  const prefix = "a".repeat(200);
  const suffix = "b".repeat(200);
  const text = `${prefix}QUERY${suffix}`;
  const result = snippetWindow(text, "QUERY");

  expect(result.startsWith("…")).toBe(true);
  expect(result.endsWith("…")).toBe(true);
  expect(result).toContain("QUERY");
  expect(result.length).toBeLessThan(text.length);
});
