# nexus-core schemas

JSON Schema (draft 2020-12) files used by the `scripts/validate.ts` pipeline.

> **Note**: Consumers may use these schemas for optional runtime validation, but are not required to. The primary purpose is CI-side validation during bootstrap and subsequent edits.

## Files

| File | Purpose |
|---|---|
| `common.schema.json` | Shared `$defs` (`id` pattern, `description`, `harnessId` enum) reused across other schemas |
| `agent.schema.json` | Validates `agents/{id}/meta.yml` — 9 fields, 7 required |
| `skill.schema.json` | Validates `skills/{id}/meta.yml` — 6 fields, 4 required |
| `vocabulary.schema.json` | Validates `vocabulary/*.yml` — 4 file types via internal `$defs` (`capabilityFile`, `categoryFile`, `resumeTierFile`, `tagFile`) |
| `manifest.schema.json` | Validates the generated `manifest.json` — structural snapshot of all agents, skills, and vocabulary |

## $ref Structure

```
         ┌──────────────────────────┐
         │  common.schema.json      │
         │  $defs:                  │
         │    id                    │
         │    description           │
         │    harnessId             │
         └──────────┬───────────────┘
                    │ (referenced by)
          ┌─────────┼─────────┬────────────────┐
          ▼         ▼         ▼                ▼
    ┌──────────┐ ┌────────┐ ┌──────────────┐ ┌───────────────┐
    │ agent.   │ │ skill. │ │ vocabulary.  │ │ manifest.     │
    │ schema   │ │ schema │ │ schema       │ │ schema        │
    │          │ │        │ │              │ │               │
    │ meta.yml │ │meta.yml│ │ 4 file types │ │ generated     │
    │ 9 fields │ │6 fields│ │ via $defs    │ │ snapshot      │
    └──────────┘ └────────┘ └──────────────┘ └───────────────┘
```

## Validator Entry

`scripts/lib/validate.ts` loads all 5 schemas via `ajv.addSchema()` and performs:

1. **G1 — Schema validation**: each `agents/{id}/meta.yml`, `skills/{id}/meta.yml`, and `vocabulary/*.yml` file is validated against the corresponding schema. Vocabulary files are routed by filename to a `$ref` map (e.g., `capabilities.yml` → `vocabulary.schema.json#/$defs/capabilityFile`).

2. **G2–G5 — Referential integrity**: cross-file reference checks (e.g., `agent.capabilities` entries must exist in `capabilities.yml`). These checks are outside JSON Schema's scope and are implemented as custom validation in `scripts/lib/validate.ts`.

3. **Manifest generation**: on successful G1–G5, the validator reads validated assets and writes `manifest.json` at the repository root, then validates the manifest against `manifest.schema.json`. Each agent and skill entry in the manifest includes a `body_hash` field (`sha256:<hex>`) computed from the corresponding `body.md` file.

## Polymorphic Tag Schema

`vocabulary.schema.json#/$defs/tagEntry` uses `if-then-else` (draft 2020-12) to model the polymorphic `tags.yml` entries:

- `type: skill` — the `then` branch requires the `skill` field
- `type: inline_action` — the `else` branch requires the `handler` field
- `variants` is declared in `properties` alongside the `if-then-else`, making it available on both types without restriction

This avoids OpenAPI-style `discriminator` (non-standard for JSON Schema core) and keeps the schema portable across validators.

## Principles

- **Strict by default**: every object uses `additionalProperties: false`. Typos like `alais_ko` produce an immediate error.
- **Kebab-case ids**: `^[a-z][a-z0-9-]*$` enforced via `common.schema.json#/$defs/id`.
- **snake_case YAML keys**: consistent with existing fields `alias_ko`, `resume_tier`, `harness_mapping`.
- **draft 2020-12**: `$schema` declared in every file; AJV 8 requires `ajv.addMetaSchema(draft2020)` before loading these schemas.

## Reference

- `.nexus/context/boundaries.md` §schema/*.json — canonical file list and field definitions
- Plan session #2 Issue #4 (2026-04-11) — design decisions for polymorphic tag schema and strict mode
