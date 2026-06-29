import { test } from 'node:test'; import assert from 'node:assert/strict';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { execFileSync } from 'node:child_process';

const RAG = path.resolve(import.meta.dirname, '..'); // rag/

function tmpProject() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'rag-proj-'));
  fs.writeFileSync(path.join(d, '.gitignore'), 'knowledge/\n.pgdata/\n.cache/\n');
  fs.mkdirSync(path.join(d, 'knowledge'));
  fs.writeFileSync(path.join(d, 'knowledge', 'care.md'), '# 케어\n수술 후 D+7 재진 예약 안내 메시지를 보낸다.');
  return d;
}

test('ingest가 기밀 게이트 통과 후 청크를 색인(exit 0)', { timeout: 180000 }, () => {
  const proj = tmpProject();
  // B5: 모델 다운로드 허용으로 결정성 확보. .cache는 roundtrip(Task 11)과 공유 권장(공유 캐시 dir 주입 가능).
  const env = { ...process.env, RAG_DATA_DIR: path.join(proj, '.pgdata'), RAG_CACHE_DIR: path.join(proj, '.cache'), RAG_ALLOW_DOWNLOAD: '1' };
  const out = execFileSync('node', ['ingest.mjs', proj], { cwd: RAG, env, encoding: 'utf8', timeout: 180000, maxBuffer: 10 * 1024 * 1024 });
  assert.match(out, /신규/);
}); // 모델 로드로 느릴 수 있음(첫 회 수십초).

test('R4#1: ingest 2회 연속이 lock 에러 없이 성공 + 실행 후 .ingest.lock 미존재', { timeout: 240000 }, () => {
  const proj = tmpProject();
  const dataDir = path.join(proj, '.pgdata');
  const env = { ...process.env, RAG_DATA_DIR: dataDir, RAG_CACHE_DIR: path.join(proj, '.cache'), RAG_ALLOW_DOWNLOAD: '1' };
  const run = () => execFileSync('node', ['ingest.mjs', proj], { cwd: RAG, env, encoding: 'utf8', timeout: 180000, maxBuffer: 10 * 1024 * 1024 });
  run();
  // 정상 종료 경로가 process.exit()를 쓰면 finally(release)가 안 돌아 lock이 남는다.
  assert.ok(!fs.existsSync(path.join(dataDir, '.ingest.lock')), '첫 ingest 후 .ingest.lock 잔류(=lock 누수)');
  const out2 = run(); // 잔류 lock이 있으면 "ingest 진행 중"으로 throw → 이 호출이 실패
  assert.match(out2, /신규 0/); // 멱등(두 번째는 신규 0)
});
