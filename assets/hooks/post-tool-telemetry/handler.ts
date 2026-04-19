import type { HookHandler } from "../../../src/hooks/types.js";
import { appendJsonLine } from "../../../src/shared/json-store.js";
import { join, resolve, relative } from "node:path";

const EDIT_TOOLS = new Set(["Edit", "Write", "MultiEdit", "ApplyPatch", "NotebookEdit"]);

function isWithinMemory(filePath: string, projectRoot: string): boolean {
  const memRoot = resolve(projectRoot, ".nexus/memory");
  const abs = resolve(filePath);
  return abs.startsWith(memRoot + "/") || abs === memRoot;
}

const handler: HookHandler = async (input) => {
  if (input.hook_event_name !== "PostToolUse") return;

  const { cwd, session_id, tool_name, agent_id } = input;
  const toolInput = (input.tool_input ?? {}) as Record<string, unknown>;

  // 1. Memory access tracking (Read)
  if (tool_name === "Read") {
    const filePath = toolInput.file_path as string | undefined;
    if (filePath && isWithinMemory(filePath, cwd)) {
      appendJsonLine(join(cwd, ".nexus/memory-access.jsonl"), {
        path: relative(cwd, resolve(filePath)),
        accessed_at: new Date().toISOString(),
        agent: agent_id ?? null,
      });
    }
  }

  // 2. Tool-log append (edit tools + agent_id present)
  if (EDIT_TOOLS.has(tool_name) && agent_id) {
    const filePath = (toolInput.file_path ?? toolInput.notebook_path) as string | undefined;
    if (filePath) {
      appendJsonLine(
        join(cwd, ".nexus/state", session_id, "tool-log.jsonl"),
        {
          ts: new Date().toISOString(),
          agent_id,
          tool: tool_name,
          file: relative(cwd, resolve(filePath)),
          status: "ok",
        },
      );
    }
  }
};

export default handler;
