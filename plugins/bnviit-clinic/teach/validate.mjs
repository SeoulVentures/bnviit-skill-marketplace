// 비앤빛 채널 연동학습(teach) 산출물 운영 검증기 (정본 불변식 강제)
//   설계 spec §6.1·§6.2·§6.3 (docs/superpowers/specs/2026-06-30-bnviit-teach-commands-design.md, v3)
//
// 외부 의존성 0(순수 node). 저장(teach ④)·재생(replay) 전에 이 모듈로 검증하며,
// ok:false 면 fail-closed(저장/재생 중단)한다. teach-docs.test.mjs가 이 모듈을 import해
// positive/negative fixture를 강제한다(테스트 보조 함수에만 두지 않음 — false-pass 방지).
//
// 검사 불변식:
//   (a) 필수 키·enum·const(synthetic_only===true·send_boundary.agent_may_send===false)
//   (b) steps[].action enum에 전송류(send/submit/보내기/전송/제출/확인 등) 부재
//   (c) send_boundary.stop_before_step_id 가 실재 step id 참조(미존재면 거부)
//   (d) 모든 문자열 필드 PII lint(주민번호·전화·이메일·이름+연락처 발견 시 ok:false)
//   (e) value_ref enum(자유 문자열 금지) + action==="type"이면 value_ref 필수
//   (f) locator: 허용 속성만(selector·a11y_label·coordinate), 추가 속성 금지(raw_value 등 차단),
//       coordinate 사용 step은 non_send:true 단언 필수(전송영역 좌표 fallback 구조 차단)

// ── 정본 enum/const ───────────────────────────────────────────────────
export const ACTION_ENUM = ['click', 'type', 'scroll', 'wait', 'assert_only'];
export const VALUE_REF_ENUM = ['from_mission_skill', 'synthetic_fixture', 'none'];
export const SURFACE_ENUM = ['desktop', 'web'];
export const BACKEND_ENUM = ['computer-use', 'claude-in-chrome'];
export const LOCATOR_KEYS = ['selector', 'a11y_label', 'coordinate'];
export const STEP_KEYS = ['id', 'locator', 'action', 'value_ref', 'assertion', 'non_send'];
export const SEND_BOUNDARY_KEYS = ['agent_may_send', 'stop_before_step_id'];
export const TOP_KEYS = [
  'schema_version', 'channel', 'surface', 'backend', 'app', 'domain',
  'target', 'synthetic_only', 'send_boundary', 'preconditions', 'steps',
];
const TOP_REQUIRED = [
  'schema_version', 'channel', 'surface', 'backend', 'target',
  'synthetic_only', 'send_boundary', 'preconditions', 'steps',
];
const ID_RE = /^[a-z0-9][a-z0-9_-]*$/;

// ── PII lint(§6.3) — 모든 자유 문자열 필드 대상 ─────────────────────────
const RRN_RE = /\b\d{6}-\d{7}\b/;
const PHONE_RE = /\b\d{2,3}-\d{3,4}-\d{4}\b/;
const EMAIL_RE = /[^\s<>"']+@[^\s<>"']+\.[^\s<>"']+/;
// 합성/테스트/가상/실(실환자)/샘플/예시/더미 등 *마커* 뒤 '환자'는 식별 이름이 아님(오탐 방지).
const SYNTHETIC_MARKER = /(합성|테스트|가상|실|샘플|예시|더미)$/;

function hasNameLikePii(text) {
  for (const m of text.matchAll(/([가-힣]{2,4})\s*(님|씨)/g)) {
    if (!SYNTHETIC_MARKER.test(m[1])) return true;
  }
  for (const m of text.matchAll(/([가-힣]{2,4})\s*환자/g)) {
    if (!SYNTHETIC_MARKER.test(m[1])) return true;
  }
  return false;
}

export function hasPii(text) {
  if (typeof text !== 'string') return false;
  return RRN_RE.test(text) || PHONE_RE.test(text) || EMAIL_RE.test(text) || hasNameLikePii(text);
}

// 산출물의 모든 문자열 필드를 (경로, 값) 쌍으로 수집.
function collectStringFields(a) {
  const out = [];
  const push = (path, v) => { if (typeof v === 'string') out.push([path, v]); };
  for (const k of ['channel', 'surface', 'backend', 'app', 'domain', 'target']) push(k, a[k]);
  if (a.send_boundary && typeof a.send_boundary === 'object') {
    push('send_boundary.stop_before_step_id', a.send_boundary.stop_before_step_id);
  }
  if (Array.isArray(a.preconditions)) {
    a.preconditions.forEach((p, i) => push(`preconditions[${i}]`, p));
  }
  if (Array.isArray(a.steps)) {
    a.steps.forEach((s, i) => {
      if (!s || typeof s !== 'object') return;
      push(`steps[${i}].id`, s.id);
      push(`steps[${i}].assertion`, s.assertion);
      if (s.locator && typeof s.locator === 'object') {
        push(`steps[${i}].locator.selector`, s.locator.selector);
        push(`steps[${i}].locator.a11y_label`, s.locator.a11y_label);
      }
    });
  }
  return out;
}

// ── 메인: validateArtifact(obj) → { ok, errors[] } ──────────────────────
export function validateArtifact(obj) {
  const errors = [];
  const err = (m) => errors.push(m);

  if (obj == null || typeof obj !== 'object' || Array.isArray(obj)) {
    return { ok: false, errors: ['$: 객체가 아님'] };
  }

  // (a) top-level: 필수 키 + 추가 속성 금지
  for (const k of TOP_REQUIRED) if (!(k in obj)) err(`$.${k}: 필수 키 누락`);
  for (const k of Object.keys(obj)) if (!TOP_KEYS.includes(k)) err(`$.${k}: 허용되지 않은 속성`);

  if (obj.schema_version !== '1.0') err('$.schema_version: const "1.0" 불일치');
  if (obj.synthetic_only !== true) err('$.synthetic_only: const true 불일치(합성 데이터 전용 위반)');
  if ('surface' in obj && !SURFACE_ENUM.includes(obj.surface)) err('$.surface: enum 밖');
  if ('backend' in obj && !BACKEND_ENUM.includes(obj.backend)) err('$.backend: enum 밖');
  if (typeof obj.channel !== 'string') err('$.channel: 문자열 아님');
  if (typeof obj.target !== 'string') err('$.target: 문자열 아님');

  // send_boundary
  const sb = obj.send_boundary;
  if (sb == null || typeof sb !== 'object' || Array.isArray(sb)) {
    err('$.send_boundary: 객체 아님');
  } else {
    for (const k of SEND_BOUNDARY_KEYS) if (!(k in sb)) err(`$.send_boundary.${k}: 필수 키 누락`);
    for (const k of Object.keys(sb)) if (!SEND_BOUNDARY_KEYS.includes(k)) err(`$.send_boundary.${k}: 허용되지 않은 속성`);
    if (sb.agent_may_send !== false) err('$.send_boundary.agent_may_send: const false 불일치(전송 영구 제외 위반)');
    if (typeof sb.stop_before_step_id !== 'string') err('$.send_boundary.stop_before_step_id: 문자열 아님');
  }

  // preconditions
  if (!Array.isArray(obj.preconditions)) err('$.preconditions: 배열 아님');
  else obj.preconditions.forEach((p, i) => { if (typeof p !== 'string') err(`$.preconditions[${i}]: 문자열 아님`); });

  // steps
  const steps = obj.steps;
  const ids = [];
  if (!Array.isArray(steps) || steps.length < 1) {
    err('$.steps: 최소 1개 배열 아님');
  } else {
    steps.forEach((s, i) => {
      const at = `$.steps[${i}]`;
      if (s == null || typeof s !== 'object' || Array.isArray(s)) { err(`${at}: 객체 아님`); return; }
      for (const k of ['id', 'locator', 'action', 'assertion']) if (!(k in s)) err(`${at}.${k}: 필수 키 누락`);
      for (const k of Object.keys(s)) if (!STEP_KEYS.includes(k)) err(`${at}.${k}: 허용되지 않은 속성(raw 리터럴 주입 차단)`);

      if (typeof s.id !== 'string' || !ID_RE.test(s.id)) err(`${at}.id: 식별자 형식 위반`);
      else ids.push(s.id);

      // (b) action enum — 전송류 부재
      if (!ACTION_ENUM.includes(s.action)) err(`${at}.action: enum 밖(전송류 action 금지)`);

      // (e) value_ref enum + action==="type"이면 필수
      if ('value_ref' in s && !VALUE_REF_ENUM.includes(s.value_ref)) {
        err(`${at}.value_ref: enum 밖(자유 문자열 금지 — 실제 값 리터럴 차단)`);
      }
      if (s.action === 'type' && !('value_ref' in s)) {
        err(`${at}.value_ref: action==="type"이면 value_ref 필수`);
      }

      if (typeof s.assertion !== 'string') err(`${at}.assertion: 문자열 아님`);

      // (f) locator: 허용 속성만 + coordinate 사용 시 non_send:true 필수
      const loc = s.locator;
      if (loc == null || typeof loc !== 'object' || Array.isArray(loc)) {
        err(`${at}.locator: 객체 아님`);
      } else {
        for (const k of Object.keys(loc)) if (!LOCATOR_KEYS.includes(k)) err(`${at}.locator.${k}: 허용되지 않은 속성(raw_value 등 차단)`);
        const hasSel = typeof loc.selector === 'string' && loc.selector;
        const hasLbl = typeof loc.a11y_label === 'string' && loc.a11y_label;
        const hasCoord = Array.isArray(loc.coordinate);
        if (!hasSel && !hasLbl && !hasCoord) err(`${at}.locator: selector·a11y_label·coordinate 중 최소 하나 필요`);
        if (hasCoord) {
          if (loc.coordinate.length !== 2 || !loc.coordinate.every((n) => typeof n === 'number')) {
            err(`${at}.locator.coordinate: [number,number] 아님`);
          }
          // (3) 좌표 step은 전송영역이 아님을 명시 단언(non_send:true) 필수.
          if (s.non_send !== true) {
            err(`${at}.non_send: coordinate locator step은 non_send===true 단언 필수(전송 가능 영역 좌표 금지)`);
          }
        } else if ('non_send' in s && s.non_send !== true && typeof s.non_send !== 'boolean') {
          err(`${at}.non_send: boolean 아님`);
        }
      }
    });
  }

  // (c) stop_before_step_id 실재 참조 + step id 유일성
  if (new Set(ids).size !== ids.length) err('$.steps: step id 중복');
  if (sb && typeof sb === 'object' && typeof sb.stop_before_step_id === 'string') {
    if (!ids.includes(sb.stop_before_step_id)) {
      err(`$.send_boundary.stop_before_step_id: 미존재 step id 참조('${sb.stop_before_step_id}')`);
    }
  }

  // (d) PII lint — 모든 문자열 필드
  for (const [path, v] of collectStringFields(obj)) {
    if (hasPii(v)) err(`${path}: PII lint 거부(주민번호·전화·이메일·이름+연락처 패턴)`);
  }

  return { ok: errors.length === 0, errors };
}

export default validateArtifact;
