import { expect, test } from "bun:test";
import {
  createInMemoryClient,
  parseTextResult,
  withNexusEnv,
  withTempProjectRoot,
} from "./helpers.js";

test("archives a cycle and exposes it through history search", async () => {
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
          arguments: {},
        });

        const result = await client.callTool({
          name: "nx_history_search",
          arguments: {
            query: "Archive this cycle",
            last_n: 5,
          },
        });

        const payload = parseTextResult(result) as {
          total: number;
          showing: number;
          cycles: Array<{ plan?: { topic?: string } }>;
        };

        expect(payload.total).toBe(1);
        expect(payload.showing).toBe(1);
        expect(payload.cycles[0]?.plan?.topic).toBe("Archive this cycle");
      } finally {
        await close();
      }
    });
  });
});
