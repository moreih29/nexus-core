import { join, resolve } from 'path';
import { existsSync, mkdirSync, statSync, readFileSync } from 'fs';
import { execSync } from 'child_process';

/**
 * 프로젝트 루트 해석. 우선순위:
 *   1. NEXUS_PROJECT_ROOT env (테스트·명시 주입용)
 *   2. git rev-parse --show-toplevel (cwd 혹은 인자 기준)
 *   3. cwd 상승하며 .git 수동 탐색
 *   4. fallback: start 자체
 */
export function findProjectRoot(cwd?: string): string {
  const envOverride = process.env['NEXUS_PROJECT_ROOT'];
  if (envOverride) return envOverride;

  const start = cwd ?? process.cwd();
  try {
    return execSync('git rev-parse --show-toplevel', {
      encoding: 'utf8',
      cwd: start,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    let dir = start;
    while (true) {
      if (existsSync(join(dir, '.git'))) return dir;
      const parent = resolve(dir, '..');
      if (parent === dir) break;
      dir = parent;
    }
    return start;
  }
}

/** .nexus/ 루트 경로 getter */
export function getNexusRoot(cwd?: string): string {
  return join(findProjectRoot(cwd), '.nexus');
}

/** .nexus/state/ 경로 getter */
export function getStateRoot(cwd?: string): string {
  return join(getNexusRoot(cwd), 'state');
}

/** 현재 git 브랜치명 반환. detached HEAD면 "HEAD" 또는 빈 문자열, git 없으면 빈 문자열 */
export function getCurrentBranch(cwd?: string): string {
  const opts = {
    encoding: 'utf8' as const,
    stdio: ['ignore', 'pipe', 'ignore'] as ['ignore', 'pipe', 'ignore'],
    ...(cwd ? { cwd } : {}),
  };
  try {
    return execSync('git symbolic-ref --short HEAD', opts).trim();
  } catch {
    return '';
  }
}

/** 디렉토리 생성 (재귀). 이미 존재하면 idempotent */
export function ensureDir(p: string): void {
  mkdirSync(p, { recursive: true });
}

/** branch명에서 파일시스템에 안전한 문자만 남긴다 */
function sanitizeBranch(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]+/g, '_');
}

function runtimeByPpidDir(cwd: string): string {
  return join(cwd, '.nexus/state/runtime/by-ppid');
}

function byPpidFilePath(cwd: string, ppid: number): string {
  return join(runtimeByPpidDir(cwd), `${ppid}.json`);
}

export function getParentPid(): number {
  const testOverride = parseInt(process.env['NEXUS_TEST_PPID'] ?? '');
  return testOverride || process.ppid;
}

interface ByPpidCache {
  mtimeMs: number;
  value: string;
}

const byPpidCache = new Map<string, ByPpidCache>();

export function resetByPpidCache(): void {
  byPpidCache.clear();
}

function readSessionIdFromByPpidFile(cwd: string): string | null {
  try {
    const ppid = getParentPid();
    const filePath = byPpidFilePath(cwd, ppid);
    const st = statSync(filePath);
    const cached = byPpidCache.get(filePath);
    if (cached && cached.mtimeMs === st.mtimeMs) {
      return cached.value;
    }
    const raw = readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw) as { session_id: string };
    byPpidCache.set(filePath, { mtimeMs: st.mtimeMs, value: parsed.session_id });
    return parsed.session_id;
  } catch {
    return null;
  }
}

/** NEXUS_SESSION_ID env 우선, 없으면 by-ppid 파일, 없으면 '<branch>-<pid>' 또는 'unknown-<pid>' */
export function getSessionId(cwd?: string): string {
  const envId = process.env['NEXUS_SESSION_ID'];
  if (envId) return envId;

  const resolvedCwd = cwd ?? process.cwd();
  const byPpidId = readSessionIdFromByPpidFile(resolvedCwd);
  if (byPpidId) return byPpidId;

  const branch = getCurrentBranch(cwd);
  const pid = process.pid;
  if (!branch) return `unknown-${pid}`;
  return `${sanitizeBranch(branch)}-${pid}`;
}

/** .nexus/state/<session_id>/ 경로 */
export function getSessionRoot(cwd?: string): string {
  return join(getStateRoot(cwd), getSessionId(cwd));
}
