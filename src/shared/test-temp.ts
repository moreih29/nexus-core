import { accessSync, constants, mkdirSync, mkdtempSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function tempCandidates(): string[] {
  return [...new Set([
    tmpdir(),
    process.env['RUNNER_TEMP'],
    '/tmp',
    process.cwd(),
  ].filter((value): value is string => typeof value === 'string' && value.length > 0))];
}

function isWritableDirectory(dir: string): boolean {
  try {
    mkdirSync(dir, { recursive: true });
    if (!statSync(dir).isDirectory()) return false;
    accessSync(dir, constants.R_OK | constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

export function getWritableTempRoot(): string {
  for (const dir of tempCandidates()) {
    if (isWritableDirectory(dir)) return dir;
  }
  throw new Error(`No writable temp root available: ${tempCandidates().join(', ')}`);
}

export function makeTempDir(prefix: string): string {
  const errors: string[] = [];

  for (const dir of tempCandidates()) {
    if (!isWritableDirectory(dir)) {
      errors.push(`${dir}: unavailable`);
      continue;
    }

    try {
      return mkdtempSync(join(dir, prefix));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(`${dir}: ${message}`);
    }
  }

  throw new Error(`Failed to create temp dir for ${prefix}. ${errors.join('; ')}`);
}
