import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..', '..', '..'); // repo root

test('plugin.json은 유효하고 이름이 bnviit-rag', () => {
  const p = JSON.parse(fs.readFileSync(path.join(ROOT, 'plugins/bnviit-rag/.claude-plugin/plugin.json'), 'utf8'));
  assert.equal(p.name, 'bnviit-rag');
  assert.ok(p.version);
});

test('marketplace.json에 bnviit-rag가 등록됨', () => {
  const m = JSON.parse(fs.readFileSync(path.join(ROOT, '.claude-plugin/marketplace.json'), 'utf8'));
  const names = m.plugins.map((x) => x.name);
  assert.ok(names.includes('bnviit-rag'), 'plugins[]에 bnviit-rag 없음');
  const entry = m.plugins.find((x) => x.name === 'bnviit-rag');
  assert.equal(entry.source, './plugins/bnviit-rag');
});

test('LICENSE는 MIT', () => {
  const l = fs.readFileSync(path.join(ROOT, 'plugins/bnviit-rag/LICENSE'), 'utf8');
  assert.match(l, /MIT License/);
});

test('rag/.gitignore가 .pgdata와 .cache를 무시', () => {
  const g = fs.readFileSync(path.join(ROOT, 'plugins/bnviit-rag/skills/bnviit-memory/rag/.gitignore'), 'utf8');
  assert.match(g, /\.pgdata\//);
  assert.match(g, /\.cache\//);
});
