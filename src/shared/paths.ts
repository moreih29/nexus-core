import { join, resolve } from 'path';
import { existsSync, mkdirSync } from 'fs';
import { execSync } from 'child_process';

/** git root를 찾아 반환. git 없으면 cwd 상승하며 .git 탐색, 끝까지 못 찾으면 cwd 반환 */
export function findProjectRoot(cwd?: string): string {
  const start = cwd ?? process.cwd();
  try {
    return execSync('git rev-parse --show-toplevel', {
      encoding: 'utf8',
      cwd: start,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    // git 없거나 git 저장소 아닌 경우 — .git 디렉토리 수동 탐색
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

/** module-level const (cwd 고정 환경용; 테스트에서는 getter 사용 권장) */
export const NEXUS_ROOT: string = getNexusRoot();
export const STATE_ROOT: string = getStateRoot();

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

/** NEXUS_SESSION_ID env 우선, 없으면 '<branch>-<pid>' 또는 'unknown-<pid>' */
export function getSessionId(cwd?: string): string {
  const envId = process.env['NEXUS_SESSION_ID'];
  if (envId) return envId;

  const branch = getCurrentBranch(cwd);
  const pid = process.pid;
  if (!branch) return `unknown-${pid}`;
  return `${sanitizeBranch(branch)}-${pid}`;
}

/** .nexus/state/<session_id>/ 경로 */
export function getSessionRoot(cwd?: string): string {
  return join(getStateRoot(cwd), getSessionId(cwd));
}
