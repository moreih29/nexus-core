# nexus-core Hook 시스템

> 3 harness portable hook 시스템. 5 Tier 1 hook + PreToolUse Tier 2 인프라. v0.13.0 결정.

---

## 1. 채택 Hook 카탈로그 (5 Tier 1 + PreToolUse Tier 2)

| Tier | hook | 이벤트 | 책임 |
|---|---|---|---|
| 1 | `session-init` | SessionStart | 세션 폴더 구조 보장, agent-tracker / tool-log 초기화 |
| 1 | `prompt-router` | UserPromptSubmit | 11 태그 감지, state 알림, `[d]` (plan 세션 없음) / `[rule:<name>]` (미등록 이름) 차단 |
| 1 | `post-tool-telemetry` | PostToolUse | memory-access 추적 + tool-log append |
| 1 | `agent-bootstrap` | SubagentStart | agent-tracker 등록 (adapter), buildCoreIndex + rules 주입 (fresh만) |
| 1 | `agent-finalize` | SubagentStop | agent-tracker 종료, files_touched 집계, pending tasks 알림 |
| 2 | (자산 없음) | PreToolUse | 인프라만 — 사용자 plugin 확장점 |

**자산 경로**: `assets/hooks/<name>/{handler.ts, meta.yml}` — agents/skills와 동일 패턴.

**빌드 산출물**:
- `dist/hooks/<name>.js` — shell wrapper 1종 (3 harness 동일 실행 코드)
- `dist/manifests/{claude,codex,opencode}-hooks.json` — 하네스별 매니페스트 (자동 생성)
- `dist/manifests/portability-report.json` — portability 산출 결과 (인간 가독용)

---

## 2. 3-레이어 책임 분담

입력(stdin)과 출력(stdout) 흐름 기준으로 3 레이어가 책임을 분담한다. (#1 결정)

| 레이어 | stdin | stdout |
|---|---|---|
| `handler.ts` | nexus 표준 input 받기 (환경 모름) | nexus 표준 output 반환 |
| wrapper (`dist/hooks/<name>.js`) | `NEXUS_HARNESS` env 감지 → 하네스 native stdin → nexus 표준 정규화. Bash 파싱으로 Codex tool_name 보완 | nexus output → 환경별 stdout 변환 (`decision`/`permissionDecision`, `hookSpecificOutput`, OpenCode pass-through) |
| `mountHooks` (OpenCode 전용) | OpenCode 이벤트 → nexus 표준 stdin으로 정규화 후 spawn stdin 전달 | wrapper stdout (nexus 표준) → OpenCode API (`throw` / `experimental.chat.system.transform` push / `args` mutation / `output.output` append) |

**`NEXUS_HARNESS` 환경변수**: Claude / Codex는 `hooks.json` command에 직접 주입. OpenCode는 `mountHooks`가 spawn 시 주입. wrapper가 이 값을 읽어 환경별 변환 경로를 결정한다.

**메시지 언어 정책**: hook이 LLM에 주입하는 모든 메시지(system-notice, additional_context, pending tasks 알림 등)는 **영어 단일**. 소스 코드·주석은 한국어로 작성 후 LLM 번역 → 영어 commit. (#3 결정)

---

## 3. nexus 표준 stdin / stdout 스키마

### stdin

6 이벤트별 필드는 `src/hooks/types.ts` 참조. 공통 필드:

```ts
{
  session_id: string,       // 세션 식별자 (세션 단위 폴더 키)
  hook_event_name: string,  // "SessionStart" | "UserPromptSubmit" | "PreToolUse" | "PostToolUse" | "SubagentStart" | "SubagentStop"
  cwd: string,              // 작업 디렉토리
  // 이벤트별 추가 필드 (snake_case)
  prompt?: string,          // UserPromptSubmit
  tool_name?: string,       // PreToolUse / PostToolUse
  tool_input?: unknown,     // PreToolUse / PostToolUse
  tool_response?: unknown,  // PostToolUse
}
```

### stdout

```ts
{
  decision?: "block",           // 차단 결정
  block_reason?: string,        // 차단 사유 (decision: "block" 시)
  additional_context?: string,  // LLM에 주입할 컨텍스트
  updated_input?: unknown,      // 도구 입력 변경 (PreToolUse 한정, Codex 미지원)
  continue?: false,             // 실행 중단
  system_message?: string,      // 시스템 메시지 주입
}
```

### 환경별 변환 매핑

| nexus stdout 필드 | Claude | Codex | OpenCode |
|---|---|---|---|
| `decision: "block"` | `{decision}` / `{permissionDecision}` | `{decision, reason}` | `throw` |
| `additional_context` | `additionalContext` (system-reminder) | `hookSpecificOutput.additionalContext` | `experimental.chat.system.transform` push (UserPromptSubmit · SessionStart · SubagentStart 한정) / SubagentStop은 `tool.execute.after` `output.output` append 우회 (#6 예외) |
| `updated_input` | `updatedInput` | fail-open (noop) | `output.args` mutation (tool.execute.before 한정) |
| `continue: false` | `{continue: false, stopReason}` | `{continue: false, stopReason}` | `mountHooks` throw |

---

## 4. meta.yml 9 필드

### 필수 필드

| 필드 | 설명 |
|---|---|
| `name` | hook 식별자 (자산 디렉토리명과 일치) |
| `description` | hook 목적 설명 |
| `events[]` | 처리할 이벤트 목록 (PascalCase: `SessionStart` 등) |
| `requires_capabilities[]` | 필요한 capability ID 목록 (dot-notation) |

### 선택 필드 (기본값 있음)

| 필드 | 기본값 | 설명 |
|---|---|---|
| `matcher` | `*` | 이벤트 내 세부 매칭 조건 (이벤트별 의미 상이 — §6 참조) |
| `timeout` | `30` (초) | handler 실행 제한 시간 |
| `fallback` | `warn` | 미지원 환경 처리 정책 (`warn` / `skip` / `error`) |
| `priority` | `0` | 같은 이벤트 내 실행 순서 |
| `condition.state_file_exists` | (미사용) | handler spawn 전 파일 존재 확인 (미충족 시 즉시 exit) |

**금지 필드**: `portability_tier` — zod strict reject. `requires_capabilities[]` + capability-matrix.yml 대조로 자동 산출되므로 직접 명시 불가. (#5 결정)

**폐기/미채택 필드**: `enabled` (파일 존재로 충분) · `tags` (YAGNI) · `version` (CHANGELOG로 충분) · `runtime` (shell 단일 결정) · `permissions` (portable sandbox 없음)

---

## 5. capability matrix 참조

**위치**: `assets/hooks/capability-matrix.yml` — YAML (인간 가독성, 주석 가능). nexus-core 단일 진실원. (#5 결정)

**portability_tier 4 tier 자동 산출**:

| tier | 의미 |
|---|---|
| `core` | 3 harness 모두 지원 |
| `extended` | 2 harness 이상 지원, fallback 적용 |
| `experimental` | 실험적 — 특정 환경 flag 필요 |
| `harness-specific` | 1 harness 전용 |

**fallback 정책**: `warn` (기본, 매니페스트 등록 제외 + stderr 알림 + portability-report 기록) / `skip` (등록 제외, 알림 없음, 의도적 harness-specific) / `error` (빌드 실패, 핵심 hook의 portable 깨짐 즉시 차단)

**capability ID 명명**: dot-notation `<feature>.<scope>`. 예시:

```
event.session_start
event.user_prompt_submit
event.pre_tool_use.bash
event.pre_tool_use.mcp
event.post_tool_use.read
event.post_tool_use.edit
event.post_tool_use.bash_parsed
event.subagent_start
event.subagent_stop
output.additional_context.session_start
output.additional_context.user_prompt
output.additional_context.subagent_stop
output.decision_block
output.updated_input.tool
output.continue_false
runtime.experimental_flag_required
```

**nexus 표준 도구 이름 (matcher용)**: PascalCase — `Bash`, `Edit`, `Write`, `MultiEdit`, `ApplyPatch`, `Read`, `mcp__<server>__<tool>`. wrapper / mountHooks가 환경별 alias 변환 (Claude PascalCase, OpenCode lowercase, Codex apply_patch 통합). (#5 결정)

---

## 6. 6 표준 이벤트 정밀 명세

### 6-1. SessionStart → `session-init`

**stdin 사용 필드**: `session_id`, `cwd`

**session_id sanitize**: handler는 `basename(input.session_id)`를 적용한 후, 결과가 비어 있거나 `.`으로 시작하거나 `/`를 포함하면 reject(traversal 방어). 근거: `session-init/handler.ts:9-13`.

**부수효과**:
- `.nexus/state/<sid>/` 디렉토리 생성 (mkdir)
- `agent-tracker.json` 초기화 (`[]`)
- `tool-log.jsonl` 초기화 (빈 파일)
- `.nexus/state/runtime/by-ppid/<process.ppid>.json` 작성 — `{ session_id, updated_at, cwd }`. MCP 서버가 `session_id`를 직접 수신하지 못하는 한계를 우회하는 side-channel. `getSessionId()`가 이 파일을 parent-PID 키로 읽어 session_id를 복원한다 (mtime 캐싱). 채택 이유: Claude/OpenCode/Codex 3 harness 모두 MCP에 session_id를 공식 노출하지 않으므로 hook→file→MCP 브리지가 필요. parent-PID 키잉은 같은 cwd 병렬 세션에서도 race-free.

**additional_context**: 없음 (컨텍스트 주입 안 함)

**제외 사항**: `plan.json` / `tasks.json` 미생성 (MCP 책임). `memory-access.jsonl` 미관여 (프로젝트 레벨, hook 범위 밖).

**matcher 의미**: source — `startup | resume | clear | compact`

### 6-2. UserPromptSubmit → `prompt-router`

**stdin 사용 필드**: `session_id`, `prompt`

**처리 태그 (11개)**:

| 태그 | 처리 |
|---|---|
| `[plan]` | plan 세션 시작 안내 |
| `[plan:auto]` | 자동 plan 진행 안내 |
| `[run]` | 실행 모드 진입. tasks.json 없으면 `[plan:auto]` 유도 |
| `[d]` | plan.json 없으면 `decision: block` |
| `[m]` | memory 저장 안내 |
| `[m:gc]` | memory garbage-collect 안내 |
| `[rule]` | 정의된 agent/skill 이름만 허용. `assets/agents/` · `assets/skills/` 디렉토리 readdir 검증. 잘못된 이름은 `decision: block` |
| `[rule:name]` | 유효한 `agents`/`skills` 디렉토리명만 허용. 매 호출 readdir로 검증. 무효 이름은 `decision: block` |
| `[sync]` | context 동기화 안내 |
| `[init]` | 초기화 안내 |
| `[init:reset]` | 리셋 초기화 안내 |

**태그 없음 + 활성 plan/tasks**: `plan.json`이 존재하면 pending 이슈 수와 무관하게 항상 state 알림. `tasks.json`만 있을 경우에는 pending 태스크가 1개 이상일 때만 알림. (조건 비대칭) 근거: `prompt-router/handler.ts:148-177`.

**메시지 형식 예시**:
```
<system-notice>
Active plan session detected. Use [d] to record a decision or [run] to start execution.
</system-notice>
```

**invocations SSOT 참조 (Issue #11)**: `prompt-router` handler는 태그 응답 메시지 내 `{{}}` 템플릿을 `assets/tools/tool-name-map.yml`의 `invocations` 섹션을 SSOT로 읽어 하네스 네이티브 구문으로 치환한다. `NEXUS_HARNESS` 환경변수로 대상 하네스를 결정하며, 로드 결과는 프로세스 단위로 캐싱된다. 이전에 handler에 하드코드된 호출 구문은 이 SSOT 참조로 대체됐다.

**additional_context 규칙**: UserPromptSubmit은 `additional_context` 주입 허용 (OpenCode `experimental.chat.system.transform` 지원).

**matcher 의미**: 무시 (프롬프트 전체 범위에서 태그 감지, 복수 태그 모두 처리).

### 6-3. PreToolUse (Tier 2)

**nexus-core 표준 자산**: 없음. wrapper · mountHooks · matcher 인프라만 표준화.

**사유**: 권한 gate 폐기 후 표준 use case 부재. 권한 강제는 `disallowed_tools` 기반 agent denylist 단일 메커니즘으로 충분 ([mcp-server.md](./mcp-server.md) §3 참조).

**사용자 plugin 확장점**: Tier 2 사용자 plugin이 `assets/hooks/<name>/` 자산을 추가하면 nexus-core 인프라(wrapper, mountHooks, matcher, capability matrix) 재사용 가능.

**Codex 한계**: PreToolUse는 Bash 이벤트만 emit (apply_patch / MCP 미인터셉트, #16732). capability matrix: `event.pre_tool_use.bash: {claude: true, codex: partial, opencode: true}`, `event.pre_tool_use.mcp: {claude: true, codex: false, opencode: false}`.

**matcher 의미**: 도구 이름 패턴 (정규식 단순).

**OpenCode `mountHooks` timeout 계약**: `meta.yml`의 `timeout` 값(초)을 밀리초로 변환해 `spawnHandler`에 전달. 제한 시간 초과 시 `spawnHandler`가 child 프로세스에 `kill()`을 호출한 뒤 `null`을 반환하고 다음 hook으로 진행(silent skip). 근거: `opencode-mount.ts:281-289`. 이 동작은 Tier 2 사용자 plugin을 포함한 모든 hook에 동일하게 적용된다.

### 6-4. PostToolUse → `post-tool-telemetry`

**stdin 사용 필드**: `session_id`, `tool_name`, `tool_input`, `tool_response`

**등록 harness**: Claude + OpenCode (tier=extended). Codex는 `event.post_tool_use.read`/`.edit` 미지원으로 제외 — `bash_parsed` 경유 우회는 requires_capabilities에서 제거됨.

**matcher**: `Read|Edit|Write|MultiEdit|ApplyPatch|NotebookEdit`

**부수효과 1 — memory-access 추적**:
- 대상: `.nexus/memory/` 경로 접근 시
- 파일: `.nexus/memory-access.jsonl` (프로젝트 레벨, **append-only**)
- 형식: 한 access = 1 line

```json
{"path": ".nexus/memory/foo.md", "accessed_at": "2026-04-18T00:00:00.000Z", "agent": "architect"}
```

count / last_accessed는 저장하지 않음 — 읽기 시 reduce로 계산. 멀티세션 write 안전 (OS write atomicity + git union merge).

**부수효과 2 — tool-log append**:
- 파일: `.nexus/state/<sid>/tool-log.jsonl` (세션 단위)
- 조건: `agent_id` 있을 때만 (Lead = null 제외)
- 성공 호출만 기록 (`status: "ok"` 고정 — Claude PostToolUse 성공 한정으로 portable 일관성 유지)

**NotebookEdit 분기**: `file_path ?? notebook_path`

**additional_context**: 없음 (PostToolUse 시점 컨텍스트 주입은 표준 미채택 — #6 결정).

**Bash 파싱 (Codex 보완)**: wrapper가 Bash 명령을 파싱해 nexus 표준 `tool_name`으로 정규화. **PreToolUse와 PostToolUse 양쪽**에 적용됨. 근거: `runtime.ts:206-219`의 `normalizeBashToolName`이 두 이벤트를 모두 허용. (#3, #4 결정)

| Bash 패턴 | nexus tool_name | target |
|---|---|---|
| `cat\|head\|tail\|less\|more <file>` | Read | file |
| `ls <path>` | LS | path |
| `find <path>` | Glob | path |
| `rg\|grep <pattern> <path>` | Grep | path |
| `echo <text> > <file>` | Write | file |
| `echo <text> >> <file>` | Edit | file |
| `sed -i <...> <file>` | Edit | file |
| `cat > <file> <<EOF` (heredoc) | Write | file |
| `tee <file>` | Write | file |
| `touch <file>` | Write | file |
| `cp <src> <dst>` | Write | dst |
| `mv <src> <dst>` | Edit | dst |
| `rm <file>` | (미매핑 — Bash 유지) | — |
| 복합/파이프/sudo | Bash 유지 (best-effort 실패) | — |

**race condition 대응**: `tool-log.jsonl` 세션 격리 append-only. `src/shared/json-store.ts`의 `appendJsonLine` helper 사용.

### 6-5. SubagentStart → `agent-bootstrap`

**stdin 사용 필드**: `session_id`, agent 식별 정보 (adapter가 제공)

**처리 흐름**:
1. **agent-tracker 등록** — adapter 책임 (wrapper / mountHooks). handler는 순수 컨텍스트 생성만 담당.
2. **buildCoreIndex 주입** — `resume_count === 0` (fresh만). 미등록 role silent skip. 2KB 상한 초과 시 최근 수정 N개 절단.
3. **rules 주입** — `.nexus/rules/<agent_type>.md` 자동 주입. fresh만 (조건 동일).

**agent_id 불변성**: Claude(SubagentStart), Codex(thread_spawn session_id), OpenCode(task_id = subagent session_id) 모두 불변. (#3 결정)

**OpenCode 2단 처리**:
- `tool.execute.before` — 컨텍스트 주입 (`args.prompt` prepend)
- `tool.execute.after` — tracker 등록 (agent_id 확정 후)

**extractRole**: handler가 런타임에 `assets/agents/` 디렉토리를 `readdirSync`로 스캔해 **디렉토리 이름을 role로 사용**. body.md frontmatter는 읽지 않으며 별도 `agent-roles.json` 자산도 없음.

**readdir 재스캔**: `agent-bootstrap`과 `prompt-router` 모두 agents/skills 디렉토리를 전역 캐시 없이 **매 호출 readdir**로 재스캔. 테스트 격리와 런타임 반영성을 확보하기 위한 의도적 설계. 근거: `agent-bootstrap/handler.ts:7-16`, `prompt-router/handler.ts:20-30`.

**additional_context 규칙**: SubagentStart 시점 주입 허용.

### 6-6. SubagentStop → `agent-finalize`

**stdin 사용 필드**: `session_id`, agent 식별 정보, `last_message`

**부수효과**:
1. **agent-tracker 종료 기록**: `status: completed`, `stopped_at`, `last_message` (500자 상한)
2. **files_touched 집계**: 같은 세션 `tool-log.jsonl` 스캔 → `agent_id` 매칭 파일 집합 저장 (향후 bounded resume 활용)
3. **pending tasks 알림**: `owner.role === agent_type` 매칭. 1개 이상이면 `additional_context` 주입.

**알림 메시지 예시**:
```
Subagent "engineer" finished. Tasks still pending with this role: [3, 5]. Review status and coordinate remaining subagent delegation.
```

**edge case**: entry 없을 때 silent skip.

**OpenCode 우회**: `tool.execute.after`에서 `output.output` append 우회 사용. (#6 예외 — SubagentStop만 허용)

**race condition 대응**: `agent-tracker.json` read-modify-write는 `src/shared/json-store.ts`의 `updateJsonFileLocked` 보호 (in-process queue + `O_EXCL` `.lock` 파일).

---

## 7. 빌드 검증 5단계 (`scripts/build-hooks.ts`)

| 단계 | 검증 내용 | 실패 시 |
|---|---|---|
| 1 | `meta.yml` zod 스키마 검증 (`portability_tier` 직접 명시 시 reject) | 빌드 실패 |
| 2 | `requires_capabilities[]` ID 유효성 (`capability-matrix.yml` 대조 — 없으면 실패) | 빌드 실패 |
| 3 | `events[]` ↔ `requires_capabilities[]` 정합 경고 (mismatch 시 경고) | 경고 출력 |
| 4 | harness별 portability 산출 + `fallback` 정책 적용 (매니페스트 등록/제외 결정) | fallback 정책 적용 |
| 5 | `dist/manifests/{claude,codex,opencode}-hooks.json` + `dist/manifests/portability-report.json` 생성 | — |

---

## 8. 표준 영역 밖 (사용자 plugin escape hatch)

다음 항목은 nexus-core 표준 hook 영역 밖이다. 필요 시 사용자가 직접 plugin 코드로 구현하거나, 별도 결정이 필요하다.

| 항목 | 사유 | 근거 |
|---|---|---|
| PreToolUse 권한 gate | agent denylist 단일 메커니즘으로 충분. 영구 폐기. | #3 결정, [mcp-server.md](./mcp-server.md) §3 |
| Stop pending alert | OpenCode `session.idle` throw 효과 없음 (silent). portable 깨짐. | #2 결정 |
| PreCompact / PostCompact | Codex `codex-rs/hooks/src/events/` 에 구현 없음 (소스 확정). | #2 결정 |
| PermissionRequest | OpenCode `permission.ask` #7006 미발화. 보류. | #2 결정 |
| PostToolUse 일반 컨텍스트 주입 | 3 sister project 모두 telemetry/state tracking만 사용. YAGNI. SubagentStop만 예외 허용. | #6 결정 |
| 외부 시스템 통합 | Slack / GitHub 알림 등 — nexus-core 범위 밖. | — |
| `http` · `prompt` · `agent` 핸들러 타입 | Claude 전용 — shell 단일 정책. | #1 결정 |
| apply_patch hook (Codex) | Codex #16732, PR #18391 pending merge — 외부 해결 대기. | #4 결정 |
| MCP 도구 PreToolUse 인터셉트 (Codex/OpenCode) | Codex #16732, OpenCode #2319 — Claude 전용. | #4 결정 |

---

참조:
- [philosophy.md](./philosophy.md) — 프로젝트 철학 (3 harness 공통 라이브러리 목적)
- [architecture.md](./architecture.md) — 패키지 구조, 세션 단위 폴더 (`.nexus/state/<sid>/`)
- [orchestration.md](./orchestration.md) — Lead + 9 에이전트 조율 모델
- [mcp-server.md](./mcp-server.md) — MCP 서버 14 도구, 권한 모델, 공통 인프라
- `.nexus/state/plan.json` — Hook 설계 6 이슈 결정 상세 (Issue #1~#6)
