# Claude Code 하네스 정리

> 검증일: 2026-04-21
>
> 주요 출처:
> - Claude Code Plugins: https://code.claude.com/docs/en/plugins
> - Plugins reference: https://code.claude.com/docs/en/plugins-reference
> - Hooks reference: https://code.claude.com/docs/en/hooks
> - Tools reference: https://code.claude.com/docs/en/tools-reference
> - Subagents: https://code.claude.com/docs/en/sub-agents

## 1. 개요와 설치 스코프

Claude Code는 플러그인 단위로 `skills`, `agents`, `hooks`, `MCP`, `LSP`, `monitors`를 함께 배포할 수 있다. 개인 설정과 프로젝트 설정을 모두 지원하며, 플러그인을 활성화하면 사용자/프로젝트 훅과 병합되어 동작한다.

설치 스코프는 다음 4가지다.

| 스코프 | 설정 파일 | 용도 |
|---|---|---|
| `user` | `~/.claude/settings.json` | 개인 전역 |
| `project` | `.claude/settings.json` | 팀 공유 |
| `local` | `.claude/settings.local.json` | 프로젝트 로컬 전용 |
| `managed` | 관리형 설정 | 조직 강제 |

설치된 플러그인은 캐시 위치인 `~/.claude/plugins/cache/<marketplace>/<plugin>/<version>/`로 복사되어 로드된다.

## 2. 플러그인 디렉토리 구조

Claude Code 플러그인은 루트 기준으로 다음 구조를 가진다.

```text
my-plugin/
├── .claude-plugin/
│   └── plugin.json
├── skills/<name>/SKILL.md
├── commands/*.md
├── agents/*.md
├── hooks/hooks.json
├── monitors/monitors.json
├── bin/
├── settings.json
├── .mcp.json
├── .lsp.json
└── assets / scripts / 기타 보조 파일
```

중요한 제약:

- `.claude-plugin/` 안에는 `plugin.json`만 둔다.
- `skills/`, `commands/`, `agents/`, `hooks/`는 플러그인 루트에 있어야 한다.
- `commands/`는 하위 호환 용도이며, 새 플러그인은 `skills/` 사용이 권장된다.
- `bin/` 아래 실행 파일은 플러그인 활성 중 Bash 도구의 `PATH`에 추가된다.

## 3. 매니페스트와 번들 가능 구성요소

`.claude-plugin/plugin.json`은 사실상 플러그인 진입점이다. 핵심 필드는 `name`, `version`, `description`이며, `author`, `repository`, `dependencies`, `userConfig` 등을 추가할 수 있다.

플러그인이 번들할 수 있는 핵심 구성요소:

- `skills` / `commands`: 재사용 가능한 워크플로
- `agents`: 자동 또는 수동 호출 가능한 서브에이전트
- `hooks`: lifecycle 자동화
- `.mcp.json`: MCP 서버 설정
- `.lsp.json`: 코드 인텔리전스용 LSP 설정
- `monitors/monitors.json`: 백그라운드 감시
- `settings.json`: 기본 동작 설정

`settings.json`은 현재 `agent`와 `subagentStatusLine` 같은 일부 키만 지원한다.

## 4. 에이전트와 스킬 구조

### 4-1. Agents

플러그인 `agents/*.md`는 Claude가 자동 선택하거나 사용자가 수동 호출할 수 있는 서브에이전트다. 공식 reference 기준으로 지원되는 frontmatter는 다음이 핵심이다.

- `name`
- `description`
- `model`
- `effort`
- `maxTurns`
- `tools`
- `disallowedTools`
- `skills`
- `memory`
- `background`
- `isolation`

중요 제약:

- plugin-shipped agent에는 `hooks`, `mcpServers`, `permissionMode`를 넣을 수 없다.
- `isolation`의 유효값은 현재 `"worktree"`뿐이다.

### 4-2. Skills

스킬은 `skills/<name>/SKILL.md` 디렉토리형 자산이다. Claude가 문맥을 보고 자동 호출할 수 있고, 사용자가 `/plugin-name:skill-name` 형태로 수동 호출할 수도 있다.

실무적으로는:

- 공유 가능한 명령형 워크플로는 `skills`
- 구식 slash-command 스타일 호환은 `commands`
- 역할 분리는 `agents`

로 나누는 것이 가장 자연스럽다.

## 5. 훅 종류 및 동작 방식

### 5-1. 훅 등록 위치

Claude Code 훅은 다음 위치에서 등록된다.

- `~/.claude/settings.json`
- `.claude/settings.json`
- `.claude/settings.local.json`
- 플러그인 `hooks/hooks.json`
- 스킬/에이전트 frontmatter 내부 `hooks`

플러그인 훅은 사용자/프로젝트 훅과 병합된다. `/hooks` 메뉴에서 최종 등록 상태를 읽기 전용으로 확인할 수 있다.

### 5-2. 훅 이벤트 카탈로그

2026-04-21 기준 공식 hooks reference에서 확인되는 주요 이벤트군은 다음과 같다.

| 그룹 | 이벤트 |
|---|---|
| 세션 | `SessionStart`, `SessionEnd`, `Stop`, `StopFailure`, `PreCompact`, `PostCompact` |
| 프롬프트/지시 | `InstructionsLoaded`, `UserPromptSubmit` |
| 권한 | `PermissionRequest`, `PermissionDenied` |
| 도구 | `PreToolUse`, `PostToolUse`, `PostToolUseFailure` |
| 서브에이전트/팀 | `SubagentStart`, `SubagentStop`, `TeammateIdle` |
| 작업/알림 | `TaskCreated`, `TaskCompleted`, `Notification` |
| 환경 변화 | `ConfigChange`, `CwdChanged`, `FileChanged`, `WorktreeCreate`, `WorktreeRemove` |
| MCP 상호작용 | `Elicitation`, `ElicitationResult` |

실무적으로 nexus-core가 가장 많이 신경 써야 하는 이벤트는 `SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `SubagentStop`, `Stop`이다.

### 5-3. 핸들러 타입

Claude Code는 4가지 훅 핸들러 타입을 지원한다.

- `command`
- `http`
- `prompt`
- `agent`

지원 범위는 이벤트별로 다르다. `PreToolUse`, `PostToolUse`, `PostToolUseFailure`, `PermissionRequest`, `Stop`, `SubagentStop`, `TaskCreated`, `TaskCompleted`, `UserPromptSubmit` 같은 핵심 이벤트는 4종 모두 지원한다.

### 5-4. 입출력 의미론

`command` 훅 기준 핵심 동작은 다음과 같다.

- 입력: `stdin` JSON
- 출력: `stdout` JSON
- `exit 0`: 성공
- `exit 2`: 차단/거부
- 기타 exit code: 비차단 오류

`PreToolUse`의 핵심 출력:

- `permissionDecision: allow | deny | ask | defer`
- `updatedInput`
- `additionalContext`

`PostToolUse`의 핵심 출력:

- `decision: "block"`
- `additionalContext`
- `updatedMCPToolOutput`

`UserPromptSubmit` / `SessionStart` / `PostToolUse` 등에서는 `additionalContext`를 통해 Claude의 추가 developer/system reminder를 주입할 수 있다.

중요한 운영 포인트:

- `PreToolUse`는 실제 툴 호출 전에 실행되므로 차단 지점으로 가장 강하다.
- `PostToolUse`의 `decision: "block"`은 이미 실행된 부작용을 되돌리지는 못하고, 결과 전달을 차단하는 성격이다.
- hook command와 HTTP hook은 dedupe 규칙이 있으며, 여러 소스의 훅이 함께 작동한다.

## 6. 지원 툴 종류

2026-04-21 기준 공식 Tools reference의 주요 빌트인 툴은 다음과 같다.

### 6-1. 파일/검색

- `Read`
- `Write`
- `Edit`
- `Glob`
- `Grep`
- `NotebookEdit`

### 6-2. 실행/환경

- `Bash`
- `PowerShell`
- `Monitor`

### 6-3. 코드 인텔리전스

- `LSP`

### 6-4. 웹/MCP

- `WebFetch`
- `WebSearch`
- `ListMcpResourcesTool`
- `ReadMcpResourceTool`

### 6-5. 오케스트레이션/메타

- `Agent`
- `AskUserQuestion`
- `Skill`
- `EnterPlanMode`
- `ExitPlanMode`
- `EnterWorktree`
- `ExitWorktree`
- `TaskCreate`
- `TaskGet`
- `TaskList`
- `TaskUpdate`
- `TaskStop`
- `TodoWrite`
- `ToolSearch`

### 6-6. 스케줄/팀

- `CronCreate`
- `CronList`
- `CronDelete`
- `SendMessage`
- `TeamCreate`
- `TeamDelete`

Claude Code는 세 하네스 중 파일 편집, 웹, LSP, 모니터, 작업/팀 도구까지 가장 넓은 1st-party surface를 가진 편이다.

## 7. nexus-core 관점 정리

- 플러그인 구조 자체는 Claude Code가 가장 정형화되어 있다.
- `skills`, `agents`, `hooks`, `MCP`, `LSP`, `monitors`를 한 디렉토리에서 같이 배포하기 쉽다.
- `PreToolUse` / `PostToolUse`가 풍부해서 하네스 간 공통 훅 추상화를 설계하기에 가장 좋은 기준점이다.
- 반면 plugin-shipped agent에 `hooks`와 `mcpServers`를 직접 실을 수 없다는 제약은 고려해야 한다.
- 새 자산은 `commands`보다 `skills` 중심으로 설계하는 편이 현재 문서 방향과 맞다.

## 확인 불가 / 주의

- Agent teams 관련 도구(`SendMessage`, `TeamCreate`, `TeamDelete`)는 환경 변수에 따라 비활성될 수 있다.
- PowerShell은 플랫폼별 롤아웃 상태가 다르고 Windows 이외 환경에서는 별도 활성화가 필요하다.
