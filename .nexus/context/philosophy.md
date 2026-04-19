# nexus-core 철학

> nexus-core는 3 하네스(Claude Code · OpenCode · Codex)의 Nexus 플러그인을 위한 공통 라이브러리다.

## 1. 목적

멀티 에이전트를 효과적으로 조율하기 위해, 3 하네스가 공유하는 두 자산을 한 곳에서 정의한다.

- **에이전트 조율 계층**: HOW · DO · CHECK 3종 분류 + Lead 주재 모델
- **공통 빌드 도구**: 에이전트·스킬 원본(`assets/`)을 3 하네스 네이티브 형식으로 변환하는 빌드 파이프라인 (`build-agents.ts` · `build-hooks.ts`) + 통합 CLI (`nexus-core`). `capability-matrix.yml`과 `tool-name-map.yml invocations` 2종 SSOT가 하네스별 편차를 단일 정의로 흡수한다.

이를 통해 3 하네스 간 구현 편차를 방지하고 동일 철학이 일관되게 전파된다.

## 2. 원칙

## 3. 비목표

- 플러그인 자체의 빌드·배포·실행 — 하네스 책임.
- 도구·훅의 실제 구현 코드 — 하네스 책임.
