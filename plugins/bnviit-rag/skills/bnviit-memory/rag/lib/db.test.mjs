import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { openDb, upsertChunk, search, deleteMissing, existingHashes, getMeta } from './db.mjs';

function fakeVec(seed) { return Array.from({ length: 384 }, (_, i) => ((i + seed) % 7) / 10); }
function tmpData() { return fs.mkdtempSync(path.join(os.tmpdir(), 'rag-db-')); }

test('upsert 후 코사인 검색이 자기 자신을 1순위로', async () => {
  const db = await openDb(tmpData());
  await upsertChunk(db, { id: 'a', source: 'knowledge/x.md', source_type: 'knowledge', heading: 'H', chunk_index: 0, content: 'hello', char_len: 5, content_hash: 'h1', embedding: fakeVec(1) });
  await upsertChunk(db, { id: 'b', source: 'knowledge/y.md', source_type: 'knowledge', heading: null, chunk_index: 0, content: 'world', char_len: 5, content_hash: 'h2', embedding: fakeVec(5) });
  const rows = await search(db, fakeVec(1), { k: 2 });
  assert.equal(rows[0].source, 'knowledge/x.md');
  await db.close();
});

test('meta 테이블에 fingerprint 저장됨', async () => {
  const db = await openDb(tmpData());
  const m = await getMeta(db);
  assert.ok(m.embedding_fingerprint);
  assert.equal(m.schema_version, 1);
  await db.close();
});

test('deleteMissing은 keep에 없는 청크 제거', async () => {
  const db = await openDb(tmpData());
  await upsertChunk(db, { id: 'a', source: 's.md', source_type: 'sop', heading: null, chunk_index: 0, content: 'x', char_len: 1, content_hash: 'h', embedding: fakeVec(1) });
  const removed = await deleteMissing(db, 's.md', new Set());
  assert.equal(removed, 1);
  await db.close();
});
