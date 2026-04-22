import fs from "node:fs";
import { join } from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { readJsonFile, updateJsonFileLocked } from "../../shared/json-store.js";
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
  PlanFile,
  ResumeTier,
  TaskItem,
  TaskOwner,
  TasksFile,
} from "../../types/state.js";
import {
  taskAddTool,
  taskCloseTool,
  taskListTool,
  taskResumeTool,
  taskUpdateTool,
} from "../definitions/task.js";

type TaskStatus = "pending" | "in_progress" | "completed";

interface TaskAddArgs {
  title: string;
  context: string;
  acceptance: string;
  approach?: string;
  risk?: string;
  plan_issue?: number;
  deps?: number[];
  owner: TaskOwner;
  goal?: string;
  decisions?: string[];
}

interface TaskListArgs {
  include_completed?: boolean;
}

interface TaskOwnerUpdate {
  agent_id?: string | null;
  resume_tier?: ResumeTier | null;
}

interface TaskUpdateArgs {
  id: number;
  status?: TaskStatus;
  owner?: TaskOwnerUpdate;
}

interface TaskResumeArgs {
  id: number;
}

function tasksPath(): string {
  return join(getStateRoot(), "tasks.json");
}

function planPath(): string {
  return join(getStateRoot(), "plan.json");
}

function historyPath(): string {
  return join(getNexusRoot(), "history.json");
}

const defaultTasksFile = (): TasksFile => ({ tasks: [] });

function computeSummary(tasks: TaskItem[]): {
  total: number;
  in_progress: number[];
  completed: number[];
  blocked: number[];
  ready: number[];
} {
  const completedIds = new Set(
    tasks.filter((t) => t.status === "completed").map((t) => t.id),
  );

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

const taskToolBindings: ReadonlyArray<NxToolBinding> = [
  {
    definition: taskAddTool,
    handler: async ({
      title,
      context,
      acceptance,
      approach,
      risk,
      plan_issue,
      deps,
      owner,
      goal,
      decisions,
    }: TaskAddArgs) => {
      const tPath = tasksPath();

      let newTask!: TaskItem;

      await updateJsonFileLocked<TasksFile>(
        tPath,
        defaultTasksFile(),
        (data) => {
          if (goal !== undefined) {
            data.goal = goal;
          }
          if (decisions !== undefined && decisions.length > 0) {
            data.decisions = [...(data.decisions ?? []), ...decisions];
          }

          if (deps && deps.length > 0) {
            const existingIds = new Set(data.tasks.map((t) => t.id));
            for (let i = 0; i < deps.length; i += 1) {
              if (!existingIds.has(deps[i])) {
                throw new Error(
                  `deps[${i}] does not exist: task id ${deps[i]} not found`,
                );
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
        },
      );

      return textResult({ task: newTask });
    },
  },
  {
    definition: taskListTool,
    handler: async ({ include_completed = true }: TaskListArgs) => {
      const data = await readJsonFile<TasksFile | null>(tasksPath(), null);

      if (!data) {
        return textResult({
          tasks: [],
          summary: {
            total: 0,
            in_progress: [],
            completed: [],
            blocked: [],
            ready: [],
          },
        });
      }

      const summary = computeSummary(data.tasks);
      const tasks = include_completed
        ? data.tasks
        : data.tasks.filter((t) => t.status !== "completed");

      const response: Record<string, unknown> = { tasks, summary };
      if (data.goal !== undefined) {
        response.goal = data.goal;
      }
      return textResult(response);
    },
  },
  {
    definition: taskUpdateTool,
    handler: async ({ id, status, owner }: TaskUpdateArgs) => {
      const tPath = tasksPath();

      let updatedTask!: TaskItem;

      await updateJsonFileLocked<TasksFile>(
        tPath,
        defaultTasksFile(),
        (data) => {
          const task = data.tasks.find((candidate) => candidate.id === id);
          if (!task) {
            throw new Error(`Task ${id} not found`);
          }

          if (status !== undefined) {
            task.status = status;
          }

          if (owner !== undefined) {
            if ("agent_id" in owner) {
              const value = owner.agent_id;
              if (value === null || value === "") {
                delete (task.owner as Partial<TaskOwner>).agent_id;
              } else if (value !== undefined) {
                task.owner.agent_id = value;
              }
            }

            if ("resume_tier" in owner) {
              const value = owner.resume_tier;
              if (value === null) {
                delete (task.owner as Partial<TaskOwner>).resume_tier;
              } else if (value !== undefined) {
                task.owner.resume_tier = value as ResumeTier;
              }
            }
          }

          updatedTask = task;
          return data;
        },
      );

      return textResult({ task: updatedTask });
    },
  },
  {
    definition: taskCloseTool,
    handler: async () => {
      const tPath = tasksPath();
      const pPath = planPath();
      const hPath = historyPath();

      const tasksData = await readJsonFile<TasksFile | null>(tPath, null);
      const planData = await readJsonFile<PlanFile | null>(pPath, null);

      const tasks = tasksData?.tasks ?? [];
      const plan_id = planData?.id ?? null;
      const task_count = tasks.length;
      const incomplete_count = tasks.filter(
        (task) => task.status !== "completed",
      ).length;

      await updateJsonFileLocked<HistoryFile>(
        hPath,
        { cycles: [] },
        (history) => {
          history.cycles.push({
            schema_version: "1.0",
            completed_at: new Date().toISOString(),
            branch: getCurrentBranch(),
            ...(planData ? { plan: planData } : {}),
            tasks,
          });
          return history;
        },
      );

      ensureDir(getNexusRoot());
      try {
        fs.unlinkSync(pPath);
      } catch {}
      try {
        fs.unlinkSync(tPath);
      } catch {}

      return textResult({
        closed: true,
        plan_id,
        task_count,
        incomplete_count,
      });
    },
  },
  {
    definition: taskResumeTool,
    handler: async ({ id }: TaskResumeArgs) => {
      const data = await readJsonFile<TasksFile | null>(tasksPath(), null);

      if (!data) {
        throw new Error(`Task ${id} not found`);
      }

      const task = data.tasks.find((candidate) => candidate.id === id);
      if (!task) {
        throw new Error(`Task ${id} not found`);
      }

      const resumable =
        task.owner.resume_tier !== undefined && task.owner.resume_tier !== null;
      const agent_id = task.owner.agent_id ?? null;
      const resume_tier = task.owner.resume_tier ?? null;

      return textResult({
        task_id: task.id,
        resumable,
        agent_id,
        resume_tier,
      });
    },
  },
];

export function registerTaskTools(server: McpServer): void {
  registerNxTools(server, taskToolBindings);
}
