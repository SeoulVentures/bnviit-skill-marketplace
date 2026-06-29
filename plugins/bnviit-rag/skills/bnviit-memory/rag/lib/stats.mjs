import { getMeta } from './db.mjs';
export async function collectStats(db) {
  const total = await db.query('SELECT count(*)::int AS n FROM chunks');
  const byType = await db.query('SELECT source_type, count(*)::int AS n FROM chunks GROUP BY source_type ORDER BY n DESC');
  const srcs = await db.query('SELECT count(DISTINCT source)::int AS n FROM chunks');
  const meta = await getMeta(db);
  return { chunks: total.rows[0].n, sources: srcs.rows[0].n, byType: byType.rows,
    last_ingest_at: meta.last_ingest_at || null, embedding_fingerprint: meta.embedding_fingerprint || null };
}
