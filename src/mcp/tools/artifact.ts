import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { findProjectRoot, getNexusRoot } from "../../shared/paths.js";
import { textResult } from "../../shared/mcp-utils.js";

export function sanitizeName(input: string): string {
  const normalized = input.replace(/\\/g, "/");
  const segments = normalized.split("/").filter((s) => s && s !== "." && s !== "..");
  if (segments.length === 0) {
    throw new Error("Invalid filename: empty after sanitize");
  }
  return segments.join("/");
}

export function registerArtifactTools(server: McpServer): void {
  server.tool(
    "nx_artifact_write",
    "Write a team artifact (report, synthesis, analysis) to the project's nexus state",
    {
      filename: z.string().describe("Filename to write (e.g. 'findings.md', 'sub/synthesis.md')"),
      content: z.string().describe("File content"),
    },
    async ({ filename, content }) => {
      const safeName = sanitizeName(filename);
      const artifactsDir = join(getNexusRoot(), "state", "artifacts");
      const outputPath = join(artifactsDir, safeName);
      await mkdir(dirname(outputPath), { recursive: true });
      await writeFile(outputPath, content, "utf-8");
      const projectRoot = findProjectRoot();
      const relPath = relative(projectRoot, outputPath);
      return textResult({ success: true, path: relPath });
    }
  );
}
