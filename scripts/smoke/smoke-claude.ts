// Issue #39 — hook bundle silent no-op 회귀 감지
// Verifies dist/hooks/session-init.js receives SessionStart stdin and produces side-effects.

import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { findPackageRoot } from "../../src/shared/package-root.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const ROOT = findPackageRoot(__dirname);
const HANDLER = join(ROOT, "dist/hooks/session-init.js");

function fail(msg: string): never {
  process.stderr.write(`[smoke-claude] FAIL: ${msg}\n`);
  process.exit(1);
}

if (!existsSync(HANDLER)) {
  fail(`handler not found: ${HANDLER} — run \`bun run build\` first`);
}

const tmpDir = mkdtempSync(join(tmpdir(), "nexus-smoke-claude-"));
const sid = randomUUID();
const payload = JSON.stringify({
  hook_event_name: "SessionStart",
  session_id: sid,
  cwd: tmpDir,
  source: "startup",
});

try {
  const child = spawn("node", [HANDLER], { stdio: ["pipe", "pipe", "pipe"] });

  let stderr = "";
  child.stderr.on("data", (d: Buffer) => { stderr += d.toString(); });

  child.stdin.write(payload);
  child.stdin.end();

  const code: number = await new Promise((resolve) => {
    child.on("exit", (c) => resolve(c ?? 1));
    child.on("error", () => resolve(1));
  });

  if (code !== 0) {
    fail(`handler exited with code ${code}. stderr:\n${stderr}`);
  }

  const stateDir = join(tmpDir, ".nexus/state", sid);
  const trackerPath = join(stateDir, "agent-tracker.json");
  const toolLogPath = join(stateDir, "tool-log.jsonl");

  if (!existsSync(stateDir)) {
    fail(`state directory not created: ${stateDir}`);
  }
  if (!existsSync(trackerPath)) {
    fail(`agent-tracker.json not created: ${trackerPath}`);
  }
  if (!existsSync(toolLogPath)) {
    fail(`tool-log.jsonl not created: ${toolLogPath}`);
  }

  console.log("[smoke-claude] PASS — session-init side-effects confirmed");
} finally {
  rmSync(tmpDir, { recursive: true, force: true });
}
