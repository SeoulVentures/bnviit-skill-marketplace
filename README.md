# bnviit-skill-marketplace

비앤빛 안과(BNVIIT)의 **Claude Cowork**를 위한 스킬 마켓플레이스입니다.
환자 상담·수술 후 케어·운영 보고 등 병원 업무를 돕는 Claude Code 스킬·에이전트를 플러그인 형태로 모아 배포합니다.

> 📖 **작업자용 통합 사용 매뉴얼: [docs/MANUAL.md](docs/MANUAL.md)** — 설치부터 환자 문의 처리 흐름까지 단계별 안내.

---

## 플러그인

| 플러그인 | 역할 | 핵심 |
|---|---|---|
| **[`bnviit-rag`](plugins/bnviit-rag)** | 로컬 지식 RAG | 비앤빛 업무 지식을 PGlite+pgvector로 색인해 **의미 검색**(외부 송출 0, 로컬 임베딩) |
| **[`bnviit-clinic`](plugins/bnviit-clinic)** | 임무 스킬·에이전트·연동학습 | 환자 FAQ·수술후 케어·PMO 보고 + **의료안전/PII 게이트**, Desktop/Chrome **연동학습(teach)** |

## 빠른 시작

### 1) 마켓플레이스 등록
```
/plugin marketplace add SeoulVentures/bnviit-skill-marketplace
```

### 2) 플러그인 설치
```
/plugin install bnviit-rag@bnviit-skill-marketplace
/plugin install bnviit-clinic@bnviit-skill-marketplace
```

### 3) RAG 셋업(지식 색인)
```
/bnviit-rag:bnviit-setup      (또는 "비앤빛안과를 위한 스킬을 설치하라")
```
> Node 22/24 런타임 준비 → 도구 설치 → **색인 전 기밀 게이트**(공개 노출 방지) → 지식 색인 → 검증까지 한 번에. 데이터·인덱스는 작업자 로컬에만 생성됩니다.

### 4) 사용
- 지식 검색: `/bnviit-rag:bnviit-ask "질문"` · 재색인 `/bnviit-rag:bnviit-ingest` · 현황 `/bnviit-rag:bnviit-status`
- 환자 문의 답변: **`patient-faq-reply`** 스킬(예: "환자 문의 답변 써줘")
- 수술후 케어 스케줄: `postop-care-scheduler` · 주간 보고: `weekly-pmo-report`
- 채널 연동학습: `/bnviit-clinic:bnviit-teach <채널> <작업>` · 보조 재생 `/bnviit-clinic:bnviit-teach-replay <채널> <작업>`

자세한 흐름·옵션·안전 규율은 **[사용 매뉴얼](docs/MANUAL.md)** 참조.

## 커맨드·스킬 한눈에

> 커맨드는 `/<플러그인>:<커맨드>` 네임스페이스로 호출합니다(예: `/bnviit-rag:bnviit-setup`, `/bnviit-clinic:bnviit-teach`).

**bnviit-rag** — 커맨드: `/bnviit-rag:bnviit-setup` · `/bnviit-rag:bnviit-ingest` · `/bnviit-rag:bnviit-ask` · `/bnviit-rag:bnviit-status` / 스킬: `bnviit-memory`

**bnviit-clinic**
- 임무 스킬: `patient-faq-reply` · `medical-safety-checker` · `pii-masker` · `postop-care-scheduler` · `weekly-pmo-report`
- 에이전트: `ag-02-medical-counsel` · `ag-03-operations` · `ag-08-pmo-reviewer`
- 연동학습 커맨드: `/bnviit-clinic:bnviit-teach` · `/bnviit-clinic:bnviit-teach-replay` / 스킬: `channel-teach`

## 안전 원칙 (요약)

- **사람 우선(HITL)**: 환자 발신·금전·외부 전송은 **사람이 최종 클릭**. 자동 발송 금지.
- **fail-closed**: 게이트 실패·오류·미설치 시 환자 발신을 **차단**하고 직원 연결로 폴백. 근거 부족 시 **abstain**.
- **개인정보 보호**: 환자 원문은 외부 송출(RAG·발신·저장·로그) 전 **결정론적 마스킹**, 입력·출력 양방향 마스킹.
- **기밀 분리**: 담당자명·KPI 목표값·환자 데이터 등 기밀은 공개 플러그인에 넣지 않고 로컬 `knowledge/`(gitignored)에. 공개 문서엔 역할명·placeholder만.
- **연동학습은 합성 데이터 전용**: 실환자 화면 학습 금지, 전송 동작은 학습·재생에서 영구 제외.

## 저장소 구조

```
bnviit-skill-marketplace/
├── .claude-plugin/marketplace.json     # 마켓플레이스 정의(플러그인 목록)
├── plugins/
│   ├── bnviit-rag/                     # 로컬 RAG
│   │   ├── commands/                   # /bnviit-rag:bnviit-setup·ingest·ask·status
│   │   └── skills/bnviit-memory/
│   │       └── rag/                    # PGlite+pgvector 도구(ingest·query·status·lib)
│   └── bnviit-clinic/                  # 임무 스킬·에이전트·연동학습
│       ├── commands/                   # /bnviit-clinic:bnviit-teach·teach-replay
│       ├── skills/                     # patient-faq-reply·medical-safety-checker·pii-masker·postop-care-scheduler·weekly-pmo-report·channel-teach
│       ├── agents/                     # ag-02·ag-03·ag-08 + _template
│       ├── teach/                      # channels.json·replay.schema.json·validate.mjs
│       └── test/                       # mission-docs·teach-docs 테스트
├── docs/
│   ├── MANUAL.md                       # 작업자용 통합 사용 매뉴얼
│   └── superpowers/                    # specs/(설계)·plans/(구현 계획) 문서
├── .github/workflows/ci.yml            # OS×Node 매트릭스 + 문서/매니페스트 검증
└── README.md
```

> 기밀 지식 인덱스(`knowledge/`)·연동학습 산출물(`.bnviit-teach/`)은 이 리포 `.gitignore`로 제외됩니다. RAG 데이터·캐시(`.pgdata`·`.cache`)는 셋업 시 **작업자 프로젝트 루트**에 생성되므로 이 리포 루트 `.gitignore`가 자동 제외하지는 않습니다 — 셋업의 **기밀 게이트가 git 추적·클라우드 동기화를 감지하면 색인을 차단**하며, 작업자 리포 `.gitignore`에 `.pgdata/`·`.cache/` 추가를 권장합니다.

## 개발

- 테스트: 모델-free 단위 테스트는 CI(`.github/workflows/ci.yml`)가 **파일을 명시해** 실행합니다(예: `node --test lib/config.test.mjs lib/sources.test.mjs …`). 인자 없는 `node --test`는 모델 다운로드가 필요한 smoke 테스트까지 탐색하므로, 로컬에서도 CI와 동일한 파일 목록으로 실행하세요(RAG 도구는 `plugins/bnviit-rag/skills/bnviit-memory/rag`에서 `npm ci` 후). 모델 smoke(ingest/query)는 `RAG_ALLOW_DOWNLOAD=1`로 별도 실행합니다.
- CI: GitHub Actions — `rag-unit`(macOS/Ubuntu/Windows × Node 22/24)·`clinic-docs`·`plugin-docs`·`json-validate`.

### 새 스킬 추가
플러그인의 `skills/<skill-name>/SKILL.md`를 만들고 frontmatter에 `name`·`description`(트리거 문구)을 작성합니다.

### 새 플러그인 추가
`plugins/<plugin-name>/.claude-plugin/plugin.json`을 만들고 `.claude-plugin/marketplace.json`의 `plugins` 배열에 `{ "name", "source", "description" }`를 추가합니다.

## 라이선스

내부 사용 (SeoulVentures / 비앤빛 안과). RAG 도구 코드(`plugins/bnviit-rag/...`)는 MIT.
