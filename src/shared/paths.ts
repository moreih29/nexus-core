import { execSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";

/**
 * 프로젝트 루트 해석. 우선순위:
 *   1. NEXUS_PROJECT_ROOT env (테스트·명시 주입용)
 *   2. git rev-parse --show-toplevel (cwd 혹은 인자 기준)
 *   3. cwd 상승하며 .git 수동 탐색
 *   4. fallback: start 자체
 */
export function findProjectRoot(cwd?: string): string {
  const envOverride = process.env.NEXUS_PROJECT_ROOT;
  if (envOverride) return envOverride;

  const start = cwd ?? process.cwd();
  try {
    return execSync("git rev-parse --show-toplevel", {
      encoding: "utf8",
      cwd: start,
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    let dir = start;
    while (true) {
      if (existsSync(join(dir, ".git"))) return dir;
      const parent = resolve(dir, "..");
      if (parent === dir) break;
      dir = parent;
    }
    return start;
  }
}

/** .nexus/ 루트 경로 getter */
export function getNexusRoot(cwd?: string): string {
  return join(findProjectRoot(cwd), ".nexus");
}

/** .nexus/state/ 경로 getter */
export function getStateRoot(cwd?: string): string {
  return join(getNexusRoot(cwd), "state");
}

/** 현재 git 브랜치명 반환. detached HEAD면 "HEAD" 또는 빈 문자열, git 없으면 빈 문자열 */
export function getCurrentBranch(cwd?: string): string {
  const opts = {
    encoding: "utf8" as const,
    stdio: ["ignore", "pipe", "ignore"] as ["ignore", "pipe", "ignore"],
    ...(cwd ? { cwd } : {}),
  };
  try {
    return execSync("git symbolic-ref --short HEAD", opts).trim();
  } catch {
    return "";
  }
}

/** 디렉토리 생성 (재귀). 이미 존재하면 idempotent */
export function ensureDir(p: string): void {
  mkdirSync(p, { recursive: true });
}
