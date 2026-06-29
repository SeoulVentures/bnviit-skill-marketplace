# 비앤빛 RAG 셋업 스킬 구현 계획 (Implementation Plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** "비앤빛안과를 위한 스킬을 설치하라" 한 마디로 작업자 로컬에 PGlite+pgvector RAG를 셋업·색인·검증까지 완주하는 공개 플러그인 `bnviit-rag`(스킬 `bnviit-memory` + 번들 RAG 도구)를 만든다.

**Architecture:** `seoulventures-office/tools/rag`(검증된 ~550줄, 로컬 e5 임베딩)를 복제하고 비앤빛용으로 적응한다 — 디렉터리 기반 `source_type` 태깅, 임베딩 fingerprint·`meta` 테이블, 파일 단위 멱등 색인, writer lock, `status` 도구, 색인 전 fail-closed 기밀 게이트. 데이터·인덱스는 로컬에만 생성(외부 송출 0). 슬래시 커맨드가 표준 실행 경로이고 자연어 트리거는 위임한다.

**Tech Stack:** Node.js(ESM `.mjs`), `@electric-sql/pglite` + `pgvector` contrib, `@huggingface/transformers`(`Xenova/multilingual-e5-small`, 384d), 테스트는 `node:test`(내장) + `node:assert`.

**참조 원본(읽기 전용):** `/private/tmp/claude-501/-Users-caspar-Projects-SeoulVentures-bnviit-skills/f58facce-3c1b-4a9e-9406-64d3ed76239b/scratchpad/seoulventures-office/tools/rag/` (또는 `~/Projects/SeoulVentures/SvOffice`). "복제"는 이 경로의 파일을 그대로 가져옴을 뜻한다.

**스펙:** `docs/superpowers/specs/2026-06-29-bnviit-rag-setup-design.md` (v2)

## Global Constraints

- **Node 22 또는 24 LTS** (20은 EOL이라 제외). 테스트·런타임 점검은 `>=22`.
- 의존성은 **`package-lock.json` 커밋 + `npm ci`**. 모델 **ID `Xenova/multilingual-e5-small` + revision(commit hash) 고정**.
- 임베딩 계약: e5 프리픽스(`passage: `/`query: `), mean pooling, **L2 정규화**, 384차원, 코사인(`1 - (embedding <=> q)`).
- **데이터·인덱스는 로컬에만** 생성(`.pgdata`/`.cache`). 외부 송출 0. `transformers env.allowRemoteModels`는 최초 셋업에서만 true, 이후 false.
- **기밀 게이트는 색인 *전* fail-closed**: 색인 대상 + `.pgdata`/`.cache`/로그가 `git ls-files` 추적 중이거나 `.gitignore` 미매칭이거나 클라우드 동기화 폴더 하위이면 **색인 차단**.
- **HITL은 둘**: Node 설치 승인, 색인 대상 승인. 메모리는 실행 허가 아님(의료 발신·비가역 행위는 별도 승인, 근거 부족 시 abstain).
- 경로 우선순위: **CLI 인자 > 환경변수(`BNVIIT_RAG_ROOT`/`RAG_DATA_DIR`) > 탐지 기본값**.
- 라이선스 **MIT**. 모든 명령은 종료 코드(0/비0)와 `--json` 출력을 제공.
- 산출물 경로 루트: `plugins/bnviit-rag/`. RAG 도구: `plugins/bnviit-rag/skills/bnviit-memory/rag/`.

---

## File Structure

| 파일 | 책임 |
|---|---|
| `plugins/bnviit-rag/.claude-plugin/plugin.json` | 플러그인 메타데이터 |
| `plugins/bnviit-rag/LICENSE` | MIT |
| `plugins/bnviit-rag/skills/bnviit-memory/SKILL.md` | 셋업·색인·질의 절차 + 결과 해석 규율(abstain) |
| `.../rag/config.mjs` | 경로·모델·청킹 설정, 우선순위 |
| `.../rag/lib/chunk.mjs` | 마크다운 청킹(복제, 무변경) |
| `.../rag/lib/sources.mjs` | 색인 대상 수집 + `source_type` 태깅 + 경계 |
| `.../rag/lib/embed.mjs` | 로컬 e5 임베딩 + `embeddingFingerprint()` |
| `.../rag/lib/db.mjs` | `chunks`/`meta` 스키마, upsert/search/orphan/fingerprint |
| `.../rag/lib/stats.mjs` | 현황 집계(공용 API) |
| `.../rag/lib/guard.mjs` | 기밀 게이트(git/gitignore/클라우드 검사) |
| `.../rag/lib/lock.mjs` | 단일 writer 파일 lock |
| `.../rag/ingest.mjs` | 색인 CLI(멱등·resume·lock·exit code) |
| `.../rag/query.mjs` | 질의 CLI(top-k·--type·--json·exit code) |
| `.../rag/status.mjs` | 현황 CLI(--json) |
| `.../rag/package.json` · `package-lock.json` · `.gitignore` | 의존성·무시 |
| `plugins/bnviit-rag/commands/{bnviit-setup,bnviit-ingest,bnviit-ask,bnviit-status}.md` | 슬래시 커맨드 |
| `.claude-plugin/marketplace.json` | `bnviit-rag` 등록(수정) |
| `README.md` | 2단계 설치 안내(수정) |

테스트: 각 `lib/*.mjs` 옆에 `*.test.mjs`(node:test). 통합 스모크는 `rag/test/smoke.test.mjs`.

---

## Task 1: 플러그인 스캐폴드 + 마켓플레이스 등록

**Files:**
- Create: `plugins/bnviit-rag/.claude-plugin/plugin.json`, `plugins/bnviit-rag/LICENSE`, `plugins/bnviit-rag/skills/bnviit-memory/rag/.gitignore`
- Modify: `.claude-plugin/marketplace.json`
- Test: `plugins/bnviit-rag/test/scaffold.test.mjs`

**Interfaces:**
- Produces: 플러그인 `bnviit-rag`가 `marketplace.json`의 `plugins[]`에 `{name:"bnviit-rag", source:"./plugins/bnviit-rag", ...}`로 등록됨.

> **주의(미적응 도구 직접 실행 금지):** Task 2~6 동안에는 아직 적응되지 않은 `ingest.mjs`/`query.mjs`/`status.mjs`를 직접 `node`로 실행하지 말 것(원본 office 경로·DATA_DIR 가정이 달라 오작동). 각 lib는 단위 테스트로만 검증하고, CLI 스모크는 Task 7 이후에 한다.

- [ ] **Step 0: 작업 브랜치 생성 + plan/spec 추적 커밋** (현재 `main`에 직접 커밋 금지 — Codex#13)
```bash
git checkout -b feat/bnviit-rag
git add docs/superpowers
git commit -m "docs(bnviit-rag): RAG 셋업 설계 스펙 + 구현 계획 추적"
```
> 이후 모든 Task의 커밋은 이 브랜치 위에 쌓는다. `docs/`(plan·spec)는 여기서 한 번 추적 커밋해 둔다.

- [ ] **Step 1: 실패 테스트 작성** — `plugins/bnviit-rag/test/scaffold.test.mjs`

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..', '..', '..'); // repo root

test('plugin.json은 유효하고 이름이 bnviit-rag', () => {
  const p = JSON.parse(fs.readFileSync(path.join(ROOT, 'plugins/bnviit-rag/.claude-plugin/plugin.json'), 'utf8'));
  assert.equal(p.name, 'bnviit-rag');
  assert.ok(p.version);
});

test('marketplace.json에 bnviit-rag가 등록됨', () => {
  const m = JSON.parse(fs.readFileSync(path.join(ROOT, '.claude-plugin/marketplace.json'), 'utf8'));
  const names = m.plugins.map((x) => x.name);
  assert.ok(names.includes('bnviit-rag'), 'plugins[]에 bnviit-rag 없음');
  const entry = m.plugins.find((x) => x.name === 'bnviit-rag');
  assert.equal(entry.source, './plugins/bnviit-rag');
});

test('LICENSE는 MIT', () => {
  const l = fs.readFileSync(path.join(ROOT, 'plugins/bnviit-rag/LICENSE'), 'utf8');
  assert.match(l, /MIT License/);
});

test('rag/.gitignore가 .pgdata와 .cache를 무시', () => {
  const g = fs.readFileSync(path.join(ROOT, 'plugins/bnviit-rag/skills/bnviit-memory/rag/.gitignore'), 'utf8');
  assert.match(g, /\.pgdata\//);
  assert.match(g, /\.cache\//);
});
```

- [ ] **Step 2: 실패 확인** — Run: `node --test plugins/bnviit-rag/test/scaffold.test.mjs` · Expected: FAIL (ENOENT).

- [ ] **Step 3: 파일 생성**

`plugins/bnviit-rag/.claude-plugin/plugin.json`:
```json
{
  "name": "bnviit-rag",
  "description": "비앤빛 안과 전용 로컬 RAG 셋업 스킬 — PGlite+pgvector, 로컬 e5 임베딩(외부 송출 0)",
  "version": "0.1.0",
  "author": { "name": "SeoulVentures", "email": "erik@seoulventures.net" },
  "homepage": "https://github.com/SeoulVentures/bnviit-skill-marketplace",
  "license": "MIT",
  "keywords": ["bnviit", "rag", "pglite", "pgvector", "memory"]
}
```

`plugins/bnviit-rag/LICENSE`: 표준 MIT 전문(저작권 `2026 SeoulVentures`).

`plugins/bnviit-rag/skills/bnviit-memory/rag/.gitignore`:
```
node_modules/
.pgdata/
.pgdata-*/
.cache/
.models/
*.log
_test-*.mjs
```

`.claude-plugin/marketplace.json`의 `plugins[]`에 추가:
```json
{
  "name": "bnviit-rag",
  "source": "./plugins/bnviit-rag",
  "description": "비앤빛 안과 전용 로컬 RAG 셋업 스킬 (PGlite+pgvector, 로컬 임베딩)"
}
```

- [ ] **Step 4: 통과 확인** — Run: `node --test plugins/bnviit-rag/test/scaffold.test.mjs` · Expected: PASS (4 tests).

- [ ] **Step 5: 커밋**
```bash
git add plugins/bnviit-rag/.claude-plugin plugins/bnviit-rag/LICENSE plugins/bnviit-rag/skills/bnviit-memory/rag/.gitignore plugins/bnviit-rag/test/scaffold.test.mjs .claude-plugin/marketplace.json
git commit -m "feat(bnviit-rag): 플러그인 스캐폴드 + 마켓플레이스 등록"
```

---

## Task 2: RAG 도구 복제 + config 적응

**Files:**
- Create(복제): `.../rag/package.json`, `.../rag/lib/chunk.mjs`, `.../rag/query.mjs`(임시 그대로), `.../rag/ingest.mjs`(임시 그대로)
- Create(적응): `.../rag/config.mjs`
- Test: `.../rag/lib/config.test.mjs`

**Interfaces:**
- Produces: `config.mjs` exports — `REPO_ROOT`, `EMBED_MODEL`, `EMBED_REVISION`, `EMBED_DIM`(=384), `CHUNK_MAX_CHARS`(=1200), `CHUNK_OVERLAP`(=150), `IGNORE_DIRS`(Set), `INCLUDE_EXT`(Set `.md`), `MAX_FILE_BYTES`, `SOURCE_DIRS`(=`['knowledge','agents','skills','sops']`), `resolveRoot({cliArg})`, **`resolveDataDir({cliDataDir, root})`**, **`resolveCacheDir({cliCacheDir, root})`** (둘 다 우선순위 CLI > env > root > 기본). 하위호환용 `DATA_DIR = resolveDataDir({})` 한 줄도 export(직접 import 금지 권장 — 호출부는 root 파생 함수를 쓴다).
- **멱등 키 주의:** 멱등 ID는 *상대 source 경로* 기반(`chunkId(source, i)`)이다. 스펙 §8.3의 "canonical realpath(source)+content_hash" 문구와 표현이 다르나, 동일 root 내 상대경로가 안정적이므로 기능상 정상(같은 파일=같은 source→같은 id). 절대 realpath를 키에 쓰지 않는다(머신 간 이식·임시디렉터리 테스트 안정성).

- [ ] **Step 1: 원본 복제(무변경 파일) + 의존성 설치 + lockfile 생성** (Codex#1: Task 5의 PGlite import 테스트가 실행 가능하도록 lockfile을 여기서 앞당겨 생성)

참조 원본에서 그대로 복사: `lib/chunk.mjs`, `package.json`(이름만 `bnviit-rag`로), `query.mjs`, `ingest.mjs`. (`query.mjs`/`ingest.mjs`는 Task 7·8에서 적응한다.)
`package.json` 핵심:
```json
{
  "name": "bnviit-rag", "version": "0.1.0", "private": true, "type": "module",
  "scripts": { "ingest": "node ingest.mjs", "query": "node query.mjs", "status": "node status.mjs", "test": "node --test" },
  "dependencies": { "@electric-sql/pglite": "0.2.17", "@huggingface/transformers": "3.8.1" },
  "engines": { "node": ">=22" }
}
```
> 버전은 정확히 핀(`^` 제거).

이어서 lockfile 생성 + 무결성 1회 검증(npm ci):
```bash
cd plugins/bnviit-rag/skills/bnviit-memory/rag
npm install                          # package-lock.json 생성
rm -rf node_modules && npm ci        # lock 무결성 검증(이후 Task 7은 npm ci만)
```
Expected: `package-lock.json` 생성(커밋), `node_modules/`(gitignore됨). 이후 Task 5의 `db.test.mjs`가 PGlite를 import할 수 있다.

- [ ] **Step 2: 실패 테스트 작성** — `.../rag/lib/config.test.mjs`

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import * as cfg from '../config.mjs'; // config.test.mjs는 lib/ 하위, config.mjs는 rag/ 직속 → 상위 경로

test('기본 상수', () => {
  assert.equal(cfg.EMBED_DIM, 384);
  assert.equal(cfg.CHUNK_MAX_CHARS, 1200);
  assert.equal(cfg.CHUNK_OVERLAP, 150);
  assert.deepEqual([...cfg.INCLUDE_EXT], ['.md']);
  assert.deepEqual(cfg.SOURCE_DIRS, ['knowledge', 'agents', 'skills', 'sops']);
});

test('resolveRoot 우선순위: CLI > env > 탐지', () => {
  assert.equal(cfg.resolveRoot({ cliArg: '/a' }), '/a');
  process.env.BNVIIT_RAG_ROOT = '/b';
  assert.equal(cfg.resolveRoot({}), '/b');
  delete process.env.BNVIIT_RAG_ROOT;
  assert.ok(typeof cfg.resolveRoot({}) === 'string');
});

test('resolveDataDir 우선순위: CLI > env > root > 기본 (R2#3)', () => {
  process.env.RAG_DATA_DIR = '/env-data';
  // CLI 인자가 env보다 우선
  assert.equal(cfg.resolveDataDir({ cliDataDir: '/cli', root: '/r' }), '/cli');
  // CLI 없으면 env
  assert.equal(cfg.resolveDataDir({ root: '/r' }), '/env-data');
  delete process.env.RAG_DATA_DIR;
  // env 없으면 root
  assert.equal(cfg.resolveDataDir({ root: '/r' }), path.join('/r', '.pgdata'));
  assert.ok(cfg.resolveDataDir({}).endsWith('.pgdata')); // root 미지정 → 번들 기준 기본
});

test('resolveCacheDir 우선순위: CLI > env > root > 번들 기본 (R2#3)', () => {
  process.env.RAG_CACHE_DIR = '/env-cache';
  assert.equal(cfg.resolveCacheDir({ cliCacheDir: '/cli-c', root: '/r' }), '/cli-c'); // CLI 우선
  assert.equal(cfg.resolveCacheDir({ root: '/r' }), '/env-cache');                    // CLI 없으면 env
  delete process.env.RAG_CACHE_DIR;
  assert.equal(cfg.resolveCacheDir({ root: '/r' }), path.join('/r', '.cache'));        // env 없으면 root
  assert.ok(cfg.resolveCacheDir({}).endsWith('.cache' + path.sep) || cfg.resolveCacheDir({}).endsWith('.cache'));
});
```

- [ ] **Step 3: 실패 확인** — Run: `node --test .../rag/lib/config.test.mjs` · Expected: FAIL.

- [ ] **Step 4: `config.mjs` 작성(적응)**

```js
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const EMBED_MODEL = process.env.RAG_EMBED_MODEL || 'Xenova/multilingual-e5-small';
// revision(commit hash) 고정 — 재현성. 실제 hash는 구현 시 huggingface 모델 페이지에서 확정.
export const EMBED_REVISION = process.env.RAG_EMBED_REVISION || 'main';
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
```

- [ ] **Step 5: 통과 확인 + 커밋** — Run: `node --test .../rag/lib/config.test.mjs` → PASS.
```bash
git add plugins/bnviit-rag/skills/bnviit-memory/rag
git commit -m "feat(bnviit-rag): RAG 도구 복제 + config 적응(경로 우선순위·SOURCE_DIRS)"
```

---

## Task 3: 소스 수집 + `source_type` 태깅 + 경계

**Files:**
- Create(적응): `.../rag/lib/sources.mjs`
- Test: `.../rag/lib/sources.test.mjs`

**Interfaces:**
- Consumes: `config.mjs`(`SOURCE_DIRS`,`IGNORE_DIRS`,`INCLUDE_EXT`,`MAX_FILE_BYTES`).
- Produces: `collectSources(root) → [{ absPath, source(상대경로), sourceType }]`. `sourceType`은 최상위 디렉터리명(`knowledge|agents|skills|sops`)에서 `agents→agent`, `skills→skill`, `sops→sop`, `knowledge→knowledge`로 매핑.

- [ ] **Step 1: 실패 테스트 작성** — `.../rag/lib/sources.test.mjs`

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { collectSources } from './sources.mjs';

function tmpRoot() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'rag-src-'));
  fs.mkdirSync(path.join(d, 'knowledge'));
  fs.writeFileSync(path.join(d, 'knowledge', 'a.md'), '# A\n본문');
  fs.writeFileSync(path.join(d, 'knowledge', 'note.txt'), '무시'); // 확장자 외
  fs.mkdirSync(path.join(d, 'sops'));
  fs.writeFileSync(path.join(d, 'sops', 's.md'), '# S');
  return d;
}

test('md만 수집하고 source_type을 디렉터리로 태깅', () => {
  const root = tmpRoot();
  const got = collectSources(root);
  const types = Object.fromEntries(got.map((x) => [x.source, x.sourceType]));
  assert.equal(types['knowledge/a.md'], 'knowledge');
  assert.equal(types['sops/s.md'], 'sop');
  assert.ok(!('knowledge/note.txt' in types), '.txt는 제외');
});

test('루트 밖 symlink는 제외', () => {
  const root = tmpRoot();
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'rag-out-'));
  fs.writeFileSync(path.join(outside, 'x.md'), '# X');
  try { fs.symlinkSync(path.join(outside, 'x.md'), path.join(root, 'knowledge', 'link.md')); } catch { return; }
  const got = collectSources(root);
  assert.ok(!got.some((x) => x.source.endsWith('link.md')), '루트 밖 symlink 포함됨');
});
```

- [ ] **Step 2: 실패 확인** — Run: `node --test .../rag/lib/sources.test.mjs` · Expected: FAIL.

- [ ] **Step 3: `sources.mjs` 작성(적응)**

```js
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
      out.push({ absPath: abs, source: path.relative(rootReal, abs), sourceType: TYPE_MAP[dir] });
    }
  }
  return out;
}
```

- [ ] **Step 4: 통과 + 커밋** — Run → PASS.
```bash
git add plugins/bnviit-rag/skills/bnviit-memory/rag/lib/sources.mjs plugins/bnviit-rag/skills/bnviit-memory/rag/lib/sources.test.mjs
git commit -m "feat(bnviit-rag): 소스 수집 + source_type 태깅 + 경계(symlink/확장자/크기)"
```

---

## Task 4: 임베딩 + fingerprint

**Files:**
- Create(적응): `.../rag/lib/embed.mjs`
- Test: `.../rag/lib/embed.test.mjs`

**Interfaces:**
- Consumes: `config.mjs`(`EMBED_MODEL`,`EMBED_REVISION`,`EMBED_DIM`).
- Produces: `embed(texts, kind) → Promise<number[][]>`(384d L2 정규화), `embedOne(text, kind)`, `embeddingFingerprint() → string`(모델ID+revision+prefix+pooling+정규화+dim의 안정적 해시).

- [ ] **Step 1: 실패 테스트 작성** — `.../rag/lib/embed.test.mjs`

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { embeddingFingerprint } from './embed.mjs';

test('fingerprint는 결정적이고 모델/차원을 반영', () => {
  const fp1 = embeddingFingerprint();
  const fp2 = embeddingFingerprint();
  assert.equal(fp1, fp2);
  assert.match(fp1, /multilingual-e5-small/);
  assert.match(fp1, /d=384/);
});
```
> 실제 임베딩(모델 로드 ~수십초)은 통합 스모크(Task 11)에서 검증한다. 여기선 fingerprint만 단위 테스트.

- [ ] **Step 2: 실패 확인** — Run → FAIL.

- [ ] **Step 3: `embed.mjs` 작성(적응)** — 원본 `embed.mjs`에 `embeddingFingerprint`·revision 고정·cacheDir(fileURLToPath)·다운로드 fail-safe(B5) 추가.

```js
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { EMBED_MODEL, EMBED_REVISION, EMBED_DIM } from '../config.mjs';

let _p = null;
async function getExtractor() {
  if (!_p) {
    const { pipeline, env } = await import('@huggingface/transformers');
    // B3/Codex#4: .pathname은 공백/한글을 %20 등으로 남겨 잘못된 경로를 만든다 → fileURLToPath.
    // R2#2: 실제 모델 캐시 경로 == 게이트가 검사한 경로가 되도록, RAG_CACHE_DIR(있으면) 최우선.
    //   ingest/query/status는 resolveCacheDir({cliCacheDir,root})를 계산해 RAG_CACHE_DIR로 주입하므로 둘이 항상 일치한다.
    //   lib 단독 호출(env 미설정)일 때만 번들 기본(rag/.cache)로 폴백.
    env.cacheDir = process.env.RAG_CACHE_DIR
      ? path.resolve(process.env.RAG_CACHE_DIR)
      : fileURLToPath(new URL('../.cache/', import.meta.url));
    // B5: fail-safe 반전 — 기본은 다운로드 금지(false). 최초 색인(ingest)에서만 RAG_ALLOW_DOWNLOAD=1로 허용.
    env.allowRemoteModels = (process.env.RAG_ALLOW_DOWNLOAD === '1');
    _p = pipeline('feature-extraction', EMBED_MODEL, { revision: EMBED_REVISION });
  }
  return _p;
}

export async function embed(texts, kind = 'passage') {
  if (texts.length === 0) return [];
  const extractor = await getExtractor();
  const prefix = kind === 'query' ? 'query: ' : 'passage: ';
  const out = await extractor(texts.map((t) => prefix + t), { pooling: 'mean', normalize: true });
  return out.tolist();
}
export async function embedOne(text, kind = 'passage') { const [v] = await embed([text], kind); return v; }

import crypto from 'node:crypto';
export function embeddingFingerprint() {
  const contract = `model=${EMBED_MODEL};rev=${EMBED_REVISION};prefix=passage|query;pool=mean;norm=l2;d=${EMBED_DIM}`;
  return contract + ';sha=' + crypto.createHash('sha1').update(contract).digest('hex').slice(0, 12);
}
```

- [ ] **Step 4: 통과 + 커밋** — Run → PASS.
```bash
git add plugins/bnviit-rag/skills/bnviit-memory/rag/lib/embed.mjs plugins/bnviit-rag/skills/bnviit-memory/rag/lib/embed.test.mjs
git commit -m "feat(bnviit-rag): 로컬 e5 임베딩 + embeddingFingerprint(revision 고정)"
```

---

## Task 5: DB 레이어 — `chunks`/`meta` 스키마 + fingerprint 재구축

**Files:**
- Create(적응): `.../rag/lib/db.mjs`
- Test: `.../rag/lib/db.test.mjs`

**Interfaces:**
- Consumes: `config.mjs`(`EMBED_DIM`), `embed.mjs`(`embeddingFingerprint`).
- Produces: `openDb(dataDir) → db`(스키마 보장 + fingerprint/schema_version 검사), `toVectorLiteral(arr)`, `upsertChunk(db,row)`, `existingHashes(db)`, `deleteMissing(db,source,keepIds)`, `search(db,vec,{k,sourceType})`, `getMeta(db)`, `setMeta(db,{fingerprint})`. 상수 `SCHEMA_VERSION=1`.

- [ ] **Step 1: 실패 테스트 작성** — `.../rag/lib/db.test.mjs`

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { openDb, upsertChunk, search, deleteMissing, existingHashes, getMeta } from './db.mjs';

function fakeVec(seed) { return Array.from({ length: 384 }, (_, i) => ((i + seed) % 7) / 10); }
function tmpData() { return fs.mkdtempSync(path.join(os.tmpdir(), 'rag-db-')); }

test('upsert 후 코사인 검색이 자기 자신을 1순위로', async () => {
  const db = await openDb(tmpData());
  await upsertChunk(db, { id: 'a', source: 'knowledge/x.md', source_type: 'knowledge', heading: 'H', chunk_index: 0, content: 'hello', char_len: 5, content_hash: 'h1', embedding: fakeVec(1) });
  await upsertChunk(db, { id: 'b', source: 'knowledge/y.md', source_type: 'knowledge', heading: null, chunk_index: 0, content: 'world', char_len: 5, content_hash: 'h2', embedding: fakeVec(5) });
  const rows = await search(db, fakeVec(1), { k: 2 });
  assert.equal(rows[0].source, 'knowledge/x.md');
  await db.close();
});

test('meta 테이블에 fingerprint 저장됨', async () => {
  const db = await openDb(tmpData());
  const m = await getMeta(db);
  assert.ok(m.embedding_fingerprint);
  assert.equal(m.schema_version, 1);
  await db.close();
});

test('deleteMissing은 keep에 없는 청크 제거', async () => {
  const db = await openDb(tmpData());
  await upsertChunk(db, { id: 'a', source: 's.md', source_type: 'sop', heading: null, chunk_index: 0, content: 'x', char_len: 1, content_hash: 'h', embedding: fakeVec(1) });
  const removed = await deleteMissing(db, 's.md', new Set());
  assert.equal(removed, 1);
  await db.close();
});
```

- [ ] **Step 2: 실패 확인** — Run → FAIL.

- [ ] **Step 3: `db.mjs` 작성(적응)** — 원본 `db.mjs` + `meta` 테이블 + fingerprint/schema_version 재구축.

```js
import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite/vector';
import { EMBED_DIM } from '../config.mjs';
import { embeddingFingerprint } from './embed.mjs';

export const SCHEMA_VERSION = 1;

async function ensureSchema(db) {
  await db.exec(`
    CREATE EXTENSION IF NOT EXISTS vector;
    CREATE TABLE IF NOT EXISTS chunks (
      id TEXT PRIMARY KEY, source TEXT NOT NULL, source_type TEXT NOT NULL,
      heading TEXT, chunk_index INTEGER NOT NULL, content TEXT NOT NULL,
      char_len INTEGER, content_hash TEXT NOT NULL,
      embedding vector(${EMBED_DIM}), updated_at TIMESTAMPTZ DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS chunks_source_idx ON chunks(source);
    CREATE INDEX IF NOT EXISTS chunks_type_idx ON chunks(source_type);
    CREATE TABLE IF NOT EXISTS meta (
      id INTEGER PRIMARY KEY DEFAULT 1, schema_version INTEGER, embedding_fingerprint TEXT, last_ingest_at TIMESTAMPTZ
    );
  `);
}

export async function openDb(dataDir) {
  let db = new PGlite(dataDir, { extensions: { vector } });
  await ensureSchema(db);
  const fp = embeddingFingerprint();
  const res = await db.query('SELECT schema_version, embedding_fingerprint FROM meta WHERE id=1');
  const row = res.rows[0];
  const mismatch = row && (row.schema_version !== SCHEMA_VERSION || row.embedding_fingerprint !== fp);
  if (mismatch) {
    // 차원/계약 변경 → 전체 재구축(drop & recreate). 차원 불일치 row가 코사인에 섞이지 않게.
    await db.exec('DROP TABLE IF EXISTS chunks; DROP TABLE IF EXISTS meta;');
    await ensureSchema(db);
  }
  await db.query(
    `INSERT INTO meta (id, schema_version, embedding_fingerprint, last_ingest_at)
     VALUES (1,$1,$2,NULL)
     ON CONFLICT (id) DO UPDATE SET schema_version=EXCLUDED.schema_version, embedding_fingerprint=EXCLUDED.embedding_fingerprint`,
    [SCHEMA_VERSION, fp]
  );
  return db; // B9: 색인 전 last_ingest_at은 NULL(=status '없음'). setMeta(UPDATE)로만 채운다.
}

export function toVectorLiteral(a) { return '[' + a.join(',') + ']'; }

export async function upsertChunk(db, r) {
  await db.query(
    `INSERT INTO chunks (id,source,source_type,heading,chunk_index,content,char_len,content_hash,embedding,updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::vector,now())
     ON CONFLICT (id) DO UPDATE SET source=EXCLUDED.source, source_type=EXCLUDED.source_type, heading=EXCLUDED.heading,
       chunk_index=EXCLUDED.chunk_index, content=EXCLUDED.content, char_len=EXCLUDED.char_len,
       content_hash=EXCLUDED.content_hash, embedding=EXCLUDED.embedding, updated_at=now()`,
    [r.id, r.source, r.source_type, r.heading, r.chunk_index, r.content, r.char_len, r.content_hash, toVectorLiteral(r.embedding)]
  );
}

export async function existingHashes(db) {
  const res = await db.query('SELECT id, content_hash FROM chunks');
  const m = new Map(); for (const r of res.rows) m.set(r.id, r.content_hash); return m;
}
export async function deleteMissing(db, source, keepIds) {
  const res = await db.query('SELECT id FROM chunks WHERE source=$1', [source]);
  const del = res.rows.map((r) => r.id).filter((id) => !keepIds.has(id));
  for (const id of del) await db.query('DELETE FROM chunks WHERE id=$1', [id]);
  return del.length;
}
export async function search(db, qvec, { k = 5, sourceType = null } = {}) {
  const params = [toVectorLiteral(qvec), k]; let where = '';
  if (sourceType) { where = 'WHERE source_type = $3'; params.push(sourceType); }
  const res = await db.query(
    `SELECT source, source_type, heading, chunk_index, content, 1 - (embedding <=> $1::vector) AS similarity
     FROM chunks ${where} ORDER BY embedding <=> $1::vector LIMIT $2`, params);
  return res.rows;
}
export async function getMeta(db) { const r = await db.query('SELECT * FROM meta WHERE id=1'); return r.rows[0] || {}; }
export async function setMeta(db) { await db.query('UPDATE meta SET last_ingest_at=now() WHERE id=1'); }
```

- [ ] **Step 4: 통과 + 커밋** — Run → PASS.
```bash
git add plugins/bnviit-rag/skills/bnviit-memory/rag/lib/db.mjs plugins/bnviit-rag/skills/bnviit-memory/rag/lib/db.test.mjs
git commit -m "feat(bnviit-rag): chunks/meta 스키마 + fingerprint/schema_version 재구축"
```

---

## Task 6: writer lock + 기밀 게이트

**Files:**
- Create: `.../rag/lib/lock.mjs`, `.../rag/lib/guard.mjs`
- Test: `.../rag/lib/lock.test.mjs`, `.../rag/lib/guard.test.mjs`

**Interfaces:**
- Produces:
  - `acquireLock(dataDir) → release()` (원자적 `wx` 생성; 이미 잠겼고 PID 살아있으면 throw; stale이면 정리 후 재시도).
  - `checkSecrecy(root, targets, { dataDir, cacheDir } = {}) → { ok, violations:[{path,reason}], warnings:[{path,reason}] }`. `reason ∈ git-tracked|not-ignored|cloud-sync`(violations) / `git-unverifiable`(warnings, Codex#6 — git 아니면 tracked/ignore 검증 불가를 '경고+계속'으로 표면화). dataDir/cacheDir가 root 밖이면 그 절대경로를 직접 검사(cloud-sync + 소속 git 리포 기준 tracked/ignore).

- [ ] **Step 1: 실패 테스트 작성**

`lock.test.mjs`:
```js
import { test } from 'node:test'; import assert from 'node:assert/strict';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { acquireLock } from './lock.mjs';
test('두 번째 acquire는 throw, release 후 재취득 가능', async () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'rag-lock-'));
  const rel = await acquireLock(d);
  await assert.rejects(() => acquireLock(d));
  rel();
  const rel2 = await acquireLock(d); rel2();
});
```

`guard.test.mjs`:
```js
import { test } from 'node:test'; import assert from 'node:assert/strict';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { execSync } from 'node:child_process';
import { checkSecrecy } from './guard.mjs';
test('git 추적 중인 대상은 위반(git-tracked)', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'rag-guard-'));
  execSync('git init -q', { cwd: d });
  fs.mkdirSync(path.join(d, 'knowledge'));
  fs.writeFileSync(path.join(d, 'knowledge', 'a.md'), '# A');
  execSync('git add knowledge/a.md', { cwd: d });
  const res = checkSecrecy(d, ['knowledge']);
  assert.equal(res.ok, false);
  assert.ok(res.violations.some((v) => v.reason === 'git-tracked'));
});
test('gitignore된 대상은 통과', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'rag-guard2-'));
  execSync('git init -q', { cwd: d });
  fs.writeFileSync(path.join(d, '.gitignore'), 'knowledge/\n');
  fs.mkdirSync(path.join(d, 'knowledge'));
  fs.writeFileSync(path.join(d, 'knowledge', 'a.md'), '# A');
  const res = checkSecrecy(d, ['knowledge']);
  assert.equal(res.ok, true);
});
test('비-git 디렉터리는 차단 아닌 경고(git-unverifiable)', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'rag-guard3-'));
  fs.mkdirSync(path.join(d, 'knowledge'));
  fs.writeFileSync(path.join(d, 'knowledge', 'a.md'), '# A');
  const res = checkSecrecy(d, ['knowledge']);
  assert.equal(res.ok, true, '비-git은 차단하지 않는다(정상 시나리오)');
  assert.ok(res.warnings.some((w) => w.reason === 'git-unverifiable'), '검증 불가는 경고로 표면화');
});
test('미존재 .pgdata/.cache는 .gitignore의 디렉터리 패턴으로 통과(R2#1 — 최초 셋업 차단 회귀)', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'rag-guard4-'));
  execSync('git init -q', { cwd: d });
  fs.writeFileSync(path.join(d, '.gitignore'), 'knowledge/\n.pgdata/\n.cache/\n');
  fs.mkdirSync(path.join(d, 'knowledge'));
  fs.writeFileSync(path.join(d, 'knowledge', 'a.md'), '# A');
  // .pgdata/.cache는 아직 생성 전(미존재). 디렉터리 패턴(.pgdata/)으로 ignore 판정되어야 한다.
  const res = checkSecrecy(d, ['knowledge', '.pgdata', '.cache'], {
    dataDir: path.join(d, '.pgdata'), cacheDir: path.join(d, '.cache'),
  });
  assert.equal(res.ok, true, '미존재 .pgdata가 not-ignored로 오판되어 최초 색인이 차단되면 안 됨');
});
```

- [ ] **Step 2: 실패 확인** — Run both → FAIL.

- [ ] **Step 3: 구현**

`lock.mjs` (Codex#5: TOCTOU 없는 원자적 `wx` 배타 생성):
```js
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
```

`guard.mjs` (B2/Codex#6: 실제 데이터 경로 검사 + 비-git은 '경고+계속'):
```js
import fs from 'node:fs'; import path from 'node:path';
import { execFileSync } from 'node:child_process';
const CLOUD = ['Library/Mobile Documents', 'Dropbox', 'Google Drive', 'OneDrive'];

function safeRealpath(p) { try { return fs.realpathSync(p); } catch { return null; } }
// 미존재 경로는 가장 가까운 존재 부모로 realpath 대체(데이터 디렉터리는 색인 전엔 없을 수 있음)
function realpathOrParent(p) {
  let cur = path.resolve(p);
  for (let i = 0; i < 64; i++) {
    const r = safeRealpath(cur);
    if (r) return r;
    const up = path.dirname(cur);
    if (up === cur) return cur;
    cur = up;
  }
  return cur;
}
function inCloud(realAbs) {
  return CLOUD.some((c) => realAbs.includes(path.sep + c.replace('/', path.sep)));
}
function inGit(dir) { try { execFileSync('git', ['rev-parse', '--is-inside-work-tree'], { cwd: dir, stdio: 'ignore' }); return true; } catch { return false; } }
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
  const realAbs = realpathOrParent(absPath);
  if (inCloud(realAbs)) violations.push({ path: absPath, reason: 'cloud-sync' });
  // 해당 경로가 속한 git work-tree 기준(없으면 부모) tracked/ignore 검사
  const baseDir = fs.existsSync(absPath) ? absPath : path.dirname(absPath);
  if (inGit(baseDir)) {
    try {
      const topRaw = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: baseDir, encoding: 'utf8' }).trim();
      const rel = path.relative(topRaw, absPath) || '.';
      if (isTracked(topRaw, rel)) violations.push({ path: absPath, reason: 'git-tracked' });
      else if (!isIgnored(topRaw, rel)) violations.push({ path: absPath, reason: 'not-ignored' });
    } catch { warnings.push({ path: absPath, reason: 'git-unverifiable' }); }
  } else {
    warnings.push({ path: absPath, reason: 'git-unverifiable' }); // 비-git: 검증 불가 표면화(경고)
  }
}

export function checkSecrecy(root, targets, { dataDir, cacheDir } = {}) {
  const violations = []; const warnings = [];
  const realRoot = realpathOrParent(root);
  if (inCloud(realRoot)) violations.push({ path: realRoot, reason: 'cloud-sync' });

  const git = inGit(root);
  for (const t of targets) {
    if (!git) { warnings.push({ path: t, reason: 'git-unverifiable' }); continue; } // Codex#6: 통과 대신 경고
    if (isTracked(root, t)) violations.push({ path: t, reason: 'git-tracked' });
    else if (!isIgnored(root, t)) violations.push({ path: t, reason: 'not-ignored' });
  }

  // B2/Codex#7: dataDir/cacheDir가 root 밖이면 그 절대경로를 직접 검사(in-root면 호출부가 상대 target으로 이미 추가).
  for (const abs of [dataDir, cacheDir].filter(Boolean)) {
    const rel = path.relative(realRoot, realpathOrParent(abs));
    const inRoot = rel && !rel.startsWith('..') && !path.isAbsolute(rel);
    if (!inRoot) checkAbsolutePath(path.resolve(abs), violations, warnings);
  }

  return { ok: violations.length === 0, violations, warnings };
}
```

- [ ] **Step 4: 통과 + 커밋** — Run both → PASS.
```bash
git add plugins/bnviit-rag/skills/bnviit-memory/rag/lib/lock.mjs plugins/bnviit-rag/skills/bnviit-memory/rag/lib/guard.mjs plugins/bnviit-rag/skills/bnviit-memory/rag/lib/lock.test.mjs plugins/bnviit-rag/skills/bnviit-memory/rag/lib/guard.test.mjs
git commit -m "feat(bnviit-rag): writer lock + 색인 전 fail-closed 기밀 게이트"
```

---

## Task 7: `ingest.mjs` — 멱등·lock·fingerprint·exit code

**Files:**
- Modify(적응): `.../rag/ingest.mjs`
- Create: `.../rag/test/ingest.smoke.test.mjs` (lockfile은 Task 2에서 이미 생성·커밋됨)

**Interfaces:**
- Consumes: `config.mjs`(`resolveRoot`,`resolveDataDir`,`resolveCacheDir`,청킹 상수), `sources.collectSources`, `chunk.chunkMarkdown/sha1/chunkId`, `embed.embed`, `db.*`, `lock.acquireLock`, `guard.checkSecrecy`.
- Produces: CLI `node ingest.mjs [root] [--root R] [--data-dir DIR] [--cache-dir DIR] [--no-guard] [--json]`. 동작: 기밀 게이트(위반 시 exit 2) → lock → 파일 단위 색인(변경분만 임베딩, orphan 삭제) → 완전 삭제 파일의 청크 일괄 정리(Codex#8) → `meta.last_ingest_at` 갱신 → 요약 출력. exit 0 성공. `--json`은 성공/게이트실패/예외 모두 안정 JSON(Codex#9).
- **lock 수명(R4#1)**: `acquireLock(dataDir)` 이후의 모든 종료 경로는 `process.exit()`를 호출하지 않고 `process.exitCode`만 설정 후 `main()`을 정상 반환한다 → `try/finally`의 `release()`가 반드시 실행되어 `.ingest.lock`이 남지 않는다(다음 ingest의 '진행 중' 오판 방지). 게이트 차단만 lock 취득 *전*이라 `process.exit(2)` 허용.
- 캐시 일관(R2#2): ingest가 `resolveCacheDir({cliCacheDir,root})`로 계산한 `cacheDir`를 `process.env.RAG_CACHE_DIR`에 주입해, **게이트가 검사한 캐시 경로 == embed가 실제로 쓰는 모델 캐시 경로**가 되게 한다.
- 다운로드 정책(B5): 최초 색인이므로 ingest는 내부적으로 `RAG_ALLOW_DOWNLOAD=1`을 보장(미설정 시 주입). query/status는 캐시 온리.

- [ ] **Step 1: lockfile 무결성 검증(npm ci)** (의존성·lockfile은 Task 2에서 생성·커밋 → 여기선 재현성만 재확인)
```bash
cd plugins/bnviit-rag/skills/bnviit-memory/rag && npm ci
```
Expected: lockfile 기준 결정적 설치 성공, `node_modules/`(gitignore됨).

- [ ] **Step 2: 실패 테스트(스모크) 작성** — `.../rag/test/ingest.smoke.test.mjs`

```js
import { test } from 'node:test'; import assert from 'node:assert/strict';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { execFileSync } from 'node:child_process';

const RAG = path.resolve(import.meta.dirname, '..'); // rag/

function tmpProject() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'rag-proj-'));
  fs.writeFileSync(path.join(d, '.gitignore'), 'knowledge/\n.pgdata/\n.cache/\n');
  fs.mkdirSync(path.join(d, 'knowledge'));
  fs.writeFileSync(path.join(d, 'knowledge', 'care.md'), '# 케어\n수술 후 D+7 재진 예약 안내 메시지를 보낸다.');
  return d;
}

test('ingest가 기밀 게이트 통과 후 청크를 색인(exit 0)', { timeout: 180000 }, () => {
  const proj = tmpProject();
  // B5: 모델 다운로드 허용으로 결정성 확보. .cache는 roundtrip(Task 11)과 공유 권장(공유 캐시 dir 주입 가능).
  const env = { ...process.env, RAG_DATA_DIR: path.join(proj, '.pgdata'), RAG_CACHE_DIR: path.join(proj, '.cache'), RAG_ALLOW_DOWNLOAD: '1' };
  const out = execFileSync('node', ['ingest.mjs', proj], { cwd: RAG, env, encoding: 'utf8', timeout: 180000, maxBuffer: 10 * 1024 * 1024 });
  assert.match(out, /신규/);
}); // 모델 로드로 느릴 수 있음(첫 회 수십초).

test('R4#1: ingest 2회 연속이 lock 에러 없이 성공 + 실행 후 .ingest.lock 미존재', { timeout: 240000 }, () => {
  const proj = tmpProject();
  const dataDir = path.join(proj, '.pgdata');
  const env = { ...process.env, RAG_DATA_DIR: dataDir, RAG_CACHE_DIR: path.join(proj, '.cache'), RAG_ALLOW_DOWNLOAD: '1' };
  const run = () => execFileSync('node', ['ingest.mjs', proj], { cwd: RAG, env, encoding: 'utf8', timeout: 180000, maxBuffer: 10 * 1024 * 1024 });
  run();
  // 정상 종료 경로가 process.exit()를 쓰면 finally(release)가 안 돌아 lock이 남는다.
  assert.ok(!fs.existsSync(path.join(dataDir, '.ingest.lock')), '첫 ingest 후 .ingest.lock 잔류(=lock 누수)');
  const out2 = run(); // 잔류 lock이 있으면 "ingest 진행 중"으로 throw → 이 호출이 실패
  assert.match(out2, /신규 0/); // 멱등(두 번째는 신규 0)
});
```

- [ ] **Step 3: 실패 확인** — Run: `node --test .../rag/test/ingest.smoke.test.mjs` · Expected: FAIL.

- [ ] **Step 4: `ingest.mjs` 작성(적응)** — 원본 흐름 + lock + guard + 파일 단위 커밋 + exit code.

```js
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
```
> `--json` 모드에서는 사람용 텍스트 로그를 stderr로만 내보내거나 억제해 stdout이 순수 JSON 한 줄이 되도록 한다(파서 안정성).

- [ ] **Step 5: 통과 + 커밋** — Run → PASS. (lockfile은 Task 2에서 이미 커밋됨)
```bash
git add plugins/bnviit-rag/skills/bnviit-memory/rag/ingest.mjs plugins/bnviit-rag/skills/bnviit-memory/rag/test/ingest.smoke.test.mjs
git commit -m "feat(bnviit-rag): 멱등 ingest(--json·orphan 정리·실데이터 게이트·다운로드 fail-safe)"
```

---

## Task 8: `query.mjs` 적응(exit code·--json 유지)

**Files:**
- Modify(적응): `.../rag/query.mjs`
- Test: `.../rag/test/query.smoke.test.mjs`

**Interfaces:**
- Consumes: `config.resolveRoot/resolveDataDir/resolveCacheDir`, `db.search`, `embed.embedOne`.
- Produces: CLI `node query.mjs "질문" [--root R] [--data-dir DIR] [--cache-dir DIR] [--k N] [--type T] [--json]`. **경로 옵션(`--root`/`--data-dir`/`--cache-dir`)은 parseArgs가 값을 소비·제거해 질의문에 누수되지 않는다(R2#4).** **openDb 전에 `RAG_CACHE_DIR=resolveCacheDir({cliCacheDir,root})`를 주입(R3)** 해 embed가 셋업 때 받은 root 캐시를 쓰도록 한다(번들 폴백 방지). 결과 없으면 exit 0(빈 결과 메시지), 인자 없으면 exit 1. **`--json`은 명시 키만 직렬화**: `{source, source_type, heading, chunk_index, similarity, content}`(embedding 제외). 다운로드는 캐시 온리(B5: `RAG_ALLOW_DOWNLOAD` 주입 안 함).

- [ ] **Step 1: 실패 테스트 작성** — `.../rag/test/query.smoke.test.mjs`

```js
import { test } from 'node:test'; import assert from 'node:assert/strict';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { execFileSync } from 'node:child_process';
const RAG = path.resolve(import.meta.dirname, '..');

// 사전 색인된 임시 프로젝트(이 테스트는 Task 7 ingest 적응 이후 실행 가능).
function ingested() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'rag-q-'));
  fs.writeFileSync(path.join(d, '.gitignore'), 'knowledge/\n.pgdata/\n.cache/\n');
  fs.mkdirSync(path.join(d, 'knowledge'));
  fs.writeFileSync(path.join(d, 'knowledge', 'care.md'), '# 케어\n수술 후 D+7 재진 예약 안내.');
  const env = { ...process.env, RAG_DATA_DIR: path.join(d, '.pgdata'), RAG_CACHE_DIR: path.join(d, '.cache'), RAG_ALLOW_DOWNLOAD: '1' };
  execFileSync('node', ['ingest.mjs', d], { cwd: RAG, env, timeout: 180000, maxBuffer: 10 * 1024 * 1024 });
  return { d, env };
}

test('--json은 명시 키만 직렬화(embedding 미포함)', { timeout: 180000 }, () => {
  const { d, env } = ingested();
  const out = execFileSync('node', ['query.mjs', '재진 예약', '--json'], { cwd: RAG, env, encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
  const rows = JSON.parse(out);
  assert.ok(Array.isArray(rows) && rows.length > 0, '결과 없음');
  const r = rows[0];
  assert.deepEqual(Object.keys(r).sort(), ['chunk_index', 'content', 'heading', 'similarity', 'source', 'source_type']);
  assert.ok(!('embedding' in r), 'embedding은 직렬화에서 제외되어야 함');
});

test('R2#4: --root/--data-dir 옵션이 질의문에 누수되지 않음', { timeout: 180000 }, () => {
  const { d } = ingested();
  // 옵션을 질의문 앞뒤에 섞어도 질의문은 "재진 예약"으로만 처리되어야 한다(옵션·값이 query에 안 섞임).
  const env = { ...process.env }; // RAG_DATA_DIR 등 미설정 → CLI 옵션으로만 경로 지정
  const out = execFileSync('node',
    ['query.mjs', '재진', '예약', '--root', d, '--data-dir', path.join(d, '.pgdata'), '--cache-dir', path.join(d, '.cache'), '--json'],
    { cwd: RAG, env, encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
  const rows = JSON.parse(out);
  assert.ok(Array.isArray(rows) && rows.length > 0, '옵션 파싱 실패 시 잘못된 경로/질의로 결과 없음');
  assert.ok(rows.some((r) => r.source.endsWith('care.md')), '기대 출처 미회수(옵션 누수 의심)');
});

test('R3: --root만으로 캐시 온리 질의 성공(RAG_CACHE_DIR/RAG_ALLOW_DOWNLOAD 미설정)', { timeout: 180000 }, () => {
  const { d } = ingested(); // 셋업 때 모델이 <d>/.cache(=ingest가 RAG_CACHE_DIR로 주입)에 캐시됨
  // 캐시 온리: 다운로드 비허용 + RAG_CACHE_DIR 미설정. query가 --root에서 cacheDir(<d>/.cache)를 파생·주입해야 캐시 적중.
  const env = { ...process.env };
  delete env.RAG_CACHE_DIR; delete env.RAG_DATA_DIR; delete env.RAG_ALLOW_DOWNLOAD;
  const out = execFileSync('node', ['query.mjs', '재진 예약', '--root', d, '--json'],
    { cwd: RAG, env, encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
  const rows = JSON.parse(out);
  assert.ok(rows.some((r) => r.source.endsWith('care.md')),
    'cacheDir 미주입 시 embed가 번들 .cache로 폴백→캐시 미스/다운로드 시도로 실패. --root 파생 캐시 주입이 동작해야 함');
});
// (R4#2: status.mjs 회귀는 status.mjs가 생성되는 Task 9로 이동 — Task 8 시점엔 status.mjs가 없어 의존성 역전.)
```
> RED 근거: 원본 `query.mjs --json`은 `search()`가 반환한 행을 그대로 `JSON.stringify`하므로 키 집합이 위 명시 6키와 다를 수 있다(예: `chunk_index` 누락). 또한 원본 parser는 `--root`/`--data-dir`/`--cache-dir`를 모르므로 이 토큰들이 `rest`에 섞여 질의문이 오염된다. R3 캐시 온리 테스트는 적응 전 query가 `--root`를 무시하고 번들 `rag/.cache`로 폴백해 캐시 미스로 실패한다 → 세 테스트 모두 적응 전 FAIL. (원래 '인자 없으면 exit 1'은 복제본이 이미 통과해 RED 미성립이므로 채택하지 않음. status.mjs 회귀는 Task 9로 분리 — R4#2.)

- [ ] **Step 2: 실패 확인** — Run → FAIL(키 불일치 또는 옵션 누수로). 만약 원본 `search()`가 이미 정확히 6키만 반환하면 첫 테스트는 PASS일 수 있으나, 옵션 파싱 테스트는 적응 전 반드시 FAIL이다 → Step 3에서 둘 다 코드로 고정.

- [ ] **Step 3: 원본 `query.mjs` 적응** — (1) **parseArgs에 `--root <p>`·`--data-dir <p>`·`--cache-dir <p>` 처리 추가**(값 1개 소비, `rest`에서 제외 — 질의문 오염 방지, R2#4). (2) `DATA_DIR` 직접 import 대신 `resolveRoot({cliArg:args.root})` + `resolveDataDir({cliDataDir:args.dataDir, root})`로 dataDir 계산(B1, 우선순위 CLI>env>root). (3) **R3 캐시 주입**: `const cacheDir = resolveCacheDir({cliCacheDir:args.cacheDir, root}); process.env.RAG_CACHE_DIR = cacheDir;`를 `openDb(dataDir)` 호출 전에 실행 — embed가 번들 `rag/.cache`로 폴백하지 않고 셋업 때 받은 root의 캐시를 쓰도록(캐시 온리 질의 성공 보장). (4) `--json` 출력을 `{source, source_type, heading, chunk_index, similarity, content}` 6키로 **명시 매핑**해 직렬화(embedding 등 제외 보장). (5) exit code 규약(`인자 없음→1`, 정상→0) 유지 — query/status는 lock을 쓰지 않으므로 `process.exit()` 사용 가능(R4#1의 'lock 후 exit 금지' 규칙은 ingest 전용). 다만 일관성 위해 정상 경로는 `process.exitCode` 설정 후 반환 패턴을 권장. 다운로드 미허용(캐시 온리) — `RAG_ALLOW_DOWNLOAD` 주입 안 함.

parseArgs 적응 예(원본 `--k/--type/--json`에 value-opt 3종 추가):
```js
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
  args.query = rest.join(' ').trim();
  return args;
}
// 사용(openDb 전, ingest와 동일 순서로 경로 계산·주입 — R3):
// const args = parseArgs(process.argv.slice(2));
// if (!args.query) { console.error('사용법: ...'); process.exit(1); }
// const root = resolveRoot({ cliArg: args.root });
// const dataDir = resolveDataDir({ cliDataDir: args.dataDir, root });
// const cacheDir = resolveCacheDir({ cliCacheDir: args.cacheDir, root });
// process.env.RAG_CACHE_DIR = cacheDir; // embed 캐시 일관 — 번들 .cache 폴백 방지(캐시 온리 질의 성공)
// const db = await openDb(dataDir);
// 주의: RAG_ALLOW_DOWNLOAD는 주입하지 않는다(캐시 온리). 셋업 때와 같은 root/cacheDir면 네트워크 없이 질의된다.
```

- [ ] **Step 4: 통과 + 커밋** — Run → PASS.
```bash
git add plugins/bnviit-rag/skills/bnviit-memory/rag/query.mjs plugins/bnviit-rag/skills/bnviit-memory/rag/test/query.smoke.test.mjs
git commit -m "feat(bnviit-rag): query exit code·--json 6키 매핑·경로 옵션 파싱(--root/--data-dir/--cache-dir)"
```

---

## Task 9: `status.mjs` + `lib/stats.mjs`

**Files:**
- Create: `.../rag/lib/stats.mjs`, `.../rag/status.mjs`
- Test: `.../rag/lib/stats.test.mjs`, `.../rag/test/status.smoke.test.mjs`(R4#2: status CLI 회귀를 여기 배치 — status.mjs가 본 태스크에서 생성되므로)

**Interfaces:**
- Consumes: `config.resolveRoot/resolveDataDir/resolveCacheDir`, `db.*`, `embed.embeddingFingerprint`.
- Produces: `collectStats(db) → { chunks, sources, byType:[{source_type,n}], last_ingest_at, embedding_fingerprint }`. CLI `node status.mjs [--root R] [--data-dir DIR] [--cache-dir DIR] [--json]`(`--root`/`--data-dir`/`--cache-dir` 값 명시 파싱 — R2#4, 우선순위 CLI>env>root). **`RAG_CACHE_DIR=resolveCacheDir({cliCacheDir,root})` 주입(R3, query와 동일 패턴)** — status 자체는 embed를 호출하지 않아(fingerprint는 모델 로드 없이 contract 해시) 캐시 미사용이지만, 경로 계약을 query/ingest와 일관 유지(향후 확장 대비). 다운로드 캐시 온리(B5).

- [ ] **Step 1: 실패 테스트 작성** — `.../rag/lib/stats.test.mjs`

```js
import { test } from 'node:test'; import assert from 'node:assert/strict';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { openDb, upsertChunk } from './db.mjs';
import { collectStats } from './stats.mjs';
function v(s){return Array.from({length:384},(_,i)=>((i+s)%5)/10);}
test('collectStats가 총 청크·타입별 분포·fingerprint 반환', async () => {
  const db = await openDb(fs.mkdtempSync(path.join(os.tmpdir(),'rag-st-')));
  await upsertChunk(db,{id:'a',source:'knowledge/x.md',source_type:'knowledge',heading:null,chunk_index:0,content:'x',char_len:1,content_hash:'h',embedding:v(1)});
  const s = await collectStats(db);
  assert.equal(s.chunks, 1);
  assert.ok(s.embedding_fingerprint);
  assert.deepEqual(s.byType, [{ source_type: 'knowledge', n: 1 }]);
  await db.close();
});
```

또한 `.../rag/test/status.smoke.test.mjs`(R4#2: Task 8에서 이관) — status CLI가 `--root`로 ingest와 동일 dataDir를 가리켜 색인 결과를 보고하는지 검증:
```js
import { test } from 'node:test'; import assert from 'node:assert/strict';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { execFileSync } from 'node:child_process';
const RAG = path.resolve(import.meta.dirname, '..');

function ingested() { // ingest.smoke / query.smoke와 동일 패턴
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'rag-stx-'));
  fs.writeFileSync(path.join(d, '.gitignore'), 'knowledge/\n.pgdata/\n.cache/\n');
  fs.mkdirSync(path.join(d, 'knowledge'));
  fs.writeFileSync(path.join(d, 'knowledge', 'care.md'), '# 케어\n수술 후 D+7 재진 예약 안내.');
  const env = { ...process.env, RAG_DATA_DIR: path.join(d, '.pgdata'), RAG_CACHE_DIR: path.join(d, '.cache'), RAG_ALLOW_DOWNLOAD: '1' };
  execFileSync('node', ['ingest.mjs', d], { cwd: RAG, env, timeout: 180000, maxBuffer: 10 * 1024 * 1024 });
  return d;
}

test('R3/R4#2: status --root가 동일 dataDir를 가리켜 색인 결과를 보고', { timeout: 180000 }, () => {
  const d = ingested();
  const env = { ...process.env };
  delete env.RAG_CACHE_DIR; delete env.RAG_DATA_DIR; delete env.RAG_ALLOW_DOWNLOAD;
  const out = execFileSync('node', ['status.mjs', '--root', d, '--json'],
    { cwd: RAG, env, encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
  const s = JSON.parse(out);
  assert.ok(s.chunks > 0, 'status가 --root 파생 dataDir(<d>/.pgdata)를 못 찾아 0 청크로 보고');
});
```
> 이 스모크는 status.mjs(본 태스크 Step 3)와 ingest(Task 7) 적응 이후 GREEN. unit `stats.test.mjs`는 즉시 RED→GREEN.

- [ ] **Step 2: 실패 확인** — Run → FAIL(stats unit은 미구현으로, status smoke는 status.mjs 부재로).

- [ ] **Step 3: 구현**

`lib/stats.mjs`:
```js
import { getMeta } from './db.mjs';
export async function collectStats(db) {
  const total = await db.query('SELECT count(*)::int AS n FROM chunks');
  const byType = await db.query('SELECT source_type, count(*)::int AS n FROM chunks GROUP BY source_type ORDER BY n DESC');
  const srcs = await db.query('SELECT count(DISTINCT source)::int AS n FROM chunks');
  const meta = await getMeta(db);
  return { chunks: total.rows[0].n, sources: srcs.rows[0].n, byType: byType.rows,
    last_ingest_at: meta.last_ingest_at || null, embedding_fingerprint: meta.embedding_fingerprint || null };
}
```

`status.mjs`:
```js
import { resolveRoot, resolveDataDir, resolveCacheDir } from './config.mjs';
import { openDb } from './lib/db.mjs';
import { collectStats } from './lib/stats.mjs';
const argv = process.argv.slice(2);
const json = argv.includes('--json');
// R2#3/R2#4: 우선순위 CLI > env > root. --root/--data-dir/--cache-dir 값을 명시 파싱(ingest와 동일 패턴).
// B5: 다운로드 미허용(캐시 온리) — RAG_ALLOW_DOWNLOAD 주입 안 함.
const optVal = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
const VALUE_OPTS = new Set(['--data-dir', '--cache-dir', '--root']);
const dataDirArg = optVal('--data-dir');
const cacheDirArg = optVal('--cache-dir');
const cliRoot = optVal('--root') ?? argv.find((a, i) => !a.startsWith('--') && !VALUE_OPTS.has(argv[i - 1]));
const root = resolveRoot({ cliArg: cliRoot });
const dataDir = resolveDataDir({ cliDataDir: dataDirArg, root });
const cacheDir = resolveCacheDir({ cliCacheDir: cacheDirArg, root });
process.env.RAG_CACHE_DIR = cacheDir; // R3: query와 동일 패턴으로 캐시 경로 일관 주입(status는 embed 미호출이라 무해하나 일관성·향후 확장 대비)
const db = await openDb(dataDir);
const s = await collectStats(db);
await db.close();
if (json) { console.log(JSON.stringify(s, null, 2)); }
else {
  console.log('비앤빛 메모리 현황');
  console.log(`  청크 ${s.chunks} / 소스 ${s.sources}`);
  for (const t of s.byType) console.log(`  - ${t.source_type}: ${t.n}`);
  console.log(`  마지막 색인: ${s.last_ingest_at || '없음'}`);
  console.log(`  임베딩: ${s.embedding_fingerprint || '미설정'}`);
}
```

- [ ] **Step 4: 통과 + 커밋** — Run → PASS.
```bash
git add plugins/bnviit-rag/skills/bnviit-memory/rag/lib/stats.mjs plugins/bnviit-rag/skills/bnviit-memory/rag/status.mjs plugins/bnviit-rag/skills/bnviit-memory/rag/lib/stats.test.mjs plugins/bnviit-rag/skills/bnviit-memory/rag/test/status.smoke.test.mjs
git commit -m "feat(bnviit-rag): status.mjs(--root/--data-dir/--cache-dir) + lib/stats 공용 집계 + status 스모크"
```

---

## Task 10: SKILL.md + 슬래시 커맨드 + README

**Files:**
- Create: `.../skills/bnviit-memory/SKILL.md`, `plugins/bnviit-rag/commands/{bnviit-setup,bnviit-ingest,bnviit-ask,bnviit-status}.md`
- Modify: `README.md`
- Test: `plugins/bnviit-rag/test/docs.test.mjs`

**Interfaces:**
- Produces: 셋업 절차(⓪~⑧)와 결과 해석 규율(비신뢰·abstain·HITL)을 담은 `SKILL.md`, 4개 커맨드 마크다운.

- [ ] **Step 1: 실패 테스트 작성** — `plugins/bnviit-rag/test/docs.test.mjs`

```js
import { test } from 'node:test'; import assert from 'node:assert/strict';
import fs from 'node:fs'; import path from 'node:path';
const P = path.resolve(import.meta.dirname, '..');
function fm(file){ const t=fs.readFileSync(file,'utf8'); assert.match(t,/^---\n[\s\S]*?name:[\s\S]*?\n---/, `${file} frontmatter`); return t; }

test('SKILL.md frontmatter + abstain 규율 포함', () => {
  const t = fm(path.join(P, 'skills/bnviit-memory/SKILL.md'));
  assert.match(t, /비앤빛안과를 위한 스킬을 설치/);
  assert.match(t, /abstain|근거 부족/);
  assert.match(t, /fail-closed|색인 전 차단|기밀 게이트/);
});
test('커맨드 4종 존재', () => {
  for (const c of ['bnviit-setup','bnviit-ingest','bnviit-ask','bnviit-status'])
    assert.ok(fs.existsSync(path.join(P, 'commands', c + '.md')), c);
});
```

- [ ] **Step 2: 실패 확인** — Run → FAIL.

- [ ] **Step 3: `SKILL.md` 작성** — frontmatter(pushy description) + 셋업 플로우(⓪~⑧) + Node 22/24 설치 정책 + 결과 해석 규율(출처 검증·유사도 해석·출처 인용·비신뢰 데이터·근거 부족 시 abstain·의료 발신 HITL). 본문은 스펙 §6·§9를 절차문으로 옮긴다(명령은 번들 `rag/`의 ingest/query/status 호출, 기밀 게이트 차단 시 중단·안내). **다운로드 정책 1줄 명기**: 최초 색인은 `RAG_ALLOW_DOWNLOAD=1`(ingest 자동 주입), 검증 질의 이후 ask/status 호출은 캐시 온리(기본, 다운로드 미허용)임을 본문에 포함한다. **캐시 일관(R2#2)**: ask/status 위임도 동일 root(또는 동일 `--cache-dir`/`RAG_CACHE_DIR`)를 사용해 색인 때와 같은 모델 캐시를 가리키도록 명시(불일치 시 캐시 미스로 다운로드 시도→캐시 온리 실패). **기밀 게이트 경고(git-unverifiable)** 발생 시 차단은 아니나 사용자에게 표면화함을 명시.

`SKILL.md` frontmatter:
```markdown
---
name: bnviit-memory
description: >-
  "비앤빛안과를 위한 스킬을 설치하라" 등 요청 시 작업자 로컬에 PGlite+pgvector RAG를 셋업하고
  비앤빛 업무 지식(knowledge/ 등)을 색인해 의미 검색을 제공한다. "비앤빛 RAG 설치/셋업/구축",
  "직원 메모리 설치", 비앤빛 정의서·정책·SOP·지식을 의미 기반으로 찾을 때 사용. 색인 전 기밀 게이트로
  공개 노출을 막고, 결과는 출처와 함께 제시하며 근거 부족 시 abstain한다.
---
```
(본문은 스펙 §5·§6·§9를 절차로 기술. ④ 색인 대상·①-b Node 설치는 HITL, ⑤ 기밀 게이트 위반 시 중단.)

각 커맨드 `.md`는 frontmatter `description` + 한 줄 동작. 예 `commands/bnviit-setup.md`:
```markdown
---
description: 비앤빛 RAG 전체 셋업(런타임 준비→도구→기밀 게이트→색인→검증)
---
bnviit-memory 스킬의 셋업 플로우(⓪~⑧)를 실행하라. Node 22/24 LTS 확인·설치(HITL), 색인 대상 확정(HITL),
색인 전 기밀 게이트(fail-closed) 통과 후 ingest, 프리셋 스모크 검증, 현황 보고까지 완주한다.
최초 색인(⑥)은 모델 다운로드가 필요하므로 `RAG_ALLOW_DOWNLOAD=1`로 ingest를 실행한다(ingest가 미설정 시 자동 주입).
이후 ask/status는 캐시 온리(다운로드 미허용)가 기본이다.
```
(ingest/ask/status 커맨드는 각각 `node <rag>/ingest.mjs`, `query.mjs`, `status.mjs` 위임.
bnviit-ingest 커맨드는 최초/재색인이므로 `RAG_ALLOW_DOWNLOAD=1`을 명시한다.
ask/status 위임은 색인과 동일한 root(또는 `--cache-dir`/`RAG_CACHE_DIR`·`--data-dir`/`RAG_DATA_DIR`)를 전달해 같은 캐시·데이터 경로를 가리키게 한다 — R2#2.)

`README.md`에 2단계 설치 섹션 추가:
```markdown
## 비앤빛 RAG 메모리 설치 (bnviit-rag)
1단계: `/plugin install bnviit-rag@bnviit-skill-marketplace`
2단계: `/bnviit-setup` (또는 "비앤빛안과를 위한 스킬을 설치하라")
```

- [ ] **Step 4: 통과 + 커밋** — Run: `node --test plugins/bnviit-rag/test/docs.test.mjs` → PASS.
```bash
git add plugins/bnviit-rag/skills/bnviit-memory/SKILL.md plugins/bnviit-rag/commands plugins/bnviit-rag/test/docs.test.mjs README.md
git commit -m "feat(bnviit-rag): SKILL.md(abstain 규율) + 슬래시 커맨드 4종 + README 2단계 설치"
```

---

## Task 11: 통합 스모크 — 라운드트립·멱등·기대 출처

**Files:**
- Create: `.../rag/test/roundtrip.test.mjs`

**Interfaces:**
- Consumes: 전 모듈(실DB·실임베딩). 느린 테스트(모델 로드).

- [ ] **Step 1: 실패 테스트 작성** — `.../rag/test/roundtrip.test.mjs`

```js
import { test } from 'node:test'; import assert from 'node:assert/strict';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { execFileSync } from 'node:child_process';
const RAG = path.resolve(import.meta.dirname, '..');

function project() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'rag-rt-'));
  fs.writeFileSync(path.join(d, '.gitignore'), 'knowledge/\n.pgdata/\n.cache/\n');
  fs.mkdirSync(path.join(d, 'knowledge'));
  fs.writeFileSync(path.join(d, 'knowledge', '09-care.md'), '# 케어 자동화\n수술 후 D+7: 1주 축하 + 재진 예약 CTA + 시력 기록 요청.');
  fs.writeFileSync(path.join(d, 'knowledge', '07-arch.md'), '# 아키텍처\n5겹 오류 방어 모델: 지식DB·의료안전필터·PMO검수·사람승인·사후감사.');
  return d;
}

test('ingest 후 질의가 기대 출처를 top-k에 회수 + 재색인 멱등', { timeout: 180000 }, () => {
  const proj = project();
  // B5: 최초 색인 다운로드 허용 + .cache 공유(ingest.smoke와 동일 캐시 dir 재사용 권장). Codex#12: options는 두 번째 인자.
  const env = { ...process.env, RAG_DATA_DIR: path.join(proj, '.pgdata'), RAG_CACHE_DIR: path.join(proj, '.cache'), RAG_ALLOW_DOWNLOAD: '1' };
  execFileSync('node', ['ingest.mjs', proj], { cwd: RAG, env, timeout: 180000, maxBuffer: 10 * 1024 * 1024 });
  const out = execFileSync('node', ['query.mjs', '5겹 오류 방어 모델', '--json'], { cwd: RAG, env, encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
  const rows = JSON.parse(out);
  assert.ok(rows.some((r) => r.source.endsWith('07-arch.md')), '기대 출처 미회수');
  // B8: 멱등 어서션 강화 — 두 번째 색인은 신규/갱신이 0이어야 한다(스킵만).
  const again = execFileSync('node', ['ingest.mjs', proj], { cwd: RAG, env, encoding: 'utf8', timeout: 180000, maxBuffer: 10 * 1024 * 1024 });
  assert.match(again, /신규 0/);
  assert.match(again, /갱신 0/);
});
```

- [ ] **Step 2: 실패 확인** — Run: `node --test .../rag/test/roundtrip.test.mjs` · Expected: FAIL(빈 인덱스/미구현이면).

- [ ] **Step 3: 구현 보정** — 앞 태스크 구현으로 통과해야 한다. 실패 시 원인(임베딩 prefix·코사인 부호·source 상대경로) 디버그.

- [ ] **Step 4: 통과 + 커밋** — Run → PASS.
```bash
git add plugins/bnviit-rag/skills/bnviit-memory/rag/test/roundtrip.test.mjs
git commit -m "test(bnviit-rag): 통합 스모크(라운드트립·기대 출처·멱등)"
```

---

## Self-Review

**1. 스펙 커버리지** (스펙 §→태스크):
- §3 아키텍처/파일구조 → T1·T2·T9·T10. §4.1 라이선스 게이트 → T1(LICENSE)·T2(핀). §4.2 적응표 → T2·T3. §4.3 임베딩 계약/fingerprint → T4·T5. §4.4 경로 변수 → T2.
- §5 명령어/exit code → T7·T8·T9·T10. §6 셋업 플로우 → T10(SKILL/커맨드) + 엔진(T6 게이트/lock, T7 ingest). §7 프리셋 기대출처 → T11.
- §8 데이터흐름/스키마/멱등 → T5·T7(orphan 일괄 정리 포함). §9 가드레일(게이트·lock·다운로드 fail-safe·abstain) → T6·T4(allowRemoteModels fail-safe)·T10(abstain). §10 테스트 → 각 태스크 테스트 + T11.
- §11 마켓플레이스/README → T1·T10. §12 결정 → 반영. §13 후속 → 계획 외(의도적).
- **갭 점검**: `transformers env.allowRemoteModels`는 T4에서 **fail-safe 반전**으로 구현 — 기본 false(다운로드 금지), `RAG_ALLOW_DOWNLOAD=1`일 때만 true. 최초 색인(ingest)만 이 변수를 자동 주입하고 ask/status는 캐시 온리. SKILL.md(T10 Step 3)에 다운로드 정책 1줄 명기.

**2. 플레이스홀더 스캔**: `EMBED_REVISION` 기본 `'main'`은 플레이스홀더가 아니라 "구현 시 정확 commit hash로 교체" 지시(T2 주석)로 명시 — 구현자가 모델 페이지에서 확정. 그 외 TODO/TBD 없음.

**3. 타입 일관성**:
- 경로 함수: `resolveRoot({cliArg})`·`resolveDataDir({cliDataDir,root})`·`resolveCacheDir({cliCacheDir,root})`(T2) → `ingest`(T7)·`query`(T8)·`status`(T9)·`embed`(T4)가 모두 **동일 우선순위(CLI > env > root > 기본, R2#3)** 로 일관 호출. `DATA_DIR` 모듈 상수 직접 import는 제거(하위호환 export만 잔존, 호출부 미사용).
- 캐시 경로 일관(R2#2 + R3): **ingest·query·status 셋 다** `resolveCacheDir({cliCacheDir,root})`로 계산한 `cacheDir`를 `openDb` 전에 `process.env.RAG_CACHE_DIR`로 주입 → `embed`가 `RAG_CACHE_DIR`을 최우선으로 읽어 **게이트 검사 경로 == 실제 모델 캐시 경로**가 되고, 캐시 온리 질의(`--root`만 주고 RAG_CACHE_DIR/RAG_ALLOW_DOWNLOAD 미설정)에서도 번들 `rag/.cache` 폴백 없이 셋업 캐시에 적중한다. embed는 `resolveCacheDir` import 없이 env/번들기본만 사용(중복 제거). (status는 embed 미호출이나 일관성 위해 동일 주입.)
- 경로 옵션 파싱(R2#4): ingest/query/status 모두 `--root`/`--data-dir`(query·ingest는 `--cache-dir`도) 값을 명시 소비·제거 → 위치 인자/질의문 오염 없음. query는 parseArgs, ingest/status는 `optVal`+`VALUE_OPTS` 동일 패턴.
- `checkSecrecy(root, targets, { dataDir, cacheDir })`(T6) → `ingest`(T7)가 dataDir/cacheDir를 함께 전달. 반환은 `{ ok, violations, warnings }` — ingest가 violations(차단)·warnings(경고+계속) 모두 처리. `isIgnored`는 디렉터리 target을 `rel+'/'`로 질의해 미존재 `.pgdata`/`.cache`도 정확 판정(R2#1).
- lock 수명/종료 코드(R4#1): `acquireLock`(T6, 원자적 wx) → `ingest`(T7). ingest는 **lock 취득 후 `process.exit()` 금지** — 정상/예외 모두 `process.exitCode`만 설정하고 `main()` 반환 → `try/finally`의 `release()`가 항상 실행되어 `.ingest.lock` 누수 없음(게이트 차단만 lock 전이라 `exit(2)` 허용). 회귀: T7에 '2회 연속 ingest + lock 미잔류' 추가. query/status는 lock 미사용이라 exit 규약 유지(일관성 위해 exitCode 패턴 권장).
- 테스트 의존성 순서(R4#2): status.mjs를 호출하는 회귀는 status.mjs가 생성되는 **T9**에 배치(`test/status.smoke.test.mjs`). T8은 query.mjs만 검증(–json 6키·–root 캐시 온리). 의존성 역전 제거.
- `collectSources`(T3) → `ingest`(T7) 소비. `embeddingFingerprint`(T4) → `db.openDb`/`stats`(T5·T9). `openDb/upsertChunk/search/deleteMissing/getMeta/setMeta`(T5) 시그니처가 T7·T9에서 동일. `collectStats`(T9) → `status.mjs`. 일치 확인됨.

> **연기(스펙 §13, 계획 외):** 정량 골든셋 평가, 3-OS CI 매트릭스, postinstall 감사, 파일 SHA 체크섬, 롤백 manifest, 프롬프트 인젝션 정밀 방어 — 후속 라운드.

---

## 14. 변경 이력

| 버전 | 날짜 | 요약 |
|---|---|---|
| v1 | 2026-06-29 | 최초 구현 계획(11 태스크, TDD 단계화). |
| v2 | 2026-06-29 | 스펙 v2 정합 — fingerprint·meta·writer lock·기밀 게이트·status·abstain 반영. |
| v3 | 2026-06-29 | 자체+codex plan 리뷰 반영 — DATA_DIR 함수화(resolveDataDir/resolveCacheDir, root 파생)·게이트 실경로 검사(dataDir/cacheDir 절대경로)·embed cacheDir fileURLToPath·allowRemoteModels fail-safe 반전(RAG_ALLOW_DOWNLOAD)·lock 원자성(wx)·완전삭제 orphan 정리·ingest `--json`·query `--json` 키 매핑(RED 재구성)·비-git 경고화·detectRoot marker 보정·symlink try/catch·meta last_ingest_at NULL·npm install/lock을 Task 2로 전진+npm ci 검증·Task 11 timeout 위치·멱등 어서션 강화·Task 0 브랜치 스텝. |
| v4 | 2026-06-29 | 라운드2 codex 검증 blocker 4건 반영 — (1) guard `isIgnored`를 디렉터리 `rel+'/'` 질의로 고쳐 미존재 `.pgdata`/`.cache`의 not-ignored 오판(최초 색인 차단) 제거 + 회귀 테스트, (2) embed 캐시 경로를 `RAG_CACHE_DIR` 최우선으로 하고 ingest가 계산한 cacheDir를 `RAG_CACHE_DIR`로 주입해 게이트 검사 경로==실제 모델 캐시 경로 일치, (3) `resolveDataDir`/`resolveCacheDir` 우선순위를 전역 계약(CLI > env > root)에 맞게 정렬 + config.test 어서션 갱신, (4) query/status parseArgs에 `--root`/`--data-dir`/`--cache-dir` 값 소비·제거 추가(질의문 오염 방지) + query 회귀 테스트. SKILL.md/커맨드에 캐시 일관 위임 명시. |
| v5 | 2026-06-29 | 라운드3 codex 검증 blocker 1건 반영 — query.mjs/status.mjs가 `resolveCacheDir({cliCacheDir,root})`로 계산한 cacheDir를 `openDb` 전 `process.env.RAG_CACHE_DIR`로 주입하도록 보정(이전엔 ingest만 주입 → query/status는 파싱만 하고 미주입해 embed가 번들 `rag/.cache`로 폴백, 캐시 온리 질의 실패). 회귀 테스트 2건 추가: `--root`만으로 캐시 온리 질의 성공, `status --root`가 동일 dataDir 보고. Self-Review 캐시 일관 항목을 ingest·query·status 3자 일치로 갱신. |
| v6 | 2026-06-29 | 라운드4 codex 검증 blocker 2건 반영 — (1) **lock 누수 수정**: ingest가 `acquireLock` 이후 `process.exit()`을 호출해 `try/finally`의 `release()` 전에 종료되어 `.ingest.lock` 잔류(다음 ingest '진행 중' 오판)하던 것을, lock 취득 후 모든 정상/예외 경로에서 `process.exitCode`만 설정·`main()` 반환으로 변경(게이트 차단만 lock 전이라 `exit(2)` 유지). T7에 '2회 연속 ingest + lock 미잔류' 회귀 추가. (2) **테스트 의존성 역전 수정**: 라운드3에서 Task 8에 둔 `status --root` 회귀가 Task 9에서야 생성되는 status.mjs를 호출 → Task 9의 `test/status.smoke.test.mjs`로 이동, Task 8은 query.mjs 검증만 유지. |
