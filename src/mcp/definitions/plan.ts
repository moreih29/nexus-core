import * as z from "zod/v3";
import type { NxToolDefinition } from "../../shared/register-tool.js";

export const planStartTool = {
  group: "plan",
  name: "nx_plan_start",
  description:
    "Start a new planning session and automatically archive any existing plan.json",
  inputSchema: {
    topic: z.string().describe("Planning topic"),
    issues: z.array(z.string()).describe("List of issues to decide"),
    research_summary: z
      .string()
      .describe(
        "Summary of prior research. Required to ensure research is completed before planning.",
      ),
  },
} satisfies NxToolDefinition;

export const planStatusTool = {
  group: "plan",
  name: "nx_plan_status",
  description: "Get the current planning session status",
  inputSchema: {},
} satisfies NxToolDefinition;

export const planUpdateTool = {
  group: "plan",
  name: "nx_plan_update",
  description: "Manage issues in the plan: add, remove, modify, or reopen",
  inputSchema: {
    action: z
      .enum(["add", "remove", "modify", "reopen"])
      .describe("Action to perform"),
    issue_id: z
      .number()
      .optional()
      .describe("Target issue ID. Required for remove, modify, and reopen"),
    title: z
      .string()
      .optional()
      .describe("Issue title. Required for add and modify"),
  },
} satisfies NxToolDefinition;

export const planDecideTool = {
  group: "plan",
  name: "nx_plan_decide",
  description: "Record the final decision for a plan issue",
  inputSchema: {
    issue_id: z.number().describe("Issue ID to decide"),
    decision: z.string().describe("Decision text"),
  },
} satisfies NxToolDefinition;

export const planResumeTool = {
  group: "plan",
  name: "nx_plan_resume",
  description: "Get resume routing information for a HOW participant",
  inputSchema: {
    role: z.string().describe("Agent role to look up"),
  },
} satisfies NxToolDefinition;

export const planAnalysisAddTool = {
  group: "plan",
  name: "nx_plan_analysis_add",
  description: "Add an analysis entry to a plan issue",
  inputSchema: {
    issue_id: z.number().describe("Target issue ID"),
    role: z.string().describe("Role of the analyzing agent"),
    agent_id: z
      .string()
      .optional()
      .describe("Agent ID, used for resume routing"),
    summary: z.string().describe("Analysis summary"),
  },
} satisfies NxToolDefinition;

export const planToolDefinitions = [
  planStartTool,
  planStatusTool,
  planUpdateTool,
  planDecideTool,
  planResumeTool,
  planAnalysisAddTool,
] as const;
