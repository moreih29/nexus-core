# 3 하네스 통합 비교 문서

> 검증일: 2026-04-21
>
> 기반 문서:
> - [external-claude-code.md](./external-claude-code.md)
> - [external-opencode.md](./external-opencode.md)
> - [external-codex.md](./external-codex.md)
>
> 목적:
> - Claude Code, OpenCode, Codex의 공통 기반을 한 문서에서 본다.
> - 공통화 가능한 영역과 하네스별 어댑터가 필요한 영역을 구분한다.
> - nexus-core가 공통 코어를 어디까지 가져가야 하는지 판단 기준으로 사용한다.

## 1. 플러그인 구조

### 1-1. 세 하네스가 공통으로 가지는 구조 레이어

세 하네스는 모두 "에이전트 기반 코딩 하네스"이며, 다음 레이어를 공통으로 가진다.

| 공통 레이어 | 의미 |
|---|---|
| 재사용 가능한 워크플로 자산 | skills, commands, prompts 등 형태는 다르지만 재사용 지침 자산이 있다. |
| 역할 분리된 에이전트 | 메인 에이전트 외에 역할별 서브에이전트를 둘 수 있다. |
| 사용자/프로젝트 설정 스코프 | 글로벌과 프로젝트 단위 설정을 모두 가진다. |
| MCP 연동 | 외부 도구/리소스를 MCP 서버로 연결할 수 있다. |
| 도구 권한 제어 | 어떤 도구를 허용/차단할지 설정할 수 있다. |
| 배포 메타데이터 | manifest 또는 config를 통해 플러그인/자산 로딩을 제어한다. |

즉 세 하네스는 개념적으로는 같은 문제를 푼다. 하지만 구현 레이어의 분리 방식이 다르다.

### 1-2. 공통으로 보이는 자산과 실제 위치

| 자산 종류 | Claude Code | OpenCode | Codex |
|---|---|---|---|
| 플러그인 메타 | `.claude-plugin/plugin.json` | `opencode.json` + `plugins/*.ts` | `.codex-plugin/plugin.json` |
| skills | `skills/<name>/SKILL.md` | `skills/<name>/SKILL.md` | `skills/<name>/SKILL.md` |
| commands | `commands/*.md` | `commands/*.md` | 별도 폴더 없음, custom prompts는 deprecated |
| agents | `agents/*.md` | `agents/*.md` 또는 `opencode.json` | `.codex/agents/*.toml`, `~/.codex/agents/*.toml` |
| hooks | `hooks/hooks.json` 또는 settings | plugin hook API / event bus | `.codex/hooks.json`, `~/.codex/hooks.json` |
| MCP | `.mcp.json` | config + plugin/runtime integration | `.mcp.json` + `config.toml` / agent TOML |
| 기타 | `.lsp.json`, monitors, bin | `tools/`, `modes/`, `themes/`, `package.json` | `.app.json`, `assets/`, `agents/openai.yaml` |

핵심 차이:

- Claude Code는 플러그인 디렉토리 하나에 자산을 정형화해 둔다.
- OpenCode는 설정 루트 전체가 확장 작업공간처럼 동작한다.
- Codex는 plugin, skills, native subagents가 분리된 다층 구조다.

### 1-3. 설치 스코프와 배포 감각

세 하네스 모두 글로벌/프로젝트 스코프를 가진다. 다만 배포 감각은 다르다.

| 항목 | Claude Code | OpenCode | Codex |
|---|---|---|---|
| 글로벌 스코프 | `~/.claude/settings.json` | `~/.config/opencode/` | `~/.codex/config.toml`, `~/.codex/plugins/`, `~/.codex/agents/` |
| 프로젝트 스코프 | `.claude/settings.json` | `.opencode/` | `.codex/config.toml`, repo-local marketplace, repo-local plugin dir |
| 로컬/비공유 스코프 | `.claude/settings.local.json` | 프로젝트 루트 자체가 로컬 확장점 | 프로젝트별 `.codex/`와 user config 조합 |
| 배포 메커니즘 | plugin marketplace + cache | 로컬 plugins 또는 npm plugin | marketplace + plugin cache + native agent config |

공통점:

- 사용자 전역과 프로젝트 전용 설정을 분리할 수 있다.
- 로컬 자산과 패키지/마켓플레이스 기반 배포를 혼합할 수 있다.

차이점:

- Claude Code는 플러그인 캐시와 설치 규약이 가장 정형화되어 있다.
- OpenCode는 npm plugin과 로컬 JS/TS plugin file이 핵심이다.
- Codex는 plugin 설치와 agent 정의가 서로 다른 층에 있다.

### 1-4. 에이전트 구조와 capability/권한 모델

세 하네스 모두 역할별 agent 정의와 도구 제한을 제공한다. 하지만 표현 방식이 다르다.

#### 공통 개념

- 에이전트는 역할 단위로 분리된다.
- 각 역할은 사용할 수 있는 도구 범위를 제한할 수 있다.
- 파일 편집 금지, 특정 MCP tool 금지, task lifecycle 조작 금지 같은 정책을 표현할 수 있다.

#### 하네스별 표현

| 목적 | Claude Code | OpenCode | Codex |
|---|---|---|---|
| 에이전트 정의 위치 | `agents/*.md` | `agents/*.md` 또는 `opencode.json` | `.codex/agents/*.toml` |
| 권한 핵심 필드 | `tools`, `disallowedTools` | `permission` | `sandbox_mode`, `[mcp_servers.<id>] disabled_tools`, `enabled_tools` |
| 파일 편집 차단 | `Edit`, `Write`, `MultiEdit`, `NotebookEdit` 차단 | `permission.edit: deny` | `sandbox_mode = "read-only"` |
| 특정 MCP tool 차단 | `disallowedTools`에 MCP tool 이름 추가 | `permission.<tool>: deny` | `disabled_tools = [...]` |

예시 감각:

- Claude Code: "도구 이름 denylist"
- OpenCode: "permission rule map"
- Codex: "OS sandbox + MCP tool disable"

이 차이는 중요하다.

- 세 하네스 모두 권한 제어는 가능하다.
- 하지만 공통 capability 메타를 그대로 실행할 수는 없고, 하네스별 변환이 필요하다.
- 특히 Codex는 파일 쓰기 금지를 tool denylist보다 sandbox에 더 의존한다.

#### 공통으로 가능한 capability 표준

세 하네스 공통 capability 메타로 비교적 안정적으로 들고 갈 수 있는 것은 다음이다.

- `no_file_edit`
- `no_task_create`
- `no_task_update`
- 모델 tier 추상화 (`high`, `standard`, `low`)

이 메타는 하네스별로 다음처럼 내려간다.

- Claude Code → `disallowedTools`
- OpenCode → `permission`
- Codex → `sandbox_mode`, `disabled_tools`

#### caller identity 기반 권한 제어는 공통 표준이 되기 어렵다

이 영역은 세 하네스가 모두 비대칭이다.

| 항목 | Claude Code | OpenCode | Codex |
|---|---|---|---|
| MCP tool 호출자 식별 | 공식 미지원 | 일부 노출되지만 신뢰성 이슈 | 비공식 메타데이터 의존 |
| 결론 | caller 기반 정책 비권장 | caller 기반 정책 불안정 | caller 기반 정책 비권장 |

따라서 nexus-core는 **agent definition 레벨의 권한 제한을 공통 표준으로 삼는 것이 맞다**. caller propagation은 portable한 기반이 아니다.

### 1-5. 공통화 가능한 구조와 어댑터가 필요한 구조

#### 공통 코어로 가져갈 수 있는 것

- agent 역할 정의 자체
- skill 지침 본문
- capability 메타 모델
- MCP tool schema와 비즈니스 로직
- 공통 문서/온보딩/설명 자산

#### 하네스별 어댑터가 필요한 것

- 플러그인 manifest와 설치 방식
- agent 출력 포맷
- tool 권한 필드 변환
- MCP server 등록 방식
- commands/prompts의 packaging 차이

결론적으로, `공통 플러그인 artifact 1개`보다 `공통 코어 + 하네스별 빌더`가 현실적이다.

## 2. 훅

### 2-1. 세 하네스가 공통으로 가지는 훅 개념

세 하네스 모두 "모델이 작업하는 흐름 중 특정 시점에 개입하는 메커니즘"을 가진다.

공통 개념은 다음과 같다.

- 세션 시작 시점 개입
- 사용자 프롬프트 처리 직전 개입
- 툴 실행 전/후 개입
- 컨텍스트 주입 또는 안내 메시지 추가
- 정책 위반 시 차단 또는 경고

즉, 모두 hook-like interception layer를 가진다. 하지만 설계 형태는 크게 다르다.

### 2-2. 훅 등록 방식과 실행 모델

| 항목 | Claude Code | OpenCode | Codex |
|---|---|---|---|
| 등록 위치 | settings, plugin hooks, agent/skill frontmatter | plugin function return object | `hooks.json` |
| 실행 모델 | 외부 command/http/prompt/agent 호출 | in-process plugin code 실행 | command hook 실행 |
| 활성화 조건 | 기본 사용 가능 | 기본 사용 가능 | `[features] codex_hooks = true` 필요 |

공통점:

- 훅은 전역과 프로젝트 단위를 모두 가질 수 있다.
- 사용자 설정과 플러그인/프로젝트 훅이 함께 작동할 수 있다.

차이점:

- Claude Code는 정형화된 hook registry에 가깝다.
- OpenCode는 plugin runtime 내부 API에 가깝다.
- Codex는 실험적 command hook 시스템에 가깝다.

### 2-3. 이벤트 구조 비교

#### Claude Code

가장 풍부한 lifecycle hook 세트를 가진다.

- 세션: `SessionStart`, `SessionEnd`, `Stop`, `StopFailure`, `PreCompact`, `PostCompact`
- 프롬프트/지시: `InstructionsLoaded`, `UserPromptSubmit`
- 권한: `PermissionRequest`, `PermissionDenied`
- 툴: `PreToolUse`, `PostToolUse`, `PostToolUseFailure`
- 서브에이전트/팀: `SubagentStart`, `SubagentStop`, `TeammateIdle`
- 작업/알림: `TaskCreated`, `TaskCompleted`, `Notification`
- 환경 변화: `ConfigChange`, `CwdChanged`, `FileChanged`, `WorktreeCreate`, `WorktreeRemove`
- MCP 상호작용: `Elicitation`, `ElicitationResult`

#### OpenCode

고정 이벤트 목록보다 event bus + direct hooks 조합에 가깝다.

- bus event: `session.created`, `session.updated`, `message.updated`, `permission.asked`, `file.edited`, `tool.execute.before`, `tool.execute.after` 등
- direct hooks: `tool.execute.before`, `tool.execute.after`, `tool.definition`, `chat.params`, `chat.headers`, `chat.message`, `permission.ask`, `shell.env`, `config`, `tool`, `experimental.*`

#### Codex

문서화된 공식 hook 이벤트는 가장 적다.

- `SessionStart`
- `UserPromptSubmit`
- `PreToolUse`
- `PostToolUse`
- `Stop`

추가 차이:

- Codex hooks는 experimental이다.
- 공식 문서 기준 `PreToolUse`와 `PostToolUse`는 현재 사실상 `Bash`에만 의미 있게 적용된다.

### 2-4. 핸들러 타입과 입출력 의미론

#### Claude Code

핸들러 타입이 4종이다.

- `command`
- `http`
- `prompt`
- `agent`

핵심 의미론:

- `stdin` JSON 입력
- `stdout` JSON 출력
- `exit 2` 차단
- `additionalContext`, `updatedInput`, `permissionDecision`, `decision: "block"` 지원

#### OpenCode

핸들러라기보다 plugin 함수가 hook API를 구현하는 모델이다.

- `tool.execute.before`에서 `output.args` mutation 가능
- `throw`로 tool execution 차단 가능
- `tool.execute.after`에서 결과 관찰/수정 가능
- `shell.env`, `tool.definition`, `chat.params` 등 런타임 확장 지점이 넓다

#### Codex

command hook 중심이다.

- `stdin` JSON 입력
- `stdout` JSON 출력
- `continue`, `stopReason`, `systemMessage`, `decision: "block"`, `permissionDecision: "deny"` 등 사용
- 단, 여러 필드는 parse되지만 실제로는 미구현이거나 fail-open 상태다

### 2-5. 세 하네스 공통으로 기대할 수 있는 훅 동작

비교적 공통으로 기대할 수 있는 것은 다음이다.

- 세션 시작 시 안내/컨텍스트 주입
- 사용자 프롬프트 직전 검사
- 셸 또는 일부 툴 실행 전 검사
- 실행 결과 후처리 또는 telemetry

반대로 공통 표준으로 삼기 어려운 것은 다음이다.

- tool args mutation의 동일 의미론
- 후속 모델 입력에 대한 deterministic `additionalContext` 주입
- permission prompt interception의 일관성
- MCP tool caller identity와 연결된 hook logic

즉 hook은 공통 추상화를 만들 수는 있어도, **핵심 정책 강제 레이어로 신뢰하기에는 하네스별 차이가 크다**.

### 2-6. nexus-core 관점의 hook 판단

공통 표준으로 삼기 적절한 것:

- 세션 시작 안내
- 경고/telemetry/상태 추적
- 보조적 validation

공통 표준으로 삼기 부적절한 것:

- caller identity 기반 authorization
- 핵심 권한 enforcement
- 하네스별 tool execution semantics에 강하게 의존하는 blocking logic

결론:

- 권한 강제는 agent definition / sandbox / disabled_tools에 두고
- hook은 보조 레이어로 사용해야 한다.

## 3. 툴

### 3-1. 세 하네스가 공통으로 가지는 툴 카테고리

세 하네스 모두 아래 카테고리의 도구를 가진다.

| 공통 카테고리 | 의미 |
|---|---|
| 파일 읽기/쓰기/편집 | 코드와 파일을 읽고 수정하는 도구 |
| 검색/탐색 | grep, glob, ls/list 등 코드베이스 탐색 도구 |
| 셸 실행 | shell/bash 실행 |
| 웹 접근 | web fetch/search 계열 |
| 서브에이전트 호출 | 작업 위임용 도구 |
| 사용자 질문 | 사용자의 선택/입력을 받는 도구 |
| 계획/투두 | 진행 단계나 todo 관리 |
| MCP | 외부 툴/리소스 접근 |

즉 툴 카테고리는 겹치지만, 개별 tool name과 세부 surface는 다르다.

### 3-2. 대표 툴 매핑

| 의미 | Claude Code | OpenCode | Codex |
|---|---|---|---|
| 파일 읽기 | `Read` | `read` | 주로 shell 우회 |
| 파일 쓰기 | `Write` | `write` | `apply_patch` |
| 파일 편집 | `Edit`, `MultiEdit` | `edit`, `apply_patch` | `apply_patch` |
| 검색 | `Grep`, `Glob`, `LS` | `grep`, `glob`, `list` | 주로 shell + `rg`, `find`, `list_dir` |
| 셸 | `Bash`, `PowerShell` | `bash` | `shell`, `shell_command`, `exec_command` |
| 웹 fetch | `WebFetch` | `webfetch` | 직접 대응 약함 |
| 웹 검색 | `WebSearch` | `websearch` | `web_search` |
| 서브에이전트 | `Agent` | `task` | `spawn_agent` |
| 사용자 질문 | `AskUserQuestion` | `question` | `request_user_input` |
| 계획/투두 | `TodoWrite`, `Task*` | `todowrite`, `todoread` | `update_plan` |
| skill 호출 | `Skill` | `skill` | `$skill-name` 문법 |

이 표가 말해주는 핵심:

- 단순 rename 정도의 차이가 아니다.
- Codex는 파일 read/edit가 독립 tool보다 shell/apply_patch 쪽에 더 기울어져 있다.
- OpenCode는 tools page 외에도 runtime/source에 semi-native surface가 있다.
- Claude Code는 1st-party built-in tool 구성이 가장 풍부하다.

### 3-3. 각 하네스에서 확인되는 주요 툴 surface

#### Claude Code

주요 built-in family:

- 파일/검색: `Read`, `Write`, `Edit`, `Glob`, `Grep`, `NotebookEdit`
- 실행/환경: `Bash`, `PowerShell`, `Monitor`
- 코드 인텔리전스: `LSP`
- 웹/MCP: `WebFetch`, `WebSearch`, `ListMcpResourcesTool`, `ReadMcpResourceTool`
- 오케스트레이션/메타: `Agent`, `AskUserQuestion`, `Skill`, `Task*`, `TodoWrite`, `ToolSearch`
- 스케줄/팀: `Cron*`, `SendMessage`, `TeamCreate`, `TeamDelete`

#### OpenCode

공식 tools page와 문서/런타임을 합친 surface:

- `bash`
- `read`
- `write`
- `edit`
- `apply_patch`
- `grep`
- `glob`
- `list`
- `lsp`
- `skill`
- `task`
- `todowrite`
- `todoread`
- `webfetch`
- `websearch`
- `question`
- plugin-defined custom tools
- MCP server tools

#### Codex

공식 docs와 runtime surface를 함께 보면:

- shell/exec: `shell`, `shell_command`, `exec_command`, `write_stdin`
- 파일/디렉토리: `apply_patch`, `list_dir`, `view_image`
- 웹/발견: `web_search`, `tool_search`, `tool_suggest`
- 계획/사용자: `update_plan`, `request_user_input`, `request_permissions`
- 서브에이전트: `spawn_agent`, `send_input`, `resume_agent`, `wait_agent`, `close_agent`
- MCP/JS/이미지: `list_mcp_resources`, `list_mcp_resource_templates`, `read_mcp_resource`, `js_repl`, `image_generation`

### 3-4. 공통 portable tool subset

세 하네스 모두에 비교적 안전하게 추상화할 수 있는 tool intent는 다음이다.

- 파일 읽기
- 파일 쓰기/편집
- 검색/탐색
- 셸 실행
- 웹 검색
- 서브에이전트 위임
- 사용자 질문
- 계획/투두 업데이트
- skill activation
- MCP tool 호출

하지만 추상화 레벨은 "intent"까지만 안전하다.

예를 들면:

- `Read`와 `read`는 가깝지만 Codex는 shell 우회가 섞인다.
- `Agent`, `task`, `spawn_agent`는 모두 위임이지만 세부 인자와 lifecycle이 다르다.
- `TodoWrite`, `todowrite`, `update_plan`은 역할은 비슷하지만 데이터 모델이 다르다.

즉 공통 표준은 `tool name`이 아니라 `tool intent`로 잡는 편이 맞다.

### 3-5. 공통 표준으로 삼기 어려운 tool 영역

- Codex의 shell-heavy file inspection
- Claude Code의 team/worktree/cron tooling
- OpenCode의 plugin-defined custom tools와 in-process tool definition mutation
- tool별 matcher exact name에 의존하는 정책
- 하네스별 approval/request-permission 모델

결론:

- tool mapping layer는 필요하다.
- 그러나 단순 alias table만으로는 충분하지 않고, 일부는 semantic adapter가 필요하다.

## 4. Claude Code만의 특별한 점

### 구조

- 플러그인 디렉토리 구조가 가장 정형화되어 있다.
- `skills`, `agents`, `hooks`, `.mcp.json`, `.lsp.json`, `monitors`, `bin`을 같은 패키지 감각으로 다루기 쉽다.
- plugin-shipped agent에 `hooks`, `mcpServers`, `permissionMode`를 직접 넣을 수 없는 제약이 분명하다.

### 훅

- 공식 문서화된 lifecycle hook surface가 가장 넓다.
- `command`, `http`, `prompt`, `agent` 4종 handler type을 지원한다.
- `additionalContext`, `updatedInput`, `permissionDecision`, `decision: "block"` 등 hook output semantics가 가장 풍부하다.

### 툴

- 파일/웹/LSP/monitor/task/team 도구까지 1st-party surface가 가장 넓다.
- 공통 추상화를 설계할 때 기준점으로 삼기 좋다.

### 판단

- 공통 하네스 표준을 설계할 때 가장 좋은 레퍼런스다.
- 하지만 다른 하네스가 Claude 수준의 hook/tool surface를 모두 제공하지는 않는다.

## 5. OpenCode만의 특별한 점

### 구조

- 설정 루트 전체가 확장 작업공간처럼 동작한다.
- 플러그인 코드, agents, commands, skills, custom tools가 느슨하게 결합된다.
- npm plugin과 로컬 JS/TS plugin file 양쪽이 핵심 배포 수단이다.

### 훅

- event bus와 direct hook API가 함께 열린 구조다.
- in-process plugin code가 `tool.execute.before`, `tool.definition`, `chat.params`, `shell.env`, `config`, `tool` 등 런타임 깊은 곳에 개입할 수 있다.
- 문서 표면과 runtime/source surface가 완전히 동일하지 않은 구간이 있다.

### 툴

- built-in tools 외에 plugin-defined custom tools를 자연스럽게 추가할 수 있다.
- MCP와 plugin tool이 같은 확장 생태계 안에 놓인다.

### 판단

- 확장 자유도는 가장 높다.
- 대신 문서만 보고 portable abstraction을 설계하면 놓치는 부분이 생길 수 있다.

## 6. Codex만의 특별한 점

### 구조

- plugin, skills, native subagents가 분리된 다층 구조다.
- skills 배포와 agent role 정의가 서로 다른 레이어에서 관리된다.
- `AGENTS.md`와 native subagent TOML이 역할 제어에 큰 비중을 가진다.

### 훅

- hooks는 experimental이며 활성화 플래그가 필요하다.
- 공식 hook surface가 가장 좁고, `PreToolUse`/`PostToolUse`는 현재 사실상 Bash 중심이다.
- 따라서 hook은 범용 정책 엔진보다 보조 guardrail에 가깝다.

### 툴

- file read/write abstraction은 상대적으로 얇다.
- 반대로 subagent lifecycle, orchestration, MCP resources는 가장 강하다.
- `sandbox_mode`, `disabled_tools` 같은 강한 런타임 제어 지점이 있다.

### 판단

- 세 하네스 중 multi-agent orchestration과 MCP-first 구조에 가장 잘 맞는다.
- 반대로 file-edit interception이나 generic hook policy는 가장 약한 편이다.

## 7. nexus-core 시사점

최종 판단은 다음으로 정리할 수 있다.

### 공통 코어로 두기 적절한 것

- agent/skill 원본
- capability 메타 모델
- MCP 서버 구현
- 공통 문서와 규칙

### 하네스별 어댑터로 분리해야 하는 것

- 플러그인 패키징과 설치
- 에이전트 출력 포맷
- 권한 설정 변환
- hook wiring
- tool mapping

### 공통 표준으로 삼지 말아야 하는 것

- caller identity 기반 authorization
- hook-specific blocking semantics
- 특정 하네스 전용 built-in tool에 의존하는 설계
- 런타임 내부 메타데이터 포맷에 기대는 구현

### 한 줄 결론

- `공통 플러그인 artifact 1개`는 비현실적이다.
- `공통 코어 + 하네스별 빌더/어댑터`는 현실적이다.
- `공통 MCP 서버`는 가장 유망하다.
- 권한은 공통 capability 메타를 두고 하네스별로 변환하는 구조가 맞다.
