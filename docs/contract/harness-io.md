# harness-io 계약

> **규범 문서 (Normative).** `@moreih29/nexus-core`와 3 하네스 consumer plugin repo 간 I/O 계약의 SSOT.
> 튜토리얼·사용법은 [`docs/plugin-guide.md`](../plugin-guide.md) 참조.

---

## 1. 스코프와 버전 정책

### 1-1. 문서 역할

본 문서는 nexus-core가 외부 consumer(3 하네스 plugin repo)에게 보장하는 **계약**을 정의한다. 하네스별 설치 절차·코드 예시·온보딩 흐름은 이 문서의 범위 밖이다.

### 1-2. semver 3축 분리

| 축 | 대상 | 변경 등급 |
|---|---|---|
| (i) Runtime exports | §2 전체 — 서브패스 API, 타입 시그니처 | 추가: minor / 제거·타입 축소: major |
| (ii) sync 출력 set | §4 전체 — 경로·파일명·Managed/Template 분류 | 추가: minor / 제거·이동·분류 전환: major |
| (iii) bin 인터페이스 | §3 전체 — 서브커맨드명·주요 플래그 시맨틱 | 추가: minor / 제거·시맨틱 변경: major |

세 축의 변경 등급은 독립적으로 산출한다. 파일 콘텐츠 내부 구조(프론트매터 스키마 등)는 향후 `assets/schema/`에 별도 버전 문서로 기술될 예정이며, 본 계약은 해당 디렉터리를 스키마 호환 주소로 지정한다. 현재는 agent·skill frontmatter 스키마 파일이 미작성 상태로, 작성 시점에 §8-4 참조.

---

## 2. Runtime exports 계약

소비자가 `@moreih29/nexus-core`의 서브패스로 import할 수 있는 런타임 API 전수. `package.json exports` 필드가 기계 판독 SSOT이며 본 섹션은 그 해석을 제공한다.

### 2-1. 루트 (`"."`)

```
null
```

barrel 파일이 존재하지 않는다. `import "@moreih29/nexus-core"`는 항상 오류다. 서브패스를 통해서만 접근 가능하다.

### 2-2. 공개 API 서브패스

| 서브패스 | 형태 | 제공 내용 |
|---|---|---|
| `@moreih29/nexus-core/mcp` | types + import | MCP stdio 서버 모듈 |
| `@moreih29/nexus-core/types` | types + import | `AgentConfig` 등 generator 산출물이 참조하는 타입 (#36) |
| `@moreih29/nexus-core/hooks/opencode-mount` | types + import | `mountHooks` 함수 및 관련 타입 |
| `@moreih29/nexus-core/hooks/runtime` | types + import | dispatcher helpers 및 관련 타입 |
| `@moreih29/nexus-core/hooks/opencode-manifest` | JSON 단일 경로 | hook manifest JSON (Node 22+ `with { type: "json" }` import) |

`hooks/opencode-manifest`는 조건부 export 객체가 아닌 단일 문자열 경로로 선언된다. 소비자는 반드시 `with { type: "json" }` import attribute와 함께 사용해야 한다. 이는 Node.js 22 이상을 요구한다(§3 참조).

### 2-3. 자산 와일드카드 서브패스 (read-only)

| 서브패스 패턴 | 실제 경로 | 용도 |
|---|---|---|
| `@moreih29/nexus-core/agents/*` | `assets/agents/*` | 에이전트 원본 |
| `@moreih29/nexus-core/skills/*` | `assets/skills/*` | 스킬 원본 |
| `@moreih29/nexus-core/assets/*` | `assets/*` | 기타 자산 |
| `@moreih29/nexus-core/docs/*` | `docs/*` | 문서 |

와일드카드 서브패스는 읽기 전용 참조 용도다. 소비자가 이 경로의 파일을 수정하면 다음 패키지 업그레이드 시 변경이 소실된다.

---

## 3. bin 계약

| 실행 파일 | 진입점 | 역할 |
|---|---|---|
| `nexus-core` | `./dist/scripts/cli.js` | 빌드 타임 CLI |
| `nexus-mcp` | `./dist/src/mcp/server.js` | 런타임 stdio MCP 서버 |

### 3-1. `nexus-core` 서브커맨드

| 서브커맨드 | 역할 |
|---|---|
| `sync` | 하네스별 자산 동기화 (§4 참조) |
| `init` | 신규 plugin repo 스캐폴드 초기화 |
| `list` | 에이전트·스킬·훅 목록 출력 |
| `validate` | `assets/` frontmatter 및 YAML 유효성 검사 |
| `mcp` | MCP stdio 서버 직접 실행 (`nexus-mcp`와 동일) |

서브커맨드 시맨틱 변경 및 제거는 major breaking이다.

### 3-2. engines 요구사항

`engines.node >= 22` — `import ... with { type: "json" }` (import attributes) 지원 최소 버전. 이 요구사항은 runtime exports §2와 연동되며 하향 조정은 major breaking이다.

---

## 4. sync 출력 set — 3 하네스별 규범

**공통 규칙**: `nexus-core sync --harness=<x> --target=<dir>` 실행 시 `<dir>` 직속에 자산을 기록한다. harness 이름 prefix를 붙이지 않는다. flat 출력이 기본값이며 별도 플래그 없이 적용된다.

multi-harness 빌드가 필요한 경우 소비자가 `--harness`와 `--target`을 조합해 3회 호출한다.

---

### 4-1. Claude

**하네스 루트 = plugin 루트.** Claude Code marketplace의 `source: "./"` 직접 정합.

| 경로 (target 루트 기준) | 분류 | 용도 |
|---|---|---|
| `.claude-plugin/plugin.json` | Template | 플러그인 메타 — 저자 편집 허용 |
| `.claude-plugin/marketplace.json` | Template | 마켓플레이스 메타 |
| `agents/<name>.md` | Managed | 하네스 네이티브 에이전트 마크다운 |
| `skills/<name>/SKILL.md` | Managed | 스킬 마크다운 |
| `settings.json`[^claude-primary] | Managed | `{ "agent": "<primary>" }` — main thread 시스템 프롬프트 주입 fragment |
| `hooks/hooks.json`[^claude-hooks] | Managed | Claude Code hooks manifest (prebuilt `dist/manifests/claude-hooks.json` 복사) |
| `dist/hooks/<name>.js`[^claude-hooks] | Managed | 사전 번들된 hook handler 바이너리 (prebuilt `dist/hooks/<name>.js` 복사, 하네스에 등록된 hook만) |

[^claude-primary]: primary agent가 1개 이상 있을 때만 생성. primary 에이전트 부재 시 파일을 생성하지 않으며 기존 파일도 삭제하지 않는다. §6-1 Managed 정의의 조건부 생성 예외 참조.
[^claude-hooks]: consumer `sync` 경로는 절대 `assets/hooks/*/handler.ts`를 재컴파일하지 않는다. 모든 handler는 publish 시점에 `bun build`로 self-contained ESM으로 번들링되어 tarball의 `dist/hooks/`·`dist/manifests/`에 탑재되며, `sync`는 단순 복사만 수행한다 (#34·#35·#36 Bug 2·#37).

**fragment 경로**: `settings.json`은 core가 생성하는 fragment다. `{ "agent": "<primary>" }` 키 하나를 포함한다.

**hooks 경로**: `hooks/hooks.json`의 `command` 필드는 `node ${CLAUDE_PLUGIN_ROOT}/dist/hooks/<name>.js` 형태다. `CLAUDE_PLUGIN_ROOT`는 Claude Code 런타임이 플러그인 설치 디렉터리로 바인딩하는 환경 변수로, 본 계약이 기록하는 상대 경로 `dist/hooks/<name>.js`와 정확히 정합한다. consumer sync가 두 파일 집합을 같은 target 루트에 배치하므로 런타임 해석이 성립한다.

**Consumer(claude-nexus wrapper) 책임**: marketplace 등록 · version bump · git push. core는 `settings.json`·`hooks/hooks.json`·`dist/hooks/*.js` 생성까지만 담당한다. fragment의 consumer 환경 실제 적용은 Claude Code 런타임이 처리하며 wrapper가 그 경로를 보장한다.

---

### 4-2. OpenCode

**npm 패키지 루트 = repo 루트.**

| 경로 (target 루트 기준) | 분류 | 용도 |
|---|---|---|
| `package.json` | Template | npm 패키지 메타 — 저자 name·version 편집 |
| `src/plugin.ts` | **Template (신규)** | mountHooks 진입점 보일러플레이트 |
| `src/index.ts` | Managed | 에이전트 export 인덱스 (`export const agents = [...]` 포함) |
| `src/agents/<name>.ts` | Managed | 에이전트 TS 모듈 |
| `.opencode/skills/<name>/SKILL.md` | Managed | 스킬 마크다운 |

#### Consumer 설정 가이드 (canonical 경로)

**1단계 — 의존성 설치**

```bash
bun add -d @moreih29/nexus-core @opencode-ai/plugin typescript
```

**2단계 — sync 실행**

`bun run sync`를 실행하면 `src/index.ts`에 `export const agents = [...]`가 생성되고, `src/plugin.ts`에 `mountHooks` 기반 Plugin export 보일러플레이트가 생성된다. 이 두 파일이 OpenCode plugin auto-register의 canonical 진입점이다.

**3단계 — consumer 워크스페이스 `.opencode/opencode.json` 구성**

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["<your-plugin-name>"],
  "default_agent": "<primary-agent-id>",
  "mcp": { "nx": { "type": "local", "command": ["nexus-mcp"] } }
}
```

`agent` 객체는 optional이다. 특정 agent의 model 또는 permission을 개별 override해야 할 때만 추가한다.

> **주의**: `{ "agents": [...] }` 형태로 config에 agents를 직접 나열하면 OpenCode가 `Unrecognized key: "agents"` 오류로 기동에 실패한다. agents 등록은 반드시 `plugin: ["<name>"]` 경로(plugin auto-register)를 통해야 한다.

**4단계 — postinstall 허용 (Bun 1.3+)**

```bash
bun pm trust <your-plugin-name>
```

Bun 1.3+에서 plugin의 postinstall 스크립트를 허용하기 위해 필요하다.

**hooks 경로**: OpenCode는 Claude/Codex와 달리 `hooks/hooks.json` 파일을 target에 기록하지 않는다. 대신 `src/plugin.ts`의 `mountHooks(ctx, manifest)`가 런타임에 `@moreih29/nexus-core/hooks/opencode-manifest` JSON과 `@moreih29/nexus-core/hooks/opencode-mount` 함수를 import해 consume하며, handler 경로는 node_modules 내부 패키지 기준으로 해석된다. consumer target에는 물리 복사가 발생하지 않는다.

**Skill discovery 경계 (결정 #7)**: core는 consumer 프로젝트의 `.opencode/skills/<name>/SKILL.md` 파일 존재를 보장한다. `node_modules/<plugin>/.opencode/skills/` 자동 감지 여부는 OpenCode 런타임 영역으로 본 계약 외부다. wrapper(opencode-nexus)는 postinstall 스크립트로 패키지 내부 `.opencode/skills/`를 consumer 경로로 복사할 책임을 진다.

**Consumer(opencode-nexus wrapper) 책임**: `src/plugin.ts` 실 진입점 유지 · plugin auto-register 경로(`src/index.ts` export) 유지 · postinstall skill copy · npm publish.

---

### 4-3. Codex

**wrapper repo 루트 = installer + plugin body 번들.**

| 경로 (target 루트 기준) | 분류 | 용도 |
|---|---|---|
| `package.json` | **Template (신규)** | wrapper 메타 |
| `install/install.sh` | **Template (신규)** | block-marker 머지 설치 스크립트 |
| `plugin/.codex-plugin/plugin.json` | Managed | plugin body 메타 (`~/.codex/plugins/<name>/`로 설치) |
| `plugin/skills/<name>/SKILL.md` | Managed | 스킬 마크다운 (plugin body 내부) |
| `agents/<name>.toml` | Managed | native agent TOML (`~/.codex/agents/`로 설치) |
| `prompts/<name>.md` | Managed | 에이전트 프롬프트 마크다운 |
| `install/config.fragment.toml` | Managed | `~/.codex/config.toml`에 merge될 `[mcp_servers]` fragment |
| `install/AGENTS.fragment.md`[^codex-primary] | Managed | `~/.codex/AGENTS.md`에 merge될 primary agent body (block-marker) |
| `hooks/hooks.json`[^codex-hooks] | Managed | Codex hooks manifest (prebuilt `dist/manifests/codex-hooks.json` 복사) |
| `dist/hooks/<name>.js`[^codex-hooks] | Managed | 사전 번들된 hook handler 바이너리 (Codex에 등록된 hook만) |

[^codex-hooks]: Claude와 동일한 self-contained pre-bundle 정책을 따른다. consumer sync는 재컴파일하지 않고 tarball의 prebuilt 산출물을 단순 복사한다.

[^codex-primary]: primary agent가 1개 이상 있을 때만 생성. primary 에이전트 부재 시 파일을 생성하지 않으며 기존 파일도 삭제하지 않는다. §6-1 Managed 정의의 조건부 생성 예외 참조.

**fragment 경로**:
- `install/config.fragment.toml` — MCP 서버 등록 TOML fragment
- `install/AGENTS.fragment.md` — primary agent body를 `<!-- nexus-core:<agent-id>:start -->` / `<!-- nexus-core:<agent-id>:end -->` 마커로 감싼 fragment. `<agent-id>`는 primary agent의 frontmatter `id`이며 기본값은 `lead`이다

**`agents/*.toml` — standalone role file 스키마**: `agents/<name>.toml`은 Codex의 `~/.codex/agents/`에 **standalone role file**로 직접 설치된다. 파일 스키마는 root-level 필드를 사용한다.

```toml
name = "<agent-id>"
description = "..."
developer_instructions = """<body>"""
model = "..."
sandbox_mode = "..."

[mcp_servers.nx]
command = "nexus-mcp"
disabled_tools = ["nx_task_add"]    # 예시 — 실제 항목은 capability-matrix 조합에 따라 다름
```

> **주의 1**: `[agents.<id>]` nested 구조는 `~/.codex/config.toml`(global config)의 agent 정의용이며, standalone role file과 혼용하면 안 된다. standalone 파일에는 반드시 root-level `name`·`developer_instructions` 형식을 사용한다.

> **주의 2**: `disabled_tools`는 `[mcp_servers.<id>]` 블록 하위에만 배치한다. root-level에 배치하면 Codex 0.121+ `RawAgentRoleFileToml`의 `deny_unknown_fields`에 걸려 role 전체가 reject된다. `disabled_tools`가 비어 있을 때는 `[mcp_servers.nx]` 블록 자체를 생략한다.

**도메인 서브디렉터리 구조**: Codex 내부 `plugin/`·`agents/`·`install/` 서브디렉터리는 Codex 생태계가 `~/.codex/plugins/`·`~/.codex/agents/`·`~/.codex/config.toml` 3곳에 분리 설치되는 구조를 반영한다. 이 도메인 prefix는 flat 출력 규칙(§4 공통 규칙)과 직교하며 유지된다.

**Consumer(codex-nexus wrapper) 책임**: `install.sh` 편집·실행 · block-marker merge(`config.toml`·`AGENTS.md`) · npm 혹은 GitHub source 배포 선택.

---

## 5. Ownership line (Model 2 통일)

3 하네스 모두 동일한 ownership 모델을 따른다. 철학 §3 비목표("플러그인 자체의 빌드·배포·실행 — 하네스 책임")의 규범화다.

### 5-1. core 책임

1. agents·skills 원본 생성 (`assets/agents/*`, `assets/skills/*`)
2. 하네스 네이티브 자산 빌드 — agents (`.md`/`.ts`/`.toml`), skills (`SKILL.md`), plugin manifest
3. Integration fragment 제공:
   - Claude: `settings.json`
   - OpenCode: `src/index.ts`의 `export const agents` (plugin auto-register — fragment 없음)
   - Codex: `install/config.fragment.toml`·`install/AGENTS.fragment.md`
4. Runtime exports (`mountHooks`, manifest JSON, mcp 서버)

### 5-2. wrapper 책임

1. Fragment의 consumer 환경 실제 머지 로직 — block-marker·conditional merge·OS 경로 해석 (Claude `settings.json`, Codex `config.fragment.toml`·`AGENTS.fragment.md`)
2. 배포 — marketplace 등록·npm publish·`install.sh` 실행
3. Plugin 진입점 코드 — OpenCode `src/plugin.ts`·Codex `install/install.sh`
4. Version·changelog 관리

core는 merge 로직·배포·OS별 경로 해석을 떠안지 않는다.

---

## 6. Template vs Managed 정책

### 6-1. 분류 정의

| 분류 | 쓰기 시점 | 소비자 편집 보존 여부 |
|---|---|---|
| **Managed** | 매 `sync` 실행마다 덮어씀 | 보존되지 않음 |
| **Template** | 파일 부재 시에만 생성. 존재 시 skip | 보존됨 (`--force` 지정 시 제외) |

**조건부 생성 예외**: §4에서 각주로 명시한 Managed 파일(`settings.json`, `install/AGENTS.fragment.md`)은 primary agent가 1개 이상 존재할 때만 생성된다. primary 부재 시 생성 자체가 일어나지 않으며, 기존 파일이 있어도 삭제하지 않는다. 이 파일들은 "생성되면 Managed" 규칙을 따른다.

### 6-2. 플래그 시맨틱

| 플래그 | 동작 |
|---|---|
| `--dry-run` | 실제 쓰기 없이 변경될 파일 목록과 summary만 출력 |
| `--force` | Template 파일도 강제 덮어씀 |
| `--strict` | Managed 파일에 로컬 drift가 있으면 exit 1. Template skip은 정상 통과(exit 0) |

### 6-3. dry-run 출력 포맷

파일별 prefix:

| prefix | 의미 |
|---|---|
| `[M]` | Managed — 이번 sync에서 쓰여짐 |
| `[T]` | Template — 신규 생성 |
| `[T]{skip}` | Template — 파일 존재로 건너뜀 |
| `[T]{force}` | Template — `--force`로 덮어씀 |

Summary 라인 포맷:

```
[build-agents] N managed, M template-create, K template-skipped, L template-force-overwrite
```

### 6-4. Managed·Template 분류 변경 정책

Managed에서 Template으로, 또는 Template에서 Managed로의 분류 전환은 major breaking이다(§8 참조).

---

## 7. 예약된 확장점

### 7-1. consumer-manifest.json (현재 미도입, 결정 #2 유보)

현재 3 wrapper 어느 쪽도 `managed_outputs`·`requires`·`primary_agents` 등 기계 판독 필드를 소비하는 코드가 없다. 소비처가 없는 상태에서 스키마를 동결하면 형식적 1.0 고정과 드리프트 위험이 발생한다.

**현재 SSOT**: `package.json exports`(runtime 계약) + 본 문서 `docs/contract/harness-io.md`(빌드 산출물 계약) 두 축으로 충분하다.

**재검토 조건**: 자동화가 `managed_outputs`·`requires` 등 필드를 실제로 기계 소비하기 시작하는 시점에 별도 안건으로 재검토한다. 그 전에는 본 문서가 SSOT 역할을 유지한다.

---

## 8. 변경 관리

### 8-1. sync 출력 set (§4) 변경 등급

| 변경 유형 | 등급 |
|---|---|
| 경로 추가 | minor |
| 경로 제거·이동 | major breaking |
| Managed ↔ Template 분류 전환 | major breaking |

### 8-2. Runtime exports (§2) 변경 등급

| 변경 유형 | 등급 |
|---|---|
| 새 서브패스 추가 | minor |
| 서브패스 제거 | major breaking |
| 타입 시그니처 축소·호환 불가 변경 | major breaking |
| 타입 확장(호환 유지) | minor 또는 patch |

### 8-3. bin 인터페이스 (§3) 변경 등급

| 변경 유형 | 등급 |
|---|---|
| 새 서브커맨드·플래그 추가 | minor |
| 서브커맨드·플래그 제거 | major breaking |
| 주요 플래그 시맨틱 변경 | major breaking |

### 8-4. 프론트매터 스키마

`assets/agents/*/body.md`·`assets/skills/*/body.md` frontmatter 스키마 변경은 `assets/schema/` 버전 문서에서 관리될 예정이다. 현재는 agent·skill frontmatter 전용 스키마 파일이 미작성 상태이며, 작성 시 `assets/schema/` 디렉터리에 위치한다. 본 문서에는 "스키마 호환 주소: `assets/schema/`" 만 명시한다.
