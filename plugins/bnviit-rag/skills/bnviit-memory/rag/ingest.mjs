import fs from 'node:fs';
import path from 'node:path';
import { resolveRoot, resolveDataDir, resolveCacheDir, SOURCE_DIRS, CHUNK_MAX_CHARS, CHUNK_OVERLAP } from './config.mjs';
import { openDb, upsertChunk, existingHashes, deleteMissing, setMeta } from './lib/db.mjs';
import { embed } from './lib/embed.mjs';
import { chunkMarkdown, sha1, chunkId } from './lib/chunk.mjs';
import { collectSources } from './lib/sources.mjs';
import { acquireLock } from './lib/lock.mjs';
import { checkSecrecy } from './lib/guard.mjs';

const BATCH = 16;
const argv = process.argv.slice(2);
const noGuard = argv.includes('--no-guard');
const asJson = argv.includes('--json');
const optVal = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
const VALUE_OPTS = new Set(['--data-dir', '--cache-dir', '--root']);
const dataDirArg = optVal('--data-dir');
const cacheDirArg = optVal('--cache-dir');
// 위치 인자(=root): 옵션도 아니고 value-opt의 값도 아닌 첫 토큰. --root도 허용.
const cliRoot = optVal('--root') ?? argv.find((a, i) => !a.startsWith('--') && !VALUE_OPTS.has(argv[i - 1]));
const root = resolveRoot({ cliArg: cliRoot });
const dataDir = resolveDataDir({ cliDataDir: dataDirArg, root });   // B1: CLI > env > root
const cacheDir = resolveCacheDir({ cliCacheDir: cacheDirArg, root });

// R2#2: 게이트가 검사한 캐시 경로 == embed가 실제로 쓰는 경로가 되도록 RAG_CACHE_DIR 주입.
process.env.RAG_CACHE_DIR = cacheDir;
// B5: 최초 색인 — 다운로드 미허용 시 주입(query/status는 캐시 온리 유지).
if (process.env.RAG_ALLOW_DOWNLOAD == null) process.env.RAG_ALLOW_DOWNLOAD = '1';

// R4#1 규칙: lock을 잡은 뒤에는 process.exit() 금지(즉시 종료 시 finally의 release()가 안 돌아 .ingest.lock 잔류).
//   대신 exitCode만 설정하고 main()을 정상 반환시켜 try/finally가 lock을 반드시 해제하게 한다.
//   exitImmediate=true는 lock 취득 *전*(기밀 게이트 차단)에서만 사용.
function emit(obj, code, exitImmediate = false) { // Codex#9: 안정 JSON + exit code
  if (asJson) console.log(JSON.stringify(obj));
  if (exitImmediate) process.exit(code); // lock 취득 전 경로(게이트 차단)만
  else process.exitCode = code;          // lock 취득 후: 반환으로 finally(release) 보장
}

async function main() {
  // 기밀 게이트(색인 전, fail-closed) — B2: 실제 데이터/캐시 경로 검사
  if (!noGuard) {
    // (1) 소스 디렉터리 상대 target
    const targets = SOURCE_DIRS.filter((t) => fs.existsSync(path.join(root, t)));
    // (2) dataDir/cacheDir이 root 하위면 상대로 환산해 target에 추가, 밖이면 guard가 절대경로로 직접 검사
    for (const abs of [dataDir, cacheDir]) {
      const rel = path.relative(root, abs);
      if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) targets.push(rel);
    }
    const g = checkSecrecy(root, targets, { dataDir, cacheDir });
    if (g.warnings.length && !asJson) {
      console.error('⚠️ 기밀 게이트 경고(검증 불가 — 계속 진행):');
      for (const w of g.warnings) console.error(`  - ${w.path}: ${w.reason}`);
    }
    if (!g.ok) {
      if (!asJson) {
        console.error('✋ 기밀 게이트 차단 — 색인 중단:');
        for (const v of g.violations) console.error(`  - ${v.path}: ${v.reason}`);
        console.error('해소: .gitignore에 추가 + (이미 추적 시) git rm --cached, 또는 저장 위치 변경 후 재시도.');
      }
      return emit({ ok: false, stage: 'guard', violations: g.violations, warnings: g.warnings }, 2, true); // lock 전 → 즉시 종료 OK
    }
  }

  // PGlite는 미초기화 dataDir에 .ingest.lock 등 외부 파일이 있으면 exit(1)로 crash한다.
  // lock 취득 전에 PGlite가 dataDir을 먼저 초기화하게 해서 이 문제를 방지한다.
  { const _db = await openDb(dataDir); await _db.close(); }

  const release = await acquireLock(dataDir);
  try {
    const db = await openDb(dataDir);
    const known = await existingHashes(db);
    const sources = collectSources(root);
    if (!asJson) console.log(`색인 대상 파일: ${sources.length}개 (루트: ${root})`);
    let added = 0, updated = 0, skipped = 0, removed = 0;
    const seenSources = new Set();
    for (const src of sources) {
      seenSources.add(src.source);
      let text; try { text = fs.readFileSync(src.absPath, 'utf8'); } catch { continue; }
      const pieces = chunkMarkdown(text, { maxChars: CHUNK_MAX_CHARS, overlap: CHUNK_OVERLAP });
      const keep = new Set(); const pending = [];
      pieces.forEach((p, i) => {
        const id = chunkId(src.source, i); const hash = sha1(p.content); keep.add(id);
        if (known.get(id) === hash) skipped++; else pending.push({ id, i, heading: p.heading, content: p.content, hash, isNew: !known.has(id) });
      });
      for (let b = 0; b < pending.length; b += BATCH) {
        const batch = pending.slice(b, b + BATCH);
        const vecs = await embed(batch.map((x) => x.content), 'passage');
        for (let j = 0; j < batch.length; j++) {
          const x = batch[j];
          await upsertChunk(db, { id: x.id, source: src.source, source_type: src.sourceType, heading: x.heading, chunk_index: x.i, content: x.content, char_len: x.content.length, content_hash: x.hash, embedding: vecs[j] });
          if (x.isNew) added++; else updated++;
        }
      }
      removed += await deleteMissing(db, src.source, keep); // 파일 단위(청크 일부 삭제) 커밋
    }
    // Codex#8: 완전히 삭제된 파일의 orphan 청크 제거 — DB의 distinct source − 이번 수집 source
    const dbSrc = await db.query('SELECT DISTINCT source FROM chunks');
    for (const r of dbSrc.rows) {
      if (!seenSources.has(r.source)) removed += await deleteMissing(db, r.source, new Set());
    }
    await setMeta(db);
    if (!asJson) console.log(`완료 — 신규 ${added} · 갱신 ${updated} · 스킵 ${skipped} · 삭제 ${removed}`);
    await db.close();
    emit({ ok: true, stage: 'done', root, dataDir, added, updated, skipped, removed, files: sources.length }, 0); // exitCode=0, 반환
    return;
  } finally { release(); } // R4#1: 성공/예외 어느 경로든 lock 해제 보장
}
main().catch((e) => {
  if (asJson) console.log(JSON.stringify({ ok: false, stage: 'error', message: String(e && e.message || e) }));
  else console.error(e);
  process.exitCode = 1; // R4#1: exit() 대신 코드만 설정(lock은 try/finally에서 이미 해제됨)
});
