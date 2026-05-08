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

test("nx_task_update patches acceptance, approach, and risk (rework lane)", async () => {
  await withTempProjectRoot(async (projectRoot: string) => {
    await withNexusEnv(projectRoot, async () => {
      const { client, close } = await createInMemoryClient();

      try {
        await client.callTool({
          name: "nx_task_add",
          arguments: {
            title: "Original title",
            context: "Original context",
            acceptance: "Original acceptance",
            owner: { role: "engineer" },
          },
        });

        const updateResult = await client.callTool({
          name: "nx_task_update",
          arguments: {
            id: 1,
            acceptance: "Updated acceptance",
            approach: "New approach",
            risk: "Some risk",
          },
        });

        const payload = parseTextResult(updateResult) as {
          task: {
            title: string;
            context: string;
            acceptance: string;
            approach: string;
            risk: string;
          };
        };

        expect(payload.task.acceptance).toBe("Updated acceptance");
        expect(payload.task.approach).toBe("New approach");
        expect(payload.task.risk).toBe("Some risk");
        // identity-carrying fields untouched
        expect(payload.task.title).toBe("Original title");
        expect(payload.task.context).toBe("Original context");
      } finally {
        await close();
      }
    });
  });
});

test("nx_task_update silently strips immutable fields (title, context, deps)", async () => {
  await withTempProjectRoot(async (projectRoot: string) => {
    await withNexusEnv(projectRoot, async () => {
      const { client, close } = await createInMemoryClient();

      try {
        await client.callTool({
          name: "nx_task_add",
          arguments: {
            title: "Original title",
            context: "Original context",
            acceptance: "Original acceptance",
            owner: { role: "engineer" },
          },
        });

        await client.callTool({
          name: "nx_task_add",
          arguments: {
            title: "Dep task",
            context: "ctx",
            acceptance: "done",
            owner: { role: "lead" },
          },
        });

        const updateResult = await client.callTool({
          name: "nx_task_update",
          arguments: {
            id: 1,
            // These fields are not in taskUpdateTool input schema and are
            // silently stripped by Zod. The handler never sees them.
            title: "Should not change",
            context: "Should not change",
            deps: [2],
            // A real allowed field to confirm the call still applies the
            // valid portion of the input.
            acceptance: "Updated acceptance",
          } as Record<string, unknown>,
        });

        const payload = parseTextResult(updateResult) as {
          task: {
            title: string;
            context: string;
            acceptance: string;
            deps?: number[];
          };
        };

        expect(payload.task.title).toBe("Original title");
        expect(payload.task.context).toBe("Original context");
        expect(payload.task.deps).toBeUndefined();
        expect(payload.task.acceptance).toBe("Updated acceptance");
      } finally {
        await close();
      }
    });
  });
});

test("nx_task_update sets result with server-stamped recorded_at", async () => {
  await withTempProjectRoot(async (projectRoot: string) => {
    await withNexusEnv(projectRoot, async () => {
      const { client, close } = await createInMemoryClient();

      try {
        await client.callTool({
          name: "nx_task_add",
          arguments: {
            title: "Result test task",
            context: "ctx",
            acceptance: "done",
            owner: { role: "engineer" },
          },
        });

        const before = new Date();

        const updateResult = await client.callTool({
          name: "nx_task_update",
          arguments: {
            id: 1,
            result: {
              outcome: "success",
              summary: "All done",
              artifacts: ["path/to/file.ts"],
            },
          },
        });

        const after = new Date();

        const payload = parseTextResult(updateResult) as {
          task: {
            result: {
              outcome: string;
              summary: string;
              artifacts: string[];
              recorded_at: string;
            };
          };
        };

        expect(payload.task.result.outcome).toBe("success");
        expect(payload.task.result.summary).toBe("All done");
        expect(payload.task.result.artifacts).toEqual(["path/to/file.ts"]);

        const stamp = new Date(payload.task.result.recorded_at);
        expect(stamp.getTime()).toBeGreaterThanOrEqual(before.getTime());
        expect(stamp.getTime()).toBeLessThanOrEqual(after.getTime());
      } finally {
        await close();
      }
    });
  });
});

test("nx_task_update result without artifacts stores no artifacts field", async () => {
  await withTempProjectRoot(async (projectRoot: string) => {
    await withNexusEnv(projectRoot, async () => {
      const { client, close } = await createInMemoryClient();

      try {
        await client.callTool({
          name: "nx_task_add",
          arguments: {
            title: "No artifact task",
            context: "ctx",
            acceptance: "done",
            owner: { role: "engineer" },
          },
        });

        const updateResult = await client.callTool({
          name: "nx_task_update",
          arguments: {
            id: 1,
            result: { outcome: "failure", summary: "Something went wrong" },
          },
        });

        const payload = parseTextResult(updateResult) as {
          task: { result: Record<string, unknown> };
        };

        expect(payload.task.result.outcome).toBe("failure");
        expect("artifacts" in payload.task.result).toBe(false);
      } finally {
        await close();
      }
    });
  });
});

test("nx_task_update does not change owner.role", async () => {
  await withTempProjectRoot(async (projectRoot: string) => {
    await withNexusEnv(projectRoot, async () => {
      const { client, close } = await createInMemoryClient();

      try {
        await client.callTool({
          name: "nx_task_add",
          arguments: {
            title: "Role guard test",
            context: "ctx",
            acceptance: "done",
            owner: { role: "engineer" },
          },
        });

        // owner object in schema only accepts agent_id and resume_tier; role is absent
        const updateResult = await client.callTool({
          name: "nx_task_update",
          arguments: {
            id: 1,
            owner: { agent_id: "new-agent" },
          },
        });

        const payload = parseTextResult(updateResult) as {
          task: { owner: { role: string; agent_id: string } };
        };

        expect(payload.task.owner.role).toBe("engineer");
        expect(payload.task.owner.agent_id).toBe("new-agent");
      } finally {
        await close();
      }
    });
  });
});

test("nx_task_update legacy call with only id+status+owner still works", async () => {
  await withTempProjectRoot(async (projectRoot: string) => {
    await withNexusEnv(projectRoot, async () => {
      const { client, close } = await createInMemoryClient();

      try {
        await client.callTool({
          name: "nx_task_add",
          arguments: {
            title: "Compat task",
            context: "ctx",
            acceptance: "done",
            owner: {
              role: "lead",
              agent_id: "agent-old",
              resume_tier: "bounded",
            },
          },
        });

        const updateResult = await client.callTool({
          name: "nx_task_update",
          arguments: {
            id: 1,
            status: "in_progress",
            owner: { agent_id: "agent-new", resume_tier: null },
          },
        });

        const payload = parseTextResult(updateResult) as {
          task: { status: string; owner: Record<string, unknown> };
        };

        expect(payload.task.status).toBe("in_progress");
        expect(payload.task.owner.agent_id).toBe("agent-new");
        expect("resume_tier" in payload.task.owner).toBe(false);
      } finally {
        await close();
      }
    });
  });
});

test("nx_task_close throws when incomplete tasks exist and force is not set", async () => {
  await withTempProjectRoot(async (projectRoot: string) => {
    await withNexusEnv(projectRoot, async () => {
      const { client, close } = await createInMemoryClient();

      try {
        await client.callTool({
          name: "nx_task_add",
          arguments: {
            title: "Incomplete task A",
            context: "ctx",
            acceptance: "done",
            owner: { role: "lead" },
          },
        });
        await client.callTool({
          name: "nx_task_add",
          arguments: {
            title: "Incomplete task B",
            context: "ctx",
            acceptance: "done",
            owner: { role: "lead" },
          },
        });

        const result = await client.callTool({
          name: "nx_task_close",
          arguments: {},
        });

        expect(result.isError).toBe(true);
        const errorText = readErrorText(result);
        expect(errorText).toContain("1");
        expect(errorText).toContain("2");
        expect(errorText).toContain("force:true");
      } finally {
        await close();
      }
    });
  });
});

test("nx_task_close with force:true closes even when tasks are incomplete", async () => {
  await withTempProjectRoot(async (projectRoot: string) => {
    await withNexusEnv(projectRoot, async () => {
      const { client, close } = await createInMemoryClient();

      try {
        await client.callTool({
          name: "nx_task_add",
          arguments: {
            title: "Incomplete task",
            context: "ctx",
            acceptance: "done",
            owner: { role: "lead" },
          },
        });

        const result = await client.callTool({
          name: "nx_task_close",
          arguments: { force: true },
        });

        expect(result.isError).toBeFalsy();
        const payload = parseTextResult(result) as {
          closed: boolean;
          incomplete_count: number;
        };
        expect(payload.closed).toBe(true);
        expect(payload.incomplete_count).toBe(1);
      } finally {
        await close();
      }
    });
  });
});

test("nx_task_close succeeds without force when all tasks are completed", async () => {
  await withTempProjectRoot(async (projectRoot: string) => {
    await withNexusEnv(projectRoot, async () => {
      const { client, close } = await createInMemoryClient();

      try {
        await client.callTool({
          name: "nx_task_add",
          arguments: {
            title: "Done task",
            context: "ctx",
            acceptance: "done",
            owner: { role: "lead" },
          },
        });
        await client.callTool({
          name: "nx_task_update",
          arguments: { id: 1, status: "completed" },
        });

        const result = await client.callTool({
          name: "nx_task_close",
          arguments: {},
        });

        expect(result.isError).toBeFalsy();
        const payload = parseTextResult(result) as {
          closed: boolean;
          incomplete_count: number;
        };
        expect(payload.closed).toBe(true);
        expect(payload.incomplete_count).toBe(0);
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
          name: "nx_task_update",
          arguments: { id: 1, status: "completed" },
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
