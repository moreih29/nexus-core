# 에이전트·스킬 명세 동기화

`@moreih29/nexus-core` 패키지는 표준 스펙(canonical spec)으로 정의된 에이전트·스킬을 각 하네스(Claude Code, Codex, OpenCode)의 네이티브 파일 포맷으로 렌더링하는 동기화 파이프라인을 제공한다. 컨슈머는 이 파이프라인을 `nexus-sync` 바이너리로 실행해 자기 프로젝트에 아티팩트를 생성한다.

- 실행 엔트리: `nexus-sync` (패키지 `bin`)
- 프로그램적 API: `@moreih29/nexus-core/generate`

## 설치

```bash
npm install @moreih29/nexus-core
# 또는
bun add @moreih29/nexus-core
```

패키지에는 동기화에 필요한 입력이 모두 번들되어 있다.

- `spec/agents/*`, `spec/skills/*` — 에이전트·스킬 표준 정의
- `vocabulary/invocations.yml` + `vocabulary/enums/*` — 매크로 사전
- `harness/<name>/invocations.yml`, `harness/<name>/layout.yml` — 하네스별 호출 템플릿과 레이아웃

컨슈머가 별도로 스펙을 준비할 필요는 없다.

## 동기화가 하는 일

`nexus-sync`는 다음 순서로 동작한다.

1. 번들된 스펙 문서를 로드
2. `{{...}}` 매크로를 하네스 네이티브 호출 문법으로 확장
3. 각 에이전트·스킬을 하네스 출력 포맷으로 렌더링
4. `--target`으로 지정된 루트 아래 하네스 레이아웃에 맞춰 파일 기록

## CLI 사용법

```bash
nexus-sync --harness=claude --target=./out/claude
nexus-sync --harness=codex --target=./out/codex
nexus-sync --harness=opencode --target=./out/opencode
nexus-sync --harness=codex --target=./out/codex --dry-run
```

지원 플래그:

| 플래그 | 의미 |
|---|---|
| `--harness=claude\|codex\|opencode` | 타깃 하네스 선택 |
| `--target=<dir>` | 출력 루트 디렉터리 |
| `--dry-run` | 기록할 경로만 출력하고 파일은 쓰지 않음 |

`--target`은 출력 루트일 뿐이며, 실제 파일 배치는 하네스 레이아웃 정의를 따른다. 컨슈머는 자기 프로젝트에서 해당 아티팩트가 놓일 위치(예: 저장소 루트, 하위 디렉터리)에 맞춰 `--target`만 정해주면 된다.

## 하네스별 출력 경로

`--target`을 `T`라 할 때의 상대 경로.

| 하네스 | 에이전트 | 스킬 |
|---|---|---|
| `claude` | `T/agents/{id}.md` | `T/skills/{id}/SKILL.md` |
| `codex` | `T/.codex/agents/{id}.toml` | `T/.codex/skills/{id}/SKILL.md` |
| `opencode` | `T/src/agents/{id}.ts` | `T/skills/{id}/SKILL.md` |

`{id}`는 스펙 정의의 에이전트·스킬 ID이다.

이 표는 어디까지나 `nexus-sync`가 쓰는 **출력 레이아웃**이다. 실제로 각 하네스가 어떤 파일을 네이티브하게 읽는지, 그리고 `lead`를 메인 세션에 어떻게 연결하는지는 아래 하네스별 섹션을 따른다.

## 패키지가 제공하는 것

아티팩트 수준에서 `nexus-core`는 다음을 제공한다.

- 하네스별 에이전트 파일
- 하네스별 스킬 파일
- 에이전트 제약(툴 제한 등)의 하네스별 물질화
- 원시 매크로의 하네스 네이티브 치환
  - 스킬 활성화
  - 서브에이전트 스폰
  - 일시 태스크 등록
  - 구조화된 사용자 질문

## 하네스별 통합

### Claude Code

`nexus-sync --harness=claude --target=T`는 `T/agents/{id}.md`와 `T/skills/{id}/SKILL.md`를 생성한다. 이 레이아웃은 Claude Code의 **플러그인 루트** 구조와 맞물린다. 공식 문서 기준으로 Claude는 프로젝트 `.claude/agents/`, 사용자 `~/.claude/agents/`, 그리고 플러그인의 `agents/` 디렉터리에서 subagent를 읽고, 플러그인 루트의 `settings.json`을 기본 설정으로 적용할 수 있다.

따라서 Claude 하네스에서는 `T`를 플러그인 루트로 두는 것이 자연스럽다.

- `T/agents/lead.md`는 Claude plugin agent로 그대로 쓸 수 있다.
- `T/skills/{id}/SKILL.md`는 Claude plugin skill 구조와 일치한다.
- `lead`를 **메인 세션 기본 agent**로 쓰려면, 컨슈머가 `T/settings.json`을 직접 추가해 `"agent": "lead"`를 설정하면 된다.

예시:

```json
{
  "agent": "lead"
}
```

Claude 공식 settings 문서는 `agent` 설정이 "main thread를 named subagent로 실행"한다고 설명한다. 즉, `agents/lead.md`가 존재하고 `settings.json`에 위 값을 두면, Claude Code는 플러그인이 활성화된 세션에서 main thread를 `lead` prompt로 시작한다.

플러그인을 쓰지 않고 프로젝트 로컬 설정으로만 운영한다면, 같은 개념으로 `lead.md`를 `.claude/agents/lead.md`에 두고 `.claude/settings.json` 또는 `~/.claude/settings.json`에서 `"agent": "lead"`를 설정하면 된다. 다만 현재 `claude` harness 출력은 standalone `.claude/` 레이아웃이 아니라 plugin-root 레이아웃을 전제로 한다.

Claude에서 종료된 subagent를 같은 `agent_id`로 다시 resume하는 경로는 `SendMessage` 기반이다. 이 기능은 Claude Code의 experimental agent teams tool surface에 묶여 있으므로, Claude consumer가 subagent resume을 지원하려면 먼저 아래 설정으로 기능을 켜야 한다.

```json
{
  "env": {
    "CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS": "1"
  }
}
```

이 설정은 plugin root의 `settings.json`, 프로젝트 `.claude/settings.json`, 또는 사용자 `~/.claude/settings.json`에 둘 수 있다. 실제 resume wiring 자체는 컨슈머가 맡되, 전제 조건은 이 환경 변수가 활성화된 세션이어야 한다.

### Codex

`nexus-sync --harness=codex --target=T`는 `T/.codex/agents/{id}.toml`과 `T/.codex/skills/{id}/SKILL.md`를 생성한다. Codex에서 `lead`를 메인 세션에 적용하는 경로는 `lead.instructions.md`와 `model_instructions_file`이다.

Codex 공식 문서 기준으로 메인 세션 instruction surface는 `AGENTS.md`와 `model_instructions_file`이다.

- `model_instructions_file`은 built-in instructions를 대체한다.
- `instructions` 설정 키는 미래용 예약 필드이므로 쓰지 말고, `model_instructions_file`을 사용한다.

예시:

```toml
model_instructions_file = "/absolute/path/to/lead.instructions.md"
```

중요한 점은 `lead.toml` 자체를 `model_instructions_file`에 바로 넘기는 방식이 아니라는 것이다. Codex 공식 문서에서 `model_instructions_file`은 built-in instructions를 대체하는 **메인 세션용 instruction 파일**이다.

Codex 하네스에서는 아래 방식으로만 운영한다.

1. `lead.instructions.md`를 만든다.
2. 이 파일에 `lead`의 instruction 본문을 넣는다.
3. `~/.codex/config.toml`의 `model_instructions_file`이 이 파일을 가리키게 한다.

즉, 메인 세션 wiring은 항상 `model_instructions_file -> lead.instructions.md`다.

예를 들면:

```md
# lead.instructions.md

<lead의 instruction 본문만 복사>
```

그리고:

```toml
model_instructions_file = "/absolute/path/to/lead.instructions.md"
```

또 하나의 차이는 skills다. Codex 공식 skills 문서는 native skill discovery 경로로 `.agents/skills/`, `$HOME/.agents/skills/`, `/etc/codex/skills`를 설명한다. 따라서 `T/.codex/skills/{id}/SKILL.md`는 `nexus-sync`의 render output일 뿐, 그 자체가 Codex 문서상 native discovery path는 아니다. Codex가 skill을 자동 발견하게 하려면, 컨슈머가 이 폴더를 `.agents/skills/{id}/SKILL.md` 같은 공식 경로로 복사·symlink하거나 plugin packaging 단계에서 재배치해야 한다.

### OpenCode

`nexus-sync --harness=opencode --target=T`는 `T/src/agents/{id}.ts`와 `T/skills/{id}/SKILL.md`를 생성한다. 여기서 핵심은 이 산출물이 OpenCode의 **native on-disk config 포맷**과는 다르다는 점이다.

OpenCode 공식 문서 기준으로:

- agent는 `opencode.json`의 `agent` 항목으로 설정하거나, `opencode agent create`로 생성하는 Markdown agent 파일로 관리할 수 있다.
- agent의 `mode`는 `primary`, `subagent`, `all` 중 하나다.
- primary agent는 `Tab`으로 전환 가능하다.
- skill discovery는 `.opencode/skills/`, `.claude/skills/`, `.agents/skills/` 및 그 전역 경로를 사용한다.

반면 `nexus-sync`의 `opencode` harness는 agent를 Markdown이 아니라 TypeScript module로 렌더링한다. 즉 `src/agents/lead.ts`는 OpenCode가 곧바로 읽는 설정 파일이 아니라, 컨슈머가 자기 bootstrap에서 소비해야 하는 **generated config layer**다.

현재 renderer는 `lead`에 대해 자동으로 `mode: "primary"`를 넣는다. 따라서 OpenCode에서 `lead`를 메인 세션 후보로 쓰려면, 컨슈머가 `src/agents/lead.ts`의 내용을 자기 OpenCode 설정 계층으로 연결해 주면 된다.

가능한 방식은 두 가지다.

1. `src/agents/lead.ts`의 필드(`description`, `model`, `permission`, `mode`, `system`)를 읽어 `opencode.json`의 `agent.lead` 설정으로 옮긴다.
2. 또는 컨슈머가 자기 빌드 단계에서 generated agent module을 native OpenCode agent file 또는 별도 설정 산출물로 변환한다.

첫 번째 방식의 형태는 대략 아래와 같다.

```json
{
  "$schema": "https://opencode.ai/config.json",
  "agent": {
    "lead": {
      "mode": "primary",
      "description": "..."
    }
  }
}
```

실제 값은 생성된 `src/agents/lead.ts`에서 가져와야 한다. `nexus-sync`는 현재 `opencode.json`이나 plugin bootstrap 자체를 생성하지 않으므로, 이 wiring은 컨슈머가 맡는다.

skills도 같은 맥락이다. OpenCode의 native discovery path는 `.opencode/skills/` 등인데, `nexus-sync` 출력은 `T/skills/{id}/SKILL.md`다. 따라서 OpenCode가 skill을 자동 발견하게 하려면, 컨슈머가 이 폴더를 `.opencode/skills/{id}/SKILL.md` 같은 공식 경로로 복사·symlink하거나 npm package/postinstall 단계에서 재배치해야 한다.

## 범위 밖

다음은 `nexus-sync`가 다루지 않는다. 컨슈머 통합의 몫이다.

- 하네스 설치 스크립트
- 컨슈머 hook runtime wiring 및 hook manifest/config
- 플러그인 매니페스트, 마켓플레이스 메타데이터
- Claude primary-agent 설정 파일
- Codex `model_instructions_file` 와이어링
- OpenCode 런타임 부트스트랩·플러그인 엔트리

관련 문서:

- MCP 서버 도구: [mcp-server-tools.md](./mcp-server-tools.md)
- 컨슈머 hook 가이드: [harness-hook-guidance.md](./harness-hook-guidance.md)
