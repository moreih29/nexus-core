# Claude Code 플러그인 구조

> Anthropic 공식 — Claude Code 플러그인 설치·로딩 규약. 출처: [Plugins reference](https://code.claude.com/docs/en/plugins-reference) · [Plugin marketplaces](https://code.claude.com/docs/en/plugin-marketplaces)

## 1. 설치 스코프

설정 파일 기준 4종. 기본은 `user`.

| 스코프 | 설정 파일 | 적용 |
|---|---|---|
| user (기본) | `~/.claude/settings.json` | 모든 프로젝트 |
| project | `.claude/settings.json` | 팀 공유, git 커밋 |
| local | `.claude/settings.local.json` | 프로젝트 전용, gitignore |
| managed | 관리형 (읽기 전용) | 조직 강제 |

설치된 플러그인 본체는 캐시로 복사: `~/.claude/plugins/cache/<marketplace>/<plugin>/<version>/`. `CLAUDE_CODE_PLUGIN_CACHE_DIR`로 위치 변경 가능.

## 2. 디렉토리 레이아웃

```
my-plugin/
├── .claude-plugin/plugin.json   # 매니페스트 (선택)
├── skills/<name>/SKILL.md
├── commands/*.md
├── agents/*.md
├── hooks/hooks.json
├── monitors/monitors.json
├── bin/                         # PATH 추가
├── output-styles/
├── .mcp.json
├── .lsp.json
└── settings.json
```

`skills/`, `agents/`, `commands/`, `hooks/`는 **반드시 플러그인 루트**에 위치. `.claude-plugin/` 내부에 두면 인식 안 됨.

## 3. 매니페스트

`.claude-plugin/plugin.json`. 매니페스트 자체는 선택(없으면 자동 탐색). 유일한 필수 필드는 `name` (kebab-case).

핵심 필드: `name` · `version`(semver, 업데이트 감지용) · `description` · `author` · `repository` · `dependencies` · `userConfig`(설치 시 입력 요청). 기본 자산 경로(`skills`, `agents`, `hooks`, `mcpServers`, `lspServers`, `monitors`)도 재정의 가능.

## 4. 배포 메커니즘

마켓플레이스(`marketplace.json` 카탈로그)를 통한 배포가 표준. 소스 5종:

| 소스 | 명세 |
|---|---|
| 로컬 | `"./plugins/my-plugin"` (마켓플레이스 저장소 상대) |
| github | `{source:"github", repo:"owner/repo", ref:"v1.0"}` |
| url | `{source:"url", url:"..."}` |
| git-subdir | `{source:"git-subdir", url:"...", path:"..."}` |
| npm | `{source:"npm", package:"@org/plugin", version:"1.0.0"}` |

개발 중에는 `claude --plugin-dir ./my-plugin`으로 마켓플레이스 없이 로드.

## 5. 캐시·상태 위치

- 플러그인 캐시: `~/.claude/plugins/cache/<marketplace>/<plugin>/<version>/`
- 영속 데이터: `~/.claude/plugins/data/<plugin-id>/` (`$CLAUDE_PLUGIN_DATA`)
- 마켓플레이스 등록: `~/.claude/plugins/known_marketplaces.json`
- 구 버전: 업데이트/삭제 7일 후 자동 정리 (실행 중 세션 호환성 목적)

## 6. nexus-core 시사점

- 공통 자산이 플러그인 디렉토리 **외부**에 있으면 캐시 복사 시 접근 불가 → symlink 또는 npm source로 패키징해야 함.
- 버전 비교 기준은 `plugin.json`의 `version`. 마켓플레이스 측과 양쪽 명시 시 plugin.json이 우선.

## 확인 불가

- npm 패키지로 배포되는 플러그인의 `node_modules` 해결 시점.
- 마켓플레이스 없이 `npm install`만으로 설치하는 공식 지원 여부.
