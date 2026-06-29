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
