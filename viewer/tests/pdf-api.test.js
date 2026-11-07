import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { Writable } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { handlePdfSave, handlePdfSettings, isAbsoluteFolderPath, readPdfSettings, savePdfFile, validatePdfFolder, withTimeout } from '../pdf-api.js';

describe('isAbsoluteFolderPath', () => {
  it('ドライブ指定とUNCパスを受け付ける', () => {
    expect(isAbsoluteFolderPath('C:\\records')).toBe(true);
    expect(isAbsoluteFolderPath('D:/records')).toBe(true);
    expect(isAbsoluteFolderPath('\\\\fileserver\\share')).toBe(true);
    expect(isAbsoluteFolderPath('\\\\fileserver\\share\\3D記録')).toBe(true);
  });
  it('相対パス・共有名の無いUNC・ドライブ相対は受け付けない', () => {
    expect(isAbsoluteFolderPath('records')).toBe(false);
    expect(isAbsoluteFolderPath('\\\\fileserver')).toBe(false);
    expect(isAbsoluteFolderPath('C:records')).toBe(false);
  });
});

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
  it('存在して書き込めるフォルダは null（問題なし）。試し書きのファイルは残さない', async () => {
    expect(await validatePdfFolder(out)).toBeNull();
    expect(fs.readdirSync(out)).toEqual([]);
  });
  it('空・相対パスは理由を返す', async () => {
    expect(await validatePdfFolder('')).toMatch(/入力/);
    expect(await validatePdfFolder('records')).toMatch(/完全な場所/);
  });
  it('存在しないフォルダ・ファイルは理由を返す', async () => {
    expect(await validatePdfFolder(path.join(dir, 'nope'))).toMatch(/見つかりません/);
    fs.writeFileSync(path.join(dir, 'file.txt'), 'x');
    expect(await validatePdfFolder(path.join(dir, 'file.txt'))).toMatch(/フォルダではありません/);
  });
});

describe('savePdfFile', () => {
  it('モデル名_日時.pdf で保存する', async () => {
    expect(await savePdfFile(out, 'PumpA', PDF, NOW)).toBe('PumpA_20261107-090503.pdf');
    expect(fs.readFileSync(path.join(out, 'PumpA_20261107-090503.pdf'))).toEqual(PDF);
  });
  it('同じ秒に2回保存すると _2 を付け、1つ目を上書きしない', async () => {
    fs.writeFileSync(path.join(out, 'PumpA_20261107-090503.pdf'), 'first');
    expect(await savePdfFile(out, 'PumpA', PDF, NOW)).toBe('PumpA_20261107-090503_2.pdf');
    expect(fs.readFileSync(path.join(out, 'PumpA_20261107-090503.pdf'), 'utf8')).toBe('first');
  });
  it('禁止文字を含むモデル名でも保存できる', async () => {
    expect(await savePdfFile(out, 'ポンプ/A:改', PDF, NOW)).toBe('ポンプ_A_改_20261107-090503.pdf');
  });
  it('書き込みの途中で失敗したら、作りかけのファイルを残さない', async () => {
    await expect(savePdfFile(out, 'PumpA', 12345, NOW)).rejects.toThrow();
    expect(fs.readdirSync(out)).toEqual([]);
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

describe('withTimeout', () => {
  it('時間内に終われば結果を返す', async () => {
    expect(await withTimeout(Promise.resolve(1), 50, '遅い')).toBe(1);
  });
  it('応答の無い処理は時間切れのエラーにする（ネットワークフォルダが応答しない場合）', async () => {
    await expect(withTimeout(new Promise(() => {}), 20, '保存先に接続できません')).rejects.toThrow('保存先に接続できません');
  });
});

describe('handlePdfSettings（設定ファイルが書けない）', () => {
  it('設定ファイルが書けなくてもサーバーを落とさず 500 と理由を返す', async () => {
    const res = fakeRes();
    const req = fakeReq({ method: 'PUT' });
    handlePdfSettings(out, req, res); // 設定ファイルの場所がフォルダ → 書き込みに失敗する
    req.emit('data', Buffer.from(JSON.stringify({ folder: out })));
    req.emit('end');
    await res.finished;
    expect(res.statusCode).toBe(500);
    expect(res.json().error).toMatch(/設定を保存できませんでした/);
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
