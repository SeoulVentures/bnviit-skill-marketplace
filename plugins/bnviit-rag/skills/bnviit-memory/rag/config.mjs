import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const EMBED_MODEL = process.env.RAG_EMBED_MODEL || 'Xenova/multilingual-e5-small';
// revision(commit hash) 고정 — 재현성. Xenova/multilingual-e5-small@main 2025-07-22 기준.
export const EMBED_REVISION = process.env.RAG_EMBED_REVISION || '761b726dd34fb83930e26aab4e9ac3899aa1fa78';
export const EMBED_DIM = Number(process.env.RAG_EMBED_DIM || 384);
export const CHUNK_MAX_CHARS = Number(process.env.RAG_CHUNK_MAX_CHARS || 1200);
export const CHUNK_OVERLAP = Number(process.env.RAG_CHUNK_OVERLAP || 150);
export const MAX_FILE_BYTES = Number(process.env.RAG_MAX_FILE_BYTES || 1_000_000);
export const SOURCE_DIRS = ['knowledge', 'agents', 'skills', 'sops'];
export const IGNORE_DIRS = new Set(['node_modules', '.git', '.pgdata', '.cache', '.models', 'dist', 'build']);
export const INCLUDE_EXT = new Set(['.md']);

// Codex#2: 번들 플러그인의 skills/를 사용자 루트로 오인하지 않도록, 탐지 marker는
// 'knowledge'(없으면 'sops') 존재로만 한다. skills/agents는 플러그인 번들에도 흔해 marker에서 제외.
const ROOT_MARKERS = ['knowledge', 'sops'];
function detectRoot() {
  let dir = process.cwd();
  for (let i = 0; i < 6; i++) {
    if (ROOT_MARKERS.some((d) => fs.existsSync(path.join(dir, d)))) return dir;
    const up = path.dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return process.cwd();
}
export function resolveRoot({ cliArg } = {}) {
  if (cliArg) return path.resolve(cliArg);
  if (process.env.BNVIIT_RAG_ROOT) return path.resolve(process.env.BNVIIT_RAG_ROOT);
  return detectRoot();
}

// B1: DATA_DIR/CACHE_DIR을 root 파생 함수로. R2#3: 전역 계약과 동일하게 CLI 인자 > env > root > 번들 기본.
// env 미설정으로 CLI root만 줘도 데이터가 프로젝트 루트 .pgdata에 생기고, 마켓플레이스 번들(git 리포)로 새지 않는다.
export function resolveDataDir({ cliDataDir, root } = {}) {
  if (cliDataDir) return path.resolve(cliDataDir);                        // CLI 최우선
  if (process.env.RAG_DATA_DIR) return path.resolve(process.env.RAG_DATA_DIR);
  if (root) return path.join(root, '.pgdata');
  return path.join(__dirname, '.pgdata');
}
export function resolveCacheDir({ cliCacheDir, root } = {}) {
  if (cliCacheDir) return path.resolve(cliCacheDir);                      // CLI 최우선(대칭)
  if (process.env.RAG_CACHE_DIR) return path.resolve(process.env.RAG_CACHE_DIR);
  if (root) return path.join(root, '.cache');
  return fileURLToPath(new URL('./.cache/', import.meta.url));
}

export const REPO_ROOT = resolveRoot({});
// 하위호환 한 줄(직접 import 금지 권장 — 호출부는 resolveDataDir({root})를 쓴다).
export const DATA_DIR = resolveDataDir({});
