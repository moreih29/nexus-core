// Issue #46 — prompt-router runtime asset lookup 회귀 감지 (fresh consumer target 모사)

import { execSync, spawn } from "node:child_process";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { findPackageRoot } from "../../src/shared/package-root.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const ROOT = findPackageRoot(__dirname);

function fail(msg: string): never {
  process.stderr.write(`[smoke-consumer] FAIL: ${msg}\n`);
  process.exit(1);
}

function spawnWithStdin(
  handlerPath: string,
  payload: string,
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn("node", [handlerPath], { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d: Buffer) => { stdout += d.toString(); });
    child.stderr.on("data", (d: Buffer) => { stderr += d.toString(); });
    child.stdin.write(payload);
    child.stdin.end();
    child.on("exit", (c) => resolve({ code: c ?? 1, stdout, stderr }));
    child.on("error", () => resolve({ code: 1, stdout, stderr }));
  });
}

const tmpDir = mkdtempSync(join(tmpdir(), "nexus-smoke-consumer-"));

try {
  // 1. Sync to fresh consumer target — simulates downstream consumer install
  execSync(
    `node ${join(ROOT, "dist/scripts/cli.js")} sync --harness=claude --target=${tmpDir}`,
    { stdio: "ignore" },
  );

  const handlerPath = join(tmpDir, "dist/hooks/prompt-router.js");
  if (!existsSync(handlerPath)) {
    fail(`prompt-router.js not found at ${handlerPath} — sync may have failed or bundle name changed`);
  }

  // Case A: [run] tag → exit 0 + stdout contains <system-notice>
  const payloadA = JSON.stringify({
    hook_event_name: "UserPromptSubmit",
    session_id: "smoke-run",
    cwd: tmpDir,
    prompt: "[run] smoke",
  });

  const resultA = await spawnWithStdin(handlerPath, payloadA);
  if (resultA.code !== 0) {
    fail(
      `case A ([run]) exited with code ${resultA.code}\n` +
      `  stdout: ${resultA.stdout.slice(0, 300)}\n` +
      `  stderr: ${resultA.stderr.slice(0, 300)}`,
    );
  }
  if (!resultA.stdout.includes("<system-notice>")) {
    fail(
      `case A ([run]) stdout missing <system-notice>\n` +
      `  stdout: ${resultA.stdout.slice(0, 300)}\n` +
      `  stderr: ${resultA.stderr.slice(0, 300)}`,
    );
  }

  // Case B: [rule] tag → exit 0 + stdout contains "Valid targets:" + at least one name
  const payloadB = JSON.stringify({
    hook_event_name: "UserPromptSubmit",
    session_id: "smoke-rule",
    cwd: tmpDir,
    prompt: "[rule] store this convention",
  });

  const resultB = await spawnWithStdin(handlerPath, payloadB);
  if (resultB.code !== 0) {
    fail(
      `case B ([rule]) exited with code ${resultB.code}\n` +
      `  stdout: ${resultB.stdout.slice(0, 300)}\n` +
      `  stderr: ${resultB.stderr.slice(0, 300)}`,
    );
  }
  if (!resultB.stdout.includes("Valid targets:")) {
    fail(
      `case B ([rule]) stdout missing "Valid targets:"\n` +
      `  stdout: ${resultB.stdout.slice(0, 300)}\n` +
      `  stderr: ${resultB.stderr.slice(0, 300)}`,
    );
  }
  if (!/Valid targets:[^.]*[a-zA-Z0-9_-]+/.test(resultB.stdout)) {
    fail(
      `case B ([rule]) "Valid targets:" not followed by at least one name\n` +
      `  stdout: ${resultB.stdout.slice(0, 300)}`,
    );
  }

  console.log("[smoke-consumer] PASS — prompt-router emits system-notice for [run] + [rule] tags in fresh consumer target");
} finally {
  rmSync(tmpDir, { recursive: true, force: true });
}
