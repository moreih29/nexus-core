import type { HookHandler } from "../../../src/hooks/types.js";
import { updateJsonFileLocked } from "../../../src/shared/json-store.js";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const handler: HookHandler = async (input) => {
  if (input.hook_event_name !== "SubagentStop") return;

  const { cwd, session_id, agent_type, agent_id } = input;
  const lastMessage = (input.last_assistant_message ?? "").slice(0, 500);

  const sessionDir = join(cwd, ".nexus/state", session_id);
  const trackerPath = join(sessionDir, "agent-tracker.json");
  const toolLogPath = join(sessionDir, "tool-log.jsonl");
  const tasksPath = join(sessionDir, "tasks.json");

  // 1. tracker update + files_touched aggregation (locked)
  await updateJsonFileLocked(trackerPath, [], (tracker: unknown[]) => {
    const entry = (tracker as Record<string, unknown>[]).find(
      (e) => e["agent_id"] === agent_id,
    );
    if (!entry) return tracker;

    entry["status"] = "completed";
    entry["stopped_at"] = new Date().toISOString();
    entry["last_message"] = lastMessage;

    if (existsSync(toolLogPath)) {
      const files = new Set<string>();
      const raw = readFileSync(toolLogPath, "utf-8");
      for (const line of raw.split("\n")) {
        if (!line.trim()) continue;
        try {
          const log = JSON.parse(line) as Record<string, unknown>;
          if (log["agent_id"] === agent_id && typeof log["file"] === "string") {
            files.add(log["file"]);
          }
        } catch {
          // skip malformed lines
        }
      }
      entry["files_touched"] = [...files];
    }

    return tracker;
  });

  // 2. pending tasks alert (owner.role === agent_type)
  if (!existsSync(tasksPath)) return;

  try {
    const tasksData = JSON.parse(readFileSync(tasksPath, "utf-8")) as unknown;
    const tasks: Record<string, unknown>[] = Array.isArray(
      (tasksData as Record<string, unknown>)?.["tasks"],
    )
      ? ((tasksData as Record<string, unknown>)["tasks"] as Record<string, unknown>[])
      : [];

    const incomplete = tasks.filter(
      (t) =>
        (t["owner"] as Record<string, unknown> | undefined)?.["role"] === agent_type &&
        t["status"] !== "completed",
    );

    if (incomplete.length === 0) return;

    const ids = incomplete.map((t) => t["id"]).join(", ");
    return {
      additional_context: `<system-notice>\nSubagent "${agent_type}" finished. Tasks still pending with this role: ${ids}. Review status and coordinate remaining subagent delegation.\n</system-notice>`,
    };
  } catch {
    return;
  }
};

export default handler;
