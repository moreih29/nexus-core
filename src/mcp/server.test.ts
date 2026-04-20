import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { createServer } from "./server.ts";

const PROJECT_ROOT = process.cwd();
const SERVER_DIST = join(PROJECT_ROOT, "dist", "src", "mcp", "server.js");

const EXPECTED_TOOLS = [
  "nx_artifact_write",
  "nx_history_search",
  "nx_lsp_code_actions",
  "nx_lsp_diagnostics",
  "nx_lsp_find_references",
  "nx_lsp_hover",
  "nx_lsp_rename",
  "nx_plan_analysis_add",
  "nx_plan_decide",
  "nx_plan_resume",
  "nx_plan_start",
  "nx_plan_status",
  "nx_plan_update",
  "nx_task_add",
  "nx_task_close",
  "nx_task_list",
  "nx_task_resume",
  "nx_task_update",
].sort();

describe("createServer (in-process)", () => {
  test("returns an McpServer instance with name and version", () => {
    const server = createServer();
    expect(server).toBeDefined();
    expect(typeof server.connect).toBe("function");
  });

  test("registers all 18 tools", () => {
    const server = createServer();
    const registered = (server as unknown as { _registeredTools: Record<string, unknown> })._registeredTools;
    const names = Object.keys(registered).sort();
    expect(names).toEqual(EXPECTED_TOOLS);
  });

  test("each registered tool has an inputSchema", () => {
    const server = createServer();
    const registered = (server as unknown as { _registeredTools: Record<string, { inputSchema: unknown }> })._registeredTools;
    for (const [, tool] of Object.entries(registered)) {
      expect(tool.inputSchema).toBeDefined();
    }
  });
});

describe("server.js stdio handshake (spawn)", () => {
  let proc: ChildProcessWithoutNullStreams | null = null;
  let buffer = "";
  let nextRequestId = 1;
  const pending = new Map<number, (msg: unknown) => void>();

  function send(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    return new Promise((resolve, reject) => {
      if (!proc) return reject(new Error("server not running"));
      const id = nextRequestId++;
      pending.set(id, resolve);
      const msg = JSON.stringify({ jsonrpc: "2.0", id, method, params });
      proc.stdin.write(msg + "\n");
      setTimeout(() => {
        if (pending.has(id)) {
          pending.delete(id);
          reject(new Error(`timeout waiting for ${method}`));
        }
      }, 5000);
    });
  }

  beforeAll(async () => {
    if (!existsSync(SERVER_DIST)) {
      throw new Error(
        `dist build missing at ${SERVER_DIST}. Run 'bun run build' before testing.`
      );
    }
    proc = spawn("node", [SERVER_DIST], {
      stdio: ["pipe", "pipe", "pipe"],
      cwd: PROJECT_ROOT,
    });

    proc.stdout.setEncoding("utf-8");
    proc.stdout.on("data", (chunk: string) => {
      buffer += chunk;
      let idx: number;
      while ((idx = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, idx).trim();
        buffer = buffer.slice(idx + 1);
        if (!line) continue;
        try {
          const msg = JSON.parse(line) as { id?: number };
          if (typeof msg.id === "number" && pending.has(msg.id)) {
            const resolver = pending.get(msg.id)!;
            pending.delete(msg.id);
            resolver(msg);
          }
        } catch {
          // ignore non-json lines
        }
      }
    });

    proc.stderr.setEncoding("utf-8");
    proc.stderr.on("data", () => {
      // ignore — server may emit diagnostic noise
    });

    // initialize handshake — must be the first message
    const initResp = (await send("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "nexus-core-test", version: "0.0.0" },
    })) as {
      result?: { serverInfo?: { name?: string; version?: string } };
    };

    if (!initResp.result?.serverInfo) {
      throw new Error("initialize did not return serverInfo");
    }
  });

  afterAll(() => {
    if (proc) {
      proc.kill("SIGTERM");
      proc = null;
    }
  });

  test("tools/list returns all 18 tools", async () => {
    const resp = (await send("tools/list", {})) as {
      result: { tools: { name: string }[] };
    };
    const names = resp.result.tools.map((t) => t.name).sort();
    expect(names).toEqual(EXPECTED_TOOLS);
  });

  test("each tool has inputSchema", async () => {
    const resp = (await send("tools/list", {})) as {
      result: { tools: { name: string; inputSchema: unknown }[] };
    };
    for (const t of resp.result.tools) {
      expect(t.inputSchema).toBeDefined();
    }
  });

  test("server responds to multiple sequential requests", async () => {
    const r1 = (await send("tools/list", {})) as { result: { tools: unknown[] } };
    const r2 = (await send("tools/list", {})) as { result: { tools: unknown[] } };
    expect(r1.result.tools.length).toBe(18);
    expect(r2.result.tools.length).toBe(18);
  });
});
