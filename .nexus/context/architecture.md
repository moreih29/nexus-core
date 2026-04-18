# nexus-core 아키텍처

> 구조 — 패키지 배치와 자기 적용된 .nexus/. 에이전트 조율 모델은 [`orchestration.md`](./orchestration.md) 참조.

## 1. 패키지 구조

루트는 4 분류로 정돈: **자산(`assets/`)** · **문서(`docs/`)** · **코드(`src/` · `dist/` · `scripts/`)** · **메타(`manifest.json` · `.nexus/`)**.

| 경로 | 역할 |
|---|---|
| `assets/agents/` | 에이전트 정의 (body.md + meta.yml). HOW · DO · CHECK 분류. |
| `assets/skills/` | 스킬 정의 (body.md + meta.yml). |
| `assets/vocabulary/` | 카테고리·태그·권한·등급·기억 정책 등 표준 어휘. |
| `assets/schema/` | JSON Schema (draft 2020-12). |
| `assets/conformance/` | 도구 · 시나리오 · 생애주기 · 상태 스키마 검증 데이터. |
| `docs/contract/` | consumer가 따라야 할 규범 명세. |
| `docs/consuming/` | consumer 구현 가이드. |
| `src/` | 배포 TS 소스. MCP 서버 (`mcp/`) · LSP 통합 (`lsp/`) · 공통 인프라 (`shared/`) · 타입 (`types/`). 상세는 [`mcp-server.md`](./mcp-server.md). |
| `dist/` | 컴파일 출력 (.js + .d.ts). git에서 제외, npm 배포 시에만 포함. |
| `scripts/` | 개발 전용 내부 도구 (검증 · manifest 생성 · 배포). |
| `manifest.json` | 배포 메타데이터 (위 자산 구조의 자동 생성 스냅샷). |
| `.nexus/` | nexus-core가 자기 자신에게 적용한 nexus. |

## 2. `.nexus/` 자기 적용

### 2-1. 디렉토리

| 경로 | 역할 | 변경 빈도 | 형식 |
|---|---|---|---|
| `.nexus/context/*.md` | 프로젝트 골격(설계 철학·구조). | 낮음 | markdown |
| `.nexus/memory/` | 동적 기억. 3 카테고리(`empirical-` · `external-` · `pattern-`) 접두사 기반. | 높음 | markdown |
| `.nexus/rules/` | 에이전트·스킬 프롬프트에 자동 주입되는 보조 프롬프트. 파일 이름이 곧 트리거. | 중간 | markdown |
| `.nexus/state/sessions/<session_id>/` | 세션별 작업 상태. 멀티세션 허용. | 매 작업 | json + jsonl |
| `.nexus/state/memory-access.jsonl` | 기억 파일 읽기 누적 이벤트 로그. 강화/망각 신호 원천. | 매 읽기 | jsonl |
| `.nexus/history.json` | 프로젝트 레벨 누적 보관소. cycles 배열, read-modify-write. | 세션 종료 시 | json |
| `.nexus/.gitignore` | 화이트리스트 정책. | 거의 없음 | git |

### 2-2. 세션 상태 파일

`.nexus/state/sessions/<session_id>/` 내부:

- `tasks.json` — 작업 목록 스냅샷
- `plan.json` — 계획 + 이슈 + 결정 스냅샷
- `agent-tracker.json` — 하위 에이전트 생성 추적 스냅샷
- `tool-log.jsonl` — 도구 호출 누적 로그

### 2-3. json vs jsonl

- **스냅샷 = `.json`** — 파일 전체가 한 시점의 완전한 상태. tasks · plan · agent-tracker · history.
- **누적(추가 전용) = `.jsonl`** — 한 줄에 1 레코드. tool-log · memory-access.

### 2-4. 멀티세션과 동시성

- 한 프로젝트에서 여러 세션 동시 활성 허용. 각 세션은 git 워크트리에서 격리.
- 세션 로컬 파일은 네임스페이스 분리로 시스템적 쓰기 충돌 0.
- 프로젝트 공유 jsonl(`memory-access.jsonl` · `tool-log.jsonl`)은 git union merge로 처리. `history.json`은 read-modify-write라 union merge 부적합 — 락 + atomic write로 처리.
