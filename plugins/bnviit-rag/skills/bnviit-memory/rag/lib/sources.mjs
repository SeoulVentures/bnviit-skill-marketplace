import fs from 'node:fs';
import path from 'node:path';
import { SOURCE_DIRS, IGNORE_DIRS, INCLUDE_EXT, MAX_FILE_BYTES } from '../config.mjs';

const TYPE_MAP = { knowledge: 'knowledge', agents: 'agent', skills: 'skill', sops: 'sop' };

function walk(dir, rootReal, acc) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    const abs = path.join(dir, e.name);
    if (e.isSymbolicLink()) {
      let real;
      try { real = fs.realpathSync(abs); } catch { continue; } // Codex#3: 깨진 symlink는 해당 항목만 제외
      if (!real.startsWith(rootReal + path.sep)) continue; // 루트 밖 symlink 제외
    }
    if (e.isDirectory()) {
      if (IGNORE_DIRS.has(e.name)) continue;
      walk(abs, rootReal, acc);
    } else if (e.isFile()) {
      if (!INCLUDE_EXT.has(path.extname(e.name))) continue;
      let st; try { st = fs.statSync(abs); } catch { continue; }
      if (st.size > MAX_FILE_BYTES) continue;
      acc.push(abs);
    }
  }
}

export function collectSources(root) {
  const rootReal = fs.realpathSync(root);
  const out = [];
  for (const dir of SOURCE_DIRS) {
    const base = path.join(rootReal, dir);
    if (!fs.existsSync(base)) continue;
    const files = [];
    walk(base, rootReal, files);
    for (const abs of files) {
      // source는 항상 POSIX 슬래시로 정규화(Windows `\` → `/`) — DB 키·테스트 일관성
      const source = path.relative(rootReal, abs).split(path.sep).join('/');
      out.push({ absPath: abs, source, sourceType: TYPE_MAP[dir] });
    }
  }
  return out;
}
