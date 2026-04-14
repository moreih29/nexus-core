> 이 문서는 plan session #1(2026-04-10) 기반으로 시작, plan session #2(2026-04-11)의 구현 결정이 추가 반영되어 있다, plan session #3(2026-04-12)의 v0.2.0 harness-agnostic 재설계 결정이 추가 반영되어 있다, plan session #4(2026-04-13)의 conformance full-coverage 결정이 추가 반영되어 있다. 8 issues 결정 세부는 `.nexus/history.json` 참조. 원본 논의: `.nexus/memory/` 참조.

# 경계와 vocabulary

nexus-core가 무엇을 포함하고 무엇을 거절하는지, 그리고 그 이유를 정의한다. 이 문서는 ecosystem.md(생태계 구조와 용어)와 evolution.md(Forward-only 완화 정책과 Phase 전환)에서 다루지 않는 범위와 vocabulary를 담는다.

---

## 포함 범위

nexus-core에 들어가는 것은 다음 경로다.

**에이전트 자산**

- `agents/{id}/body.md` — 에이전트 프롬프트 본문. claude-nexus에서 추출 시 MCP tool 참조를 `nx_X` 추상 형태로 정규화한다.
- `agents/{id}/meta.yml` — 에이전트 neutral metadata. 포함 필드 9개: `id`, `name`, `alias_ko`, `description`, `task`, `category`, `capabilities`, `resume_tier`, `model_tier`. (`tags` 필드 제외 — 두 sibling 모두 실제로 사용하지 않음. Minimal MVP.)

**스킬 자산**

- `skills/{id}/body.md` — 스킬 프롬프트 본문.
- `skills/{id}/meta.yml` — 스킬 neutral metadata. 포함 필드: `id`, `name`, `description`, `summary` (v0.2.0 추가, optional 10-120자 one-liner), `triggers`, `alias_ko`, `manual_only`, `harness_docs_refs` (v0.2.0 추가, optional string[]). (`triggers`는 `tags.yml`의 `type=skill` tag id 배열 참조. `manual_only`는 boolean, default false — Claude Code의 disable-model-invocation 수용.)

**vocabulary**

- `vocabulary/capabilities.yml` — 추상 capability 정의와 하네스별 concrete tool 매핑.
- `vocabulary/categories.yml` — HOW/DO/CHECK 카테고리 정의.
- `vocabulary/resume-tiers.yml` — persistent/bounded/ephemeral 티어 정의.
- `vocabulary/tags.yml` — skill 태그와 inline 액션 태그의 canonical 정의 (Issue #4 신규).

**루트 메타**

- `manifest.json` — validate.ts가 post-validation artifact로 생성하는 단일 루트 파일. nexus_core_version, agent/skill 목록, vocabulary 참조 등 소비자용 런타임 인덱스.

**검증 스키마**

- `schema/common.schema.json` — 공통 $defs (id 패턴 `^[a-z][a-z0-9-]*$`, harness enum 등). 나머지 schema 파일이 `$ref`로 참조한다.
- `schema/agent.schema.json` — 에이전트 meta.yml 검증.
- `schema/skill.schema.json` — 스킬 meta.yml 검증.
- `schema/vocabulary.schema.json` — vocabulary 4종 파일 검증. tag polymorphic 포함.
- `schema/manifest.schema.json` — manifest.json 구조 검증.

모든 schema 파일은 JSON Schema draft 2020-12 기준, `additionalProperties: false` strict 기본 적용.

**스크립트**

- `scripts/import-from-claude-nexus.ts` — claude-nexus에서 nexus-core로 변경을 동기화하는 단방향 추출 스크립트 (Bun 기반 TypeScript).
- `scripts/validate.ts` — 모든 asset의 schema 검증 및 manifest.json 생성.
- `scripts/lib/{validate,lint,structure,frontmatter}.ts` — 검증 로직 분리 라이브러리.
- `scripts/conformance-coverage.ts` — state-schema field × fixture.covers 교차 검증 + params anti-pattern 검출 validator. `validate:conformance` npm script로 실행. exit 0이 CI gate (v0.4.0 신설).

Runtime: Bun (최신 stable). sibling과 일관성. prompt-only 정체성과 무관 (scripts만 dev-only, files whitelist 제외).

**Conformance suite**

- `conformance/state-schemas/*.json` — state file JSON Schema (plan, tasks, history, agent-tracker). Cross-harness state 호환성 검증 근거. 4종 유지 (v0.6.0에서 runtime.schema.json 제거 — 소비 0건 확인 후 false contract 제거).
- `conformance/tools/*.json` — MCP tool behavioral conformance fixtures. 도구별 input→postcondition 선언적 assertion. 11/11 abstract tool 커버 완성 (v0.4.0).
- `conformance/scenarios/*.json` — lifecycle sequence conformance fixtures. 다단계 시나리오 검증.
- `conformance/lifecycle/*.json` — event-based fixture (agent lifecycle event). agent_spawn/agent_complete/agent_resume 3종 (v0.4.0 신설, v0.6.0에서 session_start/session_end 삭제 — runtime.schema.json 의존 fixture 정리).
- `conformance/lifecycle/README.md` — lifecycle fixture 설명 및 harness hook이 event를 재현하는 방식 가이드 (v0.4.0 신설).
- `conformance/schema/fixture.schema.json` — conformance fixture 포맷 자체의 JSON Schema. covers(required) + uncovered_params(optional) + event oneOf 분기 포함 (v0.4.0 확장). event.type enum v0.6.0에서 5종 → 3종으로 축소.
- `conformance/README.md` — fixture 형식 설명 및 consumer test runner 작성 가이드.

**문서**

- `docs/nexus-tools-contract.md` — 11 Nexus-core MCP tool semantic contract (harness-neutral).
- `docs/nexus-state-overview.md` — state file lifecycle, tool interaction 매핑.
- `docs/nexus-layout.md` — `.nexus/` canonical 디렉토리 구조.
- `docs/behavioral-contracts.md` — task/plan state machine, resume tier, permission model, manual_only, NL trigger boundary.
- `docs/nexus-outputs-contract.md` — 하네스 산출물 normative 계약. Tool-produced(plan/tasks/history)/Harness-produced(runtime/agent-tracker)/Agent-produced(artifacts/) 3 카테고리. 각 산출물의 책임 주체·생성·삭제 트리거·schema·interop 요건 선언 (v0.4.0 신설).

---

## 제외 범위

다음 항목들은 nexus-core에 들어가지 않는다. 근거는 bridge §9.2다.

- **hook 구현** — `gate.cjs` 등 하네스별 hook 로직
- **MCP server 구현** — `mcp-server.cjs` 등
- **OpenCode plugin tool 구현** — `nx_plan_start`, `nx_task_update` 등
- **TypeScript 타입 정의** — `NexusAgentProfile`, `NexusAgentCategory` 등 런타임 타입
- **런타임 I/O 로직** — 모든 런타임 파일 I/O 및 프로세스 로직

이것들을 포함하는 것은 두 하네스(Claude Code, OpenCode)가 안정화되기 전에 런타임 추상화 계층을 만드는 투기적 공학이다. 각 하네스의 런타임 구현은 하네스별 레포(claude-nexus, opencode-nexus)에 머문다.

---

## 5개 Issue 결정 요지

### Issue #1 — Authoring layer 정체성, 집행 semantics 없음

nexus-core는 Nexus 생태계의 Authoring layer다. 프롬프트 본문, neutral metadata, vocabulary 정의의 역할을 유지하며 집행 semantics를 포함하지 않는다. 이 정체성은 bridge §2.1의 "neutral vs runtime-specific 2계층 분리"를 생태계 전체 아키텍처 수준에서 확인한 것이다.

채택 근거: 프롬프트 본문과 neutral metadata는 플랫폼 독립적이다. capability abstraction layer가 하네스별 도구 이름 차이를 처리한다. 런타임 코드 공유 없이도 prompt drift 문제를 해결하기에 충분하다 (bridge §1.5 Option E).

### Issue #2 — 3 consumer single source of truth, ACP vocabulary 편입 거부

nexus-core는 세 소비자(opencode-nexus, claude-nexus, nexus-code)의 single source of truth다. 세 소비자 모두 read-only로 소비한다. ACP(Agent Client Protocol) vocabulary는 nexus-core에 편입하지 않는다.

nexus-code는 이번 세션에서 3번째 read-only consumer로 명시적으로 추가되었다. nexus-code가 Supervision UI를 구성할 때 필요한 neutral 데이터(에이전트 카탈로그, vocabulary)를 nexus-core에서 읽는다. ACP 편입 거부 근거는 §거절 근거 1 참조.

### Issue #3 — 독립 레포 유지 + Forward-only 완화

nexus-core는 독립 레포를 유지한다. monorepo나 하위 패키지로 합치지 않는다. 3층위(Authoring / Execution / Supervision)의 물리적 분리가 개념과 정합하며 각 레포는 자신의 버전, CI, 릴리스 주기를 독립적으로 가진다.

Forward-only schema 원칙은 완화한다. breaking change 발생 시 semver major bump + CHANGELOG.md에 "Consumer Action Required" 섹션 추가로 대응한다. 완화 상세 정책은 evolution.md 참조.

### Issue #4 — vocabulary/tags.yml 신규 추가

`vocabulary/tags.yml`을 신규 파일로 추가한다. 이 파일은 Nexus 태그 시스템 전체를 canonical하게 정의하는 단일 소스다. skill 태그([plan], [run], [sync])와 inline 액션 태그([d], [m], [m:gc], [rule], [rule:*])를 모두 이 파일에서 정의한다. 기존 vocabulary 파일 3종(capabilities.yml, categories.yml, resume-tiers.yml)과 동등한 위상을 갖는다.

두 하네스에서 태그 문법과 의미가 동일해야 한다. `[m]`의 의미, 트리거 패턴, 처리 방식이 하네스마다 다르면 사용자 경험이 일관되지 않는다. vocabulary/tags.yml이 이 공통 정의를 canonical하게 유지한다.

### Issue #5 — nexus-code의 Supervision 역할은 외부, nexus-core는 read-only neutral 데이터만 제공

nexus-code의 Supervision 역할(세션 spawn, 관찰, Policy Enforcement, ApprovalBridge)은 nexus-core의 관여 밖이다. nexus-core는 nexus-code에 read-only neutral 데이터만 제공한다. nexus-code가 그 데이터로 무엇을 하는지는 nexus-code 내부 결정이다.

nexus-core가 제공하는 것: 에이전트 카탈로그(id, name, alias_ko, category, description, resume_tier, capabilities), vocabulary 4종, 스킬 목록(skills/{id}/meta.yml). nexus-core는 이 데이터의 사용 방식에 관여하지 않는다.

capabilities 설계 주의: plan session #2 Issue #3에서 canonical postdoc의 capabilities 리스트에 no_shell_exec을 추가하지 않는 HOW symmetry 결정은 유효하다. 단, plan session #3 Issue #11에서 vocabulary/capabilities.yml에 no_shell_exec이 4번째 entry로 추가되었다 (vocabulary 존재 ≠ canonical agent 적용). 각 consumer harness가 자기 local capability map에서 opt-in 여부를 독립 결정한다 — nexus-core는 관여하지 않는다.

### plan session #4 결정 요지 (2026-04-13) — conformance full-coverage

**결정**: conformance suite의 state-schema field 100% coverage를 의무화한다.

3계층 방어 구조:
1. **covers required** — 모든 fixture가 `covers.state_schemas` 또는 `covers.return_value` 중 최소 하나를 non-empty로 선언해야 한다. fixture.schema.json에 required 필드로 명시.
2. **conformance-coverage.ts validator** — state-schema field 집합 × covers 합집합 교차 검증 + params anti-pattern 검출(params에 있으나 postcondition에서 assert되지 않고 uncovered_params에도 없는 key를 오류로 간주). `validate:conformance` script로 노출.
3. **CI gate** — validator exit 0이 릴리스 조건. fixture 추가·수정 시 coverage 보존 검증.

이 결정으로 conformance/tools/*.json 11/11 커버 완성, conformance/lifecycle/ 신설(5 event-based fixture), docs/nexus-outputs-contract.md 신설이 함께 실행되었다(v0.4.0).

---

## 6개 거절 근거

각 거절이 왜 필요한가를 서술한다. 구체 enforceable 규칙 패턴은 `.nexus/rules/neutral-principles.md` 참조.

### 거절 1 — ACP vocabulary 편입 금지

ACP(Agent Client Protocol)는 Zed가 주도하는 독립 오픈 표준이며 구독제 Nexus 생태계 밖에 위치한다. Primer §4.4에 따르면 Claude Code의 ACP 어댑터는 Agent SDK 기반으로 재구성되어 구독제 호환이 아니다.

ACP vocabulary를 nexus-core에 편입하면 nexus-core가 구독제 생태계 밖의 표준에 결합된다. nexus-core의 소비자 3종은 모두 Nexus 생태계 안에 존재한다. 그 생태계 밖의 표준 어휘를 Authoring layer에 포함하는 것은 harness-neutral 원칙을 위반한다. 생태계 범위가 달라지면 nexus-core의 vocabulary가 생태계 경계와 어긋나는 항목을 포함하게 된다.

### 거절 2 — runtime 코드 포함 금지

bridge §9.2가 명시하듯, `@moreih29/nexus-core`는 prompt-only 공유 라이브러리다. hook, MCP server, OpenCode plugin tool 구현, TypeScript 타입, 런타임 I/O 로직은 명시적으로 제외 범위다.

두 하네스(Claude Code, OpenCode)가 아직 안정화되지 않은 상태에서 런타임 추상화 계층을 만드는 것은 투기적 공학이다. 각 하네스의 런타임 인터페이스가 변화하는 동안 공유 런타임 코드는 빠르게 무효화된다. 안정화 전 공유는 두 레포를 lockstep으로 묶는 비용을 만들며, 이것은 독립 레포 유지 결정(Issue #3)과 직접 충돌한다.

### 거절 3 — 구체 model 이름 포함 금지

bridge §2.1과 §3.3이 명시하듯, `meta.yml`에 구체 model 이름(`opus`, `sonnet`, `openai/gpt-5.3-codex` 등)을 포함하는 것은 금지다. `model_tier: high | standard`라는 추상 hint만 허용된다.

구체 model 이름은 하네스별로 다른 model 제공자와 네임스페이스를 사용한다. Claude Code는 Anthropic model identifier를 사용하고, OpenCode는 다른 제공자 이름을 사용할 수 있다. nexus-core에 구체 model 이름을 고정하면 하네스 중립성이 깨진다. 각 하네스가 `model_tier`를 자신의 설정을 통해 구체 model 이름으로 resolve하는 것이 올바른 책임 분리다.

### 거절 4 — harness-specific tool 이름 포함 금지

`body.md`나 `meta.yml`에 하네스별 도구 이름(예: Claude Code의 `mcp__plugin_claude-nexus_nx__nx_task_add`, OpenCode의 `nx_task_add`)을 직접 포함하는 것은 금지다.

bridge §2.2의 capability abstraction이 이 문제를 해결하는 이유: nexus-core가 Claude Code의 tool 이름을 저장하면 OpenCode는 그 이름을 사용할 수 없고, 반대도 마찬가지다. 추상 capability 문자열(`no_task_create` 등)을 저장하면 각 하네스의 빌드 프로세스가 자신의 tool namespace로 resolve한다. 하네스별 tool 이름은 하네스 구현의 내부 사항이며 Authoring layer가 알아야 할 이유가 없다. v0.2.0에서 harness_mapping(concrete tool 이름 열거)이 capabilities.yml에서 완전 삭제되고 semantic prose(intent + blocks_semantic_classes + prose_guidance)로 대체됨으로써, 이 harness-specific tool 이름 금지 원칙은 예외 없이 전면 적용된다 — carve-out 없음.

### 거절 5 — UI hint 필드 추가 금지

에이전트 아이콘, 색상, 정렬 순서 등 UI hint 필드는 nexus-core의 neutral 원칙을 위반한다.

neutral metadata는 모든 소비자가 플랫폼 독립적으로 사용할 수 있는 데이터만 포함한다(Primer §1.1). UI hint는 nexus-code의 Supervision UI라는 특정 소비자의 표현 계층 결정이다. Claude Code 하네스나 OpenCode 하네스는 UI hint를 사용하지 않는다. 특정 소비자를 위한 전용 필드를 Authoring layer에 추가하면 neutral 원칙이 깨지고 nexus-core가 특정 소비자의 UI 결정에 결합된다.

### 거절 6 — Supervision 집행 로직 포함 금지

ApprovalBridge, ProcessSupervisor, AgentHost 인터페이스는 nexus-code의 내부 구현이다(Primer §1.3). nexus-core가 이것들에 대한 정의나 스키마를 포함하면 Authoring layer가 Supervision layer의 집행 의미론에 결합된다.

3층위 경계(Authoring / Execution / Supervision)는 각 층위가 자신의 책임 범위 밖을 모르도록 설계된다. Supervision 집행 의미론(어떤 권한 요청을 승인할 것인가, 어떤 세션 상태를 관찰할 것인가)은 nexus-code의 내부 정책이다. 그것을 nexus-core에 넣으면 Authoring layer가 Supervision layer를 위해 결정해야 하는 상황이 만들어지며, 층위 간 독립성이 무너진다.

---

## Vocabulary 4종

nexus-core의 `vocabulary/` 디렉토리는 4개 파일로 구성된다. 각 파일은 동등한 위상을 갖는 canonical 정의 소스다.

### capabilities.yml

각 capability의 의미를 harness-neutral semantic으로 정의한다 (v0.2.0 X3 hybrid schema). 각 entry는 `id`, `description`, `intent` (snake_case machine-readable 식별자), `blocks_semantic_classes` (per-capability local 의미 클래스), `prose_guidance` (authoritative 다단 prose)를 포함한다. `harness_mapping`은 v0.2.0에서 완전 삭제되었다 — nexus-core는 어떤 harness가 존재하는지 모르며, concrete tool 이름을 알지 못한다. 각 consumer harness가 자기 저장소에 local capability map을 유지하여 nexus-core의 semantic description을 자기 tool namespace로 매핑한다. 이 정보가 nexus-core로 올라오지 않는다.

현재 4 capabilities: `no_file_edit` (workspace_write_denial), `no_task_create` (task_pipeline_append_denial), `no_task_update` (task_pipeline_mutate_denial), `no_shell_exec` (shell_execution_denial, v0.2.0 추가).

### categories.yml

에이전트 카테고리 3종(HOW, DO, CHECK)을 정의한다. 각 카테고리의 역할 범위와 구분 기준을 canonical하게 서술한다. 에이전트 `meta.yml`의 `category` 필드는 이 파일에 정의된 값만 사용한다.

### resume-tiers.yml

에이전트 재개 가능성 티어 3종(persistent, bounded, ephemeral)을 정의한다. 각 티어가 세션 중단 이후 작업 재개 방식을 어떻게 구분하는지를 canonical하게 서술한다. 에이전트 `meta.yml`의 `resume_tier` 필드는 이 파일에 정의된 값만 사용한다.

### tags.yml

Nexus 태그 시스템 전체의 canonical 정의를 담는다. 초기 세트: skill 태그 3 entries ([plan] variants:[auto], [run], [sync])와 inline 액션 태그 4 entries ([d], [m], [m-gc] 독립 entry, [rule] variants:[*]) — 총 7 entries, 9 triggers ([plan:auto] 포함). variants 필드는 skill과 inline_action 모두 허용. 두 하네스(claude-nexus, opencode-nexus)가 이 파일을 참조하여 태그 트리거 패턴과 처리 방식을 동일하게 유지한다. 스키마 상세는 아래 섹션 참조.

---

## tags.yml 스키마 초안

### 필드 정의

| 필드 | 타입 | 설명 |
|------|------|------|
| `id` | string | 태그 고유 식별자. 예: `plan`, `d`, `m`, `m-gc`, `rule`. kebab-case. |
| `trigger` | string | 메시지에서 인식되는 기본 패턴. 예: `[plan]`, `[d]`, `[rule:*]`. |
| `type` | enum | `skill` 또는 `inline_action`. |
| `skill` | string? | type이 `skill`일 때 활성화되는 skill id. 예: `nx-plan`. `handler`와 상호 배타적. |
| `handler` | string? | type이 `inline_action`일 때 처리 참조 이름. 예: `nx_plan_decide`, `memory_store`. `skill`과 상호 배타적. |
| `variants` | string[]? | 파생 트리거 패턴 목록. skill과 inline_action 모두 허용. 예: `["auto"]` → `[plan:auto]` 수용. `["*"]` → `[rule:태그]` 와일드카드. |
| `description` | string | 이 태그가 하는 일의 한 줄 설명. |
| `constraints` | string[]? | 이 태그 사용에 적용되는 제약 목록. |

`skill`과 `handler`는 상호 배타적이다. type이 `skill`이면 `skill` 필드를 사용하고, type이 `inline_action`이면 `handler` 필드를 사용한다. `variants`는 두 type 모두에서 선택적으로 사용할 수 있다.

### skill 태그와 inline 액션 태그 구분 원칙

**skill 태그**는 하네스의 skill 디스패처가 처리한다. 메시지에 태그가 등장하면 해당 skill이 활성화된다. skill의 실행 흐름 전체를 위임한다. 예: `[plan]`은 nx-plan skill을 활성화한다.

**inline 액션 태그**는 Lead가 직접 처리하거나 하네스의 hook이 처리한다. 메시지 흐름 내에서 특정 단일 액션을 수행한다. skill을 활성화하지 않고 즉시 처리된다. 예: `[d]`는 `nx_plan_decide` 도구를 호출하여 결정을 기록한다.

`handler` 이름(`nx_plan_decide`, `memory_store` 등)은 각 하네스가 자신의 gate/dispatcher에서 구현하는 방식을 나타내는 참조 이름이다. 구체 구현(claude-nexus의 gate.cjs 등)은 이 파일에 포함되지 않는다.

### YAML 예시

```yaml
# vocabulary/tags.yml
# Canonical definition of all Nexus tag triggers.
# DO NOT store harness-specific tool names here.
# Each harness resolves 'handler' and 'skill' references in its own gate/dispatcher.
# Slash command triggers are NOT stored here.
# variants field is valid for both skill and inline_action types.

tags:
  # skill tags (3 entries, 4 triggers)
  - id: plan
    trigger: "[plan]"
    type: skill
    skill: nx-plan
    variants: ["auto"]   # [plan:auto] also accepted
    description: "Activates nx-plan skill: structured multi-perspective analysis, decision recording, plan document generation"
    constraints:
      - "Only Lead triggers this tag"
      - "Cannot be used mid-execution (while [run] is active)"

  - id: run
    trigger: "[run]"
    type: skill
    skill: nx-run
    description: "Activates nx-run skill: executes a plan via user-directed agent composition"
    constraints:
      - "Only Lead triggers this tag"

  - id: sync
    trigger: "[sync]"
    type: skill
    skill: nx-sync
    description: "Activates nx-sync skill: synchronizes .nexus/context/ design documents with current project state"

  # inline action tags (4 entries, 5 triggers)
  - id: d
    trigger: "[d]"
    type: inline_action
    handler: nx_plan_decide
    description: "Records a decision during a plan session via nx_plan_decide"
    constraints:
      - "Valid only within an active plan session"
      - "Each [d] call must include a decision title and rationale"

  - id: m
    trigger: "[m]"
    type: inline_action
    handler: memory_store
    description: "Stores a lesson or reference to .nexus/memory/"
    constraints:
      - "Content is compressed before storage"

  - id: m-gc
    trigger: "[m:gc]"
    type: inline_action
    handler: memory_gc
    description: "Garbage-collects .nexus/memory/: merges and removes stale entries"

  - id: rule
    trigger: "[rule]"
    type: inline_action
    handler: rule_store
    variants: ["*"]   # [rule:태그] wildcard accepted
    description: "Stores a rule to .nexus/rules/"
    constraints:
      - "Rule must have a clear, actionable title"
```

---

*이 문서의 관련 파일: ecosystem.md (생태계 구조, 용어, consumer 관계), evolution.md (Forward-only 완화 정책, CHANGELOG 포맷, Phase 전환), `.nexus/rules/neutral-principles.md` (enforceable 규칙 패턴).*
