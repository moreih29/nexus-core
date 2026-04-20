# Changelog

이 파일은 [Keep a Changelog](https://keepachangelog.com/en/0.3.0/) 형식을 따릅니다.

---

## [0.14.1] - 2026-04-20

### Fixed

- 컴파일된 `dist/scripts/*.js` 의 ROOT 해결 로직이 dist 디렉토리를 가리켜 `assets/capability-matrix.yml` 접근이 실패하던 문제 ([#28](https://github.com/moreih29/nexus-core/issues/28)).
  `src/shared/package-root.ts` 신설 — `findPackageRoot()` 헬퍼가 dirname 상향 탐색으로 첫 `package.json` 을 찾아 반환하여 dev·prod 경로 비대칭을 해소했습니다.
  `scripts/cli.ts`, `scripts/build-agents.ts`, `scripts/build-hooks.ts` 세 파일이 이 헬퍼 호출로 전환되었습니다.
- `nexus-core sync --harness=<claude|codex|opencode>` 실행 시 `[build-agents] capability-matrix.yml not found at: <pkg>/dist/assets/capability-matrix.yml` 오류로 실패하던 문제 복구.
- `nexus-core list` 가 silent 0 결과를 반환하던 문제 복구.
- `scripts/cli.ts` 의 엔트리포인트 가드를 symlink-aware 하게 보강. 기존 `process.argv[1]?.endsWith("cli.js")` 조건은 `node_modules/.bin/nexus-core` symlink 경유 호출 시 `argv[1]` 이 symlink 경로("nexus-core" 서픽스)가 되어 `main()` 이 실행되지 않는 문제가 있었습니다. `realpathSync` 로 symlink 해소 후 `import.meta.url` 과 비교하여 bin symlink·직접 node 호출·test import 세 경로 모두에서 올바르게 동작하도록 수정.

### Added

- CI smoke 확장 — `publish-npm.yml` · `validate.yml` 의 "Install from pack + smoke test" 스텝에 두 검증 추가:
  - `npx nexus-core sync --harness=claude --target=./ --dry-run` exit 0 — 실제 asset 로드 경로 exercise.
  - `npx nexus-core list` stdout의 `^Agents \([1-9]` 패턴 매치 — silent 빈 결과 탐지.

### Migration Notes

- `bun add @moreih29/nexus-core@^0.14.1` 로 단순 bump. 소스·설정 변경 불필요. breaking 없음.

---

## [0.14.0] - 2026-04-20

### Fixed

- `bin.nexus-core` 경로를 `./scripts/cli.ts` → `./dist/scripts/cli.js`로 수정.
  Node 24는 `node_modules` 하위 `.ts` 파일의 type-stripping을 거부하므로(`ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`), bin이 컴파일된 JS 산출물을 가리키도록 변경했습니다.
- `yaml`, `zod`, `@modelcontextprotocol/sdk`를 `devDependencies`에서 `dependencies`로 이동.
  이전에는 소비자가 이 패키지를 설치하지 않으면 런타임에서 `Cannot find module` 오류가 발생했습니다.
- `tsconfig.hooks.json` 삭제 후 `tsconfig.build.json`으로 통합.
  `scripts/` 디렉터리가 컴파일 범위에 포함되어 `dist/scripts/`가 생성됩니다.
- `package.json`의 `exports` 재설계: `./hooks/opencode-mount`, `./hooks/runtime`, `./hooks/opencode-manifest` 서브패스를 추가.
  이전에는 이 경로가 노출되지 않아 OpenCode 플러그인 구축이 불가능했습니다.
- OpenCode hook manifest 스키마 파싱 결함 수정.
  v0.13.0의 `mountHooks()` 런타임은 manifest를 파싱하지 못해 dead code 상태였습니다. v0.14.0에서 실제로 동작하는 파싱 경로를 복원했습니다.
- `files` 배열에서 `scripts/` 제거.
  TypeScript 원본 파일이 tarball에 포함되지 않습니다.

### Breaking Changes

- **Node.js 엔진 요구사항 상향**: `engines.node` `>=20` → `>=22`.
  `import ... with { type: 'json' }` 구문이 Node 22에서 stable로 확정되었기 때문입니다.

- **OpenCode hook manifest 스키마 전면 교체**:

  이전 스키마(v0.13.0 — 런타임 파싱 실패로 실제로 동작한 적 없음):
  ```json
  {
    "mountHooks": [
      { "event": "...", "matcher": "...", "module": "...", "timeout": 5000 }
    ]
  }
  ```

  신규 스키마(v0.14.0):
  ```json
  {
    "hooks": [
      {
        "name": "...",
        "events": ["..."],
        "matcher": "...",
        "handlerPath": "...",
        "priority": 0,
        "timeout": 5000
      }
    ]
  }
  ```

- **manifest 파일명 변경**: `dist/manifests/opencode-hooks.json` → `opencode-manifest.json`.

- **의존성 제거**: `ajv`, `ajv-errors`, `ajv-formats`, `tinyglobby`가 제거되었습니다.
  코드베이스 전수 조사 결과 사용처가 없음이 확인되었습니다.

> **참고**: v0.13.0 OpenCode hook manifest 형태는 런타임 파싱에 실패해 실제로 동작한 적이 없습니다.
> v0.13.0을 기반으로 OpenCode 플러그인을 구축한 소비자는 없는 것으로 간주합니다.

### Added

- `./hooks/opencode-mount` 서브패스 export — `mountHooks` 함수 노출.
- `./hooks/runtime` 서브패스 export — 런타임 유틸리티 노출.
- `./hooks/opencode-manifest` 서브패스 export — JSON manifest. `import ... with { type: "json" }` 패턴으로 사용합니다.

### Migration Notes

v0.13.0에서 v0.14.0으로 업그레이드하는 소비자는 다음 두 단계를 수행하세요.

**1단계 — Node.js 버전 확인**

```bash
node --version
# v22.0.0 이상이어야 합니다
```

Node 22 미만 환경에서는 설치는 가능하지만 `import ... with { type: "json" }` 구문 실행 시 오류가 발생합니다.

**2단계 — OpenCode 플러그인 import 패턴 적용**

OpenCode 플러그인을 구축 중이라면 다음 thin-wrapper 패턴을 사용하세요.

```typescript
import type { Plugin } from "@opencode-ai/plugin";
import { mountHooks } from "@moreih29/nexus-core/hooks/opencode-mount";
import manifest from "@moreih29/nexus-core/hooks/opencode-manifest" with { type: "json" };

export const OpencodeNexus: Plugin = async (ctx) => mountHooks(ctx, manifest);
```

관련 이슈: [#25](https://github.com/moreih29/nexus-core/issues/25) · [#26](https://github.com/moreih29/nexus-core/issues/26)

---

[0.14.1]: https://github.com/moreih29/nexus-core/releases/tag/v0.14.1
[0.14.0]: https://github.com/moreih29/nexus-core/releases/tag/v0.14.0
