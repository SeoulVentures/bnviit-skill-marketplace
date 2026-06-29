import { test } from 'node:test'; import assert from 'node:assert/strict';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { execFileSync } from 'node:child_process';
const RAG = path.resolve(import.meta.dirname, '..');

// 사전 색인된 임시 프로젝트(이 테스트는 Task 7 ingest 적응 이후 실행 가능).
function ingested() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'rag-q-'));
  fs.writeFileSync(path.join(d, '.gitignore'), 'knowledge/\n.pgdata/\n.cache/\n');
  fs.mkdirSync(path.join(d, 'knowledge'));
  fs.writeFileSync(path.join(d, 'knowledge', 'care.md'), '# 케어\n수술 후 D+7 재진 예약 안내.');
  const env = { ...process.env, RAG_DATA_DIR: path.join(d, '.pgdata'), RAG_CACHE_DIR: path.join(d, '.cache'), RAG_ALLOW_DOWNLOAD: '1' };
  execFileSync('node', ['ingest.mjs', d], { cwd: RAG, env, timeout: 180000, maxBuffer: 10 * 1024 * 1024 });
  return { d, env };
}

test('--json은 명시 키만 직렬화(embedding 미포함)', { timeout: 180000 }, () => {
  const { d, env } = ingested();
  const out = execFileSync('node', ['query.mjs', '재진 예약', '--json'], { cwd: RAG, env, encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
  const rows = JSON.parse(out);
  assert.ok(Array.isArray(rows) && rows.length > 0, '결과 없음');
  const r = rows[0];
  assert.deepEqual(Object.keys(r).sort(), ['chunk_index', 'content', 'heading', 'similarity', 'source', 'source_type']);
  assert.ok(!('embedding' in r), 'embedding은 직렬화에서 제외되어야 함');
});

test('R2#4: --root/--data-dir 옵션이 질의문에 누수되지 않음', { timeout: 180000 }, () => {
  const { d } = ingested();
  // 옵션을 질의문 앞뒤에 섞어도 질의문은 "재진 예약"으로만 처리되어야 한다(옵션·값이 query에 안 섞임).
  const env = { ...process.env }; // RAG_DATA_DIR 등 미설정 → CLI 옵션으로만 경로 지정
  const out = execFileSync('node',
    ['query.mjs', '재진', '예약', '--root', d, '--data-dir', path.join(d, '.pgdata'), '--cache-dir', path.join(d, '.cache'), '--json'],
    { cwd: RAG, env, encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
  const rows = JSON.parse(out);
  assert.ok(Array.isArray(rows) && rows.length > 0, '옵션 파싱 실패 시 잘못된 경로/질의로 결과 없음');
  assert.ok(rows.some((r) => r.source.endsWith('care.md')), '기대 출처 미회수(옵션 누수 의심)');
});

test('R3: --root만으로 캐시 온리 질의 성공(RAG_CACHE_DIR/RAG_ALLOW_DOWNLOAD 미설정)', { timeout: 180000 }, () => {
  const { d } = ingested(); // 셋업 때 모델이 <d>/.cache(=ingest가 RAG_CACHE_DIR로 주입)에 캐시됨
  // 캐시 온리: 다운로드 비허용 + RAG_CACHE_DIR 미설정. query가 --root에서 cacheDir(<d>/.cache)를 파생·주입해야 캐시 적중.
  const env = { ...process.env };
  delete env.RAG_CACHE_DIR; delete env.RAG_DATA_DIR; delete env.RAG_ALLOW_DOWNLOAD;
  const out = execFileSync('node', ['query.mjs', '재진 예약', '--root', d, '--json'],
    { cwd: RAG, env, encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
  const rows = JSON.parse(out);
  assert.ok(rows.some((r) => r.source.endsWith('care.md')),
    'cacheDir 미주입 시 embed가 번들 .cache로 폴백→캐시 미스/다운로드 시도로 실패. --root 파생 캐시 주입이 동작해야 함');
});
// (R4#2: status.mjs 회귀는 status.mjs가 생성되는 Task 9로 이동 — Task 8 시점엔 status.mjs가 없어 의존성 역전.)
