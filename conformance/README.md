# Nexus Conformance Fixtures

Declarative behavioral tests for Nexus MCP tools. Each fixture describes a tool invocation (or sequence of invocations) and the state assertions that must hold afterwards. Fixtures are harness-neutral: they use abstract tool names and JSONPath assertions, so any consumer can write a runner against their own harness implementation.

## What conformance fixtures are

A conformance fixture is a JSON document that specifies:

1. **Precondition** — the state files that must exist (or must not exist) before the test runs.
2. **Action** (or **Steps**) — one or more tool invocations with concrete parameters.
3. **Postcondition** — assertions on the tool return value and on state files after the invocation.

Fixtures do not contain any test runner code. Consumers load the JSON, reconstruct precondition state, call their own tool implementation, and verify the postconditions.

## Fixture format

All fixtures must validate against [`schema/fixture.schema.json`](schema/fixture.schema.json).

### Single-action fixture

```json
{
  "test_id": "plan_start_happy_path",
  "description": "...",
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

For `state_files`, a `null` value at the file path key means the file must be absent. A `null` value at a JSONPath key within a file assertion means that field must be `null`.

## Writing a test runner

A conformance test runner does the following for each fixture:

1. **Load** the fixture JSON file.
2. **Establish precondition**: for each entry in `precondition.state_files`, write the content object as JSON to the specified path, or delete the file if the value is `null`.
3. **Execute**:
   - For single-action fixtures: call the tool named by `action.tool` with `action.params`.
   - For multi-step scenarios: iterate `steps` in order, calling each `action` and evaluating `assert_return` and `assert_state` after each step before proceeding.
4. **Evaluate postconditions**:
   - Check `postcondition.return_value` assertions against the tool's return value.
   - Check `postcondition.state_files` assertions against the actual file system state.
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

These fixtures cover the 11 Nexus-core abstract tool names:

| Abstract name | Description |
|---|---|
| `plan_start` | Start a new plan session |
| `plan_decide` | Record a decision on a plan issue |
| `plan_status` | Query the current plan state |
| `plan_update` | Add, remove, edit, or reopen plan issues |
| `task_add` | Add a task to the task list |
| `task_update` | Update a task's status |
| `task_list` | List tasks with dependency-aware ready set |
| `task_close` | Archive cycle into history and delete source files |
| `history_search` | Search past cycles in history.json |
| `context` | Read or write .nexus/context/ knowledge files |
| `artifact_write` | Write an artifact output file |

## Excluded tools

AST and LSP tools (`ast_search`, `ast_replace`, `lsp_diagnostics`, `lsp_goto_definition`, etc.) are harness utilities that depend on language server infrastructure. They are not ecosystem contracts and are excluded from conformance coverage.
