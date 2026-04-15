# Nexus State File Overview

This document is the normative specification for all files and directories that constitute Nexus runtime and project state. It defines each file's purpose, lifecycle, git-tracking status, and the tools that read or write it.

The Nexus state layout is divided into two categories:

- **Session-scoped state** — created and deleted within a single planning/execution cycle; not git-tracked.
- **Project-scoped content** — persists across cycles; git-tracked as part of the repository.

---

## State File Reference

### `.nexus/state/plan.json`

| Attribute | Value |
|-----------|-------|
| Scope | Session |
| Git-tracked | No |
| Created by | `plan_start` |
| Deleted by | `plan_start` (auto-archive of prior session), `task_close` |

**Purpose.** Holds the active planning session. Contains the plan `id`, `topic`, `research_summary`, `created_at`, and the ordered list of `PlanIssue` objects. Each issue records its `id`, `title`, `status` (`"pending"` or `"decided"`), and — once decided — the `decision` summary along with optional `how_agents`, `how_summary`, and `how_agent_ids` fields.

**Creation trigger.** `plan_start` writes this file after archiving any existing session. The `id` is set to one greater than the highest plan `id` found in `history.json`.

**Deletion trigger.** `task_close` archives the file's contents into `history.json` and then deletes it. `plan_start` also deletes a pre-existing `plan.json` when starting a new session (archiving it first).

**Tool access.**

| Tool | Access |
|------|--------|
| `plan_start` | Write (creates) |
| `plan_status` | Read |
| `plan_update` | Read + Write |
| `plan_decide` | Read + Write |
| `task_close` | Read + Delete |
| `context` | None |

---

### `.nexus/state/tasks.json`

| Attribute | Value |
|-----------|-------|
| Scope | Session |
| Git-tracked | No |
| Created by | `task_add` (on first call) |
| Deleted by | `task_close` |

**Purpose.** Holds the active task list. Contains a top-level `goal` string, a `decisions` string array (key decisions from the plan session), and a `tasks` array. Each task records `id`, `title`, `context`, optional `approach`, `acceptance`, `risk`, `status`, `deps`, `plan_issue`, `owner`, `owner_agent_id`, `owner_reuse_policy`, and `created_at`.

**Creation trigger.** `task_add` initializes this file with `{ goal: "", decisions: [], tasks: [] }` when it does not yet exist, then immediately appends the first task.

**Deletion trigger.** `task_close` archives the task list into `history.json` and deletes this file.

**Tool access.**

| Tool | Access |
|------|--------|
| `task_add` | Write (creates if absent) |
| `task_list` | Read |
| `task_update` | Read + Write |
| `task_close` | Read + Delete |
| `context` | Read |

---

### `.nexus/history.json`

| Attribute | Value |
|-----------|-------|
| Scope | Project |
| Git-tracked | Yes |
| Created by | `plan_start` or `task_close` (on first archive) |
| Deleted by | Never |

**Purpose.** Append-only ledger of completed planning and execution cycles. Each entry (a "cycle") captures `completed_at`, `branch`, the full `plan` object (or `null`), and the full `tasks` array at time of closure.

**Creation trigger.** Created automatically by `plan_start` when it archives a prior session, or by `task_close` when it archives the current cycle. If the file already exists, new cycles are appended to the `cycles` array.

**Deletion trigger.** Never deleted. This file is the permanent project record.

**Tool access.**

| Tool | Access |
|------|--------|
| `plan_start` | Read + Write (archive pre-existing plan) |
| `task_close` | Read + Write (archive current cycle) |
| `history_search` | Read |

---

### `.nexus/state/{harness-id}/agent-tracker.json`

| Attribute | Value |
|-----------|-------|
| Scope | Session |
| Git-tracked | No |
| Created by | Session start (harness hook) |
| Deleted by | Session end (harness hook) |

**Purpose.** Tracks agent instance activity during the session — which agents were spawned, their instance IDs, and what artifacts they touched. Used by the harness to evaluate `owner_reuse_policy` on subsequent `task_add` calls and to support agent resume. Each harness writes its own file under a harness-specific subdirectory, keeping records isolated across harness namespaces.

**Schema.** The file contains a JSON array. Each entry is an object representing one spawned agent instance. Required fields per entry: `harness_id` (string, identifies the writing harness) and `started_at` (ISO 8601 timestamp when the agent instance was first started). The following fields are optional per entry: `agent_name`, `agent_id`, `last_resumed_at`, `resume_count`, `status`, `stopped_at`, `last_message`, and `files_touched`. Harness-defined extension fields are not permitted — `additionalProperties` is false per the schema.

The `agent_id` field, when present, is a harness-specific opaque agent instance identifier. Its format is defined by the writing harness (for example, a UUID, a composite string, or another harness-native scheme). Consumers of this file treat the value as opaque — they do not parse it or infer agent identity across harness namespaces.

**Creation trigger.** Initialized by the harness at session start. The harness creates the `{harness-id}/` subdirectory if it does not already exist.

**Deletion trigger.** Removed by the harness upon session teardown.

**Tool access.** Managed exclusively by harness hooks. No Nexus MCP tool listed in this specification writes to this file. When `task_add` records an `owner_agent_id` on a task, it stores the value as received from the harness without parsing or interpreting it — the value is passed through opaquely to the harness on subsequent reads.

---

### `.nexus/state/artifacts/`

| Attribute | Value |
|-----------|-------|
| Scope | Session |
| Git-tracked | No |
| Created by | `artifact_write` |
| Deleted by | Session end (harness cleanup) or manual removal |

**Purpose.** Stores named artifact files produced by agents during a session — research outputs, synthesis documents, analysis reports, and similar deliverables. Each file is written by a single call to `artifact_write` and may be overwritten by subsequent calls with the same filename.

**Creation trigger.** The directory is created on demand by the first `artifact_write` call in a session.

**Deletion trigger.** Session-scoped; not archived by `task_close`. Persistence beyond the session is the caller's responsibility.

**Tool access.**

| Tool | Access |
|------|--------|
| `artifact_write` | Write (creates directory if absent, writes file) |

---

## Content File Conventions

The following directories hold project-scoped knowledge files. All are git-tracked and persist across sessions and cycles.

### `.nexus/memory/*.md`

**Purpose.** Stores lessons learned, reference notes, and factual anchors accumulated during project work. Each file is a discrete note tagged with the `[m]` convention. Files are authored and updated by the Lead agent in response to `[m]` tags in conversation.

**Lifecycle.** Created manually or by Lead; updated incrementally. Stale entries are garbage-collected via the `[m:gc]` convention. No Nexus MCP tool writes to this directory.

**Format.** Plain Markdown. An optional `<!-- tags: tag1, tag2, tag3 -->` comment may appear as the first line to support filtering. No required frontmatter schema.

---

### `.nexus/context/*.md`

**Purpose.** Stores design principles, architecture philosophy, and structural decisions that define how the project should evolve. These files represent the canonical design record and are the primary input for the `nx-sync` skill.

**Lifecycle.** Created and updated by the `nx-sync` skill, which scans the current project state and reconciles it with existing context documents. Human authors may also edit these files directly. No Nexus MCP tool writes to this directory during normal execution.

**Format.** Plain Markdown. An optional `<!-- tags: tag1, tag2, tag3 -->` comment may appear as the first line. No required frontmatter schema.

---

### `.nexus/rules/*.md`

**Purpose.** Stores user-defined rules that govern agent behavior, coding conventions, and process constraints specific to this project. Rules are authored by the user via the `[rule]` and `[rule:*]` tag conventions.

**Lifecycle.** Created by the Lead agent when the user asserts a rule via the `[rule]` tag. Rules persist indefinitely unless explicitly removed or superseded. No Nexus MCP tool writes to this directory.

**Format.** Plain Markdown. An optional `<!-- tags: tag1, tag2, tag3 -->` comment may appear as the first line to support categorization. No required frontmatter schema.
