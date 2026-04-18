import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { existsSync } from "node:fs";

const PROJECT_ROOT = process.cwd();
const SERVER_DIST = path.join(PROJECT_ROOT, "dist", "mcp", "server.js");

// ---------------------------------------------------------------------------
// E2E: full session scenario — spawn server + JSON-RPC client
// ---------------------------------------------------------------------------

describe("e2e session scenario", () => {
  let proc: ChildProcessWithoutNullStreams | null = null;
  let buffer = "";
  let nextRequestId = 1;
  const pending = new Map<number, (msg: unknown) => void>();
  let tmpDir: string;
  let originalCwd: string;

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
          reject(new Error(`timeout waiting for ${method} (id=${id})`));
        }
      }, 8000);
    });
  }

  function callTool(name: string, args: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
    return send("tools/call", { name, arguments: args }).then((resp) => {
      const r = resp as { result?: { content?: Array<{ type: string; text: string }> }; error?: unknown };
      if (r.error) throw new Error(`Tool ${name} error: ${JSON.stringify(r.error)}`);
      const text = r.result?.content?.[0]?.text;
      if (!text) throw new Error(`Tool ${name} returned empty content`);
      return JSON.parse(text) as Record<string, unknown>;
    });
  }

  beforeAll(async () => {
    if (!existsSync(SERVER_DIST)) {
      throw new Error(`dist build missing at ${SERVER_DIST}. Run 'bun run build' first.`);
    }

    // isolated tmp directory
    originalCwd = process.cwd();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "nexus-e2e-"));
    fs.mkdirSync(path.join(tmpDir, ".nexus", "state"), { recursive: true });

    proc = spawn("node", [SERVER_DIST], {
      stdio: ["pipe", "pipe", "pipe"],
      cwd: tmpDir,
      env: { ...process.env, NEXUS_SESSION_ID: "e2e-test-session" },
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
            pending.get(msg.id)!(msg);
            pending.delete(msg.id);
          }
        } catch {
          // ignore non-json lines
        }
      }
    });

    proc.stderr.setEncoding("utf-8");
    proc.stderr.on("data", () => { /* ignore */ });

    // initialize handshake
    const initResp = (await send("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "nexus-e2e-test", version: "0.0.0" },
    })) as { result?: { serverInfo?: { name?: string } } };

    if (!initResp.result?.serverInfo) {
      throw new Error("initialize did not return serverInfo");
    }

    // MCP notifications/initialized
    proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
  });

  afterAll(async () => {
    if (proc) {
      proc.kill("SIGTERM");
      proc = null;
    }
    if (tmpDir) {
      await fs.promises.rm(tmpDir, { recursive: true, force: true });
    }
    if (originalCwd) {
      process.chdir(originalCwd);
    }
  });

  test("step 1 — nx_plan_start creates plan with 2 issues", async () => {
    const r = await callTool("nx_plan_start", {
      topic: "E2E Test Plan",
      issues: ["Architecture decision", "Security review"],
      research_summary: "Initial research completed for e2e test.",
    });
    expect(r.created).toBe(true);
    expect(r.plan_id).toBeGreaterThan(0);
    expect(r.topic).toBe("E2E Test Plan");
    expect(r.issueCount).toBe(2);
  });

  test("step 2 — nx_plan_analysis_add records analysis entry", async () => {
    const r = await callTool("nx_plan_analysis_add", {
      issue_id: 1,
      role: "architect",
      agent_id: "e2e-agent-001",
      summary: "Microservices architecture recommended",
    });
    expect(r.added).toBe(true);
    expect(r.issue_id).toBe(1);
    expect(r.role).toBe("architect");
    expect(r.total_entries).toBe(1);
  });

  test("step 3 — nx_plan_decide issue 1", async () => {
    const r = await callTool("nx_plan_decide", {
      issue_id: 1,
      decision: "Use microservices with event sourcing",
    });
    expect(r.decided).toBe(true);
    expect(r.allComplete).toBe(false);
  });

  test("step 4 — nx_plan_decide issue 2 → allComplete", async () => {
    const r = await callTool("nx_plan_decide", {
      issue_id: 2,
      decision: "Implement JWT auth with rate limiting",
    });
    expect(r.decided).toBe(true);
    expect(r.allComplete).toBe(true);
  });

  test("step 5 — nx_task_add creates task linked to plan issue 1", async () => {
    const r = await callTool("nx_task_add", {
      title: "Implement event sourcing module",
      context: "Following architecture decision from plan issue 1",
      acceptance: "All unit tests pass, integration test green",
      owner: { role: "engineer", agent_id: "e2e-eng-001", resume_tier: "bounded" },
      plan_issue: 1,
    });
    const task = r.task as Record<string, unknown>;
    expect(task.id).toBeGreaterThan(0);
    expect(task.title).toBe("Implement event sourcing module");
    expect(task.status).toBe("pending");
  });

  test("step 6 — nx_task_update marks task completed", async () => {
    const r = await callTool("nx_task_update", {
      id: 1,
      status: "completed",
    });
    const task = r.task as Record<string, unknown>;
    expect(task.status).toBe("completed");
  });

  test("step 7 — nx_task_close archives cycle (4 fields)", async () => {
    const r = await callTool("nx_task_close", {});
    expect(r.closed).toBe(true);
    expect(typeof r.plan_id).toBe("number");
    expect(r.task_count).toBe(1);
    expect(r.incomplete_count).toBe(0);
  });

  test("step 8 — plan.json and tasks.json deleted after close", async () => {
    expect(existsSync(path.join(tmpDir, ".nexus", "state", "plan.json"))).toBe(false);
    expect(existsSync(path.join(tmpDir, ".nexus", "state", "tasks.json"))).toBe(false);
  });

  test("step 9 — nx_history_search returns archived cycle with plan topic and task title", async () => {
    const r = await callTool("nx_history_search", { last_n: 1 });
    expect(r.total).toBeGreaterThan(0);
    const cycles = r.cycles as Array<Record<string, unknown>>;
    expect(cycles.length).toBeGreaterThan(0);
    const cycle = cycles[0];

    // plan topic present
    const cycleJson = JSON.stringify(cycle);
    expect(cycleJson).toContain("E2E Test Plan");
    // task title present
    expect(cycleJson).toContain("Implement event sourcing module");
  });
}, 60_000);
