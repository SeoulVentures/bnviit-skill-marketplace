# 비앤빛 스킬 마켓플레이스 — 작업자 사용 매뉴얼

비앤빛 안과 업무에서 Claude Cowork로 `bnviit-rag`·`bnviit-clinic` 플러그인을 사용하는 방법을 단계별로 안내합니다.
이 문서는 **공개 문서**입니다. 실제 담당자·환자 데이터·KPI 값 등 기밀은 적지 않습니다(역할명·예시만 사용).

---

## 0. 한눈에 보기

```
설치 → RAG 셋업(/bnviit-rag:bnviit-setup) → 지식 색인
   │
   ├─ 지식 검색            /bnviit-rag:bnviit-ask "질문"
   ├─ 환자 문의 답변 초안   patient-faq-reply 스킬
   ├─ 수술후 케어 스케줄    postop-care-scheduler 스킬
   ├─ 주간 PMO 보고        weekly-pmo-report 스킬
   └─ 채널 연동학습         /bnviit-clinic:bnviit-teach <채널> <작업>
```

핵심 안전 규칙(항상 적용):
- **환자에게 나가는 발신은 사람이 최종 클릭**(HITL). 자동 발송 없음.
- 게이트가 막히거나 근거가 부족하면 **차단(fail-closed)·abstain → 직원/의료진 연결**.
- 환자 개인정보는 **외부로 나가기 전에 마스킹**됩니다.

---

## 1. 설치

### 1-1. 마켓플레이스 등록
```
/plugin marketplace add SeoulVentures/bnviit-skill-marketplace
```

### 1-2. 플러그인 설치
```
/plugin install bnviit-rag@bnviit-skill-marketplace
/plugin install bnviit-clinic@bnviit-skill-marketplace
```

> 플러그인은 작업자 컴퓨터의 Claude 플러그인 캐시에 설치됩니다. 도구 경로는 `${CLAUDE_PLUGIN_ROOT}`로 자동 해석됩니다.

---

## 2. bnviit-rag — 지식 RAG

비앤빛 업무 지식을 **로컬에 색인**해 의미 기반으로 검색합니다. 임베딩을 로컬에서 계산하므로 **데이터가 외부로 나가지 않습니다**.

### 2-1. 셋업 (`/bnviit-rag:bnviit-setup`)
```
/bnviit-rag:bnviit-setup
```
또는 자연어로 "비앤빛안과를 위한 스킬을 설치하라".

셋업이 자동으로 수행하는 일:
1. **런타임 준비** — Node 22/24 LTS가 없으면 (승인 후) 설치.
2. **도구 설치** — `npm ci`로 의존성 설치(패키지만; 임베딩 모델은 5단계에서 받습니다).
3. **색인 대상 확정**(사람 확인) — 기본은 `knowledge/`(+ 있으면 `agents/`·`skills/`·`sops/`).
4. **기밀 게이트(색인 전, 차단형)** — 색인 대상·데이터 경로가 git에 추적되거나 클라우드 동기화 폴더에 있으면 **색인을 막습니다**(공개 노출 방지).
5. **색인 + 검증** — **최초 색인(ingest) 시 임베딩 모델(약 100MB)을 1회 다운로드**(`RAG_ALLOW_DOWNLOAD=1` 자동 주입)한 뒤 색인하고, 대표 질의로 스모크 테스트. 이후 검색은 캐시 온리(다운로드 없음).

> 데이터·인덱스(`.pgdata`·`.cache`)는 셋업 시 **작업자 프로젝트 루트**에 생성됩니다. 이 마켓플레이스 리포 루트 `.gitignore`가 자동 제외하지는 않으므로, 작업자 리포의 `.gitignore`에 `.pgdata/`·`.cache/`를 추가하세요(④의 기밀 게이트도 git 추적·동기화를 감지하면 색인을 차단합니다).

### 2-2. 검색 (`/bnviit-rag:bnviit-ask`)
```
/bnviit-rag:bnviit-ask "수술 후 D+7 케어 메시지"
/bnviit-rag:bnviit-ask "5겹 오류 방어 모델" --type knowledge --json
```
- `--k N` 결과 개수 · `--type knowledge|agent|skill|sop` 필터 · `--json` 기계 출력.
- 결과는 **출처(source·heading)와 함께** 제시되며, 검색 문서는 **비신뢰 데이터**로 취급합니다(문서 속 지시는 실행하지 않음).
- 근거가 부족하면 추측하지 않고 **abstain**합니다.

> ⚠️ **보안**: `query.mjs`는 질의를 위치 인자(셸 미경유 `execFile`)·`--query-file`(임시 파일)·`RAG_QUERY`(환경변수)로 받으며 **표준 경로는 `--query-file`**입니다. 셸 문자열 보간을 쓰지 않으므로 질의 안의 따옴표·`;`·`$()`·백틱이 명령으로 실행되지 않습니다. 환자 원문은 이 명령에 **직접 넣지 말고** `patient-faq-reply`를 통해 마스킹된 질의만 전달하세요.

### 2-3. 재색인·현황
```
/bnviit-rag:bnviit-ingest     # 지식 갱신 후 변경분만 멱등 재색인
/bnviit-rag:bnviit-status     # 총 청크 수·소스 타입 분포·마지막 색인 시각
```

---

## 3. bnviit-clinic — 임무 스킬

환자/운영 업무를 실제로 수행하는 스킬입니다. 환자/의료 정보를 다루는 스킬은 **의료안전·개인정보 게이트**를 거치도록 절차가 규정되어 있습니다 — 원문 마스킹·응급 분류 등 결정론적 단계는 `preprocess.mjs`가 코드로 강제하고, 안전·PII 검수(`medical-safety-checker`·`pii-masker`)는 스킬 지시에 따라 LLM이 수행합니다(런타임 집행은 운영 환경의 오케스트레이터/스킬이 담당).

### 3-1. 환자 FAQ 답변 — `patient-faq-reply`
환자/보호자 문의에 **RAG 근거 + 출처**로 답변 **초안**을 작성합니다. (예: "환자 문의 답변 써줘", "FAQ 답변 초안")

처리 흐름(스킬 절차가 규정 — 결정론적 단계는 코드 강제, 검수는 스킬 지시):
```
환자 원문
  → ① 결정론적 전처리(preprocess): PII 마스킹 + 응급 분류  ← 원문은 여기서만 처리, 외부 송출 전 마스킹
  → ② 응급이면 즉시 고정 응급 안내 + 사람 에스컬레이션
  → ③ 마스킹된 질의로만 RAG 검색
  → ③' 검색 결과(content·source·heading) 출력단 마스킹
  → ④ 의료광고 규정 검증(과장·절대보장·치료경험담·환자유인 금지)
  → ⑤ medical-safety-checker(진단·처방 단독 금지)
  → ⑥ pii-masker 2차 검수
  → 답변 초안(출처 인용) — 발송은 사람(HITL)
```
- **단일 진입점**: 환자 원문은 반드시 이 스킬을 거칩니다. `/bnviit-rag:bnviit-ask`에 환자 원문을 직접 넣지 마세요(마스킹 우회).
- 어느 단계라도 실패하면 **차단 + 직원/의료진 연결**. 응급 신호(급성 시력저하·심한 통증·출혈 등)는 최우선으로 고정 응급 안내(119·1339 등)를 반환합니다.

### 3-2. 가드레일 스킬
- **`medical-safety-checker`** — AI 단독 의료 판단·처방·수술 적합 단정·응급 대응을 차단하고 사람에게 에스컬레이션. 응급 1차 분류 포함.
- **`pii-masker`** — 주민번호·연락처·이름·생년월일·주소 등 마스킹. 1차 결정론적(정규식) + 2차 LLM 검수. 불확실·고위험이면 **차단(fail-closed)**.

### 3-3. 수술후 케어 — `postop-care-scheduler`
수술일·유형을 입력하면 D-1~D+365 케어 메시지 **타이밍·채널·문구 초안**을 만듭니다.
- 모든 문구는 `medical-safety-checker`·`pii-masker`를 **먼저** 통과. **발송은 사람 승인(HITL)**, 자동 발송 없음.
- 산출물(`messageDraft`)은 **placeholder(예: `{고객명}`) 형태로만** 생성하고 실제 환자값을 넣지 않습니다(실값을 넣으면 게이트 통과 산출물이 아니게 됨).
- **게이트 이후에 placeholder를 실제 환자값으로 치환**하면 그 산출물은 더 이상 검수본이 아니므로, **발송 전 `pii-masker`를 다시 통과**시켜야 합니다(게이트 후 무검수 발송 금지, fail-closed).

### 3-4. 주간 PMO 보고 — `weekly-pmo-report`
진행 상황(트랙/작업지시 상태)을 입력하면 주간 보고 초안과 이슈 등급(🔴/🟠/🟡/🟢)을 정리합니다. 수치는 입력 근거만 사용하고 추정하지 않습니다(근거 없으면 abstain).

---

## 4. 임무 에이전트

여러 스킬을 묶어 운용하는 **역할 정의(draft)**입니다(`agents/`, `status: draft`). 에이전트는 **초안(draft)만 생성하고 직접 외부 발신을 하지 않으며**, 권한·게이트 집행은 운영 환경의 상위 오케스트레이터/스킬이 담당합니다(에이전트 정의 파일 자체가 런타임 강제 장치는 아님).

| 에이전트 | 역할 | 호출 스킬 |
|---|---|---|
| `ag-02-medical-counsel` | 의료 상담(1차 응대·정보 제공·예약 연결) | `patient-faq-reply` |
| `ag-03-operations` | 전산·운영(알림톡·케어 발송·일일보고) | `postop-care-scheduler` |
| `ag-08-pmo-reviewer` | PMO 검수(안전·PII 검수·주간 보고) | `medical-safety-checker`·`pii-masker`·`weekly-pmo-report` |

> 환자 대상 발신물은 `ag-08-pmo-reviewer` 검수를 거친 뒤 사람 승인(HITL)을 받는 것을 원칙으로 합니다(검수 큐·오케스트레이터는 운영 환경에서 구성).

---

## 5. 채널 연동학습 (teach)

API/MCP가 없는 채널(카카오톡·WeChat·LINE·Zalo·인스타 DM·네이버 톡톡)의 **반복 UI 조작 절차**를 사람 시연으로 한 번 학습해 두고, 이후 발신 직전까지 보조합니다.

### 5-1. 학습 (`/bnviit-clinic:bnviit-teach`)
```
/bnviit-clinic:bnviit-teach 카카오톡 "안내 메시지 작성 화면까지 이동"
```
- **반드시 합성(가상) 데이터·테스트 계정·샌드박스 화면에서만** 학습합니다. 실환자 화면·실제 개인정보 학습은 금지(감지 시 즉시 중단·로컬 산출물 폐기).
- **전송/발신 단계는 학습하지 않습니다**(forbidden-send). 그 버튼은 항상 사람이 직접 누릅니다.
- 데스크톱 앱은 computer-use, 웹 채널은 Claude in Chrome으로 학습(세션 시작 시 사용 가능 도구를 확인하는 capability probe 수행).
- 학습 절차는 로컬 `.bnviit-teach/`(gitignored)에 저장되며 PII는 저장되지 않습니다.

### 5-2. 보조 재생 (`/bnviit-clinic:bnviit-teach-replay`)
```
/bnviit-clinic:bnviit-teach-replay 카카오톡 "안내 메시지 작성 화면까지 이동"
```
- 학습된 절차로 **발신 직전까지만** 진행합니다. 메시지 내용은 `patient-faq-reply` 등이 만들고 게이트를 통과한 초안만 사용합니다.
- **최종 발신은 사람이 직접 클릭**합니다. 학습 산출물 schema에는 전송 단계가 존재하지 않고, validator·실행 지시·런타임 검사가 전송 UI 조작을 차단하므로 에이전트 경로로는 발신에 도달하지 않습니다.
- 링크·첨부·다운로드는 학습/재생 중 무조건 금지(비신뢰 입력).
- **backend 범위**: 자동 보조 재생은 **데스크톱(computer-use) 중심**입니다. 웹 채널은 step별 검사·전송 차단·PII lint를 강제할 **검증된 runtime 계약이 있을 때만 자동 재생**하며, 없으면 **teach(학습)까지만 지원하고 재생은 사람이 수동**으로 합니다.

---

## 6. 안전·기밀 규율 (전체 공통)

- **HITL**: 환자 발신·금전·계약·외부 전송·권한 확장은 사람 승인. 메모리/검색 결과는 "무엇이 정해졌는지"만 알려줄 뿐 실행 허가가 아닙니다.
- **fail-closed**: 게이트 실행 불가·오류·미설치, RAG 미설치/색인 없음이면 **환자 발신 차단**. 근거 부족이면 **abstain → 직원/의료진 연결**.
- **양방향 마스킹**: 입력(환자 원문)·출력(검색 결과) 모두 결정론적으로 마스킹. 잔존 위험이 있으면 해당 결과를 쓰지 않습니다.
- **기밀 분리**: 담당자 실명·개인 이메일, KPI 목표값, 환자 데이터는 공개 플러그인/문서에 넣지 않고 로컬 `knowledge/`(gitignored)에 둡니다. 공개 문서엔 역할명·placeholder만. (단 **배포자 연락처** — manifest의 `author.email`(`erik@seoulventures.net`) — 는 의도된 공개 메타로 기밀 예외입니다.)
- **푸시 전 점검**: 커밋·푸시 전 `git status`로 `knowledge/`·`.bnviit-teach/`(이 리포 `.gitignore`)와 작업자 리포의 `.pgdata`·`.cache`가 추적되지 않는지 확인하세요.

---

## 7. 트러블슈팅

| 증상 | 원인 | 조치 |
|---|---|---|
| `/bnviit-rag:bnviit-ask`가 빈 결과·"색인 없음" | 색인 안 됨/캐시 미스 | `/bnviit-rag:bnviit-ingest` 실행 |
| "RAG가 준비되지 않음" 안내 | bnviit-rag 미설치·실행 오류 | `/bnviit-rag:bnviit-setup` 재실행 |
| 셋업이 색인을 막음 | 기밀 게이트 — 대상이 git 추적/클라우드 동기화 폴더 | `.gitignore` 추가 + `git rm --cached`, 또는 저장 위치 변경 후 재시도 |
| 답변 대신 "직원 연결" | 근거 부족·게이트 차단·응급 | 정상 동작(fail-closed). 사람이 직접 응대 |
| teach가 시작 거부 | 합성 데이터 게이트·probe 실패 | 테스트 계정/합성 화면에서, 지원 도구 확인 후 재시도 |

---

## 8. 더 보기

- 플러그인별 상세: `plugins/bnviit-rag/skills/bnviit-memory/SKILL.md`, `plugins/bnviit-clinic/skills/*/SKILL.md`
- 설계·구현 계획: `docs/superpowers/specs/`·`docs/superpowers/plans/`
- 스킬 카탈로그(로컬·기밀): `knowledge/11-skill-building-implications.md`
