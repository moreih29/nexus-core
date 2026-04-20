# nexus-core Plugin 개발 가이드

플러그인 repo 저자를 위한 end-to-end 온보딩 문서입니다.

## 1. 3 레이어 스택 개요

```
nexus-core (@moreih29/nexus-core)
  └── 공통 자산 정의 (agents/, skills/, hooks/, capability-matrix)
       └── 빌드 도구 (nexus-core sync / init / validate)

plugin repo (your-org/my-X-plugin)
  └── nexus-core를 devDependency로 참조
       └── sync로 하네스별 자산을 생성·커밋
            └── 하네스 spec에 맞는 형식으로 배포

end user (컨슈머)
  └── 플러그인을 Claude Code / OpenCode / Codex에 설치
```

nexus-core는 자산을 **정의**합니다. plugin repo는 자산을 **패키징**합니다. end user는 플러그인을 **소비**합니다.

---

## 2. `nexus-core sync` 사용법

sync 명령은 nexus-core의 자산을 plugin repo의 하네스별 형식으로 변환해 기록합니다.

### 기본 사용법

```bash
bunx @moreih29/nexus-core sync --harness=<claude|opencode|codex> --target=<dir>
```

### 플래그 전체 목록

| 플래그 | 기본값 | 설명 |
|---|---|---|
| `--harness=<name>` | 전체 (all) | 대상 하네스를 `claude`, `opencode`, `codex` 중 하나로 제한 |
| `--target=<dir>` | `dist/` | 출력 디렉터리. plugin repo 루트를 지정하려면 `--target=./` |
| `--dry-run` | — | 변경될 파일 목록만 출력. 실제 쓰기 없음 |
| `--force` | — | Template 파일(처음 한 번만 생성되는 파일)도 강제 덮어쓰기 |
| `--strict` | — | Managed 파일에 미커밋 로컬 변경이 있으면 오류로 중단 |
| `--only=<name>` | — | 특정 에이전트 또는 스킬 이름만 처리 |

### 덮어쓰기 정책

| 분류 | 예시 경로 | 정책 |
|---|---|---|
| **Managed** | `agents/*.md`, `src/agents/*.ts`, `plugin/skills/*/SKILL.md`, `dist/claude/settings.json`, `dist/codex/install/AGENTS.fragment.md` | 항상 덮어씀 (`--dry-run` 시 제외) |
| **Template** | `.claude-plugin/plugin.json`, `package.json` | 파일이 없을 때만 생성. `--force`로 강제 가능 |

**직접 편집하지 말아야 할 경로**: Managed 경로는 다음 sync 시 덮어집니다. 커스터마이즈가 필요하면 Template 경로나 별도 파일을 사용하세요.

### 실전 예시

```bash
# 플러그인 repo 루트에서 claude 하네스 동기화
bunx @moreih29/nexus-core sync --harness=claude --target=./

# 변경 사항 미리 확인
bunx @moreih29/nexus-core sync --harness=opencode --target=./ --dry-run

# CI에서 미커밋 변경 감지 (엄격 모드)
bunx @moreih29/nexus-core sync --harness=codex --target=./ --strict

# 특정 에이전트만 재빌드
bunx @moreih29/nexus-core sync --harness=claude --target=./ --only=architect
```

---

## 2-1. Lead primary agent 주입

### 배경

nexus-core는 10개 에이전트 중 `lead`를 primary orchestrator로 지정합니다. 3 하네스는 빌드 시 `lead` agent body를 main thread 시스템 프롬프트로 자동 주입합니다. 이를 통해 컨슈머가 플러그인을 설치하는 순간 Lead가 기본 실행 에이전트로 동작합니다.

### `mode` 필드

에이전트 `assets/agents/<name>/body.md` frontmatter에 `mode` 필드가 있습니다.

| 값 | 의미 |
|---|---|
| `primary` | 3 하네스의 main thread 시스템 프롬프트로 주입 |
| `subagent` | 기본값. 서브에이전트로만 호출 가능 |
| `all` | main thread 주입 + 서브에이전트 호출 모두 허용 |

`lead`는 `mode: primary`로 정의되어 있습니다. 이 필드가 없는 에이전트는 `subagent`로 처리됩니다.

### 하네스별 주입 경로

| 하네스 | 주입 경로 | Managed 산출물 | Consumer 작업 |
|---|---|---|---|
| Claude | `settings.json`의 `agent` 키 | `dist/claude/settings.json` | 없음 (자동) |
| OpenCode | `AgentConfig.mode = "primary"` | `dist/opencode/src/agents/<name>.ts` | 없음 (자동) |
| Codex | `AGENTS.md` 수동 머지 | `dist/codex/install/AGENTS.fragment.md` | [docs/consuming/codex-lead-merge.md](./consuming/codex-lead-merge.md) 참조 |

---

## 3. `nexus-core init` 사용법

init 명령은 nexus-core에 포함된 플러그인 템플릿을 지정 경로로 복사합니다.
새 plugin repo를 처음 생성할 때 한 번 실행합니다.

### 기본 사용법

```bash
bunx @moreih29/nexus-core init --harness=<claude|opencode|codex> --target=<dir>
```

### 플래그

| 플래그 | 기본값 | 설명 |
|---|---|---|
| `--harness=<name>` | `claude` | 복사할 하네스 템플릿 지정 |
| `--target=<dir>` | (필수) | 템플릿을 복사할 대상 경로 |

`--target`은 필수입니다. 생략 시 오류로 종료됩니다.

### 전체 흐름

```bash
# 1. 새 플러그인 디렉터리 생성
bunx @moreih29/nexus-core init --harness=claude --target=./my-claude-plugin

# 2. 이동 및 의존성 설치
cd my-claude-plugin
bun install

# 3. 자산 동기화 (nexus-core에서 에이전트·스킬 가져오기)
bunx @moreih29/nexus-core sync --harness=claude --target=./

# 4. 매니페스트 커스터마이즈 (name, version, description 변경)
# .claude-plugin/plugin.json 편집

# 5. 커밋
git init
git add .
git commit -m "Initial plugin scaffold"
```

---

## 4. 하네스별 install 구현 가이드

### 4-1. Claude

Claude 플러그인은 플러그인 repo 자체가 설치 단위입니다. 컨슈머는 별도 install 명령 없이
마켓플레이스에서 플러그인을 등록하거나 `claude --plugin-dir <path>`로 직접 로드합니다.

**plugin repo 저자가 할 일:**

1. `nexus-core sync --harness=claude --target=./` 실행 후 커밋
2. `.claude-plugin/plugin.json` 의 `name`, `version`, `description` 커스터마이즈
3. 마켓플레이스 카탈로그에 GitHub 소스로 등록

```json
{
  "source": "github",
  "repo": "your-org/my-claude-plugin",
  "ref": "v1.0.0"
}
```

**컨슈머 측 추가 작업 없음.** Claude Code가 플러그인 디렉터리를 캐시로 복사하고
`agents/`, `skills/`, `hooks/` 등을 자동으로 인식합니다.

캐시 위치: `~/.claude/plugins/cache/<marketplace>/<plugin>/<version>/`

`plugin.json`의 `version` 필드가 업데이트 감지 기준입니다. 릴리즈마다 버전을 올리세요.

**Lead primary agent 주입**: sync는 `.claude-plugin/` 디렉터리가 아닌 플러그인 루트에 `dist/claude/settings.json`을 생성합니다. 이 파일에는 `{ "agent": "lead" }` 키가 포함되어, Claude Code가 플러그인 활성 시 main thread를 `lead` 에이전트로 실행합니다. 사용자가 다른 에이전트로 override하려면 프로젝트 또는 사용자 `.claude/settings.json`에서 scope 우선순위에 따라 재정의할 수 있습니다.

---

### 4-2. OpenCode

OpenCode 플러그인은 npm 패키지로 배포됩니다. 컨슈머가 `opencode.json`의 `plugin` 배열에
패키지명을 추가하면 OpenCode 시작 시 Bun이 자동 설치합니다.

**요구사항: Node.js 22 이상** — `import ... with { type: "json" }` 구문이 필요합니다.

**plugin repo 저자가 할 일:**

1. `nexus-core sync --harness=opencode --target=./` 실행 후 커밋
2. `package.json`의 `name`을 실제 npm 패키지명으로 변경
3. npm에 배포: `npm publish --access public`
4. 컨슈머에게 다음 안내 제공:

```json
// .opencode/opencode.json (컨슈머 프로젝트)
{
  "plugin": ["@your-org/my-opencode-plugin"]
}
```

#### hook manifest 스키마 (v0.14.0)

v0.14.0부터 OpenCode hook manifest 스키마가 변경되었습니다. 플러그인 진입점에서
`@moreih29/nexus-core`의 서브패스를 통해 manifest를 임포트하세요.

```typescript
import type { Plugin } from "@opencode-ai/plugin";
import { mountHooks } from "@moreih29/nexus-core/hooks/opencode-mount";
import manifest from "@moreih29/nexus-core/hooks/opencode-manifest" with { type: "json" };

export const OpencodeNexus: Plugin = async (ctx) => mountHooks(ctx, manifest);
```

manifest의 구조는 다음과 같습니다.

```json
{
  "hooks": [
    {
      "name": "hook-name",
      "events": ["event-name"],
      "matcher": "pattern",
      "handlerPath": "../assets/hooks/hook-name/handler.js",
      "priority": 0,
      "timeout": 5000
    }
  ]
}
```

> **v0.13.0 소비자 주의**: v0.13.0의 `mountHooks` `{ mountHooks: [...] }` 스키마는
> 런타임 파싱에 실패해 실제로 동작한 적이 없습니다. v0.14.0의 새 스키마로 교체가 필요합니다.
> manifest 파일명도 `dist/manifests/opencode-hooks.json` → `opencode-manifest.json`으로 변경되었습니다.

**에이전트 활성화**: OpenCode는 `plugin` 배열 등록만으로 에이전트가 자동 활성화되지 않을 수 있습니다.
sync 결과물인 `opencode.json.fragment`를 참고해 컨슈머의 `opencode.json`에 `agents` 배열을 추가하거나,
`postinstall` 스크립트로 자동화하세요.

```js
// postinstall.mjs (package.json scripts.postinstall: "node postinstall.mjs")
import { readFileSync, writeFileSync, existsSync } from "node:fs";
const fragment = JSON.parse(readFileSync("./opencode.json.fragment", "utf-8"));
const target = ".opencode/opencode.json";
const existing = existsSync(target) ? JSON.parse(readFileSync(target, "utf-8")) : {};
existing.agents = [...(existing.agents || []), ...fragment.agents];
writeFileSync(target, JSON.stringify(existing, null, 2));
```

`package.json`이 `"type": "module"`이므로 `require()` 대신 ESM 방식(`import` / `fs.readFileSync + JSON.parse`)을 사용합니다.

자산 경로(`src/agents/*.ts`)는 TypeScript를 그대로 참조합니다. OpenCode가 TypeScript를 직접 실행합니다.

**Lead primary agent 주입**: `lead` 에이전트는 `mode: "primary"`로 빌드됩니다. sync가 생성하는 `src/agents/lead.ts`의 `AgentConfig` 객체에 `mode: "primary"` 필드가 설정되어 OpenCode primary mode로 등록됩니다. 컨슈머 측 추가 작업은 없습니다.

---

### 4-3. Codex

Codex는 플러그인 시스템(`.codex-plugin/plugin.json`)과 native agent 시스템(`config.toml [agents.*]`)이
**별개**입니다. 에이전트를 활성화하려면 두 경로를 모두 처리해야 합니다.

**plugin repo 저자가 할 일:**

1. `nexus-core sync --harness=codex --target=./` 실행 후 커밋
2. install 헬퍼 스크립트(`install/install.sh`) 작성 또는 `package.json`의 `install-plugin` 스크립트 구현

install 스크립트가 수행해야 하는 작업:

```bash
#!/usr/bin/env bash
# install/install.sh — 컨슈머 machine에서 실행

PLUGIN_NAME="my-codex-plugin"

# 1. config.toml에 MCP 서버 + agent 테이블 병합 (block-marker 패턴)
MARKER_BEGIN="# BEGIN ${PLUGIN_NAME}"
MARKER_END="# END ${PLUGIN_NAME}"
CONFIG="$HOME/.codex/config.toml"

# 기존 블록 제거 후 새 내용 삽입
if grep -q "${MARKER_BEGIN}" "$CONFIG" 2>/dev/null; then
  sed -i.bak "/${MARKER_BEGIN}/,/${MARKER_END}/d" "$CONFIG"
fi

{
  echo "${MARKER_BEGIN}"
  cat install/config.fragment.toml
  echo "${MARKER_END}"
} >> "$CONFIG"

# 2. agent TOML 파일을 user scope로 복사
mkdir -p "$HOME/.codex/agents"
cp agents/*.toml "$HOME/.codex/agents/"

# 3. lead agent body를 AGENTS.md에 머지 (block-marker 패턴)
FRAGMENT="dist/codex/install/AGENTS.fragment.md"
AGENTS_TARGET="$HOME/.codex/AGENTS.md"
FRAG_BEGIN="<!-- nexus-core:lead:start -->"
FRAG_END="<!-- nexus-core:lead:end -->"

if grep -q "${FRAG_BEGIN}" "$AGENTS_TARGET" 2>/dev/null; then
  sed -i.bak "/${FRAG_BEGIN}/,/${FRAG_END}/d" "$AGENTS_TARGET"
fi

cat "$FRAGMENT" >> "$AGENTS_TARGET"

echo "Installed ${PLUGIN_NAME}"
```

**block-marker 패턴**: `# BEGIN <plugin-name>` / `# END <plugin-name>` 마커 사이의 내용만 교체합니다.
기존 사용자 설정을 덮어쓰지 않습니다. oh-my-codex의 `omx setup` 패턴에서 가져온 방식입니다.

`install/config.fragment.toml`에는 MCP 서버 설정이 포함됩니다.

```toml
[mcp_servers.nx]
command = "nexus-mcp"
```

`nexus-mcp`는 `@moreih29/nexus-core`를 전역 설치하면 PATH에 추가됩니다.

**Lead primary agent 주입**: sync는 `dist/codex/install/AGENTS.fragment.md`를 생성합니다. 이 파일은 `<!-- nexus-core:lead:start -->` / `<!-- nexus-core:lead:end -->` 마커로 감싸진 `lead` agent body를 포함합니다. Codex는 `AGENTS.md`를 공식 로드 경로로 사용하므로 컨슈머가 직접 머지해야 합니다. 위 install 스크립트의 3단계가 이를 자동화합니다. 자세한 수동 머지 절차는 [docs/consuming/codex-lead-merge.md](./consuming/codex-lead-merge.md) 참조.

---

## 5. 주의사항 및 FAQ

### Q: sync 후 plugin.json이 바뀌지 않아요

`plugin.json`은 Template 파일입니다. 최초 생성 후에는 덮어쓰지 않습니다. 의도적으로 재생성하려면 `--force` 플래그를 사용하세요.

```bash
bunx @moreih29/nexus-core sync --harness=claude --target=./ --force
```

주의: `--force`는 Template 파일의 기존 편집 내용도 덮어씁니다.

### Q: 사용자가 agents/*.md를 직접 수정해도 되나요?

Managed 파일(`agents/`, `skills/` 등)은 다음 sync 시 덮어씁니다. 사용자 커스텀 내용은 보존되지 않습니다.
에이전트 동작을 커스터마이즈하려면 `plugin.json`의 `agents` 배열에서 파일 경로를 재지정하거나,
별도 경로에 커스텀 에이전트를 추가하세요.

### Q: --strict 플래그는 언제 사용하나요?

CI 파이프라인에서 "sync 결과가 항상 커밋된 상태"임을 보장하고 싶을 때 사용합니다.
Managed 파일에 로컬 변경이 감지되면 오류로 중단합니다.

### Q: OpenCode에서 git URL로 플러그인을 설치할 수 있나요?

OpenCode의 `plugin` 배열은 npm 패키지명을 기준으로 동작합니다. git URL 기반 설치의 공식 지원 여부는 확인되지 않았습니다. npm 배포를 권장합니다.

### Q: Codex에서 npm으로 플러그인을 설치할 수 있나요?

Codex 플러그인의 npm 기반 설치는 공식 지원 여부가 확인되지 않았습니다. 로컬 경로 또는 GitHub 소스 방식을 사용하세요.

### Q: 여러 하네스를 한 번에 동기화할 수 있나요?

`--harness` 플래그를 생략하면 모든 하네스를 순차로 처리합니다. `--target`은 공통 출력 루트가 됩니다.

```bash
# dist/claude/, dist/opencode/, dist/codex/ 에 동시 생성
bunx @moreih29/nexus-core sync --target=./dist
```

각 하네스 디렉터리를 별도 git repo로 분리하는 구성에서는 `--harness` 플래그로 개별 실행을 권장합니다.

### Q: plugin.json에서 오버라이드한 자산 경로가 sync 후 사라지나요?

Template 파일인 `plugin.json`은 `--force` 없이는 덮어쓰지 않습니다. 오버라이드 내용은 보존됩니다.

### Q: lead 대신 다른 에이전트를 primary로 쓰고 싶으면?

`assets/agents/<name>/body.md` frontmatter에서 원하는 에이전트의 `mode` 값을 `primary`로 변경하고 `lead`의 `mode`를 `subagent`로 바꿉니다. 이후 sync를 재실행하면 해당 에이전트가 3 하네스에 primary로 주입됩니다. Claude만 빠르게 override하려면 컨슈머 프로젝트 또는 사용자 `.claude/settings.json`에서 `agent` 키를 재정의하세요.

### Q: primary agent를 여러 개 등록할 수 있나요?

빌드는 `mode: primary`인 에이전트를 전부 처리합니다. 단, 하네스별 동작이 다릅니다.

- **Claude**: `dist/claude/settings.json`은 첫 번째 primary만 기록하고, 복수 발견 시 경고 log를 출력합니다.
- **Codex**: `AGENTS.fragment.md`에 primary 에이전트를 순차 append합니다.
- **OpenCode**: 해당 에이전트 TS 모듈 각각에 `mode: "primary"`를 설정합니다.

---

## 6. 보조 명령

```bash
bunx @moreih29/nexus-core list       # 에이전트·스킬·훅 전체 목록과 설명 출력
bunx @moreih29/nexus-core validate   # assets/ frontmatter 및 YAML 파일 유효성 검사
bunx @moreih29/nexus-core mcp        # MCP stdio 서버 직접 실행 (nexus-mcp와 동일)
bunx @moreih29/nexus-core --help     # 전체 명령 도움말
```

전역 설치(`bun add -g @moreih29/nexus-core`) 환경에서는 `nexus-core list` 형태로도 사용할 수 있습니다.

`bunx @moreih29/nexus-core validate`는 CI에서 자산 정합성을 검증하는 용도로 사용합니다.
검증 대상: `assets/agents/*/body.md` frontmatter, `assets/skills/*/body.md` frontmatter,
`assets/capability-matrix.yml`, `assets/tools/tool-name-map.yml`.
