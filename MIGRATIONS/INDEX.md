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
| v0.9.x → v0.10.0 | [v0_9_to_v0_10.md](./v0_9_to_v0_10.md) | GH #19/#20 부분 수용: `skills/nx-plan/body.md` Step 7 재작성(conditional auto-pairing, artifact-coherence, Dedup Layer 1, HOW row-differ); 신규 `vocabulary/task-exceptions.yml` + `vocabulary/memory_policy.yml` + `conformance/state-schemas/memory-access.schema.json` + `docs/memory-lifecycle-contract.md`; `boundaries.md §Canonical specifics의 증거 기준` 신설; dispatcher·runtime·수치 거부 항목 consumer-local 이관 |
| v0.8.x → v0.9.0 | [v0_8_to_v0_9.md](./v0_8_to_v0_9.md) | `task_close` scope reduced to nexus-core owned state only: `memoryHint.hadLoopDetection` removed from return shape; `edit-tracker.json`/`reopen-tracker.json` delete side effects removed; both tracker files removed from nexus-core contract; `rule:neutral-tool-side-effect` 신설 |
| v0.6.x → v0.7.0 | [v0_6_to_v0_7.md](./v0_6_to_v0_7.md) | `agent-tracker.json` path namespace-isolated to `{harness-id}/`; schema `required` fields 6 → 2 (`harness_id`, `started_at`); `agent_id` reframed as opaque; fixture placeholder token convention (`{STATE_ROOT}`, `{HARNESS_ID}`); `rule:harness-state-namespace` intent reframe |
| v0.5.x → v0.6.0 | [v0_5_to_v0_6.md](./v0_5_to_v0_6.md) | `runtime.schema.json` removed (no consumer readers); `session_start`/`session_end` lifecycle fixtures dropped; `event.type` enum reduced to `agent_*` |
| v0.4.x → v0.5.0 | [v0_4_to_v0_5.md](./v0_4_to_v0_5.md) | `plugin_version` → `harness_id` + `harness_version` on `runtime.schema.json`; `agent_type` decomposed; `plan_decide` param renamed `summary` → `decision` |
| v0.3.x → v0.4.0 | [v0_3_to_v0_4.md](./v0_3_to_v0_4.md) | `covers` required in `fixture.schema.json`, conformance self-auditing via `validate:conformance`, lifecycle fixtures added |
| v0.2.x → v0.3.0 | [v0_2_to_v0_3.md](./v0_2_to_v0_3.md) | `skills/nx-setup/` removed (harness-specific), tool names neutralized, instruction file abstracted |
| v0.1.x → v0.2.0 | [v0_1_to_v0_2.md](./v0_1_to_v0_2.md) | Harness-neutral vocabulary redesign, `harness_mapping` removed, conformance suite added |

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
