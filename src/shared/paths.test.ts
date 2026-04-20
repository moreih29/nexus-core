import { test, expect, describe, beforeEach, afterEach } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execSync } from 'child_process';

import {
  findProjectRoot,
  getNexusRoot,
  getStateRoot,
  getCurrentBranch,
  ensureDir,
  getSessionId,
  getSessionRoot,
  resetByPpidCache,
} from './paths.ts';

// ---------------------------------------------------------------------------
// 헬퍼
// ---------------------------------------------------------------------------

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-paths-'));
}

function initGitRepo(dir: string): void {
  execSync('git init', { cwd: dir, stdio: 'ignore' });
  execSync('git config user.email "test@test.com"', { cwd: dir, stdio: 'ignore' });
  execSync('git config user.name "Test"', { cwd: dir, stdio: 'ignore' });
  // 최초 커밋 없이는 detached HEAD 테스트가 불가능하므로 빈 커밋 생성
  execSync('git commit --allow-empty -m "init"', { cwd: dir, stdio: 'ignore' });
}

// ---------------------------------------------------------------------------
// findProjectRoot
// ---------------------------------------------------------------------------

describe('findProjectRoot', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('1. git 저장소 루트 cwd — 루트 경로 반환', () => {
    initGitRepo(tmpDir);
    const result = findProjectRoot(tmpDir);
    // git rev-parse --show-toplevel이 realpath를 반환할 수 있으므로 resolve
    expect(fs.realpathSync(result)).toBe(fs.realpathSync(tmpDir));
  });

  test('2. git 저장소 내 깊이 nested cwd — 루트 경로 반환', () => {
    initGitRepo(tmpDir);
    const nested = path.join(tmpDir, 'a', 'b', 'c');
    fs.mkdirSync(nested, { recursive: true });
    const result = findProjectRoot(nested);
    expect(fs.realpathSync(result)).toBe(fs.realpathSync(tmpDir));
  });

  test('3. git 없는 독립 디렉토리 — cwd 그대로 반환', () => {
    // tmpDir 안에 .git 없음, 상위도 현재 테스트 환경 git root에 포함될 수 있으므로
    // /tmp 아래의 완전히 분리된 경로를 사용
    const isolated = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-isolated-'));
    try {
      // isolated 내부의 서브 디렉토리에서 시작 — 상위에 .git 없으면 isolated 반환
      const sub = path.join(isolated, 'sub');
      fs.mkdirSync(sub);
      const result = findProjectRoot(sub);
      // .git이 없으면 start(=sub) 반환
      expect(result).toBe(sub);
    } finally {
      fs.rmSync(isolated, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// getNexusRoot / getStateRoot
// ---------------------------------------------------------------------------

describe('getNexusRoot / getStateRoot', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    initGitRepo(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('4a. getNexusRoot — .nexus 경로 형식', () => {
    const result = getNexusRoot(tmpDir);
    expect(result).toBe(path.join(fs.realpathSync(tmpDir), '.nexus'));
  });

  test('4b. getStateRoot — .nexus/state 경로 형식', () => {
    const result = getStateRoot(tmpDir);
    expect(result).toBe(path.join(fs.realpathSync(tmpDir), '.nexus', 'state'));
  });
});

// ---------------------------------------------------------------------------
// getCurrentBranch
// ---------------------------------------------------------------------------

describe('getCurrentBranch', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('5. 정상 브랜치 — 브랜치명 반환', () => {
    initGitRepo(tmpDir);
    // git init 후 기본 브랜치는 main 또는 master
    const branch = getCurrentBranch(tmpDir);
    expect(branch).toMatch(/^(main|master)$/);
  });

  test('6. detached HEAD — 빈 문자열 반환', () => {
    initGitRepo(tmpDir);
    // SHA로 checkout해서 detached HEAD 상태 만들기
    const sha = execSync('git rev-parse HEAD', { cwd: tmpDir, encoding: 'utf8' }).trim();
    execSync(`git checkout ${sha}`, { cwd: tmpDir, stdio: 'ignore' });
    const branch = getCurrentBranch(tmpDir);
    // symbolic-ref는 detached HEAD에서 non-zero exit → 빈 문자열
    expect(branch).toBe('');
  });

  test('7. git 없는 디렉토리 — 빈 문자열 반환', () => {
    // tmpDir에 git init 하지 않음
    const branch = getCurrentBranch(tmpDir);
    expect(branch).toBe('');
  });
});

// ---------------------------------------------------------------------------
// getSessionId / getSessionRoot
// ---------------------------------------------------------------------------

describe('getSessionId', () => {
  let prevSid: string | undefined;

  beforeEach(() => {
    prevSid = process.env.NEXUS_SESSION_ID;
  });

  afterEach(() => {
    if (prevSid === undefined) delete process.env.NEXUS_SESSION_ID;
    else process.env.NEXUS_SESSION_ID = prevSid;
  });

  test('11. NEXUS_SESSION_ID env 설정 시 — env 값 그대로 반환', () => {
    process.env.NEXUS_SESSION_ID = 'my-fixed-session';
    expect(getSessionId()).toBe('my-fixed-session');
  });

  test('12. NEXUS_SESSION_ID 없고 git 브랜치 있으면 — <branch>-<pid> 형식 반환', () => {
    delete process.env.NEXUS_SESSION_ID;
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-sid-'));
    try {
      initGitRepo(tmpDir);
      const sid = getSessionId(tmpDir);
      // Should match <sanitized_branch>-<pid>
      expect(sid).toMatch(/^[a-zA-Z0-9_-]+-\d+$/);
      expect(sid).toContain(`-${process.pid}`);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test('13. NEXUS_SESSION_ID 없고 git 없으면 — unknown-<pid> 형식 반환', () => {
    delete process.env.NEXUS_SESSION_ID;
    const isolated = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-no-git-'));
    try {
      const sid = getSessionId(isolated);
      expect(sid).toBe(`unknown-${process.pid}`);
    } finally {
      fs.rmSync(isolated, { recursive: true, force: true });
    }
  });
});

describe('getSessionId — by-ppid side-channel', () => {
  const TEST_PPID = 99999;
  let tmpDir: string;
  let prevSid: string | undefined;
  let prevTestPpid: string | undefined;

  function byPpidFilePath(): string {
    return path.join(tmpDir, '.nexus/state/runtime/by-ppid', `${TEST_PPID}.json`);
  }

  function writeByPpidFile(sessionId: string): void {
    const dir = path.dirname(byPpidFilePath());
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(byPpidFilePath(), JSON.stringify({ session_id: sessionId, updated_at: new Date().toISOString(), cwd: tmpDir }));
  }

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-ppid-'));
    prevSid = process.env.NEXUS_SESSION_ID;
    prevTestPpid = process.env.NEXUS_TEST_PPID;
    delete process.env.NEXUS_SESSION_ID;
    process.env.NEXUS_TEST_PPID = String(TEST_PPID);
    resetByPpidCache();
  });

  afterEach(() => {
    if (prevSid === undefined) delete process.env.NEXUS_SESSION_ID;
    else process.env.NEXUS_SESSION_ID = prevSid;
    if (prevTestPpid === undefined) delete process.env.NEXUS_TEST_PPID;
    else process.env.NEXUS_TEST_PPID = prevTestPpid;
    resetByPpidCache();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('A. NEXUS_SESSION_ID env 최우선 — by-ppid 파일 무관하게 env 값 반환', () => {
    writeByPpidFile('from-file-session');
    process.env.NEXUS_SESSION_ID = 'env-wins';
    expect(getSessionId(tmpDir)).toBe('env-wins');
  });

  test('B. by-ppid 파일 있을 때 — 파일의 session_id 반환', () => {
    writeByPpidFile('session-from-ppid-file');
    expect(getSessionId(tmpDir)).toBe('session-from-ppid-file');
  });

  test('C. by-ppid 파일 없으면 — branch-pid fallback', () => {
    const isolated = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-ppid-nogit-'));
    try {
      const sid = getSessionId(isolated);
      expect(sid).toBe(`unknown-${process.pid}`);
    } finally {
      fs.rmSync(isolated, { recursive: true, force: true });
    }
  });

  test('D. by-ppid 파일 mtime 변경 시 캐시 invalidate — 갱신된 session_id 반환', () => {
    writeByPpidFile('first-session');
    expect(getSessionId(tmpDir)).toBe('first-session');

    const before = fs.statSync(byPpidFilePath()).mtimeMs;
    let after = before;
    while (after === before) {
      writeByPpidFile('second-session');
      after = fs.statSync(byPpidFilePath()).mtimeMs;
    }

    expect(getSessionId(tmpDir)).toBe('second-session');
  });
});

describe('getSessionRoot', () => {
  let prevSid: string | undefined;
  let tmpDir: string;

  beforeEach(() => {
    prevSid = process.env.NEXUS_SESSION_ID;
    process.env.NEXUS_SESSION_ID = 'test-session';
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-sroot-'));
    initGitRepo(tmpDir);
  });

  afterEach(() => {
    if (prevSid === undefined) delete process.env.NEXUS_SESSION_ID;
    else process.env.NEXUS_SESSION_ID = prevSid;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('14. NEXUS_SESSION_ID 고정 시 — .nexus/state/<sid>/ 형식 반환', () => {
    const result = getSessionRoot(tmpDir);
    const projectRoot = fs.realpathSync(tmpDir);
    expect(result).toBe(path.join(projectRoot, '.nexus', 'state', 'test-session'));
  });

  test('15. getSessionRoot는 getStateRoot + session_id 조합', () => {
    const stateRoot = getStateRoot(tmpDir);
    const sessionRoot = getSessionRoot(tmpDir);
    expect(sessionRoot).toBe(path.join(stateRoot, 'test-session'));
  });
});

// ---------------------------------------------------------------------------
// ensureDir
// ---------------------------------------------------------------------------

describe('ensureDir', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('8. 신규 디렉토리 생성', () => {
    const target = path.join(tmpDir, 'newdir');
    expect(fs.existsSync(target)).toBe(false);
    ensureDir(target);
    expect(fs.existsSync(target)).toBe(true);
    expect(fs.statSync(target).isDirectory()).toBe(true);
  });

  test('9. 이미 존재하는 디렉토리 — 멱등 (에러 없음)', () => {
    const target = path.join(tmpDir, 'existing');
    fs.mkdirSync(target);
    expect(() => ensureDir(target)).not.toThrow();
    expect(fs.existsSync(target)).toBe(true);
  });

  test('10. 깊은 중첩 경로 생성', () => {
    const target = path.join(tmpDir, 'a', 'b', 'c', 'd', 'e');
    expect(fs.existsSync(target)).toBe(false);
    ensureDir(target);
    expect(fs.existsSync(target)).toBe(true);
    expect(fs.statSync(target).isDirectory()).toBe(true);
  });
});
