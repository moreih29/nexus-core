import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  loadHarnessInvocationMap,
  loadHarnessLayout,
  loadInvocationCatalog,
} from "./load-data.js";
import { loadSpecDocuments } from "./load-spec.js";
import { expandMacrosForHarness } from "./macros/expand.js";
import { renderClaudeDocument } from "./renderers/claude.js";
import { renderCodexDocument } from "./renderers/codex.js";
import { renderOpencodeDocument } from "./renderers/opencode.js";
import type {
  GeneratedFile,
  Harness,
  SpecDocument,
  SyncOptions,
  SyncResult,
} from "./types.js";

function formatPath(template: string, document: SpecDocument): string {
  return template.replaceAll("{id}", document.id);
}

function renderDocument(
  harness: Harness,
  document: SpecDocument,
  expandedBody: string,
): string {
  if (harness === "claude") {
    return renderClaudeDocument(document, expandedBody);
  }
  if (harness === "codex") {
    return renderCodexDocument(document, expandedBody);
  }
  return renderOpencodeDocument(document, expandedBody);
}

export function buildGeneratedFiles(
  harness: Harness,
  target: string,
): GeneratedFile[] {
  const layout = loadHarnessLayout(harness);
  const invocationCatalog = loadInvocationCatalog();
  const invocationMap = loadHarnessInvocationMap(harness);

  return loadSpecDocuments().map((document) => {
    const expandedBody = expandMacrosForHarness(
      document.body,
      harness,
      invocationCatalog,
      invocationMap,
    );
    const content = renderDocument(harness, document, expandedBody);
    return {
      kind: document.kind,
      sourcePath: document.sourcePath,
      targetPath: join(
        target,
        formatPath(layout.paths[document.kind], document),
      ),
      content,
    };
  });
}

export function syncSpecsToTarget(options: SyncOptions): SyncResult {
  const targetRoot = options.target;
  const files = buildGeneratedFiles(options.harness, targetRoot);
  const writtenFiles: string[] = [];

  if (!options.dryRun) {
    mkdirSync(targetRoot, { recursive: true });

    for (const file of files) {
      mkdirSync(dirname(file.targetPath), { recursive: true });
      const current = existsSync(file.targetPath)
        ? readFileSync(file.targetPath, "utf8")
        : null;
      if (current === file.content) continue;
      writeFileSync(file.targetPath, file.content, "utf8");
      writtenFiles.push(file.targetPath);
    }
  }

  return {
    harness: options.harness,
    targetRoot,
    files,
    writtenFiles,
  };
}
