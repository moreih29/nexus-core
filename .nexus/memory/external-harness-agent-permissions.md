# 3 하네스 에이전트 도구 권한 제어

> 자매 프로젝트 + 공식 문서 검증. nexus-core의 결정론적 권한 모델 설계 기반 자료.

## 1. 3 레이어 권한 모델 (공통)

| 레이어 | 위치 | 강제력 |
|---|---|---|
| **A. Agent definition** | 에이전트 frontmatter/TOML | 런타임 강제 (3 하네스 모두 가장 강력하고 portable) |
| **B. Caller propagation → MCP gating** | 도구 호출 시 caller 식별 | **하네스마다 천차만별, 결정론 위협** |
| **C. Hook 기반 인터셉트** | PreToolUse 등 훅 | 하네스별 한계 다름 |

## 2. Claude Code

### Agent definition

`agents/<name>.md` frontmatter:

```yaml
---
tools: [Read, Grep, Glob]                                # allowlist
# 또는
disallowedTools: [Edit, Write, mcp__*]                   # denylist
---
```

- 두 필드 동시 지정 시: disallowedTools 먼저 → tools로 재필터링
- 와일드카드 `mcp__*`, `mcp__server__*`, `mcp__server__tool` 지원
- SDK에선 `allowedTools`로 표기

claude-nexus 패턴: **9 에이전트 모두 `disallowedTools` denylist 방식 사용**.

| 에이전트 | disallowedTools |
|---|---|
| HOW (architect·designer·postdoc·strategist) | Edit · Write · NotebookEdit · nx_task_add · nx_task_update |
| engineer | nx_task_add (task_update는 허용) |
| researcher · reviewer · tester | Edit · Write · NotebookEdit · nx_task_add |
| writer | nx_task_add |

### Caller 전파 — **공식 미지원**

- 서브에이전트가 MCP 도구 호출해도 MCP 서버는 누가 호출했는지 모름
- Issue #32514: "Provide agent identity context to MCP tool calls" — feature request 상태, 미구현
- claude-nexus는 caller 검증 코드 **없음** (`nx_task_close` 핸들러에 가드 없음)
- "Lead-only" 강제는 **agent definition denylist에 의존** (soft gating)

### Hook

PermissionRequest 훅으로 도구 호출 차단 가능. frontmatter와 독립 동작 — 둘 다 사용 가능.

출처: [Sub-agents](https://code.claude.com/docs/en/sub-agents) · [Permissions](https://code.claude.com/docs/en/permissions) · [Issue #32514](https://github.com/anthropics/claude-code/issues/32514)

## 3. OpenCode

### Agent definition

`.opencode/agents/<name>.md` frontmatter:

**v1.1.1+ 권장 — `permission:` 필드:**

```yaml
---
description: ...
mode: subagent
permission:
  edit: deny
  bash:
    "*": ask
    "git diff": allow
    "git log*": allow
  webfetch: deny
  mymcp_*: false      # MCP 서버별 와일드카드
---
```

값: `allow` · `ask` · `deny`. 와일드카드 `*`(0+개) · `?`(정확 1개). 마지막 매칭 우선.

**구식 — `tools:` 필드 (deprecated):**

```yaml
tools:
  bash: false
  write: false
```

`true` ↔ `{"*": "allow"}`, `false` ↔ `{"*": "deny"}` 자동 변환.

opencode-nexus 패턴: createConfigHook으로 프로그램매틱 등록. denylist 매핑은 claude-nexus와 동일 + `task: false` · `nx_task_close: false` 모든 서브에이전트 강제. `general` · `explore` 내장 에이전트도 강제 주입으로 우회 차단.

### Caller 전파 — **부분 지원 (버그 있음)**

`tool.execute.before` 훅의 input에 caller 정보 포함:

```ts
interface ToolInput {
  tool: string,
  agent?: string,
  agent_id?: string,
  agentID?: string,
  sessionID?: string,
  session_id?: string
}
```

**버그 #5894**: 서브에이전트가 호출한 도구는 훅 미발화 (Closed 처리됐으나 fix 검증 불가).

opencode-nexus 방어 설계 — 2중 검증:
1. `nx_task_close` 핸들러 내부에서 `resolveCallerAgentFromToolContext` (context 객체 재귀 탐색)
2. agent-tracker.json `child_session_id` 매칭으로 fallback (`tool.execute.after`에서 미리 기록)

### Hook

`permission.ask` 훅 — **미발화 버그 #7006** (PR #19453 미병합). 우회: `tool.execute.before`에서 `throw`.

출처: [Agents](https://opencode.ai/docs/agents/) · [Permissions](https://opencode.ai/docs/permissions/) · [Issue #5894](https://github.com/anomalyco/opencode/issues/5894) · [Issue #7006](https://github.com/anomalyco/opencode/issues/7006)

## 4. Codex CLI

### Agent definition (Native TOML)

`~/.codex/agents/<name>.toml`:

```toml
name = "architect"
model = "gpt-5.4"
sandbox_mode = "read-only"            # 파일 쓰기 OS 샌드박스 차단
developer_instructions = """..."""

[mcp_servers.nx]
command = "bun"
args = ["...dist/mcp/server.js"]
disabled_tools = ["nx_task_close", "nx_task_add"]      # 런타임 강제 — 모델이 호출 자체 불가
```

| 키 | 효과 |
|---|---|
| `sandbox_mode = "read-only"` | OS 샌드박스 — 파일 쓰기 전체 차단 (Edit·Write 등) |
| `[mcp_servers.<id>] disabled_tools = [...]` | 그 MCP 서버의 특정 도구 비활성화 (런타임 강제) |
| `[mcp_servers.<id>] enabled_tools = [...]` | allowlist (있으면 명시된 것만) |
| `[mcp_servers.<id>] default_tools_approval_mode` | 사용자 승인 요구 |

`config.toml`의 `[agents.<name>]`에는 도구 권한 키 없음 — 반드시 agent 파일에서 설정.

codex-nexus 변환 흐름:

```
prompts/<name>.md (frontmatter)
  ↓ definitions.ts (capabilities: ["no_file_edit", "no_task_create", ...])
  ↓ native-config.ts → generateStandaloneAgentToml()
  ↓
~/.codex/agents/<name>.toml
  sandbox_mode + [mcp_servers.nx] disabled_tools
```

### nexus-core 히스토리

- **v0.15.x**: `[agents.<id>]` nested 테이블 + `[agents.<id>.mcp_servers.nx] disabled_tools`
- **v0.16.0**: standalone role file로 전환 시 `[mcp_servers.nx]` 블록을 실수로 drop하고 root-level `disabled_tools` 방출 → codex-cli 0.121의 `RawAgentRoleFileToml` `deny_unknown_fields`에 reject (Issue #48)
- **v0.16.2**: standalone role file 구조 유지 + `[mcp_servers.nx] disabled_tools = [...]` 복원 (올바른 스키마)

### Caller 전파 — **De-facto (미문서화)**

Codex 런타임이 MCP `tools/call` 요청의 `_meta` 필드에 `x-codex-turn-metadata` 객체 자동 삽입:

```ts
{
  session_id: string,
  thread_source?: "subagent",   // 서브에이전트 세션 표시
  turn_id: string
}
```

**공식 문서 명시 없음**. codex-nexus가 의존 중.

agent_role 추출 2단계:
1. `_meta.x-codex-turn-metadata.thread_source === "subagent"` 확인
2. `~/.codex/sessions/<session_id>.jsonl` 첫 줄(session_meta) 파싱 → `payload.source.subagent.thread_spawn.agent_role` 추출

→ codex-nexus가 jsonl 포맷 역공학. **공개 안정 스펙 아님**.

### Hook

`hooks.json`의 PreToolUse는 `matcher: "Bash"`만 인터셉트. MCP 도구 권한은 **TOML disabled_tools + 핸들러 내 검증**이 담당.

출처: [Configuration Reference](https://developers.openai.com/codex/config-reference) · [Advanced Configuration](https://developers.openai.com/codex/config-advanced) · [MCP](https://developers.openai.com/codex/mcp)

## 5. 결정론 평가 (3 하네스 통합)

| 메커니즘 | Claude | OpenCode | Codex | 결정성 |
|---|---|---|---|---|
| **Agent definition denylist** | ✓ disallowedTools | ✓ permission | ✓ disabled_tools (TOML) | **완전** — 3 하네스 모두 강제 |
| File write 차단 | tools/disallowedTools | permission edit | sandbox_mode | **완전** |
| Caller 전파 → MCP gating | **✗ 미지원** | △ 버그 (#5894) | △ 미문서화 (`_meta`) | **불가능** — 3 하네스 비대칭 |
| Hook 기반 인터셉트 | ✓ 25 이벤트 | △ 버그 다수 | △ Bash만 | **부분** |

## 6. nexus-core 시사점

**결정론 확보 전략**:

1. **Agent definition denylist를 단일 portable 메커니즘으로 채택**
   - nexus-core 표준 frontmatter에 `disallowed_tools: [...]` 명시
   - 빌드 시 하네스별 변환:
     - Claude → `disallowedTools:` frontmatter
     - OpenCode → `permission:` block (`{tool: deny}`)
     - Codex → TOML `[mcp_servers.nx] disabled_tools = [...]`

2. **Caller 전파 의존 회피**
   - "Lead-only" 같은 권한은 agent denylist로 강제 (soft gating)
   - MCP 도구 핸들러에서 caller 검증 시도하지 않음 → 결정론 강화
   - codex-nexus의 `getTaskAddDeniedReason` 같은 캘러 검증은 **하네스 종속 hack**, 표준화 불가

3. **Lead 식별 모델**
   - Lead만 `nx_task_add` 등 특정 도구 사용 가능하려면:
     - Lead 에이전트는 denylist 비움
     - 모든 다른 에이전트는 denylist에 그 도구 명시
   - 3 하네스에서 동일하게 동작 (런타임 강제)

4. **벤더 미지원 사항 명시**
   - Claude는 caller 전파 미지원 (Issue #32514 추적)
   - OpenCode는 subagent hook 버그 (#5894)
   - Codex의 `_meta` 메커니즘은 비공식 → 변경 위험

## 확인 불가

- Claude의 와일드카드 `mcp__*`가 `disallowedTools`에서도 동일 동작하는지 (공식 문서 명시 없음)
- OpenCode `tool.execute.before` input.agent 필드가 항상 채워지는지
- Codex `_meta.x-codex-turn-metadata`가 공개 안정 API인지
- `.codex/sessions/<id>.jsonl` `session_meta` 포맷의 안정성
