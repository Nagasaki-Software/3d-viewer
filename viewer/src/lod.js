/** LOD（操作中の軽量表示）関連。
 * - buildLodBatches: 簡略版glTFシーンから表示専用のBatchedMesh群を組み立てる
 *   （parts.jsのような部品レジストリ・選択・個別表示制御は持たない）。
 * - createMotionTracker: カメラの動き量から軽量版を出す/戻すタイミングを判定する純粋ロジック。
 */
import * as THREE from 'three';
import { isBatchable, materialKey, normalizeGeometry } from './parts.js';

/** 簡略版シーンから色分けBatchedMesh群を1つのGroupにまとめて返す。
 * バッチ化対象が無ければ null。 */
export function buildLodBatches(root) {
  root.updateMatrixWorld(true);
  const rootInv = new THREE.Matrix4().copy(root.matrixWorld).invert();

  const groups = new Map(); // key -> { material, items: Mesh[] }
  root.traverse((mesh) => {
    if (!mesh.isMesh || !isBatchable(mesh)) return;
    const key = materialKey(mesh.material);
    if (!groups.has(key)) groups.set(key, { material: mesh.material, items: [] });
    groups.get(key).items.push(mesh);
  });
  if (groups.size === 0) return null;

  // 呼び出し側は描画ツリーに追加しない使い捨てのシーンを渡す前提。そのため元メッシュの
  // geometryは解放/除去せず、正規化コピーのみdisposeする（描画中のツリーを扱うparts.jsとは異なる）。
  const group = new THREE.Group();
  groups.forEach(({ material, items }) => {
    const normalized = items.map((mesh) => normalizeGeometry(mesh.geometry));
    const totalVerts = normalized.reduce((s, g) => s + g.getAttribute('position').count, 0);
    const totalIndices = normalized.reduce((s, g) => s + g.index.count, 0);

    const batchMaterial = material.clone();
    batchMaterial.color = new THREE.Color(0xffffff); // 色はper-instanceで持つ
    batchMaterial.map = null;

    const batch = new THREE.BatchedMesh(items.length, totalVerts, totalIndices, batchMaterial);
    items.forEach((mesh, i) => {
      const baseColor = mesh.material.color.clone();
      const id = batch.addInstance(batch.addGeometry(normalized[i]));
      const rel = new THREE.Matrix4().multiplyMatrices(rootInv, mesh.matrixWorld);
      batch.setMatrixAt(id, rel);
      batch.setColorAt(id, baseColor);
      normalized[i].dispose();
    });
    group.add(batch);
    batch.raycast = () => {}; // LODは部品選択の対象にしない（タップは常に精密版側で処理する）
  });
  return group;
}

/** カメラの動き量から、軽量表示(LOD)を出す/戻すの状態遷移を判定する純粋ロジック。
 * update()は状態が変わったフレームだけ 'show'/'hide' を返し、変化なしは null を返す。
 * 静止後 holdMs だけ軽量版を保持してから精密版に戻す（減衰運動の余韻をまたぐため）。
 * @param {{holdMs?: number}} [opts]
 */
export function createMotionTracker({ holdMs = 250 } = {}) {
  let showing = false;
  let lastMotion = 0;
  return {
    /** @param {number} moved 動き量  @param {number} threshold 判定閾値  @param {number} now 現在時刻ms */
    update(moved, threshold, now) {
      if (moved > threshold) {
        lastMotion = now;
        if (!showing) { showing = true; return 'show'; }
      } else if (showing && now - lastMotion > holdMs) {
        showing = false;
        return 'hide';
      }
      return null;
    },
    isShowing: () => showing,
    reset() { showing = false; lastMotion = 0; },
  };
}

/** 描画に使うピクセル比を返す。高解像度パネル（4K・表示スケール200%等）では
 * 塗る画素の量（フィルレート）がボトルネックになるため、操作中だけ1まで下げて
 * 画素量を最大1/4に減らす。静止時は従来どおりdevicePixelRatio（上限2）を使う */
export function interactionPixelRatio(devicePixelRatio, interacting) {
  const base = Math.min(devicePixelRatio, 2);
  return interacting ? Math.min(base, 1) : base;
}

/** 描画オンデマンドの判定。静止中は描かず、カメラが minMove を超えて動いたフレームと、
 * request(ms, now) で予約した期間（now から ms ミリ秒）だけ描く。
 * minMove は、慣性(damping)の余韻が目に見えないほど小さくなっても描き続けるのを防ぐためのもの */
export function createRenderScheduler() {
  let until = -Infinity;
  return {
    request(ms, now) { until = Math.max(until, now + ms); },
    shouldRender(moved, now, minMove = 0) { return moved > minMove || now <= until; },
  };
}

/** 操作中の表示を中間版から軽量版へ下げるかの判定。中間版を表示している間の
 * 連続描画フレームの間隔を record() に渡す。直近 samples 個の中央値が slowMs を
 * 超えたら1回だけ true を返し、以後は下げたまま（行ったり来たりを防ぐ） */
export function createTierGovernor({ slowMs = 66, samples = 10 } = {}) {
  let intervals = [];
  let demoted = false;
  return {
    record(intervalMs) {
      if (demoted) return false;
      intervals.push(intervalMs);
      if (intervals.length > samples) intervals.shift();
      if (intervals.length < samples) return false;
      const sorted = [...intervals].sort((a, b) => a - b);
      const mid = (samples - 1) / 2;
      const median = (sorted[Math.floor(mid)] + sorted[Math.ceil(mid)]) / 2;
      if (median > slowMs) { demoted = true; return true; }
      return false;
    },
    clearSamples() { intervals = []; },
    isDemoted: () => demoted,
    reset() { intervals = []; demoted = false; },
  };
}
