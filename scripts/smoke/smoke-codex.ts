// Issue #42 — agents/*.toml standalone schema 회귀 감지
// Verifies each dist/codex/agents/*.toml satisfies standalone role file schema.

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { findPackageRoot } from "../../src/shared/package-root.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const ROOT = findPackageRoot(__dirname);
const AGENTS_DIR = join(ROOT, "dist/codex/agents");

function fail(msg: string): never {
  process.stderr.write(`[smoke-codex] FAIL: ${msg}\n`);
  process.exit(1);
}

if (!existsSync(AGENTS_DIR)) {
  fail(`dist/codex/agents/ not found — run \`bun run build-agents\` (or nexus-core sync --harness=codex) first`);
}

const files = readdirSync(AGENTS_DIR).filter((f) => f.endsWith(".toml"));

if (files.length === 0) {
  fail(`no .toml files found in ${AGENTS_DIR}`);
}

const failures: string[] = [];

for (const file of files) {
  const filePath = join(AGENTS_DIR, file);
  const content = readFileSync(filePath, "utf-8");
  const fileErrors: string[] = [];

  // Assert standalone schema — root-level fields (no indentation)
  if (!/^name = "/m.test(content)) {
    fileErrors.push("missing root-level `name = \"...\"` line");
  }
  if (!/^description = "/m.test(content)) {
    fileErrors.push("missing root-level `description = \"...\"` line");
  }
  if (!/^developer_instructions = ("""|")/m.test(content)) {
    fileErrors.push("missing root-level `developer_instructions = ...` line");
  }
  // Detect nested [agents.<name>] header which signals old bundle schema
  if (/^\[agents\./m.test(content)) {
    fileErrors.push("contains `[agents.*]` section header — old bundle schema, should be standalone");
  }

  if (fileErrors.length > 0) {
    failures.push(`  ${file}:\n${fileErrors.map((e) => `    - ${e}`).join("\n")}`);
  }
}

if (failures.length > 0) {
  process.stderr.write(`[smoke-codex] FAIL: ${failures.length}/${files.length} file(s) failed schema check:\n`);
  process.stderr.write(failures.join("\n") + "\n");
  process.exit(1);
}

console.log(`[smoke-codex] PASS — ${files.length} file(s) passed standalone schema check`);
