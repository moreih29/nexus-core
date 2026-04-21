# MCP Server Tools

`nexus-core` ships an MCP server that exposes Nexus state-management tools over stdio.

- Server entrypoint: [src/mcp/server.ts](/Users/kih/workspaces/areas/nexus-core/src/mcp/server.ts:1)
- Registered groups: `plan`, `task`, `history`, `artifact`

The server does not ship skill or agent logic. It only owns persistent Nexus state and artifact operations.

## Tool Groups

### Plan

Planning-session lifecycle tools backed by `.nexus/state/plan.json`.

| Tool | Purpose |
|---|---|
| `nx_plan_start` | Start a new planning session and archive any existing `plan.json` |
| `nx_plan_status` | Return current planning-session status |
| `nx_plan_update` | Add, remove, modify, or reopen issues in the active plan |
| `nx_plan_decide` | Record a decision for a plan issue |
| `nx_plan_resume` | Return resume routing information for a HOW participant |
| `nx_plan_analysis_add` | Append an analysis entry to a plan issue |

Definitions:
- [src/mcp/definitions/plan.ts](/Users/kih/workspaces/areas/nexus-core/src/mcp/definitions/plan.ts:1)

Handler:
- [src/mcp/handlers/plan.ts](/Users/kih/workspaces/areas/nexus-core/src/mcp/handlers/plan.ts:1)

### Task

Execution-task lifecycle tools backed by `.nexus/state/tasks.json`.

| Tool | Purpose |
|---|---|
| `nx_task_add` | Add a new task to `tasks.json` |
| `nx_task_list` | Read `tasks.json` and return tasks plus a summary |
| `nx_task_update` | Partially update task status or owner metadata |
| `nx_task_close` | Close the current cycle, archive to `history.json`, remove `plan.json` and `tasks.json` |
| `nx_task_resume` | Return resume routing information for a task owner |

Definitions:
- [src/mcp/definitions/task.ts](/Users/kih/workspaces/areas/nexus-core/src/mcp/definitions/task.ts:1)

Handler:
- [src/mcp/handlers/task.ts](/Users/kih/workspaces/areas/nexus-core/src/mcp/handlers/task.ts:1)

### History

Archived-cycle lookup backed by `.nexus/history.json`.

| Tool | Purpose |
|---|---|
| `nx_history_search` | Search archived cycles or return recent entries |

Definitions:
- [src/mcp/definitions/history.ts](/Users/kih/workspaces/areas/nexus-core/src/mcp/definitions/history.ts:1)

Handler:
- [src/mcp/handlers/history.ts](/Users/kih/workspaces/areas/nexus-core/src/mcp/handlers/history.ts:1)

### Artifact

Artifact write operations backed by `.nexus/state/artifacts/`.

| Tool | Purpose |
|---|---|
| `nx_artifact_write` | Write an artifact file under the Nexus state artifacts directory |

Definitions:
- [src/mcp/definitions/artifact.ts](/Users/kih/workspaces/areas/nexus-core/src/mcp/definitions/artifact.ts:1)

Handler:
- [src/mcp/handlers/artifact.ts](/Users/kih/workspaces/areas/nexus-core/src/mcp/handlers/artifact.ts:1)

## Files Touched by the MCP Server

| Path | Owned by |
|---|---|
| `.nexus/state/plan.json` | Plan tools |
| `.nexus/state/tasks.json` | Task tools |
| `.nexus/history.json` | History search reads; `nx_task_close` archives to it |
| `.nexus/state/artifacts/` | Artifact write |

## Not in Scope

The MCP server does not:

- generate harness-specific agent or skill files
- inject lead into the main harness session
- install plugin manifests, config fragments, or harness bootstraps
- interpret `{{...}}` macros at runtime

Those concerns belong to the sync/generation pipeline.
