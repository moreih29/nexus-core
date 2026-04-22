import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  createInMemoryClient,
  parseTextResult,
  withNexusEnv,
  withTempProjectRoot,
} from "./helpers.js";

function readJsonFile<T>(filePath: string): T {
  return JSON.parse(readFileSync(filePath, "utf8")) as T;
}

test("creates plan state under .nexus/state/plan.json", async () => {
  await withTempProjectRoot(async (projectRoot: string) => {
    await withNexusEnv(projectRoot, async () => {
      const { client, close } = await createInMemoryClient();

      try {
        await client.callTool({
          name: "nx_plan_start",
          arguments: {
            topic: "Testing MCP server",
            issues: ["Define tests"],
            research_summary: "Reviewed the tool surface and state layout.",
          },
        });

        const planPath = join(projectRoot, ".nexus", "state", "plan.json");
        expect(existsSync(planPath)).toBe(true);

        const plan = readJsonFile<Record<string, unknown>>(planPath);
        expect(plan.topic).toBe("Testing MCP server");
        expect(plan.issues).toHaveLength(1);
      } finally {
        await close();
      }
    });
  });
});

test("archives the previous plan when nx_plan_start is called twice", async () => {
  await withTempProjectRoot(async (projectRoot: string) => {
    await withNexusEnv(projectRoot, async () => {
      const { client, close } = await createInMemoryClient();

      try {
        const firstResult = await client.callTool({
          name: "nx_plan_start",
          arguments: {
            topic: "First plan",
            issues: ["Issue A"],
            research_summary: "Research for the first plan.",
          },
        });
        const firstPayload = parseTextResult(firstResult) as {
          previousArchived: boolean;
          plan_id: number;
        };
        expect(firstPayload.previousArchived).toBe(false);
        expect(firstPayload.plan_id).toBe(1);

        const secondResult = await client.callTool({
          name: "nx_plan_start",
          arguments: {
            topic: "Second plan",
            issues: ["Issue B"],
            research_summary: "Research for the second plan.",
          },
        });
        const secondPayload = parseTextResult(secondResult) as {
          previousArchived: boolean;
          plan_id: number;
        };
        expect(secondPayload.previousArchived).toBe(true);
        expect(secondPayload.plan_id).toBe(2);

        const historyPath = join(projectRoot, ".nexus", "history.json");
        const history = readJsonFile<Record<string, unknown>>(historyPath);
        const cycles = history.cycles as Array<{ plan?: { topic?: string } }>;

        expect(cycles).toHaveLength(1);
        expect(cycles[0]?.plan?.topic).toBe("First plan");
      } finally {
        await close();
      }
    });
  });
});

test("supports concurrent nx_plan_update add calls without ID collisions", async () => {
  await withTempProjectRoot(async (projectRoot: string) => {
    await withNexusEnv(projectRoot, async () => {
      const { client, close } = await createInMemoryClient();

      try {
        await client.callTool({
          name: "nx_plan_start",
          arguments: {
            topic: "Concurrent updates",
            issues: ["Base issue"],
            research_summary: "Need to test concurrent add behavior.",
          },
        });

        const additions = await Promise.all(
          Array.from({ length: 8 }, (_, index) =>
            client.callTool({
              name: "nx_plan_update",
              arguments: {
                action: "add",
                title: `Concurrent issue ${index + 1}`,
              },
            }),
          ),
        );

        expect(additions).toHaveLength(8);

        const planPath = join(projectRoot, ".nexus", "state", "plan.json");
        const plan = readJsonFile<{
          issues: Array<{ id: number; title: string }>;
        }>(planPath);
        const ids = plan.issues.map((issue) => issue.id).sort((a, b) => a - b);
        const titles = new Set(plan.issues.map((issue) => issue.title));

        expect(plan.issues).toHaveLength(9);
        expect(ids).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
        expect(titles.has("Base issue")).toBe(true);
        expect(titles.has("Concurrent issue 8")).toBe(true);
      } finally {
        await close();
      }
    });
  });
});

test("nx_plan_decide records only the final decision and does not append analysis", async () => {
  await withTempProjectRoot(async (projectRoot: string) => {
    await withNexusEnv(projectRoot, async () => {
      const { client, close } = await createInMemoryClient();

      try {
        await client.callTool({
          name: "nx_plan_start",
          arguments: {
            topic: "Decision semantics",
            issues: ["Keep analysis stable"],
            research_summary:
              "Need to verify decide only updates decision state.",
          },
        });

        await client.callTool({
          name: "nx_plan_analysis_add",
          arguments: {
            issue_id: 1,
            role: "architect",
            agent_id: "agent-1",
            summary: "Detailed architectural analysis",
          },
        });

        await client.callTool({
          name: "nx_plan_decide",
          arguments: {
            issue_id: 1,
            decision:
              "Proceed with the simpler architecture because it satisfies v1 scope.",
          },
        });

        const planPath = join(projectRoot, ".nexus", "state", "plan.json");
        const plan = readJsonFile<{
          issues: Array<{
            status: string;
            decision?: string;
            analysis?: Array<{
              role: string;
              agent_id?: string;
              summary: string;
              recorded_at: string;
            }>;
          }>;
        }>(planPath);

        expect(plan.issues[0]?.status).toBe("decided");
        expect(plan.issues[0]?.decision).toBe(
          "Proceed with the simpler architecture because it satisfies v1 scope.",
        );
        expect(plan.issues[0]?.analysis).toHaveLength(1);
        expect(plan.issues[0]?.analysis?.[0]).toEqual({
          role: "architect",
          agent_id: "agent-1",
          summary: "Detailed architectural analysis",
          recorded_at: expect.any(String),
        });

        const resumeResult = await client.callTool({
          name: "nx_plan_resume",
          arguments: { role: "architect" },
        });
        expect(parseTextResult(resumeResult)).toEqual({
          role: "architect",
          resumable: true,
          agent_id: "agent-1",
          resume_tier: null,
          issue_id: 1,
        });
      } finally {
        await close();
      }
    });
  });
});
