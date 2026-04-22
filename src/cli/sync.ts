#!/usr/bin/env bun
import { resolve } from "node:path";
import { syncSpecsToTarget } from "../generate/sync.js";
import type { Harness } from "../generate/types.js";

type ParsedArgs = {
  harness: Harness;
  target: string;
  dryRun: boolean;
};

function parseArgs(argv: string[]): ParsedArgs {
  let harness: Harness | null = null;
  let target: string | null = null;
  let dryRun = false;

  for (const arg of argv) {
    if (arg === "--dry-run") {
      dryRun = true;
      continue;
    }
    if (arg.startsWith("--harness=")) {
      const value = arg.slice("--harness=".length);
      if (value === "claude" || value === "codex" || value === "opencode") {
        harness = value;
        continue;
      }
      throw new Error(`Unsupported harness "${value}"`);
    }
    if (arg.startsWith("--target=")) {
      target = arg.slice("--target=".length);
    }
  }

  if (!harness) {
    throw new Error(`Missing required flag --harness=<claude|codex|opencode>`);
  }
  if (!target) {
    throw new Error(`Missing required flag --target=<directory>`);
  }

  return {
    harness,
    target: resolve(target),
    dryRun,
  };
}

export function main(argv: string[] = process.argv.slice(2)): void {
  const parsed = parseArgs(argv);
  const result = syncSpecsToTarget(parsed);

  if (parsed.dryRun) {
    console.log(
      `[nexus-sync] dry-run: ${result.files.length} files would be generated`,
    );
    for (const file of result.files) {
      console.log(file.targetPath);
    }
    return;
  }

  console.log(
    `[nexus-sync] harness=${result.harness} wrote ${result.writtenFiles.length}/${result.files.length} files to ${result.targetRoot}`,
  );
}

const isDirectRun = import.meta.url === `file://${process.argv[1]}`;
if (isDirectRun) {
  try {
    main();
  } catch (error) {
    console.error("[nexus-sync] fatal:", error);
    process.exit(1);
  }
}
