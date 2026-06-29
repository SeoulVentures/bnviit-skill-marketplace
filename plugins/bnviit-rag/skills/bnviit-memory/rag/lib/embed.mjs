import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { EMBED_MODEL, EMBED_REVISION, EMBED_DIM } from '../config.mjs';

let _p = null;
async function getExtractor() {
  if (!_p) {
    const { pipeline, env } = await import('@huggingface/transformers');
    // B3/Codex#4: .pathname은 공백/한글을 %20 등으로 남겨 잘못된 경로를 만든다 → fileURLToPath.
    // R2#2: 실제 모델 캐시 경로 == 게이트가 검사한 경로가 되도록, RAG_CACHE_DIR(있으면) 최우선.
    //   ingest/query/status는 resolveCacheDir({cliCacheDir,root})를 계산해 RAG_CACHE_DIR로 주입하므로 둘이 항상 일치한다.
    //   lib 단독 호출(env 미설정)일 때만 번들 기본(rag/.cache)로 폴백.
    env.cacheDir = process.env.RAG_CACHE_DIR
      ? path.resolve(process.env.RAG_CACHE_DIR)
      : fileURLToPath(new URL('../.cache/', import.meta.url));
    // B5: fail-safe 반전 — 기본은 다운로드 금지(false). 최초 색인(ingest)에서만 RAG_ALLOW_DOWNLOAD=1로 허용.
    env.allowRemoteModels = (process.env.RAG_ALLOW_DOWNLOAD === '1');
    _p = pipeline('feature-extraction', EMBED_MODEL, { revision: EMBED_REVISION });
  }
  return _p;
}

export async function embed(texts, kind = 'passage') {
  if (texts.length === 0) return [];
  const extractor = await getExtractor();
  const prefix = kind === 'query' ? 'query: ' : 'passage: ';
  const out = await extractor(texts.map((t) => prefix + t), { pooling: 'mean', normalize: true });
  return out.tolist();
}
export async function embedOne(text, kind = 'passage') { const [v] = await embed([text], kind); return v; }

import crypto from 'node:crypto';
export function embeddingFingerprint() {
  const contract = `model=${EMBED_MODEL};rev=${EMBED_REVISION};prefix=passage|query;pool=mean;norm=l2;d=${EMBED_DIM}`;
  return contract + ';sha=' + crypto.createHash('sha1').update(contract).digest('hex').slice(0, 12);
}
