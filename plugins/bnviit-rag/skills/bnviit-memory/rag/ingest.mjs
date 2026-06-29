// RAG 색인 — md 파일을 청킹·임베딩·업서트.
// 멱등: content_hash가 같은 청크는 임베딩을 재계산하지 않는다.
import fs from 'node:fs';
import { DATA_DIR, CHUNK_MAX_CHARS, CHUNK_OVERLAP } from './config.mjs';
import { openDb, upsertChunk, existingHashes, deleteMissing, stats } from './lib/db.mjs';
import { embed } from './lib/embed.mjs';
import { chunkMarkdown, sha1, chunkId } from './lib/chunk.mjs';
import { collectSources } from './lib/sources.mjs';

const BATCH = 16;

async function statsOnly() {
  const db = await openDb(DATA_DIR);
  const s = await stats(db);
  console.log('RAG 메모리 현황');
  console.log('  청크:', s.chunks, '/ 소스 파일:', s.sources);
  for (const t of s.byType) console.log(`  - ${t.source_type}: ${t.n}`);
  await db.close();
}

async function main() {
  if (process.argv.includes('--stats')) return statsOnly();

  const db = await openDb(DATA_DIR);
  const known = await existingHashes(db);

  const sources = collectSources();
  console.log(`색인 대상 파일: ${sources.length}개`);

  let added = 0, updated = 0, skipped = 0, removed = 0;

  for (const src of sources) {
    let text;
    try {
      text = fs.readFileSync(src.absPath, 'utf8');
    } catch {
      continue;
    }
    const pieces = chunkMarkdown(text, { maxChars: CHUNK_MAX_CHARS, overlap: CHUNK_OVERLAP });
    const keepIds = new Set();

    // 임베딩이 필요한 청크만 모은다(멱등).
    const pending = [];
    pieces.forEach((p, i) => {
      const id = chunkId(src.source, i);
      const hash = sha1(p.content);
      keepIds.add(id);
      if (known.get(id) === hash) {
        skipped++;
      } else {
        pending.push({ id, index: i, heading: p.heading, content: p.content, hash, isNew: !known.has(id) });
      }
    });

    for (let b = 0; b < pending.length; b += BATCH) {
      const batch = pending.slice(b, b + BATCH);
      const vectors = await embed(batch.map((x) => x.content), 'passage');
      for (let j = 0; j < batch.length; j++) {
        const x = batch[j];
        await upsertChunk(db, {
          id: x.id,
          source: src.source,
          source_type: src.sourceType,
          heading: x.heading,
          chunk_index: x.index,
          content: x.content,
          char_len: x.content.length,
          content_hash: x.hash,
          embedding: vectors[j],
        });
        if (x.isNew) added++; else updated++;
      }
    }

    // 파일에서 사라진 청크 제거
    removed += await deleteMissing(db, src.source, keepIds);
  }

  const s = await stats(db);
  console.log(`완료 — 신규 ${added} · 갱신 ${updated} · 스킵 ${skipped} · 삭제 ${removed}`);
  console.log(`현재 총 청크 ${s.chunks} (소스 ${s.sources})`);
  await db.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
