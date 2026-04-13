#!/usr/bin/env bun

/**
 * conformance-coverage.ts
 *
 * Build-time validator for conformance fixture coverage.
 * Checks:
 *   1. Every field in every state-schema is covered by at least one fixture
 *   2. Params in action fixtures are traceable to postcondition assertions (anti-pattern check)
 *
 * rule:no-runtime exception — this is a build-time utility under scripts/.
 */

import { readFile } from 'node:fs/promises';
import { glob } from 'tinyglobby';
import path from 'node:path';

// ─── Types ───────────────────────────────────────────────────────────────────

interface CoversBlock {
  state_schemas?: Record<string, string[]>;
  return_value?: Record<string, string[]>;
  description?: string;
}

interface ActionBlock {
  tool: string;
  params: Record<string, unknown>;
}

interface EventBlock {
  type: string;
  params?: Record<string, unknown>;
}

interface PostconditionBlock {
  state_files?: Record<string, Record<string, unknown> | null>;
  return_value?: Record<string, unknown>;
  error?: boolean;
  error_contains?: string;
}

interface StepBlock {
  description?: string;
  action?: ActionBlock;
  event?: EventBlock;
  assert_return?: Record<string, unknown>;
  assert_state?: Record<string, Record<string, unknown> | null>;
}

interface Fixture {
  test_id: string;
  description: string;
  covers?: CoversBlock;
  uncovered_params?: string[];
  precondition?: { state_files?: Record<string, unknown> };
  action?: ActionBlock;
  event?: EventBlock;
  steps?: StepBlock[];
  postcondition?: PostconditionBlock;
  _source_file: string;
}

interface MissingReport {
  schema: string;
  missingFields: string[];
}

interface AntiPatternReport {
  fixture: string;
  sourceFile: string;
  uncoveredParams: string[];
}

// ─── extractSchemaFields ──────────────────────────────────────────────────────

/**
 * Recursively traverse a JSON Schema object and return all field paths.
 * - Object properties => "key"
 * - Array items => "key[]"
 * - $defs/$ref resolution for same-file refs (e.g. "#/$defs/task")
 * - Top-level array: items are emitted without a leading "[]" wrapper;
 *   fields are emitted as-is (e.g. "agent_type", "agent_id")
 */
function extractSchemaFields(
  schemaObj: Record<string, unknown>,
  basePath = '',
  defs?: Record<string, unknown>,
  topLevelIsArray = false,
): string[] {
  // Resolve $ref if present
  const resolved = resolveRef(schemaObj, defs ?? (schemaObj['$defs'] as Record<string, unknown> | undefined));
  if (resolved !== schemaObj) {
    return extractSchemaFields(resolved, basePath, defs, topLevelIsArray);
  }

  const localDefs = (defs ?? (schemaObj['$defs'] as Record<string, unknown> | undefined)) as
    | Record<string, unknown>
    | undefined;

  const type = schemaObj['type'] as string | undefined;

  // Top-level array: recurse into items without prefixing with "[]"
  if (type === 'array' && basePath === '') {
    const items = schemaObj['items'] as Record<string, unknown> | undefined;
    if (items) {
      return extractSchemaFields(items, basePath, localDefs, true);
    }
    return [];
  }

  // Array field inside an object
  if (type === 'array' && basePath !== '') {
    const items = schemaObj['items'] as Record<string, unknown> | undefined;
    if (!items) return [basePath + '[]'];
    const itemType = (items as Record<string, unknown>)['type'] as string | undefined;
    // Scalar array items — no sub-fields to extract
    if (itemType === 'string' || itemType === 'number' || itemType === 'boolean') {
      return [basePath + '[]'];
    }
    // Object array items — recurse with "[]" appended to base path
    return extractSchemaFields(items as Record<string, unknown>, basePath + '[]', localDefs);
  }

  // Object with properties
  if (type === 'object' || schemaObj['properties']) {
    const properties = schemaObj['properties'] as Record<string, unknown> | undefined;
    if (!properties) return basePath ? [basePath] : [];

    const fields: string[] = [];
    if (basePath) fields.push(basePath);

    for (const [key, propSchema] of Object.entries(properties)) {
      const childPath = basePath ? `${basePath}.${key}` : key;
      const childFields = extractSchemaFields(
        propSchema as Record<string, unknown>,
        childPath,
        localDefs,
      );
      fields.push(...childFields);
    }
    return fields;
  }

  // Leaf scalar
  if (basePath) return [basePath];
  return [];
}

function resolveRef(
  schemaObj: Record<string, unknown>,
  defs: Record<string, unknown> | undefined,
): Record<string, unknown> {
  const ref = schemaObj['$ref'] as string | undefined;
  if (!ref || !defs) return schemaObj;

  // Handle "#/$defs/<name>"
  const match = ref.match(/^#\/\$defs\/(.+)$/);
  if (!match) return schemaObj;

  const defName = match[1];
  const def = defs[defName] as Record<string, unknown> | undefined;
  if (!def) return schemaObj;

  // Merge any non-$ref fields from schemaObj on top of resolved def
  // (allOf/oneOf merging is not needed for our strict schemas)
  return def;
}

// ─── Schema loading helpers ───────────────────────────────────────────────────

/**
 * Flatten schema field paths, removing parent object paths when they have
 * children (only keep leaf paths and array sentinel paths).
 */
function leafFields(schemaObj: Record<string, unknown>): string[] {
  const all = extractSchemaFields(schemaObj, '', undefined, false);
  // Remove intermediate paths that are parents of other paths
  const result: string[] = [];
  for (const field of all) {
    const hasChild = all.some((f) => f !== field && f.startsWith(field + '.'));
    if (!hasChild) result.push(field);
  }
  return result;
}

// ─── loadFixtures ─────────────────────────────────────────────────────────────

async function loadFixtures(root: string): Promise<Fixture[]> {
  const dirs = [
    path.join(root, 'conformance/tools'),
    path.join(root, 'conformance/scenarios'),
    path.join(root, 'conformance/lifecycle'),
  ];

  const patterns = dirs.map((d) => path.join(d, '*.json'));
  const files = await glob(patterns);

  const fixtures: Fixture[] = [];

  for (const file of files) {
    const raw = await readFile(file, 'utf-8');
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      console.error(`Failed to parse JSON: ${file}`);
      continue;
    }

    const sourceFile = path.relative(root, file);

    if (Array.isArray(parsed)) {
      for (const item of parsed as Record<string, unknown>[]) {
        fixtures.push({ ...(item as Omit<Fixture, '_source_file'>), _source_file: sourceFile });
      }
    } else {
      fixtures.push({
        ...(parsed as Omit<Fixture, '_source_file'>),
        _source_file: sourceFile,
      });
    }
  }

  return fixtures;
}

// ─── unionCovers ─────────────────────────────────────────────────────────────

interface CoverageUnion {
  state_schemas: Map<string, Set<string>>;
  return_value: Map<string, Set<string>>;
}

function unionCovers(fixtures: Fixture[]): CoverageUnion {
  const state_schemas = new Map<string, Set<string>>();
  const return_value = new Map<string, Set<string>>();

  for (const fixture of fixtures) {
    if (!fixture.covers) continue;

    if (fixture.covers.state_schemas) {
      for (const [schemaName, fields] of Object.entries(fixture.covers.state_schemas)) {
        if (!state_schemas.has(schemaName)) {
          state_schemas.set(schemaName, new Set());
        }
        for (const f of fields) {
          state_schemas.get(schemaName)!.add(f);
        }
      }
    }

    if (fixture.covers.return_value) {
      for (const [toolName, fields] of Object.entries(fixture.covers.return_value)) {
        if (!return_value.has(toolName)) {
          return_value.set(toolName, new Set());
        }
        for (const f of fields) {
          return_value.get(toolName)!.add(f);
        }
      }
    }
  }

  return { state_schemas, return_value };
}

// ─── checkSchemaFieldCoverage ─────────────────────────────────────────────────

function checkSchemaFieldCoverage(
  schemaFields: Map<string, string[]>,
  covered: CoverageUnion,
): MissingReport[] {
  const reports: MissingReport[] = [];

  for (const [schemaName, fields] of schemaFields.entries()) {
    const coveredFields = covered.state_schemas.get(schemaName) ?? new Set<string>();
    const missing = fields.filter((f) => !coveredFields.has(f));
    if (missing.length > 0) {
      reports.push({ schema: schemaName, missingFields: missing });
    }
  }

  return reports;
}

// ─── checkParamsAntiPattern ───────────────────────────────────────────────────

/**
 * For a single-action fixture, check whether every param key appears in
 * some postcondition assertion key (substring match).
 * Keys listed in uncovered_params are exempt.
 */
function getAssertionKeys(postcondition: PostconditionBlock | undefined): string[] {
  const keys: string[] = [];
  if (!postcondition) return keys;

  if (postcondition.return_value) {
    keys.push(...Object.keys(postcondition.return_value));
  }
  if (postcondition.state_files) {
    for (const assertions of Object.values(postcondition.state_files)) {
      if (assertions && typeof assertions === 'object') {
        keys.push(...Object.keys(assertions));
      }
    }
  }
  return keys;
}

function getStepAssertionKeys(step: StepBlock): string[] {
  const keys: string[] = [];
  if (step.assert_return) keys.push(...Object.keys(step.assert_return));
  if (step.assert_state) {
    for (const assertions of Object.values(step.assert_state)) {
      if (assertions && typeof assertions === 'object') {
        keys.push(...Object.keys(assertions));
      }
    }
  }
  return keys;
}

function paramIsCovered(paramKey: string, assertionKeys: string[]): boolean {
  return assertionKeys.some((ak) => ak.includes(paramKey));
}

function checkParamsAntiPattern(fixtures: Fixture[]): AntiPatternReport[] {
  const reports: AntiPatternReport[] = [];

  for (const fixture of fixtures) {
    const exempt = new Set(fixture.uncovered_params ?? []);

    if (fixture.action) {
      // Single-action fixture
      const paramKeys = Object.keys(fixture.action.params ?? {});
      const assertionKeys = getAssertionKeys(fixture.postcondition);
      const uncovered = paramKeys.filter(
        (k) => !exempt.has(k) && !paramIsCovered(k, assertionKeys),
      );
      if (uncovered.length > 0) {
        reports.push({
          fixture: fixture.test_id,
          sourceFile: fixture._source_file,
          uncoveredParams: uncovered,
        });
      }
    } else if (fixture.steps) {
      // Multi-step fixture: check each step's action params against that step's assertions
      const perStepUncovered: string[] = [];

      for (const step of fixture.steps) {
        if (!step.action) continue;
        const paramKeys = Object.keys(step.action.params ?? {});
        const assertionKeys = getStepAssertionKeys(step);
        const uncovered = paramKeys.filter(
          (k) => !exempt.has(k) && !paramIsCovered(k, assertionKeys),
        );
        perStepUncovered.push(...uncovered.filter((k) => !perStepUncovered.includes(k)));
      }

      if (perStepUncovered.length > 0) {
        reports.push({
          fixture: fixture.test_id,
          sourceFile: fixture._source_file,
          uncoveredParams: perStepUncovered,
        });
      }
    }
    // event-only fixtures have no action params to check
  }

  return reports;
}

// ─── main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const root = process.cwd();

  // 1. Load state schemas
  const schemaDir = path.join(root, 'conformance/state-schemas');
  const schemaFiles = await glob(path.join(schemaDir, '*.json'));

  const schemaFields = new Map<string, string[]>();
  for (const schemaFile of schemaFiles) {
    const raw = await readFile(schemaFile, 'utf-8');
    const schemaObj = JSON.parse(raw) as Record<string, unknown>;
    const schemaName = path.basename(schemaFile);
    const fields = leafFields(schemaObj);
    schemaFields.set(schemaName, fields);
  }

  // 2. Load fixtures
  const fixtures = await loadFixtures(root);

  // 3. Check for missing covers blocks
  const missingCovers = fixtures.filter((f) => !f.covers);
  if (missingCovers.length > 0) {
    console.error('✗ Fixtures missing required "covers" block:');
    for (const f of missingCovers) {
      console.error(`  ${f._source_file}: test_id="${f.test_id}"`);
    }
    process.exit(1);
  }

  // 4. Compute union of all covers
  const covered = unionCovers(fixtures);

  // 5. Check schema field coverage
  const coverageReports = checkSchemaFieldCoverage(schemaFields, covered);

  // 6. Check params anti-pattern
  const antiPatternReports = checkParamsAntiPattern(fixtures);

  // 7. Report
  let hasFailure = false;

  if (coverageReports.length > 0) {
    hasFailure = true;
    console.error('✗ Schema field coverage incomplete:');
    for (const r of coverageReports) {
      console.error(`  ${r.schema}: missing fields [${r.missingFields.join(', ')}]`);
    }
  }

  if (antiPatternReports.length > 0) {
    hasFailure = true;
    console.error('✗ Params anti-pattern detected (params not verified in postcondition):');
    for (const r of antiPatternReports) {
      console.error(`  ${r.sourceFile} (${r.fixture}): uncovered params [${r.uncoveredParams.join(', ')}]`);
    }
  }

  if (hasFailure) {
    process.exit(1);
  }

  // Compute totals for success message
  const totalFields = Array.from(schemaFields.values()).reduce((n, f) => n + f.length, 0);
  const totalFixtures = fixtures.length;
  console.log(
    `✓ All state-schema fields covered: ${schemaFields.size} schemas, ${totalFields} fields across ${totalFixtures} fixtures`,
  );
}

main().catch((err) => {
  console.error('Fatal error in conformance-coverage.ts:', err);
  process.exit(2);
});
