// RAG 질의 — 코사인 top-k 검색.
// 사용: node query.mjs "질문" [--query-file <path>] [--root <p>] [--data-dir <p>] [--cache-dir <p>] [--k 5] [--type <source_type>] [--json]
// 질의 전달(우선순위): argv 위치인자 > --query-file <path>(파일에서 읽음) > RAG_QUERY 환경변수.
// --query-file·RAG_QUERY 경로는 질의가 셸 명령 문자열에 보간되지 않으므로 명령 주입이 불가능하다
//   (argv-safe 실제 브리지). bnviit-ask.md는 $ARGUMENTS를 임시 파일로 저장 후 --query-file로 넘긴다.
import { readFileSync } from 'node:fs';
import { resolveRoot, resolveDataDir, resolveCacheDir } from './config.mjs';
import { openDb, search } from './lib/db.mjs';
import { embedOne } from './lib/embed.mjs';

function parseArgs(argv) {
  const args = { k: 5, type: null, json: false, root: undefined, dataDir: undefined, cacheDir: undefined, query: '', queryFile: undefined };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--k') args.k = Number(argv[++i]);
    else if (a === '--type') args.type = argv[++i];
    else if (a === '--root') args.root = argv[++i];
    else if (a === '--data-dir') args.dataDir = argv[++i];
    else if (a === '--cache-dir') args.cacheDir = argv[++i];
    else if (a === '--query-file') args.queryFile = argv[++i];
    else if (a === '--json') args.json = true;
    else rest.push(a);
  }
  // 질의 우선순위: argv 위치인자 → --query-file(파일 내용) → RAG_QUERY 환경변수.
  // argv 우선이라 기존 query.smoke 테스트(위치인자 전달)는 영향 없음.
  // --query-file·RAG_QUERY는 셸 미경유 안전 전달용(명령 주입 불가).
  const argvQuery = rest.join(' ').trim();
  let fileQuery = '';
  if (args.queryFile) {
    try {
      fileQuery = readFileSync(args.queryFile, 'utf8').trim();
    } catch (e) {
      console.error(`--query-file 읽기 실패: ${args.queryFile} (${e.code ?? e.message})`);
      process.exit(1);
    }
  }
  args.query = argvQuery || fileQuery || (process.env.RAG_QUERY ?? '').trim();
  return args;
}

function snippet(s, n = 280) {
  const one = s.replace(/\s+/g, ' ').trim();
  return one.length > n ? one.slice(0, n) + '…' : one;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.query) {
    console.error('사용법: node query.mjs "질문" [--query-file <path>] [--root <p>] [--data-dir <p>] [--cache-dir <p>] [--k 5] [--type <source_type>] [--json]');
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
