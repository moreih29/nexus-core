# Changelog

All notable changes to `@moreih29/nexus-core` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/).

**Breaking changes** use versioned HTML comment markers for machine-readable extraction:

```
<!-- nx-car:vX.Y.Z:start -->
- impact: ...
- action: ...
- migration: ...
<!-- nx-car:vX.Y.Z:end -->
```

Consumer LLM agents can extract these blocks via regex. See [CONSUMING.md](./CONSUMING.md) for the upgrade protocol and [.nexus/rules/semver-policy.md](./.nexus/rules/semver-policy.md) for semver interpretation.

## [Unreleased]

(none)

## [0.10.0] - 2026-04-16 — upstream proposal partial acceptance (GH #19/#20)

This release implements the partial acceptance of two upstream proposals from claude-nexus Plan session #7: GH #19 (Plan/Run quantitative guidelines) and GH #20 (memory operational policy + access tracking). The accepted portions land as authoring-layer canonical assets (vocabulary, schemas, docs, boundaries principle). Rejected portions are dispatcher / runtime / consumer-local concerns that belong outside the Authoring layer per boundaries §Canonical specifics의 증거 기준 (newly introduced in this release).

### BREAKING CHANGES
<!-- nx-car:v0.10.0:start -->
- **Impact**: claude-nexus, opencode-nexus — `skills/nx-plan/body.md` Step 7 prose restructured; `body_hash` changed. Two new canonical vocabulary files (`task-exceptions.yml`, `memory_policy.yml`) and one new state schema (`memory-access.schema.json`) are published. Consumers that `verifyBodyHash` will fail on v0.10.0 until they refresh their build artifacts. Consumers that import manifest vocabulary must accommodate two new sections (`task_exceptions` array, `memory_policy` object). Runtime behavior of existing consumer dispatchers is **not** affected by this release — all new canonical assets are additive or prose-only.
- **Action required (claude-nexus)**:
  1. `@moreih29/nexus-core` devDependency를 `^0.10.0`으로 업데이트.
  2. `bun run dev` (또는 consumer 빌드 명령)로 재빌드 — 신규 `body_hash` 및 vocabulary entries를 수용.
  3. conditional auto-pairing 규칙(engineer + runtime-behavior acceptance → tester / writer + verifiable deliverable acceptance → reviewer; researcher·순수 refactor·type-only·docs-adjacent 제외)을 local dispatcher에 반영. 기존 unconditional pairing 코드 제거.
  4. Dedup Layer 1(plan-time static merge via `same_file_bundle`)을 task 생성 단계에 반영. Layer 2(wave-time intersection check), cap=5 hard enforcement, pair-wise streaming spawn 알고리즘, wave_id TUI grouping, escalation wave pause/resume, `tool-log.jsonl` wave recalibration — 모두 consumer-local dispatcher 결정 (canonical로 승격되지 않음).
  5. memory-access observation hook은 선택적. 구현할 경우 `.nexus/state/claude-nexus/memory-access.jsonl`을 `conformance/state-schemas/memory-access.schema.json` 4-field schema로 기록. P1 자동 삭제 임계값(예: 일수·cycle 수·접근 횟수)은 프로젝트 cadence에 맞춰 consumer가 설정.
  6. `vocabulary/task-exceptions.yml` 4 entries를 dispatcher가 인식하여 Step 7 static merge 및 CHECK pair skip 판단에 활용.
- **Action required (opencode-nexus)**:
  1. `@moreih29/nexus-core` devDependency를 `^0.10.0`으로 업데이트.
  2. 빌드 재실행.
  3. 동일 conditional auto-pairing 규칙을 opencode harness의 task 분해 로직에 반영.
  4. memory-access observation hook 구현 여부는 프로젝트 필요에 따라 판단.
- **Migration guide**: [MIGRATIONS/v0_9_to_v0_10.md](./MIGRATIONS/v0_9_to_v0_10.md) — 거부 항목 목록 + canonical specifics 증거 기준 근거 포함.
- **Rationale (semver)**: pre-v1 minor + nx-car marker — v0.2.0/v0.4.0/v0.5.0/v0.6.0/v0.7.0/v0.8.0/v0.9.0 선례 일관. `body.md` prose 재구조화 + vocabulary 2종 추가 + state schema 1종 추가는 consumer 측 빌드 재실행을 요구하는 breaking change. additive-with-obligation 패턴.
<!-- nx-car:v0.10.0:end -->

### Added

- `vocabulary/task-exceptions.yml` — canonical exception catalog. 4 entries: `docs_only.coherent`, `docs_only.independent`, `same_file_bundle`, `generated_artifacts`. 각 entry는 `id`, `description`, `applies_when`, `treatment`, `rationale` 5 필드.
- `vocabulary/memory_policy.yml` — canonical memory operational policy. 5 섹션: `categories` (empirical / external / pattern 3종; primer는 context/ 소관이므로 제외), `naming` (structural contract — lowercase kebab-case `.md`, optional prefix), `access_tracking` (file_read observation primitive + 3 정보 축적 의미), `forgetting` (manual gate 기본값 + 3-signal intersection 구조, 수치는 consumer 재량), `merge` (merge-before-create 원칙).
- `schema/task-exceptions.schema.json` — JSON Schema draft 2020-12 (`$defs` 통해 `vocabulary.schema.json`에서 $ref).
- `schema/memory-policy.schema.json` — JSON Schema draft 2020-12 (`$defs` 통해 `vocabulary.schema.json`에서 $ref).
- `conformance/state-schemas/memory-access.schema.json` — canonical state schema for `.nexus/state/{harness_id}/memory-access.jsonl`. 4 required fields: `path`, `last_accessed_ts`, `access_count`, `last_agent`. agent-tracker.json 선례 패턴 동일.
- `docs/memory-lifecycle-contract.md` — behavioral contract 문서. 5 canonical principles + 3 category boundary + consumer responsibility (수치·commit 포맷·resume 규칙 consumer 재량 명시).
- `vocabulary/invocations.yml` entries: `memory_read_observation` primitive (6 필드).
- `.nexus/memory/pattern-upstream-proposal-review.md` — Plan session #6 판단 과정 기록.

### Changed

- `skills/nx-plan/body.md` Step 7 — "Verification auto-pairing" 섹션을 conditional rule로 재작성(researcher 제외, docs-adjacent 제외, 순수 refactor·type-only 제외). artifact-coherence primary metric prose, Exception catalog 참조, Dedup Layer 1 prose, HOW decomposition row-differ 규칙, parallel decomp ≥3 qualitative guidance 추가. 거부 항목(cap 수치, pair-wise streaming 알고리즘, Dedup Layer 2 wave-time, wave_id TUI, escalation wave pause/resume, tool-log recalibration) 본문 미포함.
- `docs/nexus-outputs-contract.md` §Shared filename convention — `memory-access.jsonl` 항목 추가. agent-tracker entry와 포맷 동일.
- `vocabulary/tags.yml` — `[m]`/`[m:gc]` entries에 `prose_guidance` 필드 추가. memory_policy.yml과 memory-lifecycle-contract.md 참조.
- `schema/vocabulary.schema.json` — `tagEntry`에 optional `prose_guidance` 필드 허용. `taskExceptionEntry` / `taskExceptionFile` / `memoryPolicyFile` $defs 신설 ($ref via `task-exceptions.schema.json` / `memory-policy.schema.json`).
- `schema/manifest.schema.json` — `vocabulary` 섹션에 `task_exceptions` 배열, `memory_policy` 객체 속성 추가. required에 포함.
- `scripts/lib/validate.ts` — 신규 vocabulary 2종 validator 컴파일 + `loadVocab`에서 로드 + `generateManifest`에 반영.
- `.nexus/context/boundaries.md` — §Canonical specifics의 증거 기준 신규 섹션(§거절 근거 6개 뒤, §Vocabulary 4종 앞). 3 적용 예시 포함(memory-access 4-field / P1 수치 / Plan Step 7 수치).
- `VERSION`, `package.json` — 0.10.0으로 bump.

### Rejected (documented in MIGRATIONS/v0_9_to_v0_10.md)

GH #19에서 거부된 항목: `cap=5` hard 수치, pair-wise streaming spawn 알고리즘, Dedup Layer 2 (wave-time intersection), TUI `wave_id` grouping, escalation serialization의 wave pause/resume 상태 머신, `tool-log.jsonl` wave recalibration, `run_parallel_dispatch` harness_keys entry. GH #20에서 거부된 항목: `primer-` 범주(context/ 중복), `max_count: 1 primer`, 구체 수치(80/200/15/60KB/20 cycles/180 days/6 cycles/access=0), P1 자동 삭제의 수치 enforcement, git commit message 포맷 구체, resume 세션 미증분 규칙, 4-prefix enumeration regex의 강제. 모두 dispatcher·runtime·consumer-local 결정 영역.

## [0.9.0] - 2026-04-15 — task_close scope reduction + rule:neutral-tool-side-effect

This release narrows `task_close` to the nexus-core owned state files only, removes a harness-specific return field, and formalizes the boundary as a new enforceable rule. A companion patch (Issue #17) corrects the `agent-tracker.json` array-of-entries narrative drift without breaking any consumer contract.

### BREAKING CHANGES
<!-- nx-car:v0.9.0:start -->
- **Impact**: claude-nexus, opencode-nexus — `task_close` return shape no longer includes `memoryHint.hadLoopDetection`. Consumer code that reads this field will receive `undefined`. `task_close` no longer deletes `edit-tracker.json` or `reopen-tracker.json`; consumers that depended on this side effect must move tracker cleanup to their `session_end` hook.
- **Action required (claude-nexus)**:
  1. `@moreih29/nexus-core` devDependency를 `^0.9.0`으로 업데이트.
  2. `result.memoryHint.hadLoopDetection` 참조 코드 제거.
  3. `session_end` hook에 `edit-tracker.json` / `reopen-tracker.json` 정리 로직 추가. 권장 경로: `.nexus/state/claude-nexus/edit-tracker.json`, `.nexus/state/claude-nexus/reopen-tracker.json`. 파일 존재 여부 확인 후 삭제.
  4. 내부 문서에서 두 tracker를 harness-local로 재분류.
- **Action required (opencode-nexus)**:
  1. `@moreih29/nexus-core` devDependency를 `^0.9.0`으로 업데이트.
  2. `result.memoryHint.hadLoopDetection` 참조 코드 제거. `edit-tracker` 미구현이므로 추가 조치 없음.
- **Migration guide**: [MIGRATIONS/v0_8_to_v0_9.md](./MIGRATIONS/v0_8_to_v0_9.md) (Before/After 반환값 예시 + consumer action checklist + 근거 포함).
- **Rationale (semver)**: pre-v1 minor + nx-car marker — v0.2.0/v0.4.0/v0.5.0/v0.6.0/v0.7.0/v0.8.0 선례 일관. `task_close` 반환 shape 축소 + side effect 범위 축소는 consumer 측 코드 변경을 요구하는 breaking change.
<!-- nx-car:v0.9.0:end -->

### Changed

- `docs/nexus-tools-contract.md` §task_close: 반환 shape에서 `memoryHint.hadLoopDetection` 제거; side effect에서 `edit-tracker.json`·`reopen-tracker.json` delete 제거; harness-local tracker는 consumer session hook 책임임을 명기.
- `docs/nexus-outputs-contract.md`: legacy carve-out 섹션 삭제; `edit-tracker.json`·`reopen-tracker.json`을 harness-local state로 재분류. `task_close` 삭제 트리거 서술을 `plan.json`·`tasks.json`만으로 축소.
- `docs/nexus-layout.md`: `edit-tracker.json`·`reopen-tracker.json`을 harness-local namespace(`{harness-id}/`) 아래로 이동.
- `docs/consumer-implementation-guide.md`: `edit-tracker`를 optional harness-local 파일로 기술; 관리 책임이 consumer session hook에 있음을 명기.
- `.nexus/rules/neutral-principles.md`: `rule:neutral-tool-side-effect` 신설 — nexus-core MCP tool contract는 `conformance/state-schemas/*.json` 등록 파일(`plan.json`, `tasks.json`, `history.json`, `agent-tracker.json`)에만 side effect 선언 가능.

### Fixed / Clarified

- `docs/nexus-state-overview.md` §agent-tracker: 서술을 단일 객체에서 array-of-entries로 통일 (Issue #17 patch). Consumer implementation에서 이미 array를 사용하고 있었으나 nexus-core narrative가 단일 객체 서술을 유지하던 drift 수정.

### Removed

- `task_close` 반환값 `memoryHint.hadLoopDetection` 필드 — claude-nexus 특화 loop detection 집계값. harness-neutral tool contract에 포함될 수 없는 harness-specific 필드.
- `task_close` side effect에서 `edit-tracker.json`·`reopen-tracker.json` delete — nexus-core가 소유하지 않는 schema 파일에 대한 side effect. `rule:neutral-tool-side-effect` 위반.
- `docs/nexus-outputs-contract.md` legacy carve-out 섹션 — harness-local 파일의 nexus-core 계약 포함을 허용하던 예외 조항.

### Related Issues

- [GH #17](https://github.com/moreih29/nexus-core/issues/17) — agent-tracker docs drift 수정 (patch, no breaking change)
- [GH #18](https://github.com/moreih29/nexus-core/issues/18) — task_close scope 축소 (Plan session #5, 2026-04-15)

## [0.8.0] - 2026-04-15 — Invocation vocabulary + Spec γ macro rewrite + G6 lint hardening

This release introduces `vocabulary/invocations.yml` as the 5th canonical vocabulary, rewrites 13 harness-specific tool call sites in `skills/*/body.md` to Spec γ macro tokens, and hardens G6 lint to enforce the macro/namespace contract. All changes are additive to the vocabulary layer; the breaking surface is the prompt drift in `skills/*/body.md` — consumers that expand macro tokens at build time must integrate a macro expander.

### BREAKING CHANGES
<!-- nx-car:v0.8.0:start -->
- **Impact**: claude-nexus, opencode-nexus — body.md 13건의 하네스 특화 tool 호출이 Spec γ 매크로 토큰으로 전환됨. 기존 `Skill()`/`Agent()`/`TaskCreate` 등 직접 호출 문법이 consumer 산출물에 남아 있으면 런타임 미작동 가능.
- **Action required (claude-nexus, opencode-nexus 공통)**:
  1. `@moreih29/nexus-core` devDependency를 `^0.8.0`으로 업데이트.
  2. consumer repo에 `invocation-map.yml` 신설 (4 primitive × concrete syntax 매핑).
  3. `harness-content/slash_command_display.md` (또는 각 하네스의 동등 경로) 신설. `nx-init`의 `harness_docs_refs: [instruction_file, slash_command_display]` append 대상.
  4. `generate-from-nexus-core.lib.mjs`(또는 동등)에 매크로 expander 통합 (heredoc 마스킹 + 매크로 스캔 + expansion).
  5. 전체 재빌드 후 `grep -rn "claude-nexus:" src/skills/generated/` (opencode-nexus) 또는 동등 grep으로 cross-harness namespace 오염 0건 확인.
- **Migration guide**: [MIGRATIONS/v0_7_to_v0_8.md](./MIGRATIONS/v0_7_to_v0_8.md) (Spec γ 매크로 규격 + consumer parser pseudo-code + invocation-map 템플릿 + rebuild procedure + pitfalls 포함).
- **Rationale (semver)**: pre-v1 minor + nx-car marker — v0.2.0/v0.4.0/v0.5.0/v0.6.0/v0.7.0 선례 일관. API shape 변경이 아닌 prompt drift + lint gate 성격.
<!-- nx-car:v0.8.0:end -->

### Added

- `vocabulary/invocations.yml`: 5번째 canonical vocabulary, 4 primitive entry (skill_activation, subagent_spawn, task_register, user_question). 각 entry에 id / description / intent / semantic_params / prose_guidance / fallback_behavior 필드 포함.
- `schema/vocabulary.schema.json`: `invocationParam`, `invocationEntry`, `invocationFile` 정의 추가.
- `schema/manifest.schema.json`: `vocabulary.invocations` 필드 required.
- `scripts/lib/validate.ts`: `checkInvocationEntryIntegrity` 게이트, invocations.yml load 로직, manifest에 invocations 요약 emission.
- `scripts/lib/lint.ts`: G6 확장 5 카테고리 — Category 1 distinctive word boundary, Category 2 call-pattern only, Category 3 namespace prefix, Category 4 macro whitelist with primitive_id enum cross-check, Category 5 heredoc opaque.
- `.nexus/rules/neutral-principles.md`: §rule:use-invocation-vocabulary 신설 (warning level, positive gate).
- `MIGRATIONS/v0_7_to_v0_8.md`: consumer 업그레이드 완전 가이드 (Spec γ 매크로 규격 + consumer parser pseudo-code + invocation-map 템플릿 + rebuild procedure + pitfalls 포함).

### Changed

- `skills/*/body.md` (4 파일): 하네스 특화 tool 호출 13건 → Spec γ 매크로 토큰 (`{{primitive_id key=val}}` + heredoc).
- `skills/nx-init/meta.yml`: `harness_docs_refs`에 `slash_command_display` 추가.
- `.nexus/rules/neutral-principles.md`: §rule:no-harness-tool 3-subsection 재구조화 (Category 1-3 정규식 그대로 기재), 동기화 유지 메모 추가.
- `.nexus/context/boundaries.md`: §포함 범위 vocabulary 5종으로 확장, §거절 4 하단에 positive invocation carve-out 없음 명기.
- `.nexus/context/ecosystem.md`: §invocation abstraction 신설 (capability abstraction 병렬 구조).
- `.nexus/context/evolution.md`: §v0.8.0 서브섹션 신설.

### Removed

- (해당 없음 — v0.8.0은 additive + prompt drift 성격)

## [0.7.1] - 2026-04-14 — Documentation cleanup: nexus-code archived

`nexus-code` 프로젝트가 archived됨에 따라 nexus-core의 철학·내부·consumer-facing 문서에서 `nexus-code` specific 참조를 제거. Spec API 변경 없음 — narrative와 consumer 목록 update만.

### Changed

- 3 consumer 목록(claude-nexus, opencode-nexus, nexus-code) → 2 consumer (claude-nexus, opencode-nexus). `CLAUDE.md`, `CONSUMING.md`, `README.md`, `vocabulary/capabilities.yml` top comment, `.nexus/rules/semver-policy.md`, `docs/nexus-outputs-contract.md`, `docs/nexus-tools-contract.md`, `docs/consumer-implementation-guide.md` 전역 일관.
- 3층위 모델: `README.md` + `.nexus/context/ecosystem.md`에서 Supervision layer를 `(reserved)` 상태로 reframe — 개념 자체는 보존(rule:no-supervision-logic 유효), nexus-code specific 참조 제거.
- `rule:no-supervision-logic`: wording을 "외부 Supervision consumer의 내부 구현"으로 generic화. 금지 개념·식별자(ApprovalBridge, ProcessSupervisor, AgentHost) 목록 유지.
- `docs/nexus-outputs-contract.md` §Supervision aggregation 전제 (reserved): "향후 Supervision consumer"로 generic consumer wording.
- `.nexus/context/ecosystem.md`, `.nexus/context/boundaries.md`, `.nexus/context/evolution.md`: 현재 상태 narrative update. Published release 서브섹션(§v0.2.0~§v0.7.0)은 historical record로 미수정.
- `.nexus/memory/open-questions.md`: (a) UI hint, (b) capability 역매핑 항목에 `[resolved — nexus-code archived 2026-04-14]` 표기 + Resolution 단락 추가. (e)/(f) generic wording 교체.
- `.nexus/memory/agent-sdk-constraint.md`, `.nexus/memory/bridge-quotes.md`: 상단에 Archive note 추가, 본문 historical record로 보존.
- `README.md` Status section: v0.2.0 → v0.7.1 갱신.

### Notes

- Schema·Tool API·Conformance fixture 변경 없음 — patch level.
- MIGRATIONS file 불요 (no breaking change, nx-car marker 없음).
- Historical record (CHANGELOG v0.5.0~v0.7.0, MIGRATIONS/v0_*, `.nexus/history.json`)는 append-only 원칙으로 보존.

## [0.7.0] - 2026-04-14 — Correctness fix: cross-harness state namespace isolation

This release corrects specification errors that accumulated during the design-focused v0.2–v0.6 series. No new design concepts are introduced. All changes narrow, clarify, or make consistent existing contracts — consumers whose implementations already respected the intent of the namespace isolation principle are unaffected at runtime, but schema and path changes require explicit migration.

### Added

- `docs/nexus-outputs-contract.md` §Shared filename convention: normative section enumerating every state file whose name is shared across harnesses, with path and ownership column.
- `.nexus/context/ecosystem.md` §Co-run scenarios: new section documenting multi-harness co-run state isolation expectations.
- `MIGRATIONS/v0_6_to_v0_7.md`: migration guide for this release (path update, schema required assertion, placeholder substitution).
- `.nexus/memory/open-questions.md` item (f): records the open question surfaced during this correctness pass.

### Changed

- `conformance/state-schemas/agent-tracker.schema.json`: `required` array reduced from 6 fields to 2 (`harness_id`, `started_at`); remaining fields remain defined but are not required by the shared schema.
- `conformance/state-schemas/agent-tracker.schema.json` `agent_id` description: reframed as opaque — cross-harness parsing of the `agent_id` value is explicitly forbidden.
- `conformance/schema/fixture.schema.json` + `conformance/lifecycle/agent-spawn.json`, `agent-complete.json`, `agent-resume.json`: placeholder token convention introduced (`{STATE_ROOT}`, `{HARNESS_ID}`) for lifecycle fixture path values; path strings now use tokens rather than literal paths.
- `.nexus/rules/neutral-principles.md` `rule:harness-state-namespace`: scope reframed — the rule's isolation prohibition is now explicitly scoped to exempt files declared in the outputs-contract §Shared filename convention, preventing the rule from conflicting with intentionally shared common-purpose files.
- `docs/nexus-outputs-contract.md`: `agent-tracker.json` path updated to the namespace-isolated form; §Shared filename convention section added (see Added).
- `docs/nexus-state-overview.md`, `docs/nexus-layout.md`, `docs/consumer-implementation-guide.md`: path references and descriptions updated to match the corrected `agent-tracker.json` location.
- `conformance/README.md` + `conformance/lifecycle/README.md`: placeholder token convention documented; fixture authoring guidance updated.

### BREAKING CHANGES
<!-- nx-car:v0.7.0:start -->
**Tracking issue**: [GH #16](https://github.com/moreih29/nexus-core/issues/16)

**Affected consumers**: opencode-nexus (Phase 1 active), claude-nexus (Phase 2 pending), nexus-code (Phase 2 pending)

**Consumer Action Required**:

- **changed**: `agent-tracker.json` path namespace isolation — the canonical path has moved to the harness-namespaced location. Consumers writing or reading `agent-tracker.json` at the previous path must update to the new path as specified in `docs/nexus-outputs-contract.md`.
  - **impact**: any harness writing `agent-tracker.json` to the old path will create a file that conformance fixtures no longer validate.
  - **action**: update `AGENT_TRACKER_FILE` path constant in your harness to the value declared in `docs/nexus-outputs-contract.md` §Shared filename convention.

- **changed**: `agent-tracker.schema.json` required fields reduced 6 → 2 (`harness_id`, `started_at`) — harness implementations that validated entry completeness against all 6 previously-required fields must relax their assertion to the 2 fields now required by the shared schema. Additional required fields may still be enforced by a harness-local extension schema.
  - **impact**: consumers enforcing the old 6-field required set will over-validate against the shared schema contract.
  - **action**: assert only `harness_id` and `started_at` as required at the shared-schema layer; add a harness-local extension schema if your harness requires additional fields.

- **changed**: `agent_id` opaque semantic — the `agent_id` field in `agent-tracker.json` entries is now explicitly opaque. Cross-harness parsing of the value (e.g., splitting on `:` to extract harness name) is forbidden. Treat the value as an opaque identifier for equality comparison only.

- **added**: fixture state file path placeholder token convention (`{STATE_ROOT}`, `{HARNESS_ID}`) — lifecycle fixtures now use placeholder tokens in `state_files` paths instead of literal strings. Conformance runners must implement substitution of these tokens before evaluating fixture assertions.

- **rule**: `rule:harness-state-namespace` scope reframed — the rule now explicitly exempts files listed in `docs/nexus-outputs-contract.md` §Shared filename convention. Consumers whose rule-compliance logic hard-coded the old scope must re-verify against the updated rule text in `.nexus/rules/neutral-principles.md`.

- **impact**: opencode-nexus is in Phase 1 (active integration) and must apply all actions before next conformance gate. claude-nexus and nexus-code are in Phase 2 (pending) and should apply actions before Phase 2 activation.

- **action**: (1) update `AGENT_TRACKER_FILE` path, (2) assert only 2 required fields at shared-schema layer, (3) treat `agent_id` as opaque, (4) implement `{STATE_ROOT}` / `{HARNESS_ID}` placeholder substitution in your conformance runner, (5) re-verify `rule:harness-state-namespace` compliance against updated rule text.

- **migration**: See [MIGRATIONS/v0_6_to_v0_7.md](./MIGRATIONS/v0_6_to_v0_7.md)
<!-- nx-car:v0.7.0:end -->

## [0.6.0] - 2026-04-14 — Lifecycle simplification (runtime.json removed)

### Removed

- `conformance/state-schemas/runtime.schema.json`: ephemeral runtime state schema removed. Write-only with 0 read-sites across all surveyed consumers (GH #14 claude-nexus, #15 opencode-nexus); harness session metadata is now a harness-local implementation concern.
- `conformance/lifecycle/session-start.json` + `conformance/lifecycle/session-end.json`: event fixtures deleted. Remaining assertions were trivial (agent-tracker empty-array init / deletion) and already implied by the schema's `required` array plus the `agent_spawn`/`agent_complete`/`agent_resume` fixtures that cover every `agent-tracker.schema.json` field.

### Changed

- `conformance/lifecycle/agent-spawn.json`: `precondition.state_files[".nexus/state/runtime.json"]` removed. Agent-tracker postconditions unchanged.
- `conformance/schema/fixture.schema.json`: `event.type` enum reduced from 5 values to 3 (`agent_spawn`, `agent_complete`, `agent_resume`). Description updated to reference `agent-tracker.json` only.
- `docs/nexus-outputs-contract.md`, `docs/nexus-layout.md`, `docs/nexus-state-overview.md`, `docs/consumer-implementation-guide.md`, `CONSUMING.md`: runtime.json references removed (sections, directory trees, schema lists, session_start hook description).
- `.nexus/rules/neutral-principles.md` §`rule:harness-state-namespace`: `runtime.json` removed from common-schema filename list.
- `conformance/README.md`, `conformance/lifecycle/README.md`: lifecycle event tables updated (3 events instead of 5); example fixture snippet re-based on `agent-tracker.schema.json`.

### BREAKING CHANGES
<!-- nx-car:v0.6.0:start -->
**Affected consumers**: claude-nexus, opencode-nexus, nexus-code

**Required actions**:
1. **`session_start` hook** — remove code that writes `.nexus/state/runtime.json`. Retain `agent-tracker.json` initialization (empty array).
2. **`session_end` hook** — remove code that deletes `.nexus/state/runtime.json`. Retain `agent-tracker.json` deletion.
3. **Conformance test runner** — remove any references to `lifecycle/session-start.json` or `lifecycle/session-end.json`; drop `session_start`/`session_end` from any hardcoded `event.type` enum your runner may cache. Re-run `bun run validate:conformance` (or `bunx nexus-validate-conformance`) and confirm exit 0.

If your harness stored runtime-like configuration in `runtime.json`, move it to a harness-local namespace file (e.g. `.nexus/state/{harness-id}/session-config.json`) with its own schema. Reusing the common filename `runtime.json` inside the namespace directory is forbidden by `rule:harness-state-namespace`.

**Migration guide**: [MIGRATIONS/v0_5_to_v0_6.md](./MIGRATIONS/v0_5_to_v0_6.md)

**Upgrade gate**: run `bunx nexus-validate-conformance` after upgrade. All fixtures must pass before deploying the consumer.

**Notes**: nexus-code is not yet consuming nexus-core and is not impacted by this release.
<!-- nx-car:v0.6.0:end -->

## [0.5.0] - 2026-04-13 — Consumer experience + harness-neutral refinements

### Added

- `package.json#bin`: `nexus-validate-conformance` entry for direct `bunx`/`npx` invocation
- `package.json#files`: `scripts/` now shipped with the npm tarball — consumers can invoke the conformance validator without reaching into `node_modules`
- `conformance/examples/plan.extension.schema.example.json`: non-normative reference example for harness-local state extensions
- Optional `schema_version` field on `plan`, `tasks`, `runtime`, `history` state schemas (top-level)
- Required per-cycle `schema_version` field on `history.schema.json` `cycles[]` — migration anchor for long-lived archives
- `docs/nexus-tools-contract.md` §plan_update: `issue` object shape table (`id`, `title`, `status` with presence conditions)
- `docs/nexus-outputs-contract.md` §Harness-local State Extension: link to reference example schema

### Changed

- `conformance/state-schemas/runtime.schema.json`: `plugin_version` replaced with `harness_id` + `harness_version` (required)
- `conformance/state-schemas/agent-tracker.schema.json`: `agent_type` decomposed into `harness_id` + `agent_name` (required)
- `docs/nexus-tools-contract.md` §plan_decide: parameter renamed `summary` → `decision` (matches state field name)
- `conformance/tools/plan-decide.json` + `conformance/scenarios/full-plan-cycle.json`: fixtures updated to new param name
- `conformance/lifecycle/*.json`: 5 event fixtures updated to reference `harness_id`/`harness_version`/`agent_name`
- `conformance/README.md` + `conformance/schema/fixture.schema.json`: `state_files` empty `{}` semantic documented as "file must exist, content not inspected"

### BREAKING CHANGES
<!-- nx-car:v0.5.0:start -->
**Affected consumers**: claude-nexus, opencode-nexus, nexus-code

**Required actions**:
1. **runtime.json writer** — replace `plugin_version` with `harness_id` (free string matching `^[a-z][a-z0-9-]*$`) and `harness_version` (plugin version string).
2. **agent-tracker.json writer** — remove `agent_type` prefix composition; record `harness_id` and `agent_name` as separate fields. Remove any parsing code that splits `"<harness>:<agent>"`.
3. **plan_decide MCP wrapper** — rename input parameter `summary` to `decision`. State field already was `decision`; this aligns the pair.
4. **history.json writer** — include `"schema_version": "0.5"` on every archived cycle. Optional (recommended) on plan/tasks/runtime top-level writes.

**Migration guide**: [MIGRATIONS/v0_4_to_v0_5.md](./MIGRATIONS/v0_4_to_v0_5.md)

**Upgrade gate**: run `bunx nexus-validate-conformance` after upgrade. All fixtures must pass before deploying the consumer.
<!-- nx-car:v0.5.0:end -->

### Roadmap

- `schema_version` required promotion is a candidate for the next major bump (v1.0.0, tied to Phase 2 entry per `.nexus/context/evolution.md`).

## [0.4.0] - 2026-04-13 — Conformance full-coverage

### Added

- `docs/nexus-outputs-contract.md` — normative 3-category output contract (Tool-produced / Harness-produced / Agent-produced)
- `conformance/lifecycle/*.json` — 5 event-based fixtures (session_start, session_end, agent_spawn, agent_complete, agent_resume)
- `conformance/lifecycle/README.md`
- `scripts/conformance-coverage.ts` — validator: schema field × fixture.covers coverage + params anti-pattern detection
- `conformance/tools/plan-update.json`, `plan-status.json`, `history-search.json`, `context.json`, `artifact-write.json` — 5 new tool fixtures completing 11/11 tool coverage
- `package.json` script `validate:conformance`
- `docs/nexus-outputs-contract.md §Harness-local State Extension` — normative convention for harness-local state files (namespace directory `.nexus/state/{harness-id}/` + `.extension.json` suffix for common-file extensions)
- `.nexus/rules/neutral-principles.md` rule #7 `rule:harness-state-namespace` — enforceable rule prohibiting root-level harness files and common-schema field injection
- `CONSUMING.md §Harness-local State Extension` — consumer quick reference for the namespace + extension convention

### Changed

- `conformance/schema/fixture.schema.json` — `covers` required, `uncovered_params` optional, `event` oneOf branch for harness-managed file validation
- `conformance/README.md` — Authoring Rules, Lifecycle Fixtures, Running the Coverage Validator sections; Coverage section updated (11/11 tools, 5/5 events, 54/54 fields)
- `CONSUMING.md` — Schema Field Coverage Obligation subsection added under §Conformance Obligation; File Contracts table gains 4 rows; Upgrade Protocol adds validator step
- Existing 6 tool fixtures — `covers` field added; postconditions strengthened to verify previously-dropped fields (`how_agents`, `approach`/`acceptance`/`risk`, `owner*`, `branch`)

<!-- nx-car:v0.4.0:start -->
### Consumer Action Required

- **Impact**: `fixture.schema.json` now requires a `covers` field on every fixture object. Consumers with custom fixture sets must add `covers` to each fixture or `validate:conformance` will exit with code 1. CI pipelines must add `bun run validate:conformance` as a release gate.
- **Action**:
  1. Run `bun run validate:conformance` against your fixture set. If it exits with code 1, follow the diagnostic output — either add missing fields to a fixture's `covers` or declare routing-only parameters in `uncovered_params`.
  2. Extend each custom fixture's top-level to include `covers: { state_schemas: {...}, return_value: {...} }` (at least one non-empty key required).
  3. For fixtures whose `action.params` carry routing-only values (e.g., `action`, `issue_id` for `plan_update`), declare those keys in `uncovered_params`.
  4. Add `bun run validate:conformance` to your CI workflow as a release gate.
  5. (If you have harness-local state files currently at `.nexus/state/` root other than `edit-tracker.json` or `reopen-tracker.json`) Move them to `.nexus/state/{your-harness-id}/` and add a local JSON Schema at `state-schemas/*.extension.schema.json` or an independent schema file. See `docs/nexus-outputs-contract.md §Harness-local State Extension` for the full contract.
- **Migration**: see `MIGRATIONS/v0_3_to_v0_4.md` for concrete before/after examples and the full gap catalog.
<!-- nx-car:v0.4.0:end -->

## [0.3.0] - 2026-04-12

### BREAKING CHANGES
<!-- nx-car:v0.3.0:start -->
- **removed**: `skills/nx-setup/` — `body.md` contained Claude Code–specific tool names and UI idioms throughout, violating the harness-neutral principle. The directory has been deleted from the package.
- **impact**: any consumer that resolved `nx-setup` from this package (via `manifest.json` lookup, directory traversal, or npm `skills/nx-setup/` path) will find the entry absent. Harnesses that surfaced a setup experience backed by this skill will break at boot or first invocation.
- **action**: implement a local `setup` skill in your consumer repo. The skill contract (required `meta.yml` fields, expected capability references) is documented in `CONSUMING.md` under "Setup Skill Contract".
- **migration**: See [MIGRATIONS/v0_2_to_v0_3.md](./MIGRATIONS/v0_2_to_v0_3.md)
<!-- nx-car:v0.3.0:end -->

### Consumer Action Required

1. **Remove any reference to `skills/nx-setup/`** from your harness bootstrap, skill-loader, and manifest-resolution logic.
2. **Implement a local setup skill** in your consumer repo. Consult `CONSUMING.md` → "Setup Skill Contract" for the required `meta.yml` fields and capability references your implementation must declare.
3. **Update your pin** from `0.2.0` to `0.3.0` only after the local setup skill is in place and validated.

### Changed

- `skills/nx-init/body.md`, `skills/nx-sync/body.md`, `skills/nx-plan/body.md` — all harness-specific tool names (`Edit`, `Write`, `Read`, `Bash`, `Agent`) replaced with neutral capability expressions. No behavioral semantics changed; only the surface vocabulary is now harness-agnostic.
- `skills/nx-init/body.md` — hardcoded `CLAUDE.md` reference replaced with the abstract term "instruction file" throughout. `meta.yml` gains `harness_docs_refs: ["instruction_file"]` so consumers can map the abstraction to their harness's actual instruction file name.

### Added

- `conformance/fixtures/` — two new tool conformance fixtures: `task-update.json` and `task-list.json`. Tool coverage advances from 4/11 to 6/11 (`plan_start`, `plan_decide`, `task_add`, `task_close`, `task_update`, `task_list`).

### Removed

- `skills/nx-setup/` — entire directory deleted (see Breaking Changes above).

## [0.2.0] - 2026-04-12

### BREAKING CHANGES
<!-- nx-car:v0.2.0:start -->
- **removed**: `harness_mapping` from `vocabulary/capabilities.yml` — nexus-core no longer knows which harnesses exist
- **added**: `intent`, `blocks_semantic_classes`, `prose_guidance` fields (X3 hybrid semantic schema)
- **added**: `no_shell_exec` 4th capability entry (opt-in, no canonical agent references it)
- **impact**: all consumers reading `harness_mapping[harnessName]` for tool resolution
- **action**: Create local capability-map in your repo; read `prose_guidance` from manifest.json; map to your harness tools. Add CI test asserting coverage.
- **schema_contract_version**: 1.0 → 2.0
- **migration**: See [MIGRATIONS/v0_1_to_v0_2.md](./MIGRATIONS/v0_1_to_v0_2.md)
<!-- nx-car:v0.2.0:end -->

### Added
- `conformance/` directory: state file JSON schemas (plan, tasks, history, runtime, agent-tracker) + tool conformance fixtures (plan_start, plan_decide, task_add, task_close) + scenario fixtures (full-plan-cycle, task-deps-ordering)
- `docs/` directory: nexus-tools-contract.md (11 tool semantic specs), nexus-state-overview.md, nexus-layout.md (.nexus/ canonical structure), behavioral-contracts.md (state machines, resume tiers, permissions, manual_only, NL trigger boundary)
- `summary` optional field in `skill.schema.json` — short one-liner for UI/catalog rendering
- `harness_docs_refs` optional field in `skill.schema.json` — references to consumer-local harness-specific documentation
- Gate 11 (`G11-tag-trigger`): tags.yml trigger↔id consistency validation
- G5' capability integrity: validates intent/blocks_semantic_classes/prose_guidance
- G6 lint expansion: now scans `agents/**/body.md` and `skills/**/body.md`
- DO/CHECK decomposition principle in `skills/nx-plan/body.md`
- `.nexus/memory/consumer-lib-reference.md` — pseudocode reference for trivial consumer helpers

### Changed
- All 9 agent body.md files and 5 skill body.md files rewritten for harness-neutrality (tool name references replaced with neutral phrasing)
- `manual_only` in skill.schema.json now has normative description
- `vocabulary.schema.json` capabilityEntry definition updated for X3 schema
- `schema/common.schema.json` harnessId $def removed

## [0.1.2] - 2026-04-11

### Added

- `RELEASING.md` at repository root — harness-neutral release runbook for LLM agents (or humans) performing a release. Written as a plain document rather than a skill so it works across Claude Code, OpenCode, and any future harness. Includes pre-flight checklist, version decision guide (cross-referencing `.nexus/rules/semver-policy.md`), commit/tag/push flow, workflow observation, post-publish verification, hard rules ("DO NOT" list), and a troubleshooting table distilled from the v0.1.0 → v0.1.1 bootstrap failures. Git-repo-only (not in npm `files` whitelist).
- `README.md` References section entry linking to `RELEASING.md` so discovering the runbook does not require grep.

## [0.1.1] - 2026-04-11

### Changed

- CI publish workflow now uses npm **Trusted Publishing (OIDC)** instead of Granular Access Token. `env.NODE_AUTH_TOKEN` removed from `publish-npm.yml`; the `id-token: write` permission enables automatic OIDC credential exchange. No functional behavior change for consumers. See [.nexus/context/evolution.md](./.nexus/context/evolution.md) for the 3-phase auth transition plan (B→A, completed with this release).

## [0.1.0] - 2026-04-11

### Added

- Initial bootstrap from `claude-nexus v0.25.0` via `scripts/import-from-claude-nexus.ts`
- **9 agents**: architect, designer, engineer, postdoc, researcher, reviewer, strategist, tester, writer (category: how/do/check)
- **5 skills**: nx-init, nx-plan, nx-run, nx-setup, nx-sync
- **Vocabulary** (4 files): `capabilities.yml` (3 entries), `categories.yml` (how/do/check), `resume-tiers.yml` (persistent/bounded/ephemeral), `tags.yml` (7 entries, 9 triggers)
- **JSON Schemas** (5 files): `common`, `agent`, `skill`, `vocabulary`, `manifest` (draft 2020-12, AJV strict mode)
- **Validation pipeline** (`scripts/validate.ts` + `scripts/lib/{validate,lint,structure,frontmatter}.ts`) implementing 10 gates: G1 schema, G2-G5 referential integrity, G6 harness-specific lint, G7 concrete model lint, G8 prompt-only enforcement, G9 directory strict, G10 id/directory match
- **Import script** (`scripts/import-from-claude-nexus.ts`) — Phase 1 one-way bootstrap with staging + atomic rename transaction
- **manifest.json** (root) — post-validation artifact with `body_hash` per agent/skill for consumer LLM lookup
- **CI workflows**: `validate.yml` (PR/push) and `publish-npm.yml` (tag/workflow_dispatch)
- **Consumer protocol**: `CONSUMING.md` — upgrade protocol for LLM agents in consumer repos
- **Semver policy**: `.nexus/rules/semver-policy.md` — 18-case interpretation table
- **Migration framework**: `MIGRATIONS/INDEX.md` — append-only migration guide index

### Changed

- (none — initial release)

### Deprecated

- (none)

### Removed

- (none)

### Fixed

- (none)

### Security

- (none)

### BREAKING CHANGES

- (none — initial release)

---

[Unreleased]: https://github.com/moreih29/nexus-core/compare/v0.8.0...HEAD
[0.8.0]: https://github.com/moreih29/nexus-core/compare/v0.7.1...v0.8.0
[0.7.1]: https://github.com/moreih29/nexus-core/compare/v0.7.0...v0.7.1
[0.7.0]: https://github.com/moreih29/nexus-core/compare/v0.6.0...v0.7.0
[0.6.0]: https://github.com/moreih29/nexus-core/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/moreih29/nexus-core/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/moreih29/nexus-core/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/moreih29/nexus-core/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/moreih29/nexus-core/compare/v0.1.2...v0.2.0
[0.1.2]: https://github.com/moreih29/nexus-core/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/moreih29/nexus-core/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/moreih29/nexus-core/releases/tag/v0.1.0
