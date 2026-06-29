import { test } from 'node:test'; import assert from 'node:assert/strict';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { execSync } from 'node:child_process';
import { checkSecrecy } from './guard.mjs';
test('git 추적 중인 대상은 위반(git-tracked)', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'rag-guard-'));
  execSync('git init -q', { cwd: d });
  fs.mkdirSync(path.join(d, 'knowledge'));
  fs.writeFileSync(path.join(d, 'knowledge', 'a.md'), '# A');
  execSync('git add knowledge/a.md', { cwd: d });
  const res = checkSecrecy(d, ['knowledge']);
  assert.equal(res.ok, false);
  assert.ok(res.violations.some((v) => v.reason === 'git-tracked'));
});
test('gitignore된 대상은 통과', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'rag-guard2-'));
  execSync('git init -q', { cwd: d });
  fs.writeFileSync(path.join(d, '.gitignore'), 'knowledge/\n');
  fs.mkdirSync(path.join(d, 'knowledge'));
  fs.writeFileSync(path.join(d, 'knowledge', 'a.md'), '# A');
  const res = checkSecrecy(d, ['knowledge']);
  assert.equal(res.ok, true);
});
test('비-git 디렉터리는 차단 아닌 경고(git-unverifiable)', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'rag-guard3-'));
  fs.mkdirSync(path.join(d, 'knowledge'));
  fs.writeFileSync(path.join(d, 'knowledge', 'a.md'), '# A');
  const res = checkSecrecy(d, ['knowledge']);
  assert.equal(res.ok, true, '비-git은 차단하지 않는다(정상 시나리오)');
  assert.ok(res.warnings.some((w) => w.reason === 'git-unverifiable'), '검증 불가는 경고로 표면화');
});
test('미존재 .pgdata/.cache는 .gitignore의 디렉터리 패턴으로 통과(R2#1 — 최초 셋업 차단 회귀)', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'rag-guard4-'));
  execSync('git init -q', { cwd: d });
  fs.writeFileSync(path.join(d, '.gitignore'), 'knowledge/\n.pgdata/\n.cache/\n');
  fs.mkdirSync(path.join(d, 'knowledge'));
  fs.writeFileSync(path.join(d, 'knowledge', 'a.md'), '# A');
  // .pgdata/.cache는 아직 생성 전(미존재). 디렉터리 패턴(.pgdata/)으로 ignore 판정되어야 한다.
  const res = checkSecrecy(d, ['knowledge', '.pgdata', '.cache'], {
    dataDir: path.join(d, '.pgdata'), cacheDir: path.join(d, '.cache'),
  });
  assert.equal(res.ok, true, '미존재 .pgdata가 not-ignored로 오판되어 최초 색인이 차단되면 안 됨');
});
