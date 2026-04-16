# Memory Lifecycle Contract

This document defines the canonical operating principles for the `.nexus/memory/` layer. It sits alongside `vocabulary/memory_policy.yml`, which is the machine-readable form of the same rules. Where `memory_policy.yml` states principles as structured data for consumer tooling to parse, this document provides authoritative prose for implementers. The boundary between canonical and consumer-local is consistent across both: nexus-core owns the principles; consumers own all thresholds, formats, and enforcement mechanics.

---

## 1. Canonical Principles

### 1.1 Read-Event Observation

An agent observes a memory file at the moment it reads that file's contents. That read event — and only that event — is the unit of observation for access tracking.

Write events, directory scans (glob, grep), and path mentions in prose are not observation events. An agent that lists `.nexus/memory/` to decide which file to read has not yet observed anything. The observation is recorded when the file is opened and its content is consumed.

This distinction matters because memory is meant to capture what has actually been used, not what has been found or referenced. Stale detection and gc decisions depend on a signal that reflects genuine use, not incidental proximity.

### 1.2 Three Information Types Accumulated

For each memory file, three pieces of information are accumulated across read events: (1) the wall-clock time of the most recent read, (2) the cumulative count of reads observed since tracking began, and (3) the identity of the most recent reader.

These three values constitute the access record for a file. They are stored in `.nexus/state/{harness_id}/memory-access.jsonl` — one JSONL line per file, upserted on each observation. The canonical field names and types are defined in `conformance/state-schemas/memory-access.schema.json`; that schema is the authoritative source for storage format. Value domains for the reader identity field are harness-local.

Together, these three values give consumers the signals they need to reason about whether a memory file remains actively useful or has drifted into disuse.

### 1.3 Manual Gate as Default

Automatic deletion is off by default. The normal path for removing stale memory files is the `[m:gc]` tag, which the user invokes manually. User intent is the final arbiter of what gets removed.

Automatic deletion is an opt-in capability. A consumer may enable it, but must do so explicitly. No consumer should assume automatic deletion is active unless they have deliberately configured it.

This default reflects a conservative stance: the cost of accidentally losing a still-relevant memory file is higher than the cost of retaining an unused one. Manual gc preserves human judgment in the loop.

### 1.4 Three-Signal Intersection for Automatic Deletion

When a consumer enables automatic deletion, the policy must require the simultaneous satisfaction of at least three independent signals before a file is eligible for removal. No single signal, however strong, is sufficient on its own.

The three signals should be drawn from independent dimensions — for example: elapsed time since last access, number of work cycles completed since last read, and cumulative access count since tracking began. Requiring intersection across independent dimensions reduces the risk of false positives caused by a single anomalous period (a long vacation, an unusually dense sprint, an early-lifecycle file that has never yet been needed).

The specific thresholds for each signal are consumer-local, calibrated to the project's cycle cadence and team working patterns. nexus-core specifies the structural requirement — three independent signals — not the magnitudes.

### 1.5 Git-Backed Recoverable Deletion

Every memory file deletion must be recorded as a git commit. Deletion without a corresponding commit is not permitted.

The commit should include enough information in its message that a reader can reconstruct the recovery path — for example, the git command needed to restore the file from history. Including an explicit recovery path in the commit message is recommended; it reduces the cognitive load on anyone who later discovers the deletion was premature. The exact format of the commit message is consumer-local.

This requirement ensures that no memory deletion is silent. The project history serves as a safety net, and the act of committing forces an intentional moment before content is removed from the active workspace.

### 1.6 Merge-Before-Create

When a new memory save candidate substantively overlaps an existing file in topic and category, the existing file should be extended rather than a new file created. Proliferation of near-duplicate files degrades the utility of the memory layer: duplicates force readers to reconcile redundant content and make gc harder to reason about.

The concrete criteria for deciding whether two topics overlap — keyword thresholds, semantic distance, structural similarity — are consumer-local. nexus-core requires the preference for merging; it does not specify the matching algorithm.

---

## 2. Category Boundaries

Memory files are organized into three categories defined in `vocabulary/memory_policy.yml`. Each category has a `prefix-` naming convention that makes the file's type visible in directory listings.

### 2.1 `empirical-`

Files in this category contain empirically verified findings: observations and measurements the project has confirmed through its own experimentation. Examples include runtime behavior observations, testing-derived structural facts, and operational measurements that cannot be inferred from documentation alone.

Empirical memory captures what the project has learned by doing. It is distinct from external references (what others have said) and from patterns (what the project has found effective as procedure).

### 2.2 `external-`

Files in this category contain external constraints and references: requirements imposed by upstream dependencies, third-party API limits, vendor documentation quotations, and knowledge that originates outside the project.

External memory may become stale if the upstream source changes. This is the category most likely to require periodic review against current upstream state.

### 2.3 `pattern-`

Files in this category contain tactical operational patterns: recurring cycle-level recipes, routing heuristics, and procedural knowledge developed through work on the project.

The scope of this category is explicitly tactical. Architectural or design-level patterns do not belong here. If a finding rises to the level of architectural principle or design rationale — something that shapes how the project is structured rather than how day-to-day work is executed — it belongs in `.nexus/context/`, not in `memory/`.

### 2.4 Relation to `context/` and `rules/`

`.nexus/memory/` and `.nexus/context/` serve different purposes and should not be confused.

`memory/` holds project-accumulated working knowledge: empirical findings, external references, and tactical patterns that agents draw on during active work. These files are created via `[m]` and managed via `[m:gc]`. They are subject to the gc lifecycle defined in this document.

`.nexus/context/` holds design principles, architectural philosophy, and onboarding materials — documents that define the project's enduring structure and intent. Primer-style documents (documents that introduce the project's goals, vocabulary, or design decisions to a new reader) belong in `context/`, not in `memory/`. The gc lifecycle does not apply to `context/` files; they are maintained by `[sync]` and represent stable project knowledge rather than accumulated working observations.

`.nexus/rules/` holds enforceable project rules. These are not memory entries and are not subject to this lifecycle.

---

## 3. Consumer Responsibility

The principles in §1 are canonical. Everything below is consumer-local — decisions that each consumer makes independently, calibrated to their own project, harness, and team cadence. nexus-core does not prescribe values for any of the following items.

Consumers determine:

- The specific threshold for each signal used in automatic deletion (for example: how much time elapsed, how many cycles completed, what access count constitutes "unused")
- File and directory size criteria, if any, used in gc decisions
- The frequency or trigger conditions for `[m:gc]` invocations in normal workflow
- The git commit message format for deletion commits, beyond the recommendation that a recovery path be included
- Whether access counts are re-incremented in resumed sessions (i.e., whether a resumed context that re-reads a file adds to the count or not)
- The keyword overlap threshold, semantic distance measure, or other matching criteria used to decide whether merge-before-create applies
- Whether additional filename prefix categories beyond the canonical three are introduced for project-specific use

Consumers may configure automatic deletion, but must not treat it as active unless they have explicitly opted in. All other gc path decisions remain under user control by default.

---

## 4. Reference

Related vocabulary and files:

- `vocabulary/memory_policy.yml` — machine-readable canonical form of the principles in this document
- `vocabulary/tags.yml` — `[m]` and `[m:gc]` tag definitions
- `vocabulary/invocations.yml` — `memory_read_observation` primitive
- `conformance/state-schemas/memory-access.schema.json` — access log schema (canonical field names and types)
- `docs/nexus-outputs-contract.md §Shared filename convention` — `memory-access.jsonl` registration and location convention
- `docs/behavioral-contracts.md` — other behavioral contracts in nexus-core
- `.nexus/context/boundaries.md` — why specific thresholds are not canonical (거절 근거 및 Authoring layer 정체성)
