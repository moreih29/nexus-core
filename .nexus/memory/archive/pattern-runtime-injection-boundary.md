# pattern-runtime-injection-boundary

Plan session #8 (2026-04-17, v0.12.0)의 dead context 회귀 판단 과정 기록 — 향후 runtime injection 메커니즘 확장 제안 평가 시 참조.

## Context

Plan #7(v0.11.0)이 `nexus_hook_mapping` 토큰 + §9.X Appendix "Hook Event Runtime Mapping" + consumer obligation `harness-content/nexus-hook-mapping.md` 신설을 도입해 ship. 설계 근거는 v0.8.0 `harness_docs_refs` 패턴 선례 재현이었다. Plan #8에서 `skills/*/body.md` · `agents/*/body.md` 전체를 대상으로 8개 hook event 키워드 grep 수행 — 참조 0건 확인. body에서 해당 개념을 지시하는 prose가 존재하지 않으므로 dead context 판정. v0.12.0에서 토큰·Appendix·consumer obligation 3 surface 회수.

## 판단 축

1. **Docs-runtime 경계** — `docs/*`는 consumer 개발자가 hook handler 코드 구현 시 참조하는 자료이지 LLM prompt context로 주입되는 자료가 아니다. docs 조항을 runtime inject 토큰으로 승격하는 제안은 구조적으로 의심 대상.
2. **Body 참조 = 성립 전제** — `harness_docs_refs` 패턴(v0.8.0, `instruction_file` / `slash_command_display` / `resume_invocation` 3선례)의 공통 전제: body.md에서 해당 개념을 지시하는 prose가 존재한다. 이 전제가 없으면 토큰이 runtime에 inject되어도 체계 내에서 지시받는 곳이 없다. 검증 방법 = body grep.
3. **선례 기계적 재사용 위험** — "v0.X.0 선례 그대로 적용"으로 시작하는 설계는 원본의 성립 조건(body 참조, domain alignment 등)이 현 제안에서도 재현되는지 점검을 생략하기 쉽다. Plan #7이 이 경로로 body 참조 유무 검증을 누락했다.

## 결정 요지 대비

| 구분 | Plan #7 (도입) | Plan #8 (회귀) |
|------|---------------|---------------|
| 토큰 | `nexus_hook_mapping` 신설 | 회수 |
| 문서 | §9.X Appendix 신설 | 회수 |
| Consumer obligation | `harness-content/nexus-hook-mapping.md` 신설 | 회수 |
| 보존 범위 | — | §9 rewrite 본체 / RFC 2119 dual gate / evidence threshold / conformance fixtures / 3-consumer 편입 |

## 재사용 규칙

향후 nexus-core에 runtime injection 메커니즘 확장(새 `harness_docs_refs` 토큰, `vocabulary/invocations.yml` primitive 추가 등) 제안 시:

1. **Body 참조 검증**: 제안된 토큰·primitive가 표상하는 개념이 `skills/*/body.md`, `agents/*/body.md`에서 prose든 macro든 실제로 지시되고 있는지 grep 확인. 참조 0건이면 제안 기각 또는 body 작업 선행.
2. **Docs 승격 의심**: `docs/*` 조항을 runtime inject 토큰으로 승격하는 제안은 구조적 의심 대상. docs는 consumer 개발자용 layer이지 LLM runtime context layer가 아님. 승격 근거는 body 지시 존재로만 성립한다.
3. **선례 재현성 점검**: "v0.X.0 선례 그대로 적용"으로 시작하는 설계는 원본의 성립 조건(body 참조, domain alignment 등)이 현 제안에서도 재현되는지 명시적 점검 필수. 재현 증거 없이는 "선례 정합" 주장 불가.

## 관련 문서

- `.nexus/context/evolution.md §v0.11.0` (Plan #7 결정 맥락) + `§v0.12.0` (회귀)
- `CHANGELOG.md` v0.11.0 / v0.12.0 entries
- `docs/consumer-implementation-guide.md §9` (preamble framing 재정비 후)
- `.nexus/context/boundaries.md` (Spec γ primitive vs. hook domain 경계 subsection)
- `MIGRATIONS/v0_10_to_v0_11.md` (archive) + `MIGRATIONS/v0_11_to_v0_12.md`
