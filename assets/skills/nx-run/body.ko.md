---
name: nx-run
description: Execution — user-directed agent composition.
summary: "Execution — user-directed agent composition"
triggers:
  - run
harness_docs_refs:
  - resume_invocation
id: nx-run
---

## Role

사용자가 [run] 태그를 호출할 때 Lead가 따르는 실행 규범이다. 사용자 지시에 따라 서브에이전트를 동적으로 조합하고, intake부터 완료까지 전체 실행 파이프라인을 구동한다.

## Constraints

- NEVER modify files via shell commands (sed, echo redirection, heredoc, tee, etc.) — harness의 전용 파일 편집 primitive를 항상 사용한다 (gate 강제)
- NEVER terminate while pending tasks remain (Gate Stop nonstop)
- NEVER spawn a new branch without checking for main/master first
- MUST check tasks.json before executing — 없으면 먼저 plan을 생성한다
- MUST spawn subagents per-task based on owner field — 태스크 수 ≥ 2 또는 대상 파일 ≥ 2인 경우 Lead 단독으로 처리하지 않는다
- MUST NOT spawn parallel Engineers if their target files overlap — 겹치면 직렬화한다
- MUST call nx_task_close before completing the cycle — plan+tasks를 history.json에 아카이브한다

## Guidelines

## Flow

### Step 1: Intake (Lead)

- **사용자가 에이전트/방향을 지정** → 지시를 그대로 따른다.
- **[run] only (방향 없음)** → 진행 전 사용자에게 방향을 확인한다.
- 사용자가 SCOPE와 구성을 결정한다. 명시되지 않은 부분은 Lead가 채운다.
- **Branch Guard**: main/master에 있으면 진행 전에 태스크 유형에 맞는 브랜치를 생성한다 (prefix: `feat/`, `fix/`, `chore/`, `research/` 등 — Lead의 판단). 사용자 확인 없이 자동 생성한다.
- `tasks.json` 확인:
  - **존재** → 읽고 Step 2로 진행한다.
  - **없음** → `{{skill_activation skill=nx-plan mode=auto}}`를 자동 호출하여 tasks.json을 생성한다. 묻지 않는다 — `[run]`은 실행 의도를 내포한다. plan 생성 후 Step 2로 진행한다.
- tasks.json이 존재하면 `nx_plan_status`로 기존 결정을 확인한다.

### Step 1.5: TUI Progress

시각적 진행 추적(Ctrl+T)을 위해 태스크를 등록한다:

- **태스크 ≤ 10개**: 태스크당 `{{task_register label="<per-task label>" state=pending}}`
- **태스크 > 10개**: `plan_issue`로 그룹화하여 그룹당 `{{task_register label="<group label>" state=pending}}`
- 실행이 진행됨에 따라 `{{task_register label="<label>" state=in_progress}}` / `{{task_register label="<label>" state=completed}}`로 등록 항목을 업데이트한다
- **건너뛰는 경우**: non-TTY 환경 (VSCode, headless)
- **Known issue**: auto-compact 중 TUI가 멈출 수 있다 (#27919) — 디스크의 태스크 데이터는 정확하게 유지된다

### Step 2: Execute

- **tasks.json을 사용자에게 제시한다** — owner, deps, approach 요약과 함께 태스크 목록을 보여준다. 확인을 묻지 않고 즉시 진행한다.
- `owner` 필드에 따라 태스크를 실행한다:
  - `owner: "lead"` → Lead가 직접 처리한다
  - `owner: "engineer"`, `"researcher"`, `"writer"` 등 → owner 역할에 맞는 서브에이전트를 스폰한다
  - `owner: "architect"`, `"tester"`, `"reviewer"` 등 → 해당 HOW/CHECK 서브에이전트를 스폰한다
- 각 서브에이전트에게 태스크의 `context`, `approach`, `acceptance`를 프롬프트로 전달한다.
- **병렬 실행**: 독립적인 태스크(대상 파일이 겹치지 않고, deps 없음)는 병렬로 스폰할 수 있다. 대상 파일이 공유되는 태스크는 직렬화해야 한다.
- **SubagentStop 에스컬레이션 체인**: 서브에이전트가 미완성 상태로 종료되면:
  1. **Do/Check 실패** → 해당 HOW 에이전트를 스폰하여 (예: Engineer 실패 → Architect) 실패를 진단하고, 접근법을 검토하며, 조정안을 제안하게 한다.
  2. **재위임** → HOW의 조정된 접근법을 적용하여 새 Do/Check 에이전트에게 재위임한다.
  3. **HOW도 실패** → Lead가 진단 내용과 함께 사용자에게 실패를 보고하고 방향을 요청한다.
  - 최대: 태스크당 HOW 진단 1회 + 재위임 1회. 이후에는 사용자에게 에스컬레이션한다.
  - 관련 HOW 매핑: Engineer→Architect, Writer→Strategist, Researcher→Postdoc, Tester→Architect.

### Resume Dispatch Rule

각 태스크에 대해 Lead는 `owner`의 `resume_tier`에 따라 새로 스폰할지 resume할지 결정한다:

1. `agents/{owner}.md` frontmatter에서 `resume_tier`를 조회한다 (없으면 → `ephemeral`로 처리).
2. `ephemeral`이면 → 새로 스폰한다. 종료.
3. `bounded`이면 → tasks.json 이력을 확인한다: 동일 `owner`가 겹치는 대상 파일에 이전에 작업했는가? 그렇고 다른 에이전트의 개입 편집이 없으면 → resume 후보. 아니면 새로 스폰. resume 프롬프트에는 항상 "수정 전 대상 파일을 다시 읽을 것" 지시를 포함한다.
4. `persistent`이면 → 이번 실행에서 동일 에이전트가 이전에 작업했으면 기본적으로 resume한다. 크로스 태스크 재사용 허용.
5. resume 시도 전 harness의 resume 메커니즘이 사용 가능한지 확인한다. 사용 불가이면 오류를 발생시키지 않고 조용히 새로 스폰으로 폴백한다.

### Step 3: Verify (Lead + Check subagents)

**Lead**: 빌드 + E2E 통과/실패 여부를 확인한다.

**Tester — acceptance criteria 검증**:
- Tester는 tasks.json에서 완료된 각 태스크의 `acceptance` 필드를 읽는다
- 각 기준을 PASS/FAIL로 판정한다
- 태스크를 완료로 간주하려면 모든 기준을 통과해야 한다
- 기준 하나라도 실패 → Step 2 재작업 (태스크 재개)
- Tester 스폰 조건 (하나라도 해당되면):
  - tasks.json에 `acceptance` 필드가 있는 태스크가 1개 이상
  - 변경된 파일이 3개 이상
  - 기존 테스트 파일이 수정됨
  - 외부 API/DB 접근 코드가 변경됨
  - 해당 영역의 실패 이력이 memory에 존재

**Reviewer — writer 산출물 검증**:
- Step 2에서 Writer가 산출물을 생성한 경우, Reviewer가 반드시 검증해야 한다
- Writer → Reviewer는 선택이 아닌 필수 페어링이다
- Reviewer 확인 항목: 사실 정확성, 소스 일관성, 문법/형식

- 문제 발견 시: 코드 문제 → Step 2 재작업; 설계 문제 → 재실행 전 nx-plan을 다시 수행한다.

### Step 4: Complete

순서대로 실행한다:

1. **nx-sync**: 이번 사이클에 코드 변경이 있었으면 `{{skill_activation skill=nx-sync}}`를 호출한다. Best effort — 실패해도 사이클 완료를 막지 않는다.
2. **nx_task_close**: 호출하여 plan+tasks를 history.json에 아카이브한다. `.nexus/history.json`이 업데이트된다.
3. **git commit**: 소스 변경, 빌드 artifact (`bridge/`, `scripts/`), `.nexus/history.json`, 수정된 `.nexus/memory/` 또는 `.nexus/context/`를 스테이징하고 커밋한다. 명시적인 `git add`에 경로를 지정한다 (`git add -A` 사용 금지). `Co-Authored-By`가 포함된 HEREDOC 커밋 메시지를 사용한다. 이렇게 하면 사이클의 history 아카이브가 코드 변경과 같은 커밋에 포함되어 1:1 사이클-커밋 매핑이 보장된다.
4. **Report**: 사용자에게 요약 보고 — 변경된 파일, 적용된 핵심 결정, 권장 다음 단계. Merge/push는 사용자의 결정이며 이 스킬의 SCOPE 밖이다.

---

## Reference Framework

| Phase | Owner | Content |
|-------|-------|---------|
| 1. Intake | Lead | 의도 파악, 방향 확인, Branch Guard, tasks.json 확인 / 없으면 nx-plan 호출 |
| 2. Execute | Do subagents | owner별 태스크당 스폰, 위임 기준, 안전한 경우 병렬 실행 |
| 3. Verify | Lead + Check subagent | 빌드 확인, 품질 검증 |
| 4. Complete | Lead | nx-sync, nx_task_close, git commit, 보고 |

---

## Structured Delegation

Lead가 서브에이전트에게 태스크를 위임할 때, 다음 형식으로 프롬프트를 구성한다:

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

## Key Principles

1. **Lead = 사용자 지시 해석 + 조율 + 태스크 직접 처리**
2. **사용자가 SCOPE와 구성을 결정한다**
3. **tasks.json이 상태의 단일 진실 소스** — nx-plan이 생성하고, Step 1에서 읽으며, 태스크가 완료됨에 따라 업데이트된다
4. **Do subagents = owner별 실행** — Lead는 `owner` 필드에 따라 태스크당 하나의 서브에이전트를 스폰한다. Engineer는 코드 변경에 집중한다. 문서 업데이트는 Step 4에서 Writer가 일괄 처리한다. Researcher는 즉시 reference/에 기록한다.
5. **Check subagents = 검증** — Lead의 판단 + 4가지 조건
6. **SubagentStop 에스컬레이션** — 서브에이전트가 미완성 상태로 종료되면 HOW 진단 → 재위임 → 사용자 보고 순으로 에스컬레이션한다. 태스크당 최대 1사이클.
7. **Gate Stop nonstop** — 미결 태스크가 존재하는 동안 종료할 수 없다
8. **Plan first** — tasks.json이 없으면 Step 2 전에 반드시 nx-plan을 실행한다
9. **shell 명령으로 파일 수정 금지** — sed, echo redirection, heredoc, tee 및 유사한 shell 기반 파일 편집은 금지된다. harness의 전용 파일 편집 primitive를 항상 사용한다 (gate 강제)

## State Management

`.nexus/state/tasks.json` — nx-plan이 생성하고 `nx_task_add`/`nx_task_update`로 관리한다. Gate Stop 강제.
사이클 종료 시 `nx_task_close`를 통해 plan+tasks를 `.nexus/history.json`에 아카이브한다.
