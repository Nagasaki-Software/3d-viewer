# ビューのPDF保存 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 今の3Dビュー・モデル名・日時・注釈一覧・メモをA4横1ページのPDFにして、画面で設定したフォルダ（UNCパス可）にサーバーPCが保存する。

**Architecture:** ブラウザ側で、ページを canvas に描いて JPEG にし、手書きの最小構成PDFに包んで `POST /api/pdf` で送る。サーバー側の `pdf-api.js` が、設定ファイル `viewer/pdf-settings.json` のフォルダに、上書きしない名前で書き込む。`pdf-api.js` は `models-api.js` と同じく、本番の `server.js` と開発用の `vite.config.js` の両方から使う。

**Tech Stack:** three.js 0.184、Vite 8 / vitest 4、Node 標準ライブラリ（fs / path / crypto）。追加ライブラリは無し

**Spec:** `docs/superpowers/specs/2026-11-07-pdf-export-design.md`

## Global Constraints

- **着手の条件：** 別セッション「静止中の再描画停止と中間LODの実装」（`viewer/src/viewer.js`、`main.js` を変更中）の完了を待ってから始める。始める前に `git status` と `git diff --stat` で、そのセッションの変更が入っていることを確かめ、その変更は消さない
- **コミットしない。** ユーザーが明示的に依頼したときだけ行う
- ポート4000（本番）は止めない。`viewer/dist` と `viewer/models` は本番と共有しているので、`npm run build` はユーザーの許可を得てから行う。確認用のモデルと設定ファイルは scratchpad に置く
- 追加ライブラリは無し。フォントは `'Meiryo', 'メイリオ', sans-serif`
- ページは A4横（842×595pt）、canvas は 1754×1240px、JPEG の品質は 0.85。メモは最大500文字で、PDFに載せるのは6行まで。PDFの上限は30MB
- ファイル名は `<モデル名>_YYYYMMDD-HHmmss.pdf`。禁止文字（`\ / : * ? " < > |`、制御文字）は `_` に置き換え、空なら `view`。同名があれば `_2`、`_3` … を付け、既存ファイルは上書きしない
- **Ruling（設計書からの変更）：** 設計書では DOM を使う描画処理も `pdf-report.js` に置くことになっている。しかし `pdf-api.js`（Node）から import するファイルに DOM の処理を混ぜないため、canvas でページを組み立てる処理は `viewer/src/pdf-compose.js` に分ける。`pdf-report.js` は純粋関数だけにする

## Review Focus

1. **ネットワークフォルダが途中で切れた・権限が外れた** — 設定時には書けたが、保存時に書けない場合。500 と理由を返し、画面に表示する。Task 2 で、書き込みが失敗する場合（保存先がファイルになっている）のテストを入れる
2. **日本語・記号を含むモデル名** — `ポンプ/A:改` のような名前でも、PDFが保存できること。Task 1 で、`pdfFileName` の禁止文字のテストを入れる
3. **同じ秒に2回保存** — 2つ目が1つ目を上書きせず、`_2` が付くこと。Task 2 でテストを入れる
4. **操作中（軽量版の表示中）に保存** — PDFには精密版が写ること。Task 3 の `renderForCapture` で、軽量版を消し、通常解像度に戻してから撮る
5. **保存先が未設定のまま保存** — 409 と「保存先フォルダが設定されていません…」を表示すること。Task 2 でテストを入れる

---

### Task 1: PDFを作る純粋関数（pdf-report.js）

**Files:**
- Create: `viewer/src/pdf-report.js`
- Test: `viewer/tests/pdf-report.test.js`

**Interfaces:**
- Produces: `pdfFileName(modelName: string, date: Date): string`
- Produces: `formatReportDate(date: Date): string`（`YYYY/MM/DD HH:mm`）
- Produces: `buildImagePdf(jpeg: Uint8Array, imgW: number, imgH: number): Uint8Array`
- Produces: `wrapText(ctx: {measureText(s): {width: number}}, text: string, maxWidth: number, maxLines: number): string[]`

- [ ] **Step 1: 失敗するテストを書く**（`viewer/tests/pdf-report.test.js`）

```js
import { describe, expect, it } from 'vitest';
import { buildImagePdf, formatReportDate, pdfFileName, wrapText } from '../src/pdf-report.js';

const D = new Date(2026, 10, 7, 9, 5, 3); // 2026/11/07 09:05:03（ローカル時刻）

describe('pdfFileName', () => {
  it('モデル名_日時.pdf の形にする', () => {
    expect(pdfFileName('PumpA', D)).toBe('PumpA_20261107-090503.pdf');
  });
  it('ファイル名に使えない文字を_に置き換える', () => {
    // / と : で2つ、*?"<>|\ の7文字で7つ、区切りの1つ → 「改」のあとに _ が8個
    expect(pdfFileName('ポンプ/A:改*?"<>|\\', D)).toBe('ポンプ_A_改________20261107-090503.pdf');
  });
  it('末尾の空白・ドットは取り除く（Windowsで作れない名前を避ける）', () => {
    expect(pdfFileName('Model. ', D)).toBe('Model_20261107-090503.pdf');
  });
  it('空の名前は view にする', () => {
    expect(pdfFileName('', D)).toBe('view_20261107-090503.pdf');
    expect(pdfFileName(null, D)).toBe('view_20261107-090503.pdf');
  });
});

describe('formatReportDate', () => {
  it('YYYY/MM/DD HH:mm', () => {
    expect(formatReportDate(D)).toBe('2026/11/07 09:05');
  });
});

describe('buildImagePdf', () => {
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 0xff, 0xd9]);
  const pdf = buildImagePdf(jpeg, 1754, 1240);
  const text = new TextDecoder('latin1').decode(pdf);

  it('%PDF- で始まり %%EOF で終わる', () => {
    expect(text.startsWith('%PDF-1.4')).toBe(true);
    expect(text.trimEnd().endsWith('%%EOF')).toBe(true);
  });
  it('A4横のページで、JPEGをそのまま埋め込む', () => {
    expect(text).toContain('/MediaBox [0 0 842 595]');
    expect(text).toContain('/Filter /DCTDecode');
    expect(text).toContain('/Width 1754 /Height 1240');
    expect(text).toContain(`/Length ${jpeg.length}`);
  });
  it('xref の各オフセットが、その位置の「N 0 obj」を指している', () => {
    const xrefPos = Number(text.match(/startxref\n(\d+)/)[1]);
    expect(text.slice(xrefPos, xrefPos + 4)).toBe('xref');
    const entries = text.slice(xrefPos).split('\n').slice(3, 8);
    entries.forEach((line, i) => {
      const off = Number(line.slice(0, 10));
      expect(text.slice(off, off + `${i + 1} 0 obj`.length)).toBe(`${i + 1} 0 obj`);
    });
  });
});

describe('wrapText', () => {
  const ctx = { measureText: (s) => ({ width: s.length * 10 }) }; // 1文字10px
  it('幅に収まるよう折り返す。改行も尊重する', () => {
    expect(wrapText(ctx, 'あいうえおかき\nく', 50, 10)).toEqual(['あいうえお', 'かき', 'く']);
  });
  it('行数を超えた分は最後の行を…で切る', () => {
    expect(wrapText(ctx, 'あいうえおかきくけこさしす', 50, 2)).toEqual(['あいうえお', 'かきくけ…']);
  });
  it('空文字は空配列', () => {
    expect(wrapText(ctx, '', 50, 3)).toEqual([]);
  });
});
```

- [ ] **Step 2: 失敗を確認する**

Run: `cd viewer && npx vitest run tests/pdf-report.test.js`
Expected: FAIL（`Failed to resolve import "../src/pdf-report.js"`）

- [ ] **Step 3: 実装する**（`viewer/src/pdf-report.js`）

```js
/** PDF保存の純粋関数（ブラウザとNodeの両方から使う。DOM・three.jsに依存しないこと） */

const pad = (n) => String(n).padStart(2, '0');

/** 保存ファイル名 <モデル名>_YYYYMMDD-HHmmss.pdf。Windowsで使えない文字は_に置き換える */
export function pdfFileName(modelName, date) {
  const stamp = `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`
    + `-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
  const base = String(modelName ?? '')
    .replace(/[\\/:*?"<>|\x00-\x1f]/g, '_')
    .replace(/[. ]+$/, '')
    .trim() || 'view';
  return `${base}_${stamp}.pdf`;
}

/** PDFに印字する日時 YYYY/MM/DD HH:mm */
export function formatReportDate(date) {
  return `${date.getFullYear()}/${pad(date.getMonth() + 1)}/${pad(date.getDate())}`
    + ` ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** JPEG1枚をA4横のページ全面に貼った、最小構成のPDFを作る（ライブラリ不要） */
export function buildImagePdf(jpeg, imgW, imgH) {
  const enc = new TextEncoder();
  const W = 842, H = 595; // A4横（pt）
  const content = `q\n${W} 0 0 ${H} 0 0 cm\n/Im0 Do\nQ\n`;
  const chunks = [];
  let len = 0;
  const push = (bytes) => { chunks.push(bytes); len += bytes.length; };
  const offsets = [];

  push(enc.encode('%PDF-1.4\n'));
  push(new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a])); // バイナリを含むことを示すコメント行
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>`,
    null, // 4: 画像（バイナリなので下で別に書く）
    `<< /Length ${content.length} >>\nstream\n${content}endstream`,
  ];
  objects.forEach((body, i) => {
    offsets.push(len);
    if (body === null) {
      push(enc.encode(`${i + 1} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${imgW} /Height ${imgH}`
        + ` /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`));
      push(jpeg);
      push(enc.encode('\nendstream\nendobj\n'));
    } else {
      push(enc.encode(`${i + 1} 0 obj\n${body}\nendobj\n`));
    }
  });
  const xrefPos = len;
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  offsets.forEach((o) => { xref += `${String(o).padStart(10, '0')} 00000 n \n`; });
  xref += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF\n`;
  push(enc.encode(xref));

  const out = new Uint8Array(len);
  let p = 0;
  chunks.forEach((c) => { out.set(c, p); p += c.length; });
  return out;
}

/** canvasの文字幅で折り返す。maxLinesを超えた分は最後の行を「…」で切る */
export function wrapText(ctx, text, maxWidth, maxLines) {
  if (text == null || text === '') return [];
  const lines = [];
  for (const para of String(text).split('\n')) {
    let line = '';
    for (const ch of para) {
      if (line && ctx.measureText(line + ch).width > maxWidth) {
        lines.push(line);
        line = ch;
      } else {
        line += ch;
      }
    }
    lines.push(line);
  }
  if (lines.length <= maxLines) return lines;
  const kept = lines.slice(0, maxLines);
  let last = kept[maxLines - 1];
  while (last && ctx.measureText(last + '…').width > maxWidth) last = last.slice(0, -1);
  kept[maxLines - 1] = last + '…';
  return kept;
}
```

- [ ] **Step 4: 合格を確認する**

Run: `cd viewer && npx vitest run tests/pdf-report.test.js`
Expected: PASS

- [ ] **Step 5: 差分を確認する**（コミットしない）

Run: `git status --short`

---

### Task 2: サーバー側の保存処理（pdf-api.js）

**Files:**
- Create: `viewer/pdf-api.js`
- Modify: `viewer/server.js`（ルート追加）、`viewer/vite.config.js`（ミドルウェア追加）、`.gitignore`（`viewer/pdf-settings.json`）
- Test: `viewer/tests/pdf-api.test.js`

**Interfaces:**
- Consumes: `pdfFileName`（Task 1）
- Produces: `readPdfSettings(settingsFile: string): { folder: string }`
- Produces: `validatePdfFolder(folder: string): string | null`（エラーメッセージ、問題なければ null）
- Produces: `savePdfFile(folder: string, modelName: string, bytes: Buffer, now?: Date): string`（保存したファイル名）
- Produces: `handlePdfSettings(settingsFile, req, res)`（GET / PUT）、`handlePdfSave(settingsFile, req, res)`（POST）

- [ ] **Step 1: 失敗するテストを書く**（`viewer/tests/pdf-api.test.js`）

```js
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { Writable } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { handlePdfSave, handlePdfSettings, readPdfSettings, savePdfFile, validatePdfFolder } from '../pdf-api.js';

let dir, out, settingsFile;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pdf-api-'));
  out = path.join(dir, 'out');
  fs.mkdirSync(out);
  settingsFile = path.join(dir, 'pdf-settings.json');
});
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

function fakeRes() {
  const chunks = [];
  const res = new Writable({ write(chunk, _enc, cb) { chunks.push(chunk); cb(); } });
  res.headers = {};
  res.setHeader = (k, v) => { res.headers[k.toLowerCase()] = v; };
  res.json = () => JSON.parse(Buffer.concat(chunks).toString('utf8'));
  res.finished = new Promise((resolve) => res.on('finish', resolve));
  return res;
}
function fakeReq({ method = 'GET', url = '/', headers = {} } = {}) {
  const req = new EventEmitter();
  Object.assign(req, { method, url, headers });
  return req;
}
const PDF = Buffer.from('%PDF-1.4\n...%%EOF\n');
const NOW = new Date(2026, 10, 7, 9, 5, 3);

describe('validatePdfFolder', () => {
  it('存在して書き込めるフォルダは null（問題なし）。試し書きのファイルは残さない', () => {
    expect(validatePdfFolder(out)).toBeNull();
    expect(fs.readdirSync(out)).toEqual([]);
  });
  it('空・相対パスは理由を返す', () => {
    expect(validatePdfFolder('')).toMatch(/入力/);
    expect(validatePdfFolder('records')).toMatch(/完全な場所/);
  });
  it('存在しないフォルダ・ファイルは理由を返す', () => {
    expect(validatePdfFolder(path.join(dir, 'nope'))).toMatch(/見つかりません/);
    fs.writeFileSync(path.join(dir, 'file.txt'), 'x');
    expect(validatePdfFolder(path.join(dir, 'file.txt'))).toMatch(/フォルダではありません/);
  });
});

describe('savePdfFile', () => {
  it('モデル名_日時.pdf で保存する', () => {
    expect(savePdfFile(out, 'PumpA', PDF, NOW)).toBe('PumpA_20261107-090503.pdf');
    expect(fs.readFileSync(path.join(out, 'PumpA_20261107-090503.pdf'))).toEqual(PDF);
  });
  it('同じ秒に2回保存すると _2 を付け、1つ目を上書きしない', () => {
    fs.writeFileSync(path.join(out, 'PumpA_20261107-090503.pdf'), 'first');
    expect(savePdfFile(out, 'PumpA', PDF, NOW)).toBe('PumpA_20261107-090503_2.pdf');
    expect(fs.readFileSync(path.join(out, 'PumpA_20261107-090503.pdf'), 'utf8')).toBe('first');
  });
  it('禁止文字を含むモデル名でも保存できる', () => {
    expect(savePdfFile(out, 'ポンプ/A:改', PDF, NOW)).toBe('ポンプ_A_改_20261107-090503.pdf');
  });
});

describe('handlePdfSettings', () => {
  it('未設定なら folder は空文字', async () => {
    const res = fakeRes();
    handlePdfSettings(settingsFile, fakeReq(), res);
    await res.finished;
    expect(res.json()).toEqual({ folder: '' });
  });
  it('PUT で正しいフォルダを保存する', async () => {
    const res = fakeRes();
    const req = fakeReq({ method: 'PUT' });
    handlePdfSettings(settingsFile, req, res);
    req.emit('data', Buffer.from(JSON.stringify({ folder: ` ${out} ` })));
    req.emit('end');
    await res.finished;
    expect(res.statusCode).toBe(200);
    expect(readPdfSettings(settingsFile)).toEqual({ folder: out });
  });
  it('PUT で不正なフォルダは 400 と理由を返し、設定を変えない', async () => {
    fs.writeFileSync(settingsFile, JSON.stringify({ folder: out }), 'utf8');
    const res = fakeRes();
    const req = fakeReq({ method: 'PUT' });
    handlePdfSettings(settingsFile, req, res);
    req.emit('data', Buffer.from(JSON.stringify({ folder: path.join(dir, 'nope') })));
    req.emit('end');
    await res.finished;
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/見つかりません/);
    expect(readPdfSettings(settingsFile)).toEqual({ folder: out });
  });
});

describe('handlePdfSave', () => {
  async function post(body, url = '/api/pdf?model=PumpA') {
    const res = fakeRes();
    const req = fakeReq({ method: 'POST', url });
    handlePdfSave(settingsFile, req, res);
    req.emit('data', body);
    req.emit('end');
    await res.finished;
    return res;
  }
  it('保存先が未設定なら 409', async () => {
    const res = await post(PDF);
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toMatch(/保存先フォルダが設定されていません/);
  });
  it('PDFでない本文は 400', async () => {
    fs.writeFileSync(settingsFile, JSON.stringify({ folder: out }), 'utf8');
    const res = await post(Buffer.from('<html>'));
    expect(res.statusCode).toBe(400);
    expect(fs.readdirSync(out)).toEqual([]);
  });
  it('正しいPDFを保存してファイル名を返す', async () => {
    fs.writeFileSync(settingsFile, JSON.stringify({ folder: out }), 'utf8');
    const res = await post(PDF, '/api/pdf?model=%E3%83%9D%E3%83%B3%E3%83%97');
    expect(res.statusCode).toBe(200);
    expect(res.json().fileName).toMatch(/^ポンプ_\d{8}-\d{6}\.pdf$/);
    expect(fs.readdirSync(out)).toHaveLength(1);
  });
  it('保存先に書けなくなっていたら 500 と理由を返す', async () => {
    fs.writeFileSync(settingsFile, JSON.stringify({ folder: path.join(dir, 'gone') }), 'utf8');
    const res = await post(PDF);
    expect(res.statusCode).toBe(500);
    expect(res.json().error).toMatch(/保存できませんでした/);
  });
});
```

- [ ] **Step 2: 失敗を確認する**

Run: `cd viewer && npx vitest run tests/pdf-api.test.js`
Expected: FAIL（`Failed to resolve import "../pdf-api.js"`）

- [ ] **Step 3: 実装する**（`viewer/pdf-api.js`）

```js
/** PDF保存API（保存先フォルダの設定と、PDFの書き込み）。
 * 開発サーバー（vite.config.js）と本番配信サーバー（server.js）の両方から使う。
 * 書き込みはサーバーを起動したWindowsユーザーの権限で行う（ネットワークフォルダはその権限が必要） */
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { pdfFileName } from './src/pdf-report.js'

const MAX_PDF_BYTES = 30 * 1024 * 1024
const MAX_SETTINGS_BYTES = 64 * 1024

export function readPdfSettings(settingsFile) {
  try {
    const j = JSON.parse(fs.readFileSync(settingsFile, 'utf8'))
    return { folder: typeof j.folder === 'string' ? j.folder : '' }
  } catch {
    return { folder: '' }
  }
}

/** 保存先として使えるかを確かめる。問題があれば理由（日本語）、なければ null */
export function validatePdfFolder(folder) {
  const f = typeof folder === 'string' ? folder.trim() : ''
  if (!f) return '保存先フォルダを入力してください'
  if (!/^[A-Za-z]:[\\/]/.test(f) && !/^\\\\[^\\]+\\[^\\]+/.test(f)) {
    return '保存先は「C:\\…」や「\\\\サーバー名\\共有名\\…」のような完全な場所で指定してください'
  }
  let st
  try { st = fs.statSync(f) } catch { return `フォルダが見つかりません: ${f}` }
  if (!st.isDirectory()) return `フォルダではありません: ${f}`
  const probe = path.join(f, `.3dviewer-write-test-${crypto.randomBytes(4).toString('hex')}`)
  try {
    fs.writeFileSync(probe, 'test')
    fs.unlinkSync(probe)
  } catch (e) {
    return `このフォルダに書き込めません: ${e.code ?? e.message}`
  }
  return null
}

/** 上書きしない名前で保存し、保存したファイル名を返す */
export function savePdfFile(folder, modelName, bytes, now = new Date()) {
  const base = pdfFileName(modelName, now).replace(/\.pdf$/, '')
  for (let i = 1; i < 1000; i++) {
    const name = i === 1 ? `${base}.pdf` : `${base}_${i}.pdf`
    let fd
    try {
      fd = fs.openSync(path.join(folder, name), 'wx') // 既にあれば EEXIST（上書きしない）
    } catch (e) {
      if (e.code === 'EEXIST') continue
      throw e
    }
    try { fs.writeFileSync(fd, bytes) } finally { fs.closeSync(fd) }
    return name
  }
  throw new Error('同じ名前のファイルが多すぎます')
}

function sendJson(res, status, obj) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(obj))
}

/** 本文をBufferで集める。limitを超えたら tooLarge=true（以後は読み捨てる） */
function readBody(req, limit, done) {
  const chunks = []
  let size = 0
  let tooLarge = false
  req.on('data', (chunk) => {
    const b = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += b.length
    if (size > limit) { tooLarge = true; return }
    chunks.push(b)
  })
  req.on('end', () => done(tooLarge ? null : Buffer.concat(chunks), tooLarge))
}

/** GET/PUT /api/pdf-settings */
export function handlePdfSettings(settingsFile, req, res) {
  if (req.method === 'GET') {
    sendJson(res, 200, readPdfSettings(settingsFile))
    return
  }
  if (req.method !== 'PUT') {
    sendJson(res, 405, { error: 'method not allowed' })
    return
  }
  readBody(req, MAX_SETTINGS_BYTES, (body, tooLarge) => {
    let folder
    try {
      if (tooLarge) throw new Error()
      folder = JSON.parse(body.toString('utf8')).folder
    } catch {
      sendJson(res, 400, { error: '設定の形式が正しくありません' })
      return
    }
    const err = validatePdfFolder(folder)
    if (err) {
      sendJson(res, 400, { error: err })
      return
    }
    const settings = { folder: folder.trim() }
    fs.writeFileSync(settingsFile, JSON.stringify(settings, null, 2), 'utf8')
    sendJson(res, 200, settings)
  })
}

/** POST /api/pdf?model=<名前>（本文はPDF） */
export function handlePdfSave(settingsFile, req, res) {
  if (req.method !== 'POST') {
    sendJson(res, 405, { error: 'method not allowed' })
    return
  }
  const model = new URL(req.url ?? '/', 'http://localhost').searchParams.get('model') ?? ''
  readBody(req, MAX_PDF_BYTES, (body, tooLarge) => {
    const { folder } = readPdfSettings(settingsFile)
    if (!folder) {
      sendJson(res, 409, { error: '保存先フォルダが設定されていません（編集モードの表示設定で設定してください）' })
      return
    }
    if (tooLarge || !body.subarray(0, 5).equals(Buffer.from('%PDF-'))) {
      sendJson(res, 400, { error: 'PDFのデータが正しくありません' })
      return
    }
    try {
      sendJson(res, 200, { fileName: savePdfFile(folder, model, body) })
    } catch (e) {
      sendJson(res, 500, { error: `保存できませんでした: ${e.code ?? e.message}（${folder}）` })
    }
  })
}
```

- [ ] **Step 4: 合格を確認する**

Run: `cd viewer && npx vitest run tests/pdf-api.test.js`
Expected: PASS

- [ ] **Step 5: サーバーにつなぐ**

`viewer/server.js`：import に `import { handlePdfSave, handlePdfSettings } from './pdf-api.js'` を足す。`const MODELS_DIR = …` の下に `const PDF_SETTINGS = path.join(ROOT, 'pdf-settings.json')` を足す。`createServer` の分岐の `/api/models` の次に、次を追加する。

```js
  } else if (urlPath === '/api/pdf-settings') {
    handlePdfSettings(PDF_SETTINGS, req, res)
  } else if (urlPath === '/api/pdf') {
    handlePdfSave(PDF_SETTINGS, req, res)
```

ファイル先頭のコメントにある、提供APIの一覧に「/api/pdf-settings・/api/pdf のPDF保存API」を書き足す。

`viewer/vite.config.js`：import に `import { handlePdfSave, handlePdfSettings } from './pdf-api.js'` を足す。`MODELS_DIR` の下に `const PDF_SETTINGS = process.env.VIEWER_PDF_SETTINGS || path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'pdf-settings.json')` を足す。`configureServer` の中、`/api/models` の前に追加する。

```js
      server.middlewares.use('/api/pdf-settings', (req, res) => {
        handlePdfSettings(PDF_SETTINGS, req, res)
      })
      server.middlewares.use('/api/pdf', (req, res) => {
        handlePdfSave(PDF_SETTINGS, req, res)
      })
```

`.gitignore` の `viewer/models/` の下に `viewer/pdf-settings.json` を足す。

- [ ] **Step 6: 全テストを通す**

Run: `cd viewer && npx vitest run`
Expected: すべて PASS

---

### Task 3: 画面（ボタン・メモ窓・保存先設定・ページの組み立て）

**Files:**
- Create: `viewer/src/pdf-compose.js`
- Modify: `viewer/src/viewer.js`（`renderForCapture` を export）、`viewer/index.html`、`viewer/src/ui.js`（`applyMode`）、`viewer/src/main.js`、`viewer/src/style.css`

**Interfaces:**
- Consumes: `buildImagePdf`、`formatReportDate`、`wrapText`（Task 1）。API：`GET/PUT /api/pdf-settings`、`POST /api/pdf?model=`（Task 2）
- Produces: `renderForCapture(): HTMLCanvasElement`（viewer.js）、`composeReportCanvas({ viewCanvas, modelName, date, labels, annotationTexts, memo }): HTMLCanvasElement`（pdf-compose.js）

このタスクは画面の描画なので、単体テストは置かない。Task 4 の実機確認で、生成したPDFを開いて確かめる。

- [ ] **Step 1: viewer.js に撮影用の関数を足す**（`getRenderer` の上）

```js
/** PDF用に、精密版・通常解像度で今の視点を描き、描いた直後のcanvasを返す。
 * WebGLの描画結果は次の描画で消えるため、呼び出し側は同じ処理の中ですぐ drawImage すること */
export function renderForCapture() {
  applyInteractionQuality(false); // 操作中の軽量版・低解像度を解除する
  lodTracker.reset();
  frameCallbacks.forEach((fn) => fn());
  renderer.render(scene, camera);
  return renderer.domElement;
}
```

- [ ] **Step 2: pdf-compose.js を作る**

```js
/** PDF1ページ分（A4横・150dpi相当）をcanvasに組み立てる（ブラウザ専用） */
import { formatReportDate, wrapText } from './pdf-report.js';

const PAGE_W = 1754;
const PAGE_H = 1240;
const M = 60; // 余白
const FONT = "'Meiryo', 'メイリオ', sans-serif";
const LIST_H = 300; // 下部（注釈一覧・メモ）の高さ

/**
 * @param {{ viewCanvas: HTMLCanvasElement, modelName: string, date: Date,
 *   labels: {n: number, text: string, x: number, y: number}[],  // viewCanvasの画素座標
 *   annotationTexts: string[], memo: string }} p
 */
export function composeReportCanvas({ viewCanvas, modelName, date, labels, annotationTexts, memo }) {
  const c = document.createElement('canvas');
  c.width = PAGE_W;
  c.height = PAGE_H;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, PAGE_W, PAGE_H);
  ctx.textBaseline = 'top';

  // 見出し：モデル名と日時
  ctx.fillStyle = '#111111';
  ctx.font = `bold 40px ${FONT}`;
  ctx.fillText(wrapText(ctx, modelName || '（名称なし）', PAGE_W - 2 * M - 420, 1)[0] ?? '', M, M);
  ctx.font = `28px ${FONT}`;
  ctx.textAlign = 'right';
  ctx.fillText(formatReportDate(date), PAGE_W - M, M + 8);
  ctx.textAlign = 'left';

  // 3D画面（縦横比を保って枠に収める）
  const area = { x: M, y: M + 70, w: PAGE_W - 2 * M, h: PAGE_H - M - LIST_H - (M + 70) };
  const scale = Math.min(area.w / viewCanvas.width, area.h / viewCanvas.height);
  const dw = viewCanvas.width * scale;
  const dh = viewCanvas.height * scale;
  const dx = area.x + (area.w - dw) / 2;
  const dy = area.y + (area.h - dh) / 2;
  ctx.fillStyle = '#f2f2f2';
  ctx.fillRect(area.x, area.y, area.w, area.h);
  ctx.drawImage(viewCanvas, dx, dy, dw, dh);
  ctx.strokeStyle = '#999999';
  ctx.lineWidth = 2;
  ctx.strokeRect(area.x, area.y, area.w, area.h);

  // 注釈ラベル（番号の丸と文字）
  ctx.font = `bold 20px ${FONT}`;
  labels.forEach((l) => {
    const x = dx + l.x * scale;
    const y = dy + l.y * scale;
    if (x < dx || x > dx + dw || y < dy || y > dy + dh) return;
    ctx.fillStyle = '#e53935';
    ctx.beginPath();
    ctx.arc(x, y, 16, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(l.n), x, y + 1);
    ctx.textAlign = 'left';
    const t = wrapText(ctx, l.text, 360, 1)[0] ?? '';
    const tw = ctx.measureText(t).width;
    ctx.fillStyle = 'rgba(255,255,255,0.88)';
    ctx.fillRect(x + 22, y - 16, tw + 16, 32);
    ctx.fillStyle = '#111111';
    ctx.fillText(t, x + 30, y + 1);
    ctx.textBaseline = 'top';
  });

  // 下部：注釈一覧（左）とメモ（右）
  const listTop = PAGE_H - M - LIST_H + 20;
  const colW = (PAGE_W - 2 * M - 40) / 2;
  ctx.fillStyle = '#111111';
  ctx.font = `bold 26px ${FONT}`;
  ctx.fillText('注釈', M, listTop);
  ctx.fillText('メモ', M + colW + 40, listTop);
  ctx.font = `22px ${FONT}`;
  const MAX_ITEMS = 8;
  const items = annotationTexts.slice(0, MAX_ITEMS).map((t, i) => wrapText(ctx, `${i + 1}. ${t}`, colW, 1)[0] ?? '');
  if (annotationTexts.length > MAX_ITEMS) items.push(`ほか ${annotationTexts.length - MAX_ITEMS} 件`);
  if (annotationTexts.length === 0) items.push('（なし）');
  items.forEach((t, i) => ctx.fillText(t, M, listTop + 40 + i * 30));
  const memoLines = wrapText(ctx, memo, colW, 6);
  (memoLines.length ? memoLines : ['（なし）']).forEach((t, i) => ctx.fillText(t, M + colW + 40, listTop + 40 + i * 30));
  return c;
}
```

- [ ] **Step 3: index.html にボタン・設定・窓を足す**

`<button id="bookmark-list-btn">ビュー一覧</button>` の下に追加する。

```html
          <button id="pdf-btn">PDF保存</button>
```

「表示設定」の `<div class="font-settings">` の直前に追加する。

```html
        <div class="pdf-folder-setting hidden" id="pdf-folder-setting">
          <label for="pdf-folder">PDF保存先（例: \\fileserver\share\3D記録）</label>
          <input type="text" id="pdf-folder" />
          <button id="pdf-folder-save">設定</button>
        </div>
```

`label-dialog` の `</div>` の下に追加する。

```html
    <!-- PDF保存のメモ入力ダイアログ（中央） -->
    <div id="pdf-dialog" class="hidden" role="dialog" aria-modal="true" aria-labelledby="pdf-dialog-title">
      <p id="pdf-dialog-title">PDFを保存（メモは空欄でも可）</p>
      <textarea id="pdf-memo" rows="5" maxlength="500" placeholder="メモ（任意）"></textarea>
      <div class="dialog-actions">
        <button id="pdf-confirm">保存</button>
        <button id="pdf-cancel">キャンセル</button>
      </div>
    </div>
```

- [ ] **Step 4: style.css で既存の窓と同じ見た目にする**

`viewer/src/style.css` の次のセレクタに、PDF用のセレクタをカンマで足す（スマホ幅の `@media` 内も同様）。
- `#label-dialog` → `#label-dialog, #pdf-dialog`
- `#label-dialog-title` → `#label-dialog-title, #pdf-dialog-title`
- `#label-textarea`（2か所とも。`:focus` も含む）→ `#label-textarea, #pdf-memo`
- `#label-confirm`（`:hover`・`:active`・`:focus-visible` を含む）→ `#pdf-confirm` も足す
- `#label-cancel`（同上）→ `#pdf-cancel` も足す

ファイル末尾に追加する。

```css
.pdf-folder-setting {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 8px;
}
.pdf-folder-setting.hidden { display: none; }
.pdf-folder-setting input {
  font: inherit;
  padding: 6px 8px;
}
```

- [ ] **Step 5: 編集モードだけ保存先の設定を出す**（`viewer/src/ui.js` の `applyMode`）

`const upAxisGroup = …` の下に `const pdfFolderSetting = document.getElementById('pdf-folder-setting');` を足す。edit 側に `pdfFolderSetting.classList.remove('hidden');`、view 側に `pdfFolderSetting.classList.add('hidden');` を足す。

- [ ] **Step 6: main.js に処理を足す**

import を変える。viewer.js からの import に `renderForCapture, toScreenPosition` を足す（既に `toScreenPosition` があれば重複させない）。次の2行を足す。

```js
import { buildImagePdf } from './pdf-report.js';
import { composeReportCanvas } from './pdf-compose.js';
```

モードトグルの処理（`applyMode(mode); refreshInfoCards();` の下）に `if (mode === 'edit') refreshPdfFolder();` を足す。

「保存ボタン」の節の前に、次の節を追加する。

```js
// ─── PDF保存 ──────────────────────────────────────────────────

const pdfBtn = document.getElementById('pdf-btn');
const pdfDialog = document.getElementById('pdf-dialog');
const pdfMemo = document.getElementById('pdf-memo');
const pdfFolderInput = document.getElementById('pdf-folder');

async function refreshPdfFolder() {
  try {
    const res = await fetch('/api/pdf-settings');
    if (res.ok) pdfFolderInput.value = (await res.json()).folder ?? '';
  } catch { /* 取得できなくても入力欄が空のままになるだけ */ }
}

document.getElementById('pdf-folder-save').addEventListener('click', async () => {
  try {
    const res = await fetch('/api/pdf-settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ folder: pdfFolderInput.value }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error ?? `設定できませんでした（${res.status}）`);
    pdfFolderInput.value = body.folder;
    showMessage(`PDF保存先を設定しました：${body.folder}`, 5000);
  } catch (e) {
    showMessage(e instanceof TypeError ? 'サーバーに接続できませんでした' : e.message, 8000);
  }
});

pdfBtn.addEventListener('click', () => {
  if (!modelLoaded) { showMessage('先にモデルを開いてください'); return; }
  pdfMemo.value = '';
  pdfDialog.classList.remove('hidden');
  pdfMemo.focus();
});

document.getElementById('pdf-cancel').addEventListener('click', () => {
  pdfDialog.classList.add('hidden');
});

document.getElementById('pdf-confirm').addEventListener('click', async () => {
  pdfDialog.classList.add('hidden');
  pdfBtn.disabled = true;
  try {
    const name = serverModelName ?? modelFileName.replace(/\.glb$/i, '');
    const date = new Date();
    const raw = getAnnotationsRaw();
    // 描画直後でないとWebGLの画面が読めないため、撮影からページ組み立てまでを続けて行う
    const view = renderForCapture();
    const ratio = view.width / view.clientWidth;
    const labels = labelsOn
      ? raw.map((a, i) => {
        const s = toScreenPosition(annotationWorldPoint(a));
        return s.behindCamera ? null : { n: i + 1, text: a.label, x: s.x * ratio, y: s.y * ratio };
      }).filter(Boolean)
      : [];
    const page = composeReportCanvas({
      viewCanvas: view, modelName: name, date, labels,
      annotationTexts: raw.map((a) => a.label), memo: pdfMemo.value.slice(0, 500),
    });
    const jpeg = await new Promise((resolve) => page.toBlob(resolve, 'image/jpeg', 0.85));
    const pdf = buildImagePdf(new Uint8Array(await jpeg.arrayBuffer()), page.width, page.height);
    const res = await fetch(`/api/pdf?model=${encodeURIComponent(name)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/pdf' },
      body: pdf,
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error ?? `保存できませんでした（${res.status}）`);
    showMessage(`PDFを保存しました：${body.fileName}`, 6000);
  } catch (e) {
    showMessage(e instanceof TypeError ? 'サーバーに接続できませんでした' : e.message, 8000);
  } finally {
    pdfBtn.disabled = false;
  }
});
```

（`labelsOn` は main.js の後半で `let` 宣言されているが、参照するのはクリック時なので問題ない。部品が隠れている注釈は、`annotations.js` の表示判定と同じく描かないのが望ましい。描くかどうかは、実機確認でラベルの表示と見比べて決める）

- [ ] **Step 7: 全テストを通す**

Run: `cd viewer && npx vitest run`
Expected: すべて PASS

---

### Task 4: 実機確認

- [ ] **Step 1: 確認用サーバーを用意する**

scratchpad に `models`（`Verify.glb` と注釈JSON）と `pdf-out` フォルダを作る。`verify.vite.config.mjs` は、`root` を viewer にして、models を scratchpad に向ける。そのうえで、環境変数 `VIEWER_PDF_SETTINGS=<scratchpad>/pdf-settings.json` で起動する。launch.json への一時的な項目追加は、ユーザーの許可を得てから行う（終わったら消す）。

- [ ] **Step 2: 動きを確かめる**

1. 保存先が未設定のまま「PDF保存」→「保存」を押すと、「保存先フォルダが設定されていません…」と表示される
2. 編集モードで、保存先に相対パスを入れると理由が表示される。scratchpad の `pdf-out` を入れると「設定しました」と表示される。閲覧モードでは設定欄が隠れる
3. メモに日本語を入れて保存すると、`pdf-out` に `Verify_YYYYMMDD-HHmmss.pdf` ができる
4. できたPDFを Read で開き、見出し・3D画面（精密版）・ラベル・注釈一覧・メモが読めることを目で確かめる。画像はユーザーにも見せる
5. ドラッグ中（軽量版の表示中）に保存ボタンを押しても、精密版が写る

- [ ] **Step 3: ユーザーに確かめてもらうこと**

- 実際のネットワークフォルダ（`\\…`）を保存先に設定して保存できるか（本番に反映したあと）
- タッチパネルでメモ欄に触れたとき、画面上キーボードが出るか

- [ ] **Step 4: 報告する**

本番への反映（`npm run build`）とコミットの可否を聞く。launch.json の一時的な項目を消す。
