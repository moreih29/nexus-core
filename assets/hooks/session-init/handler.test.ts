import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as crypto from "node:crypto";
import handler from "./handler.ts";

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function makeTmpDir(): string {
  return fs.mkdtempSync(
    path.join(os.tmpdir(), `nexus-session-init-${crypto.randomUUID()}-`)
  );
}

function sessionDir(cwd: string, sid: string): string {
  return path.join(cwd, ".nexus/state", sid);
}

// ---------------------------------------------------------------------------
// Scenario 1: New session_id (valid) → directory + files created
// ---------------------------------------------------------------------------

describe("scenario 1 — new session_id creates state files", () => {
  let cwd: string;

  beforeEach(() => {
    cwd = makeTmpDir();
  });

  afterEach(() => {
    fs.rmSync(cwd, { recursive: true, force: true });
  });

  test("creates .nexus/state/sessions/<sid>/ directory", async () => {
    const sid = crypto.randomUUID();
    await handler({ hook_event_name: "SessionStart", session_id: sid, cwd });
    expect(fs.existsSync(sessionDir(cwd, sid))).toBe(true);
    expect(fs.statSync(sessionDir(cwd, sid)).isDirectory()).toBe(true);
  });

  test("creates agent-tracker.json with content '[]'", async () => {
    const sid = crypto.randomUUID();
    await handler({ hook_event_name: "SessionStart", session_id: sid, cwd });
    const filePath = path.join(sessionDir(cwd, sid), "agent-tracker.json");
    expect(fs.existsSync(filePath)).toBe(true);
    expect(fs.readFileSync(filePath, "utf8")).toBe("[]");
  });

  test("creates tool-log.jsonl as empty file", async () => {
    const sid = crypto.randomUUID();
    await handler({ hook_event_name: "SessionStart", session_id: sid, cwd });
    const filePath = path.join(sessionDir(cwd, sid), "tool-log.jsonl");
    expect(fs.existsSync(filePath)).toBe(true);
    expect(fs.readFileSync(filePath, "utf8")).toBe("");
  });
});

// ---------------------------------------------------------------------------
// Scenario 2: Existing session_id re-invoked → files overwritten (reset policy)
// ---------------------------------------------------------------------------

describe("scenario 2 — existing session_id re-initialises (overwrite)", () => {
  let cwd: string;

  beforeEach(() => {
    cwd = makeTmpDir();
  });

  afterEach(() => {
    fs.rmSync(cwd, { recursive: true, force: true });
  });

  test("overwrites agent-tracker.json even when it had prior content", async () => {
    const sid = crypto.randomUUID();
    // First call
    await handler({ hook_event_name: "SessionStart", session_id: sid, cwd });
    // Simulate prior state
    const trackerPath = path.join(sessionDir(cwd, sid), "agent-tracker.json");
    fs.writeFileSync(trackerPath, '[{"id":"agent-1"}]');
    // Second call — must reset
    await handler({ hook_event_name: "SessionStart", session_id: sid, cwd });
    expect(fs.readFileSync(trackerPath, "utf8")).toBe("[]");
  });

  test("overwrites tool-log.jsonl even when it had prior content", async () => {
    const sid = crypto.randomUUID();
    await handler({ hook_event_name: "SessionStart", session_id: sid, cwd });
    const logPath = path.join(sessionDir(cwd, sid), "tool-log.jsonl");
    fs.writeFileSync(logPath, '{"tool":"Bash","ts":"2026-01-01T00:00:00Z"}\n');
    await handler({ hook_event_name: "SessionStart", session_id: sid, cwd });
    expect(fs.readFileSync(logPath, "utf8")).toBe("");
  });
});

// ---------------------------------------------------------------------------
// Scenario 3: Path traversal — session_id="../etc/passwd"
// ---------------------------------------------------------------------------

describe("scenario 3 — path traversal is prevented", () => {
  let cwd: string;

  beforeEach(() => {
    cwd = makeTmpDir();
  });

  afterEach(() => {
    fs.rmSync(cwd, { recursive: true, force: true });
  });

  test("does not write to the real /etc/passwd (mtime unchanged)", async () => {
    // Guard: confirm /etc/passwd exists so the test is meaningful
    expect(fs.existsSync("/etc/passwd")).toBe(true);
    const before = fs.statSync("/etc/passwd").mtimeMs;
    await handler({
      hook_event_name: "SessionStart",
      session_id: "../etc/passwd",
      cwd,
    });
    const after = fs.statSync("/etc/passwd").mtimeMs;
    expect(after).toBe(before);
  });

  test("any created path is contained within cwd", async () => {
    await handler({
      hook_event_name: "SessionStart",
      session_id: "../etc/passwd",
      cwd,
    });
    // Walk everything created and assert it all lives inside cwd
    const sessionsRoot = path.join(cwd, ".nexus/state");
    if (fs.existsSync(sessionsRoot)) {
      const entries = fs.readdirSync(sessionsRoot, { recursive: true, encoding: "utf8" }) as string[];
      for (const entry of entries) {
        const abs = path.resolve(sessionsRoot, entry);
        expect(abs.startsWith(cwd)).toBe(true);
      }
    }
  });

  test("basename extraction: if something is created it is named 'passwd' inside sessions", async () => {
    await handler({
      hook_event_name: "SessionStart",
      session_id: "../etc/passwd",
      cwd,
    });
    // basename('../etc/passwd') === 'passwd'
    // Handler must either create state/passwd (safe) or nothing.
    // It must NOT create state/../etc/passwd (which resolves to .nexus/etc/passwd — still inside cwd but wrong semantic).
    // The only acceptable directory name is 'passwd' directly under state.
    const sessionsRoot = path.join(cwd, ".nexus/state");
    if (fs.existsSync(sessionsRoot)) {
      const children = fs.readdirSync(sessionsRoot);
      // Each direct child must be a non-traversal name
      for (const child of children) {
        expect(child).not.toContain("..");
        expect(child).not.toContain("/");
      }
    }
  });

  test("session_id with embedded slash is rejected or sanitised — no nested subdirs under sessions", async () => {
    const sid = "foo/bar";
    await handler({ hook_event_name: "SessionStart", session_id: sid, cwd });
    // If handler created something it must not be a nested foo/bar under state.
    // Acceptable: nothing, or state/bar (basename). Not acceptable: state/foo/bar.
    const fooInsideSessions = path.join(cwd, ".nexus/state/foo");
    if (fs.existsSync(fooInsideSessions)) {
      // foo exists — bar must NOT be a subdirectory of it (that would be nested traversal)
      expect(fs.existsSync(path.join(fooInsideSessions, "bar"))).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// Scenario 4: plan.json, tasks.json, memory-access.jsonl are not touched
// ---------------------------------------------------------------------------

describe("scenario 4 — project-level state files are not modified", () => {
  let cwd: string;

  beforeEach(() => {
    cwd = makeTmpDir();
    // Seed pre-existing project-level state files
    const stateDir = path.join(cwd, ".nexus/state");
    fs.mkdirSync(stateDir, { recursive: true });
    fs.writeFileSync(path.join(stateDir, "plan.json"), '{"version":1}');
    fs.writeFileSync(path.join(stateDir, "tasks.json"), '{"tasks":[]}');
    fs.writeFileSync(path.join(stateDir, "memory-access.jsonl"), "entry1\n");
  });

  afterEach(() => {
    fs.rmSync(cwd, { recursive: true, force: true });
  });

  test("plan.json content is unchanged after handler runs", async () => {
    const sid = crypto.randomUUID();
    const planPath = path.join(cwd, ".nexus/state/plan.json");
    const before = fs.readFileSync(planPath, "utf8");
    await handler({ hook_event_name: "SessionStart", session_id: sid, cwd });
    expect(fs.readFileSync(planPath, "utf8")).toBe(before);
  });

  test("tasks.json content is unchanged after handler runs", async () => {
    const sid = crypto.randomUUID();
    const tasksPath = path.join(cwd, ".nexus/state/tasks.json");
    const before = fs.readFileSync(tasksPath, "utf8");
    await handler({ hook_event_name: "SessionStart", session_id: sid, cwd });
    expect(fs.readFileSync(tasksPath, "utf8")).toBe(before);
  });

  test("memory-access.jsonl content is unchanged after handler runs", async () => {
    const sid = crypto.randomUUID();
    const memPath = path.join(cwd, ".nexus/state/memory-access.jsonl");
    const before = fs.readFileSync(memPath, "utf8");
    await handler({ hook_event_name: "SessionStart", session_id: sid, cwd });
    expect(fs.readFileSync(memPath, "utf8")).toBe(before);
  });

  test("plan.json mtime is unchanged after handler runs", async () => {
    const sid = crypto.randomUUID();
    const planPath = path.join(cwd, ".nexus/state/plan.json");
    const before = fs.statSync(planPath).mtimeMs;
    await handler({ hook_event_name: "SessionStart", session_id: sid, cwd });
    expect(fs.statSync(planPath).mtimeMs).toBe(before);
  });
});

// ---------------------------------------------------------------------------
// Scenario 5: Return value is undefined / void
// ---------------------------------------------------------------------------

describe("scenario 5 — return value is undefined (void)", () => {
  let cwd: string;

  beforeEach(() => {
    cwd = makeTmpDir();
  });

  afterEach(() => {
    fs.rmSync(cwd, { recursive: true, force: true });
  });

  test("returns undefined for a valid SessionStart event", async () => {
    const sid = crypto.randomUUID();
    const result = await handler({
      hook_event_name: "SessionStart",
      session_id: sid,
      cwd,
    });
    expect(result).toBeUndefined();
  });

  test("returns undefined when hook_event_name is not SessionStart", async () => {
    const result = await handler({
      hook_event_name: "UserPromptSubmit",
      session_id: crypto.randomUUID(),
      cwd,
      prompt: "hello",
    });
    expect(result).toBeUndefined();
  });

  test("returns undefined for path traversal input (rejected)", async () => {
    const result = await handler({
      hook_event_name: "SessionStart",
      session_id: "../etc/passwd",
      cwd,
    });
    expect(result).toBeUndefined();
  });
});
