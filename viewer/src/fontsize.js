/** フォントサイズ設定: 範囲チェックとlocalStorage永続化 */

export const FONT_LIMITS = {
  annotation: { min: 10, max: 32, def: 14 },
  title: { min: 12, max: 40, def: 18 },
  specs: { min: 8, max: 24, def: 12 },
};

const STORAGE_KEY = 'viewer-font-sizes';

/** 欠損・不正・範囲外の値を既定値/クランプで正規化する */
export function normalizeFontSizes(raw) {
  const out = {};
  for (const [key, { min, max, def }] of Object.entries(FONT_LIMITS)) {
    const rawValue = raw?.[key];
    // Number(null) は 0 になってしまうため、値なしは明示的に既定値へ
    const v = rawValue == null ? NaN : Number(rawValue);
    out[key] = Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : def;
  }
  return out;
}

export function loadFontSizes(storage = localStorage) {
  try {
    return normalizeFontSizes(JSON.parse(storage.getItem(STORAGE_KEY) ?? '{}'));
  } catch {
    return normalizeFontSizes({});
  }
}

export function saveFontSizes(sizes, storage = localStorage) {
  storage.setItem(STORAGE_KEY, JSON.stringify(sizes));
}

/** CSS変数へ反映する（style.css側が var(--font-*) を参照する） */
export function applyFontSizes(sizes) {
  const root = document.documentElement.style;
  root.setProperty('--font-annotation', `${sizes.annotation}px`);
  root.setProperty('--font-title', `${sizes.title}px`);
  root.setProperty('--font-specs', `${sizes.specs}px`);
}
