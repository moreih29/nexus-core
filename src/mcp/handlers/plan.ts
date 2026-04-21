import fs from "node:fs";
import { join } from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  readJsonFile,
  updateJsonFileLocked,
  writeJsonFile,
} from "../../shared/json-store.js";
import { textResult } from "../../shared/mcp-utils.js";
import {
  ensureDir,
  getCurrentBranch,
  getNexusRoot,
  getStateRoot,
} from "../../shared/paths.js";
import {
  type NxToolBinding,
  registerNxTools,
} from "../../shared/register-tool.js";
import type {
  HistoryFile,
  PlanAnalysisEntry,
  PlanFile,
  PlanIssue,
} from "../../types/state.js";
import {
  planAnalysisAddTool,
  planDecideTool,
  planResumeTool,
  planStartTool,
  planStatusTool,
  planUpdateTool,
} from "../definitions/plan.js";

interface PlanStartArgs {
  topic: string;
  issues: string[];
  research_summary: string;
}

interface PlanUpdateArgs {
  action: "add" | "remove" | "modify" | "reopen";
  issue_id?: number;
  title?: string;
}

interface PlanDecideArgs {
  issue_id: number;
  decision: string;
  how_agents?: string[];
  how_summary?: Record<string, string>;
  how_agent_ids?: Record<string, string>;
}

interface PlanResumeArgs {
  role: string;
}

interface PlanAnalysisAddArgs {
  issue_id: number;
  role: string;
  agent_id?: string;
  summary: string;
}

function planPath(): string {
  return join(getStateRoot(), "plan.json");
}

function historyPath(): string {
  return join(getNexusRoot(), "history.json");
}

async function nextPlanId(): Promise<number> {
  const history = await readJsonFile<HistoryFile>(historyPath(), {
    cycles: [],
  });
  let maxId = 0;
  for (const cycle of history.cycles) {
    if (cycle.plan && typeof cycle.plan.id === "number") {
      maxId = Math.max(maxId, cycle.plan.id);
    }
  }
  return maxId + 1;
}

const planToolBindings: ReadonlyArray<NxToolBinding> = [
  {
    definition: planStartTool,
    handler: async ({ topic, issues, research_summary }: PlanStartArgs) => {
      if (!research_summary || research_summary.trim() === "") {
        throw new Error(
          "research_summary is required — complete research before starting a plan",
        );
      }

      const hPath = historyPath();
      const pPath = planPath();
      const existingRaw = await readJsonFile<PlanFile | null>(pPath, null);
      let previousArchived = false;

      if (existingRaw) {
        try {
          ensureDir(getNexusRoot());
          await updateJsonFileLocked<HistoryFile>(
            hPath,
            { cycles: [] },
            (history) => ({
              ...history,
              cycles: [
                ...(Array.isArray(history.cycles) ? history.cycles : []),
                {
                  completed_at: new Date().toISOString(),
                  branch: getCurrentBranch(),
                  plan: existingRaw,
                  tasks: [],
                },
              ],
            }),
          );
        } catch {}

        try {
          fs.unlinkSync(pPath);
        } catch {}
        previousArchived = true;
      }

      const planId = await nextPlanId();
      const now = new Date().toISOString();
      const newPlan: PlanFile = {
        id: planId,
        topic,
        issues: issues.map((title, index) => ({
          id: index + 1,
          title,
          status: "pending" as const,
        })),
        research_summary,
        created_at: now,
      };

      ensureDir(getStateRoot());
      await writeJsonFile(pPath, newPlan);

      return textResult({
        created: true,
        plan_id: planId,
        topic,
        issueCount: issues.length,
        previousArchived,
      });
    },
  },
  {
    definition: planStatusTool,
    handler: async () => {
      const plan = await readJsonFile<PlanFile | null>(planPath(), null);

      if (!plan) {
        return textResult({ exists: false });
      }

      const total = plan.issues.length;
      const pending = plan.issues.filter(
        (issue) => issue.status === "pending",
      ).length;
      const decided = plan.issues.filter(
        (issue) => issue.status === "decided",
      ).length;
      return textResult({
        exists: true,
        id: plan.id,
        topic: plan.topic,
        summary: { total, pending, decided },
        issues: plan.issues.map((issue) => ({
          id: issue.id,
          title: issue.title,
          status: issue.status,
          ...(issue.decision !== undefined ? { decision: issue.decision } : {}),
        })),
      });
    },
  },
  {
    definition: planUpdateTool,
    handler: async ({ action, issue_id, title }: PlanUpdateArgs) => {
      const pPath = planPath();
      let result: Record<string, unknown> = {};

      await updateJsonFileLocked<PlanFile | null>(pPath, null, (raw) => {
        if (!raw) {
          throw new Error("No active plan");
        }

        if (action === "add") {
          if (!title) {
            throw new Error("title is required for add");
          }
          const maxId = raw.issues.reduce(
            (m, issue) => Math.max(m, issue.id),
            0,
          );
          const newIssue: PlanIssue = {
            id: maxId + 1,
            title,
            status: "pending",
          };
          raw.issues.push(newIssue);
          result = {
            updated: true,
            action,
            issue_id: newIssue.id,
            issue: newIssue,
          };
          return raw;
        }

        if (action === "remove") {
          if (issue_id === undefined) {
            throw new Error("issue_id is required for remove");
          }
          const index = raw.issues.findIndex((issue) => issue.id === issue_id);
          if (index === -1) {
            throw new Error(`Issue ${issue_id} not found`);
          }
          const [removed] = raw.issues.splice(index, 1);
          result = { updated: true, action, issue_id: removed.id };
          return raw;
        }

        if (action === "modify") {
          if (issue_id === undefined || !title) {
            throw new Error("issue_id and title are required for modify");
          }
          const issue = raw.issues.find(
            (candidate) => candidate.id === issue_id,
          );
          if (!issue) {
            throw new Error(`Issue ${issue_id} not found`);
          }
          issue.title = title;
          result = {
            updated: true,
            action,
            issue_id: issue.id,
            title: issue.title,
          };
          return raw;
        }

        if (issue_id === undefined) {
          throw new Error("issue_id is required for reopen");
        }
        const issue = raw.issues.find((candidate) => candidate.id === issue_id);
        if (!issue) {
          throw new Error(`Issue ${issue_id} not found`);
        }
        issue.status = "pending";
        delete issue.decision;
        result = {
          updated: true,
          action,
          issue_id: issue.id,
          status: issue.status,
        };
        return raw;
      });

      return textResult(result);
    },
  },
  {
    definition: planDecideTool,
    handler: async ({
      issue_id,
      decision,
      how_agents,
      how_summary,
      how_agent_ids,
    }: PlanDecideArgs) => {
      const pPath = planPath();
      let responsePayload: Record<string, unknown> = {};

      await updateJsonFileLocked<PlanFile | null>(pPath, null, (raw) => {
        if (!raw) {
          throw new Error("No active plan");
        }

        const issue = raw.issues.find((candidate) => candidate.id === issue_id);
        if (!issue) {
          throw new Error(`Issue ${issue_id} not found`);
        }
        if (issue.status === "decided") {
          throw new Error(
            "이미 결정된 issue입니다. 재결정은 reopen 후 진행하세요.",
          );
        }

        issue.status = "decided";
        issue.decision = decision;

        if (how_agents && how_agents.length > 0) {
          const now = new Date().toISOString();
          if (!issue.analysis) {
            issue.analysis = [];
          }
          for (const agentName of how_agents) {
            const entry: PlanAnalysisEntry = {
              role: agentName,
              summary: how_summary?.[agentName] ?? "",
              recorded_at: now,
            };
            if (how_agent_ids?.[agentName]) {
              entry.agent_id = how_agent_ids[agentName];
            }
            issue.analysis.push(entry);
          }
        }

        const allComplete = raw.issues.every(
          (candidate) => candidate.status === "decided",
        );
        const remaining = raw.issues.filter(
          (candidate) => candidate.status !== "decided",
        );
        responsePayload = {
          decided: true,
          issue: {
            id: issue.id,
            title: issue.title,
            status: issue.status,
            decision: issue.decision,
          },
          allComplete,
          remaining: remaining.map((candidate) => ({
            id: candidate.id,
            title: candidate.title,
            status: candidate.status,
          })),
          ...(allComplete
            ? {
                message:
                  "모든 안건이 결정되었습니다. tasks.json으로 태스크를 생성하세요.",
              }
            : {}),
        };

        return raw;
      });

      return textResult(responsePayload);
    },
  },
  {
    definition: planResumeTool,
    handler: async ({ role }: PlanResumeArgs) => {
      const plan = await readJsonFile<PlanFile | null>(planPath(), null);

      if (!plan) {
        return textResult({
          role,
          resumable: false,
          agent_id: null,
          resume_tier: null,
          issue_id: null,
        });
      }

      let latestEntry: PlanAnalysisEntry | null = null;
      let latestIssueId: number | null = null;
      let latestTime = "";

      for (const issue of plan.issues) {
        if (!issue.analysis) {
          continue;
        }
        for (const entry of issue.analysis) {
          if (entry.role === role && entry.recorded_at > latestTime) {
            latestTime = entry.recorded_at;
            latestEntry = entry;
            latestIssueId = issue.id;
          }
        }
      }

      return textResult({
        role,
        resumable: latestEntry !== null,
        agent_id: latestEntry?.agent_id ?? null,
        resume_tier: null,
        issue_id: latestIssueId,
      });
    },
  },
  {
    definition: planAnalysisAddTool,
    handler: async ({
      issue_id,
      role,
      agent_id,
      summary,
    }: PlanAnalysisAddArgs) => {
      const pPath = planPath();
      let responsePayload: Record<string, unknown> = {};

      await updateJsonFileLocked<PlanFile | null>(pPath, null, (raw) => {
        if (!raw) {
          throw new Error("No active plan");
        }

        const issue = raw.issues.find((candidate) => candidate.id === issue_id);
        if (!issue) {
          throw new Error(`Issue ${issue_id} not found`);
        }

        if (!issue.analysis) {
          issue.analysis = [];
        }

        const recorded_at = new Date().toISOString();
        const entry: PlanAnalysisEntry = {
          role,
          summary,
          recorded_at,
          ...(agent_id !== undefined ? { agent_id } : {}),
        };
        issue.analysis.push(entry);

        responsePayload = {
          added: true,
          issue_id,
          role,
          recorded_at,
          total_entries: issue.analysis.length,
        };

        return raw;
      });

      return textResult(responsePayload);
    },
  },
];

export function registerPlanTools(server: McpServer): void {
  registerNxTools(server, planToolBindings);
}
