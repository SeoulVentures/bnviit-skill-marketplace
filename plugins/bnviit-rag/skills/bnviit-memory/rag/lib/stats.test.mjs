import { test } from 'node:test'; import assert from 'node:assert/strict';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { openDb, upsertChunk } from './db.mjs';
import { collectStats } from './stats.mjs';
function v(s){return Array.from({length:384},(_,i)=>((i+s)%5)/10);}
test('collectStats가 총 청크·타입별 분포·fingerprint 반환', async () => {
  const db = await openDb(fs.mkdtempSync(path.join(os.tmpdir(),'rag-st-')));
  await upsertChunk(db,{id:'a',source:'knowledge/x.md',source_type:'knowledge',heading:null,chunk_index:0,content:'x',char_len:1,content_hash:'h',embedding:v(1)});
  const s = await collectStats(db);
  assert.equal(s.chunks, 1);
  assert.ok(s.embedding_fingerprint);
  assert.deepEqual(s.byType, [{ source_type: 'knowledge', n: 1 }]);
  await db.close();
});
