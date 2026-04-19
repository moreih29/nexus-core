import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import fs from "node:fs";
import fsPromises from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execSync } from "node:child_process";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { sanitizeName, registerArtifactTools } from "./artifact.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTmpGitRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nexus-artifact-"));
  execSync("git init", { cwd: dir, stdio: "ignore" });
  execSync('git config user.email "test@test.com"', { cwd: dir, stdio: "ignore" });
  execSync('git config user.name "Test"', { cwd: dir, stdio: "ignore" });
  execSync("git commit --allow-empty -m init", { cwd: dir, stdio: "ignore" });
  return dir;
}

/** Parse the first text content item from a CallToolResult. */
function parseResult(result: CallToolResult): { success: boolean; path: string } {
  const item = result.content[0];
  if (item.type !== "text") throw new Error("Expected text content");
  return JSON.parse(item.text) as { success: boolean; path: string };
}

/**
 * Build a server, capture the registered tool handler, then restore cwd.
 * The handler is extracted by intercepting server.tool's return value.
 */
function buildHandler(
  tmpDir: string,
): (args: { filename: string; content: string }) => Promise<CallToolResult> {
  const server = new McpServer({ name: "test", version: "0.0.0" });

  // Intercept server.tool to capture the registered tool object
  let registered: { handler: (args: unknown, extra: unknown) => Promise<unknown> } | undefined;
  const origTool = server.tool.bind(server) as typeof server.tool;
  (server as unknown as Record<string, unknown>).tool = (...args: Parameters<typeof server.tool>) => {
    const reg = origTool(...args) as typeof registered;
    registered = reg;
    return reg;
  };

  // chdir so findProjectRoot / getNexusRoot resolve to tmpDir
  const prevCwd = process.cwd();
  process.chdir(tmpDir);
  try {
    registerArtifactTools(server);
  } finally {
    process.chdir(prevCwd);
  }

  if (!registered) throw new Error("registerArtifactTools did not call server.tool");

  const handler = registered.handler;
  return async (args) => {
    // chdir during invocation so runtime calls resolve correctly
    const prev = process.cwd();
    process.chdir(tmpDir);
    try {
      return (await handler(args, {})) as CallToolResult;
    } finally {
      process.chdir(prev);
    }
  };
}

// ---------------------------------------------------------------------------
// sanitizeName — unit tests (no I/O)
// ---------------------------------------------------------------------------

describe("sanitizeName", () => {
  test("1a. normal filename passes through unchanged", () => {
    expect(sanitizeName("findings.md")).toBe("findings.md");
  });

  test("1b. subdirectory path passes through unchanged", () => {
    expect(sanitizeName("sub/synthesis.md")).toBe("sub/synthesis.md");
  });

  test("3. traversal: '../etc/passwd' -> 'etc/passwd'", () => {
    expect(sanitizeName("../etc/passwd")).toBe("etc/passwd");
  });

  test("4. backslash: '..\\\\foo\\\\bar.md' -> 'foo/bar.md'", () => {
    expect(sanitizeName("..\\foo\\bar.md")).toBe("foo/bar.md");
  });

  test("5. leading slash: '/abs/path.md' -> 'abs/path.md'", () => {
    expect(sanitizeName("/abs/path.md")).toBe("abs/path.md");
  });

  test("6. multiple traversals: '../../../../../tmp/evil.md' -> 'tmp/evil.md'", () => {
    expect(sanitizeName("../../../../../tmp/evil.md")).toBe("tmp/evil.md");
  });

  test("8a. empty string -> throws", () => {
    expect(() => sanitizeName("")).toThrow("Invalid filename: empty after sanitize");
  });

  test("8b. only dots '..': throws", () => {
    expect(() => sanitizeName("..")).toThrow("Invalid filename: empty after sanitize");
  });

  test("8c. multiple traversals leaving nothing '../../..': throws", () => {
    expect(() => sanitizeName("../../..")).toThrow("Invalid filename: empty after sanitize");
  });

  test("9. multi-byte filename passes through", () => {
    expect(sanitizeName("한글파일.md")).toBe("한글파일.md");
  });
});

// ---------------------------------------------------------------------------
// nx_artifact_write handler — integration tests (real I/O in tmp git repo)
// ---------------------------------------------------------------------------

const ARTIFACT_TEST_SESSION = "artifact-test-session";

describe("nx_artifact_write handler", () => {
  let tmpDir: string;
  let invoke: (args: { filename: string; content: string }) => Promise<CallToolResult>;
  let prevSid: string | undefined;

  beforeEach(() => {
    prevSid = process.env.NEXUS_SESSION_ID;
    process.env.NEXUS_SESSION_ID = ARTIFACT_TEST_SESSION;
    tmpDir = makeTmpGitRepo();
    invoke = buildHandler(tmpDir);
  });

  afterEach(async () => {
    if (prevSid === undefined) delete process.env.NEXUS_SESSION_ID;
    else process.env.NEXUS_SESSION_ID = prevSid;
    await fsPromises.rm(tmpDir, { recursive: true, force: true });
  });

  test("1. 정상: findings.md 작성, 응답 path가 PROJECT_ROOT 상대", async () => {
    const result = await invoke({ filename: "findings.md", content: "hello" });
    const parsed = parseResult(result);

    expect(parsed.success).toBe(true);
    expect(parsed.path).toBe(path.join(".nexus", "state", ARTIFACT_TEST_SESSION, "artifacts", "findings.md"));

    const fullPath = path.join(tmpDir, ".nexus", "state", ARTIFACT_TEST_SESSION, "artifacts", "findings.md");
    expect(fs.existsSync(fullPath)).toBe(true);
    expect(fs.readFileSync(fullPath, "utf-8")).toBe("hello");
  });

  test("2. 하위 디렉토리: 'sub/synthesis.md' — mkdir 자동, 작성", async () => {
    const result = await invoke({ filename: "sub/synthesis.md", content: "content" });
    const parsed = parseResult(result);

    expect(parsed.success).toBe(true);
    expect(parsed.path).toBe(
      path.join(".nexus", "state", ARTIFACT_TEST_SESSION, "artifacts", "sub", "synthesis.md"),
    );

    const fullPath = path.join(tmpDir, ".nexus", "state", ARTIFACT_TEST_SESSION, "artifacts", "sub", "synthesis.md");
    expect(fs.existsSync(fullPath)).toBe(true);
  });

  test("3. traversal 차단: '../etc/passwd' -> artifacts/etc/passwd (proj 외부 escape 안 됨)", async () => {
    const result = await invoke({ filename: "../etc/passwd", content: "evil" });
    const parsed = parseResult(result);

    expect(parsed.success).toBe(true);
    // path must stay inside artifacts/
    expect(parsed.path).toContain(path.join(".nexus", "state", ARTIFACT_TEST_SESSION, "artifacts"));
    expect(parsed.path).not.toContain("..");

    const fullPath = path.join(tmpDir, ".nexus", "state", ARTIFACT_TEST_SESSION, "artifacts", "etc", "passwd");
    expect(fs.existsSync(fullPath)).toBe(true);
  });

  test("4. backslash: '..\\\\foo\\\\bar.md' -> artifacts/foo/bar.md", async () => {
    const result = await invoke({ filename: "..\\foo\\bar.md", content: "data" });
    const parsed = parseResult(result);

    expect(parsed.success).toBe(true);
    expect(parsed.path).toContain(path.join(".nexus", "state", ARTIFACT_TEST_SESSION, "artifacts", "foo", "bar.md"));
  });

  test("5. leading slash: '/abs/path.md' -> artifacts/abs/path.md", async () => {
    const result = await invoke({ filename: "/abs/path.md", content: "data" });
    const parsed = parseResult(result);

    expect(parsed.success).toBe(true);
    expect(parsed.path).toContain(path.join(".nexus", "state", ARTIFACT_TEST_SESSION, "artifacts", "abs", "path.md"));
  });

  test("6. 다중 점: '../../../../../tmp/evil.md' -> artifacts/tmp/evil.md", async () => {
    const result = await invoke({ filename: "../../../../../tmp/evil.md", content: "data" });
    const parsed = parseResult(result);

    expect(parsed.success).toBe(true);
    expect(parsed.path).toContain(path.join(".nexus", "state", ARTIFACT_TEST_SESSION, "artifacts", "tmp", "evil.md"));
    expect(parsed.path).not.toContain("..");
  });

  test("7. 덮어쓰기: 같은 filename 두 번 작성 — content 덮어씀", async () => {
    await invoke({ filename: "overwrite.md", content: "first" });
    await invoke({ filename: "overwrite.md", content: "second" });

    const fullPath = path.join(tmpDir, ".nexus", "state", ARTIFACT_TEST_SESSION, "artifacts", "overwrite.md");
    expect(fs.readFileSync(fullPath, "utf-8")).toBe("second");
  });

  test("8. 빈 파일명 -> throw (empty after sanitize)", async () => {
    await expect(invoke({ filename: "", content: "x" })).rejects.toThrow(
      "Invalid filename: empty after sanitize",
    );
  });

  test("9. multi-byte filename: '한글파일.md' -> 정상 작성", async () => {
    const result = await invoke({ filename: "한글파일.md", content: "한글내용" });
    const parsed = parseResult(result);

    expect(parsed.success).toBe(true);
    expect(parsed.path).toContain("한글파일.md");

    const fullPath = path.join(tmpDir, ".nexus", "state", ARTIFACT_TEST_SESSION, "artifacts", "한글파일.md");
    expect(fs.readFileSync(fullPath, "utf-8")).toBe("한글내용");
  });

  test("10. 매우 긴 content (10KB+): 정상 작성", async () => {
    const largeContent = "x".repeat(10_240);
    const result = await invoke({ filename: "large.md", content: largeContent });
    const parsed = parseResult(result);

    expect(parsed.success).toBe(true);

    const fullPath = path.join(tmpDir, ".nexus", "state", ARTIFACT_TEST_SESSION, "artifacts", "large.md");
    expect(fs.readFileSync(fullPath, "utf-8")).toBe(largeContent);
  });
});

// ---------------------------------------------------------------------------
// 보안 edge — URL 인코딩, NULL byte, symlink escape
// ---------------------------------------------------------------------------

describe("보안 edge", () => {
  let tmpDir: string;
  let invoke: (args: { filename: string; content: string }) => Promise<CallToolResult>;
  let prevSid: string | undefined;

  beforeEach(() => {
    prevSid = process.env.NEXUS_SESSION_ID;
    process.env.NEXUS_SESSION_ID = ARTIFACT_TEST_SESSION;
    tmpDir = makeTmpGitRepo();
    invoke = buildHandler(tmpDir);
  });

  afterEach(async () => {
    if (prevSid === undefined) delete process.env.NEXUS_SESSION_ID;
    else process.env.NEXUS_SESSION_ID = prevSid;
    await fsPromises.rm(tmpDir, { recursive: true, force: true });
  });

  test("URL 인코딩 입력 — %2E%2E%2Fetc%2Fpasswd: artifactsDir 외부 escape 없음", async () => {
    const result = await invoke({ filename: "%2E%2E%2Fetc%2Fpasswd", content: "url-encoded" });
    const parsed = parseResult(result);
    expect(parsed.success).toBe(true);
    // path must stay inside .nexus/state/<session_id>/artifacts
    expect(parsed.path).toContain(path.join(".nexus", "state", ARTIFACT_TEST_SESSION, "artifacts"));
    expect(parsed.path).not.toContain("..");
    // %2E%2E is NOT decoded by sanitizeName — it's treated as a literal segment name
    const writtenPath = path.join(tmpDir, parsed.path);
    expect(fs.existsSync(writtenPath)).toBe(true);
  });

  test("NULL byte filename — fs 레이어 차단 또는 정상 (traversal escape 없음)", async () => {
    const filename = "\x00etc/passwd";
    let threwError = false;
    let parsedPath: string | undefined;

    try {
      const result = await invoke({ filename, content: "null-byte" });
      const parsed = parseResult(result);
      parsedPath = parsed.path;
    } catch {
      threwError = true;
    }

    if (!threwError && parsedPath !== undefined) {
      // If it didn't throw, the written path must be inside artifactsDir
      expect(parsedPath).toContain(path.join(".nexus", "state", ARTIFACT_TEST_SESSION, "artifacts"));
      expect(parsedPath).not.toContain("..");
      // Must NOT have written outside tmpDir
      const writtenFull = path.join(tmpDir, parsedPath);
      const artifactsDir = path.join(tmpDir, ".nexus", "state", ARTIFACT_TEST_SESSION, "artifacts");
      expect(writtenFull.startsWith(artifactsDir)).toBe(true);
    }
    // Either throw or safe path — both are acceptable outcomes
    expect(threwError || parsedPath !== undefined).toBe(true);
  });

  test("symlink escape — artifactsDir 안 symlink → 외부 escape 차단", async () => {
    const artifactsDir = path.join(tmpDir, ".nexus", "state", ARTIFACT_TEST_SESSION, "artifacts");
    fs.mkdirSync(artifactsDir, { recursive: true });

    // Create a symlink inside artifactsDir pointing to /tmp (an external directory)
    const externalTarget = os.tmpdir();
    const symlinkPath = path.join(artifactsDir, "evil-link");
    fs.symlinkSync(externalTarget, symlinkPath);

    let threwError = false;
    let parsedPath: string | undefined;

    try {
      const result = await invoke({ filename: "evil-link/escape.md", content: "escaped" });
      const parsed = parseResult(result);
      parsedPath = parsed.path;
    } catch {
      threwError = true;
    }

    if (!threwError && parsedPath !== undefined) {
      // Resolve the actual written file's real path and verify it's inside tmpDir
      const writtenFull = path.join(tmpDir, parsedPath);
      let realWritten: string;
      try {
        realWritten = fs.realpathSync(writtenFull);
      } catch {
        // File may not exist yet (ENOTDIR scenario) — that's fine, no escape
        realWritten = writtenFull;
      }
      const realArtifactsDir = fs.realpathSync(artifactsDir);
      const realTmpDir = fs.realpathSync(tmpDir);
      // The written file must be within tmpDir (not escaped to externalTarget)
      const escapedToExternal = realWritten.startsWith(externalTarget + path.sep) ||
        realWritten === externalTarget;
      expect(escapedToExternal).toBe(false);
      // Acceptable: written inside tmpDir/artifacts or throw
      const staysInProject = realWritten.startsWith(realTmpDir);
      const staysInArtifacts = realWritten.startsWith(realArtifactsDir);
      expect(staysInProject || staysInArtifacts).toBe(true);
    }
    // throw or safe write — both acceptable
    expect(threwError || parsedPath !== undefined).toBe(true);
  });
});
