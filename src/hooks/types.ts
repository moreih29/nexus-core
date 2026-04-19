/**
 * Nexus Hook 표준 stdin/stdout 스키마 및 meta.yml 스키마
 *
 * 결정 참조: plan.json Issue #1 (hook stdin/stdout 표준화),
 *            Issue #5 (HookMeta portability_tier 제거 — .strict() 강제)
 */

import { z } from "zod";

// ---- NexusHookInput (discriminated union on hook_event_name) ----

const BaseInput = z.object({
  session_id: z.string(),
  cwd: z.string(),
});

export const NexusHookInputSchema = z.discriminatedUnion("hook_event_name", [
  BaseInput.extend({
    hook_event_name: z.literal("SessionStart"),
    source: z.enum(["startup", "resume", "clear", "compact"]).optional(),
  }),
  BaseInput.extend({
    hook_event_name: z.literal("UserPromptSubmit"),
    prompt: z.string(),
  }),
  BaseInput.extend({
    hook_event_name: z.literal("PreToolUse"),
    tool_name: z.string(),
    tool_input: z.record(z.unknown()).optional(),
    agent_id: z.string().nullable().optional(),
  }),
  BaseInput.extend({
    hook_event_name: z.literal("PostToolUse"),
    tool_name: z.string(),
    tool_input: z.record(z.unknown()).optional(),
    tool_response: z.union([z.string(), z.record(z.unknown())]).optional(),
    agent_id: z.string().nullable().optional(),
  }),
  BaseInput.extend({
    hook_event_name: z.literal("SubagentStart"),
    agent_type: z.string(),
    agent_id: z.string(),
  }),
  BaseInput.extend({
    hook_event_name: z.literal("SubagentStop"),
    agent_type: z.string(),
    agent_id: z.string(),
    last_assistant_message: z.string().optional(),
  }),
]);
export type NexusHookInput = z.infer<typeof NexusHookInputSchema>;

// ---- NexusHookOutput ----

export const NexusHookOutputSchema = z
  .object({
    decision: z.literal("block").optional(),
    block_reason: z.string().optional(),
    additional_context: z.string().optional(),
    updated_input: z.record(z.unknown()).optional(),
    continue: z.boolean().optional(),
    system_message: z.string().optional(),
  })
  .strict();
export type NexusHookOutput = z.infer<typeof NexusHookOutputSchema>;

// ---- HookMeta (meta.yml 스키마 — portability_tier 등 unknown 필드 reject) ----

export const HookMetaSchema = z
  .object({
    name: z.string().regex(/^[a-z][a-z0-9-]*$/),
    description: z.string(),
    events: z
      .array(
        z.enum([
          "SessionStart",
          "UserPromptSubmit",
          "PreToolUse",
          "PostToolUse",
          "SubagentStart",
          "SubagentStop",
        ])
      )
      .min(1),
    requires_capabilities: z.array(z.string()),
    matcher: z.string().default("*"),
    timeout: z.number().int().positive().default(30),
    fallback: z.enum(["warn", "skip", "error"]).default("warn"),
    priority: z.number().int().default(0),
    condition: z
      .object({
        state_file_exists: z.string().optional(),
      })
      .optional(),
  })
  .strict();
export type HookMeta = z.infer<typeof HookMetaSchema>;

// ---- Handler 타입 ----

export type HookHandler = (
  input: NexusHookInput
) => Promise<NexusHookOutput | void> | NexusHookOutput | void;
