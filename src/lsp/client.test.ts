import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { LspClient } from './client.ts';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Wraps a JSON-RPC message in Content-Length framing */
function frame(msg: object): string {
  const body = JSON.stringify(msg);
  return `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`;
}

/** Minimal echo server: responds to initialize with a fixed result */
function startEchoServer(): { port: number; close: () => void } {
  // We can't easily intercept stdio, so we use a real child process for integration,
  // and instead use internal-method tests for unit coverage.
  throw new Error('Use internal tests instead');
}

// ---------------------------------------------------------------------------
// Internal parser unit tests via a test-only subclass
// ---------------------------------------------------------------------------

class TestableClient extends LspClient {
  public receivedMessages: unknown[] = [];

  constructor() {
    super('echo', []);
    // Intercept emitted events to capture server notifications
    this.on('testNotification', (params: unknown) => {
      this.receivedMessages.push(params);
    });
  }

  // Expose the internal onData method for testing
  public injectData(data: string): void {
    (this as unknown as { onData: (d: string) => void }).onData(data);
  }

  // Expose pending map for testing
  public getPending(): Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }> {
    return (this as unknown as { pending: Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }> }).pending;
  }

  // Expose buffer for testing
  public getBuffer(): string {
    return (this as unknown as { buffer: string }).buffer;
  }

  // Expose contentLength for testing
  public getContentLength(): number {
    return (this as unknown as { contentLength: number }).contentLength;
  }

  // Simulate having a live process so request() doesn't throw
  public fakeProcess(): void {
    (this as unknown as { process: unknown }).process = { stdin: { write: () => true }, kill: () => {} };
    (this as unknown as { initialized: boolean }).initialized = true;
  }
}

// ---------------------------------------------------------------------------
// 1. Content-Length parsing — single chunk
// ---------------------------------------------------------------------------

describe('Content-Length parsing', () => {
  test('1. parses a single complete message', () => {
    const client = new TestableClient();
    // Inject a response message that resolves pending id=1
    let resolvedValue: unknown = undefined;
    client.getPending().set(1, {
      resolve: (v) => { resolvedValue = v; },
      reject: () => {},
    });

    const msg = { jsonrpc: '2.0', id: 1, result: { ok: true } };
    client.injectData(frame(msg));

    expect(resolvedValue).toEqual({ ok: true });
    expect(client.getPending().size).toBe(0);
  });

  test('2. parses message split across multiple chunks', () => {
    const client = new TestableClient();
    let resolvedValue: unknown = undefined;
    client.getPending().set(1, {
      resolve: (v) => { resolvedValue = v; },
      reject: () => {},
    });

    const msg = { jsonrpc: '2.0', id: 1, result: { split: true } };
    const full = frame(msg);
    const mid = Math.floor(full.length / 2);

    // Deliver in two halves
    client.injectData(full.slice(0, mid));
    expect(resolvedValue).toBeUndefined(); // not yet resolved
    client.injectData(full.slice(mid));
    expect(resolvedValue).toEqual({ split: true });
  });

  test('3. parses two consecutive messages in one chunk', () => {
    const client = new TestableClient();
    const resolved: unknown[] = [];

    client.getPending().set(1, { resolve: (v) => resolved.push(v), reject: () => {} });
    client.getPending().set(2, { resolve: (v) => resolved.push(v), reject: () => {} });

    const msg1 = { jsonrpc: '2.0', id: 1, result: 'first' };
    const msg2 = { jsonrpc: '2.0', id: 2, result: 'second' };
    client.injectData(frame(msg1) + frame(msg2));

    expect(resolved).toEqual(['first', 'second']);
  });

  test('4. dispatches server notification (no id) as EventEmitter event', () => {
    const client = new TestableClient();
    const received: unknown[] = [];
    client.on('textDocument/publishDiagnostics', (params: unknown) => received.push(params));

    const notif = { jsonrpc: '2.0', method: 'textDocument/publishDiagnostics', params: { uri: 'file:///a.ts', diagnostics: [] } };
    client.injectData(frame(notif));

    expect(received).toHaveLength(1);
    expect((received[0] as { uri: string }).uri).toBe('file:///a.ts');
  });

  test('5. ignores malformed JSON without throwing', () => {
    const client = new TestableClient();
    // A framed body that is not valid JSON
    const badBody = 'NOT JSON';
    const badFrame = `Content-Length: ${Buffer.byteLength(badBody)}\r\n\r\n${badBody}`;
    expect(() => client.injectData(badFrame)).not.toThrow();
    expect(client.getBuffer()).toBe('');
  });

  test('6. rejects pending request when LSP returns error', () => {
    const client = new TestableClient();
    let rejectedError: Error | undefined;
    client.getPending().set(1, {
      resolve: () => {},
      reject: (e) => { rejectedError = e; },
    });

    const errorMsg = { jsonrpc: '2.0', id: 1, error: { code: -32700, message: 'Parse error' } };
    client.injectData(frame(errorMsg));

    expect(rejectedError).toBeDefined();
    expect(rejectedError!.message).toBe('Parse error');
  });
});

// ---------------------------------------------------------------------------
// 2. notify / notifyDidOpen / notifyDidChange
// ---------------------------------------------------------------------------

describe('notify methods', () => {
  test('7. notifyDidOpen sends correct textDocument/didOpen notification', () => {
    const client = new TestableClient();
    client.fakeProcess();
    const written: string[] = [];
    const fakeProcess = (client as unknown as { process: { stdin: { write: (s: string) => void }; kill: () => void } }).process;
    fakeProcess.stdin.write = (s: string) => { written.push(s); };

    client.notifyDidOpen('file:///a.ts', 'typescript', 'const x = 1;');

    expect(written).toHaveLength(1);
    const bodyStart = written[0].indexOf('\r\n\r\n') + 4;
    const parsed = JSON.parse(written[0].slice(bodyStart)) as {
      method: string;
      params: { textDocument: { uri: string; languageId: string; version: number; text: string } };
    };
    expect(parsed.method).toBe('textDocument/didOpen');
    expect(parsed.params.textDocument.uri).toBe('file:///a.ts');
    expect(parsed.params.textDocument.languageId).toBe('typescript');
    expect(parsed.params.textDocument.version).toBe(1);
    expect(parsed.params.textDocument.text).toBe('const x = 1;');
  });

  test('8. notifyDidChange sends full text replacement', () => {
    const client = new TestableClient();
    client.fakeProcess();
    const written: string[] = [];
    const fakeProcess = (client as unknown as { process: { stdin: { write: (s: string) => void }; kill: () => void } }).process;
    fakeProcess.stdin.write = (s: string) => { written.push(s); };

    client.notifyDidChange('file:///a.ts', 2, 'const x = 2;');

    expect(written).toHaveLength(1);
    const bodyStart = written[0].indexOf('\r\n\r\n') + 4;
    const parsed = JSON.parse(written[0].slice(bodyStart)) as {
      method: string;
      params: { textDocument: { uri: string; version: number }; contentChanges: Array<{ text: string }> };
    };
    expect(parsed.method).toBe('textDocument/didChange');
    expect(parsed.params.textDocument.version).toBe(2);
    expect(parsed.params.contentChanges[0].text).toBe('const x = 2;');
  });
});

// ---------------------------------------------------------------------------
// 3. isReady / shutdown idempotency
// ---------------------------------------------------------------------------

describe('isReady and shutdown', () => {
  test('9. isReady returns false before initialize', () => {
    const client = new LspClient('echo', []);
    expect(client.isReady()).toBe(false);
  });

  test('10. shutdown is idempotent — calling twice does not throw', async () => {
    const client = new LspClient('echo', []);
    await expect(client.shutdown()).resolves.toBeUndefined();
    await expect(client.shutdown()).resolves.toBeUndefined();
  });

  test('11. on/removeListener work without error', () => {
    const client = new LspClient('echo', []);
    const handler = (_p: unknown) => {};
    client.on('someEvent', handler);
    expect(() => client.removeListener('someEvent', handler)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// 4. Integration test with a real child process (echo-based mock server)
// ---------------------------------------------------------------------------

describe('LspClient integration (mock server via node script)', () => {
  test('12. initialize + request roundtrip with a mock LSP server', async () => {
    // Write a minimal Node script that acts as an LSP server
    const serverScript = `
process.stdin.setEncoding('utf-8');
let buf = '';
process.stdin.on('data', (chunk) => {
  buf += chunk;
  while (true) {
    const hEnd = buf.indexOf('\\r\\n\\r\\n');
    if (hEnd === -1) break;
    const header = buf.slice(0, hEnd);
    const match = header.match(/Content-Length:\\s*(\\d+)/i);
    if (!match) { buf = buf.slice(hEnd + 4); continue; }
    const len = parseInt(match[1], 10);
    if (Buffer.byteLength(buf.slice(hEnd + 4)) < len) break;
    const body = buf.slice(hEnd + 4, hEnd + 4 + len);
    buf = buf.slice(hEnd + 4 + len);
    const msg = JSON.parse(body);
    if (msg.method === 'initialize') {
      const resp = JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { capabilities: {} } });
      process.stdout.write('Content-Length: ' + Buffer.byteLength(resp) + '\\r\\n\\r\\n' + resp);
    } else if (msg.method === 'shutdown') {
      const resp = JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: null });
      process.stdout.write('Content-Length: ' + Buffer.byteLength(resp) + '\\r\\n\\r\\n' + resp);
    }
  }
});
`;
    // Write the script to a temp file
    const path = await import('node:path');
    const fs = await import('node:fs');
    const { makeTempDir } = await import('../shared/test-temp.ts');
    const tmpDir = makeTempDir('lsp-test-');
    const scriptPath = path.join(tmpDir, 'mock-server.js');
    fs.writeFileSync(scriptPath, serverScript, 'utf-8');

    const client = new LspClient(process.execPath, [scriptPath]);
    try {
      await client.initialize('file:///tmp/workspace');
      expect(client.isReady()).toBe(true);
    } finally {
      await client.shutdown();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  }, 15000);
});
