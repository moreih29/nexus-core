# Behavioral Contracts

This document formalizes the behavioral contracts that all Nexus harnesses must implement. These contracts define state machines, coordination rules, and semantic boundaries that are harness-neutral — they describe *what* must happen, not *how* any specific harness implements it.

---

## 1. Task Lifecycle State Machine

Tasks transition through the following states:

```
pending → in_progress → completed
                ↑              |
                └── (reopen) ──┘
```

**States.**

| State | Meaning |
|---|---|
| `pending` | Task is waiting to begin. Not yet assigned or all dependencies unresolved. |
| `in_progress` | Task is actively being worked on by an assigned agent. |
| `completed` | Task has finished and its output is available. |

**Reopen.** A `completed` task may be transitioned back to `pending` via `task_update`. This is used when review or downstream work reveals that the task's output is insufficient and it must be reworked.

**No `blocked` state.** There is no explicit `blocked` state. A task that cannot proceed because a dependency has not completed remains in `pending`. Harnesses compute readiness from dependency status rather than relying on an explicit blocked marker.

**Readiness computation.** A task is ready to begin when both conditions hold:
1. Its status is `pending`.
2. Every task listed in its `deps` field has status `completed`.

---

## 2. Plan Lifecycle State Machine

Plan issues transition through the following states:

```
pending → decided
    ↑         |
    └─────────┘  (reopen)
```

**States.**

| State | Meaning |
|---|---|
| `pending` | Issue is open and no decision has been recorded. |
| `decided` | A decision has been recorded for this issue. |

**Reopen.** A `decided` issue may be transitioned back to `pending` via `plan_update` with `action: reopen`. On reopen, the `decision` field for that issue is deleted. The issue returns to open discussion.

**Plan complete signal.** A plan is considered complete when all issues within it have status `decided`. This signals that the plan phase is finished and execution may begin.

---

## 3. Resume Tier and Owner Reuse Policy Coordination

### Resume Tiers

Each agent role carries a resume tier that governs whether a prior agent session may be reused for a new task assignment, or whether a fresh spawn is required. The three tiers are defined in `vocabulary/resume-tiers.yml`.

**`ephemeral`.** The agent is always spawned fresh. No prior session is carried forward. Used for roles where independence from prior context is essential to correctness (e.g., verification roles).

**`bounded`.** The agent may resume a prior session only when all of the following conditions hold: (a) the same owner identity is assigned, (b) the target files or artifacts are the same, and (c) no intervening edits have occurred to those targets since the prior session. If any condition is not met, a fresh spawn is used. Agent instructions for bounded-tier agents must include a directive to re-read the target files at the start of each resumed session to ensure current state is reflected.

**`persistent`.** The agent resumes by default within the same run session. Cross-task reuse is allowed. Used for roles where accumulated context is the primary asset (e.g., analysis and design roles).

### Owner Reuse Policy Override

The `owner_reuse_policy` field in `tasks.json` allows per-task override of the default resume-tier behavior.

| Value | Effect |
|---|---|
| `fresh` | Force a fresh spawn regardless of resume tier. |
| `resume_if_same_artifact` | Apply bounded-tier behavior: resume only if same artifact, same owner, no intervening edits. |
| `resume` | Force resume regardless of resume tier, if a prior session is available. |

When `owner_reuse_policy` is absent, the agent's default resume tier governs.

### Resume Gating

Before attempting to resume a prior agent session, the harness must verify that its resume mechanism is available for the current context. If the mechanism is unavailable, the harness must fall back to a fresh spawn silently, without surfacing an error to the user. Resume gating is a harness-level concern; nexus-core specifies only that fallback must occur.

---

## 4. Permission Model

**Lead.** The Lead agent may invoke all skills, call all tools available to the harness, spawn subagents, and record plan decisions. Lead is the only role that may initiate a new plan or run cycle.

**Subagents.** Each subagent role has a defined set of capabilities that restrict which tools it may call. Capabilities are declared in the agent's `meta.yml` using the capability abstraction defined in `vocabulary/capabilities.yml`. A subagent may not call tools outside its declared capability set.

**Gate enforcement.** The mechanism by which capability gates are enforced is harness-specific. nexus-core specifies the semantic — which capabilities a role holds — but not the enforcement implementation. Harnesses are responsible for translating capability declarations into their native access-control mechanism.

**Capability override rule (additive-only).** A consumer's effective capability set for any agent is computed as:

```
effective_capabilities(agent) = canonical_capabilities(agent) ∪ consumer_additions(agent)
```

`canonical_capabilities` is the `capabilities` array in `agents/{id}/meta.yml` — the nexus-core canonical definition. `consumer_additions` is a harness-local set of additional capabilities the consumer chooses to apply (format and storage are consumer decisions). Consumers may **add** capabilities but **must not remove** canonical ones. Removing a canonical capability (e.g., removing `no_file_edit` from an agent that canonically carries it) would violate the nexus-core design intent and is forbidden. The union is idempotent — if nexus-core later adds a capability that a consumer already applied locally, the overlap is harmless.

---

## 5. Session Boundary Semantics

A **session** begins when the harness launches and ends when the harness closes or the user explicitly terminates it. A session may contain one or more plan/run cycles.

A **cycle** consists of exactly one `plan.json` lifecycle and one `tasks.json` lifecycle. A cycle begins when a new plan is created and ends with `task_close`, which archives the cycle's plan and task records into `history.json`.

```
Session
└── Cycle 1: plan.json + tasks.json → task_close → history.json
└── Cycle 2: plan.json + tasks.json → task_close → history.json
└── ...
```

Session state (the `state/` directory) persists across cycles within a single session. When a new cycle begins within the same session, `plan.json` and `tasks.json` are replaced; other session state (e.g., agent registrations) may persist or be reset depending on harness policy.

Session end discards all remaining session state that has not been promoted to project-scoped storage.

---

## 6. `manual_only` Contract

A skill declared with `manual_only: true` in its `meta.yml` must not be auto-invoked by the language model as a result of natural-language inference.

**Activation constraint.** Only an explicit user-initiated trigger may activate a `manual_only` skill. Valid explicit triggers are: a slash command typed by the user, or a bracket tag typed by the user (e.g., `[plan]`). Inference from conversational context does not qualify as an explicit trigger.

**Consumer harness obligation.** Consumer harnesses that implement auto-invocation detection — where the language model may activate skills based on recognized patterns in user messages — must filter `manual_only` skills out of the skill activation list exposed to the language model. A `manual_only` skill must not appear as a candidate for automatic activation under any circumstances.

This contract ensures that high-consequence or structurally significant skills are only invoked when the user has expressed deliberate intent.

---

## 7. Natural-Language Trigger Boundary

Natural-language trigger detection is **consumer-owned**. nexus-core does not define, distribute, or maintain natural-language pattern lists for any skill or tag.

**Canonical trigger form.** The authoritative trigger for every tag is the explicit bracket form defined in `vocabulary/tags.yml` (e.g., `[plan]`, `[run]`, `[sync]`). This is the form nexus-core specifies. All other activation forms are consumer extensions.

**Consumer responsibility.** Each consumer harness independently defines the natural-language patterns it recognizes as equivalent to an explicit trigger, tests those patterns, and maintains them over time. nexus-core provides no shared pattern library and makes no guarantees about pattern compatibility across harnesses.

**Divergence is acceptable.** Different consumer harnesses may recognize different natural-language phrasings for the same underlying skill. This divergence is explicitly acceptable. Harnesses must not assume that another harness's pattern set matches their own.
