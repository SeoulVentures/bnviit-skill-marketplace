import fs from 'node:fs'; import path from 'node:path';
function alive(pid) { try { process.kill(pid, 0); return true; } catch { return false; } }
export async function acquireLock(dataDir) {
  fs.mkdirSync(dataDir, { recursive: true });
  const lf = path.join(dataDir, '.ingest.lock');
  for (let attempt = 0; attempt < 2; attempt++) {
    let fd;
    try {
      fd = fs.openSync(lf, 'wx'); // 원자적 배타 생성 — 동시 두 프로세스 중 하나만 성공
      fs.writeSync(fd, String(process.pid));
      fs.closeSync(fd);
      return () => { try { fs.rmSync(lf, { force: true }); } catch {} };
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      // 이미 존재 → 기존 PID 판정
      let pid = NaN;
      try { pid = Number(fs.readFileSync(lf, 'utf8').trim()); } catch {}
      if (pid && alive(pid)) throw new Error(`ingest 진행 중(pid ${pid}). 끝난 뒤 재시도하세요.`);
      // stale(프로세스 부재) → 정리 후 재시도(1회)
      try { fs.rmSync(lf, { force: true }); } catch {}
    }
  }
  throw new Error('lock 획득 실패(stale 정리 후에도 경합).');
}
