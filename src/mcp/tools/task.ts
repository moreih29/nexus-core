import { z } from "zod";
import { join } from "node:path";
import fs from "node:fs";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getNexusRoot, getSessionRoot, getCurrentBranch, ensureDir } from "../../shared/paths.js";
import { readJsonFile, updateJsonFileLocked } from "../../shared/json-store.js";
import { textResult } from "../../shared/mcp-utils.js";
import { logToolCall } from "../../shared/tool-log.js";
import { TaskOwnerSchema, ResumeTierSchema } from "../../types/state.js";
import type { TaskItem, TasksFile, TaskOwner, HistoryFile, PlanFile, ResumeTier } from "../../types/state.js";

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function tasksPath(): string {
  return join(getSessionRoot(), "tasks.json");
}

function planPath(): string {
  return join(getSessionRoot(), "plan.json");
}

function historyPath(): string {
  return join(getNexusRoot(), "history.json");
}

const defaultTasksFile = (): TasksFile => ({ tasks: [] });

// Compute summary partition over all tasks (mutually exclusive).
// - in_progress: status === "in_progress"
// - completed: status === "completed"
// - blocked: status === "pending" AND has at least one dep that is NOT completed
// - ready: status === "pending" AND all deps are completed (or no deps)
function computeSummary(tasks: TaskItem[]): {
  total: number;
  in_progress: number[];
  completed: number[];
  blocked: number[];
  ready: number[];
} {
  const completedIds = new Set(tasks.filter((t) => t.status === "completed").map((t) => t.id));

  const in_progress: number[] = [];
  const completed: number[] = [];
  const blocked: number[] = [];
  const ready: number[] = [];

  for (const task of tasks) {
    if (task.status === "in_progress") {
      in_progress.push(task.id);
    } else if (task.status === "completed") {
      completed.push(task.id);
    } else {
      // pending
      const deps = task.deps ?? [];
      const allDepsComplete = deps.every((dep) => completedIds.has(dep));
      if (allDepsComplete) {
        ready.push(task.id);
      } else {
        blocked.push(task.id);
      }
    }
  }

  return { total: tasks.length, in_progress, completed, blocked, ready };
}

// ---------------------------------------------------------------------------
// registerTaskTools
// ---------------------------------------------------------------------------

export function registerTaskTools(server: McpServer): void {
  // -----------------------------------------------------------------------
  // nx_task_add
  // -----------------------------------------------------------------------
  server.tool(
    "nx_task_add",
    "새 task 추가 — tasks.json에 TaskItem 삽입",
    {
      title: z.string().describe("Task 제목"),
      context: z.string().describe("Task 컨텍스트 설명"),
      acceptance: z.string().describe("완료 조건 (DoD) — 필수"),
      approach: z.string().optional().describe("구현 접근법"),
      risk: z.string().optional().describe("알려진 리스크"),
      plan_issue: z.number().optional().describe("연관 plan issue ID"),
      deps: z.array(z.number()).optional().describe("선행 task ID 목록"),
      owner: TaskOwnerSchema.describe("소유자 정보 (role 필수)"),
      goal: z.string().optional().describe("tasks.json top-level goal 갱신"),
      decisions: z.array(z.string()).optional().describe("tasks.json top-level decisions append"),
    },
    async ({ title, context, acceptance, approach, risk, plan_issue, deps, owner, goal, decisions }) => {
      const t0 = Date.now();
      const tPath = tasksPath();

      let newTask!: TaskItem;

      await updateJsonFileLocked<TasksFile>(tPath, defaultTasksFile(), (data) => {
        if (goal !== undefined) {
          data.goal = goal;
        }
        if (decisions !== undefined && decisions.length > 0) {
          data.decisions = [...(data.decisions ?? []), ...decisions];
        }

        // Validate deps
        if (deps && deps.length > 0) {
          const existingIds = new Set(data.tasks.map((t) => t.id));
          for (let i = 0; i < deps.length; i++) {
            if (!existingIds.has(deps[i])) {
              throw new Error(`deps[${i}] does not exist: task id ${deps[i]} not found`);
            }
          }
        }

        const maxId = data.tasks.reduce((m, t) => Math.max(m, t.id), 0);
        newTask = {
          id: maxId + 1,
          title,
          status: "pending",
          context,
          acceptance,
          ...(approach !== undefined ? { approach } : {}),
          ...(risk !== undefined ? { risk } : {}),
          ...(plan_issue !== undefined ? { plan_issue } : {}),
          ...(deps !== undefined && deps.length > 0 ? { deps } : {}),
          owner,
          created_at: new Date().toISOString(),
        };

        data.tasks.push(newTask);
        return data;
      });

      const response = { task: newTask };
      logToolCall({ tool: "nx_task_add", args: { title, owner }, response, duration_ms: Date.now() - t0 });
      return textResult(response);
    }
  );

  // -----------------------------------------------------------------------
  // nx_task_list
  // -----------------------------------------------------------------------
  server.tool(
    "nx_task_list",
    "tasks.json 조회 — task 목록 및 summary 반환",
    {
      include_completed: z.boolean().optional().describe("완료 task 포함 여부 (기본 true)"),
    },
    async ({ include_completed = true }) => {
      const t0 = Date.now();
      const data = await readJsonFile<TasksFile | null>(tasksPath(), null);

      if (!data) {
        const response = { tasks: [], summary: { total: 0, in_progress: [], completed: [], blocked: [], ready: [] } };
        logToolCall({ tool: "nx_task_list", args: { include_completed }, response, duration_ms: Date.now() - t0 });
        return textResult(response);
      }

      // summary is always computed over ALL tasks regardless of include_completed
      const summary = computeSummary(data.tasks);

      const tasks = include_completed
        ? data.tasks
        : data.tasks.filter((t) => t.status !== "completed");

      const response: Record<string, unknown> = { tasks, summary };
      if (data.goal !== undefined) response.goal = data.goal;

      logToolCall({ tool: "nx_task_list", args: { include_completed }, response, duration_ms: Date.now() - t0 });
      return textResult(response);
    }
  );

  // -----------------------------------------------------------------------
  // nx_task_update
  // -----------------------------------------------------------------------

  // Update owner schema — role 갱신 불가, agent_id/resume_tier nullable
  const TaskOwnerUpdateSchema = z.object({
    agent_id: z.string().nullable().optional(),
    resume_tier: ResumeTierSchema.nullable().optional(),
  });

  server.tool(
    "nx_task_update",
    "Task status 또는 owner 메타데이터 부분 갱신",
    {
      id: z.number().describe("갱신할 task ID"),
      status: z.enum(["pending", "in_progress", "completed"]).optional().describe("새 상태"),
      owner: TaskOwnerUpdateSchema.optional().describe("owner 부분 갱신 (agent_id, resume_tier만 — role 갱신 불가)"),
    },
    async ({ id, status, owner }) => {
      const t0 = Date.now();
      const tPath = tasksPath();

      let updatedTask!: TaskItem;

      await updateJsonFileLocked<TasksFile>(tPath, defaultTasksFile(), (data) => {
        const task = data.tasks.find((t) => t.id === id);
        if (!task) throw new Error(`Task ${id} not found`);

        if (status !== undefined) {
          task.status = status;
        }

        if (owner !== undefined) {
          if ("agent_id" in owner) {
            const val = owner.agent_id;
            if (val === null || val === "") {
              delete (task.owner as Partial<TaskOwner>).agent_id;
            } else if (val !== undefined) {
              task.owner.agent_id = val;
            }
          }
          if ("resume_tier" in owner) {
            const val = owner.resume_tier;
            if (val === null) {
              delete (task.owner as Partial<TaskOwner>).resume_tier;
            } else if (val !== undefined) {
              task.owner.resume_tier = val as ResumeTier;
            }
          }
        }

        updatedTask = task;
        return data;
      });

      const response = { task: updatedTask };
      logToolCall({ tool: "nx_task_update", args: { id, status }, response, duration_ms: Date.now() - t0 });
      return textResult(response);
    }
  );

  // -----------------------------------------------------------------------
  // nx_task_close
  // -----------------------------------------------------------------------
  server.tool(
    "nx_task_close",
    "현재 사이클 종료 — history.json에 아카이브 후 plan.json·tasks.json 삭제",
    {},
    async () => {
      const t0 = Date.now();
      const tPath = tasksPath();
      const pPath = planPath();
      const hPath = historyPath();

      const tasksData = await readJsonFile<TasksFile | null>(tPath, null);
      const planData = await readJsonFile<PlanFile | null>(pPath, null);

      const tasks = tasksData?.tasks ?? [];
      const plan_id = planData?.id ?? null;
      const task_count = tasks.length;
      const incomplete_count = tasks.filter((t) => t.status !== "completed").length;

      // Append to history.json
      await updateJsonFileLocked<HistoryFile>(hPath, { cycles: [] }, (history) => {
        history.cycles.push({
          schema_version: "1.0",
          completed_at: new Date().toISOString(),
          branch: getCurrentBranch(),
          ...(planData ? { plan: planData } : {}),
          tasks,
        });
        return history;
      });

      // Unlink plan.json and tasks.json
      ensureDir(getNexusRoot());
      try { fs.unlinkSync(pPath); } catch { /* not present */ }
      try { fs.unlinkSync(tPath); } catch { /* not present */ }

      const response = { closed: true, plan_id, task_count, incomplete_count };
      logToolCall({ tool: "nx_task_close", args: {}, response, duration_ms: Date.now() - t0 });
      return textResult(response);
    }
  );

  // -----------------------------------------------------------------------
  // nx_task_resume
  // -----------------------------------------------------------------------
  server.tool(
    "nx_task_resume",
    "Task resume 라우팅 정보 조회 — owner.resume_tier 기반 정책 반환",
    {
      id: z.number().describe("조회할 task ID"),
    },
    async ({ id }) => {
      const t0 = Date.now();
      const data = await readJsonFile<TasksFile | null>(tasksPath(), null);

      if (!data) throw new Error(`Task ${id} not found`);

      const task = data.tasks.find((t) => t.id === id);
      if (!task) throw new Error(`Task ${id} not found`);

      const resumable = task.owner.resume_tier !== undefined && task.owner.resume_tier !== null;
      const agent_id = task.owner.agent_id ?? null;
      const resume_tier = task.owner.resume_tier ?? null;

      const response = {
        task_id: task.id,
        resumable,
        agent_id,
        resume_tier,
      };

      logToolCall({ tool: "nx_task_resume", args: { id }, response, duration_ms: Date.now() - t0 });
      return textResult(response);
    }
  );
}
