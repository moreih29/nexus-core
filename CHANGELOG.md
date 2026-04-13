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

[Unreleased]: https://github.com/moreih29/nexus-core/compare/v0.4.0...HEAD
[0.4.0]: https://github.com/moreih29/nexus-core/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/moreih29/nexus-core/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/moreih29/nexus-core/compare/v0.1.2...v0.2.0
[0.1.2]: https://github.com/moreih29/nexus-core/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/moreih29/nexus-core/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/moreih29/nexus-core/releases/tag/v0.1.0
