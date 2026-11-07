import { describe, expect, it } from 'vitest';
import { modelPaths, sanitizeModelName } from '../src/modelsource.js';

describe('sanitizeModelName', () => {
  it('通常の名前はそのまま通す（日本語も可）', () => {
    expect(sanitizeModelName('SampleCar')).toBe('SampleCar');
    expect(sanitizeModelName('搬送ロボット A-100')).toBe('搬送ロボット A-100');
  });

  it('.glb拡張子は取り除く', () => {
    expect(sanitizeModelName('model.glb')).toBe('model');
    expect(sanitizeModelName('model.GLB')).toBe('model');
  });

  it('パス区切りや .. を含む名前は拒否する', () => {
    expect(sanitizeModelName('../secret')).toBeNull();
    expect(sanitizeModelName('a/b')).toBeNull();
    expect(sanitizeModelName('a\\b')).toBeNull();
    expect(sanitizeModelName('..')).toBeNull();
  });

  it('空・文字列以外は拒否する', () => {
    expect(sanitizeModelName('')).toBeNull();
    expect(sanitizeModelName('   ')).toBeNull();
    expect(sanitizeModelName(null)).toBeNull();
    expect(sanitizeModelName(undefined)).toBeNull();
  });
});

describe('modelPaths', () => {
  it('glbと注釈JSONのパスを返す', () => {
    const p = modelPaths('SampleCar');
    expect(p.glb).toBe('/models/SampleCar.glb');
    expect(p.json).toBe('/models/SampleCar_annotations.json');
  });

  it('スペースや日本語をURLエンコードする', () => {
    const p = modelPaths('搬送ロボット A-100');
    expect(p.glb).toContain('%20');
    expect(p.glb).not.toContain(' ');
    expect(decodeURIComponent(p.glb)).toBe('/models/搬送ロボット A-100.glb');
  });

  it('LOD(軽量表示)用GLBのパスを返す', () => {
    expect(modelPaths('robot').lod).toBe('/models/robot_lod.glb');
    expect(modelPaths('robot').mid).toBe('/models/robot_mid.glb');
  });
});
