import { glob } from 'tinyglobby';
import { readFile } from 'node:fs/promises';
import { parse as parseYaml } from 'yaml';
import path from 'node:path';

/**
 * Common ValidationResult type. Imported from ./validate.ts for consistency,
 * but declared here as well for isolation.
 */
export interface ValidationResult {
  file: string;
  gate: string;
  severity: 'error' | 'warning';
  line?: number;
  message: string;
}

/** Paths excluded from all lint checks. */
const LINT_EXCLUDE: string[] = [
  'scripts/**',
  'node_modules/**',
  '.git/**',
  'dist/**',
  '.nexus/**',
  'schema/**',
  // capabilities.yml prose_guidance naturally uses English words (Read, edit, write)
  // that match tool-name regexes. After v0.2.0 harness-agnostic redesign, this file
  // contains zero harness tool names — only semantic descriptions. Excluding is safe.
  'vocabulary/capabilities.yml',
];

/**
 * Patterns to scan — only prompt-injection sources and canonical vocabulary.
 *
 * Intentionally excluded: README.md, CONSUMING.md, CHANGELOG.md, MIGRATIONS/*,
 * schema/README.md — these are human-facing documentation where harness tool
 * names and model names may legitimately appear in prose explanations.
 */
const LINT_INCLUDE: string[] = [
  'agents/**/meta.yml',
  'agents/**/body.md',
  'skills/**/meta.yml',
  'skills/**/body.md',
  'vocabulary/*.yml',
];

// G6: harness-specific tool names
// Distinctive tools — unambiguous, safe to scan in ALL files including body.md prose
const CLAUDE_CODE_TOOLS_DISTINCTIVE = /\b(NotebookEdit|BashOutput|KillShell|Glob|Grep|WebFetch|WebSearch|TodoWrite|SendMessage|TeamCreate|AskUserQuestion|mcp__plugin_[a-z0-9_]+)\b/g;
// Ambiguous tools — also common English words (Read, Write, Edit, Bash, Task, Monitor)
// Only scanned in meta.yml and vocabulary where they are clearly tool references, not prose.
const CLAUDE_CODE_TOOLS_AMBIGUOUS = /\b(Read|Write|Edit|Bash|Task|Monitor)\b/g;
const OPENCODE_TOOLS = /\b(edit|write|patch|multiedit|bash)\b/g;

// G7: concrete model names
const CONCRETE_MODELS = /\b(opus|sonnet|haiku|gpt-[0-9][a-z0-9.-]*|claude-[0-9][a-z0-9.-]*)\b/gi;

// G8: non-TS/JS file allowed extensions
const PROMPT_ONLY_BAD_EXT = /\.(ts|tsx|js|jsx|cjs|mjs)$/;

async function* iterFiles(root: string): AsyncGenerator<string> {
  const files = await glob(LINT_INCLUDE, {
    cwd: root,
    ignore: LINT_EXCLUDE,
    absolute: true,
    onlyFiles: true,
  });
  for (const f of files) yield f;
}

function lineOfMatch(source: string, index: number): number {
  return source.slice(0, index).split('\n').length;
}

function scanRegex(
  source: string,
  regex: RegExp,
  file: string,
  gate: string,
  makeMessage: (match: string) => string
): ValidationResult[] {
  const results: ValidationResult[] = [];
  regex.lastIndex = 0;
  let m: RegExpExecArray | null;
  // eslint-disable-next-line no-cond-assign
  while ((m = regex.exec(source)) !== null) {
    results.push({
      file,
      gate,
      severity: 'error',
      line: lineOfMatch(source, m.index),
      message: makeMessage(m[0]),
    });
    if (m.index === regex.lastIndex) regex.lastIndex++;
  }
  return results;
}

/** G6: harness-specific tool names forbidden in body/meta/vocabulary.
 *
 * CLAUDE_CODE_TOOLS (capitalized, distinctive) — scanned in ALL lint-included files.
 * OPENCODE_TOOLS (lowercase, indistinguishable from English words in prose) — scanned
 * ONLY in meta.yml and vocabulary/*.yml, NOT in body.md or prose_guidance fields.
 * Rationale: "edit", "write", "bash" are common English words that legitimately appear
 * in descriptive body prose. Scanning body.md for these produces mass false positives.
 */
export async function checkHarnessSpecific(root: string): Promise<ValidationResult[]> {
  const results: ValidationResult[] = [];
  for await (const file of iterFiles(root)) {
    const source = await readFile(file, 'utf8');
    const rel = path.relative(root, file);
    // Distinctive Claude Code tools (unambiguous) — all files
    results.push(
      ...scanRegex(source, CLAUDE_CODE_TOOLS_DISTINCTIVE, rel, 'G6-harness-lint',
        (m) => `Harness-specific tool name forbidden: '${m}'. Use abstract capability or remove.`)
    );
    // Ambiguous tools (Read/Write/Edit/Bash/Task/Monitor + OpenCode lowercase) — meta.yml and vocabulary only
    if (rel.endsWith('meta.yml') || rel.startsWith('vocabulary/')) {
      results.push(
        ...scanRegex(source, CLAUDE_CODE_TOOLS_AMBIGUOUS, rel, 'G6-harness-lint',
          (m) => `Harness-specific tool name forbidden: '${m}'. Use abstract capability or remove.`)
      );
      results.push(
        ...scanRegex(source, OPENCODE_TOOLS, rel, 'G6-harness-lint',
          (m) => `OpenCode tool name forbidden: '${m}'. Use abstract capability or remove.`)
      );
    }
  }
  return results;
}

/** G7: concrete model names forbidden; use model_tier abstraction. */
export async function checkConcreteModel(root: string): Promise<ValidationResult[]> {
  const results: ValidationResult[] = [];
  for await (const file of iterFiles(root)) {
    const source = await readFile(file, 'utf8');
    const rel = path.relative(root, file);
    results.push(
      ...scanRegex(source, CONCRETE_MODELS, rel, 'G7-model-lint',
        (m) => `Concrete model name forbidden: '${m}'. Use 'model_tier: high | standard'.`)
    );
  }
  return results;
}

/**
 * G11: tag trigger consistency — each tag's trigger must equal "[" + id.replace(/-/g, ":") + "]".
 */
export async function checkTagTriggerConsistency(root: string): Promise<ValidationResult[]> {
  const tagsPath = path.join(root, 'vocabulary', 'tags.yml');
  const rel = path.join('vocabulary', 'tags.yml');
  let source: string;
  try {
    source = await readFile(tagsPath, 'utf8');
  } catch (err) {
    return [{
      file: rel,
      gate: 'G11-tag-trigger',
      severity: 'error',
      message: `Cannot read tags.yml: ${(err as Error).message}`,
    }];
  }

  let data: unknown;
  try {
    data = parseYaml(source);
  } catch (err) {
    return [{
      file: rel,
      gate: 'G11-tag-trigger',
      severity: 'error',
      message: `YAML parse error in tags.yml: ${(err as Error).message}`,
    }];
  }

  const tags = (data as { tags?: Array<{ id: string; trigger: string }> })?.tags ?? [];
  const results: ValidationResult[] = [];
  for (const tag of tags) {
    const expected = '[' + tag.id.replace(/-/g, ':') + ']';
    if (tag.trigger !== expected) {
      results.push({
        file: rel,
        gate: 'G11-tag-trigger',
        severity: 'error',
        message: `Tag '${tag.id}': trigger mismatch — expected '${expected}', got '${tag.trigger}'`,
      });
    }
  }
  return results;
}

/**
 * G8: prompt-only enforcement — no .ts/.js/.cjs/.mjs outside scripts/.
 * Published artifact must not contain runtime code.
 */
export async function checkPromptOnly(root: string): Promise<ValidationResult[]> {
  const results: ValidationResult[] = [];
  const allFiles = await glob(['**/*'], {
    cwd: root,
    ignore: ['node_modules/**', '.git/**', 'dist/**', '.nexus/**', 'scripts/**'],
    absolute: true,
    onlyFiles: true,
  });
  for (const file of allFiles) {
    if (PROMPT_ONLY_BAD_EXT.test(file)) {
      const rel = path.relative(root, file);
      results.push({
        file: rel,
        gate: 'G8-prompt-only',
        severity: 'error',
        message: `Runtime code file outside scripts/: ${rel}. nexus-core is a prompt-only library.`,
      });
    }
  }
  return results;
}
