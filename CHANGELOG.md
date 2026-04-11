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

[Unreleased]: https://github.com/moreih29/nexus-core/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/moreih29/nexus-core/releases/tag/v0.1.0
