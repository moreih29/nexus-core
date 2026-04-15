# .nexus/ Directory Layout

This document is the canonical reference for the `.nexus/` directory structure used by all Nexus harnesses. Harnesses read this layout to know where to write, read, and archive runtime state.

---

## Directory Tree

```
.nexus/
├── state/                    ← session/branch-scoped (ephemeral)
│   ├── plan.json
│   ├── tasks.json
│   ├── tool-log.jsonl
│   ├── artifacts/
│   ├── claude-nexus/         ← harness-namespaced directory (example)
│   │   ├── agent-tracker.json
│   │   ├── edit-tracker.json
│   │   └── reopen-tracker.json
│   └── opencode-nexus/       ← harness-namespaced directory (example)
│       ├── agent-tracker.json
│       ├── edit-tracker.json
│       └── reopen-tracker.json
├── history.json              ← project-scoped (git-tracked, append-only)
├── memory/                   ← project-scoped (git-tracked)
│   └── *.md
├── context/                  ← project-scoped (git-tracked, nx-sync managed)
│   └── *.md
├── rules/                    ← project-scoped (git-tracked, user-defined)
│   └── *.md
└── .gitignore
```

---

## Entry Reference

### `state/`

**Purpose.** Holds all runtime state for the current session or branch. Contents are ephemeral and not meaningful across sessions.

**Scope.** Session-scoped.

**Git tracking.** Ignored via `.gitignore`.

**Lifecycle.** Created when the first plan or run cycle begins. Cleared or reset when a new cycle starts or when the session ends. Individual files within `state/` may be archived to `history.json` at cycle close (see `task_close`).

**Owner.** Harness runtime, via lifecycle hooks.

---

#### `state/plan.json`

**Purpose.** Active plan for the current cycle. Contains issues and their decision status.

**Scope.** Session-scoped (one plan per cycle).

**Git tracking.** Ignored.

**Lifecycle.** Created by `nx-plan` skill at cycle start. Archived into `history.json` at `task_close`. Deleted or overwritten when a new cycle begins.

**Owner.** `nx-plan` skill; updated by plan lifecycle tools.

---

#### `state/tasks.json`

**Purpose.** Task list for the current cycle. Tracks task status, ownership, dependencies, and agent configuration for each unit of work.

**Scope.** Session-scoped.

**Git tracking.** Ignored.

**Lifecycle.** Created alongside `plan.json` at cycle start. Archived to `history.json` at `task_close`.

**Owner.** `nx-run` skill; updated by task lifecycle tools.

---

#### `state/{harness-id}/agent-tracker.json`

**Purpose.** Records which subagents have been spawned in the current session, their assigned tasks, and their resume-tier classification. Each harness writes into its own subdirectory under `state/` (for example, `state/claude-nexus/` or `state/opencode-nexus/`), keeping agent-tracker records isolated across harness namespaces.

**Scope.** Session-scoped.

**Git tracking.** Ignored.

**Lifecycle.** Created when the first subagent is spawned in the session. The harness creates the `{harness-id}/` subdirectory if it does not already exist. Cleared at session end.

**Owner.** Harness agent-management layer.

---

#### `state/tool-log.jsonl`

**Purpose.** Append-only log of tool invocations made during the current session. Used for auditing, debugging, and post-session analysis.

**Scope.** Session-scoped.

**Git tracking.** Ignored.

**Lifecycle.** Appended to throughout the session. Discarded or rotated at session end.

**Owner.** Harness tool-invocation layer.

---

#### `state/{harness-id}/edit-tracker.json`

**Purpose.** Tracks which files have been edited in the current session. Used by the bounded resume tier to detect intervening edits before allowing agent reuse.

**Scope.** Session-scoped.

**Git tracking.** Ignored.

**Lifecycle.** Created on first file edit. Cleared at session end by the consumer harness session hook.

**Owner.** Consumer harness session hook. Not managed by any nexus-core MCP tool.

---

#### `state/{harness-id}/reopen-tracker.json`

**Purpose.** Records tasks or plan issues that have been reopened within the current cycle, to prevent infinite reopen loops.

**Scope.** Session-scoped.

**Git tracking.** Ignored.

**Lifecycle.** Created on first reopen event. Cleared at cycle end by the consumer harness session hook.

**Owner.** Consumer harness session hook. Not managed by any nexus-core MCP tool.

---

#### `state/artifacts/`

**Purpose.** Stores intermediate and final deliverables produced by subagents during the current cycle (e.g., reports, synthesized documents, analysis outputs).

**Scope.** Session-scoped.

**Git tracking.** Ignored.

**Lifecycle.** Files are written here by subagents during a run cycle. The directory persists for the session; individual files may be promoted to project-level locations by Lead before the cycle closes.

**Owner.** Subagents writing deliverables; Lead controls promotion.

---

### `history.json`

**Purpose.** Append-only archive of completed plan and task cycles. Each completed cycle contributes one record. Used to reconstruct project history and provide context for future plans.

**Scope.** Project-scoped.

**Git tracking.** Tracked (committed to the repository).

**Lifecycle.** Created on first `task_close`. Records are appended at each subsequent `task_close`. Never truncated or overwritten; only appended.

**Owner.** `task_close` lifecycle tool.

---

### `memory/`

**Purpose.** Stores lessons learned, reference notes, and durable observations captured with the `[m]` tag. Each note is a standalone Markdown file.

**Scope.** Project-scoped.

**Git tracking.** Tracked.

**Lifecycle.** Files are created when Lead or a subagent records a memory entry. They persist indefinitely. Stale entries are merged or removed via `[m:gc]`.

**Owner.** Memory-store inline action; garbage-collected by `[m:gc]`.

---

### `context/`

**Purpose.** Holds design documents and architecture philosophy that describe the project's principles and current state. Managed by the `nx-sync` skill, which keeps these documents current with the actual codebase.

**Scope.** Project-scoped.

**Git tracking.** Tracked.

**Lifecycle.** Files are created or updated by `[sync]`. They should be refreshed whenever the project's architecture or design intent changes significantly.

**Owner.** `nx-sync` skill.

---

### `rules/`

**Purpose.** Contains user-defined project rules created with the `[rule]` tag. Rules constrain agent behavior for this specific project and take precedence over default behavior.

**Scope.** Project-scoped.

**Git tracking.** Tracked.

**Lifecycle.** Files are created by the rule-store inline action and persist indefinitely. Users are responsible for removing obsolete rules.

**Owner.** Rule-store inline action (`[rule]`); maintained by users.

---

### `.gitignore`

**Purpose.** Ensures that ephemeral session state is not committed to the repository while project-scoped files remain tracked.

**Scope.** Project-scoped.

**Git tracking.** Tracked.

**Lifecycle.** Created during project initialization. Updated when new ephemeral paths are added to `state/`.

**Owner.** Nexus initialization tooling.

**Convention.** The `.gitignore` inside `.nexus/` must ignore the `state/` directory and all its contents. The following entries must be tracked and must not appear in `.gitignore`: `memory/`, `context/`, `rules/`, `history.json`.

Minimal required content:

```
state/
```
