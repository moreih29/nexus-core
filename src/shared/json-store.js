import fs from "node:fs/promises";
import { constants as fsConstants, appendFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
// ---------------------------------------------------------------------------
// In-process mutex (serialises concurrent calls within the same process)
// ---------------------------------------------------------------------------
const inProcessQueues = new Map();
async function runWithInProcessLock(filePath, action) {
    const previous = inProcessQueues.get(filePath) ?? Promise.resolve();
    let release = () => { };
    const gate = new Promise((resolve) => {
        release = resolve;
    });
    // The entry in the map is the combined promise so the next waiter queues behind both
    const entry = previous.then(() => gate);
    inProcessQueues.set(filePath, entry);
    await previous;
    try {
        return await action();
    }
    finally {
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
function lockPath(filePath) {
    return `${filePath}.lock`;
}
async function acquireFsLock(filePath) {
    const lp = lockPath(filePath);
    for (let attempt = 0; attempt <= LOCK_MAX_RETRIES; attempt++) {
        try {
            // O_EXCL ensures atomic creation — only one process wins
            const fd = await fs.open(lp, fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL);
            await fd.close();
            return;
        }
        catch (err) {
            const e = err;
            if (e.code !== "EEXIST")
                throw err;
            // Lock file exists — check if it is stale
            try {
                const stat = await fs.stat(lp);
                const ageMs = Date.now() - stat.mtimeMs;
                if (ageMs > LOCK_STALE_MS) {
                    // Stale lock — remove and retry immediately
                    await fs.unlink(lp).catch(() => undefined);
                    continue;
                }
            }
            catch {
                // stat failed (lock vanished between check and here) — retry
                continue;
            }
            if (attempt === LOCK_MAX_RETRIES) {
                throw new Error(`Failed to acquire lock for "${filePath}" after ${LOCK_MAX_RETRIES} retries`);
            }
            await new Promise((resolve) => setTimeout(resolve, LOCK_RETRY_INTERVAL_MS));
        }
    }
}
async function releaseFsLock(filePath) {
    await fs.unlink(lockPath(filePath)).catch(() => undefined);
}
// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------
/**
 * Read a JSON file, returning `defaultValue` when the file does not exist or
 * its content cannot be parsed.
 */
export async function readJsonFile(filePath, defaultValue) {
    let raw;
    try {
        raw = await fs.readFile(filePath, "utf8");
    }
    catch (err) {
        const e = err;
        if (e.code === "ENOENT")
            return defaultValue;
        throw err;
    }
    try {
        return JSON.parse(raw);
    }
    catch {
        return defaultValue;
    }
}
/**
 * Atomically write a JSON file.
 * Writes to a unique temp file then renames to the target path.
 * Parent directories are created automatically.
 */
export async function writeJsonFile(filePath, data) {
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
export async function updateJsonFileLocked(filePath, defaultValue, updater) {
    return runWithInProcessLock(filePath, async () => {
        await acquireFsLock(filePath);
        try {
            const current = await readJsonFile(filePath, defaultValue);
            const next = await updater(current);
            await writeJsonFile(filePath, next);
            return next;
        }
        finally {
            await releaseFsLock(filePath);
        }
    });
}
// ---------------------------------------------------------------------------
// Append-only JSONL helper
// ---------------------------------------------------------------------------
const APPEND_SIZE_WARN_THRESHOLD = 4 * 1024; // 4KB — OS write atomicity limit
/**
 * Append a single JSON record as one line to a `.jsonl` file.
 *
 * Uses the OS `write(2)` syscall via `appendFileSync`, which is atomic for
 * writes up to ~4 KB on most POSIX filesystems. Lines exceeding that threshold
 * trigger a `console.error` warning but are still written (best-effort).
 *
 * No lock is acquired — concurrent appenders are safe at the line level
 * because each call is a single `write(2)` syscall.
 * Parent directories are created automatically.
 */
export function appendJsonLine(filePath, record) {
    const line = JSON.stringify(record) + "\n";
    if (line.length > APPEND_SIZE_WARN_THRESHOLD) {
        console.error(`[json-store] appendJsonLine line exceeds ${APPEND_SIZE_WARN_THRESHOLD} bytes ` +
            `(${line.length}) — write may not be atomic on some filesystems. path=${filePath}`);
    }
    mkdirSync(path.dirname(filePath), { recursive: true });
    appendFileSync(filePath, line);
}
//# sourceMappingURL=json-store.js.map