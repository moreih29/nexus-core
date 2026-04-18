import { spawn, ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
}

export class LspClient extends EventEmitter {
  private process: ChildProcess | null = null;
  private initialized = false;
  private requestId = 0;
  private pending = new Map<number, PendingRequest>();
  private buffer = '';
  private contentLength = -1;

  constructor(
    private command: string,
    private args: string[],
  ) {
    super();
  }

  async initialize(rootUri: string): Promise<void> {
    if (this.initialized) return;

    this.process = spawn(this.command, this.args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, NODE_OPTIONS: '' },
    });

    // Unref to avoid keeping the parent process alive
    this.process.unref();

    this.process.stdout!.on('data', (chunk: Buffer) => this.onData(chunk.toString()));
    this.process.on('error', (err: Error) => {
      // Reject all pending requests on spawn/IO error
      for (const [, { reject }] of this.pending) {
        reject(err);
      }
      this.pending.clear();
      this.initialized = false;
      this.process = null;
    });
    this.process.on('exit', () => {
      this.initialized = false;
      this.process = null;
      // Reject all pending requests
      for (const [, { reject }] of this.pending) {
        reject(new Error('LSP server exited'));
      }
      this.pending.clear();
    });

    await this.request('initialize', {
      processId: process.pid,
      capabilities: {
        textDocument: {
          hover: { contentFormat: ['plaintext', 'markdown'] },
          definition: {},
          references: {},
          publishDiagnostics: {},
        },
      },
      rootUri,
      workspaceFolders: [{ uri: rootUri, name: 'workspace' }],
    });

    this.notify('initialized', {});
    this.initialized = true;
  }

  async request(method: string, params: object): Promise<unknown> {
    if (!this.process && method !== 'initialize') {
      throw new Error('LSP server not running');
    }

    const id = ++this.requestId;
    const message = JSON.stringify({ jsonrpc: '2.0', id, method, params });
    this.send(message);

    const timeoutMs = method === 'initialize' ? 60000 : 30000;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`LSP request timeout: ${method}`));
        }
      }, timeoutMs);
    });
  }

  notify(method: string, params: object): void {
    const message = JSON.stringify({ jsonrpc: '2.0', method, params });
    this.send(message);
  }

  notifyDidOpen(uri: string, languageId: string, text: string): void {
    this.notify('textDocument/didOpen', {
      textDocument: { uri, languageId, version: 1, text },
    });
  }

  notifyDidChange(uri: string, version: number, text: string): void {
    this.notify('textDocument/didChange', {
      textDocument: { uri, version },
      contentChanges: [{ text }],
    });
  }

  on(event: string, handler: (params: unknown) => void): this {
    return super.on(event, handler);
  }

  removeListener(event: string, handler: (params: unknown) => void): this {
    return super.removeListener(event, handler);
  }

  isReady(): boolean {
    return this.initialized && this.process !== null;
  }

  async shutdown(): Promise<void> {
    if (!this.process) return;

    try {
      await this.request('shutdown', {});
      this.notify('exit', {});
    } catch {
      // Ignore errors during shutdown
    } finally {
      this.process?.kill();
      this.initialized = false;
      this.process = null;
    }
  }

  private send(message: string): void {
    const header = `Content-Length: ${Buffer.byteLength(message)}\r\n\r\n`;
    this.process?.stdin?.write(header + message);
  }

  private onData(data: string): void {
    this.buffer += data;

    while (true) {
      if (this.contentLength === -1) {
        const headerEnd = this.buffer.indexOf('\r\n\r\n');
        if (headerEnd === -1) return;

        const header = this.buffer.slice(0, headerEnd);
        const match = header.match(/Content-Length:\s*(\d+)/i);
        if (!match) {
          this.buffer = this.buffer.slice(headerEnd + 4);
          continue;
        }

        this.contentLength = parseInt(match[1], 10);
        this.buffer = this.buffer.slice(headerEnd + 4);
      }

      if (Buffer.byteLength(this.buffer) < this.contentLength) return;

      const body = this.buffer.slice(0, this.contentLength);
      this.buffer = this.buffer.slice(this.contentLength);
      this.contentLength = -1;

      try {
        const msg = JSON.parse(body) as {
          id?: number;
          method?: string;
          result?: unknown;
          error?: { message: string };
          params?: unknown;
        };
        if (msg.id !== undefined && this.pending.has(msg.id)) {
          const { resolve, reject } = this.pending.get(msg.id)!;
          this.pending.delete(msg.id);
          if (msg.error) {
            reject(new Error(msg.error.message));
          } else {
            resolve(msg.result);
          }
        } else if (msg.method) {
          this.emit(msg.method, msg.params);
        }
      } catch {
        // Ignore JSON parse failures
      }
    }
  }
}
