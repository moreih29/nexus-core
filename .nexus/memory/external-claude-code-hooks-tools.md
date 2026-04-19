# Claude Code 훅·네이티브 툴

> Anthropic 공식 — Claude Code 훅 시스템과 빌트인 툴 카탈로그. 출처: [Hooks](https://code.claude.com/docs/en/hooks). 플러그인 구조는 [`external-claude-code-plugin.md`](./external-claude-code-plugin.md) 참조.

## 1. 훅 이벤트 (25종)

| 이벤트 | 발화 | Matcher |
|---|---|---|
| `SessionStart` | 세션 시작·재개·초기화·컴팩션 직후 | `startup`·`resume`·`clear`·`compact` |
| `SessionEnd` | 세션 종료 | 종료 사유 |
| `InstructionsLoaded` | CLAUDE.md·rules 로드 | reason |
| `UserPromptSubmit` | 프롬프트 제출 후 처리 전 | 미지원 |
| `PermissionRequest` | 권한 다이얼로그 발생 | 도구 이름 |
| `PermissionDenied` | auto 모드 거부 시 | 도구 이름 |
| `PreToolUse` | 도구 실행 전 (차단 가능) | 도구 이름 |
| `PostToolUse` | 도구 성공 직후 | 도구 이름 |
| `PostToolUseFailure` | 도구 실패 직후 | 도구 이름 |
| `Stop` | Claude 응답 완료 | 미지원 |
| `StopFailure` | API 오류 종료 | 오류 유형 |
| `SubagentStart` / `SubagentStop` | 서브에이전트 시작·완료 | agent 유형 |
| `TeammateIdle` | 팀원 유휴 진입 직전 | 미지원 |
| `TaskCreated` / `TaskCompleted` | TaskCreate 도구 생성·완료 | 미지원 |
| `Notification` | 알림 발송 | 알림 유형 |
| `ConfigChange` | 설정 변경 감지 | 설정 소스 |
| `CwdChanged` | 작업 디렉토리 변경 | 미지원 |
| `FileChanged` | 감시 파일 변경 | 파일명 |
| `WorktreeCreate` / `WorktreeRemove` | 워크트리 생성·제거 | 미지원 |
| `PreCompact` / `PostCompact` | 컨텍스트 컴팩션 전·후 | `manual`·`auto` |
| `Elicitation` / `ElicitationResult` | MCP 사용자 입력 요청·응답 | MCP 서버명 |

## 2. 훅 등록

`hooks.json` 또는 `settings.json`. 등록 위치 4종:

| 경로 | 범위 |
|---|---|
| `~/.claude/settings.json` | 사용자 전체 |
| `.claude/settings.json` | 단일 프로젝트 (공유) |
| `.claude/settings.local.json` | 단일 프로젝트 (로컬) |
| 플러그인 `hooks/hooks.json` | 플러그인 활성 시 |

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash|Edit|Write",
        "hooks": [
          {"type": "command", "command": ".claude/hooks/x.sh", "timeout": 30}
        ]
      }
    ]
  }
}
```

**Matcher 규칙**: `*`/빈/생략 = 전체. 영숫자·`_`·`|` = 정확 매칭 또는 OR. 그 외 = 정규식.

**핸들러 타입 4종**: `command` (셸) · `http` (POST) · `prompt` (소형 모델) · `agent` (에이전트 호출)

## 3. 핸들러 인터페이스 (command)

- 입력: **stdin JSON**
- 출력: **stdout JSON** (exit 0일 때만 파싱)
- exit code: `0` 성공 / `2` 차단(stderr 전달) / 기타 비차단 오류

**환경변수**: `session_id` · `transcript_path` · `cwd` · `CLAUDE_PROJECT_DIR` · `CLAUDE_PLUGIN_ROOT` · `CLAUDE_PLUGIN_DATA` · `CLAUDE_ENV_FILE` · `CLAUDE_CODE_REMOTE`

## 4. 주입 컨텍스트

**공통 필드**:
```json
{
  "session_id": "...", "transcript_path": "...", "cwd": "...",
  "permission_mode": "default|plan|acceptEdits|auto|dontAsk|bypassPermissions",
  "hook_event_name": "PreToolUse",
  "agent_id": "...", "agent_type": "..."
}
```

**PreToolUse·PostToolUse 추가**: `tool_name` · `tool_input` · `tool_use_id` · `tool_response`(Post만)

**SubagentStop 추가**: `agent_id` · `agent_type` · `agent_transcript_path` · `last_assistant_message`

## 5. 출력 처리

| 이벤트 | 주요 출력 |
|---|---|
| `PreToolUse` | `permissionDecision: allow|deny|ask|defer` · `updatedInput` · `additionalContext` |
| `PostToolUse` | `decision: block` · `additionalContext` · `updatedMCPToolOutput` |
| `UserPromptSubmit` | `decision: block` · `additionalContext` · `sessionTitle` |
| `PermissionRequest` | `decision.behavior: allow|deny` · `updatedInput` |
| `SessionStart` / `SubagentStart` | `additionalContext` |
| `Elicitation` | `action: accept|decline|cancel` · `content` |

**공통 범용**: `continue` · `stopReason` · `suppressOutput` · `systemMessage`

## 6. 네이티브 빌트인 툴

대소문자 정확히 일치 필요 (matcher 동작 기준).

### 파일 조작

| 툴 | 핵심 인자 |
|---|---|
| `Read` | `file_path` · `offset` · `limit` |
| `Write` | `file_path` · `content` |
| `Edit` | `file_path` · `old_string` · `new_string` · `replace_all` |
| `MultiEdit` | `file_path` · `edits[]` |
| `Glob` | `pattern` · `path` |
| `LS` | `path` · `ignore` |

### 셸 / 검색 / 웹

| 툴 | 핵심 인자 |
|---|---|
| `Bash` | `command` · `timeout` · `description` · `run_in_background` |
| `PowerShell` | `command` · `timeout` |
| `Grep` | `pattern` · `path` · `glob` · `output_mode` · `-i` · `multiline` |
| `WebFetch` | `url` · `prompt` |
| `WebSearch` | `query` · `allowed_domains` · `blocked_domains` |
| `Computer` | (Chrome 자동화) |

### 메타·에이전트

| 툴 | 설명 |
|---|---|
| `Agent` (=Task) | 서브에이전트 실행 — `prompt` · `description` · `subagent_type` · `model` |
| `TodoRead` / `TodoWrite` | 세션 투두 |
| `AskUserQuestion` | 사용자 질문 — `questions[]` |
| `Config` | settings.json 설정 |
| `Skill` | 사전 정의 스킬 실행 |
| `REPL` | JavaScript 실행 |
| `EnterPlanMode` / `ExitPlanMode` | 플랜 모드 |
| `EnterWorktree` / `ExitWorktree` | git worktree |
| `CronCreate` · `TaskCreate` · `TeammateTool` · `TeamDelete` · `PushNotification` | 메타 |

### 노트북·LSP

| 툴 | 설명 |
|---|---|
| `NotebookRead` / `NotebookEdit` | Jupyter |
| `LSP` | 코드 인텔리전스 (goto definition · references · diagnostics) |

## 7. additionalContext 주입 의미론 [상세]

> 출처: [Hooks reference](https://code.claude.com/docs/en/hooks) [P], [Hooks guide](https://code.claude.com/docs/en/hooks-guide) [P], [Bug #14281](https://github.com/anthropics/claude-code/issues/14281) [T]

### 주입 방식 (핵심)

공식 문서 명시: **"Text returned via `additionalContext` is injected as a system reminder that Claude reads as plain text."**

→ **별도 컨텍스트 영역 — `system-reminder` 블록**으로 주입. 사용자 프롬프트 prepend도, 별도 system role도 아님.

- 최대 10,000자. 초과 시 파일 저장 + preview + 경로만 전달
- 복수 훅의 `additionalContext`는 **모두 수집·합산** 전달
- plain stdout (exit 0, non-JSON)도 컨텍스트로 주입되나 transcript에 표시됨

### 이벤트별 차이

| 이벤트 | additionalContext 주입 타이밍 | 가시성 |
|---|---|---|
| `SessionStart` | 세션 전체 | transcript 미노출 |
| `UserPromptSubmit` | Claude 처리 전 | transcript 미노출 |
| `PreToolUse` | 도구 실행 직전 (defer 아닐 때) | transcript 미노출 |
| `PostToolUse` | 도구 실행 직후 | transcript 미노출 |

알려진 버그 (v2.0.71): 같은 `system-reminder` 블록 내 중복 주입 ([Issue #14281](https://github.com/anthropics/claude-code/issues/14281)).

## 8. 핸들러 타입 4종 상세

> 출처: [Hooks reference](https://code.claude.com/docs/en/hooks) [P], [Hooks guide](https://code.claude.com/docs/en/hooks-guide) [P]

### command
- 입력: stdin JSON / 출력: stdout JSON (exit 0) + stderr
- `async: true` → 백그라운드 비차단
- `asyncRewake: true` → 백그라운드 실행 후 exit 2 시 Claude 재깨움 + stderr를 system reminder로 전달

### http
- POST, `Content-Type: application/json`. body는 stdin JSON과 동일
- 헤더에 `$VAR_NAME` · `${VAR_NAME}` 환경변수 보간 (`allowedEnvVars` 목록 내만)
- 응답: 2xx + 빈 body → exit 0 / 2xx + plain text → context 추가 / 2xx + JSON → command stdout과 동일 파싱 / non-2xx → 비차단 오류
- 차단은 반드시 2xx + JSON (`decision: "block"` 또는 `permissionDecision: "deny"`)

### prompt
- **모델: Haiku** (기본). `model` 필드로 변경
- 입력: prompt의 `$ARGUMENTS` 자리에 훅 입력 JSON stringify로 치환
- **출력 형식: `{"ok": true}` 또는 `{"ok": false, "reason": "..."}`** — command와 비호환
- 기본 timeout 30초

### agent
- 기본 모델 (설정 가능). Read · Grep · Glob · Agent 도구 사용 가능. 최대 50 tool-use turn
- 출력 형식: prompt와 동일 (`ok` / `reason`)
- 기본 timeout 60초

> **stdout 의미론**: command·http = exit code + hookSpecificOutput JSON. **prompt·agent = `{ok, reason}` 형식만 유효** — 두 형식 비호환.

## 9. 환경변수 정확 의미

> 출처: [Hooks reference](https://code.claude.com/docs/en/hooks) [P]

| 변수 | 값 | 가용 이벤트 |
|---|---|---|
| `CLAUDE_PROJECT_DIR` | 프로젝트 루트 | 모든 이벤트 |
| `CLAUDE_PLUGIN_ROOT` | 플러그인 설치 디렉토리 (업데이트마다 변경) | 모든 이벤트 |
| `CLAUDE_PLUGIN_DATA` | 플러그인 영속 데이터 (업데이트 후에도 유지) | 모든 이벤트 |
| `CLAUDE_ENV_FILE` | bash export 구문을 쓸 수 있는 파일 경로 | **SessionStart · CwdChanged · FileChanged 전용** |
| `CLAUDE_CODE_REMOTE` | 원격 웹 환경 시 `"true"`, 로컬 CLI 미설정 | 모든 이벤트 |

`CLAUDE_ENV_FILE`: `>>` append만, `>` 덮어쓰기 금지 — 다른 훅 변수 소실.

**`permission_mode` 영향**:
- `PreToolUse` 훅은 permission-mode 검사 **이전** 실행
- `permissionDecision: "deny"`는 `bypassPermissions`/`--dangerously-skip-permissions`에서도 차단
- `"allow"`는 settings deny 규칙을 우회 못함 — 훅은 권한을 조이는 방향만 가능
- `"defer"`는 `-p` (non-interactive) 전용

## 10. 차단 의미론 정확화

> 출처: [Hooks reference](https://code.claude.com/docs/en/hooks) [P]

### exit 2 + stderr
- transcript에 `<훅명> hook error` + stderr 첫 줄 표시. 전체 stderr는 debug 로그
- 차단 이벤트에서 stderr는 Claude에게 피드백으로도 전달
- exit 2 사용 시 stdout JSON은 무시됨 (혼용 금지)

### decision: "block"
- 블록 대상: 이벤트가 나타내는 행동 자체
  - `UserPromptSubmit` → 프롬프트 처리 차단 + 컨텍스트에서 프롬프트 삭제
  - `PostToolUse` → 도구 결과 피드백 차단 (도구는 이미 실행됨)
  - `Stop` → Claude의 중단 방지
- `reason` = Claude에게 전달되는 피드백

### permissionDecision (PreToolUse 전용)

| 값 | 동작 |
|---|---|
| `"allow"` | 권한 프롬프트 스킵. settings deny 규칙은 여전히 적용 |
| `"deny"` | 도구 호출 취소 + reason을 Claude에게 전달 |
| `"ask"` | 사용자 확인 프롬프트 (출처 레이블 포함) |
| `"defer"` | `-p` 모드 전용: 세션 일시정지, `--resume`으로 재개 |

복수 훅 우선순위: `deny` > `defer` > `ask` > `allow`

**`deny` vs `decision: "block"`**: 전자는 PreToolUse 전용·도구 실행 이전 차단. 후자는 여러 이벤트·일부는 실행 이후 피드백 차단.

### continue: false
- **전역 즉시 중단**, 모든 event-specific 결정 필드보다 우선
- `stopReason`: Claude가 아닌 **사용자**에게 표시

### updatedInput
- 도구 인자 **완전 교체** (partial 아님 — 누락 필드 소실)
- `permissionDecision: "allow"`/`"ask"` 시에만 적용
- 복수 훅 반환 시 마지막 완료 훅이 승리 (병렬 실행 → 비결정론적)

### updatedMCPToolOutput
- `PostToolUse` + MCP 도구(`mcp__*`)에만 유효. 빌트인 도구에선 무시

## 11. 기존 §3 정오

기존 §3에 "환경변수: `session_id` · `transcript_path` · `cwd`"라 적혀 있으나 이들은 **stdin JSON 필드**임. `CLAUDE_*` 계열만 환경변수.

## 확인 불가

- `Computer` · `REPL` · `TeammateTool` · `TeamDelete` 등 일부 툴은 secondary 출처(시스템 프롬프트 리버스)에만 등장. 공식 문서 직접 확인 못함.
- `additionalContext`가 정확히 어느 컨텍스트 레이어에 삽입되는지 (API 수준 system role 블록 위치) 공식 명시 없음 — `system-reminder` 명칭은 bug report에서만 확인
- `prompt`/`agent` 타입 훅에서 `additionalContext` 필드 반환 가능 여부 (ok/reason 형식만 문서화)

## Skill 도구 args 형식 (v0.13 조사)

> 출처: [code.claude.com/docs/en/skills](https://code.claude.com/docs/en/skills) [P], [mikhail.io/2025/10/claude-code-skills/](https://mikhail.io/2025/10/claude-code-skills/) [S]

### tool_use 스키마

Claude Code의 `Skill` 툴은 **단일 문자열 파라미터** `command`만 받는다.

```json
{
  "type": "tool_use",
  "name": "Skill",
  "input": {
    "command": "pdf"
  }
}
```

- 파라미터: `command` (string, required)
- `args` 파라미터: **없음** — 도구 호출 시 args 전달 불가
- plugin-namespaced 스킬: `"command": "ms-office-suite:pdf"` 형식 지원

### 사용자 → Skill body 내 args 흐름

args는 도구 스키마가 아닌 **SKILL.md 본문 내 placeholder 치환**으로 전달:

| placeholder | 의미 |
|---|---|
| `$ARGUMENTS` | 슬래시 명령 뒤 전체 문자열 |
| `$ARGUMENTS[N]` 또는 `$N` | 0-based 위치 인자 (shell-style quoting) |

예: `/fix-issue 123` → SKILL.md 내 `$ARGUMENTS` → `"123"` 치환  
예: `/migrate-component SearchBar React Vue` → `$0`=`SearchBar`, `$1`=`React`, `$2`=`Vue`

### nexus-core 영향

- `Skill` 툴 호출 시 Hook의 `tool_input.command`에 스킬 이름만 존재, args는 없음
- args를 Hook에서 파싱하려면 SKILL.md 본문에 이미 치환된 텍스트에서 추출해야 함 (구조적 args 접근 불가)
- `{{INVOKE:Skill:<name>:<args>}}` 형식 설계 시 Claude Code는 `<args>`를 `command` 파라미터로 전달할 수 없음 → args는 SKILL.md body 내에서만 치환됨
