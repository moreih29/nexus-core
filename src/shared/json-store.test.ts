import { describe, it, expect, beforeEach, afterEach, spyOn } from "bun:test";
import fs from "node:fs";
import fsPromises from "node:fs/promises";
import path from "node:path";
import { readJsonFile, writeJsonFile, updateJsonFileLocked, appendJsonLine } from "./json-store.ts";
import { makeTempDir } from "./test-temp.ts";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

let tmpDir: string;

beforeEach(() => {
  tmpDir = makeTempDir("nexus-json-");
});

afterEach(async () => {
  await fsPromises.rm(tmpDir, { recursive: true, force: true });
});

function fp(name: string): string {
  return path.join(tmpDir, name);
}

// ---------------------------------------------------------------------------
// readJsonFile
// ---------------------------------------------------------------------------

describe("readJsonFile", () => {
  it("1. returns parsed content when file exists", async () => {
    const file = fp("existing.json");
    await fsPromises.writeFile(file, JSON.stringify({ a: 1 }), "utf8");
    const result = await readJsonFile<{ a: number }>(file, { a: 0 });
    expect(result).toEqual({ a: 1 });
  });

  it("2. returns defaultValue when file does not exist", async () => {
    const result = await readJsonFile(fp("missing.json"), { fallback: true });
    expect(result).toEqual({ fallback: true });
  });

  it("3. returns defaultValue when JSON is malformed (does not throw)", async () => {
    const file = fp("corrupt.json");
    await fsPromises.writeFile(file, "{ not valid json {{", "utf8");
    const result = await readJsonFile(file, 42);
    expect(result).toBe(42);
  });
});

// ---------------------------------------------------------------------------
// writeJsonFile
// ---------------------------------------------------------------------------

describe("writeJsonFile", () => {
  it("4. creates a new file with JSON content", async () => {
    const file = fp("new.json");
    await writeJsonFile(file, { hello: "world" });
    const raw = await fsPromises.readFile(file, "utf8");
    expect(JSON.parse(raw)).toEqual({ hello: "world" });
  });

  it("5. overwrites an existing file", async () => {
    const file = fp("overwrite.json");
    await writeJsonFile(file, { v: 1 });
    await writeJsonFile(file, { v: 2 });
    const raw = await fsPromises.readFile(file, "utf8");
    expect(JSON.parse(raw)).toEqual({ v: 2 });
  });

  it("6. auto-creates missing parent directories", async () => {
    const file = fp("nested/deep/file.json");
    await writeJsonFile(file, { nested: true });
    const raw = await fsPromises.readFile(file, "utf8");
    expect(JSON.parse(raw)).toEqual({ nested: true });
  });

  it("7. no leftover tmp file after successful write (atomic verification)", async () => {
    const file = fp("atomic.json");
    await writeJsonFile(file, { ok: true });

    // No .tmp.* files should remain in the directory
    const entries = await fsPromises.readdir(path.dirname(file));
    const tmpFiles = entries.filter((e) => e.includes(".tmp."));
    expect(tmpFiles).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// updateJsonFileLocked
// ---------------------------------------------------------------------------

describe("updateJsonFileLocked", () => {
  it("8. single call reads default, applies updater, persists result", async () => {
    const file = fp("single.json");
    const result = await updateJsonFileLocked(file, { count: 0 }, (c) => ({ count: c.count + 1 }));
    expect(result).toEqual({ count: 1 });

    const persisted = await readJsonFile(file, { count: -1 });
    expect(persisted).toEqual({ count: 1 });
  });

  it("9. 100 concurrent calls each incrementing a counter produce exactly 100 (no lost updates)", async () => {
    const file = fp("race.json");
    await writeJsonFile(file, { count: 0 });

    const tasks = Array.from({ length: 100 }, () =>
      updateJsonFileLocked(file, { count: 0 }, (c) => ({ count: c.count + 1 })),
    );
    await Promise.all(tasks);

    const result = await readJsonFile<{ count: number }>(file, { count: -1 });
    expect(result.count).toBe(100);
  }, 30_000);

  it("10. updater throw releases lock so subsequent call succeeds", async () => {
    const file = fp("throw.json");

    await expect(
      updateJsonFileLocked(file, { v: 0 }, () => {
        throw new Error("updater error");
      }),
    ).rejects.toThrow("updater error");

    // Lock must have been released — next call must not hang
    const result = await updateJsonFileLocked(file, { v: 0 }, (c) => ({ v: c.v + 1 }));
    expect(result).toEqual({ v: 1 });
  });

  it("11. stale lock (mtime > 30s) is automatically cleared and call succeeds", async () => {
    const file = fp("stale.json");
    const lp = `${file}.lock`;

    // Create a lock file and backdate its mtime by 31 seconds
    await fsPromises.writeFile(lp, "", "utf8");
    const staleTime = new Date(Date.now() - 31_000);
    await fsPromises.utimes(lp, staleTime, staleTime);

    // Should detect the stale lock, remove it, and proceed normally
    const result = await updateJsonFileLocked(file, { stale: true }, (c) => c);
    expect(result).toEqual({ stale: true });

    // Lock file should be gone
    const lockExists = await fsPromises.access(lp).then(() => true).catch(() => false);
    expect(lockExists).toBe(false);
  });

  it("12. 2 parallel agent-tracker writers both changes are preserved (no lost update)", async () => {
    // Simulates two agents writing distinct keys to the same agent-tracker.json
    const file = fp("agent-tracker.json");
    await writeJsonFile(file, { agentA: null, agentB: null });

    const [resultA, resultB] = await Promise.all([
      updateJsonFileLocked(
        file,
        { agentA: null, agentB: null },
        (c) => ({ ...c, agentA: "done" }),
      ),
      updateJsonFileLocked(
        file,
        { agentA: null, agentB: null },
        (c) => ({ ...c, agentB: "done" }),
      ),
    ]);

    // Both callers saw a result (neither was dropped)
    expect(resultA.agentA === "done" || resultB.agentB === "done").toBe(true);

    // Final file must contain both writes
    const final = await readJsonFile<{ agentA: string | null; agentB: string | null }>(
      file,
      { agentA: null, agentB: null },
    );
    expect(final.agentA).toBe("done");
    expect(final.agentB).toBe("done");
  });
});

// ---------------------------------------------------------------------------
// appendJsonLine
// ---------------------------------------------------------------------------

describe("appendJsonLine", () => {
  it("13. 100 parallel appends — every line is valid JSON and total count is 100", async () => {
    const file = fp("parallel.jsonl");

    // Kick off 100 concurrent synchronous-but-Promise-wrapped appends
    await Promise.all(
      Array.from({ length: 100 }, (_, i) =>
        new Promise<void>((resolve) => {
          appendJsonLine(file, { seq: i, payload: "x".repeat(64) });
          resolve();
        }),
      ),
    );

    const raw = await fsPromises.readFile(file, "utf8");
    const lines = raw.trimEnd().split("\n");

    expect(lines).toHaveLength(100);

    for (const line of lines) {
      // Every line must be parseable JSON with the expected shape
      let parsed: unknown;
      expect(() => { parsed = JSON.parse(line); }).not.toThrow();
      expect(parsed).toMatchObject({ payload: "x".repeat(64) });
    }
  });

  it("14. entry exceeding 4KB emits console.error warning but is still written (no throw)", async () => {
    const file = fp("large.jsonl");

    const errorSpy = spyOn(console, "error").mockImplementation(() => {});
    try {
      // Build a record whose JSON serialisation exceeds 4096 bytes
      const bigRecord = { data: "A".repeat(5000) };

      // Must not throw
      expect(() => appendJsonLine(file, bigRecord)).not.toThrow();

      // console.error must have been called at least once with the warning
      expect(errorSpy).toHaveBeenCalled();
      const [firstArg] = errorSpy.mock.calls[0] as [string];
      expect(firstArg).toContain("[json-store] appendJsonLine line exceeds");

      // The record must still be written
      const raw = await fsPromises.readFile(file, "utf8");
      const parsed = JSON.parse(raw.trimEnd());
      expect(parsed.data).toHaveLength(5000);
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("15. auto-creates missing parent directories before writing", async () => {
    const file = fp("deep/nested/dir/events.jsonl");

    // Parent directories do not exist yet — must not throw
    expect(() => appendJsonLine(file, { event: "init" })).not.toThrow();

    const raw = await fsPromises.readFile(file, "utf8");
    expect(JSON.parse(raw.trimEnd())).toEqual({ event: "init" });
  });

  it("16. single append writes exactly one line of valid JSON", async () => {
    const file = fp("single.jsonl");
    appendJsonLine(file, { hello: "world" });

    const raw = await fsPromises.readFile(file, "utf8");
    const lines = raw.trimEnd().split("\n");
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0])).toEqual({ hello: "world" });
  });
});
