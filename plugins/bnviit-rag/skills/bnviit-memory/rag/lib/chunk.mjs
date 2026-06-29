// 마크다운 청킹 — YAML frontmatter 제거 후 헤딩 단위로 섹션화,
// 섹션이 너무 길면 문단 단위로 maxChars 한도에 맞춰 분할(약간의 overlap).
import crypto from 'node:crypto';

export function stripFrontmatter(text) {
  if (text.startsWith('---')) {
    const end = text.indexOf('\n---', 3);
    if (end !== -1) {
      const fmEnd = text.indexOf('\n', end + 1);
      return text.slice(fmEnd === -1 ? text.length : fmEnd + 1);
    }
  }
  return text;
}

function headingLevel(line) {
  const m = /^(#{1,6})\s+(.*)$/.exec(line);
  return m ? { level: m[1].length, text: m[2].trim() } : null;
}

// 섹션을 maxChars 한도로 분할(문단 경계 우선, overlap은 문자 단위).
function splitLong(body, maxChars, overlap) {
  if (body.length <= maxChars) return [body];
  const paras = body.split(/\n{2,}/);
  const chunks = [];
  let cur = '';
  for (const p of paras) {
    if (cur && (cur.length + p.length + 2) > maxChars) {
      chunks.push(cur.trim());
      const tail = cur.slice(Math.max(0, cur.length - overlap));
      cur = tail + '\n\n' + p;
    } else {
      cur = cur ? cur + '\n\n' + p : p;
    }
    // 단일 문단이 maxChars를 넘으면 하드 분할
    while (cur.length > maxChars) {
      chunks.push(cur.slice(0, maxChars).trim());
      cur = cur.slice(maxChars - overlap);
    }
  }
  if (cur.trim()) chunks.push(cur.trim());
  return chunks;
}

// 반환: [{ heading, content }]
export function chunkMarkdown(text, { maxChars = 1200, overlap = 150 } = {}) {
  const body = stripFrontmatter(text);
  const lines = body.split('\n');
  const sections = [];
  let curHeading = null;
  let buf = [];

  const flush = () => {
    const content = buf.join('\n').trim();
    if (content) sections.push({ heading: curHeading, content });
    buf = [];
  };

  for (const line of lines) {
    const h = headingLevel(line);
    if (h) {
      flush();
      curHeading = h.text;
      buf.push(line);
    } else {
      buf.push(line);
    }
  }
  flush();

  const out = [];
  for (const sec of sections) {
    for (const piece of splitLong(sec.content, maxChars, overlap)) {
      const clean = piece.trim();
      if (clean.length < 8) continue; // 의미 없는 짧은 조각 제외
      out.push({ heading: sec.heading, content: clean });
    }
  }
  return out;
}

export function sha1(s) {
  return crypto.createHash('sha1').update(s).digest('hex');
}

export function chunkId(source, index) {
  return sha1(source + '#' + index).slice(0, 16);
}
