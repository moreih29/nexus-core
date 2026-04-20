// Issue #46 — prompt-router runtime asset lookup 회귀 감지 (fresh consumer target 모사)
// Issue #50 — session_id side-channel + tracker lifecycle integration cases

import { execSync, spawn } from "node:child_process";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { findPackageRoot } from "../../src/shared/package-root.js";
import { getSessionId, resetByPpidCache } from "../../src/shared/paths.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const ROOT = findPackageRoot(__dirname);

function fail(msg: string): never {
  process.stderr.write(`[smoke-consumer] FAIL: ${msg}\n`);
  process.exit(1);
}

function spawnWithStdin(
  handlerPath: string,
  payload: string,
  extraEnv?: Record<string, string>,
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const env = extraEnv ? { ...process.env, ...extraEnv } : process.env;
    const child = spawn("node", [handlerPath], { stdio: ["pipe", "pipe", "pipe"], env });
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

  // Case C — session_id side-channel round-trip
  const sidTmpDir = mkdtempSync(join(tmpdir(), "nexus-smoke-sid-"));
  const savedTestPpid = process.env["NEXUS_TEST_PPID"];
  const savedSessionId = process.env["NEXUS_SESSION_ID"];
  try {
    process.env["NEXUS_TEST_PPID"] = "999000";
    delete process.env["NEXUS_SESSION_ID"];

    const sessionInitHandler = join(ROOT, "dist/hooks/session-init.js");
    if (!existsSync(sessionInitHandler)) {
      fail(`session-init.js not found at ${sessionInitHandler} — run \`bun run build\` first`);
    }

    const payloadC = JSON.stringify({
      hook_event_name: "SessionStart",
      session_id: "test-sid-abc",
      cwd: sidTmpDir,
      source: "startup",
    });
    const resultC = await spawnWithStdin(sessionInitHandler, payloadC, { NEXUS_TEST_PPID: "999000" });
    if (resultC.code !== 0) {
      fail(
        `case C (session-init) exited with code ${resultC.code}\n` +
        `  stderr: ${resultC.stderr.slice(0, 300)}`,
      );
    }

    const byPpidFile = join(sidTmpDir, ".nexus/state/runtime/by-ppid/999000.json");
    if (!existsSync(byPpidFile)) {
      fail(`case C: by-ppid file not created at ${byPpidFile}`);
    }
    const byPpidData = JSON.parse(readFileSync(byPpidFile, "utf-8")) as { session_id: string };
    if (byPpidData.session_id !== "test-sid-abc") {
      fail(`case C: by-ppid file has session_id="${byPpidData.session_id}", expected "test-sid-abc"`);
    }

    resetByPpidCache();
    const resolvedSid = getSessionId(sidTmpDir);
    if (resolvedSid !== "test-sid-abc") {
      fail(`case C: getSessionId() returned "${resolvedSid}", expected "test-sid-abc"`);
    }

    console.log("[smoke-consumer] PASS — case C: session_id side-channel round-trip");
  } finally {
    if (savedTestPpid === undefined) {
      delete process.env["NEXUS_TEST_PPID"];
    } else {
      process.env["NEXUS_TEST_PPID"] = savedTestPpid;
    }
    if (savedSessionId !== undefined) {
      process.env["NEXUS_SESSION_ID"] = savedSessionId;
    }
    rmSync(sidTmpDir, { recursive: true, force: true });
  }

  // Case D — tracker lifecycle: session-init → agent-bootstrap → agent-finalize
  const trackerTmpDir = mkdtempSync(join(tmpdir(), "nexus-smoke-tracker-"));
  const savedTestPpid2 = process.env["NEXUS_TEST_PPID"];
  const savedSessionId2 = process.env["NEXUS_SESSION_ID"];
  try {
    process.env["NEXUS_TEST_PPID"] = "999001";
    delete process.env["NEXUS_SESSION_ID"];

    const sessionInitHandler = join(ROOT, "dist/hooks/session-init.js");
    const bootstrapHandler = join(ROOT, "dist/hooks/agent-bootstrap.js");
    const finalizeHandler = join(ROOT, "dist/hooks/agent-finalize.js");

    for (const h of [sessionInitHandler, bootstrapHandler, finalizeHandler]) {
      if (!existsSync(h)) {
        fail(`case D: handler not found at ${h} — run \`bun run build\` first`);
      }
    }

    const initPayload = JSON.stringify({
      hook_event_name: "SessionStart",
      session_id: "test-sid-abc",
      cwd: trackerTmpDir,
      source: "startup",
    });
    const initResult = await spawnWithStdin(sessionInitHandler, initPayload, { NEXUS_TEST_PPID: "999001" });
    if (initResult.code !== 0) {
      fail(`case D (session-init) exited with code ${initResult.code}\n  stderr: ${initResult.stderr.slice(0, 300)}`);
    }

    const trackerPath = join(trackerTmpDir, ".nexus/state/test-sid-abc/agent-tracker.json");
    if (!existsSync(trackerPath)) {
      fail(`case D: agent-tracker.json not created at ${trackerPath}`);
    }
    const initTracker = JSON.parse(readFileSync(trackerPath, "utf-8"));
    if (!Array.isArray(initTracker) || initTracker.length !== 0) {
      fail(`case D: agent-tracker.json after session-init should be [], got ${JSON.stringify(initTracker)}`);
    }

    const bootstrapPayload = JSON.stringify({
      hook_event_name: "SubagentStart",
      cwd: trackerTmpDir,
      session_id: "test-sid-abc",
      agent_type: "architect",
      agent_id: "test-agent-xyz",
    });
    const bootstrapResult = await spawnWithStdin(bootstrapHandler, bootstrapPayload, { NEXUS_TEST_PPID: "999001" });
    if (bootstrapResult.code !== 0) {
      fail(`case D (agent-bootstrap) exited with code ${bootstrapResult.code}\n  stderr: ${bootstrapResult.stderr.slice(0, 300)}`);
    }

    const afterBootstrap = JSON.parse(readFileSync(trackerPath, "utf-8")) as Array<Record<string, unknown>>;
    if (!Array.isArray(afterBootstrap) || afterBootstrap.length !== 1) {
      fail(`case D: tracker after bootstrap should have 1 entry, got ${JSON.stringify(afterBootstrap)}`);
    }
    const entry = afterBootstrap[0]!;
    if (entry["agent_id"] !== "test-agent-xyz") {
      fail(`case D: tracker entry agent_id="${entry["agent_id"]}", expected "test-agent-xyz"`);
    }
    if (entry["agent_type"] !== "architect") {
      fail(`case D: tracker entry agent_type="${entry["agent_type"]}", expected "architect"`);
    }
    if (entry["status"] !== "running") {
      fail(`case D: tracker entry status="${entry["status"]}", expected "running"`);
    }
    if (typeof entry["started_at"] !== "string" || !entry["started_at"]) {
      fail(`case D: tracker entry started_at missing or not a string`);
    }

    const finalizePayload = JSON.stringify({
      hook_event_name: "SubagentStop",
      cwd: trackerTmpDir,
      session_id: "test-sid-abc",
      agent_type: "architect",
      agent_id: "test-agent-xyz",
      last_assistant_message: "",
    });
    const finalizeResult = await spawnWithStdin(finalizeHandler, finalizePayload, { NEXUS_TEST_PPID: "999001" });
    if (finalizeResult.code !== 0) {
      fail(`case D (agent-finalize) exited with code ${finalizeResult.code}\n  stderr: ${finalizeResult.stderr.slice(0, 300)}`);
    }

    const afterFinalize = JSON.parse(readFileSync(trackerPath, "utf-8")) as Array<Record<string, unknown>>;
    if (!Array.isArray(afterFinalize) || afterFinalize.length !== 1) {
      fail(`case D: tracker after finalize should have 1 entry, got ${JSON.stringify(afterFinalize)}`);
    }
    const finalEntry = afterFinalize[0]!;
    if (finalEntry["status"] !== "completed") {
      fail(`case D: tracker entry status="${finalEntry["status"]}", expected "completed"`);
    }
    if (typeof finalEntry["stopped_at"] !== "string" || !finalEntry["stopped_at"]) {
      fail(`case D: tracker entry stopped_at missing or not a string`);
    }

    console.log("[smoke-consumer] PASS — case D: tracker lifecycle (init → bootstrap → finalize)");
  } finally {
    if (savedTestPpid2 === undefined) {
      delete process.env["NEXUS_TEST_PPID"];
    } else {
      process.env["NEXUS_TEST_PPID"] = savedTestPpid2;
    }
    if (savedSessionId2 !== undefined) {
      process.env["NEXUS_SESSION_ID"] = savedSessionId2;
    }
    rmSync(trackerTmpDir, { recursive: true, force: true });
  }
} finally {
  rmSync(tmpDir, { recursive: true, force: true });
}
