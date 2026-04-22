import { expect, test } from "bun:test";
import {
  createInMemoryClient,
  withNexusEnv,
  withTempProjectRoot,
} from "./helpers.js";

test("lists registered MCP tools with definitions", async () => {
  await withTempProjectRoot(async (projectRoot: string) => {
    await withNexusEnv(projectRoot, async () => {
      const { client, close } = await createInMemoryClient();

      try {
        const tools = await client.listTools();
        const toolMap = new Map(tools.tools.map((tool) => [tool.name, tool]));
        const planDecide = toolMap.get("nx_plan_decide");
        const planDecideProperties =
          planDecide?.inputSchema &&
          "properties" in planDecide.inputSchema &&
          typeof planDecide.inputSchema.properties === "object" &&
          planDecide.inputSchema.properties !== null
            ? planDecide.inputSchema.properties
            : {};

        expect(toolMap.get("nx_artifact_write")?.description).toBe(
          "Write an artifact to the state artifacts directory",
        );
        expect(toolMap.get("nx_plan_start")?.description).toBe(
          "Start a new planning session and automatically archive any existing plan.json",
        );
        expect(planDecide?.description).toBe(
          "Record the final decision for a plan issue",
        );
        expect("how_agents" in planDecideProperties).toBe(false);
        expect("how_summary" in planDecideProperties).toBe(false);
        expect("how_agent_ids" in planDecideProperties).toBe(false);
        expect(toolMap.get("nx_task_add")?.description).toBe(
          "Add a new task to tasks.json",
        );
      } finally {
        await close();
      }
    });
  });
});
