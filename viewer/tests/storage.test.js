import { describe, expect, it } from 'vitest';
import { buildProjectJSON, parseProjectJSON } from '../src/storage.js';

const v1json = JSON.stringify({
  modelFile: 'a.glb',
  annotations: [{ id: '1', label: 'L1', position: { x: 1, y: 2, z: 3 } }],
});

describe('parseProjectJSON', () => {
  it('v1を読み込むと partName:null の v2 になる', () => {
    const p = parseProjectJSON(v1json);
    expect(p.version).toBe(2);
    expect(p.annotations).toHaveLength(1);
    expect(p.annotations[0].partName).toBeNull();
    expect(p.annotations[0].position).toEqual({ x: 1, y: 2, z: 3 });
    expect(p.bookmarks).toEqual([]);
  });

  it('v2はそのまま読み込める（round-trip）', () => {
    const json = buildProjectJSON('m.glb',
      [{ id: 'a', label: 'ラベル', partName: 'P/Q', position: { x: 0.12345, y: 0, z: 0 } }],
      [{ id: 'b', name: 'view1', camera: { position: { x: 1, y: 1, z: 1 }, target: { x: 0, y: 0, z: 0 } }, hiddenParts: ['P/Q'], background: 'light' }]);
    const p = parseProjectJSON(json);
    expect(p.annotations[0].partName).toBe('P/Q');
    expect(p.bookmarks[0].name).toBe('view1');
    expect(p.bookmarks[0].hiddenParts).toEqual(['P/Q']);
    expect(p.bookmarks[0].background).toBe('light');
  });

  it('不正JSONは日本語メッセージで throw する', () => {
    expect(() => parseProjectJSON('{{')).toThrow(/JSON/);
  });

  it('annotations も bookmarks も無いJSONは throw する', () => {
    expect(() => parseProjectJSON('{"foo":1}')).toThrow();
  });

  it('数値でない座標は 0 に補正される', () => {
    const p = parseProjectJSON(JSON.stringify({
      version: 2, annotations: [{ id: '1', label: 'x', position: { x: 'bad' } }], bookmarks: [],
    }));
    expect(p.annotations[0].position).toEqual({ x: 0, y: 0, z: 0 });
  });
});

describe('meta', () => {
  it('metaが無いJSONは title:null / specs:"" / upAxis:null / edgesVisible:false になる', () => {
    const p = parseProjectJSON(v1json);
    expect(p.meta).toEqual({ title: null, specs: '', upAxis: null, edgesVisible: false });
  });

  it('metaはround-tripする', () => {
    const json = buildProjectJSON('m.glb', [], [], { title: '搬送ロボット A-100', specs: '寸法: 1200x800mm\n重量: 350kg' });
    const p = parseProjectJSON(json);
    expect(p.meta.title).toBe('搬送ロボット A-100');
    expect(p.meta.specs).toContain('350kg');
  });

  it('upAxisはround-tripする', () => {
    const json = buildProjectJSON('m.glb', [], [], { title: null, specs: '', upAxis: { axis: 'z', sign: -1 } });
    const p = parseProjectJSON(json);
    expect(p.meta.upAxis).toEqual({ axis: 'z', sign: -1 });
  });

  it('不正なupAxisはnullになる', () => {
    const p = parseProjectJSON(JSON.stringify({
      version: 2, annotations: [], bookmarks: [], meta: { upAxis: { axis: 'w', sign: 1 } },
    }));
    expect(p.meta.upAxis).toBeNull();
  });

  it('edgesVisibleはround-tripする', () => {
    const json = buildProjectJSON('m.glb', [], [], { title: null, specs: '', upAxis: null, edgesVisible: true });
    const p = parseProjectJSON(json);
    expect(p.meta.edgesVisible).toBe(true);
  });

  it('edgesVisibleが真偽値でなければfalseになる', () => {
    const p = parseProjectJSON(JSON.stringify({
      version: 2, annotations: [], bookmarks: [], meta: { edgesVisible: 'yes' },
    }));
    expect(p.meta.edgesVisible).toBe(false);
  });
});
