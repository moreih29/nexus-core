import * as z from "zod/v3";
import type { NxToolDefinition } from "../../shared/register-tool.js";

export const HISTORY_SCOPE_VALUES = [
  "all",
  "decision",
  "analysis",
  "task.acceptance",
  "task.approach",
  "task.risk",
  "task.result.outcome",
  "task.result.summary",
  "task.result.artifacts",
] as const;

export type HistoryScope = (typeof HISTORY_SCOPE_VALUES)[number];

export const historySearchTool = {
  group: "history",
  name: "nx_history_search",
  description:
    "Search archived cycles in .nexus/history.json or return the most recent entries",
  inputSchema: {
    query: z
      .string()
      .optional()
      .describe(
        "Full-text query applied to the specified scope. Omit for metadata-only listing.",
      ),
    last_n: z.coerce
      .number()
      .int()
      .positive()
      .optional()
      .describe(
        "When group_by_cycle=true (default): max number of matching cycles to return. When group_by_cycle=false: max number of hits. Defaults to 10.",
      ),
    scope: z
      .enum(HISTORY_SCOPE_VALUES)
      .optional()
      .describe(
        "Which fields to search. Defaults to 'all'. Options: 'decision', 'analysis', 'task.acceptance', 'task.approach', 'task.risk', 'task.result.outcome', 'task.result.summary', 'task.result.artifacts'.",
      ),
    mode: z
      .enum(["snippet", "full"])
      .optional()
      .describe(
        "Response shape when query is present. 'snippet' (default): hits[{cycle_id, path, excerpt}]. 'full': hits[{cycle_id, path, parent}] where parent is the containing issue or task object.",
      ),
    group_by_cycle: z
      .boolean()
      .optional()
      .describe(
        "When true (default), hits are grouped by cycle and last_n counts cycles. When false, last_n counts individual hits.",
      ),
  },
} satisfies NxToolDefinition;

export const historyToolDefinitions = [historySearchTool] as const;
