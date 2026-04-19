# nexus-core MCP 서버

> 3 하네스 공통 MCP 서버. 14 도구 + 공통 인프라 + LSP 통합. v0.13.0 채택 결정.

---

## 1. 채택 도구 카탈로그 (14개)

| 카테고리 | 도구 | 핵심 동작 |
|---|---|---|
| plan | `nx_plan_start` | 새 plan 세션 시작. `research_summary` 강제 포함. 응답 `{created, plan_id, topic, issueCount, previousArchived}` — 기존 plan 자동 archive 시 `previousArchived: true` |
| plan | `nx_plan_status` | 현재 plan 상태 조회. 핵심 필드만 반환 |
| plan | `nx_plan_update` | plan 이슈 관리. `add` · `remove` · `modify` · `reopen` 4 액션 단일 도구 |
| plan | `nx_plan_decide` | 이슈 결정 기록. 입력 `{issue_id, decision, how_agents?, how_summary?, how_agent_ids?}` — legacy compat: how_* 파라미터는 analysis 배열로 변환됨. re-decide는 throw |
| plan | `nx_plan_resume` | 중단된 HOW 에이전트 재개. 입력 `{role}`. 출력 `role · resumable · agent_id · resume_tier · issue_id` |
| plan | `nx_plan_analysis_add` | HOW 분석 즉시 append. 입력 `{issue_id, role, agent_id?, summary}`. `recorded_at` 서버 자동 부여 |
| task | `nx_task_add` | 태스크 추가. `owner` 필수 객체, `acceptance` 필수. deps 검증 throw. `goal?: string`으로 tasks.json top-level `goal` 갱신, `decisions?: string[]`으로 top-level `decisions` append 가능 |
| task | `nx_task_list` | 태스크 목록 조회. 입력 `{include_completed?: boolean}`. summary는 4분류(in_progress · completed · blocked · ready) + total. `goal` 설정 시 응답에 포함 |
| task | `nx_task_update` | 태스크 부분 갱신. 입력 `{id, status?, owner?: {agent_id?, resume_tier?}}`. role 갱신 불가. `owner.agent_id`가 `null` 또는 `""` 이면 해당 필드 삭제. `owner.resume_tier`가 `null` 이면 삭제 |
| task | `nx_task_close` | 세션 종료. 인자 없음. 응답 `{closed, plan_id, task_count, incomplete_count}` |
| task | `nx_task_resume` | 중단된 태스크 재개. 입력 `{id}`. 출력 `task_id · resumable · agent_id · resume_tier` |
| history | `nx_history_search` | 과거 사이클 전문 검색. 입력 `{query?, last_n?: number = 10}`. 응답 `{total, showing, cycles[]}`. 최신→오래 순 |
| artifact | `nx_artifact_write` | 산출물 저장. 입력 `{filename, content}`. 경로 sanitize(`..` · `\` 차단) + realpath 기반 symlink escape 차단. 응답 `{success, path}` |
| lsp | `nx_lsp_hover` · `nx_lsp_diagnostics` · `nx_lsp_find_references` · `nx_lsp_rename` · `nx_lsp_code_actions` | LSP 5개 도구 — §5 참조 |

### 미채택 도구 (11개)

| 카테고리 | 도구 | 미채택 사유 |
|---|---|---|
| plan | `nx_plan_followup` | `nx_plan_resume`과 중복, 자동 prompt 합성이 하네스 종속 위험 |
| context | `nx_context` | 자동 호출 트리거 없음, 개별 status 도구로 충분, 호출 대비 유의미성 낮음 |
| workflow | `nx_init` | 최초 1회성 — 디렉토리 생성·draft 작성은 skill이 shell/Write로 처리 |
| workflow | `nx_sync` | 실제 sync는 LLM 판단 필요 — skill 책임 영역 |
| lsp | `nx_lsp_document_symbols` | grep으로 동등 대체 가능 |
| lsp | `nx_lsp_workspace_symbols` | grep으로 대체 가능 |
| lsp | `nx_lsp_goto_definition` | grep `"function X\|class X"` 패턴으로 대체 가능 |
| ast | `nx_ast_search` | 실제 호출 0회, LLM 패턴 작성 부담, grep 대체 가능 (YAGNI) |
| ast | `nx_ast_replace` | nx_ast_search 동일 사유 + native binary 의존 + multi-file 변경 위험 |

---

## 2. 공통 데이터 타입

### PlanIssue

`plan.json`의 `issues[]` 원소. `nx_plan_*` 도구가 공유.

```ts
{
  id: number,
  title: string,
  status: "pending" | "decided",
  decision?: string,           // status === "decided" 일 때 채워짐
  analysis?: Array<{
    role: string,              // HOW 역할 (architect, designer, ...)
    agent_id?: string,         // 하네스 네이티브 ID (opaque). Lead 직접 분석 시 없음
    summary: string,           // 분석 요약
    recorded_at: string        // ISO timestamp, 정렬용
  }>
}
```

`analysis[]`는 append-only. `nx_plan_resume(role)` 재개 시 같은 `role`의 가장 최신 `agent_id`를 조회하고 결과는 새 entry로 append.

폐기 필드 (legacy read 호환만): `how_agents` · `how_summary` · `how_agent_ids` · `discussion` · `task_refs` · `summary`.

### TaskItem

`tasks.json`의 `tasks[]` 원소. `nx_task_*` 도구가 공유.

```ts
{
  id: number,
  title: string,
  status: "pending" | "in_progress" | "completed",
  context: string,             // 필수
  acceptance: string,          // 필수 (Definition of Done 강제)
  approach?: string,
  risk?: string,
  plan_issue?: number,
  deps?: number[],
  owner: {                     // 필수
    role: string,              // 에이전트 역할
    agent_id?: string,         // 하네스 native (opaque). spawn 후 update로 채움
    resume_tier?: "persistent" | "bounded" | "ephemeral"  // agent frontmatter 기본값 override
  },
  created_at: string
}
```

### HistoryCycle

`.nexus/history.json`의 `cycles[]` 원소. **형식: JSON 배열 (`cycles` 키) — jsonl 아님.**

```ts
{
  schema_version?: string,
  completed_at: string,        // ISO timestamp
  branch: string,
  plan?: PlanFile,             // 세션 종료 시점 plan.json 스냅샷
  tasks?: TaskItem[]           // 세션 종료 시점 tasks.json 스냅샷
}
```

`memoryHint` 필드는 폐기. `nx_history_search` 응답에도 포함 안 함.

---

## 3. 권한 모델

- **caller 검증 제거**: MCP 핸들러에서 caller agent gating 코드 없음. 도구 자체는 호출자를 검증하지 않는다.
- **단일 메커니즘**: 권한 강제는 `disallowed_tools` 기반 agent denylist만 사용.
- **하네스별 매핑**:

| 하네스 | 도구 제한 필드 |
|---|---|
| Claude (claude-nexus) | `disallowedTools` |
| OpenCode (opencode-nexus) | `permission` |
| Codex (codex-nexus) | `disabled_tools` (TOML) |

---

## 4. 재개 모델

- **resume_tier 명명**: `persistent` / `bounded` / `ephemeral`. agent frontmatter와 `task.owner.resume_tier` 동일 명명.
- **agent frontmatter**: `assets/agents/<role>.md`의 frontmatter에 `resume_tier` 필수 명시. nexus-core agent 표준 메타데이터.
- **task override**: `task.owner.resume_tier`는 agent frontmatter 기본값을 task 단위로 override.
- **agent_id**: opaque string. 하네스 adapter가 부여. MCP 서버는 의미 부여 안 함.

| resume_tier | 재개 정책 |
|---|---|
| `persistent` | 같은 이슈 내 기본 재개. 이슈 간 재개는 Lead 명시 동의 시 |
| `bounded` | 같은 산출물만 재개. 재개 사이 타 에이전트 개입 시 재읽기 의무 |
| `ephemeral` | 항상 새로 생성 |

---

## 5. LSP 통합

### 5-1. 채택 도구 (5개)

| 도구 | 역할 |
|---|---|
| `nx_lsp_hover` | 복잡한 제네릭·conditional type 즉시 해결 |
| `nx_lsp_diagnostics` | 단일 파일 빠른 타입 체크 (`bunx tsc --noEmit`보다 빠름) |
| `nx_lsp_find_references` | scope-aware cross-file 참조 검색 (동명이인·alias 오인 방지) |
| `nx_lsp_rename` | safe refactoring — edit 목록만 반환, 적용은 호출자 책임 |
| `nx_lsp_code_actions` | quick fix · organize imports · extract — grep으로 대체 불가 |

5개 모두 read-only.

### 5-2. 운영 결정 (6개)

**서버 의존성 및 자동 실행**
- TypeScript · Python: `bunx` 우선, `npx` fallback (npm 패키지: `typescript-language-server`, `pyright`)
- Rust · Go: PATH + common paths 검색 (`~/.cargo/bin/rust-analyzer`, `~/go/bin/gopls` 등). 자동 설치 불가.
- 미발견 시 구조화 응답: `{ error, install_hint }`. 호출 자체는 차단 안 함.

**언어 감지**
- 확장자 기반. TS/JS는 `ts/tsx/js/jsx/mjs/cjs/mts/cts` 포함.
- `languageId`는 LSP 표준 세분화 (`tsx → typescriptreact` 등).
- 데이터 파일: `assets/lsp-servers.json` — 확장자 매핑 · 서버 명령 · install hint 통합 관리.

**서버 수명**
- lazy spawn: 첫 호출 시 기동. 미사용 언어 비용 0.
- 캐시 키: `${language}:${workspace_root}`.
- idle timeout: 5분 미사용 시 cleanup. 다음 호출이 자연 재spawn.
- failCount: 3회 연속 spawn 실패 시 `permanently_failed` 응답. idle timeout(5분)이 자연 리셋.

**파일 동기화**
- 캐시 entry: `Map<uri, { mtime, version }>`.
- 외부 변경 감지: 호출 시 `fs.statSync(file).mtimeMs` 비교.
- 동기화 방식: full text didChange (전체 텍스트 재전송, version++). incremental 미사용.
- 5 도구 모두 동일 정책: cache miss → `didOpen` / mtime 동일 → 호출만 / mtime 변경 → `didChange`.

**권한**
- 5 도구 모두 모든 에이전트·Lead 허용. agent denylist에 명시 안 함.

**호출 트리거**
- 자율 호출만. 자동 hook 미채택 — Codex가 Edit hook을 emit하지 않아 portable 불가.
- 활용 시점은 agent definition(engineer · architect · tester)의 prompt 문구로 권장.

---

## 6. 공통 인프라

| 모듈 | 역할 |
|---|---|
| `src/shared/paths.ts` | `findProjectRoot` · `NEXUS_ROOT` · `STATE_ROOT` · `getCurrentBranch` · `ensureDir` · `getSessionId` · `getSessionRoot` |
| `src/shared/json-store.ts` | atomic write + file lock (in-process queue + `O_EXCL` `.lock` 파일) + `appendJsonLine` helper |
| `src/shared/mcp-utils.ts` | `textResult` — MCP 텍스트 응답 래퍼 |
| `src/shared/tool-log.ts` | 세션별 `.nexus/state/<sid>/tool-log.jsonl` best-effort 기록 |
| `src/types/state.ts` | zod schema + TS 타입 (`PlanIssue` · `TaskItem` · `HistoryCycle` 등) |
| `src/hooks/types.ts` | Hook 공통 타입 (`HookEvent` · `HookResult` · capability 인터페이스) |
| `src/hooks/runtime.ts` | Hook 실행 엔진 — capability-matrix.yml 로드 · hook 디스패치 · harness 분기 |
| `src/hooks/opencode-mount.ts` | OpenCode 하네스용 hook mount 어댑터 |

`paths.ts` 주요 함수:

| 함수 | 동작 | 소스 |
|---|---|---|
| `getSessionId(cwd?)` | NEXUS_SESSION_ID env 우선, 없으면 `<branch>-<pid>` | paths.ts |
| `getSessionRoot(cwd?)` | `.nexus/state/<session_id>/` 경로 반환 | paths.ts |

### 상태 파일 배치

| 파일 | 위치 | 형식 |
|---|---|---|
| `tasks.json` · `plan.json` · `agent-tracker.json` · `tool-log.jsonl` | `.nexus/state/<session_id>/` | 세션 격리 |
| `artifacts/` | `.nexus/state/<session_id>/artifacts/` | 세션 스코프 산출물 (최근 리팩터로 세션 스코프화됨) |
| `memory-access.jsonl` | `.nexus/memory-access.jsonl` | **프로젝트 레벨, append-only** |
| `history.json` | `.nexus/history.json` | 프로젝트 레벨, cycles 배열 read-modify-write |

### memory-access.jsonl 형식 (append-only 재설계)

한 access 이벤트 = 1 line:

```json
{"path": ".nexus/memory/foo.md", "accessed_at": "2026-04-19T00:00:00.000Z", "agent": "architect"}
```

- count · last_accessed는 읽기 시 reduce로 계산 (저장 단계 read-modify-write 제거)
- 멀티세션 write 안전 — OS write atomicity (line < 4KB) + git union merge

---

## 7. CLI 서브커맨드 (`nexus-core`)

v0.13.0부터 `nexus-core` bin이 추가됐다 (`scripts/cli.ts` → `./scripts/cli.ts`). 에이전트·스킬 빌드 파이프라인과 MCP 서버 기동을 단일 진입점으로 오케스트레이션한다.

```
nexus-core <command> [flags]
```

| 서브커맨드 | 역할 | 주요 플래그 |
|---|---|---|
| `sync` | 에이전트·스킬 빌드(`build-agents`) + 훅 빌드(`build-hooks`) 순서대로 실행. | `--harness=<claude\|opencode\|codex>` · `--target=<dir>` · `--dry-run` · `--force` · `--strict` · `--only=<name>` |
| `init` | 하네스 플러그인 템플릿을 지정 디렉토리로 복사 (플러그인 레포 신규 생성용). | `--harness=<harness>` · `--target=<dir>` (필수) |
| `list` | `assets/` 아래 에이전트·스킬·훅을 이름+설명 목록으로 출력. | — |
| `validate` | 에이전트·스킬 `body.md` frontmatter 필수 필드 검증 + `capability-matrix.yml` · `tool-name-map.yml` YAML 파싱 검증. | — |
| `mcp` | MCP stdio 서버 기동 (`nexus-mcp`와 동일). | — |

모든 서브커맨드는 `--help` / `-h` 플래그를 지원한다.

## 8. 빌드 및 실행

- **bin `nexus-mcp`**: `./dist/mcp/server.js` — MCP 서버 단독 실행 (기존 호환 유지)
- **bin `nexus-core`**: `./scripts/cli.ts` — 에이전트·훅 빌드 + MCP 기동 통합 CLI (v0.13.0 신규)
- **exports `./mcp`**: `./dist/mcp/server.js`
- **컴파일**: `tsc` emit (`esbuild` 미채택)
- **모듈 시스템**: ESM (`"type": "module"`)
- **런타임**: Node.js >= 20

---

## 9. 빌드 순서

| 단계 | 공통 자산 | 상태 |
|---|---|---|
| 1 | **MCP 서버** — 14 도구 + 공통 인프라 + LSP 통합 | v0.13.0 완료 |
| 2 | **Hook** — 5 Tier 1 hook + capability-matrix + build-hooks | v0.13.0 완료 |
| 3 | Skill — Hook 위에서 동작 | 예정 |
| 4 | Agent | 예정 |

순서 근거: MCP는 도구 카탈로그를 정의하므로 인터페이스가 가장 명확. Hook은 MCP 도구를 인터셉트. Skill · Agent는 Hook 위에서 동작.
