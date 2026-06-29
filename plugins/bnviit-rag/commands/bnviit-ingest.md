---
description: 비앤빛 지식 재색인(변경분 멱등 업서트) — 최초 또는 지식 갱신 후 실행
---

비앤빛 지식을 재색인한다(멱등). 변경된 파일만 재임베딩하고 삭제된 파일의 청크는 orphan 삭제한다.

최초 색인 및 재색인 모두 모델 캐시가 필요하므로 `RAG_ALLOW_DOWNLOAD=1`을 설정해 실행한다:

```bash
RAG_ALLOW_DOWNLOAD=1 node "${CLAUDE_PLUGIN_ROOT}/skills/bnviit-memory/rag/ingest.mjs" --root <프로젝트_루트>
```

- `<프로젝트_루트>`: `knowledge/` 등 색인 대상이 있는 디렉터리 경로.
- `RAG_CACHE_DIR`를 명시한 경우 이후 ask/status에도 동일한 값을 사용한다(캐시 일관).
- 색인 전 기밀 게이트(fail-closed)가 자동 적용된다. 위반 시 색인이 차단된다.
- 진행률과 결과(신규/갱신/스킵/삭제 카운트)를 출력한다. 중단 후 재실행 시 resume된다.
- 완료 후 `/bnviit-status`로 현황을 확인한다.
