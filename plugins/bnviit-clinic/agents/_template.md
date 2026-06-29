---
name: ag-00-template
display_name: 임무 에이전트 템플릿 (비앤빛 안과)
version: 0.1.0
status: draft
description: >-
  임무 에이전트 정의의 정본 스키마 템플릿이다. 새 에이전트를 만들 때 이 파일을 복제해
  frontmatter 키와 본문 11섹션을 채운다. (이 템플릿 자체는 subagent로 호출하지 않는다 —
  실제 에이전트는 이 `description`을 "언제 이 에이전트를 호출하는지"로 구체화해야 한다.)
owner: clinic-ops-team
tools: []
model: ""
tags: [template, schema]
---

# 임무 에이전트 템플릿 (_template)

> **이 파일의 지위**: `plugins/bnviit-clinic/agents/` 디렉터리에 두는 모든 임무 에이전트 `.md`의
> **정본 스키마**다. 설계 spec §5의 명세를 자기완결로 vendored 복제한 것이며, 외부
> `seoulventures-office/agents/_template.md`에 의존하지 않는다(본 repo에 부재, 검증됨).
> 새 에이전트는 이 파일을 복제한 뒤 frontmatter와 아래 11섹션을 모두 채워 작성한다.

> **이 템플릿은 채우기용 골격이다.** 대괄호 `[...]` placeholder와 `<knowledge 참조>` 표기는
> 실제 값으로 치환한다. 단, **개인 실명·이메일·주민번호·개인 연락처·KPI 목표값**은 공개 파일에
> 넣지 않는다 — 역할/팀 슬러그·지표 슬러그·`<knowledge 참조>` placeholder만 사용한다.

---

## frontmatter 키 (정본)

에이전트 `.md`는 **(1) Claude Code subagent 호환 frontmatter + (2) 운영 정의 11섹션 본문**으로
구성된다. 아래는 frontmatter 키의 정본이다.

| 키 | 타입 | 필수 | 비고 |
|---|---|---|---|
| `name` | string (slug) | **필수** | subagent 식별자. 예: `ag-02-medical-counsel`. |
| `description` | string | **필수** | **subagent 트리거 설명** — 없으면 subagent가 동작하지 않는다. "언제 이 에이전트를 호출하는지"를 명시한다. |
| `tools` | string[] | 선택 | 미지정 시 전체 도구 상속. **최소 권한 원칙상 명시 권장.** |
| `model` | string | 선택 | 미지정 시 상위 모델 상속. |
| `display_name` | string | 선택(운영) | 예: `의료 상담 에이전트 (비앤빛 안과)`. |
| `version` | string (semver) | 선택(운영) | 예: `0.1.0`. |
| `status` | enum: `draft`\|`review`\|`active`\|`deprecated` | **필수(운영)** | 라이프사이클 상태(README 참조). |
| `owner` | string (역할/팀 슬러그) | **필수(운영)** | **개인 실명·이메일 금지.** 예: `clinic-ops-team`. 구체 담당자 매핑은 로컬 `knowledge/`. |
| `tags` | string[] | 선택 | 분류용. |

> **subagent 런타임 vs 운영 메타**: `name`·`description`만이 subagent 동작 **필수 키**다.
> `display_name`·`version`·`status`·`owner`·`tags`는 본 repo의 **운영 메타**로, subagent
> 런타임은 무시한다(검증·추적 용도). 그래도 본 repo 정책상 `status`·`owner`는 필수다.

---

## 본문 11섹션 (정본)

아래 11섹션을 순서대로 채운다. (필수)/(선택) 표기를 따른다.

### 1. 역할 (Role) — (필수)

[에이전트의 한 줄 정의와 책임 범위를 적는다. 예: "비앤빛 안과 환자 1차 상담을 담당하는
정보 제공·예약 연결 에이전트."]

### 2. R&R (Responsibilities) — (필수)

**수행 업무**
- [이 에이전트가 수행하는 업무를 나열한다. 예: 환자 FAQ 초안 작성, 예약 연결 안내.]

**금지 업무**
- [명시적으로 하지 않는 업무를 나열한다. 예: 확정적 의료 판단·진단, 승인 없는 외부 발신.]

### 3. 권한 (Permissions) — (필수)

> **문서적 계약 고지(중요)**: 본 섹션의 '권한' 선언과 §8의 '에스컬레이션' 선언은
> **문서적 계약일 뿐 런타임 제한이 아니다.** 실제 도구 접근·게이트 순서·발신 차단의 **강제**는
> 이 에이전트를 호출하는 **상위 command/skill 오케스트레이션**이 담당한다(§5.3 / 본 README의
> "오케스트레이션 게이트 계약" 참조). 본문은 그 계약을 **문서화**할 뿐이다.

| 구분 | 범위 |
|---|---|
| 허용 도구 | [frontmatter `tools`와 일치시킨다. 예: patient-faq-reply 스킬 호출.] |
| 읽기 | [예: 공개 knowledge 색인 결과(마스킹된 검색 결과만).] |
| 쓰기 | [예: HITL 큐에 올릴 **초안(draft)** 생성. 직접 외부 발신 금지.] |
| 실행 | [예: 결정론적 `preprocess.mjs`(비-LLM) 호출.] |
| 금지 행위 | [예: 마스킹 우회, 검수 게이트 우회, 승인 없는 환자 발신, 원문 PII의 RAG/외부 전달.] |

### 4. 도구 (Tools) — (필수)

- **호출 스킬**: [예: `patient-faq-reply`.]
- **외부 API / 서비스**: [예: RAG 슬래시 위임 `/bnviit-rag:bnviit-ask`(§6.1). 없으면 "없음".]

### 5. SOP (표준 운영 절차) — (필수)

1. [단계별 표준 절차를 적는다. 환자 발신 경로라면 ①②결정론적 전처리(preprocess.mjs) →
   ③마스킹된 질의로만 RAG → ④안전·PII 검수 → ⑤HITL 승인 큐 순서를 명시한다.]
2. [...]

### 6. 메모리 (Memory) — (선택)

[세션 내/외 상태 저장 방식을 적는다. 환자 식별정보는 저장·색인하지 않는다(§6.4 상류 차단).
해당 없으면 "세션 외 상태 보존 없음".]

### 7. KPI — (선택)

| 지표(슬러그) | 목표값 |
|---|---|
| [예: `first-response-latency`] | `<knowledge 참조>` |
| [예: `hitl-pass-rate`] | `<knowledge 참조>` |

> **목표값은 공개 파일에 넣지 않는다** — 반드시 `<knowledge 참조>` placeholder로 둔다.

### 8. 에스컬레이션 (Escalation) — (필수)

| 트리거 | 대상(역할명) | 경로 |
|---|---|---|
| [예: 응급 증상 감지] | [예: `clinical-staff`(의료진)] | [예: emergency-template + HITL 즉시 알림] |
| [예: 검수 게이트 차단] | [예: `pmo-reviewer-role`] | [예: 차단 사유와 함께 에스컬레이션] |

> 대상은 **역할명/팀 슬러그만** 적는다(개인 실명·연락처 금지). HITL 큐 연동을 명시한다.

### 9. 실패 모드 (Failure Modes) — (필수)

- **fail-closed 기본**: [게이트·전처리·RAG 오류 시 **환자 발신을 차단**한다. 예: 마스킹
  `maskingStatus !== "ok"`면 RAG·답변 진행 차단.]
- **RAG 4상태**(§6.2): [(a) unavailable·(b) 색인 없음 → 발신 차단 + 진단/색인 안내;
  (c) 근거 부족 → abstain + 직원/의료진 연결; (d) 정상 → 출처 인용 후 계속.]
- **전처리 프로세스 실패**: [비정상 종료·timeout·파싱 불가 시 RAG/답변 차단 + 보수적
  응급 폴백(emergency-template + HITL).]

### 10. 의존성 (Dependencies) — (필수)

- **호출 스킬**: [예: `patient-faq-reply`, `medical-safety-checker`, `pii-masker`.]
- **플러그인**: [예: `bnviit-rag`(슬래시 위임 경로).]
- **외부 서비스**: [예: HITL 승인 큐. 없으면 "없음".]

### 11. 이력 (Changelog) — (필수)

| 버전 | 날짜 | 변경 요약 |
|---|---|---|
| 0.1.0 | YYYY-MM-DD | [최초 작성 요약.] |
