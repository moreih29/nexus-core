# 스키마 진화 정책

> 이 문서는 plan session #1 (2026-04-10)의 결정을 재구성한 것이다. 원본 논의: `.nexus/memory/` 참조.

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

2. **CHANGELOG.md 업데이트**: 해당 버전 엔트리에 "Consumer Action Required" 섹션을 추가한다. 이 섹션은 엔트리 내에서 다른 변경 내용보다 먼저 등장해야 한다. 포맷은 아래 §Consumer Action Required 섹션 포맷을 따른다.

3. **소비자 반영**: 각 소비자 레포(opencode-nexus, claude-nexus, nexus-code)의 maintainer가 "Consumer Action Required" 섹션을 읽고 자신의 레포에서 필요한 업데이트를 반영한다. 현재 모든 소비자 레포의 maintainer는 동일 작성자다.

---

## Consumer Action Required 섹션 포맷

### 규칙

- semver major bump가 포함된 모든 릴리스는 반드시 이 섹션을 포함한다.
- 이 섹션은 해당 버전 CHANGELOG 엔트리의 맨 앞에 위치한다.
- 영향 대상 목록에는 현재 알려진 모든 소비자를 명시한다: opencode-nexus, claude-nexus, nexus-code.
- before/after 예시를 반드시 포함한다.
- "이유" 항목은 생략할 수 없다. 왜 이 breaking change가 필요했는지 기술한다.
- minor/patch bump에는 이 섹션을 포함하지 않는다.

### 예시 포맷

아래는 `meta.yml`의 `capabilities` 필드가 배열에서 객체로 변경되는 경우의 예시다.

```markdown
## 1.0.0 — 2026-MM-DD

### Consumer Action Required

**Breaking change**: `meta.yml`의 `capabilities` 필드 타입이 변경되었습니다.

**영향 대상**
- opencode-nexus: `scripts/generate-prompts.mjs`에서 `meta.capabilities` 읽기 방식 업데이트 필요
- claude-nexus: Phase 2 loader 구현 시 새 형식으로 읽어야 함
- nexus-code: `meta.capabilities` 파싱 코드 업데이트 필요

**Before**
```yaml
capabilities:
  - no_file_edit
  - no_task_create
```

**After**
```yaml
capabilities:
  no_file_edit: true
  no_task_create: true
```

**마이그레이션 방법**
배열 순회(`for cap of meta.capabilities`) 코드를 객체 키 순회(`for key of Object.keys(meta.capabilities)`)로 변경한다.

**이유**
[이 변경이 필요했던 구체적 이유. 예: capability별 활성화 여부를 조건부로 제어하기 위해]

### What Changed

- [그 외 변경 내용 목록]
```

---

## Phase 1 → Phase 2 전환

### Phase 정의

**Phase 1 — opencode-nexus 단독 통합**
- opencode-nexus만 `@moreih29/nexus-core`를 devDependency로 소비한다.
- claude-nexus는 변경되지 않는다. claude-nexus의 프롬프트를 수정하면 `scripts/import-from-claude-nexus.mjs`를 수동으로 실행해 nexus-core에 반영한다.
- nexus-core → opencode-nexus 방향의 단방향 흐름이다.

**Phase 2 — 양방향 하네스 소비**
- opencode-nexus와 claude-nexus 모두 nexus-core를 소비한다.
- claude-nexus에 nexus-core loader가 구현된다. claude-nexus는 패키지를 runtime dependency로 소비한다(bridge §8.3).
- nexus-core가 양방향 single source of truth가 된다. import script는 은퇴하거나 양방향으로 전환된다.
- Phase 2 진입 시점에 VERSION을 1.0.0으로 bump한다.

### Trigger 조건

bridge 계획 §11이 Phase 2 전환의 세 가지 신호를 정의한다.

**Signal 1 — Commit velocity reversal**
```
commits_14d(opencode-nexus) > commits_14d(claude-nexus) × 1.5
```
직전 14일 기준 opencode-nexus의 커밋 수가 claude-nexus 커밋 수의 1.5배를 초과하는 상태가 2주(14일) 연속으로 유지되는 경우.

**Signal 2 — Author declaration**
작성자가 다음 중 하나에 "Phase 2 transition"을 명시적으로 선언하는 경우:
- 어느 레포의 `.nexus/state/plan.json`에 기록된 plan session
- opencode-nexus 또는 claude-nexus의 `UPSTREAM.md`
- GitHub 태그 릴리스 노트

**Signal 3 — Sync direction reversal**
30일 기준으로 "opencode-nexus → nexus-core 기여 빈도"가 "claude-nexus → nexus-core 기여 빈도"를 초과하는 경우.

### Trigger 규칙

```
Signal 1 AND (Signal 2 OR Signal 3)
```

세 신호를 모두 충족해야 하는 것이 아니라, Signal 1이 성립하면서 Signal 2 또는 Signal 3 중 하나가 성립하면 전환 조건이 충족된다.

### 참고 지표 성격

Primer §5.2가 명시하듯, 이 trigger 조건들은 참고 지표일 뿐 엄격한 게이트가 아니다. 작성자 판단으로 조건 미충족 상태에서도 조기 전환이 가능하다.

---

## 90일 재평가 윈도우

bridge 계획 §11.3에 따라, Phase 1 완료 후 90일마다 Phase 2 전환 재평가 plan session을 개최한다. 이 세션은 trigger 조건 충족 여부와 무관하게 진행한다.

### 조기 전환 고려 조건

아래 조건 중 하나 이상이 성립하면 90일 재평가 세션에서 조기 전환을 검토한다.

- opencode-nexus가 nexus-core에 기여한 개선이 누적 5개 초과
- drift ledger(두 하네스 간 prompt 차이 기록)의 증가 추세가 지속됨
- Signal 1 미충족이더라도 작성자 판단으로 Phase 2가 더 적절하다고 판단되는 경우

### 정책 재평가 항목

90일 재평가 세션에서는 다음을 검토한다.

- Phase 1 동안 발생한 breaking change 횟수와 실제 마이그레이션 비용
- schema 안정성: major bump 없이 Phase 1이 운영되었는지
- Phase 2 진입 시 claude-nexus loader 구현의 예상 공수

구체 체크리스트 항목은 아직 미결정이다. Phase 1 운영 중 수집된 경험 데이터를 바탕으로 확정한다 — TBD, `.nexus/memory/open-questions.md` 참조(항목 c).

---

## 미결 항목 (TBD)

다음 항목들은 이번 세션(plan session #1)에서 확정되지 않았다. 향후 `[plan]` 세션에서 재논의한다.

### (c) Phase 1 → Phase 2 전환의 practical 시점 판단 기준

bridge §11의 trigger 조건(Signal 1/2/3)은 정의되어 있으나, 90일 재평가 시점에서 실제로 무엇을 체크리스트로 확인할지는 미정이다. Signal 1이 충족되지 않았을 때 조기 전환을 고려하는 실질적 기준도 Phase 1 운영 전에는 결정할 수 없다.

TBD — `.nexus/memory/open-questions.md` 항목 (c) 참조

### (e) schema_version 필드 도입 여부

Forward-only 완화 이후 소비자들이 자신이 읽는 schema와 자신의 loader가 호환되는지 확인하는 defensive loading 지원을 위해 `meta.yml`이나 `vocabulary/*.yml`에 `schema_version` 필드를 추가하는 방안이 제기되었다. Phase 1에서는 package.json의 semver로 충분할 수 있으나, Phase 2에서 소비자가 3개로 늘어나면 버전 관리가 복잡해질 수 있다.

TBD — `.nexus/memory/open-questions.md` 항목 (e) 참조

---

*이 문서의 관련 파일: `ecosystem.md` (생태계 구조와 용어), `boundaries.md` (범위와 vocabulary), `.nexus/memory/open-questions.md` (미결 항목 (c), (e)). 변경 이력: `.nexus/memory/` 참조. 다음 재평가 예정: Phase 1 완료 후 90일.*
