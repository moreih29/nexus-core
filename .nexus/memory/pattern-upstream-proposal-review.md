# pattern-upstream-proposal-review

Plan session #6 (2026-04-16, v0.10.0)의 판단 과정 기록 — 향후 consumer→upstream 제안 평가 시 참조.

## Context

claude-nexus Plan session #7 산출물로 GH #19 (Plan/Run quantitative guidelines)와 GH #20 (memory operational policy + access tracking) 두 제안이 upstream으로 들어왔다. 각 제안 500+ 줄, §Questions for maintainer 섹션 포함 — 완성된 spec이 아니라 협상 요청 성격.

## 판단 축

1. **Authoring layer 경계** — body.md prose가 dispatcher 알고리즘/runtime state machine을 지시하면 "prompt-only authoring layer" 정체성 침식. boundaries §1·§2와 직접 충돌.
2. **Vocabulary=semantic only 경계** — 기존 5 vocabulary 파일(capabilities / categories / resume-tiers / tags / invocations)은 전부 "무엇인가(semantic definition)"만 담는다. 임계값·삭제 정책·git commit 포맷 같은 behavioral policy는 한 번도 vocabulary에 들어가지 않았다. 이 경계를 깨는 제안은 의심 대상.
3. **수치 증거 기반** — 단일 consumer(claude-nexus) cycle 경험에서 유도된 수치를 canonical로 박으면 다른 consumer(opencode-nexus)의 국소 최적을 구조적으로 박탈. "원칙·구조는 canonical, 수치는 consumer"가 기본 line.

## 결정 요지

**#19 B안 부분 수용**: artifact-coherence metric + conditional auto-pairing(researcher·docs-adjacent 제외) + exception catalog(vocabulary/task-exceptions.yml로 분리) + Dedup Layer 1 + HOW row-differ + ≥3 qualitative guidance 수용. cap=5 hard / pair-wise streaming 알고리즘 / Dedup Layer 2 / wave_id TUI / escalation wave-pause / tool-log recalibration / run_parallel_dispatch harness_keys 거부 — 모두 dispatcher·runtime·UI 층위.

**#20 5차 C안 + α**: 3 범주(empirical/external/pattern, primer는 context/ 중복으로 제거) + 파일명 structural contract + memory-access.jsonl 4-field schema(agent-tracker 선례) + 5 canonical 원칙(read-event observation, manual gate default, 3-signal intersection 구조, git-backed deletion, merge-before-create) 수용. 구체 수치(180d/6c/80/200/15/60KB)·max_count:1 primer·git commit 포맷·resume 세션 규칙 거부.

## 판단 반복 포인트

초기 분석은 가장 보수적(거의 전부 거부)에서 출발. 사용자 push로 4회 입장 수정 — 더 canonical로 기울어진 과정:
- 1차: vocabulary·docs 전부 거부 → "divergence 위험" 지적받고 docs/memory-lifecycle-contract.md 추가.
- 2차: schema도 거부 → agent-tracker 선례 지적받고 memory-access schema canonical화.
- 3차: naming regex 거부 → state/*.json 선례 지적받고 structural naming canonical화.
- 4차: 4-prefix taxonomy 거부 → merit-based 평가하자는 요청받고 3 범주로 축소 수용(primer는 context/ 중복이라 제외).
- 5차(최종): gc/P1 원칙도 consumer 재량 → "좋은 제시가 하네스 성능 향상" 관점에서 원칙/구조 canonical화 + 수치 consumer 재량으로 정리.

최종 경계: **원칙·구조는 canonical, 수치는 consumer**.

## 재사용 규칙

향후 consumer upstream 제안 평가 시:
1. `.nexus/context/boundaries.md §Canonical specifics의 증거 기준`을 먼저 확인.
2. 단일 consumer 증거로 올라온 구체 수치는 원칙·구조 수준으로 demote 검토.
3. vocabulary에 behavioral policy 추가 요청은 docs/ 경로 대안 검토.
4. 저자가 §Questions 섹션을 남겼다면 각 질문에 대한 명시적 응답이 회신의 기본 구조.
5. 거절 근거를 `거절 3(구체 model 금지)` 같은 기존 원칙 축에 연결하여 일관성 유지.

## 관련 문서

- `.nexus/context/boundaries.md §Canonical specifics의 증거 기준` (v0.10.0 추가)
- `.nexus/context/evolution.md §90일 재평가 윈도우 §3` (opencode-nexus drift 체크)
- `docs/memory-lifecycle-contract.md` (Proposal B 원칙 canonical 정착)
- `vocabulary/memory_policy.yml`, `vocabulary/task-exceptions.yml` (v0.10.0 신설)
- `MIGRATIONS/v0_9_to_v0_10.md` (consumer action)
- GH #19, GH #20 (원본 제안 + 회신 코멘트)
