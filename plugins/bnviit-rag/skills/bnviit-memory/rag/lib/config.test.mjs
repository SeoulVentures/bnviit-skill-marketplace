import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import * as cfg from '../config.mjs'; // config.test.mjs는 lib/ 하위, config.mjs는 rag/ 직속 → 상위 경로

test('기본 상수', () => {
  assert.equal(cfg.EMBED_DIM, 384);
  assert.equal(cfg.CHUNK_MAX_CHARS, 1200);
  assert.equal(cfg.CHUNK_OVERLAP, 150);
  assert.deepEqual([...cfg.INCLUDE_EXT], ['.md']);
  assert.deepEqual(cfg.SOURCE_DIRS, ['knowledge', 'agents', 'skills', 'sops']);
});

// cli/env 인자는 구현이 path.resolve로 절대화하므로(Windows는 드라이브 prefix 추가),
// 기대값도 동일하게 path.resolve로 만들어 OS 독립 비교한다.
test('resolveRoot 우선순위: CLI > env > 탐지', () => {
  assert.equal(cfg.resolveRoot({ cliArg: '/a' }), path.resolve('/a'));
  process.env.BNVIIT_RAG_ROOT = '/b';
  assert.equal(cfg.resolveRoot({}), path.resolve('/b'));
  delete process.env.BNVIIT_RAG_ROOT;
  assert.ok(typeof cfg.resolveRoot({}) === 'string');
});

test('resolveDataDir 우선순위: CLI > env > root > 기본 (R2#3)', () => {
  process.env.RAG_DATA_DIR = '/env-data';
  // CLI 인자가 env보다 우선
  assert.equal(cfg.resolveDataDir({ cliDataDir: '/cli', root: '/r' }), path.resolve('/cli'));
  // CLI 없으면 env
  assert.equal(cfg.resolveDataDir({ root: '/r' }), path.resolve('/env-data'));
  delete process.env.RAG_DATA_DIR;
  // env 없으면 root
  assert.equal(cfg.resolveDataDir({ root: '/r' }), path.join('/r', '.pgdata'));
  assert.ok(cfg.resolveDataDir({}).endsWith('.pgdata')); // root 미지정 → 번들 기준 기본
});

test('resolveCacheDir 우선순위: CLI > env > root > 번들 기본 (R2#3)', () => {
  process.env.RAG_CACHE_DIR = '/env-cache';
  assert.equal(cfg.resolveCacheDir({ cliCacheDir: '/cli-c', root: '/r' }), path.resolve('/cli-c')); // CLI 우선
  assert.equal(cfg.resolveCacheDir({ root: '/r' }), path.resolve('/env-cache'));                    // CLI 없으면 env
  delete process.env.RAG_CACHE_DIR;
  assert.equal(cfg.resolveCacheDir({ root: '/r' }), path.join('/r', '.cache'));        // env 없으면 root
  assert.ok(cfg.resolveCacheDir({}).endsWith('.cache' + path.sep) || cfg.resolveCacheDir({}).endsWith('.cache'));
});
