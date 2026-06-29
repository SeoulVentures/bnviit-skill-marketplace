# 비앤빛 안과 전용 RAG 셋업 스킬 — 설계 문서

- 날짜: 2026-06-29
- 상태: 설계 수렴(자체+codex 리뷰 1라운드 반영, v2) → 라운드 2 검증 후 writing-plans
- 작성: Claude (brainstorming)
- 관련 참조: `seoulventures-office`(PRIVATE)의 `tools/rag`, `skills/sv-shared-memory`, `agents/_template.md`

---

## 1. 목표 (Goal)

비앤빛 안과 업무 작업자가 **스킬 하나를 설치/호출("비앤빛안과를 위한 스킬을 설치하라")** 하면, 자기 로컬 환경에 PGlite + pgvector 기반 RAG가 셋업되고 비앤빛 업무 지식(`knowledge/` 등)이 색인되어 **의미 기반 검색**이 가능해진다.

### 비목표 (Non-goals)
- 기밀 데이터를 스킬/공개 리포에 박아 넣지 않는다 — 데이터·인덱스는 작업자 로컬에만 존재.
- 이번 라운드에서 **에이전트 정의(`agents/`)** 와 **Desktop/Chrome 의존 스킬**은 구현하지 않는다(설계·예약만).
  - 주의: 색인 대상에 `agents/`가 포함되는 것은 *이미 존재하는 정의 문서를 검색 대상에 넣는 것*일 뿐, 에이전트 정의의 **구현**(비목표)과는 무관하다.

## 2. 핵심 원칙

- **스킬·도구 코드 = 공개 OK** (범용, 특정 기밀 미포함). **데이터·인덱스 = 로컬** (로컬 임베딩 → 외부 송출 0).
- `seoulventures-office`의 `tools/rag` + `sv-shared-memory`를 **"설치형 전용 스킬"로 일반화**한다.
- 5대 운영 원칙 계승: 단일 책임 · 명시적 권한 · 재현 가능성 · 감사 가능성 · 사람 우선(HITL).

## 3. 아키텍처 (Components)

```
plugins/bnviit-rag/                      # 공개 플러그인
├── .claude-plugin/plugin.json
├── LICENSE                              # 공개 라이선스(MIT) — §12
├── commands/                            # 슬래시 커맨드(표준 실행 경로)
│   ├── bnviit-setup.md
│   ├── bnviit-ingest.md
│   ├── bnviit-ask.md
│   └── bnviit-status.md
└── skills/bnviit-memory/
    ├── SKILL.md                         # 셋업·색인·질의 절차 + 결과 해석 규율(abstain 포함)
    └── rag/                             # 번들 RAG 도구 (seoulventures-office 복제·적응)
        ├── package.json · package-lock.json
        ├── config.mjs
        ├── ingest.mjs · query.mjs · status.mjs
        ├── lib/{db,embed,chunk,sources,stats}.mjs
        └── .gitignore                   # .pgdata/ .cache/ node_modules/ *.log
```

각 구성요소의 단일 책임:
- **rag/**: 색인·검색·현황 엔진(로컬). "무엇을 색인/검색하는가"만 안다. UI·트리거 모름. **플러그인 번들에서 직접 실행**(§6 ②)하고, 사용자 영역에는 데이터(`.pgdata`/`.cache`)만 생성한다.
- **SKILL.md**: 작업자/에이전트에게 *언제·어떻게* 셋업·질의하는지와 결과 해석 규율(비신뢰 데이터 취급·근거 부족 시 **abstain**·의료 발신 HITL)을 준다.
- **commands/**: **표준 실행 경로**. 자연어 트리거는 해당 슬래시 커맨드로 위임한다(§5).

## 4. RAG 도구 — `seoulventures-office/tools/rag` 대비 차이

복제: `config.mjs`, `lib/{db,embed,chunk,sources}.mjs`, `ingest.mjs`, `query.mjs`, `package.json`, `.gitignore` + 신규 `status.mjs`·`lib/stats.mjs`·`package-lock.json`.

### 4.1 복제 전 게이트 (라이선스·기밀)
원본은 PRIVATE 리포이므로 공개 마켓플레이스에 올리기 전에 반드시 확인한다:
1. 저작권 헤더·라이선스 확인 → 공개용 라이선스(**MIT**) 명시.
2. 하드코딩된 사내 경로·식별자·기밀 흔적 스캔 후 제거(범용화).
3. 제거 결과를 `git ls-files`로 재확인.

### 4.2 비앤빛 적응
| 항목 | office 원본 | bnviit 적응 |
|---|---|---|
| 색인 루트 | repo 루트(tools/rag 두 단계 위) | 작업자 프로젝트 루트(`knowledge/`가 있는 곳). **우선순위: CLI 인자 > `BNVIIT_RAG_ROOT` > 탐지 기본값** |
| 색인 대상 | repo `*.md` + (옵션)Cowork 메모리 | `knowledge/` + `agents/` + `skills/` + `sops/` 중 **존재하는 것**. `realpath` 경계 강제, 루트 밖 symlink 제외, 확장자(`.md`)·최대 파일 크기·제외 glob 적용 |
| `source_type` | `repo` / `cowork-memory` | 디렉터리 기반 태깅: `knowledge` / `agent` / `skill` / `sop` (→ `--type` 필터) |
| 의존성 | `npm install` | **`package-lock.json` 커밋 + `npm ci`**(재현성). 모델 **ID·revision(commit hash) 고정** |
| 임베딩·청킹 | e5-small 384 · 1200/150 | **동일**(§4.3 임베딩 계약 명시) |

### 4.3 임베딩 계약 (변경 시 전체 재색인 트리거)
- 모델: `Xenova/multilingual-e5-small`(revision 고정), 384차원.
- e5 프리픽스: 색인 `passage: `, 질의 `query: `.
- pooling: mean, 정규화: L2. 거리→유사도: 코사인(`1 - (embedding <=> q)`).
- 이 파이프라인 전체를 **`embedding_fingerprint`** 로 직렬화해 `meta` 테이블에 저장(§8.2). 불일치 시 **전체 재색인**을 강제한다.

### 4.4 경로 / 환경 변수
| 변수 | 의미 | 기본 |
|---|---|---|
| `BNVIIT_RAG_ROOT` | 색인 루트 | 탐지(`knowledge/` 보유 폴더) |
| `RAG_DATA_DIR` | `.pgdata` 위치 | `rag/.pgdata` |
| (CLI 인자) | 위 둘을 덮어씀 | — |

우선순위: **CLI 인자 > 환경변수 > 탐지 기본값**.

## 5. 명령어 (Interface)

### 진입점 보장
- **자연어 트리거는 플러그인 설치 이후에만 동작**한다(미설치 상태에선 감지 불가 — §6 ⓪).
- 최초 1회 보장 진입점은 **`/bnviit-setup`**. 자연어 트리거("비앤빛안과를 위한 스킬을 설치하라" 등)는 이 커맨드로 위임한다.

### 슬래시 커맨드 (표준 실행 경로)
| 명령 | 동작 | 종료/출력 |
|---|---|---|
| `/bnviit-setup` | 전체 셋업 플로우(§6) | 프리셋 라운드트립+기밀 게이트 통과 시 exit0 |
| `/bnviit-ingest` | 변경분 재색인(멱등) | 신규/갱신/스킵/삭제 카운트, exit0 |
| `/bnviit-ask "질문" [--k N] [--type knowledge\|agent\|skill\|sop] [--json]` | 의미 검색 | top-k 반환 |
| `/bnviit-status` | 색인 현황 | 정량 지표(§6 ⑧), `--json` 스키마 제공 |

각 명령은 **종료 코드(0 성공 / 비0 실패 유형별)** 와 `--json` 출력을 제공한다(상세 스키마는 구현 계획에서 확정).

## 6. "설치하라" → 진행 범위 (셋업 플로우)

| 단계 | 동작 | 모드 |
|---|---|---|
| ⓪ 플러그인 설치 | `/plugin install bnviit-rag@bnviit-skill-marketplace` 완료 확인(자연어 트리거의 전제) | 전제 |
| ① 사전 점검 | 색인 루트 탐지(realpath 경계·루트 밖 symlink 제외·확장자·최대 크기·제외 glob), 기존 `.pgdata`/`.cache` 확인, Node 유무·버전 확인 | 자동 |
| **①-b 런타임 준비** | **Node 22/24 LTS 없으면** OS·버전매니저 감지 → 설치 방법 제안 → **승인 후 설치** → 재확인(PATH 폴백 §9) | **✋HITL(시스템 변경)** |
| ② 도구 준비 | **번들 `rag/`를 직접 실행**(npm 의존성 번들 내). 사용자 영역에는 `.pgdata`/`.cache` 데이터만 생성. (복사 유지 시: git-tracked 확인 → 덮어쓰기 전 `.bak` 백업 → 버전 비교 후 스킵) | 자동 |
| ③ 의존성 | `npm ci`(lockfile 기준). 최초 모델 다운로드는 ⑥에서. 큰 다운로드 고지 | 자동·고지 |
| ④ 색인 대상 확정 | 기본 목록(존재하는 `knowledge/`+`agents/`+`skills/`+`sops/`) 제시 → 승인/수정 | **✋HITL** |
| ⑤ 기밀 게이트(색인 전·**fail-closed**) | 확정 대상 + `.pgdata`/`.cache`/로그/임시파일이 (a) `git ls-files`로 추적 중인지, (b) `.gitignore` 매칭되는지, (c) 클라우드 동기화 폴더(iCloud/Dropbox 등) 하위인지 검사. **위반 시 색인 차단** | **차단 게이트** |
| ⑥ 색인 | `npm run ingest`. 첫 회 모델 약 100MB(revision·quantization에 따라 변동)·로딩 느림. **파일 단위 커밋(부분 진행 보존·resume)**, 진행률·결과(신규/갱신/스킵/삭제) | 자동·진행률 |
| ⑦ 검증 질의 | 비앤빛 프리셋(§7) 스모크: 각 질의의 **기대 source/heading이 top-k에 등장하는지** 확인(유사도 0.8은 참고용 휴리스틱, 합격 게이트 아님) | 자동 |
| ⑧ 완료 보고 | `status`(총 청크·`source_type`별 분포·마지막 ingest 시각·`embedding_fingerprint`·커버리지[분모=대상 파일 수]·실패 파일) + query 사용법 + 재색인 루틴 | 자동 |

**HITL은 둘** — ①-b(Node 설치) · ④(색인 대상). **⑤는 fail-closed 차단 게이트**(기밀이 git/클라우드로 새지 않게 색인 *전* 차단). 나머지는 로컬·가역이라 자동.

### ①-b 런타임 준비 — Node 자동 설치 정책 (Node 22 또는 24 LTS)
| 환경 | 우선순위(위→아래로 시도) | 비고 |
|---|---|---|
| 공통 | 이미 있는 버전매니저 재사용: `nvm`/`fnm`/`mise`/`asdf` → `install 22`(또는 24) | 사용자 공간·sudo 불필요 |
| macOS | 위 없으면 → Homebrew(`brew install node@22`) → 그래도 없으면 `fnm` 설치 후 Node 설치 | sudo 회피 우선 |
| Windows | `fnm`/`nvm-windows`/`winget install OpenJS.NodeJS.LTS`/`choco` | 셸 재시작 안내 |
| Linux | `fnm`/`nvm`/배포판 패키지(`apt`/`dnf`) | 배포판 패키지는 sudo 필요 고지 |

- **항상 사용자 승인 후 설치**(시스템/셸 변경). 방법·영향(PATH·셸 rc 수정) 고지.
- 설치 후 `node -v`가 **≥22**인지 재확인. **PATH 폴백**: 동일 비대화형 셸에서 버전매니저 PATH가 즉시 안 잡히면 절대경로로 `node`/`npm` 호출하거나, 셸 재시작 후 `/bnviit-setup` 재실행을 안내(§9).
- Node 20은 2026-03-24 EOL이라 대상에서 제외. (3-OS CI 매트릭스는 §13 후속.)

## 7. 검증 질의 프리셋 (스모크 — 기본 색인 대상에서 회수 가능한 질의)

각 질의에 **기대 출처(디렉터리/문서)** 를 병기하여, 해당 source/heading이 top-k에 등장하는지로 검증한다(기밀 수치 아님).

| 질의 | 기대 출처 |
|---|---|
| "수술 후 D+7 케어 메시지 타이밍" | `knowledge/09-care-automation.md` |
| "5겹 오류 방어 모델" | `knowledge/07-architecture.md` |
| "툴 통합 우선순위 1단계" | `knowledge/04-integration-roadmap.md` |
| "수술 후 별점 3점 이하일 때 에스컬레이션" | `knowledge/09-care-automation.md` |

> `agents/`/`sops/`가 생기면 해당 타입의 프리셋을 1건씩 추가한다.

## 8. 데이터 흐름 · DB 스키마 · 멱등성

### 8.1 데이터 흐름
```
명령 → 스킬 트리거(슬래시 커맨드)
 (셋업) npm ci → ingest: 파일 수집 → 청킹 → 로컬 임베딩(e5) → PGlite .pgdata 업서트(멱등)
 (질의) query: 질문 로컬 임베딩 → 코사인 top-k → {source, heading, similarity, content} 반환 → 출처와 함께 답
```
모든 임베딩은 로컬 계산. 문서·인덱스는 작업자 디스크를 벗어나지 않는다.

### 8.2 DB 스키마 (PGlite + pgvector)
- `chunks(id, source, source_type, heading, chunk_index, content, char_len, content_hash, embedding vector(384), updated_at)`
- `meta(schema_version, embedding_fingerprint, last_ingest_at)`
- PGlite(`@electric-sql/pglite`) + pgvector contrib extension **버전 고정**, extension 초기화 순서 명시.
- **`schema_version` 또는 `embedding_fingerprint` 불일치 = `.pgdata` 전체 재구축(drop & recreate)** 을 단일 정책으로 못박는다(모델 교체로 벡터 차원이 바뀌면 ALTER가 아니라 재생성 필요 — 차원 불일치 row가 코사인 계산에 섞이지 않게).

### 8.3 멱등성 / 재색인
- `id = canonical realpath(source) + content_hash` 기반. **변경된 파일만 재임베딩**, 사라진 파일의 청크는 **orphan 삭제**.
- ingest는 **파일 단위 커밋**(부분 실패 시 다음 ingest가 이어받는 resume). 진행률 표시와 양립.
- `embedding_fingerprint` 일치 검증을 멱등성 판정에 포함.

## 9. 에러 처리 / 가드레일

- **Node 없음/구버전(<22)** → 버전매니저 감지 후 **승인 받아 22/24 LTS 설치**(§6 ①-b). **PATH 갱신 실패 시** 절대경로 호출 또는 셸 재시작 후 재실행 안내. 설치 실패 시에만 중단·수동 링크.
- **기밀 게이트(⑤) 위반** → **fail-closed: 색인 전 차단**. 사용자가 `.gitignore` 수정 + `git rm --cached`로 추적 해제(또는 저장 위치 변경)해 해소한 뒤에만 진행. (`.gitignore`는 이미 추적된 파일을 보호하지 못하므로 추적 여부를 직접 확인.)
- **공급망/재현성** → `npm ci`(lockfile), 모델 ID·revision 고정. 셋업 후 `transformers env.allowRemoteModels=false`(모델 캐시 사전 확보, 최초 셋업에서만 원격 허용). 파일 단위 SHA 체크섬은 §13 후속.
- **모델 다운로드 실패** → 캐시 경로·재시도 안내.
- **PGlite 동시 접근** → ingest는 **단일 writer 파일 lock**(`.pgdata` 옆 lockfile); 잠겨 있으면 대기/중단, stale lock(프로세스 부재·timeout) 정리. PGlite는 임베디드 단일 프로세스 DB이므로 **동일 `.pgdata`에 대한 ingest 쓰기와 query 읽기를 직렬화**(동시 핸들 충돌 방지). query는 읽기 전용.
- **인덱스 폐기** → `reset/purge` 명령으로 `.pgdata`/`.cache` 폐기 가능. (보존기간·로그 redaction은 §13.)
- **검색 결과 안전(SKILL.md 규율)** → 검색 문서는 **비신뢰 데이터**로 취급. 근거(유사도·출처) 부족 시 추측 금지·**abstain**. 의료 판단·환자 발신은 검색 결과만으로 자동 실행 금지·**별도 승인 필수**. (문서 내 프롬프트 인젝션 정밀 방어는 §13.)
- **HITL 규율** → 메모리는 *무엇이 정해졌는지*만 알려준다. 금전·계약·외부 발신·신규 등록·권한 확장 등 비가역 행위는 검색 결과를 근거로 자동 실행 금지.

## 10. 테스트 / 검증

- **런타임 준비**: Node 부재/구버전 환경에서 ①-b가 버전매니저 감지·제안, 승인 후 `node -v ≥ 22` 반환 확인.
- **기밀 게이트(fail-closed)**: 이미 `git`에 추적 중인 `knowledge/` 파일 → 색인 **차단**됨을 확인.
- **라운드트립 스모크**: 셋업 → ingest → ask, 각 프리셋의 **기대 source/heading이 top-k에 등장**하는지 확인(유사도는 참고).
- **멱등성·재색인**: 두 번째 ingest는 대부분 스킵 / 중단 후 재실행 resume / 파일 삭제→orphan 제거 / 파일 이동→중복 없음 / `embedding_fingerprint` 불일치→전체 재구축.
- **경로/인코딩**: 한글·공백 경로에서 정상 색인.
- **명령 계약**: ingest/query/status의 exit code(0/비0)·`--json` 출력 존재.
- **타입 필터**: `--type knowledge`로 소스 범위 좁힘.
- (3-OS CI 매트릭스·손상 DB 복구·정량 골든셋 평가는 §13.)

## 11. 마켓플레이스 통합

- `plugins/bnviit-rag/.claude-plugin/plugin.json` + `LICENSE`(MIT) 신설.
- `.claude-plugin/marketplace.json`의 `plugins[]`에 `bnviit-rag` 추가.
- `README.md`에 **2단계 설치** 명시: **1단계** `/plugin install bnviit-rag@bnviit-skill-marketplace` → **2단계** `/bnviit-setup`(또는 "비앤빛안과를 위한 스킬을 설치하라"). 리포 README의 라이선스 표기를 공개 배포와 일치시킨다.

## 12. 결정 기록 (Resolved)

- **도구 실행 방식** = **플러그인 번들 `rag/`를 직접 실행**(사용자 영역엔 `.pgdata`/`.cache` 데이터만 생성) → 사용자 파일 비손상. 복사가 불가피하면 `.bak` 백업 + 버전 비교 규율(§6 ②).
- **라이선스** = 공개 배포용 **MIT**. 복제 전 기밀 흔적 스캔(§4.1).
- **경로 우선순위** = CLI 인자 > 환경변수 > 탐지 기본값.
- **Node 정책** = 22 또는 24 LTS(20 EOL 제외).
- **knowledge 배포 범위** = 이번 라운드는 *현재 작업폴더에 `knowledge/` 존재*를 가정. 타 작업자 머신 배포(별도 채널)는 후속.
- **이름** = 플러그인 `bnviit-rag`, 스킬 `bnviit-memory`, 슬래시 접두어 `/bnviit-*`.

## 13. 범위 밖 / 후속 (Out of Scope)

### 13.1 검증·운영 강화 (이번 설계에 정책만 박고 구현·검증 단계로 연기)
- 정량 검색 품질 평가(골든셋 **Recall@k / MRR**) — 0.8 휴리스틱·기대 heading 검증을 회귀 테스트로 대체.
- **3-OS CI 매트릭스**(macOS/Windows/Linux) — 한글 경로·Windows PATH·PGlite 환경 의존 실패 검출.
- npm **postinstall 스크립트 감사**(`--ignore-scripts` 등), 파일 단위 SHA 체크섬 검증.
- 도구 복사 시 **manifest 기반 원자적 설치·롤백**(번들 직접 실행 채택으로 우선순위 낮음).
- 보존기간·로그 redaction 정책.

### 13.2 후속 기능
- **에이전트 정의(`agents/`)** — AG-01~09 직원 에이전트 정의는 후속 라운드(이번 RAG 위에 얹음).
- **각 임무 수행 스킬 추가 제작** — `knowledge/11-skill-building-implications.md`의 스킬 카탈로그(예: `patient-faq-reply`·`consult-personalizer`·`noshow-reminder-writer`·`postop-care-scheduler`·`satisfaction-monitor`·`weekly-pmo-report`·`issue-escalation-classifier`·`overseas-channel-router`·`pii-masker`·`medical-safety-checker` 등)를 **이 RAG 지식 기반 위에 후속 제작**한다. 본 RAG(`bnviit-memory`)는 그 임무 스킬들이 정의서·정책·SOP·지식과 일관되게 동작하도록 컨텍스트를 공급하는 **공통 의미검색 기반(전제 인프라)** 이다. 각 임무 스킬은 §2 5대 원칙·HITL을 따르며, 그중 Desktop/Chrome 의존 스킬은 아래 항목대로 연동학습으로 예약한다.
- **Desktop Use / Chrome Browser Use 의존 스킬**(카카오톡·WeChat·LINE·Zalo·인스타 DM·네이버 톡톡 등 API/MCP 부재 채널) — **스킬 초기화 시 "연동학습(teach/연동)"으로 예약**. 이번 자동화 배선 대상 아님.
- **MCP 서버화** — 에이전트가 RAG를 도구로 직접 질의하는 형태는 후속.
- **문서 내 프롬프트 인젝션 정밀 방어** — 검색 문서 비신뢰 취급의 정교화.

## 14. 변경 이력

| 버전 | 날짜 | 요약 |
|---|---|---|
| v1 | 2026-06-29 | 최초 설계(셋업 플로우·명령어·Node 자동설치 추가) |
| v2 | 2026-06-29 | 자체(3렌즈)+codex 리뷰 1라운드 반영 — 기밀 가드 fail-closed 전진, 부트스트랩 2단계, Node 22/24, 번들 직접 실행, 임베딩 fingerprint·DB 스키마·멱등성·writer lock·status 도구·abstain·라이선스 게이트. (defer 항목 §13) |
