# Sync and Harness Guide

`nexus-core` provides a sync/generation pipeline that turns canonical specs under `spec/` into harness-specific agent and skill artifacts.

- Public API: [src/generate/index.ts](/Users/kih/workspaces/areas/nexus-core/src/generate/index.ts:1)
- CLI entrypoint: [src/cli/sync.ts](/Users/kih/workspaces/areas/nexus-core/src/cli/sync.ts:1)

## What Sync Does

`sync` reads:

- canonical agent and skill specs from `spec/`
- macro vocabulary from `vocabulary/`
- harness-specific invocation templates and layout rules from `harness/`

It then:

1. loads the canonical spec documents
2. expands `{{...}}` macros into harness-native call syntax
3. renders each agent/skill into the harness's output format
4. writes the generated files under the target root

Core implementation:
- [src/generate/load-spec.ts](/Users/kih/workspaces/areas/nexus-core/src/generate/load-spec.ts:1)
- [src/generate/macros/expand.ts](/Users/kih/workspaces/areas/nexus-core/src/generate/macros/expand.ts:1)
- [src/generate/sync.ts](/Users/kih/workspaces/areas/nexus-core/src/generate/sync.ts:1)

## CLI Usage

Examples:

```bash
nexus-sync --harness=claude --target=./out/claude
nexus-sync --harness=codex --target=./out/codex
nexus-sync --harness=opencode --target=./out/opencode
nexus-sync --harness=codex --target=./out/codex --dry-run
```

Supported flags:

| Flag | Meaning |
|---|---|
| `--harness=claude|codex|opencode` | Select target harness |
| `--target=<dir>` | Output root directory |
| `--dry-run` | Show paths without writing files |

`--target` is only the output root. The actual file layout under that root is determined by the harness layout files.

## Generated Layouts

Current harness layouts:

- Claude: [harness/claude/layout.yml](/Users/kih/workspaces/areas/nexus-core/harness/claude/layout.yml:1)
- Codex: [harness/codex/layout.yml](/Users/kih/workspaces/areas/nexus-core/harness/codex/layout.yml:1)
- OpenCode: [harness/opencode/layout.yml](/Users/kih/workspaces/areas/nexus-core/harness/opencode/layout.yml:1)

Resolved paths:

| Harness | Agent Output | Skill Output |
|---|---|---|
| `claude` | `agents/{id}.md` | `skills/{id}/SKILL.md` |
| `codex` | `.codex/agents/{id}.toml` | `.codex/skills/{id}/SKILL.md` |
| `opencode` | `src/agents/{id}.ts` | `skills/{id}/SKILL.md` |

Preview examples from this repository:

- Claude: [dist/render-preview/claude](/Users/kih/workspaces/areas/nexus-core/dist/render-preview/claude)
- Codex: [dist/render-preview/codex](/Users/kih/workspaces/areas/nexus-core/dist/render-preview/codex)
- OpenCode: [dist/render-preview/opencode](/Users/kih/workspaces/areas/nexus-core/dist/render-preview/opencode)

## What Nexus-Core Provides

At artifact level, `nexus-core` provides:

- harness-specific agent files
- harness-specific skill files
- harness-specific rule materialization for agent restrictions
- harness-native macro expansion for primitives like:
  - skill activation
  - subagent spawning
  - transient task registration
  - structured user questions

Relevant data files:

- Macro vocabulary: [vocabulary/invocations.yml](/Users/kih/workspaces/areas/nexus-core/vocabulary/invocations.yml:1)
- Claude invocations: [harness/claude/invocations.yml](/Users/kih/workspaces/areas/nexus-core/harness/claude/invocations.yml:1)
- Codex invocations: [harness/codex/invocations.yml](/Users/kih/workspaces/areas/nexus-core/harness/codex/invocations.yml:1)
- OpenCode invocations: [harness/opencode/invocations.yml](/Users/kih/workspaces/areas/nexus-core/harness/opencode/invocations.yml:1)

## Lead by Harness

`lead` is generated for every harness, but the way it becomes the user's main session differs by harness.

### Claude

Generated artifact:

- [agents/lead.md](/Users/kih/workspaces/areas/nexus-core/dist/render-preview/claude/agents/lead.md:1)

How to use:

- `nexus-core` provides the lead agent definition file.
- The Claude-side consumer is responsible for wiring that file into the harness's primary-agent mechanism.
- In other words, `nexus-core` generates the lead artifact, but does not own Claude installation/bootstrap settings.

### Codex

Generated artifact:

- [.codex/agents/lead.toml](/Users/kih/workspaces/areas/nexus-core/dist/render-preview/codex/.codex/agents/lead.toml:1)

How to use:

- `nexus-core` provides the lead agent artifact for Codex agent parity.
- Injecting lead into the user's main Codex session is consumer-owned.
- If a consumer wants lead semantics on the main session, they must configure Codex themselves, typically via `model_instructions_file` or `AGENTS.md`, outside the sync pipeline.
- `nexus-core` does not generate or manage that main-session wiring.

### OpenCode

Generated artifact:

- [src/agents/lead.ts](/Users/kih/workspaces/areas/nexus-core/dist/render-preview/opencode/src/agents/lead.ts:1)

How to use:

- `nexus-core` provides the generated lead agent module.
- The OpenCode-side consumer/plugin is responsible for importing and registering the generated agents bundle in its own runtime/bootstrap.
- `nexus-core` does not ship the consumer's plugin bootstrap or packaging layer.

## Out of Scope

The sync pipeline does not currently own:

- harness installer scripts
- plugin manifests or marketplace metadata
- Claude primary-agent settings files
- Codex `model_instructions_file` wiring
- OpenCode runtime bootstrap/plugin entrypoints

Those are consumer integration concerns, not canonical spec-to-artifact concerns.
