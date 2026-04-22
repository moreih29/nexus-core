import * as z from "zod/v3";
import type { NxToolDefinition } from "../../shared/register-tool.js";

export const historySearchTool = {
  group: "history",
  name: "nx_history_search",
  description:
    "Search archived cycles in .nexus/history.json or return the most recent entries",
  inputSchema: {
    query: z
      .string()
      .optional()
      .describe("Full-text query applied to each archived cycle"),
    last_n: z
      .number()
      .optional()
      .describe("Maximum number of cycles to return. Defaults to 10"),
  },
} satisfies NxToolDefinition;

export const historyToolDefinitions = [historySearchTool] as const;
