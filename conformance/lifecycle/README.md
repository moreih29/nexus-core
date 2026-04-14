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
