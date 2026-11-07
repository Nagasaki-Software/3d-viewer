import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { rotateAroundTarget, panByScreenDirection, zoomByFactor } from '../src/manual-controls.js';

describe('rotateAroundTarget', () => {
  it('水平回転（horizontal）でtheta方向に位置が変わる（距離は変わらない）', () => {
    const pos = rotateAroundTarget({ x: 0, y: 0, z: 3 }, { x: 0, y: 0, z: 0 }, 'horizontal', Math.PI / 2);
    expect(pos.x).toBeCloseTo(3);
    expect(pos.y).toBeCloseTo(0);
    expect(pos.z).toBeCloseTo(0);
  });

  it('垂直回転（vertical）で上限を超える角度を指定すると、既定の上限(π)でクランプされる', () => {
    const pos = rotateAroundTarget({ x: 0, y: 0, z: 3 }, { x: 0, y: 0, z: 0 }, 'vertical', Math.PI);
    expect(pos.y).toBeCloseTo(-3); // 真下(phi=π)で頭打ち
    expect(pos.x).toBeCloseTo(0);
    expect(pos.z).toBeCloseTo(0);
  });

  it('垂直回転で下限を超える角度を指定すると、既定の下限(0)でクランプされる', () => {
    const pos = rotateAroundTarget({ x: 0, y: 0, z: 3 }, { x: 0, y: 0, z: 0 }, 'vertical', -Math.PI);
    expect(pos.y).toBeCloseTo(3); // 真上(phi=0)で頭打ち
    expect(pos.x).toBeCloseTo(0);
    expect(pos.z).toBeCloseTo(0);
  });

  it('polarLimitsを指定するとその範囲でクランプされる', () => {
    const pos = rotateAroundTarget(
      { x: 0, y: 0, z: 3 }, { x: 0, y: 0, z: 0 }, 'vertical', Math.PI,
      { min: Math.PI / 4, max: Math.PI / 2 },
    );
    // phi初期値はπ/2なので、上限もπ/2 → 変化なし
    expect(pos.x).toBeCloseTo(0);
    expect(pos.y).toBeCloseTo(0);
    expect(pos.z).toBeCloseTo(3);
  });

  it('注視点が原点以外でも、注視点からの相対位置として回転する', () => {
    const pos = rotateAroundTarget({ x: 5, y: 2, z: 5 }, { x: 5, y: 2, z: 2 }, 'horizontal', Math.PI / 2);
    expect(pos.x).toBeCloseTo(8);
    expect(pos.y).toBeCloseTo(2);
    expect(pos.z).toBeCloseTo(2);
  });
});

describe('panByScreenDirection', () => {
  it('カメラのローカル右方向(+X)へ、距離×panRatio分だけ移動する（単位行列＝正面向きの場合）', () => {
    const offset = panByScreenDirection(new THREE.Matrix4(), 'right', 10, 0.1);
    expect(offset.x).toBeCloseTo(1);
    expect(offset.y).toBeCloseTo(0);
    expect(offset.z).toBeCloseTo(0);
  });

  it('leftはrightの逆方向、up/downも同様にカメラのローカル軸に沿う', () => {
    const m = new THREE.Matrix4();
    expect(panByScreenDirection(m, 'left', 10, 0.1).x).toBeCloseTo(-1);
    expect(panByScreenDirection(m, 'up', 10, 0.1).y).toBeCloseTo(1);
    expect(panByScreenDirection(m, 'down', 10, 0.1).y).toBeCloseTo(-1);
  });

  it('距離(distanceToTarget)に比例して移動量が変わる', () => {
    const offset = panByScreenDirection(new THREE.Matrix4(), 'right', 20, 0.1);
    expect(offset.x).toBeCloseTo(2);
  });

  it('カメラと注視点の両方に同じオフセットを加えても、相対位置（向き・距離）は変わらない', () => {
    const cameraPos = { x: 0, y: 0, z: 10 };
    const target = { x: 0, y: 0, z: 0 };
    const offset = panByScreenDirection(new THREE.Matrix4(), 'right', 10, 0.1);
    const newCamera = { x: cameraPos.x + offset.x, y: cameraPos.y + offset.y, z: cameraPos.z + offset.z };
    const newTarget = { x: target.x + offset.x, y: target.y + offset.y, z: target.z + offset.z };
    expect(newTarget.x - newCamera.x).toBeCloseTo(target.x - cameraPos.x);
    expect(newTarget.z - newCamera.z).toBeCloseTo(target.z - cameraPos.z);
  });
});

describe('zoomByFactor', () => {
  it('inで距離がzoomStep倍(拡大=近づく)になる', () => {
    const pos = zoomByFactor({ x: 0, y: 0, z: 10 }, { x: 0, y: 0, z: 0 }, 'in', 0.9, 0, 100);
    expect(pos.z).toBeCloseTo(9);
  });

  it('outで距離が1/zoomStep倍(縮小=遠ざかる)になる', () => {
    const pos = zoomByFactor({ x: 0, y: 0, z: 10 }, { x: 0, y: 0, z: 0 }, 'out', 0.9, 0, 100);
    expect(pos.z).toBeCloseTo(10 / 0.9);
  });

  it('maxDistanceを超える場合はmaxDistanceでクランプされる', () => {
    const pos = zoomByFactor({ x: 0, y: 0, z: 10 }, { x: 0, y: 0, z: 0 }, 'out', 0.9, 0, 10.5);
    expect(pos.z).toBeCloseTo(10.5);
  });

  it('minDistanceを下回る場合はminDistanceでクランプされる', () => {
    const pos = zoomByFactor({ x: 0, y: 0, z: 1 }, { x: 0, y: 0, z: 0 }, 'in', 0.9, 1, 100);
    expect(pos.z).toBeCloseTo(1);
  });
});
