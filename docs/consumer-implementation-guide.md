# Nexus Consumer Implementation Guide

**Version:** nexus-core 0.2.0
**Audience:** Developers building a Nexus consumer harness from scratch.

---

## Table of Contents

1. [Overview](#1-overview)
2. [Prerequisites](#2-prerequisites)
3. [Component Map and Build Order](#3-component-map-and-build-order)
4. [State File Management](#4-state-file-management)
5. [MCP Tool Implementation](#5-mcp-tool-implementation)
6. [Capability Handling](#6-capability-handling)
7. [Agent Catalog Construction](#7-agent-catalog-construction)
8. [Skill Activation Architecture](#8-skill-activation-architecture)
9. [Hook Event Lifecycle](#9-hook-event-lifecycle)
10. [Subagent Orchestration Model](#10-subagent-orchestration-model)
11. [Conformance Verification](#11-conformance-verification)
12. [Minimum Viable Consumer](#12-minimum-viable-consumer)

---

## 1. Overview

A **Nexus consumer** is an execution-layer harness that reads nexus-core and orchestrates agents on behalf of the user. nexus-core is the authoring layer: it defines prompts, metadata, vocabulary, schemas, conformance fixtures, and documentation. The consumer is the runtime layer: it implements tool execution, spawns agents, enforces capability gates, and manages session state.

### What nexus-core provides

- **Agent prompts** — `agents/{id}/body.md`, harness-neutral behavioral specifications for each agent role
- **Skill prompts** — `skills/{id}/body.md`, full behavioral specifications for each skill
- **Metadata** — `agents/{id}/meta.yml` and `skills/{id}/meta.yml`, structured descriptions of each agent and skill
- **Manifest** — `manifest.json`, a single-file snapshot of all agents, skills, and vocabulary for the current version
- **Vocabulary** — `vocabulary/capabilities.yml`, `tags.yml`, `resume-tiers.yml`, `categories.yml`, abstract definitions of the Nexus semantic model
- **Schemas** — `schema/*.json`, JSON Schema definitions for all data structures
- **Conformance fixtures** — `conformance/tools/*.json` and `conformance/scenarios/*.json`, declarative behavioral tests
- **Documentation** — `docs/`, normative specifications for tools, state files, layout, and behavioral contracts

### What the consumer builds

- **Runtime orchestration** — session start/end logic, cycle management, state file creation and cleanup
- **Tool implementation** — concrete implementations of the 11 abstract Nexus tools
- **Hook system** — lifecycle event handlers that fire at well-defined points in the session
- **Capability mapping** — a local file that translates abstract capability IDs to concrete disallowed tools in your harness
- **Agent catalog** — your harness's agent registration, populated from nexus-core agent definitions
- **Skill dispatcher** — tag detection and skill body injection
- **Subagent orchestration** — spawn, context injection, resume evaluation, result collection
- **UI integration** — your harness's plugin registration, command system, and inter-process communication

### How to use this guide

Read this guide cover to cover before writing any code. The sections are ordered by build dependency: later sections assume the structures established by earlier ones. Jumping ahead and implementing subagent orchestration before state file management or tool implementation is defined will produce integration failures that are difficult to diagnose.

Cross-reference the normative specifications linked throughout. This guide describes what to build and in what order; the linked documents define the precise contracts your implementation must satisfy.

---

## 2. Prerequisites

### Package installation

Install nexus-core as a development dependency. It is not shipped to end users — it is consumed at build time by your harness.

```
npm install --save-dev @moreih29/nexus-core
```

After installation, the package is available at `node_modules/@moreih29/nexus-core/`. All paths in this guide referencing nexus-core files resolve from that root.

### Knowledge prerequisites

Before building a consumer, you must be familiar with:

1. **Your harness's plugin system** — how to register tools that the LLM can call, how hooks are declared and fire, and how to inject content into the LLM's context (system prompt, tool response, or user message prefix).
2. **Your harness's agent/subprocess model** — how to spawn an isolated LLM session, how to pass initial context, and how to receive the result.
3. **JSON and YAML** — all nexus-core metadata files are YAML or JSON; all state files are JSON.

### Primary entry points

Begin your implementation by reading these files in order:

1. `manifest.json` — the complete catalog of agents, skills, and vocabulary for the installed version. This is your primary lookup source; most implementation tasks start here.
2. `docs/nexus-tools-contract.md` — normative specifications for all 11 tools: parameters, return values, side effects, and error conditions. Read this before implementing any tool.
3. `docs/nexus-state-overview.md` — lifecycle and tool access table for every state file.
4. `docs/nexus-layout.md` — the canonical `.nexus/` directory structure your harness must create.
5. `docs/behavioral-contracts.md` — state machines, permission model, resume tier semantics, and the `manual_only` contract.

---

## 3. Component Map and Build Order

A complete Nexus consumer comprises nine components. They have hard dependencies: some components cannot be implemented until others are in place. Build them in the order shown.

### Components

| # | Component | Description |
|---|-----------|-------------|
| 1 | `.nexus/` Directory Initialization | Create the required directory tree and `.gitignore` at session start |
| 2 | State File Management | Read/write plan.json, tasks.json, history.json, runtime.json, agent-tracker.json |
| 3 | MCP Tool Implementation | Concrete implementations of the 11 abstract Nexus tools |
| 4 | Capability Mapping | Local file translating abstract capability IDs to concrete disallowed tools |
| 5 | Agent Catalog | Load nexus-core agents, apply capability-map, register with harness |
| 6 | Skill Dispatcher | Detect bracket tags, load skill body.md, inject into LLM context |
| 7 | Hook/Gate System | Lifecycle event handlers: session_start, user_message, pre_tool_use, etc. |
| 8 | Subagent Orchestration | Spawn isolated LLM sessions, pass context, collect results, evaluate resume |
| 9 | Conformance Verification | Run fixtures against your tool implementations to verify interoperability |

### Dependency graph

```
Directory Init → State File Mgmt → MCP Tools → Capability Mapping
                                             → Agent Catalog → Skill Dispatcher
                                             → Hook/Gate System → Subagent Orchestration
                                                                → Conformance Verification
```

**Directory Init** must precede everything: state files cannot be written if the directory does not exist.

**State File Management** must precede tool implementation: tools read and write specific files at specific paths. Without knowing the file layout, tool implementation cannot be completed.

**MCP Tools** must precede Capability Mapping, Agent Catalog, and Hook/Gate: the capability-map is only useful once the tools it restricts are implemented; the agent catalog is validated against the tool set; hooks reference both.

**Capability Mapping** must precede Agent Catalog: effective capabilities are computed by merging canonical capabilities with consumer additions, and that merge requires the capability-map to be defined.

**Agent Catalog** must precede Skill Dispatcher: the dispatcher injects skill body alongside agent context; the agent registration format must exist first.

**Hook/Gate System** must precede Subagent Orchestration: hooks fire during agent spawn and completion; the hook contracts must be defined before the orchestration logic can reference them.

**Subagent Orchestration** must precede Conformance Verification: end-to-end scenario fixtures test the full lifecycle, including agent spawning.

### Build order within components

Within MCP Tools, implement in this recommended order:

1. `plan_start`, `plan_decide` — the core planning pair; all planning workflows depend on them
2. `plan_status`, `plan_update` — planning query and mutation
3. `task_add`, `task_list`, `task_update`, `task_close` — execution lifecycle
4. `history_search`, `context`, `artifact_write` — support and reporting

This order matches the dependency chain within the planning/execution lifecycle. Implement and test each tool against its conformance fixtures before moving to the next.

---

## 4. State File Management

Nexus state is split into two categories with different scopes, persistence, and git-tracking rules. Your implementation must respect these boundaries exactly.

### Two-category model

**Session-scoped state** lives in `.nexus/state/`. It is created at session start, updated throughout the session, and deleted at session end or cycle close. It must never be git-tracked. Your `.nexus/.gitignore` must contain `state/` to enforce this.

**Project-scoped content** lives directly under `.nexus/` (outside `state/`). It persists across sessions and git branches. It is git-tracked and committed to the repository.

### Directory tree

```
.nexus/
├── state/                    ← session-scoped (not git-tracked)
│   ├── plan.json
│   ├── tasks.json
│   ├── runtime.json
│   ├── agent-tracker.json
│   ├── tool-log.jsonl
│   ├── edit-tracker.json
│   ├── reopen-tracker.json
│   └── artifacts/
├── history.json              ← project-scoped (git-tracked, append-only)
├── memory/                   ← project-scoped (git-tracked)
│   └── *.md
├── context/                  ← project-scoped (git-tracked, nx-sync managed)
│   └── *.md
├── rules/                    ← project-scoped (git-tracked, user-defined)
│   └── *.md
└── .gitignore
```

### Initialization sequence

At session start, your harness must:

1. Create `.nexus/` if it does not exist.
2. Create `.nexus/state/` if it does not exist.
3. Write `.nexus/.gitignore` with content `state/` if the file does not exist.
4. Write `.nexus/state/runtime.json` with session metadata (session ID, harness version, start timestamp).
5. Initialize `.nexus/state/agent-tracker.json` as an empty array `[]`.
6. Check for stale state files from a prior crashed session. If `plan.json` or `tasks.json` exist without a running session, warn the user that a previous session may not have closed cleanly.

### Key state files

| File | Scope | Git-tracked | Created by | Deleted by |
|------|-------|------------|------------|------------|
| `state/plan.json` | Session | No | `plan_start` tool | `task_close` tool |
| `state/tasks.json` | Session | No | `task_add` tool (first call) | `task_close` tool |
| `state/runtime.json` | Session | No | session_start hook | session_end hook |
| `state/agent-tracker.json` | Session | No | session_start hook | session_end hook |
| `state/tool-log.jsonl` | Session | No | post_tool_use hook | session_end hook |
| `state/edit-tracker.json` | Session | No | post_tool_use hook (first edit) | task_close / session_end |
| `history.json` | Project | Yes | `plan_start` or `task_close` (first archive) | Never |

### Schema validation

JSON Schema definitions for all state files are available in `conformance/state-schemas/`. The schemas cover `plan.json`, `tasks.json`, `history.json`, `runtime.json`, and `agent-tracker.json`. Validate state files against these schemas in your test suite.

For full lifecycle and tool access details, see [nexus-state-overview.md](./nexus-state-overview.md) and [nexus-layout.md](./nexus-layout.md).

---

## 5. MCP Tool Implementation

The 11 Nexus abstract tools are the interface between the LLM and Nexus state. Your harness implements each one concretely. nexus-core specifies behavior; you choose the registration name, prefix, and implementation mechanism.

### The 11 abstract tool names

| Abstract name | Function |
|---------------|----------|
| `plan_start` | Create a new planning session |
| `plan_status` | Query the current plan state |
| `plan_update` | Add, remove, edit, or reopen plan issues |
| `plan_decide` | Record a decision on a plan issue |
| `task_add` | Add a task to the active task list |
| `task_list` | List tasks with dependency-aware ready set |
| `task_update` | Update a task's status |
| `task_close` | Archive the current cycle to history.json and delete session state files |
| `history_search` | Search past cycles in history.json |
| `context` | Read active session context (branch, task summary, decisions) |
| `artifact_write` | Write a named artifact file to the session artifact directory |

### Tool naming

nexus-core uses abstract names only. Your harness chooses its own registration names. For example, a harness might register `plan_start` as `nx_plan_start`, or a plugin system might prefix it as `mcp__plugin_name_nx__plan_start`. The name you use internally is your decision. The behavioral contract — parameters, return values, side effects, error conditions — is fixed by nexus-core and must not vary.

### Implementation contract

For every tool, implement exactly the parameter schema, return shape, and side effects documented in [nexus-tools-contract.md](./nexus-tools-contract.md). Do not add undocumented parameters or return fields that callers may depend on. Do not omit required return fields.

Specific requirements to enforce:

- `plan_start`: when a prior `plan.json` exists, archive it to `history.json` before creating the new session. Failure to archive on replace will cause data loss.
- `task_close`: delete `plan.json`, `tasks.json`, `edit-tracker.json`, and `reopen-tracker.json` after archiving. Leaving these files causes stale state on next session.
- `artifact_write`: create `.nexus/state/artifacts/` on demand if it does not exist. Do not require the directory to pre-exist.
- `context`: return `{ active: false }` (for plan_status) or `{ exists: false }` (for task_list) when the relevant state file is absent. Do not return an error.

### Implementation order

Implement in this sequence:

1. `plan_start`, `plan_decide` — validates state file management; these are the most frequently tested tools
2. `plan_status`, `plan_update` — complete the planning surface
3. `task_add`, `task_list`, `task_update`, `task_close` — execution lifecycle; `task_close` is the cleanup path
4. `history_search`, `context`, `artifact_write` — support tools; implement after the core tools are passing conformance

After each tool pair, run the relevant fixtures from `conformance/tools/` before continuing.

For full parameter schemas, return value shapes, and error conditions, see [nexus-tools-contract.md](./nexus-tools-contract.md).

---

## 6. Capability Handling

Capabilities restrict which tools a subagent may call. nexus-core defines capabilities in abstract semantic terms. Your harness translates them into concrete tool blocklists.

### Canonical capability definitions

Read `vocabulary/capabilities.yml`. Each capability has:

- `id` — the canonical identifier (e.g., `no_file_edit`)
- `intent` — a machine-readable semantic class (e.g., `workspace_write_denial`)
- `blocks_semantic_classes` — the list of semantic operation classes this capability forbids
- `prose_guidance` — a human-readable description of exactly which tool behaviors are blocked and which are not

The four canonical capabilities in nexus-core 0.2.0:

| ID | Intent | Blocks |
|----|--------|--------|
| `no_file_edit` | `workspace_write_denial` | `file_creation`, `file_modification`, `file_deletion`, `partial_file_edit`, `structured_document_edit` |
| `no_task_create` | `task_pipeline_append_denial` | `nexus_task_creation` |
| `no_task_update` | `task_pipeline_mutate_denial` | `nexus_task_state_transition`, `nexus_task_metadata_modification` |
| `no_shell_exec` | `shell_execution_denial` | `shell_command_exec`, `subprocess_spawn`, `interactive_shell_session` |

### Local capability-map

Create a consumer-owned capability-map file that translates each capability ID and semantic class to the concrete tool names in your harness. The format is your choice; the following YAML structure is a workable pattern:

```yaml
# capability-map.yml  (consumer-owned, not part of nexus-core)
no_file_edit:
  disallowed_tools:
    - YourEditTool
    - YourWriteTool
    - YourDeleteTool
    - YourPatchTool
    - YourNotebookCellEditTool
  mapped_classes:
    - file_creation
    - file_modification
    - file_deletion
    - partial_file_edit
    - structured_document_edit

no_task_create:
  disallowed_tools:
    - YourTaskAddTool      # your harness's concrete registration name for task_add
  mapped_classes:
    - nexus_task_creation

no_task_update:
  disallowed_tools:
    - YourTaskUpdateTool   # your harness's concrete registration name for task_update
    - YourTaskCloseTool    # your harness's concrete registration name for task_close
  mapped_classes:
    - nexus_task_state_transition
    - nexus_task_metadata_modification

no_shell_exec:
  disallowed_tools:
    - YourShellTool
    - YourSubprocessTool
  mapped_classes:
    - shell_command_exec
    - subprocess_spawn
    - interactive_shell_session
```

### Effective capability computation

When building an agent's effective restriction set, apply the additive-only merge rule defined in [behavioral-contracts.md §4](./behavioral-contracts.md):

```
effective_capabilities(agent) = canonical_capabilities(agent) ∪ consumer_additions(agent)
```

- `canonical_capabilities` is the `capabilities` array in `agents/{id}/meta.yml` (the nexus-core definition).
- `consumer_additions` is a harness-local set you define for agents where you want stricter restrictions.

**You may add capabilities. You must not remove canonical capabilities.** Removing `no_file_edit` from an agent that carries it canonically violates the nexus-core design intent. If nexus-core later adds a capability that your consumer already applies locally, the overlap is harmless — the union is idempotent.

### Applying the capability-map

When registering an agent for a subagent session:

1. Read the agent's `capabilities` array from `manifest.json` or `agents/{id}/meta.yml`.
2. Merge with any consumer additions for that agent ID.
3. For each capability in the merged set, look up `disallowed_tools` in your capability-map.
4. Build the union of all disallowed tools across all capabilities.
5. Pass this union to your harness's agent-registration mechanism as the set of tools the agent may not call.

### CI coverage assertion

In your test suite, verify that every `blocks_semantic_classes` value across all entries in `vocabulary/capabilities.yml` has at least one mapped tool in your capability-map. This catches omissions when nexus-core adds new semantic classes in a future version.

---

## 7. Agent Catalog Construction

The agent catalog is your harness's internal registry of all Nexus agent roles, populated from nexus-core agent definitions and augmented with harness-specific context.

### Reading agent definitions

Start with `manifest.json`. The `agents` array contains one entry per agent role with these fields:

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Canonical agent identifier (e.g., `engineer`) |
| `name` | string | Display name |
| `description` | string | One-line role description |
| `category` | `"how" \| "do" \| "check"` | Role category |
| `resume_tier` | `"persistent" \| "bounded" \| "ephemeral"` | Session persistence behavior |
| `model_tier` | `"high" \| "standard"` | Abstract model selection signal |
| `capabilities` | `string[]` | Canonical capability IDs |
| `body_hash` | string | SHA-256 hash of body.md for integrity verification |

For full metadata, read `agents/{id}/meta.yml`. For the agent's prompt content, read `agents/{id}/body.md`.

### Transformation pipeline

For each agent in `manifest.json`:

1. **Read body.md** from `agents/{id}/body.md`. This is the prompt you will inject into the agent's LLM context.
2. **Compute effective_capabilities** by merging canonical capabilities with your consumer additions (see §6).
3. **Resolve disallowed tools** by applying your capability-map to `effective_capabilities`.
4. **Map model_tier** to a concrete model identifier: `high` → your harness's high-capability model, `standard` → your harness's standard model. This mapping is consumer-owned.
5. **Register** the agent in your harness's agent system with the resolved prompt, model, and tool restrictions.

### Neutral body + harness context synthesis

`body.md` is deliberately harness-neutral. It says things like "report to Lead" without specifying the concrete mechanism. This is intentional: the same body works across claude-nexus, opencode-nexus, and nexus-code because each harness injects the mechanism alongside the body.

Your harness must inject harness-specific tool awareness when activating an agent. Concretely:

- body.md says: "report to Lead"
- Your harness injects alongside it: "To report to Lead, use [your harness's inter-agent communication tool]."

- body.md says: "save your output using the artifact tool"
- Your harness injects alongside it: "The artifact tool in this harness is registered as [your concrete tool name]."

The `harness_docs_refs` field in `skills/{id}/meta.yml` signals which harness-specific topics should be surfaced when injecting context for that skill. For example, `nx-plan` and `nx-run` both declare `harness_docs_refs: [resume_invocation]` — meaning your harness should inject documentation about how agent resume works in your specific system when those skills are active.

### Nine agent roles

nexus-core 0.2.0 defines these nine agents:

| ID | Category | Resume tier | Canonical capabilities |
|----|----------|-------------|------------------------|
| `architect` | how | persistent | no_file_edit, no_task_create, no_task_update |
| `designer` | how | persistent | no_file_edit, no_task_create, no_task_update |
| `postdoc` | how | persistent | no_file_edit, no_task_create, no_task_update |
| `strategist` | how | persistent | no_file_edit, no_task_create, no_task_update |
| `engineer` | do | bounded | no_task_create |
| `writer` | do | bounded | no_task_create |
| `researcher` | do | persistent | no_file_edit, no_task_create |
| `tester` | check | ephemeral | no_file_edit, no_task_create |
| `reviewer` | check | ephemeral | no_file_edit, no_task_create |

All nine roles must be registered in your catalog. A consumer that omits an agent prevents Lead from using that role in plans and run cycles.

---

## 8. Skill Activation Architecture

Skills are behavioral specifications that change how Lead operates. Skill activation transforms the LLM's operating mode by injecting a new body.md as its primary instruction set. The activation flow has six stages.

### Full activation flow

```
User types "[plan] analyze the architecture"
     |
     v
1. Tag Detection
   - The consumer's user_message hook (or equivalent) intercepts the message
   - Scan the message text for bracket tag patterns defined in vocabulary/tags.yml
   - "[plan]" matches: id=plan, type=skill, skill=nx-plan
     |
     v
2. Routing by type
   - type=skill       → proceed to skill body loading (step 3)
   - type=inline_action → call the handler tool directly; do not load a skill body
                          Example: "[d]" → call plan_decide tool immediately
     |
     v
3. Skill Body Loading
   - Read skills/{skill_id}/body.md from the nexus-core package
   - This file is the skill's complete behavioral specification
   - Also read skills/{skill_id}/meta.yml to check for harness_docs_refs
     |
     v
4. LLM Context Injection
   - Inject the body.md content into the LLM's operating context
   - HOW to inject is consumer's decision:
     a. System prompt injection — most common; replaces or appends to the system prompt
     b. Tool-response injection — return body.md as a tool response the LLM reads
     c. User-message prefix — prepend body.md to the next user message
   - Also inject harness-specific context for any harness_docs_refs declared in meta.yml
   - The body.md content BECOMES the LLM's operating instructions for this skill
     |
     v
5. Skill Active State
   - Skill remains active until one of:
     a. Session ends — all skills deactivate
     b. Another skill is activated — replacement (e.g., [plan] → [run] transition)
     c. The skill's own deactivation condition is met
        Example: nx-plan completes (all issues decided) → user types [run] to transition
   - While active, the skill's body governs Lead's behavior
     |
     v
6. manual_only Handling
   - Before exposing skills to LLM natural-language detection, check meta.yml
   - If manual_only=true: NEVER include in auto-detection candidate list
   - Only activate on explicit user trigger: slash command or bracket tag typed by user
   - Applies to: nx-init, nx-setup in nexus-core 0.2.0
   - See: behavioral-contracts.md §6
```

### Tag variants

Tags may include variant suffixes. The `variants` field in `vocabulary/tags.yml` lists valid variant tokens for each tag.

Example: `plan` has `variants: ["auto"]`. This means `[plan:auto]` is a valid trigger that activates the same `nx-plan` skill but passes `auto` as a mode flag. Your consumer must:

1. Detect `[plan:auto]` as a variant of the `plan` tag.
2. Activate the same `nx-plan` skill body.
3. Pass the variant string (`auto`) to the skill activation logic as an argument or injected parameter.

The `rule` tag has `variants: ["*"]`, meaning any suffix is valid: `[rule:frontend]`, `[rule:testing]`, etc. Capture the suffix and pass it to the `rule_store` handler.

### Inline actions

Tags with `type=inline_action` do not load a skill body. They trigger a direct tool call.

| Tag | Handler | Effect |
|-----|---------|--------|
| `[d]` | `nx_plan_decide` | Immediately calls plan_decide with the user's decision text |
| `[m]` | `memory_store` | Stores the current lesson to `.nexus/memory/` |
| `[m:gc]` | `memory_gc` | Garbage-collects `.nexus/memory/` |
| `[rule]` | `rule_store` | Stores a rule to `.nexus/rules/` |

For inline actions, extract the relevant content from the user's message (the text following the tag) and pass it as the tool parameter. No skill body is loaded; no LLM mode change occurs.

### Natural-language trigger detection

Natural-language trigger detection — recognizing that a user's message implies a skill activation even without a bracket tag — is **consumer-owned**. nexus-core does not define, distribute, or maintain natural-language pattern lists.

The canonical trigger for every tag is the explicit bracket form in `vocabulary/tags.yml`. Any other activation form (recognizing "let's plan this" as equivalent to `[plan]`) is a consumer extension. Different consumers may implement different patterns. This divergence is explicitly acceptable per [behavioral-contracts.md §7](./behavioral-contracts.md).

---

## 9. Hook Event Lifecycle

Hooks are the consumer's mechanism for responding to lifecycle events. nexus-core defines 8 abstract events. The names are harness-neutral; each harness maps them to its own event API.

### Event mapping examples

Different harnesses expose these events under different names:

- **Claude Code**: `SessionStart`, `UserPromptSubmit`, `SubagentStart`, `SubagentStop`, `PreToolUse`, `PostToolUse`, `Stop`, `PostCompact`
- **OpenCode**: its own hook API names — map accordingly when building an OpenCode consumer

Identify the equivalent events in your harness's plugin system and implement the expected behaviors below.

### 8 lifecycle events

#### `session_start`

**When it fires:** The harness launches or the user begins a new session.

**Expected consumer behavior:**
- Create `.nexus/` and `.nexus/state/` directories if they do not exist.
- Write `.nexus/.gitignore` with `state/` if it does not exist.
- Write `.nexus/state/runtime.json` with session metadata: session ID, harness version, start timestamp, and any environment properties your harness tracks.
- Initialize `.nexus/state/agent-tracker.json` as `[]`.
- Check for stale state from a prior crashed session: if `plan.json` or `tasks.json` exist, warn the user that these may be leftover from an unclean shutdown.
- Load the knowledge index: list files in `.nexus/memory/`, `.nexus/context/`, and `.nexus/rules/` to build the reference index that will be injected into subagent spawns.

---

#### `user_message`

**When it fires:** The user submits a message to Lead.

**Expected consumer behavior:**
- Scan the message text for bracket tags. Match against all triggers defined in `vocabulary/tags.yml`.
- For each matched tag:
  - If `type=skill`: activate the skill (see §8, steps 3–5). Do not proceed with normal message handling for that tag.
  - If `type=inline_action`: call the handler tool immediately. The user's message following the tag is the input.
- After tag routing, inject contextual guidance into Lead's available context before LLM inference begins:
  - Current plan status: if `plan.json` exists, summarize pending vs. decided issues.
  - Task progress: if `tasks.json` exists, summarize total/completed/pending counts and the ready-task set.
  - Knowledge file counts: number of files in `.nexus/memory/`, `.nexus/context/`, `.nexus/rules/`.
- If no tags are matched, pass the message to Lead without modification.

---

#### `subagent_spawn`

**When it fires:** Lead spawns a subagent to execute a task.

**Expected consumer behavior:**
- Record the new agent entry in `agent-tracker.json`: `{ agent_type, agent_id, task_id, started_at }`.
- Inject the knowledge index into the subagent's initial context: the list of files in `.nexus/memory/`, `.nexus/context/`, and `.nexus/rules/` so the agent knows what project knowledge is available.
- Apply capability restrictions: resolve `effective_capabilities` for this agent type and configure the subagent's tool access accordingly (see §6).
- Apply the resume evaluation: check `owner_reuse_policy` on the task and the agent's `resume_tier` to determine whether to spawn fresh or resume a prior session (see §10).
- Pass the structured task context to the agent: title, context, approach, and acceptance criteria (see §10, Context Passing).

---

#### `subagent_complete`

**When it fires:** A subagent finishes its assigned work and returns control to Lead.

**Expected consumer behavior:**
- Update `agent-tracker.json`: set `status=completed`, record `stopped_at` timestamp.
- Compute `files_touched` from your tool-log or the subagent's tool usage record. Record which files were created or modified.
- Update `edit-tracker.json` with the files touched by this agent. This data feeds the bounded-tier resume evaluation on subsequent spawns.
- Check if the completed task has pending acceptance criteria that were not verified. If the task has `acceptance` defined and no `tester` or `reviewer` subagent has been scheduled, surface a reminder to Lead.
- Update the task status in `tasks.json` via the `task_update` tool: set to `completed`.

---

#### `pre_tool_use`

**When it fires:** A tool is about to execute.

**Expected consumer behavior:**
- Gate enforcement for unplanned file edits: if `tasks.json` does not exist and the tool is a file-editing tool, block the call and return an error explaining that edits outside of a planned task cycle are disallowed. This prevents unplanned workspace changes.
- Capability gate: check whether the current agent (Lead or a subagent) has the requested tool in its disallowed set. If so, block the call and return an appropriate error.
- Any other pre-condition checks your harness requires (rate limits, sandbox policies, etc.).

Read-only tools (query tools, status reads) are never blocked by capability gates. Only tools with primary write effects are subject to capability restrictions.

---

#### `post_tool_use`

**When it fires:** A tool has executed and returned a result.

**Expected consumer behavior:**
- Append a log entry to `.nexus/state/tool-log.jsonl`: timestamp, agent_id, tool name, file path (if a file was touched), result status.
- If the tool was a file-editing tool, update `edit-tracker.json`: record the file path and the agent_id that modified it. This is the data source for bounded-tier resume evaluation.
- If the tool result indicates an error, record the error in the log for diagnostic purposes. Do not suppress error results.

---

#### `session_end`

**When it fires:** The user closes the harness or the session terminates.

**Expected consumer behavior:**
- Check for pending tasks: if `tasks.json` exists and contains incomplete tasks (status `pending` or `in_progress`), warn the user that the session is ending with unfinished work and suggest calling `task_close` to archive before exiting.
- Check for an active plan: if `plan.json` exists, warn that the plan session will be lost if not archived.
- Delete `runtime.json` and `agent-tracker.json` (session-scoped files that have no value beyond the session).
- Optionally rotate or archive `tool-log.jsonl` if your harness supports log retention.
- Do not delete `history.json`, `memory/`, `context/`, or `rules/` — these are project-scoped and must persist.

---

#### `context_compact`

**When it fires:** The LLM's context window is compressed (older messages are truncated to make room for new content).

**Expected consumer behavior:**
- Re-inject the critical session snapshot that was lost in compression:
  - Active skill/mode: which skill is currently active (plan, run, sync, or none).
  - Plan status: if `plan.json` exists, re-inject the issue list with pending/decided status.
  - Task progress: if `tasks.json` exists, re-inject the task list with status and ready-task set.
  - Knowledge file index: re-inject the list of files in `.nexus/memory/`, `.nexus/context/`, `.nexus/rules/`.
  - Active agent list: re-inject which subagents are currently tracked in `agent-tracker.json`.
- Context compaction is a context loss event. The LLM cannot reconstruct session state from its compressed context alone. Your consumer must restore state from the state files on disk.
- Read state files fresh from disk — do not rely on in-memory caches that may also have been cleared.

---

## 10. Subagent Orchestration Model

Subagent orchestration is the mechanism by which Lead delegates work to specialized agents. nexus-core specifies the behavioral contracts; the implementation mechanism is consumer-decided.

### Spawn model

When Lead assigns a task to an agent, the consumer:

1. Creates an isolated LLM session for the agent. The isolation mechanism is implementation-specific: a subprocess, an API call to a sandboxed session, a parallel conversation thread, or any other approach your harness supports.
2. Injects the agent's `body.md` as the agent's system prompt or initial context. This is the agent's identity and behavioral specification.
3. Applies tool restrictions derived from `effective_capabilities` (see §6). The agent session must not have access to tools in its disallowed set.
4. Passes the task's structured context as the agent's working prompt.
5. Waits for the agent to complete and collects the result.

### Context passing

Pass task context to the agent in this structured format:

```
TASK: {task.title}

CONTEXT:
{task.context}

APPROACH:
{task.approach}

ACCEPTANCE:
{task.acceptance}
```

Omit sections whose fields are absent (not all tasks have `approach` or `acceptance` defined). The `task_list` tool returns the full task structure including all optional fields.

Also inject:
- The knowledge index: file paths in `.nexus/memory/`, `.nexus/context/`, `.nexus/rules/`
- Harness-specific tool name mapping: which of your harness's concrete tool names correspond to the abstract nexus operations the agent's body.md may reference
- Any `harness_docs_refs` from the active skill's meta.yml

### Result collection

The agent produces output: file changes, artifact files, reports, or analysis. How the result is returned to Lead is consumer-decided. Common patterns:

- **Return value** — the subagent session's final message is returned as a string; Lead reads it directly.
- **Shared filesystem** — the agent writes to `.nexus/state/artifacts/` via the `artifact_write` tool; Lead reads the file.
- **Message passing** — the agent sends a structured message to Lead via your harness's inter-agent communication mechanism; Lead receives and acts on it.

The body.md of each agent specifies that it should "report to Lead" — whatever concrete mechanism you implement, ensure that the agent's output reaches Lead before the subagent session closes.

Lead is the only coordinator. Subagents do not communicate directly with each other. All inter-agent communication flows through Lead.

### Resume model

Before spawning an agent, evaluate whether to spawn fresh or resume a prior session. The evaluation follows three inputs:

**1. `owner_reuse_policy` from `tasks.json`** (per-task override, highest priority):

| Value | Effect |
|-------|--------|
| `fresh` | Always spawn fresh; ignore resume_tier |
| `resume_if_same_artifact` | Resume only if same agent, same target files, no intervening edits |
| `resume` | Always resume if a prior session is available |
| absent | Fall back to the agent's default resume_tier |

**2. Agent `resume_tier` from `manifest.json`** (default behavior):

| Tier | Behavior |
|------|----------|
| `ephemeral` | Always spawn fresh. Independent verification requires no prior context. Applies to: tester, reviewer. |
| `bounded` | Resume only when: same owner identity, same target files, no intervening edits by others. Re-read target files at session start. Applies to: engineer, writer. |
| `persistent` | Resume by default within the same run session. Cross-task reuse allowed. Applies to: architect, designer, postdoc, strategist, researcher. |

**3. Resume gating**:

Before attempting to resume, verify that your harness supports the resume mechanism for the current context. If the mechanism is unavailable (the harness cannot reopen a prior session, or no session ID was recorded for this agent), fall back to a fresh spawn silently. Do not surface a resume failure as an error to the user.

For `bounded` agents evaluating resume eligibility:
- Check `agent-tracker.json` for the prior agent ID assigned to this task.
- Check `edit-tracker.json` to determine if any other agent has modified the target files since the last session.
- If any intervening edit is found, use a fresh spawn regardless of `owner_reuse_policy`.

Full resume tier definitions are in [behavioral-contracts.md §3](./behavioral-contracts.md).

### Inter-agent communication boundary

Subagents communicate results to Lead. Lead is responsible for all coordination. No direct subagent-to-subagent communication is defined or permitted by the nexus-core model.

If your harness exposes an inter-agent communication tool, it must be available to Lead and may be made available to subagents for the purpose of reporting back to Lead. Subagents must not use it to route work to other subagents — that is Lead's responsibility.

---

## 11. Conformance Verification (Required)

Consumers MUST pass all conformance fixtures to claim nexus-core compatibility. This is not optional — it is the mechanism by which cross-harness interoperability is guaranteed. Non-conforming implementations may produce state files that other Nexus ecosystem components cannot read, or exhibit behavioral divergence that breaks plan/task lifecycle assumptions.

### Fixture types

**Tool fixtures** (`conformance/tools/*.json`) — single-action tests for individual tools. Each fixture specifies:
- `precondition` — which state files must exist or must not exist before the test
- `action` — the tool name and parameters to call
- `postcondition` — assertions on the return value and state file contents after the call

**Scenario fixtures** (`conformance/scenarios/*.json`) — multi-step tests for end-to-end lifecycle flows. Each fixture specifies a sequence of steps, each with an action and assertions. Scenarios cover flows such as a full plan cycle and dependency-ordered task execution.

Available fixture files in nexus-core 0.2.0:

| File | Coverage |
|------|----------|
| `conformance/tools/plan-start.json` | `plan_start` happy path and edge cases |
| `conformance/tools/plan-decide.json` | `plan_decide` decision recording |
| `conformance/tools/task-add.json` | `task_add` creation and first-time initialization |
| `conformance/tools/task-close.json` | `task_close` archiving and state file deletion |
| `conformance/scenarios/full-plan-cycle.json` | Complete plan → decide → task → close lifecycle |
| `conformance/scenarios/task-deps-ordering.json` | Dependency-ordered task readiness computation |

### Writing a test runner

A conformance test runner:

1. Loads a fixture JSON file.
2. Establishes the precondition: writes or deletes state files as specified.
3. Calls your harness's implementation of the named tool with the fixture's parameters.
4. Evaluates postconditions using JSONPath assertions against the return value and state files.
5. Reports pass/fail per `test_id`.

Assertion keys in postconditions are JSONPath expressions. A `null` value at a file path key means the file must not exist. A `null` value at a JSONPath key means that field must be `null`.

The fixture format schema is at `conformance/schema/fixture.schema.json`.

For runner implementation patterns and a TypeScript sketch, see [conformance/README.md](../conformance/README.md).

### CI integration

Add the conformance test runner to your CI pipeline. Conformance failures MUST block release. Do not merge harness changes that break conformance — a conformance failure means your implementation diverges from the Nexus ecosystem contract.

Conformance verification is distinct from your harness's own unit tests. Run both.

---

## 12. Minimum Viable Consumer

The smallest working Nexus session requires exactly these components. Build this first, verify it works end to end, then expand incrementally.

### Tools (4 minimum)

| Abstract name | Purpose |
|---------------|---------|
| `plan_start` | Create a planning session |
| `plan_decide` | Record decisions on plan issues |
| `task_add` | Add tasks to the execution list |
| `task_close` | Archive the cycle and clean up session state |

This set covers the complete plan → decide → add tasks → close cycle. Implement these four tools first, run their conformance fixtures, and verify the full cycle before adding more tools.

### Agent (1 minimum)

Register the `engineer` agent:

- **body.md**: `agents/engineer/body.md`
- **resume_tier**: `bounded`
- **capabilities**: `no_task_create`
- **model_tier**: `standard`

Engineer is the execution agent. With engineer alone, Lead can delegate implementation tasks and collect results.

### Skill (1 minimum)

Activate `nx-plan` when the user types `[plan]`:

- **body.md**: `skills/nx-plan/body.md`
- **trigger**: `[plan]` (from `vocabulary/tags.yml`)
- **type**: `skill`

Implement tag detection in your `user_message` hook. When `[plan]` is detected, load `skills/nx-plan/body.md` and inject it into Lead's context.

### Hook events (3 minimum)

| Event | Minimum required behavior |
|-------|--------------------------|
| `session_start` | Create `.nexus/state/` directory; write `runtime.json`; initialize `agent-tracker.json` as `[]` |
| `user_message` | Detect `[plan]` tag; load `skills/nx-plan/body.md`; inject into Lead's context |
| `session_end` | Check for `tasks.json`; if present with incomplete tasks, warn the user |

### State files (3 minimum)

| File | Why it is required |
|------|--------------------|
| `plan.json` | Written by `plan_start`; read by `plan_decide` |
| `tasks.json` | Written by `task_add`; archived by `task_close` |
| `history.json` | Written by `task_close`; the permanent project record |

### What this gives you

A minimum viable consumer supports this complete cycle:

1. User types `[plan] let's plan the feature` → `nx-plan` skill activates
2. Lead runs a planning session, calls `plan_start`, calls `plan_decide` for each issue
3. Lead calls `task_add` to create implementation tasks
4. Lead spawns engineer subagent with task context
5. Engineer completes the work
6. Lead calls `task_close` to archive the cycle

### Incremental expansion path

Add components in this order after verifying the MVC:

1. **`[run]` skill + `nx-run` body** — adds structured execution orchestration; Lead gets the full delegation protocol for parallel task assignment
2. **Remaining 7 agents** — researcher, architect, postdoc, strategist, designer, writer, tester, reviewer; adds parallel analysis and verification roles
3. **Remaining 7 tools** — `plan_status`, `plan_update`, `task_list`, `task_update`, `history_search`, `context`, `artifact_write`; completes the full tool surface
4. **All 8 hook events** — adds `subagent_spawn`, `subagent_complete`, `pre_tool_use`, `post_tool_use`, `context_compact` for full lifecycle management
5. **Conformance suite** — run all fixtures in `conformance/tools/` and `conformance/scenarios/` before marking the harness production-ready
6. **`[sync]` skill** — adds `nx-sync` for keeping `.nexus/context/` synchronized with project state

Do not add the `[sync]`, `nx-init`, or `nx-setup` skills until the core planning and execution lifecycle is verified. These skills depend on the project state infrastructure built by the earlier components.
