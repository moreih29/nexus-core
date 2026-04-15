# Nexus MCP Tool Contracts

This document is the normative specification for the eleven Nexus MCP tools. Implementations in all consumer harnesses (claude-nexus, opencode-nexus) must conform to the parameter names, types, return shapes, side effects, and error conditions defined here. Harness-specific registration names (prefixes such as `nx_` or `mcp__plugin_*`) are implementation details and are not part of this specification.

---

## plan_start

Creates a new planning session. If a plan session is already active (i.e., `plan.json` exists), it is automatically archived to `history.json` before the new session is written.

### Parameters

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `topic` | `string` | yes | Theme or subject of the planning session |
| `issues` | `string[]` | yes | Ordered list of agenda items to resolve during the session |
| `research_summary` | `string` | yes | Evidence that prerequisite research has been completed; serves as a gate to enforce research before planning |

### Return Value

| Field | Type | Description |
|-------|------|-------------|
| `created` | `boolean` | Always `true` on success |
| `plan_id` | `number` | Monotonically increasing identifier assigned to the new plan; derived by incrementing the highest `id` found across all archived cycles in `history.json` |
| `topic` | `string` | Echo of the `topic` parameter |
| `issueCount` | `number` | Number of issues registered in the new session |
| `previousArchived` | `boolean` | `true` if a pre-existing `plan.json` was archived before creating the new session |

### Side Effects

- Creates `.nexus/state/plan.json` with `id`, `topic`, `issues` (each with `id`, `title`, `status: "pending"`), `research_summary`, and `created_at`.
- If a prior `plan.json` existed, appends a cycle record to `.nexus/history.json` (creating the file if absent), then deletes the prior `plan.json`.

### Error Conditions

- No explicit error return; the tool always succeeds if called with valid parameters. Callers must ensure `research_summary` is a non-empty string — the parameter is required by schema, but an empty string is not rejected at the tool level.

---

## plan_status

Returns the current state of the active planning session.

### Parameters

None.

### Return Value

When no session is active:

| Field | Type | Description |
|-------|------|-------------|
| `active` | `boolean` | Always `false` |

When a session is active:

| Field | Type | Description |
|-------|------|-------------|
| `active` | `boolean` | Always `true` |
| `plan_id` | `number` | Identifier of the active plan |
| `topic` | `string` | Planning session theme |
| `issues` | `PlanIssue[]` | Full list of issues with their current state (see schema below) |
| `research_summary` | `string \| undefined` | Research evidence recorded at session creation |
| `summary.total` | `number` | Total number of issues |
| `summary.pending` | `number` | Issues not yet decided |
| `summary.decided` | `number` | Issues with a recorded decision |

**PlanIssue schema:**

| Field | Type | Description |
|-------|------|-------------|
| `id` | `number` | Issue identifier, unique within the plan |
| `title` | `string` | Issue description |
| `status` | `"pending" \| "decided"` | Current resolution state |
| `decision` | `string \| undefined` | Decision summary, present only when `status` is `"decided"` |
| `how_agents` | `string[] \| undefined` | Names of HOW agents that participated in analysis |
| `how_summary` | `Record<string, string> \| undefined` | Key positions per agent |
| `how_agent_ids` | `Record<string, string> \| undefined` | Agent name to agent-instance ID mapping, for session resume |

### Side Effects

None. Read-only.

### Error Conditions

None. Returns `{ active: false }` when `plan.json` does not exist.

---

## plan_update

Mutates the issue list of the active planning session. Supports four discrete actions.

### Parameters

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `action` | `"add" \| "remove" \| "edit" \| "reopen"` | yes | Operation to perform |
| `issue_id` | `number` | conditional | Target issue identifier; required for `remove`, `edit`, and `reopen` |
| `title` | `string` | conditional | Issue title text; required for `add` and `edit` |

### Return Value

All responses include an `issue` field containing the affected `PlanIssue` object.

The `issue` object contains:

| Field | Type | Presence |
|-------|------|----------|
| `id` | `number` | always |
| `title` | `string` | on `add`, `edit`, `reopen` |
| `status` | `"pending" \| "decided"` | on `add`, `reopen` |

The discriminating field varies by action:

| Action | Discriminating Field | Value |
|--------|----------------------|-------|
| `add` | `added` | `true` |
| `remove` | `removed` | `true` |
| `edit` | `edited` | `true` |
| `reopen` | `reopened` | `true` |

On error, returns `{ error: string }`.

### Side Effects

- Writes the updated issue list back to `.nexus/state/plan.json`.
- For `reopen`: clears `status` to `"pending"` and removes the `decision` field from the target issue.

### Error Conditions

| Condition | Error message |
|-----------|---------------|
| No active plan session | `"No active plan session"` |
| `remove` or `reopen` called without `issue_id` | `"issue_id is required for <action>"` |
| `edit` called without `issue_id` or `title` | `"issue_id and title are required for edit"` |
| `add` called without `title` | `"title is required for add"` |
| Referenced `issue_id` not found | `"Issue <id> not found"` |
| Unrecognized `action` value | `"Unknown action"` |

---

## plan_decide

Records a decision for a specific issue and marks it as `"decided"`. Triggered by the `[d]` tag convention.

### Parameters

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `issue_id` | `number` | yes | Identifier of the issue being decided |
| `decision` | `string` | yes | Decision text to record against the issue |
| `how_agents` | `string[]` | no | Names of HOW agents that contributed analysis |
| `how_summary` | `Record<string, string>` | no | Per-agent key position summaries |
| `how_agent_ids` | `Record<string, string>` | no | Agent name to agent-instance ID mapping for future resume |

### Return Value

| Field | Type | Description |
|-------|------|-------------|
| `decided` | `boolean` | Always `true` on success |
| `issue` | `string` | Title of the decided issue |
| `allComplete` | `boolean` | `true` if every issue in the plan now has `status: "decided"` |
| `message` | `string \| undefined` | Guidance for the next step, present only when `allComplete` is `true` |
| `remaining` | `Array<{id, title, status}>` \| undefined | List of undecided issues, present only when `allComplete` is `false` |

### Side Effects

- Updates the target issue in `.nexus/state/plan.json`: sets `status` to `"decided"`, writes `decision`, and conditionally writes `how_agents`, `how_summary`, `how_agent_ids`.

### Error Conditions

| Condition | Error message |
|-----------|---------------|
| No active plan session | `"No active plan session"` |
| Referenced `issue_id` not found | `"Issue <id> not found"` |

---

## task_list

Returns the full task list with a computed progress summary.

### Parameters

None.

### Return Value

When `tasks.json` does not exist:

| Field | Type | Description |
|-------|------|-------------|
| `exists` | `boolean` | Always `false` |

When `tasks.json` exists:

| Field | Type | Description |
|-------|------|-------------|
| `goal` | `string` | Top-level goal for this task cycle |
| `tasks` | `Task[]` | Full task list (see Task schema below) |
| `summary.total` | `number` | Total task count |
| `summary.completed` | `number` | Tasks with `status: "completed"` |
| `summary.pending` | `number` | Tasks with `status: "pending"` |
| `summary.blocked` | `number` | Tasks with `status: "in_progress"` |
| `summary.ready` | `number[]` | IDs of pending tasks whose dependencies are all completed |

**Task schema:**

| Field | Type | Description |
|-------|------|-------------|
| `id` | `number` | Task identifier, unique within the cycle |
| `title` | `string` | Task title |
| `context` | `string` | Background or description |
| `approach` | `string \| undefined` | Implementation approach |
| `acceptance` | `string \| undefined` | Definition of done |
| `risk` | `string \| undefined` | Known risks or caveats |
| `status` | `"pending" \| "in_progress" \| "completed"` | Current state |
| `deps` | `number[]` | IDs of tasks that must be completed before this one |
| `plan_issue` | `number \| undefined` | Source issue ID in the associated plan session |
| `owner` | `string \| undefined` | Assigned agent name |
| `owner_agent_id` | `string \| undefined` | Agent instance ID for session resume |
| `owner_reuse_policy` | `"fresh" \| "resume_if_same_artifact" \| "resume" \| undefined` | Agent spawn policy |
| `created_at` | `string \| undefined` | ISO 8601 creation timestamp |

### Side Effects

None. Read-only.

### Error Conditions

None. Returns `{ exists: false }` when `tasks.json` does not exist.

---

## task_add

Adds a new task to the active task list. Creates `tasks.json` if it does not exist.

### Parameters

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `title` | `string` | yes | Task title |
| `context` | `string` | yes | Background or description of the task |
| `deps` | `number[]` | no | IDs of prerequisite tasks; defaults to `[]` |
| `approach` | `string` | no | Proposed implementation approach |
| `acceptance` | `string` | no | Acceptance criteria defining done |
| `risk` | `string` | no | Known risks or caveats |
| `plan_issue` | `number` | no | Plan issue ID this task originates from |
| `goal` | `string` | no | Sets or replaces the top-level goal of the task list |
| `decisions` | `string[]` | no | Decision strings to append to the task list's `decisions` array |
| `owner` | `string` | no | Assignee agent name |
| `owner_agent_id` | `string` | no | Agent instance ID for resume; if absent, a fresh instance is spawned |
| `owner_reuse_policy` | `"fresh" \| "resume_if_same_artifact" \| "resume"` | no | Controls agent reuse: `fresh` forces a new spawn; `resume_if_same_artifact` resumes only if the prior agent touched the same target file; `resume` always resumes |

### Return Value

| Field | Type | Description |
|-------|------|-------------|
| `task` | `Task` | The newly created task object |

### Side Effects

- Creates `.nexus/state/tasks.json` if absent (initializing `goal: ""`, `decisions: []`, `tasks: []`).
- Appends the new task with an auto-incremented `id` (max existing `id` + 1).
- If `goal` is provided, overwrites the file-level `goal` field.
- If `decisions` is provided, appends to the file-level `decisions` array.

### Error Conditions

None. The tool always succeeds when called with the required parameters.

---

## task_update

Updates the status of an existing task.

### Parameters

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `id` | `number` | yes | Identifier of the task to update |
| `status` | `"pending" \| "in_progress" \| "completed"` | yes | New status value |

### Return Value

| Field | Type | Description |
|-------|------|-------------|
| `task` | `Task` | The updated task object |

### Side Effects

- Writes the updated status back to `.nexus/state/tasks.json`.

### Error Conditions

| Condition | Error message |
|-----------|---------------|
| `tasks.json` does not exist | `"tasks.json not found"` |
| Referenced `id` not found | `"Task id <id> not found"` |

---

## task_close

Closes the current work cycle by archiving the active plan and task list to `history.json`, then deleting all session-scoped state files.

### Parameters

None.

### Return Value

| Field | Type | Description |
|-------|------|-------------|
| `closed` | `boolean` | Always `true` |
| `cycle` | `string` | ISO 8601 timestamp of the closed cycle |
| `branch` | `string` | Git branch name at time of closure |
| `archived.plan` | `boolean` | `true` if a `plan.json` was present and archived |
| `archived.decisions` | `number` | Count of decided issues archived from the plan |
| `archived.tasks` | `number` | Count of tasks archived |
| `deleted` | `string[]` | Filenames of deleted session-state files |
| `total_cycles` | `number` | Total number of cycles in `history.json` after closure |
| `memoryHint.taskCount` | `number` | Number of tasks in the closed cycle |
| `memoryHint.decisionCount` | `number` | Number of decided issues in the closed cycle |
| `memoryHint.cycleTopics` | `string[]` | Non-empty strings from `plan.topic` and `tasks.goal` |

### Side Effects

- Appends a cycle record to `.nexus/history.json` (creating the file if absent). The record contains `completed_at`, `branch`, `plan` (full `PlanFile` or `null`), and `tasks` (full `Task[]`).
- Deletes the following session-scoped files if they exist: `plan.json`, `tasks.json` (all within `.nexus/state/`).

Harness-local tracker files (`edit-tracker.json`, `reopen-tracker.json`, and any other files under `.nexus/state/{harness-id}/`) are not managed by `task_close`. Their lifecycle is the responsibility of consumer harness session hooks.

### Error Conditions

None. The tool succeeds even when no plan or tasks are active; it archives whatever state exists.

---

## history_search

Searches past plan/task cycles recorded in `history.json`.

### Parameters

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `query` | `string` | no | Search term matched case-insensitively against the full JSON of each cycle (topic, decisions, research_summary, task titles, etc.) |
| `last_n` | `number` | no | Return only the last N matching cycles; defaults to `10` |

### Return Value

| Field | Type | Description |
|-------|------|-------------|
| `total` | `number` | Total number of matching cycles before limiting |
| `showing` | `number` | Number of cycles returned |
| `cycles` | `CycleSummary[]` | Summarized cycle records (see below) |

**CycleSummary schema:**

| Field | Type | Description |
|-------|------|-------------|
| `completed_at` | `string` | ISO 8601 timestamp of cycle closure |
| `branch` | `string` | Git branch at time of closure |
| `topic` | `string \| undefined` | Plan topic, if a plan was archived |
| `decisions` | `Array<{title, decision}>` \| undefined | Decided issues from the plan |
| `task_count` | `number \| undefined` | Number of tasks in the cycle |

### Side Effects

None. Read-only.

### Error Conditions

None. Returns `{ cycles: [], total: 0 }` when `history.json` does not exist.

---

## context

Returns a snapshot of the current session context: active task summary, decisions, and current branch.

### Parameters

None.

### Return Value

| Field | Type | Description |
|-------|------|-------------|
| `branch` | `string` | Current git branch |
| `activeMode` | `"team" \| null` | `"team"` if `tasks.json` is present; `null` otherwise |
| `goal` | `string \| undefined` | Top-level goal from `tasks.json`; present only when `activeMode` is `"team"` |
| `tasksSummary.total` | `number \| undefined` | Total task count; present only when `activeMode` is `"team"` |
| `tasksSummary.completed` | `number \| undefined` | Completed task count; present only when `activeMode` is `"team"` |
| `tasksSummary.pending` | `number \| undefined` | Pending task count; present only when `activeMode` is `"team"` |
| `decisions` | `string[]` | Decisions from `decisions.json`; empty array if the file does not exist |

### Side Effects

None. Read-only.

### Error Conditions

None. Partial data (e.g., malformed JSON in `tasks.json` or `decisions.json`) is silently ignored; the tool returns whatever it can read.

---

## artifact_write

Writes a named artifact file (report, synthesis, analysis output) to the session artifact directory.

### Parameters

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `filename` | `string` | yes | Name of the file to write (e.g., `"findings.md"`, `"synthesis.md"`) |
| `content` | `string` | yes | Full content to write to the file |

### Return Value

| Field | Type | Description |
|-------|------|-------------|
| `success` | `boolean` | Always `true` on success |
| `path` | `string` | Absolute path to the written file |

### Side Effects

- Creates `.nexus/state/artifacts/` if it does not exist.
- Writes (or overwrites) `.nexus/state/artifacts/<filename>` with `content`.

### Error Conditions

None declared at the tool level. Filesystem errors (permissions, disk full) will surface as unhandled exceptions.
