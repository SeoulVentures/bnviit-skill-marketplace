// 비앤빛 채널 연동학습(teach) 산출물 검증 테스트 (정본: 설계 spec §8)
//   docs/superpowers/specs/2026-06-30-bnviit-teach-commands-design.md (v3)
//
// node:test 만 사용한다(외부 의존성 없음). 실행:
//   node --test plugins/bnviit-clinic/test/teach-docs.test.mjs
//
// 검증 범위(§8, 11항목):
//   1. 구조: channels.json 유효 + 매핑, 커맨드 2종·channel-teach SKILL 존재+frontmatter, replay.schema.json 유효 Schema
//   2. forbidden-send invariant(구조): action enum에 전송류 부재·agent_may_send false const·
//      synthetic_only true const·stop_before_step_id 실재 step 참조
//   3. JSON Schema fixture(positive/negative): 전송 action·synthetic_only:false·value_ref 자유문자열·
//      stop_before 미존재 id·전송영역 좌표-only 는 거부
//   4. PII lint adversarial: 임의 문자열 필드의 PII 패턴은 저장 전 거부(fail-closed) + 정본 부재
//   5. 전송 UI 의미검증 문구  6. web replay 불변식 문구  7. .bnviit-teach/ gitignore 강제
//   8. capability probe 문구  9. purge 범위 문구  10. 안전 문구  11. 기밀 미포함

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
// 운영 불변식 검증기(정본). 테스트는 보조 함수가 아니라 이 모듈을 import해
// positive/negative fixture를 강제한다(false-pass 방지). 저장·replay 전에도 동일 모듈을 쓴다.
import { validateArtifact } from '../teach/validate.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = dirname(__dirname);            // test/ → bnviit-clinic
const REPO_ROOT = dirname(dirname(PLUGIN_ROOT));   // plugins/bnviit-clinic → repo 루트

const TEACH_DIR = join(PLUGIN_ROOT, 'teach');
const CHANNELS_PATH = join(TEACH_DIR, 'channels.json');
const SCHEMA_PATH = join(TEACH_DIR, 'replay.schema.json');
const VALIDATE_PATH = join(TEACH_DIR, 'validate.mjs');
const SKILL_PATH = join(PLUGIN_ROOT, 'skills', 'channel-teach', 'SKILL.md');
const CMD_TEACH = join(PLUGIN_ROOT, 'commands', 'bnviit-teach.md');
const CMD_REPLAY = join(PLUGIN_ROOT, 'commands', 'bnviit-teach-replay.md');
const GITIGNORE_PATH = join(REPO_ROOT, '.gitignore');

// 정본 산출물 문서 내 PII 부재 검사용 패턴.
const RRN_RE = /\b\d{6}-\d{7}\b/;

function read(p) {
  return readFileSync(p, 'utf8');
}

function splitFrontmatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text);
  if (!m) return { frontmatter: '', body: text };
  return { frontmatter: m[1], body: m[2] };
}

function loadSchema() {
  return JSON.parse(read(SCHEMA_PATH));
}

// 유효(positive) 기준 산출물 — 합성·전송 부재. validateArtifact가 ok:true 여야 한다.
function validArtifact() {
  return {
    schema_version: '1.0',
    channel: '카카오톡',
    surface: 'desktop',
    backend: 'computer-use',
    app: 'kakaotalk-desktop',
    target: 'guide-message-compose-screen',
    synthetic_only: true,
    send_boundary: { agent_may_send: false, stop_before_step_id: 'focus-input' },
    preconditions: ['테스트 계정 로그인됨', '합성 환자 선택됨'],
    steps: [
      { id: 'open-channel', locator: { selector: '#test-channel' }, action: 'click', assertion: '채널 목록 열림' },
      { id: 'open-thread', locator: { a11y_label: '테스트 대화방' }, action: 'click', assertion: '대화방 열림' },
      { id: 'focus-input', locator: { a11y_label: '메시지 입력' }, action: 'click', assertion: '입력창 포커스됨' },
    ],
  };
}

// ──────────────────────────────────────────────────────────────────────
// 1. 구조
// ──────────────────────────────────────────────────────────────────────
test('§8.1 구조: channels.json 유효 JSON + 채널→표면→backend 매핑 존재', () => {
  assert.ok(existsSync(CHANNELS_PATH), `누락: ${CHANNELS_PATH}`);
  const json = JSON.parse(read(CHANNELS_PATH));
  assert.ok(Array.isArray(json.channels) && json.channels.length > 0, 'channels 배열 비어있음');
  for (const c of json.channels) {
    assert.ok(typeof c.channel === 'string' && c.channel, 'channel 누락');
    assert.ok(typeof c.surface === 'string' && c.surface, `${c.channel}: surface 누락`);
    assert.ok(typeof c.backend === 'string' && c.backend, `${c.channel}: backend 누락`);
  }
  // 정본 채널 6종 존재
  const names = json.channels.map((c) => c.channel);
  for (const need of ['카카오톡', 'WeChat', 'LINE', 'Zalo', '인스타그램 DM', '네이버 톡톡']) {
    assert.ok(names.includes(need), `채널 매핑 누락: ${need}`);
  }
});

test('§8.1 구조: 커맨드 2종·channel-teach SKILL 존재 + frontmatter', () => {
  for (const p of [CMD_TEACH, CMD_REPLAY, SKILL_PATH]) {
    assert.ok(existsSync(p), `누락: ${p}`);
  }
  // SKILL: name·description
  const { frontmatter: sf } = splitFrontmatter(read(SKILL_PATH));
  assert.match(sf, /^name\s*:\s*channel-teach\s*$/m, 'SKILL frontmatter name 불일치');
  assert.match(sf, /^description\s*:/m, 'SKILL frontmatter description 누락');
  // 커맨드: description
  for (const p of [CMD_TEACH, CMD_REPLAY]) {
    const { frontmatter } = splitFrontmatter(read(p));
    assert.match(frontmatter, /^description\s*:/m, `${p}: 커맨드 description 누락`);
  }
});

test('§8.1 구조: replay.schema.json 유효 JSON Schema(draft 2020-12) + validate.mjs 모듈 존재', () => {
  assert.ok(existsSync(SCHEMA_PATH), `누락: ${SCHEMA_PATH}`);
  assert.ok(existsSync(VALIDATE_PATH), `운영 검증기 누락: ${VALIDATE_PATH}`);
  const schema = loadSchema();
  assert.equal(schema.$schema, 'https://json-schema.org/draft/2020-12/schema', '$schema 불일치');
  assert.equal(schema.type, 'object', 'top-level type object 아님');
  assert.ok(Array.isArray(schema.required), 'required 누락');
  // (2) locator additionalProperties:false (임의 문자열 주입 차단)
  assert.equal(
    schema.properties.steps.items.properties.locator.additionalProperties,
    false,
    'locator additionalProperties:false 누락(raw_value 주입 차단)',
  );
  // (3) non_send const:true 단언 + coordinate→non_send 조건부 필수
  assert.equal(
    schema.properties.steps.items.properties.non_send.const,
    true,
    'non_send const:true 누락',
  );
  const allOf = schema.properties.steps.items.allOf ?? [];
  assert.ok(
    allOf.some((c) => c.if?.properties?.locator?.required?.includes('coordinate') && c.then?.required?.includes('non_send')),
    'coordinate→non_send 조건부 필수(if/then) 누락',
  );
  // (4) action==="type"→value_ref 조건부 필수
  assert.ok(
    allOf.some((c) => c.if?.properties?.action?.const === 'type' && c.then?.required?.includes('value_ref')),
    'action===type→value_ref 조건부 필수(if/then) 누락',
  );
});

// ──────────────────────────────────────────────────────────────────────
// 2. forbidden-send invariant (구조)
// ──────────────────────────────────────────────────────────────────────
test('§8.2 forbidden-send: action enum에 전송류(send/submit/confirm-send) 부재', () => {
  const schema = loadSchema();
  const actionEnum = schema.properties.steps.items.properties.action.enum;
  assert.ok(Array.isArray(actionEnum), 'action enum 누락');
  const forbidden = /send|submit|보내기|전송|제출|확인|confirm/i;
  for (const a of actionEnum) {
    assert.doesNotMatch(a, forbidden, `action enum에 전송류 값 존재: ${a}`);
  }
  // 기대 enum 정합
  assert.deepEqual(actionEnum, ['click', 'type', 'scroll', 'wait', 'assert_only']);
});

test('§8.2 forbidden-send: agent_may_send false const · synthetic_only true const', () => {
  const schema = loadSchema();
  assert.equal(schema.properties.synthetic_only.const, true, 'synthetic_only const true 아님');
  const sb = schema.properties.send_boundary.properties;
  assert.equal(sb.agent_may_send.const, false, 'agent_may_send const false 아님');
  assert.ok(sb.stop_before_step_id, 'stop_before_step_id 정의 누락');
});

test('§8.2 forbidden-send: value_ref enum(from_mission_skill/synthetic_fixture/none) — 자유 문자열 금지', () => {
  const schema = loadSchema();
  const vr = schema.properties.steps.items.properties.value_ref;
  assert.ok(Array.isArray(vr.enum), 'value_ref enum 누락(자유 문자열 허용 위험)');
  assert.deepEqual(vr.enum, ['from_mission_skill', 'synthetic_fixture', 'none']);
});

// ──────────────────────────────────────────────────────────────────────
// 3. 운영 검증기(validate.mjs) fixture (positive / negative)
//    테스트 보조 함수가 아니라 운영 모듈 validateArtifact를 직접 구동(false-pass 방지).
// ──────────────────────────────────────────────────────────────────────
test('§8.3 positive: 유효 산출물 fixture는 validateArtifact ok:true', () => {
  const r = validateArtifact(validArtifact());
  assert.equal(r.ok, true, `positive fixture가 거부됨: ${r.errors.join('; ')}`);
});

test('§8.3 negative(a): 전송 action 포함 fixture는 거부', () => {
  const art = validArtifact();
  art.steps.push({ id: 'send-it', locator: { a11y_label: '보내기' }, action: 'send', assertion: '발송됨' });
  const r = validateArtifact(art);
  assert.equal(r.ok, false, '전송 action(send) fixture가 통과됨');
  assert.ok(r.errors.some((e) => /action: enum 밖/.test(e)), `action enum 거부 사유 누락: ${r.errors.join('; ')}`);
});

test('§8.3 negative(b): synthetic_only:false fixture는 거부', () => {
  const art = validArtifact();
  art.synthetic_only = false;
  const r = validateArtifact(art);
  assert.equal(r.ok, false, 'synthetic_only:false fixture가 통과됨');
  assert.ok(r.errors.some((e) => /synthetic_only/.test(e)), '합성 전용 위반 사유 누락');
});

test('§8.3 negative(c): value_ref 자유 문자열(실제 값) fixture는 거부', () => {
  const art = validArtifact();
  art.steps[2].action = 'type';
  art.steps[2].value_ref = '안녕하세요 환자분 010-1234-5678'; // enum 밖 자유 문자열
  const r = validateArtifact(art);
  assert.equal(r.ok, false, 'value_ref 자유 문자열 fixture가 통과됨');
  assert.ok(r.errors.some((e) => /value_ref: enum 밖/.test(e)), 'value_ref enum 거부 사유 누락');
});

test('§8.3 negative(d): stop_before_step_id 미존재 id fixture는 거부', () => {
  const art = validArtifact();
  art.send_boundary.stop_before_step_id = 'does-not-exist';
  const r = validateArtifact(art);
  assert.equal(r.ok, false, '미존재 stop_before_step_id fixture가 통과됨');
  assert.ok(r.errors.some((e) => /stop_before_step_id: 미존재/.test(e)), '미존재 참조 거부 사유 누락');
});

test('§8.3 negative(e): 전송 가능 영역 좌표 step에 non_send 단언 부재 fixture는 거부', () => {
  const art = validArtifact();
  // 좌표 locator step을 non_send 단언 없이 추가 → 구조적으로 거부되어야 함.
  art.steps.push({ id: 'near-send', locator: { coordinate: [400, 720] }, action: 'click', assertion: '버튼 인근' });
  art.send_boundary.stop_before_step_id = 'near-send';
  const r = validateArtifact(art);
  assert.equal(r.ok, false, '좌표-only(non_send 부재) fixture가 통과됨');
  assert.ok(r.errors.some((e) => /non_send/.test(e)), `non_send 필수 거부 사유 누락: ${r.errors.join('; ')}`);
});

test('§8.3 negative(f): action==="type"인데 value_ref 부재 fixture는 거부', () => {
  const art = validArtifact();
  art.steps[2].action = 'type'; // value_ref 미부여
  const r = validateArtifact(art);
  assert.equal(r.ok, false, 'type action + value_ref 부재 fixture가 통과됨');
  assert.ok(r.errors.some((e) => /value_ref.*필수/.test(e)), 'type→value_ref 필수 거부 사유 누락');
});

test('§8.3 negative(g): locator 추가 속성(raw_value) fixture는 거부', () => {
  const art = validArtifact();
  art.steps[0].locator = { selector: '#x', raw_value: '환자에게 보낼 실제 메시지 리터럴' };
  const r = validateArtifact(art);
  assert.equal(r.ok, false, 'locator raw_value 추가 속성 fixture가 통과됨');
  assert.ok(r.errors.some((e) => /locator\.raw_value/.test(e)), 'locator 추가 속성 거부 사유 누락');
});

test('§8.3 positive: 좌표 step + non_send:true 단언은 허용', () => {
  const art = validArtifact();
  art.steps.push({ id: 'scroll-list', locator: { coordinate: [200, 300] }, action: 'scroll', non_send: true, assertion: '목록 스크롤됨' });
  const r = validateArtifact(art);
  assert.equal(r.ok, true, `좌표+non_send:true fixture가 거부됨: ${r.errors.join('; ')}`);
});

// ──────────────────────────────────────────────────────────────────────
// 4. PII lint adversarial fixture (validate.mjs 운영 검증기 — 모든 문자열 필드)
// ──────────────────────────────────────────────────────────────────────
test('§8.4 PII lint adversarial: 임의 문자열 필드의 PII는 validateArtifact가 거부(fail-closed)', () => {
  const cases = [
    ['target', (a) => { a.target = '홍길동님 안내 절차'; }],            // 이름+존칭
    ['preconditions', (a) => { a.preconditions.push('연락처 010-1234-5678 확인됨'); }], // 전화
    ['selector', (a) => { a.steps[0].locator.selector = '#patient-880101-1234567'; }], // 주민번호
    ['a11y_label', (a) => { a.steps[1].locator = { a11y_label: 'patient@example.com 대화' }; }], // 이메일
    ['assertion', (a) => { a.steps[2].assertion = '김환자님 010-9876-5432 노출됨'; }], // 이름+전화
    ['stop_before_step_id 근접 X(전화 in precondition)', (a) => { a.preconditions.push('환자 김민수님 연락'); }], // 이름+존칭
  ];

  for (const [field, mutate] of cases) {
    const art = validArtifact();
    mutate(art);
    const r = validateArtifact(art);
    assert.equal(r.ok, false, `${field} 필드의 PII가 거부되지 않음`);
    assert.ok(
      r.errors.some((e) => /PII lint 거부/.test(e)),
      `${field}: PII lint 거부 사유 누락: ${r.errors.join('; ')}`,
    );
  }
});

test('§8.4 정본 산출물·문서에 실환자 라벨(이름+연락처·전화·주민번호·이메일) 부재', () => {
  for (const p of [CHANNELS_PATH, SCHEMA_PATH, VALIDATE_PATH, SKILL_PATH, CMD_TEACH, CMD_REPLAY]) {
    const text = read(p);
    assert.doesNotMatch(text, RRN_RE, `${p}: 주민번호 패턴 존재`);
    // 문서 내 설명용 전화/이메일 예시도 금지(정본은 출처 키만 쓰므로).
    assert.deepEqual(text.match(/\b\d{2,3}-\d{3,4}-\d{4}\b/g) ?? [], [], `${p}: 전화 패턴 존재`);
    assert.deepEqual(
      text.match(/[^\s<>"']+@[^\s<>"']+\.[^\s<>"']+/g) ?? [],
      [],
      `${p}: 이메일 패턴 존재`,
    );
  }
});

// ──────────────────────────────────────────────────────────────────────
// 5. 전송 UI 의미검증 계약 문구 (§6.2)
// ──────────────────────────────────────────────────────────────────────
test('§8.5 전송 UI 의미검증 문구: step 직전 전송류 라벨 검사·전송 UI면 중단 + 좌표 fallback 금지', () => {
  // SKILL + replay 커맨드에 의미검증 취지 존재.
  for (const p of [SKILL_PATH, CMD_REPLAY]) {
    const text = read(p);
    assert.match(text, /의미\s*검증/, `${p}: 전송 UI 의미검증 문구 누락`);
    assert.match(text, /Send|보내기|제출|확인/, `${p}: 전송류 라벨 명시 누락`);
    assert.match(text, /좌표\s*fallback\s*금지|좌표\s*fallback\s*을?\s*(허용하지\s*않|금지)/, `${p}: 전송영역 좌표 fallback 금지 문구 누락`);
  }
});

// ──────────────────────────────────────────────────────────────────────
// 6. web replay 불변식 문구
// ──────────────────────────────────────────────────────────────────────
test('§8.6 web replay 불변식: 검증된 runtime 계약 있을 때만, 없으면 teach까지만(자동 replay 미지원)', () => {
  for (const p of [SKILL_PATH, CMD_REPLAY]) {
    const text = read(p);
    assert.match(text, /runtime\s*계약/, `${p}: 검증된 runtime 계약 문구 누락`);
    assert.match(text, /teach까지만/, `${p}: teach까지만(자동 replay 미지원) 문구 누락`);
    assert.match(text, /미지원/, `${p}: 미지원 문구 누락`);
  }
});

// ──────────────────────────────────────────────────────────────────────
// 6b. validate.mjs 운영 검증기 계약 문구(저장·replay 전 검증·실패 시 fail-closed)
// ──────────────────────────────────────────────────────────────────────
test('§8.6b validate.mjs 계약 문구: 저장·replay 전 validate.mjs 검증·ok:false면 fail-closed', () => {
  for (const p of [SKILL_PATH, CMD_TEACH, CMD_REPLAY]) {
    const text = read(p);
    assert.match(text, /validate\.mjs/, `${p}: validate.mjs 참조 누락`);
    assert.match(text, /validateArtifact/, `${p}: validateArtifact 참조 누락`);
    assert.match(text, /ok\s*:\s*false|fail-closed/, `${p}: fail-closed(ok:false) 중단 문구 누락`);
  }
  // 좌표 step 사람 확인(전송영역 아님) 문구 — replay 경로(SKILL·replay 커맨드)에 존재.
  for (const p of [SKILL_PATH, CMD_REPLAY]) {
    const text = read(p);
    assert.match(text, /non_send/, `${p}: non_send 단언 문구 누락`);
    assert.match(text, /전송\s*영역(이)?\s*아님|전송\s*영역이\s*아님/, `${p}: 좌표 step 전송영역 아님 확인 문구 누락`);
  }
});

// ──────────────────────────────────────────────────────────────────────
// 7. .bnviit-teach/ gitignore 강제
// ──────────────────────────────────────────────────────────────────────
test('§8.7 gitignore 강제: 루트 .gitignore에 .bnviit-teach/ 존재', () => {
  assert.ok(existsSync(GITIGNORE_PATH), `.gitignore 누락: ${GITIGNORE_PATH}`);
  const text = read(GITIGNORE_PATH);
  assert.match(text, /^\.bnviit-teach\/?\s*$/m, '.gitignore에 .bnviit-teach/ 항목 부재');
});

// ──────────────────────────────────────────────────────────────────────
// 8. capability probe 문구
// ──────────────────────────────────────────────────────────────────────
test('§8.8 capability probe 문구: 런타임 확인·폴백/미지원·비보존/비저장 미충족 차단', () => {
  for (const p of [SKILL_PATH, CMD_TEACH]) {
    const text = read(p);
    assert.match(text, /capability\s*probe/i, `${p}: capability probe 문구 누락`);
    assert.match(text, /런타임\s*확인/, `${p}: 런타임 확인 문구 누락`);
    assert.match(text, /폴백|미지원/, `${p}: 폴백/미지원 안내 문구 누락`);
    assert.match(text, /비보존|비저장/, `${p}: 비보존·비저장 차단 문구 누락`);
  }
});

// ──────────────────────────────────────────────────────────────────────
// 9. purge 범위 문구
// ──────────────────────────────────────────────────────────────────────
test('§8.9 purge 범위 문구: 로컬 삭제만·외부 전달분 회수 불가·1차 방어는 기록 전 합성 게이트', () => {
  // SKILL + teach 커맨드에 purge 범위 취지 존재.
  for (const p of [SKILL_PATH, CMD_TEACH]) {
    const text = read(p);
    assert.match(text, /purge/, `${p}: purge 문구 누락`);
    assert.match(text, /회수\s*(불가|하지\s*못)/, `${p}: 외부 전달분 회수 불가 문구 누락`);
    assert.match(text, /1차\s*방어/, `${p}: 1차 방어(기록 전 합성 게이트) 문구 누락`);
  }
});

// ──────────────────────────────────────────────────────────────────────
// 10. 안전 문구 검증 (SKILL/커맨드 본문)
// ──────────────────────────────────────────────────────────────────────
test('§8.10 안전 문구: 합성 데이터 전용·전송 영구 제외(사람 직접)·기록 전 PII·링크/첨부 금지·자동 발송 금지·Ask before acting', () => {
  for (const p of [SKILL_PATH, CMD_TEACH, CMD_REPLAY]) {
    const text = read(p);
    assert.match(text, /합성/, `${p}: '합성' 문구 누락`);
    assert.match(text, /전송\s*영구\s*제외|forbidden-send/, `${p}: 전송 영구 제외/forbidden-send 누락`);
    assert.match(text, /사람이\s*직접\s*클릭|사람\s*직접\s*클릭/, `${p}: 사람 직접 클릭 문구 누락`);
    assert.match(text, /링크.*(금지)|첨부.*(금지)|링크\/첨부/, `${p}: 링크/첨부 금지 문구 누락`);
    assert.match(text, /자동\s*발송\s*금지/, `${p}: 자동 발송 금지 문구 누락`);
    assert.match(text, /Ask before acting/, `${p}: Ask before acting 문구 누락`);
  }
  // 기록 전 PII 게이트: teach 진입·SKILL에 존재.
  for (const p of [SKILL_PATH, CMD_TEACH]) {
    const text = read(p);
    assert.match(text, /기록\s*(시작\s*)?전/, `${p}: 기록 전 PII 게이트 문구 누락`);
  }
});

// ──────────────────────────────────────────────────────────────────────
// 11. 기밀 미포함 (정본 산출물 전반 — manifest author 제외)
// ──────────────────────────────────────────────────────────────────────
test('§8.11 기밀 미포함: 정본 teach 산출물에 실명+연락처·전화·주민번호·이메일 패턴 부재', () => {
  const NAME_CONTACT = /[가-힣]{2,4}\s*(님|환자|씨)\s*[\d(]/; // 이름+연락처 근접
  for (const p of [CHANNELS_PATH, SCHEMA_PATH, VALIDATE_PATH, SKILL_PATH, CMD_TEACH, CMD_REPLAY]) {
    const text = read(p);
    assert.doesNotMatch(text, RRN_RE, `${p}: 주민번호 패턴`);
    assert.doesNotMatch(text, NAME_CONTACT, `${p}: 실명+연락처 패턴`);
    assert.deepEqual(text.match(/\b\d{2,3}-\d{3,4}-\d{4}\b/g) ?? [], [], `${p}: 전화 패턴`);
    assert.deepEqual(
      text.match(/[^\s<>"']+@[^\s<>"']+\.[^\s<>"']+/g) ?? [],
      [],
      `${p}: 이메일 패턴`,
    );
  }
});
