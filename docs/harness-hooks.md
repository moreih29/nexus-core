# 하네스 훅 권장

`@moreih29/nexus-core`가 각 하네스 컨슈머에게 구현을 권장하는 훅이다. 코어는 훅 런타임·manifest·설치 스크립트를 직접 제공하지 않는다. 컨슈머가 자신의 하네스에서 아래 역할을 와이어링한다.

훅이 맡는 역할은 세 가지다.

1. 세션 진입 시 `.nexus/` 폴더 구조와 `.gitignore` 화이트리스트 보장
2. 사용자 프롬프트에서 Nexus 태그(`[plan]`·`[auto-plan]`·`[run]`·`[m]`·`[m:gc]`·`[d]`) 감지해 스킬/지시 활성화
3. Nexus 규칙 위반 셸 명령 차단 (선택)

서브에이전트 lifecycle 추적이나 파일 편집 타임라인은 훅이 맡지 않는다. 재개 라우팅 메타(`agent_id`·`resume_tier`)는 Lead가 서브에이전트 스폰 시점에 얻은 id를 MCP 도구(`nx_plan_analysis_add`·`nx_task_update`)의 인자로 넘겨 `plan.json`·`tasks.json`에 기록한다. 이렇게 하면 세 하네스 모두 훅 기반 트래커 없이 동일한 재개 경로를 지원할 수 있다.

## 폴더 구조와 `.gitignore`

역할 (1)에서 보장해야 하는 구조:

```
.nexus/
├── .gitignore       # 화이트리스트 방식
├── context/         # 디자인 원칙·아키텍처 문서 (추적)
├── memory/          # 학습 내용·참조 (추적)
└── history.json     # cycle 아카이브 (추적, nx_task_close가 생성)
```

`.nexus/.gitignore`는 `state/` 같은 런타임 파일을 제외하고 정해진 것만 추적하는 화이트리스트로 둔다.

```gitignore
# Nexus: whitelist tracked files, ignore everything else
*
!.gitignore
!context/
!context/**
!memory/
!memory/**
!history.json
```

## Claude Code

### SessionStart — `.nexus/` 구조 보장

- 이벤트: `SessionStart`
- 동작:
  1. 프로젝트 루트의 `.nexus/` 디렉터리를 생성한다 (idempotent, `mkdir -p`).
  2. `.nexus/context/`, `.nexus/memory/`를 생성한다.
  3. `.nexus/.gitignore`가 없으면 위 §폴더 구조와 `.gitignore` 섹션의 화이트리스트 본문으로 생성한다. 이미 존재하면 건드리지 않는다.
  4. `history.json`·`state/` 하위 파일은 생성하지 않는다. 각 MCP 도구가 필요 시 생성한다.

### UserPromptSubmit — 태그 라우팅

- 이벤트: `UserPromptSubmit`
- 동작:
  1. 페이로드의 `prompt` 문자열에서 선두 태그 토큰을 파싱한다 (`[plan]`·`[auto-plan]`·`[run]`·`[m]`·`[m:gc]`·`[d]`).
  2. 매칭된 태그별로 `additionalContext`에 한 줄 지시를 주입한다.
     - `[plan]` → "nx-plan 스킬을 활성화하라"
     - `[auto-plan]` → "nx-auto-plan 스킬을 활성화하라"
     - `[run]` → "nx-run 스킬을 활성화하라"
     - `[m]` → "뒤따르는 본문을 `.nexus/memory/`에 저장하라"
     - `[m:gc]` → "`.nexus/memory/`를 정리(병합·제거)하라"
     - `[d]` → "활성 plan 세션의 현재 안건에 대한 결정을 `nx_plan_decide`로 기록하라"
  3. 상태 불일치(예: `[run]`인데 `tasks.json` 부재, `[d]`인데 활성 plan 세션 없음)는 `additionalContext`로 알리기만 하고 차단하지 않는다. 복구(auto-plan 자동 전환 등)는 스킬 본문이 담당한다.

### PreToolUse — Nexus 규칙 강제 (선택)

- 이벤트: `PreToolUse`
- matcher: `Bash`
- 동작:
  1. `tool_input.command`를 읽는다.
  2. Nexus 규칙 위반 패턴을 검사한다 (`nx-run` §4단계가 금지하는 `git add -A` 등).
  3. 위반 시 `permissionDecision:"deny"`를 반환하거나 `updatedInput`으로 명시 경로 버전으로 재작성한다.
- 일반 감사 로깅 목적으로는 권장하지 않는다.

### 제약

- plugin-shipped agent 파일에는 `hooks`, `mcpServers`, `permissionMode`를 직접 넣을 수 없다. 훅은 플러그인 루트 `hooks/hooks.json` 또는 사용자·프로젝트 `settings.json`에 둔다.

## OpenCode

### event: session.created — `.nexus/` 구조 보장

- 훅: `event` (`session.created` 구독)
- 동작:
  1. bus 페이로드에서 `session.parentID`(또는 동등 필드)를 읽는다.
  2. `parentID`가 없다 → 루트 세션이다. `.nexus/`·`.nexus/context/`·`.nexus/memory/`를 `mkdir -p`로 보장한다. `.nexus/.gitignore`가 없으면 §폴더 구조와 `.gitignore`의 화이트리스트 본문으로 생성한다.
  3. `parentID`가 있다 → 서브에이전트 child session이므로 아무 것도 하지 않는다. (서브에이전트 참여 기록은 Lead가 MCP로 처리한다.)

### chat.message — 태그 라우팅

- 훅: `chat.message`
- 동작:
  1. 사용자 메시지 본문에서 선두 태그 토큰을 파싱한다 (`[plan]`·`[auto-plan]`·`[run]`·`[m]`·`[m:gc]`·`[d]`).
  2. 매칭된 태그별로 메시지 변환 훅에서 메시지에 한 줄 지시를 덧붙인다 (Claude Code의 `additionalContext`와 동일 의미).
     - `[plan]` → "nx-plan 스킬 활성화"
     - `[auto-plan]` → "nx-auto-plan 스킬 활성화"
     - `[run]` → "nx-run 스킬 활성화"
     - `[m]` → "본문을 `.nexus/memory/`에 저장"
     - `[m:gc]` → "`.nexus/memory/` 정리"
     - `[d]` → "활성 plan 세션의 현재 안건에 대한 결정을 `nx_plan_decide`로 기록"

### tool.execute.before — Nexus 규칙 강제 (선택)

- 훅: `tool.execute.before`
- 대상: `bash`
- 동작:
  1. `args.command` 문자열을 읽는다.
  2. `git add -A` 같은 Nexus 규칙 위반 패턴에 매칭되면 `throw`로 실행을 중단한다.

### 제약

- `experimental.*` 훅은 기본 권장 세트에 넣지 않는다.

## Codex

### SessionStart — `.nexus/` 구조 보장

- 이벤트: `SessionStart`
- matcher: `source`에서 `startup` / `resume` 구분 가능하지만 동작은 동일하게 둔다 (idempotent이므로 resume 안전).
- 동작:
  1. 프로젝트 루트의 `.nexus/`·`.nexus/context/`·`.nexus/memory/`를 `mkdir -p`로 보장한다.
  2. `.nexus/.gitignore`가 없으면 §폴더 구조와 `.gitignore`의 화이트리스트 본문으로 생성한다.

### UserPromptSubmit — 태그 라우팅

- 이벤트: `UserPromptSubmit`
- 동작:
  1. 페이로드의 `prompt`에서 선두 태그 토큰을 파싱한다 (`[plan]`·`[auto-plan]`·`[run]`·`[m]`·`[m:gc]`·`[d]`).
  2. 매칭된 태그별로 `systemMessage`에 한 줄 지시를 주입한다. 내용은 Claude Code 섹션과 동일.
  3. 심각한 상태 위반 시에만 `decision:"block"`을 쓴다. 일반 안내는 차단하지 않는다.
  4. 주의: matcher가 없어 모든 프롬프트가 검사 대상이 된다.

### PreToolUse / PostToolUse — Bash 범위 내 Nexus 규칙 강제 (선택)

- 이벤트: `PreToolUse`, `PostToolUse`
- matcher: `Bash`
- 동작:
  1. `tool_input.command`를 읽는다.
  2. Nexus 규칙 위반 패턴(`git add -A` 등)에 매칭되면 `PreToolUse`에서 `permissionDecision:"deny"` 또는 `systemMessage` 경고로 차단한다.
  3. `PostToolUse`는 필요 시 후처리 알림에 쓴다.

### 훅으로 채우지 못하는 범용 정책은 TOML로

- 파일 쓰기 차단 → `sandbox_mode = "read-only"`
- MCP tool denylist → `[mcp_servers.<id>] disabled_tools`
- 오케스트레이션 범위 제한 → agent depth·thread 한도

### 제약

- `[features] codex_hooks = true`가 필요하다. 컨슈머 설치 문서에 전제로 적어야 한다.
- `continue`, `suppressOutput`, `permissionDecision:"allow|ask"` 등은 파싱만 되고 아직 미구현이다. 핵심 강제는 `systemMessage` + `decision:"block"` / `permissionDecision:"deny"` 조합이다.
- Windows 훅은 임시 비활성 상태다.

---

관련 문서:

- 에이전트·스킬 명세 동기화: [agent-skill-sync.md](./agent-skill-sync.md)
- MCP 서버 도구: [mcp-server-tools.md](./mcp-server-tools.md)
