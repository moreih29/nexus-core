# OpenCode Plugin Scaffold — nexus-core

이 디렉터리는 `nexus-core init --harness=opencode` 명령으로 복사되는 OpenCode 플러그인 스타터입니다.

## 개요

nexus-core가 공통 에이전트·스킬 자산을 이 플러그인 repo에 동기화(sync)합니다.
OpenCode 플러그인은 npm 패키지로 배포되며, 컨슈머의 `opencode.json`에 패키지명을 등록하면
OpenCode가 시작 시 자동으로 설치·로드합니다.

## 디렉터리 구조

```
my-opencode-plugin/
├── src/
│   ├── index.ts             # Managed — nexus-core sync가 덮어씀 (에이전트 re-export)
│   └── agents/              # Managed — nexus-core sync가 덮어씀
│       └── <agent-name>.ts
├── .opencode/
│   └── skills/              # Managed — nexus-core sync가 덮어씀
│       └── <skill-name>/
│           └── SKILL.md
├── opencode.json.fragment   # Managed — opencode.json 병합용 에이전트 목록 스니펫
├── package.json             # Template — 처음 한 번만 생성
├── tsconfig.json            # 직접 관리
└── .github/
    └── workflows/
        └── build.yml
```

**Managed** 경로(`src/`, `.opencode/skills/`, `opencode.json.fragment`)는 `nexus-core sync`가 항상 최신 상태로 유지합니다.
**Template** 경로(`package.json`)는 처음 한 번만 생성됩니다.

## 빠른 시작

### 1. 이 템플릿으로 새 플러그인 생성

```bash
bunx @moreih29/nexus-core init --harness=opencode --target=./my-opencode-plugin
cd my-opencode-plugin
bun install
```

### 2. 자산 동기화

```bash
bunx @moreih29/nexus-core sync --harness=opencode --target=./
```

동기화 후 생성되는 파일:

- `src/index.ts` — 에이전트 전체 re-export
- `src/agents/<name>.ts` × N — 각 에이전트 `AgentConfig` 객체
- `.opencode/skills/<name>/SKILL.md` × N
- `opencode.json.fragment` — 컨슈머 `opencode.json`에 병합할 `agents` 배열 스니펫

### 3. 변경 내용 커밋

```bash
git add src/ .opencode/ opencode.json.fragment
git commit -m "Sync nexus-core assets"
```

## 컨슈머 설치 안내

플러그인을 사용하는 프로젝트의 `.opencode/opencode.json`에 패키지명을 추가합니다.

```json
{
  "plugin": ["@your-org/my-opencode-plugin"]
}
```

OpenCode가 시작 시 Bun으로 자동 설치합니다. 캐시 위치: `~/.cache/opencode/node_modules/`.

에이전트를 활성화하려면 `opencode.json.fragment`의 내용을 컨슈머의 `opencode.json`에 병합하거나,
`postinstall` 스크립트로 자동화하세요.

```json
{
  "agents": [
    {
      "id": "architect",
      "module": "./node_modules/@your-org/my-opencode-plugin/src/agents/architect.js"
    }
  ]
}
```

## package.json 커스터마이즈

`package.json`의 `name`과 `version`을 실제 npm 패키지명으로 변경하세요.

```json
{
  "name": "@your-org/my-opencode-plugin",
  "version": "1.0.0",
  "type": "module",
  "main": "./src/index.ts"
}
```

`"type": "module"`과 `"main": "./src/index.ts"`는 OpenCode가 TypeScript를 직접 로드하므로 변경하지 마세요.

## CLI 참조

```bash
bunx @moreih29/nexus-core sync --harness=opencode --target=<dir>   # 자산 동기화
bunx @moreih29/nexus-core sync --harness=opencode --dry-run        # 변경될 파일 목록만 출력 (쓰기 없음)
bunx @moreih29/nexus-core sync --harness=opencode --force          # Template 파일도 강제 덮어쓰기
bunx @moreih29/nexus-core sync --harness=opencode --strict         # Managed 파일의 미커밋 변경 시 오류
bunx @moreih29/nexus-core list                                      # 사용 가능한 에이전트·스킬 목록
```

전역 설치(`bun add -g @moreih29/nexus-core`) 환경에서는 `nexus-core <cmd>` 형태로도 사용할 수 있습니다.

## 주의사항

- `src/agents/`, `src/index.ts`, `.opencode/skills/`는 직접 편집하지 마세요. 다음 sync 시 덮어씁니다.
- OpenCode는 `plugin` 배열의 항목을 npm 패키지로 인식합니다. git URL 기반 설치의 공식 지원 여부는 확인되지 않았습니다.
- 플러그인 코드 훅(`session.created` 등)이 필요하면 `src/plugin.ts`를 직접 추가하고 `package.json`의 `main`을 해당 파일로 변경하세요.
