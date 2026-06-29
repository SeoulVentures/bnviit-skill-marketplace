// patient-faq-reply 결정론적(비-LLM) 전처리 — 외부 송출 전 진입점.
// 정본: docs/superpowers/specs/2026-06-30-bnviit-mission-skills-design.md §3·§4·§6·§9.
//
// 책임(단일):
//   환자 원문 → ① 정규식 기반 PII 마스킹 + ② 응급 키워드 1차 분류
//   → 항상-반환 envelope JSON 출력(무기록).
//
// 보안 계약(엄수):
//   - 환자 원문은 **stdin 전용**으로만 읽는다. process.argv 위치인자로 원문을
//     받지 않는다(argv는 `ps`/프로세스 목록에 노출되어 PII 누출). argv에는
//     비-원문 플래그(--max-len 등)만 허용하며, 위치인자가 오면 무시한다.
//   - emergency는 마스킹 성공/실패와 **독립적으로 항상 평가·반환**(응급 유실 금지).
//   - maskingStatus !== "ok"이면 maskedQuery: null (부분 마스킹 원문 조각 금지).
//   - 오류 표현은 자유형 문자열 금지 — 고정 errorCode enum만
//     (PII_UNCERTAIN | MASK_ERROR | TIMEOUT). foundPiiTypes는 유형명만(원문 값 금지).
//   - 자체 timeout(수 초) 초과 시 TIMEOUT errorCode로 종료.
//
// envelope 형태:
//   { maskingStatus: "ok"|"uncertain"|"error",
//     maskedQuery: string|null,
//     emergency: boolean,
//     foundPiiTypes: string[],   // 유형명만 (rrn|phone|email|name_contact ...)
//     errorCode: "PII_UNCERTAIN"|"MASK_ERROR"|"TIMEOUT"|null }

// ── 자체 timeout(ms). 결정론적 처리이므로 넉넉히 잡되 무한 루프/폭주를 막는다. ──
export const SELF_TIMEOUT_MS = 3000;

// 입력 길이 상한(폭주·ReDoS 방어). --max-len 플래그로 조정 가능.
const DEFAULT_MAX_LEN = 8000;

// ── PII 마스킹 규칙(결정론적 정규식). 순서가 중요: 더 구체적인 패턴 먼저. ──
// 각 규칙은 { type, re, mask } — re는 전역 매치, mask는 치환 토큰.
const PII_RULES = [
  // 주민등록번호: 6자리-7자리.
  { type: 'rrn', re: /\b\d{6}-\d{7}\b/g, mask: '[주민번호]' },
  // 이메일.
  { type: 'email', re: /\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g, mask: '[이메일]' },
  // 국제전화(+82) — 한국 번호 국제표기. phone 규칙보다 먼저(선두 0 제거형 매칭).
  // 예: +82-10-1234-5678, +82 10 1234 5678, +821012345678.
  {
    type: 'phone_intl',
    re: /\+82[-.\s]?\d{1,2}[-.\s]?\d{3,4}[-.\s]?\d{4}\b/g,
    mask: '[전화번호]',
  },
  // 전화번호: 02/0xx-xxx(x)-xxxx, 휴대폰 010 등. 하이픈/공백/점 구분 허용.
  {
    type: 'phone',
    re: /\b0\d{1,2}[-.\s]?\d{3,4}[-.\s]?\d{4}\b/g,
    mask: '[전화번호]',
  },
  // 카드/계좌 유사 장수열(13자리 이상 연속 숫자) — 금융정보 보수적 마스킹.
  { type: 'long_number', re: /\b\d{13,}\b/g, mask: '[숫자]' },
  // 8자리 생년월일(YYYYMMDD) — 구분자 없는 형식. rrn(하이픈 포함) 이후 평가.
  // 19/20 세기 + 01~12월 + 01~31일 보수적 매칭(임의 8자리 숫자 오탐 최소화).
  {
    type: 'dob',
    re: /\b(?:19|20)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])\b/g,
    mask: '[생년월일]',
  },
  // 생년월일(YYYY-MM-DD / YYYY.MM.DD / YYYY/MM/DD / YYYY년 MM월 DD일).
  {
    type: 'dob',
    re: /\b(19|20)\d{2}[-.\s/]\d{1,2}[-.\s/]\d{1,2}\b|\b(19|20)\d{2}\s*년\s*\d{1,2}\s*월\s*\d{1,2}\s*일/g,
    mask: '[생년월일]',
  },
  // 한국 주소(보수적): 시/도 또는 시·구·동 뒤에 번지(숫자-숫자) 또는 '번지/로/길 + 숫자'.
  // 비정형 주소는 100% 못 잡으므로 표지어 잔존 검사(hasResidualPii)로 fail-closed 보완.
  // 예: "서울특별시 강남구 역삼동 123-45", "경기도 ... 12번길 3".
  {
    type: 'address',
    re: /(?:서울|부산|대구|인천|광주|대전|울산|세종|경기|강원|충북|충남|전북|전남|경북|경남|제주)(?:특별시|광역시|특별자치시|특별자치도|도)?\s*\S*?(?:시|군|구)\s*\S*?(?:동|읍|면|로|길)\s*\d{1,4}(?:[-]\d{1,4})?(?:번지|번길|호)?/g,
    mask: '[주소]',
  },
];

// 이름+연락처 조합(맥락) 마스킹: "홍길동 010-..." 같이 한글 성명 뒤 연락처가 붙는 패턴.
// 연락처 자체는 위 phone 규칙이 잡으므로, 여기서는 성명 토큰만 마스킹한다.
// - 성명 후보는 (문장경계 또는 비한글) 뒤에서 시작하는 2~4 한글.
// - 연락처 안내어(연락처·전화·번호 등) 자체는 성명에서 제외(부정 선행).
// - 성명 뒤 (선택)호칭/안내어/구분자 후 전화번호(원형 또는 [전화번호] 토큰)가 오는 경우만.
const CONTACT_WORDS = '(?:연락처|전화번호|핸드폰|휴대폰|전화|번호|폰)';
const NAME_CONTACT_RE = new RegExp(
  // (1) 성명 시작 경계: 문자열 시작/공백/비한글-비숫자 기호.
  '(^|[\\s,。.(（])' +
    // (2) 안내어가 아닌 2~4 한글 성명.
    `(?!${CONTACT_WORDS})([가-힣]{2,4})` +
    // (3) 호칭/안내어/구분자/공백을 캡처(group3) — 마스킹 시 공백 보존용.
    `((?:님|씨)?\\s*(?:${CONTACT_WORDS})?\\s*[:：]?\\s*)` +
    // (4) 직후 전화번호(원형 또는 마스킹 토큰)가 와야 성명으로 확정.
    '(?=(?:\\[전화번호\\]|0\\d{1,2}[-.\\s]?\\d{3,4}|\\+82))',
  'g',
);

// 이름+표지어(님/환자) 조합: "홍길동님", "김환자 환자분" 등 성명 뒤 환자/호칭 표지어.
// 연락처 동반 없이도 성명 표지어가 명시되면 보수적으로 성명 토큰을 마스킹한다.
// - 안내어(연락처·전화 등)는 성명에서 제외, 흔한 비-성명 2글자 보통명사는 부정 선행으로 일부 차단.
const NAME_MARKER_RE = new RegExp(
  '(^|[\\s,。.(（])' +
    `(?!${CONTACT_WORDS})(?!환자|보호자|고객|선생|원장|의사)([가-힣]{2,4})` +
    // 표지어: 님/씨 + (선택)환자/보호자/고객, 또는 직접 '환자/보호자'.
    '(?=(?:님|씨)\\s*(?:환자|보호자|고객)?|\\s*(?:환자분|환자|보호자분))',
  'g',
);

// ── 응급 키워드/패턴(1차 분류). 마스킹과 독립적으로 항상 평가. ──
// 안과 응급: 급성 시력저하·심한 안구 통증·출혈·광시증·시야 결손·심한 두통+시각이상 등.
const EMERGENCY_PATTERNS = [
  /급성\s*시력\s*저하/,
  /갑자기.*(?:안\s*보|시력|시야)/,
  /시력\s*(?:이|을)?\s*(?:급격|갑자기|확)/,
  /심한\s*(?:안구|눈)?\s*통증/,
  /(?:눈|안구).*심(?:한|하게)\s*아/,
  /출혈/,
  /광시증/,
  /번쩍/,
  /(?:시야|시각)\s*결손/,
  /(?:시야|시각)\s*(?:가|이)?\s*(?:가려|좁아|잘려|일부)/,
  /커튼.*가린|가린.*커튼/,
  /비문증.*(?:갑자기|급증|많아)/,
  /실명/,
  /심한\s*두통.*(?:시각|시야|눈)|(?:시각|시야|눈).*심한\s*두통/,
  /(?:화학|약품|세제).*(?:눈|안구)|(?:눈|안구).*(?:화학|약품)/,
  /(?:눈|안구).*(?:찔|찔렸|찔림|박혀|이물질|관통)/,
  // 통증 역순/구어 표현: "눈이 너무 아파요", "눈이 심하게 아파요"(부사+아프다).
  /(?:눈|안구)(?:이|가)?\s*(?:너무|많이|엄청|매우|심하게|심히)\s*아(?:파|프|픔)/,
  // 출혈 동의어/구어: "눈에서 피가 나요/난다", "피나요".
  /(?:눈|안구).*피\s*(?:가|를)?\s*(?:나|난|남|흘)/,
  /피\s*(?:가|를)?\s*나(?:요|와|온|는)/,
  // 급성 시력저하 구어: "안 보여요", "갑자기 안 보임", "하나도 안 보".
  /(?:갑자기|급|확|하나도)?\s*안\s*보(?:여|임|이|인|일)/,
];

/**
 * 응급 여부 1차 분류. 결정론적·마스킹 독립. 절대 throw하지 않는다.
 * @param {string} text
 * @returns {boolean}
 */
export function classifyEmergency(text) {
  if (typeof text !== 'string' || text.length === 0) return false;
  for (const re of EMERGENCY_PATTERNS) {
    if (re.test(text)) return true;
  }
  return false;
}

/**
 * 결정론적 정규식 PII 마스킹.
 * @param {string} text
 * @returns {{ masked: string, foundTypes: string[] }}
 */
export function maskPii(text) {
  let masked = String(text);
  const found = new Set();

  // 이름+연락처(성명 토큰) 먼저: phone 마스킹 전후 모두 동작하도록 단계 분리.
  // 1) 우선 연락처를 임시로 보존하기 위해 성명 토큰을 phone 원형과 함께 검사.
  NAME_CONTACT_RE.lastIndex = 0;
  if (NAME_CONTACT_RE.test(masked)) {
    found.add('name_contact');
  }
  NAME_CONTACT_RE.lastIndex = 0;
  // 그룹1(선행 경계문자)·그룹3(중간 호칭/안내어/구분자)은 보존하고 성명 토큰만 치환.
  // 중간 세그먼트(group3)의 공백을 유지해 "[이름] 010-..."처럼 단어 경계를 보존한다.
  masked = masked.replace(NAME_CONTACT_RE, (_m, lead, _name, mid) => `${lead ?? ''}[이름]${mid ?? ''}`);

  // 이름+표지어(님/환자 등) — 연락처 동반 없이도 성명 표지어가 명시되면 마스킹.
  NAME_MARKER_RE.lastIndex = 0;
  if (NAME_MARKER_RE.test(masked)) {
    found.add('name_marker');
  }
  NAME_MARKER_RE.lastIndex = 0;
  masked = masked.replace(NAME_MARKER_RE, (_m, lead) => `${lead ?? ''}[이름]`);

  for (const rule of PII_RULES) {
    rule.re.lastIndex = 0;
    if (rule.re.test(masked)) {
      found.add(rule.type);
    }
    rule.re.lastIndex = 0;
    masked = masked.replace(rule.re, rule.mask);
  }

  return { masked, foundTypes: [...found] };
}

/**
 * RAG 검색 결과 출력단 마스킹(§6.4 양방향 마스킹·전 필드).
 * 검색 결과 객체의 `content`·`source`·`heading` 각 필드에 결정론적 maskPii를 적용한다.
 * - content만 마스킹하면 파일명(source)·제목(heading)의 타 환자 식별정보가 샌다 → 전 필드.
 * - 결정론적(비-LLM)이며 throw하지 않는다. 문자열 필드만 마스킹하고 나머지는 보존한다.
 * @param {Record<string, unknown>} obj  검색 결과 한 행(또는 임의 객체)
 * @returns {{ masked: Record<string, unknown>, foundTypes: string[] }}
 */
export function maskFields(obj) {
  const found = new Set();
  const src = obj && typeof obj === 'object' ? obj : {};
  const out = { ...src };
  for (const field of ['content', 'source', 'heading']) {
    const v = src[field];
    if (typeof v === 'string' && v.length > 0) {
      const { masked, foundTypes } = maskPii(v);
      out[field] = masked;
      for (const t of foundTypes) found.add(t);
    }
  }
  return { masked: out, foundTypes: [...found] };
}

/**
 * 핵심 처리 — 항상-반환 envelope를 만든다. 절대 throw하지 않는다.
 * 테스트 가능성을 위해 forceError/forceUncertain 주입을 받는다(프로덕션 경로는 미사용).
 *
 * @param {string} rawText  환자 원문(이미 stdin에서 읽어온 값)
 * @param {{ forceError?: boolean, forceUncertain?: boolean, maxLen?: number }} [opts]
 * @returns {{ maskingStatus, maskedQuery, emergency, foundPiiTypes, errorCode }}
 */
export function processInput(rawText, opts = {}) {
  const text = typeof rawText === 'string' ? rawText : '';

  // emergency는 마스킹과 독립적으로 **항상 먼저** 평가한다(응급 유실 금지).
  // classifyEmergency는 throw하지 않지만 방어적으로 감싼다.
  let emergency = false;
  try {
    emergency = classifyEmergency(text);
  } catch {
    emergency = false;
  }

  // 강제 오류 주입(테스트): 원문 누출 없이 fail-closed envelope.
  if (opts.forceError) {
    return envelope('error', null, emergency, [], 'MASK_ERROR');
  }

  // 입력 길이 상한 초과 → 불확실(보수적). 원문 조각 미반환.
  const maxLen = Number.isFinite(opts.maxLen) ? opts.maxLen : DEFAULT_MAX_LEN;
  if (text.length > maxLen) {
    return envelope('uncertain', null, emergency, [], 'PII_UNCERTAIN');
  }

  let maskResult;
  try {
    maskResult = maskPii(text);
  } catch {
    // 마스킹 자체 실패 → error, 원문 미반환.
    return envelope('error', null, emergency, [], 'MASK_ERROR');
  }

  // 강제 불확실 주입(테스트): 유형명만 보존하고 maskedQuery=null.
  if (opts.forceUncertain) {
    return envelope('uncertain', null, emergency, maskResult.foundTypes, 'PII_UNCERTAIN');
  }

  // 마스킹 후 잔존 PII 패턴 검사(불확실 판정 — fail-closed 트리거).
  // 결정론적 마스킹이 끝났는데도 PII 시그니처가 남아있으면 불완전으로 간주한다.
  if (hasResidualPii(maskResult.masked)) {
    return envelope('uncertain', null, emergency, maskResult.foundTypes, 'PII_UNCERTAIN');
  }

  return envelope('ok', maskResult.masked, emergency, maskResult.foundTypes, null);
}

// 마스킹 후 잔존 PII가 남았는지 보수적 점검(fail-closed 트리거).
// (1) 명백한 PII 시그니처(주민번호·이메일·전화) 잔존.
// (2) PII 표지어(주민번호/생년월일/연락처/전화/주소 등) + 인접 숫자/고유명사 의심 잔존.
//     비정형 PII는 정규식으로 100% 못 잡으므로, 표지어가 남고 그 부근에 마스킹되지 않은
//     숫자열·한글 고유명사 의심이 있으면 불완전(uncertain)으로 보수 판정한다.
function hasResidualPii(masked) {
  const residualSignature = [
    /\b\d{6}-\d{7}\b/,
    /\b[\w.+-]+@[\w-]+\.[\w.-]+\b/,
    /\b0\d{1,2}[-.\s]?\d{3,4}[-.\s]?\d{4}\b/,
  ];
  if (residualSignature.some((re) => re.test(masked))) return true;

  // 표지어 + 인접(같은 줄·근접) 마스킹 안 된 숫자(3자리 이상) 또는 주소형 토막.
  // 이미 [주민번호]·[전화번호]·[주소] 등으로 치환된 표지어 부근은 마스킹 토큰이라 제외.
  const LABEL = '(?:주민\\s*등록\\s*번호|주민\\s*번호|생년\\s*월일|생일|연락처|전화\\s*번호|전화|핸드폰|휴대폰|주소)';
  // 표지어 직후 구분자(:·는·은·이·가·)·공백) 후 마스킹 토큰이 아닌 숫자열(3+) 잔존.
  const labelWithDigits = new RegExp(
    LABEL + '\\s*(?:[:：]|은|는|이|가|=|\\s)?\\s*(?!\\[)[^\\[\\]\\n]{0,6}\\d{3,}',
  );
  if (labelWithDigits.test(masked)) return true;
  // 주소 표지어 + 행정구역 표지(동/읍/면/로/길/번지/호)가 마스킹 토큰 밖에 잔존.
  const addrResidual = /주소\s*(?:[:：]|은|는|이|가|=)?\s*(?!\[)[^\[\]\n]{0,12}?(?:동|읍|면|로|길|번지|호)(?:\s|\d|$|[^가-힣])/;
  if (addrResidual.test(masked)) return true;

  return false;
}

// envelope 빌더 — 키 순서/형태 고정, 비정상 상태 원문 누출 방지 불변식 강제.
function envelope(maskingStatus, maskedQuery, emergency, foundPiiTypes, errorCode) {
  // 불변식: ok가 아니면 maskedQuery는 반드시 null.
  const safeMasked = maskingStatus === 'ok' ? maskedQuery : null;
  // foundPiiTypes는 유형명(소문자/언더스코어)만 — 방어적으로 필터.
  const safeTypes = Array.isArray(foundPiiTypes)
    ? foundPiiTypes.filter((t) => typeof t === 'string' && /^[a-z_]+$/.test(t))
    : [];
  // errorCode는 enum만.
  const safeErr =
    errorCode === null || ['PII_UNCERTAIN', 'MASK_ERROR', 'TIMEOUT'].includes(errorCode)
      ? errorCode
      : 'MASK_ERROR';
  return {
    maskingStatus,
    maskedQuery: safeMasked,
    emergency: Boolean(emergency),
    foundPiiTypes: safeTypes,
    errorCode: safeErr,
  };
}

// argv에서 비-원문 플래그만 파싱. 위치인자(원문 모사)는 무시(ps 노출 차단).
function parseFlags(argv) {
  const flags = { maxLen: DEFAULT_MAX_LEN };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--max-len') {
      const v = Number(argv[++i]);
      if (Number.isFinite(v) && v > 0) flags.maxLen = v;
    }
    // 그 외 위치인자/미지원 플래그는 무시한다(원문을 argv로 받지 않음).
  }
  return flags;
}

// stdin 전체를 읽는다(환자 원문의 유일한 입력 경로).
function readStdin() {
  return new Promise((resolve) => {
    const chunks = [];
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      resolve(Buffer.concat(chunks).toString('utf8'));
    };
    try {
      process.stdin.on('data', (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
      process.stdin.on('end', finish);
      process.stdin.on('error', finish);
      // TTY 등으로 stdin이 열려 있지 않으면 즉시 빈 입력으로 처리.
      if (process.stdin.isTTY) finish();
    } catch {
      finish();
    }
  });
}

// CLI 진입점 — 항상 envelope JSON 한 줄을 stdout으로 낸다. 절대 throw 누출 없음.
async function main() {
  const flags = parseFlags(process.argv.slice(2));

  // 자체 timeout: 초과 시 TIMEOUT envelope로 종료(원문/응급 평가 불가 → 보수적).
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    // 응급 여부 불명이므로 보수적으로 true(안전 측). 호출자가 고정 응급 안내+HITL 폴백.
    emit(envelope('error', null, true, [], 'TIMEOUT'));
    process.exit(0);
  }, SELF_TIMEOUT_MS);
  if (typeof timer.unref === 'function') timer.unref();

  let raw = '';
  try {
    raw = await readStdin();
  } catch {
    raw = '';
  }
  if (timedOut) return;

  let env;
  try {
    env = processInput(raw, { maxLen: flags.maxLen });
  } catch {
    // 최후 방어 — 어떤 예외도 원문 없이 error envelope로 수렴.
    env = envelope('error', null, false, [], 'MASK_ERROR');
  }

  clearTimeout(timer);
  if (!timedOut) emit(env);
}

function emit(env) {
  process.stdout.write(JSON.stringify(env) + '\n');
}

// 직접 실행될 때만 CLI 구동(import 시에는 순수 함수만 노출).
// pathToFileURL로 경로 정규화(공백·특수문자 안전).
const isDirectRun = await (async () => {
  try {
    const { pathToFileURL } = await import('node:url');
    return Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;
  } catch {
    return false;
  }
})();

if (isDirectRun) {
  main();
}
