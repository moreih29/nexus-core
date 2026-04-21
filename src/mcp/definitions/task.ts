import * as z from "zod/v3";
import type { NxToolDefinition } from "../../shared/register-tool.js";
import { ResumeTierSchema, TaskOwnerSchema } from "../../types/state.js";

const TaskOwnerUpdateSchema = z.object({
  agent_id: z.string().nullable().optional(),
  resume_tier: ResumeTierSchema.nullable().optional(),
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
    plan_issue: z.number().optional().describe("Related plan issue ID"),
    deps: z
      .array(z.number())
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
  description: "Partially update task status or owner metadata",
  inputSchema: {
    id: z.number().describe("Task ID to update"),
    status: z
      .enum(["pending", "in_progress", "completed"])
      .optional()
      .describe("New status"),
    owner: TaskOwnerUpdateSchema.optional().describe(
      "Partial owner update. Only agent_id and resume_tier are allowed; role cannot be changed",
    ),
  },
} satisfies NxToolDefinition;

export const taskCloseTool = {
  group: "task",
  name: "nx_task_close",
  description:
    "Close the current cycle, archive it to history.json, and remove plan.json and tasks.json",
  inputSchema: {},
} satisfies NxToolDefinition;

export const taskResumeTool = {
  group: "task",
  name: "nx_task_resume",
  description: "Get task resume routing information based on owner.resume_tier",
  inputSchema: {
    id: z.number().describe("Task ID to look up"),
  },
} satisfies NxToolDefinition;

export const taskToolDefinitions = [
  taskAddTool,
  taskListTool,
  taskUpdateTool,
  taskCloseTool,
  taskResumeTool,
] as const;
