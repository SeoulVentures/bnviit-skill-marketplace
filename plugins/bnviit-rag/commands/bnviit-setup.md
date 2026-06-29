---
description: 비앤빛 RAG 전체 셋업(런타임 준비→도구→기밀 게이트→색인→검증)
---

bnviit-memory 스킬의 셋업 플로우(⓪~⑧)를 실행하라.

1. **⓪ 플러그인 설치 전제** 확인: `/plugin install bnviit-rag@bnviit-skill-marketplace` 완료 여부.
2. **① 사전 점검**: 색인 루트 탐지(CLI 인자 > `BNVIIT_RAG_ROOT` > 자동 탐지), Node 버전 확인.
3. **①-b 런타임 준비(HITL)**: Node 22/24 LTS 없으면 OS·버전매니저 감지 → 설치 방법 제안 → 승인 후 설치 → 재확인.
4. **② 도구 준비**: 번들 `plugins/bnviit-rag/skills/bnviit-memory/rag/`를 직접 실행.
5. **③ 의존성**: `npm ci`(lockfile 기준). 큰 다운로드(모델 약 100MB)를 사전 고지.
6. **④ 색인 대상 확정(HITL)**: 기본 목록(`knowledge/`, `agents/`, `skills/`, `sops/` 중 존재하는 것) 제시 → 승인/수정.
7. **⑤ 기밀 게이트(fail-closed)**: 확정 대상이 git 추적 중이거나 클라우드 동기화 폴더 하위이면 **색인 차단**. 해소 후에만 진행.
8. **⑥ 색인**: 최초 색인은 모델 다운로드가 필요하므로 `RAG_ALLOW_DOWNLOAD=1`로 ingest를 실행한다(ingest가 미설정 시 자동 주입).
   ```bash
   RAG_ALLOW_DOWNLOAD=1 node plugins/bnviit-rag/skills/bnviit-memory/rag/ingest.mjs --root <프로젝트_루트>
   ```
9. **⑦ 검증 질의**: 이후 ask/status는 캐시 온리(다운로드 미허용)가 기본이다. 동일 `--root`(또는 동일 `RAG_CACHE_DIR`)를 사용해 같은 캐시·데이터 경로를 가리킨다.
10. **⑧ 완료 보고**: `node plugins/bnviit-rag/skills/bnviit-memory/rag/status.mjs --root <프로젝트_루트>` 결과와 query 사용법을 안내.

결과 해석 규율(비신뢰 데이터·근거 부족 시 abstain·의료 발신 HITL)은 SKILL.md §결과 해석 규율을 따른다.
