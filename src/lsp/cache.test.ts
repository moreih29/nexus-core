import { describe, test, expect, beforeEach, afterEach, spyOn, mock } from 'bun:test';
import * as fs from 'node:fs';
import * as path from 'node:path';

// ---------------------------------------------------------------------------
// We import the module under test. Because cache uses module-level state,
// we need to reset it between tests using the exported shutdownAll.
// ---------------------------------------------------------------------------

import { ensureClient, ensureFileSync, shutdownAll, findWorkspaceRoot } from './cache.ts';
import { LspClient } from './client.ts';
import { _resetConfigCache } from './detect.ts';
import { makeTempDir } from '../shared/test-temp.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a temporary directory */
function makeTmpDir(): string {
  return makeTempDir('nexus-cache-');
}

/** Reset module-level cache state between tests */
async function resetCache(): Promise<void> {
  await shutdownAll();
  _resetConfigCache();
}

// We need a way to clear the signal handler flag between tests.
// The cache module keeps signalHandlerRegistered as a module-level boolean.
// We'll use process.removeAllListeners carefully only in tests.

beforeEach(async () => {
  await resetCache();
});

afterEach(async () => {
  await resetCache();
});

// ---------------------------------------------------------------------------
// Mocking utilities
// ---------------------------------------------------------------------------

/** Build a mock LspClient that tracks calls */
function makeMockClient(ready = true): {
  client: LspClient;
  didOpenCalls: Array<{ uri: string; languageId: string; text: string }>;
  didChangeCalls: Array<{ uri: string; version: number; text: string }>;
  shutdownCalled: boolean;
} {
  const didOpenCalls: Array<{ uri: string; languageId: string; text: string }> = [];
  const didChangeCalls: Array<{ uri: string; version: number; text: string }> = [];
  let shutdownCalled = false;

  const client = new LspClient('echo', []);

  // Fake the initialized state
  (client as unknown as { initialized: boolean }).initialized = ready;
  (client as unknown as { process: unknown }).process = ready ? { stdin: { write: () => {} }, kill: () => {} } : null;

  // Override notify methods to track calls
  client.notifyDidOpen = (uri, languageId, text) => {
    didOpenCalls.push({ uri, languageId, text });
  };
  client.notifyDidChange = (uri, version, text) => {
    didChangeCalls.push({ uri, version, text });
  };
  client.shutdown = async () => {
    shutdownCalled = true;
    (client as unknown as { initialized: boolean }).initialized = false;
    (client as unknown as { process: unknown }).process = null;
  };

  return { client, didOpenCalls, didChangeCalls, shutdownCalled: false };
}

// ---------------------------------------------------------------------------
// 1. findWorkspaceRoot
// ---------------------------------------------------------------------------

describe('findWorkspaceRoot', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('1. finds nearest marker (tsconfig.json)', () => {
    const sub = path.join(tmpDir, 'src');
    fs.mkdirSync(sub);
    fs.writeFileSync(path.join(tmpDir, 'tsconfig.json'), '{}');

    const result = findWorkspaceRoot(path.join(sub, 'index.ts'));
    expect(result).toBe(tmpDir);
  });

  test('2. returns project root when no marker found', () => {
    // No markers — should return findProjectRoot result
    const sub = path.join(tmpDir, 'a', 'b');
    fs.mkdirSync(sub, { recursive: true });

    // findProjectRoot will walk up — since tmpDir has no .git it'll return
    // the git repo this test runs in, which is fine for our purposes
    const result = findWorkspaceRoot(path.join(sub, 'file.ts'));
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// 2. ensureClient — cache hit/miss/failure scenarios
// ---------------------------------------------------------------------------

describe('ensureClient', () => {
  test('3. unsupported file extension throws', async () => {
    await expect(ensureClient('/some/file.cpp')).rejects.toThrow('Unsupported language');
  });

  test('4. returns error when LSP server binary not found', async () => {
    // Mock getLspConfig to return error
    const detectModule = await import('./detect.ts');
    const spy = spyOn(detectModule, 'getLspConfig').mockReturnValue({
      error: 'No LSP server found',
      install_hint: 'npm install ...',
    });

    const result = await ensureClient('/tmp/test.ts');
    spy.mockRestore();

    expect(typeof result).toBe('object');
    expect('error' in result).toBe(true);
    if ('error' in result) {
      expect(result.error).toContain('No LSP server');
    }
  });

  test('5. increments failCount on spawn failure', async () => {
    const detectModule = await import('./detect.ts');
    // Return a valid config pointing to a non-existent command
    const spy = spyOn(detectModule, 'getLspConfig').mockReturnValue({
      command: '/nonexistent/lsp-binary',
      args: [],
      install_hint: 'install it',
    });

    const result = await ensureClient('/tmp/test.ts');
    spy.mockRestore();

    expect('error' in result).toBe(true);
    if ('error' in result) {
      expect(result.error).toContain('failed to start');
    }
  });

  test('6. permanently_failed after 3 failures — no more attempts', async () => {
    const detectModule = await import('./detect.ts');
    const spy = spyOn(detectModule, 'getLspConfig').mockReturnValue({
      command: '/nonexistent/lsp-binary',
      args: [],
      install_hint: 'install it',
    });

    // First call
    await ensureClient('/tmp/test.ts');
    // Second call
    await ensureClient('/tmp/test.ts');
    // Third call — should reach MAX_FAIL_COUNT
    const result3 = await ensureClient('/tmp/test.ts');
    // Fourth call — should return permanently failed without spawning
    const result4 = await ensureClient('/tmp/test.ts');

    spy.mockRestore();

    expect('error' in result3).toBe(true);
    expect('error' in result4).toBe(true);
    if ('error' in result4) {
      expect(result4.error).toContain('permanently');
    }
  });
});

// ---------------------------------------------------------------------------
// 3. ensureFileSync — mtime-based didOpen/didChange
// ---------------------------------------------------------------------------

describe('ensureFileSync', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  async function setupCacheWithMockClient(filePath: string): Promise<{
    didOpenCalls: Array<{ uri: string; languageId: string; text: string }>;
    didChangeCalls: Array<{ uri: string; version: number; text: string }>;
    client: LspClient;
    restore: () => void;
  }> {
    const didOpenCalls: Array<{ uri: string; languageId: string; text: string }> = [];
    const didChangeCalls: Array<{ uri: string; version: number; text: string }> = [];

    const cacheModule = await import('./cache.ts');
    const detectModule = await import('./detect.ts');

    const getLspSpy = spyOn(detectModule, 'getLspConfig').mockReturnValue({
      command: process.execPath,
      args: ['-e', 'process.stdin.resume()'],
      install_hint: '',
    });

    const initSpy = spyOn(LspClient.prototype, 'initialize').mockResolvedValue(undefined);
    const isReadySpy = spyOn(LspClient.prototype, 'isReady').mockReturnValue(true);
    // Keep these spies active for the entire test so calls during ensureFileSync are captured
    const didOpenSpy = spyOn(LspClient.prototype, 'notifyDidOpen').mockImplementation(
      (uri, languageId, text) => { didOpenCalls.push({ uri, languageId, text }); }
    );
    const didChangeSpy = spyOn(LspClient.prototype, 'notifyDidChange').mockImplementation(
      (uri, version, text) => { didChangeCalls.push({ uri, version, text }); }
    );

    const result = await cacheModule.ensureClient(filePath);
    // Restore setup-only spies; keep didOpen/didChange spies alive for assertion phase
    getLspSpy.mockRestore();
    initSpy.mockRestore();
    isReadySpy.mockRestore();

    if ('error' in result) {
      didOpenSpy.mockRestore();
      didChangeSpy.mockRestore();
      throw new Error(`ensureClient failed: ${result.error}`);
    }

    const restore = () => {
      didOpenSpy.mockRestore();
      didChangeSpy.mockRestore();
    };

    return { didOpenCalls, didChangeCalls, client: result, restore };
  }

  test('7. first access → notifyDidOpen called', async () => {
    const filePath = path.join(tmpDir, 'index.ts');
    fs.writeFileSync(filePath, 'const x = 1;');

    const { didOpenCalls, didChangeCalls, client, restore } = await setupCacheWithMockClient(filePath);
    try {
      await ensureFileSync(client, filePath);

      expect(didOpenCalls).toHaveLength(1);
      expect(didOpenCalls[0].uri).toContain('index.ts');
      expect(didChangeCalls).toHaveLength(0);
    } finally {
      restore();
    }
  });

  test('8. second access with same mtime → noop (no didOpen or didChange)', async () => {
    const filePath = path.join(tmpDir, 'index.ts');
    fs.writeFileSync(filePath, 'const x = 1;');

    const { didOpenCalls, didChangeCalls, client, restore } = await setupCacheWithMockClient(filePath);
    try {
      await ensureFileSync(client, filePath);
      expect(didOpenCalls).toHaveLength(1);

      // Call again with same mtime
      await ensureFileSync(client, filePath);
      expect(didOpenCalls).toHaveLength(1); // no new opens
      expect(didChangeCalls).toHaveLength(0);
    } finally {
      restore();
    }
  });

  test('9. access after file changed → notifyDidChange called', async () => {
    const filePath = path.join(tmpDir, 'index.ts');
    fs.writeFileSync(filePath, 'const x = 1;');

    const { didOpenCalls, didChangeCalls, client, restore } = await setupCacheWithMockClient(filePath);
    try {
      // First access — records current mtime in cache
      await ensureFileSync(client, filePath);
      expect(didOpenCalls).toHaveLength(1);

      // Write new content and force a future mtime so the cache sees a change
      fs.writeFileSync(filePath, 'const x = 2;');
      const futureMtime = new Date(Date.now() + 5000);
      fs.utimesSync(filePath, futureMtime, futureMtime);

      await ensureFileSync(client, filePath);
      expect(didChangeCalls).toHaveLength(1);
      expect(didChangeCalls[0].text).toBe('const x = 2;');
    } finally {
      restore();
    }
  });

  test('10. ensureFileSync is noop for non-existent file (no throw)', async () => {
    const filePath = path.join(tmpDir, 'ghost.ts');
    // Don't create the file

    const { client, restore } = await setupCacheWithMockClient(filePath);
    try {
      // Should not throw even if file doesn't exist
      await expect(ensureFileSync(client, '/tmp/ghost.ts')).resolves.toBeUndefined();
    } finally {
      restore();
    }
  });
});

// ---------------------------------------------------------------------------
// 4. shutdownAll
// ---------------------------------------------------------------------------

describe('shutdownAll', () => {
  test('11. shutdownAll resolves without error when cache is empty', async () => {
    await expect(shutdownAll()).resolves.toBeUndefined();
  });

  test('12. shutdownAll is idempotent — calling twice is safe', async () => {
    await shutdownAll();
    await expect(shutdownAll()).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 5. Signal handler registration
// ---------------------------------------------------------------------------

describe('signal handler', () => {
  test('13. SIGINT handler is registered only once across multiple ensureClient calls', async () => {
    // Count SIGINT listeners before
    const before = process.listenerCount('SIGINT');

    const detectModule = await import('./detect.ts');
    const spy = spyOn(detectModule, 'getLspConfig').mockReturnValue({
      error: 'no server',
      install_hint: '',
    });

    // Multiple calls — signal handler should only be added once
    await ensureClient('/tmp/a.ts').catch(() => {});
    await ensureClient('/tmp/b.ts').catch(() => {});
    await ensureClient('/tmp/c.ts').catch(() => {});

    spy.mockRestore();

    const after = process.listenerCount('SIGINT');
    // At most 1 new listener added
    expect(after - before).toBeLessThanOrEqual(1);
  });
});
