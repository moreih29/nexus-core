# MIGRATIONS

Migration guides for breaking changes between `@moreih29/nexus-core` versions.

## Purpose

Consumer repositories (claude-nexus, opencode-nexus, nexus-code) and their LLM agents use this directory to understand how to update their code when a `@moreih29/nexus-core` version bump introduces breaking changes.

## Access

This directory is **git-repo-only** — it is not included in the npm package (`files` whitelist excludes `MIGRATIONS/`). Consumer LLM agents access migration files via WebFetch:

```
https://github.com/moreih29/nexus-core/blob/v{X.Y.Z}/MIGRATIONS/{from}_to_{to}.md
```

See [CONSUMING.md](../CONSUMING.md) for the full upgrade protocol.

## Policy: Append-Only

Once a migration file is created and released, it is **never modified**:

- **New version = new file** (never edit existing migration files)
- **Naming convention**: `v{from_major.minor}_to_v{to_major.minor}.md` (e.g., `v0.1_to_v0.2.md`)
- **Cross-reference**: link from the corresponding `<!-- nx-car:vX.Y.Z:start -->` block in [CHANGELOG.md](../CHANGELOG.md)
- **Inline threshold**: if the migration is < 50 lines, keep it inline in CHANGELOG's nx-car block instead of creating a separate file

This immutability guarantees that consumer LLM agents can reference any historical migration without worrying about retroactive changes.

## Index

| Version Jump | File | Summary |
|---|---|---|
| _(no migrations yet — first release is `v0.1.0`)_ | | |

## Contributing a Migration

When releasing a breaking change (semver major bump):

1. Decide: inline in CHANGELOG nx-car block (< 50 lines) or new MIGRATIONS file (>= 50 lines)?
2. If new file: create `MIGRATIONS/v{from}_to_v{to}.md` with:
   - **Context**: what changed and why
   - **Impact**: which consumer surfaces break
   - **Before/After**: code/config examples
   - **Steps**: migration checklist
   - **Rollback**: if feasible
3. Link from CHANGELOG's nx-car block: `migration: See MIGRATIONS/v{from}_to_v{to}.md`
4. Add row to this INDEX.md table
5. Update `.nexus/rules/semver-policy.md` if a new case pattern emerges

## References

- [CHANGELOG.md](../CHANGELOG.md) — version history with nx-car breaking change markers
- [.nexus/rules/semver-policy.md](../.nexus/rules/semver-policy.md) — 18-case semver interpretation
- [CONSUMING.md](../CONSUMING.md) — consumer upgrade protocol
- [.nexus/context/evolution.md](../.nexus/context/evolution.md) — Forward-only 완화 정책
- plan session #2 Issue #8 (2026-04-11) — this policy's design decision (Architect suggestion #2)
