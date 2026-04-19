/**
 * opencode-mount.ts tests
 *
 * Strategy: mock child_process.spawn so no real processes are launched.
 * The mock returns a controllable EventEmitter that behaves like a ChildProcess.
 * Each test configures what stdout data the "child" emits and what it exits with.
 *
 * Scenarios covered:
 * (1) session.created → SessionStart dispatch → buffer push
 * (2) chat.message → UserPromptSubmit dispatch
 * (3) tool.execute.before (tool=task) → SubagentStart dispatch + args.prompt prepend
 * (4) tool.execute.before (tool=bash) → PreToolUse dispatch + args mutation
 * (5) tool.execute.after (tool=task) → SubagentStop dispatch + output.output append + agent-tracker upsert
 * (6) decision:block → throw
 * (7) spawn 실패 → silent (throw 없음)
 * (8) experimental.chat.system.transform → buffer flush
 */

import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  mock,
  spyOn,
} from "bun:test";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import fsPromises from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { OpenCodeHookManifest } from "./opencode-mount.ts";

// ---------------------------------------------------------------------------
// Helpers: fake ChildProcess
// ---------------------------------------------------------------------------

/**
 * Creates a minimal ChildProcess-like EventEmitter with controllable behaviour.
 *
 * @param stdoutData  JSON string the "child" will emit on stdout (or null for no data)
 * @param exitDelay   ms before the "exit" event fires
 * @param throwOnSpawn  if true, spawn() itself will throw
 * @param emitError   if true, emits an "error" event instead of "exit"
 * @param hang        if true, stdin.end() never schedules exit/error — simulates a hanging process
 */
function makeFakeChild(options: {
  stdoutData?: string | null;
  exitDelay?: number;
  emitError?: boolean;
  hang?: boolean;
} = {}) {
  const { stdoutData = null, exitDelay = 0, emitError = false, hang = false } = options;

  const proc = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter & { on: (ev: string, cb: (chunk: Buffer) => void) => EventEmitter };
    stdin: { write: (data: string) => void; end: () => void };
    kill: () => void;
  };

  // stdout
  const stdout = new EventEmitter() as EventEmitter & {
    on: (ev: string, cb: (chunk: Buffer) => void) => EventEmitter;
  };
  proc.stdout = stdout;

  // stdin
  proc.stdin = {
    write: (_data: string) => {},
    end: () => {
      // If hang is true, never fire exit/error — timeout path will trigger instead
      if (hang) return;
      // After stdin is closed, schedule the response
      const delay = exitDelay;
      setTimeout(() => {
        if (stdoutData != null) {
          stdout.emit("data", Buffer.from(stdoutData));
        }
        if (emitError) {
          proc.emit("error", new Error("spawn ENOENT"));
        } else {
          proc.emit("exit", 0, null);
        }
      }, delay);
    },
  };

  proc.kill = () => {};

  return proc;
}

// ---------------------------------------------------------------------------
// Mock child_process module-level
// ---------------------------------------------------------------------------

// We capture the spawn mock so each test can configure its child.
// bun:test mock.module is not available for built-in Node modules the same way;
// instead we use spyOn on the module import after dynamic import.
// Because opencode-mount.ts imports { spawn } from "node:child_process" at
// module scope, we patch it via spyOn on the module namespace.

import * as childProcess from "node:child_process";
import { mountHooks } from "./opencode-mount.ts";

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "nexus-mount-"));
});

afterEach(async () => {
  await fsPromises.rm(tmpDir, { recursive: true, force: true });
});

/** Minimal manifest with a single catch-all hook. */
function makeManifest(handlerPath = "/fake/handler.js"): OpenCodeHookManifest {
  return {
    hooks: [
      {
        name: "catch-all",
        events: [
          "SessionStart",
          "UserPromptSubmit",
          "SubagentStart",
          "SubagentStop",
          "PreToolUse",
          "PostToolUse",
        ],
        matcher: "*",
        handlerPath,
        priority: 10,
        timeout: 5,
      },
    ],
  };
}

/** Sets up the spawn spy to return a fake child that emits the given JSON. */
function mockSpawnWith(result: Record<string, unknown> | null) {
  const spawnSpy = spyOn(childProcess, "spawn").mockImplementation(
    () => makeFakeChild({ stdoutData: result != null ? JSON.stringify(result) : null }) as unknown as ReturnType<typeof childProcess.spawn>,
  );
  return spawnSpy;
}

// ---------------------------------------------------------------------------
// Scenario (1): session.created → SessionStart → buffer push
// ---------------------------------------------------------------------------

describe("Scenario 1: session.created → SessionStart → buffer push", () => {
  it("dispatches SessionStart and pushes additional_context into systemTransformBuffer", async () => {
    const additionalCtx = "nexus system context";
    const spawnSpy = mockSpawnWith({ additional_context: additionalCtx });

    const hooks = mountHooks({ directory: tmpDir }, makeManifest());

    await hooks["event"]!({
      event: { type: "session.created", sessionID: "sess-001" },
    });

    // Verify spawn was called once (handler was invoked)
    expect(spawnSpy).toHaveBeenCalledTimes(1);

    // Verify buffer was populated by calling system.transform
    const output = { system: [] as unknown[] };
    await hooks["experimental.chat.system.transform"]!({}, output);
    expect(output.system).toContain(additionalCtx);

    spawnSpy.mockRestore();
  });

  it("ignores events whose type is not session.created", async () => {
    const spawnSpy = spyOn(childProcess, "spawn");

    const hooks = mountHooks({ directory: tmpDir }, makeManifest());

    await hooks["event"]!({
      event: { type: "some.other.event", sessionID: "sess-001" },
    });

    expect(spawnSpy).not.toHaveBeenCalled();
    spawnSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// Scenario (2): chat.message → UserPromptSubmit
// ---------------------------------------------------------------------------

describe("Scenario 2: chat.message → UserPromptSubmit dispatch", () => {
  it("dispatches UserPromptSubmit with the correct session and prompt", async () => {
    let capturedInput: Record<string, unknown> | null = null;

    const spawnSpy = spyOn(childProcess, "spawn").mockImplementation(
      () => {
        const child = makeFakeChild({ stdoutData: JSON.stringify({ decision: "continue" }) });
        // Intercept stdin.write to capture what was sent
        const origWrite = child.stdin.write.bind(child.stdin);
        child.stdin.write = (data: string) => {
          capturedInput = JSON.parse(data) as Record<string, unknown>;
          origWrite(data);
        };
        return child as unknown as ReturnType<typeof childProcess.spawn>;
      },
    );

    const hooks = mountHooks({ directory: tmpDir }, makeManifest());

    await hooks["chat.message"]!({
      sessionID: "sess-002",
      message: "hello nexus",
    });

    expect(capturedInput).not.toBeNull();
    expect(capturedInput!["hook_event_name"]).toBe("UserPromptSubmit");
    expect(capturedInput!["session_id"]).toBe("sess-002");
    expect(capturedInput!["prompt"]).toBe("hello nexus");

    spawnSpy.mockRestore();
  });

  it("pushes additional_context from UserPromptSubmit into the buffer", async () => {
    const spawnSpy = mockSpawnWith({ additional_context: "user context" });

    const hooks = mountHooks({ directory: tmpDir }, makeManifest());

    await hooks["chat.message"]!({ sessionID: "sess-002", message: "hi" });

    const output = { system: [] as unknown[] };
    await hooks["experimental.chat.system.transform"]!({}, output);
    expect(output.system).toContain("user context");

    spawnSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// Scenario (3): tool.execute.before (tool=task) → SubagentStart + prompt prepend
// ---------------------------------------------------------------------------

describe("Scenario 3: tool.execute.before (tool=task) → SubagentStart + prompt prepend", () => {
  it("dispatches SubagentStart and prepends additional_context to args.prompt", async () => {
    const spawnSpy = mockSpawnWith({
      hook_event_name: "SubagentStart",
      additional_context: "PREPENDED",
    });

    const hooks = mountHooks({ directory: tmpDir }, makeManifest());

    const input = { sessionID: "sess-003", tool: "task" };
    const output = {
      args: { subagent_type: "engineer", prompt: "do the work" },
    };

    await hooks["tool.execute.before"]!(input, output);

    // additional_context should be prepended to args.prompt
    expect(output.args.prompt).toBe("PREPENDED\n\ndo the work");

    spawnSpy.mockRestore();
  });

  it("sets args.prompt to just additional_context when originally empty", async () => {
    const spawnSpy = mockSpawnWith({ additional_context: "INIT_CTX" });

    const hooks = mountHooks({ directory: tmpDir }, makeManifest());

    const output = { args: { subagent_type: "tester", prompt: "" } };
    await hooks["tool.execute.before"]!({ sessionID: "s", tool: "task" }, output);

    expect((output.args.prompt as string).startsWith("INIT_CTX")).toBe(true);

    spawnSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// Scenario (4): tool.execute.before (tool=bash) → PreToolUse + args mutation
// ---------------------------------------------------------------------------

describe("Scenario 4: tool.execute.before (tool=bash) → PreToolUse + updated_input mutation", () => {
  it("dispatches PreToolUse with normalized tool name Bash", async () => {
    let capturedInput: Record<string, unknown> | null = null;

    const spawnSpy = spyOn(childProcess, "spawn").mockImplementation(
      () => {
        const child = makeFakeChild({ stdoutData: null });
        const origWrite = child.stdin.write.bind(child.stdin);
        child.stdin.write = (data: string) => {
          capturedInput = JSON.parse(data) as Record<string, unknown>;
          origWrite(data);
        };
        return child as unknown as ReturnType<typeof childProcess.spawn>;
      },
    );

    const hooks = mountHooks({ directory: tmpDir }, makeManifest());

    const output = { args: { command: "ls -la" } };
    await hooks["tool.execute.before"]!({ sessionID: "sess-004", tool: "bash" }, output);

    expect(capturedInput!["hook_event_name"]).toBe("PreToolUse");
    expect(capturedInput!["tool_name"]).toBe("Bash");

    spawnSpy.mockRestore();
  });

  it("applies updated_input mutations to output.args for PreToolUse", async () => {
    const spawnSpy = mockSpawnWith({
      updated_input: { command: "echo mutated" },
    });

    const hooks = mountHooks({ directory: tmpDir }, makeManifest());

    const output: { args: Record<string, unknown> } = { args: { command: "ls" } };
    await hooks["tool.execute.before"]!({ sessionID: "sess-004", tool: "bash" }, output);

    expect(output.args["command"]).toBe("echo mutated");

    spawnSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// Scenario (5): tool.execute.after (tool=task) → SubagentStop + output.output append + agent-tracker upsert
// ---------------------------------------------------------------------------

describe("Scenario 5: tool.execute.after (tool=task) → SubagentStop + output append + agent-tracker upsert", () => {
  it("appends additional_context to output.output", async () => {
    const spawnSpy = mockSpawnWith({ additional_context: "APPENDED" });

    const hooks = mountHooks({ directory: tmpDir }, makeManifest());

    const input = { sessionID: "sess-005", tool: "task" };
    const output: Record<string, unknown> = {
      args: { subagent_type: "engineer" },
      metadata: { sessionId: "agent-abc" },
      output: "original output",
    };

    await hooks["tool.execute.after"]!(input, output);

    expect(output["output"]).toBe("original output\n\nAPPENDED");

    spawnSpy.mockRestore();
  });

  it("upserts agent-tracker using output.metadata.sessionId as agent_id", async () => {
    const spawnSpy = mockSpawnWith(null); // no result from handler

    const hooks = mountHooks({ directory: tmpDir }, makeManifest());

    const sessionId = "sess-005";
    const agentId = "subagent-xyz";

    const input = { sessionID: sessionId, tool: "task" };
    const output: Record<string, unknown> = {
      args: { subagent_type: "tester" },
      metadata: { sessionId: agentId },
      output: "",
    };

    await hooks["tool.execute.after"]!(input, output);

    // Read the agent-tracker.json and verify the entry was upserted
    const trackerPath = path.join(
      tmpDir,
      ".nexus",
      "state",
      sessionId,
      "agent-tracker.json",
    );

    expect(fs.existsSync(trackerPath)).toBe(true);

    const raw = await fsPromises.readFile(trackerPath, "utf8");
    const tracker = JSON.parse(raw) as Array<{
      agent_id: string;
      agent_type: string;
      status: string;
      resume_count: number;
    }>;

    expect(tracker).toHaveLength(1);
    expect(tracker[0]!.agent_id).toBe(agentId);
    expect(tracker[0]!.agent_type).toBe("tester");
    expect(tracker[0]!.status).toBe("running");
    expect(tracker[0]!.resume_count).toBe(0);

    spawnSpy.mockRestore();
  });

  it("increments resume_count on subsequent calls with the same agent_id", async () => {
    const spawnSpy = mockSpawnWith(null);

    const hooks = mountHooks({ directory: tmpDir }, makeManifest());

    const input = { sessionID: "sess-005b", tool: "task" };
    const output: Record<string, unknown> = {
      args: { subagent_type: "engineer" },
      metadata: { sessionId: "agent-resume" },
      output: "",
    };

    // First call → creates entry with resume_count 0
    await hooks["tool.execute.after"]!(input, output);
    // Second call → increments resume_count
    await hooks["tool.execute.after"]!(input, output);

    const trackerPath = path.join(
      tmpDir,
      ".nexus",
      "state",
      "sess-005b",
      "agent-tracker.json",
    );
    const raw = await fsPromises.readFile(trackerPath, "utf8");
    const tracker = JSON.parse(raw) as Array<{ agent_id: string; resume_count: number }>;

    expect(tracker).toHaveLength(1);
    expect(tracker[0]!.resume_count).toBe(1);

    spawnSpy.mockRestore();
  });

  it("skips agent-tracker upsert when metadata.sessionId is absent", async () => {
    const spawnSpy = mockSpawnWith(null);

    const hooks = mountHooks({ directory: tmpDir }, makeManifest());

    const input = { sessionID: "sess-005c", tool: "task" };
    const output: Record<string, unknown> = {
      args: { subagent_type: "engineer" },
      metadata: {}, // no sessionId
      output: "",
    };

    // Should not throw, should not create tracker file
    await expect(hooks["tool.execute.after"]!(input, output)).resolves.toBeUndefined();

    const trackerPath = path.join(
      tmpDir,
      ".nexus",
      "state",
      "sess-005c",
      "agent-tracker.json",
    );
    expect(fs.existsSync(trackerPath)).toBe(false);

    spawnSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// Scenario (6): decision:block → throw
// ---------------------------------------------------------------------------

describe("Scenario 6: decision:block → throw", () => {
  it("throws when handler returns decision:block", async () => {
    const spawnSpy = mockSpawnWith({
      decision: "block",
      block_reason: "Not allowed by policy",
    });

    const hooks = mountHooks({ directory: tmpDir }, makeManifest());

    await expect(
      hooks["chat.message"]!({ sessionID: "sess-006", message: "bad request" }),
    ).rejects.toThrow("Not allowed by policy");

    spawnSpy.mockRestore();
  });

  it("uses default block message when block_reason is absent", async () => {
    const spawnSpy = mockSpawnWith({ decision: "block" });

    const hooks = mountHooks({ directory: tmpDir }, makeManifest());

    await expect(
      hooks["chat.message"]!({ sessionID: "sess-006b", message: "request" }),
    ).rejects.toThrow("Blocked by nexus hook");

    spawnSpy.mockRestore();
  });

  it("throws when handler returns continue:false", async () => {
    const spawnSpy = mockSpawnWith({
      continue: false,
      system_message: "Hook requested stop",
    });

    const hooks = mountHooks({ directory: tmpDir }, makeManifest());

    await expect(
      hooks["chat.message"]!({ sessionID: "sess-006c", message: "stop" }),
    ).rejects.toThrow("Hook requested stop");

    spawnSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// Scenario (7): spawn 실패 → silent (throw 없음)
// ---------------------------------------------------------------------------

describe("Scenario 7: spawn failure → silent (no throw)", () => {
  it("does not throw when spawn itself throws (e.g. ENOENT)", async () => {
    const spawnSpy = spyOn(childProcess, "spawn").mockImplementation(() => {
      throw new Error("spawn ENOENT: node not found");
    });

    const hooks = mountHooks({ directory: tmpDir }, makeManifest());

    await expect(
      hooks["chat.message"]!({ sessionID: "sess-007", message: "test" }),
    ).resolves.toBeUndefined();

    spawnSpy.mockRestore();
  });

  it("does not throw when child emits an error event", async () => {
    const spawnSpy = spyOn(childProcess, "spawn").mockImplementation(
      () => makeFakeChild({ emitError: true }) as unknown as ReturnType<typeof childProcess.spawn>,
    );

    const hooks = mountHooks({ directory: tmpDir }, makeManifest());

    await expect(
      hooks["chat.message"]!({ sessionID: "sess-007b", message: "test" }),
    ).resolves.toBeUndefined();

    spawnSpy.mockRestore();
  });

  it("does not throw when handler returns invalid JSON (stdout is garbage)", async () => {
    const spawnSpy = spyOn(childProcess, "spawn").mockImplementation(
      () => makeFakeChild({ stdoutData: "not valid json {{{{" }) as unknown as ReturnType<typeof childProcess.spawn>,
    );

    const hooks = mountHooks({ directory: tmpDir }, makeManifest());

    await expect(
      hooks["chat.message"]!({ sessionID: "sess-007c", message: "test" }),
    ).resolves.toBeUndefined();

    spawnSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// Scenario (8): experimental.chat.system.transform → buffer flush
// ---------------------------------------------------------------------------

describe("Scenario 8: experimental.chat.system.transform → buffer flush", () => {
  it("flushes all buffered entries into output.system and empties the buffer", async () => {
    // Produce two entries in the buffer: one via SessionStart, one via UserPromptSubmit
    const spawnSpy = spyOn(childProcess, "spawn")
      .mockImplementationOnce(
        () => makeFakeChild({ stdoutData: JSON.stringify({ additional_context: "CTX_SESSION" }) }) as unknown as ReturnType<typeof childProcess.spawn>,
      )
      .mockImplementationOnce(
        () => makeFakeChild({ stdoutData: JSON.stringify({ additional_context: "CTX_PROMPT" }) }) as unknown as ReturnType<typeof childProcess.spawn>,
      );

    const hooks = mountHooks({ directory: tmpDir }, makeManifest());

    await hooks["event"]!({ event: { type: "session.created", sessionID: "sess-008" } });
    await hooks["chat.message"]!({ sessionID: "sess-008", message: "hello" });

    // First transform call should flush both entries
    const output1 = { system: [] as unknown[] };
    await hooks["experimental.chat.system.transform"]!({}, output1);
    expect(output1.system).toEqual(["CTX_SESSION", "CTX_PROMPT"]);

    // Second transform call should be a no-op (buffer already drained)
    const output2 = { system: [] as unknown[] };
    await hooks["experimental.chat.system.transform"]!({}, output2);
    expect(output2.system).toHaveLength(0);

    spawnSpy.mockRestore();
  });

  it("does nothing when output.system is not an array", async () => {
    const hooks = mountHooks({ directory: tmpDir }, makeManifest());

    // Should not throw even when output has no system array
    const output = {} as { system?: unknown[] };
    await expect(
      hooks["experimental.chat.system.transform"]!({}, output),
    ).resolves.toBeUndefined();
  });

  it("appends to existing system array entries without overwriting them", async () => {
    const spawnSpy = mockSpawnWith({ additional_context: "NEW_CTX" });

    const hooks = mountHooks({ directory: tmpDir }, makeManifest());
    await hooks["chat.message"]!({ sessionID: "sess-008b", message: "hi" });

    const output = { system: ["EXISTING"] as unknown[] };
    await hooks["experimental.chat.system.transform"]!({}, output);

    expect(output.system[0]).toBe("EXISTING");
    expect(output.system[1]).toBe("NEW_CTX");

    spawnSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// Scenario (9): spawn handler timeout → null return
// ---------------------------------------------------------------------------

describe("Scenario 9: spawn handler timeout → null return", () => {
  it("Test A: hang child + short timeout resolves undefined without throwing", async () => {
    const hangChild = makeFakeChild({ hang: true });
    const spawnSpy = spyOn(childProcess, "spawn").mockImplementation(
      () => hangChild as unknown as ReturnType<typeof childProcess.spawn>,
    );

    const manifest: OpenCodeHookManifest = {
      hooks: [
        {
          name: "hang-hook",
          events: ["UserPromptSubmit"],
          matcher: "*",
          handlerPath: "/fake/hang.js",
          priority: 10,
          timeout: 0.01, // 10ms
        },
      ],
    };

    const hooks = mountHooks({ directory: tmpDir }, manifest);

    const start = Date.now();
    await expect(
      hooks["chat.message"]!({ sessionID: "sess-009a", message: "test" }),
    ).resolves.toBeUndefined();
    const elapsed = Date.now() - start;

    expect(elapsed).toBeLessThan(50);

    spawnSpy.mockRestore();
  });

  it("Test B: timeout triggers child.kill()", async () => {
    const killSpy = mock(() => {});
    const hangChild = makeFakeChild({ hang: true });
    hangChild.kill = killSpy;

    const spawnSpy = spyOn(childProcess, "spawn").mockImplementation(
      () => hangChild as unknown as ReturnType<typeof childProcess.spawn>,
    );

    const manifest: OpenCodeHookManifest = {
      hooks: [
        {
          name: "hang-hook-kill",
          events: ["UserPromptSubmit"],
          matcher: "*",
          handlerPath: "/fake/hang-kill.js",
          priority: 10,
          timeout: 0.01, // 10ms
        },
      ],
    };

    const hooks = mountHooks({ directory: tmpDir }, manifest);

    await hooks["chat.message"]!({ sessionID: "sess-009b", message: "test" });

    expect(killSpy).toHaveBeenCalledTimes(1);

    spawnSpy.mockRestore();
  });

  it("Test C: first hook timeout does not prevent second hook from running", async () => {
    const hangChild = makeFakeChild({ hang: true });
    const normalChild = makeFakeChild({
      stdoutData: JSON.stringify({ additional_context: "SECOND_HOOK_CTX" }),
    });

    const spawnSpy = spyOn(childProcess, "spawn")
      .mockImplementationOnce(
        () => hangChild as unknown as ReturnType<typeof childProcess.spawn>,
      )
      .mockImplementationOnce(
        () => normalChild as unknown as ReturnType<typeof childProcess.spawn>,
      );

    const manifest: OpenCodeHookManifest = {
      hooks: [
        {
          name: "hang-hook-first",
          events: ["UserPromptSubmit"],
          matcher: "*",
          handlerPath: "/fake/hang-first.js",
          priority: 10,
          timeout: 0.01, // 10ms
        },
        {
          name: "normal-hook-second",
          events: ["UserPromptSubmit"],
          matcher: "*",
          handlerPath: "/fake/normal-second.js",
          priority: 20,
          timeout: 5,
        },
      ],
    };

    const hooks = mountHooks({ directory: tmpDir }, manifest);

    await hooks["chat.message"]!({ sessionID: "sess-009c", message: "test" });

    const output = { system: [] as unknown[] };
    await hooks["experimental.chat.system.transform"]!({}, output);
    expect(output.system).toContain("SECOND_HOOK_CTX");

    spawnSpy.mockRestore();
  });
});
