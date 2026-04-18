import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import fs from "node:fs";
import fsPromises from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { readJsonFile, writeJsonFile, updateJsonFileLocked } from "./json-store.ts";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "nexus-json-"));
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
});
