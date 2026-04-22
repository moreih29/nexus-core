#!/usr/bin/env bun
import { readFileSync } from "node:fs";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerArtifactTools } from "./handlers/artifact.js";
import { registerHistoryTools } from "./handlers/history.js";
import { registerPlanTools } from "./handlers/plan.js";
import { registerTaskTools } from "./handlers/task.js";

type PackageMetadata = {
  name?: string;
  version?: string;
};

const FALLBACK_SERVER_INFO = {
  name: "nexus-core",
  version: "0.16.2",
} as const;

function normalizeServerName(packageName: string | undefined): string {
  if (!packageName) {
    return FALLBACK_SERVER_INFO.name;
  }
  const segments = packageName.split("/");
  return segments[segments.length - 1] || FALLBACK_SERVER_INFO.name;
}

function loadServerInfo(): { name: string; version: string } {
  try {
    const packagePath = new URL("../../package.json", import.meta.url);
    const packageJson = JSON.parse(
      readFileSync(packagePath, "utf8"),
    ) as PackageMetadata;

    return {
      name: normalizeServerName(packageJson.name),
      version: packageJson.version ?? FALLBACK_SERVER_INFO.version,
    };
  } catch {
    return FALLBACK_SERVER_INFO;
  }
}

const SERVER_INFO = loadServerInfo();

export function createServer(): McpServer {
  const server = new McpServer({
    name: SERVER_INFO.name,
    version: SERVER_INFO.version,
  });
  registerPlanTools(server);
  registerTaskTools(server);
  registerHistoryTools(server);
  registerArtifactTools(server);
  return server;
}

export async function main(): Promise<void> {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

// Direct execution detection for the compiled CLI entrypoint.
const isDirectRun = import.meta.url === `file://${process.argv[1]}`;
if (isDirectRun) {
  main().catch((err) => {
    console.error("[nexus-mcp] fatal:", err);
    process.exit(1);
  });
}
