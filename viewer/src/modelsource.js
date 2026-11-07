/** サーバー上のモデル（viewer/models/）への参照: 名前検証とパス生成 */

/**
 * URLパラメータ等から来たモデル名を検証する。
 * パス区切り・「..」を拒否し、.glb拡張子は取り除く。不正ならnull。
 */
export function sanitizeModelName(raw) {
  if (typeof raw !== 'string') return null;
  const name = raw.trim().replace(/\.glb$/i, '');
  if (!name || /[/\\]/.test(name) || name.includes('..')) return null;
  return name;
}

/** モデル名からGLB・注釈JSON・LOD(軽量表示)・中間版GLBの取得パスを返す */
export function modelPaths(name) {
  return {
    glb: `/models/${encodeURIComponent(name)}.glb`,
    json: `/models/${encodeURIComponent(name)}_annotations.json`,
    lod: `/models/${encodeURIComponent(name)}_lod.glb`,
    mid: `/models/${encodeURIComponent(name)}_mid.glb`,
  };
}
