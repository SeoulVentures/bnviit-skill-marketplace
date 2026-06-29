// 비앤빛 임무 산출물 검증 테스트 (정본: 설계 spec §7)
//   docs/superpowers/specs/2026-06-30-bnviit-mission-skills-design.md (v10)
//
// node:test 만 사용한다(외부 의존성 없음). 실행:
//   node --test plugins/bnviit-clinic/test/mission-docs.test.mjs
//
// 검증 범위(§7):
//   §7.1 스킬 frontmatter·존재 + patient-faq-reply '예시 스킬' 자기선언 부재
//   §7.2 환자 대상 스킬 가드레일 전수 검증
//   §7.3 에이전트 .md 구조(필수 frontmatter·섹션 헤더·owner 이메일 아님)
//   §7.4 기밀 스캔(이메일·주민번호·전화번호 필드 단위 화이트리스트)
//   + 산출물 존재(스킬 5·에이전트 3·_template·README·emergency-template·preprocess.mjs)

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
// test/ → 플러그인 루트(bnviit-clinic)
const PLUGIN_ROOT = dirname(__dirname);
// 마켓플레이스 루트(repo 루트): plugins/bnviit-clinic → 위로 두 단계
const REPO_ROOT = dirname(dirname(PLUGIN_ROOT));

const SKILLS_DIR = join(PLUGIN_ROOT, 'skills');
const AGENTS_DIR = join(PLUGIN_ROOT, 'agents');
const FAQ_DIR = join(SKILLS_DIR, 'patient-faq-reply');
// bnviit-rag 플러그인의 슬래시 명령(다른 플러그인) — argv-safe 검증 대상(§7.2.1).
const BNVIIT_ASK_PATH = join(REPO_ROOT, 'plugins', 'bnviit-rag', 'commands', 'bnviit-ask.md');

// ── 산출물 정본 목록 ──────────────────────────────────────────────────
const SKILL_NAMES = [
  'patient-faq-reply',
  'medical-safety-checker',
  'pii-masker',
  'postop-care-scheduler',
  'weekly-pmo-report',
];

// 환자 대상(동적 산출물) 스킬 — 가드레일 전수 검증 대상(§7.2)
const PATIENT_FACING_SKILLS = ['patient-faq-reply', 'postop-care-scheduler'];

const AGENT_FILES = [
  'ag-02-medical-counsel.md',
  'ag-03-operations.md',
  'ag-08-pmo-reviewer.md',
];

// ── 보조 함수 ─────────────────────────────────────────────────────────
function skillPath(name) {
  return join(SKILLS_DIR, name, 'SKILL.md');
}

function read(path) {
  return readFileSync(path, 'utf8');
}

// frontmatter(--- ... ---)와 본문을 분리한다.
function splitFrontmatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text);
  if (!m) return { frontmatter: '', body: text };
  return { frontmatter: m[1], body: m[2] };
}

// frontmatter 에서 단일 스칼라 키 값을 추출한다(간이 파서, 따옴표 제거).
function frontmatterValue(frontmatter, key) {
  const re = new RegExp(`^${key}\\s*:\\s*(.+?)\\s*$`, 'm');
  const m = re.exec(frontmatter);
  if (!m) return null;
  return m[1].replace(/^['"]|['"]$/g, '').trim();
}

// 전화번호 패턴(§7.4): 개인 연락처. 기관 공개번호는 화이트리스트로 예외.
const PHONE_RE = /\b\d{2,3}-\d{3,4}-\d{4}\b/g;
const RRN_RE = /\b\d{6}-\d{7}\b/g; // 주민번호
const EMAIL_RE = /[^\s<>"']+@[^\s<>"']+\.[^\s<>"']+/g;

// 기관 공개번호 화이트리스트 정본(§7.4) 로드.
function loadPublicNumberWhitelist() {
  const p = join(FAQ_DIR, 'public-numbers.json');
  if (!existsSync(p)) return new Set();
  const json = JSON.parse(read(p));
  const set = new Set();
  for (const entry of json.whitelist ?? []) {
    if (entry && typeof entry.number === 'string') set.add(entry.number.trim());
  }
  return set;
}

// 텍스트에서 화이트리스트에 없는 전화 패턴만 추려 반환.
function nonWhitelistedPhones(text, whitelist) {
  const found = text.match(PHONE_RE) ?? [];
  return found.filter((n) => !whitelist.has(n.trim()));
}

// ──────────────────────────────────────────────────────────────────────
// §산출물 존재 검증 (스킬 5·에이전트 3·_template·README·emergency·preprocess)
// ──────────────────────────────────────────────────────────────────────
test('산출물 존재: 스킬 5개 SKILL.md', () => {
  for (const name of SKILL_NAMES) {
    const p = skillPath(name);
    assert.ok(existsSync(p), `누락: ${p}`);
  }
});

test('산출물 존재: 에이전트 3개 + _template + README', () => {
  for (const f of AGENT_FILES) {
    const p = join(AGENTS_DIR, f);
    assert.ok(existsSync(p), `누락 에이전트: ${p}`);
  }
  assert.ok(existsSync(join(AGENTS_DIR, '_template.md')), '_template.md 누락');
  assert.ok(existsSync(join(AGENTS_DIR, 'README.md')), 'agents/README.md 누락');
});

test('산출물 존재: patient-faq-reply 보조 산출물(preprocess.mjs·emergency-template.md·public-numbers.json)', () => {
  assert.ok(existsSync(join(FAQ_DIR, 'preprocess.mjs')), 'preprocess.mjs 누락');
  assert.ok(existsSync(join(FAQ_DIR, 'emergency-template.md')), 'emergency-template.md 누락');
  assert.ok(existsSync(join(FAQ_DIR, 'public-numbers.json')), 'public-numbers.json 누락');
});

// ──────────────────────────────────────────────────────────────────────
// §7.1 스킬 frontmatter·존재
// ──────────────────────────────────────────────────────────────────────
test('§7.1 각 스킬 SKILL.md frontmatter name·description 존재', () => {
  for (const name of SKILL_NAMES) {
    const { frontmatter } = splitFrontmatter(read(skillPath(name)));
    const fmName = frontmatterValue(frontmatter, 'name');
    assert.equal(fmName, name, `${name}: frontmatter name 불일치(${fmName})`);

    // description 은 멀티라인(>- 블록 스칼라) 가능 → 키 존재만 검사.
    assert.match(
      frontmatter,
      /^description\s*:/m,
      `${name}: frontmatter description 누락`,
    );
  }
});

test("§7.1 patient-faq-reply 본문에 '예시 스킬' 자기선언 문구 부재", () => {
  const { body } = splitFrontmatter(read(skillPath('patient-faq-reply')));
  // '예시 스킬'(자기선언) 부재. '예시'(예시 섹션 등)는 허용하되,
  // '예시 스킬'/'예시 플러그인' 자기선언 형태만 금지.
  assert.doesNotMatch(
    body,
    /예시\s*스킬/,
    "patient-faq-reply 본문에 '예시 스킬' 자기선언 문구가 있으면 안 됨",
  );
  assert.doesNotMatch(
    body,
    /예시\s*플러그인/,
    "patient-faq-reply 본문에 '예시 플러그인' 자기선언 문구가 있으면 안 됨",
  );
});

// ──────────────────────────────────────────────────────────────────────
// §7.2 가드레일 전수 검증 (환자 대상 스킬)
// ──────────────────────────────────────────────────────────────────────
test('§7.2 환자 대상 스킬 가드레일 전수: medical-safety-checker·pii-masker·abstain·HITL·fail-closed', () => {
  for (const name of PATIENT_FACING_SKILLS) {
    const text = read(skillPath(name));

    assert.match(text, /medical-safety-checker/, `${name}: medical-safety-checker 참조 누락`);
    assert.match(text, /pii-masker/, `${name}: pii-masker 참조 누락`);
    assert.match(text, /abstain/, `${name}: abstain 참조 누락`);
    assert.match(text, /HITL/, `${name}: HITL 참조 누락`);
    assert.match(text, /fail-closed/, `${name}: fail-closed 참조 누락`);
  }
});

test('§7.2 환자 대상 스킬: 응급(emergency/응급) 문구 포함', () => {
  for (const name of PATIENT_FACING_SKILLS) {
    const text = read(skillPath(name));
    assert.match(text, /응급|emergency/, `${name}: 응급 문구 누락`);
  }
});

test('§7.2 환자 대상 스킬: 프롬프트 인젝션 차단 문구 포함', () => {
  for (const name of PATIENT_FACING_SKILLS) {
    const text = read(skillPath(name));
    assert.match(text, /인젝션|injection/i, `${name}: 프롬프트 인젝션 차단 문구 누락`);
  }
});

// ──────────────────────────────────────────────────────────────────────
// §7.2.2 emergency-template 정본 검증
// ──────────────────────────────────────────────────────────────────────
test('§7.2.2 emergency-template.md: 버전·승인일 메타 존재', () => {
  const { frontmatter } = splitFrontmatter(read(join(FAQ_DIR, 'emergency-template.md')));
  assert.match(frontmatter, /^version\s*:/m, 'emergency-template version 메타 누락');
  assert.match(frontmatter, /^approvedAt\s*:/m, 'emergency-template approvedAt 메타 누락');
});

test('§7.2.2 emergency-template.md: 전화/특수번호가 화이트리스트 정합', () => {
  const whitelist = loadPublicNumberWhitelist();
  assert.ok(whitelist.size > 0, 'public-numbers.json 화이트리스트가 비어 있음');
  const text = read(join(FAQ_DIR, 'emergency-template.md'));
  const leaked = nonWhitelistedPhones(text, whitelist);
  assert.deepEqual(
    leaked,
    [],
    `emergency-template 내 화이트리스트 외 번호(환자 개인번호 의심): ${leaked.join(', ')}`,
  );
});

// ──────────────────────────────────────────────────────────────────────
// §7.2.1 bnviit-ask 슬래시 명령 주입 차단(argv-safe) 검증 (C2)
//   - $ARGUMENTS를 실제 사용한다(질의 전달 결함 회귀 방지).
//   - $ARGUMENTS를 셸 실행 블록(```bash ...```) 문자열에 raw 보간하지 않는다(명령 주입 차단).
// ──────────────────────────────────────────────────────────────────────

// 펜스 코드블록(``` ... ```)을 추출. lang 태그 무관(bash·sh·없음 모두).
function fencedCodeBlocks(text) {
  const blocks = [];
  const re = /```[^\n]*\n([\s\S]*?)```/g;
  let m;
  while ((m = re.exec(text)) !== null) blocks.push(m[1]);
  return blocks;
}

test('§7.2.1 bnviit-ask.md: $ARGUMENTS를 실제 사용한다(질의 전달 결함 회귀 방지)', () => {
  assert.ok(existsSync(BNVIIT_ASK_PATH), `bnviit-ask.md 누락: ${BNVIIT_ASK_PATH}`);
  const text = read(BNVIIT_ASK_PATH);
  assert.match(text, /\$ARGUMENTS/, 'bnviit-ask.md가 $ARGUMENTS를 사용하지 않음(질의 미전달 결함)');
});

test('§7.2.1 bnviit-ask.md: 셸 실행 블록에 $ARGUMENTS raw 보간(명령 주입) 패턴 부재', () => {
  const text = read(BNVIIT_ASK_PATH);

  // (1) 어떤 펜스 코드블록에도 $ARGUMENTS가 보간되어 있으면 안 된다(셸 실행 시 명령 주입 위험).
  for (const block of fencedCodeBlocks(text)) {
    assert.ok(
      !block.includes('$ARGUMENTS'),
      '펜스 코드블록 안에 $ARGUMENTS 보간 발견(명령 주입 위험)',
    );
  }

  // (2) `node ... query.mjs ... "$ARGUMENTS"` 형태의 raw 셸 보간 호출 패턴 부재.
  //     (경고/금지 설명을 위한 인라인 코드 span은 위 (1)의 펜스 블록 검사에 걸리지 않으므로 허용.)
  const rawInterp =
    /node[^\n`]*query\.mjs[^\n`]*["']?\$ARGUMENTS["']?/;
  assert.doesNotMatch(
    text,
    new RegExp('```[^\\n]*\\n[\\s\\S]*?' + rawInterp.source + '[\\s\\S]*?```'),
    'query.mjs로의 raw 셸 보간($ARGUMENTS) bash 블록이 존재(명령 주입 위험)',
  );

  // (3) 안전 전달 메커니즘(RAG_QUERY 환경변수 또는 execFile argv) 명시.
  assert.match(
    text,
    /RAG_QUERY|execFile/,
    'argv-safe 전달(RAG_QUERY env 또는 execFile argv) 지시 누락',
  );
});

// ──────────────────────────────────────────────────────────────────────
// §7.2.3 RAG 검색 결과 출력단 마스킹(전 필드) — maskFields (C2 codex/I1)
//   content·source·heading 각각에 PII가 있으면 maskFields 후 제거됨.
// ──────────────────────────────────────────────────────────────────────
test('§7.2.3 maskFields: content·source·heading 각 필드의 PII가 제거됨', async () => {
  const { maskFields } = await import(
    join(FAQ_DIR, 'preprocess.mjs')
  );
  const row = {
    content: '환자 연락처 010-9876-5432 안내, 이메일 patient@example.com',
    source: 'knowledge/case_홍길동님 010-1111-2222.md',
    heading: '상담 hong.gil@example.com 케이스',
    chunk_index: 1,
    similarity: 0.88,
  };
  const { masked } = maskFields(row);

  // content·source·heading 각각에서 원문 PII 값이 제거되었는지 필드별로 검증.
  assert.ok(!masked.content.includes('010-9876-5432'), 'content 전화 미마스킹');
  assert.ok(!masked.content.includes('patient@example.com'), 'content 이메일 미마스킹');
  assert.ok(!masked.source.includes('010-1111-2222'), 'source(파일경로) 전화 미마스킹');
  assert.ok(!masked.heading.includes('hong.gil@example.com'), 'heading(제목) 이메일 미마스킹');
  // 비-PII 필드 보존.
  assert.equal(masked.chunk_index, 1, '비-PII 필드 보존');
});

// ──────────────────────────────────────────────────────────────────────
// §7.3 에이전트 .md 구조
// ──────────────────────────────────────────────────────────────────────
test('§7.3 에이전트 frontmatter name·description·status·owner 존재', () => {
  for (const f of AGENT_FILES) {
    const { frontmatter } = splitFrontmatter(read(join(AGENTS_DIR, f)));
    assert.match(frontmatter, /^name\s*:/m, `${f}: name 누락`);
    assert.match(frontmatter, /^description\s*:/m, `${f}: description(subagent 필수) 누락`);
    assert.match(frontmatter, /^status\s*:/m, `${f}: status 누락`);
    assert.match(frontmatter, /^owner\s*:/m, `${f}: owner 누락`);
  }
});

test('§7.3 에이전트 owner 가 이메일 패턴이 아닐 것', () => {
  for (const f of AGENT_FILES) {
    const { frontmatter } = splitFrontmatter(read(join(AGENTS_DIR, f)));
    const owner = frontmatterValue(frontmatter, 'owner');
    assert.ok(owner, `${f}: owner 값 파싱 실패`);
    assert.doesNotMatch(owner, /\S+@\S+/, `${f}: owner 가 이메일 패턴(${owner})`);
  }
});

test('§7.3 에이전트 필수 섹션 헤더(R&R·권한·에스컬레이션) 존재', () => {
  const rrRe = /^#{1,3}\s+(R&R|역할과\s+책임|R&R\s*\(.*\))/m;
  const permRe = /^#{1,3}\s+.*?(권한|Permissions)/m;
  const escRe = /^#{1,3}\s+.*?(에스컬레이션|Escalation)/m;
  for (const f of AGENT_FILES) {
    const { body } = splitFrontmatter(read(join(AGENTS_DIR, f)));
    assert.match(body, rrRe, `${f}: R&R 섹션 헤더 누락`);
    assert.match(body, permRe, `${f}: 권한(Permissions) 섹션 헤더 누락`);
    assert.match(body, escRe, `${f}: 에스컬레이션(Escalation) 섹션 헤더 누락`);
  }
});

// ──────────────────────────────────────────────────────────────────────
// §7.4 기밀 스캔 (필드 단위 화이트리스트)
//   스캔 대상: skills/**/SKILL.md + agents/**/*.md + plugin.json + marketplace.json
//   이메일은 manifest 의 author.email / owner.email 필드 값만 예외.
//   본문(SKILL.md·agents .md) 내 이메일·주민번호·개인 전화번호는 위반.
//   전화번호는 public-numbers.json 화이트리스트 등록값만 예외.
// ──────────────────────────────────────────────────────────────────────

// 스캔 대상 본문 파일(마크다운) 목록 — skills/** SKILL.md + agents/** .md
function collectMarkdownTargets() {
  const targets = [];
  for (const name of SKILL_NAMES) targets.push(skillPath(name));
  // skills/patient-faq-reply 보조 마크다운(emergency-template)도 공개 파일이므로 스캔
  targets.push(join(FAQ_DIR, 'emergency-template.md'));
  // agents 디렉터리의 모든 .md (개별 에이전트 + _template + README)
  for (const entry of readdirSync(AGENTS_DIR)) {
    if (entry.endsWith('.md')) targets.push(join(AGENTS_DIR, entry));
  }
  return targets;
}

test('§7.4 기밀 스캔: 본문(SKILL.md·agents .md)에 이메일 부재', () => {
  for (const path of collectMarkdownTargets()) {
    const text = read(path);
    const emails = text.match(EMAIL_RE) ?? [];
    assert.deepEqual(
      emails,
      [],
      `${path}: 본문 내 이메일 발견(위반): ${emails.join(', ')}`,
    );
  }
});

test('§7.4 기밀 스캔: 본문에 주민번호 패턴 부재', () => {
  for (const path of collectMarkdownTargets()) {
    const text = read(path);
    const rrns = text.match(RRN_RE) ?? [];
    assert.deepEqual(rrns, [], `${path}: 주민번호 패턴 발견(위반): ${rrns.join(', ')}`);
  }
});

test('§7.4 기밀 스캔: 본문에 개인 전화번호 패턴 부재(화이트리스트 제외)', () => {
  const whitelist = loadPublicNumberWhitelist();
  for (const path of collectMarkdownTargets()) {
    const text = read(path);
    const leaked = nonWhitelistedPhones(text, whitelist);
    assert.deepEqual(
      leaked,
      [],
      `${path}: 화이트리스트 외 전화번호(개인 연락처 의심): ${leaked.join(', ')}`,
    );
  }
});

// manifest(JSON)는 파싱해 author.email/owner.email 필드만 화이트리스트.
// 그 외 필드(description 등) 위치의 이메일은 위반.
test('§7.4 기밀 스캔: manifest 이메일은 author.email/owner.email 필드만 허용', () => {
  const manifests = [
    join(PLUGIN_ROOT, '.claude-plugin', 'plugin.json'),
    join(REPO_ROOT, '.claude-plugin', 'marketplace.json'),
  ];

  for (const mPath of manifests) {
    assert.ok(existsSync(mPath), `manifest 누락: ${mPath}`);
    const raw = read(mPath);
    const json = JSON.parse(raw);

    // 허용된 필드 값(author.email / owner.email)을 수집.
    const allowed = new Set();
    const collectAllowed = (obj) => {
      if (!obj || typeof obj !== 'object') return;
      for (const key of ['author', 'owner']) {
        const v = obj[key];
        if (v && typeof v === 'object' && typeof v.email === 'string') {
          allowed.add(v.email.trim());
        }
      }
    };
    collectAllowed(json);
    for (const p of json.plugins ?? []) collectAllowed(p);

    // raw 전체에서 이메일을 뽑아, 허용 집합에 없는 값이 있으면 위반.
    const emails = raw.match(EMAIL_RE) ?? [];
    const violating = emails
      .map((e) => e.replace(/[",]+$/g, '').trim())
      .filter((e) => !allowed.has(e));
    assert.deepEqual(
      violating,
      [],
      `${mPath}: author/owner.email 외 위치의 이메일 발견(위반): ${violating.join(', ')}`,
    );
  }
});

test('§7.4 기밀 스캔: manifest 본문에 주민번호·개인 전화번호 부재', () => {
  const whitelist = loadPublicNumberWhitelist();
  const manifests = [
    join(PLUGIN_ROOT, '.claude-plugin', 'plugin.json'),
    join(REPO_ROOT, '.claude-plugin', 'marketplace.json'),
  ];
  for (const mPath of manifests) {
    const raw = read(mPath);
    assert.deepEqual(raw.match(RRN_RE) ?? [], [], `${mPath}: 주민번호 패턴 발견(위반)`);
    assert.deepEqual(
      nonWhitelistedPhones(raw, whitelist),
      [],
      `${mPath}: 화이트리스트 외 전화번호 발견(위반)`,
    );
  }
});
