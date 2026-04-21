import * as z from "zod/v3";

// resume_tier
export const ResumeTierSchema = z.enum(["persistent", "bounded", "ephemeral"]);
export type ResumeTier = z.infer<typeof ResumeTierSchema>;

// PlanIssue.analysis entry
export const PlanAnalysisEntrySchema = z.object({
  role: z.string(),
  agent_id: z.string().optional(),
  summary: z.string(),
  recorded_at: z.string(), // ISO
});
export type PlanAnalysisEntry = z.infer<typeof PlanAnalysisEntrySchema>;

// PlanIssue
export const PlanIssueSchema = z.object({
  id: z.number(),
  title: z.string(),
  status: z.enum(["pending", "decided"]),
  decision: z.string().optional(),
  analysis: z.array(PlanAnalysisEntrySchema).optional(),
});
export type PlanIssue = z.infer<typeof PlanIssueSchema>;

// PlanFile
export const PlanFileSchema = z.object({
  id: z.number(),
  topic: z.string(),
  issues: z.array(PlanIssueSchema),
  research_summary: z.string().optional(),
  created_at: z.string(),
});
export type PlanFile = z.infer<typeof PlanFileSchema>;

// TaskOwner
export const TaskOwnerSchema = z.object({
  role: z.string(),
  agent_id: z.string().optional(),
  resume_tier: ResumeTierSchema.optional(),
});
export type TaskOwner = z.infer<typeof TaskOwnerSchema>;

// TaskItem
export const TaskItemSchema = z.object({
  id: z.number(),
  title: z.string(),
  status: z.enum(["pending", "in_progress", "completed"]),
  context: z.string(),
  acceptance: z.string(),
  approach: z.string().optional(),
  risk: z.string().optional(),
  plan_issue: z.number().optional(),
  deps: z.array(z.number()).optional(),
  owner: TaskOwnerSchema,
  created_at: z.string(),
});
export type TaskItem = z.infer<typeof TaskItemSchema>;

// TasksFile
export const TasksFileSchema = z.object({
  goal: z.string().optional(),
  decisions: z.array(z.string()).optional(),
  tasks: z.array(TaskItemSchema),
});
export type TasksFile = z.infer<typeof TasksFileSchema>;

// HistoryCycle (memoryHint 제거)
export const HistoryCycleSchema = z.object({
  schema_version: z.string().optional(),
  completed_at: z.string(),
  branch: z.string(),
  plan: PlanFileSchema.optional(),
  tasks: z.array(TaskItemSchema).optional(),
});
export type HistoryCycle = z.infer<typeof HistoryCycleSchema>;

// HistoryFile
export const HistoryFileSchema = z.object({
  schema_version: z.string().optional(),
  cycles: z.array(HistoryCycleSchema),
});
export type HistoryFile = z.infer<typeof HistoryFileSchema>;
