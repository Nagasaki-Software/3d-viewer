import { describe, expect, it } from 'vitest';
import { FONT_LIMITS, loadFontSizes, normalizeFontSizes, saveFontSizes } from '../src/fontsize.js';

function fakeStorage(initial = {}) {
  const store = { ...initial };
  return {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    dump: () => store,
  };
}

describe('normalizeFontSizes', () => {
  it('空入力は既定値になる', () => {
    const s = normalizeFontSizes({});
    expect(s.annotation).toBe(FONT_LIMITS.annotation.def);
    expect(s.title).toBe(FONT_LIMITS.title.def);
    expect(s.specs).toBe(FONT_LIMITS.specs.def);
  });

  it('範囲外はクランプされる', () => {
    const s = normalizeFontSizes({ annotation: 999, title: 1, specs: 16 });
    expect(s.annotation).toBe(FONT_LIMITS.annotation.max);
    expect(s.title).toBe(FONT_LIMITS.title.min);
    expect(s.specs).toBe(16);
  });

  it('数値でない値は既定値になる', () => {
    const s = normalizeFontSizes({ annotation: 'abc', title: null });
    expect(s.annotation).toBe(FONT_LIMITS.annotation.def);
    expect(s.title).toBe(FONT_LIMITS.title.def);
  });
});

describe('loadFontSizes / saveFontSizes', () => {
  it('保存した値を読み戻せる', () => {
    const storage = fakeStorage();
    saveFontSizes({ annotation: 20, title: 30, specs: 10 }, storage);
    expect(loadFontSizes(storage)).toEqual({ annotation: 20, title: 30, specs: 10 });
  });

  it('壊れたJSONは既定値になる', () => {
    const storage = fakeStorage({ 'viewer-font-sizes': '{{broken' });
    const s = loadFontSizes(storage);
    expect(s.annotation).toBe(FONT_LIMITS.annotation.def);
  });

  it('未保存の場合は既定値になる', () => {
    const s = loadFontSizes(fakeStorage());
    expect(s.title).toBe(FONT_LIMITS.title.def);
  });
});
