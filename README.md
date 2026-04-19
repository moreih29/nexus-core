# nexus-core

3 하네스(Claude Code, OpenCode, Codex)의 Nexus 플러그인을 위한 공통 라이브러리.  
에이전트 조율 계층, 공통 빌드 도구, MCP 서버, 스킬·훅 자산을 단일 패키지로 제공합니다.

## 제공하는 것

1. **에이전트 조율 계층** — HOW / DO / CHECK 분류 + Lead 주재 (10 에이전트)
2. **공통 빌드 도구** — `nexus-core sync` / `init` / `validate` CLI
3. **MCP 서버** — 14개 도구를 stdio 서버로 제공 (`nexus-mcp`)
4. **하네스별 자산** — 스킬·훅·에이전트 정의, capability-matrix SSOT

## 제공하지 않는 것

실제 플러그인 빌드 및 배포는 개별 하네스 플러그인 repo의 책임입니다.

---

## Installation

```bash
bun add -D @moreih29/nexus-core
```

전역 설치 시 `nexus-core` CLI와 `nexus-mcp` MCP 서버가 PATH에 추가됩니다.

```bash
bun add -g @moreih29/nexus-core
nexus-core --help
```

---

## Quick Start

새 플러그인 repo를 시작하는 기본 흐름입니다.

```bash
# 1. 플러그인 스캐폴드 생성
bunx @moreih29/nexus-core init --harness=claude --target=./my-claude-plugin

# 2. 의존성 설치 후 자산 동기화
cd my-claude-plugin && bun install
bunx @moreih29/nexus-core sync --harness=claude --target=./

# 3. 변경 사항 확인 후 커밋
bunx @moreih29/nexus-core sync --harness=claude --target=./ --dry-run
git add . && git commit -m "Initial plugin scaffold"
```

전체 흐름과 하네스별 install 구현 가이드는 [`docs/plugin-guide.md`](./docs/plugin-guide.md)를 참조하세요.

---

## Documentation

| 문서 | 내용 |
|---|---|
| [`docs/plugin-guide.md`](./docs/plugin-guide.md) | 플러그인 저자용 end-to-end 통합 가이드 (sync · init · 하네스별 install · Lead 주입) |
| [`docs/consuming/`](./docs/consuming/) | 컨슈머 구현 가이드 (Claude · OpenCode · Codex 설치 절차) |
| [`docs/consuming/codex-lead-merge.md`](./docs/consuming/codex-lead-merge.md) | Codex AGENTS.md 수동 머지 절차 |
| [`.nexus/context/architecture.md`](./.nexus/context/architecture.md) | 패키지 구조 · 빌드 파이프라인 · Lead vs Hook 책임 경계 |

---

## Consumer 하네스

| 하네스 | 플러그인 repo |
|---|---|
| Claude Code | claude-nexus |
| OpenCode | opencode-nexus |
| Codex | codex-nexus |
