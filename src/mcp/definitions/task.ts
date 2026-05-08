import * as z from "zod/v3";
import type { NxToolDefinition } from "../../shared/register-tool.js";
import { ResumeTierSchema, TaskOwnerSchema } from "../../types/state.js";

const TaskOwnerUpdateSchema = z.object({
  agent_id: z.string().nullable().optional(),
  resume_tier: ResumeTierSchema.nullable().optional(),
});

const TaskResultInputSchema = z.object({
  outcome: z.enum(["success", "failure", "partial"]),
  summary: z.string(),
  artifacts: z.array(z.string()).optional(),
});

export const taskAddTool = {
  group: "task",
  name: "nx_task_add",
  description: "Add a new task to tasks.json",
  inputSchema: {
    title: z.string().describe("Task title"),
    context: z.string().describe("Task context"),
    acceptance: z.string().describe("Definition of done. Required"),
    approach: z.string().optional().describe("Implementation approach"),
    risk: z.string().optional().describe("Known risk"),
    plan_issue: z.coerce
      .number()
      .int()
      .positive()
      .optional()
      .describe("Related plan issue ID"),
    deps: z
      .array(z.coerce.number().int().positive())
      .optional()
      .describe("List of dependency task IDs"),
    owner: TaskOwnerSchema.describe("Owner metadata. role is required"),
    goal: z
      .string()
      .optional()
      .describe("Replace the top-level goal in tasks.json"),
    decisions: z
      .array(z.string())
      .optional()
      .describe("Append entries to the top-level decisions list in tasks.json"),
  },
} satisfies NxToolDefinition;

export const taskListTool = {
  group: "task",
  name: "nx_task_list",
  description: "Read tasks.json and return the task list with a summary",
  inputSchema: {
    include_completed: z
      .boolean()
      .optional()
      .describe("Whether to include completed tasks. Defaults to true"),
  },
} satisfies NxToolDefinition;

export const taskUpdateTool = {
  group: "task",
  name: "nx_task_update",
  description:
    "Partially update a task. Updatable fields: status, acceptance, approach, risk, owner (agent_id/resume_tier only), result (outcome/summary/artifacts). result.recorded_at is always set by the server. id, title, context, deps, created_at, owner.role are immutable — to change identity-carrying fields, delete and re-add the task instead.",
  inputSchema: {
    id: z.coerce.number().int().positive().describe("Task ID to update"),
    status: z
      .enum(["pending", "in_progress", "completed"])
      .optional()
      .describe("New status"),
    acceptance: z.string().optional().describe("New acceptance criteria"),
    approach: z.string().optional().describe("New approach"),
    risk: z.string().optional().describe("New risk description"),
    owner: TaskOwnerUpdateSchema.optional().describe(
      "Partial owner update. Only agent_id and resume_tier are allowed; role cannot be changed",
    ),
    result: TaskResultInputSchema.optional().describe(
      "Task result. recorded_at is set by the server and must not be supplied",
    ),
  },
} satisfies NxToolDefinition;

export const taskCloseTool = {
  group: "task",
  name: "nx_task_close",
  description:
    "Close the current cycle, archive it to history.json, and remove plan.json and tasks.json. Throws if any tasks are incomplete unless force is true.",
  inputSchema: {
    force: z
      .boolean()
      .optional()
      .describe(
        "Skip the incomplete-task guard and close anyway. Defaults to false.",
      ),
  },
} satisfies NxToolDefinition;

export const taskResumeTool = {
  group: "task",
  name: "nx_task_resume",
  description: "Get task resume routing information based on owner.resume_tier",
  inputSchema: {
    id: z.coerce.number().int().positive().describe("Task ID to look up"),
  },
} satisfies NxToolDefinition;

export const taskToolDefinitions = [
  taskAddTool,
  taskListTool,
  taskUpdateTool,
  taskCloseTool,
  taskResumeTool,
] as const;
