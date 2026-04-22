# Releasing

이 문서는 `@moreih29/nexus-core`를 릴리즈할 때 사람이 체크하고, LLM이 그대로 따라 실행할 수 있도록 만든 운영 체크리스트다.

현재 릴리즈 자동화 전제:

- 검증 워크플로우: `.github/workflows/validate.yml`
- 배포 워크플로우: `.github/workflows/publish-npm.yml`
- GitHub 릴리즈 노트 분류: `.github/release.yml`
- npm 배포 방식: GitHub Actions trusted publishing
- publish 트리거: `v*` 태그 push

## 기본 원칙

- 릴리즈는 `package.json` 버전과 git tag가 정확히 일치해야 한다.
  - 예: `package.json = 0.16.3` 이면 tag는 `v0.16.3`
- 릴리즈는 `main`에서만 수행한다.
- 릴리즈 대상 변경은 long-lived 작업 브랜치에서 직접 배포하지 않고, PR로 `main`에 병합한 뒤 진행한다.
- 배포 전 로컬 검증이 통과하지 않으면 tag를 만들지 않는다.
- 이 저장소는 현재 별도 `CHANGELOG.md`를 canonical source로 쓰지 않는다.
  - canonical changelog는 GitHub Release notes다.
  - 다만 consumer-facing 변경이나 breaking change가 있으면 auto-generated notes만으로 끝내지 않고, GitHub Release body 상단에 수동 요약을 반드시 붙인다.
- 자동화가 이미 하는 일은 사람이 반복하지 않는다.
  - publish workflow가 `bun run validate`와 `npm publish`를 다시 수행한다.

## LLM 운영 규칙

LLM이 릴리즈를 수행할 때 아래 항목이 불명확하면 추측하지 말고 사용자에게 확인한다.

- 다음 버전 번호
- 이번 릴리즈가 `patch` / `minor` / `major` 중 무엇인지
- 릴리즈 요약에 강조할 변경점
- 영향받는 harness consumer가 누구인지
- 릴리즈를 지금 바로 실행할지, 체크리스트 문서화까지만 할지

다만 아래 규칙으로 초안 판단은 가능하다.

- `patch`
  - 버그 수정
  - 문서 수정
  - 내부 리팩터
  - 배포/CI 수정
  - 컨슈머 공개 인터페이스 변화 없음
- `minor`
  - backward-compatible 기능 추가
  - 새로운 명세/출력/문서 surface 추가
  - 기존 컨슈머를 깨지 않는 public capability 확장
- `major`
  - 컨슈머가 쓰는 경로, 포맷, 계약, 동작을 깨는 변경
  - 기존 harness 통합 가이드를 다시 따라야 하는 변경
  - 예: MCP tool 입력 스키마 제거, 공개 출력 포맷 변경, 기존 consumer 호출 방식 수정 필요

## 브랜치 정책

- 모든 릴리즈 대상 작업은 작업 브랜치에서 진행한다.
  - 예: `feat/...`, `fix/...`, `chore/...`
- 작업 브랜치는 GitHub PR로 `main`에 병합한다.
- tag는 병합 후 `main` HEAD에서만 만든다.
- 릴리즈 커밋을 만들기 위해 별도 release branch를 유지하지 않는다.
- 병합된 작업 브랜치는 정리한다.
  - 원격 브랜치:
    - GitHub의 자동 삭제가 켜져 있으면 merge 후 자동 삭제에 맡긴다.
    - 자동 삭제가 없으면 merge 직후 수동으로 삭제한다.
  - 로컬 브랜치:
    - merge 완료 후 수동으로 삭제한다.

정리 명령 예시:

```bash
git branch -d <branch>
git push origin --delete <branch>
```

LLM 운영 규칙:

- 현재 브랜치가 `main`이 아니면, 먼저 PR 병합 여부를 확인한다.
- 아직 `main`에 병합되지 않은 브랜치에서는 tag를 만들지 않는다.
- 이미 `main`에 병합된 브랜치라면, 릴리즈 후 브랜치 정리까지 수행한다.

## 릴리즈 체크리스트

### 1. 릴리즈 범위 결정

- [ ] 이번 릴리즈에 들어갈 변경 범위를 확정했다.
- [ ] 다음 버전 번호를 확정했다.
- [ ] semver 등급(`patch` / `minor` / `major`)을 확정했다.
- [ ] 공개 계약(public contract) 변경 여부를 확인했다.
- [ ] 영향받는 harness/consumer와 각 consumer가 해야 할 업데이트를 정리했다.
- [ ] 이번 릴리즈에서 사용자에게 알려야 할 핵심 변경 3개 이하를 정리했다.

메모:

- 버전 번호를 먼저 정한 뒤 파일과 tag를 맞춘다.
- 애매하면 version을 올리기 전에 사용자에게 판단을 받는다.

### 2. 릴리즈 노트 정책 확인

- [ ] 이번 릴리즈의 canonical changelog는 GitHub Release notes로 간다.
- [ ] PR label이 release category 분류에 맞는지 확인했다.
  - `feat`, `feature` → Features
  - `fix`, `bug` → Fixes
  - `docs` → Documentation
  - `build`, `ci`, `chore`, `tooling` → Tooling
  - `test` → Tests
- [ ] consumer-facing 변경이 있으면 release body 앞에 붙일 수동 요약을 준비했다.
- [ ] 공개 계약 변경이나 breaking change가 있으면 release body에 아래 항목이 모두 들어가도록 준비했다.
  - 무엇이 바뀌었는지
  - 누가 영향받는지
  - consumer/harness별 필요한 조치
  - migration 단계
  - 가능하면 before/after 예시

메모:

- `CHANGELOG.md`는 현재 필수 릴리즈 산출물이 아니다.
- 현재 workflow는 `generate_release_notes: true`만 사용하므로, 수동 요약은 자동 주입되지 않는다.
- 따라서 consumer-facing 변경이 있으면 release 생성 후 GitHub Release description을 직접 편집해 상단 요약과 migration 안내를 넣어야 한다.
- 단순 내부 변경이 아니라면 "짧은 bullet 3개"만으로 끝내지 말고, 컨슈머가 그대로 따라 업데이트할 수 있는 수준으로 적는다.

권장 release body 템플릿:

```md
## Summary
- ...

## Affected consumers
- Claude harness consumer: ...
- Codex harness consumer: ...
- OpenCode harness consumer: ...

## Required changes
- ...

## Migration
1. ...
2. ...

## Before / After
- Before: ...
- After: ...
```

### 3. 버전 파일 업데이트

- [ ] `package.json`의 `version`을 목표 버전으로 올렸다.
- [ ] 변경 후 버전 문자열이 tag와 정확히 맞는지 확인했다.

예:

```json
{
  "version": "0.16.3"
}
```

tag:

```bash
git tag v0.16.3
```

### 4. 배포 메타 확인

- [ ] `package.json`의 `name`이 올바르다.
- [ ] `package.json`의 `repository.url`이 실제 GitHub repo와 정확히 일치한다.
- [ ] `package.json`에 `private: true`가 없다.
- [ ] `publishConfig.access`가 의도대로 설정되어 있다.
- [ ] npm trusted publisher 설정의 workflow filename이 실제 파일명과 일치한다.
  - 현재 기대값: `publish-npm.yml`

### 5. 로컬 기계 검증

- [ ] 의존성을 설치했다.

```bash
bun install --frozen-lockfile
```

- [ ] 전체 검증을 통과했다.

```bash
bun run validate
```

- [ ] publish tarball preview를 확인했다.

```bash
npm pack --dry-run
```

- [ ] tarball에 들어가면 안 되는 파일이 없는지 눈으로 확인했다.

선택:

- [ ] 하네스 렌더 preview를 다시 생성해 마크다운/출력 형식을 확인했다.

```bash
bun dist/cli/sync.js --harness=claude --target=dist/render-preview/claude
bun dist/cli/sync.js --harness=codex --target=dist/render-preview/codex
bun dist/cli/sync.js --harness=opencode --target=dist/render-preview/opencode
```

### 6. 릴리즈 전 수동 검토

- [ ] README가 이번 릴리즈 설명과 충돌하지 않는다.
- [ ] 새로 추가하거나 바꾼 consumer-facing 문서가 있으면 링크가 맞는다.
- [ ] 공개 surface 변경이 있으면 docs에 설명이 반영됐다.
- [ ] 공개 계약 변경이 있으면 GitHub Release body 초안에 consumer별 영향과 migration 단계가 반영됐다.
- [ ] package tarball preview에서 `dist`, `spec`, `harness`, `vocabulary`만 의도대로 포함된다.
- [ ] 민감한 파일, 로컬 메모, 실험 출력물이 publish 대상에 섞이지 않았다.

### 7. 커밋과 태그 준비

- [ ] 작업 브랜치가 `main`에 병합됐다.
- [ ] 현재 릴리즈 기준점이 `main` HEAD다.
- [ ] 릴리즈용 변경만 커밋 대상에 포함되어 있다.
- [ ] 불필요한 작업 중 파일이 없는지 확인했다.
- [ ] 릴리즈 커밋 메시지를 정했다.

예:

```bash
git add .
git commit -m "release: v0.16.3"
```

- [ ] 정확한 버전 tag를 만들었다.

```bash
git tag v0.16.3
```

### 8. 푸시와 자동 배포

- [ ] 릴리즈 커밋을 원격에 push 했다.
- [ ] 버전 tag를 원격에 push 했다.

```bash
git push origin main
git push origin v0.16.3
```

배포 자동화 기대 동작:

1. `validate.yml`은 `main` push에서 검증
2. `publish-npm.yml`은 `v*` tag push에서 실행
3. publish workflow 내부에서 다시:
   - `bun install --frozen-lockfile`
   - `bun run validate`
   - `npm pack --dry-run`
   - `npm publish`
   - GitHub Release 생성

### 9. 배포 후 확인

- [ ] GitHub Actions의 `Publish npm` workflow가 성공했다.
- [ ] GitHub Release가 생성됐다.
- [ ] GitHub Release notes가 기대한 카테고리로 분류됐다.
- [ ] consumer-facing 변경이 있었다면 GitHub Release description을 수동 편집해 상단 요약, 영향 범위, migration 단계를 반영했다.
- [ ] GitHub Release 본문만 읽어도 harness consumer가 필요한 업데이트를 판단할 수 있다.
- [ ] npm registry에 새 버전이 올라갔다.
- [ ] 병합된 작업 브랜치를 정리했다.

확인 명령:

```bash
npm view @moreih29/nexus-core version
npm view @moreih29/nexus-core dist-tags
```

- [ ] 필요하면 설치 smoke test를 한다.

예:

```bash
npm view @moreih29/nexus-core version
mkdir -p /tmp/nexus-core-smoke && cd /tmp/nexus-core-smoke
npm init -y
npm install @moreih29/nexus-core@0.16.3
npx nexus-sync --help
```

주의:

- smoke test는 실제 릴리즈 버전으로 바꿔 실행한다.
- 별도 temp dir에서 설치 후 `nexus-sync --help`와 `nexus-mcp` 진입이 되는지만 봐도 충분하다.

## 실패 시 대응

### validate 실패

- tag를 만들지 않는다.
- 원인 수정 후 로컬에서 다시 `bun run validate`

### npm pack 실패

- publish 대상 파일 구성을 먼저 수정한다.
- `files` / `.npmignore` / build 산출물 상태를 다시 확인한다.

### publish workflow 실패, npm publish 이전

- 원인을 수정한다.
- 같은 버전으로 다시 시도 가능하다.
- 필요하면 tag를 삭제 후 다시 생성한다.

### npm publish 성공, GitHub Release 생성 실패

- npm에는 이미 배포된 상태다.
- 같은 버전으로 재publish하지 않는다.
- GitHub Release만 수동으로 만들거나 workflow를 재실행한다.

### 잘못된 버전을 publish함

- 기존 버전을 덮어쓸 수는 없다.
- 필요하면 deprecate 또는 새 버전으로 바로 후속 릴리즈한다.

## 릴리즈 실행용 요약 절차

LLM이 실제 배포를 수행할 때의 최소 절차:

1. 목표 버전과 릴리즈 요약을 확정한다.
2. `package.json` 버전을 올린다.
3. `bun install --frozen-lockfile`
4. `bun run validate`
5. `npm pack --dry-run`
6. 결과를 검토한다.
7. 릴리즈 커밋을 만든다.
8. `vX.Y.Z` tag를 만든다.
9. branch와 tag를 push 한다.
10. GitHub Actions와 npm 결과를 확인한다.

이 순서 중 1, 6, 10은 기계적으로 넘기지 말고 사람이 최종 판단하거나, LLM이 결과를 읽고 이상 여부를 명시적으로 보고해야 한다.
