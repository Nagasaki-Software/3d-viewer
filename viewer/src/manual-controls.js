/** ボタン操作（ピンチ操作の代替）用の純粋関数群。
 * OrbitControlsの内部には触れず、カメラ位置・注視点の値だけを受け取って
 * 新しいカメラ位置を計算して返す（viewer.js側がcamera.position/controls.targetに反映する）。
 */
import * as THREE from 'three';

/**
 * 注視点を中心にカメラを回転させた新しい位置を返す。
 * @param {{x:number,y:number,z:number}} cameraPos 現在のカメラ位置
 * @param {{x:number,y:number,z:number}} target 注視点
 * @param {'horizontal'|'vertical'} axis horizontal=左右(theta), vertical=上下(phi)
 * @param {number} angleRad 回転量（ラジアン）
 * @param {{min:number,max:number}} [polarLimits] verticalのクランプ範囲（既定: 真上0〜真下π）
 */
export function rotateAroundTarget(cameraPos, target, axis, angleRad, polarLimits = { min: 0, max: Math.PI }) {
  const offset = new THREE.Vector3(cameraPos.x - target.x, cameraPos.y - target.y, cameraPos.z - target.z);
  const spherical = new THREE.Spherical().setFromVector3(offset);

  if (axis === 'horizontal') {
    spherical.theta += angleRad;
  } else {
    spherical.phi = Math.max(polarLimits.min, Math.min(polarLimits.max, spherical.phi + angleRad));
  }

  const newOffset = new THREE.Vector3().setFromSpherical(spherical);
  return { x: target.x + newOffset.x, y: target.y + newOffset.y, z: target.z + newOffset.z };
}

const PAN_DIRECTIONS = {
  up: { axis: 1, sign: 1 },
  down: { axis: 1, sign: -1 },
  left: { axis: 0, sign: -1 },
  right: { axis: 0, sign: 1 },
};

/**
 * カメラのローカル画面方向（上下左右）へ、距離に比例した移動量のオフセットを返す。
 * 呼び出し側がこのオフセットをカメラ位置と注視点の両方に加算する。
 * @param {THREE.Matrix4} cameraMatrix カメラのワールド行列（回転成分を使う）
 * @param {'up'|'down'|'left'|'right'} direction
 * @param {number} distanceToTarget カメラ→注視点の距離
 * @param {number} panRatio 距離に対する移動量の割合（例: 0.1 = 10%）
 */
export function panByScreenDirection(cameraMatrix, direction, distanceToTarget, panRatio) {
  const { axis, sign } = PAN_DIRECTIONS[direction];
  const axisVec = new THREE.Vector3().setFromMatrixColumn(cameraMatrix, axis);
  const amount = distanceToTarget * panRatio * sign;
  return { x: axisVec.x * amount, y: axisVec.y * amount, z: axisVec.z * amount };
}

/**
 * 注視点からの距離をzoomStep倍（in）または1/zoomStep倍（out）にした新しいカメラ位置を返す。
 * @param {{x:number,y:number,z:number}} cameraPos
 * @param {{x:number,y:number,z:number}} target
 * @param {'in'|'out'} direction
 * @param {number} zoomStep 1回のタップで距離にかける倍率（例: 0.9）
 * @param {number} minDistance
 * @param {number} maxDistance
 */
export function zoomByFactor(cameraPos, target, direction, zoomStep, minDistance, maxDistance) {
  const offset = new THREE.Vector3(cameraPos.x - target.x, cameraPos.y - target.y, cameraPos.z - target.z);
  const dist = offset.length();
  const factor = direction === 'in' ? zoomStep : 1 / zoomStep;
  const newDist = Math.max(minDistance, Math.min(maxDistance, dist * factor));
  offset.setLength(newDist);
  return { x: target.x + offset.x, y: target.y + offset.y, z: target.z + offset.z };
}
