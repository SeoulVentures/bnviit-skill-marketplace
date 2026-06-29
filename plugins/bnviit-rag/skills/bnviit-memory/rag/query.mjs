// RAG 질의 — 코사인 top-k 검색.
// 사용: node query.mjs "질문" [--root <p>] [--data-dir <p>] [--cache-dir <p>] [--k 5] [--type <source_type>] [--json]
// 질의는 argv 위치인자 또는 RAG_QUERY 환경변수로 전달한다(argv 우선). 환경변수 경로는
// 셸 메타문자가 명령 문자열에 보간되지 않도록 하는 안전 전달용이다(bnviit-ask.md 참조).
import { resolveRoot, resolveDataDir, resolveCacheDir } from './config.mjs';
import { openDb, search } from './lib/db.mjs';
import { embedOne } from './lib/embed.mjs';

function parseArgs(argv) {
  const args = { k: 5, type: null, json: false, root: undefined, dataDir: undefined, cacheDir: undefined, query: '' };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--k') args.k = Number(argv[++i]);
    else if (a === '--type') args.type = argv[++i];
    else if (a === '--root') args.root = argv[++i];
    else if (a === '--data-dir') args.dataDir = argv[++i];
    else if (a === '--cache-dir') args.cacheDir = argv[++i];
    else if (a === '--json') args.json = true;
    else rest.push(a);
  }
  // 질의 우선순위: argv 위치인자 → RAG_QUERY 환경변수(셸-안전 경로).
  // argv 우선이라 기존 query.smoke 테스트(위치인자 전달)는 영향 없음.
  // 환경변수 경로는 bnviit-ask.md 등 셸 메타문자 안전 전달을 위한 것.
  const argvQuery = rest.join(' ').trim();
  args.query = argvQuery || (process.env.RAG_QUERY ?? '').trim();
  return args;
}

function snippet(s, n = 280) {
  const one = s.replace(/\s+/g, ' ').trim();
  return one.length > n ? one.slice(0, n) + '…' : one;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.query) {
    console.error('사용법: node query.mjs "질문" [--root <p>] [--data-dir <p>] [--cache-dir <p>] [--k 5] [--type <source_type>] [--json]');
    process.exit(1);
  }

  // R3: openDb 전에 경로 계산·주입 — embed가 번들 .cache로 폴백하지 않도록(캐시 온리 질의 성공 보장).
  const root = resolveRoot({ cliArg: args.root });
  const dataDir = resolveDataDir({ cliDataDir: args.dataDir, root });
  const cacheDir = resolveCacheDir({ cliCacheDir: args.cacheDir, root });
  process.env.RAG_CACHE_DIR = cacheDir;

  const db = await openDb(dataDir);
  const qvec = await embedOne(args.query, 'query');
  const rows = await search(db, qvec, { k: args.k, sourceType: args.type });
  await db.close();

  if (args.json) {
    // R2#5: 명시 6키만 직렬화 — embedding 등 누수 방지.
    const out = rows.map((r) => ({
      source: r.source,
      source_type: r.source_type,
      heading: r.heading,
      chunk_index: r.chunk_index,
      similarity: r.similarity,
      content: r.content,
    }));
    console.log(JSON.stringify(out, null, 2));
    return;
  }

  if (rows.length === 0) {
    console.log('결과 없음 — 먼저 `npm run ingest`로 색인했는지 확인하세요.');
    return;
  }

  console.log(`질문: ${args.query}\n`);
  rows.forEach((r, i) => {
    const sim = (r.similarity * 100).toFixed(1);
    const head = r.heading ? ` › ${r.heading}` : '';
    console.log(`#${i + 1}  [${sim}%]  ${r.source}${head}`);
    console.log(`    ${snippet(r.content)}\n`);
  });
}

main().catch((e) => { console.error(e); process.exit(1); });
