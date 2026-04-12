# semver-policy — nexus-core Semver 판단 기준

이 문서는 nexus-core의 CHANGELOG 작성 시 "이 변경이 major / minor / patch 중 무엇인가"를 판단하는 참조표다.

핵심 원칙: **"consumer 코드가 이 변경을 수정 없이 소비할 수 있는가?"**
- 수정 없이 소비 가능 → patch 또는 minor
- 소비하려면 consumer 측 변경이 필요 → major

**pre-v1 상태**: 이 프로젝트는 작성자가 명시적으로 v1.0을 선언하기 전까지 pre-v1이다. pre-v1 semver에서는 breaking change가 minor bump(0.x → 0.x+1)이다. v1.0.0은 "production stable" 선언을 의미하므로 작성자 판단 없이 임의로 올리지 말 것.

---

## 1. Purpose

nexus-core는 claude-nexus · opencode-nexus · nexus-code 세 하네스가 읽기 전용으로 소비한다. 버전 정책의 목적은 consumer가 업그레이드 시점을 안전하게 결정할 수 있도록 변경의 파급 범위를 명시하는 것이다.

이 문서는 판단 기준을 제공한다. 실제 CHANGELOG 작성 방법은 `CHANGELOG.md`의 marker 규칙을 따른다.

---

## 2. 18-case Semver 해석 표

| Change | Version | Rationale |
|---|---|---|
| agent 추가 | minor | 기존 agent 불변, 새 agent는 opt-in 카탈로그 확장 |
| agent 제거 | major | consumer가 참조하던 id가 사라지면 runtime 오류 |
| agent meta optional 필드 추가 | minor | 기존 consumer는 새 필드 무시 가능 |
| agent meta required 필드 추가 | major | 기존 YAML validation fail |
| agent meta optional → required | major | 기존 fail |
| agent meta required → optional | minor | 기존 기대값 유지 |
| capability 정의 추가만 (미적용) | patch | 어떤 agent에도 적용 안 되면 관찰 가능한 변화 없음 |
| capability 기존 agent에 적용 | major | consumer의 해당 agent 권한 축소 |
| capability 정의 제거 | major | 그것을 참조하던 agent 존재 시 integrity 깨짐 |
| skill 추가 | minor | 기존 skill 불변 |
| skill 제거 | major | consumer 참조 id 사라짐 |
| tags.yml 새 tag 추가 | minor | 기존 태그 불변, 새 태그는 opt-in |
| tags.yml 기존 tag 제거 | major | consumer trigger 참조 깨짐 |
| tags.yml tag type/handler 변경 | major | semantic 변경 |
| schema `additionalProperties: false → true` | patch | 더 관대한 방향, 기존 valid document 계속 valid |
| schema `additionalProperties: true → false` | major | 기존 document fail 가능 |
| body.md 본문 오타/명료화 | patch | 의미 불변 가정 |
| body.md 실질 개정 (동작 변화) | minor(추가) / major(기존 지침 제거) | 방향 기준 |

---

## 3. CHANGELOG Marker 중첩 금지 규칙

`<!-- nx-car:vX.Y.Z:start -->` 와 `<!-- nx-car:vX.Y.Z:end -->` marker는 line-based extraction으로 파싱된다. 중첩 시 파싱이 깨지므로 **중첩 금지**.

올바른 예:

```markdown
<!-- nx-car:v0.2.0:start -->
- ...breaking change 1...
- ...breaking change 2...
<!-- nx-car:v0.2.0:end -->
```

금지된 예 (중첩):

```markdown
<!-- nx-car:v0.2.0:start -->
...
<!-- nx-car:v0.2.1:start -->  ← 금지! 중첩
...
<!-- nx-car:v0.2.1:end -->
<!-- nx-car:v0.2.0:end -->
```

각 버전의 marker는 독립적으로 작성한다. 한 CHANGELOG 파일 안에 여러 버전의 marker가 순차 존재하는 것은 허용된다.

---

## 4. Heuristic: "의심스러우면 minor"

body.md 본문 개정이 "오타/명료화(patch)"인지 "실질 개정(minor)"인지 경계가 애매할 때는 **minor로 기록**한다.

이유:
- patch로 기록했는데 실제로 semantic 변화가 있었다면 consumer가 자동 업그레이드 받고 silent regression
- minor로 기록하면 consumer가 명시적 결정을 하고 업그레이드
- 보수적 선택이 long-term 안전

이 heuristic은 주관적 판단이 개입되는 유일한 지점이다. 다른 18개 case는 표에 따라 기계적으로 결정된다.

---

## 5. Reference Files

- `.nexus/context/evolution.md` §Forward-only 완화 정책 — 이 semver 정책의 근거
- `CHANGELOG.md` — 실제 marker 사용 사례
- `CONSUMING.md` — consumer LLM이 이 파일을 읽는 위치 정의
- plan session #2 Issue #7 (2026-04-11) — 이 18-case 표의 원본 출처

---

## 6. Rule Tag 연결

이 문서는 `[rule:semver]` 트리거로 참조 가능하다.

작성자가 CHANGELOG 엔트리 작성 시 "이 변경이 major인가 minor인가" 판단이 필요하면 `[rule:semver]`로 이 문서를 로드한다. Nexus Lead 및 gate가 변경 제안을 평가할 때도 이 문서를 점검 기준으로 사용한다.
