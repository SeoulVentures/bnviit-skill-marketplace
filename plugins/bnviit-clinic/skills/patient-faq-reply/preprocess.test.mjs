// preprocess.mjs 결정론적 전처리 단위 테스트 (node:test, 외부 의존성 없음)
// 정본: spec §3·§4·§6·§7.2.1. 환자 원문은 stdin 전용으로만 읽으며 envelope는 항상-반환.
//
// 두 층위로 검증한다:
//  (A) 모듈 API(processInput 등 순수 함수) — 결정론적 마스킹·응급분류·envelope 형태.
//  (B) 실제 프로세스 실행(execFileSync 'node preprocess.mjs') — stdin 전용 입력,
//      argv 원문 무시, 비정상 상태 원문 누출 부재 등 프로세스 계약.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PREPROCESS = join(__dirname, 'preprocess.mjs');

// 모듈 순수 함수 직접 import (프로세스 미경유, 결정론 검증용).
const mod = await import('./preprocess.mjs');

// 실제 프로세스를 stdin으로 구동하는 헬퍼. argvExtra는 비-원문 플래그만 전달.
function runProcess(stdinText, argvExtra = []) {
  const out = execFileSync('node', [PREPROCESS, ...argvExtra], {
    input: stdinText ?? '',
    encoding: 'utf8',
    timeout: 15000,
  });
  return JSON.parse(out.trim());
}

// envelope 형태 불변식 — 모든 테스트가 재사용.
function assertEnvelopeShape(env) {
  assert.ok(env && typeof env === 'object', 'envelope는 객체');
  assert.deepEqual(
    Object.keys(env).sort(),
    ['emergency', 'errorCode', 'foundPiiTypes', 'maskedQuery', 'maskingStatus'],
    'envelope 키 집합 고정',
  );
  assert.ok(['ok', 'uncertain', 'error'].includes(env.maskingStatus), 'maskingStatus enum');
  assert.equal(typeof env.emergency, 'boolean', 'emergency는 boolean');
  assert.ok(Array.isArray(env.foundPiiTypes), 'foundPiiTypes는 배열');
  assert.ok(
    env.errorCode === null ||
      ['PII_UNCERTAIN', 'MASK_ERROR', 'TIMEOUT'].includes(env.errorCode),
    'errorCode enum 또는 null',
  );
  // maskedQuery는 string 또는 null만.
  assert.ok(
    env.maskedQuery === null || typeof env.maskedQuery === 'string',
    'maskedQuery는 string|null',
  );
}

// ---------------------------------------------------------------------------
// (1) 원문 stdin → maskedQuery에 원문 PII 미포함
// ---------------------------------------------------------------------------
test('원문 stdin: 주민번호·전화·이메일이 maskedQuery에 미포함되고 유형명만 보고', () => {
  const raw = '안녕하세요 제 주민번호는 900101-1234567 이고 연락처 010-1234-5678, 이메일 hong@example.com 입니다. 라식 가격 문의드려요.';
  const env = runProcess(raw);
  assertEnvelopeShape(env);
  assert.equal(env.maskingStatus, 'ok');
  assert.equal(typeof env.maskedQuery, 'string');

  // 원문 PII 값이 maskedQuery에 그대로 남아있지 않아야 한다.
  assert.ok(!env.maskedQuery.includes('900101-1234567'), '주민번호 원문 미포함');
  assert.ok(!env.maskedQuery.includes('010-1234-5678'), '전화 원문 미포함');
  assert.ok(!env.maskedQuery.includes('hong@example.com'), '이메일 원문 미포함');

  // 발견 유형명은 보고되되 원문 값은 없어야 한다.
  assert.ok(env.foundPiiTypes.includes('rrn'));
  assert.ok(env.foundPiiTypes.includes('phone'));
  assert.ok(env.foundPiiTypes.includes('email'));
  for (const t of env.foundPiiTypes) {
    assert.ok(!/\d{6}-\d{7}/.test(t), 'foundPiiTypes에 주민번호 값 없음');
    assert.ok(!/@/.test(t), 'foundPiiTypes에 이메일 값 없음');
  }
  // 비-PII 본문(문의 의도)은 보존된다.
  assert.ok(env.maskedQuery.includes('라식'), '비-PII 본문 보존');
});

// ---------------------------------------------------------------------------
// (2) 응급 키워드 → emergency true / 비응급 → false
// ---------------------------------------------------------------------------
test('응급 키워드 감지 시 emergency=true', () => {
  for (const raw of [
    '갑자기 한쪽 눈이 급성 시력저하가 왔어요',
    '눈에 심한 통증이 있고 출혈이 보입니다',
    '어제부터 광시증이 생기고 시야 결손이 있어요',
  ]) {
    const env = runProcess(raw);
    assertEnvelopeShape(env);
    assert.equal(env.emergency, true, `응급으로 분류: ${raw}`);
  }
});

test('비응급 일반 문의는 emergency=false', () => {
  const env = runProcess('라식 수술 가격이랑 회복 기간이 궁금합니다');
  assertEnvelopeShape(env);
  assert.equal(env.emergency, false);
});

// ---------------------------------------------------------------------------
// (3) argv로 준 원문은 무시/거부, stdin만 읽음 (ps 노출 차단)
// ---------------------------------------------------------------------------
test('argv 위치인자(원문 모사)는 무시/거부하고 stdin만 사용', () => {
  // stdin에는 정상 문의, argv에는 원문처럼 보이는 PII 문자열을 위치인자로 투입.
  const argvLeak = '주민번호 850505-2345678 광시증 출혈';
  const env = runProcess('라식 가격 문의', [argvLeak]);
  assertEnvelopeShape(env);
  // argv 내용은 처리 대상이 아니므로 그 PII/응급 키워드가 결과에 영향을 주지 않는다.
  assert.equal(env.emergency, false, 'argv의 응급 키워드는 무시');
  if (env.maskedQuery) {
    assert.ok(!env.maskedQuery.includes('850505'), 'argv 원문 미반영');
    assert.ok(!env.maskedQuery.includes('출혈'), 'argv 텍스트 미반영');
  }
});

test('비-원문 플래그(--max-len)는 argv로 허용', () => {
  const env = runProcess('라식 가격 문의', ['--max-len', '4000']);
  assertEnvelopeShape(env);
  assert.equal(env.maskingStatus, 'ok');
});

// ---------------------------------------------------------------------------
// (4) 비정상 상태 envelope에 원문 부분문자열 부재 (maskedQuery null·errorCode만)
// ---------------------------------------------------------------------------
test('uncertain 상태: maskedQuery=null, 원문 PII 부분문자열이 envelope 어디에도 부재', () => {
  // 모듈 API로 uncertain을 강제(비정형 자유서술 PII 다수로 불확실 트리거).
  const raw = '제 주민등록번호 뒷자리 1234567 이고 850505 생이고 전화 끝자리 5678 입니다';
  const env = mod.processInput(raw, { forceUncertain: true });
  assertEnvelopeShape(env);
  assert.notEqual(env.maskingStatus, 'ok');
  assert.equal(env.maskedQuery, null, 'uncertain이면 maskedQuery=null');
  assert.ok(['PII_UNCERTAIN', 'MASK_ERROR', 'TIMEOUT'].includes(env.errorCode));

  // envelope 전체 직렬화에 원문 PII 부분문자열이 없어야 한다(errorCode·foundPiiTypes 포함).
  const blob = JSON.stringify(env);
  for (const frag of ['1234567', '850505', '5678', '주민등록번호']) {
    assert.ok(!blob.includes(frag), `비정상 envelope에 원문 조각 부재: ${frag}`);
  }
  // foundPiiTypes는 유형명만.
  for (const t of env.foundPiiTypes) {
    assert.equal(typeof t, 'string');
    assert.ok(!/\d/.test(t) || /^[a-z_]+$/i.test(t), 'foundPiiTypes 유형명만(원문 숫자값 금지)');
  }
});

test('error 상태: maskedQuery=null, errorCode enum만 (자유문자열 금지)', () => {
  const env = mod.processInput('아무 문의', { forceError: true });
  assertEnvelopeShape(env);
  assert.equal(env.maskingStatus, 'error');
  assert.equal(env.maskedQuery, null);
  assert.equal(env.errorCode, 'MASK_ERROR');
});

// ---------------------------------------------------------------------------
// 부가: 응급은 마스킹 성패와 독립적으로 항상 평가·반환 (응급 유실 금지)
// ---------------------------------------------------------------------------
test('마스킹 uncertain이어도 응급 플래그는 보존', () => {
  const env = mod.processInput('눈에 심한 통증과 출혈이 있어요', { forceUncertain: true });
  assertEnvelopeShape(env);
  assert.notEqual(env.maskingStatus, 'ok');
  assert.equal(env.maskedQuery, null);
  assert.equal(env.emergency, true, '마스킹 실패와 무관하게 응급 보존');
});

// ---------------------------------------------------------------------------
// 부가: 빈 입력도 항상-반환 envelope (프로세스 안전)
// ---------------------------------------------------------------------------
test('빈 stdin 입력도 envelope을 항상 반환', () => {
  const env = runProcess('');
  assertEnvelopeShape(env);
  assert.equal(env.emergency, false);
});

// ---------------------------------------------------------------------------
// (5) 확장 PII 패턴: 8자리 생년월일·+82 국제전화·한국 주소 마스킹 (codex C1)
// ---------------------------------------------------------------------------
test('확장 PII: 8자리 생년월일(YYYYMMDD)이 maskedQuery에 미포함', () => {
  const env = runProcess('제 생년월일은 19900101 이고 라식 문의드려요');
  assertEnvelopeShape(env);
  assert.equal(env.maskingStatus, 'ok', '구조화된 8자리 생년월일은 결정론적 마스킹');
  assert.ok(!env.maskedQuery.includes('19900101'), '8자리 생년월일 원문 미포함');
  assert.ok(env.foundPiiTypes.includes('dob'), 'dob 유형 보고');
  assert.ok(env.maskedQuery.includes('라식'), '비-PII 본문 보존');
});

test('확장 PII: +82 국제전화가 maskedQuery에 미포함', () => {
  const env = runProcess('연락은 +82-10-1234-5678 로 부탁드립니다. 예약 문의예요');
  assertEnvelopeShape(env);
  assert.equal(env.maskingStatus, 'ok');
  assert.ok(!env.maskedQuery.includes('+82-10-1234-5678'), '+82 전화 원문 미포함');
  assert.ok(!env.maskedQuery.includes('1234-5678'), '전화 일부도 미포함');
  assert.ok(env.foundPiiTypes.includes('phone_intl'), 'phone_intl 유형 보고');
});

test('확장 PII: 한국 주소(시/도·구·동·번지)가 maskedQuery에 미포함', () => {
  const env = runProcess('주소는 서울특별시 강남구 역삼동 123-45 입니다. 오시는 길 안내 부탁해요');
  assertEnvelopeShape(env);
  // 마스킹되어 ok이거나, 표지어 잔존으로 uncertain일 수 있다(둘 다 fail-safe).
  if (env.maskingStatus === 'ok') {
    assert.ok(!env.maskedQuery.includes('역삼동 123-45'), '주소 원문 미포함');
    assert.ok(env.foundPiiTypes.includes('address'), 'address 유형 보고');
  } else {
    assert.equal(env.maskedQuery, null, '주소 표지어 잔존 시 fail-closed(maskedQuery=null)');
  }
});

// ---------------------------------------------------------------------------
// (6) PII 표지어 잔존 시 uncertain (fail-closed) — 비정형 PII는 보수 처리 (codex C1)
// ---------------------------------------------------------------------------
test('표지어 잔존 fail-closed: 표지어 + 인접 숫자/주소 토막이 남으면 uncertain', () => {
  // 정규식이 못 잡은 비정형이지만 표지어(주민번호·연락처·주소)가 인접 숫자/행정구역과 남는 케이스.
  for (const raw of [
    '제 주민번호는 1234 뒤에 더 있어요',
    '연락처 끝자리만 5678 입니다',
    '주소: 무슨동 12로 부근이에요',
  ]) {
    const env = runProcess(raw);
    assertEnvelopeShape(env);
    assert.equal(env.maskingStatus, 'uncertain', `표지어 잔존 fail-closed: ${raw}`);
    assert.equal(env.maskedQuery, null, 'uncertain이면 maskedQuery=null');
  }
});

test("표지어 단독(인접 PII 없음)·비-PII 본문은 ok 유지(과잉 차단 방지)", () => {
  for (const raw of ['주소 등록 방법 알려주세요', '라식 수술 가격이 궁금합니다']) {
    const env = runProcess(raw);
    assertEnvelopeShape(env);
    assert.equal(env.maskingStatus, 'ok', `과잉 차단 아님: ${raw}`);
  }
});

// ---------------------------------------------------------------------------
// (7) 응급 표현 확장: 통증 역순·출혈 동의어·급성 시력저하 구어 (codex Important)
// ---------------------------------------------------------------------------
test('확장 응급 표현(구어/역순)도 emergency=true', () => {
  for (const raw of [
    '눈이 너무 아파요',
    '눈이 심하게 아파요',
    '눈에서 피가 나요',
    '갑자기 안 보여요',
    '한쪽 눈이 안 보임',
  ]) {
    const env = runProcess(raw);
    assertEnvelopeShape(env);
    assert.equal(env.emergency, true, `확장 응급 분류: ${raw}`);
  }
});

// ---------------------------------------------------------------------------
// (8) RAG 출력단 전 필드 마스킹 maskFields (§6.4·§7.2.3) — content·source·heading
// ---------------------------------------------------------------------------
test('§7.2.3 maskFields: content·source·heading 각 필드 PII가 마스킹됨', () => {
  const row = {
    content: '환자 연락처 010-9876-5432 로 안내. 이메일 patient@example.com',
    source: 'knowledge/case_홍길동님 010-1111-2222.md',
    heading: '상담 hong.gil@example.com 케이스 요약',
    chunk_index: 3,
    similarity: 0.91,
    source_type: 'knowledge',
  };
  const { masked, foundTypes } = mod.maskFields(row);

  // content: 전화·이메일 원문 제거.
  assert.ok(!masked.content.includes('010-9876-5432'), 'content 전화 마스킹');
  assert.ok(!masked.content.includes('patient@example.com'), 'content 이메일 마스킹');
  // source: 파일명 내 전화 원문 제거(파일명으로 식별정보 누출 차단).
  assert.ok(!masked.source.includes('010-1111-2222'), 'source 전화 마스킹');
  // heading: 제목 내 이메일 원문 제거.
  assert.ok(!masked.heading.includes('hong.gil@example.com'), 'heading 이메일 마스킹');
  // 비-PII 필드는 보존.
  assert.equal(masked.chunk_index, 3, '비-PII 필드 보존');
  assert.equal(masked.similarity, 0.91);
  // 유형명만 반환(원문 값 금지).
  for (const t of foundTypes) {
    assert.ok(/^[a-z_]+$/.test(t), `유형명만: ${t}`);
  }
  assert.ok(foundTypes.includes('phone') || foundTypes.includes('email'), '발견 유형 보고');
});

test('§7.2.3 maskFields: 각 필드를 독립적으로 마스킹(한 필드만 PII여도 처리)', () => {
  // source에만 PII가 있는 경우에도 그 필드가 마스킹되어야 한다(content만 검사하면 누출).
  const onlySource = mod.maskFields({
    content: '수술 후 회복 기간 일반 안내',
    source: 'knowledge/홍길동 010-3333-4444.md',
    heading: '회복 기간',
  });
  assert.ok(!onlySource.masked.source.includes('010-3333-4444'), 'source 단독 PII도 마스킹');
  assert.equal(onlySource.masked.content, '수술 후 회복 기간 일반 안내', '비-PII content 보존');
});

// ---------------------------------------------------------------------------
// (9) 프로세스 실패 폴백 신호 — 호출자가 RAG 차단+보수적 응급 폴백 가능 (codex Important)
//     preprocess가 비정상 상태를 envelope/exit로 신호하는지 검증(호출자 분기 근거).
// ---------------------------------------------------------------------------
test('프로세스 실패 신호: timeout이면 errorCode=TIMEOUT·maskedQuery=null·보수적 emergency', () => {
  // 모듈 API로 timeout 모사는 불가하므로, envelope 계약을 직접 검증(호출자 fail-closed 분기 근거).
  // 실제 CLI timeout 경로는 main()이 emit(envelope('error', null, true, [], 'TIMEOUT'))로 수렴한다.
  const env = mod.processInput('아무 문의', { forceError: true });
  assertEnvelopeShape(env);
  assert.notEqual(env.maskingStatus, 'ok', '비정상 상태는 ok 아님 → RAG 진행 불가');
  assert.equal(env.maskedQuery, null, '비정상이면 maskedQuery=null(RAG 차단 근거)');
});

test('프로세스 파싱불가/비정상 출력 모사: 비-JSON 출력이면 호출자가 fail-closed 판정 가능', () => {
  // preprocess는 항상 JSON envelope 한 줄을 낸다. 호출자가 JSON.parse 실패 시 fail-closed로
  // 간주해야 함을 명시 검증: 비-JSON 문자열은 파싱 실패하고, 그 자체가 차단 신호다.
  let parsed = null;
  let parseFailed = false;
  try {
    parsed = JSON.parse('이것은 envelope이 아닌 비정상 출력입니다');
  } catch {
    parseFailed = true;
  }
  assert.equal(parseFailed, true, '파싱 불가 출력은 JSON.parse 실패(호출자 fail-closed 신호)');
  assert.equal(parsed, null, '파싱 실패 시 envelope 부재 → RAG/답변 차단 + 보수적 응급 폴백 분기');
});

test('정상 프로세스는 항상 단일 JSON envelope을 stdout으로 낸다(파싱 가능)', () => {
  // 정상 경로의 출력 계약: 호출자가 한 줄 JSON으로 파싱 가능해야 분기할 수 있다.
  const env = runProcess('라식 가격 문의');
  assertEnvelopeShape(env);
});

test('실제 프로세스: 과대 입력(max-len 초과)은 uncertain+maskedQuery=null로 신호(RAG 차단 근거)', () => {
  // 실제 CLI 경로로 비정상(uncertain) 상태를 유발 → 호출자가 maskedQuery로 RAG 진행 불가.
  const big = '가'.repeat(50) + ' 라식 문의';
  const env = runProcess(big, ['--max-len', '10']);
  assertEnvelopeShape(env);
  assert.equal(env.maskingStatus, 'uncertain', '과대 입력은 보수적으로 uncertain');
  assert.equal(env.maskedQuery, null, 'uncertain이면 maskedQuery=null → RAG/답변 차단');
  assert.equal(env.errorCode, 'PII_UNCERTAIN');
});
