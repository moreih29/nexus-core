# 빌드 순서 이정표

> v0.13 skeleton 재시작 시점 결정. **임시 메모** — 작업 진행 따라 삭제 예정.

## 4 공통 자산 구현 순서

**MCP server → Hook → Skill → Agent**

## 근거 요약

- 의존: MCP가 도구 카탈로그 정의 → Hook이 그 도구 인터셉트 → Skill·Agent가 그 도구 호출
- 결정론: MCP 가장 강함, Hook 가장 약함 → 약한 것 일찍 derisk
- 변환 비용: Skill 0 → Agent 낮음 → MCP 중간 → Hook 높음

## 사전 조건

MCP 작업 첫 단계 = **자매 프로젝트(claude-nexus·codex-nexus·opencode-nexus) MCP 도구 목록 조사 + 추상화** → nexus-core 도구 카탈로그 확정.

## MCP 도구 카탈로그 — 자매 프로젝트 현황

CN=claude-nexus · CX=codex-nexus · OC=opencode-nexus.

| 카테고리 | 도구 | CN | CX | OC | 결정 |
|---|---|:-:|:-:|:-:|---|
| plan | nx_plan_start | ✓ | ✓ | ✓ | **채택** (그대로, research_summary 강제 유지) |
| plan | nx_plan_status | ✓ | ✓ | ✓ | **채택** (핵심 필드만, OpenCode `opencode.*` 객체 제거) |
| plan | nx_plan_update | ✓ | ✓ | ✓ | **채택** (action enum 단일 도구, reopen 시 analysis 보존, 4 액션) |
| plan | nx_plan_decide | ✓ | ✓ | ✓ | **채택** (입력: `{issue_id, decision}`. analysis 분리. re-decide throw) |
| plan | nx_plan_resume | ✗ | ✓ | ✓ | **채택** (Claude도 통일). 입력 `{role}` (question? 제거). 데이터 plan.json만, recommendation 제거, agent_id 단일 (opaque). 출력 5필드: role · resumable · agent_id · resume_tier · issue_id |
| plan | nx_plan_followup | ✗ | ✓ | ✓ | **미채택** (resume과 거의 중복, prompt 자동 합성은 하네스 종속 위험) |
| plan | **nx_plan_analysis_add** | (신규) | (신규) | (신규) | **채택** (분석 시점 즉시 append. 입력: `{issue_id, role, agent_id?, summary}`. recorded_at은 서버 자동) |
| task | nx_task_add | ✓ | ✓ | ✓ | **채택** (owner 필수 객체화 `{role, agent_id?, resume_tier?}`. acceptance 필수. caller 검증 제거. deps 검증 throw. goal/decisions 인자 유지) |
| task | nx_task_list | ✓ | ✓ | ✓ | **채택** (입력 `include_completed?: boolean = true`. summary는 partition 4배열 (in_progress·completed·blocked·ready) + total. summary는 항상 full. goal 포함, decisions 미포함) |
| task | nx_task_update | ✓ | ✓ | ✓ | **채택** (입력 `{id, status?, owner?: {agent_id?, resume_tier?}}`. note 제거. agent_id null/"" → 삭제. role 갱신 불가. partial update) |
| task | nx_task_close | ✓ | ✓ | ✓ | **채택** (인자 없음. caller 검증 제거. 미완료 task warning. 응답 평탄 4필드: `{closed, plan_id, task_count, incomplete_count}`. memoryHint 분리) |
| task | nx_task_resume | ✗ | ✓ | ✗ | **채택** (3 하네스 통일. plan_resume과 평행. 입력 `{id}`. 출력 4필드: `task_id`·`resumable`·`agent_id`·`resume_tier`. 정책 hard 강제) |
| history | nx_history_search | ✓ | ✓ | ✓ | **채택** (입력 `{query?, last_n?: number = 10}`. 검색은 full-text `JSON.stringify(c).toLowerCase().includes(q)`. 응답 `{total, showing, cycles[]}` — cycles는 full HistoryCycle, **최신→오래 순** reverse, `memoryHint` 필드 제거) |
| context | nx_context | ✓ | ✓ | ✓ | **미채택** (자동 호출 트리거 없음. plan_status·task_list 등 개별 status 도구로 충분. opencode stats상 호출은 되나 내용 유의미성 낮음. 도구 수 절감) |
| artifact | nx_artifact_write | ✓ | ✓ | ✓ | **채택** (산출물 위치 결정론 보장. 입력 `{filename, content}`. 내부: filename sanitize (`..` `\` 차단·leading `/` 제거), `mkdir(dirname, recursive)` 자동 디렉토리 생성, 덮어쓰기. 응답 `{success, path}` — path는 PROJECT_ROOT 상대) |
| workflow | nx_init | ✗ | ✓ | ✓ | **미채택** (최초 1회 사용 후 재호출 없음. 디렉토리 생성·draft 파일 작성은 skill이 shell·Write로 처리. claude-nexus 패턴 채택) |
| workflow | nx_sync | ✗ | ✓ | ✓ | **미채택** (opencode조차 stub. 실제 sync 작업은 git diff 분석·Writer spawn 등 LLM 판단이 핵심. skill 책임) |
| lsp | nx_lsp_document_symbols | ✓ | ✗ | ✓ | **미채택** (grep으로 거의 동등 대체 가능) |
| lsp | nx_lsp_workspace_symbols | ✓ | ✗ | ✓ | **미채택** (grep으로 대체) |
| lsp | nx_lsp_goto_definition | ✓ | ✗ | ✓ | **미채택** (grep `"function X\|class X"`로 대체) |
| lsp | nx_lsp_hover | ✓ | ✗ | ✓ | **채택** (복잡한 제네릭/conditional type 즉시 해결. LLM 추론 부담 제거) |
| lsp | nx_lsp_diagnostics | ✓ | ✗ | ✓ | **채택** (단일 파일 빠른 타입체크. `bunx tsc --noEmit`보다 1초 응답) |
| lsp | nx_lsp_find_references | ✓ | ✗ | ✓ | **채택** (scope-aware cross-file 정확도. grep 대체 시 동명이인·alias 오인) |
| lsp | nx_lsp_rename | ✓ | ✗ | ✓ | **채택** (safe refactoring. edit 목록만 반환, 적용은 호출자) |
| lsp | nx_lsp_code_actions | ✓ | ✗ | ✓ | **채택** (quick fix·organize imports·extract — grep으로 절대 대체 불가) |

### LSP 도구 — 하네스별 활용 결정사항

**논점 1 — 서버 의존성/자동 실행**:
- TypeScript·Python은 `bunx` 우선 + `npx` fallback으로 자동 실행 (npm 패키지: `typescript-language-server`, `pyright`)
- Rust·Go는 PATH + common paths 검색 (`~/.cargo/bin/rust-analyzer`, `~/go/bin/gopls` 등). 자동 설치 불가
- 미발견 시 구조화 응답: `{ error, install_hint }`. 호출 자체는 막지 않음
- LSP 서버 매핑 + install hint는 **별도 데이터 파일** (`assets/lsp-servers.json` 등)에서 관리. consumer override 여지

**논점 2 — 언어 자동 감지**:
- 확장자 매핑 확장: TS/JS는 `ts/tsx/js/jsx + mjs/cjs/mts/cts` 모두 포함
- `languageId`는 LSP 표준대로 확장자별 세분화 (`tsx → typescriptreact` 등) — JSX 파서 활성화에 영향
- 미매핑 확장자 응답: `{ error: "Unsupported language: .xyz", supported: [...] }`
- 데이터 파일은 논점 1과 통합 — `languages: { typescript: { extensions: {ts: "typescript", ...}, server: {command_chain, args, search_paths?}, install_hint } }`

**논점 3 — LSP 서버 수명/캐싱**:
- spawn: lazy (첫 호출 시). 사용 안 하는 언어 비용 0
- 캐시 키: `${language}:${workspace_root}` 조합. 멀티 워크스페이스 정확
- idle timeout: **5분 미사용 시 cleanup**. 다음 호출 시 자연 재spawn
- crash 복구: 자동 재시작 안 함. 다음 호출이 자연스럽게 재spawn 유발 (`isReady()` 체크)
- failCount 정책: 같은 entry에서 **3회 연속 spawn 실패 시 `permanently_failed` 응답**. spawn 시도 안 함. idle timeout(5분)이 자연 리셋. 별도 reset 도구 없음
- 응답: `{ error: "permanently_failed", attempts: 3, last_error, install_hint }`
- 정리 hook: `process.on("SIGINT"|"SIGTERM", ...)` 핸들러로 모든 LSP 클라이언트 명시적 shutdown — 좀비 프로세스 방지

**논점 4 — 파일 캐시·외부 변경 동기화**:
- 파일 캐시 entry: `Map<uri, { mtime, version }>`
- 외부 변경 감지: 호출 시 `fs.statSync(file).mtimeMs` 비교 (cheap, < 1ms)
- 동기화 방식: **full text didChange** (전체 텍스트 재전송, version++). incremental·close/reopen 미사용
- 정책 일관성: **5 도구 모두 동일 정책** (mtime 체크 + 변경 시 didChange). claude-nexus의 도구별 차등은 폐기
- 동작: cache miss → didOpen / cache hit + mtime 동일 → 호출만 / cache hit + mtime 다름 → didChange

**논점 5 — 에이전트 권한**:
- 5 도구 모두 **read-only** (rename도 edit 목록만 반환, 적용은 호출자)
- **모든 에이전트·Lead 호출 가능** — agent denylist에 명시 안 함
- rename도 동일 (architect refactoring 분석 시 가치 있음)
- 단순화: writer/researcher 등 자연스럽게 호출 안 함 → 명시적 차단 불필요

**논점 6 — 호출 트리거**:
- **자율 호출만**. 자동 hook 미채택 — Codex가 Edit hook emit 안 함(#16732)으로 portable 불가
- 자동 hook 비용·노이즈 대비 가치 작음. LLM은 명시적 instruction 있으면 자율적으로 잘 호출
- agent definition 단계에서 활용 시점을 prompt 문구로 권장 (engineer·architect·tester 중심)
- 도구별 사용 시점 매트릭스 카탈로그는 over-engineering — 자유
| ast | nx_ast_search | ✓ | ✗ | ✓ | **미채택** (claude-nexus 42 세션 호출 0회. LLM의 ast-grep 패턴 작성 능력 부족·시나리오 드묾·grep 대체 가능. YAGNI) |
| ast | nx_ast_replace | ✓ | ✗ | ✓ | **미채택** (search와 동일 사유 + native binary 의존성 + multi-file 변경 위험) |

논의 후 결정사항은 `결정` 컬럼에 기록.

## 공통 데이터 타입 — Issue (PlanIssue)

`nx_plan_*` 도구들이 공유. plan.json `issues[]` 원소.

```ts
{
  id: number,
  title: string,
  status: "pending" | "decided",
  decision?: string,                    // status === "decided" 일 때 채워짐
  analysis?: [                          // HOW 분석 history (append-only)
    {
      role: string,                     // HOW 역할 (architect, designer, ...)
      agent_id?: string,                // 하네스 네이티브 ID (opaque, Lead 직접 분석 시 없음)
      summary: string,                  // 분석 요약
      recorded_at: string               // ISO timestamp, 정렬용
    }
  ]
}
```

**폐기 필드** (legacy read 호환만): `how_agents` · `how_summary` · `how_agent_ids` · `discussion` · `task_refs` · `summary`. 3 통합 필드 → `analysis[]` 단일.

**Resume 의미론**: `nx_plan_resume(role)` → `analysis` 중 같은 `role` 가장 최신 entry의 `agent_id`로 재개 시도. 결과는 새 entry로 append.

## 표준 메타데이터 — agent frontmatter

`assets/agents/<role>.md` frontmatter에 `resume_tier: "persistent" | "bounded" | "ephemeral"` 명시 필수. nexus-core agent 표준 metadata.

## 공통 데이터 타입 — TaskItem

`nx_task_*` 도구들이 공유. tasks.json `tasks[]` 원소.

```ts
{
  id: number,
  title: string,
  status: "pending" | "in_progress" | "completed",
  context: string,                                              // 필수
  acceptance: string,                                           // 필수 (DoD 강제)
  approach?: string,
  risk?: string,
  plan_issue?: number,
  deps?: number[],
  owner: {                                                      // 필수
    role: string,                                               // 에이전트 역할
    agent_id?: string,                                          // 하네스 native (opaque), spawn 후 update로 채움
    resume_tier?: "persistent" | "bounded" | "ephemeral"        // agent frontmatter override
  },
  created_at: string
}
```

**vocabulary 통일**: agent frontmatter `resume_tier`와 task `owner.resume_tier` 동일 명명. 의미: task에서 agent 기본 정책 override.

**caller 검증 제거**: MCP 도구 핸들러에서 caller agent gating 코드 제거. 권한 강제는 **agent definition denylist (`disallowed_tools`)** 단일 메커니즘. 3 하네스 모두 런타임 강제 가능 (Claude `disallowedTools`, OpenCode `permission`, Codex `disabled_tools` TOML).

## 구현 공통화 — 검토 항목

**파일 락 (json + jsonl)**:
- `plan.json` · `tasks.json` · `agent-tracker.json` 등 read-modify-write 도구가 다수
- 멀티세션·병렬 도구 호출에 강건하려면 락 필수
- opencode-nexus의 `updateJsonFileLocked`가 참고 패턴
- nexus-core build-utils 또는 공통 SDK로 추출 검토 — 도구 구현 시점에 다시 살펴봄

**MCP 서버 도구 호출 로그**:
- nexus-core MCP 서버가 자기에게 들어온 도구 호출을 모두 기록 (timestamp · tool_name · args · response · caller 추정 정보)
- 위치 후보: `.nexus/state/sessions/<session_id>/mcp-call.jsonl` 또는 프로젝트 공유 `.nexus/mcp-call.jsonl`
- 목적: 도구 채택·갱신 시점에 **실제 사용 패턴 기반 검증** (어떤 도구가 자주 쓰이는지, 어떤 인자가 실제 들어오는지, 응답이 어떻게 활용되는지)
- 로드맵 후속 작업 — 도구 카탈로그 1차 확정 후 도입

---

## 카탈로그 확정 요약 (총 26 도구 검토 → 14 채택 / 12 미채택)

### 채택 도구 (14)

| 카테고리 | 채택 도구 |
|---|---|
| **plan** (5) | `nx_plan_start`, `nx_plan_status`, `nx_plan_update`, `nx_plan_decide`, `nx_plan_resume`, `nx_plan_analysis_add` (신규) |
| **task** (5) | `nx_task_add`, `nx_task_list`, `nx_task_update`, `nx_task_close`, `nx_task_resume` |
| **history** (1) | `nx_history_search` |
| **artifact** (1) | `nx_artifact_write` |
| **lsp** (5) | `nx_lsp_hover`, `nx_lsp_diagnostics`, `nx_lsp_find_references`, `nx_lsp_rename`, `nx_lsp_code_actions` |

(plan은 6개로 카운트하면 총 15. 위 표는 "구현 단위" 기준 — `nx_plan_resume` + `nx_plan_analysis_add`는 신규 분리)

### 미채택 도구 (11)

| 카테고리 | 미채택 도구 | 사유 요약 |
|---|---|---|
| **plan** | `nx_plan_followup` | resume과 중복, 자동 prompt 합성 위험 |
| **context** | `nx_context` | 자동 호출 트리거 없음, plan_status·task_list로 충분 |
| **workflow** | `nx_init`, `nx_sync` | 1회성 사용 / skill 책임 영역 |
| **lsp** | `nx_lsp_document_symbols`, `nx_lsp_workspace_symbols`, `nx_lsp_goto_definition` | grep 대체 가능 |
| **ast** | `nx_ast_search`, `nx_ast_replace` | 호출 0회, LLM 패턴 작성 부담, YAGNI |

### 핵심 데이터 타입

| 타입 | 위치 | 핵심 필드 |
|---|---|---|
| **PlanIssue** | plan.json `issues[]` | `id`, `title`, `status`, `decision?`, `analysis[]` |
| **TaskItem** | tasks.json `tasks[]` | `id`, `title`, `status`, `context`, `acceptance`, `owner: {role, agent_id?, resume_tier?}` |
| **HistoryCycle** | history.json `cycles[]` | `completed_at`, `branch`, `plan?`, `tasks?` (memoryHint 제거) |

### 권한·결정론 모델

- **caller 검증**: MCP 핸들러에서 제거. **agent denylist (`disallowed_tools`) 단일 메커니즘**으로 통일
- **resume_tier**: `persistent` / `bounded` / `ephemeral`. agent frontmatter + task `owner.resume_tier` 동일 명명
- **agent_id**: opaque string. 하네스 adapter 책임. MCP는 의미 부여 안 함

### LSP 통합 결정 (요약)

- 자동 실행: `bunx → npx fallback` (TS·Python). Rust/Go는 PATH·common paths 검색
- 미발견 응답: `{ error, install_hint }` 구조화
- 데이터 파일: `assets/lsp-servers.json` — 확장자 매핑 + 서버 명령 + install hint 통합
- 캐시: `${language}:${workspace_root}` 키, lazy spawn, 5분 idle timeout
- crash: 자연 재시도 + 3회 실패 시 `permanently_failed`
- 파일 sync: mtime 캐시 + 변경 시 full text didChange
- 권한: 5 도구 모두 read-only, **모든 에이전트 허용**
- 호출 트리거: **자율 호출만**, 자동 hook 미채택 (Codex portability)

---

## 다음 단계 (빌드 순서 진행)

1. ✅ **MCP 도구 카탈로그 확정** (현재 완료 시점)
2. ⏭ **MCP 서버 구현 시작**:
   - 공통 인프라 (paths·json-store with 락·textResult·MCP 호출 로그)
   - plan/task 도구 (가장 핵심) → history → artifact → lsp 순
3. ⏸ Hook (MCP 안정 후)
4. ⏸ Skill (Hook 후)
5. ⏸ Agent (Skill 후)

**즉시 착수 가능 항목**:
- nexus-core MCP 서버 골조 + 공통 paths/json-store/textResult 모듈
- `assets/lsp-servers.json` 데이터 파일 작성
- PlanIssue·TaskItem·HistoryCycle 타입 정의 (`src/types/state.ts` 등)
