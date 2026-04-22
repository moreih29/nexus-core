import { mkdir, realpath, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { textResult } from "../../shared/mcp-utils.js";
import { findProjectRoot, getStateRoot } from "../../shared/paths.js";
import {
  type NxToolBinding,
  registerNxTools,
} from "../../shared/register-tool.js";
import { artifactWriteTool } from "../definitions/artifact.js";

interface ArtifactWriteArgs {
  filename: string;
  content: string;
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
];

export function registerArtifactTools(server: McpServer): void {
  registerNxTools(server, artifactToolBindings);
}
