# Claude Code Plugin Scaffold — nexus-core

이 디렉터리는 `nexus-core init --harness=claude` 명령으로 복사되는 Claude Code 플러그인 스타터입니다.

## 개요

nexus-core가 공통 에이전트·스킬·훅 자산을 이 플러그인 repo에 동기화(sync)합니다.
플러그인 repo 저자는 동기화된 자산을 커스터마이즈하고 배포만 담당합니다.

## 디렉터리 구조

```
my-claude-plugin/
├── .claude-plugin/
│   ├── plugin.json          # 플러그인 매니페스트 (Template — 처음 한 번만 생성)
│   └── marketplace.json     # 마켓플레이스 카탈로그 (Template — 처음 한 번만 생성)
├── agents/                  # Managed — nexus-core sync가 덮어씀
│   └── <agent-name>.md
├── skills/                  # Managed — nexus-core sync가 덮어씀
│   └── <skill-name>/
│       └── SKILL.md
├── hooks/                   # nexus-core build-hooks가 생성 (sync 포함)
│   └── hooks.json
├── .mcp.json                # MCP 서버 설정 (수동 관리)
├── package.json
└── .github/
    └── workflows/
        └── build.yml
```

**Managed** 경로(`agents/`, `skills/`)는 `nexus-core sync`가 항상 최신 상태로 유지합니다.
**Template** 경로(`.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`)는 처음 한 번만 생성됩니다. 이후 편집 내용은 보존됩니다(`--force` 없이는 덮어쓰지 않음).

## 빠른 시작

### 1. 이 템플릿으로 새 플러그인 생성

```bash
bunx @moreih29/nexus-core init --harness=claude --target=./my-claude-plugin
cd my-claude-plugin
bun install
```

### 2. 자산 동기화

```bash
bunx @moreih29/nexus-core sync --harness=claude --target=./
```

동기화 후 생성되는 파일:

- `agents/<name>.md` × N
- `skills/<name>/SKILL.md` × N
- `.claude-plugin/plugin.json` (최초 생성 시)
- `.claude-plugin/marketplace.json` (최초 생성 시)

### 3. 변경 내용 커밋

```bash
git add agents/ skills/ .claude-plugin/ hooks/ .mcp.json
git commit -m "Sync nexus-core assets"
```

## 플러그인 매니페스트 커스터마이즈

`.claude-plugin/plugin.json`에서 플러그인 이름, 버전, 설명을 수정하세요.

```json
{
  "name": "my-claude-plugin",
  "version": "1.0.0",
  "description": "My Claude Code plugin powered by nexus-core"
}
```

`name`은 kebab-case여야 합니다. `version`은 Claude Code의 업데이트 감지에 사용됩니다.

## 배포

Claude Code 마켓플레이스에 배포하려면 마켓플레이스 카탈로그 저장소에 다음 형식으로 등록합니다.

```json
{
  "source": "github",
  "repo": "your-org/my-claude-plugin",
  "ref": "v1.0.0"
}
```

개발 중에는 `claude --plugin-dir ./`로 마켓플레이스 없이 로컬 로드할 수 있습니다.

## CLI 참조

```bash
bunx @moreih29/nexus-core sync --harness=claude --target=<dir>   # 자산 동기화
bunx @moreih29/nexus-core sync --harness=claude --dry-run        # 변경될 파일 목록만 출력 (쓰기 없음)
bunx @moreih29/nexus-core sync --harness=claude --force          # Template 파일도 강제 덮어쓰기
bunx @moreih29/nexus-core sync --harness=claude --strict         # Managed 파일의 미커밋 변경 시 오류
bunx @moreih29/nexus-core sync --harness=claude --only=<name>    # 특정 에이전트/스킬만 동기화
bunx @moreih29/nexus-core list                                    # 사용 가능한 에이전트·스킬·훅 목록
bunx @moreih29/nexus-core validate                                # 자산 frontmatter 및 YAML 검증
```

전역 설치(`bun add -g @moreih29/nexus-core`) 환경에서는 `nexus-core <cmd>` 형태로도 사용할 수 있습니다.

## 주의사항

- `agents/`, `skills/` 내 파일을 직접 편집하지 마세요. 다음 sync 시 덮어씁니다.
- 플러그인 전용 커스텀 에이전트는 `agents/` 외 별도 경로에 두고 `plugin.json`에서 참조하세요.
- `.claude-plugin/plugin.json`의 `name` 필드 변경 시 마켓플레이스 등록과 일치해야 합니다.
