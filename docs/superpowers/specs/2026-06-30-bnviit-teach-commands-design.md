# 비앤빛 채널 연동학습(teach) 커맨드 — 설계 문서

- 날짜: 2026-06-30
- 상태: 설계 초안 → 자체+codex 리뷰(10건) 수렴 → 구현
- 작성: Claude
- 참조: computer-use MCP, claude-in-chrome MCP, 임무 스킬(bnviit-clinic), `knowledge/03·08`(채널 현황)
- 안전 등급: **의료/PII 민감 — 본 문서의 안전 불변식(invariant)은 편의 기능보다 항상 우선한다**

> 도구명 표기 규약: 본 문서에서 언급하는 computer-use/claude-in-chrome 도구명(예: `request_access`, `teach_step`, shortcut export API 등)은 **런타임에 실제로 노출되는지 확인한 뒤에만 사용**한다(§4 capability probe). 환경마다 노출 도구가 다를 수 있으므로 어떤 도구도 "항상 존재"한다고 가정하지 않는다.

---

## 1. 목표 (Goal)

**API/MCP가 없는 채널**(카카오톡·WeChat·LINE·Zalo·인스타그램 DM·네이버 톡톡 등)에서 반복되는 **UI 조작 절차**를, **사람 시연을 한 번 학습(teach)** 해 두고 이후 보조하는 **연동학습 커맨드**를 `bnviit-clinic`에 추가한다. 데스크톱 앱은 computer-use, 웹 채널은 claude-in-chrome으로 학습한다.

### 1.0 핵심 안전 전제 — 합성 데이터 전용 (가장 중요)

> **teach/replay는 합성(가상) 환자 데이터·테스트 계정·샌드박스 화면에서만 수행한다. 실환자 채널·실제 개인정보(이름·연락처·진료·예약·결제 등) 화면에서의 학습·재생은 금지한다.**

- teach가 학습하는 것은 **"어디를 어떻게 조작하는가"라는 UI 절차뿐**이다. 메시지 콘텐츠·실제 데이터와 무관하며, 콘텐츠는 임무 스킬이 별도로 생성한다.
- claude-in-chrome / computer-use로 실환자 채널을 운전하는 것은 의료정보·타인 개인정보 처리 지양 원칙과 충돌하므로, 학습은 반드시 **테스트 계정·합성 화면**에서 한다. 운영 채널 운전은 본 라운드의 범위가 아니다.
- 이 전제는 §2(핵심 원칙)·§5(플로우 게이트)·§10(가드레일)에 강제 계약으로 박혀 있으며, 위반 시 세션을 즉시 중단한다.

### 비목표
- 학습된 절차로 **자동 발송/자동 전송**은 하지 않는다(환자 발신은 항상 사람 직접 클릭). 본 라운드는 "절차 학습 + 보조 재생(발신 직전까지)"까지.
- 실제 메시지 *콘텐츠* 생성은 임무 스킬(patient-faq-reply 등)이 담당. teach는 **UI 조작 절차**만 학습.
- 실환자 채널의 무인 운전·운영 데이터 학습은 영구 비목표.

## 2. 핵심 원칙

- **합성 데이터 전용(§1.0)**: 실환자 화면·실제 PII에서 학습/재생 금지. 테스트 계정·가상 환자·샌드박스에서만.
- **전송 영구 제외(forbidden-send invariant)**: **전송/발신/전송확인(Send/제출/확인) 동작은 학습 기록·산출물·재생에서 영구히 제외**한다. 그 단계는 **오직 사람이 직접 클릭**하며 에이전트는 어떤 상황에서도(승인을 받았더라도) 그 버튼을 클릭하지 않는다. "사람 클릭 **또는** 명시 승인"이 아니라 **사람 직접 클릭만** 허용한다. 산출물 schema에는 전송 단계 자체가 존재하지 않는다(§6, §8).
- **기록 전 PII 가드(fail-closed)**: PII 보호는 기록 *후* 마스킹이 아니라 **기록 시작 전 게이트**로 강제한다. computer-use는 입력·창 내용을, Chrome은 페이지·스크린샷을 읽으므로 **한 번 기록되면 사후 마스킹으로 회수 불가**다. 따라서 세션 시작 전 합성 데이터 확인을 게이트로 두고(1차 방어), 세션 중 실환자/실개인정보 화면이 감지되면 **즉시 중단 + 로컬 산출물 폐기(purge)**한다. **purge는 로컬 파일/shortcut 삭제만 의미하며, 이미 도구/모델/외부로 전달된 화면 정보는 회수하지 못한다** — 그래서 1차 방어는 항상 기록 전 합성-데이터 게이트(§5 ②a)다(§5 ③g, §10).
- **명시적·최소 권한**: computer-use는 `request_access`(앱별 승인·티어)를 매 세션 확인하고 작업에 필요한 최소 앱만 요청한다. Chrome은 대화별 활성·사이트별 권한·permission mode가 별개이며 **Ask before acting**(매 동작 승인)·단일-action 승인·조직 allowlist를 쓰고 **Act without asking·예약 실행은 금지**한다(§5 ②b, §7).
- **링크/첨부 무조건 금지**: 메시지·DM은 prompt injection·악성 링크가 섞인 **비신뢰 입력**이다. teach/replay 중 **링크 클릭·첨부 열기·리디렉션 따라가기·다운로드는 무조건 금지**하며, 필요 시 별도의 사람이 검증한다(§10).
- **capability probe 우선**: 어떤 computer-use/chrome 도구도 "항상 존재"한다고 가정하지 않는다. 세션 시작 시 실제 노출 도구를 확인한 뒤 라우팅·폴백을 결정한다(§4).
- 학습 산출물은 **로컬·기밀**(gitignored), 공개 커맨드/문서엔 절차 가이드만.

## 3. 산출물 구조

```
plugins/bnviit-clinic/
├── commands/
│   ├── bnviit-teach.md          # 연동학습 진입 커맨드(채널·작업 인자)
│   └── bnviit-teach-replay.md   # 학습된 절차 보조 재생(발신 직전까지, 사람 발신)
├── skills/
│   └── channel-teach/SKILL.md   # 연동학습 절차·안전 규율(트리거·채널 라우팅·게이트)
└── teach/
    ├── channels.json            # 채널→표면→backend 매핑 정본
    └── replay.schema.json       # 학습 산출물 JSON Schema(§6) 정본
```

### 3.1 backend별 저장 경계

- **computer-use(desktop) 산출물**: 작업자 로컬 `.bnviit-teach/<채널>-<작업>.json`(루트 `.gitignore`로 추적 제외). §6 schema를 따른다.
- **claude-in-chrome(web) 산출물**: 1차로 **Chrome 확장 패널의 workflow/shortcut**으로 관리한다(확장이 저장·동기화 담당). 로컬 `.bnviit-teach/` JSON으로의 변환은 **확장이 검증된 JSON export/import 계약(런타임 확인된 export API)을 제공할 때만** 수행한다. 그런 계약이 없으면 web backend는 "확장 shortcut으로만 관리"가 정본이며 로컬 JSON 미러는 만들지 않는다(§5). **자동 replay 적용 범위는 §6.4를 따른다**: step별 검사·전송 차단·PII lint를 강제할 검증된 runtime 계약이 없으면 web은 **teach까지만 지원하고 자동 replay는 미지원**(사람이 수동 실행, 전송 직접).
- **gitignore 강제(본 PR 산출물)**: 루트 `.gitignore`에 `.bnviit-teach/` 항목을 추가한다. (실제 `.gitignore` 편집은 구현 단계에서 수행하되, §8 테스트가 그 존재를 강제한다.)
- **보존·삭제**: 산출물은 학습한 작업자 로컬에만 보존하고, 더 이상 필요 없으면 `purge` 절차(파일 삭제 / Chrome 확장에서 해당 shortcut 삭제)로 제거한다. backend별 저장 위치·보존 책임·삭제 경로를 §10에 규정한다.

> 본 PR은 산출물 **포맷·경로·gitignore·삭제 규약**만 정의한다(실데이터·실 좌표 비포함).

## 4. backend 라우팅 + capability probe (`channels.json`)

### 4.1 채널 → 표면 → backend

| 채널 | 표면 | 학습 backend |
|---|---|---|
| 카카오톡 | 데스크톱 앱 | computer-use(desktop) |
| WeChat | 데스크톱/웹 | computer-use 또는 claude-in-chrome |
| LINE | 데스크톱/웹 | computer-use 또는 claude-in-chrome |
| Zalo | 웹 | claude-in-chrome |
| 인스타그램 DM | 웹 | claude-in-chrome |
| 네이버 톡톡 | 웹 | claude-in-chrome |

> 브라우저는 computer-use에서 tier="read"(클릭/입력 차단)일 수 있으므로 **웹 채널은 claude-in-chrome backend**로 학습·조작한다. 실제 티어와 도구 가용성은 §4.2 probe로 확정한다.

### 4.2 capability probe (세션 시작 필수)

teach/replay 세션은 **시작 시 capability probe**를 먼저 수행한다. 어떤 도구도 환경에 항상 존재한다고 가정하지 않는다.

1. **사용 가능한 backend 도구 확인**
   - computer-use: 접근/조작/(있다면)teach 계열 도구가 실제 노출되는지 확인하고, `list_granted_applications` 등으로 현재 권한·티어를 읽는다.
   - claude-in-chrome: 연결된 브라우저·shortcut 관리·(있다면)export 계열 도구가 실제 노출되는지 확인한다.
2. **실제 도구명은 런타임에 고정**: probe로 확인된 이름만 사용한다. 문서에 적힌 이름이 환경에 없으면 그 경로를 쓰지 않는다.
3. **비보존·비저장 조건 검증(probe 실패 시 차단)**: probe는 backend가 **화면 정보를 비보존(no-retention)·스크린샷 비저장** 조건으로 운용 가능한지 확인한다. 이 조건을 만족하지 못하는 backend는 **세션을 시작하지 않는다**(probe 실패=차단). 합성-데이터 게이트가 1차 방어이지만, 기록 매체 자체가 화면을 외부에 보존한다면 게이트만으로 부족하기 때문이다.
4. **폴백/미지원 처리**
   - desktop에서 teach 류 전용 도구가 없으면, 지원되는 UI 조작 도구(클릭/타입/스크린샷 등)로 동등 절차를 구성하는 폴백을 쓴다.
   - web에서 검증된 export API가 없으면 Chrome 확장 shortcut 관리로만 진행하고 로컬 JSON 변환은 생략한다(§3.1). 자동 replay 적용 여부는 §6.4(검증된 runtime 계약) 기준을 따른다.
   - 어떤 backend도 요건(합성-데이터 게이트·전송 영구 제외·링크 금지·비보존/비저장을 만족하며 학습 가능)을 충족하지 못하면 **학습을 시작하지 않고 미지원으로 안내**한다.

> probe 결과는 세션 로그에만 남기고, 도구 가용성 판단에 PII·화면 콘텐츠를 사용하지 않는다.

## 5. 연동학습 플로우 (`/bnviit-teach <채널> <작업>`)

| 단계 | 동작 | 모드 |
|---|---|---|
| ① 라우팅+probe | `channels.json`에서 표면·backend 결정 → §4.2 capability probe로 도구·티어·폴백 확정 | 자동 |
| ②a 합성-데이터 게이트 | **기록 시작 전** 합성/테스트 계정·샌드박스 화면임을 사람이 확인(게이트). 실환자/실 PII면 시작 거부 | ✋게이트(차단) |
| ②b 권한 확인 | desktop: `request_access`(최소 앱·티어) / web: Chrome 대화별 활성·사이트별 권한·**Ask before acting**·단일-action 승인·조직 allowlist 확인(§7) | ✋확인 |
| ③ 시연 학습 | 사람이 **합성 데이터로** UI 절차(예: "테스트 채널에서 안내 메시지 작성 화면까지 이동")를 시연 → 노출된 teach/조작 도구(desktop) 또는 chrome 액션으로 **절차만** 기록. **전송/발신 단계는 기록하지 않음**(forbidden-send invariant) | ✋사람 시연 |
| ③g 실시간 PII 감시 | 세션 중 실환자/실 PII 화면 감지 시 **즉시 중단 + 로컬 산출물 폐기(purge)**. purge는 **로컬 파일/shortcut 삭제만** 의미하며, 이미 도구/모델/외부로 전달된 화면 정보는 **회수 불가**. 따라서 1차 방어는 항상 ②a 합성-데이터 게이트(애초에 실 PII 진입을 막음) | 자동·차단 |
| ④ 저장 | 절차를 §6 schema로 저장(저장 전 PII lint §6.3 통과 필수): desktop→`.bnviit-teach/<채널>-<작업>.json`(gitignored), web→확장 shortcut(검증된 export 있을 때만 로컬 미러) | 자동 |
| ⑤ 검증 재생 | 학습 절차를 **드라이런(발신 직전까지)**으로 재생해 확인. **실제 발신은 안 함**. 전송 단계는 산출물에 부재 + 전송 UI 의미검증으로 차단(§6.2). **web은 검증된 runtime 계약이 있을 때만 자동 재생, 없으면 미지원**(§6.4) | 자동·드라이런 |

**HITL 경계**: ②a(합성 데이터 게이트)·②b(권한)는 사람 확인. **전송/발신/전송확인 클릭은 학습·재생 어디에도 포함되지 않으며 오직 사람이 직접 수행**한다(에이전트는 절대 클릭하지 않음, 승인으로도 위임 불가).

## 6. 보조 재생 (`/bnviit-teach-replay <채널> <작업>`) — 산출물 schema + fail-closed executor

학습된 절차로 UI를 **발신 직전까지** 보조 진행한다. 메시지 콘텐츠는 임무 스킬(patient-faq-reply 등)이 생성하고 medical-safety·pii 게이트를 통과한 초안만 사용한다. **최종 발신 클릭은 사람**이며, 산출물에 전송 단계가 존재하지 않으므로 에이전트 경로상 발신 도달이 불가능하다. 자동 발송 금지.

> **backend별 적용 범위(§6.4)**: 자동 replay는 step별 검사·전송 차단·PII lint를 강제할 수 있는 backend에서만 지원한다. desktop(computer-use)은 지원, **web(claude-in-chrome)은 검증된 runtime 계약이 확인될 때만 지원하고, 없으면 teach까지만(자동 replay 미지원)**.

### 6.1 학습 산출물 JSON Schema (정본: `teach/replay.schema.json`)

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "bnviit teach replay artifact",
  "type": "object",
  "required": ["schema_version", "channel", "surface", "backend", "target", "synthetic_only", "send_boundary", "preconditions", "steps"],
  "additionalProperties": false,
  "properties": {
    "schema_version": { "type": "string", "const": "1.0" },
    "channel": { "type": "string" },
    "surface": { "enum": ["desktop", "web"] },
    "backend": { "enum": ["computer-use", "claude-in-chrome"] },
    "app": { "type": "string", "description": "desktop 앱 식별자(있을 때)" },
    "domain": { "type": "string", "description": "web 도메인(있을 때)" },
    "target": { "type": "string", "description": "학습한 작업명(콘텐츠 아님)" },
    "synthetic_only": { "const": true, "description": "합성 데이터 전용 — 항상 true" },
    "send_boundary": {
      "type": "object",
      "required": ["agent_may_send", "stop_before_step_id"],
      "properties": {
        "agent_may_send": { "const": false },
        "stop_before_step_id": {
          "type": "string",
          "description": "재생이 멈춰야 하는 발신 직전 step의 id. 임의 문자열이 아니라 steps[].id 중 하나를 참조해야 함(저장 전 검증: 미존재 id면 거부). 이 step 직전에서 정지하고 이후는 사람 전용"
        }
      },
      "additionalProperties": false
    },
    "preconditions": {
      "type": "array",
      "items": { "type": "string" },
      "description": "예: 테스트 계정 로그인됨, 합성 환자 선택됨"
    },
    "steps": {
      "type": "array",
      "minItems": 1,
      "items": {
        "type": "object",
        "required": ["id", "locator", "action", "assertion"],
        "additionalProperties": false,
        "properties": {
          "id": {
            "type": "string",
            "pattern": "^[a-z0-9][a-z0-9_-]*$",
            "description": "안정적 step 식별자. 산출물 내 유일(저장 전 중복 검증). send_boundary.stop_before_step_id가 이 값을 참조"
          },
          "locator": {
            "type": "object",
            "description": "우선순위: 안정 셀렉터 → 접근성 라벨 → 좌표(최후 폴백). 좌표는 라벨 의미검증이 불가하므로 전송 가능 영역에서는 금지(§6.2)",
            "properties": {
              "selector": { "type": "string" },
              "a11y_label": { "type": "string" },
              "coordinate": {
                "type": "array", "items": { "type": "number" }, "minItems": 2, "maxItems": 2,
                "description": "최후 폴백 전용. 좌표만으로 식별되는 단계는 비권장. 전송류 UI(Send/보내기/제출/확인)에 도달 가능한 영역에서는 좌표 fallback 금지 — 셀렉터/라벨 필수"
              }
            },
            "anyOf": [
              { "required": ["selector"] },
              { "required": ["a11y_label"] },
              { "required": ["coordinate"] }
            ]
          },
          "action": {
            "enum": ["click", "type", "scroll", "wait", "assert_only"],
            "description": "발신/전송류 action은 enum에 존재하지 않음(forbidden-send invariant). click도 실행 직전 전송 UI 의미검증을 통과해야 함(§6.2)"
          },
          "value_ref": {
            "enum": ["from_mission_skill", "synthetic_fixture", "none"],
            "description": "타이핑 값의 출처 키만 허용(자유 문자열 금지). action===type일 때만 from_mission_skill/synthetic_fixture 의미. 실제 값 리터럴은 산출물에 저장하지 않음(저장 전 PII lint로 강제, §6.3)"
          },
          "assertion": {
            "type": "string",
            "description": "단계 성공 판정 조건. 불충족 시 fail-closed 중단. 자유 문자열이지만 저장 전 PII lint 대상(§6.3)"
          }
        }
      }
    }
  }
}
```

핵심 계약:
- **전송 단계 구조적 부재**: `action` enum에 send/submit/confirm-send가 없고, `send_boundary.agent_may_send`는 `false` const이며, `stop_before_step_id`는 임의 문자열이 아니라 **실재하는 step id를 참조**(저장 전 검증)한다. `click`만으로 전송 버튼을 누르는 우회는 §6.2 실행 직전 전송 UI 의미검증으로 차단한다.
- **합성 전용 플래그**: `synthetic_only`는 `true` const. 거짓이거나 누락이면 schema 검증 실패.
- **locator 우선순위 + 좌표 제약**: 안정 셀렉터/접근성 라벨 우선, **좌표는 최후 폴백**. 전송류 UI에 도달 가능한 영역에서는 **좌표 fallback 금지**(라벨 의미검증 불가하므로).
- **PII 리터럴 금지(이중 강제)**: 타이핑 값은 `value_ref` **enum**(`from_mission_skill`/`synthetic_fixture`/`none`)만 허용하고, 모든 자유 문자열 필드는 저장 전 **PII lint**(§6.3)로 검사한다.

### 6.2 fail-closed executor + 전송 UI 의미검증

replay 실행기는 **fail-closed**다. 또한 **각 step 실행 직전에 대상 locator/라벨이 전송류 UI인지 의미 검증**한다:

- **전송 UI 의미검증(필수)**: step 실행 직전, 대상 요소의 접근성 라벨·텍스트가 전송류(`Send`/`보내기`/`전송`/`제출`/`확인`/`Submit`/유사 다국어)에 해당하는지 검사한다. 해당하면 **클릭하지 않고 즉시 중단·사람 인계**한다. `click` action이라도 전송 버튼을 누르는 것은 이 게이트에서 차단된다. 좌표만 있는 locator는 라벨 매칭이 불가하므로, **전송 가능 영역에서는 좌표 fallback을 허용하지 않는다**(셀렉터/라벨 필수).

다음 중 하나라도 발생하면 즉시 중단하고 사람에게 인계한다:
- assertion 실패 / 화면 상태 불일치,
- locator 불일치(셀렉터·라벨 미발견, 좌표 폴백이 기대 요소와 어긋남),
- 전송류 UI 의미검증에 걸림(전송 버튼·전송 영역 도달),
- `send_boundary.stop_before_step_id` 참조 step 도달(여기서 멈추고 사람 발신 대기),
- 링크/첨부/리디렉션/다운로드 유발 요소 조우(§10, 무조건 금지),
- 실환자/실 PII 화면 감지.

중단은 "안전한 정지"이며, 모호하면 진행하지 않고 멈춘다(진행 우선 아님).

### 6.3 저장 전 PII lint (fail-closed)

산출물 저장 전, **모든 문자열 필드**(`target`·`preconditions[]`·`steps[].locator.selector`·`a11y_label`·`assertion` 등)에 PII lint를 강제한다:

- 주민등록번호·전화번호·이메일·(이름+연락처) 패턴이 발견되면 **저장을 거부**하고 fail-closed로 중단한다(부분 마스킹 후 저장하지 않음 — 거부).
- `value_ref`는 enum(`from_mission_skill`/`synthetic_fixture`/`none`)이라 실제 값 리터럴이 들어갈 자리가 없다. 타이핑 실제 값은 **재생 시 임무 스킬이 주입**하며 산출물에는 출처 키만 남는다.
- lint는 schema 통과만으로 우회되지 않는 **추가 게이트**다(schema는 형태, lint는 내용). §8 테스트가 adversarial fixture로 강제한다.

### 6.4 backend별 replay 적용 범위 (web replay 불변식)

fail-closed executor·step별 의미검증·PII lint는 **실행기가 step 단위로 가로챌 수 있을 때만** 보장된다.

- **desktop(computer-use)**: 본 실행기가 step을 직접 구동하므로 §6.1~§6.3 불변식을 전부 강제한다 → 자동 replay 지원.
- **web(claude-in-chrome)**: Chrome 확장 shortcut은 본 실행기 밖에서 동작하여 step별 검사·전송 차단·링크 금지·PII lint를 강제할 수 없다. 따라서 **web backend의 자동 replay는, step 단위 검사·동작별 차단(전송 UI 차단·링크 금지·PII lint)을 강제할 수 있는 검증된 runtime 계약이 확인될 때만 지원**한다. 그런 계약이 없으면 web은 **teach(학습)까지만 지원하고 replay는 미지원**으로 둔다 — 재생은 사람이 확장 shortcut을 **수동 실행**하되 전송은 사람이 직접 한다. 즉 동일 안전 불변식을 강제하지 못하는 backend는 자동 replay에서 제외한다.

## 7. Chrome(claude-in-chrome) 권한 게이트

web backend는 "확장 연결 확인"만으로 충분하지 않다. connector는 **대화별 활성화·사이트별 권한·permission mode가 각각 별개**이며 `Always allow`/`Act without asking`은 다중 동작을 무인 허용한다. 따라서 teach/replay에서는:

- **Ask before acting**(매 동작 승인) permission mode를 사용한다.
- **단일-action 승인**만 허용하고, 한 번의 승인으로 여러 동작을 위임하지 않는다.
- **조직 allowlist**(허용 사이트 목록) 내에서만 동작한다.
- **Act without asking·예약(스케줄) 실행은 금지**한다.
- 대화별 활성화·사이트별 권한을 세션마다 확인한다(§4.2 probe와 함께).

## 8. 검증 / 테스트

`plugins/bnviit-clinic/test/teach-docs.test.mjs`(node:test). 단순 문구 존재 검사를 넘어 **안전 계약을 강제**한다:

1. **구조**: `channels.json` 유효 JSON + 채널→표면→backend 매핑 존재. 커맨드 2종·`channel-teach/SKILL.md` 존재 + frontmatter. `teach/replay.schema.json` 유효 JSON Schema 존재.
2. **forbidden-send invariant(구조)**: schema의 step `action` enum에 send/submit/confirm-send류가 **없음**, `send_boundary.agent_may_send`가 `false` const, `synthetic_only`가 `true` const임을 검증. 추가로 **`stop_before_step_id`가 실재하는 step id를 참조**함을 검증하고, 존재하지 않는 id를 참조한 fixture는 **거부**됨을 검증.
3. **JSON Schema fixture 검증(positive/negative)**: 유효 산출물 fixture는 통과하고, (a)전송 action 포함, (b)`synthetic_only:false`, (c)`value_ref`에 enum 밖 자유 문자열(실제 값), (d)`stop_before_step_id`가 미존재 id, (e)전송 가능 영역에 좌표-only locator인 fixture는 **거부**됨을 검증.
4. **PII lint adversarial fixture**: 실환자 라벨(가짜 한국 이름·전화·주민번호·이메일 패턴 등)을 `value_ref`·`locator.selector`·`a11y_label`·`assertion`·`preconditions`·`target` 등 **임의 문자열 필드**에 심은 산출물 fixture가 **저장 전 PII lint에서 거부**(fail-closed)됨을 검증하고, 정본 산출물·문서에 그런 라벨이 **부재**함을 검증.
5. **전송 UI 의미검증 계약 문구**: SKILL/커맨드/문서에 "각 step 실행 직전 전송류 라벨(Send/보내기/제출/확인) 의미검증·전송 UI면 중단"·"전송 가능 영역 좌표 fallback 금지" 취지가 존재함을 검증(§6.2).
6. **web replay 불변식 문구**: "web 자동 replay는 검증된 runtime 계약이 있을 때만, 없으면 teach까지만(자동 replay 미지원)" 취지가 §3.1·§5·§6.4·§10에 일관되게 존재함을 검증.
7. **`.bnviit-teach/` gitignore 강제**: 루트 `.gitignore`에 `.bnviit-teach/` 항목이 존재함을 테스트로 강제(없으면 실패).
8. **capability probe 문구**: SKILL/커맨드 본문에 "capability probe", "런타임 확인", "폴백/미지원 안내", "비보존·비저장 미충족 backend는 세션 시작 차단" 취지의 규율이 존재함을 검증.
9. **purge 범위 문구**: "purge는 로컬 산출물 삭제만, 외부 전달분은 회수 불가, 1차 방어는 기록 전 합성-데이터 게이트" 취지가 §2·§5 ③g·§10에 존재함을 검증.
10. **안전 문구 검증**: "합성 데이터 전용"·"전송 영구 제외(사람 직접 클릭)"·"기록 전 PII 게이트"·"링크/첨부 금지"·"자동 발송 금지"·"Ask before acting" 문구가 SKILL/커맨드 본문에 포함됨을 검증.
11. **기밀 미포함**: 실명·환자·이메일·전화 패턴 부재(author 제외).

## 9. CI 통합

기존 `clinic-docs` 잡 `node --test`에 `plugins/bnviit-clinic/test/teach-docs.test.mjs` 및 schema fixture 디렉터리를 추가한다.

## 10. 보안 / 가드레일

- **합성 데이터 전용**: 실환자 채널·실 PII 화면에서 학습/재생 금지. 테스트 계정·가상 환자·샌드박스에서만(§1.0).
- **전송 영구 제외(구조적 강제)**: 환자 발신/전송/전송확인은 **사람이 직접 클릭**. 학습·산출물·재생 어디에도 포함되지 않으며 에이전트는 승인을 받았더라도 클릭하지 않는다. schema 차원(전송 action 부재·`agent_may_send:false`·`stop_before_step_id`가 실 step 참조)과 실행 차원(각 step 직전 전송류 라벨 의미검증·전송 UI면 중단, 전송 가능 영역 좌표 fallback 금지, §6.2)에서 이중 강제. 자동 발송·자동 전송 금지.
- **web replay 불변식**: step별 검사·전송 차단·링크 금지·PII lint를 강제할 검증된 runtime 계약이 없는 backend는 **자동 replay에서 제외**. web(claude-in-chrome)은 그 계약 확인 전까지 teach까지만 지원, 재생은 사람이 수동 실행·전송 직접(§6.4).
- **기록 전 PII 게이트 + 저장 전 lint + 제한적 purge**: 합성-데이터 게이트를 기록 시작 전에 통과해야 하며(1차 방어), 저장 전 모든 문자열 필드에 PII lint(§6.3, 발견 시 저장 거부). 세션 중 실 PII 감지 시 즉시 중단 + 로컬 산출물 purge. **purge는 로컬 파일/shortcut 삭제만 의미하며 이미 도구/모델/외부로 전달된 화면 정보는 회수 불가** — 그래서 1차 방어는 항상 기록 전 합성-데이터 게이트다. computer-use는 입력·창 내용을, Chrome은 페이지·스크린샷을 읽으므로 사후 마스킹으로 회수 불가임을 전제로 한다.
- **링크/첨부 무조건 금지**: 메시지·DM의 링크 클릭·첨부 열기·리디렉션 따라가기·다운로드를 teach/replay에서 무조건 금지. 비신뢰 입력(prompt injection·악성 링크)으로 취급하고, 필요 시 별도 사람이 검증.
- **Chrome 권한**: Ask before acting·단일-action 승인·조직 allowlist. Act without asking·예약 실행 금지(§7).
- **capability probe**: 도구 가용성은 런타임 확인. 비보존·스크린샷 비저장 조건 미충족 backend는 **세션 시작 차단**. 미지원이면 폴백 또는 미지원 안내, 추측 실행 금지(§4.2).
- **저장 경계·삭제**: 산출물은 작업자 로컬(`.bnviit-teach/`, gitignored) 또는 Chrome 확장 shortcut에만 보존. `.bnviit-teach/`는 루트 `.gitignore`에 강제(§3.1, §8). 불필요 시 `purge`(파일 삭제 / shortcut 삭제)로 제거.
- computer-use 링크 안전·티어 규칙 준수. 금전·계약·외부 공시는 별도 승인.
- 공개 커맨드/문서에 기밀 미포함.

## 11. 범위 밖 / 후속

- 학습 절차의 완전 자동 실행(무인 발송) — 영구 비목표(환자 안전).
- 실환자 운영 채널 운전·운영 데이터 학습 — 영구 비목표(§1.0).
- 채널별 세부 셀렉터·좌표 안정화·OCR 기반 검증 — 후속.
- Chrome 확장의 검증된 JSON export/import 계약 — export API 확인 시 별도 라운드.
- 다국어 채널(WeChat/LINE 등) 콘텐츠는 overseas 라운드.

## 12. 변경 이력

- **v3 (2026-06-30)**: 라운드2 codex 차단 4건 반영 — step id 기반 `send_boundary`(`stop_before_step_id`가 실 step 참조)·실행 직전 전송 UI 의미검증(전송 가능 영역 좌표 fallback 금지)으로 forbidden-send 구조적 강제; web 자동 replay는 검증된 runtime 계약이 있을 때만(없으면 teach까지만, replay 미지원, §6.4); 저장 전 전 문자열 필드 PII lint(§6.3) + `value_ref` enum화; purge는 로컬 한정·외부 전달분 비회수 명시 + probe 비보존/비저장 미충족 시 세션 시작 차단. §8 테스트(stop_before id 참조·value_ref enum·좌표-only 전송영역·전 필드 PII lint·web replay 불변식·purge 범위) 추가.
- **v2 (2026-06-30)**: codex 리뷰 10건 반영 — 합성데이터 전용 원칙·전송 영구 제외(forbidden-send invariant)·기록 전 PII 게이트(fail-closed, 즉시 폐기)·capability probe(도구 런타임 확인·폴백)·재생 JSON Schema + fail-closed executor·Chrome 권한 게이트(Ask before acting/단일-action/allowlist)·링크/첨부 무조건 금지·`.bnviit-teach/` gitignore 강제·테스트 강화(schema fixture·forbidden-send invariant·PII adversarial·gitignore·probe 문구). backend 라우팅 표 및 web 산출물(확장 shortcut 우선) 정리.
- **v1 (2026-06-30)**: 설계 초안 — 채널 라우팅·teach/replay 플로우·HITL·PII 보호·테스트 골격.
