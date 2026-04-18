#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerPlanTools } from "./tools/plan.js";
import { registerTaskTools } from "./tools/task.js";
import { registerHistoryTools } from "./tools/history.js";
import { registerArtifactTools } from "./tools/artifact.js";
import { registerLspTools } from "./tools/lsp.js";

export function createServer(): McpServer {
  const server = new McpServer({
    name: "nexus-core",
    version: "0.13.0",
  });
  registerPlanTools(server);
  registerTaskTools(server);
  registerHistoryTools(server);
  registerArtifactTools(server);
  registerLspTools(server);
  return server;
}

export async function main(): Promise<void> {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

// Direct execution detection (node·bun 양립)
const isDirectRun = import.meta.url === `file://${process.argv[1]}`;
if (isDirectRun) {
  main().catch((err) => {
    console.error("[nexus-mcp] fatal:", err);
    process.exit(1);
  });
}
