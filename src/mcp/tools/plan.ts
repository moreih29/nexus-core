import { z } from "zod";
import { join } from "node:path";
import fs from "node:fs";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getNexusRoot, getSessionRoot, getCurrentBranch, ensureDir } from "../../shared/paths.js";
import { readJsonFile, writeJsonFile, updateJsonFileLocked } from "../../shared/json-store.js";
import { textResult } from "../../shared/mcp-utils.js";
import { logToolCall } from "../../shared/tool-log.js";
import type { PlanFile, PlanIssue, PlanAnalysisEntry, HistoryFile } from "../../types/state.js";

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function planPath(): string {
  return join(getSessionRoot(), "plan.json");
}

function historyPath(): string {
  return join(getNexusRoot(), "history.json");
}

async function nextPlanId(): Promise<number> {
  const history = await readJsonFile<HistoryFile>(historyPath(), { cycles: [] });
  let maxId = 0;
  for (const cycle of history.cycles) {
    if (cycle.plan && typeof cycle.plan.id === "number") {
      maxId = Math.max(maxId, cycle.plan.id);
    }
  }
  return maxId + 1;
}

// ---------------------------------------------------------------------------
// registerPlanTools
// ---------------------------------------------------------------------------

export function registerPlanTools(server: McpServer): void {
  // -----------------------------------------------------------------------
  // nx_plan_start
  // -----------------------------------------------------------------------
  server.tool(
    "nx_plan_start",
    "새 플래닝 세션 시작 — 기존 plan.json 자동 아카이브",
    {
      topic: z.string().describe("플래닝 주제"),
      issues: z.array(z.string()).describe("안건 목록"),
      research_summary: z.string().describe("사전조사 결과 요약. 리서치 완료를 강제하기 위한 필수 파라미터."),
    },
    async ({ topic, issues, research_summary }) => {
      const t0 = Date.now();

      if (!research_summary || research_summary.trim() === "") {
        throw new Error("research_summary is required — complete research before starting a plan");
      }

      const hPath = historyPath();
      const pPath = planPath();

      // Read existing plan before locking to determine archive
      const existingRaw = await readJsonFile<PlanFile | null>(pPath, null);
      let previousArchived = false;

      if (existingRaw) {
        // Archive to history.json under file lock to avoid race with nx_task_close
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
            })
          );
        } catch {
          // best-effort — silently ignore archive failures
        }
        // Always unlink existing plan.json
        try {
          fs.unlinkSync(pPath);
        } catch {
          // ignore
        }
        previousArchived = true;
      }

      const planId = await nextPlanId();
      const now = new Date().toISOString();

      const newPlan: PlanFile = {
        id: planId,
        topic,
        issues: issues.map((title, i) => ({
          id: i + 1,
          title,
          status: "pending" as const,
        })),
        research_summary,
        created_at: now,
      };

      ensureDir(getSessionRoot());
      await writeJsonFile(pPath, newPlan);

      const response = { created: true, plan_id: planId, topic, issueCount: issues.length, previousArchived };
      logToolCall({ tool: "nx_plan_start", args: { topic, issueCount: issues.length }, response, duration_ms: Date.now() - t0 });
      return textResult(response);
    }
  );

  // -----------------------------------------------------------------------
  // nx_plan_status
  // -----------------------------------------------------------------------
  server.tool(
    "nx_plan_status",
    "현재 플래닝 상태 조회",
    {},
    async () => {
      const t0 = Date.now();
      const plan = await readJsonFile<PlanFile | null>(planPath(), null);

      if (!plan) {
        const response = { exists: false };
        logToolCall({ tool: "nx_plan_status", args: {}, response, duration_ms: Date.now() - t0 });
        return textResult(response);
      }

      const total = plan.issues.length;
      const pending = plan.issues.filter((i) => i.status === "pending").length;
      const decided = plan.issues.filter((i) => i.status === "decided").length;

      const response = {
        exists: true,
        id: plan.id,
        topic: plan.topic,
        summary: { total, pending, decided },
        issues: plan.issues.map((i) => ({
          id: i.id,
          title: i.title,
          status: i.status,
          ...(i.decision !== undefined ? { decision: i.decision } : {}),
        })),
      };
      logToolCall({ tool: "nx_plan_status", args: {}, response, duration_ms: Date.now() - t0 });
      return textResult(response);
    }
  );

  // -----------------------------------------------------------------------
  // nx_plan_update
  // -----------------------------------------------------------------------
  server.tool(
    "nx_plan_update",
    "안건 관리: 추가(add), 삭제(remove), 수정(modify), 재개(reopen)",
    {
      action: z.enum(["add", "remove", "modify", "reopen"]).describe("수행할 액션"),
      issue_id: z.number().optional().describe("대상 안건 ID (remove, modify, reopen에 필수)"),
      title: z.string().optional().describe("안건 제목 (add, modify에 필수)"),
    },
    async ({ action, issue_id, title }) => {
      const t0 = Date.now();
      const pPath = planPath();

      let result: Record<string, unknown> = {};

      await updateJsonFileLocked<PlanFile | null>(pPath, null, (raw) => {
        if (!raw) throw new Error("No active plan session");

        if (action === "add") {
          if (!title) throw new Error("title is required for add");
          const maxId = raw.issues.reduce((m, i) => Math.max(m, i.id), 0);
          const newIssue: PlanIssue = { id: maxId + 1, title, status: "pending" };
          raw.issues.push(newIssue);
          result = { updated: true, action, issue_id: newIssue.id, issue: newIssue };
          return raw;
        }

        if (action === "remove") {
          if (issue_id === undefined) throw new Error("issue_id is required for remove");
          const idx = raw.issues.findIndex((i) => i.id === issue_id);
          if (idx === -1) throw new Error(`Issue ${issue_id} not found`);
          const [removed] = raw.issues.splice(idx, 1);
          result = { updated: true, action, issue_id: removed.id };
          return raw;
        }

        if (action === "modify") {
          if (issue_id === undefined || !title) throw new Error("issue_id and title are required for modify");
          const issue = raw.issues.find((i) => i.id === issue_id);
          if (!issue) throw new Error(`Issue ${issue_id} not found`);
          issue.title = title;
          result = { updated: true, action, issue_id: issue.id, title: issue.title };
          return raw;
        }

        // reopen
        if (issue_id === undefined) throw new Error("issue_id is required for reopen");
        const issue = raw.issues.find((i) => i.id === issue_id);
        if (!issue) throw new Error(`Issue ${issue_id} not found`);
        issue.status = "pending";
        delete issue.decision;
        // analysis array is preserved intentionally
        result = { updated: true, action, issue_id: issue.id, status: issue.status };
        return raw;
      });

      logToolCall({ tool: "nx_plan_update", args: { action, issue_id, title }, response: result, duration_ms: Date.now() - t0 });
      return textResult(result);
    }
  );

  // -----------------------------------------------------------------------
  // nx_plan_decide
  // -----------------------------------------------------------------------
  server.tool(
    "nx_plan_decide",
    "안건 결정 기록",
    {
      issue_id: z.number().describe("결정할 안건 ID"),
      decision: z.string().describe("결정 내용"),
      how_agents: z.array(z.string()).optional().describe("이슈 분석에 참여한 HOW 에이전트 이름 목록"),
      how_summary: z.record(z.string(), z.string()).optional().describe("에이전트별 핵심 의견 요약"),
      how_agent_ids: z.record(z.string(), z.string()).optional().describe("에이전트 이름 → agentId 매핑"),
    },
    async ({ issue_id, decision, how_agents, how_summary, how_agent_ids }) => {
      const t0 = Date.now();
      const pPath = planPath();

      let responsePayload: Record<string, unknown> = {};

      await updateJsonFileLocked<PlanFile | null>(pPath, null, (raw) => {
        if (!raw) throw new Error("No active plan session");

        const issue = raw.issues.find((i) => i.id === issue_id);
        if (!issue) throw new Error(`Issue ${issue_id} not found`);
        if (issue.status === "decided") {
          throw new Error("이미 결정된 issue입니다. 재결정은 reopen 후 진행하세요.");
        }

        issue.status = "decided";
        issue.decision = decision;

        // Convert legacy how_* fields to analysis entries
        if (how_agents && how_agents.length > 0) {
          const now = new Date().toISOString();
          if (!issue.analysis) issue.analysis = [];
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

        const allComplete = raw.issues.every((i) => i.status === "decided");
        const remaining = raw.issues.filter((i) => i.status !== "decided");

        responsePayload = {
          decided: true,
          issue: { id: issue.id, title: issue.title, status: issue.status, decision: issue.decision },
          allComplete,
          remaining: remaining.map((i) => ({ id: i.id, title: i.title, status: i.status })),
          ...(allComplete ? { message: "모든 안건이 결정되었습니다. tasks.json으로 태스크를 생성하세요." } : {}),
        };

        return raw;
      });

      logToolCall({ tool: "nx_plan_decide", args: { issue_id, decision }, response: responsePayload, duration_ms: Date.now() - t0 });
      return textResult(responsePayload);
    }
  );

  // -----------------------------------------------------------------------
  // nx_plan_resume
  // -----------------------------------------------------------------------
  server.tool(
    "nx_plan_resume",
    "HOW 참가자 재개 라우팅 정보 조회",
    {
      role: z.string().describe("조회할 에이전트 역할"),
    },
    async ({ role }) => {
      const t0 = Date.now();
      const plan = await readJsonFile<PlanFile | null>(planPath(), null);

      if (!plan) {
        const response = { role, resumable: false, agent_id: null, resume_tier: null, issue_id: null };
        logToolCall({ tool: "nx_plan_resume", args: { role }, response, duration_ms: Date.now() - t0 });
        return textResult(response);
      }

      // Find latest analysis entry matching the role across all issues
      let latestEntry: PlanAnalysisEntry | null = null;
      let latestIssueId: number | null = null;
      let latestTime = "";

      for (const issue of plan.issues) {
        if (!issue.analysis) continue;
        for (const entry of issue.analysis) {
          if (entry.role === role && entry.recorded_at > latestTime) {
            latestTime = entry.recorded_at;
            latestEntry = entry;
            latestIssueId = issue.id;
          }
        }
      }

      const response = {
        role,
        resumable: latestEntry !== null,
        agent_id: latestEntry?.agent_id ?? null,
        resume_tier: null, // nexus-core MCP does not read agent frontmatter
        issue_id: latestIssueId,
      };

      logToolCall({ tool: "nx_plan_resume", args: { role }, response, duration_ms: Date.now() - t0 });
      return textResult(response);
    }
  );

  // -----------------------------------------------------------------------
  // nx_plan_analysis_add
  // -----------------------------------------------------------------------
  server.tool(
    "nx_plan_analysis_add",
    "안건에 분석 항목 추가",
    {
      issue_id: z.number().describe("대상 안건 ID"),
      role: z.string().describe("분석 에이전트 역할"),
      agent_id: z.string().optional().describe("에이전트 ID (resume용)"),
      summary: z.string().describe("분석 요약"),
    },
    async ({ issue_id, role, agent_id, summary }) => {
      const t0 = Date.now();
      const pPath = planPath();

      let responsePayload: Record<string, unknown> = {};

      await updateJsonFileLocked<PlanFile | null>(pPath, null, (raw) => {
        if (!raw) throw new Error("No active plan session");

        const issue = raw.issues.find((i) => i.id === issue_id);
        if (!issue) throw new Error(`Issue ${issue_id} not found`);

        if (!issue.analysis) issue.analysis = [];

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

      logToolCall({ tool: "nx_plan_analysis_add", args: { issue_id, role }, response: responsePayload, duration_ms: Date.now() - t0 });
      return textResult(responsePayload);
    }
  );
}
