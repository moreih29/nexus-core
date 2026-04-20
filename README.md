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

**요구사항: Node.js 22 이상** (`import ... with { type: "json" }` 구문이 Node 22에서 stable입니다.)

```bash
node --version   # v22.0.0 이상 확인
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

## Consumer 통합 가이드

### 서브패스 경유 정책

`@moreih29/nexus-core`의 bare import(`import "@moreih29/nexus-core"`)는 의도적으로 비활성화되어 있습니다 (`"."` export = `null`). 모든 기능은 서브패스를 통해 접근해야 합니다.

| 서브패스 | 노출 내용 |
|---|---|
| `@moreih29/nexus-core/hooks/opencode-mount` | `mountHooks` 함수 |
| `@moreih29/nexus-core/hooks/runtime` | 런타임 유틸리티 |
| `@moreih29/nexus-core/hooks/opencode-manifest` | OpenCode hook JSON manifest |

### OpenCode 플러그인 thin-wrapper 예제

OpenCode 플러그인을 구축하는 가장 간단한 패턴은 다음과 같습니다.

```typescript
import type { Plugin } from "@opencode-ai/plugin";
import { mountHooks } from "@moreih29/nexus-core/hooks/opencode-mount";
import manifest from "@moreih29/nexus-core/hooks/opencode-manifest" with { type: "json" };

export const OpencodeNexus: Plugin = async (ctx) => mountHooks(ctx, manifest);
```

- `manifest`는 `./hooks/opencode-manifest` 서브패스를 통해 JSON으로 임포트합니다. Node 22의 `import ... with { type: "json" }` 구문이 필요합니다.
- `mountHooks(ctx, manifest)`는 manifest에 정의된 훅을 OpenCode context에 등록합니다.

전체 하네스별 통합 절차는 [`docs/plugin-guide.md`](./docs/plugin-guide.md)를 참조하세요.

---

## Consumer 하네스

| 하네스 | 플러그인 repo |
|---|---|
| Claude Code | claude-nexus |
| OpenCode | opencode-nexus |
| Codex | codex-nexus |
