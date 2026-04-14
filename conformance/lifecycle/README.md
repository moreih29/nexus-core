# Lifecycle Fixtures

이 fixture들은 harness의 session hook이 event를 재현한 후의 state 파일을 검증한다.

## Event Types

| Fixture | Event Type | 검증 대상 |
|---|---|---|
| `agent-spawn.json` | `agent_spawn` | `agent-tracker.json` 첫 항목 생성 (running 상태) |
| `agent-complete.json` | `agent_complete` | `agent-tracker.json` 항목 완료 상태 전환 |
| `agent-resume.json` | `agent_resume` | `agent-tracker.json` 재개 카운터 및 상태 복귀 |

## Tool-action 대신 Event 트리거 사용

각 fixture는 `action` (tool invocation) 대신 `event` 필드를 사용한다. `agent-tracker.json`은 harness의 session hook이 관리하며, MCP tool이 직접 쓰지 않는다. Event fixture는 "harness가 event를 실행한 후 state 파일의 구조가 올바른가"를 선언적으로 명세한다.

## Placeholder token 경로

이 lifecycle fixture 3종의 `precondition.state_files` 및 `postcondition.state_files` 키는 모두 placeholder token 형식을 사용한다:

```
{STATE_ROOT}/{HARNESS_ID}/agent-tracker.json
```

Test runner는 이 키를 파일 시스템 경로로 해석하기 전에 다음 치환을 수행해야 한다:

| Token | 치환 값 | 출처 |
|---|---|---|
| `{STATE_ROOT}` | `.nexus/state` | 고정 상수 |
| `{HARNESS_ID}` | harness 식별자 (예: `claude-nexus`) | 해당 fixture의 `event.params.harness_id` |

치환 규약:
- `{STATE_ROOT}`와 `{HARNESS_ID}` 두 token만 인식된다. 그 외 `{…}` 형태의 token이 경로에 등장하면 authoring 오류로 처리한다.
- 공통 파일 fixture (`plan-*`, `task-*`, `history-*`, `artifact-write`)는 하드코딩된 경로를 사용하며 이 token 규약이 적용되지 않는다. Token 경로는 lifecycle fixture 3종에만 적용된다.

### Fixture별 경로 요약

| Fixture | `event.params.harness_id` 예시 | 해석된 경로 |
|---|---|---|
| `agent-spawn.json` | `claude-nexus` | `.nexus/state/claude-nexus/agent-tracker.json` |
| `agent-complete.json` | `claude-nexus` | `.nexus/state/claude-nexus/agent-tracker.json` |
| `agent-resume.json` | `claude-nexus` | `.nexus/state/claude-nexus/agent-tracker.json` |
