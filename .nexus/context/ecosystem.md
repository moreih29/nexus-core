# nexus-core — Nexus Authoring layer

> 이 문서는 plan session #1 (2026-04-10)의 결정을 재구성한 것이다. plan session #5 (2026-04-14)의 invocation abstraction 결정(Option A + Spec γ)이 추가 반영되어 있다. 원본 논의: `.nexus/memory/` 참조.

---

## 3층위 멘탈 모델

Nexus 생태계는 세 층위로 나뉜다. 각 층위는 물리적으로 독립 레포지토리이며 역할 경계가 명확하다. 이 분리는 개념적 분리이기도 하지만 동시에 실제 레포지토리 경계이기도 하다 — 각 층위는 자신의 버전, CI, 릴리스 주기를 독립적으로 가진다.

```
Supervision   (reserved)
                │  read-only
Execution     claude-nexus ↔ opencode-nexus
                │  read-only
Authoring     nexus-core   ← 이 프로젝트
```
<!-- 과거 nexus-code 프로젝트가 Supervision layer에 있었으나 2026-04-14 archived됨 -->

### Authoring layer — nexus-core

프롬프트, neutral metadata, vocabulary를 정의하는 공유 자산이다. 생태계 전체에서 에이전트 정의와 어휘의 유일한 canonical source 역할을 한다.

"Authoring layer"의 의미는 두 방향으로 읽힌다. 첫째, nexus-core는 에이전트가 어떻게 동작해야 하는지를 기술(記述)한다 — 그러나 실제로 동작시키지는 않는다. 둘째, 하네스가 교체되더라도 이 기술이 변하지 않는다. capability abstraction이 하네스별 도구 이름 차이를 흡수하므로 본문(body.md, meta.yml)은 플랫폼 독립적으로 유지된다.

집행 semantics를 포함하지 않는다. hook, MCP server, tool 구현, TypeScript 런타임 코드는 각 하네스 레포에 남는다.

### Execution layer — claude-nexus, opencode-nexus

각각 Claude Code 하네스, OpenCode 하네스 위에서 에이전트를 조립·디스패치하고 권한을 집행한다. 태스크 파이프라인을 소유하며, Lead 에이전트가 하위 에이전트를 조율하는 Lead-mediated coordination 모델을 구현한다.

두 프로젝트는 nexus-core의 동등한 소비자다. parent-child 관계가 아니라 sibling이다.

### Supervision layer (reserved)

Supervision layer는 향후 Execution layer 세션 프로세스를 외부에서 spawn·관찰·권한 중재·시각화하는 consumer가 등장할 경우를 위해 개념적으로 예약된 layer다. 2026-04-14 현재 활성 consumer는 없다. 과거 nexus-code 프로젝트가 이 layer를 구현했으나 archived되었다. nexus-core는 이 layer의 의미론에 결합되지 않는다(neutral 원칙).

### 이 프레임의 적용 범위

3층위 모델은 내부 아키텍처 문서 전용이다. 외부 포지셔닝 문서(README, landing page)에는 이 용어가 등장하지 않는다. 외부에서는 사용 맥락(작성자가 어떤 상황에서 어떤 도구를 사용하는가) 중심으로 설명한다.

이 프레임은 scope 판단 규칙이 아니다. 특정 기능이 어느 레포에 속하는지 결정할 때는 3층위 모델이 아닌, 각 프로젝트 고유의 경계 원칙(nexus-core의 경우 harness-neutral 원칙)을 기준으로 삼는다.

---

## 고정 관계 모델

### Sibling 관계

claude-nexus와 opencode-nexus는 sibling이다. 어느 쪽도 다른 쪽의 parent가 아니며, 서로를 관리하거나 의존하지 않는다. 둘 다 nexus-core를 동등하게 소비한다. nexus-core 관점에서 두 소비자는 대칭적이다.

이 대칭성은 nexus-core 설계에 구체적 제약을 부과한다. 특정 하네스에만 유효한 필드나 의미를 nexus-core 파일에 추가하면 대칭성이 깨진다. capability abstraction이 이 대칭성을 유지하는 주요 도구다.

### Bidirectional flip 모델

작성자는 주력 하네스를 시간에 따라 전환할 수 있다(claude-nexus → opencode-nexus, 또는 반대). 이 전환을 "flip"이라 부른다.

flip의 실질적 의미는 "prompt 소유권의 이동"이다. 작성자가 어느 하네스에서 작업하든 동일한 에이전트 정의와 vocabulary를 사용할 수 있는 것은 nexus-core가 canonical source로 중재하기 때문이다. flip은 Execution layer 내부에서만 발생한다.

### Co-run scenarios

두 Execution layer 하네스(claude-nexus, opencode-nexus)가 동일 프로젝트 디렉토리에서 동시에 실행되는 상태를 co-run이라 부른다. flip이 시간 축에서 주력 하네스를 전환하는 현상인 것과 달리, co-run은 공간 축에서 두 하네스가 병존하는 현상이다. 둘은 orthogonal한 개념이며 co-run이 flip을 대체하지 않는다.

**Primary vs fallback 관계.** flip은 여전히 primary pattern이다. co-run은 "두 하네스를 동시에 사용하도록 권장하는 패턴"이 아니다. co-run은 작성자가 의도치 않게 또는 과도기적으로 두 하네스를 동시에 활성화했을 때 state가 파괴되지 않도록 막는 fallback 수준의 지원이다.

**nexus-core 보장 범위.** nexus-core는 state-layer 호환성만 보장한다. 두 하네스가 동일 디렉토리를 읽더라도 공유 state file의 schema가 충돌하지 않는다는 것이 보장 범위다. MCP server port 경합, hook 실행 순서, tool invocation 충돌 등 runtime-level 경합은 각 하네스의 runtime responsibility이며 nexus-core 관할 밖이다(`boundaries.md §제외 범위` 참조).

**파일 분리 기준.** genuinely shared schema(plan, tasks, history)는 루트 경로를 유지한다. harness-specific lifecycle 또는 의미를 가진 파일(예: agent-tracker)은 `.nexus/state/{harness-id}/` 하위에 격리한다. 공통 파일명 재사용 convention은 `docs/nexus-outputs-contract.md §Shared filename convention`에서 관리한다.

**Supervision implication.** cross-harness aggregation이 구현될 경우, `.nexus/state/*/agent-tracker.json` glob 모델을 전제로 설계한다. 단일 공통 파일 모델은 co-run 시 두 하네스가 동일 파일을 경합 기록하게 되므로 채택하지 않는다.

**미결 유보.** harness 수 증가 또는 co-run 빈도 증가 시 `harness_id` registry가 필요해질 수 있다. 현재는 free-string + pattern(glob)으로 유지하며, v1.0 roadmap에서 재평가한다.

### Supervision은 flip 외부

Supervision consumer가 존재한다면 flip 모델의 당사자가 아니다. claude-nexus와 opencode-nexus 중 어느 쪽이 주력 하네스가 되든 Supervision consumer는 그 세션을 동일하게 감독한다. Supervision layer는 Execution layer의 flip에 무관하게 독립적으로 위치한다.

### nexus-core의 canonical 역할

생태계 전체에서 프롬프트, neutral metadata, vocabulary 정의의 유일한 canonical source다. 어떤 프로젝트도 이 정의를 자체적으로 재정의하지 않는다. Supervision consumer가 전용 데이터를 요청하더라도, nexus-core는 neutral 자산만 제공하고 Supervision 의미론을 포함하지 않는다.

"canonical"의 실제 의미: 만약 두 하네스에서 동일한 에이전트 이름과 카테고리가 달리 표기된다면 nexus-core가 틀린 것이다. nexus-core의 정의가 항상 기준이며, 하네스는 그 정의를 resolve하거나 렌더링할 뿐 재정의하지 않는다.

---

## 용어 고정

### Supervisor

Supervision layer에서 Execution layer 세션을 감독하는 consumer를 일반적으로 지칭하는 용어. "Observer"라는 이전 표현은 사용하지 않는다.

Supervisor는 이중 성격을 가진다.

- **관찰자 측면**: 세션 상태, 메시지 스트림, 파일 변경 사항을 읽기 전용으로 관찰한다.
- **Policy Enforcement Point 측면**: 에이전트가 요청하는 권한(파일 수정, 셸 명령 실행 등)에 대해 승인 또는 거부 결정을 내린다.

이 이중성은 구조적 이유에서 비롯된다. 외부 Supervisor가 ApprovalBridge 같은 외부 승인 중재 메커니즘을 통해 이 결정 지점을 처리하는 것이 일반적인 구현 패턴이다.

### HOW / DO / CHECK

에이전트 카테고리를 세 가지로 구분한다.

- **HOW**: 분석과 자문. architect, designer, postdoc, strategist. 깊은 맥락 유지가 핵심 자산이다.
- **DO**: 실행. engineer, writer, researcher. 산출물(artifact) 단위로 작업하고 종료한다.
- **CHECK**: 검증. tester, reviewer. 항상 fresh한 관점에서 독립적으로 검사한다.

에이전트 간 직접 통신은 없다. 모든 조율은 Lead를 경유한다(Lead-mediated coordination).

### resume_tier

에이전트의 세션 지속성을 세 티어로 구분한다.

- **persistent**: 세션 전체를 지속한다. HOW 카테고리 에이전트와 researcher. 맥락 누적이 이들의 핵심 자산이다.
- **bounded**: artifact 단위로 지속한다. engineer, writer. 특정 산출물 완성 후 종료한다.
- **ephemeral**: 항상 새로 시작한다. tester, reviewer. 이전 맥락 없이 독립 검증해야 하기 때문이다.

이 구분은 persistence-surface-theory(reasoning surface vs artifact surface)에 근거한다. resume_tier는 에이전트가 어떤 종류의 표면에서 가치를 생성하는지를 반영한다. HOW 에이전트는 누적된 맥락(reasoning surface)이 산출물이고, DO 에이전트는 완성된 artifact가 산출물이며, CHECK 에이전트는 편향 없는 검사 시각이 산출물이다.

### capability abstraction

nexus-core가 harness-neutral한 공유 자산이 될 수 있는 핵심 메커니즘이다. **denial 방향** — 무엇을 막느냐 — 을 다룬다.

추상 capability 문자열(예: `no_file_edit`, `no_task_create`, `no_task_update`, `no_shell_exec`)을 각 하네스가 자기 tool namespace로 resolve한다. body.md나 meta.yml에 하네스별 도구 이름을 직접 쓰지 않는다. 이 추상화 덕분에 동일한 에이전트 정의가 claude-nexus와 opencode-nexus 양쪽에서 유효하다.

v0.2.0부터 resolve 방향이 변경되었다: nexus-core는 각 capability의 의미를 semantic prose(intent + blocks_semantic_classes + prose_guidance)로 기술하고, concrete tool 매핑은 consumer의 local capability map에서 수행한다. nexus-core에서 harness_mapping(concrete tool 이름 열거)은 삭제되었다.

에이전트가 특정 도구에 접근할 수 없다는 사실(제약)은 nexus-core에서 선언하고, 그 제약을 어떤 도구 차단으로 구현하는지는 각 하네스가 결정한다. 추상과 구현의 이 분리가 capability abstraction의 핵심이다.

### invocation abstraction

nexus-core가 body.md를 "transform source"로 제공하면서 하네스 중립성을 유지하는 메커니즘이다 (v0.8.0). **positive invocation 방향** — 무엇을 호출하느냐 — 을 다룬다.

capability abstraction이 denial 방향("무엇을 막느냐")을 다룬다면, invocation abstraction은 positive invocation 방향("무엇을 호출하느냐")을 다룬다. body.md에서 구체 tool 호출(`Skill({...})`, `Agent({...})`, `TaskCreate` 등)을 하드코딩하지 않고, 추상 매크로 토큰 `{{primitive_id key=val}}`로 표현한다.

각 consumer harness는 local `invocation-map.yml`에서 semantic primitive(skill_activation / subagent_spawn / task_register / user_question)를 자신의 concrete tool 호출 문법으로 매핑한다. claude-nexus는 `Skill()`, `Agent()`, `TaskCreate`, `AskUserQuestion` 같은 Claude Code 하네스 tool로, opencode-nexus는 tag re-emit, hooks 기반 routing, prose fallback 등 자기 생태계 mechanisms로 resolve한다.

`fallback_behavior` 필드는 하네스 비대칭(예: `AskUserQuestion`이 opencode-nexus에 native tool 없음)을 invocations.yml 수준에서 선언적으로 표현한다. 이 필드는 v0.8.0 vocabulary 설계의 핵심 기여로, v0.2.0의 capabilities.yml semantic prose가 denial 방향 비대칭을 흡수한 방식과 쌍대적이다.

추상과 구현의 분리: invocation 의미(primitive_id + semantic_params + prose_guidance)는 nexus-core에서 canonical하게 선언하고, 그 의미를 어떤 concrete tool 호출로 구현할지는 각 consumer가 자기 repo의 invocation-map.yml에서 결정한다. 매크로 문법(Spec γ)의 세부 규격은 `.nexus/state/history.json`의 plan session #5 Issue #2 결정 및 MIGRATIONS/v0_7_to_v0_8.md 참조.

### sibling

claude-nexus와 opencode-nexus의 관계를 표현하는 용어. 계층 관계(parent-child)가 아니라 동등한 관계임을 명시한다. 두 프로젝트는 nexus-core를 공유 소스로 읽고, 서로를 관리하거나 의존하지 않는다.

### bidirectional flip

작성자가 주력 하네스를 전환하는 행위. 단방향이 아니라 양방향으로 전환 가능하다는 점을 강조한다. flip은 Execution layer 내부에서만 발생하며, nexus-core가 canonical source로 중재함으로써 flip 이후에도 에이전트 정의의 일관성이 유지된다.

---

## Consumer 관계

nexus-core는 현재 두 active consumer에 의해 read-only로 소비된다. 소비자 모두 nexus-core에 쓰지 않는다. 소비 시점과 방식은 각 프로젝트가 결정한다 — nexus-core는 소비 방식을 지시하지 않는다.

### claude-nexus — Claude Code 하네스

Phase 2 소비자다(Phase 1에서는 opencode-nexus가 선행). Claude Code 환경 위에서 에이전트를 조립·디스패치하는 Execution layer다. Phase 2 진입 시점은 엄격한 게이트가 아니라 작성자 판단으로 결정된다.

nexus-core에서 가져가는 것: 에이전트 정의(body.md, meta.yml), skill 정의(body.md, meta.yml), vocabulary 파일 전체, schema. capability 문자열을 Claude Code 도구 네임스페이스로 resolve하는 책임은 claude-nexus 내부에 있다.

### opencode-nexus — OpenCode 하네스 (sibling)

Phase 1 소비자다. nexus-core의 bootstrap 시점부터 첫 번째 소비자로 작동한다. OpenCode 환경 위에서 에이전트를 조립·디스패치하는 Execution layer다. claude-nexus와 sibling 관계이며, 두 프로젝트는 nexus-core를 동등하게 소비한다.

nexus-core에서 가져가는 것: claude-nexus와 동일한 범위. capability 문자열을 OpenCode 도구 네임스페이스로 resolve하는 책임은 opencode-nexus 내부에 있다. 이 resolve 방식이 claude-nexus와 달라도 nexus-core 정의는 변하지 않는다.

### (이전) nexus-code — archived (2026-04-14)

plan session #1 Issue #2에서 nexus-code가 3번째 read-only consumer로 추가되었으나, 2026-04-14 해당 프로젝트가 archived되어 현재는 2 active consumer 상태다. Supervision layer는 reserved 상태로 유지된다.

---

## Authoring layer 정체성

### 관리하는 것

nexus-core가 소유하고 관리하는 항목은 다음과 같다. 이 파일들은 모든 소비자가 읽을 수 있도록 플랫폼 독립적으로 작성된다. 특정 하네스를 전제하는 내용은 포함하지 않는다.

- `agents/{id}/body.md` — 에이전트 프롬프트 본문
- `agents/{id}/meta.yml` — 에이전트 neutral metadata (id, name, alias_ko, category, description, tags, capabilities, resume_tier, model_tier)
- `skills/{id}/body.md` — skill 프롬프트 본문
- `skills/{id}/meta.yml` — skill metadata (id, name, description, triggers)
- `vocabulary/capabilities.yml` — capability 추상 문자열 정의
- `vocabulary/categories.yml` — HOW / DO / CHECK 카테고리 정의
- `vocabulary/resume-tiers.yml` — persistent / bounded / ephemeral 티어 정의
- `vocabulary/tags.yml` — skill 태그와 inline 액션 태그의 canonical 정의 (신규)
- `schema/*.json` — 위 파일들의 JSON Schema
- `scripts/import-from-claude-nexus.mjs` — 마이그레이션 스크립트
- `conformance/` — state file JSON Schema, tool conformance fixtures, scenario fixtures. Consumer가 자기 구현의 Nexus 호환성을 검증하는 선언적 테스트.
- `docs/` — MCP tool semantic contracts, state file lifecycle 문서, behavioral contracts. 11 Nexus-core tool의 harness-neutral 명세.

### 제공하지 않는 것

다음 항목은 nexus-core의 범위 밖이다. 각 하네스 레포 또는 외부 Supervision consumer 내부에 머문다.

- hook 구현
- MCP server
- tool 구현
- TypeScript 타입 정의
- 런타임 I/O 로직
- Supervision 집행 로직 (ApprovalBridge, ProcessSupervisor, stream-json 파싱)
- 하네스별 capability resolve 로직
- Supervision 전용 UI hint 데이터

### 이 경계가 중요한 이유

Authoring layer가 집행 semantics를 포함하는 순간, 특정 하네스나 런타임에 결합된다. 그 결합이 발생하면 nexus-core의 harness-neutral 원칙이 깨지고, 다른 소비자가 nexus-core를 소비하기 위해 불필요한 의존성을 감수해야 한다. "Authoring layer는 기술하고, 집행은 각 layer가 담당한다"는 분리가 3층위 모델 전체를 유효하게 만드는 전제다.

실용적 판단 기준: 어떤 파일이나 필드를 nexus-core에 추가하려 할 때, "이것이 없어도 다른 두 소비자는 nexus-core를 온전히 소비할 수 있는가"를 물어야 한다. 답이 "예"라면 그 항목은 nexus-core 밖에 있어야 한다.

---

*이 문서의 범위: 3층위 모델, 고정 관계, 용어 정의, consumer 관계, Authoring layer 경계. 거절 목록·Issue 결정 상세 → `boundaries.md`. Forward-only 완화·Phase 전환·CHANGELOG 포맷 → `evolution.md`. 공유 파일명 convention → `docs/nexus-outputs-contract.md §Shared filename convention`. 현재 active consumer: claude-nexus, opencode-nexus (Supervision layer reserved).*
