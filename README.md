# @moreih29/nexus-core

Claude Code · Codex · OpenCode 하네스 위에서 멀티 에이전트 오케스트레이션을 돌리기 위한 canonical 스펙과 도구.

## 무엇인가

`nexus-core`는 "Lead가 역할별 서브에이전트를 조합해 plan → run 사이클을 돌리는" 에이전트 오케스트레이션 모델을 세 하네스(Claude Code, Codex, OpenCode)에서 동일하게 구현하도록 뒷받침한다. 핵심은 세 축이다.

1. **Canonical 스펙** — 10개 에이전트와 3개 스킬의 하네스 중립 정의
2. **Sync 파이프라인** (`nexus-sync`) — 스펙을 각 하네스 네이티브 포맷으로 렌더링
3. **MCP 서버** (`nexus-mcp`) — 플래닝·태스크·이력·아티팩트 상태 관리 도구 노출

제공하지 않는 것 — 훅 런타임, 메인 세션 와이어링, 플러그인 설치 스크립트, 하네스 부트스트랩. 이들은 컨슈머(각 하네스용 플러그인·저장소)가 `nexus-core` 산출물을 받아 자체 구현한다.

## 설치

```bash
npm install @moreih29/nexus-core
# 또는
bun add @moreih29/nexus-core
```

패키지는 다음을 번들한다.

```
node_modules/@moreih29/nexus-core/
├── spec/            # canonical 에이전트·스킬 정의
├── vocabulary/      # 도구 호출식 스키마
├── harness/         # 하네스별 invocations + layout
└── dist/            # 빌드 산출물 (MCP 서버, sync CLI)
```

바이너리: `nexus-sync`, `nexus-mcp`. 프로그램적 API: `@moreih29/nexus-core/generate`, `@moreih29/nexus-core/mcp`.

## 하네스 컨슈머가 해야 할 세 가지

### 1. 에이전트·스킬 아티팩트 생성

```bash
nexus-sync --harness=claude --target=./out/claude
nexus-sync --harness=codex --target=./out/codex
nexus-sync --harness=opencode --target=./out/opencode
```

`--target` 아래 하네스 레이아웃대로 파일이 생성된다.

| 하네스 | 에이전트 출력 | 스킬 출력 |
|---|---|---|
| `claude` | `agents/{id}.md` | `skills/{id}/SKILL.md` |
| `codex` | `.codex/agents/{id}.toml` | `.codex/skills/{id}/SKILL.md` |
| `opencode` | `src/agents/{id}.ts` | `skills/{id}/SKILL.md` |

생성된 lead를 메인 세션에 어떻게 연결할지는 하네스마다 다르며 컨슈머의 몫이다. 상세는 [docs/agent-skill-sync.md](docs/agent-skill-sync.md).

### 2. MCP 서버 등록

하네스의 MCP 설정에 `nexus-mcp` 명령을 등록한다. 전송 방식은 stdio, 서버 이름은 `nexus-core`.

| 도구 그룹 | 용도 |
|---|---|
| `nx_plan_*` | 플래닝 세션 수명주기 |
| `nx_task_*` | 태스크 수명주기 |
| `nx_history_search` | 과거 사이클 조회 |
| `nx_artifact_write` | 아티팩트 쓰기 |

MCP 서버는 컨슈머 프로젝트 루트 기준 `.nexus/state/`와 `.nexus/history.json`만 읽고 쓴다. 상세는 [docs/mcp-server-tools.md](docs/mcp-server-tools.md).

### 3. 훅 와이어링

Nexus 런타임이 기대하는 세 가지 역할을 각 하네스에서 와이어링한다.

1. 세션 진입 시 `.nexus/` 폴더 구조와 `.gitignore` 화이트리스트 보장
2. 사용자 프롬프트에서 Nexus 태그(`[plan]`·`[auto-plan]`·`[run]`·`[m]`·`[m:gc]`) 감지해 스킬/지시 활성화
3. (선택) Nexus 규칙 위반 Bash 명령 차단

하네스별 권장 훅과 이벤트 매핑은 [docs/harness-hooks.md](docs/harness-hooks.md).

## 에이전트 모델

세 카테고리로 역할이 분리된다.

| 카테고리 | 역할 | 에이전트 |
|---|---|---|
| HOW | 기술 설계·분석·전략 자문 | architect, designer, postdoc, strategist |
| DO | 실행 | engineer, writer, researcher |
| CHECK | 검증 | reviewer, tester |

`lead`는 메인 세션에서 사용자와 대화하고, 서브에이전트를 조합하며, plan/task 수명주기를 주도한다. 재개가 필요한 시점에 스폰 때 받은 `agent_id`를 `nx_plan_analysis_add` / `nx_task_update`에 기록해두고, 나중에 `nx_plan_resume` / `nx_task_resume`로 되찾아 `{{subagent_resume}}`로 재개한다.

## 스킬과 태그

| 태그 | 스킬/동작 | 목적 |
|---|---|---|
| `[plan]` | nx-plan | 사용자 결정 중심의 구조적 분석 |
| `[auto-plan]` | nx-auto-plan | Lead 자율 결정 |
| `[run]` | nx-run | 태스크 실행 오케스트레이션 |
| `[d]` | 결정 기록 | 활성 plan 세션의 현재 안건에 `nx_plan_decide` |
| `[m]` | memory 저장 | `.nexus/memory/`에 누적 |
| `[m:gc]` | memory 정리 | `.nexus/memory/` 병합·제거 |

## 도구 호출식

스펙 본문에서 이중 중괄호 표기로 호출하는 도구. sync 시점에 각 하네스 네이티브 문법으로 확장된다.

| 호출식 | 용도 |
|---|---|
| `{{subagent_spawn}}` | 서브에이전트 스폰 |
| `{{subagent_resume}}` | 기존 서브에이전트 재개 |
| `{{skill_activation}}` | 스킬 활성화 |
| `{{task_register}}` | 태스크 진행 추적 등록 |
| `{{user_question}}` | 사용자에게 선택지 질문 |

스키마는 `vocabulary/invocations.yml`, 하네스별 확장 템플릿은 `harness/<name>/invocations.yml`에 있다.

## 파일 레이아웃 (컨슈머 프로젝트 기준)

```
.nexus/
├── .gitignore       # 화이트리스트 — context, memory, history만 추적
├── context/         # 설계 원칙·아키텍처
├── memory/          # empirical-·external-·pattern- prefix 교훈
├── state/
│   ├── plan.json    # 현재 plan 세션
│   ├── tasks.json   # 현재 태스크 목록
│   └── artifacts/   # 사이클 산출물
└── history.json     # 종료된 사이클 아카이브
```

- `state/*`·`history.json` — MCP 도구만 편집
- `context/`·`memory/` — Lead가 사용자 태그로 관리

## 관련 문서

- [에이전트·스킬 명세 동기화](docs/agent-skill-sync.md)
- [MCP 서버 도구](docs/mcp-server-tools.md)
- [하네스 훅 권장](docs/harness-hooks.md)

## 라이선스

MIT
