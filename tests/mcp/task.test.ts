import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  createInMemoryClient,
  parseTextResult,
  readErrorText,
  withNexusEnv,
  withTempProjectRoot,
} from "./helpers.js";

function readJsonFile<T>(filePath: string): T {
  return JSON.parse(readFileSync(filePath, "utf8")) as T;
}

test("creates task state under .nexus/state/tasks.json", async () => {
  await withTempProjectRoot(async (projectRoot: string) => {
    await withNexusEnv(projectRoot, async () => {
      const { client, close } = await createInMemoryClient();

      try {
        await client.callTool({
          name: "nx_task_add",
          arguments: {
            title: "Add MCP tests",
            context: "Need protocol-level coverage",
            acceptance: "Tests exist and pass",
            owner: { role: "lead" },
          },
        });

        const tasksPath = join(projectRoot, ".nexus", "state", "tasks.json");
        expect(existsSync(tasksPath)).toBe(true);

        const tasks = readJsonFile<{ tasks: Array<{ title: string }> }>(
          tasksPath,
        );
        expect(tasks.tasks).toHaveLength(1);
        expect(tasks.tasks[0].title).toBe("Add MCP tests");
      } finally {
        await close();
      }
    });
  });
});

test("returns an MCP error result for unknown task deps", async () => {
  await withTempProjectRoot(async (projectRoot: string) => {
    await withNexusEnv(projectRoot, async () => {
      const { client, close } = await createInMemoryClient();

      try {
        const result = await client.callTool({
          name: "nx_task_add",
          arguments: {
            title: "Dependent task",
            context: "Needs another task first",
            acceptance: "Done",
            owner: { role: "lead" },
            deps: [99],
          },
        });

        expect(result.isError).toBe(true);
        expect(readErrorText(result)).toContain("does not exist");
      } finally {
        await close();
      }
    });
  });
});

test("computes task summary partitions across all statuses", async () => {
  await withTempProjectRoot(async (projectRoot: string) => {
    await withNexusEnv(projectRoot, async () => {
      const { client, close } = await createInMemoryClient();

      try {
        await client.callTool({
          name: "nx_task_add",
          arguments: {
            title: "Completed task",
            context: "Base dependency",
            acceptance: "Done",
            owner: { role: "lead" },
          },
        });
        await client.callTool({
          name: "nx_task_update",
          arguments: { id: 1, status: "completed" },
        });

        await client.callTool({
          name: "nx_task_add",
          arguments: {
            title: "In-progress task",
            context: "Work in flight",
            acceptance: "Done",
            owner: { role: "lead" },
          },
        });
        await client.callTool({
          name: "nx_task_update",
          arguments: { id: 2, status: "in_progress" },
        });

        await client.callTool({
          name: "nx_task_add",
          arguments: {
            title: "Ready task",
            context: "Depends on completed task",
            acceptance: "Done",
            owner: { role: "lead" },
            deps: [1],
          },
        });

        await client.callTool({
          name: "nx_task_add",
          arguments: {
            title: "Blocked task",
            context: "Depends on in-progress task",
            acceptance: "Done",
            owner: { role: "lead" },
            deps: [2],
          },
        });

        const result = await client.callTool({
          name: "nx_task_list",
          arguments: {},
        });
        const payload = parseTextResult(result) as {
          summary: {
            total: number;
            in_progress: number[];
            completed: number[];
            blocked: number[];
            ready: number[];
          };
        };

        expect(payload.summary.total).toBe(4);
        expect(payload.summary.completed).toEqual([1]);
        expect(payload.summary.in_progress).toEqual([2]);
        expect(payload.summary.ready).toEqual([3]);
        expect(payload.summary.blocked).toEqual([4]);
      } finally {
        await close();
      }
    });
  });
});

test("updates task owner fields without changing role", async () => {
  await withTempProjectRoot(async (projectRoot: string) => {
    await withNexusEnv(projectRoot, async () => {
      const { client, close } = await createInMemoryClient();

      try {
        await client.callTool({
          name: "nx_task_add",
          arguments: {
            title: "Owner patch test",
            context: "Verify owner updates",
            acceptance: "Done",
            owner: {
              role: "engineer",
              agent_id: "agent-1",
              resume_tier: "bounded",
            },
          },
        });

        await client.callTool({
          name: "nx_task_update",
          arguments: {
            id: 1,
            owner: {
              agent_id: "agent-2",
              resume_tier: null,
            },
          },
        });

        const tasksPath = join(projectRoot, ".nexus", "state", "tasks.json");
        const tasks = readJsonFile<{
          tasks: Array<{ owner: Record<string, unknown> }>;
        }>(tasksPath);
        const owner = tasks.tasks[0]?.owner;

        expect(owner.role).toBe("engineer");
        expect(owner.agent_id).toBe("agent-2");
        expect("resume_tier" in owner).toBe(false);
      } finally {
        await close();
      }
    });
  });
});

test("supports concurrent nx_task_add calls without losing tasks or IDs", async () => {
  await withTempProjectRoot(async (projectRoot: string) => {
    await withNexusEnv(projectRoot, async () => {
      const { client, close } = await createInMemoryClient();

      try {
        const results = await Promise.all(
          Array.from({ length: 10 }, (_, index) =>
            client.callTool({
              name: "nx_task_add",
              arguments: {
                title: `Concurrent task ${index + 1}`,
                context: "Concurrency coverage",
                acceptance: "Done",
                owner: { role: "lead" },
              },
            }),
          ),
        );

        expect(results).toHaveLength(10);

        const tasksPath = join(projectRoot, ".nexus", "state", "tasks.json");
        const tasks = readJsonFile<{
          tasks: Array<{ id: number; title: string }>;
        }>(tasksPath);
        const ids = tasks.tasks.map((task) => task.id).sort((a, b) => a - b);

        expect(tasks.tasks).toHaveLength(10);
        expect(ids).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
      } finally {
        await close();
      }
    });
  });
});

test("removes plan.json and tasks.json when closing the current cycle", async () => {
  await withTempProjectRoot(async (projectRoot: string) => {
    await withNexusEnv(projectRoot, async () => {
      const { client, close } = await createInMemoryClient();

      try {
        await client.callTool({
          name: "nx_plan_start",
          arguments: {
            topic: "Close files test",
            issues: ["Close state files"],
            research_summary: "Need to verify cleanup.",
          },
        });
        await client.callTool({
          name: "nx_task_add",
          arguments: {
            title: "Temporary task",
            context: "Should be archived and removed from state",
            acceptance: "Done",
            owner: { role: "lead" },
          },
        });
        await client.callTool({
          name: "nx_task_close",
          arguments: {},
        });

        expect(
          existsSync(join(projectRoot, ".nexus", "state", "plan.json")),
        ).toBe(false);
        expect(
          existsSync(join(projectRoot, ".nexus", "state", "tasks.json")),
        ).toBe(false);
      } finally {
        await close();
      }
    });
  });
});
