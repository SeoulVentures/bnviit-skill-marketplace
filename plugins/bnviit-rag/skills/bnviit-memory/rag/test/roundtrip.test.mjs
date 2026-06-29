import { test } from 'node:test'; import assert from 'node:assert/strict';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { execFileSync } from 'node:child_process';
const RAG = path.resolve(import.meta.dirname, '..');

function project() {
  // 한글·공백 경로 — embed cacheDir(fileURLToPath) 회귀 고정
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'rag 통합-'));
  fs.writeFileSync(path.join(d, '.gitignore'), 'knowledge/\n.pgdata/\n.cache/\n');
  fs.mkdirSync(path.join(d, 'knowledge'));
  fs.writeFileSync(path.join(d, 'knowledge', '09-care.md'), '# 케어 자동화\n수술 후 D+7: 1주 축하 + 재진 예약 CTA + 시력 기록 요청.');
  fs.writeFileSync(path.join(d, 'knowledge', '07-arch.md'), '# 아키텍처\n5겹 오류 방어 모델: 지식DB·의료안전필터·PMO검수·사람승인·사후감사.');
  return d;
}

test('ingest 후 질의가 기대 출처를 top-k에 회수 + 재색인 멱등', { timeout: 180000 }, () => {
  const proj = project();
  // B5: 최초 색인 다운로드 허용 + .cache 공유(ingest.smoke와 동일 캐시 dir 재사용 권장). Codex#12: options는 두 번째 인자.
  const env = { ...process.env, RAG_DATA_DIR: path.join(proj, '.pgdata'), RAG_CACHE_DIR: path.join(proj, '.cache'), RAG_ALLOW_DOWNLOAD: '1' };
  execFileSync('node', ['ingest.mjs', proj], { cwd: RAG, env, timeout: 180000, maxBuffer: 10 * 1024 * 1024 });
  const out = execFileSync('node', ['query.mjs', '5겹 오류 방어 모델', '--json'], { cwd: RAG, env, encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
  const rows = JSON.parse(out);
  assert.ok(rows.some((r) => r.source.endsWith('07-arch.md')), '기대 출처 미회수');
  // B8: 멱등 어서션 강화 — 두 번째 색인은 신규/갱신이 0이어야 한다(스킵만).
  const again = execFileSync('node', ['ingest.mjs', proj], { cwd: RAG, env, encoding: 'utf8', timeout: 180000, maxBuffer: 10 * 1024 * 1024 });
  assert.match(again, /신규 0/);
  assert.match(again, /갱신 0/);
});
