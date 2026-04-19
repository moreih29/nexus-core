import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import fs from "node:fs";
import fsPromises from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import handler from "./handler.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let tmpDir: string;
let sessionDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "nexus-agent-finalize-"));
  // Mimic .nexus/state/<session_id> layout expected by handler.ts
  sessionDir = path.join(tmpDir, ".nexus", "state", "sess-test");
  fs.mkdirSync(sessionDir, { recursive: true });
});

afterEach(async () => {
  await fsPromises.rm(tmpDir, { recursive: true, force: true });
});

function trackerPath(): string {
  return path.join(sessionDir, "agent-tracker.json");
}

function toolLogPath(): string {
  return path.join(sessionDir, "tool-log.jsonl");
}

function tasksPath(): string {
  return path.join(sessionDir, "tasks.json");
}

function writeTracker(entries: Record<string, unknown>[]): void {
  fs.writeFileSync(trackerPath(), JSON.stringify(entries, null, 2));
}

function writeToolLog(lines: Record<string, unknown>[]): void {
  const content = lines.map((l) => JSON.stringify(l)).join("\n") + "\n";
  fs.writeFileSync(toolLogPath(), content);
}

function writeTasks(tasks: Record<string, unknown>[]): void {
  fs.writeFileSync(tasksPath(), JSON.stringify({ tasks }, null, 2));
}

function readTracker(): Record<string, unknown>[] {
  return JSON.parse(fs.readFileSync(trackerPath(), "utf-8")) as Record<string, unknown>[];
}

function makeInput(overrides: Record<string, unknown> = {}) {
  return {
    hook_event_name: "SubagentStop" as const,
    session_id: "sess-test",
    cwd: tmpDir,
    agent_type: "engineer",
    agent_id: "agent-abc",
    last_assistant_message: "done",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Scenario 1: pending task exists — additional_context returned (English + <system-notice>)
// ---------------------------------------------------------------------------

describe("Scenario 1: pending task for same role returns additional_context", () => {
  it("returns additional_context containing <system-notice> when pending tasks exist for the same agent_type", async () => {
    writeTracker([{ agent_id: "agent-abc", status: "running" }]);
    writeTasks([
      { id: "task-1", status: "pending", owner: { role: "engineer" } },
      { id: "task-2", status: "completed", owner: { role: "engineer" } },
    ]);

    const result = await handler(makeInput());

    expect(result).toBeDefined();
    expect(typeof result?.additional_context).toBe("string");
    const ctx = result!.additional_context!;

    // Must contain <system-notice> wrapper tags
    expect(ctx).toContain("<system-notice>");
    expect(ctx).toContain("</system-notice>");

    // Must mention "coordinate remaining subagent delegation"
    expect(ctx).toContain("coordinate remaining subagent delegation");

    // Must be in English — no Korean characters
    expect(/[\u3131-\uD7A3]/.test(ctx)).toBe(false);

    // Must include the pending task id but not the completed one
    expect(ctx).toContain("task-1");
    expect(ctx).not.toContain("task-2");
  });

  it("includes all pending task ids when multiple tasks are pending for the role", async () => {
    writeTracker([{ agent_id: "agent-abc", status: "running" }]);
    writeTasks([
      { id: "task-A", status: "pending", owner: { role: "engineer" } },
      { id: "task-B", status: "in_progress", owner: { role: "engineer" } },
    ]);

    const result = await handler(makeInput());
    const ctx = result?.additional_context ?? "";
    expect(ctx).toContain("task-A");
    expect(ctx).toContain("task-B");
  });
});

// ---------------------------------------------------------------------------
// Scenario 2: no pending tasks — returns undefined (no additional_context)
// ---------------------------------------------------------------------------

describe("Scenario 2: no pending tasks returns undefined", () => {
  it("returns undefined when all tasks for the role are completed", async () => {
    writeTracker([{ agent_id: "agent-abc", status: "running" }]);
    writeTasks([
      { id: "task-1", status: "completed", owner: { role: "engineer" } },
    ]);

    const result = await handler(makeInput());

    expect(result).toBeUndefined();
  });

  it("returns undefined when tasks.json has tasks with a different role only", async () => {
    writeTracker([{ agent_id: "agent-abc", status: "running" }]);
    writeTasks([
      { id: "task-x", status: "in_progress", owner: { role: "architect" } },
    ]);

    const result = await handler(makeInput());

    expect(result).toBeUndefined();
  });

  it("returns undefined when tasks.json is empty", async () => {
    writeTracker([{ agent_id: "agent-abc", status: "running" }]);
    writeTasks([]);

    const result = await handler(makeInput());

    expect(result).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Scenario 3: tool-log.jsonl with 3 files for the same agent_id → files_touched stored
// ---------------------------------------------------------------------------

describe("Scenario 3: files_touched aggregation from tool-log.jsonl", () => {
  it("stores exactly 3 unique file paths when tool-log has 3 matching entries for agent_id", async () => {
    writeTracker([{ agent_id: "agent-abc", status: "running" }]);
    writeToolLog([
      { agent_id: "agent-abc", file: "src/foo.ts" },
      { agent_id: "agent-abc", file: "src/bar.ts" },
      { agent_id: "agent-abc", file: "src/baz.ts" },
      // entry with a different agent_id — must NOT be included
      { agent_id: "agent-xyz", file: "src/other.ts" },
    ]);
    writeTasks([]);

    await handler(makeInput());

    const tracker = readTracker();
    const entry = tracker.find((e) => e["agent_id"] === "agent-abc");
    expect(entry).toBeDefined();
    const touched = entry!["files_touched"] as string[];
    expect(Array.isArray(touched)).toBe(true);
    expect(touched).toHaveLength(3);
    expect(touched).toContain("src/foo.ts");
    expect(touched).toContain("src/bar.ts");
    expect(touched).toContain("src/baz.ts");
    expect(touched).not.toContain("src/other.ts");
  });

  it("deduplicates repeated file paths — files_touched contains only unique entries", async () => {
    writeTracker([{ agent_id: "agent-abc", status: "running" }]);
    writeToolLog([
      { agent_id: "agent-abc", file: "src/foo.ts" },
      { agent_id: "agent-abc", file: "src/foo.ts" }, // duplicate
      { agent_id: "agent-abc", file: "src/bar.ts" },
    ]);
    writeTasks([]);

    await handler(makeInput());

    const tracker = readTracker();
    const entry = tracker.find((e) => e["agent_id"] === "agent-abc");
    const touched = entry!["files_touched"] as string[];
    expect(touched).toHaveLength(2);
    expect(touched).toContain("src/foo.ts");
    expect(touched).toContain("src/bar.ts");
  });
});

// ---------------------------------------------------------------------------
// Scenario 4: entry missing (tracker empty or agent_id mismatch) → silent skip
// ---------------------------------------------------------------------------

describe("Scenario 4: missing tracker entry — silent skip (tracker not modified)", () => {
  it("does not modify the tracker and does not throw when tracker array is empty", async () => {
    writeTracker([]);
    writeTasks([]);

    const result = await handler(makeInput());

    // No pending tasks → no additional_context
    expect(result).toBeUndefined();
    // Tracker must remain unchanged (empty)
    const tracker = readTracker();
    expect(tracker).toHaveLength(0);
  });

  it("does not modify the non-matching entry and returns undefined when agent_id is not found", async () => {
    writeTracker([{ agent_id: "agent-OTHER", status: "running" }]);
    writeTasks([]);

    const result = await handler(makeInput());

    expect(result).toBeUndefined();
    // Tracker entry for unmatched agent must remain unchanged
    const tracker = readTracker();
    expect(tracker).toHaveLength(1);
    expect(tracker[0]["status"]).toBe("running");
    // No status update, stopped_at, last_message, or files_touched was added
    expect(tracker[0]["stopped_at"]).toBeUndefined();
    expect(tracker[0]["files_touched"]).toBeUndefined();
  });

  it("does not throw and returns undefined when tasks.json is absent and tracker has no matching entry", async () => {
    writeTracker([{ agent_id: "agent-OTHER", status: "running" }]);
    // tasks.json intentionally absent

    const result = await handler(makeInput());

    expect(result).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Scenario 5: tracker entry updated with status="completed", stopped_at, last_message
// ---------------------------------------------------------------------------

describe("Scenario 5: tracker entry fields updated on agent stop", () => {
  it("sets status to 'completed' and records stopped_at as a valid ISO timestamp", async () => {
    const before = new Date();
    writeTracker([{ agent_id: "agent-abc", status: "running" }]);
    writeTasks([]);

    await handler(makeInput({ last_assistant_message: "Task finished." }));

    const after = new Date();
    const tracker = readTracker();
    const entry = tracker.find((e) => e["agent_id"] === "agent-abc");
    expect(entry).toBeDefined();

    expect(entry!["status"]).toBe("completed");

    const stoppedAt = entry!["stopped_at"] as string;
    expect(typeof stoppedAt).toBe("string");
    const stoppedDate = new Date(stoppedAt);
    // Must be a valid date in the range [before, after]
    expect(stoppedDate.getTime()).toBeGreaterThanOrEqual(before.getTime());
    expect(stoppedDate.getTime()).toBeLessThanOrEqual(after.getTime());
  });

  it("records last_message in the tracker entry", async () => {
    writeTracker([{ agent_id: "agent-abc", status: "running" }]);
    writeTasks([]);

    await handler(makeInput({ last_assistant_message: "Short message." }));

    const tracker = readTracker();
    const entry = tracker.find((e) => e["agent_id"] === "agent-abc");
    expect(entry!["last_message"]).toBe("Short message.");
  });
});

// ---------------------------------------------------------------------------
// Scenario 6: last_assistant_message > 500 chars → last_message sliced to 500 chars
// ---------------------------------------------------------------------------

describe("Scenario 6: last_assistant_message truncated to 500 chars in last_message", () => {
  it("stores only the first 500 characters of a message exceeding 500 chars", async () => {
    const longMessage = "A".repeat(501);
    writeTracker([{ agent_id: "agent-abc", status: "running" }]);
    writeTasks([]);

    await handler(makeInput({ last_assistant_message: longMessage }));

    const tracker = readTracker();
    const entry = tracker.find((e) => e["agent_id"] === "agent-abc");
    expect(entry).toBeDefined();

    const stored = entry!["last_message"] as string;
    expect(stored.length).toBe(500);
    expect(stored).toBe("A".repeat(500));
  });

  it("stores the message unchanged when it is exactly 500 chars", async () => {
    const exactMessage = "B".repeat(500);
    writeTracker([{ agent_id: "agent-abc", status: "running" }]);
    writeTasks([]);

    await handler(makeInput({ last_assistant_message: exactMessage }));

    const tracker = readTracker();
    const entry = tracker.find((e) => e["agent_id"] === "agent-abc");
    const stored = entry!["last_message"] as string;
    expect(stored.length).toBe(500);
    expect(stored).toBe(exactMessage);
  });

  it("stores the full message unchanged when it is under 500 chars", async () => {
    const shortMessage = "Hello world";
    writeTracker([{ agent_id: "agent-abc", status: "running" }]);
    writeTasks([]);

    await handler(makeInput({ last_assistant_message: shortMessage }));

    const tracker = readTracker();
    const entry = tracker.find((e) => e["agent_id"] === "agent-abc");
    expect(entry!["last_message"]).toBe(shortMessage);
  });

  it("handles missing last_assistant_message as empty string (no throw, last_message is empty)", async () => {
    writeTracker([{ agent_id: "agent-abc", status: "running" }]);
    writeTasks([]);

    const inputWithoutMessage = {
      hook_event_name: "SubagentStop" as const,
      session_id: "sess-test",
      cwd: tmpDir,
      agent_type: "engineer",
      agent_id: "agent-abc",
      // last_assistant_message intentionally omitted
    };

    await handler(inputWithoutMessage);

    const tracker = readTracker();
    const entry = tracker.find((e) => e["agent_id"] === "agent-abc");
    expect(entry!["last_message"]).toBe("");
  });
});

// ---------------------------------------------------------------------------
// Guard: non-SubagentStop events are silently ignored
// ---------------------------------------------------------------------------

describe("Guard: non-SubagentStop events", () => {
  it("returns undefined immediately for non-SubagentStop events without touching any files", async () => {
    const result = await handler({
      hook_event_name: "SessionStart",
      session_id: "sess-test",
      cwd: tmpDir,
    });

    expect(result).toBeUndefined();
    // No tracker file should have been created
    expect(fs.existsSync(trackerPath())).toBe(false);
  });
});
