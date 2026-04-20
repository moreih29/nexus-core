import type { HookHandler } from "../../../src/hooks/types.js";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, basename } from "node:path";
import { getParentPid } from "../../../src/shared/paths.js";

const handler: HookHandler = async (input) => {
  if (input.hook_event_name !== "SessionStart") return;

  const safeSid = basename(input.session_id);
  if (!safeSid || safeSid.startsWith(".") || safeSid.includes("/")) {
    process.stderr.write(`[session-init] invalid session_id: ${input.session_id}\n`);
    return;
  }

  const sessionDir = join(input.cwd, ".nexus/state", safeSid);

  mkdirSync(sessionDir, { recursive: true });

  writeFileSync(join(sessionDir, "agent-tracker.json"), "[]");
  writeFileSync(join(sessionDir, "tool-log.jsonl"), "");

  const ppid = getParentPid();
  const byPpidDir = join(input.cwd, ".nexus/state/runtime/by-ppid");
  mkdirSync(byPpidDir, { recursive: true });
  writeFileSync(
    join(byPpidDir, `${ppid}.json`),
    JSON.stringify({ session_id: input.session_id, updated_at: new Date().toISOString(), cwd: input.cwd }),
  );
};

export default handler;
