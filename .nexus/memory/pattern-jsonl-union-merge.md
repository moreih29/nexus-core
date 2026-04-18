# 공유 jsonl 파일 union merge 적용

여러 워크트리·세션이 동시에 추가하는 jsonl 파일은 git union merge driver로 자동 병합.

## 적용 대상

**jsonl만 (한 줄에 1 레코드)** — read-modify-write 형식인 json 파일은 union merge 부적합.

| 파일 | 형식 | union merge |
|---|---|---|
| `.nexus/state/memory-access.jsonl` | jsonl 추가 전용 | ✓ |
| `.nexus/state/sessions/<sid>/tool-log.jsonl` | jsonl 추가 전용 | ✓ |
| `.nexus/history.json` | json (cycles 배열, read-modify-write) | ✗ — 락 + atomic write로 처리 |

## 설정

`.gitattributes`에 대상 등록:

```
.nexus/state/memory-access.jsonl  merge=union
```

## 순서 보장

union merge는 라인 순서를 보장하지 않음. 레코드 스키마에 `timestamp` 필드를 두고 읽기 시 정렬.
