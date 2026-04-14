# 스키마 진화 정책

> 이 문서는 plan session #1 (2026-04-10)과 plan session #2 (2026-04-11)의 결정을 재구성한 것이다. plan session #1은 철학 확립, plan session #2는 구현 결정. 원본 논의: `.nexus/memory/` 참조.

---

이 문서는 nexus-core의 schema 진화 방식, breaking change 대응 절차, CHANGELOG 포맷, Phase 전환 트리거를 정의한다. 생태계 구조(ecosystem.md)와 범위·vocabulary(boundaries.md)는 이 파일에서 다루지 않는다.

---

## 원래 Forward-only 원칙

bridge 계획 §2.3이 Phase 1 schema 진화 정책을 다음과 같이 정의했다.

**허용**
- additive change: 신규 optional 필드 추가 → minor version bump (예: 0.1.0 → 0.2.0)
- 비기능적 수정: 설명 문구, 포맷 정리 → patch bump (예: 0.1.0 → 0.1.1)

**금지 (Phase 1 기간)**
- breaking change: 필수 필드 제거, 필드 의미 변경, 필드 타입 변경 → major bump이며 Phase 1에서 금지

**원래 의도**: claude-nexus가 Phase 2에서 `@moreih29/nexus-core` 패키지를 채택할 때 schema 마이그레이션 부담을 최소화하는 것. Phase 1 동안 schema를 안정적으로 유지하면, Phase 2 통합 시 claude-nexus loader가 별도 마이그레이션 없이 패키지를 소비할 수 있다.

---

## 이번 세션의 완화 결정

plan session #1 (2026-04-10)에서 Forward-only 원칙을 완화했다. 근거와 적용 범위는 다음과 같다.

### 완화 근거

1. **1인 dogfooding 맥락**: 현재 nexus-core 작성자가 모든 소비자 레포의 maintainer이기도 하다. 완벽한 사전 방어보다 실제 문제를 경험하며 대응 전략을 학습하는 것이 가치 있다(Primer §5.1).

2. **Phase 1 소비자의 실제 비용**: Phase 1에서 nexus-core를 소비하는 레포는 opencode-nexus 하나다. claude-nexus는 아직 패키지를 소비하지 않는다. breaking change가 발생해도 영향 대상이 단일 레포이므로 실제 마이그레이션 비용이 낮다.

3. **절차 확립이 목적**: 이 완화는 "breaking change를 허용한다"는 의미가 아니다. "breaking change가 발생했을 때 명시적 신호를 통해 소비자에게 알리고 대응한다"는 절차를 확립한 것이다.

### 적용 범위

- Forward-only 원칙의 원래 의도(Phase 2 마이그레이션 부담 최소화)는 유지된다.
- 다만 Phase 1에서 breaking change를 절대 금지하는 대신, 발생 시 명시적 대응 절차를 따른다.
- Phase 2에서 claude-nexus가 패키지를 채택하는 시점부터는 breaking change 비용이 올라가므로 정책을 재평가한다.

---

## Breaking Change 대응 절차

breaking change가 발생한 경우 아래 순서로 대응한다.

1. **VERSION 파일 업데이트**: semver major를 올린다.
   - 예: `0.1.4` → `1.0.0`
   - minor/patch 변경은 이 절차를 거치지 않는다.

2. **CHANGELOG.md 업데이트**: Keep a Changelog 포맷을 사용하고, 해당 버전 엔트리에 아래 요소를 포함한다.
   - "Consumer Action Required" 섹션을 엔트리 내 다른 변경 내용보다 먼저 위치시킨다.
   - `<!-- nx-car:vX.Y.Z:start -->` / `<!-- nx-car:vX.Y.Z:end -->` versioned HTML 주석 marker로 섹션을 감싼다.
   - migration 내용이 50줄을 초과하면 `MIGRATIONS/vX_to_vY.md` 별도 파일을 작성하고 CHANGELOG에서 링크한다.
   - 포맷 상세는 아래 §CHANGELOG Canonical 포맷을 따른다.

3. **소비자 반영**: 각 소비자 레포(opencode-nexus, claude-nexus, nexus-code)의 maintainer가 "Consumer Action Required" 섹션을 읽고 자신의 레포에서 필요한 업데이트를 반영한다. 현재 모든 소비자 레포의 maintainer는 동일 작성자다.

semver 해석 판단(어떤 변경이 major/minor/patch인지)은 `.nexus/rules/semver-policy.md`의 18-case 표를 참조한다.

### v0.2.0 — 첫 Breaking Change 실전 검증 (2026-04-12)

plan session #3에서 capabilities.yml harness-agnostic 재설계를 결정하고 v0.2.0으로 실행했다. CHANGELOG.md의 nx-car:v0.2.0 marker, MIGRATIONS/v0_1_to_v0_2.md 199줄 migration guide, "Consumer Action Required" 섹션이 처음으로 실전 사용되었다. breaking change 대응 절차의 기계적 요소(marker 파싱, version range 관리)는 설계대로 작동함을 확인했다.

### v0.4.0 — Additive-with-obligation minor bump (2026-04-13)

plan session #4에서 conformance full-coverage를 결정하고 v0.4.0으로 실행했다. 추가 항목(conformance/lifecycle/, docs/nexus-outputs-contract.md, scripts/conformance-coverage.ts)은 additive이나 fixture.schema.json의 `covers` 필드가 required로 승격되어 기존 custom fixture를 가진 consumer에게 migration 의무가 발생한다. pre-v1 semver 정책에 따라 major bump 대신 minor bump + nx-car 마커로 처리했다(CHANGELOG.md nx-car:v0.4.0 marker, MIGRATIONS/v0_3_to_v0_4.md). validate:conformance CI gate가 이번 bump를 통해 처음으로 도입되었다.

### v0.5.0 — Consumer experience + harness-neutral refinements (2026-04-13)

plan session #5에서 이슈 #8/#9/#10/#11/#12 통합 처리를 결정하고 v0.5.0으로 실행했다. 4가지 breaking change를 단일 minor bump로 묶었다:

1. `runtime.json` common schema에서 `plugin_version` 제거, `harness_id` + `harness_version` 분해.
2. `agent-tracker.json` common schema에서 `agent_type` 제거, `harness_id` + `agent_name` 구조적 분해.
3. `plan_decide` MCP tool input 파라미터 `summary` → `decision` 리네이밍 (state field와 통일).
4. `history.json` cycles[]에 `schema_version` 필수 도입 (long-lived archive migration anchor).

추가 additive: `bin` 엔트리 `nexus-validate-conformance` 신설(이슈 #8/#11 해소), 5개 state schema에 top-level optional `schema_version` 추가, `conformance/examples/plan.extension.schema.example.json` reference 신설(이슈 #12 Gap 5).

pre-v1 정책에 따라 major bump 대신 minor bump + nx-car:v0.5.0 마커 + MIGRATIONS/v0_4_to_v0_5.md(291줄)로 처리. v0.2.0/v0.4.0과 동일 패턴 일관성 확인.

### v0.6.0 — Common schema 축소: runtime.json 제거 + lifecycle fixture 정리 (2026-04-14)

GH #14/#15 해결. surveyed consumer 전원이 `runtime.schema.json`을 write-only로만 사용하고 read가 0건임을 확인한 뒤, canonical source가 소비되지 않는 contract를 유지할 이유가 없다는 판단으로 제거했다.

제거 항목:
- `conformance/state-schemas/runtime.schema.json` 삭제
- `conformance/lifecycle/session-start.json`, `session-end.json` 삭제 (runtime.schema.json에 의존하던 event fixture)
- `fixture.schema.json` event.type enum 5종 → 3종 (`agent_spawn`, `agent_complete`, `agent_resume`만 유지)
- state schema count 5 → 4 (plan / tasks / history / agent-tracker)

보존 판단: `agent-tracker.json`은 `task_add.owner_agent_id` 연계가 실제로 소비되므로 유지.

이 결정의 설계 철학적 의미: canonical source는 실제 소비되는 contract만 선언해야 한다. 소비 증거 없는 schema 유지는 "false contract" — 소비자에게 구현 의무를 부과하는 착시를 만들 수 있다. runtime.schema.json 제거는 schema 추가보다 드문 방향이므로 진화 기록에 명시한다.

pre-v1 정책에 따라 minor bump + nx-car:v0.6.0 마커로 처리.

---

## CHANGELOG Canonical 포맷

CHANGELOG.md는 Keep a Changelog 포맷을 기반으로 하되, nexus-core 전용 확장을 적용한다.

### 규칙

- semver major bump가 포함된 모든 릴리스는 반드시 "Consumer Action Required" 섹션을 포함한다.
- "Consumer Action Required" 섹션은 해당 버전 엔트리의 맨 앞에 위치한다.
- 섹션은 `<!-- nx-car:vX.Y.Z:start -->` / `<!-- nx-car:vX.Y.Z:end -->` versioned HTML 주석 marker로 감싼다. marker 중첩은 금지한다(`.nexus/rules/semver-policy.md` 참조).
- 영향 대상 목록에는 현재 알려진 모든 소비자를 명시한다: opencode-nexus, claude-nexus, nexus-code.
- migration 내용이 50줄을 초과하면 `MIGRATIONS/vX_to_vY.md`를 별도 작성하고 CHANGELOG에서 링크한다.
- minor/patch bump에는 "Consumer Action Required" 섹션을 포함하지 않는다.

### 포맷 예시

```markdown
## [0.2.0] - 2026-05-15

### Added
- ...

### BREAKING CHANGES
<!-- nx-car:v0.2.0:start -->
- **removed**: `qa-tester` agent
- **impact**: consumers referencing qa-tester id
- **action**: Rename references from qa-tester to tester
- **migration**: See MIGRATIONS/v0.1_to_v0.2.md
<!-- nx-car:v0.2.0:end -->
```

---

## Phase 1 → Phase 2 전환

### Phase 정의

**Phase 1 — bootstrap + 짧은 검증 기간**

예상 기간: bootstrap 직후 1-2주 수준(이번 주말 진입 예상).

- claude-nexus가 canonical source다. `scripts/import-from-claude-nexus.ts`가 claude-nexus → nexus-core 단방향 동기화를 담당한다.
- nexus-core는 임시 snapshot이다.
- sibling 관계는 소비 방향만 symmetric하다. bootstrap source 방향은 asymmetric하다(bridge §1.5 근거).
- opencode-nexus만 `@moreih29/nexus-core`를 devDependency로 소비한다.

**Phase 2 — 3 consumer read-only 소비**

- 3 consumer(claude-nexus, opencode-nexus, nexus-code) 모두 nexus-core를 read-only로 소비하기 시작한다.
- nexus-core가 canonical source로 역전된다. 이후 수정은 nexus-core에서 직접 이루어진다.
- `scripts/import-from-claude-nexus.ts`는 `scripts/legacy/bootstrap.ts`로 이동한다(Transient Bootstrap 정책, 아래 섹션 참조).

### Phase 2 진입 Signal

**전환 판정 조건**: 3 consumer repo 각각에 nexus-core import 전환 commit이 존재하면 Phase 2 진입으로 판정한다.

이 조건은 bridge 계획 §11의 Signal 1/2/3보다 단순하고 명확한 기준이다. Signal 1/2/3는 참고 지표로 유지하되, 실제 판정은 위 commit 존재 여부로 한다.

### 참고 지표 성격

Primer §5.2가 명시하듯, trigger 조건들은 참고 지표일 뿐 엄격한 게이트가 아니다. 작성자 판단으로 조건 미충족 상태에서도 조기 전환이 가능하다.

---

## Transient Bootstrap Import Script 정책

`scripts/import-from-claude-nexus.ts`는 Phase 1 1회용 bootstrap 도구다.

- Phase 2 진입 시 `scripts/legacy/bootstrap.ts`로 이동한다.
- 스크립트 상단 docstring에 다음을 명시한다: "Transient bootstrap artifact. Preserved for historical reference and emergency re-bootstrap. Not intended for routine use after Phase 2."
- Phase 2 진입 후 90일 재평가 시점에 완전 삭제 vs 유지를 재결정한다(아래 §90일 재평가 지표 항목 9 참조).

---

## Bun Publish 재평가 Reservation

Issue #7 결정: publish는 Bun primary, fallback은 npm CLI. Bun publish의 OIDC/provenance 지원 여부가 2026-04 기준 불확실하다.

- **재평가 시점**: Phase 2 진입 후 6개월
- **확인 항목**: bun publish OIDC/provenance 지원 여부, publish 안정성 실사용 사례
- **fallback path 유지**: npm CLI fallback은 재평가 결과가 확정될 때까지 유지한다.

---

## 90일 재평가 윈도우

Phase 2 진입 후 90일 시점에 재평가 plan session을 개최한다. 아래 9개 지표를 체크리스트로 확인한다.

1. `manifest.json`이 runtime contract 요구를 발견했는가 (Issue #8 Risk 2) — **부분 해소** (v0.2.0): conformance/ directory + docs/nexus-tools-contract.md가 runtime contract를 formal spec으로 승격
2. agent/skill 개수 — 현재 14개 기준, 30+ 도달 시 병렬화 전략 재평가 (Issue #6 Risk 3)
3. opencode-nexus 추가 drift 발견 여부 (Issue #5 W2)
4. `body.md` semver 해석 주관성 — `.nexus/rules/semver-policy.md` 업데이트 필요 여부 — **부분 해소** (v0.2.0): v0.2.0에서 body.md 전수 rewrite가 실행됨. lint G6이 body.md까지 확장되어 향후 harness-tool name drift 기계적 방지
5. claude-nexus v0.25.0과 nexus-core 독립 semver 유지의 유효성
6. bridge §2.1 필드 변경 → import allow list 동기화 누락 여부 (Issue #5 W3 체크리스트)
7. WebFetch 가용성 실사용 실패 사례 누적 여부 (Issue #8 Risk 3)
8. Bun publish OIDC/provenance 지원 확정 여부 (Issue #7, 위 §Bun Publish 재평가 Reservation 연동)
9. `scripts/import-from-claude-nexus.ts` 실제 실행 빈도 — retire vs keep 결정 근거 (위 §Transient Bootstrap Import Script 정책 연동)

---

## 미결 항목 (TBD)

다음 항목은 plan session #1에서 미결정이었으나, plan session #2(2026-04-11)에서 부분 해소되었다.

### (c) Phase 1 → Phase 2 전환의 practical 시점 판단 기준

**해소**: 위 §90일 재평가 윈도우의 9개 지표가 체크리스트로 확정되었다. Signal 1이 미충족인 경우의 조기 전환 판단은 작성자 재량에 따른다(§참고 지표 성격 참조).

### (e) schema_version 필드 도입 여부

Forward-only 완화 이후 소비자들이 자신이 읽는 schema와 자신의 loader가 호환되는지 확인하는 defensive loading 지원을 위해 `meta.yml`이나 `vocabulary/*.yml`에 `schema_version` 필드를 추가하는 방안이 제기되었다. Phase 1에서는 package.json의 semver로 충분할 수 있으나, Phase 2에서 소비자가 3개로 늘어나면 버전 관리가 복잡해질 수 있다.

**해소 (v0.5.0)**: 5개 state schema에 top-level optional `schema_version` 추가. `history.json` cycles[]에는 required로 도입. 값 포맷 `^\d+\.\d+$` (예: "0.5"). future migration script anchor 역할. v1.0.0(Phase 2 entry)에서 required 승격 후보로 CHANGELOG 로드맵에 명시. 상세는 위 §v0.5.0 서브섹션 참조.

TBD — `.nexus/memory/open-questions.md` 항목 (e) 참조

---

*이 문서의 관련 파일: `ecosystem.md` (생태계 구조와 용어), `boundaries.md` (범위와 vocabulary), `.nexus/memory/open-questions.md` (미결 항목 (c), (e)). 변경 이력: `.nexus/memory/` 참조. 다음 재평가 예정: Phase 1 완료 후 90일.*
