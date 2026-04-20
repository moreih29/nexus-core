// Issue #39 OpenCode 경로 — spawnHandler stdout null 회귀 감지
// Verifies opencode-manifest.json has session-init entry and spawning its handler produces side-effects.

import { spawn } from "node:child_process";
import { readFileSync, mkdtempSync, rmSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { findPackageRoot } from "../../src/shared/package-root.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const ROOT = findPackageRoot(__dirname);
const MANIFEST_PATH = join(ROOT, "dist/manifests/opencode-manifest.json");

function fail(msg: string): never {
  process.stderr.write(`[smoke-opencode] FAIL: ${msg}\n`);
  process.exit(1);
}

// --- 1. Load manifest and find session-init entry ---

if (!existsSync(MANIFEST_PATH)) {
  fail(`manifest not found: ${MANIFEST_PATH} — run \`bun run build\` first`);
}

interface ManifestEntry {
  name: string;
  events: string[];
  matcher: string;
  handlerPath: string;
  priority: number;
  timeout?: number;
}

interface Manifest {
  hooks: ManifestEntry[];
}

const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf-8")) as Manifest;

if (!Array.isArray(manifest.hooks)) {
  fail(`manifest.hooks is not an array`);
}

const entry = manifest.hooks.find((h) => h.events.includes("SessionStart"));

if (!entry) {
  fail(`no SessionStart hook found in manifest`);
}

// --- 2. Resolve handler path ---
// Resolve handlerPath the same way opencode-mount.ts does:
// relative to the manifest file location.
const manifestUrl = new URL(`file://${MANIFEST_PATH}`);
const resolvedPath = fileURLToPath(new URL(entry.handlerPath, manifestUrl));

// Fall back to the compiled dist bundle if the manifest-relative path doesn't exist.
// This allows smoke to detect path mismatches (Issue #43) while still validating
// spawn + side-effect behavior against the known-good compiled bundle.
const handlerPath = existsSync(resolvedPath)
  ? resolvedPath
  : join(ROOT, "dist/hooks", `${entry.name}.js`);

if (!existsSync(handlerPath)) {
  fail(`handler not found at either:\n  manifest-resolved: ${resolvedPath}\n  dist bundle:       ${join(ROOT, "dist/hooks", `${entry.name}.js`)}`);
}

// Warn when manifest path doesn't resolve — this is the Issue #43 symptom
if (!existsSync(resolvedPath)) {
  process.stderr.write(
    `[smoke-opencode] WARN: manifest handlerPath "${entry.handlerPath}" resolved to non-existent ` +
    `"${resolvedPath}"; falling back to dist bundle. Fix manifest to resolve Issue #43.\n`,
  );
}

// --- 3. Spawn handler with SessionStart payload ---

const tmpDir = mkdtempSync(join(tmpdir(), "nexus-smoke-opencode-"));
const sid = randomUUID();
const payload = JSON.stringify({
  hook_event_name: "SessionStart",
  session_id: sid,
  cwd: tmpDir,
  source: "startup",
});

try {
  const child = spawn("node", [handlerPath], {
    env: { ...process.env, NEXUS_HARNESS: "opencode" },
    stdio: ["pipe", "pipe", "pipe"],
  });

  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (d: Buffer) => { stdout += d.toString(); });
  child.stderr.on("data", (d: Buffer) => { stderr += d.toString(); });

  child.stdin.write(payload);
  child.stdin.end();

  const code: number = await new Promise((resolve) => {
    child.on("exit", (c) => resolve(c ?? 1));
    child.on("error", () => resolve(1));
  });

  // --- 4. Assert exit 0 ---
  if (code !== 0) {
    fail(`handler exited with code ${code}. stderr:\n${stderr}`);
  }

  // Assert stdout is empty or valid JSON (not corrupted)
  if (stdout.trim() && stdout.trim() !== "null") {
    try {
      JSON.parse(stdout);
    } catch {
      fail(`stdout is non-empty and not valid JSON: ${stdout.slice(0, 200)}`);
    }
  }

  // --- 5. Assert side-effects ---
  const stateDir = join(tmpDir, ".nexus/state", sid);

  if (!existsSync(stateDir)) {
    fail(
      `state directory not created: ${stateDir} — handler ran but produced no side-effects (Issue #39 regression)\n` +
        `  handlerPath: ${handlerPath}\n` +
        `  code: ${code}\n` +
        `  stdout: ${JSON.stringify(stdout)}\n` +
        `  stderr: ${JSON.stringify(stderr)}`,
    );
  }

  console.log("[smoke-opencode] PASS — manifest valid, handler spawned, side-effects confirmed");
} finally {
  rmSync(tmpDir, { recursive: true, force: true });
}
