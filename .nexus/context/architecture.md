# nexus-core 아키텍처

> 구조 — 패키지 배치와 자기 적용된 .nexus/. 에이전트 조율 모델은 [`orchestration.md`](./orchestration.md) 참조.

## 1. 패키지 구조

루트는 4 분류로 정돈: **자산(`assets/`)** · **문서(`docs/`)** · **코드(`src/` · `dist/` · `scripts/`)** · **메타(`manifest.json` · `.nexus/`)**.

| 경로 | 역할 |
|---|---|
| `assets/agents/` | 에이전트 정의 (`body.md` — frontmatter + 본문 일체). HOW · DO · CHECK 분류. |
| `assets/skills/` | 스킬 정의 (`body.md` — frontmatter + 본문 일체). |
| `assets/hooks/` | Hook 정의 (5개: agent-bootstrap · agent-finalize · post-tool-telemetry · prompt-router · session-init). 각 hook 폴더 안에 `meta.yml` + `handler.ts`. |
| `assets/capability-matrix.yml` | **에이전트용** SSOT. 두 최상위 키 — `capabilities:`(capability 이름 → 하네스별 denylist·sandbox 매핑)와 `model_tier:`(high/standard/low → 하네스별 모델 슬러그). `build-agents.ts`가 읽어 frontmatter/manifest를 생성. 훅용 `assets/hooks/capability-matrix.yml`(이벤트×하네스 지원 매트릭스)과는 별개 파일. |
| `assets/tools/` | `tool-name-map.yml` — 도구 이름 표준 매핑 테이블 + `invocations` 섹션 (4 하네스-중립 호출 템플릿 SSOT). |
| `assets/vocabulary/` | 카테고리·태그·권한·등급·기억 정책 등 표준 어휘. |
| `assets/schema/` | JSON Schema (draft 2020-12). |
| `assets/conformance/` | 도구 · 시나리오 · 생애주기 · 상태 스키마 검증 데이터. |
| `docs/contract/` | consumer가 따라야 할 규범 명세. |
| `docs/consuming/` | consumer 구현 가이드. |
| `src/` | 배포 TS 소스. MCP 서버 (`mcp/`) · Hook 런타임 (`hooks/`) · LSP 통합 (`lsp/`) · 공통 인프라 (`shared/`) · 타입 (`types/`). 상세는 [`mcp-server.md`](./mcp-server.md). |
| `dist/` | 하네스별 빌드 산출물. 상세는 §3 참조. |
| `scripts/` | 개발 전용 내부 도구. `build-agents.ts` (에이전트·스킬 빌드 파이프라인) · `build-hooks.ts` (훅 빌드 파이프라인) · `cli.ts` (nexus-core 서브커맨드 CLI) · 검증 · manifest 생성. |
| `manifest.json` | 배포 메타데이터 (위 자산 구조의 자동 생성 스냅샷). |
| `.nexus/` | nexus-core가 자기 자신에게 적용한 nexus. |

## 2. 3-레이어 스택

nexus-core는 단독으로 동작하지 않는다. 3 하네스 플러그인 레포로 소비되어 최종 사용자에게 전달된다.

```
nexus-core (@moreih29/nexus-core)
  ├── 에이전트·스킬 원본 (assets/agents/*, assets/skills/*)
  ├── Hook 원본 (assets/hooks/*)
  ├── SSOT 자산 (capability-matrix.yml, tool-name-map.yml invocations)
  └── MCP 서버 (src/mcp/) + 빌드 파이프라인 (scripts/)
          │
          │ nexus-core sync (build-agents + build-hooks)
          ▼
  dist/<harness>/   ← 하네스별 빌드 산출물
          │
          │ 플러그인 레포가 소비
          ▼
  claude-nexus-plugin / opencode-nexus-plugin / codex-nexus-plugin
          │
          │ 설치
          ▼
  End user
```

### 2-1. dist/ 하네스별 출력 트리

`nexus-core sync` 실행 후 `dist/` 아래에 하네스별 파일이 생성된다.

| 하네스 | 경로 | 내용 |
|---|---|---|
| Claude | `dist/claude/.claude-plugin/plugin.json` | 플러그인 메타 (Template — 최초 1회 생성) |
| Claude | `dist/claude/.claude-plugin/marketplace.json` | 마켓플레이스 메타 (Template) |
| Claude | `dist/claude/agents/<name>.md` | 하네스 네이티브 에이전트 .md (Managed) |
| Claude | `dist/claude/skills/<name>/SKILL.md` | 스킬 .md (Managed) |
| OpenCode | `dist/opencode/package.json` | 플러그인 패키지 (Template) |
| OpenCode | `dist/opencode/opencode.json.fragment` | 에이전트 등록 fragment (Managed) |
| OpenCode | `dist/opencode/src/index.ts` | 에이전트 export 인덱스 (Managed) |
| OpenCode | `dist/opencode/src/agents/<name>.ts` | 에이전트 TS 모듈 (Managed) |
| OpenCode | `dist/opencode/.opencode/skills/<name>/SKILL.md` | 스킬 .md (Managed) |
| Codex | `dist/codex/plugin/.codex-plugin/plugin.json` | 플러그인 메타 (Managed) |
| Codex | `dist/codex/agents/<name>.toml` | 에이전트 TOML (Managed) |
| Codex | `dist/codex/prompts/<name>.md` | 에이전트 프롬프트 .md (Managed) |
| Codex | `dist/codex/plugin/skills/<name>/SKILL.md` | 스킬 .md (Managed) |
| Codex | `dist/codex/install/config.fragment.toml` | MCP 서버 등록 fragment (Managed) |
| Claude | `dist/claude/settings.json` | Managed — plugin settings, `{ "agent": "<primary>" }` 키로 main thread 시스템 프롬프트 주입 |
| Codex | `dist/codex/install/AGENTS.fragment.md` | Managed — primary agent body를 마커로 감싸 consumer가 수동 머지 |

**덮어쓰기 정책**: `Managed` 경로는 빌드 시마다 항상 덮어씀. `Template` 경로는 파일이 이미 존재하면 건너뜀(`--force`로 강제 덮어쓰기 가능).

### 2-2. 빌드 SSOT 2종

| SSOT 파일 | 목적 | 소비처 |
|---|---|---|
| `assets/capability-matrix.yml` (`capabilities:` 섹션) | capability 이름 → 하네스별 denylist · sandbox 매핑 | `build-agents.ts` Stage 2 |
| `assets/capability-matrix.yml` (`model_tier:` 섹션) | high/standard/low → 하네스별 모델 슬러그(claude: opus/sonnet/haiku, codex: gpt-5.4/gpt-5.3-codex/gpt-5.4-mini, opencode: null) | `build-agents.ts` Stage 2 |
| `assets/tools/tool-name-map.yml` (`invocations` 섹션) | 4종 하네스-중립 호출 템플릿 (`subagent_spawn` · `skill_activation` · `task_register` · `user_question`) → 하네스 네이티브 구문 | `build-agents.ts` Stage 3 · `prompt-router` 런타임 |

### 2-3. 빌드 파이프라인

`build-agents.ts`와 `build-hooks.ts`는 독립 스크립트로 분리 유지된다. `scripts/cli.ts`의 `sync` 서브커맨드가 두 파이프라인을 순서대로 오케스트레이션한다.

**`build-agents.ts` 4단계**:

| 단계 | 내용 |
|---|---|
| 1. 자산 로드 | `assets/agents/*/body.md` · `assets/skills/*/body.md` frontmatter 파싱 |
| 2. capability matrix 로드 | `assets/capability-matrix.yml` 로드 → capability ID 유효성 검증 |
| 3. invocations 로드 | `assets/tools/tool-name-map.yml` invocations 섹션 로드 |
| 4. 하네스별 빌드 | Claude · OpenCode · Codex 각각 `dist/<harness>/` 에 파일 생성. `expandInvocations`가 `{{}}` 템플릿을 하네스 네이티브 구문으로 치환 |

**`build-hooks.ts`**: 훅 `meta.yml` 검증 → capability-matrix.yml 대조 → portability_tier 산출 → 하네스별 훅 매니페스트 생성. 상세는 [`hooks.md`](./hooks.md) §7 참조.

**mode 필드 처리**: `body.md` frontmatter의 `mode` 필드(`primary` | `subagent` | `all`, default `subagent`)를 기반으로 3 하네스 빌드가 각자 primary agent를 주입한다. Claude: `settings.json`의 `agent` 키. OpenCode: `AgentConfig.mode`. Codex: `AGENTS.fragment.md` 마커 블록.

## 3. `.nexus/` 자기 적용

### 3-1. 디렉토리

| 경로 | 역할 | 변경 빈도 | 형식 |
|---|---|---|---|
| `.nexus/context/*.md` | 프로젝트 골격(설계 철학·구조). | 낮음 | markdown |
| `.nexus/memory/` | 동적 기억. 3 카테고리(`empirical-` · `external-` · `pattern-`) 접두사 기반. | 높음 | markdown |
| `.nexus/rules/` | 에이전트·스킬 프롬프트에 자동 주입되는 보조 프롬프트. 파일 이름이 곧 트리거. | 중간 | markdown |
| `.nexus/state/<session_id>/` | 세션별 작업 상태. 멀티세션 허용. | 매 작업 | json + jsonl |
| `.nexus/memory-access.jsonl` | 기억 파일 읽기 누적 이벤트 로그. 강화/망각 신호 원천. (프로젝트 레벨, append-only) | 매 읽기 | jsonl |
| `.nexus/history.json` | 프로젝트 레벨 누적 보관소. cycles 배열, read-modify-write. | 세션 종료 시 | json |
| `.nexus/.gitignore` | 화이트리스트 정책. | 거의 없음 | git |

### 3-2. 세션 상태 파일

`.nexus/state/<session_id>/` 내부:

- `tasks.json` — 작업 목록 스냅샷
- `plan.json` — 계획 + 이슈 + 결정 스냅샷
- `agent-tracker.json` — 하위 에이전트 생성 추적 스냅샷
- `tool-log.jsonl` — 도구 호출 누적 로그

### 3-3. json vs jsonl

- **스냅샷 = `.json`** — 파일 전체가 한 시점의 완전한 상태. tasks · plan · agent-tracker · history.
- **누적(추가 전용) = `.jsonl`** — 한 줄에 1 레코드. tool-log · memory-access.

### 3-4. 멀티세션과 동시성

- 한 프로젝트에서 여러 세션 동시 활성 허용. 각 세션은 git 워크트리에서 격리.
- 세션 로컬 파일은 네임스페이스 분리로 시스템적 쓰기 충돌 0.
- 프로젝트 공유 `memory-access.jsonl`은 git union merge로 처리 (멀티세션 병렬 append 안전). `tool-log.jsonl`은 세션 격리라 충돌 가능성 없으나 워크트리 병합 시 union merge 적용 안전. `history.json`은 read-modify-write라 union merge 부적합 — 락 + atomic write로 처리.

## 4. 패키징·배포

### Build 파이프라인

- 단일 `tsconfig.build.json` 이 `src/`, `scripts/`, `assets/hooks/*/handler.ts` 를 모두 포함 (`rootDir=./`)
- 산출물 레이아웃: `dist/{src,scripts,assets/hooks,manifests}/`
- 번들러(bun build, tsup) 미사용 — 스크립트 3개 규모 대비 과잉이며, 외부화 목록 drift 리스크를 회피한다
- `bun run build` = `tsc -p tsconfig.build.json && bun run scripts/build-hooks.ts` — 후자가 `dist/manifests/opencode-manifest.json` 및 portability-report를 생성

*(결정: plan #15 이슈 #1, 2026-04-20)*

### package.json exports 원칙 (하이브리드)

- `.` = null 고수: barrel 파일이 없으며 소비자는 서브패스를 통해서만 접근 가능
- 공개 API는 명시적 서브패스(types + import 조건부): `./mcp`, `./hooks/opencode-mount`, `./hooks/runtime`
- JSON 자원은 단일 문자열 경로: `./hooks/opencode-manifest`
- 자산(수백 개)은 와일드카드 패턴: `./agents/*`, `./skills/*`, `./assets/*`, `./docs/*`
- 근거: `types.ts` 등 내부 파일 외부 공개 방지 + 자산 수백 개를 일일이 나열하는 비현실적 관리 부담 회피

*(결정: plan #15 이슈 #2, 2026-04-20)*

### dependencies 분류

- 실측 import 기반 승격만 허용: 소스 전체 grep으로 실제 사용 확인 후 dep 승격
- 미사용 발견 시 즉시 제거
- peerDependencies는 현 규모에 과잉 — version drift 발생 시 별도 안건으로 처리

*(결정: plan #15 이슈 #2, 2026-04-20)*

### OpenCode hook-manifest

- build-time: `dist/manifests/opencode-manifest.json` 에 **manifest 파일 기준 상대 경로**(`../assets/hooks/<name>/handler.js`)로 기록
- runtime: `mountHooks()` 진입부가 `new URL(rel, manifestUrl)` + `fileURLToPath` 로 절대 경로를 산출 → `spawn("node", [absolute])`
- 근거: 소비자 CWD가 아닌 패키지 내부 경로 기준으로 자기 완결. 소비자 저장소에 빌드 산출물을 커밋하는 sync-materialized 반패턴을 회피한다

*(결정: plan #15 이슈 #3, 2026-04-20)*

### CI 가드

- `publish-npm.yml`과 `validate.yml` 이 `npm pack` + fresh install smoke 테스트로 소비자 설치 시나리오를 재현
- 이슈 #25·#26 같은 경로 누락·의존성 오분류·스키마 회귀는 publish 전 차단
- build 스텝을 validate와 publish 양쪽에 포함해 `dist/` 부재 상태 테스트 실패를 사전 방지

*(결정: plan #15 이슈 #4, 2026-04-20)*

## 5. Lead agent vs Hook 책임 경계

### 5-1. 책임 경계 표

| 레이어 | 담당 | 트리거 |
|---|---|---|
| Lead `body.md` (system prompt) | 정체성·책임·HOW/DO/CHECK 라우팅·skill 참조 | 세션 시작 (정적) |
| `session-init` hook | 세션 폴더·tracker 초기화, context 주입 없음 | `SessionStart` |
| `prompt-router` hook | 태그 감지·skill 유도·plan/tasks 상태 알림·차단 | `UserPromptSubmit` |
| `agent-bootstrap` hook | subagent에 `buildCoreIndex` + rules 주입 | `SubagentStart` |
| `agent-finalize` hook | pending tasks 알림, tracker 종료 | `SubagentStop` |

`post-tool-telemetry` hook은 `PostToolUse` 이벤트에서 memory access·file-edit 작업을 추적하며, 위 orchestration 경계와는 별개로 감사·강화/망각 신호 수집을 담당한다.

### 5-2. 설계 원칙

Lead `body.md`는 정적 orchestration SSOT다. 에이전트 정체성·협업 구조·스킬 위임 방침이 여기에 집약된다. Hook은 동적 상태(tasks·plan·tracker)·태그 감지·subagent 주입을 담당한다. 두 레이어는 역할이 분리되어 중복·충돌이 없다. Lead는 `.nexus/memory/`·`.nexus/context/`를 자가 로드하지 않는다 — 사용자 `CLAUDE.md` 지침이 이 역할을 보완한다.
