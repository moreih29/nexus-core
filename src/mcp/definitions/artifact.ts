import * as z from "zod/v3";
import type { NxToolDefinition } from "../../shared/register-tool.js";

export const artifactWriteTool = {
  group: "artifact",
  name: "nx_artifact_write",
  description: "Write an artifact to the state artifacts directory",
  inputSchema: {
    filename: z
      .string()
      .describe("Artifact path relative to the artifacts directory"),
    content: z.string().describe("File content"),
  },
} satisfies NxToolDefinition;

export const artifactListTool = {
  group: "artifact",
  name: "nx_artifact_list",
  description: "List artifacts in the state artifacts directory",
  inputSchema: {
    prefix: z
      .string()
      .optional()
      .describe(
        "Filter results to filenames that start with this prefix. Omit to list all artifacts.",
      ),
  },
} satisfies NxToolDefinition;

export const artifactToolDefinitions = [
  artifactWriteTool,
  artifactListTool,
] as const;
