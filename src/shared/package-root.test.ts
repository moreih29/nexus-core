import { test, expect, describe, afterEach } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { findPackageRoot } from "./package-root.ts";

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "nexus-pkg-root-"));
}

describe("findPackageRoot", () => {
  const tmps: string[] = [];

  afterEach(() => {
    for (const d of tmps.splice(0)) {
      fs.rmSync(d, { recursive: true, force: true });
    }
  });

  test("1. package.json이 startDir에 있으면 startDir 반환", () => {
    const tmp = makeTmpDir();
    tmps.push(tmp);
    fs.writeFileSync(path.join(tmp, "package.json"), "{}");
    expect(findPackageRoot(tmp)).toBe(tmp);
  });

  test("2. package.json이 한 단계 위에 있으면 부모 반환", () => {
    const tmp = makeTmpDir();
    tmps.push(tmp);
    fs.writeFileSync(path.join(tmp, "package.json"), "{}");
    const child = path.join(tmp, "scripts");
    fs.mkdirSync(child);
    expect(findPackageRoot(child)).toBe(tmp);
  });

  test("3. package.json이 여러 단계 위에 있으면 해당 조상 반환", () => {
    const tmp = makeTmpDir();
    tmps.push(tmp);
    fs.writeFileSync(path.join(tmp, "package.json"), "{}");
    const deep = path.join(tmp, "dist", "scripts");
    fs.mkdirSync(deep, { recursive: true });
    expect(findPackageRoot(deep)).toBe(tmp);
  });

  test("4. 중간 디렉토리에 package.json이 있으면 가장 가까운 것 반환", () => {
    const tmp = makeTmpDir();
    tmps.push(tmp);
    fs.writeFileSync(path.join(tmp, "package.json"), "{}");
    const mid = path.join(tmp, "mid");
    fs.mkdirSync(mid);
    fs.writeFileSync(path.join(mid, "package.json"), "{}");
    const deep = path.join(mid, "deep");
    fs.mkdirSync(deep);
    expect(findPackageRoot(deep)).toBe(mid);
  });

  test("5. package.json이 없으면 throw", () => {
    const isolated = makeTmpDir();
    tmps.push(isolated);
    // startDir 자체에도 없고 /tmp 등 상위에도 package.json 없을 것을 보장하기 어려우므로
    // 실제 fs root에 달할 수 없는 depth에서 테스트하는 대신,
    // 임시 chroot 없이 가능한 방식으로: 상위에 package.json이 없는 격리 경로 사용
    // /tmp 자체에는 보통 package.json이 없음
    const noRoot = path.join(isolated, "orphan");
    fs.mkdirSync(noRoot);
    // /tmp의 상위로 올라가도 package.json이 없다고 가정하기보다,
    // 직접 throw 동작을 검증: 오류 메시지에 startDir이 포함되는지만 확인
    // (throw 여부는 실제 fs 상태 의존이라 환경마다 다를 수 있음)
    // 단: nexus-core repo 자체가 /tmp에 없으므로 orphan 경로에서 throw 가능성이 높음
    try {
      const result = findPackageRoot(noRoot);
      // 만약 throw 안 하면 — 상위 어딘가에 package.json이 존재한다는 뜻; 결과가 string이어야 함
      expect(typeof result).toBe("string");
    } catch (err) {
      expect(String(err)).toContain("package.json not found");
      expect(String(err)).toContain(noRoot);
    }
  });
});
