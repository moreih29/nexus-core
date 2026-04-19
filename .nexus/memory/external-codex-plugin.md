# OpenAI Codex CLI 플러그인 구조

> openai/codex 공식 — Codex CLI 플러그인·확장 규약. 출처: [Plugins](https://developers.openai.com/codex/plugins) · [Build plugins](https://developers.openai.com/codex/plugins/build) · [Agent Skills](https://developers.openai.com/codex/skills) · [Custom Prompts](https://developers.openai.com/codex/custom-prompts) · [Slash commands](https://developers.openai.com/codex/cli/slash-commands) · [Config basics](https://developers.openai.com/codex/config-basic) · [Config reference](https://developers.openai.com/codex/config-reference) · [MCP](https://developers.openai.com/codex/mcp) · [AGENTS.md](https://developers.openai.com/codex/guides/agents-md)

## 0. 확장 메커니즘 4 레이어

Codex의 확장은 단일 시스템이 아님. 4 레이어가 병존:

| 레이어 | 위치 | 역할 |
|---|---|---|
| **A. Plugin (skill 단위)** | `.codex-plugin/plugin.json` | 마켓플레이스 등록 단위. Skills + MCP + Apps 묶음 |
| **B. Native agent (config 단위)** | `config.toml`의 `[agents.<name>]` + 외부 TOML | 진짜 spawn·nesting 가능한 멀티 에이전트 인프라 |
| **C. AGENTS.md** | `~/.codex/AGENTS.md` · 레포 루트 | 작업 시작 전 우선 로드되는 지침 |
| **D. Custom Prompts (deprecated)** | `~/.codex/prompts/*.md` | 슬래시 커맨드. Skills로 대체 권고 |

**중요**: A와 B는 **별도 시스템**. plugin spec만으로는 멀티 에이전트 표현 불가능 — B가 필요.

## 1. 시스템 존재

공식 플러그인 시스템 보유. CLI와 앱 UI 양쪽에서 설치·관리. 2025년 이후 공식 문서에 별도 섹션 존재.

## 2. 구성 요소 3종

| 유형 | 설명 |
|---|---|
| Skills | 재사용 가능한 작업 지침 집합 |
| Apps | GitHub · Slack · Google Drive 등 외부 연동 |
| MCP Servers | 로컬 외부 시스템 도구·정보 접근 |

## 3. 디렉토리 레이아웃

`.codex-plugin/plugin.json`을 진입점으로 하는 폴더 단위. **Skills가 단일 자산 컨테이너** — agent·command 개념이 모두 skill 안으로 흡수됨.

```
my-plugin/
├── .codex-plugin/plugin.json    # 필수 매니페스트
├── skills/
│   └── <skill-name>/
│       ├── SKILL.md             # YAML frontmatter (name, description) + 지침 본문
│       ├── scripts/             # CLI 스크립트
│       └── agents/openai.yaml   # UI 메타·호출 정책·툴 의존성 선언
├── .mcp.json                    # MCP 서버 설정 (선택)
├── .app.json                    # App/커넥터 매핑 (선택)
└── assets/                      # 아이콘·로고·스크린샷
```

**중요**: 플러그인 루트 직속 `agents/`, `commands/` 폴더는 **존재하지 않음**. `agents/openai.yaml`은 각 skill **내부**에 위치.

`plugin.json` 핵심 필드:
- 필수: `name` · `version` · `description`
- 선택: `skills` · `mcpServers` · `apps` (번들 컴포넌트 경로)
- UI: `interface.displayName` · `shortDescription`

## 3-1. Agent·Command 대응

다른 하네스의 자산 개념은 다음으로 매핑됨:

| 타 하네스 | Codex 대응 | 비고 |
|---|---|---|
| `agents/<name>.md` | `skills/<name>/agents/openai.yaml` | skill 내부 메타로 흡수 |
| `commands/<name>.md` | Skills 직접 호출 (`$skill-name`) | 별도 폴더 없음 |
| 슬래시 커맨드 | Custom Prompts (deprecated) → Skills 권고 | `~/.codex/prompts/*.md` |

**`~/.codex/prompts/`** — 슬래시 커맨드(`/prompts:draftpr`)로 호출되는 Markdown. 현재 **deprecated**, Skills로 대체 권고. 플러그인 단위 제공 불가(글로벌 영역만).

## 4. 설치 스코프

| 스코프 | 위치 | 마켓플레이스 카탈로그 |
|---|---|---|
| 글로벌 | `~/.codex/plugins/` | `~/.agents/plugins/marketplace.json` |
| 프로젝트 | `$REPO_ROOT/plugins/` 등 | `$REPO_ROOT/.agents/plugins/marketplace.json` |

MCP 서버 등록은 `~/.codex/config.toml`(글로벌) 또는 `.codex/config.toml`(프로젝트, 신뢰된 프로젝트만 적용)의 `[mcp_servers.<name>]` 테이블.

## 5. Native agent (config.toml 기반)

플러그인과 **별개 시스템**. Codex의 진짜 multi-agent 인프라.

### 5-1. 등록

`~/.codex/config.toml`(글로벌) 또는 `.codex/config.toml`(프로젝트)에 `[agents.<name>]` 테이블 추가:

```toml
[agents.my-agent]
config_file = "~/.codex/agents/my-agent.toml"
description = "역할 선택 및 spawn 시 Codex에 표시되는 지침"
nickname_candidates = ["alpha", "beta"]
```

| 키 | 의미 |
|---|---|
| `config_file` | TOML 설정 레이어 경로 (외부 파일) |
| `description` | 역할 선택·spawn 시 표시되는 지침 |
| `nickname_candidates` | spawn된 agent 표시 별칭 풀 |

### 5-2. 멀티 에이전트 제어

| 키 | 의미 |
|---|---|
| `agents.max_threads` | 동시 열린 agent 스레드 최대 |
| `agents.max_depth` | spawn 중첩 깊이 제한 |
| `agents.job_max_runtime_seconds` | `spawn_agents_on_csv` 작업자당 제한 시간 |

### 5-3. 한계

공식 문서는 `[agents.<name>]` **키 목록만** 명시. 외부 TOML 파일의 정확한 필드 구조(예: `instructions` · `model` · `reasoning_effort`)는 문서화 부족 — 일부 미문서 영역. 실제 구조는 사례 참조 필요.

## 6. AGENTS.md (별도 시스템)

플러그인·native agent와 별개. 작업 시작 전 우선 로드되는 지침 파일.

- 글로벌: `~/.codex/AGENTS.md` 또는 `~/.codex/AGENTS.override.md`
- 레포: 레포 루트 `AGENTS.md`

## 7. 배포 메커니즘

`marketplace.json`의 `plugins[].source.path`로 폴더 지칭. 지원 소스:

- 로컬 경로 (marketplace root 기준 상대)
- Git URL · GitHub
- 직접 `marketplace.json` URL

CLI: `codex plugins install` 또는 내장 `@plugin-creator` skill로 스캐폴딩.

## 8. nexus-core 시사점

- 각 플러그인 폴더 루트에 `.codex-plugin/plugin.json` 필수.
- 개인 사용: `~/.codex/plugins/` + `~/.agents/plugins/marketplace.json`.
- 팀/레포 공용: `$REPO_ROOT/.agents/plugins/marketplace.json` 등록 + 로컬 경로 참조.
- MCP 서버 제공 시 `config.toml`의 `[mcp_servers]` 병행 필요.
- `source.path`가 git·로컬 모두 지원 → nexus-core를 git submodule이나 로컬 경로 참조하는 형태가 현실적.
- **멀티 에이전트 표현은 plugin spec만으로 불가능** — native agent 레이어(§5) 병행 필수. 즉 install 시점에 `~/.codex/config.toml`의 `[agents.*]` 테이블 + 외부 TOML 파일을 함께 생성해야 함.

## 확인 불가

- npm·pip 등 패키지 매니저 기반 설치.
- Native agent 외부 TOML 파일의 정식 필드 명세 (공식 문서 부족).
