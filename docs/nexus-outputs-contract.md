# Nexus 산출물 제어 계약

이 문서는 nexus-core를 소비하는 하네스(claude-nexus, opencode-nexus, nexus-code)가 준수해야 할 **산출물 제어 normative 계약**이다. 산출물이란 Nexus 세션 또는 프로젝트 사이클에서 생성·수정·삭제되는 모든 파일을 의미하며, 그 책임 주체·생성 조건·삭제 조건·상호운용 의무를 선언적으로 기술한다.

이 문서는 `docs/nexus-state-overview.md`와 역할을 명확히 분담한다.

- `docs/nexus-state-overview.md` — **기술적 사실**: 각 state 파일의 schema, field 정의, lifecycle facts, tool 접근 매핑.
- `docs/nexus-outputs-contract.md` (본 문서) — **의무 선언**: 하네스가 MUST / MUST NOT / SHOULD로 지켜야 할 normative 조항. 기술 사실이 아니라 준수 의무를 다룬다.

두 문서는 서로를 전제하며 상호 대체하지 않는다. 기술 상세는 state-overview를 참조하고, 준수 여부 판단은 본 문서를 기준으로 한다.

---

## 산출물 3 카테고리

Nexus 산출물은 생성 책임 주체에 따라 세 카테고리로 분류된다.

| 카테고리 | 책임 주체 | 예시 파일 |
|---|---|---|
| Tool-produced | MCP tool 계약 (nexus-tools-contract.md 정의) | `plan.json`, `tasks.json`, `history.json` |
| Harness-produced | Session hook (하네스 구현 책임) | `runtime.json`, `agent-tracker.json` |
| Agent-produced (ephemeral) | `artifact_write` 도구 (에이전트가 호출) | `artifacts/*.md` (등 임의 파일명) |

카테고리 간 경계는 "누가 파일을 만드는가"로 정의된다. MCP tool이 직접 write하면 Tool-produced, 하네스 hook이 세션 초기화·종료 시 관리하면 Harness-produced, 에이전트가 `artifact_write`를 통해 기록하면 Agent-produced다.

---

## Tool-produced 산출물

### `plan.json` — 활성 계획 세션

**책임 주체**: MCP tool (`plan_start`, `plan_status`, `plan_update`, `plan_decide`, `task_close`). `plan_status`는 read-only이며 `docs/nexus-tools-contract.md`의 tool 열거 순서와 일치한다.

**생성 trigger**: `plan_start` 호출 시 MUST 생성한다. 이전 세션이 존재할 경우 반드시 `history.json`에 아카이브한 뒤 덮어쓴다.

**삭제 trigger**: `task_close` 호출 시 MUST `history.json`에 아카이브 후 삭제한다. `plan_start` 재호출 시에도 동일한 순서(아카이브 → 삭제 → 신규 생성)로 처리해야 한다.

**Schema reference**: `conformance/state-schemas/plan.schema.json`

**Interop requirement**:
- 하네스는 `plan.json`을 생성할 때 MUST `conformance/state-schemas/plan.schema.json`에 유효한 JSON을 기록해야 한다.
- 다른 하네스가 이 파일을 읽어 parse·편집할 수 있어야 한다. MUST NOT 하네스 고유 확장 필드를 schema 외부에 추가해서는 안 된다.
- `created_at` 필드는 MUST ISO 8601 형식을 사용해야 한다.

**Conformance fixture reference**: `conformance/tools/plan-start.json`, `conformance/tools/plan-decide.json`

---

### `tasks.json` — 활성 태스크 목록

**책임 주체**: MCP tool (`task_add`, `task_update`, `task_close`).

**생성 trigger**: `task_add` 최초 호출 시 MUST `{ goal: "", decisions: [], tasks: [] }` 구조로 초기화한 뒤 첫 태스크를 추가한다.

**삭제 trigger**: `task_close` 호출 시 MUST `history.json`에 아카이브 후 삭제한다.

**Schema reference**: `conformance/state-schemas/tasks.schema.json`

**Interop requirement**:
- 하네스는 `tasks.json`을 기록할 때 MUST `conformance/state-schemas/tasks.schema.json`에 유효한 JSON을 기록해야 한다.
- `created_at` 필드는 MUST ISO 8601 형식을 사용해야 한다.
- `status` 값은 MUST `"pending"`, `"in_progress"`, `"completed"` 중 하나여야 한다. 하네스 고유 status 값은 MUST NOT 사용해서는 안 된다.
- `owner_reuse_policy` 값은 MUST `"fresh"`, `"resume_if_same_artifact"`, `"resume"` 중 하나 또는 absent여야 한다.

**Conformance fixture reference**: `conformance/tools/task-add.json`, `conformance/tools/task-update.json`, `conformance/tools/task-list.json`, `conformance/tools/task-close.json`

---

### `history.json` — 완료된 사이클 ledger

**책임 주체**: MCP tool (`plan_start`, `task_close`).

**생성 trigger**: `plan_start` 또는 `task_close`가 최초 아카이브를 수행할 때 파일이 없으면 MUST 생성한다. 이후 호출은 기존 파일의 `cycles` 배열에 append한다.

**삭제 trigger**: MUST NOT 삭제해서는 안 된다. `history.json`은 프로젝트 영구 기록이며 어떤 도구도 이 파일을 삭제해서는 안 된다.

**Schema reference**: `conformance/state-schemas/history.schema.json`

**Interop requirement**:
- 하네스는 cycle 레코드를 append할 때 MUST `conformance/state-schemas/history.schema.json`에 유효한 구조를 기록해야 한다.
- `completed_at` 및 각 태스크의 `created_at` 필드는 MUST ISO 8601 형식을 사용해야 한다.
- 새 cycle 레코드는 MUST append-only 방식으로 추가해야 한다. 기존 cycle 레코드의 수정은 MUST NOT 허용되어서는 안 된다.
- `history.json`은 git-tracked 파일이다. 하네스는 SHOULD 세션 종료 후 이 파일을 commit 대상에 포함할 것을 권장한다.

**Conformance fixture reference**: `conformance/tools/task-close.json` (archive 동작 포함)

---

## Harness-produced 산출물

### `runtime.json` — 세션 런타임 메타데이터

**책임 주체**: Session hook (하네스 구현 책임). 어떤 MCP tool도 이 파일을 write해서는 안 된다.

**생성 trigger**: 하네스는 세션 초기화 시 MUST `runtime.json`을 생성해야 한다. 이 파일은 MCP tool 호출이 시작되기 전에 존재해야 한다.

**삭제 trigger**: 하네스는 세션 종료 시 MUST `runtime.json`을 삭제해야 한다.

**Schema reference**: `conformance/state-schemas/runtime.schema.json`

**Interop requirement**:
- 하네스는 `runtime.json`을 기록할 때 MUST `conformance/state-schemas/runtime.schema.json`에 유효한 JSON을 기록해야 한다.
- 다른 하네스의 session hook이 이 파일을 read할 경우 schema에 정의된 필드에만 의존해야 한다. MUST NOT schema 외부의 하네스 전용 필드에 의존해서는 안 된다.
- `runtime.json`은 MUST NOT git-tracked 상태로 commit되어서는 안 된다.

**Conformance fixture reference**: 해당 없음. `runtime.json`은 MCP tool behavioral fixture 범위 외에 있으며 하네스 session hook이 전적으로 책임진다.

---

### `agent-tracker.json` — 에이전트 인스턴스 추적

**책임 주체**: Session hook (하네스 구현 책임). 어떤 MCP tool도 이 파일에 직접 write해서는 안 된다.

**생성 trigger**: 하네스는 세션 초기화 시 MUST `agent-tracker.json`을 생성해야 한다. 파일 구조는 세션 중 에이전트 인스턴스 spawn 정보를 기록할 수 있어야 한다.

**삭제 trigger**: 하네스는 세션 종료 시 MUST `agent-tracker.json`을 삭제해야 한다.

**Schema reference**: `conformance/state-schemas/agent-tracker.schema.json`

**Interop requirement**:
- 하네스는 `agent-tracker.json`을 기록할 때 MUST `conformance/state-schemas/agent-tracker.schema.json`에 유효한 JSON을 기록해야 한다.
- `task_add` 도구가 `owner_agent_id` 필드를 읽어 harness에 전달하는 방식으로 간접 연계된다. 하네스는 이 연계가 동작하도록 MUST `owner_agent_id` 기반 agent 재개 로직을 구현해야 한다.
- `agent-tracker.json`은 MUST NOT git-tracked 상태로 commit되어서는 안 된다.

**Conformance fixture reference**: 해당 없음. `agent-tracker.json`은 MCP tool behavioral fixture 범위 외에 있으며 하네스 session hook이 전적으로 책임진다.

---

## Agent-produced 산출물 (ephemeral)

### `artifacts/` 디렉토리 — 에이전트 생성 파일

**책임 주체**: `artifact_write` 도구. 에이전트가 이 도구를 호출하여 산출물을 기록한다. 디렉토리 자체는 첫 `artifact_write` 호출 시 자동 생성된다.

**생성 trigger**: 에이전트가 `artifact_write`를 호출할 때 MUST `.nexus/state/artifacts/<filename>` 경로에 파일을 기록해야 한다. 디렉토리가 없으면 MUST 자동 생성해야 한다.

**삭제 trigger**: `task_close`는 `artifacts/` 디렉토리를 아카이브하지 않는다. 세션 종료 시 하네스가 이 디렉토리를 정리하거나 유지하는 것은 하네스의 구현 결정이다. 에이전트 또는 사용자가 artifact를 세션 이후에도 보존하려면 MUST `task_close` 이전에 명시적으로 다른 경로로 복사하거나 git-commit해야 한다.

**Schema reference**: `artifact_write` 산출물 파일 자체에 대한 schema 제약은 없다. 내용 형식은 도구 호출자가 결정한다.

**Interop requirement**:
- `artifact_write`는 MUST 동일 `filename`으로 반복 호출 시 파일을 덮어써야 한다. 이 덮어쓰기 동작은 하네스 간에 일관되어야 한다.
- 다른 하네스가 동일 세션 내 `artifacts/` 파일을 읽을 경우, 파일이 존재하면 MUST 읽을 수 있어야 한다. 특정 하네스만 읽을 수 있는 인코딩이나 잠금은 MUST NOT 사용해서는 안 된다.
- `artifact_write`의 반환값 중 `path` 필드는 MUST 실제 기록된 파일의 절대 경로를 포함해야 한다.

**Conformance fixture reference**: 해당 없음. `artifact_write`의 파일 내용 형식에 대한 fixture는 정의되지 않는다. 도구 동작(디렉토리 생성, 파일 write, 반환값)은 `docs/nexus-tools-contract.md`의 `artifact_write` 섹션이 normative source다.

---

## Cross-harness Interop 원칙

이 섹션은 하네스 간 상호운용성을 보장하기 위한 최소 의무 조항을 정의한다. 하네스 A가 생성한 산출물을 하네스 B가 읽고 처리할 수 있어야 한다는 원칙에서 도출된다.

### MUST 조항

1. **Schema 기반 parse 가능성**: 하네스 A가 생성한 `plan.json`은 하네스 B가 `conformance/state-schemas/plan.schema.json`을 기준으로 parse하여 편집·아카이브할 수 있어야 한다. 마찬가지로 `tasks.json`, `history.json`에 대해서도 동일 원칙이 적용된다. 하네스는 MUST schema에 정의된 필드 집합만 기록해야 하며, schema 외부 필드를 추가해서는 안 된다.

2. **Forward-compatible schema**: 모든 산출물의 schema는 forward-compatible이어야 한다. 기존 field 제거 또는 type 변경은 MUST semver major bump 대상이며, `CHANGELOG.md`에 "Consumer Action Required" 섹션을 포함해야 한다. 하네스는 MUST 새 minor version의 schema에서 추가된 optional field를 unknown field로 거부해서는 안 된다.

3. **ISO 8601 timestamp**: 모든 산출물에 포함되는 timestamp 필드(`created_at`, `completed_at` 등)는 MUST ISO 8601 형식을 사용해야 한다. 하네스별 locale timestamp, Unix epoch, 비표준 포맷은 MUST NOT 사용해서는 안 된다.

4. **append-only ledger 보전**: `history.json`은 모든 하네스 간에 MUST append-only로 처리되어야 한다. 기존 cycle 레코드를 수정하거나 삭제하는 하네스는 cross-harness 호환성 보장 대상에서 제외된다.

5. **session-scoped 파일 격리**: `plan.json`, `tasks.json`, `runtime.json`, `agent-tracker.json`, `artifacts/` 디렉토리는 MUST git-tracked 상태로 commit되어서는 안 된다. 이 파일들은 세션 범위에 속하며 프로젝트 영구 기록이 아니다. 하네스는 MUST `.gitignore`에 이 경로들을 포함해야 한다.

6. **Tool 이름 참조 금지**: 산출물 파일 내용 안에 harness-specific tool 이름(하네스별 MCP prefix, 하네스별 도구 식별자 등)을 MUST NOT 기록해서는 안 된다. 산출물은 harness-neutral해야 한다.

---

## Harness-local State Extension

하네스가 nexus-core 공통 schema로 수렴되지 않는 자체 state 파일을 필요로 할 때의 normative 규약이다.

### 3 파일 유형 분류

| 유형 | 경로 패턴 | Schema 소유 | Lifecycle 책임 |
|---|---|---|---|
| 공통 state | `.nexus/state/{name}.json` | nexus-core `conformance/state-schemas/` | nexus-core MCP tool |
| 하네스 extension | `.nexus/state/{harness-id}/{base}.extension.json` | 하네스 repo `state-schemas/` | 하네스 session hook |
| 하네스 독립 파일 | `.nexus/state/{harness-id}/{any}.json` | 하네스 repo `state-schemas/` | 하네스 session hook |

### Harness-id 식별 규약

- **MUST**: `{harness-id}`는 하네스 npm package name의 마지막 segment를 사용한다.
  - `@moreih29/claude-nexus` → `claude-nexus`
  - `@moreih29/opencode-nexus` → `opencode-nexus`
  - `@moreih29/nexus-code` → `nexus-code`
- **MUST NOT**: nexus-core는 하네스 id 레지스트리를 소유하지 않는다. 규약은 각 하네스 `CONSUMING.md` / `README.md`에서 자기 id를 선언한다.

### Extension 파일 의무

- **MUST**: 파일명은 `{공통-base}.extension.json` 형식이다. 예: `plan.extension.json`, `tasks.extension.json`, `history.extension.json`.
- **MUST**: 최상위 `extends` 필드로 참조 대상 공통 schema를 명시한다. 예: `"extends": "plan.schema.json"`.
- **MUST**: 공통 파일의 레코드와 연결되는 join 필드를 명시한다. 권장 표준:
  - plan extension: `extension_for_plan_id: N` + `issue_extensions: { "<issue_id>": { ... } }`
  - tasks extension: `task_extensions: { "<task_id>": { ... } }`
  - history extension: `cycle_extensions: [ { completed_at, ... } ]`
- **MUST**: 하네스 repo의 자체 `state-schemas/{base}.extension.schema.json` 파일에 JSON Schema(draft 2020-12, `additionalProperties: false`)를 정의한다.
- **MUST NOT**: 공통 schema의 필드(id/title/status/created_at 등)를 extension에서 재선언한다.
- **MUST NOT**: nexus-core MCP tool이 extension 파일을 직접 참조한다고 가정한다. extension은 하네스 session hook이 전담한다.

### Namespace 디렉토리 규약

- **MUST**: 하네스 고유 파일(독립 파일 + extension)은 모두 `.nexus/state/{harness-id}/` 하위에만 배치한다.
- **MUST NOT**: `.nexus/state/` 루트에 신규 하네스 파일을 추가한다.
- **MUST NOT**: 다른 하네스의 namespace 디렉토리에 쓰거나 읽는다.
- **MUST NOT**: `{harness-id}/` 하위에서 공통 schema 파일명(plan.json, tasks.json, history.json, runtime.json, agent-tracker.json)을 재사용한다. 예: `.nexus/state/claude-nexus/plan.json` 금지.
- **예외**: v0.3.x 이하에 루트 경로로 등록된 legacy 2종(`edit-tracker.json`, `reopen-tracker.json`)은 `task_close` tool 계약에 묶여 있어 backward-compat으로 루트 유지 허용한다. 신규 파일에는 예외 편승 금지.

### Archive 정책

- **MUST NOT**: nexus-core의 `history.json`에 하네스 extension을 포함한다.
- **SHOULD**: 하네스가 archive가 필요한 경우 자체 `.nexus/state/{harness-id}/history.extension.json`을 운영한다. git-tracking 여부는 하네스 결정.
- **MUST**: `plan_start` 재호출 또는 `task_close` 시 공통 파일이 archive/삭제되면, 하네스 session hook은 대응 extension 파일도 함께 archive/삭제하여 stale 상태를 방지한다.

### Atomicity

- **MUST**: 공통 파일 쓰기와 대응 extension 쓰기는 하네스 session hook의 책임 하에 함께 성공하거나 함께 실패하도록 처리한다.
- **SHOULD**: consumer가 extension 파일 부재를 "이 하네스는 해당 공통 파일에 확장 정보 없음"으로 해석한다. 공통 파일은 extension 없이도 valid해야 한다.

### 예시 디렉토리 구조

```
.nexus/state/
├── plan.json                          ← 공통, strict
├── tasks.json
├── runtime.json
├── agent-tracker.json
├── artifacts/
└── claude-nexus/                      ← namespace 디렉토리
    ├── plan.extension.json            ← plan.json의 확장 (priority, estimated_effort 등)
    ├── tasks.extension.json
    ├── history.extension.json         ← 하네스 자체 archive
    ├── edit-tracker.json              ← 독립 파일
    ├── reopen-tracker.json            ← 독립 파일
    └── tool-log.jsonl
```

(루트 레벨 `edit-tracker.json`/`reopen-tracker.json`은 legacy carve-out으로 v0.3.x 이하 호환 유지)

### Reference example

`conformance/examples/plan.extension.schema.example.json`에 non-normative 참조 예시가 있다. 이 파일은 다음 요소를 보여준다:

- `extends` 필드 (const: 부모 schema 경로)로 extension이 참조하는 common schema를 명시
- `additionalProperties: false` — 확장 schema에서도 엄격 적용
- `harness_id` 필드와 harness-specific field placeholder

consumer는 이 파일을 starting point로 삼아 자신의 실제 extension 필드로 교체한다.

---

## Conformance 의무와의 연결

### CONSUMING.md §Conformance Obligation

`CONSUMING.md`의 §Conformance Obligation은 하네스가 `conformance/tools/*.json` 및 `conformance/scenarios/*.json`의 모든 fixture를 통과해야 함을 명시한다. 본 문서는 그 의무의 **의미를 확장**한다.

fixture 통과 = schema field 100% coverage ≠ 산출물 제어 의무 이행.

fixture는 도구 호출의 반환값과 state file postcondition을 검증하지만, 아래 항목은 fixture만으로 검증되지 않는다.

- Harness-produced 산출물(`runtime.json`, `agent-tracker.json`)의 생성·삭제 타이밍
- Cross-harness interop 의무(다른 하네스가 생성한 파일을 읽을 수 있는가)
- Forward-compatible schema 유지 의무
- git-tracking 격리 의무

하네스는 fixture 통과를 필요조건으로 충족한 뒤, 본 문서의 MUST 조항을 추가 의무로 준수해야 한다.

### conformance/README.md Schema Field Coverage Obligation

`conformance/README.md`가 정의하는 schema field coverage 의무: 모든 state-schema field는 최소 하나의 fixture의 `covers` 항목에 등장해야 한다. 이 의무는 fixture suite가 schema 전체를 검증함을 보장한다.

본 문서는 이 의무가 **Tool-produced 산출물에 대해서만** 적용됨을 명시한다. Harness-produced 산출물(`runtime.json`, `agent-tracker.json`)의 field coverage는 하네스 자체 테스트 suite의 책임이다.

schema field가 신규 추가되었을 때, nexus-core 관리자는 MUST 해당 field를 cover하는 fixture를 추가하거나 기존 fixture를 갱신해야 한다. field를 schema에 추가하면서 fixture를 갱신하지 않는 것은 coverage 의무 위반이다.

---

## 관련 문서

- `docs/nexus-state-overview.md` — state 파일별 schema, field 정의, tool 접근 매핑 (기술적 사실)
- `docs/nexus-tools-contract.md` — 11 MCP tool의 parameter, return value, side effect, error condition normative 명세
- `docs/nexus-layout.md` — `.nexus/` 디렉토리 canonical 구조
- `docs/behavioral-contracts.md` — task/plan state machine, resume tier, permission model
- `conformance/README.md` — conformance fixture 형식 및 test runner 작성 가이드
- `.nexus/rules/neutral-principles.md` — harness-neutral 원칙 enforceable 규칙 (6개 규칙)
