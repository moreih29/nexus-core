<!-- PROJECT:START -->
## nexus-core

Nexus 생태계의 Authoring layer. claude-nexus, opencode-nexus 2개 하네스가 공유하는 프롬프트·neutral metadata·vocabulary의 canonical source. 집행 semantics는 포함하지 않는다.

### Essentials

- **2 consumer read-only**: claude-nexus · opencode-nexus가 이 레포를 읽기 전용으로 소비한다. ACP vocabulary 편입 금지.
- **구독제 호환 필수**: Claude Pro/Max 전제. Agent SDK / ACP 기반 설계 경로 금지 (Anthropic 공식 정책 근거).
- **prompt-only 라이브러리**: hook, MCP server, tool 구현, TypeScript 타입 정의, 런타임 I/O 로직 포함 금지.
- **harness-neutral 표현**: `body.md` / `meta.yml`에 harness-specific tool 이름(`mcp__plugin_*`, `Bash`, `Edit`, `edit`, `bash` 등) 금지. capability abstraction으로 표현.
- **model_tier 추상만**: `meta.yml`에 구체 model 이름(`opus`, `sonnet`, `gpt-*`) 금지. `model_tier: high | standard`만 허용.
- **neutral 원칙**: `meta.yml`에 UI hint 필드(`icon`, `color`, `sort_order`) 및 Supervision 집행 로직(AgentHost, ApprovalBridge 등) 포함 금지.
- **Forward-only 완화**: breaking change는 semver major bump + `CHANGELOG.md` "Consumer Action Required" 섹션 필수.
- **canonical source**: opencode-nexus의 `docs/bridge/nexus-core-bootstrap.md`가 상위 설계 문서. 상세 해석은 `.nexus/context/` 참조.
<!-- PROJECT:END -->
