/** カメラのなめらかな移動（フレームループに乗せた線形補間+イージング） */
import * as THREE from 'three';

let active = null; // { fromPos, toPos, fromTarget, toTarget, start, ms, camera, controls }

export function animateCameraTo(camera, controls, toPos, toTarget, ms = 450) {
  active = {
    camera, controls, ms,
    fromPos: camera.position.clone(),
    toPos: new THREE.Vector3(toPos.x, toPos.y, toPos.z),
    fromTarget: controls.target.clone(),
    toTarget: new THREE.Vector3(toTarget.x, toTarget.y, toTarget.z),
    start: performance.now(),
  };
}

/** 毎フレーム呼ぶ（viewer.jsのonEachFrameに登録）。アニメ中true */
export function updateCameraAnimation() {
  if (!active) return false;
  const t = Math.min((performance.now() - active.start) / active.ms, 1);
  const e = 1 - Math.pow(1 - t, 3); // easeOutCubic
  active.camera.position.lerpVectors(active.fromPos, active.toPos, e);
  active.controls.target.lerpVectors(active.fromTarget, active.toTarget, e);
  if (t >= 1) active = null;
  return true;
}

const DIRS = {
  front: [0, 0, 1], back: [0, 0, -1],
  top: [0, 1, 0.001], bottom: [0, -1, 0.001], // 真上/真下は極特異点回避で僅かにZを足す
  left: [-1, 0, 0], right: [1, 0, 0],
  iso: [1, 0.8, 1],
};

/**
 * 指定したローカル軸の指定方向を、世界の上方向(+Y)に向けるための回転(ラジアン)を返す。
 * どの軸が「高さ」かはCADファイルごとに異なり自動判定できないため、ユーザーが選んだ軸をそのまま使う。
 */
export function axisUpRotation(axis, sign) {
  if (axis === 'x') {
    return { x: 0, y: 0, z: sign >= 0 ? Math.PI / 2 : -Math.PI / 2 };
  }
  if (axis === 'z') {
    return { x: sign >= 0 ? -Math.PI / 2 : Math.PI / 2, y: 0, z: 0 };
  }
  // axis === 'y'
  return sign >= 0 ? { x: 0, y: 0, z: 0 } : { x: Math.PI, y: 0, z: 0 };
}

/** 標準ビューのカメラ位置を返す（注視点は原点=モデル中心のまま） */
export function standardViewPose(name, target, diag) {
  const d = DIRS[name] ?? DIRS.front;
  const len = Math.hypot(...d);
  const dist = diag * 1.6;
  return {
    position: {
      x: target.x + (d[0] / len) * dist,
      y: target.y + (d[1] / len) * dist,
      z: target.z + (d[2] / len) * dist,
    },
    target: { ...target },
  };
}
