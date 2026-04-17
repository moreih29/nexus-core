import Ajv2020 from 'ajv/dist/2020';
import type { ValidateFunction } from 'ajv';
import addFormats from 'ajv-formats';
import ajvErrors from 'ajv-errors';
import { glob } from 'tinyglobby';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { parse as parseYaml } from 'yaml';
import path from 'node:path';
import { parseFrontmatter, frontmatterLineToSourceLine } from './frontmatter.ts';

export interface ValidationResult {
  file: string;
  gate: string;
  severity: 'error' | 'warning';
  line?: number;
  message: string;
}

// ─── Manifest types ──────────────────────────────────────────────────────────

interface AgentMeta {
  id: string;
  name: string;
  alias_ko?: string;
  description: string;
  task?: string;
  category: string;
  capabilities: string[];
  resume_tier: string;
  model_tier: string;
}

interface SkillMeta {
  id: string;
  name: string;
  alias_ko?: string;
  description: string;
  summary?: string;
  harness_docs_refs?: string[];
  triggers: string[];
  manual_only?: boolean;
}

interface CapabilityEntry {
  id: string;
  description: string;
  intent: string;
  blocks_semantic_classes: string[];
  prose_guidance: string;
}

interface SimpleEntry {
  id: string;
  description: string;
}

interface TagEntry {
  id: string;
  trigger: string;
  type: 'skill' | 'inline_action';
  description: string;
  skill?: string;
  handler?: string;
  variants?: string[];
}

interface InvocationParam {
  name: string;
  description: string;
  required: boolean;
  value_type?: string;
}

interface InvocationEntry {
  id: string;
  description: string;
  intent: string;
  semantic_params: InvocationParam[];
  prose_guidance: string;
  fallback_behavior: string;
}

interface TaskExceptionEntry {
  id: string;
  description: string;
  applies_when: string;
  treatment: string;
  rationale: string;
}

interface MemoryPolicy {
  categories: unknown[];
  naming: unknown;
  access_tracking: unknown;
  forgetting: unknown;
  merge: unknown;
}

interface Vocab {
  capabilities: CapabilityEntry[];
  categories: SimpleEntry[];
  resume_tiers: SimpleEntry[];
  tags: TagEntry[];
  invocations: InvocationEntry[];
  task_exceptions: TaskExceptionEntry[];
  memory_policy: MemoryPolicy;
}

interface ManifestAgent extends AgentMeta {
  body_hash: string;
}

interface ManifestSkill extends SkillMeta {
  body_hash: string;
}

interface ManifestInvocationEntry {
  id: string;
  description: string;
  intent: string;
  fallback_behavior: string;
}

interface Manifest {
  nexus_core_version: string;
  nexus_core_commit: string;
  schema_contract_version: string;
  agents: ManifestAgent[];
  skills: ManifestSkill[];
  vocabulary: {
    capabilities: CapabilityEntry[];
    categories: SimpleEntry[];
    resume_tiers: SimpleEntry[];
    tags: TagEntry[];
    invocations: ManifestInvocationEntry[];
    task_exceptions: TaskExceptionEntry[];
    memory_policy: MemoryPolicy;
  };
}

// ─── AJV setup ───────────────────────────────────────────────────────────────

let ajvInstance: Ajv2020 | null = null;
let schemaDir = '';

interface LoadedSchemas {
  agentValidator: ValidateFunction;
  skillValidator: ValidateFunction;
  vocabValidator: ValidateFunction;
  manifestValidator: ValidateFunction;
  taskExceptionValidator: ValidateFunction;
  memoryPolicyValidator: ValidateFunction;
}

let cachedSchemas: LoadedSchemas | null = null;

/** G1: Load and compile JSON schemas. Must be called before runAll. */
export async function loadSchemas(root: string): Promise<void> {
  schemaDir = path.join(root, 'schema');

  const ajv = new Ajv2020({
    strict: true,
    allErrors: true,
    verbose: true,
    loadSchema: async (uri: string) => {
      // Resolve relative $ref URIs within schema directory
      const basename = path.basename(uri);
      const schemaPath = path.join(schemaDir, basename);
      const content = await readFile(schemaPath, 'utf8');
      return JSON.parse(content) as Record<string, unknown>;
    },
  });
  addFormats(ajv);
  ajvErrors(ajv);

  const [commonRaw, agentRaw, skillRaw, vocabRaw, manifestRaw, taskExceptionSchemaRaw, memoryPolicySchemaRaw] = await Promise.all([
    readFile(path.join(schemaDir, 'common.schema.json'), 'utf8'),
    readFile(path.join(schemaDir, 'agent.schema.json'), 'utf8'),
    readFile(path.join(schemaDir, 'skill.schema.json'), 'utf8'),
    readFile(path.join(schemaDir, 'vocabulary.schema.json'), 'utf8'),
    readFile(path.join(schemaDir, 'manifest.schema.json'), 'utf8'),
    readFile(path.join(schemaDir, 'task-exceptions.schema.json'), 'utf8'),
    readFile(path.join(schemaDir, 'memory-policy.schema.json'), 'utf8'),
  ]);

  const commonSchema = JSON.parse(commonRaw) as Record<string, unknown>;
  const agentSchema = JSON.parse(agentRaw) as Record<string, unknown>;
  const skillSchema = JSON.parse(skillRaw) as Record<string, unknown>;
  const vocabSchema = JSON.parse(vocabRaw) as Record<string, unknown>;
  const manifestSchema = JSON.parse(manifestRaw) as Record<string, unknown>;
  const taskExceptionSchema = JSON.parse(taskExceptionSchemaRaw) as Record<string, unknown>;
  const memoryPolicySchema = JSON.parse(memoryPolicySchemaRaw) as Record<string, unknown>;

  ajv.addSchema(commonSchema);
  ajv.addSchema(vocabSchema);

  const agentValidator = await ajv.compileAsync(agentSchema);
  const skillValidator = await ajv.compileAsync(skillSchema);

  // Vocabulary files use named $defs — compile per sub-schema
  const vocabDefs = (vocabSchema['$defs'] ?? {}) as Record<string, Record<string, unknown>>;
  const capabilityFileSchema = {
    ...vocabDefs['capabilityFile'],
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: 'vocabulary-capability-file',
    $defs: vocabDefs,
  };
  const categoryFileSchema = {
    ...vocabDefs['categoryFile'],
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: 'vocabulary-category-file',
    $defs: vocabDefs,
  };
  const resumeTierFileSchema = {
    ...vocabDefs['resumeTierFile'],
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: 'vocabulary-resume-tier-file',
    $defs: vocabDefs,
  };
  const tagFileSchema = {
    ...vocabDefs['tagFile'],
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: 'vocabulary-tag-file',
    $defs: vocabDefs,
  };
  const invocationFileSchema = {
    ...vocabDefs['invocationFile'],
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: 'vocabulary-invocation-file',
    $defs: vocabDefs,
  };

  const capabilityValidator = await ajv.compileAsync(capabilityFileSchema);
  const categoryValidator = await ajv.compileAsync(categoryFileSchema);
  const resumeTierValidator = await ajv.compileAsync(resumeTierFileSchema);
  const tagValidator = await ajv.compileAsync(tagFileSchema);
  const invocationValidator = await ajv.compileAsync(invocationFileSchema);
  const taskExceptionValidator = await ajv.compileAsync(taskExceptionSchema);
  const memoryPolicyValidator = await ajv.compileAsync(memoryPolicySchema);

  const manifestAjv = new Ajv2020({
    strict: false,
    allErrors: true,
    loadSchema: async (uri: string) => {
      const basename = path.basename(uri);
      const schemaPath = path.join(schemaDir, basename);
      const content = await readFile(schemaPath, 'utf8');
      return JSON.parse(content) as Record<string, unknown>;
    },
  });
  addFormats(manifestAjv);
  ajvErrors(manifestAjv);
  manifestAjv.addSchema(commonSchema);
  const manifestValidator = await manifestAjv.compileAsync(manifestSchema);

  ajvInstance = ajv;
  cachedSchemas = {
    agentValidator,
    skillValidator,
    // Store vocabulary validators and manifest as composite
    vocabValidator: capabilityValidator, // placeholder — we handle vocab separately below
    manifestValidator,
    taskExceptionValidator,
    memoryPolicyValidator,
  };

  // Store all vocab validators for internal use
  _vocabValidators = { capabilityValidator, categoryValidator, resumeTierValidator, tagValidator, invocationValidator, taskExceptionValidator, memoryPolicyValidator };
}

interface VocabValidators {
  capabilityValidator: ValidateFunction;
  categoryValidator: ValidateFunction;
  resumeTierValidator: ValidateFunction;
  tagValidator: ValidateFunction;
  invocationValidator: ValidateFunction;
  taskExceptionValidator: ValidateFunction;
  memoryPolicyValidator: ValidateFunction;
}

let _vocabValidators: VocabValidators | null = null;

// ─── offsetToLine helper ──────────────────────────────────────────────────────

/**
 * Converts a character offset in source text to a 1-based line number.
 * Works for both frontmatter and body regions.
 */
export function offsetToLine(source: string, offset: number): number {
  return source.slice(0, offset).split('\n').length;
}

// ─── G1: Schema validation ────────────────────────────────────────────────────

async function validateAgentMeta(
  filePath: string,
  rel: string
): Promise<{ result: ValidationResult[]; data: AgentMeta | null }> {
  if (!cachedSchemas) return { result: [], data: null };
  const results: ValidationResult[] = [];

  let source: string;
  try {
    source = await readFile(filePath, 'utf8');
  } catch (err) {
    return {
      result: [{ file: rel, gate: 'G1-schema', severity: 'error', message: `Cannot read file: ${(err as Error).message}` }],
      data: null,
    };
  }

  let data: unknown;
  try {
    data = parseYaml(source);
  } catch (err) {
    return {
      result: [{ file: rel, gate: 'G1-schema', severity: 'error', message: `YAML parse error: ${(err as Error).message}` }],
      data: null,
    };
  }

  const valid = cachedSchemas.agentValidator(data);
  if (!valid) {
    for (const e of cachedSchemas.agentValidator.errors ?? []) {
      results.push({
        file: rel,
        gate: 'G1-schema',
        severity: 'error',
        message: `${e.instancePath || '(root)'}: ${e.message ?? 'validation failed'}`,
      });
    }
    return { result: results, data: null };
  }

  return { result: [], data: data as AgentMeta };
}

async function validateSkillMeta(
  filePath: string,
  rel: string
): Promise<{ result: ValidationResult[]; data: SkillMeta | null }> {
  if (!cachedSchemas) return { result: [], data: null };

  let source: string;
  try {
    source = await readFile(filePath, 'utf8');
  } catch (err) {
    return {
      result: [{ file: rel, gate: 'G1-schema', severity: 'error', message: `Cannot read file: ${(err as Error).message}` }],
      data: null,
    };
  }

  let data: unknown;
  try {
    data = parseYaml(source);
  } catch (err) {
    return {
      result: [{ file: rel, gate: 'G1-schema', severity: 'error', message: `YAML parse error: ${(err as Error).message}` }],
      data: null,
    };
  }

  const valid = cachedSchemas.skillValidator(data);
  if (!valid) {
    const results: ValidationResult[] = [];
    for (const e of cachedSchemas.skillValidator.errors ?? []) {
      results.push({
        file: rel,
        gate: 'G1-schema',
        severity: 'error',
        message: `${e.instancePath || '(root)'}: ${e.message ?? 'validation failed'}`,
      });
    }
    return { result: results, data: null };
  }

  return { result: [], data: data as SkillMeta };
}

// ─── G2-G5: Referential integrity ────────────────────────────────────────────

function checkCapabilityIntegrity(
  agents: Array<{ meta: AgentMeta; rel: string }>,
  capabilityIds: Set<string>
): ValidationResult[] {
  const results: ValidationResult[] = [];
  for (const { meta, rel } of agents) {
    for (const cap of meta.capabilities) {
      if (!capabilityIds.has(cap)) {
        results.push({
          file: rel,
          gate: 'G2-capability-integrity',
          severity: 'error',
          message: `Unknown capability '${cap}' — not defined in vocabulary/capabilities.yml`,
        });
      }
    }
  }
  return results;
}

function checkCategoryIntegrity(
  agents: Array<{ meta: AgentMeta; rel: string }>,
  categoryIds: Set<string>
): ValidationResult[] {
  const results: ValidationResult[] = [];
  for (const { meta, rel } of agents) {
    if (!categoryIds.has(meta.category)) {
      results.push({
        file: rel,
        gate: 'G3-category-integrity',
        severity: 'error',
        message: `Unknown category '${meta.category}' — not defined in vocabulary/categories.yml`,
      });
    }
  }
  return results;
}

function checkResumeTierIntegrity(
  agents: Array<{ meta: AgentMeta; rel: string }>,
  resumeTierIds: Set<string>
): ValidationResult[] {
  const results: ValidationResult[] = [];
  for (const { meta, rel } of agents) {
    if (!resumeTierIds.has(meta.resume_tier)) {
      results.push({
        file: rel,
        gate: 'G4-resume-tier-integrity',
        severity: 'error',
        message: `Unknown resume_tier '${meta.resume_tier}' — not defined in vocabulary/resume-tiers.yml`,
      });
    }
  }
  return results;
}

function checkTagIntegrity(
  skills: Array<{ meta: SkillMeta; rel: string }>,
  tags: TagEntry[]
): ValidationResult[] {
  // G5: skill.triggers references must be tag ids of type=skill
  const skillTagIds = new Set(tags.filter((t) => t.type === 'skill').map((t) => t.id));
  const results: ValidationResult[] = [];
  for (const { meta, rel } of skills) {
    for (const trigger of meta.triggers ?? []) {
      if (!skillTagIds.has(trigger)) {
        results.push({
          file: rel,
          gate: 'G5-tag-integrity',
          severity: 'error',
          message: `Trigger '${trigger}' is not a known skill-type tag id in vocabulary/tags.yml`,
        });
      }
    }
  }
  return results;
}

// ─── G5': Capability entry integrity ─────────────────────────────────────────

const SNAKE_CASE_RE = /^[a-z][a-z0-9_]*$/;

export function checkCapabilityEntryIntegrity(capabilities: CapabilityEntry[]): ValidationResult[] {
  const results: ValidationResult[] = [];
  for (const cap of capabilities) {
    if (!SNAKE_CASE_RE.test(cap.intent)) {
      results.push({
        file: 'vocabulary/capabilities.yml',
        gate: 'G5-capability-integrity',
        severity: 'error',
        message: `Capability '${cap.id}': 'intent' must match snake_case /^[a-z][a-z0-9_]*$/, got '${cap.intent}'`,
      });
    }
    if (!cap.blocks_semantic_classes || cap.blocks_semantic_classes.length === 0) {
      results.push({
        file: 'vocabulary/capabilities.yml',
        gate: 'G5-capability-integrity',
        severity: 'error',
        message: `Capability '${cap.id}': 'blocks_semantic_classes' must have at least 1 entry`,
      });
    } else {
      for (const cls of cap.blocks_semantic_classes) {
        if (!SNAKE_CASE_RE.test(cls)) {
          results.push({
            file: 'vocabulary/capabilities.yml',
            gate: 'G5-capability-integrity',
            severity: 'error',
            message: `Capability '${cap.id}': class '${cls}' must match snake_case /^[a-z][a-z0-9_]*$/`,
          });
        }
      }
    }
    if (!cap.prose_guidance || cap.prose_guidance.trim().length < 40) {
      results.push({
        file: 'vocabulary/capabilities.yml',
        gate: 'G5-capability-integrity',
        severity: 'error',
        message: `Capability '${cap.id}': 'prose_guidance' must be at least 40 characters`,
      });
    }
  }
  return results;
}

// ─── G6': Invocation entry integrity ─────────────────────────────────────────

export function checkInvocationEntryIntegrity(invocations: InvocationEntry[]): ValidationResult[] {
  const results: ValidationResult[] = [];
  for (const inv of invocations) {
    if (!SNAKE_CASE_RE.test(inv.intent)) {
      results.push({
        file: 'vocabulary/invocations.yml',
        gate: 'G6-invocation-integrity',
        severity: 'error',
        message: `Invocation '${inv.id}': 'intent' must match snake_case /^[a-z][a-z0-9_]*$/, got '${inv.intent}'`,
      });
    }
    if (!inv.prose_guidance || inv.prose_guidance.trim().length < 40) {
      results.push({
        file: 'vocabulary/invocations.yml',
        gate: 'G6-invocation-integrity',
        severity: 'error',
        message: `Invocation '${inv.id}': 'prose_guidance' must be at least 40 characters`,
      });
    }
    if (!inv.fallback_behavior || inv.fallback_behavior.trim().length < 20) {
      results.push({
        file: 'vocabulary/invocations.yml',
        gate: 'G6-invocation-integrity',
        severity: 'error',
        message: `Invocation '${inv.id}': 'fallback_behavior' must be at least 20 characters`,
      });
    }
    for (const param of inv.semantic_params ?? []) {
      if (!SNAKE_CASE_RE.test(param.name)) {
        results.push({
          file: 'vocabulary/invocations.yml',
          gate: 'G6-invocation-integrity',
          severity: 'error',
          message: `Invocation '${inv.id}': param name '${param.name}' must match snake_case /^[a-z][a-z0-9_]*$/`,
        });
      }
    }
  }
  return results;
}

// ─── Vocabulary loading ───────────────────────────────────────────────────────

async function loadVocab(root: string): Promise<{ vocab: Vocab | null; results: ValidationResult[] }> {
  if (!_vocabValidators) return { vocab: null, results: [] };
  const results: ValidationResult[] = [];

  const vocabDir = path.join(root, 'vocabulary');

  async function loadYaml<T>(filename: string, validator: ValidateFunction): Promise<T | null> {
    const filePath = path.join(vocabDir, filename);
    const rel = path.join('vocabulary', filename);
    let source: string;
    try {
      source = await readFile(filePath, 'utf8');
    } catch {
      // Vocabulary file absent — skip silently (no agents/skills to validate)
      return null;
    }

    let data: unknown;
    try {
      data = parseYaml(source);
    } catch (err) {
      results.push({ file: rel, gate: 'G1-schema', severity: 'error', message: `YAML parse error: ${(err as Error).message}` });
      return null;
    }

    const valid = validator(data);
    if (!valid) {
      for (const e of validator.errors ?? []) {
        results.push({
          file: rel,
          gate: 'G1-schema',
          severity: 'error',
          message: `${e.instancePath || '(root)'}: ${e.message ?? 'validation failed'}`,
        });
      }
      return null;
    }

    return data as T;
  }

  const [capData, catData, resumeData, tagData, invocationData, taskExceptionData, memoryPolicyData] = await Promise.all([
    loadYaml<{ capabilities: CapabilityEntry[] }>('capabilities.yml', _vocabValidators.capabilityValidator),
    loadYaml<{ categories: SimpleEntry[] }>('categories.yml', _vocabValidators.categoryValidator),
    loadYaml<{ resume_tiers: SimpleEntry[] }>('resume-tiers.yml', _vocabValidators.resumeTierValidator),
    loadYaml<{ tags: TagEntry[] }>('tags.yml', _vocabValidators.tagValidator),
    loadYaml<{ invocations: InvocationEntry[] }>('invocations.yml', _vocabValidators.invocationValidator),
    loadYaml<{ task_exceptions: TaskExceptionEntry[] }>('task-exceptions.yml', _vocabValidators.taskExceptionValidator),
    loadYaml<MemoryPolicy>('memory_policy.yml', _vocabValidators.memoryPolicyValidator),
  ]);

  if (!capData || !catData || !resumeData || !tagData || !invocationData || !taskExceptionData || !memoryPolicyData) {
    return { vocab: null, results };
  }

  return {
    vocab: {
      capabilities: capData.capabilities,
      categories: catData.categories,
      resume_tiers: resumeData.resume_tiers,
      tags: tagData.tags,
      invocations: invocationData.invocations,
      task_exceptions: taskExceptionData.task_exceptions,
      memory_policy: memoryPolicyData,
    },
    results,
  };
}

// ─── body_hash ────────────────────────────────────────────────────────────────

async function computeBodyHash(bodyPath: string): Promise<string> {
  const content = await readFile(bodyPath, 'utf8');
  // Normalize line endings before hashing
  const normalized = content.replace(/\r\n/g, '\n').trimEnd() + '\n';
  const hash = createHash('sha256').update(normalized, 'utf8').digest('hex');
  return `sha256:${hash}`;
}

// ─── Manifest generation ──────────────────────────────────────────────────────

/** Generate manifest.json structure from validated agents, skills, and vocabulary. */
export async function generateManifest(
  agents: Array<{ meta: AgentMeta; dir: string }>,
  skills: Array<{ meta: SkillMeta; dir: string }>,
  vocab: Vocab,
  version: string,
  commit: string
): Promise<Manifest> {
  const agentEntries: ManifestAgent[] = await Promise.all(
    agents.map(async ({ meta, dir }) => {
      const body_hash = await computeBodyHash(path.join(dir, 'body.md'));
      return { ...meta, body_hash };
    })
  );
  agentEntries.sort((a, b) => a.id.localeCompare(b.id));

  const skillEntries: ManifestSkill[] = await Promise.all(
    skills.map(async ({ meta, dir }) => {
      const body_hash = await computeBodyHash(path.join(dir, 'body.md'));
      return { ...meta, body_hash };
    })
  );
  skillEntries.sort((a, b) => a.id.localeCompare(b.id));

  const invocationSummaries: ManifestInvocationEntry[] = vocab.invocations.map((inv) => ({
    id: inv.id,
    description: inv.description,
    intent: inv.intent,
    fallback_behavior: inv.fallback_behavior,
  }));

  return {
    nexus_core_version: version,
    nexus_core_commit: commit,
    schema_contract_version: '2.0',
    agents: agentEntries,
    skills: skillEntries,
    vocabulary: {
      capabilities: vocab.capabilities,
      categories: vocab.categories,
      resume_tiers: vocab.resume_tiers,
      tags: vocab.tags,
      invocations: invocationSummaries,
      task_exceptions: vocab.task_exceptions,
      memory_policy: vocab.memory_policy,
    },
  };
}

/** Write manifest to <root>/manifest.json. */
export async function writeManifest(root: string, manifest: Manifest): Promise<void> {
  const dest = path.join(root, 'manifest.json');
  await writeFile(dest, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
}

// ─── runAll ───────────────────────────────────────────────────────────────────

/**
 * G1-G5: per-file fail-forward schema + referential integrity validation.
 * On success (no errors), generates and writes manifest.json.
 */
export async function runAll(root: string): Promise<ValidationResult[]> {
  const allResults: ValidationResult[] = [];

  // Load vocabulary first (G1 for vocab files)
  const { vocab, results: vocabResults } = await loadVocab(root);
  allResults.push(...vocabResults);

  // Collect capability/category/resumeTier/tag ID sets (may be empty if vocab missing)
  const capabilityIds = new Set((vocab?.capabilities ?? []).map((c) => c.id));
  const categoryIds = new Set((vocab?.categories ?? []).map((c) => c.id));
  const resumeTierIds = new Set((vocab?.resume_tiers ?? []).map((r) => r.id));
  const tags = vocab?.tags ?? [];

  // Discover agent directories
  const agentMetaPaths = await glob(['agents/*/meta.yml'], {
    cwd: root,
    absolute: true,
    onlyFiles: true,
  });

  const validAgents: Array<{ meta: AgentMeta; rel: string; dir: string }> = [];

  for (const metaPath of agentMetaPaths) {
    const rel = path.relative(root, metaPath);
    const { result, data } = await validateAgentMeta(metaPath, rel);
    allResults.push(...result);
    if (data) {
      validAgents.push({ meta: data, rel, dir: path.dirname(metaPath) });
    }
    // per-file fail-forward: if G1 fails for this file, G2-G5 checks skip it (data is null)
  }

  // Discover skill directories
  const skillMetaPaths = await glob(['skills/*/meta.yml'], {
    cwd: root,
    absolute: true,
    onlyFiles: true,
  });

  const validSkills: Array<{ meta: SkillMeta; rel: string; dir: string }> = [];

  for (const metaPath of skillMetaPaths) {
    const rel = path.relative(root, metaPath);
    const { result, data } = await validateSkillMeta(metaPath, rel);
    allResults.push(...result);
    if (data) {
      validSkills.push({ meta: data, rel, dir: path.dirname(metaPath) });
    }
  }

  // G2-G5: referential integrity (only on files that passed G1)
  if (vocab) {
    allResults.push(...checkCapabilityIntegrity(validAgents, capabilityIds));
    allResults.push(...checkCategoryIntegrity(validAgents, categoryIds));
    allResults.push(...checkResumeTierIntegrity(validAgents, resumeTierIds));
    allResults.push(...checkTagIntegrity(validSkills, tags));
    // G5': capability entry field integrity
    allResults.push(...checkCapabilityEntryIntegrity(vocab.capabilities));
    // G6': invocation entry field integrity
    allResults.push(...checkInvocationEntryIntegrity(vocab.invocations));
  }

  // Manifest generation — only on full success (no errors)
  const hasErrors = allResults.some((r) => r.severity === 'error');
  if (!hasErrors && vocab) {
    try {
      // Determine version and commit from env or package.json
      let version = process.env['npm_package_version'] ?? '0.0.0';
      if (version === '0.0.0') {
        try {
          const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8')) as { version?: string };
          version = pkg.version ?? '0.0.0';
        } catch {
          // ignore
        }
      }

      let commit = process.env['GITHUB_SHA'] ?? 'local';
      if (commit === 'local') {
        try {
          const { execSync } = await import('node:child_process');
          const sha = execSync('git rev-parse --short HEAD', { cwd: root, encoding: 'utf8' }).trim();
          if (sha) commit = sha;
        } catch {
          // ignore — keep 'local'
        }
      }

      const manifest = await generateManifest(validAgents, validSkills, vocab, version, commit);
      await writeManifest(root, manifest);
    } catch (err) {
      allResults.push({
        file: 'manifest.json',
        gate: 'G1-schema',
        severity: 'error',
        message: `Manifest generation failed: ${(err as Error).message}`,
      });
    }
  }

  return allResults;
}
