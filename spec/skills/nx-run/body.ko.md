---
id: nx-run
name: nx-run
description: Execution — user-directed agent composition.
triggers:
  - "[run]"
---

## 역할

사용자가 `[run]` 태그를 호출할 때 Lead가 따르는 실행 규범이다. tasks.json을 읽어 `owner` 필드에 따라 서브에이전트를 동적으로 조합하고, 실행-검증-완료 사이클을 구동한다.

## 핵심 규칙

- **계획 없이 실행하지 않는다.** tasks.json이 없으면 먼저 nx-auto-plan을 호출해 계획을 세운 뒤 돌아온다.
- **태스크는 `owner`가 실행 주체다.** Lead 단독 처리보다 owner에 맞는 서브에이전트 위임을 기본으로 한다.
- **미완료 태스크가 남아 있으면 중단하지 않는다.** `nx_task_list`로 모든 태스크가 `completed`인지 확인할 때까지 사이클을 이어간다.
- **main/master에서는 작업하지 않는다.** 실행 시작 전에 태스크 유형에 맞는 브랜치로 이동한다.

## 절차

### 1단계: 준비

- **Branch Guard**: main/master에 있으면 태스크 유형에 맞는 브랜치를 생성하고 이동한다 (prefix: `feat/`, `fix/`, `chore/`, `research/` 등 — Lead의 판단).
- **tasks.json 로드**:
  - **존재** → `nx_task_list`로 목록을 읽고 `nx_plan_status`로 기존 결정을 확인한다.
  - **없음** → `{{skill_activation skill=nx-auto-plan}}`을 자동 호출해 tasks.json을 생성한다. `[run]`은 실행 의도를 내포하므로 사용자에게 묻지 않는다.

### 2단계: 실행

#### 태스크 등록

각 태스크에 대해 `{{task_register label="<label>" state=pending}}`을 호출해 진행 추적을 등록한다. 등록 항목은 최대 10개로 유지한다. 태스크가 10개를 넘으면 `plan_issue`나 대상 파일 등 자연스러운 묶음 기준으로 연관 태스크를 엮어 등록 항목이 10개 이내가 되도록 조정한다.

#### 태스크 디스패치

- `owner` 필드에 따라 태스크를 실행한다.
  - `owner: "lead"` → Lead가 직접 처리한다.
  - 그 외 → owner 역할에 맞는 서브에이전트를 스폰한다.
- 각 서브에이전트에게 태스크의 `context`, `approach`, `acceptance`를 프롬프트로 전달한다.
- **재개 판단**: 각 태스크마다 `nx_task_resume`로 재개 라우팅 정보를 조회하고, 아래 재개 라우팅 규칙에 따라 새로 스폰할지 재개할지 결정한다.
- **병렬 실행**: deps가 없는 태스크는 병렬로 스폰할 수 있다. 대상 파일이 겹치는 태스크는 직렬화한다.

#### 상태 전환

- 태스크 시작 시 `nx_task_update`로 `in_progress`, 완료 시 `completed`로 전환한다.
- 태스크를 `completed`로 전환할 때 같은 `nx_task_update` 호출에 `result: {outcome, summary, artifacts?}`를 함께 포함한다. `recorded_at`은 서버 스탬프. `status`는 워크플로우 단계, `result.outcome`은 결말을 나타내며 두 필드는 직교한다.
- 서브에이전트를 새로 스폰한 경우 같은 `nx_task_update` 호출에 `owner={role, agent_id: <스폰에서 얻은 id>, resume_tier: <ephemeral|bounded|persistent>}`를 함께 넘겨 이후 `nx_task_resume`가 이 id를 돌려줄 수 있게 한다.
- 같은 타이밍에 `{{task_register label="<label>" state=in_progress}}` / `{{task_register label="<label>" state=completed}}`로 진행 추적도 갱신한다. 초기 등록 때 정한 label을 그대로 재사용한다.

### 재개 라우팅 규칙

`nx_task_resume`가 반환하는 `resume_tier`와 `agent_id` 값에 따라 Lead가 행동한다.

- `ephemeral` → 새로 스폰한다.
- `bounded` → 동일 owner가 겹치는 대상 파일에 이전 작업이 있고 중간에 다른 에이전트 편집이 없으면 재개한다. 재개 프롬프트에 "수정 전 대상 파일을 다시 읽을 것" 지시를 반드시 포함한다.
- `persistent` → 이번 실행에서 동일 에이전트가 이전 태스크에 참여했으면 재개한다. 크로스 태스크 재사용 허용.

재개가 결정되면 `nx_task_resume`가 반환한 `agent_id`로 `{{subagent_resume agent_id="<id>" prompt="<재개 프롬프트>"}}` 도구를 호출한다. 재개 프롬프트는 매번 새로 제공한다 — 일부 하네스(OpenCode)는 실행 중 session에 추가 입력을 push하는 경로가 없고, idle session에 새 prompt를 주입하는 방식으로만 재개를 지원한다.

`nx_task_resume`가 `agent_id: null`을 반환하거나 하네스가 해당 id를 더 이상 찾지 못하면 오류 없이 새로 스폰으로 폴백한다.

### 에스컬레이션 체인

Check 결과를 받은 뒤 Lead가 라우팅한다. Verdict와 Flagged issues 분류 두 입력을 본다.

#### Verdict 입력

| 검증자 | PASS | 라우팅 진입 |
|---|---|---|
| Tester | PASS | FAIL |
| Reviewer | APPROVED | REVISION_REQUIRED · BLOCKED |

#### 라우팅 규칙

Lead는 Check 보고서의 Flagged issues 분류로 다음 액션을 결정한다.

| Flagged issues 분류 | 다음 액션 |
|---|---|
| 설계 결함 · 아키텍처 변경 필요 | 도메인 매칭 HOW 스폰 → 자문 → Do 재위임 |
| 범위 충돌 · 사용자 결정 필요 · 판단 모호 | 사용자 보고 · 방향 요청 |
| 환경 문제 · 검증 불가(UNVERIFIABLE 포함) | 환경 수정·재시도. 해소 불가하면 사용자 보고 |
| 그 외 (단순 실패) | same Do 재위임 (카운트 +1) |

분류 명확한 실패는 카운트 0회에서도 즉시 분기한다. 단순 실패만 누적 카운트 대상.

#### 단순 실패 누적 카운트

```
Do → Check(실패) → Do → Check(실패) → HOW → Do → Check(실패) → Lead → 사용자
```

- **1회** → same Do 재위임 (실패 피드백 첨부)
- **2회 연속** → 도메인 매칭 HOW 스폰 → 접근법 자문 → Do 재위임
- **HOW 자문 후에도 실패** → 진단 내용과 함께 사용자 보고, 방향 요청

#### Do 도중 통보 처리

Do/Check 에이전트는 자체 본문 정의에 따라 task 도중 또는 완료 보고에서 직접 통보를 보낼 수 있다. Lead는 그 통보를 받으면 위 라우팅 규칙을 즉시 적용한다 — 체인 카운트와 무관하다.

### 3단계: 검증

Lead는 각 태스크의 `acceptance` 필드를 Check 서브에이전트에 넘겨 검증을 위임한다. 세부 판정 방식은 서브에이전트의 자율 영역.

- **Tester** — 코드 검증 (engineer 산출물).
- **Reviewer** — 문서 검증 (writer 산출물).

검증 실패는 위의 에스컬레이션 체인을 따른다.

### 4단계: 사이클 종료 검토

모든 태스크가 `completed` 상태가 된 뒤 Lead가 사이클을 검토하고 종료 여부를 판단한다.

**검토 범위**

- 원래 사용자 요청과 결과의 정렬 — 빠진 영역이 있는가
- 태스크 간 산출물 통합 — 결과들이 서로 모순 없이 작동하는가
- 요청 안에서 명시되지 않았지만 의도상 필요한 후속이 있는가

**HOW 자문**

기본적으로 도메인 매칭 HOW를 스폰해 cross-task 검토를 받는다 — 코드는 Architect, UX는 Designer, 리서치 방법론은 Postdoc. **자문하지 않을 경우 사이클 종료 보고에 사유를 명시한다** — 정당 사유 예시: 기존 결정·회고가 사이클 결과를 이미 커버 / 단일 태스크 사이클로 cross-task 검토 대상이 없음 / 변경 반경이 한 모듈에 집중되고 비가역성이 낮음.

`nx_plan_analysis_add`로 사이클 종료 합성이나 태스크 실패 주석을 기록할 때 `role='retrospective'`(사이클 종료 합성)와 `role='failure-note'`(태스크 실패 주석)를 예약어로 사용한다. 두 값은 `nx_history_search`의 분류 기준이 되며, 그 외 임의 role 값도 허용된다.

**판단 결과별 액션**

| 판단 | 액션 |
|---|---|
| 추가 작업 없음 | 5단계 완료로 진입 |
| 누락 발견 | `nx_task_add`로 새 태스크 등록 → 2단계 실행 복귀 |
| 기존 태스크 재작업 필요 | `nx_task_update`로 재오픈 → 2단계 실행 복귀 |

**반복 한도**

검토는 사이클당 **최대 2회**(초기 + 재검토 1회). 추가 작업 후 모든 태스크가 다시 `completed`가 되면 2회째 검토를 수행한다. 2회째에도 누락이 남아 있으면 자동 등록 없이 사용자에게 보고하고 사이클 연장 여부를 결정 받는다 — 추가 사이클은 사용자 결정 영역.

**범위 규율**

원래 사용자 요청 커버리지 안에서만 누락을 잡는다. 요청 밖 품질 개선 아이디어는 새 plan 사이클로 미룬다 — 현 사이클의 scope creep을 막는다.

### 5단계: 완료

순서대로 실행한다.

1. **`nx_task_close`**: plan+tasks를 `.nexus/history.json`에 아카이브한다. `plan.json`과 `tasks.json`이 제거된다.
2. **git commit**: 소스 변경, 빌드 아티팩트(`bridge/`, `scripts/`), `.nexus/history.json`, 수정된 `.nexus/memory/` 또는 `.nexus/context/`를 한 커밋으로 묶어 사이클-커밋 1:1 매핑을 유지한다. `git add -A` 대신 명시적 경로를 쓴다.
3. **보고**: 아래 항목으로 사용자에게 요약한다. Merge/push는 사용자의 결정이며 이 스킬의 scope 밖이다.
   - **변경 사항**: 파일 경로와 요약
   - **주요 결정**: 범위·접근·트레이드오프
   - **다음 단계**: 후속 액션
   - **미해결 질문**: 해당 시
   - **리스크 / 불확실성**: "X가 Y 상황에서 실패할 수 있다" 형태, 해당 시

---

## 전체 흐름표

| 단계 | 담당 | 내용 |
|---|---|---|
| 1. 준비 | Lead | Branch Guard, `nx_task_list`로 tasks.json 확인 / 없으면 nx-auto-plan 호출 |
| 2. 실행 | Do 서브에이전트 | owner별 스폰, `nx_task_resume`로 재개 판단, `nx_task_update`로 상태 전환 |
| 3. 검증 | Check 서브에이전트 | `acceptance` 기준으로 Tester(코드)/Reviewer(문서) 검증 |
| 4. 사이클 종료 검토 | Lead (필요 시 HOW) | 사이클 차원 검토 후 추가 작업 등록 또는 종료 판단 |
| 5. 완료 | Lead | `nx_task_close`, git commit, 보고 |

---

## 구조화된 위임

Lead가 서브에이전트에게 태스크를 위임할 때 다음 형식으로 프롬프트를 구성한다.

```
TASK: {specific deliverable}

CONTEXT:
- Current state: {relevant code/doc locations}
- Dependencies: {results from prior tasks}
- Prior decisions: {relevant decisions}
- Target files: {file path list}

CONSTRAINTS:
- {constraint 1}
- {constraint 2}

ACCEPTANCE:
- {completion criterion 1}
- {completion criterion 2}
```

---

## 상태 관리

`.nexus/state/tasks.json`은 nx-plan 계열(plan/auto-plan)이 `nx_task_add`로 생성하고, nx-run 사이클 동안 `nx_task_update`로 상태 전환을 반영한다. 조회는 `nx_task_list`, 재개 판단은 `nx_task_resume`가 담당한다. 사이클 종료 시 `nx_task_close`를 호출해 plan+tasks를 `.nexus/history.json`에 아카이브한다.
