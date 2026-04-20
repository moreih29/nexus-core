import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

/**
 * 주어진 디렉토리에서 dirname 상향 탐색하며 package.json을 찾아
 * 패키지 루트 디렉토리를 반환한다. 루트 fs까지 도달해도 못 찾으면 throw.
 */
export function findPackageRoot(startDir: string): string {
  let current = startDir;
  while (true) {
    if (existsSync(join(current, "package.json"))) return current;
    const parent = dirname(current);
    if (parent === current) {
      throw new Error(`findPackageRoot: package.json not found walking up from ${startDir}`);
    }
    current = parent;
  }
}
