import { glob } from 'tinyglobby';
import { readFile } from 'node:fs/promises';
import { parse as parseYaml } from 'yaml';
import path from 'node:path';

// ─── Invocation ID cache ──────────────────────────────────────────────────────

let _invocationIds: Set<string> | null = null;

async function loadInvocationIds(root: string): Promise<Set<string>> {
  if (_invocationIds !== null) return _invocationIds;
  try {
    const raw = await readFile(path.join(root, 'vocabulary', 'invocations.yml'), 'utf8');
    const data = parseYaml(raw) as { invocations?: Array<{ id: string }> };
    _invocationIds = new Set((data.invocations ?? []).map((e) => e.id));
  } catch {
    _invocationIds = new Set();
  }
  return _invocationIds;
}

// ─── Pre-processing helpers ───────────────────────────────────────────────────

/**
 * Mask heredoc blocks (>>LABEL ... <<LABEL) with spaces, preserving newlines
 * so line numbers remain accurate. Returns masked source.
 *
 * Per spec: heredoc internals are opaque for DISTINCTIVE/AMBIGUOUS G6 scanning.
 * Note: the spec also says tool call patterns inside heredocs should still be
 * caught. We do that via a separate scanRegex pass on the original source for
 * the CALL-PATTERN-ONLY regexes (Cat 2) and NAMESPACE regexes (Cat 3), which
 * are applied to the unmasked source.
 */
function maskHeredocs(source: string): string {
  // Match >>LABEL (optionally preceded by = or whitespace) through <<LABEL
  return source.replace(
    />>([A-Z][A-Z0-9_]*)([\s\S]*?)<<\1/g,
    (_match, _label: string, body: string) => {
      // Replace non-newline chars with spaces
      const masked = body.replace(/[^\n]/g, ' ');
      return `>>${_label}${masked}<<${_label}`;
    }
  );
}

/**
 * Mask macro invocations {{ ... }} with spaces, preserving newlines.
 * The primitive_id token immediately after {{ is preserved for validation;
 * everything else inside the braces is replaced with spaces.
 *
 * Returns { masked, macros } where macros is a list of { id, line }.
 */
function maskMacros(
  source: string
): { masked: string; macros: Array<{ id: string; line: number }> } {
  const macros: Array<{ id: string; line: number }> = [];
  const masked = source.replace(
    /\{\{([a-z_][a-z0-9_]*)([^}]*)\}\}/g,
    (match, id: string, rest: string, offset: number) => {
      const line = source.slice(0, offset).split('\n').length;
      macros.push({ id, line });
      // Replace the entire macro token with spaces (preserve newlines)
      const inner = (id as string) + (rest as string);
      return '{{' + inner.replace(/[^\n]/g, ' ') + '}}';
    }
  );
  return { masked, macros };
}

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
const CLAUDE_CODE_TOOLS_DISTINCTIVE = /\b(NotebookEdit|BashOutput|KillShell|Glob|Grep|WebFetch|WebSearch|TodoWrite|SendMessage|TeamCreate|AskUserQuestion|mcp__plugin_[a-z0-9_]+|TaskCreate|TaskUpdate|TaskList|TaskGet|TaskStop|TaskOutput|subagent_type|prompt_user)\b/g;
// Ambiguous tools — also common English words (Read, Write, Edit, Bash, Task, Monitor)
// Only scanned in meta.yml and vocabulary where they are clearly tool references, not prose.
const CLAUDE_CODE_TOOLS_AMBIGUOUS = /\b(Read|Write|Edit|Bash|Task|Monitor)\b/g;
const OPENCODE_TOOLS = /\b(edit|write|patch|multiedit|bash)\b/g;

// G6 Category 2: Call-pattern only (prose words that become violations only with open-paren)
// "Agent role", "Skill activation" etc. are fine; "Agent(", "Skill(" are forbidden.
const CALL_PATTERN_TOOLS = /\b(Skill|Agent)\s*\(/g;

// G6 Category 3: Harness namespace slash-command patterns
const HARNESS_NAMESPACE = /\/(?:claude-nexus|opencode-nexus):/g;

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
 * CLAUDE_CODE_TOOLS_DISTINCTIVE — unambiguous, scanned in ALL lint-included files.
 *   For body.md: source is pre-processed (heredoc + macro masking) so that
 *   macro internals and heredoc bodies do not produce false positives.
 *
 * CLAUDE_CODE_TOOLS_AMBIGUOUS (Read/Write/Edit/Bash/Task/Monitor) + OPENCODE_TOOLS —
 *   scanned ONLY in meta.yml and vocabulary/*.yml, not in body.md prose.
 *
 * CALL_PATTERN_TOOLS (Skill(, Agent() — scanned in ALL files on raw source
 *   (after macro+heredoc masking). Prose words without parens are never flagged.
 *
 * HARNESS_NAMESPACE (/claude-nexus:, /opencode-nexus:) — scanned in ALL files.
 *   For body.md: applied to macro/heredoc-masked source.
 *
 * Cat 4 (Macro whitelist): {{primitive_id}} macros in body.md are extracted and
 *   their primitive_id is validated against vocabulary/invocations.yml enum.
 *   Unknown primitive_ids emit a warning (consumer expander cannot handle them).
 */
export async function checkHarnessSpecific(root: string): Promise<ValidationResult[]> {
  const invocationIds = await loadInvocationIds(root);
  const results: ValidationResult[] = [];
  for await (const file of iterFiles(root)) {
    const source = await readFile(file, 'utf8');
    const rel = path.relative(root, file);
    const isBody = rel.endsWith('body.md');

    if (isBody) {
      // Pre-process: mask heredocs first, then macros
      const heredocMasked = maskHeredocs(source);
      const { masked, macros } = maskMacros(heredocMasked);

      // Cat 1 (Distinctive) — on masked source
      results.push(
        ...scanRegex(masked, CLAUDE_CODE_TOOLS_DISTINCTIVE, rel, 'G6-harness-lint',
          (m) => `Harness-specific tool name forbidden: '${m}'. Use abstract capability or remove.`)
      );

      // Cat 2 (Call-pattern) — on masked source (macros/heredocs won't contain Agent(/Skill()
      results.push(
        ...scanRegex(masked, CALL_PATTERN_TOOLS, rel, 'G6-harness-lint',
          (m) => `Harness-specific tool call syntax forbidden: '${m}'. Use abstract capability or remove.`)
      );

      // Cat 3 (Namespace) — on masked source
      results.push(
        ...scanRegex(masked, HARNESS_NAMESPACE, rel, 'G6-harness-lint',
          (m) => `Harness namespace slash-command forbidden: '${m}'. Use capability abstraction.`)
      );

      // Cat 4 (Macro whitelist) — validate primitive_ids against invocations.yml
      for (const macro of macros) {
        if (!invocationIds.has(macro.id)) {
          results.push({
            file: rel,
            gate: 'G6-harness-lint',
            severity: 'warning',
            line: macro.line,
            message: `Macro primitive_id '${macro.id}' is not registered in vocabulary/invocations.yml — consumer expander cannot handle it.`,
          });
        }
      }
    } else {
      // meta.yml and vocabulary files — scan raw source
      results.push(
        ...scanRegex(source, CLAUDE_CODE_TOOLS_DISTINCTIVE, rel, 'G6-harness-lint',
          (m) => `Harness-specific tool name forbidden: '${m}'. Use abstract capability or remove.`)
      );

      results.push(
        ...scanRegex(source, CALL_PATTERN_TOOLS, rel, 'G6-harness-lint',
          (m) => `Harness-specific tool call syntax forbidden: '${m}'. Use abstract capability or remove.`)
      );

      results.push(
        ...scanRegex(source, HARNESS_NAMESPACE, rel, 'G6-harness-lint',
          (m) => `Harness namespace slash-command forbidden: '${m}'. Use capability abstraction.`)
      );

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
