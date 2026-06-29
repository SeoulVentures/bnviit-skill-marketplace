// RAG 질의 — 코사인 top-k 검색.
// 사용: node query.mjs "질문" [--k 5] [--type repo|cowork-memory] [--json]
import { DATA_DIR } from './config.mjs';
import { openDb, search } from './lib/db.mjs';
import { embedOne } from './lib/embed.mjs';

function parseArgs(argv) {
  const args = { k: 5, type: null, json: false, query: '' };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--k') args.k = Number(argv[++i]);
    else if (a === '--type') args.type = argv[++i];
    else if (a === '--json') args.json = true;
    else rest.push(a);
  }
  args.query = rest.join(' ').trim();
  return args;
}

function snippet(s, n = 280) {
  const one = s.replace(/\s+/g, ' ').trim();
  return one.length > n ? one.slice(0, n) + '…' : one;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.query) {
    console.error('사용법: node query.mjs "질문" [--k 5] [--type repo|cowork-memory] [--json]');
    process.exit(1);
  }

  const db = await openDb(DATA_DIR);
  const qvec = await embedOne(args.query, 'query');
  const rows = await search(db, qvec, { k: args.k, sourceType: args.type });
  await db.close();

  if (args.json) {
    console.log(JSON.stringify(rows, null, 2));
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
