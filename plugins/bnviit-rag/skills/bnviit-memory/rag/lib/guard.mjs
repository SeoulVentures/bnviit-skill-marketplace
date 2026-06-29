import fs from 'node:fs'; import path from 'node:path';
import { execFileSync } from 'node:child_process';
const CLOUD = ['Library/Mobile Documents', 'Dropbox', 'Google Drive', 'OneDrive'];

// 미존재 경로도 symlink를 따라 정규화(macOS /var→/private/var 등).
// 존재하는 가장 가까운 조상을 realpath하고 남은 부분을 재합산.
function canonicalize(p) {
  let cur = path.resolve(p);
  const suffix = [];
  for (let i = 0; i < 64; i++) {
    try {
      const r = fs.realpathSync(cur);
      return suffix.length ? path.join(r, ...suffix) : r;
    } catch {
      suffix.unshift(path.basename(cur));
      const up = path.dirname(cur);
      if (up === cur) return p;
      cur = up;
    }
  }
  return p;
}
function inCloud(realAbs) {
  return CLOUD.some((c) => realAbs.includes(path.sep + c.replace('/', path.sep)));
}
function inGit(dir) {
  // 디렉터리가 존재하지 않으면 부모로 대체
  let d = dir;
  while (d && !fs.existsSync(d)) d = path.dirname(d);
  try { execFileSync('git', ['rev-parse', '--is-inside-work-tree'], { cwd: d || dir, stdio: 'ignore' }); return true; } catch { return false; }
}
function isTracked(cwd, rel) {
  try { return execFileSync('git', ['ls-files', '--', rel], { cwd, encoding: 'utf8' }).trim().length > 0; }
  catch { return false; }
}
// R2#1: 게이트가 검사하는 target은 모두 디렉터리(.pgdata/.cache/소스 디렉터리)다.
// 미존재 디렉터리는 슬래시 없이 질의하면 `.pgdata/` 같은 디렉터리 패턴에 매칭되지 않아 not-ignored로 오판된다.
// 끝에 '/'를 붙여(그리고 안전하게 슬래시 없는 형도) 질의해 디렉터리 ignore를 정확히 판정한다.
function isIgnored(cwd, rel) {
  const r = rel.replace(/\/+$/, '');
  for (const cand of [r + '/', r]) {
    try { execFileSync('git', ['check-ignore', '-q', '--', cand], { cwd }); return true; } catch {}
  }
  return false;
}

// root 밖 절대경로(dataDir/cacheDir)를 그 경로가 속한 git 리포 기준으로 검사
function checkAbsolutePath(absPath, violations, warnings) {
  const realAbs = canonicalize(absPath);
  if (inCloud(realAbs)) violations.push({ path: absPath, reason: 'cloud-sync' });
  // 해당 경로가 속한 git work-tree 기준(없으면 부모) tracked/ignore 검사
  const baseDir = fs.existsSync(absPath) ? absPath : path.dirname(absPath);
  if (inGit(baseDir)) {
    try {
      const topRaw = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: baseDir, encoding: 'utf8' }).trim();
      // topRaw은 realpath 기반 — absPath도 canonicalize로 정규화해야 올바른 rel 계산
      const rel = path.relative(topRaw, realAbs) || '.';
      if (isTracked(topRaw, rel)) violations.push({ path: absPath, reason: 'git-tracked' });
      else if (!isIgnored(topRaw, rel)) violations.push({ path: absPath, reason: 'not-ignored' });
    } catch { warnings.push({ path: absPath, reason: 'git-unverifiable' }); }
  } else {
    warnings.push({ path: absPath, reason: 'git-unverifiable' }); // 비-git: 검증 불가 표면화(경고)
  }
}

export function checkSecrecy(root, targets, { dataDir, cacheDir } = {}) {
  const violations = []; const warnings = [];
  const realRoot = canonicalize(root);
  if (inCloud(realRoot)) violations.push({ path: realRoot, reason: 'cloud-sync' });

  const git = inGit(root);
  for (const t of targets) {
    if (!git) { warnings.push({ path: t, reason: 'git-unverifiable' }); continue; } // Codex#6: 통과 대신 경고
    if (isTracked(root, t)) violations.push({ path: t, reason: 'git-tracked' });
    else if (!isIgnored(root, t)) violations.push({ path: t, reason: 'not-ignored' });
  }

  // B2/Codex#7: dataDir/cacheDir가 root 밖이면 그 절대경로를 직접 검사(in-root면 호출부가 상대 target으로 이미 추가).
  for (const abs of [dataDir, cacheDir].filter(Boolean)) {
    const rel = path.relative(realRoot, canonicalize(abs));
    const inRoot = rel && !rel.startsWith('..') && !path.isAbsolute(rel);
    if (!inRoot) checkAbsolutePath(path.resolve(abs), violations, warnings);
  }

  return { ok: violations.length === 0, violations, warnings };
}
