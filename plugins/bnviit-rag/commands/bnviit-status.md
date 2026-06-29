---
description: 비앤빛 RAG 색인 현황 확인 — 총 청크·분포·마지막 ingest 시각·커버리지
---

비앤빛 RAG 색인 현황을 확인한다.

```bash
node plugins/bnviit-rag/skills/bnviit-memory/rag/status.mjs --root <프로젝트_루트> [--json]
```

옵션:

- `--root <경로>`: 색인 루트(ingest 때와 동일한 경로). `BNVIIT_RAG_ROOT` 환경변수로도 지정 가능.
- `--json`: JSON 형식으로 출력(스키마: `{ chunks, by_type, last_ingest_at, embedding_fingerprint, coverage, failed_files }`).

출력 항목:

- `chunks`: 총 청크 수.
- `by_type`: `source_type`별 청크 분포(`knowledge` / `agent` / `skill` / `sop`).
- `last_ingest_at`: 마지막 ingest 시각.
- `embedding_fingerprint`: 현재 임베딩 파이프라인 식별자(불일치 시 전체 재색인 필요).
- `coverage`: 색인된 파일 수 / 대상 파일 총 수.
- `failed_files`: 색인 실패 파일 목록.

**캐시 일관**: status는 캐시 온리(다운로드 미허용)가 기본이다. ingest 때와 동일한 `--root`(또는 `RAG_CACHE_DIR` / `RAG_DATA_DIR`)를 사용한다.
