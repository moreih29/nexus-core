import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { mkdir, realpath, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { findProjectRoot, getSessionRoot } from "../../shared/paths.js";
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
      const sessionRoot = getSessionRoot();
      const artifactsDir = join(sessionRoot, "artifacts");
      const outputPath = join(artifactsDir, safeName);
      const outputDir = dirname(outputPath);
      // [TEST-DIAG]
      if (process.env.NEXUS_SESSION_ID === "artifact-test-session") {
        console.log("[TEST-DIAG:artifact.ts:handler]",
          "cwd=", process.cwd(),
          "| projectRoot=", findProjectRoot(),
          "| sessionRoot=", sessionRoot,
          "| outputDir=", outputDir,
        );
      }
      await mkdir(outputDir, { recursive: true });
      // Resolve symlinks in the output directory and verify it stays inside artifactsDir
      const realOutputDir = await realpath(outputDir);
      const realArtifactsDir = await realpath(artifactsDir);
      if (!realOutputDir.startsWith(realArtifactsDir + "/") && realOutputDir !== realArtifactsDir) {
        throw new Error("Security: resolved path escapes artifactsDir");
      }
      await writeFile(outputPath, content, "utf-8");
      const projectRoot = findProjectRoot();
      const relPath = relative(projectRoot, outputPath);
      return textResult({ success: true, path: relPath });
    }
  );
}
