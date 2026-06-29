import { test } from 'node:test'; import assert from 'node:assert/strict';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
const RAG = path.resolve(import.meta.dirname, '..');

function ingested() { // ingest.smoke / query.smoke와 동일 패턴
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'rag-stx-'));
  fs.writeFileSync(path.join(d, '.gitignore'), 'knowledge/\n.pgdata/\n.cache/\n');
  fs.mkdirSync(path.join(d, 'knowledge'));
  fs.writeFileSync(path.join(d, 'knowledge', 'care.md'), '# 케어\n수술 후 D+7 재진 예약 안내.');
  const env = { ...process.env, RAG_DATA_DIR: path.join(d, '.pgdata'), RAG_CACHE_DIR: path.join(d, '.cache'), RAG_ALLOW_DOWNLOAD: '1' };
  execFileSync('node', ['ingest.mjs', d], { cwd: RAG, env, timeout: 180000, maxBuffer: 10 * 1024 * 1024 });
  return d;
}

test('Finding3: status --data-dir <파일경로> --json → exit 1 + {ok:false} envelope', () => {
  // PGlite는 디렉터리가 아닌 일반 파일을 data-dir로 받으면 실패한다 — 에러 envelope 검증.
  const tmpFile = fs.mkdtempSync(path.join(os.tmpdir(), 'rag-st-err-')) + '/not-a-dir.txt';
  fs.writeFileSync(tmpFile, 'not a db');
  const r = spawnSync('node', ['status.mjs', '--data-dir', tmpFile, '--json'],
    { cwd: RAG, encoding: 'utf8', timeout: 15000 });
  assert.equal(r.status, 1, 'exit code는 1이어야 한다');
  const out = r.stdout.trim();
  assert.ok(out.length > 0, '--json 에러 시 stdout에 JSON이 있어야 한다');
  const parsed = JSON.parse(out);
  assert.equal(parsed.ok, false, 'ok는 false여야 한다');
  assert.equal(parsed.stage, 'error', "stage는 'error'여야 한다");
  assert.ok(typeof parsed.message === 'string' && parsed.message.length > 0, 'message 문자열 필수');
});

test('R3/R4#2: status --root가 동일 dataDir를 가리켜 색인 결과를 보고', { timeout: 180000 }, () => {
  const d = ingested();
  const env = { ...process.env };
  delete env.RAG_CACHE_DIR; delete env.RAG_DATA_DIR; delete env.RAG_ALLOW_DOWNLOAD;
  const out = execFileSync('node', ['status.mjs', '--root', d, '--json'],
    { cwd: RAG, env, encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
  const s = JSON.parse(out);
  assert.ok(s.chunks > 0, 'status가 --root 파생 dataDir(<d>/.pgdata)를 못 찾아 0 청크로 보고');
});
