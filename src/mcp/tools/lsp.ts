import { z } from 'zod';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { LspClient } from '../../lsp/client.js';
import { ensureClient, ensureFileSync } from '../../lsp/cache.js';
import { findProjectRoot } from '../../shared/paths.js';
import { textResult } from '../../shared/mcp-utils.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function formatMarkupContent(content: unknown): string {
  if (!content) return '';
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map(formatMarkupContent).filter(Boolean).join('\n\n');
  }
  if (typeof content === 'object' && content !== null) {
    const obj = content as Record<string, unknown>;
    if (obj.value !== undefined) return String(obj.value);
    if (obj.contents !== undefined) return formatMarkupContent(obj.contents);
  }
  return JSON.stringify(content);
}

export function formatLocation(
  loc: { uri?: string; range?: { start: { line: number; character: number } } },
  projectRoot: string,
): string {
  const rootUri = pathToFileURL(projectRoot).href;
  const file = loc.uri
    ? loc.uri.startsWith(rootUri + '/')
      ? loc.uri.slice(rootUri.length + 1)
      : loc.uri
    : 'unknown';
  const line = (loc.range?.start.line ?? 0) + 1;
  const col = (loc.range?.start.character ?? 0) + 1;
  return `${file}:${line}:${col}`;
}

// ---------------------------------------------------------------------------
// withClient — shared error-handling wrapper
// ---------------------------------------------------------------------------

async function withClient(
  file: string,
  op: (client: LspClient, uri: string) => Promise<unknown>,
): Promise<ReturnType<typeof textResult>> {
  const result = await ensureClient(file);
  if ('error' in result) {
    return textResult(result);
  }
  const client = result;
  await ensureFileSync(client, file);
  const root = findProjectRoot();
  const uri = pathToFileURL(resolve(root, file)).href;
  try {
    return textResult(await op(client, uri));
  } catch (err) {
    return textResult({ error: String(err) });
  }
}

// ---------------------------------------------------------------------------
// Tool registration
// ---------------------------------------------------------------------------

export function registerLspTools(server: McpServer): void {
  // 1. nx_lsp_hover
  server.tool(
    'nx_lsp_hover',
    'Get type information for a symbol at a specific position',
    {
      file: z.string().describe('File path (relative to project root)'),
      line: z.coerce.number().describe('Line number (1-based)'),
      character: z.coerce.number().describe('Column number (1-based)'),
    },
    async ({ file, line, character }) => {
      return withClient(file, async (client, uri) => {
        const result = (await client.request('textDocument/hover', {
          textDocument: { uri },
          position: { line: line - 1, character: character - 1 },
        })) as { contents?: unknown } | null;

        if (!result) {
          return { hover: null, file, line, character };
        }
        return { hover: formatMarkupContent(result.contents), file, line, character };
      });
    },
  );

  // 2. nx_lsp_diagnostics
  server.tool(
    'nx_lsp_diagnostics',
    'Get compiler/linter errors and warnings for a file',
    {
      file: z.string().describe('File path (relative to project root)'),
    },
    async ({ file }) => {
      return withClient(file, async (client, uri) => {
        const diagnostics: Array<{
          severity: number;
          message: string;
          range?: { start: { line: number; character: number } };
        }> = [];

        const handler = (params: unknown) => {
          const p = params as { uri: string; diagnostics: typeof diagnostics };
          if (p.uri === uri) {
            diagnostics.push(...p.diagnostics);
          }
        };

        client.on('textDocument/publishDiagnostics', handler);
        await new Promise<void>((r) => setTimeout(r, 2000));
        client.removeListener('textDocument/publishDiagnostics', handler);

        const severityMap: Record<number, string> = {
          1: 'error',
          2: 'warning',
          3: 'info',
          4: 'hint',
        };
        const formatted = diagnostics.map((d) => ({
          severity: severityMap[d.severity] ?? 'unknown',
          message: d.message,
          line: (d.range?.start?.line ?? 0) + 1,
          character: (d.range?.start?.character ?? 0) + 1,
        }));

        return { diagnostics: formatted, count: formatted.length, file };
      });
    },
  );

  // 3. nx_lsp_find_references
  server.tool(
    'nx_lsp_find_references',
    'Find all references to a symbol',
    {
      file: z.string().describe('File path (relative to project root)'),
      line: z.coerce.number().describe('Line number (1-based)'),
      character: z.coerce.number().describe('Column number (1-based)'),
      includeDeclaration: z.boolean().optional().describe('Include the declaration itself (default: true)'),
    },
    async ({ file, line, character, includeDeclaration }) => {
      return withClient(file, async (client, uri) => {
        const result = await client.request('textDocument/references', {
          textDocument: { uri },
          position: { line: line - 1, character: character - 1 },
          context: { includeDeclaration: includeDeclaration ?? true },
        });

        const root = findProjectRoot();
        const locations = Array.isArray(result) ? result : [];
        const formatted = locations.map(
          (loc: { uri?: string; range?: { start: { line: number; character: number } } }) =>
            formatLocation(loc, root),
        );

        return { references: formatted, count: formatted.length, file, line, character };
      });
    },
  );

  // 4. nx_lsp_rename
  server.tool(
    'nx_lsp_rename',
    'Rename a symbol across the project (returns list of edits to apply, does not modify files)',
    {
      file: z.string().describe('File path (relative to project root)'),
      line: z.coerce.number().describe('Line number (1-based)'),
      character: z.coerce.number().describe('Column number (1-based)'),
      newName: z.string().describe('New name for the symbol'),
    },
    async ({ file, line, character, newName }) => {
      return withClient(file, async (client, uri) => {
        const result = (await client.request('textDocument/rename', {
          textDocument: { uri },
          position: { line: line - 1, character: character - 1 },
          newName,
        })) as {
          changes?: Record<string, Array<{ range?: { start?: { line?: number } }; newText: string }>>;
          documentChanges?: Array<{
            textDocument?: { uri: string };
            edits?: Array<{ range?: { start?: { line?: number } }; newText: string }>;
          }>;
        } | null;

        if (!result) {
          return { error: 'Rename not supported at this position' };
        }

        const root = findProjectRoot();
        const rootUri = pathToFileURL(root).href;
        const edits: Array<{ file: string; line: number; newText: string }> = [];

        if (result.changes) {
          for (const [fileUri, changes] of Object.entries(result.changes)) {
            const relFile = fileUri.startsWith(rootUri + '/')
              ? fileUri.slice(rootUri.length + 1)
              : fileUri;
            for (const change of changes) {
              edits.push({
                file: relFile,
                line: (change.range?.start?.line ?? 0) + 1,
                newText: change.newText,
              });
            }
          }
        }

        if (result.documentChanges) {
          for (const dc of result.documentChanges) {
            if (dc.textDocument && dc.edits) {
              const fileUri = dc.textDocument.uri;
              const relFile = fileUri.startsWith(rootUri + '/')
                ? fileUri.slice(rootUri.length + 1)
                : fileUri;
              for (const edit of dc.edits) {
                edits.push({
                  file: relFile,
                  line: (edit.range?.start?.line ?? 0) + 1,
                  newText: edit.newText,
                });
              }
            }
          }
        }

        return { edits, count: edits.length, newName };
      });
    },
  );

  // 5. nx_lsp_code_actions
  server.tool(
    'nx_lsp_code_actions',
    'Get suggested fixes and refactoring actions for a code range',
    {
      file: z.string().describe('File path (relative to project root)'),
      startLine: z.coerce.number().describe('Start line number (1-based)'),
      endLine: z.coerce.number().describe('End line number (1-based)'),
    },
    async ({ file, startLine, endLine }) => {
      return withClient(file, async (client, uri) => {
        // Collect diagnostics for the range
        const diagnostics: Array<{
          severity?: number;
          message: string;
          range?: { start?: { line?: number; character?: number } };
        }> = [];

        const handler = (params: unknown) => {
          const p = params as {
            uri: string;
            diagnostics: typeof diagnostics;
          };
          if (p.uri === uri) diagnostics.push(...p.diagnostics);
        };

        client.on('textDocument/publishDiagnostics', handler);
        await new Promise<void>((r) => setTimeout(r, 2000));
        client.removeListener('textDocument/publishDiagnostics', handler);

        // Filter diagnostics within the requested range
        const rangeDiags = diagnostics.filter((d) => {
          const line = d.range?.start?.line ?? 0;
          return line >= startLine - 1 && line <= endLine - 1;
        });

        const result = await client.request('textDocument/codeAction', {
          textDocument: { uri },
          range: {
            start: { line: startLine - 1, character: 0 },
            end: { line: endLine - 1, character: 999 },
          },
          context: { diagnostics: rangeDiags },
        });

        const actions = Array.isArray(result) ? result : [];
        const formatted = actions.map(
          (a: { title: string; kind?: string; isPreferred?: boolean }) => ({
            title: a.title,
            kind: a.kind ?? 'unknown',
            isPreferred: a.isPreferred ?? false,
          }),
        );

        return { actions: formatted, count: formatted.length, file, startLine, endLine };
      });
    },
  );
}
