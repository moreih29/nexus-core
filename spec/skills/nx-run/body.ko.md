---
id: nx-run
name: nx-run
description: Execution — user-directed agent composition.
triggers:
  - run
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
- 같은 타이밍에 `{{task_register label="<label>" state=in_progress}}` / `{{task_register label="<label>" state=completed}}`로 진행 추적도 갱신한다. 초기 등록 때 정한 label을 그대로 재사용한다.

### 재개 라우팅 규칙

`nx_task_resume`가 반환하는 `resume_tier` 값에 따라 Lead가 행동한다.

- `ephemeral` → 새로 스폰한다.
- `bounded` → 동일 owner가 겹치는 대상 파일에 이전 작업이 있고 중간에 다른 에이전트 편집이 없으면 재개한다. 재개 프롬프트에 "수정 전 대상 파일을 다시 읽을 것" 지시를 반드시 포함한다.
- `persistent` → 이번 실행에서 동일 에이전트가 이전 태스크에 참여했으면 재개한다. 크로스 태스크 재사용 허용.

재개 메커니즘이 사용 불가이면 오류 없이 새로 스폰으로 폴백한다.

### 에스컬레이션 체인

Do와 Check의 핑퐁을 기본 경로로 삼는다. Check가 연속 2회 실패하면 HOW로, HOW 검토 후에도 실패하면 Lead가 사용자에게 에스컬레이션한다.

최대 경로:

```
Do → Check(실패) → Do → Check(실패) → HOW(검토) → Do → Check(실패) → Lead → 사용자
```

- **Check 1회 실패** → 같은 Do에게 재위임(재개 가능)해 실패 피드백을 전달하고 수정 후 다시 Check를 돌린다.
- **Check 2회 연속 실패** → 태스크 도메인에 맞는 HOW 에이전트를 Lead가 선정·스폰해 접근법을 검토·조정받고 Do로 재위임한다.
- **HOW 검토 후에도 Check 실패** → Lead가 진단 내용과 함께 사용자에게 보고하고 방향을 요청한다.

### 3단계: 검증

각 태스크의 `acceptance` 필드를 기준으로 Check 서브에이전트가 자율적으로 검증한다. 세부 판정 방식은 서브에이전트에게 맡긴다.

- **Tester** — 코드 검증 (engineer 산출물).
- **Reviewer** — 문서 검증 (writer 산출물).

검증 실패는 위의 에스컬레이션 체인을 따른다.

### 4단계: 완료

순서대로 실행한다.

1. **`nx_task_close`**: plan+tasks를 `.nexus/history.json`에 아카이브한다. `plan.json`과 `tasks.json`이 제거된다.
2. **git commit**: 소스 변경, 빌드 아티팩트(`bridge/`, `scripts/`), `.nexus/history.json`, 수정된 `.nexus/memory/` 또는 `.nexus/context/`를 한 커밋으로 묶어 사이클-커밋 1:1 매핑을 유지한다. `git add -A` 대신 명시적 경로를 쓴다.
3. **보고**: 변경된 파일, 적용된 핵심 결정, 권장 다음 단계를 사용자에게 요약한다. Merge/push는 사용자의 결정이며 이 스킬의 scope 밖이다.

---

## 전체 흐름표

| 단계 | 담당 | 내용 |
|---|---|---|
| 1. 준비 | Lead | Branch Guard, `nx_task_list`로 tasks.json 확인 / 없으면 nx-auto-plan 호출 |
| 2. 실행 | Do 서브에이전트 | owner별 스폰, `nx_task_resume`로 재개 판단, `nx_task_update`로 상태 전환 |
| 3. 검증 | Check 서브에이전트 | `acceptance` 기준으로 Tester(코드)/Reviewer(문서) 검증 |
| 4. 완료 | Lead | `nx_task_close`, git commit, 보고 |

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
