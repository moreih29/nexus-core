# Codex CLI 훅·네이티브 툴

> openai/codex 공식 — Codex CLI 훅 시스템(Experimental)과 빌트인 툴 카탈로그. 출처: [Hooks](https://developers.openai.com/codex/hooks) · [CLI Features](https://developers.openai.com/codex/cli/features) · [apply_patch instructions](https://github.com/openai/codex/blob/main/codex-rs/apply-patch/apply_patch_tool_instructions.md). 플러그인 구조는 [`external-codex-plugin.md`](./external-codex-plugin.md) 참조.

## 1. 활성화 (Experimental)

`~/.codex/config.toml` 피처 플래그 필수. Windows 일시 비활성화.

```toml
[features]
codex_hooks = true
```

## 2. 이벤트 (5종)

| 이벤트 | 발화 | Matcher |
|---|---|---|
| `SessionStart` | 세션 최초 시작 또는 재개 | `startup` · `resume` |
| `UserPromptSubmit` | 프롬프트 실행 직전 | 무시 |
| `PreToolUse` | 툴 호출 직전 | 도구 이름 (**현재 `Bash`만**) |
| `PostToolUse` | 툴 호출 완료 직후 | 도구 이름 (**현재 `Bash`만**) |
| `Stop` | 에이전트 턴 종료 | 무시 |

**중요 제약**: PreToolUse·PostToolUse가 **현재 `Bash`만 emit**. `apply_patch` · `web_search` · MCP 툴은 인터셉트 안 됨. [openai/codex#16732](https://github.com/openai/codex/issues/16732) 진행 중.

## 3. 훅 등록

`hooks.json` 파일. 두 표준 경로:

- `~/.codex/hooks.json` — 전역
- `<repo>/.codex/hooks.json` — 레포 로컬

여러 파일 동시 존재 시 모두 로드·병합. 상위 레이어가 하위 훅 대체 안 함.

```json
{
  "hooks": {
    "SessionStart": [
      {
        "matcher": "startup|resume",
        "hooks": [
          {
            "type": "command",
            "command": "python3 ~/.codex/hooks/x.py",
            "statusMessage": "Loading session notes",
            "timeout": 600
          }
        ]
      }
    ],
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [{ "type": "command", "command": "..." }]
      }
    ]
  }
}
```

`timeout` 기본 600초.

## 4. 핸들러 인터페이스

**Shell command + stdin/stdout JSON**. JSON-RPC·MCP 메시지 아님.

| 응답 | 동작 |
|---|---|
| exit 0, 출력 없음 | 성공, 계속 진행 |
| exit 2, stderr | 차단·거부 사유 |
| stdout `{"decision":"block","reason":"..."}` | 명시적 거부 |
| stdout `{"continue": false}` | 세션·턴 중단 |

## 5. 주입 컨텍스트

**공통 필드 (모든 이벤트)**:

| 필드 | 타입 | 설명 |
|---|---|---|
| `session_id` | string | 세션 ID |
| `transcript_path` | string \| null | transcript 파일 경로 |
| `cwd` | string | 세션 작업 디렉토리 |
| `hook_event_name` | string | 이벤트 이름 |
| `model` | string | 활성 모델 slug |

**이벤트별 추가**:

| 이벤트 | 추가 필드 |
|---|---|
| `SessionStart` | `source` (`startup`·`resume`) |
| `UserPromptSubmit` | `turn_id` · `prompt` |
| `PreToolUse` | `turn_id` · `tool_name` · `tool_use_id` · `tool_input.command` |
| `PostToolUse` | `turn_id` · `tool_name` · `tool_use_id` · `tool_input.command` · `tool_response` |
| `Stop` | `turn_id` · `stop_hook_active` · `last_assistant_message` |

## 6. 대체 메커니즘 (훅 한계 보완)

- **AGENTS.md** — 프롬프트 레벨 지침 주입. 결정론적이지 않으나 툴 제약 없음
- **MCP 서버** — side-channel 처리는 어렵지만 별도 툴 노출 가능
- **`unified_exec` 피처 플래그** — 신규 streaming shell 실행. PreToolUse·PostToolUse 인터셉션 부분 개선 가능 (추론)

## 7. 네이티브 빌트인 툴 (소스 직접 추출 — `codex-rs/tools/src/`)

총 30+종. 카테고리별:

### 7-1. 셸·실행 (7)

| 툴 | 출처 | 설명 |
|---|---|---|
| `shell` | local_tool.rs:186 | 표준 셸 실행 |
| `shell_command` | local_tool.rs:256 | shell variant |
| `exec_command` | local_tool.rs:71 | unified_exec 셸 (streaming) |
| `write_stdin` | local_tool.rs:121 | 실행 중인 프로세스에 stdin 쓰기 |
| `request_permissions` | local_tool.rs:281 | 권한 요청 |
| `exec` | code-mode/lib.rs:30 | code_mode 셸 실행 |
| `wait` | code-mode/lib.rs:31 | code_mode 대기 |

### 7-2. 파일·디렉토리 (3)

| 툴 | 출처 | 설명 |
|---|---|---|
| `apply_patch` | apply_patch_tool.rs:91 | 구조적 diff (생성·수정·삭제·이동, 다중 파일) |
| `list_dir` | utility_tool.rs:31 | 디렉토리 목록 |
| `view_image` | protocol/models.rs:857 | 이미지 보기 |

**중요**: `Read` · `Edit` 독립 툴 없음. 파일 읽기는 셸(`cat`/`rg`) 우회 필요.

### 7-3. 웹·발견 (3)

| 툴 | 설명 |
|---|---|
| `web_search` | 캐시 또는 라이브 웹 검색 |
| `tool_search` | 도구 검색 (deferred 도구 schema 로드) |
| `tool_suggest` | 도구 제안 |

### 7-4. 플랜·사용자 (2)

| 툴 | 설명 |
|---|---|
| `update_plan` | 에이전트 플랜 스텝 (TUI 렌더) — todo 역할 흡수. `plan` · `step` · `status` |
| `request_user_input` | 사용자 질문 |

### 7-5. 에이전트 라이프사이클 (10 — Codex의 강점)

| 툴 | 설명 |
|---|---|
| `spawn_agent` | 새 서브에이전트 생성 (v1·v2 양립) |
| `send_input` | 재개된 에이전트에 메시지 전달 |
| `send_message` | 에이전트 간 메시지 |
| `followup_task` | 후속 작업 추가 |
| `resume_agent` | 완료된 에이전트 재개 (id 기준) |
| `wait_agent` | 에이전트 완료 대기 (v1·v2) |
| `list_agents` | 활성 에이전트 목록 |
| `close_agent` | 에이전트 종료 (v1·v2) |
| `spawn_agents_on_csv` | CSV 기반 배치 spawn |
| `report_agent_job_result` | 작업 결과 보고 |

**Subagent thread_spawn 이벤트**: `spawn_agent` 호출 시 transcript에 `subagent.thread_spawn` payload가 흐름. codex-nexus(`src/shared/codex-session.ts`)가 파싱.

### 7-6. JS·MCP·이미지 생성 (6)

| 툴 | 설명 |
|---|---|
| `js_repl` | JS 실행 환경 |
| `js_repl_reset` | REPL 리셋 |
| `list_mcp_resources` | MCP 리소스 목록 |
| `list_mcp_resource_templates` | MCP 리소스 템플릿 목록 |
| `read_mcp_resource` | MCP 리소스 읽기 |
| `image_generation` | 이미지 생성 (Responses API) |

MCP 서버 설정 시 그 서버 도구들이 빌트인 옆에 추가 노출.

### apply_patch 특징

- **한 호출로 다중 파일** 생성·수정·삭제 (Claude Code Edit는 파일 단위)
- 파일 이동 (`*** Move to:`) patch 내부 처리
- `@@` hunk 헤더로 컨텍스트 라인 위치 지정 (unified diff 유사)
- 절대 경로 금지, 상대 경로만

## 8. 3 하네스 툴 매핑

| 의미 | Claude Code | OpenCode | Codex |
|---|---|---|---|
| 파일 읽기 | `Read` | `read` | (셸 cat 우회) |
| 파일 쓰기·편집 | `Write` · `Edit` · `MultiEdit` | `write` · `edit` · `apply_patch` | `apply_patch` |
| 셸 | `Bash` | `bash` | `shell` · `shell_command` · `exec_command` · `exec` |
| stdin 주입 | (Bash 처리) | (bash 처리) | `write_stdin` |
| 디렉토리 목록 | `LS` · `Glob` | `list` · `glob` | `list_dir` |
| 검색 | `Grep` · `Glob` | `grep` · `glob` | (셸 + rg) |
| 웹 가져오기 | `WebFetch` | `webfetch` | (없음) |
| 웹 검색 | `WebSearch` | `websearch` | `web_search` |
| 이미지 보기 | (Read 분기) | (read 분기) | `view_image` |
| 서브에이전트 spawn | `Agent` (Task) | `task` | `spawn_agent` |
| 에이전트 재개 | (동일 Agent 재호출) | `task({resume_task_id, ...})` | `resume_agent` |
| 에이전트 통신 | (없음) | (확인 불가) | `send_input` · `send_message` · `followup_task` |
| 에이전트 대기·종료 | (없음) | (확인 불가) | `wait_agent` · `close_agent` |
| 에이전트 목록 | (없음) | (확인 불가) | `list_agents` |
| 배치 spawn | (반복 호출) | (확인 불가) | `spawn_agents_on_csv` |
| 투두·플랜 | `TodoWrite` · `TodoRead` | `todowrite` · `todoread` | `update_plan` |
| 사용자 질문 | `AskUserQuestion` | `question` | `request_user_input` |
| 권한 요청 | (PermissionRequest 훅) | `permission.ask` | `request_permissions` |
| JS 실행 | `REPL` | (확인 불가) | `js_repl` · `js_repl_reset` |
| 도구 발견 | `ToolSearch` | (확인 불가) | `tool_search` · `tool_suggest` |
| MCP 리소스 | (확인 불가) | (확인 불가) | `list_mcp_resources` · `read_mcp_resource` |
| 이미지 생성 | (확인 불가) | (확인 불가) | `image_generation` |
| Skill 호출 | `Skill` | `skill` | `$skill-name` (직접) |

## 9. 영역별 풍부도

| 영역 | Codex 평가 |
|---|---|
| 파일 inspection (read·search·glob) | **부족 — 셸 우회 필요** |
| 파일 쓰기 | 단일이지만 강력 (apply_patch는 다중 파일·이동·삭제 모두 지원) |
| 웹 가져오기 | **없음** (web_search만) |
| **에이전트 lifecycle** | **가장 풍부 — 10종** (spawn·resume·send·wait·list·close + 배치) |
| 플랜·todo | 동등 (update_plan) |
| MCP 리소스 | 풍부 (3종) |
| JS·이미지 | 보유 |

**Codex는 빈약한 하네스가 아님** — 파일 inspection 약함, 에이전트 오케스트레이션 강함. nexus-core 멀티에이전트 철학과 오히려 잘 맞음.

## 확인 불가

- `Read` · `Write` · `Edit` 독립 툴 — 공식 문서에 없음. apply_patch 단일 채널 확인됨
- PreToolUse·PostToolUse가 apply_patch emit하는지 — **현재 미지원** (#16732 명시)
- codex-nexus의 `hooks.json`이 CLI 설치 시 자동으로 `.codex/hooks.json`으로 복사되는지 — `src/cli/install.ts` 내용 미확인

---

## 10. stdout 응답 필드 상세 카탈로그 (2026-04-18 추가 조사)

> 출처: [공식 Hooks 문서](https://developers.openai.com/codex/hooks) · [issue #16732](https://github.com/openai/codex/issues/16732) · [PR #18391](https://github.com/openai/codex/pull/18391)

### 10-1. 전 이벤트 공통 응답 필드

| 필드 | 타입 | 지원 이벤트 | 설명 |
|---|---|---|---|
| `continue` | bool | SessionStart · UserPromptSubmit · PostToolUse · Stop | `false` 시 정상 처리 중단. **continue:false가 최우선** — decision:block이나 exit 2보다 우선 |
| `stopReason` | string | SessionStart · UserPromptSubmit · PostToolUse · Stop | 중단 이유 기록 |
| `systemMessage` | string | 전 이벤트 | UI/이벤트 스트림에 경고로 표시. PreToolUse는 systemMessage만 지원 |
| `suppressOutput` | bool | 전 이벤트 | 파싱되지만 **아직 미구현** (fail-open) |

### 10-2. 이벤트별 전용 응답 필드

**UserPromptSubmit**
- `decision: "block"` + `reason` — 프롬프트 제출 차단. exit 2 + stderr와 동등
- `additionalContext` (hookSpecificOutput 내부) — LLM에 추가 컨텍스트 주입
- `updatedInput` — **파싱되나 현재 미지원** (fail-open). 프롬프트 텍스트 수정 불가

**PreToolUse** (현재 Bash·apply_patch만, 아래 §10-4 참조)
- `permissionDecision: "deny"` — 툴 실행 차단 (신규 방식)
- `permissionDecisionReason` — 거부 이유
- `decision: "block"` + `reason` — 구 방식, 여전히 지원
- `updatedInput` — **파싱되나 현재 미지원** (fail-open). tool args 수정 불가
- `additionalContext` · `continue: false` · `stopReason` · `suppressOutput` — **파싱되나 미지원**

**PostToolUse**
- `decision: "block"` + `reason` — **실행은 취소 못함**. tool result를 feedback으로 대체 후 모델 계속 실행
- `additionalContext` (hookSpecificOutput 내부) — 후속 모델 요청에 컨텍스트 추가
- `continue: false` — 원래 tool result 정상 처리 중단 (decision:block보다 우선)

**Stop**
- `decision: "block"` — Codex 계속 실행. `reason` 텍스트가 **새 user prompt**로 자동 변환
- plain text stdout — **Stop 이벤트에서는 유효하지 않음** (JSON 필요)

**SessionStart**
- `additionalContext` — 세션 시작 시 LLM 컨텍스트 주입
- plain text stdout — 추가 개발자 컨텍스트로 추가

### 10-3. 차단 의미론 정확화

| 메커니즘 | 우선순위 | 의미 |
|---|---|---|
| `continue: false` | **최우선** | 정상 처리 중단. scope 불명확 (문서에 "marks hook run as stopped"만 명시, turn 종료로 추정) |
| `decision: "block"` (JSON) | 2순위 | 명시적 거부. PostToolUse에서는 실행 취소 안 됨 |
| exit 2 + stderr | 3순위 | 차단. decision:block과 **기능상 동등** (문서 상 차이 없음) |

**출력 크기 제한**: `additionalContext`, `systemMessage`, plain stdout 모두 **10,000자** 상한. 초과 시 파일 저장 후 preview + path로 대체.

### 10-4. PreToolUse Bash 한정 상태 업데이트

- **issue #16732** (Open, 2026-04-18 기준): apply_patch가 PreToolUse/PostToolUse emit하지 않음
- **PR #18391** (Open, OpenAI 직원 fcoury-oai 작성, canvrno-oai Approved): fix 준비 완료
  - `ApplyPatchHandler`에 PreToolUse/PostToolUse payload 추가
  - `hook_runtime.rs`의 `tool_name: "Bash"` 하드코딩 제거 → 핸들러가 `tool_name` 직접 공급
  - 적용 시: `apply_patch` 매처로 PreToolUse/PostToolUse 인터셉트 가능
  - MCP 도구·web_search는 여전히 미지원 (PR 범위 외)
- **unified_exec 피처 플래그**: 기존 메모리의 "개선 가능(추론)" 기재는 — PR #18391 분석 결과 hook 미지원과 별개 문제. **확인 불가 유지**
- 기존 메모리 §2의 "현재 Bash만" 표현 → PR merge 후 "Bash + apply_patch"로 갱신 필요

### 10-5. experimental 플래그 동작

- `codex_hooks = true` 미설정 → hooks.json 로드 **비활성화** (오류 없이 조용히 무시)
- `codex_hooks = false` 또는 키 부재 → 동일 (off by default)
- nexus-core installer가 자동 set하는 것: 기술적으로 안전. 단, OpenAI가 "under development" 명시하므로 API 변경 리스크 존재
- **Windows**: "현재 비활성화" — 전체 hook 시스템 무시 (일부만이 아님), 임시 조치로 명시

### 10-6. 핸들러 환경변수

- **공식 문서에 명시 없음** (config-reference, hooks 문서 모두 미기재)
- 유일하게 확인된 환경변수: `CODEX_INTERNAL_ORIGINATOR_OVERRIDE` (비공개 내부 변수, Discussion #14219에서 사용자가 발견)
- stdin JSON으로 전달되는 `session_id`, `cwd`, `model` 등(§5)이 환경변수가 아닌 **stdin** 경로임을 재확인
- **확인 불가**: CODEX_SESSION_ID, CODEX_CWD 등 환경변수로 주입 여부

## 기존 내용 정오

| 항목 | 기존 기재 | 정확한 내용 |
|---|---|---|
| §2 PreToolUse 제약 | "현재 Bash만" | Bash만 (apply_patch는 PR #18391 merge 후 추가 예정) |
| §4 `continue: false` | "세션·턴 중단" | scope 불명확 (turn 종료로 추정, 세션 종료 여부 미확인) |
| §4 exit 2 vs decision:block | 기재 없음 | 기능 동등 (우선순위만 다름: continue:false > decision:block > exit 2) |
| §6 unified_exec | "PreToolUse·PostToolUse 인터셉션 부분 개선 가능(추론)" | hook와 별개 문제, 연관성 확인 불가 |

## 11. 컴팩션 Hook 미존재 확인 (2026-04-18 조사)

> 조사 배경: v0.13.0 Hook 설계 플랜 세션 — PreCompact/PostCompact 이벤트 유무 검증
> 출처: [codex-rs/hooks/src/events/mod.rs](https://github.com/openai/codex/blob/main/codex-rs/hooks/src/events/mod.rs) · [codex-rs/hooks/src/types.rs](https://github.com/openai/codex/blob/main/codex-rs/hooks/src/types.rs) · [issue #12208](https://github.com/openai/codex/issues/12208) · [issue #2109](https://github.com/openai/codex/issues/2109) · [changelog v0.119.0](https://developers.openai.com/codex/changelog)

### 11-1. 소스 코드 직접 확인 결과

`codex-rs/hooks/src/events/mod.rs` 에 선언된 모듈 전체:

```
session_start.rs
user_prompt_submit.rs
pre_tool_use.rs
post_tool_use.rs
stop.rs
permission_request.rs
```

컴팩션 관련 파일 **없음**. `HookEvent` enum (`types.rs`) 에는 `AfterAgent` · `AfterToolUse` 두 variant만 존재 — compact variant 없음.

### 11-2. 컴팩션 기능 자체는 존재

`codex-rs/core/src/compact.rs` · `compact_remote.rs` 에서 구현됨. `models-manager`에 `model_auto_compact_token_limit` 설정 존재. 컴팩션은 동작하지만 **hook 이벤트로 미노출**.

v0.119.0 (2026-04-10) changelog의 "compaction analytics event 추가"는 OpenAI 내부 텔레메트리이며 사용자 hook이 아님.

### 11-3. Feature Request 상태

| Issue | 내용 | 상태 |
|---|---|---|
| [#12208](https://github.com/openai/codex/issues/12208) | "add a PreCompact hook event" | 2026-02-19 closed as duplicate of #2109 |
| [#2109](https://github.com/openai/codex/issues/2109) | "Event Hooks" (general) | closed (hooks 기능 구현으로 완료) |

PreCompact는 #12208 → #2109 중복 처리됐으나 **미구현 상태**. #2109 comments에 PreCompact 필요성 논의 있으나 Codex 팀 응답 없음.

### 11-4. 3 하네스 비교 — 컴팩션 Hook

| 하네스 | 컴팩션 Hook |
|---|---|
| **Claude Code** | `PreCompact` 존재 (25 이벤트 카탈로그에 포함) |
| **OpenCode** | `experimental.session.compacting` 단일 이벤트 |
| **Codex** | **없음** — 확인 불가 아님, 코드베이스에 미존재 확정 |

### 11-5. nexus-core 우회 전략

컴팩션 hook이 없으므로 다음 대안만 가능:

1. **SessionStart `resume` matcher** — 컴팩션 후 세션이 resume되면 해당 이벤트 발화. 컴팩션 직후 컨텍스트 재주입 가능 (타이밍은 불정확)
2. **AGENTS.md** — 컴팩션 시 보존할 내용을 LLM에게 지침으로 지정. 결정론적이지 않음
3. **`Stop` hook `decision:block`** — 에이전트 정지를 막는 방식으로 컴팩션 우회 가능성 있으나 미검증
4. 컴팩션 hook 추가 시까지 **확인 불가 유지**

## 12. 6번째 이벤트 PermissionRequest 발견 (2026-04-18)

§11 researcher 조사 부산물: `codex-rs/hooks/src/events/` 디렉토리에 **`permission_request.rs` 존재**. 메모리 §2의 "5종" 표기는 **부정확** — Codex hook은 실제 **6종**.

| 이벤트 파일 | 기존 §2 카탈로그 | 정정 |
|---|---|---|
| session_start.rs | ✓ | ✓ |
| user_prompt_submit.rs | ✓ | ✓ |
| pre_tool_use.rs | ✓ | ✓ |
| post_tool_use.rs | ✓ | ✓ |
| stop.rs | ✓ | ✓ |
| **permission_request.rs** | **누락** | **추가 필요** |

PermissionRequest hook의 정확한 stdin/stdout 의미론·matcher 동작은 미검증 (실험 추가 필요).

### Claude PermissionRequest와의 관계

Claude `PermissionRequest`는 권한 다이얼로그 발생 시 발화. Codex의 `PermissionRequest`도 동일 시점인지, 또는 다른 의미(예: tool 실행 권한 요청 트리거)인지 확인 필요. 자매 프로젝트 codex-nexus도 이 hook을 사용하지 않는 것으로 보임 (hooks.json에 없음, §11 sister project 분석).

## 13. 5 이벤트 직접 발화 검증 (2026-04-18)

**환경**: codex-cli 0.121.0, macOS, `~/.codex/auth + config` 인증 사용, `-c features.codex_hooks=true` 오버라이드

테스트 hook: 5 표준 이벤트 + 가상 컴팩션 이벤트(PreCompact/PostCompact/Compact)를 모두 등록 → "Run bash 'ls -la'" 프롬프트로 codex exec 실행.

| 이벤트 | 발화 | stdin 핵심 필드 |
|---|---|---|
| `SessionStart` | ✓ | `session_id`, `transcript_path`, `cwd`, `model`, `permission_mode`, `source: "startup"` |
| `UserPromptSubmit` | ✓ | + `turn_id`, `prompt` |
| `PreToolUse` | ✓ Bash 호출 시 | + `tool_name: "Bash"`, `tool_input.command`, `tool_use_id` |
| `PostToolUse` | ✓ | + `tool_response` (string, 도구 출력 그대로) |
| `Stop` | ✓ | + `stop_hook_active: false`, `last_assistant_message` |
| `PreCompact` / `PostCompact` / `Compact` | **발화 0** | — (compact 트리거 자체 없음, §11 소스 확인으로 hook 부재 확정) |
| `PermissionRequest` | (미테스트) | — |

### 신규 stdin 필드 발견

- **`permission_mode`** 필드가 stdin에 포함됨 (`"bypassPermissions"` 등). 메모리 §5의 stdin 공통 필드 표에 누락 → 정정 필요
- 환경변수 `CODEX_*` 없음 재확인 (§6 일치)
- Codex가 unknown event 이름 등록을 silently 무시 (오류 없음, 그냥 안 발화)

### nexus-core 영향

- `event.session_start`, `event.user_prompt_submit`, `event.pre_tool_use.bash`, `event.post_tool_use.bash`, `event.stop` capability matrix Codex `true` 확정
- `event.pre_compact`, `event.post_compact` Codex `false` 확정 (§11 소스 확인)
- `event.permission_request` Codex 가능성 있음 (§12 — 추가 검증 필요)

## Skill 도구 args 형식 (v0.13 조사)

> 출처: [developers.openai.com/codex/skills](https://developers.openai.com/codex/skills) [P], [developers.openai.com/codex/custom-prompts](https://developers.openai.com/codex/custom-prompts) [P]

### 호출 syntax

Codex는 별도 `skill` 도구가 아닌 **composer 내 `$` prefix** 직접 멘션 방식:

```
$skill-name
$skill-name positional-arg
$skill-name KEY=value KEY2="multi word value"
```

- `$skill-installer linear` — positional arg 예시 (스킬 이름을 installer에 전달)
- args가 있다면 **positional** (`$0`/`$1`/`$ARGUMENTS`) 또는 **named** (`KEY=value`) 중 하나

### Custom Prompts args 형식 (참고)

Codex Custom Prompts(= `/prompts:name`)는 동일한 placeholder 시스템 사용:

| 방식 | 문법 | 예 |
|---|---|---|
| positional | `$1`~`$9`, `$ARGUMENTS` | `$nx-plan auto` → `$1`=`auto` |
| named | `KEY=value` (대문자 권장) | `$nx-plan FOCUS="loading"` → `$FOCUS` 치환 |

Skills도 동일 placeholder를 지원하는 것으로 추정되나 **공식 문서에 skills-specific args 예시 없음**.

### 확인 불가

- Codex skill에서 `$ARGUMENTS` / `$N` placeholder가 공식적으로 보장되는지 (Custom Prompts 문서만 명시)
- `$skill-name KEY=value` 호출 시 SKILL.md 내 `$KEY` 치환 여부
- codex-rs 소스 내 skill arg parsing 로직 직접 확인 못함

### nexus-core 영향

- Codex에서 `$nx-plan` 뒤에 positional 또는 KEY=value args 모두 이론상 가능
- 단, args 전달 보장을 위해서는 Custom Prompts 방식(`/prompts:nx-plan MODE=auto`)이 더 안전
- `{{INVOKE:Skill:<name>:<args>}}` 형식 설계 시 Codex는 `$<name> <args>` 또는 `$<name> KEY=<args>`로 번역 필요
