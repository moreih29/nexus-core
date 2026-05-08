import { join } from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { readJsonFile } from "../../shared/json-store.js";
import { textResult } from "../../shared/mcp-utils.js";
import { getNexusRoot } from "../../shared/paths.js";
import {
  type NxToolBinding,
  registerNxTools,
} from "../../shared/register-tool.js";
import type {
  HistoryCycle,
  HistoryFile,
  PlanIssue,
  TaskItem,
} from "../../types/state.js";
import type { HistoryScope } from "../definitions/history.js";
import { historySearchTool } from "../definitions/history.js";

interface HistorySearchArgs {
  query?: string;
  last_n?: number;
  scope?: HistoryScope;
  mode?: "snippet" | "full";
  group_by_cycle?: boolean;
}

interface Hit {
  cycle_id: string;
  path: string;
  excerpt?: string;
  parent?: PlanIssue | TaskItem;
}

function snippetWindow(text: string, query: string, radius = 120): string {
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return text.slice(0, radius * 2);
  const start = Math.max(0, idx - radius);
  const end = Math.min(text.length, idx + query.length + radius);
  const prefix = start > 0 ? "…" : "";
  const suffix = end < text.length ? "…" : "";
  return `${prefix}${text.slice(start, end)}${suffix}`;
}

function extractCells(
  cycle: HistoryCycle,
  scope: HistoryScope,
): Array<{ path: string; text: string; parent: PlanIssue | TaskItem }> {
  const cells: Array<{
    path: string;
    text: string;
    parent: PlanIssue | TaskItem;
  }> = [];

  const issues = cycle.plan?.issues ?? [];
  const tasks = cycle.tasks ?? [];

  const includeDecision = scope === "all" || scope === "decision";
  const includeAnalysis = scope === "all" || scope === "analysis";
  const includeAcceptance = scope === "all" || scope === "task.acceptance";
  const includeApproach = scope === "all" || scope === "task.approach";
  const includeRisk = scope === "all" || scope === "task.risk";
  const includeOutcome = scope === "all" || scope === "task.result.outcome";
  const includeSummary = scope === "all" || scope === "task.result.summary";
  const includeArtifacts = scope === "all" || scope === "task.result.artifacts";

  for (const issue of issues) {
    if (includeDecision && issue.decision) {
      cells.push({
        path: `plan.issues[${issue.id}].decision`,
        text: issue.decision,
        parent: issue,
      });
    }
    if (includeAnalysis && issue.analysis) {
      for (let i = 0; i < issue.analysis.length; i++) {
        const entry = issue.analysis[i];
        if (entry) {
          cells.push({
            path: `plan.issues[${issue.id}].analysis[${i}].summary`,
            text: entry.summary,
            parent: issue,
          });
        }
      }
    }
  }

  for (const task of tasks) {
    if (includeAcceptance && task.acceptance) {
      cells.push({
        path: `tasks[${task.id}].acceptance`,
        text: task.acceptance,
        parent: task,
      });
    }
    if (includeApproach && task.approach) {
      cells.push({
        path: `tasks[${task.id}].approach`,
        text: task.approach,
        parent: task,
      });
    }
    if (includeRisk && task.risk) {
      cells.push({
        path: `tasks[${task.id}].risk`,
        text: task.risk,
        parent: task,
      });
    }
    if (task.result) {
      if (includeOutcome) {
        cells.push({
          path: `tasks[${task.id}].result.outcome`,
          text: task.result.outcome,
          parent: task,
        });
      }
      if (includeSummary) {
        cells.push({
          path: `tasks[${task.id}].result.summary`,
          text: task.result.summary,
          parent: task,
        });
      }
      if (includeArtifacts && task.result.artifacts) {
        for (let i = 0; i < task.result.artifacts.length; i++) {
          const artifact = task.result.artifacts[i];
          if (artifact) {
            cells.push({
              path: `tasks[${task.id}].result.artifacts[${i}]`,
              text: artifact,
              parent: task,
            });
          }
        }
      }
    }
  }

  return cells;
}

const historyToolBindings: ReadonlyArray<NxToolBinding> = [
  {
    definition: historySearchTool,
    handler: async ({
      query,
      last_n,
      scope = "all",
      mode = "snippet",
      group_by_cycle = true,
    }: HistorySearchArgs) => {
      const historyPath = join(getNexusRoot(), "history.json");
      const history = await readJsonFile<HistoryFile>(historyPath, {
        cycles: [],
      });
      const allCycles = Array.isArray(history.cycles) ? history.cycles : [];
      const limit = last_n ?? 10;

      if (!query || query.length === 0) {
        const reversed = [...allCycles].reverse();
        const showing = reversed.slice(0, limit);
        return textResult({
          total: allCycles.length,
          showing: showing.length,
          cycles: showing.map((c) => ({
            cycle_id: c.completed_at,
            branch: c.branch,
            completed_at: c.completed_at,
            plan_topic: c.plan?.topic,
            plan_issues_count: c.plan?.issues?.length ?? 0,
            tasks_count: c.tasks?.length ?? 0,
          })),
        });
      }

      const q = query.toLowerCase();
      const reversed = [...allCycles].reverse();

      if (group_by_cycle) {
        const cycleHits: Array<{ cycle_id: string; hits: Hit[] }> = [];

        for (const cycle of reversed) {
          const cycleId = cycle.completed_at;
          const cells = extractCells(cycle, scope);
          const matchingCells = cells.filter((cell) =>
            cell.text.toLowerCase().includes(q),
          );

          if (matchingCells.length > 0) {
            const hits: Hit[] = matchingCells.map((cell) => {
              if (mode === "full") {
                return {
                  cycle_id: cycleId,
                  path: cell.path,
                  parent: cell.parent,
                };
              }
              return {
                cycle_id: cycleId,
                path: cell.path,
                excerpt: snippetWindow(cell.text, query),
              };
            });
            cycleHits.push({ cycle_id: cycleId, hits });
          }

          if (cycleHits.length >= limit) break;
        }

        const allHits = cycleHits.flatMap((c) => c.hits);
        return textResult({
          total_cycles: cycleHits.length,
          total_hits: allHits.length,
          hits: allHits,
        });
      }

      const hits: Hit[] = [];
      for (const cycle of reversed) {
        if (hits.length >= limit) break;
        const cycleId = cycle.completed_at;
        const cells = extractCells(cycle, scope);
        for (const cell of cells) {
          if (hits.length >= limit) break;
          if (cell.text.toLowerCase().includes(q)) {
            if (mode === "full") {
              hits.push({
                cycle_id: cycleId,
                path: cell.path,
                parent: cell.parent,
              });
            } else {
              hits.push({
                cycle_id: cycleId,
                path: cell.path,
                excerpt: snippetWindow(cell.text, query),
              });
            }
          }
        }
      }

      return textResult({
        total_hits: hits.length,
        hits,
      });
    },
  },
];

export function registerHistoryTools(server: McpServer): void {
  registerNxTools(server, historyToolBindings);
}
