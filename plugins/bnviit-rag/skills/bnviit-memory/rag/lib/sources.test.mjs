import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { collectSources } from './sources.mjs';

function tmpRoot() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'rag-src-'));
  fs.mkdirSync(path.join(d, 'knowledge'));
  fs.writeFileSync(path.join(d, 'knowledge', 'a.md'), '# A\n본문');
  fs.writeFileSync(path.join(d, 'knowledge', 'note.txt'), '무시'); // 확장자 외
  fs.mkdirSync(path.join(d, 'sops'));
  fs.writeFileSync(path.join(d, 'sops', 's.md'), '# S');
  return d;
}

test('md만 수집하고 source_type을 디렉터리로 태깅', () => {
  const root = tmpRoot();
  const got = collectSources(root);
  const types = Object.fromEntries(got.map((x) => [x.source, x.sourceType]));
  assert.equal(types['knowledge/a.md'], 'knowledge');
  assert.equal(types['sops/s.md'], 'sop');
  assert.ok(!('knowledge/note.txt' in types), '.txt는 제외');
});

test('루트 밖 symlink는 제외', () => {
  const root = tmpRoot();
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'rag-out-'));
  fs.writeFileSync(path.join(outside, 'x.md'), '# X');
  try { fs.symlinkSync(path.join(outside, 'x.md'), path.join(root, 'knowledge', 'link.md')); } catch { return; }
  const got = collectSources(root);
  assert.ok(!got.some((x) => x.source.endsWith('link.md')), '루트 밖 symlink 포함됨');
});
