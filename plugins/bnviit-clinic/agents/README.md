# 임무 에이전트 (`agents/`)

비앤빛 안과 임무 에이전트 정의 디렉터리다. 각 에이전트는 **Claude Code subagent 호환
frontmatter + 운영 정의 11섹션 본문**으로 구성된 단일 `.md` 파일이다. 스키마 정본은
[`_template.md`](./_template.md)이며, 새 에이전트는 이 템플릿을 복제해 작성한다.

## 디렉터리 구성

| 파일 | 설명 |
|---|---|
| `_template.md` | 정본 스키마 템플릿(frontmatter 키 + 본문 11섹션). 자기완결, 외부 의존 없음. |
| `ag-NN-<slug>.md` | 개별 임무 에이전트 정의(아래 명명 규칙). |

> `_template.md`는 골격이므로 subagent로 호출하지 않는다(이름 `ag-00-template`,
> `status: draft`). 실제 동작하는 에이전트만 `active` 상태로 둔다.

## 명명 규칙

- 파일명·`name` frontmatter = 슬러그: **`ag-NN-<역할-슬러그>`**
  - `ag` 접두어 + 2자리 시퀀스 번호(`NN`) + 케밥케이스 역할 슬러그.
  - 예: `ag-02-medical-counsel`, `ag-03-operations`, `ag-08-pmo-reviewer`.
- 파일명과 frontmatter `name`은 **항상 동일**하게 유지한다(확장자 `.md` 제외).
- 시퀀스 번호는 조직 임무 번호 체계를 따르며 재사용하지 않는다.

## 에이전트 표 (정본 §5.3)

| 에이전트 | 역할 | 호출 스킬 | HITL |
|---|---|---|---|
| `ag-02-medical-counsel` | 1차 상담·정보 제공·예약 연결 | `patient-faq-reply` | 의료 판단·외부 발신은 draft + 승인 |
| `ag-03-operations` | 알림톡·케어 발송·일일보고 | `postop-care-scheduler` | 발송 승인 |
| `ag-08-pmo-reviewer` | 전 산출물 안전·PII 검수, 주간 보고 | `medical-safety-checker`·`pii-masker`·`weekly-pmo-report` | 차단 시 에스컬레이션 |

## 상태 라이프사이클 (`status`)

frontmatter `status`는 다음 enum을 따른다.

| 상태 | 의미 | 전이 |
|---|---|---|
| `draft` | 초안 작성 중. 운영 미사용. | → `review` |
| `review` | 검토·검수 대기. 오케스트레이션 연결 전. | → `active` 또는 → `draft`(반려) |
| `active` | 운영 중. 상위 워크플로가 호출 가능. | → `deprecated` |
| `deprecated` | 폐기 예정·대체됨. 신규 호출 금지. | (보관) |

전이 시 `version`(semver)을 올리고 본문 §11 이력 표에 변경 요약을 기록한다.

## 오케스트레이션 게이트 계약 (중요)

- **subagent는 다른 subagent를 직접 호출하지 않는다**(Claude Code 미지원). 게이트 순서는
  에이전트 간 직접 호출이 아니라 **상위 워크플로/skill(command)이 오케스트레이션**한다:
  1. 상위 워크플로가 `ag-03-operations`를 호출해 환자 발신 산출물 초안을 받는다.
  2. 같은 워크플로가 그 산출물을 `ag-08-pmo-reviewer`(medical-safety-checker·pii-masker)
     검수 게이트에 통과시킨다.
  3. 검수 통과 시에만 HITL 승인 큐로 올린다.
- 에이전트 본문의 '권한'·'에스컬레이션' 선언은 이 순서의 **문서적 계약**일 뿐이며,
  **강제·검증 책임은 상위 워크플로(및 테스트)에 있다**. 게이트 우회 차단은 런타임 권한이
  아니라 **오케스트레이션 설계**로 보장한다.

## 공개 파일 기밀 정책

이 디렉터리는 **공개 마켓플레이스에 푸시되는 파일**이다. 다음은 본문·frontmatter 어디에도
넣지 않는다.

- 개인 실명·이메일(`owner`는 역할/팀 슬러그만), 주민번호, 개인 연락처.
- KPI 목표값(지표 슬러그만 두고 목표값은 `<knowledge 참조>` placeholder).
- 환자 식별정보(성명·연락처·생년월일 등) 및 그것을 담은 파일명·헤딩.

구체 담당자 매핑·KPI 목표값·환자 데이터는 로컬 `knowledge/`(gitignored)에 둔다.
