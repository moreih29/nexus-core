---
name: nx-init
description: Project onboarding — scan, mission, essentials, context generation
summary: "Project onboarding — scan, mission, essentials, context generation"
manual_only: true
harness_docs_refs:
  - instruction_file
  - slash_command_display
id: nx-init
---

## Role

프로젝트를 스캔하고 flat `.nexus/` 구조에 Nexus 지식을 구축한다. 최초 실행 시 5단계 전체 온보딩 시퀀스를 수행한다.

## Constraints

- 소스 코드를 절대 수정하지 않는다. instruction 파일의 project 섹션 외 부분을 줄이는 것은 이 skill의 책임이 아니다.
- 코드에서 확인할 수 없는 정보는 추론하거나 추측하지 않는다 — context/에 작성하지 않는다.
- 지식 파일에 secrets (API 키, credentials 등)를 저장하지 않는다.
- `--reset` 없이는 기존 파일을 덮어쓰지 않는다. 재개 시 기존 파일을 그대로 보존한다.
- instruction 파일의 project 섹션은 반드시 사용자 확인을 거쳐 작성한다.
- identity/, codebase/, reference/, core/ 경로를 참조하거나 생성하지 않는다.
- Essentials 섹션은 10줄을 초과하지 않는다. 항목이 더 필요하면 우선순위가 낮은 항목을 .nexus/context/로 이동한다.

## Guidelines

## Trigger

- 수동 트리거 — 전체 온보딩(또는 재개). harness 문서 참조: slash_command_display.
- `--reset` 플래그와 함께 수동 트리거 — 기존 `.nexus/` 지식을 백업하고 재온보딩. harness 문서 참조: slash_command_display.
- `--reset --cleanup` 플래그와 함께 수동 트리거 — 백업 목록 표시 + 선택적 삭제. harness 문서 참조: slash_command_display.

---

## Modes

### First Run (`.nexus/` flat 구조 없음)

5단계 전체 온보딩을 자동으로 실행한다.

감지 기준: `.nexus/context/`, `.nexus/memory/`, `.nexus/state/`, `.nexus/rules/`가 존재하지 않음.

### Resume (`.nexus/`가 부분적으로 존재)

기존 상태를 확인하고 첫 번째 미완료 단계부터 재개한다.

### Reset (`--reset`)

기존 `.nexus/` 지식 디렉터리를 `.nexus/bak.{timestamp}/`로 백업한 뒤 First Run으로 진입한다.

### Cleanup (`--reset --cleanup`)

백업 디렉터리 목록을 표시하고, 사용자가 삭제할 백업을 선택하도록 한다.

---

## Process

### Phase 0: Mode Detection

```
IF --reset --cleanup flag:
  .nexus/bak.*/ 디렉터리 목록을 표시
  `{{user_question question="Select a backup to delete (or cancel)" options=[<backup list...>, {label: Cancel, description: "Exit without changes"}]}}`를 통해 사용자에게 옵션 제시.
  선택한 백업을 삭제하고 종료

ELSE IF --reset flag:
  .nexus/{memory,context,state,rules}/ → .nexus/bak.{timestamp}/로 이동
  안내: "Existing knowledge has been backed up to .nexus/bak.{timestamp}/. Starting re-onboarding."
  → First Run으로 진입

ELSE IF .nexus/context/ 존재:
  → Resume으로 진입 (기존 단계 확인 후 재개)

ELSE:
  → First Run으로 진입 (Step 1부터)
```

---

## Steps

### Step 1: Project Scan

코드 구조와 기술 스택을 자동 감지한다. `.nexus/` 디렉터리 구조가 존재하지 않으면 생성한다.

디렉터리 생성 (shell 명령어 실행):
- `.nexus/memory/`
- `.nexus/context/`
- `.nexus/state/`
- `.nexus/rules/`

수집 항목:
- **디렉터리 구조**: 최상위 레이아웃, 주요 모듈/패키지
- **기술 스택**: 언어, 프레임워크, 런타임 (package.json, Cargo.toml, pyproject.toml, go.mod, build.gradle 등)
- **빌드/test 시스템**: 스크립트, CI 설정
- **기존 문서**: CLAUDE.md, README.md, docs/, .cursorrules 등
- **git context**: 최근 커밋, 브랜치 구조, 기여자

출력: 스캔 요약 (언어, 프레임워크, 구조 개요)

대규모 프로젝트(최상위 디렉터리 10개 이상 또는 파일 100개 이상)의 경우, Lead context 사용을 줄이기 위해 Explore subagent를 스폰하여 병렬 스캔을 수행하는 것을 고려한다.

### Step 2: Mission + Essentials (Interactive)

Step 1 스캔 결과를 바탕으로 Mission 문장(1–2줄)과 Essentials 목록 초안을 작성한 뒤, 한 번에 사용자에게 제시하여 확인을 받는다.

#### Essentials Guidelines

Essentials는 에이전트에게 필수적인 사실이다 — 알지 못하면 에이전트가 잘못된 결과를 낼 항목들이다. 판단 기준: **"이것을 모르면 에이전트가 잘못된 결과를 낼까?"** 그렇다면 → Essentials. 아니라면 → .nexus/context/.

다음 다섯 범주에서 초안을 작성한다 (해당되는 항목만 포함):

- **Tech stack** — 런타임, 언어, 패키지 매니저, 핵심 프레임워크. 비기본 도구는 표시한다 (예: npm 대신 bun, node 대신 deno).
- **Workflow** — 빌드, test, 배포 명령어. 커밋 전 필수 lint 또는 타입 검사 단계 등 반드시 따라야 하는 절차.
- **Constraints** — 사용 금지 도구, 패턴, 또는 접근법. 수정해서는 안 되는 디렉터리 또는 파일.
- **Domain** — 대상 사용자, 필수 용어 또는 톤, 연구 프로젝트의 컴플라이언스·규제 제약·방법론.
- **Conventions** — 일반 기본값에서 벗어난 명명, 구조, 또는 스타일. 에이전트가 추론하지 못할 프로젝트 고유 패턴.

감지된 기술 스택의 표준 기본값에 해당하는 항목은 포함하지 않는다. Essentials 섹션은 총 10줄을 초과하지 않는다.

#### Draft Presentation

다음 형식으로 전체 초안을 사용자에게 제시한다:

```
The following will be added to the instruction file (see harness docs: instruction_file) (existing content will not be changed):

<!-- PROJECT:START -->
## {project-name}

{mission 1-2 lines}

### Essentials
- {auto-detected item}
- {auto-detected item}
<!-- PROJECT:END -->

Any changes?
```

사용자의 확인 또는 수정 의견을 기다린다. 모든 변경 사항을 한 번에 반영한다 — Mission과 Essentials를 별도로 묻지 않는다.

확인 후, harness의 파일 편집 프리미티브를 사용하여 마커 안에 섹션을 instruction 파일에 작성한다. instruction 파일에 이미 `<!-- PROJECT:START -->` 마커가 있으면 그 사이 내용을 교체한다. instruction 파일이 존재하지 않으면 마커와 함께 새로 생성한다.

### Step 3: Context Knowledge Auto-Generation

Step 1 스캔 결과를 분석하여 `.nexus/context/`에 context 지식 문서를 생성한다.

원칙:
- 파일 이름과 내용은 프로젝트 특성에 따라 자유롭게 결정한다. 고정된 템플릿은 없다.
- 기존 문서는 정보 출처일 뿐 — 구조를 그대로 복제하지 않는다.
- 코드에서 확인할 수 없는 내용은 추측하여 작성하지 않는다.
- 보통 1–3개 파일로 충분하다. 파일이 많다고 좋은 것이 아니다.
- **추상 수준의 내용만 생성한다** — 설계 패턴, 아키텍처 방향, 모듈 관계, 컨벤션. 파일 목록, 함수 시그니처, import 맵 같은 코드 수준 세부 사항은 포함하지 않는다. 그런 내용은 코드에서 직접 읽을 수 있다.

생성 대상 (프로젝트 실제 필요에 따라 선택하고 명명):
- 개발 스택 (언어, 프레임워크, 런타임, 핵심 의존성, 빌드/test/배포 워크플로우)
- 설계 및 아키텍처 (모듈 관계, 데이터 흐름, 핵심 진입점, 컨벤션)
- 구현 세부 사항 (파이프라인 세부 사항, 설정 패턴, 파일 구조 컨벤션, 도구 제한 — instruction 파일에 담기엔 너무 구체적이지만 코드만으로는 파악하기 어려운 내용)

harness의 파일 생성 프리미티브를 사용하여 `.nexus/context/{chosen-name}.md`에 파일을 생성한다.

대규모 프로젝트의 경우, 주제별로 Writer subagent를 스폰하여 context 지식을 병렬로 생성한다. Lead가 조율하고 결과를 검토한다.

완료 시: "context knowledge N files generated" 출력

### Step 4: Rules Initial Setup (Optional)

팀 커스텀 rule이 필요한지 확인한다.

```
{{user_question question="Do you want to set up development rules now?" options=[{label: "Set up", description: "Coding conventions, test policy, commit rules, etc."}, {label: Skip, description: "Can be added later via [rule] tag"}]}}
```

"Set up" 선택 시: 스캔 결과를 바탕으로 초안을 제시 → 사용자 확인 → harness의 파일 생성 프리미티브를 사용하여 `.nexus/rules/{topic}.md`에 저장한다.

"Skip" 선택 시: 안내 후 Step 5로 진행한다.

### Step 5: Completion Summary

온보딩 결과 요약을 출력한다.

```
## Nexus Initialization Complete

### Generated Files
- instruction file: project section — mission and essentials (<!-- PROJECT:START/END -->)
- .nexus/context/: {생성된 파일 목록}
- .nexus/rules/: {생성된 파일 또는 "none (skipped)"}

### Next Steps
- [plan] — 실행 전 리서치, 분석, 계획 수립
- [run] — plan에서 실행
- `--reset` 플래그와 함께 수동 재실행 — 온보딩 재실행 (기존 지식은 백업됨). harness 문서 참조: slash_command_display.
```
