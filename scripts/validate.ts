#!/usr/bin/env bun

import path from 'node:path';
import {
  loadSchemas,
  runAll as runSchemaAndIntegrity,
  type ValidationResult,
} from './lib/validate.ts';
import {
  checkHarnessSpecific,
  checkConcreteModel,
  checkPromptOnly,
} from './lib/lint.ts';
import {
  checkDirectoryStrict,
  checkIdMatch,
} from './lib/structure.ts';

const IS_GITHUB_ACTIONS = process.env.GITHUB_ACTIONS === 'true';

async function main(): Promise<void> {
  const root = process.cwd();
  const allResults: ValidationResult[] = [];

  // Gate 1-5: schema + referential integrity + manifest generation
  // (runAll internally does per-file fail-forward and generates manifest on success)
  await loadSchemas(root);
  const schemaResults = await runSchemaAndIntegrity(root);
  allResults.push(...schemaResults);

  // Gate 6: harness-specific tool names
  const harnessResults = await checkHarnessSpecific(root);
  allResults.push(...harnessResults);

  // Gate 7: concrete model names
  const modelResults = await checkConcreteModel(root);
  allResults.push(...modelResults);

  // Gate 8: prompt-only enforcement
  const promptOnlyResults = await checkPromptOnly(root);
  allResults.push(...promptOnlyResults);

  // Gate 9: directory strict
  const dirResults = await checkDirectoryStrict(root);
  allResults.push(...dirResults);

  // Gate 10: id ↔ directory name + kebab pattern
  const idResults = await checkIdMatch(root);
  allResults.push(...idResults);

  // Report
  const errors = allResults.filter((r) => r.severity === 'error');
  const warnings = allResults.filter((r) => r.severity === 'warning');

  if (allResults.length === 0) {
    console.log('All 10 validation gates passed.');
    return;
  }

  if (IS_GITHUB_ACTIONS) {
    // GitHub annotations format
    for (const r of allResults) {
      const level = r.severity === 'error' ? 'error' : 'warning';
      const lineAttr = r.line ? `,line=${r.line}` : '';
      console.log(`::${level} file=${r.file}${lineAttr}::[${r.gate}] ${r.message}`);
    }
  } else {
    // Human-readable format
    for (const r of allResults) {
      const loc = r.line ? `${r.file}:${r.line}` : r.file;
      console.log(`${loc}  [${r.gate}] ${r.severity.toUpperCase()}: ${r.message}`);
    }
    console.log('');
    console.log(`Summary: ${errors.length} error(s), ${warnings.length} warning(s)`);
  }

  if (errors.length > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Fatal error in validate.ts:', err);
  process.exit(2);
});
