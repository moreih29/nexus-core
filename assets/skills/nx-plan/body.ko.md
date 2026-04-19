---
name: nx-plan
description: Structured multi-perspective analysis to decompose issues, align on
  decisions, and produce an enriched plan before execution. Plan only — does not
  execute.
summary: "Structured planning — subagent-based analysis, deliberate decisions, produce execution plan"
triggers:
  - plan
harness_docs_refs:
  - resume_invocation
id: nx-plan
---

## Role

서브에이전트를 활용한 구조적 다각도 분석을 진행자로서 수행한다. 안건을 분해하고, 선택지를 숙의하며, 결정에 합의한다. Lead는 종합자이자 능동적 참여자로서 — 서브에이전트 리서치·분석을 조율하면서 동시에 자신의 입장을 제시한다. 실행은 하지 않는다 — planning only. 실행으로의 전환은 사용자의 결정이다.

## Constraints

- NEVER execute — 이 스킬은 planning only다. 실행으로의 전환은 사용자의 결정이다
- NEVER call `nx_plan_start` before research is complete (research_summary is required)
- NEVER present multiple issues at once — one issue at a time only
- NEVER ask groundless questions — always research code/knowledge/decisions first
- NEVER use the harness's team creation primitive. Inter-agent messaging for resume is permitted ONLY for resuming completed subagents whose `resume_tier` is `persistent` or `bounded`, and ONLY within the constraints of the Resume Policy section below. Direct inter-agent communication to running teammates remains forbidden in plan sessions.
- MUST record all decisions with `[d]` tag so they are not scattered across turns
- MUST call `nx_plan_decide` when recording `[d]`
- MUST check for existing plan.json before starting a new session
- `[d]` without an active plan.json is BLOCKED — "[d]는 plan 세션 안에서만 유효합니다."
- MUST present a comparison table before asking for a decision — never present options as prose only. Format:

```
| | A: {title} | B: {title} |
|---|---|---|
| Pros | ... | ... |
| Cons | ... | ... |
| Pick | | **(Recommended)** |
```

## Guidelines

## Trigger

- 명시적 태그: `[plan]` — plan.json이 존재하면 기존 세션을 계속하고, 없으면 새 세션을 시작한다
- 세션 도중 추가 분석이 필요한 경우: harness의 subagent spawn primitive를 통해 HOW 서브에이전트를 독립적으로 스폰한다
- 태그 없이 대화 계속 → 기존 세션 유지

---

## Auto Mode (`[plan:auto]`)

`[plan:auto]`로 트리거되거나 `{{skill_activation skill=nx-plan mode=auto}}`로 호출되면, **사용자 인터랙션 없이** 전체 planning 프로세스를 실행한다:

1. **Research** — researcher+Explore 서브에이전트 스폰 (interactive와 동일)
2. **안건 도출** — Lead가 리서치 결과에서 안건을 도출한다
3. **Auto-decide** — 각 안건에 대해 Lead가 선택지를 제시하지 않고 권장 옵션을 선택한다. 각 `nx_plan_decide(summary)`는 반드시 포함해야 한다: 선택한 접근법 + 이유, 그리고 기각한 대안 + 기각 이유. 비교 테이블은 불필요하지만 내부 숙의는 필수다.
4. **결정 브리핑** — 태스크 생성 전 모든 결정의 간결한 요약을 출력한다:
   ```
   [auto-plan complete] N issues, N decisions:
   - #1: {selected} ({rejected alternative} — reason)
   - #2: ...
   ```
   사용자 응답을 기다리지 않고 즉시 태스크 생성으로 진행한다.
5. **Plan document** — Step 7 규칙에 따라 tasks.json을 생성한다 (plan.json issues에 `how_agents`가 있으면 HOW-assisted 분해 포함). owner 테이블과 verification auto-pairing을 적용한다.

interactive 모드와의 주요 차이점:
- 사용자 프롬프트나 비교 테이블 없음 — Lead가 자율적으로 결정한다
- 동적 agenda 제안 없음 — Lead가 도출된 모든 안건을 내부적으로 처리한다
- 출력: `[run]` 실행을 위한 tasks.json 준비 완료

**호출 컨텍스트별 SCOPE:**
- `[plan:auto]` 단독 → auto-plan + 브리핑 + tasks.json 생성. 여기서 종료.
- `[run]`에 의해 호출됨 (tasks.json 없는 경우) → auto-plan + 브리핑 + tasks.json 생성 + 끊김 없는 실행 전환. plan과 run 사이에 일시정지 없음.

이 모드는 tasks.json이 없을 때 `[run]`이 내부적으로 호출하거나, 사용자가 `[plan:auto]`로 명시적으로 호출한다.

---

## Procedure (Interactive Mode)

### Step 1: Intent Discovery

planning 깊이를 결정하고, Progressive Depth에 기반하여 분석을 위임할 HOW 서브에이전트를 파악한다.

| Level | Signal | Exploration Scope |
|-------|--------|-------------------|
| **Specific** | 파일 경로, 함수명, 에러 메시지, 또는 구체적인 대상이 명시됨 | 해당 파일/모듈에 집중 |
| **Direction-setting** | 열린 질문, "~하면 좋겠다", 접근법 중 선택 필요 | 관련 영역 + 외부 사례 리서치 |
| **Abstract** | "어떻게 접근해야 할지 모르겠다", 목표 자체가 불명확, 근본적인 방향 설정 | 전체 코드베이스 + 외부 리서치 + 유사 프로젝트 비교 |

- Specific 요청 → 1–2개 질문으로 의도를 확인하고 즉시 안건을 도출한다
- Direction-setting → 가설 기반 질문으로 의도를 파악한다
- Abstract/fundamental → 사용자가 명확히 하지 않은 근본 목표를 발굴하기 위해 적극적으로 인터뷰한다

**HOW 서브에이전트 선택 규칙:**
- 사용자가 에이전트를 명시적으로 지정 → 그대로 사용하되, 빠진 부분이 감지되면 추가를 제안한다
- 사용자가 에이전트를 지정하지 않음 → Lead가 안건 SCOPE에 기반하여 제안하고 사용자에게 확인받는다
- 추가 HOW 서브에이전트는 분석 중 언제든지 스폰할 수 있다 (Lead 또는 사용자의 판단으로)

### Step 2: Research

planning agenda를 수립하기 전에 코드, 핵심 지식, 기존 결정을 파악한다.

**기존 지식부터 확인한다**: 서브에이전트를 스폰하기 전에, 파일 패턴 검색과 파일 읽기를 통해 `.nexus/memory/`와 `.nexus/context/`에서 관련 메모와 context 파일을 스캔하고, `nx_history_search`로 해당 주제의 기존 결정을 확인한다. 필요한 정보가 이미 있으면 그대로 활용하고 서브에이전트 스폰을 생략하거나 범위를 줄인다. 기존 지식으로 커버되지 않는 빈 곳을 채우기 위해서만 서브에이전트를 스폰한다.

**접근법 선택:**

| Scenario | Approach |
|----------|----------|
| 코드베이스 파악 | `{{subagent_spawn target_role=explore prompt="<file/code search task>"}}` 코드베이스 탐색 |
| 외부 리서치 필요 | `{{subagent_spawn target_role=researcher prompt="<research question>"}}` 웹 검색 |
| 코드베이스 + 외부 모두 | Explore + Researcher 병렬 스폰 |

- NEVER call `nx_plan_start` before research is complete.
- `nx_plan_start`의 `research_summary` 파라미터는 필수 — 세션 생성 전 리서치 완료를 강제한다.
- Researcher 서브에이전트는 harness의 subagent spawn primitive를 통해 스폰되며 결과를 Lead에 반환한다. plan 세션에는 합류하지 않는다.

**기존 세션 (plan.json 존재):**
- `nx_plan_status`로 현재 상태를 확인한다.
- 새 주제나 추가 리서치가 필요하면 → 그에 맞게 researcher 서브에이전트를 스폰한다.
- 리서치가 완료되기 전에 다음 안건으로 진행하지 않는다.

### Step 3: Session Setup

planning 세션을 등록한다.

1. **`nx_plan_start(topic, issues, research_summary)`** — plan.json에 plan을 등록한다. 기존 plan.json이 있으면 자동으로 아카이브한다.
2. 안건 목록을 사용자에게 보여주고 진행 전 확인받는다.

### Step 4: Analysis

**항상 한 번에 하나의 안건만 진행한다.** 여러 안건을 동시에 제시하지 않는다.

각 안건에 대해:

1. **현재 상태 분석** — Lead가 리서치를 바탕으로 현재 상태와 문제점을 요약한다.
2. **서브에이전트 분석** — 복잡한 안건의 경우, harness의 subagent spawn primitive를 통해 HOW 서브에이전트(architect, strategist 등)를 병렬로 스폰한다. 각 서브에이전트가 독립적으로 안건을 분석하고 결과를 반환한다.
   - **도메인-에이전트 매핑** — 안건 키워드를 권장 HOW 서브에이전트에 매핑한다:

   | Domain keywords | Recommended HOW |
   |----------------|-----------------|
   | UI, UX, 디자인, 인터페이스, 사용자 경험, 레이아웃 | Designer |
   | 아키텍처, 시스템 설계, 성능, 구조 변경, API, 스키마 | Architect |
   | 비즈니스, 시장, 전략, 포지셔닝, 경쟁, 수익 | Strategist |
   | 연구 방법론, 근거 평가, 문헌, 실험 설계 | Postdoc |

   - **Opt-out 기본값**: 안건이 매핑의 도메인과 일치하면, 스폰이 기본이다. 복수 매핑 → 복수 스폰. 건너뛰려면 분석 텍스트에 "{Agent} not needed — reason: ..."를 명시한다.
   - **매핑 없음**: 일치하는 도메인이 없으면 Lead가 직접 분석한다. 불확실할 때는 스폰한다 — 불필요한 스폰의 비용이 얕은 분석의 비용보다 낮다.
   - **HOW 결과 기록**: HOW 서브에이전트가 반환한 후, `nx_plan_decide(how_agents=[...], how_summary={...})`로 결정을 기록할 때 에이전트 이름과 핵심 결과를 포함한다. 이 데이터는 Step 7 태스크 생성을 위해 plan.json에 저장된다.
3. **선택지 제시** — 종합 후 Lead가 비교를 제시한다:

```
| Item | A: {title} | B: {title} | C: {title} |
|------|-----------|-----------|-----------|
| Pros | ... | ... | ... |
| Cons | ... | ... | ... |
| Trade-offs | ... | ... | ... |
| Best for | ... | ... | ... |

**Recommendation: {X} ({title})**

- Option A falls short because {reason}
- Option B falls short because {reason}
- Option X overcomes {A/B limitations} → {core benefit}
```

4. **사용자 응답 대기** — 자유 형식의 응답을 받는다. 사용자는 선택지를 조합하거나, 반박하거나, 후속 질문을 할 수 있다.

## Resume Policy

harness의 resume 메커니즘을 사용할 수 없으면, 모든 resume 경로가 비활성화된다 — 새로 스폰을 강제한다. 그 외:

| resume_tier | Same-issue default | Cross-issue | Disqualifiers |
|---|---|---|---|
| persistent | 기본적으로 resume | Lead opt-in only | 반증 / 번복 / 재검토 안건 → 새로 스폰 |
| bounded | 조건부 (동일 artifact에 한함) | 금지 | 3회 루프 / 피드백 사이클 (REVISION_REQUIRED) → 새로 스폰 |
| ephemeral | 금지 | 금지 | N/A (항상 새로 스폰) |

`bounded` 에이전트를 resume하기 전: 프롬프트에 "수정 전 대상 파일을 다시 읽을 것" 지시를 포함한다. re-read 없는 bounded resume은 BLOCKED.

`resume_tier`는 각 에이전트의 frontmatter (`agents/*.md`)에서 읽는다. 없으면 `ephemeral`로 처리한다 (가장 보수적).

### Step 5: Record Decision

사용자가 결정하면 `[d]` 태그로 기록한다.

- gate.ts가 `[d]`를 감지하여 `nx_plan_decide`로 라우팅한다.
- `nx_plan_decide(issue_id, summary)` — 안건을 `decided`로 표시하고 plan.json에 인라인으로 `decision`을 기록한다.
- 결정은 decisions.json에 기록하지 않는다 — plan.json이 단일 진실 소스다.
- plan.json 없이 `[d]`를 사용하면 차단된다.
- **Progress anchoring**: 기록 직후 한 줄을 출력한다: "Issue #N decided (M of K complete). Next: #X — {title}." 멀티 안건 세션에서 사용자가 진행 상황을 파악하게 한다.

**각 결정 직후**, Lead는 확인한다: "이 결정이 후속 질문이나 새로운 안건을 만들어내는가?" 그렇다면 다음 안건으로 이동하기 전에 `nx_plan_update(action='add')`로 추가를 제안한다.

**결정 번복**: 사용자가 기존 결정을 재고하려 할 때 ("아까 결정 다시 생각해보자", "issue #N 번복"), Lead는 `nx_plan_update(action='reopen', issue_id=N)`을 호출하여 안건을 재개하고 Step 4 분석으로 돌아간다.

### Step 6: Dynamic Agenda + Wrap-up

각 결정 후 Lead는 자동으로 파생 안건을 확인한다.

- **Dynamic agenda 제안**: 결정이 기록된 후, Lead는 해당 결정이 후속 질문이나 미해결 하위 안건을 내포하는지 검토한다. 발견되면 `nx_plan_update(action='add', ...)`로 추가를 제안하고 추가 전 사용자에게 확인받는다.
- 미결 안건이 남아 있으면 → 자연스럽게 다음 안건으로 전환한다.
- 모든 안건이 결정됨 → **Gap check**: 원래 질문/주제를 안건 목록과 대조한다.
  - Gap 발견 → `nx_plan_update(action='add', ...)`로 추가 안건을 등록하고 Step 4로 돌아간다.
  - Gap 없음 → planning 완료를 알린다.
- Wrap-up: 모든 분석 스레드가 Lead에 결론을 보고했는지 확인한다.
- 자동으로 Step 7로 진행한다 — plan document 생성 여부를 묻지 않는다.

### Step 7: Plan Document Generation

모든 안건이 결정되면 즉시 plan document (tasks.json)를 생성한다:

1. **결정 수집** — plan.json에서 모든 `decided` 안건을 수집한다
2. **태스크 도출** — 결정을 구체적이고 실행 가능한 태스크로 분해한다

   **HOW-assisted 태스크 분해**: plan.json issues의 `how_agents` 필드를 확인한다.
   - HOW 에이전트가 분석에 참여했으면 → 결정된 접근법 + 기존 `how_summary`를 컨텍스트로 해당 HOW를 다시 스폰한다. 해당 도메인의 태스크 분해와 owner 배정을 제안하도록 요청한다.
   - HOW 에이전트가 참여하지 않았으면 → Lead가 아래 owner 테이블과 auto-pairing 규칙을 사용하여 단독으로 분해한다.
   - 이를 통해 태스크 생성 깊이가 plan 분석 깊이에 비례하게 된다.

3. **각 태스크를 보강한다**:
   - `approach` — 결정 근거에서 도출한 구현 전략
   - `acceptance` — 완료 정의, 검증 가능한 기준
   - `risk` — 분석에서 나온 알려진 위험 또는 주의사항
   - `deps` — 실행 순서에 기반한 태스크 의존성
   - `owner` — 위임 분석에 기반하여 배정:

   | Work type | owner | Criteria |
   |-----------|-------|----------|
   | 단일 파일, 소규모 변경 | **lead** | 서브에이전트 오버헤드 > 태스크 노력 |
   | 코드 구현 (.ts, .js, .py 등) | **engineer** | 소스 코드 생성/수정 |
   | 문서/콘텐츠 (.md, 비코드) | **writer** | .md 파일, README, docs, 비코드 콘텐츠 |
   | 웹 리서치 / 외부 조사 | **researcher** | 외부 정보 수집 필요 |
   | 설계 분석 / 리뷰 | **architect** 등 HOW | 기술적 trade-off 판단 |
   | 동일 파일의 순차적 편집 | **lead** | 병렬 서브에이전트는 충돌 위험 |

   **Primary metric — artifact-coherence**: 잘 구성된 태스크는 단일 artifact 또는 긴밀하게 연결된 artifact 클러스터를 대상으로 하며 단일하고 일관된 변경을 수행한다. 변경이 일관된 경우: (a) 한 문장으로 설명할 수 있고, (b) 되돌려도 다른 모든 artifact가 일관성을 유지하며, (c) 출력만 검사하여 acceptance를 검증할 수 있다.

   **Verification auto-pairing (조건부)** — DO 태스크의 acceptance에 적절한 검증 트리거가 포함된 경우에만 CHECK 태스크를 생성한다:
   - `owner: "engineer"` + acceptance에 런타임 동작 기준 포함 → **tester** 태스크를 페어링한다.
   - `owner: "writer"` + acceptance에 검증 가능한 산출물 기준 포함 → **reviewer** 태스크를 페어링한다.
   - 제외: 순수 리팩터 (동작 보존), 타입 전용 변경, docs 인접 태스크 (`vocabulary/task-exceptions.yml`의 `docs_only` 항목으로 분류된 .md 또는 frontmatter 전용), researcher 태스크. Researcher 태스크는 auto-paired CHECK를 받지 않는다 — 리서치 출력은 tester나 reviewer가 아닌 Lead 또는 HOW 에이전트에 직접 전달된다.
   - 페어링된 검증 태스크는 `deps`를 통해 원래 태스크에 연결된다.

   **Exception catalog**: 태스크 분해 예외는 `vocabulary/task-exceptions.yml`에 정의된다 (`docs_only.coherent`, `docs_only.independent`, `same_file_bundle`, `generated_artifacts`). 태스크에 예외가 적용되면, 다운스트림 툴링이 분류를 추적할 수 있도록 해당 id를 태스크의 `context` 필드에 기록한다.

   **Dedup Layer 1 (plan-time static merge)**: 태스크 목록을 확정하기 전에, 초안 태스크에서 `target_files`가 겹치는 것을 스캔한다. 겹치는 태스크는 `vocabulary/task-exceptions.yml`의 `same_file_bundle` 예외를 통해 단일 owner 태스크로 병합한다. 실행 중 병렬 쓰기 충돌을 방지하기 위함이다.

   **DO/CHECK 분해 원칙**: DO 에이전트 (engineer, writer, researcher)와 CHECK 에이전트 (tester, reviewer)는 HOW 에이전트보다 태스크당 컨텍스트가 적다. 태스크가 여러 독립적인 artifact를 포함할 때, 하나의 owner에 번들하기보다 여러 병렬 DO/CHECK 서브에이전트로 분해한다. HOW 에이전트는 통합된 컨텍스트의 이점을 누리므로 일반적으로 단일 세션으로 유지한다. 병렬 분해는 독립 artifact가 최소 3개 이상일 때 효과적이다. 그 미만이면 병렬화 오버헤드를 피하기 위해 하나의 owner에 번들하는 것이 낫다.

   **HOW 분해 규칙**: HOW 분석을 여러 서브에이전트로 나누는 것은 안건이 도메인-에이전트 매핑 테이블의 서로 다른 행(architect vs designer vs strategist vs postdoc)에 걸쳐 있을 때만 한다. 단일 도메인 행 안의 세부 관심사는 하나의 HOW 세션에서 처리한다.

4. **`nx_task_add`를 통해 tasks.json을 채운다**:
   - plan 주제에서 `goal`을 설정한다
   - plan.json에서 결정된 요약으로 `decisions`를 설정한다
   - 각 태스크에 대해 `nx_task_add(plan_issue=N, approach, acceptance, risk, owner)`를 호출한다
   - 설계 또는 아키텍처 변경과 관련된 결정이 있으면, 해당 결정을 반영하여 `.nexus/context/`의 관련 파일을 업데이트하는 태스크를 포함한다 (owner: `writer` 또는 `lead`)
5. **Plan document 제시** — 생성된 tasks.json 요약을 사용자에게 보여주고 검토받는다
6. **전환 안내**: "`[run]`으로 실행하세요."

**Incremental mode**: tasks.json이 이미 존재하면 (예: 후속 안건 추가 후), 새로운 결정에 대한 태스크만 추가한다. 이미 처리된 안건의 태스크를 중복 생성하지 않도록 `plan_issue` 필드를 확인한다.

---

## plan → run Transition

tasks.json은 이미 Step 7에서 생성된다. Plan의 역할은 여기서 끝난다.
`[run]`으로 실행한다.

---

## Principles

1. **능동적 intent discovery** — 사용자가 명확히 하지 않은 것을 적극적으로 발굴한다. 인터뷰를 통해 말 뒤에 있는 근본 목표를 드러낸다.
2. **Lead = 종합자이자 참여자** — Lead는 서브에이전트 결과를 단순 중계하지 않는다. Lead는 자신의 입장을 형성하고, 권고를 내리며, 근거를 가지고 반박한다. Yes-man이 아니다.
3. **탐색 우선 + 선제적 확장** — planning을 시작하기 전에 코드/지식/외부 소스를 리서치한다. 근거 없는 질문은 절대 하지 않는다.
4. **가설 기반 질문** — 공허한 질문 대신, 리서치를 바탕으로 가설을 세우고 사용자에게 확인한다.
5. **Progressive Depth** — 요청 복잡도에 따라 planning 깊이와 HOW 서브에이전트 구성을 자동으로 조정한다.
6. **한 번에 하나** — 여러 안건을 동시에 제시하지 않는다. 사용자의 인지 부하를 줄인다.
7. **선택지는 반드시 pros/cons/trade-offs/recommendation 포함** — 권고할 때는 다른 선택지가 왜 부족한지 설명한다.
8. **객관적 반박** — 사용자가 강한 확신을 가지고 와도, Lead는 모든 실행 가능한 선택지를 독립적으로 분석하고 사용자가 고려하지 않았을 trade-off를 제시해야 한다. 비교 테이블은 사용자가 이미 믿는 것을 확인해주기 위한 것이 아니라, 사용자가 모르는 것을 드러내기 위해 존재한다. 더 나은 대안이 있으면 근거를 가지고 반박한다.
9. **기본은 자유 대화** — 자유 형식의 사용자 응답(선택지 조합, 반박, 후속 질문)이 planning 품질의 핵심이다.
10. **Dynamic agenda** — 결정이 새로운 질문을 만든다. Lead는 사용자가 빈 곳을 알아채기를 기다리지 않고 파생 안건을 선제적으로 드러낸다.

---

## State Management

### plan.json

`.nexus/state/plan.json` — MCP tools로 관리한다.

```json
{
  "id": 1,
  "topic": "topic name",
  "issues": [
    {
      "id": 1,
      "title": "issue title",
      "status": "pending"
    },
    {
      "id": 2,
      "title": "issue title",
      "status": "decided",
      "decision": "decision summary",
      "how_agents": ["architect", "designer"],
      "how_summary": {
        "architect": "key findings...",
        "designer": "key findings..."
      }
    }
  ],
  "research_summary": "...",
  "created_at": "2026-01-01T00:00:00Z"
}
```

- **Create**: `nx_plan_start(topic, issues, research_summary)` — Step 3에서 호출한다. 기존 plan.json이 있으면 자동으로 아카이브한다
- **Status**: `nx_plan_status()` — 현재 안건 상태 + 결정 확인
- **Update**: `nx_plan_update(action, ...)` — 안건 추가/제거/수정/재개
- **Decide**: `nx_plan_decide(issue_id, summary)` — 안건을 `decided`로 표시하고 인라인으로 decision을 기록
- **파일 존재 = 세션 진행 중**

### Topic Switching

- `[plan]` → plan.json이 있으면 기존 plan을 계속한다. 없으면 새 세션을 시작한다
- 태그 없이 대화 계속 → 기존 세션 유지
- 새 `nx_plan_start` 호출 → 새 plan 생성 전 현재 plan.json을 자동으로 아카이브한다

### Session Abort

세션을 중단하려면 `nx_task_close`로 현재 상태를 아카이브한다. 미완료 안건/태스크는 향후 참조를 위해 history.json에 기록된다.

---

## Self-Reinforcing Loop

```
[plan] start → check/continue existing plan.json (start new if none)
  ↓
Intent discovery → research (parallel subagents) → nx_plan_start (register issues)
  ↓
Per-issue: HOW subagent analysis (parallel, independent) → Lead synthesis
  → options comparison → [d] → nx_plan_decide
  → dynamic agenda check → propose derived issues if found
  ↓
Next issue → ... → gap check → planning complete
  ↓
Proceed with `[run]` to execute.
  ↓
[run]: execution skill handles the full pipeline
  ↓
All done → nx_task_close (handled by run skill)
```

gate.ts는 `[d]`를 감지하여 plan.json이 있으면 `nx_plan_decide`로 라우팅한다. 없으면 차단한다.

## Deactivation

`[run]`으로 전환할 때 Plan의 역할은 끝난다. 실행은 run skill이 처리한다.
