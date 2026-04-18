import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { extname } from 'node:path';
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const ServerDefSchema = z.object({
  command_chain: z.array(z.string()).min(1),
  search_paths: z.array(z.string()).optional(),
  args: z.array(z.string()),
});

const LanguageDefSchema = z.object({
  extensions: z.record(z.string(), z.string()),
  server: ServerDefSchema,
  install_hint: z.string(),
});

const LspServersConfigSchema = z.object({
  $schema: z.string().optional(),
  languages: z.record(z.string(), LanguageDefSchema),
});

export type LspServersConfig = z.infer<typeof LspServersConfigSchema>;

// ---------------------------------------------------------------------------
// Config loader (loaded once, then cached)
// ---------------------------------------------------------------------------

let configCache: LspServersConfig | null = null;

export function loadLspServersConfig(): LspServersConfig {
  if (configCache) return configCache;

  const url = new URL('../../assets/lsp-servers.json', import.meta.url);
  const raw = JSON.parse(readFileSync(url.pathname, 'utf-8')) as unknown;
  configCache = LspServersConfigSchema.parse(raw);
  return configCache;
}

// Exposed for testing — allows resetting the cache between tests
export function _resetConfigCache(): void {
  configCache = null;
}

// ---------------------------------------------------------------------------
// Extension → language / languageId lookups
// ---------------------------------------------------------------------------

/** Returns the language key (e.g. "typescript") for the given file path, or null. */
export function getLanguageFromExt(filePath: string): string | null {
  const ext = extname(filePath).replace(/^\./, '').toLowerCase();
  if (!ext) return null;

  const config = loadLspServersConfig();
  for (const [lang, def] of Object.entries(config.languages)) {
    if (ext in def.extensions) return lang;
  }
  return null;
}

/** Returns the LSP standard languageId (e.g. "typescriptreact" for .tsx), or null. */
export function getLanguageId(filePath: string): string | null {
  const ext = extname(filePath).replace(/^\./, '').toLowerCase();
  if (!ext) return null;

  const config = loadLspServersConfig();
  for (const def of Object.values(config.languages)) {
    if (ext in def.extensions) return def.extensions[ext];
  }
  return null;
}

// ---------------------------------------------------------------------------
// Command resolution
// ---------------------------------------------------------------------------

function resolveCommandInPath(cmd: string): string | null {
  try {
    const result = execFileSync('which', [cmd], {
      encoding: 'utf-8',
      timeout: 3000,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return result || null;
  } catch {
    return null;
  }
}

function expandHome(p: string): string {
  if (p.startsWith('~/')) return homedir() + p.slice(1);
  if (p === '~') return homedir();
  return p;
}

// ---------------------------------------------------------------------------
// getLspConfig
// ---------------------------------------------------------------------------

export type LspConfigResult =
  | { command: string; args: string[]; install_hint: string }
  | { error: string; install_hint: string };

export function getLspConfig(language: string): LspConfigResult {
  const config = loadLspServersConfig();
  const langDef = config.languages[language];
  if (!langDef) {
    return { error: `Unsupported language: ${language}`, install_hint: '' };
  }

  const { command_chain, search_paths = [], args } = langDef.server;
  const install_hint = langDef.install_hint;

  // Try each command in command_chain via which
  for (const cmd of command_chain) {
    const resolved = resolveCommandInPath(cmd);
    if (resolved) {
      return { command: resolved, args, install_hint };
    }
  }

  // Fallback: search_paths (expand ~ and check existence)
  for (const sp of search_paths) {
    const expanded = expandHome(sp);
    if (existsSync(expanded)) {
      return { command: expanded, args, install_hint };
    }
  }

  return {
    error: `No LSP server found for language "${language}". ${install_hint}`,
    install_hint,
  };
}
