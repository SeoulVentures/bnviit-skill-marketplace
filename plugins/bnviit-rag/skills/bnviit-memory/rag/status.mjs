import { resolveRoot, resolveDataDir, resolveCacheDir } from './config.mjs';
import { openDb } from './lib/db.mjs';
import { collectStats } from './lib/stats.mjs';
const argv = process.argv.slice(2);
const json = argv.includes('--json');
// R2#3/R2#4: 우선순위 CLI > env > root. --root/--data-dir/--cache-dir 값을 명시 파싱(ingest와 동일 패턴).
// B5: 다운로드 미허용(캐시 온리) — RAG_ALLOW_DOWNLOAD 주입 안 함.
const optVal = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
const VALUE_OPTS = new Set(['--data-dir', '--cache-dir', '--root']);
const dataDirArg = optVal('--data-dir');
const cacheDirArg = optVal('--cache-dir');
const cliRoot = optVal('--root') ?? argv.find((a, i) => !a.startsWith('--') && !VALUE_OPTS.has(argv[i - 1]));
const root = resolveRoot({ cliArg: cliRoot });
const dataDir = resolveDataDir({ cliDataDir: dataDirArg, root });
const cacheDir = resolveCacheDir({ cliCacheDir: cacheDirArg, root });
process.env.RAG_CACHE_DIR = cacheDir; // R3: query와 동일 패턴으로 캐시 경로 일관 주입(status는 embed 미호출이라 무해하나 일관성·향후 확장 대비)
const db = await openDb(dataDir);
const s = await collectStats(db);
await db.close();
if (json) { console.log(JSON.stringify(s, null, 2)); }
else {
  console.log('비앤빛 메모리 현황');
  console.log(`  청크 ${s.chunks} / 소스 ${s.sources}`);
  for (const t of s.byType) console.log(`  - ${t.source_type}: ${t.n}`);
  console.log(`  마지막 색인: ${s.last_ingest_at || '없음'}`);
  console.log(`  임베딩: ${s.embedding_fingerprint || '미설정'}`);
}
