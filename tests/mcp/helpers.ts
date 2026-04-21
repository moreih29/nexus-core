import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { Implementation } from "@modelcontextprotocol/sdk/types.js";
import { createServer } from "../../src/mcp/server.js";

const TEST_CLIENT_INFO: Implementation = {
  name: "nexus-core-test-client",
  version: "0.0.0-test",
};

let envQueue: Promise<void> = Promise.resolve();

type TextContent = {
  type: "text";
  text: string;
};

type ToolCallResult = Awaited<ReturnType<Client["callTool"]>>;

export function createTempProjectRoot(prefix = "nexus-core-test-"): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

export function cleanupTempProjectRoot(projectRoot: string): void {
  rmSync(projectRoot, { recursive: true, force: true });
}

export async function withTempProjectRoot<T>(
  action: (projectRoot: string) => Promise<T>,
): Promise<T> {
  const projectRoot = createTempProjectRoot();
  try {
    return await action(projectRoot);
  } finally {
    cleanupTempProjectRoot(projectRoot);
  }
}

export async function withNexusEnv<T>(
  projectRoot: string,
  action: () => Promise<T>,
): Promise<T> {
  const previous = envQueue;
  let release: () => void = () => {};
  envQueue = new Promise<void>((resolve) => {
    release = resolve;
  });

  await previous;

  const previousProjectRoot = process.env.NEXUS_PROJECT_ROOT;
  process.env.NEXUS_PROJECT_ROOT = projectRoot;

  try {
    return await action();
  } finally {
    if (previousProjectRoot === undefined) {
      delete process.env.NEXUS_PROJECT_ROOT;
    } else {
      process.env.NEXUS_PROJECT_ROOT = previousProjectRoot;
    }
    release();
  }
}

export async function createInMemoryClient() {
  const server = createServer();
  const client = new Client(TEST_CLIENT_INFO, { capabilities: {} });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();

  await server.connect(serverTransport);
  await client.connect(clientTransport);

  return {
    client,
    server,
    async close() {
      await client.close();
      await server.close();
    },
  };
}

export function parseTextResult(result: ToolCallResult): unknown {
  let content: unknown[] | undefined;

  if ("content" in result && Array.isArray(result.content)) {
    content = result.content;
  } else if (
    typeof result.toolResult === "object" &&
    result.toolResult !== null &&
    "content" in result.toolResult &&
    Array.isArray(result.toolResult.content)
  ) {
    content = result.toolResult.content;
  }

  if (!content) {
    throw new Error("Expected content in MCP tool result");
  }

  const textEntry = content.find(
    (entry): entry is TextContent =>
      typeof entry === "object" &&
      entry !== null &&
      "type" in entry &&
      "text" in entry &&
      entry.type === "text" &&
      typeof entry.text === "string",
  );

  if (!textEntry) {
    throw new Error("Expected text content in MCP tool result");
  }

  return JSON.parse(textEntry.text);
}

export function readErrorText(result: ToolCallResult): string | null {
  if (!result.isError) {
    return null;
  }

  const content =
    "content" in result && Array.isArray(result.content) ? result.content : [];
  const firstEntry = content[0];

  if (
    typeof firstEntry === "object" &&
    firstEntry !== null &&
    "type" in firstEntry &&
    firstEntry.type === "text" &&
    "text" in firstEntry &&
    typeof firstEntry.text === "string"
  ) {
    return firstEntry.text;
  }

  return null;
}
