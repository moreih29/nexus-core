# Consuming nexus-core

> **Audience**: LLM agents in consumer repositories (claude-nexus, opencode-nexus).
> Human readers should start with [README.md](./README.md).

## Internet Access Assumption

This protocol assumes internet access. Claude Code and OpenCode both require internet for LLM API calls, so offline operation is out of scope.

**Fallback** (if GitHub is unreachable during an upgrade window): `git clone https://github.com/moreih29/nexus-core.git` to a local path and reference local files in the same order below.

## Building a New Consumer

To build a Nexus consumer harness from scratch, read [docs/consumer-implementation-guide.md](./docs/consumer-implementation-guide.md) cover to cover. It defines the 9 components you must implement, their build order, and the behavioral contracts each must satisfy.

Prerequisites:
- `npm install @moreih29/nexus-core` as a dev dependency (not shipped to end users)
- Read `manifest.json` for the agent/skill catalog
- Familiarity with your harness's plugin system (hooks, tool registration)

After initial build, set up the [Upgrade Protocol](#upgrade-protocol) below so future nexus-core version bumps are handled automatically.

## Upgrade Protocol

When `@moreih29/nexus-core` version changes in your consumer repo's `package.json`, read in this exact order:

1. **Local** `package.json` — detect the new version number
2. **Local** `node_modules/@moreih29/nexus-core/manifest.json` — current public interface snapshot
3. **WebFetch** `https://github.com/moreih29/nexus-core/blob/v{X.Y.Z}/CHANGELOG.md` — scan for `<!-- nx-car:v{X.Y.Z}:start -->` / `<!-- nx-car:v{X.Y.Z}:end -->` markers for breaking changes since the last seen version
4. **WebFetch** `https://github.com/moreih29/nexus-core/blob/v{X.Y.Z}/MIGRATIONS/{from}_to_{to}.md` — if listed in a CHANGELOG entry
5. **WebFetch** `https://github.com/moreih29/nexus-core/blob/v{X.Y.Z}/.nexus/rules/semver-policy.md` — interpretation guide for major/minor/patch bumps
6. Run `bun run validate:conformance` in the consumer repo to confirm field coverage is preserved. If new state-schema fields were added in the upgrade, extend your fixture set accordingly.

Replace `{X.Y.Z}` with the actual new version string (e.g., `v0.2.0`).

## File Contracts

| Path | Purpose | Consumer Use |
|---|---|---|
| `manifest.json` (root, in node_modules) | Structural snapshot of all agents/skills/vocabulary for the current version | Primary catalog lookup |
| `agents/{id}/meta.yml` | Agent neutral metadata | Raw metadata access if manifest is insufficient |
| `agents/{id}/body.md` | Agent prompt body (markdown + inline XML) | Prompt injection source |
| `skills/{id}/{meta.yml, body.md}` | Skill definitions (same pattern) | Skill dispatcher data |
| `vocabulary/capabilities.yml` | Abstract capability definitions (intent, blocks_semantic_classes, prose_guidance) | Semantic capability lookup; map to harness tools via local capability-map |
| `vocabulary/categories.yml` | HOW/DO/CHECK role categories | Agent classification |
| `vocabulary/resume-tiers.yml` | persistent/bounded/ephemeral tier definitions | Session persistence decisions |
| `vocabulary/tags.yml` | Canonical tag trigger definitions | Tag dispatcher |
| `schema/*.json` | JSON Schema (draft 2020-12) files | Optional runtime validation |
| `conformance/state-schemas/*.json` | State file structural validation schemas | Validate plan/tasks/history/agent-tracker files |
| `conformance/tools/*.json` | Tool behavioral conformance fixtures | Assert tool implementation compatibility |
| `conformance/scenarios/*.json` | Lifecycle scenario conformance fixtures | Validate end-to-end scenario behavior |
| `conformance/schema/fixture.schema.json` | Conformance fixture format schema | Validate fixture files themselves |
| `docs/nexus-tools-contract.md` | 11 Nexus-core tool semantic specifications | Reference for tool implementation |
| `docs/nexus-state-overview.md` | State file lifecycle and tool interaction overview | Understand state transitions |
| `docs/nexus-layout.md` | Canonical .nexus/ directory structure | Implement correct directory layout |
| `docs/behavioral-contracts.md` | Behavioral contracts (state machines, resume, permissions) | Verify harness behavioral compliance |
| `.nexus/rules/semver-policy.md` | 18-case semver interpretation table (git repo only, WebFetch) | Version bump interpretation |
| `CHANGELOG.md` (root, in node_modules) | Version history with nx-car breaking change markers | Upgrade delta analysis |
| `conformance/lifecycle/*.json` | Event-based lifecycle conformance fixtures | Validate harness-managed file behavior (agent-tracker.json) |
| `conformance/lifecycle/README.md` | Lifecycle fixture explanation | Reference for event trigger semantics |
| `docs/nexus-outputs-contract.md` | Normative contract for harness outputs (tool-produced/harness-produced/agent-produced) | Must-read before implementing state persistence |
| `scripts/conformance-coverage.ts` | Schema-field × fixture.covers coverage validator | Consumer CI pipeline integration |
| `.nexus/state/{harness-id}/*` (runtime) | Harness-local state namespace root | Create harness-specific files here (independent or extension) |
| `.nexus/state/{harness-id}/{base}.extension.json` (runtime) | Extension of a common state file (e.g., plan.extension.json) | Pair writes with the common file; own lifecycle and schema |
| `state-schemas/{base}.extension.schema.json` (harness repo) | Harness-local JSON Schema for extension files | Validate extension files in harness CI |

## Conformance Obligation

Consumers MUST pass all conformance fixtures (`conformance/tools/*.json` and `conformance/scenarios/*.json`) to claim nexus-core compatibility. This is not optional.

- **Tool fixtures** verify that each MCP tool implementation produces correct state transitions and return values.
- **Scenario fixtures** verify that multi-step lifecycle sequences (plan→decide→task→close) behave correctly end to end.
- Non-conforming implementations are not guaranteed to interoperate with other Nexus ecosystem components (e.g., state files created by one harness may not be readable by another).
- Add the conformance test runner to your CI pipeline. Conformance failures block release.

See [conformance/README.md](./conformance/README.md) for fixture format and test runner guide.

### Schema Field Coverage Obligation

Consumers MUST pass all fixture behavioral assertions AND achieve 100% state-schema field coverage across their fixture set. The authoritative check is:

```bash
bun run validate:conformance
```

(equivalent: `bun run scripts/conformance-coverage.ts`)

This validator enforces two obligations:

1. Every field in every state-schema file (plan/tasks/history/agent-tracker) must appear in at least one fixture's `covers` declaration.
2. Every `action.params` key must be asserted in postcondition or declared in the fixture's `uncovered_params` list — this prevents "silent drop" regressions where a tool receives a parameter but silently discards it.

Validator exit code 1 is a release block. The same rules apply to consumer-authored custom fixtures: if you add a state field or a tool parameter, you must extend at least one fixture to cover it.

## Harness-local State Extension

Consumers that need state fields not covered by nexus-core common schemas MUST use the `.extension.json` convention within their harness namespace directory. See [`docs/nexus-outputs-contract.md §Harness-local State Extension`](./docs/nexus-outputs-contract.md) for the full normative specification.

### Quick reference

- **Harness-id**: last segment of your npm package name (`@moreih29/claude-nexus` → `claude-nexus`).
- **Namespace root**: `.nexus/state/{harness-id}/`.
- **Extension file naming**: `{common-base}.extension.json` (e.g., `plan.extension.json`).
- **Extension schema**: own JSON Schema in your harness repo at `state-schemas/{base}.extension.schema.json`, draft 2020-12, `additionalProperties: false`.
- **Lifecycle**: entirely owned by harness session hooks. nexus-core MCP tools do not read or write extension files.
- **Archive**: do NOT inject into nexus-core's `history.json`; maintain your own `{harness-id}/history.extension.json` if needed.

### Prohibited

- Adding undeclared fields to the common schemas (`plan.json`, `tasks.json`, `history.json`, `agent-tracker.json`).
- Creating new files at the `.nexus/state/` root.
- Reusing common schema filenames inside a namespace directory.
- Writing to another harness's namespace directory.

### Convergence path

If multiple harnesses implement similar extension fields, the convergence protocol is: (1) propose a common schema addition via nexus-core PR with nx-car markers, (2) pass `bun run validate:conformance`, (3) migrate extension fields into the common schema on minor bump, (4) deprecate the local extension.

## Setup Skill Contract

Consumers MUST ship a setup skill. nexus-core does not provide one — the concerns require harness-specific implementation and cannot be expressed in harness-neutral terms.

Your setup skill MUST address at least the following concerns:

- **Scope selection** — let the user choose between user-level and project-level configuration so changes land in the right config file.
- **Status display configuration** — if your harness supports status bars, badges, or similar UI, expose the relevant toggles here.
- **Recommended plugins/extensions installation** — guide the user through installing any harness-specific extensions or plugins that Nexus depends on or recommends.
- **Knowledge initialization** — integrate with the `nx-init` skill so that first-time setup triggers codebase onboarding.

Each concern above specifies **what** must be handled. How you handle it — which commands you run, which files you modify, what prompts you show — is your decision as the consumer.

> **Migration note (v0.2.0 consumers)**: `skills/nx-setup/` was previously shipped in nexus-core. As of the next major release it is removed. Consumers must implement their own setup skill. The former `nx-setup/body.md` (last present in v0.2.0) can serve as a reference starting point for Claude Code consumers.

## CHANGELOG Marker Regex

To extract breaking changes for a specific version, match this pattern on the CHANGELOG file content:

```
/<!--\s*nx-car:v(\d+\.\d+\.\d+):start\s*-->([\s\S]*?)<!--\s*nx-car:\1:end\s*-->/g
```

Each match yields (1) the version string in group 1 and (2) the breaking change block body in group 2. The block body contains human-readable markdown with impact, action, and migration fields.

## Consumer Setup (One-Time per Consumer Repo)

Add the following to your consumer repo's agent memory file (`CLAUDE.md`, `AGENTS.md`, or equivalent):

```markdown
## @moreih29/nexus-core upgrade protocol

When `@moreih29/nexus-core` version in `package.json` changes:

1. Read `node_modules/@moreih29/nexus-core/manifest.json`
2. WebFetch `https://github.com/moreih29/nexus-core/blob/v{new_version}/CONSUMING.md`
3. Follow the Upgrade Protocol documented there
```

This one-time setup lets your consumer repo's LLM agents discover the upgrade protocol whenever a version bump is detected.

## References

- [README.md](./README.md) — project overview (human audience)
- [CHANGELOG.md](./CHANGELOG.md) — version history
- [.nexus/rules/semver-policy.md](./.nexus/rules/semver-policy.md) — version bump interpretation
- [.nexus/context/evolution.md](./.nexus/context/evolution.md) — Forward-only 완화 정책 근거
- plan session #2 Issue #8 (2026-04-11) — this protocol's design decisions
- [docs/nexus-outputs-contract.md](./docs/nexus-outputs-contract.md) — normative outputs contract (tool-produced / harness-produced / agent-produced)
- [conformance/lifecycle/README.md](./conformance/lifecycle/README.md) — lifecycle fixture reference and event trigger semantics
