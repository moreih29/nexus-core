# OpenCode 플러그인 구조

> sst/opencode 공식 — OpenCode 플러그인 설치·로딩 규약. 출처: [Plugins](https://opencode.ai/docs/plugins/) · [Agents](https://opencode.ai/docs/agents/) · [Commands](https://opencode.ai/docs/commands/) · [Config](https://opencode.ai/docs/config/)

## 1. 설치 스코프

글로벌·프로젝트 양쪽 지원. 로드 순서: 글로벌 설정 → 프로젝트 설정 → 글로벌 플러그인 → 프로젝트 플러그인.

| 스코프 | 경로 |
|---|---|
| 글로벌 | `~/.config/opencode/` |
| 프로젝트 | `<project>/.opencode/` |

훅은 모두 순서대로 실행됨.

## 2. 디렉토리 레이아웃

각 스코프 루트 내부:

```
.opencode/                 (또는 ~/.config/opencode/)
├── plugins/               # JS/TS 플러그인 파일
├── agents/                # 에이전트 정의 .md
├── commands/              # 커맨드 정의 .md
├── skills/
├── tools/                 # 커스텀 도구
├── modes/
├── themes/
├── opencode.json          # 메인 설정
└── package.json           # 외부 npm 의존성 선언 (선택)
```

단수형(`agent/`, `command/`)도 하위 호환 인식.

## 3. 메타 파일

**`opencode.json`** — 메인 설정. npm 플러그인 등록:

```json
{ "plugin": ["opencode-helicone-session", "@my-org/custom-plugin"] }
```

**`package.json`** — 로컬 플러그인이 외부 npm 패키지를 의존할 때 선언. OpenCode가 시작 시 `bun install` 자동 실행.

## 4. 배포 메커니즘

3 방식:

- **npm 패키지** — `opencode.json`의 `plugin` 배열에 패키지명 기재 → Bun이 시작 시 자동 설치. 캐시: `~/.cache/opencode/node_modules/`
- **로컬 파일** — `plugins/` 디렉토리에 파일 배치 → 시작 시 자동 로드
- **CLI** — `opencode agent create` 등 대화형 명령 (플러그인 직접 등록 CLI는 미확인)

## 5. 자산 정의 형식

**에이전트** — 두 방식:
- `agents/<name>.md` — YAML frontmatter + 본문. 필수: `description` · `mode`(`primary`|`subagent`|`all`). 선택: `model` · `prompt` · `temperature` · `tools` · `steps`. 파일명이 ID.
- `opencode.json`의 `agent` 객체 — JSON 인라인, `{file:./path}` 참조 가능.

**커맨드** — `commands/<name>.md`. frontmatter 필수: `template`. 선택: `description` · `agent` · `subtask` · `model`. 본문에서 `$ARGUMENTS` · `$1..N` · `` !`cmd` `` · `@filename` 삽입 가능.

**플러그인 코드** — JS/TS 모듈, 훅 함수 반환:

```ts
export const MyPlugin = async ({ project, client, $, directory, worktree }) => ({
  "session.created": async (event) => { ... },
  "tool.execute.before": async (event) => { ... },
})
```

## 6. nexus-core 시사점

- **npm 배포** → 컨슈머 `opencode.json`의 `plugin` 배열에 패키지명 추가. Bun 자동 설치.
- **또는 로컬** → `.opencode/plugins/` 또는 `~/.config/opencode/plugins/`에 직접 배치.
- 에이전트·커맨드는 `.opencode/agents/`, `.opencode/commands/`의 `.md` 파일로 배포하거나 플러그인 코드의 훅에서 동적 제공.

## 확인 불가

- 플러그인 npm 패키지 자체의 진입점 규약(`main` 외 별도 메타).
- git 기반 설치, `opencode plugin install` 등의 등록 커맨드.
