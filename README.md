# nexus-core

> Nexus 생태계의 Authoring layer. 프롬프트·neutral metadata·vocabulary의 canonical source.

`nexus-core`는 Nexus 생태계를 구성하는 세 하네스가 **공유**하는 에이전트 정의, 스킬 정의, 어휘를 담는 저장소입니다. 집행(execution) 로직은 포함하지 않습니다 — 그것은 각 하네스의 몫입니다.

## Positioning

Nexus 생태계는 세 층위로 나뉩니다. `nexus-core`는 가장 아래, **Authoring layer**에 위치합니다.

```
Supervision   (reserved)
                │  read-only
Execution     claude-nexus ↔ opencode-nexus ↔ codex-nexus
                │  read-only
Authoring     nexus-core   ← 이 저장소
```

현재 active 소비자는 세 Execution layer 하네스(`claude-nexus`, `opencode-nexus`, `codex-nexus`)이며, 모두 `nexus-core`를 **read-only**로 참조합니다. Supervision layer는 외부 감독자 consumer를 위해 예약된 자리입니다(과거 nexus-code 프로젝트가 이 layer를 구현했으나 2026-04-14 archived).

| Consumer | Layer | 하는 일 |
|---|---|---|
| [`claude-nexus`](https://github.com/moreih29/claude-nexus) | Execution | Claude Code 하네스 위에서 에이전트 조립·디스패치 |
| [`opencode-nexus`](https://github.com/moreih29/opencode-nexus) | Execution | OpenCode 하네스 위에서 에이전트 조립·디스패치 |
| [`codex-nexus`](https://github.com/moreih29/codex-nexus) | Execution | Codex 하네스 위에서 에이전트 조립·디스패치 |

## For Consumer Repositories

> 이 저장소는 **외부 사용자가 직접 설치하는 플러그인이 아닙니다**. Nexus 하네스(`claude-nexus`, `opencode-nexus`, `codex-nexus`)를 사용하려면 해당 저장소의 안내를 따르세요.

Consumer 저장소(`claude-nexus`, `opencode-nexus`, `codex-nexus`)의 LLM 에이전트가 `@moreih29/nexus-core` 버전 업그레이드를 처리해야 하는 경우, **[CONSUMING.md](./CONSUMING.md)**의 Upgrade Protocol을 참조하세요.

CONSUMING.md는 LLM 에이전트 전용 문서입니다. 사람 독자는 이 README가 더 유용합니다.

## 이 저장소는 무엇이 **아닌가**

`nexus-core`는 **외부 사용자가 직접 설치하는 플러그인이 아닙니다.** Nexus 하네스(`claude-nexus`, `opencode-nexus`, `codex-nexus`)를 사용하고 싶다면 해당 저장소의 안내를 따르세요. `nexus-core`는 그 세 하네스가 내부적으로 공유하는 자산입니다.

## 범위

**포함하는 것**

- `agents/{id}/body.md` — 에이전트 프롬프트 본문
- `agents/{id}/meta.yml` — 에이전트 neutral metadata
- `skills/{id}/body.md` — 스킬 프롬프트 본문
- `skills/{id}/meta.yml` — 스킬 neutral metadata
- `vocabulary/*.yml` — capabilities, categories, resume-tiers, tags 정의
- `schema/*.json` — 위 파일들의 JSON Schema (AJV 검증)
- `conformance/` — cross-harness 호환성 검증을 위한 state 파일 스키마·tool 동작 fixture·시나리오 fixture
- `docs/` — tool semantic 명세(nexus-tools-contract), state 파일 개요, .nexus/ 디렉터리 구조, behavioral contract
- `scripts/` — 마이그레이션·검증 스크립트

**포함하지 않는 것**

- hook 구현 (`gate.cjs` 등) — 각 하네스 내부
- MCP server 구현 — 각 하네스 내부
- TypeScript 런타임 타입 — 각 하네스 내부
- 런타임 I/O 로직 — 각 하네스 내부
- Supervision 집행 로직 (`ApprovalBridge` 등) — 외부 Supervision consumer 내부 (현재 active consumer 없음)
- UI hint 필드 (`icon`, `color` 등) — 특정 소비자 결합 금지

## 원칙

- **prompt-only**: `nexus-core`는 프롬프트 본문과 neutral metadata만 담습니다. 런타임 코드는 들어가지 않습니다.
- **harness-neutral**: `body.md` / `meta.yml`은 특정 하네스의 도구 이름(`Edit`, `edit`, `mcp__...`)을 직접 참조하지 않습니다. 추상 capability(`no_file_edit` 등)만 사용합니다.
- **model-neutral**: 구체 모델 이름(`opus`, `sonnet`, `gpt-*`)은 금지. `model_tier: high | standard` 추상만 허용.
- **forward-only 완화**: breaking change는 semver major + `CHANGELOG.md`의 "Consumer Action Required" 섹션으로 대응합니다.

자세한 원칙과 거절 근거는 [`.nexus/context/boundaries.md`](./.nexus/context/boundaries.md)와 [`.nexus/context/ecosystem.md`](./.nexus/context/ecosystem.md) 참조.

## Status

v0.11.0 (2026-04-17). 최신 release: 훅 컨텍스트 주입 가이드 governance 재정립 (GH #21/#22/#23 — 3 consumer drift 대응). 상세 변경 이력은 [CHANGELOG.md](./CHANGELOG.md) 참조.

## References

- [CHANGELOG.md](./CHANGELOG.md) — version history
- [CONSUMING.md](./CONSUMING.md) — consumer LLM upgrade protocol
- [RELEASING.md](./RELEASING.md) — harness-neutral release runbook (for LLM agents or humans cutting a release)
- [.nexus/context/boundaries.md](./.nexus/context/boundaries.md) — scope & rejection rationale
- [.nexus/context/ecosystem.md](./.nexus/context/ecosystem.md) — 3-layer model
- [.nexus/context/evolution.md](./.nexus/context/evolution.md) — Forward-only relaxation policy
- [.nexus/rules/semver-policy.md](./.nexus/rules/semver-policy.md) — 18-case semver interpretation

## License

[MIT](./LICENSE)
