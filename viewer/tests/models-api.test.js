import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { Writable } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { isSafeFileName, listModels, handleModelFile } from '../models-api.js';

let dir;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'models-api-'));
  fs.writeFileSync(path.join(dir, 'CarA.glb'), Buffer.from('glTFdummy'));
  fs.writeFileSync(path.join(dir, 'CarA_annotations.json'), '{"version":2}');
  fs.writeFileSync(path.join(dir, 'CarB.glb'), Buffer.from('x'));
});
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

/** 書き込み内容とヘッダを記録するフェイクレスポンス */
function fakeRes() {
  const chunks = [];
  const res = new Writable({
    write(chunk, _enc, cb) { chunks.push(chunk); cb(); },
  });
  res.headers = {};
  res.setHeader = (k, v) => { res.headers[k.toLowerCase()] = v; };
  res.body = () => Buffer.concat(chunks).toString('utf8');
  res.finished = new Promise((resolve) => res.on('finish', resolve));
  return res;
}

function fakeReq({ method = 'GET', headers = {} } = {}) {
  const req = new EventEmitter();
  req.method = method;
  req.headers = headers;
  return req;
}

describe('isSafeFileName', () => {
  it('通常のglb/jsonファイル名を許可する', () => {
    expect(isSafeFileName('CarA.glb')).toBe(true);
    expect(isSafeFileName('CarA_annotations.json')).toBe(true);
  });
  it('パス区切りや親参照を拒否する', () => {
    expect(isSafeFileName('../secret.json')).toBe(false);
    expect(isSafeFileName('a/b.glb')).toBe(false);
    expect(isSafeFileName('a\\b.glb')).toBe(false);
    expect(isSafeFileName('run.exe')).toBe(false);
  });
});

describe('listModels', () => {
  it('GLB一覧と注釈の有無を返す', () => {
    const list = listModels(dir);
    expect(list.map((m) => m.name).sort()).toEqual(['CarA', 'CarB']);
    expect(list.find((m) => m.name === 'CarA').hasAnnotations).toBe(true);
    expect(list.find((m) => m.name === 'CarB').hasAnnotations).toBe(false);
  });
  it('フォルダが無ければ空一覧を返す', () => {
    expect(listModels(path.join(dir, 'nope'))).toEqual([]);
  });

  it('LOD(軽量表示)用の_lod.glbはギャラリー一覧に出さない', () => {
    fs.writeFileSync(path.join(dir, 'CarA_lod.glb'), Buffer.from('lodDummy'));
    const list = listModels(dir);
    expect(list.map((m) => m.name).sort()).toEqual(['CarA', 'CarB']);
  });

  it('中間版の_mid.glbもギャラリー一覧に出さない', () => {
    fs.writeFileSync(path.join(dir, 'CarA_mid.glb'), Buffer.from('midDummy'));
    const list = listModels(dir);
    expect(list.map((m) => m.name).sort()).toEqual(['CarA', 'CarB']);
  });
});

describe('handleModelFile GET', () => {
  it('ファイルをETag付きで返す', async () => {
    const res = fakeRes();
    handleModelFile(dir, 'CarA.glb', fakeReq(), res);
    await res.finished;
    expect(res.body()).toBe('glTFdummy');
    expect(res.headers.etag).toBeTruthy();
    expect(res.headers['content-type']).toContain('model/gltf-binary');
  });

  it('If-None-MatchがETagと一致すれば304を返す', async () => {
    const res1 = fakeRes();
    handleModelFile(dir, 'CarA.glb', fakeReq(), res1);
    await res1.finished;
    const res2 = fakeRes();
    handleModelFile(dir, 'CarA.glb', fakeReq({ headers: { 'if-none-match': res1.headers.etag } }), res2);
    expect(res2.statusCode).toBe(304);
  });

  it('存在しないファイルは404', () => {
    const res = fakeRes();
    handleModelFile(dir, 'missing.glb', fakeReq(), res);
    expect(res.statusCode).toBe(404);
  });

  it('不正なファイル名は400', () => {
    const res = fakeRes();
    handleModelFile(dir, '../etc.json', fakeReq(), res);
    expect(res.statusCode).toBe(400);
  });
});

describe('handleModelFile PUT', () => {
  it('注釈JSONを保存できる', async () => {
    const res = fakeRes();
    const req = fakeReq({ method: 'PUT' });
    handleModelFile(dir, 'CarB_annotations.json', req, res);
    req.emit('data', '{"version":2,"annotations":[]}');
    req.emit('end');
    await res.finished;
    expect(fs.readFileSync(path.join(dir, 'CarB_annotations.json'), 'utf8')).toContain('"version"');
  });

  it('glbへのPUTは403で拒否する', () => {
    const res = fakeRes();
    handleModelFile(dir, 'CarA.glb', fakeReq({ method: 'PUT' }), res);
    expect(res.statusCode).toBe(403);
  });

  it('不正なJSONは400で拒否し既存ファイルを壊さない', async () => {
    const res = fakeRes();
    const req = fakeReq({ method: 'PUT' });
    handleModelFile(dir, 'CarA_annotations.json', req, res);
    req.emit('data', '{{broken');
    req.emit('end');
    await res.finished;
    expect(res.statusCode).toBe(400);
    expect(fs.readFileSync(path.join(dir, 'CarA_annotations.json'), 'utf8')).toBe('{"version":2}');
  });
});
