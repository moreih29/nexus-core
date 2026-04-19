import type { HookHandler } from "../../../src/hooks/types.js";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, basename } from "node:path";

const handler: HookHandler = async (input) => {
  if (input.hook_event_name !== "SessionStart") return;

  // Sanitize session_id to prevent path traversal
  const safeSid = basename(input.session_id);
  if (!safeSid || safeSid.startsWith(".") || safeSid.includes("/")) {
    process.stderr.write(`[session-init] invalid session_id: ${input.session_id}\n`);
    return;
  }

  const sessionDir = join(input.cwd, ".nexus/state", safeSid);

  // Ensure directory exists (idempotent)
  mkdirSync(sessionDir, { recursive: true });

  // Initialize per-session state files — overwrite unconditionally (resume is intentional)
  writeFileSync(join(sessionDir, "agent-tracker.json"), "[]");
  writeFileSync(join(sessionDir, "tool-log.jsonl"), "");

  // plan.json and tasks.json are MCP responsibility — not touched here
  // memory-access.jsonl is project-level — not touched here

  // No additional_context returned (decided: no context injection at session start)
};

export default handler;
