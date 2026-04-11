# 04-OPEN_QUESTIONS.md — nexus-core 미결 질문 목록

> 이 파일의 항목들은 향후 `[plan]` 세션에서 재논의가 필요한 것들이다.
> 각 항목에 "무엇을 논의해야 하는가"와 "현재 정보 부족분"을 명시한다.
> 현재 상태에서 임의로 결정하지 말고, 작성자(사용자)의 판단을 기다릴 것.

---

## (a) meta.yml에 "에이전트 아이콘/색상" UI hint 필드 추가 여부

### 무엇을 논의해야 하는가

nexus-code가 3번째 read-only consumer로 합류하면서(Issue #2), nexus-code의 Supervision UI에서 에이전트를 표시할 때 아이콘이나 색상 같은 시각적 구분자가 필요해질 수 있다. 현재 nexus-core의 neutral metadata에는 시각적 속성 필드가 없다.

질문: `meta.yml`에 `icon`, `color`, `sort_order` 같은 UI hint 필드를 추가해야 하는가? 또는 nexus-code가 자체적으로 에이전트 id/category를 기반으로 UI 스타일을 결정해야 하는가?

추가 시 검토 사항:
- UI hint 필드는 특정 UI 환경(nexus-code의 Supervision UI)에 종속된다. 이는 neutral 원칙에 반할 수 있다.
- Claude Code 하네스나 OpenCode 하네스는 이 필드를 사용하지 않는다. 특정 소비자를 위한 필드가 neutral layer에 들어가는 것이 적절한가?
- category(HOW/DO/CHECK)와 id를 기반으로 각 소비자가 자체 UI 스타일을 결정하는 것이 더 neutral한 접근일 수 있다.

### 현재 정보 부족분

- nexus-code가 실제로 에이전트별 UI 스타일을 어떻게 표시할 계획인지 구체 설계가 없다.
- neutral metadata에 UI hint를 포함하는 것이 다른 소비자(opencode-nexus, claude-nexus)에 어떤 영향을 미치는지 평가되지 않았다.
- nexus-code의 UI 설계(Plan #5, T3~)가 완성된 후에 이 질문에 답할 수 있다.

---

## (b) capability → concrete tool 역매핑(ref 방향) 필요 여부

### 무엇을 논의해야 하는가

현재 `vocabulary/capabilities.yml`은 추상 capability → 하네스별 concrete tool 이름의 정방향 매핑을 제공한다. nexus-code가 이 파일을 읽을 때, concrete tool 이름으로부터 어떤 abstract capability에 해당하는지를 조회하는 역방향 매핑이 필요할 수 있다.

예: nexus-code가 Claude Code 세션에서 에이전트가 `mcp__plugin_claude-nexus_nx__nx_task_add` 도구를 요청하는 것을 관찰했을 때, 이것이 어떤 capability에 해당하는지(`no_task_create`) 매핑 테이블 없이 알 수 있는가?

질문: `vocabulary/capabilities.yml`에 역매핑 참조 섹션을 추가해야 하는가? 또는 각 소비자가 자신이 아는 정방향 매핑에서 역방향 조회를 직접 구현해야 하는가?

추가 시 검토 사항:
- 역매핑을 capabilities.yml 자체에 추가하면 파일 구조가 복잡해진다.
- 역매핑은 각 하네스 소비자의 build-time 로직에서 생성할 수 있다(정방향 매핑에서 invert).
- nexus-code에는 build step이 없으므로(런타임에서 파일을 직접 읽음), nexus-code가 역매핑을 필요로 한다면 nexus-core에 데이터가 있어야 한다.

### 현재 정보 부족분

- nexus-code가 실제로 tool 이름 → capability 역매핑을 언제 필요로 하는지 사용 사례가 명확하지 않다.
- nexus-code가 AgentHost 어댑터에서 권한 요청을 관찰할 때 어떤 정보를 가지고 결정을 내리는지(bridge Plan #5의 상세 설계) 아직 미확정이다.

---

## (c) Phase 1 → Phase 2 전환의 practical 시점

### 무엇을 논의해야 하는가

bridge 계획 §11은 Phase 2 trigger 조건 3개를 정의한다:

- Signal 1: `commits_14d(opencode-nexus) > commits_14d(claude-nexus) × 1.5` (2주 연속)
- Signal 2: 작성자의 명시적 "Phase 2 transition" 선언
- Signal 3: opencode-nexus → nexus-core 기여 빈도가 claude-nexus → nexus-core를 초과 (30일 기준)

Primer §5.2가 명시하듯, "Phase 2 trigger 조건은 참고 지표일 뿐 엄격한 게이트가 아니다. 작성자 판단으로 조기 전환 가능하다."

질문: Phase 1 시작 후 90일 재평가 시점(bridge §11.3)에서 무엇을 체크리스트로 확인할 것인가? Signal 1이 충족되지 않아도 조기 전환을 고려할 실질적 기준은 무엇인가?

### 현재 정보 부족분

- opencode-nexus가 nexus-core에서 실제로 얼마나 많은 개선을 만들어낼지 Phase 1 실행 전에는 알 수 없다.
- claude-nexus를 수정하지 않은 상태로 얼마나 오래 운영할 수 있는지(Phase 1 안정성) 경험 데이터가 없다.
- 90일 재평가 시점에서의 구체 판단 기준은 Phase 1 운영을 통해 결정하는 것이 적절하다.

---

## (d) tags.yml의 inline_action handler 이름과 각 플러그인 gate 구현 간 계약 합의

### 무엇을 논의해야 하는가

03-IMPLEMENTATION_GUIDE.md §3에서 `tags.yml`의 `handler` 필드 예시로 `nx_plan_decide`, `memory_store`, `memory_gc`, `rule_store` 같은 이름을 사용했다. 이 이름들은 아직 각 하네스 구현(claude-nexus의 `gate.cjs`, opencode-nexus의 tag parser)과 계약이 합의된 것이 아니다.

질문: handler 이름이 구체 도구 이름(`nx_plan_decide`)인가, 아니면 추상 핸들러 이름(`plan_decision_record`)인가? 각 플러그인이 이 이름을 어떻게 매핑하는가? nexus-core의 tags.yml이 handler 이름을 정의하면, 각 하네스는 그것을 준수해야 하는가?

추가로 고려할 것:
- `[d]` 태그는 claude-nexus에서 `mcp__plugin_claude-nexus_nx__nx_plan_decide`를 호출하고, opencode-nexus에서는 `nx_plan_decide`를 호출한다. capabilities.yml처럼 per-harness 매핑이 필요한가?
- tags.yml의 handler가 추상 이름이라면, capabilities.yml처럼 각 하네스 매핑 섹션이 필요하다. 이것이 tags.yml 스키마를 확장해야 한다는 의미인가?

### 현재 정보 부족분

- claude-nexus `gate.cjs`가 inline 액션 태그를 어떻게 처리하는지 상세 구현을 확인해야 한다.
- opencode-nexus의 tag parser가 `[d]`, `[m]`, `[rule]` 등을 어떻게 처리하는지 상세 구현이 필요하다.
- 두 구현을 확인한 후에 handler 이름 계약과 per-harness 매핑 필요 여부를 판단할 수 있다.

---

## (e) schema_version 필드 도입 여부 — Forward-only 완화 이후의 defensive loader 지원

### 무엇을 논의해야 하는가

Issue #3에서 Forward-only schema 원칙이 완화되어 breaking change가 semver major bump로 허용되었다. 이제 소비자들은 자신이 읽는 nexus-core 버전의 schema가 자신의 loader와 호환되는지 확인해야 한다.

질문: `meta.yml`이나 `vocabulary/*.yml`에 `schema_version` 필드를 추가해야 하는가? 각 소비자의 loader가 이 필드를 읽어 호환성을 검증하고 incompatible version에서 명시적 오류를 낼 수 있다면 defensive loading이 가능해진다.

추가 시 고려 사항:
- `schema_version`을 각 파일 header에 넣는 방식 vs. `package.json`의 version만으로 소비자가 호환성을 관리하는 방식 중 어느 것이 더 실용적인가?
- Phase 1에서 소비자가 opencode-nexus 하나뿐인 동안에는 package.json의 semver만으로 충분할 수 있다.
- Phase 2에서 claude-nexus가 합류하고 nexus-code도 읽기 시작하면, 각 소비자의 버전 범위 관리가 복잡해질 수 있다. 이 시점에 schema_version이 더 가치 있을 수 있다.

### 현재 정보 부족분

- 소비자들이 실제로 어떻게 버전 충돌을 경험하는지 Phase 1 운영 데이터가 없다.
- schema_version 필드를 추가하면 기존 meta.yml 스키마(`schema/agent.schema.json`)를 변경해야 한다. 이것 자체가 schema 변경이므로 순환 문제가 생길 수 있다.
- Phase 1이 어느 정도 진행된 후 실제 버전 충돌 사례가 생겼을 때 이 질문을 다시 논의하는 것이 적절하다.

---

*이 파일은 plan session #1, 2026-04-10 기준이다. 각 항목은 [plan] 세션에서 재논의한다. 임의로 결정하지 말 것.*
