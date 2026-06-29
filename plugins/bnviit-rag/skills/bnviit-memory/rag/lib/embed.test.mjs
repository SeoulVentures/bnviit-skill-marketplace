import { test } from 'node:test';
import assert from 'node:assert/strict';
import { embeddingFingerprint } from './embed.mjs';

test('fingerprint는 결정적이고 모델/차원을 반영', () => {
  const fp1 = embeddingFingerprint();
  const fp2 = embeddingFingerprint();
  assert.equal(fp1, fp2);
  assert.match(fp1, /multilingual-e5-small/);
  assert.match(fp1, /d=384/);
});
