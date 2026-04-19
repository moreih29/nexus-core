import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import fs from "node:fs";
import fsPromises from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import handler from "./handler.ts";
import type { NexusHookInput } from "../../../src/hooks/types.ts";

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "nexus-post-tool-"));
});

afterEach(async () => {
  await fsPromises.rm(tmpDir, { recursive: true, force: true });
});

/** Build a minimal PostToolUse input */
function makeInput(
  overrides: Partial<Extract<NexusHookInput, { hook_event_name: "PostToolUse" }>> & {
    tool_input?: Record<string, unknown>;
  },
): NexusHookInput {
  return {
    hook_event_name: "PostToolUse",
    session_id: "sid-test",
    cwd: tmpDir,
    tool_name: "Edit",
    agent_id: "agent-engineer",
    ...overrides,
  } as NexusHookInput;
}

function toolLogPath(sessionId = "sid-test"): string {
  return path.join(tmpDir, ".nexus/state", sessionId, "tool-log.jsonl");
}

function memAccessPath(): string {
  return path.join(tmpDir, ".nexus/memory-access.jsonl");
}

function readJsonLines(filePath: string): unknown[] {
  const raw = fs.readFileSync(filePath, "utf8");
  return raw
    .trimEnd()
    .split("\n")
    .filter((l) => l.trim() !== "")
    .map((l) => JSON.parse(l));
}

// ---------------------------------------------------------------------------
// Scenario 1 — Edit + agent_id present → tool-log.jsonl 1-line append
// ---------------------------------------------------------------------------

describe("scenario 1: Edit + agent_id → tool-log append", () => {
  it("appends one record to .nexus/state/sessions/<sid>/tool-log.jsonl", async () => {
    const input = makeInput({
      tool_name: "Edit",
      agent_id: "agent-engineer",
      tool_input: { file_path: path.join(tmpDir, "src/foo.ts") },
    });

    const result = await handler(input);

    // No additional_context or block returned
    expect(result).toBeUndefined();

    const logFile = toolLogPath();
    expect(fs.existsSync(logFile)).toBe(true);

    const lines = readJsonLines(logFile);
    expect(lines).toHaveLength(1);

    const entry = lines[0] as Record<string, unknown>;
    expect(entry.agent_id).toBe("agent-engineer");
    expect(entry.tool).toBe("Edit");
    expect(entry.file).toBe("src/foo.ts");
    expect(entry.status).toBe("ok");
    expect(typeof entry.ts).toBe("string");
    expect(() => new Date(entry.ts as string)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Scenario 2 — Read + file_path within .nexus/memory/** → memory-access.jsonl append
// ---------------------------------------------------------------------------

describe("scenario 2: Read + memory path → memory-access.jsonl append", () => {
  it("appends one record to .nexus/memory-access.jsonl", async () => {
    const memFile = path.join(tmpDir, ".nexus/memory/lessons.md");
    // File does not need to exist; only the path matters for the hook

    const input = makeInput({
      tool_name: "Read",
      agent_id: "agent-researcher",
      tool_input: { file_path: memFile },
    });

    await handler(input);

    const accFile = memAccessPath();
    expect(fs.existsSync(accFile)).toBe(true);

    const lines = readJsonLines(accFile);
    expect(lines).toHaveLength(1);

    const entry = lines[0] as Record<string, unknown>;
    expect(entry.path).toBe(".nexus/memory/lessons.md");
    expect(entry.agent).toBe("agent-researcher");
    expect(typeof entry.accessed_at).toBe("string");
    expect(() => new Date(entry.accessed_at as string)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Scenario 3 — Read + other path (src/foo.ts) → memory-access.jsonl NOT written
// ---------------------------------------------------------------------------

describe("scenario 3: Read + non-memory path → memory-access skip", () => {
  it("does not create memory-access.jsonl for a non-memory file path", async () => {
    const input = makeInput({
      tool_name: "Read",
      agent_id: "agent-engineer",
      tool_input: { file_path: path.join(tmpDir, "src/foo.ts") },
    });

    await handler(input);

    expect(fs.existsSync(memAccessPath())).toBe(false);
    // tool-log is also not written because tool is Read (not an edit tool)
    expect(fs.existsSync(toolLogPath())).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Scenario 4 — Lead (agent_id = null) + Edit → tool-log skip
// ---------------------------------------------------------------------------

describe("scenario 4: Lead (agent_id null) + Edit → tool-log skip", () => {
  it("does not write tool-log.jsonl when agent_id is null", async () => {
    const input = makeInput({
      tool_name: "Edit",
      agent_id: null,
      tool_input: { file_path: path.join(tmpDir, "src/bar.ts") },
    });

    await handler(input);

    expect(fs.existsSync(toolLogPath())).toBe(false);
  });

  it("does not write tool-log.jsonl when agent_id is undefined", async () => {
    const input: NexusHookInput = {
      hook_event_name: "PostToolUse",
      session_id: "sid-test",
      cwd: tmpDir,
      tool_name: "Edit",
      // agent_id intentionally omitted
      tool_input: { file_path: path.join(tmpDir, "src/bar.ts") },
    };

    await handler(input);

    expect(fs.existsSync(toolLogPath())).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Scenario 5 — NotebookEdit + notebook_path (no file_path) → tool-log uses notebook_path
// ---------------------------------------------------------------------------

describe("scenario 5: NotebookEdit + notebook_path → tool-log with notebook_path", () => {
  it("uses notebook_path when file_path is absent", async () => {
    const nbPath = path.join(tmpDir, "notebooks/analysis.ipynb");

    const input = makeInput({
      tool_name: "NotebookEdit",
      agent_id: "agent-engineer",
      tool_input: { notebook_path: nbPath },
      // no file_path key
    });

    await handler(input);

    const logFile = toolLogPath();
    expect(fs.existsSync(logFile)).toBe(true);

    const lines = readJsonLines(logFile);
    expect(lines).toHaveLength(1);

    const entry = lines[0] as Record<string, unknown>;
    expect(entry.tool).toBe("NotebookEdit");
    expect(entry.file).toBe("notebooks/analysis.ipynb");
    expect(entry.agent_id).toBe("agent-engineer");
    expect(entry.status).toBe("ok");
  });

  it("prefers file_path over notebook_path when both are present", async () => {
    const input = makeInput({
      tool_name: "NotebookEdit",
      agent_id: "agent-engineer",
      tool_input: {
        file_path: path.join(tmpDir, "src/primary.ipynb"),
        notebook_path: path.join(tmpDir, "notebooks/secondary.ipynb"),
      },
    });

    await handler(input);

    const lines = readJsonLines(toolLogPath());
    const entry = lines[0] as Record<string, unknown>;
    // file_path is ?? first, so it wins
    expect(entry.file).toBe("src/primary.ipynb");
  });
});

// ---------------------------------------------------------------------------
// Scenario 6 — 100 parallel appendJsonLine → jsonl integrity
// ---------------------------------------------------------------------------

describe("scenario 6: 100 parallel handler calls → jsonl integrity", () => {
  it("all 100 lines are valid JSON and each has expected shape", async () => {
    const inputs = Array.from({ length: 100 }, (_, i) =>
      makeInput({
        tool_name: "Edit",
        agent_id: `agent-${i}`,
        session_id: "sid-parallel",
        tool_input: { file_path: path.join(tmpDir, `src/file-${i}.ts`) },
      }),
    );

    await Promise.all(inputs.map((inp) => handler(inp)));

    const logFile = toolLogPath("sid-parallel");
    expect(fs.existsSync(logFile)).toBe(true);

    const raw = fs.readFileSync(logFile, "utf8");
    const lines = raw
      .trimEnd()
      .split("\n")
      .filter((l) => l.trim() !== "");

    expect(lines).toHaveLength(100);

    for (const line of lines) {
      let parsed: unknown;
      expect(() => {
        parsed = JSON.parse(line);
      }).not.toThrow();

      const entry = parsed as Record<string, unknown>;
      expect(typeof entry.ts).toBe("string");
      expect(typeof entry.agent_id).toBe("string");
      expect(entry.tool).toBe("Edit");
      expect(typeof entry.file).toBe("string");
      expect(entry.status).toBe("ok");
    }
  }, 15_000);
});

// ---------------------------------------------------------------------------
// Scenario 7 — handler returns no additional_context and no block
// ---------------------------------------------------------------------------

describe("scenario 7: handler returns no additional_context / block", () => {
  it("returns undefined for Edit + agent_id call", async () => {
    const result = await handler(
      makeInput({
        tool_name: "Edit",
        agent_id: "agent-engineer",
        tool_input: { file_path: path.join(tmpDir, "src/x.ts") },
      }),
    );
    expect(result).toBeUndefined();
  });

  it("returns undefined for Read + memory path call", async () => {
    const result = await handler(
      makeInput({
        tool_name: "Read",
        agent_id: "agent-researcher",
        tool_input: { file_path: path.join(tmpDir, ".nexus/memory/ref.md") },
      }),
    );
    expect(result).toBeUndefined();
  });

  it("returns undefined for non-PostToolUse event (early return)", async () => {
    const input: NexusHookInput = {
      hook_event_name: "SessionStart",
      session_id: "sid-test",
      cwd: tmpDir,
    };
    const result = await handler(input);
    expect(result).toBeUndefined();
  });
});
