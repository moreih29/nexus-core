# neutral-principles — nexus-core 중립 원칙 규칙

이 파일은 nexus-core 레포에 변경을 가할 때 반드시 준수해야 할 **enforceable 규칙**을 정의한다.
각 규칙의 철학적 근거는 `.nexus/context/boundaries.md`를 참조하라. 이 파일은 "어떤 패턴을 허용하지 않는가"라는 기계적 판단에 집중한다.

**사용 맥락**: Nexus `[rule]` 슬롯. gate나 Lead가 변경 제안을 평가할 때 이 파일의 6개 규칙을 점검한다. 위반 발견 시 즉시 작업 중단 + 사용자 확인 요청.

---

### rule:no-acp — ACP vocabulary 편입 금지

**금지 대상**: `vocabulary/tags.yml`, `vocabulary/capabilities.yml` 등 `vocabulary/*.yml` 파일에 ACP(Agent Client Protocol) 관련 항목 추가. `schema/*.json`에 ACP 관련 타입·정의 추가.

**위반 예시**:
- `vocabulary/tags.yml`에 `id: acp` 또는 `trigger: "[acp]"` 항목 추가
- `vocabulary/capabilities.yml`에 ACP tool 매핑 항목 추가
- `schema/agent.schema.json`에 `"acp_agent"` 타입 정의 추가
- `schema/` 하위에 `acp-*.schema.json` 파일 신규 생성

**예외**: 없음.

**위반 시 동작**: Lead는 즉시 작업을 중단하고 사용자에게 확인을 요청한다.

근거: `.nexus/context/boundaries.md` 참조.

---

### rule:no-runtime — runtime 코드 포함 금지

**금지 대상**: 레포 전체에 runtime 코드 포함 금지. 아래 파일명 패턴이 하나라도 매칭되면 위반이다.

- Hook 구현 파일: `gate.cjs`, `gate.ts`, `gate.js`, `pre-commit`, `post-commit`, `session-start.js` (파일명 일치)
- MCP server 구현: `mcp-server.ts`, `mcp-server.js`, `server.ts` (MCP 서버 역할인 경우)
- Tool 구현 코드: `tool-*.ts`, `tool-*.js`, `plugin-tool.js` (glob 패턴)
- TypeScript 타입 정의: `*.d.ts`, `types/*.ts` (glob 패턴)
- 런타임 I/O 로직: 파일 read/write, 네트워크 요청 등을 수행하는 실행 코드가 포함된 `.ts` / `.js` / `.cjs` / `.mjs` 파일 (`scripts/` 디렉토리 제외)

**위반 예시**:
- `src/hook.ts` 추가
- `mcp/server.js` 추가
- `lib/gate.cjs` 추가
- `types/agent.d.ts` 추가
- `src/runner.mjs` (런타임 I/O 수행) 추가

**예외**: `scripts/` 디렉토리의 build-time 유틸리티 스크립트 (예: `scripts/import-from-claude-nexus.mjs`). 소비자가 런타임에 직접 실행하지 않는 파일에 한한다.

**위반 시 동작**: Lead는 즉시 작업을 중단하고 사용자에게 확인을 요청한다.

근거: `.nexus/context/boundaries.md` 참조.

---

### rule:no-concrete-model — 구체 model 이름 포함 금지

**금지 대상**: `agents/**/meta.yml` 파일 내 `model` 필드 자체. `model` 키가 존재하거나 그 값이 아래 패턴 중 하나에 해당하면 위반이다.

금지 값 패턴 (대소문자 무관):
- `opus`, `sonnet`, `haiku` (부분 문자열 포함 시도 포함: `sonnet-4`, `claude-opus-3`)
- `claude-*` (프리픽스 패턴)
- `gpt-*`, `gpt4`, `gpt5`
- `gemini-*`
- `o1-*`, `o3-*`
- `openai/*`, `anthropic/*`, `google/*` (벤더 경로 형식)
- 그 외 어떤 벤더 제공 구체 모델 식별자

**허용**: `model_tier` 필드에 `high` 또는 `standard` 값만.

**위반 예시**:
- `model: opus`
- `model: sonnet-4`
- `model: openai/gpt-5`
- `model: anthropic/claude-3-5-sonnet`
- `model: claude-opus-4`

**예외**: 없음.

**위반 시 동작**: Lead는 즉시 작업을 중단하고 사용자에게 확인을 요청한다.

근거: `.nexus/context/boundaries.md` 참조.

---

### rule:no-harness-tool — harness-specific 도구 이름 포함 금지

**금지 대상**: `agents/**/body.md` 및 `agents/**/meta.yml`, `skills/**/body.md` 및 `skills/**/meta.yml` 내에 하네스별 고유 tool 이름 직접 참조 금지. 주석 포함.

금지 패턴 — Claude Code 고유:
`mcp__plugin_*`, `Bash`, `Edit`, `Write`, `Read`, `Glob`, `Grep`, `NotebookEdit`, `TodoWrite`, `WebFetch`, `WebSearch`, `Task`, `BashOutput`, `KillShell`

금지 패턴 — OpenCode 고유:
`bash`, `edit`, `write`, `patch`, `multiedit`, `read`, `glob`, `grep`, `list`, `webfetch`

**허용**: capability abstraction 문자열만. 예: `no_file_edit`, `no_task_create`, `no_task_update`, `no_shell_exec`. 이 문자열은 `vocabulary/capabilities.yml`에 정의되고 각 하네스가 자기 tool namespace로 resolve한다.

**위반 예시**:
- `body.md`에 "Use the Edit tool to modify files" 서술
- `body.md`에 "<!-- Use Bash to run commands -->" 주석
- `meta.yml`에 `disallowedTools: [Bash, Edit]` 필드
- `meta.yml`에 `tools: [mcp__plugin_claude-nexus_nx__nx_task_add]` 필드

**예외**: 없음. 참고용 주석으로도 harness tool 이름을 쓰지 않는다.

**위반 시 동작**: Lead는 즉시 작업을 중단하고 사용자에게 확인을 요청한다.

근거: `.nexus/context/boundaries.md` 참조.

---

### rule:no-ui-hint — UI 시각 속성 필드 추가 금지

**금지 대상**: `agents/**/meta.yml` 및 `skills/**/meta.yml`에 UI 시각 속성 필드 추가 금지. 아래 필드명이 파일에 등장하면 위반이다.

금지 필드명 (키 이름 일치):
`icon`, `color`, `bg_color`, `sort_order`, `display_order`, `badge`, `emoji`, `avatar`, `theme`, `style`, `priority_display`, `ui_hint`

**허용**: `id`, `name`, `category`, `description` 등 neutral 식별 필드. 소비자가 이 필드로 자체 UI 스타일을 결정한다.

**위반 예시**:
- `icon: "🏗️"`
- `color: "#ff0000"`
- `sort_order: 1`
- `badge: "HOW"`
- `emoji: "🔍"`

**예외**: 없음.

**위반 시 동작**: Lead는 즉시 작업을 중단하고 사용자에게 확인을 요청한다.

근거: `.nexus/context/boundaries.md` 참조.

---

### rule:no-supervision-logic — Supervision 집행 로직 포함 금지

**금지 대상**: 레포 전체에 Supervision 집행 로직의 스키마·정의·인터페이스 포함 금지. 아래 개념·식별자가 파일에 등장하면 위반이다.

금지 개념 및 식별자:
- `ApprovalBridge` (인터페이스·타입·스키마·참조 불문)
- `ProcessSupervisor` (동일)
- `AgentHost` (동일)
- 세션 spawn/observe/approve/reject/dispose 의미론 (이 동사를 에이전트 생명주기 관리 맥락에서 사용)
- Policy Enforcement Point 로직 또는 권한 중재 스키마
- 세션 스트림 파싱(`stream-json`) 정의

금지 위치: `schema/*.json`, `agents/**/*`, `skills/**/*`, `vocabulary/*.yml`, 레포 최상위 문서 (`README.md`, `CHANGELOG.md` 등).

**위반 예시**:
- `schema/agent-host.schema.json` 신규 생성
- `vocabulary/capabilities.yml`에 `approval_policies` 항목 추가
- `agents/engineer/body.md`에 "ApprovalBridge를 통해 권한 요청" 서술
- `schema/supervision.schema.json`에 `ProcessSupervisor` 인터페이스 정의
- `vocabulary/tags.yml`에 `approve`, `reject` 태그 정의

**예외**: 없음. nexus-core는 Supervision 의미론과 완전 분리된다.

**위반 시 동작**: Lead는 즉시 작업을 중단하고 사용자에게 확인을 요청한다.

근거: `.nexus/context/boundaries.md` 참조.

---

### rule:harness-state-namespace — 하네스 고유 state는 namespace 디렉토리에 격리

**금지 대상**:

1. 하네스가 `.nexus/state/` 루트에 신규 파일을 생성하는 행위
2. `{harness-id}/` namespace 하위에 공통 schema 파일명(`plan.json`, `tasks.json`, `history.json`, `runtime.json`, `agent-tracker.json`)을 재사용하는 행위
3. 다른 하네스의 namespace 디렉토리에 쓰거나 읽는 행위
4. 공통 state 파일(plan/tasks/history/runtime/agent-tracker)의 schema에 undeclared 필드를 추가하는 행위 (schema `additionalProperties: false` 위반)

**허용 패턴**:

- `.nexus/state/{harness-id}/{any-name}.json` — 하네스 독립 파일
- `.nexus/state/{harness-id}/{common-base}.extension.json` — 공통 파일의 확장

**Extension 파일 요건**:

- 파일명은 `{공통-base}.extension.json` 형식
- 최상위 `extends` 필드에 공통 schema 이름 명시
- 공통 레코드와 연결되는 join 필드 명시
- 하네스 repo에 자체 JSON Schema(draft 2020-12, `additionalProperties: false`) 정의
- 공통 필드 재선언 금지 — 확장 필드만

**위반 예시**:

- `.nexus/state/my-tracker.json` 생성 (루트에 신규 파일)
- `.nexus/state/claude-nexus/plan.json` (namespace 하위에 공통 이름 재사용)
- `opencode-nexus` 하네스가 `.nexus/state/claude-nexus/*` 읽기/쓰기
- `plan.json`의 `issues[]`에 `priority: "high"` 필드 직접 추가

**허용 예시**:

- `.nexus/state/claude-nexus/edit-tracker.json` ✓
- `.nexus/state/claude-nexus/plan.extension.json` ✓ (extends: plan.schema.json)
- `.nexus/state/opencode-nexus/permission-log.json` ✓

**예외**: v0.3.x 이하에 루트 경로로 등록된 legacy 2종(`edit-tracker.json`, `reopen-tracker.json`)은 `task_close` tool 계약에 명시되어 backward-compat으로 유지. 신규 파일은 이 예외에 편승하지 않는다.

**위반 시 동작**: Lead는 즉시 작업을 중단하고 사용자에게 확인을 요청한다.

근거: `.nexus/context/boundaries.md` (포함/제외 범위 원칙), `docs/nexus-outputs-contract.md §Harness-local State Extension` 참조.
