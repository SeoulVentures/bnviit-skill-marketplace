import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite/vector';
import { EMBED_DIM } from '../config.mjs';
import { embeddingFingerprint } from './embed.mjs';

export const SCHEMA_VERSION = 1;

async function ensureSchema(db) {
  await db.exec(`
    CREATE EXTENSION IF NOT EXISTS vector;
    CREATE TABLE IF NOT EXISTS chunks (
      id TEXT PRIMARY KEY, source TEXT NOT NULL, source_type TEXT NOT NULL,
      heading TEXT, chunk_index INTEGER NOT NULL, content TEXT NOT NULL,
      char_len INTEGER, content_hash TEXT NOT NULL,
      embedding vector(${EMBED_DIM}), updated_at TIMESTAMPTZ DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS chunks_source_idx ON chunks(source);
    CREATE INDEX IF NOT EXISTS chunks_type_idx ON chunks(source_type);
    CREATE TABLE IF NOT EXISTS meta (
      id INTEGER PRIMARY KEY DEFAULT 1, schema_version INTEGER, embedding_fingerprint TEXT, last_ingest_at TIMESTAMPTZ
    );
  `);
}

export async function openDb(dataDir) {
  let db = new PGlite(dataDir, { extensions: { vector } });
  await ensureSchema(db);
  const fp = embeddingFingerprint();
  const res = await db.query('SELECT schema_version, embedding_fingerprint FROM meta WHERE id=1');
  const row = res.rows[0];
  const mismatch = row && (row.schema_version !== SCHEMA_VERSION || row.embedding_fingerprint !== fp);
  if (mismatch) {
    // 차원/계약 변경 → 전체 재구축(drop & recreate). 차원 불일치 row가 코사인에 섞이지 않게.
    await db.exec('DROP TABLE IF EXISTS chunks; DROP TABLE IF EXISTS meta;');
    await ensureSchema(db);
  }
  await db.query(
    `INSERT INTO meta (id, schema_version, embedding_fingerprint, last_ingest_at)
     VALUES (1,$1,$2,NULL)
     ON CONFLICT (id) DO UPDATE SET schema_version=EXCLUDED.schema_version, embedding_fingerprint=EXCLUDED.embedding_fingerprint`,
    [SCHEMA_VERSION, fp]
  );
  return db; // B9: 색인 전 last_ingest_at은 NULL(=status '없음'). setMeta(UPDATE)로만 채운다.
}

export function toVectorLiteral(a) { return '[' + a.join(',') + ']'; }

export async function upsertChunk(db, r) {
  await db.query(
    `INSERT INTO chunks (id,source,source_type,heading,chunk_index,content,char_len,content_hash,embedding,updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::vector,now())
     ON CONFLICT (id) DO UPDATE SET source=EXCLUDED.source, source_type=EXCLUDED.source_type, heading=EXCLUDED.heading,
       chunk_index=EXCLUDED.chunk_index, content=EXCLUDED.content, char_len=EXCLUDED.char_len,
       content_hash=EXCLUDED.content_hash, embedding=EXCLUDED.embedding, updated_at=now()`,
    [r.id, r.source, r.source_type, r.heading, r.chunk_index, r.content, r.char_len, r.content_hash, toVectorLiteral(r.embedding)]
  );
}

export async function existingHashes(db) {
  const res = await db.query('SELECT id, content_hash FROM chunks');
  const m = new Map(); for (const r of res.rows) m.set(r.id, r.content_hash); return m;
}
export async function deleteMissing(db, source, keepIds) {
  const res = await db.query('SELECT id FROM chunks WHERE source=$1', [source]);
  const del = res.rows.map((r) => r.id).filter((id) => !keepIds.has(id));
  for (const id of del) await db.query('DELETE FROM chunks WHERE id=$1', [id]);
  return del.length;
}
export async function search(db, qvec, { k = 5, sourceType = null } = {}) {
  const params = [toVectorLiteral(qvec), k]; let where = '';
  if (sourceType) { where = 'WHERE source_type = $3'; params.push(sourceType); }
  const res = await db.query(
    `SELECT source, source_type, heading, chunk_index, content, 1 - (embedding <=> $1::vector) AS similarity
     FROM chunks ${where} ORDER BY embedding <=> $1::vector LIMIT $2`, params);
  return res.rows;
}
export async function getMeta(db) { const r = await db.query('SELECT * FROM meta WHERE id=1'); return r.rows[0] || {}; }
export async function setMeta(db) { await db.query('UPDATE meta SET last_ingest_at=now() WHERE id=1'); }
