import { readdirSync, statSync } from "node:fs";
import { mkdir, realpath, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { textResult } from "../../shared/mcp-utils.js";
import { findProjectRoot, getStateRoot } from "../../shared/paths.js";
import {
  type NxToolBinding,
  registerNxTools,
} from "../../shared/register-tool.js";
import {
  artifactListTool,
  artifactWriteTool,
} from "../definitions/artifact.js";

interface ArtifactWriteArgs {
  filename: string;
  content: string;
}

interface ArtifactListArgs {
  prefix?: string;
}

interface ArtifactEntry {
  filename: string;
  size: number;
  modified_at: string;
}

export function sanitizeName(input: string): string {
  const normalized = input.replace(/\\/g, "/");
  const segments = normalized
    .split("/")
    .filter((s) => s && s !== "." && s !== "..");
  if (segments.length === 0) {
    throw new Error("Invalid filename: empty after sanitize");
  }
  return segments.join("/");
}

function listArtifactsRecursive(dir: string, base: string): ArtifactEntry[] {
  const entries: ArtifactEntry[] = [];
  let items: string[];
  try {
    items = readdirSync(dir);
  } catch {
    return entries;
  }
  for (const item of items) {
    const fullPath = join(dir, item);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      const sub = listArtifactsRecursive(fullPath, base);
      entries.push(...sub);
    } else {
      entries.push({
        filename: relative(base, fullPath),
        size: stat.size,
        modified_at: stat.mtime.toISOString(),
      });
    }
  }
  return entries;
}

const artifactToolBindings: ReadonlyArray<NxToolBinding> = [
  {
    definition: artifactWriteTool,
    handler: async ({ filename, content }: ArtifactWriteArgs) => {
      const safeName = sanitizeName(filename);
      const artifactsDir = join(getStateRoot(), "artifacts");
      const outputPath = join(artifactsDir, safeName);
      const outputDir = dirname(outputPath);
      await mkdir(outputDir, { recursive: true });
      const realOutputDir = await realpath(outputDir);
      const realArtifactsDir = await realpath(artifactsDir);
      if (
        !realOutputDir.startsWith(`${realArtifactsDir}/`) &&
        realOutputDir !== realArtifactsDir
      ) {
        throw new Error("Security: resolved path escapes artifactsDir");
      }
      await writeFile(outputPath, content, "utf-8");
      const projectRoot = findProjectRoot();
      const relPath = relative(projectRoot, outputPath);
      return textResult({ success: true, path: relPath });
    },
  },
  {
    definition: artifactListTool,
    handler: async ({ prefix }: ArtifactListArgs) => {
      const artifactsDir = join(getStateRoot(), "artifacts");
      const all = listArtifactsRecursive(artifactsDir, artifactsDir);
      const artifacts =
        prefix !== undefined
          ? all.filter((entry) => entry.filename.startsWith(prefix))
          : all;
      return textResult({ artifacts });
    },
  },
];

export function registerArtifactTools(server: McpServer): void {
  registerNxTools(server, artifactToolBindings);
}
