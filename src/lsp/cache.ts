import { statSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { LspClient } from './client.js';
import { getLanguageFromExt, getLspConfig, getLanguageId } from './detect.js';
import { findProjectRoot } from '../shared/paths.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface FileEntry {
  mtime: number;
  version: number;
}

interface CacheEntry {
  client: LspClient | null; // null when permanently failed
  lastUsed: number;
  failCount: number;
  files: Map<string, FileEntry>;
  workspace_root: string;
  language: string;
  idleTimer: ReturnType<typeof setInterval> | null;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const IDLE_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
const MAX_FAIL_COUNT = 3;

// Workspace root marker files (checked in order)
const WORKSPACE_MARKERS = [
  'tsconfig.json',
  'jsconfig.json',
  'pyproject.toml',
  'setup.py',
  'Cargo.toml',
  'go.mod',
  'package.json',
  '.git',
];

// ---------------------------------------------------------------------------
// Cache store
// ---------------------------------------------------------------------------

const cache = new Map<string, CacheEntry>();

// ---------------------------------------------------------------------------
// SIGINT/SIGTERM handler — registered at most once
// ---------------------------------------------------------------------------

let signalHandlerRegistered = false;

function ensureSignalHandlers(): void {
  if (signalHandlerRegistered) return;
  signalHandlerRegistered = true;
  const handler = () => {
    shutdownAll().finally(() => process.exit(0));
  };
  process.on('SIGINT', handler);
  process.on('SIGTERM', handler);
}

// ---------------------------------------------------------------------------
// Workspace root detection
// ---------------------------------------------------------------------------

export function findWorkspaceRoot(filePath: string): string {
  let dir = dirname(filePath);
  // findProjectRoot ceiling: use the actual project root (git root or cwd-based),
  // not the starting dir — avoids early termination when dir === root at startup
  const root = findProjectRoot();

  while (true) {
    for (const marker of WORKSPACE_MARKERS) {
      const candidate = join(dir, marker);
      let exists = false;
      try {
        statSync(candidate);
        exists = true;
      } catch {
        // not found
      }
      if (exists) return dir;
    }
    if (dir === root || dir === dirname(dir)) break;
    dir = dirname(dir);
  }

  return root;
}

// ---------------------------------------------------------------------------
// Idle timer management
// ---------------------------------------------------------------------------

function resetIdleTimer(key: string, entry: CacheEntry): void {
  if (entry.idleTimer !== null) {
    clearInterval(entry.idleTimer);
  }
  entry.idleTimer = setInterval(async () => {
    const e = cache.get(key);
    if (!e) return;
    const now = Date.now();
    if (now - e.lastUsed >= IDLE_TIMEOUT_MS) {
      clearInterval(e.idleTimer!);
      cache.delete(key);
      if (e.client) {
        await e.client.shutdown().catch(() => {/* ignore */});
      }
    }
  }, IDLE_TIMEOUT_MS);
  // Unref so the timer doesn't keep the process alive
  if (typeof entry.idleTimer === 'object' && entry.idleTimer !== null && 'unref' in entry.idleTimer) {
    (entry.idleTimer as { unref: () => void }).unref();
  }
}

// ---------------------------------------------------------------------------
// ensureClient
// ---------------------------------------------------------------------------

export async function ensureClient(
  filePath: string,
): Promise<LspClient | { error: string; install_hint?: string }> {
  ensureSignalHandlers();

  const language = getLanguageFromExt(filePath);
  if (!language) {
    throw new Error(`Unsupported language for file: ${filePath}`);
  }

  const workspace_root = findWorkspaceRoot(filePath);
  const key = `${language}:${workspace_root}`;

  const existing = cache.get(key);

  if (existing) {
    // Permanently failed
    if (existing.failCount >= MAX_FAIL_COUNT && existing.client === null) {
      return {
        error: `LSP server for "${language}" has permanently failed after ${MAX_FAIL_COUNT} attempts`,
        install_hint: undefined,
      };
    }

    // Ready and alive
    if (existing.client?.isReady()) {
      existing.lastUsed = Date.now();
      resetIdleTimer(key, existing);
      return existing.client;
    }

    // Dead client — attempt re-spawn below (falls through)
  }

  // Get LSP configuration
  const lspConfig = getLspConfig(language);
  if ('error' in lspConfig) {
    return { error: lspConfig.error, install_hint: lspConfig.install_hint };
  }

  // Create or update cache entry
  const entry: CacheEntry = existing ?? {
    client: null,
    lastUsed: Date.now(),
    failCount: 0,
    files: new Map(),
    workspace_root,
    language,
    idleTimer: null,
  };

  if (!existing) {
    cache.set(key, entry);
  }

  // Attempt spawn
  const client = new LspClient(lspConfig.command, lspConfig.args);
  const rootUri = pathToFileURL(workspace_root).href;

  try {
    await client.initialize(rootUri);
    entry.client = client;
    entry.lastUsed = Date.now();
    resetIdleTimer(key, entry);
    return client;
  } catch (err) {
    entry.failCount += 1;
    entry.client = null;

    if (entry.failCount >= MAX_FAIL_COUNT) {
      return {
        error: `LSP server for "${language}" failed to start ${MAX_FAIL_COUNT} times and is permanently disabled`,
        install_hint: lspConfig.install_hint,
      };
    }

    return {
      error: `LSP server for "${language}" failed to start (attempt ${entry.failCount}): ${err instanceof Error ? err.message : String(err)}`,
      install_hint: lspConfig.install_hint,
    };
  }
}

// ---------------------------------------------------------------------------
// ensureFileSync
// ---------------------------------------------------------------------------

export async function ensureFileSync(
  client: LspClient,
  filePath: string,
): Promise<void> {
  const language = getLanguageFromExt(filePath);
  const workspace_root = findWorkspaceRoot(filePath);
  const key = `${language}:${workspace_root}`;
  const entry = cache.get(key);
  if (!entry) return;

  const uri = pathToFileURL(filePath).href;
  const languageId = getLanguageId(filePath) ?? 'plaintext';

  let currentMtime: number;
  try {
    currentMtime = statSync(filePath).mtimeMs;
  } catch {
    return; // File doesn't exist or inaccessible
  }

  const fileEntry = entry.files.get(uri);

  if (!fileEntry) {
    // First time seeing this file
    const text = readFileSync(filePath, 'utf-8');
    client.notifyDidOpen(uri, languageId, text);
    entry.files.set(uri, { mtime: currentMtime, version: 1 });
  } else if (fileEntry.mtime !== currentMtime) {
    // File changed — send full text didChange
    const text = readFileSync(filePath, 'utf-8');
    const newVersion = fileEntry.version + 1;
    client.notifyDidChange(uri, newVersion, text);
    entry.files.set(uri, { mtime: currentMtime, version: newVersion });
  }
  // Same mtime → noop
}

// ---------------------------------------------------------------------------
// shutdownAll
// ---------------------------------------------------------------------------

export async function shutdownAll(): Promise<void> {
  const shutdowns: Promise<void>[] = [];
  for (const [key, entry] of cache) {
    if (entry.idleTimer !== null) {
      clearInterval(entry.idleTimer);
    }
    cache.delete(key);
    if (entry.client) {
      shutdowns.push(entry.client.shutdown().catch(() => {/* ignore */}));
    }
  }
  await Promise.all(shutdowns);
}
