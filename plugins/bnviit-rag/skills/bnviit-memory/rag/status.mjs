import { resolveRoot, resolveDataDir, resolveCacheDir } from './config.mjs';
import { openDb } from './lib/db.mjs';
import { collectStats } from './lib/stats.mjs';

function parseArgs(argv) {
  const args = { json: false, root: undefined, dataDir: undefined, cacheDir: undefined };
  const VALUE_OPTS = new Set(['--data-dir', '--cache-dir', '--root']);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--root') args.root = argv[++i];
    else if (a === '--data-dir') args.dataDir = argv[++i];
    else if (a === '--cache-dir') args.cacheDir = argv[++i];
    else if (a === '--json') args.json = true;
    else if (!a.startsWith('--') && !VALUE_OPTS.has(argv[i - 1]) && !args.root) args.root = a;
  }
  return args;
}

// R2#3/R2#4: 우선순위 CLI > env > root. --root/--data-dir/--cache-dir 값을 명시 파싱(ingest와 동일 패턴).
// B5: 다운로드 미허용(캐시 온리) — RAG_ALLOW_DOWNLOAD 주입 안 함.
async function main() {
  const args = parseArgs(process.argv.slice(2));
  const root = resolveRoot({ cliArg: args.root });
  const dataDir = resolveDataDir({ cliDataDir: args.dataDir, root });
  const cacheDir = resolveCacheDir({ cliCacheDir: args.cacheDir, root });
  process.env.RAG_CACHE_DIR = cacheDir; // R3: query와 동일 패턴으로 캐시 경로 일관 주입
  const db = await openDb(dataDir);
  const s = await collectStats(db);
  await db.close();
  if (args.json) { console.log(JSON.stringify(s, null, 2)); }
  else {
    console.log('비앤빛 메모리 현황');
    console.log(`  청크 ${s.chunks} / 소스 ${s.sources}`);
    for (const t of s.byType) console.log(`  - ${t.source_type}: ${t.n}`);
    console.log(`  마지막 색인: ${s.last_ingest_at || '없음'}`);
    console.log(`  임베딩: ${s.embedding_fingerprint || '미설정'}`);
  }
  process.exitCode = 0;
}

main().catch((e) => {
  const argv = process.argv.slice(2);
  const json = argv.includes('--json');
  if (json) console.log(JSON.stringify({ ok: false, stage: 'error', message: String(e?.message || e) }));
  else console.error(e?.message || e);
  process.exitCode = 1;
});
