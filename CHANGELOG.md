# Changelog

이 파일은 [Keep a Changelog](https://keepachangelog.com/en/0.3.0/) 형식을 따릅니다.

---

## [0.16.1] - 2026-04-20

### Fixed

- v0.16.0에서 `prompt-router` 번들이 런타임에 `assets/tools/tool-name-map.yml`을 consumer target 트리 상향 탐색으로 찾다가 실패해 `UserPromptSubmit` hook이 exit 1로 throw하던 regression ([#46](https://github.com/moreih29/nexus-core/issues/46)).
  `scripts/build-hooks.ts:compileHandlers()`가 `prompt-router` entry에만 `tool-name-map.yml`의 `invocations` 섹션과 `assets/agents`·`assets/skills` 디렉토리 이름 배열을 JSON으로 parse해 `globalThis.__NEXUS_INLINE_INVOCATIONS__`·`__NEXUS_INLINE_RULE_TARGETS__`에 주입하고, `assets/hooks/prompt-router/handler.ts:loadInvocations()`·`loadValidRuleTargets()`가 이 globalThis 값을 우선 사용하도록 변경되었습니다. 기존 FS 상향 탐색 경로는 nexus-core source tree 내 dev 시나리오를 위해 fallback으로 유지됩니다.
  영향: consumer plugin에서 `[run]`·`[plan]`·`[sync]`·`[d]`·`[m]`·`[rule]` tag dispatch가 모두 복구됩니다.

### Added

- `scripts/smoke/smoke-consumer.ts` — distribution-invariant smoke gate. `mkdtemp` 타깃에 `sync --harness=claude`를 실행한 뒤 `prompt-router`에 `[run]` / `[rule]` payload를 주입하여 `exit 0` + `<system-notice>` stdout을 assert합니다. `bun run smoke` aggregate 체인 끝에 추가되어 `validate.yml`·`publish-npm.yml` CI에서 자동 실행되며, source-tree 기반 기존 smoke가 놓치는 consumer-install 시나리오 class를 차단합니다.

### Migration Notes

- `bun add @moreih29/nexus-core@^0.16.1` / `npm i @moreih29/nexus-core@0.16.1`로 bump 후 `bun run sync`로 번들을 target에 재배포하세요.
- v0.16.0은 `prompt-router`가 항상 throw하므로 **deprecate 권장**.

---

## [0.16.0] - 2026-04-20

### BREAKING CHANGES

- **Codex `agents/*.toml` 스키마 전환** ([#42](https://github.com/moreih29/nexus-core/issues/42)): `agents/*.toml`이 기존 `[agents.<id>]` nested 구조에서 root-level `name`·`developer_instructions` standalone role file 스키마로 전환됩니다. `~/.codex/config.toml`의 `[agents.<id>]` 정의와 혼용할 수 없습니다.
  Consumer 대응: `bun run sync` 재실행 후 `bash install/install.sh`를 재실행하여 `~/.codex/agents/`를 새 스키마로 재갱신하세요.

- **OpenCode `opencode.json.fragment` 생성 중단** ([#43](https://github.com/moreih29/nexus-core/issues/43)): core가 `opencode.json.fragment`를 더 이상 생성하지 않습니다. fragment-merge 경로는 폐기되며, plugin auto-register(`src/index.ts`의 `export const agents`)가 canonical 경로입니다.
  Consumer 대응: fragment-merge postinstall 로직을 제거하고, consumer 워크스페이스의 `.opencode/opencode.json`을 `plugin: ["<name>"]`·`default_agent: "..."`·`mcp` 구성으로 전환하세요. canonical 예제는 `docs/contract/harness-io.md` §4-2 참조.

### Fixed

- 이슈 [#40](https://github.com/moreih29/nexus-core/issues/40)·[#41](https://github.com/moreih29/nexus-core/issues/41) 중복 추적을 [#42](https://github.com/moreih29/nexus-core/issues/42)로 통합.

### Added

- Distribution-invariant smoke gate 3개(Claude·Codex·OpenCode, `scripts/smoke/`) 추가. CI의 release 전 단계에서 3 하네스 harness 계약 정합성을 자동 검증합니다.

### Migration Notes

- **Codex consumer**: `bun run sync` 실행 후 `bash install/install.sh` 순서로 재배포. 이 순서로 `~/.codex/agents/`가 새 standalone role file 스키마로 갱신됩니다.
- **OpenCode consumer**: `.opencode/opencode.json`에서 `agents: [...]` 키를 제거하세요. `plugin: ["<name>"]`만 두면 agents가 자동 등록됩니다. 정확한 예제는 `docs/contract/harness-io.md` §4-2를 참조하세요.
- **버전 bump**: `bun add @moreih29/nexus-core@^0.16.0`.

---

## [0.15.2] - 2026-04-20

### Fixed

- 세 하네스(Claude·Codex·OpenCode) 공통 hook bundle이 `export default handler`만 담아 `node dist/hooks/<name>.js` 실행 시 handler가 호출되지 않고 silent no-op으로 종료되던 critical 버그 ([#39](https://github.com/moreih29/nexus-core/issues/39)).
  `scripts/build-hooks.ts compileHandlers()`가 각 hook별로 stdin→JSON.parse→handler invoke→stdout write 부트스트랩을 수행하는 임시 entry 파일을 emit한 뒤 `bun build`에 이 entry를 입력으로 주입하도록 변경되었습니다. `assets/hooks/*/handler.ts` 소스는 순수 라이브러리로 유지되고, `dist/hooks/<name>.js`만 CLI 진입점으로 동작합니다.
  영향: SessionStart 시 `.nexus/state/<sid>/` 생성, `[run]`·`[plan]`·`[sync]` tag dispatch, agent-tracker 기록, SubagentStop additional_context 주입 경로가 모두 복구됩니다. OpenCode `spawnHandler` (spawn+stdin+stdout JSON) 경로도 동일 번들로 정상 동작합니다.

### Migration Notes

- `bun add @moreih29/nexus-core@^0.15.2` / `npm i @moreih29/nexus-core@0.15.2`로 bump. Consumer sync를 재실행하여 새 번들을 target에 복사하세요(`bun run sync`).
- v0.15.0 / v0.15.1은 hook 경로 전체가 silent no-op이므로 **deprecate 권장**.

---

## [0.15.1] - 2026-04-20

### Fixed

- `@moreih29/nexus-core@0.15.0` tarball의 fresh consumer install에서 `nexus-core sync --harness=<x>`가 FATAL로 실패하던 회귀 ([#34](https://github.com/moreih29/nexus-core/issues/34), [#35](https://github.com/moreih29/nexus-core/issues/35), [#36](https://github.com/moreih29/nexus-core/issues/36)).
  consumer `sync`는 더 이상 `assets/hooks/*/handler.ts`를 재컴파일하지 않습니다. publish 시점에 `bun build --target node --format esm`으로 번들링된 self-contained `dist/hooks/<name>.js`와 `dist/manifests/<harness>-hooks.json`을 target 디렉터리로 단순 복사하는 `syncHooksToTarget()` 경로로 재설계되었습니다. handler의 `../../../src/...` import가 distribution universe에서 resolve 실패하던 근본 원인이 제거됩니다.
- `compileHandlers`가 3 하네스 모두에서 excluded인 hook까지 compile 시도해 불필요한 `bun build` 호출과 WARN 노이즈를 발생시키던 문제 ([#35](https://github.com/moreih29/nexus-core/issues/35) 결함 #1).
  이제 portability plan을 받아 `registeredIn.length===0`인 hook을 skip합니다.
- `build-hooks`가 consumer install 시 `node_modules/@moreih29/nexus-core/dist/hooks/`로 쓰기를 시도하던 anti-pattern ([#35](https://github.com/moreih29/nexus-core/issues/35) 결함 #3).
  authoring-time `buildHooks()`와 consumer-time `syncHooksToTarget()`이 분리되어 후자는 target 외부 쓰기가 0건입니다.
- Claude `hooks/hooks.json`이 consumer target에 도달하지 않고 hookCommand 경로와 불일치하던 문제 ([#35](https://github.com/moreih29/nexus-core/issues/35) 결함 #4).
  prebuilt `dist/manifests/claude-hooks.json` → `<target>/hooks/hooks.json`, `dist/hooks/*.js` → `<target>/dist/hooks/*.js` 복사로 `${CLAUDE_PLUGIN_ROOT}/dist/hooks/<name>.js` runtime 경로와 정합됩니다. Codex 동일.
- Generator가 emit하던 `import type { AgentConfig } from "opencode"`가 존재하지 않는 npm 패키지를 가리켜 consumer `tsc --noEmit`이 10건 TS2307로 실패하던 문제 ([#36](https://github.com/moreih29/nexus-core/issues/36) Bug 1).
  신규 `@moreih29/nexus-core/types` 서브패스에 nexus 내부 `AgentConfig` 타입을 정의·export하고, `scripts/build-agents.ts:611` generator가 이 경로로 import를 emit하도록 교체되었습니다.

### Added

- 신규 runtime subpath export `@moreih29/nexus-core/types` — `AgentConfig`, `PermissionMode` 타입 제공.
  `package.json exports`에 `types` + `import` 조건부로 추가되어 consumer의 `tsc --noEmit` 및 ESM runtime 양쪽에서 resolve됩니다.
- `docs/contract/harness-io.md` Claude·Codex 계약에 `hooks/hooks.json`·`dist/hooks/<name>.js` Managed 항목 명문화 ([#35](https://github.com/moreih29/nexus-core/issues/35) 결함 #5).
  footnote로 "consumer sync는 재컴파일 금지, publish-time prebuilt의 단순 복사만" 원칙을 기록.
- `.nexus/context/architecture.md`에 **Authoring vs Distribution universe 경계** 절 신설 ([#37](https://github.com/moreih29/nexus-core/issues/37) proposal #2).
  동일 클래스의 회귀가 재발하지 않도록 경계·원칙·사례(`../../../src/...`·`"opencode"` 패키지명)를 인라인 기록.
- `validate.yml`·`publish-npm.yml`에 **Distribution-invariant consumer sync smoke** 스텝 추가 ([#37](https://github.com/moreih29/nexus-core/issues/37)).
  repo 외부 임시 디렉터리에 `npm pack` tarball을 install하고 3 하네스 non-dry-run `sync` + OpenCode `tsc --noEmit`을 실행합니다. authoring 트리의 sibling `src/`·`scripts/`에 우연히 resolve되던 경로가 distribution에서 실패하는 회귀는 publish 전 스텝에서 차단됩니다.

### Migration Notes

- `bun add @moreih29/nexus-core@^0.15.1`로 단순 bump. breaking 없음.
- v0.15.0은 consumer full sync가 동작하지 않아 **deprecate 권장**. v0.14.1은 계속 사용 가능하나 v0.15 계약 갱신 대상이면 v0.15.1로 직행.

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
