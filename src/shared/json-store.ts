import fs from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

// ---------------------------------------------------------------------------
// In-process mutex (serialises concurrent calls within the same process)
// ---------------------------------------------------------------------------

const inProcessQueues = new Map<string, Promise<void>>();

async function runWithInProcessLock<T>(filePath: string, action: () => Promise<T>): Promise<T> {
  const previous = inProcessQueues.get(filePath) ?? Promise.resolve();
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  // The entry in the map is the combined promise so the next waiter queues behind both
  const entry = previous.then(() => gate);
  inProcessQueues.set(filePath, entry);

  await previous;
  try {
    return await action();
  } finally {
    release();
    entry.finally(() => {
      if (inProcessQueues.get(filePath) === entry) {
        inProcessQueues.delete(filePath);
      }
    });
  }
}

// ---------------------------------------------------------------------------
// Cross-process file-system lock (.lock file, O_EXCL)
// ---------------------------------------------------------------------------

const LOCK_RETRY_INTERVAL_MS = 100;
const LOCK_MAX_RETRIES = 50; // 5 seconds total
const LOCK_STALE_MS = 30_000; // 30 seconds

function lockPath(filePath: string): string {
  return `${filePath}.lock`;
}

async function acquireFsLock(filePath: string): Promise<void> {
  const lp = lockPath(filePath);

  for (let attempt = 0; attempt <= LOCK_MAX_RETRIES; attempt++) {
    try {
      // O_EXCL ensures atomic creation — only one process wins
      const fd = await fs.open(lp, fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL);
      await fd.close();
      return;
    } catch (err: unknown) {
      const e = err as NodeJS.ErrnoException;
      if (e.code !== "EEXIST") throw err;

      // Lock file exists — check if it is stale
      try {
        const stat = await fs.stat(lp);
        const ageMs = Date.now() - stat.mtimeMs;
        if (ageMs > LOCK_STALE_MS) {
          // Stale lock — remove and retry immediately
          await fs.unlink(lp).catch(() => undefined);
          continue;
        }
      } catch {
        // stat failed (lock vanished between check and here) — retry
        continue;
      }

      if (attempt === LOCK_MAX_RETRIES) {
        throw new Error(`Failed to acquire lock for "${filePath}" after ${LOCK_MAX_RETRIES} retries`);
      }

      await new Promise<void>((resolve) => setTimeout(resolve, LOCK_RETRY_INTERVAL_MS));
    }
  }
}

async function releaseFsLock(filePath: string): Promise<void> {
  await fs.unlink(lockPath(filePath)).catch(() => undefined);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Read a JSON file, returning `defaultValue` when the file does not exist or
 * its content cannot be parsed.
 */
export async function readJsonFile<T>(filePath: string, defaultValue: T): Promise<T> {
  let raw: string;
  try {
    raw = await fs.readFile(filePath, "utf8");
  } catch (err: unknown) {
    const e = err as NodeJS.ErrnoException;
    if (e.code === "ENOENT") return defaultValue;
    throw err;
  }

  try {
    return JSON.parse(raw) as T;
  } catch {
    return defaultValue;
  }
}

/**
 * Atomically write a JSON file.
 * Writes to a unique temp file then renames to the target path.
 * Parent directories are created automatically.
 */
export async function writeJsonFile<T>(filePath: string, data: T): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.tmp.${process.pid}.${Date.now()}.${randomUUID()}`;
  await fs.writeFile(tmpPath, JSON.stringify(data, null, 2) + "\n", "utf8");
  await fs.rename(tmpPath, filePath);
}

/**
 * Read-modify-write a JSON file under a two-layer lock.
 *
 * Layer 1 — in-process promise queue: serialises concurrent calls within the
 * same Node/Bun process with zero overhead and no retry cost.
 *
 * Layer 2 — cross-process `.lock` file (O_EXCL): prevents data races between
 * separate processes. Retries every 100 ms for up to 50 attempts (5 s total).
 * Stale locks (mtime > 30 s) are forcibly removed before retry.
 *
 * The lock is always released even when `updater` throws.
 */
export async function updateJsonFileLocked<T>(
  filePath: string,
  defaultValue: T,
  updater: (current: T) => T | Promise<T>,
): Promise<T> {
  return runWithInProcessLock(filePath, async () => {
    await acquireFsLock(filePath);
    try {
      const current = await readJsonFile(filePath, defaultValue);
      const next = await updater(current);
      await writeJsonFile(filePath, next);
      return next;
    } finally {
      await releaseFsLock(filePath);
    }
  });
}
