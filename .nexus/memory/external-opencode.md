# OpenCode 하네스 정리

> 검증일: 2026-04-21
>
> 주요 출처:
> - Plugins: https://opencode.ai/docs/plugins/
> - Tools: https://opencode.ai/docs/tools/
> - Agents: https://opencode.ai/docs/agents/
> - Permissions: https://opencode.ai/docs/permissions/
> - OpenCode runtime source: https://github.com/anomalyco/opencode

## 1. 개요와 설정 루트

OpenCode는 Claude Code처럼 "플러그인 디렉토리 하나"를 배포 단위로 강하게 고정하기보다, 설정 루트 아래 여러 자산 디렉토리를 병렬로 두는 방식이다. 플러그인 코드는 JS/TS 모듈이고, 에이전트/커맨드/스킬/커스텀 툴은 별도 디렉토리 자산으로 공존한다.

주요 설정 루트:

| 스코프 | 경로 |
|---|---|
| 글로벌 | `~/.config/opencode/` |
| 프로젝트 | `.opencode/` |

## 2. 플러그인 로딩과 배포 방식

공식 docs 기준 OpenCode 플러그인 로딩 방식은 2가지다.

### 2-1. 로컬 파일

- `~/.config/opencode/plugins/`
- `.opencode/plugins/`

위 디렉토리에 JS/TS 파일을 두면 시작 시 자동 로드된다.

### 2-2. npm 패키지

`opencode.json`의 `plugin` 배열에 npm 패키지를 적으면 OpenCode가 시작 시 Bun으로 자동 설치한다.

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["opencode-helicone-session", "@my-org/custom-plugin"]
}
```

캐시 위치는 공식 docs 기준 `~/.cache/opencode/node_modules/`다.

## 3. 플러그인 모듈 형태

공식 docs 기준 플러그인은 "하나 이상의 plugin function"을 export하는 JS/TS 모듈이다.

```ts
export const MyPlugin = async (ctx) => {
  return {
    "tool.execute.before": async (input, output) => {
      // ...
    },
  }
}
```

공식 예제는 `MyPlugin`처럼 임의 export 이름을 사용한다. 현재 runtime source를 보면 loader는 최신 형식의 `server` entry와 legacy exported function들도 읽을 수 있으므로, 실무적으로는 "문서 예제는 자유 export 이름, 런타임은 `server` entry도 수용"이라고 이해하는 것이 안전하다.

## 4. 설정 디렉토리 구조

OpenCode 설정 루트 아래 일반적인 구조는 다음과 같다.

```text
.opencode/                  (또는 ~/.config/opencode/)
├── plugins/               # JS/TS 플러그인 모듈
├── agents/                # .md 에이전트 정의
├── commands/              # .md 커맨드 정의
├── skills/                # 스킬 디렉토리
├── tools/                 # 커스텀 툴
├── modes/
├── themes/
├── opencode.json
└── package.json
```

이 점이 Claude Code, Codex와 다른 핵심 차이점이다.

- OpenCode는 루트 전체가 하네스 작업공간이다.
- 에이전트/커맨드/스킬/플러그인 코드가 같은 설정 트리 안에 공존한다.
- 로컬 plugin code와 markdown 자산이 느슨하게 결합된다.

## 5. 에이전트 구조

OpenCode 에이전트는 `opencode.json` 객체 또는 Markdown 파일로 정의할 수 있다.

Markdown 위치:

- `~/.config/opencode/agents/`
- `.opencode/agents/`

예시 frontmatter 핵심:

- `description`
- `mode`
- `model`
- `temperature`
- `permission` 또는 legacy `tools`
- `hidden`

`mode`는 `primary`, `subagent`, `all`을 지원한다. `hidden: true`를 주면 `@` 자동완성에서 숨길 수 있지만, 권한이 허용되면 모델은 여전히 Task tool로 호출할 수 있다.

OpenCode docs는 built-in primary agent로 `build`, `plan`, built-in subagent로 `general`, `explore`를 안내한다.

## 6. Commands 와 Skills

OpenCode는 에이전트 외에도 다음 자산을 직접 지원한다.

### 6-1. Commands

`commands/*.md` 파일에 frontmatter + 템플릿 본문을 두는 방식이다. `$ARGUMENTS`, `$1..N`, 인라인 shell 실행, 파일 삽입 같은 보간을 지원한다.

### 6-2. Skills

`skills/` 아래 `SKILL.md`를 두는 방식이다. OpenCode의 built-in `skill` tool이 이를 로드해 대화 컨텍스트에 투입한다.

즉, OpenCode는 Claude Code처럼 "skill 중심으로 재사용"이 가능하면서도, commands와 plugin code를 함께 섞어 쓰는 유연성이 더 크다.

## 7. 권한 모델

OpenCode의 권한 모델은 `permission` 키 중심이다.

핵심 값:

- `allow`
- `ask`
- `deny`

공식 permissions docs 기준:

- `v1.1.1`부터 legacy `tools` boolean config는 deprecated
- `permission`이 표준
- glob 기반 granular rule을 지원
- `*`, `?`, `~`, `$HOME` 확장을 지원

에이전트 frontmatter에서도 `permission`을 직접 선언할 수 있다.

```yaml
---
description: Code review without edits
mode: subagent
permission:
  edit: deny
  bash: ask
  webfetch: deny
---
```

공식 permissions 문서와 agents 문서를 합치면, OpenCode는 built-in tool 권한뿐 아니라 `permission.task`로 "어떤 subagent를 Task tool로 호출할 수 있는지"도 제어한다.

## 8. 이벤트 버스 카탈로그

공식 plugins docs는 범용 `event` 훅이 구독할 수 있는 Bus event를 다음처럼 정리한다.

| 그룹 | 이벤트 |
|---|---|
| Command | `command.executed` |
| File | `file.edited`, `file.watcher.updated` |
| Installation | `installation.updated` |
| LSP | `lsp.client.diagnostics`, `lsp.updated` |
| Message | `message.part.removed`, `message.part.updated`, `message.removed`, `message.updated` |
| Permission | `permission.asked`, `permission.replied` |
| Server | `server.connected` |
| Session | `session.created`, `session.compacted`, `session.deleted`, `session.diff`, `session.error`, `session.idle`, `session.status`, `session.updated` |
| Todo | `todo.updated` |
| Shell | `shell.env` |
| Tool | `tool.execute.before`, `tool.execute.after` |
| TUI | `tui.prompt.append`, `tui.command.execute`, `tui.toast.show` |

즉 OpenCode는 "Claude식 고정 lifecycle hooks"보다 "event bus + direct hook API" 조합에 가깝다.

## 9. 직접 훅 API

공식 문서와 현재 `@opencode-ai/plugin` 타입 구조를 합치면 OpenCode 플러그인은 대체로 다음 direct hooks를 가진다.

- `event`
- `tool.execute.before`
- `tool.execute.after`
- `tool.definition`
- `command.execute.before`
- `chat.params`
- `chat.headers`
- `chat.message`
- `permission.ask`
- `shell.env`
- `auth`
- `provider`
- `config`
- `tool`
- `experimental.chat.messages.transform`
- `experimental.chat.system.transform`
- `experimental.session.compacting`
- `experimental.compaction.autocontinue`
- `experimental.text.complete`

공식 plugins 페이지에는 모든 direct hook이 전부 나열되지는 않지만, 현재 source/type surface는 이 레벨까지 열려 있다.

## 10. 훅 실행 의미론

OpenCode 플러그인은 in-process로 실행되고, 공식 docs 기준 load order는 다음과 같다.

1. 글로벌 config
2. 프로젝트 config
3. 글로벌 plugin directory
4. 프로젝트 plugin directory

중요 동작:

- 모든 source에서 플러그인이 로드된다.
- 모든 훅은 순서대로 실행된다.
- 플러그인 코드 자체는 로컬 Bun runtime과 같은 프로세스 공간에서 동작한다.

핵심 훅 의미론:

- `tool.execute.before`: `output.args`를 mutate해서 실제 tool input을 바꿀 수 있다.
- `tool.execute.before`: `throw`로 실행을 차단할 수 있다.
- `tool.execute.after`: 실행 결과를 관찰하거나 일부 후처리를 할 수 있다.
- `shell.env`: 셸 실행 전 환경 변수 삽입
- `tool.definition`: 툴 설명/스키마 조정

## 11. 플러그인 컨텍스트와 작성 헬퍼

공식 docs가 설명하는 plugin function 입력 컨텍스트는 다음이 핵심이다.

- `project`
- `directory`
- `worktree`
- `client`
- `$` (Bun shell API)

즉 OpenCode 플러그인은 단순한 "콜백 훅"이 아니라, 시작부터 SDK client와 shell을 함께 가진 강한 런타임 확장점이다.

## 12. 커스텀 툴과 MCP

OpenCode는 plugins docs에서 `tool()` helper로 커스텀 툴을 추가하는 방식을 공식 안내한다.

```ts
import { type Plugin, tool } from "@opencode-ai/plugin"

export const CustomToolsPlugin: Plugin = async () => ({
  tool: {
    mytool: tool({
      description: "This is a custom tool",
      args: {
        foo: tool.schema.string(),
      },
      async execute(args, context) {
        return `Hello ${args.foo}`
      },
    }),
  },
})
```

또한 built-in tools 외에도 MCP servers를 붙여 외부 시스템 도구를 그대로 노출할 수 있다.

## 13. Compaction 과 컨텍스트 주입

OpenCode에서 Claude Code의 `additionalContext`와 가장 비슷한 역할은 `experimental.chat.system.transform`과 `experimental.session.compacting`이다.

공식 docs에 문서화된 `experimental.session.compacting`은 다음을 할 수 있다.

- compaction prompt에 `output.context` 추가
- `output.prompt`로 기본 compaction prompt 전체 교체

이 특성 때문에 OpenCode는 "새 user prompt 직전 1회 주입"보다는 "LLM 호출 직전 시스템 프롬프트를 변형"하는 설계가 더 자연스럽다.

## 14. 알려진 갭과 주의점

OpenCode는 확장면이 넓지만, 문서와 runtime surface가 항상 완벽히 일치하지는 않는다.

실무적으로 주의할 점:

- `permission.ask`, `task`, `todoread`, `codesearch` 등은 문서 노출 위치가 일관되지 않다.
- permissions docs는 `task`, `todoread`, `codesearch`, `list` 같은 권한 키를 명시하지만, tools page의 built-in 목록은 더 좁게 보일 때가 있다.
- 따라서 "공식 docs + 현재 runtime/source"를 함께 보는 편이 정확하다.

## 15. 지원 툴 종류

### 15-1. 공식 tools page에 명시된 built-in

2026-04-21 기준 공식 Tools 페이지가 명시하는 built-in tools:

- `bash`
- `edit`
- `write`
- `read`
- `grep`
- `glob`
- `lsp` (experimental)
- `apply_patch`
- `skill`
- `todowrite`
- `webfetch`
- `websearch`
- `question`

핵심 메모:

- `write`와 `apply_patch`는 모두 `edit` permission으로 통제된다.
- `websearch`는 OpenCode provider 또는 `OPENCODE_ENABLE_EXA=1`이 필요하다.
- `todowrite`는 subagent에서 기본 비활성이다.

### 15-2. agents / permissions 문서가 추가로 드러내는 semi-native surface

공식 docs의 다른 페이지를 함께 보면 다음도 지원 surface로 봐야 한다.

- `task` / `permission.task`: subagent 호출
- `todoread`: todo 읽기
- `list`: 디렉토리 listing
- `codesearch`: 검색 계열 permission key

즉 OpenCode는 실제 런타임이 가진 도구 surface가 tools page 단일 문서보다 약간 더 넓다.

### 15-3. 확장 도구

- plugin-defined custom tools
- MCP server tools

OpenCode는 세 하네스 중 "plugin code가 런타임을 깊게 바꿀 수 있는 범위"가 가장 넓은 편이다.

## nexus-core 관점 정리

- OpenCode는 하네스 내부 구조가 가장 유연하지만, 문서 표면은 가장 분산돼 있다.
- hooks만으로 끝나는 하네스가 아니라 plugin code, event bus, direct hooks, custom tools, MCP가 한꺼번에 열린 구조다.
- Claude Code보다 구조적 표준화는 약하지만, 실험적 확장성과 플러그인 자유도는 더 높다.
- 공통 abstraction을 설계할 때는 "공식 docs 표면"보다 "현재 runtime/source 표면"을 기준으로 잡는 편이 안전하다.
