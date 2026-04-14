# Nexus Conformance Fixtures

Declarative behavioral tests for Nexus MCP tools. Each fixture describes a tool invocation (or sequence of invocations) and the state assertions that must hold afterwards. Fixtures are harness-neutral: they use abstract tool names and JSONPath assertions, so any consumer can write a runner against their own harness implementation.

## What conformance fixtures are

A conformance fixture is a JSON document that specifies:

1. **Precondition** — the state files that must exist (or must not exist) before the test runs.
2. **Action** (or **Steps** or **Event**) — one or more tool invocations, or a single lifecycle event, with concrete parameters.
3. **Postcondition** — assertions on the tool return value and on state files after the invocation.
4. **Covers** — a declaration of which state-schema fields and return-value paths this fixture verifies.

Fixtures do not contain any test runner code. Consumers load the JSON, reconstruct precondition state, call their own tool implementation, and verify the postconditions.

## Fixture format

All fixtures must validate against [`schema/fixture.schema.json`](schema/fixture.schema.json).

Every fixture must include a top-level `covers` field (required). An optional `uncovered_params` field may also appear.

### `covers` field

`covers` declares which schema fields and return-value paths this fixture's postcondition actually verifies. The coverage validator uses this declaration to track completeness across the fixture suite.

```json
"covers": {
  "state_schemas": {
    "plan.schema.json": ["id", "topic", "issues[].status"]
  },
  "return_value": {
    "plan_start": ["created", "plan_id", "issueCount"]
  },
  "description": "Verifies plan creation fields and initial issue status."
}
```

**Constraint**: at least one of `state_schemas` or `return_value` must be non-empty. Both may be present.

- `state_schemas` — map of state-schema filename (e.g. `plan.schema.json`) to an array of field paths verified by this fixture's postcondition. Field paths use dot-notation with array index notation (e.g. `issues[].status`).
- `return_value` — map of abstract tool name (e.g. `plan_start`) to an array of return-value field paths verified by this fixture's postcondition.
- `description` — optional human-readable explanation of coverage rationale or known gaps.

### `uncovered_params` field

`uncovered_params` is an optional array of `action.params` keys that are intentionally not asserted in the postcondition. Entries listed here are treated as explicit exceptions by the coverage validator, preventing false anti-pattern warnings.

Use this field for routing or contextual input params whose effect is not directly observable via state-file or return-value assertions:

```json
"uncovered_params": ["research_summary"]
```

### Schema `oneOf` constraint

Each fixture must contain exactly one of: `action` (single tool invocation), `event` (single lifecycle event), or `steps` (multi-step sequence). These three branches are mutually exclusive.

### Single-action fixture

```json
{
  "test_id": "plan_start_happy_path",
  "description": "...",
  "covers": {
    "state_schemas": { "plan.schema.json": ["id", "topic", "issues[].status"] },
    "return_value": { "plan_start": ["created", "plan_id", "issueCount"] }
  },
  "precondition": {
    "state_files": {
      ".nexus/state/plan.json": null
    }
  },
  "action": {
    "tool": "plan_start",
    "params": { "topic": "...", "issues": ["..."], "research_summary": "..." }
  },
  "postcondition": {
    "return_value": { "$.created": true },
    "state_files": {
      ".nexus/state/plan.json": { "$.topic": "..." }
    }
  }
}
```

### Multi-step scenario

```json
{
  "test_id": "full_plan_cycle",
  "description": "...",
  "covers": {
    "state_schemas": { "plan.schema.json": ["id", "topic", "issues[].status"] }
  },
  "steps": [
    {
      "description": "...",
      "action": { "tool": "plan_start", "params": { ... } },
      "assert_return": { "$.created": true },
      "assert_state": { ".nexus/state/plan.json": { "$.issues.length": 2 } }
    }
  ]
}
```

## Event-based (Lifecycle) Fixtures

`agent-tracker.json`은 MCP tool이 아니라 harness의 session hook이 관리한다. 이 파일의 구조적 정확성을 검증하기 위해 `action` 대신 `event` 필드를 사용하는 lifecycle fixture를 사용한다.

Event fixture는 "harness가 특정 event를 실행한 후 state 파일의 구조가 올바른가"를 선언적으로 명세한다. Tool invocation 없이 event 트리거만으로 postcondition을 검증한다.

### Event types

`event.type`은 다음 3종 중 하나여야 한다:

| Event type | 책임 범위 |
|---|---|
| `agent_spawn` | `agent-tracker.json`에 신규 항목 생성 (running 상태) |
| `agent_complete` | `agent-tracker.json` 항목을 완료 상태로 전환 |
| `agent_resume` | `agent-tracker.json` 재개 카운터 증가 및 상태 복귀 |

### Lifecycle fixture 구조 예시

```json
{
  "test_id": "agent_spawn_creates_entry",
  "description": "...",
  "covers": {
    "state_schemas": {
      "agent-tracker.schema.json": ["harness_id", "agent_name", "agent_id", "status"]
    }
  },
  "event": {
    "type": "agent_spawn",
    "params": { ... }
  },
  "postcondition": {
    "state_files": {
      ".nexus/state/agent-tracker.json": { "$[0].status": "running" }
    }
  }
}
```

### Lifecycle fixture 목록

`conformance/lifecycle/` 디렉토리에 3개 파일이 존재한다:

| 파일 | Event type | 검증 대상 |
|---|---|---|
| `agent-spawn.json` | `agent_spawn` | `agent-tracker.json` 첫 항목 생성 (running 상태) |
| `agent-complete.json` | `agent_complete` | `agent-tracker.json` 항목 완료 상태 전환 |
| `agent-resume.json` | `agent_resume` | `agent-tracker.json` 재개 카운터 및 상태 복귀 |

## Assertion conventions

Assertions are key/value objects where keys are JSONPath expressions and values are expected results or matchers.

| Pattern | Meaning |
|---|---|
| `"$.field": "expected"` | Exact string match |
| `"$.field": 42` | Exact number match |
| `"$.field": true` | Boolean match |
| `"$.array.length": 3` | Array length check |
| `"$.field": { "type": "iso8601" }` | Value is a valid ISO 8601 timestamp |
| `"$.field": { "type": "number", "min": 1 }` | Numeric value >= 1 |
| `"$.field": { "type": "string", "minLength": 5 }` | String with minimum length |
| `".nexus/state/plan.json": null` | File must not exist |
| `".nexus/state/artifacts/findings.md": {}` | File must exist; content not inspected (use for non-JSON artifacts like .md, .txt, binary files) |

For `state_files`, a `null` value at the file path key means the file must be absent. A `null` value at a JSONPath key within a file assertion means that field must be `null`.

## Authoring Rules

Fixtures must satisfy the following rules. The coverage validator enforces Rules 1–3 at CI time.

**Rule 1 — Coverage**: 모든 state-schema 필드(required + optional)는 최소 1개 fixture의 `covers.state_schemas`에 등장해야 한다. 단 한 필드라도 누락되면 validator가 실패한다.

**Rule 2 — No Silent Drop**: `action.params`의 모든 key는 `postcondition`(state_files 또는 return_value)에서 assert되거나 `uncovered_params`에 명시되어야 한다. 두 조건 모두 충족하지 않는 param key는 anti-pattern으로 보고된다.

**Rule 3 — CI Gate**: fixture 추가 또는 수정 시 `validate:conformance` validator 통과가 release block이다. 실패 상태로 merge할 수 없다.

**Rule 4 — Truthful Covers**: `covers`는 실제로 postcondition에서 assert하는 필드만 나열해야 한다. 허위 claim 금지. validator는 covers 선언과 실제 assertion 간 교차 검증을 수행하지 않지만, review 시 수동 검증 대상이다.

## Running the Coverage Validator

`conformance-coverage.ts`는 두 가지를 검증한다:

1. **Schema field coverage** — `conformance/state-schemas/`의 모든 schema 파일에서 추출한 필드가 전체 fixture의 `covers.state_schemas` union에 포함되는지 확인한다.
2. **Params anti-pattern** — single-action fixture의 `action.params` key가 `postcondition` assertion 또는 `uncovered_params`에 트레이스 가능한지 확인한다.

### 실행 명령

```
bun run validate:conformance
```

또는 직접 실행:

```
bun run scripts/conformance-coverage.ts
```

### 출력 해석

**PASS** (exit code 0):

```
✓ All state-schema fields covered: 5 schemas, 54 fields across 48 fixtures
```

**FAIL — schema field coverage 미달** (exit code 1):

```
✗ Schema field coverage incomplete:
  plan.schema.json: missing fields [issues[].how_agents]
```

**FAIL — params anti-pattern 감지** (exit code 1):

```
✗ Params anti-pattern detected (params not verified in postcondition):
  conformance/tools/plan-start.json (plan_start_happy_path): uncovered params [research_summary]
```

exit code 2는 파일 파싱 등 fatal error를 의미한다.

## Writing a test runner

A conformance test runner does the following for each fixture:

1. **Load** the fixture JSON file.
2. **Establish precondition**: for each entry in `precondition.state_files`, write the content object as JSON to the specified path, or delete the file if the value is `null`.
3. **Execute**:
   - For single-action fixtures: call the tool named by `action.tool` with `action.params`.
   - For event fixtures: trigger the harness session hook for the event type specified by `event.type`, passing `event.params`.
   - For multi-step scenarios: iterate `steps` in order, calling each `action` (or triggering each `event`) and evaluating `assert_return` and `assert_state` after each step before proceeding.
4. **Evaluate postconditions**:
   - Check `postcondition.return_value` assertions against the tool's return value.
   - Check `postcondition.state_files` assertions against the actual file system state. For each entry in `state_files`:
     - Value is `null` → assert the file does NOT exist.
     - Value is an empty object `{}` → assert the file EXISTS; do NOT parse content (use for non-JSON artifacts: .md, .txt, binary).
     - Value is a non-empty object `{...}` → parse file as JSON and evaluate each JSONPath assertion against the parsed content.
   - If `postcondition.error` is `true`, the tool call must have produced an error.
   - If `postcondition.error_contains` is set, the error message must contain that substring.
5. **Report** pass/fail per `test_id`.

Example runner sketch (TypeScript):

```typescript
import fixtures from "./tools/plan-start.json";

for (const fixture of fixtures) {
  applyPrecondition(fixture.precondition);
  const result = await callTool(fixture.action.tool, fixture.action.params);
  assertPostcondition(fixture.postcondition, result);
}
```

## Coverage

### Abstract tools (11/11 커버됨)

11개 abstract tool 모두 전용 fixture 파일을 갖는다. 각 fixture는 tool의 happy path, error path, optional 파라미터 경로를 포함한다.

| Abstract name | Description | Fixture file |
|---|---|---|
| `plan_start` | Start a new plan session | `tools/plan-start.json` |
| `plan_decide` | Record a decision on a plan issue | `tools/plan-decide.json` |
| `plan_status` | Query the current plan state | `tools/plan-status.json` |
| `plan_update` | Add, remove, edit, or reopen plan issues | `tools/plan-update.json` |
| `task_add` | Add a task to the task list | `tools/task-add.json` |
| `task_update` | Update a task's status | `tools/task-update.json` |
| `task_list` | List tasks with dependency-aware ready set | `tools/task-list.json` |
| `task_close` | Archive cycle into history and delete source files | `tools/task-close.json` |
| `history_search` | Search past cycles in history.json | `tools/history-search.json` |
| `context` | Read or write .nexus/context/ knowledge files | `tools/context.json` |
| `artifact_write` | Write an artifact output file | `tools/artifact-write.json` |

### Lifecycle events (3/3 커버됨)

| Event type | Fixture file |
|---|---|
| `agent_spawn` | `lifecycle/agent-spawn.json` |
| `agent_complete` | `lifecycle/agent-complete.json` |
| `agent_resume` | `lifecycle/agent-resume.json` |

### State-schema field coverage

4개 state-schema의 모든 필드가 100% 커버된다:

| Schema | 검증 도구 |
|---|---|
| `plan.schema.json` | `tools/plan-*.json` fixtures |
| `tasks.schema.json` | `tools/task-*.json` fixtures |
| `history.schema.json` | `tools/history-search.json`, `tools/task-close.json` |
| `agent-tracker.schema.json` | `lifecycle/agent-*.json` fixtures |

Validator 통과 결과 예시: `✓ All state-schema fields covered: 4 schemas across fixture suite`

## Excluded tools

AST and LSP tools (`ast_search`, `ast_replace`, `lsp_diagnostics`, `lsp_goto_definition`, etc.) are harness utilities that depend on language server infrastructure. They are not ecosystem contracts and are excluded from conformance coverage.

## 관련 문서

- `docs/nexus-outputs-contract.md` — harness 산출물 계약 (artifact 경로, 파일 형식)
- `docs/nexus-state-overview.md` — state file 기술 스펙 (schema 정의, 파일 위치)
- `docs/nexus-tools-contract.md` — 11개 abstract tool 계약 (params, return value)
- `CONSUMING.md §Conformance Obligation` — consumer가 준수해야 하는 conformance 의무
