/** プロジェクトJSON（注釈+ブックマーク）のパース/ビルド。v1互換読み込み対応 */

function num(v) { return Number.isFinite(Number(v)) ? Number(v) : 0; }
function vec(p) { return { x: num(p?.x), y: num(p?.y), z: num(p?.z) }; }

function normAnnotation(a, i) {
  return {
    id: String(a.id ?? crypto.randomUUID()),
    label: String(a.label ?? `ラベル ${i + 1}`),
    partName: a.partName != null ? String(a.partName) : null,
    position: vec(a.position),
  };
}

function normBookmark(b, i) {
  return {
    id: String(b.id ?? crypto.randomUUID()),
    name: String(b.name ?? `ビュー ${i + 1}`),
    camera: { position: vec(b.camera?.position), target: vec(b.camera?.target) },
    hiddenParts: Array.isArray(b.hiddenParts) ? b.hiddenParts.map(String) : [],
    background: b.background === 'light' ? 'light' : 'dark',
  };
}

const UP_AXES = ['x', 'y', 'z'];

function normUpAxis(u) {
  if (!u || !UP_AXES.includes(u.axis) || (u.sign !== 1 && u.sign !== -1)) return null;
  return { axis: u.axis, sign: u.sign };
}

function normMeta(m) {
  return {
    title: m?.title != null ? String(m.title) : null,
    specs: m?.specs != null ? String(m.specs) : '',
    upAxis: normUpAxis(m?.upAxis),
    edgesVisible: m?.edgesVisible === true,
  };
}

/**
 * プロジェクトJSONテキストをパースする。v1（annotationsのみ・versionフィールドなし）は
 * partName:null の v2 形式に移行して返す。
 * @param {string} text
 * @returns {{ version: 2, modelFile: string, annotations: object[], bookmarks: object[] }}
 * @throws {Error} JSONが不正またはフォーマット違い
 */
export function parseProjectJSON(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('JSON の解析に失敗しました');
  }
  const hasAnn = Array.isArray(data?.annotations);
  const hasBm = Array.isArray(data?.bookmarks);
  if (!hasAnn && !hasBm) {
    throw new Error('annotations / bookmarks フィールドが見つかりません');
  }
  return {
    version: 2,
    modelFile: String(data.modelFile ?? ''),
    annotations: (hasAnn ? data.annotations : []).map(normAnnotation),
    bookmarks: (hasBm ? data.bookmarks : []).map(normBookmark),
    meta: normMeta(data.meta),
  };
}

/**
 * 注釈・ブックマークを v2 プロジェクトJSON文字列にビルドする
 * @param {string} modelFile
 * @param {object[]} annotations
 * @param {object[]} bookmarks
 * @param {{ title: ?string, specs: string, upAxis: ?{axis: string, sign: number}, edgesVisible: boolean }} meta
 * @returns {string}
 */
export function buildProjectJSON(modelFile, annotations, bookmarks, meta = { title: null, specs: '', upAxis: null, edgesVisible: false }) {
  const r4 = (v) => parseFloat(num(v).toFixed(4));
  const rvec = (p) => ({ x: r4(p?.x), y: r4(p?.y), z: r4(p?.z) });
  return JSON.stringify({
    version: 2,
    modelFile,
    annotations: annotations.map((a) => ({
      id: a.id, label: a.label, partName: a.partName ?? null, position: rvec(a.position),
    })),
    bookmarks: bookmarks.map((b) => ({
      id: b.id, name: b.name,
      camera: { position: rvec(b.camera.position), target: rvec(b.camera.target) },
      hiddenParts: b.hiddenParts, background: b.background,
    })),
    meta: { title: meta.title, specs: meta.specs, upAxis: meta.upAxis ?? null, edgesVisible: meta.edgesVisible === true },
  }, null, 2);
}

/**
 * JSON テキストをファイルとしてダウンロードさせる
 * @param {string} filename
 * @param {string} text
 */
export function downloadJSON(filename, text) {
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 100);
}
