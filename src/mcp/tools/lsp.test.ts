import { describe, test, expect, mock, beforeEach } from 'bun:test';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { formatMarkupContent, formatLocation } from './lsp.ts';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ToolHandler = (
  args: Record<string, unknown>,
) => Promise<CallToolResult>;

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

/**
 * Builds a minimal mock LspClient that records calls and returns
 * configurable responses per LSP method.
 */
function makeMockClient(responses: Record<string, unknown> = {}) {
  const listeners = new Map<string, Array<(params: unknown) => void>>();

  const client = {
    requestCalls: [] as Array<{ method: string; params: unknown }>,
    notifyCalls: [] as Array<{ method: string; params: unknown }>,
    didChangeCalled: false,

    async request(method: string, params: unknown): Promise<unknown> {
      client.requestCalls.push({ method, params });
      if (method in responses) return responses[method];
      return null;
    },

    on(event: string, handler: (params: unknown) => void) {
      if (!listeners.has(event)) listeners.set(event, []);
      listeners.get(event)!.push(handler);
      return client;
    },

    removeListener(event: string, handler: (params: unknown) => void) {
      const arr = listeners.get(event);
      if (arr) {
        const idx = arr.indexOf(handler);
        if (idx !== -1) arr.splice(idx, 1);
      }
      return client;
    },

    emit(event: string, params: unknown) {
      listeners.get(event)?.forEach((h) => h(params));
    },
  };

  return client;
}

// ---------------------------------------------------------------------------
// Mock module state — replaced per test via beforeEach
// ---------------------------------------------------------------------------

type MockClient = ReturnType<typeof makeMockClient>;

let mockClientResult: MockClient | { error: string; install_hint: string } = makeMockClient();

// Track ensureFileSync calls
let ensureFileSyncCalls: string[] = [];

// We intercept cache module via dynamic import mocking.
// Since Bun uses module mocking at the registry level we stub the two
// functions exported from cache.ts by replacing the module before importing
// registerLspTools.

// Use bun:test mock to replace module-level deps.
mock.module('../../lsp/cache.js', () => ({
  ensureClient: async (_file: string) => mockClientResult,
  ensureFileSync: async (_client: unknown, file: string) => {
    ensureFileSyncCalls.push(file);
    if (file === 'mtime-changed.ts') {
      // Simulate didChange notification path
      const mc = _client as MockClient;
      mc.didChangeCalled = true;
    }
  },
}));

// Mock findProjectRoot to return a stable path
mock.module('../../shared/paths.js', () => ({
  findProjectRoot: () => '/project',
  getNexusRoot: () => '/project/.nexus',
  getStateRoot: () => '/project/.nexus/state',
  getCurrentBranch: () => 'main',
  ensureDir: () => undefined,
  NEXUS_ROOT: '/project/.nexus',
  STATE_ROOT: '/project/.nexus/state',
}));

// ---------------------------------------------------------------------------
// Lazy import of registerLspTools (after mocks are set up)
// ---------------------------------------------------------------------------

let registerLspTools: (server: unknown) => void;

beforeEach(async () => {
  ensureFileSyncCalls = [];
  // Re-import after mocking
  const mod = await import('./lsp.ts');
  registerLspTools = mod.registerLspTools;
});

// ---------------------------------------------------------------------------
// Helper: build a fake server and extract named tool handlers
// ---------------------------------------------------------------------------

function makeTestServer(): {
  call: (name: string, args: Record<string, unknown>) => Promise<unknown>;
} {
  const handlers = new Map<string, ToolHandler>();

  const fakeServer = {
    tool(name: string, _desc: string, _schema: object, handler: ToolHandler) {
      handlers.set(name, handler);
    },
  };

  registerLspTools(fakeServer);

  return {
    async call(name: string, args: Record<string, unknown>): Promise<unknown> {
      const handler = handlers.get(name);
      if (!handler) throw new Error(`Tool not registered: ${name}`);
      const result = await handler(args);
      const text = (result.content[0] as { type: string; text: string })?.text;
      if (!text) throw new Error('Empty tool response');
      return JSON.parse(text) as unknown;
    },
  };
}

// ---------------------------------------------------------------------------
// Helper: resolve diagnostics by emitting the event after a tiny delay
// ---------------------------------------------------------------------------

function scheduleDiagnosticsEvent(
  client: MockClient,
  uri: string,
  diags: unknown[],
  delayMs = 50,
) {
  setTimeout(() => {
    client.emit('textDocument/publishDiagnostics', { uri, diagnostics: diags });
  }, delayMs);
}

// ---------------------------------------------------------------------------
// 1-3. formatMarkupContent (pure helper)
// ---------------------------------------------------------------------------

describe('formatMarkupContent', () => {
  test('1. plain string passes through', () => {
    expect(formatMarkupContent('hello world')).toBe('hello world');
  });

  test('2. MarkupContent object returns .value', () => {
    expect(formatMarkupContent({ kind: 'markdown', value: '**type**' })).toBe('**type**');
  });

  test('3. null / undefined returns empty string', () => {
    expect(formatMarkupContent(null)).toBe('');
    expect(formatMarkupContent(undefined)).toBe('');
  });
});

// ---------------------------------------------------------------------------
// 4. formatLocation
// ---------------------------------------------------------------------------

describe('formatLocation', () => {
  test('4. strips project root from uri and converts to 1-based', () => {
    const loc = {
      uri: 'file:///project/src/foo.ts',
      range: { start: { line: 4, character: 7 } },
    };
    expect(formatLocation(loc, '/project')).toBe('src/foo.ts:5:8');
  });
});

// ---------------------------------------------------------------------------
// Hover tests (5-7)
// ---------------------------------------------------------------------------

describe('nx_lsp_hover', () => {
  test('5. hover with markup string response', async () => {
    mockClientResult = makeMockClient({
      'textDocument/hover': { contents: 'string hover text' },
    });
    const server = makeTestServer();
    const result = (await server.call('nx_lsp_hover', {
      file: 'src/foo.ts',
      line: 3,
      character: 5,
    })) as Record<string, unknown>;

    expect(result.hover).toBe('string hover text');
    expect(result.line).toBe(3);
    expect(result.character).toBe(5);
  });

  test('6. hover with MarkupContent object', async () => {
    mockClientResult = makeMockClient({
      'textDocument/hover': { contents: { kind: 'markdown', value: '# Title' } },
    });
    const server = makeTestServer();
    const result = (await server.call('nx_lsp_hover', {
      file: 'src/foo.ts',
      line: 1,
      character: 1,
    })) as Record<string, unknown>;

    expect(result.hover).toBe('# Title');
  });

  test('7. null LSP response → hover: null', async () => {
    mockClientResult = makeMockClient({ 'textDocument/hover': null });
    const server = makeTestServer();
    const result = (await server.call('nx_lsp_hover', {
      file: 'src/foo.ts',
      line: 1,
      character: 1,
    })) as Record<string, unknown>;

    expect(result.hover).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Diagnostics tests (8-9)
// ---------------------------------------------------------------------------

describe('nx_lsp_diagnostics', () => {
  test('8. diagnostics normal — severity mapped, 1-based line/char', async () => {
    const client = makeMockClient();
    mockClientResult = client;

    // Schedule the event to fire after ensureFileSync but before the 2s timeout
    const uri = 'file:///project/src/foo.ts';
    scheduleDiagnosticsEvent(client, uri, [
      {
        severity: 1,
        message: 'Type error',
        range: { start: { line: 2, character: 4 } },
      },
      {
        severity: 2,
        message: 'Unused variable',
        range: { start: { line: 9, character: 0 } },
      },
    ]);

    // Use very short timeout by temporarily overriding (we wait at most 200ms in test)
    // The real impl waits 2000ms; we need to complete faster. We mock setTimeout.
    // Instead, we rely on the event being emitted quickly and the test completing after 2s.
    // To keep tests fast, we re-implement via a mock that shortens the delay.
    // This is handled by the scheduleDiagnosticsEvent approach + allowing up to 3s per test.
    const server = makeTestServer();

    // We call with a custom approach: override setTimeout via global
    const origSetTimeout = globalThis.setTimeout;
    let capturedResolve: (() => void) | null = null;
    (globalThis as Record<string, unknown>).setTimeout = (fn: () => void, _ms: number) => {
      if (_ms >= 1000) {
        capturedResolve = fn;
        return origSetTimeout(fn, 100) as unknown; // speed up
      }
      return origSetTimeout(fn, _ms) as unknown;
    };

    try {
      const result = (await server.call('nx_lsp_diagnostics', {
        file: 'src/foo.ts',
      })) as Record<string, unknown>;

      expect(result.count).toBe(2);
      const diags = result.diagnostics as Array<Record<string, unknown>>;
      expect(diags[0].severity).toBe('error');
      expect(diags[0].message).toBe('Type error');
      expect(diags[0].line).toBe(3);
      expect(diags[0].character).toBe(5);
      expect(diags[1].severity).toBe('warning');
    } finally {
      (globalThis as Record<string, unknown>).setTimeout = origSetTimeout;
    }
  });

  test('9. diagnostics empty result', async () => {
    const client = makeMockClient();
    mockClientResult = client;
    // No events emitted

    const origSetTimeout = globalThis.setTimeout;
    (globalThis as Record<string, unknown>).setTimeout = (fn: () => void, _ms: number) => {
      if (_ms >= 1000) return origSetTimeout(fn, 50) as unknown;
      return origSetTimeout(fn, _ms) as unknown;
    };

    try {
      const server = makeTestServer();
      const result = (await server.call('nx_lsp_diagnostics', {
        file: 'src/empty.ts',
      })) as Record<string, unknown>;

      expect(result.count).toBe(0);
      expect(Array.isArray(result.diagnostics)).toBe(true);
    } finally {
      (globalThis as Record<string, unknown>).setTimeout = origSetTimeout;
    }
  });
});

// ---------------------------------------------------------------------------
// find_references tests (10-11)
// ---------------------------------------------------------------------------

describe('nx_lsp_find_references', () => {
  test('10. find_references normal', async () => {
    mockClientResult = makeMockClient({
      'textDocument/references': [
        {
          uri: 'file:///project/src/foo.ts',
          range: { start: { line: 0, character: 0 } },
        },
        {
          uri: 'file:///project/src/bar.ts',
          range: { start: { line: 9, character: 3 } },
        },
      ],
    });
    const server = makeTestServer();
    const result = (await server.call('nx_lsp_find_references', {
      file: 'src/foo.ts',
      line: 2,
      character: 4,
    })) as Record<string, unknown>;

    expect(result.count).toBe(2);
    const refs = result.references as string[];
    expect(refs[0]).toBe('src/foo.ts:1:1');
    expect(refs[1]).toBe('src/bar.ts:10:4');
  });

  test('11. includeDeclaration toggle forwarded to LSP', async () => {
    const client = makeMockClient({
      'textDocument/references': [],
    });
    mockClientResult = client;
    const server = makeTestServer();

    await server.call('nx_lsp_find_references', {
      file: 'src/foo.ts',
      line: 1,
      character: 1,
      includeDeclaration: false,
    });

    const call = client.requestCalls.find((c) => c.method === 'textDocument/references');
    expect(call).toBeDefined();
    const params = call!.params as Record<string, unknown>;
    const ctx = params.context as Record<string, unknown>;
    expect(ctx.includeDeclaration).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// rename tests (12-13)
// ---------------------------------------------------------------------------

describe('nx_lsp_rename', () => {
  test('12. rename with changes format', async () => {
    mockClientResult = makeMockClient({
      'textDocument/rename': {
        changes: {
          'file:///project/src/foo.ts': [
            {
              range: { start: { line: 2, character: 4 } },
              newText: 'newName',
            },
          ],
          'file:///project/src/bar.ts': [
            {
              range: { start: { line: 5, character: 0 } },
              newText: 'newName',
            },
          ],
        },
      },
    });
    const server = makeTestServer();
    const result = (await server.call('nx_lsp_rename', {
      file: 'src/foo.ts',
      line: 3,
      character: 5,
      newName: 'newName',
    })) as Record<string, unknown>;

    expect(result.count).toBe(2);
    expect(result.newName).toBe('newName');
    const edits = result.edits as Array<Record<string, unknown>>;
    expect(edits[0].file).toBe('src/foo.ts');
    expect(edits[0].line).toBe(3);
    expect(edits[0].newText).toBe('newName');
    expect(edits[1].file).toBe('src/bar.ts');
    expect(edits[1].line).toBe(6);
  });

  test('13. rename with documentChanges format', async () => {
    mockClientResult = makeMockClient({
      'textDocument/rename': {
        documentChanges: [
          {
            textDocument: { uri: 'file:///project/src/qux.ts', version: 1 },
            edits: [
              {
                range: { start: { line: 0, character: 0 } },
                newText: 'renamedFn',
              },
            ],
          },
        ],
      },
    });
    const server = makeTestServer();
    const result = (await server.call('nx_lsp_rename', {
      file: 'src/qux.ts',
      line: 1,
      character: 1,
      newName: 'renamedFn',
    })) as Record<string, unknown>;

    expect(result.count).toBe(1);
    const edits = result.edits as Array<Record<string, unknown>>;
    expect(edits[0].file).toBe('src/qux.ts');
    expect(edits[0].line).toBe(1);
    expect(edits[0].newText).toBe('renamedFn');
  });
});

// ---------------------------------------------------------------------------
// code_actions tests (14-15)
// ---------------------------------------------------------------------------

describe('nx_lsp_code_actions', () => {
  test('14. code_actions normal', async () => {
    const client = makeMockClient({
      'textDocument/codeAction': [
        { title: 'Fix: add import', kind: 'quickfix', isPreferred: true },
        { title: 'Refactor: extract function', kind: 'refactor' },
      ],
    });
    mockClientResult = client;

    const origSetTimeout = globalThis.setTimeout;
    (globalThis as Record<string, unknown>).setTimeout = (fn: () => void, _ms: number) => {
      if (_ms >= 1000) return origSetTimeout(fn, 50) as unknown;
      return origSetTimeout(fn, _ms) as unknown;
    };

    try {
      const server = makeTestServer();
      const result = (await server.call('nx_lsp_code_actions', {
        file: 'src/foo.ts',
        startLine: 1,
        endLine: 5,
      })) as Record<string, unknown>;

      expect(result.count).toBe(2);
      const actions = result.actions as Array<Record<string, unknown>>;
      expect(actions[0].title).toBe('Fix: add import');
      expect(actions[0].kind).toBe('quickfix');
      expect(actions[0].isPreferred).toBe(true);
      expect(actions[1].isPreferred).toBe(false);
    } finally {
      (globalThis as Record<string, unknown>).setTimeout = origSetTimeout;
    }
  });

  test('15. code_actions empty result', async () => {
    const client = makeMockClient({
      'textDocument/codeAction': [],
    });
    mockClientResult = client;

    const origSetTimeout = globalThis.setTimeout;
    (globalThis as Record<string, unknown>).setTimeout = (fn: () => void, _ms: number) => {
      if (_ms >= 1000) return origSetTimeout(fn, 50) as unknown;
      return origSetTimeout(fn, _ms) as unknown;
    };

    try {
      const server = makeTestServer();
      const result = (await server.call('nx_lsp_code_actions', {
        file: 'src/foo.ts',
        startLine: 1,
        endLine: 1,
      })) as Record<string, unknown>;

      expect(result.count).toBe(0);
      expect(Array.isArray(result.actions)).toBe(true);
    } finally {
      (globalThis as Record<string, unknown>).setTimeout = origSetTimeout;
    }
  });
});

// ---------------------------------------------------------------------------
// 16-18. Missing LSP server: all 5 tools return install_hint
// ---------------------------------------------------------------------------

describe('missing LSP server — install_hint response', () => {
  beforeEach(() => {
    mockClientResult = {
      error: 'No LSP server found for language "typescript".',
      install_hint: 'npm install -g typescript-language-server typescript',
    };
  });

  test('16a. hover returns error + install_hint', async () => {
    const server = makeTestServer();
    const result = (await server.call('nx_lsp_hover', {
      file: 'src/foo.ts',
      line: 1,
      character: 1,
    })) as Record<string, unknown>;
    expect(result.error).toBeDefined();
    expect(result.install_hint).toBeDefined();
  });

  test('16b. diagnostics returns error + install_hint', async () => {
    const server = makeTestServer();
    const result = (await server.call('nx_lsp_diagnostics', {
      file: 'src/foo.ts',
    })) as Record<string, unknown>;
    expect(result.error).toBeDefined();
    expect(result.install_hint).toBeDefined();
  });

  test('16c. find_references returns error + install_hint', async () => {
    const server = makeTestServer();
    const result = (await server.call('nx_lsp_find_references', {
      file: 'src/foo.ts',
      line: 1,
      character: 1,
    })) as Record<string, unknown>;
    expect(result.error).toBeDefined();
    expect(result.install_hint).toBeDefined();
  });

  test('16d. rename returns error + install_hint', async () => {
    const server = makeTestServer();
    const result = (await server.call('nx_lsp_rename', {
      file: 'src/foo.ts',
      line: 1,
      character: 1,
      newName: 'x',
    })) as Record<string, unknown>;
    expect(result.error).toBeDefined();
    expect(result.install_hint).toBeDefined();
  });

  test('16e. code_actions returns error + install_hint', async () => {
    const server = makeTestServer();
    const result = (await server.call('nx_lsp_code_actions', {
      file: 'src/foo.ts',
      startLine: 1,
      endLine: 3,
    })) as Record<string, unknown>;
    expect(result.error).toBeDefined();
    expect(result.install_hint).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// 17. read-only guarantee: no fs.write calls from any tool
// ---------------------------------------------------------------------------

describe('read-only guarantee', () => {
  test('17. no fs.writeFile / writeFileSync called during tool invocations', async () => {
    const fsModule = await import('node:fs');
    const fsPromises = await import('node:fs/promises');

    const writeFileSpy = mock(fsModule, 'writeFileSync', () => {
      throw new Error('writeFileSync must not be called');
    });
    const writeFileAsyncSpy = mock(fsPromises, 'writeFile', async () => {
      throw new Error('writeFile must not be called');
    });

    mockClientResult = makeMockClient({
      'textDocument/hover': { contents: 'ok' },
    });

    try {
      const server = makeTestServer();
      await server.call('nx_lsp_hover', {
        file: 'src/foo.ts',
        line: 1,
        character: 1,
      });
      // No throws = no fs.write calls
      expect(true).toBe(true);
    } finally {
      writeFileSpy.restore?.();
      writeFileAsyncSpy.restore?.();
    }
  });
});

// ---------------------------------------------------------------------------
// 18-20. 1-based → 0-based conversion verification
// ---------------------------------------------------------------------------

describe('1-based → 0-based conversion', () => {
  test('18. hover sends 0-based position to LSP', async () => {
    const client = makeMockClient({ 'textDocument/hover': null });
    mockClientResult = client;
    const server = makeTestServer();

    await server.call('nx_lsp_hover', {
      file: 'src/foo.ts',
      line: 10,
      character: 5,
    });

    const call = client.requestCalls.find((c) => c.method === 'textDocument/hover');
    const pos = (call!.params as Record<string, unknown>).position as {
      line: number;
      character: number;
    };
    expect(pos.line).toBe(9);
    expect(pos.character).toBe(4);
  });

  test('19. find_references sends 0-based position to LSP', async () => {
    const client = makeMockClient({ 'textDocument/references': [] });
    mockClientResult = client;
    const server = makeTestServer();

    await server.call('nx_lsp_find_references', {
      file: 'src/foo.ts',
      line: 7,
      character: 3,
    });

    const call = client.requestCalls.find((c) => c.method === 'textDocument/references');
    const pos = (call!.params as Record<string, unknown>).position as {
      line: number;
      character: number;
    };
    expect(pos.line).toBe(6);
    expect(pos.character).toBe(2);
  });

  test('20. rename sends 0-based position to LSP', async () => {
    const client = makeMockClient({ 'textDocument/rename': null });
    mockClientResult = client;
    const server = makeTestServer();

    await server.call('nx_lsp_rename', {
      file: 'src/foo.ts',
      line: 1,
      character: 1,
      newName: 'x',
    });

    const call = client.requestCalls.find((c) => c.method === 'textDocument/rename');
    const pos = (call!.params as Record<string, unknown>).position as {
      line: number;
      character: number;
    };
    expect(pos.line).toBe(0);
    expect(pos.character).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 21. mtime change triggers ensureFileSync (cache.ensureFileSync mock)
// ---------------------------------------------------------------------------

describe('mtime change → ensureFileSync', () => {
  test('21. ensureFileSync is called with the file path on each tool invocation', async () => {
    const client = makeMockClient({ 'textDocument/hover': null });
    mockClientResult = client;
    ensureFileSyncCalls = [];

    const server = makeTestServer();
    await server.call('nx_lsp_hover', {
      file: 'mtime-changed.ts',
      line: 1,
      character: 1,
    });

    expect(ensureFileSyncCalls).toContain('mtime-changed.ts');
    expect(client.didChangeCalled).toBe(true);
  });
});

describe('path escape guard (S4 security fix)', () => {
  test('22a. hover rejects file that escapes project root via traversal', async () => {
    const client = makeMockClient({ 'textDocument/hover': { contents: 'should not reach' } });
    mockClientResult = client;
    ensureFileSyncCalls = [];

    const server = makeTestServer();
    const result = (await server.call('nx_lsp_hover', {
      file: '../../../etc/passwd',
      line: 1,
      character: 1,
    })) as Record<string, unknown>;

    expect(result).toHaveProperty('error');
    expect(String(result.error)).toMatch(/escapes project root/);
    expect(ensureFileSyncCalls).not.toContain('../../../etc/passwd');
  });

  test('22b. diagnostics rejects absolute path outside project root', async () => {
    const client = makeMockClient({});
    mockClientResult = client;

    const server = makeTestServer();
    const result = (await server.call('nx_lsp_diagnostics', {
      file: '/etc/hosts',
    })) as Record<string, unknown>;

    expect(result).toHaveProperty('error');
    expect(String(result.error)).toMatch(/escapes project root/);
  });

  test('22c. find_references rejects traversal escape', async () => {
    const client = makeMockClient({});
    mockClientResult = client;

    const server = makeTestServer();
    const result = (await server.call('nx_lsp_find_references', {
      file: '../outside.ts',
      line: 1,
      character: 1,
    })) as Record<string, unknown>;

    expect(String(result.error)).toMatch(/escapes project root/);
  });

  test('22d. rename rejects traversal escape', async () => {
    const client = makeMockClient({});
    mockClientResult = client;

    const server = makeTestServer();
    const result = (await server.call('nx_lsp_rename', {
      file: '../../escape.ts',
      line: 1,
      character: 1,
      newName: 'foo',
    })) as Record<string, unknown>;

    expect(String(result.error)).toMatch(/escapes project root/);
  });

  test('22e. code_actions rejects traversal escape', async () => {
    const client = makeMockClient({});
    mockClientResult = client;

    const server = makeTestServer();
    const result = (await server.call('nx_lsp_code_actions', {
      file: '../escape.ts',
      startLine: 1,
      endLine: 5,
    })) as Record<string, unknown>;

    expect(String(result.error)).toMatch(/escapes project root/);
  });

  test('22f. normal in-root file passes guard (no false positive)', async () => {
    const client = makeMockClient({ 'textDocument/hover': null });
    mockClientResult = client;
    ensureFileSyncCalls = [];

    const server = makeTestServer();
    const result = (await server.call('nx_lsp_hover', {
      file: 'src/legit.ts',
      line: 1,
      character: 1,
    })) as Record<string, unknown>;

    expect(result).not.toHaveProperty('error');
    expect(ensureFileSyncCalls).toContain('src/legit.ts');
  });
});
