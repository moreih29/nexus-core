---
name: nx-sync
description: Context knowledge synchronization — scans project state and updates
  .nexus/context/ design documents
summary: "Context knowledge synchronization"
triggers:
  - sync
id: nx-sync
---

## Role

현재 프로젝트 상태를 스캔하고 `.nexus/context/` 설계 문서를 동기화한다. git diff를 사용하여 코드 변경 사항을 식별한 뒤, 코드만으로는 추론할 수 없는 추상 설계 문서(원칙, 철학, 개발 스택, 아키텍처 결정)를 업데이트한다.

## Constraints

- 기존 context 파일을 절대 삭제하지 않는다 — 업데이트하거나 추가만 한다
- 소스 코드를 절대 수정하지 않는다 — 이 skill은 문서만 업데이트한다
- 소스에서 확인할 수 없는 정보는 추측하지 않는다 — 대신 "needs verification"으로 표시한다
- 기존 내용 구조를 반드시 보존한다 — 전체 파일을 불필요하게 재작성하지 않고 섹션만 업데이트한다
- 사용 중단된 MCP 지식 도구는 절대 사용하지 않는다 — harness의 파일 읽기 및 파일 생성 프리미티브만 사용한다

## Guidelines

## Trigger

- `[sync]` — 현재 프로젝트 상태와 `.nexus/context/`를 동기화한다

## Process

### Step 1: Gather Sources

모든 사용 가능한 소스에서 정보를 수집한다:

1. **git diff** — `git diff --name-only HEAD~10..HEAD` 실행 (또는 최근 커밋을 사용하여 변경된 파일 식별)
   - 어떤 소스 파일이 변경되었는지 식별한다
   - 어떤 context 문서가 오래되었는지 판단하는 1차 신호
2. **대화 context** — 현재 세션에서 사용 가능한 경우
   - 논의되었으나 아직 context 문서에 반영되지 않은 설계 결정
   - 모든 업데이트의 보조 소스

### Step 2: Read Current Context

harness의 파일 읽기 프리미티브를 사용하여 `.nexus/context/`의 모든 파일을 읽는다:

- 파일 목록 확인: `ls .nexus/context/`
- 각 파일을 읽어 현재 문서화된 상태를 파악한다
- 감지된 변경 사항과 비교하여 누락되거나 오래된 내용을 식별한다

구체적인 변경이 감지된 파일만 업데이트한다. 오래된 내용이 없으면 "already current"를 보고하고 건너뛴다.

### Step 3: Execute Updates

Writer agent를 스폰하여 영향받은 context 문서를 업데이트한다:

```
{{subagent_spawn target_role=writer name=writer-sync-context prompt=>>WRITER_SYNC_PROMPT}}
Update .nexus/context/ documents based on the following changes. Read current files with the harness's file-reading primitive, then write updates with the harness's file-creation primitive. Changes: {change_manifest}
<<WRITER_SYNC_PROMPT
```

Writer agent:
- harness의 파일 읽기 프리미티브로 각 관련 context 파일을 읽는다
- 오래된 섹션만 수정하는 표적 업데이트를 적용한다
- harness의 파일 생성 프리미티브로 업데이트된 파일을 다시 작성한다
- 이미 정확한 파일은 재작성하지 않는다

### Step 4: Report

다음을 사용자에게 보고한다:
- 스캔한 context 파일
- 업데이트된 파일과 변경된 내용
- 이미 최신 상태인 파일
- "needs verification"으로 표시된 항목

## Key Principles

1. **전체 재작성보다 표적 업데이트** — 실제로 오래된 섹션만 변경한다
2. **증거 기반** — 모든 업데이트는 소스(git diff 또는 대화)를 추적할 수 있어야 한다
3. **구조 보존** — 기존 문서 구성, 헤딩, 형식을 유지한다
4. **추측 금지** — 변경 사항이 context 문서에 미치는 영향이 불명확하면 추측하지 않고 표시한다

## What .nexus/context/ Contains

Context 문서는 소스 코드에서 직접 읽을 수 없는 추상 지식을 담는다:

- 설계 원칙 및 철학
- 아키텍처 결정과 그 근거
- 개발 스택 선택과 제약
- 프로젝트 컨벤션과 표준

이 문서들은 코드 변경이 원칙의 전환을 반영하거나, 새로운 아키텍처 결정이 내려지거나, 개발 스택이 변화할 때 업데이트된다. 기저 설계를 변경하지 않는 일상적인 코드 추가에는 업데이트하지 않는다.
