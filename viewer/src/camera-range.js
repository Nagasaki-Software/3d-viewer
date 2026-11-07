/** カメラのnear/farとズーム限界の計算（純粋関数） */

/**
 * 注視点までの距離に応じて near/far を決める。
 * 拡大時は near を距離に比例して縮め、Zファイティングと手前欠けを防ぐ。
 * @param {number} dist カメラ→注視点距離
 * @param {number} diag モデルのバウンディングボックス対角長
 */
export function computeCameraRange(dist, diag) {
  const near = Math.max(dist / 1000, diag / 1e6);
  const far = Math.max(dist * 4 + diag * 2, near * 1000);
  return { near, far };
}

/** モデル対角長から OrbitControls の min/max ズーム距離を決める */
export function computeControlLimits(diag) {
  return { minDistance: diag * 0.005, maxDistance: diag * 4 };
}
