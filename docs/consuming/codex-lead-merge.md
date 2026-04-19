# Codex Lead Agent 수동 머지 가이드

Codex 하네스에서 nexus-core의 lead agent system prompt를 AGENTS.md에 주입하는 수동 절차를 설명합니다.

## 배경

Codex는 main agent의 system prompt를 주입하는 공식 경로를 제공하지 않습니다. `~/.codex/AGENTS.md`(글로벌) 또는 레포 루트 `AGENTS.md`(프로젝트)만 자동 로드됩니다.

nexus-core는 플러그인 배포자이므로 사용자의 `AGENTS.md`를 자동으로 수정하지 않습니다. lead agent body를 AGENTS.md에 반영하는 것은 **consumer의 책임**입니다.

## 산출물 위치

`nexus-core sync` 실행 후 다음 경로에 fragment 파일이 생성됩니다.

```
dist/codex/install/AGENTS.fragment.md
```

이 파일은 **Managed** 경로입니다. 빌드 시마다 덮어씁니다. 직접 편집하지 마세요.

## Fragment 포맷

fragment 파일은 primary agent(`mode: primary`)마다 다음 구조의 블록을 포함합니다.

```markdown
<!-- nexus-core:lead:start -->
# lead

(lead agent body 전문)
<!-- nexus-core:lead:end -->
```

마커 형식: `<!-- nexus-core:<agent-id>:start -->` / `<!-- nexus-core:<agent-id>:end -->`

- **마커**: agent frontmatter의 `id` 필드 값을 사용합니다.
- **헤딩**: agent frontmatter의 `name` 필드 값을 사용합니다.
- `id`와 `name`은 대개 동일하지만 두 필드는 별개 소스입니다.

마커는 이후 업데이트 시 교체 구역을 식별하는 데 사용합니다.

## 수동 머지 절차

### 1. Fragment 확인

```bash
bunx @moreih29/nexus-core sync --harness=codex --target=./
```

sync 완료 후 `dist/codex/install/AGENTS.fragment.md`가 생성되었는지 확인합니다.

### 2. 대상 AGENTS.md 선택

| 범위 | 경로 | 용도 |
|---|---|---|
| 글로벌 | `~/.codex/AGENTS.md` | 모든 프로젝트에 적용 |
| 프로젝트 | `<repo-root>/AGENTS.md` | 해당 레포에만 적용 |

용도에 맞는 파일을 선택합니다. 파일이 없으면 새로 생성합니다.

### 3. Fragment 내용 복사

`dist/codex/install/AGENTS.fragment.md`의 내용 전체(마커 포함)를 선택한 AGENTS.md에 붙여 넣습니다.

```markdown
# (기존 AGENTS.md 내용)

<!-- nexus-core:lead:start -->
# lead

(fragment 내용)
<!-- nexus-core:lead:end -->
```

마커를 포함해 복사해야 이후 업데이트 시 구역을 정확히 식별할 수 있습니다.

### 4. 이후 업데이트 시

nexus-core를 업데이트한 후 sync를 재실행하면 fragment 파일이 새 버전으로 덮어써집니다.
AGENTS.md에서 기존 마커 구역(`<!-- nexus-core:lead:start -->` ~ `<!-- nexus-core:lead:end -->`)을 새 fragment 내용으로 교체합니다.

## 자동화 옵션

consumer 플러그인이 install 스크립트에서 이 머지 작업을 자동화할 수 있습니다. nexus-core는 자동 머지 스크립트를 제공하지 않습니다.

자동화 예시 (install 스크립트에서 구현):

```bash
FRAGMENT="dist/codex/install/AGENTS.fragment.md"
TARGET="$HOME/.codex/AGENTS.md"
MARKER_BEGIN="<!-- nexus-core:lead:start -->"
MARKER_END="<!-- nexus-core:lead:end -->"

# 기존 마커 구역 제거 후 새 내용 삽입
if grep -q "${MARKER_BEGIN}" "$TARGET" 2>/dev/null; then
  sed -i.bak "/${MARKER_BEGIN}/,/${MARKER_END}/d" "$TARGET"
fi

cat "$FRAGMENT" >> "$TARGET"
```

이 패턴은 `docs/plugin-template/codex/README.md`의 block-marker 패턴과 동일한 방식입니다.

## 관련 문서

- `docs/plugin-template/codex/README.md` — Codex 플러그인 전체 설치 흐름
- `.nexus/context/architecture.md` §2-1 — dist/ 하네스별 출력 트리
