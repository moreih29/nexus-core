import { expect, test } from "bun:test";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { Implementation } from "@modelcontextprotocol/sdk/types.js";
import { parseTextResult, withTempProjectRoot } from "./helpers.js";

const TEST_CLIENT_INFO: Implementation = {
  name: "nexus-core-stdio-smoke-client",
  version: "0.0.0-test",
};

function stringEnv(): Record<string, string> {
  return Object.fromEntries(
    Object.entries(process.env).flatMap(([key, value]) =>
      value === undefined ? [] : [[key, value]],
    ),
  );
}

test("stdio entrypoint serves the MCP tool list", async () => {
  await withTempProjectRoot(async (projectRoot) => {
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [join(process.cwd(), "src/mcp/server.ts")],
      cwd: process.cwd(),
      env: {
        ...stringEnv(),
        NEXUS_PROJECT_ROOT: projectRoot,
      },
    });

    const client = new Client(TEST_CLIENT_INFO, { capabilities: {} });

    try {
      await client.connect(transport);

      expect(client.getServerVersion()).toEqual({
        name: "nexus-core",
        version: "0.16.2",
      });

      const tools = await client.listTools();
      expect(tools.tools.some((tool) => tool.name === "nx_plan_status")).toBe(
        true,
      );

      const result = await client.callTool({
        name: "nx_plan_status",
        arguments: {},
      });
      expect(parseTextResult(result)).toEqual({ exists: false });
    } finally {
      await client.close();
    }
  });
});
