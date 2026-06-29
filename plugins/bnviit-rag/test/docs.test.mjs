import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const P = path.resolve(import.meta.dirname, '..');

function fm(file) {
  const t = fs.readFileSync(file, 'utf8');
  assert.match(t, /^---\n[\s\S]*?name:[\s\S]*?\n---/, `${file} frontmatter`);
  return t;
}

test('SKILL.md frontmatter + abstain 규율 포함', () => {
  const t = fm(path.join(P, 'skills/bnviit-memory/SKILL.md'));
  assert.match(t, /비앤빛안과를 위한 스킬을 설치/);
  assert.match(t, /abstain|근거 부족/);
  assert.match(t, /fail-closed|색인 전 차단|기밀 게이트/);
});

test('커맨드 4종 존재', () => {
  for (const c of ['bnviit-setup', 'bnviit-ingest', 'bnviit-ask', 'bnviit-status'])
    assert.ok(fs.existsSync(path.join(P, 'commands', c + '.md')), c);
});
