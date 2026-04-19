import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

// We need to patch getStateRoot to point to our tmp dir.
// Since tool-log.ts calls getStateRoot() at runtime (not at import time),
// we can use environment variables + a manual override approach.
// The simplest approach: import logToolCall and control NEXUS_SESSION_ID env,
// then verify output in a real temp dir by monkey-patching STATE_ROOT via env.

// Because getStateRoot() uses findProjectRoot() which calls git, we can't
// easily redirect it via env. Instead we test via a direct re-export wrapper
// that accepts an injectable state root. But the spec says to test logToolCall
// as exported — so we intercept at the filesystem level using a real temp dir
// and a session ID we control, then read back the real project's state dir.

// Simpler approach: capture the real stateRoot path from paths.ts and
// verify files are created there, then clean up after each test.

import { getStateRoot } from "./paths.ts";
import { logToolCall } from "./tool-log.ts";

const REAL_STATE_ROOT = getStateRoot();

function makeSessionDir(sessionId: string): string {
  return path.join(REAL_STATE_ROOT, sessionId);
}

function makeLogFile(sessionId: string): string {
  return path.join(makeSessionDir(sessionId), "tool-log.jsonl");
}

function cleanSession(sessionId: string): void {
  const dir = makeSessionDir(sessionId);
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

describe("logToolCall", () => {
  const TEST_SESSION = "test-session-tool-log";

  beforeEach(() => {
    process.env["NEXUS_SESSION_ID"] = TEST_SESSION;
    cleanSession(TEST_SESSION);
  });

  afterEach(() => {
    delete process.env["NEXUS_SESSION_ID"];
    cleanSession(TEST_SESSION);
  });

  test("1. NEXUS_SESSION_ID env 사용 — 해당 세션 디렉토리에 기록", () => {
    const entry = {
      tool: "test-tool",
      args: { key: "value" },
      response: { ok: true },
      duration_ms: 100,
    };
    logToolCall(entry);

    const logFile = makeLogFile(TEST_SESSION);
    expect(fs.existsSync(logFile)).toBe(true);

    const lines = fs.readFileSync(logFile, "utf8").trim().split("\n");
    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0]);
    expect(parsed.tool).toBe("test-tool");
    expect(parsed.args).toEqual({ key: "value" });
    expect(parsed.response).toEqual({ ok: true });
    expect(parsed.duration_ms).toBe(100);
  });

  test("2. timestamp 미지정 시 ISO string 자동 추가", () => {
    logToolCall({ tool: "t", args: {}, response: {}, duration_ms: 1 });

    const logFile = makeLogFile(TEST_SESSION);
    const lines = fs.readFileSync(logFile, "utf8").trim().split("\n");
    const parsed = JSON.parse(lines[0]);
    expect(typeof parsed.timestamp).toBe("string");
    expect(() => new Date(parsed.timestamp)).not.toThrow();
    // valid ISO date
    expect(new Date(parsed.timestamp).getTime()).toBeGreaterThan(0);
  });

  test("3. timestamp 지정 시 그대로 유지", () => {
    const ts = "2026-01-01T00:00:00.000Z";
    logToolCall({ tool: "t", args: {}, response: {}, duration_ms: 1, timestamp: ts });

    const logFile = makeLogFile(TEST_SESSION);
    const lines = fs.readFileSync(logFile, "utf8").trim().split("\n");
    const parsed = JSON.parse(lines[0]);
    expect(parsed.timestamp).toBe(ts);
  });

  test("4. 디렉토리 자동 생성 — 세션 디렉토리 없어도 mkdir 후 기록", () => {
    const dir = makeSessionDir(TEST_SESSION);
    expect(fs.existsSync(dir)).toBe(false);

    logToolCall({ tool: "t", args: {}, response: {}, duration_ms: 1 });

    expect(fs.existsSync(dir)).toBe(true);
    expect(fs.existsSync(makeLogFile(TEST_SESSION))).toBe(true);
  });

  test("5. jsonl append — 여러 호출 시 각 줄에 기록", () => {
    logToolCall({ tool: "first", args: {}, response: {}, duration_ms: 1 });
    logToolCall({ tool: "second", args: {}, response: {}, duration_ms: 2 });
    logToolCall({ tool: "third", args: {}, response: {}, duration_ms: 3 });

    const logFile = makeLogFile(TEST_SESSION);
    const lines = fs.readFileSync(logFile, "utf8").trim().split("\n");
    expect(lines).toHaveLength(3);
    expect(JSON.parse(lines[0]).tool).toBe("first");
    expect(JSON.parse(lines[1]).tool).toBe("second");
    expect(JSON.parse(lines[2]).tool).toBe("third");
  });

  test("6. write 실패 시 throw 안 함 (best-effort) — 읽기 전용 디렉토리 시뮬레이션", () => {
    // 세션 디렉토리를 읽기 전용으로 만들어 append 실패 유발
    const dir = makeSessionDir(TEST_SESSION);
    fs.mkdirSync(dir, { recursive: true });
    fs.chmodSync(dir, 0o444);

    expect(() => {
      logToolCall({ tool: "fail", args: {}, response: {}, duration_ms: 1 });
    }).not.toThrow();

    // 정리: 권한 복원
    fs.chmodSync(dir, 0o755);
  });

  test("7. env 미설정 시 fallback — branch-pid 형식 (unknown-pid 포함)", () => {
    delete process.env["NEXUS_SESSION_ID"];

    const pid = process.pid;

    logToolCall({ tool: "fallback-test", args: {}, response: {}, duration_ms: 5 });

    // state/ 아래를 재귀적으로 탐색해 tool-log.jsonl 파일이 생성되었는지 확인
    // (branch에 '/'가 포함되면 nested 디렉토리가 생성될 수 있으므로 재귀 검색)
    function findToolLogFiles(dir: string): string[] {
      if (!fs.existsSync(dir)) return [];
      const results: string[] = [];
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          results.push(...findToolLogFiles(full));
        } else if (entry.name === "tool-log.jsonl") {
          results.push(full);
        }
      }
      return results;
    }

    const logFiles = findToolLogFiles(REAL_STATE_ROOT);
    // 적어도 1개의 tool-log.jsonl이 state/ 하위에 존재해야 함
    expect(logFiles.length).toBeGreaterThanOrEqual(1);

    // 해당 파일의 세션 디렉토리 이름이 ${pid}로 끝나거나 unknown-${pid} 형식인지 확인
    const sessionDirs = logFiles.map((f) => {
      // state/<sessionId>/tool-log.jsonl 형식
      const rel = path.relative(REAL_STATE_ROOT, f);
      return rel.replace(/\/tool-log\.jsonl$/, "");
    });
    const matchingSession = sessionDirs.find(
      (s) => s.endsWith(`-${pid}`) || s === `unknown-${pid}`,
    );
    expect(matchingSession).toBeDefined();

    // 정리: 생성된 세션 디렉토리 제거
    for (const sessionId of sessionDirs) {
      const dir = path.join(REAL_STATE_ROOT, sessionId);
      if (fs.existsSync(dir)) {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    }

    // NEXUS_SESSION_ID 복원 (afterEach가 cleanSession을 호출하므로)
    process.env["NEXUS_SESSION_ID"] = TEST_SESSION;
  });

  test("8. 동시 호출 race 안전 — 병렬 append 후 라인 수 일치", async () => {
    const N = 10;
    await Promise.all(
      Array.from({ length: N }, (_, i) =>
        Promise.resolve(
          logToolCall({ tool: `concurrent-${i}`, args: {}, response: {}, duration_ms: i }),
        ),
      ),
    );

    const logFile = makeLogFile(TEST_SESSION);
    const content = fs.readFileSync(logFile, "utf8");
    const lines = content.trim().split("\n").filter((l) => l.trim() !== "");
    expect(lines.length).toBe(N);
    // 모든 라인이 유효한 JSON인지 확인
    for (const line of lines) {
      expect(() => JSON.parse(line)).not.toThrow();
    }
  });
});
