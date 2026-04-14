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

[Unreleased]: https://github.com/moreih29/nexus-core/compare/v0.7.1...HEAD
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
