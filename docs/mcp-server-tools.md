# MCP 서버 도구

`@moreih29/nexus-core` 패키지는 Nexus 상태 관리를 위한 MCP 서버를 `nexus-mcp` 바이너리로 제공한다. 컨슈머는 자신이 쓰는 하네스(Claude Code, Codex, OpenCode 등)에 이 서버를 MCP로 등록해서, 에이전트가 플래닝 세션·태스크·이력·아티팩트에 접근할 수 있게 한다.

- 실행 엔트리: `nexus-mcp` (패키지 `bin`)
- 전송 방식: MCP stdio
- 서버 이름: `nexus-core`

MCP 서버는 **상태와 아티팩트 파일 조작만** 담당한다. 스킬/에이전트 렌더링, 하네스 설치, 매크로 확장은 포함하지 않는다. 렌더링·생성은 `nexus-sync`가 담당한다.

## 설치와 등록

패키지 설치:

```bash
npm install @moreih29/nexus-core
# 또는
bun add @moreih29/nexus-core
```

등록: 사용하는 하네스의 MCP 설정에 `nexus-mcp` 명령을 추가한다. 설정 키와 형식은 하네스마다 다르므로 해당 하네스의 MCP 가이드를 따른다.

## 도구 그룹

등록된 네 그룹은 모두 **컨슈머 프로젝트 루트의 `.nexus/`** 하위 파일을 소유한다.

### Plan

`.nexus/state/plan.json` 기반 플래닝 세션 라이프사이클 도구.

| 도구 | 용도 |
|---|---|
| `nx_plan_start` | 새 플래닝 세션 시작. 기존 `plan.json`이 있다면 아카이브 |
| `nx_plan_status` | 현재 플래닝 세션 상태 반환 |
| `nx_plan_update` | 이슈 추가·삭제·수정·재개 |
| `nx_plan_decide` | 이슈에 대한 결정 기록 |
| `nx_plan_resume` | HOW 참여자 기준 재개 라우팅 정보 반환 |
| `nx_plan_analysis_add` | 이슈에 분석 항목 추가 |

### Task

`.nexus/state/tasks.json` 기반 실행 태스크 라이프사이클 도구.

| 도구 | 용도 |
|---|---|
| `nx_task_add` | 태스크 추가 |
| `nx_task_list` | 태스크 목록과 요약 반환 |
| `nx_task_update` | 상태·소유자 메타데이터 부분 갱신 |
| `nx_task_close` | 사이클 종료. `history.json`에 아카이브 후 `plan.json`/`tasks.json` 제거 |
| `nx_task_resume` | 태스크 소유자 기준 재개 라우팅 정보 반환 |

### History

`.nexus/history.json` 기반 아카이브 이력 조회.

| 도구 | 용도 |
|---|---|
| `nx_history_search` | 아카이브된 사이클 검색 또는 최근 엔트리 조회 |

### Artifact

`.nexus/state/artifacts/` 기반 아티팩트 쓰기.

| 도구 | 용도 |
|---|---|
| `nx_artifact_write` | Nexus 상태 아티팩트 디렉터리에 파일 쓰기 |

## 건드리는 파일

MCP 서버는 컨슈머 프로젝트 루트 기준 아래 경로만 읽고 쓴다.

| 경로 | 소유 도구 |
|---|---|
| `.nexus/state/plan.json` | Plan |
| `.nexus/state/tasks.json` | Task |
| `.nexus/history.json` | History 조회 대상. `nx_task_close`가 여기로 아카이브 |
| `.nexus/state/artifacts/` | Artifact 쓰기 |

이 외 경로는 MCP 서버가 만들거나 수정하지 않는다.

## 범위 밖

MCP 서버는 다음을 하지 않는다.

- 하네스별 에이전트/스킬 파일 생성
- 하네스 메인 세션에 lead 주입
- 플러그인 매니페스트, 설정 조각, 하네스 부트스트랩 설치
- `{{...}}` 매크로 런타임 해석

이들은 `nexus-sync`가 담당하는 스펙 동기화 파이프라인의 영역이다. 자세한 내용은 [agent-skill-sync.md](./agent-skill-sync.md) 참고.
