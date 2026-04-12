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

[Unreleased]: https://github.com/moreih29/nexus-core/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/moreih29/nexus-core/compare/v0.1.2...v0.2.0
[0.1.2]: https://github.com/moreih29/nexus-core/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/moreih29/nexus-core/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/moreih29/nexus-core/releases/tag/v0.1.0
