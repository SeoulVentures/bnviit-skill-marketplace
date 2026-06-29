import { test } from 'node:test'; import assert from 'node:assert/strict';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { acquireLock } from './lock.mjs';
test('두 번째 acquire는 throw, release 후 재취득 가능', async () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'rag-lock-'));
  const rel = await acquireLock(d);
  await assert.rejects(() => acquireLock(d));
  rel();
  const rel2 = await acquireLock(d); rel2();
});
