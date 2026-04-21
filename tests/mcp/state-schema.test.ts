import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  HistoryFileSchema,
  PlanFileSchema,
  TasksFileSchema,
} from "../../src/types/state.js";
import {
  createInMemoryClient,
  withNexusEnv,
  withTempProjectRoot,
} from "./helpers.js";

function readJsonFile<T>(filePath: string): T {
  return JSON.parse(readFileSync(filePath, "utf8")) as T;
}

test("emitted state files conform to the runtime schemas", async () => {
  await withTempProjectRoot(async (projectRoot: string) => {
    await withNexusEnv(projectRoot, async () => {
      const { client, close } = await createInMemoryClient();

      try {
        await client.callTool({
          name: "nx_plan_start",
          arguments: {
            topic: "Schema verification",
            issues: ["Ensure files parse"],
            research_summary: "Schemas should match the persisted files.",
          },
        });
        await client.callTool({
          name: "nx_plan_analysis_add",
          arguments: {
            issue_id: 1,
            role: "architect",
            summary: "Looks good",
          },
        });
        await client.callTool({
          name: "nx_plan_decide",
          arguments: {
            issue_id: 1,
            decision: "Proceed",
          },
        });
        await client.callTool({
          name: "nx_task_add",
          arguments: {
            title: "Schema-backed task",
            context: "Produce tasks.json",
            acceptance: "Done",
            owner: { role: "lead" },
          },
        });

        const stateRoot = join(projectRoot, ".nexus", "state");
        const plan = readJsonFile<unknown>(join(stateRoot, "plan.json"));
        const tasks = readJsonFile<unknown>(join(stateRoot, "tasks.json"));

        expect(() => PlanFileSchema.parse(plan)).not.toThrow();
        expect(() => TasksFileSchema.parse(tasks)).not.toThrow();

        await client.callTool({
          name: "nx_task_close",
          arguments: {},
        });

        const history = readJsonFile<unknown>(
          join(projectRoot, ".nexus", "history.json"),
        );
        expect(() => HistoryFileSchema.parse(history)).not.toThrow();
      } finally {
        await close();
      }
    });
  });
});
