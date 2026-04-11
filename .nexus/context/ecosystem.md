# nexus-core — Nexus Authoring layer

> 이 문서는 plan session #1 (2026-04-10)의 결정을 재구성한 것이다. 원본 논의: `.nexus/memory/` 참조.

---

## 3층위 멘탈 모델

Nexus 생태계는 세 층위로 나뉜다. 각 층위는 물리적으로 독립 레포지토리이며 역할 경계가 명확하다. 이 분리는 개념적 분리이기도 하지만 동시에 실제 레포지토리 경계이기도 하다 — 각 층위는 자신의 버전, CI, 릴리스 주기를 독립적으로 가진다.

```
Supervision   nexus-code
                │  read-only
Execution     claude-nexus ↔ opencode-nexus
                │  read-only
Authoring     nexus-core   ← 이 프로젝트
```

### Authoring layer — nexus-core

프롬프트, neutral metadata, vocabulary를 정의하는 공유 자산이다. 생태계 전체에서 에이전트 정의와 어휘의 유일한 canonical source 역할을 한다.

"Authoring layer"의 의미는 두 방향으로 읽힌다. 첫째, nexus-core는 에이전트가 어떻게 동작해야 하는지를 기술(記述)한다 — 그러나 실제로 동작시키지는 않는다. 둘째, 하네스가 교체되더라도 이 기술이 변하지 않는다. capability abstraction이 하네스별 도구 이름 차이를 흡수하므로 본문(body.md, meta.yml)은 플랫폼 독립적으로 유지된다.

집행 semantics를 포함하지 않는다. hook, MCP server, tool 구현, TypeScript 런타임 코드는 각 하네스 레포에 남는다.

### Execution layer — claude-nexus, opencode-nexus

각각 Claude Code 하네스, OpenCode 하네스 위에서 에이전트를 조립·디스패치하고 권한을 집행한다. 태스크 파이프라인을 소유하며, Lead 에이전트가 하위 에이전트를 조율하는 Lead-mediated coordination 모델을 구현한다.

두 프로젝트는 nexus-core의 동등한 소비자다. parent-child 관계가 아니라 sibling이다.

### Supervision layer — nexus-code

Execution layer의 세션 프로세스를 외부에서 spawn·관찰·권한 중재·시각화한다. "host of host" 위치에서 여러 Execution layer 세션을 동시에 감독할 수 있다.

nexus-code는 Supervisor다. 세션 관찰자 역할과 Policy Enforcement Point 역할을 동시에 수행한다. nexus-core를 read-only로 소비하지만, Supervision 집행 로직(ProcessSupervisor, ApprovalBridge, stream-json 파싱)은 nexus-code 내부에 머문다.

nexus-code가 두 Execution layer 하네스를 모두 감독하기 위해 내부에 AgentHost 인터페이스를 정의하고 그 아래 하네스별 구현체를 둔다. 이 설계는 nexus-core와 무관하다 — nexus-core는 AgentHost 인터페이스를 알지 못한다.

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

### Supervision은 flip 외부

nexus-code는 flip 모델의 당사자가 아니다. claude-nexus와 opencode-nexus 중 어느 쪽이 주력 하네스가 되든 nexus-code는 그 세션을 동일하게 감독한다. Supervision layer는 Execution layer의 flip에 무관하게 독립적으로 위치한다.

### nexus-core의 canonical 역할

생태계 전체에서 프롬프트, neutral metadata, vocabulary 정의의 유일한 canonical source다. 어떤 프로젝트도 이 정의를 자체적으로 재정의하지 않는다. nexus-code가 Supervision UI용 전용 데이터를 요청하더라도, nexus-core는 neutral 자산만 제공하고 Supervision 의미론을 포함하지 않는다.

"canonical"의 실제 의미: 만약 두 하네스에서 동일한 에이전트 이름과 카테고리가 달리 표기된다면 nexus-core가 틀린 것이다. nexus-core의 정의가 항상 기준이며, 하네스는 그 정의를 resolve하거나 렌더링할 뿐 재정의하지 않는다.

---

## 용어 고정

### Supervisor

nexus-code를 지칭하는 공식 용어. "Observer"라는 이전 표현은 사용하지 않는다.

Supervisor는 이중 성격을 가진다.

- **관찰자 측면**: 세션 상태, 메시지 스트림, 파일 변경 사항을 읽기 전용으로 관찰한다.
- **Policy Enforcement Point 측면**: 에이전트가 요청하는 권한(파일 수정, 셸 명령 실행 등)에 대해 승인 또는 거부 결정을 내린다.

이 이중성은 구조적 이유에서 비롯된다. Claude Code CLI는 권한 요청→승인→실행 흐름을 대화형으로 이을 수 없다. 따라서 외부 감독자(nexus-code)가 ApprovalBridge를 통해 이 결정 지점을 처리한다.

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

nexus-core가 harness-neutral한 공유 자산이 될 수 있는 핵심 메커니즘이다.

추상 capability 문자열(예: `no_file_edit`, `no_task_create`, `no_task_update`, `no_shell_exec`)을 각 하네스가 자기 tool namespace로 resolve한다. body.md나 meta.yml에 하네스별 도구 이름을 직접 쓰지 않는다. 이 추상화 덕분에 동일한 에이전트 정의가 claude-nexus와 opencode-nexus 양쪽에서 유효하다.

에이전트가 특정 도구에 접근할 수 없다는 사실(제약)은 nexus-core에서 선언하고, 그 제약을 어떤 도구 차단으로 구현하는지는 각 하네스가 결정한다. 추상과 구현의 이 분리가 capability abstraction의 핵심이다.

### sibling

claude-nexus와 opencode-nexus의 관계를 표현하는 용어. 계층 관계(parent-child)가 아니라 동등한 관계임을 명시한다. 두 프로젝트는 nexus-core를 공유 소스로 읽고, 서로를 관리하거나 의존하지 않는다.

### bidirectional flip

작성자가 주력 하네스를 전환하는 행위. 단방향이 아니라 양방향으로 전환 가능하다는 점을 강조한다. flip은 Execution layer 내부에서만 발생하며, nexus-core가 canonical source로 중재함으로써 flip 이후에도 에이전트 정의의 일관성이 유지된다.

---

## 3 consumer 관계

nexus-core는 세 프로젝트에 의해 read-only로 소비된다. 세 소비자 모두 nexus-core에 쓰지 않는다. 소비 시점과 방식은 각 프로젝트가 결정한다 — nexus-core는 소비 방식을 지시하지 않는다.

### claude-nexus — Claude Code 하네스

Phase 2 소비자다(Phase 1에서는 opencode-nexus가 선행). Claude Code 환경 위에서 에이전트를 조립·디스패치하는 Execution layer다. Phase 2 진입 시점은 엄격한 게이트가 아니라 작성자 판단으로 결정된다.

nexus-core에서 가져가는 것: 에이전트 정의(body.md, meta.yml), skill 정의(body.md, meta.yml), vocabulary 파일 전체, schema. capability 문자열을 Claude Code 도구 네임스페이스로 resolve하는 책임은 claude-nexus 내부에 있다.

### opencode-nexus — OpenCode 하네스 (sibling)

Phase 1 소비자다. nexus-core의 bootstrap 시점부터 첫 번째 소비자로 작동한다. OpenCode 환경 위에서 에이전트를 조립·디스패치하는 Execution layer다. claude-nexus와 sibling 관계이며, 두 프로젝트는 nexus-core를 동등하게 소비한다.

nexus-core에서 가져가는 것: claude-nexus와 동일한 범위. capability 문자열을 OpenCode 도구 네임스페이스로 resolve하는 책임은 opencode-nexus 내부에 있다. 이 resolve 방식이 claude-nexus와 달라도 nexus-core 정의는 변하지 않는다.

### nexus-code — Supervision layer (3번째 read-only consumer)

bridge 계획 원본에는 두 소비자(opencode-nexus, claude-nexus)만 있었다. plan session #1 Issue #2에서 nexus-code가 3번째 read-only consumer로 명시적으로 추가되었다.

추가 이유: nexus-code의 정체성이 "코드 에이전트 CLI의 GUI 래퍼"에서 "Nexus 생태계에 최적화된 에이전트 감독자 워크벤치"로 예리해지면서, Supervision UI가 에이전트 카탈로그와 vocabulary에 의존하게 되었다.

nexus-code에서 소비하는 것: 에이전트 카탈로그(id, name, alias_ko, category, description, resume_tier, capabilities), vocabulary 전체(capabilities.yml, categories.yml, resume-tiers.yml, tags.yml), skill 목록(meta.yml의 id, name, description, triggers).

경계: nexus-code는 이 데이터를 Supervision UI 표시와 감독 결정의 참고 정보로 사용한다. nexus-core는 nexus-code의 사용 방식에 관여하지 않으며, Supervision 전용 데이터(UI hint, 색상, 아이콘 등)를 추가하지 않는다.

---

## Authoring layer 정체성

### 관리하는 것

nexus-core가 소유하고 관리하는 항목은 다음과 같다. 이 파일들은 세 소비자 모두가 읽을 수 있도록 플랫폼 독립적으로 작성된다. 특정 하네스를 전제하는 내용은 포함하지 않는다.

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

### 제공하지 않는 것

다음 항목은 nexus-core의 범위 밖이다. 각 하네스 레포 또는 nexus-code 내부에 머문다.

- hook 구현
- MCP server
- tool 구현
- TypeScript 타입 정의
- 런타임 I/O 로직
- Supervision 집행 로직 (ApprovalBridge, ProcessSupervisor, stream-json 파싱)
- 하네스별 capability resolve 로직
- Supervision 전용 UI hint 데이터

### 이 경계가 중요한 이유

Authoring layer가 집행 semantics를 포함하는 순간, 특정 하네스나 런타임에 결합된다. 그 결합이 발생하면 nexus-core의 harness-neutral 원칙이 깨지고, 두 번째 하네스(또는 세 번째 consumer)가 nexus-core를 소비하기 위해 불필요한 의존성을 감수해야 한다. "Authoring layer는 기술하고, 집행은 각 layer가 담당한다"는 분리가 3층위 모델 전체를 유효하게 만드는 전제다.

실용적 판단 기준: 어떤 파일이나 필드를 nexus-core에 추가하려 할 때, "이것이 없어도 다른 두 소비자는 nexus-core를 온전히 소비할 수 있는가"를 물어야 한다. 답이 "예"라면 그 항목은 nexus-core 밖에 있어야 한다.

---

*이 문서의 범위: 3층위 모델, 고정 관계, 용어 정의, consumer 관계, Authoring layer 경계. 거절 목록·Issue 결정 상세 → `boundaries.md`. Forward-only 완화·Phase 전환·CHANGELOG 포맷 → `evolution.md`.*
