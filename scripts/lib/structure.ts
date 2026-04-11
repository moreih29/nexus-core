import { glob } from 'tinyglobby';
import { readFile, readdir } from 'node:fs/promises';
import { parse as parseYaml } from 'yaml';
import path from 'node:path';

export interface ValidationResult {
  file: string;
  gate: string;
  severity: 'error' | 'warning';
  line?: number;
  message: string;
}

const KEBAB_ID_PATTERN = /^[a-z][a-z0-9-]*$/;
const ALLOWED_FILES = new Set(['body.md', 'meta.yml']);

/**
 * G9: Strict directory contents.
 * agents/{id}/ and skills/{id}/ must contain exactly body.md + meta.yml, nothing else.
 */
export async function checkDirectoryStrict(root: string): Promise<ValidationResult[]> {
  const results: ValidationResult[] = [];
  const targets: Array<{ kind: string; base: string }> = [
    { kind: 'agent', base: 'agents' },
    { kind: 'skill', base: 'skills' },
  ];

  for (const { kind, base } of targets) {
    const baseDir = path.join(root, base);
    let entries: Array<{ name: string; isDirectory: () => boolean }>;
    try {
      entries = await readdir(baseDir, { withFileTypes: true });
    } catch {
      // base directory absent — not an error at this gate
      continue;
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) {
        const rel = path.join(base, entry.name);
        results.push({
          file: rel,
          gate: 'G9-directory-strict',
          severity: 'error',
          message: `Unexpected non-directory entry in ${base}/: '${entry.name}'. Only ${kind} directories allowed.`,
        });
        continue;
      }

      const dirPath = path.join(baseDir, entry.name);
      const files = await readdir(dirPath);
      const fileSet = new Set(files);

      // Must contain exactly body.md + meta.yml
      if (!fileSet.has('body.md')) {
        results.push({
          file: path.join(base, entry.name),
          gate: 'G9-directory-strict',
          severity: 'error',
          message: `Missing required file: ${base}/${entry.name}/body.md`,
        });
      }
      if (!fileSet.has('meta.yml')) {
        results.push({
          file: path.join(base, entry.name),
          gate: 'G9-directory-strict',
          severity: 'error',
          message: `Missing required file: ${base}/${entry.name}/meta.yml`,
        });
      }
      for (const f of files) {
        if (!ALLOWED_FILES.has(f)) {
          results.push({
            file: path.join(base, entry.name, f),
            gate: 'G9-directory-strict',
            severity: 'error',
            message: `Unexpected file in ${base}/${entry.name}/: '${f}'. Only body.md + meta.yml allowed (Strict).`,
          });
        }
      }
    }
  }

  return results;
}

/**
 * G10: id <-> directory name match + kebab-case pattern.
 * meta.yml.id must equal path.basename(path.dirname(file)) and match ^[a-z][a-z0-9-]*$.
 */
export async function checkIdMatch(root: string): Promise<ValidationResult[]> {
  const results: ValidationResult[] = [];
  const metaFiles = await glob(['agents/*/meta.yml', 'skills/*/meta.yml'], {
    cwd: root,
    absolute: true,
    onlyFiles: true,
  });

  for (const metaPath of metaFiles) {
    const rel = path.relative(root, metaPath);
    const dirName = path.basename(path.dirname(metaPath));

    // Directory name must itself be kebab-case
    if (!KEBAB_ID_PATTERN.test(dirName)) {
      results.push({
        file: rel,
        gate: 'G10-id-match',
        severity: 'error',
        message: `Directory name '${dirName}' violates kebab-case pattern ^[a-z][a-z0-9-]*$`,
      });
      // Continue to also check id field — don't skip
    }

    let data: Record<string, unknown>;
    try {
      const content = await readFile(metaPath, 'utf8');
      data = (parseYaml(content) ?? {}) as Record<string, unknown>;
    } catch (err) {
      results.push({
        file: rel,
        gate: 'G10-id-match',
        severity: 'error',
        message: `Failed to parse meta.yml: ${(err as Error).message}`,
      });
      continue;
    }

    const id = data.id;
    if (typeof id !== 'string') {
      results.push({
        file: rel,
        gate: 'G10-id-match',
        severity: 'error',
        message: `meta.yml.id is missing or not a string`,
      });
      continue;
    }

    if (!KEBAB_ID_PATTERN.test(id)) {
      results.push({
        file: rel,
        gate: 'G10-id-match',
        severity: 'error',
        message: `meta.yml.id '${id}' violates kebab-case pattern ^[a-z][a-z0-9-]*$`,
      });
    }

    if (id !== dirName) {
      results.push({
        file: rel,
        gate: 'G10-id-match',
        severity: 'error',
        message: `meta.yml.id '${id}' does not match directory name '${dirName}'`,
      });
    }
  }

  return results;
}
