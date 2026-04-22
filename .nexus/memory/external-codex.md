# Codex 하네스 정리

> 검증일: 2026-04-21
>
> 주요 출처:
> - Plugins overview: https://developers.openai.com/codex/plugins
> - Build plugins: https://developers.openai.com/codex/plugins/build
> - Skills: https://developers.openai.com/codex/skills
> - Subagents: https://developers.openai.com/codex/subagents
> - Hooks: https://developers.openai.com/codex/hooks
> - Config reference: https://developers.openai.com/codex/config-reference
> - Open-source Codex CLI: https://github.com/openai/codex

## 1. 개요: Codex의 확장 레이어

Codex는 Claude Code처럼 "plugin 하나가 모든 확장 구조를 대표"하지 않는다. 2026-04-21 기준 Codex는 최소 4개의 확장 레이어를 병행한다.

| 레이어 | 위치 | 역할 |
|---|---|---|
| Plugin | `.codex-plugin/plugin.json` | 배포/설치 단위 |
| Skills | `skills/<skill>/SKILL.md` | 재사용 워크플로 본체 |
| Native subagents | `.codex/agents/*.toml`, `~/.codex/agents/*.toml` | 실제 다중 에이전트 역할 정의 |
| AGENTS.md | 레포 또는 홈 디렉토리 | 상시 지침 주입 |

추가로 `custom prompts`는 공식적으로 deprecated 되었고, reusable workflow는 skills로 이관되는 방향이다.

## 2. 플러그인 매니페스트와 구조

Codex 플러그인의 필수 진입점은 `.codex-plugin/plugin.json`이다.

공식 build docs 기준 최소 구조:

```text
my-plugin/
├── .codex-plugin/
│   └── plugin.json
├── skills/
│   └── <skill-name>/
│       └── SKILL.md
├── .mcp.json
├── .app.json
└── assets/
```

핵심 규칙:

- `.codex-plugin/` 안에는 `plugin.json`만 둔다.
- `skills/`, `.mcp.json`, `.app.json`, `assets/`는 플러그인 루트에 둔다.
- `agents/`와 `commands/`를 플러그인 루트 자산 개념으로 두지 않는다.

## 3. 마켓플레이스와 설치 방식

Codex는 plugin marketplace JSON을 통해 플러그인을 노출한다.

주요 경로:

- repo marketplace: `$REPO_ROOT/.agents/plugins/marketplace.json`
- personal marketplace: `~/.agents/plugins/marketplace.json`

설치 시 실제 캐시는 다음 위치에 저장된다.

- `~/.codex/plugins/cache/$MARKETPLACE/$PLUGIN/$VERSION/`

로컬 plugin authoring에서 흔한 패턴:

- repo plugin: `$REPO_ROOT/plugins/<plugin-name>`
- personal plugin: `~/.codex/plugins/<plugin-name>`

중요 포인트:

- `source.path`는 marketplace root 기준 상대경로다.
- plugin directory는 marketplace entry가 가리키는 위치일 뿐, 고정된 유일 경로는 아니다.
- 플러그인 on/off 상태는 `~/.codex/config.toml`에 저장된다.

## 4. Skills 와 Custom Prompts

Codex 공식 문서는 skills를 reusable workflow의 표준 형식으로 본다.

skill 구조:

```text
my-skill/
├── SKILL.md
├── scripts/
├── references/
├── assets/
└── agents/
    └── openai.yaml
```

핵심 사항:

- `SKILL.md`에는 `name`, `description`이 필수다.
- `agents/openai.yaml`은 선택이며, UI metadata, invocation policy, dependency 정보를 담는다.
- Codex는 skill metadata만 먼저 보고, 실제 필요할 때만 `SKILL.md` 전체를 로드한다.
- CLI/IDE에서는 `$skill-name` 또는 `/skills`로 명시 호출할 수 있다.

반면 `custom prompts`는 공식적으로 deprecated다. slash command 기반 재사용 프롬프트는 남아 있지만, 새 자산은 skills로 가는 것이 문서 방향과 맞다.

## 5. Native subagents 와 config 레이어

Codex의 진짜 다중 에이전트 정의는 plugin spec이 아니라 `.codex/agents/*.toml` 또는 `~/.codex/agents/*.toml`의 standalone TOML agent file이다.

공식 subagents docs 기준:

- 기본 built-in agents: `default`, `worker`, `explorer`
- custom agent file 필수 키:
  - `name`
  - `description`
  - `developer_instructions`
- 선택 키:
  - `nickname_candidates`
  - `model`
  - `model_reasoning_effort`
  - `sandbox_mode`
  - `mcp_servers`
  - `skills.config`

전역 제어는 `config.toml`의 `[agents]`에 둔다.

- `agents.max_threads`
- `agents.max_depth`
- `agents.job_max_runtime_seconds`

즉 Codex는 "plugin으로 skills를 배포"하고, "native TOML로 subagent role을 정의"하는 이중 구조다.

## 6. Hooks 활성화와 설정

Codex hooks는 2026-04-21 기준 공식적으로 Experimental이다.

활성화 조건:

```toml
[features]
codex_hooks = true
```

공식 docs가 명시하는 주요 사항:

- hooks는 active development 중이다.
- Windows support는 임시 비활성화 상태다.
- hook 파일은 `~/.codex/hooks.json`과 `<repo>/.codex/hooks.json`이 대표 경로다.
- 여러 `hooks.json`이 있으면 모두 로드되고 병합된다.
- higher-precedence config layer가 lower-precedence hook을 덮어쓰지 않는다.

## 7. Native tool surface

Codex는 공식 docs가 문서화한 툴과, 실제 CLI runtime이 노출하는 툴 surface 사이에 간극이 있다. nexus-core 관점에서는 아래 범주를 기준으로 보는 것이 실용적이다.

### 7-1. Shell / 실행

- `shell`
- `shell_command`
- `exec_command`
- `write_stdin`

실무 메모:

- Codex는 shell surface가 매우 강하다.
- hook 기준 `PreToolUse` / `PostToolUse`는 현재 사실상 Bash 계열 shell 호출만 안정적으로 잡는다.

### 7-2. 파일 / 디렉토리

- `apply_patch`
- `list_dir`
- `view_image`

중요 포인트:

- Codex는 Claude Code처럼 `Read` / `Edit` / `Write`가 분리된 하네스가 아니다.
- 파일 편집의 중심은 `apply_patch`다.
- 파일 읽기와 검색은 shell 기반(`cat`, `sed`, `rg` 등)으로 우회하는 경우가 많다.

### 7-3. 웹 / 발견

- `web_search`
- `tool_search`
- `tool_suggest`

공식 config reference는 `web_search` 모드를 `disabled | cached | live`로 제어할 수 있다고 문서화한다.

### 7-4. 플랜 / 사용자 상호작용

- `update_plan`
- `request_user_input`
- `request_permissions`

이 범주는 Claude Code의 `TodoWrite`/`AskUserQuestion`와 비슷한 역할을 한다.

### 7-5. 서브에이전트 lifecycle

- `spawn_agent`
- `send_input`
- `resume_agent`
- `wait_agent`
- `close_agent`

추가로 환경과 버전에 따라:

- `followup_task`
- `spawn_agents_on_csv`
- 기타 orchestration helper

가 함께 보일 수 있다.

Codex는 세 하네스 중 agent lifecycle surface가 가장 풍부한 편이다.

### 7-6. MCP / JS / 이미지

- `list_mcp_resources`
- `list_mcp_resource_templates`
- `read_mcp_resource`
- `js_repl`
- `image_generation`

즉 Codex는 파일 read/write abstraction은 상대적으로 얇지만, orchestration과 MCP resource 계층은 매우 두껍다.

## 8. 훅 이벤트와 matcher

공식 hooks docs가 표준으로 문서화하는 이벤트는 다음 5개다.

- `SessionStart`
- `PreToolUse`
- `PostToolUse`
- `UserPromptSubmit`
- `Stop`

matcher 동작:

| 이벤트 | matcher 기준 | 현재 제약 |
|---|---|---|
| `SessionStart` | `source` | `startup`, `resume` |
| `PreToolUse` | `tool_name` | 현재 `Bash`만 실질 emit |
| `PostToolUse` | `tool_name` | 현재 `Bash`만 실질 emit |
| `UserPromptSubmit` | 미지원 | matcher 무시 |
| `Stop` | 미지원 | matcher 무시 |

공식 문서가 명시적으로 "현재 `PreToolUse`와 `PostToolUse`는 `Bash`만 emit"한다고 적고 있으므로, Codex hooks는 현재 파일 편집/웹/MCP 제어의 범용 interception layer로 쓰기 어렵다.

## 9. 공통 입력/출력과 JSON 형태

모든 command hook은 `stdin`으로 JSON object를 받는다.

공통 입력 필드:

- `session_id`
- `transcript_path`
- `cwd`
- `hook_event_name`
- `model`

공통 출력 필드:

- `continue`
- `stopReason`
- `systemMessage`
- `suppressOutput`

공식 문서가 밝히는 제약:

- `suppressOutput`은 파싱되지만 아직 구현되지 않았다.
- `PreToolUse`는 `systemMessage`만 안정 지원하고 `continue`, `stopReason`, `suppressOutput`은 아직 미지원이다.
- `PostToolUse`는 `systemMessage`, `continue: false`, `stopReason`을 지원한다.

## 10. 이벤트별 의미론

### 10-1. SessionStart / UserPromptSubmit / Stop

- `SessionStart`는 `stdout` plain text 또는 `additionalContext`를 extra developer context로 추가할 수 있다.
- `UserPromptSubmit`는 프롬프트 처리 직전 컨텍스트 주입과 차단에 쓸 수 있다.
- `Stop`은 턴 종료 직후 정책 점검용으로 쓸 수 있다.

### 10-2. PreToolUse / PostToolUse

공식 docs 기준 핵심 동작:

- `PreToolUse`: 현재 Bash command만 가로챈다.
- `permissionDecision: "deny"` 또는 구형 `decision: "block"`로 차단 가능하다.
- `updatedInput`, `additionalContext`, `permissionDecision: "allow" | "ask"` 등은 현재 파싱되지만 fail-open 상태다.
- `PostToolUse`: 이미 실행된 Bash 결과를 후처리한다.
- `decision: "block"`은 부작용을 되돌리지 못하고, 후속 모델 입력을 대체하는 성격이다.
- `continue: false`는 원래 tool result 처리를 중단시킬 수 있다.

즉 Codex hooks는 "강한 일반 인터셉터"가 아니라 "Bash 중심 guardrail"로 봐야 한다.

## 11. nexus-core 관점 정리

- Codex는 plugin layer, skill layer, native subagent layer가 분리되어 있다.
- 공통 자산 배포는 plugin/skill 쪽이 담당하고, 실제 역할 분리와 도구 권한은 TOML agent 쪽이 담당한다.
- multi-agent orchestration 역량은 세 하네스 중 가장 강하다.
- 반대로 hook 기반 파일 편집 인터셉션은 가장 약하다.
- 따라서 nexus-core는 Codex에서:
  - hooks를 보조 장치로 보고
  - TOML `sandbox_mode`, `mcp_servers.*.disabled_tools`, agent depth/thread 제한을 더 중요한 통제 지점으로 봐야 한다.

## 12. 진화 중이거나 미표준인 영역

다음은 기존 메모와 OSS runtime 조사에서 보였지만, 2026-04-21 기준 OpenAI 공식 문서의 안정 API로 보기 어려운 부분이다.

- 공식 hooks 문서 밖의 추가 event surface 추정
- `apply_patch`와 non-Bash tool까지 완전히 포괄하는 hook interception
- runtime에 존재하는 세부 tool name 전체를 공식 docs가 단일 목록으로 고정해 주는 것

정리하면, Codex는 공식 문서보다 실제 런타임 surface가 더 넓지만, portable한 설계 기준점은 여전히 공식 docs에 잡는 편이 안전하다.
