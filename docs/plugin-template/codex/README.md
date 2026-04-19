# Codex Plugin Scaffold — nexus-core

이 디렉터리는 `nexus-core init --harness=codex` 명령으로 복사되는 Codex CLI 플러그인 스타터입니다.

## 개요

nexus-core가 공통 스킬·에이전트 자산을 이 플러그인 repo에 동기화(sync)합니다.
Codex 플러그인은 `.codex-plugin/plugin.json`을 진입점으로 하는 폴더 단위로 배포됩니다.

Codex의 멀티 에이전트 인프라는 **플러그인 시스템과 별개**입니다. 에이전트를 실제로 활성화하려면
install 시점에 `~/.codex/config.toml`의 `[agents.*]` 테이블과 TOML 파일을 user scope에 배치해야 합니다.

## 디렉터리 구조

```
my-codex-plugin/
├── plugin/                  # Plugin spec — 마켓플레이스 설치 단위
│   ├── .codex-plugin/
│   │   └── plugin.json      # Managed — nexus-core sync가 덮어씀
│   └── skills/              # Managed — nexus-core sync가 덮어씀
│       └── <skill-name>/
│           └── SKILL.md
├── agents/                  # Managed — native agent 설치 재료 (plugin spec 일부가 아님)
│   └── <agent-name>.toml    # install 명령이 ~/.codex/agents/로 복사
├── prompts/                 # Managed — 에이전트 프롬프트 Markdown
│   └── <agent-name>.md
├── install/
│   ├── config.fragment.toml # Managed — ~/.codex/config.toml에 병합할 스니펫
│   └── AGENTS.fragment.md   # Managed — AGENTS.md에 병합할 primary agent 프롬프트
├── package.json
└── .github/
    └── workflows/
        └── build.yml
```

**Managed** 경로는 `nexus-core sync`가 항상 최신 상태로 유지합니다.

> **Plugin spec vs. native agent 구분**
>
> Codex의 플러그인 시스템(`.codex-plugin/plugin.json` + `skills/`)과 native agent 시스템(`config.toml`의 `[agents.*]`)은 **별개**입니다.
>
> - `plugin/` 디렉터리: 마켓플레이스에 등록되는 plugin spec. `skills/<name>/SKILL.md`가 자산 컨테이너입니다.
>   플러그인 spec 상에 `agents/<name>.toml` 폴더는 존재하지 않습니다.
> - `agents/` 디렉터리: native agent 활성화용 TOML 파일. install 명령이 `~/.codex/agents/`로 복사하는 **설치 재료**입니다.
>   이 폴더의 파일은 plugin spec의 일부가 아닙니다.
>
> 에이전트를 실제로 활성화하려면 install 단계에서 `agents/*.toml`을 `~/.codex/agents/`에 배치하고,
> `config.fragment.toml`을 `~/.codex/config.toml`에 병합해야 합니다.

## 빠른 시작

### 1. 이 템플릿으로 새 플러그인 생성

```bash
bunx @moreih29/nexus-core init --harness=codex --target=./my-codex-plugin
cd my-codex-plugin
bun install
```

### 2. 자산 동기화

```bash
bunx @moreih29/nexus-core sync --harness=codex --target=./
```

동기화 후 생성되는 파일:

- `plugin/.codex-plugin/plugin.json` — 플러그인 매니페스트
- `plugin/skills/<name>/SKILL.md` × N
- `agents/<name>.toml` × N — `[agents.<id>]` 테이블 형식
- `prompts/<name>.md` × N — YAML frontmatter + 프롬프트 본문
- `install/config.fragment.toml` — `~/.codex/config.toml`에 병합할 스니펫
- `install/AGENTS.fragment.md` — `AGENTS.md`에 병합할 primary agent 프롬프트 (mode: primary agent 존재 시)

### 3. 변경 내용 커밋

```bash
git add plugin/ agents/ prompts/ install/
git commit -m "Sync nexus-core assets"
```

## 컨슈머 install 흐름

Codex 에이전트는 user scope(`~/.codex/`)에 직접 배치해야 활성화됩니다.
플러그인 repo의 install 명령(또는 스크립트)이 이 작업을 수행합니다.

```bash
# 예: install.sh
cat install/config.fragment.toml >> ~/.codex/config.toml
cp -r agents/ ~/.codex/agents/
```

`install/config.fragment.toml`에는 MCP 서버 등록이 포함됩니다.

```toml
[mcp_servers.nx]
command = "nexus-mcp"
```

**block-marker 패턴** 사용 권장: 기존 `~/.codex/config.toml`을 덮어쓰지 않고
`# BEGIN my-plugin` / `# END my-plugin` 마커 사이만 교체합니다.
oh-my-codex의 `omx setup` 패턴을 참고하세요.

## 플러그인 마켓플레이스 등록

`~/.agents/plugins/marketplace.json`에 GitHub 소스 또는 로컬 경로로 등록합니다.

```json
{
  "plugins": [
    {
      "source": {
        "type": "github",
        "repo": "your-org/my-codex-plugin",
        "ref": "v1.0.0",
        "path": "plugin"
      }
    }
  ]
}
```

## CLI 참조

```bash
bunx @moreih29/nexus-core sync --harness=codex --target=<dir>   # 자산 동기화
bunx @moreih29/nexus-core sync --harness=codex --dry-run        # 변경될 파일 목록만 출력 (쓰기 없음)
bunx @moreih29/nexus-core sync --harness=codex --force          # Template 경로 강제 덮어쓰기 확인
bunx @moreih29/nexus-core sync --harness=codex --strict         # Managed 파일의 미커밋 변경 시 오류
bunx @moreih29/nexus-core list                                   # 사용 가능한 에이전트·스킬 목록
```

전역 설치(`bun add -g @moreih29/nexus-core`) 환경에서는 `nexus-core <cmd>` 형태로도 사용할 수 있습니다.

## Lead Agent AGENTS.md 머지

sync 결과물 중 `install/AGENTS.fragment.md`는 Codex의 AGENTS.md 자동 로드 경로에 주입할 lead agent body를 포함합니다.

Codex는 main agent의 system prompt를 주입하는 공식 경로를 제공하지 않으므로, nexus-core는 이 fragment를 사용자의 `AGENTS.md`에 자동으로 병합하지 않습니다. consumer가 직접 fragment 내용을 `~/.codex/AGENTS.md`(글로벌) 또는 레포 루트 `AGENTS.md`(프로젝트)에 복사해야 합니다. 마커(`<!-- nexus-core:lead:start -->` / `<!-- nexus-core:lead:end -->`)를 포함해 복사해야 이후 업데이트 시 구역을 정확히 교체할 수 있습니다.

자세한 절차는 [`docs/consuming/codex-lead-merge.md`](../../consuming/codex-lead-merge.md)를 참조하세요.

## 주의사항

- `plugin/`, `agents/`, `prompts/`, `install/` 내 파일을 직접 편집하지 마세요. 다음 sync 시 덮어씁니다.
- Codex native agent의 외부 TOML 파일 필드 구조는 공식 문서에 일부 미기재 영역이 있습니다. 실제 동작은 Codex 공식 사례를 병행 확인하세요.
- npm 기반 Codex 플러그인 설치는 공식 지원 여부가 확인되지 않았습니다. 로컬 경로 또는 GitHub 소스 방식을 사용하세요.
