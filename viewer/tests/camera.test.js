import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { computeCameraRange, computeControlLimits } from '../src/camera-range.js';
import { standardViewPose, axisUpRotation } from '../src/views.js';

describe('computeCameraRange', () => {
  it('近距離では near が小さくなり far/near 比が有限に保たれる', () => {
    const r = computeCameraRange(0.01, 2); // dist=0.01, モデル対角=2
    expect(r.near).toBeLessThan(0.01);
    expect(r.near).toBeGreaterThan(0);
    expect(r.far / r.near).toBeLessThan(1e7); // Zファイティング防止
  });

  it('遠距離では far がモデル全体+距離をカバーする', () => {
    const r = computeCameraRange(10, 2);
    expect(r.far).toBeGreaterThan(12);
  });
});

describe('computeControlLimits', () => {
  it('モデル対角からmin/max距離を決める', () => {
    const l = computeControlLimits(2);
    expect(l.minDistance).toBeGreaterThan(0);
    expect(l.minDistance).toBeLessThan(0.1);
    expect(l.maxDistance).toBeGreaterThan(4);
  });
});

describe('standardViewPose', () => {
  it('front はターゲット正面(+Z)から距離diag*1.6の位置', () => {
    const p = standardViewPose('front', { x: 0, y: 0, z: 0 }, 2);
    expect(p.position.z).toBeCloseTo(3.2);
    expect(p.position.x).toBeCloseTo(0);
  });
  it('iso は3軸すべて正の位置', () => {
    const p = standardViewPose('iso', { x: 0, y: 0, z: 0 }, 2);
    expect(p.position.x).toBeGreaterThan(0);
    expect(p.position.y).toBeGreaterThan(0);
    expect(p.position.z).toBeGreaterThan(0);
  });
  it('未知のビュー名は front 扱い', () => {
    expect(standardViewPose('unknown', { x: 0, y: 0, z: 0 }, 2).position.z).toBeCloseTo(3.2);
  });
});

describe('axisUpRotation', () => {
  function localAxisVector(axis) {
    return new THREE.Vector3(axis === 'x' ? 1 : 0, axis === 'y' ? 1 : 0, axis === 'z' ? 1 : 0);
  }

  it('y軸・+方向を指定した場合は回転しない（すでに正しい向き）', () => {
    expect(axisUpRotation('y', 1)).toEqual({ x: 0, y: 0, z: 0 });
  });

  it.each([
    ['x', 1], ['x', -1], ['y', -1], ['z', 1], ['z', -1],
  ])('軸=%s 符号=%i を指定すると、その軸の指定方向が世界の上方向(+Y)を向く', (axis, sign) => {
    const r = axisUpRotation(axis, sign);
    const euler = new THREE.Euler(r.x, r.y, r.z);
    const v = localAxisVector(axis).multiplyScalar(sign).applyEuler(euler);
    expect(v.y).toBeCloseTo(1);
    expect(v.x).toBeCloseTo(0);
    expect(v.z).toBeCloseTo(0);
  });
});
