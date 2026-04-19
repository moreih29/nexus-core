# OpenCode 훅·네이티브 툴

> sst/opencode 공식 — OpenCode 훅 시스템과 빌트인 툴 카탈로그. 출처: [Plugins](https://opencode.ai/docs/plugins/) · [Tools](https://opencode.ai/docs/tools/) · [DeepWiki Plugin System](https://deepwiki.com/sst/opencode/7.3-plugin-system) · [DeepWiki Built-in Tools](https://deepwiki.com/sst/opencode/5.3-built-in-tools-reference). 플러그인 구조는 [`external-opencode-plugin.md`](./external-opencode-plugin.md) 참조.

## 1. Export 규약

`@opencode-ai/plugin` 패키지 사용. **named export `server`** (default 아님).

```ts
import type { Plugin } from "@opencode-ai/plugin"

export const server: Plugin = async (ctx) => ({
  "session.created": async ({ event }) => { /* ... */ },
  "tool.execute.before": async (input, output) => { /* ... */ },
})
```

`Plugin` 타입: `(input: PluginInput, options?: PluginOptions) => Promise<Hooks>`

## 2. 훅 종류 (직접 훅 + Bus 이벤트)

### 2-1. 직접 훅 (Hooks 인터페이스 named keys)

| 훅 | 발화 | 비고 |
|---|---|---|
| `event` | 모든 시스템 Bus 이벤트 | 범용 리스너 |
| `tool.execute.before` | 빌트인 툴 실행 직전 | args 수정 가능 |
| `tool.execute.after` | 빌트인 툴 실행 직후 | output 수정 — **버그 #13574 (UI 미반영)** |
| `tool.definition` | 툴 정의 로드 시 | description·schema 수정 |
| `command.execute.before` | 내부 커맨드 실행 직전 | — |
| `chat.params` | LLM 호출 파라미터 확정 직전 | temperature·topP 수정 |
| `chat.headers` | LLM HTTP 요청 헤더 추가 시 | 커스텀 헤더 주입 |
| `chat.message` | 새 메시지 생성 시 | session·model 컨텍스트 |
| `permission.ask` | 권한 요청 발생 시 | **버그 #7006 (미발화)** |
| `shell.env` | 셸 인스턴스 생성 시 | 환경 변수 주입 |
| `auth` | OAuth·API 인증 흐름 | credential loader 등록 |
| `provider` | 모델 프로바이더 해결 시 | 커스텀 모델 공급 |
| `config` | SDK 설정 로드 시 | 설정 객체 변경 |
| `tool` | 커스텀 툴 등록 | 빌트인 외 플러그인 정의 툴 |
| `experimental.chat.messages.transform` | 메시지 배열 재구성 | 실험 |
| `experimental.chat.system.transform` | 시스템 프롬프트 수정 | 실험 |
| `experimental.session.compacting` | 세션 컴팩션 발생 시 | 컨텍스트 보존 |
| `experimental.compaction.autocontinue` | 컴팩션 후 자동 계속 제어 | 실험 |
| `experimental.text.complete` | 메시지 텍스트 완성 시 | 실험 |

### 2-2. `event` 훅 내부 event.type 카탈로그

| 카테고리 | event.type |
|---|---|
| Session | `session.created` · `session.idle` · `session.deleted` · `session.compacted` · `session.diff` · `session.error` · `session.status` · `session.updated` |
| Message | `message.updated` · `message.part.updated` · `message.part.removed` · `message.removed` |
| Permission | `permission.asked` · `permission.replied` |
| File | `file.edited` · `file.watcher.updated` |
| LSP | `lsp.client.diagnostics` · `lsp.updated` |
| Shell | `shell.env` |
| Server | `server.connected` |
| Command | `command.executed` |
| Todo | `todo.updated` |
| TUI | `tui.prompt.append` · `tui.command.execute` · `tui.toast.show` |
| Installation | `installation.updated` |
| Question | `question.asked` · `question.replied` · `question.rejected` |
| Experimental | `experimental.session.compacting` |

## 3. PluginInput (context)

| 필드 | 타입 | 설명 |
|---|---|---|
| `client` | SDK Client | localhost:4096 SDK 클라이언트 |
| `project` | Project | `id` · `worktree` · `vcs` |
| `directory` | string | 작업 디렉토리 |
| `worktree` | string | git worktree 루트 |
| `$` | BunShell | Bun `$` shell API |

## 4. 핵심 훅 시그니처

### tool.execute.before

> ⚠ 이 시그니처는 부정확 — args는 `output.args`에 있음 (input 아님). 정확한 타입은 §8 참조.

```ts
"tool.execute.before": async (input, output) => {
  // input: { tool, sessionID, callID }
  // output: { args }   ← 여기를 mutate (reference 전달)
  // throw → 차단
}
```

### tool.execute.after

```ts
"tool.execute.after": async (input) => {
  // output 객체: title · output · metadata
  // output.output 수정 시도 가능하나 UI 미반영 버그
}
```

### chat.params

```ts
"chat.params": async (input, output) => {
  // input: sessionID · model · provider · message
  // output 수정: temperature · topP · topK · maxOutputTokens
}
```

### permission.ask

```ts
"permission.ask": async (permission, output) => {
  // permission.type: read_file · bash · ...
  // output.status = 'allow' | 'deny'
  // 현재 미발화 버그
}
```

## 5. 출력 처리 요약

| 훅 | 차단 | 인자 수정 | 결과 가로채기 | 상태 |
|---|---|---|---|---|
| `tool.execute.before` | `throw` | args | 미지원 | 정상 |
| `tool.execute.after` | 불가 | 불가 | output (UI 미반영 버그) | 버그 |
| `permission.ask` | allow/deny | — | — | **미발화** |
| `chat.params` | 불가 | temperature 등 | — | 정상 |
| `event` | 불가 | 불가 | 불가 | 관찰 전용 |

## 6. MCP 훅 갭

MCP 툴 호출 시 `tool.execute.before/after` 발화 안 되는 이슈 #2319 보고됨. DeepWiki는 "MCP도 표준 보안 모델 따른다"고 기술하나 원본 이슈 해결 여부 미확인.

## 7. 네이티브 빌트인 툴

소문자 명명 (Claude Code의 PascalCase와 대조).

### 파일 조작

| 툴 | 핵심 인자 |
|---|---|
| `read` | `filePath` · `offset` · `limit` (50KB 상한, 이미지·PDF base64) |
| `write` | `filePath` · `content` (`edit` 권한 필요) |
| `edit` | `oldString` · `newString` (LSP 진단 통합) |
| `list` | `directoryPath` (재귀, `node_modules`·`.git` 제외) |
| `apply_patch` | patch 텍스트 (`edit` 권한 필요) |

### 셸 / 검색 / 웹

| 툴 | 인자 |
|---|---|
| `bash` | `command` · `timeout` (기본 2분, tree-sitter로 파싱) |
| `grep` | `pattern` (ripgrep, 100건 상한) |
| `glob` | `pattern` (ripgrep `--glob`) |
| `webfetch` | `url` (5MB 상한, Markdown 변환) |
| `websearch` | query (Exa AI, `OPENCODE_ENABLE_EXA=1` 필요) |

### 메타

| 툴 | 설명 |
|---|---|
| `task` | 서브에이전트 위임 (서브에이전트에서는 기본 비활성) |
| `lsp` | LSP 기반 코드 인텔리전스 (goToDefinition · findReferences · hover) |
| `todowrite` / `todoread` | 세션 할 일 |
| `skill` | SKILL.md 파일 내용을 대화에 로드 |
| `question` | 사용자 질문 — 인터랙티브 분기 |

## 확인 불가

- `tool.execute.before` output 객체 정확한 타입
- `permission.ask` 미발화 버그 수정 여부
- `tool.execute.after` UI 미반영 버그 수정 여부
- MCP 훅 발화 이슈 최종 해결 여부
- `event` 훅 핸들러 내 `throw` 시 동작
- `websearch` 정식 명칭 (`websearch` vs `web_search`)
## v0.13 조사 추가 섹션 (2026-04-18)

> 이 섹션은 기존 `external-opencode-hooks-tools.md`에 **append** 하기 위해 작성됨.
> 출처: sst/opencode `packages/plugin/src/index.ts` 소스 직접 확인 [P], GitHub 이슈 #5894·#7006·#21293 [S]

---

## 8. 핵심 훅 시그니처 — 소스 기반 확정판

> 기존 섹션 4의 내용을 소스 확인으로 보정. 이하가 **실제 타입**.

### tool.execute.before

```ts
"tool.execute.before": async (
  input: { tool: string; sessionID: string; callID: string },
  output: { args: any },
) => Promise<void>
```

- `input.args` **없음**. args는 `output.args`에 있음 — 기존 메모 오류 수정.
- `output.args`는 **reference 전달**. 뮤테이션이 실제 실행에 반영됨 (trigger 구현: `for (const hook of hooks) fn(input, output)` → 동일 output 객체 순차 전달).
- `throw new Error(...)` 시 도구 실행 차단. 사용자에게는 error.message가 표시됨 (이슈 #5894 재현 코드 확인).

### tool.execute.after

```ts
"tool.execute.after": async (
  input: { tool: string; sessionID: string; callID: string; args: any },
  output: { title: string; output: string; metadata: any },
) => Promise<void>
```

### chat.params — messages/system 수정 불가 확정

```ts
"chat.params": async (
  input: { sessionID: string; agent: string; model: Model; provider: ProviderContext; message: UserMessage },
  output: { temperature: number; topP: number; topK: number; maxOutputTokens: number | undefined; options: Record<string, any> },
) => Promise<void>
```

output에 `messages`, `system` 필드 **없음**. 컨텍스트 주입 불가. temperature 등 숫자 파라미터만.

### chat.message — LLM 호출 전이 아님

```ts
"chat.message": async (
  input: { sessionID: string; agent?: string; model?: { providerID: string; modelID: string }; messageID?: string; variant?: string },
  output: { message: UserMessage; parts: Part[] },
) => Promise<void>
```

`output.message` 수정이 LLM 요청에 반영되는지는 소스 미확인 — 시그니처상 가능하나 검증 필요. 이슈 #17637에서 "chat.message는 system.transform **이후** 발화"로 확인됨. 즉 발화 순서: `system.transform` → `messages.transform` → `chat.params` → `chat.headers` → LLM 호출 → `chat.message`.

### experimental.chat.system.transform

```ts
"experimental.chat.system.transform": async (
  input: { sessionID?: string; model: Model },
  output: { system: string[] },
) => Promise<void>
```

- `output.system` 배열에 push/splice로 시스템 프롬프트 수정. LLM 호출 **직전** 발화.
- `input`에 현재 사용자 메시지 텍스트 없음 — 이슈 #17637 feature request (2026-04 기준 미반영).
- Claude Code의 `additionalContext`에 가장 근접한 메커니즘.

### experimental.chat.messages.transform

```ts
"experimental.chat.messages.transform": async (
  input: {},
  output: { messages: { info: Message; parts: Part[] }[] },
) => Promise<void>
```

- `input`이 빈 객체 `{}` — sessionID도 없음. 메시지 배열 전체 재구성 가능.
- LLM 호출 직전 발화 (실험적).

### permission.ask

```ts
"permission.ask": async (
  input: Permission,
  output: { status: "ask" | "deny" | "allow" },
) => Promise<void>
```

---

## 9. 훅 실행 메커니즘 — trigger 구현

소스(`packages/opencode/src/plugin/index.ts`) 직접 확인:

```ts
for (const hook of s.hooks) {
  const fn = hook[name] as any
  if (!fn) continue
  yield* Effect.promise(async () => fn(input, output))
}
return output
```

- 모든 플러그인의 동일 훅이 **등록 순서대로 순차 실행**.
- **동일 output 객체**를 모든 플러그인이 공유 → 앞 플러그인의 수정이 뒤 플러그인에 보임.
- 실행 순서: INTERNAL_PLUGINS (내장) → global plugins → project plugins (설정 파일 순).
- 한 플러그인이 `throw`하면 이후 플러그인은 실행되지 않음 (Effect.promise 에러 전파).

---

## 10. subagent hook 발화 — #5894 최종 상태 (확정)

이슈 #5894: **2025-03-14경 자동 close** (90일 비활성). **fix 되지 않음**.

collaborator 코멘트 요약:
- 서브에이전트는 별도 세션에서 실행되며 plugins는 **Instance별로 로드**됨 → 서브에이전트 도구에도 hook이 발화함.
- 단, 서브에이전트가 `bash` 도구로 `grep/glob`을 **셸 명령으로** 실행하면 `tool.execute.before`는 `tool: "bash"`만 봄 — `grep`/`glob`으로 보이지 않음.
- **진짜 미해결 버그**: `batch` 툴은 `tool.execute()` 직접 호출 → hook bypass. `prompt.ts`에 중앙화되지 않은 invoke 로직 여러 곳 (TODO 코멘트 존재).

**결론**: subagent의 네이티브 툴 직접 호출은 hook 발화함. bash 경유 시 발화 안 됨 (의도적 동작). batch 툴은 bypass (버그).

---

## 11. permission.ask 미발화 — #7006 최종 상태

- **이슈 #7006**: OPEN (2026-04 기준). `PermissionNext.ask()`에서 `Plugin.trigger("permission.ask", ...)` 호출 누락.
- **PR #19453** (anomalyco/opencode fork): OPEN. `permission.ask` 훅 복구 + bash 명령 전체를 metadata에 추가. sst/opencode **main에 미병합**.

`tool.execute.before`의 `throw`는 권한 다이얼로그를 **트리거하지 않음** — 단순 도구 실행 차단. 사용자에게 error message만 표시.

---

## 12. Plugin child_process.spawn 이슈 — #21293

### 이슈 보고 내용
- OPEN (2026-04 기준), label: core, **댓글 0개**, maintainer 응답 없음, 단일 보고
- 보고 환경: opencode v1.3.10, **Debian Linux**, plugin `@cortexkit/aft-opencode@0.9.1` (AFT Rust 바이너리)
- 보고 증상: `spawn()` + `stdin.write()` 후 child(`aft`)가 `unix_stream_data_wait`로 30초 hang
- 보고자 의심: Go 내장 JS 런타임의 stdin buffer flush 문제
- Bun/Node.js 단독 실행에서는 정상이라고 보고

### 직접 검증 결과 (2026-04-18)
**환경**: macOS Darwin 25.3.0, opencode v1.4.7, node v24.13.1

3 시나리오 모두 **정상 동작 확인**:

| 시나리오 | payload | 결과 | 소요 |
|---|---|---|---|
| short-lived: write→end→exit | small (37 bytes) | child stdin 정상 수신, exit 0 | ~35ms |
| 큰 페이로드: write→end→exit | 10KB | TOTAL_BYTES=10240, exit 0 | ~36ms |
| 큰 페이로드: write→end→exit | 100KB | TOTAL_BYTES=102400, exit 0 | ~31ms |
| **persistent bridge** (보고자 시나리오 재현): write→read echo→write→read echo→end | per-line | 3 echoes 정상 수신, exit 0 | ~36ms |

검증 plugin: `/tmp/opencode-spawn-test/.opencode/plugins/spawn-test.ts` (`chat.params` hook 발화 시 spawn 테스트). child는 `node child.js` 실행.

### 결론
**이슈는 우리 환경에서 재현 불가**. 가능성:
- v1.3.10 → 1.4.7 사이 fix됨 (release notes 미확인이지만 가장 가능성 높음)
- Linux/Debian platform 한정 버그 (Go의 platform별 spawn 구현 차이)
- 보고자 환경 특이성 (AFT 바이너리 자체 또는 plugin 코드)

### nexus-core 영향
- macOS / opencode 1.4.7+ 환경에서 `mountHooks`의 spawn 패턴(short-lived: write→end→exit) **안전**
- C안 OpenCode 통합 가정 유효
- **미검증**: Linux 환경 — sister project consumer 또는 CI에서 검증 필요

---

## 14. session.idle 차단·재호출 의미론 — 실험 검증 (2026-04-18)

**환경**: macOS, opencode 1.4.7

| 측면 | 결과 |
|---|---|
| `session.idle.properties.sessionID` | **있음** (메모리 §2-2 카탈로그에서 누락 정정) |
| Bus event hook의 `throw` (session.idle 시점) | **silent — opencode 정상 종료, error 표시 없음, LLM 재호출 안 됨** |
| Bus event hook 자체의 차단 능력 | 없음 (메모리 §5 "관찰 전용"과 일치) |
| `chat.message`는 LLM 호출 직후 발화 | 확인 (한 번 발화 — sessionID로 user/assistant 구분 가능) |

### nexus-core 영향

- nexus 표준 `Stop` 이벤트의 OpenCode 매핑 = `session.idle` (Bus event)
- 컨텍스트 주입은 가능: plugin 전역 state 저장 → 다음 `experimental.chat.system.transform` 발화 시 `output.system.push`
- **차단(decision: block의 "Claude 계속 실행" 등가)은 불가** — OpenCode 아키텍처상 session.idle 후 사용자 입력 없이 LLM 재호출 메커니즘 없음
- claude-nexus Stop의 "pending tasks 있으니 계속 응답하라" 패턴은 OpenCode에선 "다음 turn에서 알림" 으로 약화됨 (실제 opencode-nexus도 Stop 등가 hook 사용 안 함, UserPromptSubmit/chat.system.transform에서 검증)

## 13. 컨텍스트 주입 우회 경로 — 실험 검증 (2026-04-18)

**환경**: macOS Darwin 25.3.0, opencode 1.4.7, node v24.13.1

### 실험 결과

메모리 §8에서 "`chat.message` output 수정이 LLM 요청에 반영되는지 미확인"이라고 했던 부분 + #13574 UI 미반영 버그와 LLM-side 반영 여부 구분 필요 → 직접 plugin 작성 후 LLM 응답으로 검증.

| 훅 | 수정 방식 | LLM 반영 | 비고 |
|---|---|---|---|
| `tool.execute.after` | `output.output` 문자열 append | **✓ 반영됨** | LLM이 수정된 tool output을 정확히 인용하며 "hook이 append한 것 같다"고 메타-인지까지 함. UI 미반영 #13574와 **별개** — LLM-side 파이프라인은 정상 |
| `experimental.chat.messages.transform` | `output.messages.push({ role, parts })` | **✓ 반영됨** | 주입된 message를 LLM이 "follow-up injected marker"로 인식. messages 배열 수정이 실제 LLM 요청 body에 그대로 반영 |
| `experimental.chat.system.transform` | `output.system.push(text)` | (응답 상 미언급, length 증가만 확인) | 매 LLM 호출 직전 반복 발화 |

### PostToolUse 시점 컨텍스트 주입 — 두 경로 확보

1. **직접 경로 (권장)**: `tool.execute.after`에서 `output.output`에 컨텍스트 append. tool 결과의 일부로 LLM에 전달됨. semantic이 명확 (tool 출력의 확장).
2. **지연 주입**: plugin 전역 state에 PostToolUse 시점 기록 → 다음 `experimental.chat.messages.transform` 발화 시 messages 배열에 user/assistant role로 push. 범용이지만 semantic이 tool result와 분리됨.

### 추가 확인 사항

- `experimental.chat.messages.transform`의 `input`은 정말 `{}` (`Object.keys = []`). sessionID 없음 확정. 세션 구별은 plugin 전역 state + 다른 훅(`tool.execute.after`의 `input.sessionID`)에서 미리 매핑해야 함.
- `chat.messages.transform`은 **매 LLM 호출 직전 발화** — 도구 호출 중간에도 반복. 지연 주입 버퍼는 한 번 쓰고 비워야 함 (중복 주입 방지).
- `chat.message`는 LLM 응답 **이후** 발화 (메시지 stream이 끝난 시점). 주입 경로로 부적합.

### nexus-core 영향

`output.additional_context.post_tool` capability → OpenCode 기술적으로 가능 (단 `tool.execute.after` 메커니즘으로 우회).

**그러나 실제 use case 검증 (2026-04-18, sister project 분석)**:
- claude-nexus `handlePostToolUse` (gate.cjs:573) — tool-log.jsonl append만, `additionalContext` 반환 안 함
- opencode-nexus `tool.execute.after` (plugin/hooks.ts:222) — memory access tracking + delegation tracker, 컨텍스트 주입 안 함
- 즉 3 sister project 모두 PostToolUse 시점 컨텍스트 주입 패턴 미사용

→ **우회 메커니즘 존재 사실은 보존하되, 표준 capability matrix에 `output.additional_context.post_tool` 채택 가치 낮음 (YAGNI)**. 미래 use case 발생 시 추가.

### 3 sister project 컨텍스트 주입 시점 사용 현황 (참조)

| 시점 | claude-nexus | opencode-nexus | 비고 |
|---|---|---|---|
| SessionStart | ✓ (gate.cjs handleSessionStart 외) | ✓ (chat.system.transform onboarded check) | 가장 일반적 |
| UserPromptSubmit | ✓ (mode 감지 + state 알림) | ✓ (chat.system.transform notice 빌드) | 핵심 라우팅 |
| SubagentStart | ✓ (buildCoreIndex 주입) | (확인 필요 — task tool wrapper) | 코어 메모리 인덱스 전달 |
| Stop | ✓ (pending tasks 알림) | (확인 필요) | run cycle 마무리 유도 |
| PreCompact / PostCompact | ✓ (시점만 사용) | `experimental.session.compacting` 사용 | 컨텍스트 보존 |
| PostToolUse | ✗ (side effect만) | ✗ (side effect만) | **컨텍스트 주입 미사용** |
| PreToolUse | ✗ (gate/permission만) | ✗ (gate만) | 컨텍스트 주입보다 차단 용도 |

## 확인 불가 (업데이트)

- `experimental.chat.messages.transform` `input: {}` 가 의도적 설계인지 미완성인지 (실험상 sessionID 없음 확정, 설계 의도 미확인)
- batch 툴 hook bypass 수정 PR 존재 여부
- `tool.execute.before` `throw` 시 error.message 노출 형식 (TUI 표시 포맷)
- `tool.execute.after`에서 `output.title` · `output.metadata` 수정의 LLM 반영 여부 (실험은 `output.output`만 검증)
- PreToolUse 전(`tool.execute.before`)에서 tool args 수정이 tool 실행뿐 아니라 **LLM이 인식하는 tool call 내용**에도 반영되는지

## Skill 도구 args 형식 (v0.13 조사)

> 출처: [opencode.ai/docs/skills/](https://opencode.ai/docs/skills/) [P], [github.com/sst/opencode skill.ts](https://github.com/sst/opencode/blob/dev/packages/opencode/src/tool/skill.ts) [P]

### tool 스키마 (TypeScript / Zod)

OpenCode `skill` 툴의 Zod 파라미터 정의:

```typescript
const Parameters = z.object({
  name: z.string().describe("The name of the skill from available_skills"),
})
```

- 파라미터: `name` (string, required)
- `args` 파라미터: **없음** (소스 확인)
- 호출 예: `skill({ name: "git-release" })`

### args 전달 방식

OpenCode는 SKILL.md `$ARGUMENTS` 치환을 **확인 불가** — 공식 docs에 명시 없음.  
Agent Skills 표준(agentskills.io)을 준수하나, args placeholder 지원은 구현체마다 다름.

| 항목 | 상태 |
|---|---|
| `name` 파라미터 | 확정 (소스 확인) |
| `args` / `input` 추가 파라미터 | 없음 (소스 확인) |
| `$ARGUMENTS` placeholder 치환 | **확인 불가** (공식 docs 미명시) |

### nexus-core 영향

- OpenCode Skill 호출은 `skill({ name: "nx-plan" })` 형태가 전부
- args 전달이 필요한 경우 SKILL.md body 내 동적 치환에 의존해야 하나, 동작 보장 없음
- 안전한 설계: args를 SKILL.md 내에 기본값으로 내장하거나, args-free 방식으로 설계

## 15. Subagent resume 메커니즘 (2026-04-18 OpenCode 소스 직접 확인 — 정정판)

**기존 §15 기재의 `resume_task_id` 필드명·"매 resume마다 새 task_id 할당" 설명은 오류**. OpenCode `packages/opencode/src/tool/task.ts` 소스 직접 확인 결과로 정정.

### 공식 파라미터 스키마

```ts
// packages/opencode/src/tool/task.ts
{
  subagent_type: string,
  prompt: string,
  description: string,
  task_id?: string,      // ← 공식 파라미터명, optional
}
```

Zod 스키마 설명:
> "This should only be set if you mean to resume a previous task (you can pass a prior task_id and the task will continue the same subagent session as before instead of creating a fresh one)"

**`resume_task_id`는 opencode-nexus의 비공식 관행명**, 공식은 `task_id`.

### 핵심 의미

`task_id` = **subagent session ID** (`nextSession.id`). task invocation 단위 ID가 아닌 **session 단위 ID**.

```ts
// task.ts 실제 로직
const taskID = params.task_id;
const session = taskID
  ? yield* sessions.get(SessionID.make(taskID)).pipe(
      Effect.catchCause(() => Effect.succeed(undefined))
    )
  : undefined;
const nextSession = session ?? (yield* sessions.create({ parentID: ctx.sessionID, ... }));

// 출력
output: [
  `task_id: ${nextSession.id} (for resuming to continue this task if needed)`,
  ...
].join("\n")
```

### 체인 시나리오 해석 (T1 → T2 → T3)

```
T1: task({subagent_type:"X", prompt:"..."})
  → 새 session S1 생성
  → 반환 task_id = S1

T2: task({subagent_type:"X", task_id:"S1", prompt:"..."})
  → 기존 S1 session 재사용 (sessions.get(S1) 성공)
  → 같은 S1에 메시지 append
  → 반환 task_id = S1  (동일)

T3: task({subagent_type:"X", task_id:"S1", prompt:"..."})
  → 기존 S1 재사용
  → 반환 task_id = S1  (동일)
```

**task_id는 invocation마다 변하지 않음**. "T1 task_id vs T2 task_id" 구분 자체가 없음. 체인의 모든 invocation이 동일 S1 ID로 접근.

### 컨텍스트 복원 범위

`runLoop(sessionID)`에서 `MessageV2.filterCompactedEffect(sessionID)`로 해당 session의 **전체 메시지 이력** 로드. compaction 없으면 full history, 있으면 summary + 이후.

즉 T1 시점에 "ALPHA"를 저장하고 T2에서 "BETA"를 저장했다면, 이후 어느 호출에서 `task_id:"S1"`로 resume하면 ALPHA/BETA 둘 다 포함된 컨텍스트로 subagent가 시작.

### 출처 (primary — source 직접 확인)

- `packages/opencode/src/tool/task.ts` — Zod 스키마 + `nextSession.id` 출력 로직
- `packages/opencode/src/session/session.ts` — `sessions.get/create`
- `packages/opencode/src/session/prompt.ts` — `runLoop`
- `packages/opencode/src/session/message-v2.ts` — `filterCompactedEffect(sessionID)`

### nexus-core 영향 (정정)

- nexus 표준 `agent_id` = OpenCode **task_id = subagent session_id**. **resume해도 불변** — Claude/Codex와 동일 불변성 보장
- mountHooks가 `tool.execute.after`의 `output.metadata.sessionId`를 agent_id로 주입 (단순)
- α/β(root vs latest) 딜레마 **존재하지 않음** — task_id 자체가 불변
- opencode-nexus의 `resume_task_id` 필드 사용은 비공식 별칭 — 내부에선 `task_id`로 통일 권장

### 공식 docs 공백

`opencode.ai/docs/tools/`, `opencode.ai/docs/agents/`에 `task_id` 파라미터 설명 **없음**. `task.txt` 프롬프트 텍스트와 Zod describe만 출처. 동작은 소스로 확정.

### 실험 검증 (2026-04-18)

4회 연속 task 호출로 chain 동작 확인:

| 호출 | task_id 입력 | ALPHA/BETA 기억 | 반환 task_id |
|---|---|---|---|
| 1 (fresh) | 없음 | — | `ses_25f13fd9dffe16...` (= T1) |
| 2 | T1 | ALPHA, BETA 둘 다 | **T1과 동일** |
| 3 | T1 (재입력) | ALPHA, BETA 둘 다 (STEP2 결과 포함) | **T1과 동일** |
| 4 | T1 (STEP2 이후 조회) | ALPHA, BETA 둘 다 | **T1과 동일** |

**확정 결론**:
- task_id는 subagent session ID — 세션 생성 시 1회 할당, 이후 모든 resume 호출에서 동일 ID 반환
- session은 **linear, not forkable** — "T1 시점 상태로 되돌려 resume" 불가능, 매 호출마다 session에 메시지 누적
- "T1 vs T2 task_id"의 개념적 구분 없음 — invocation 단위 체크포인트 ID가 OpenCode에 존재하지 않음
