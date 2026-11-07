import * as THREE from 'three';
import { beforeEach, describe, expect, it } from 'vitest';
import { buildPartRegistry } from '../src/parts.js';
import { annotationWorldPoint, partitionAnnotations } from '../src/annotations.js';

// annotationWorldPoint は document に触れないため、
// addAnnotation（DOM生成を伴う）を使わず注釈オブジェクトを直接組み立ててテストする。

function makePart(name, offset) {
  const root = new THREE.Group();
  const part = new THREE.Group();
  part.name = name;
  part.position.copy(offset);
  part.add(new THREE.Mesh(new THREE.BufferGeometry()));
  root.add(part);
  return root;
}

describe('annotationWorldPoint', () => {
  beforeEach(() => {
    const root = makePart('Asm/PartA', new THREE.Vector3(10, 0, 0));
    buildPartRegistry(root);
  });

  it('部品ローカル座標をワールド座標に変換する', () => {
    const a = { partName: 'Asm/PartA', position: new THREE.Vector3(1, 2, 3) };
    const world = annotationWorldPoint(a);
    // 部品はワールド原点から (10,0,0) にオフセットしているため、ローカル(1,2,3)は
    // ワールドでは (11,2,3) になるはず
    expect(world.x).toBeCloseTo(11);
    expect(world.y).toBeCloseTo(2);
    expect(world.z).toBeCloseTo(3);
  });

  it('partNameがnullならワールド座標をそのまま返す', () => {
    const a = { partName: null, position: new THREE.Vector3(5, 6, 7) };
    const world = annotationWorldPoint(a);
    expect(world.x).toBeCloseTo(5);
    expect(world.y).toBeCloseTo(6);
    expect(world.z).toBeCloseTo(7);
  });

  it('登録されていない部品名なら保存座標をそのまま返す', () => {
    const a = { partName: 'Asm/Unknown', position: new THREE.Vector3(1, 1, 1) };
    const world = annotationWorldPoint(a);
    expect(world.x).toBeCloseTo(1);
    expect(world.y).toBeCloseTo(1);
    expect(world.z).toBeCloseTo(1);
  });
});

describe('partitionAnnotations', () => {
  const getPartFn = (name) => (name === 'Asm/PartA' ? {} : null);

  it('partNameが解決できる、またはnullの項目はresolvedに残す', () => {
    const list = [
      { id: 'a', partName: 'Asm/PartA' },
      { id: 'b', partName: null },
    ];
    const { resolved, unresolvedCount } = partitionAnnotations(list, getPartFn);
    expect(resolved).toEqual(list);
    expect(unresolvedCount).toBe(0);
  });

  it('partNameが解決できない項目はresolvedから除外しunresolvedCountに数える', () => {
    const list = [
      { id: 'a', partName: 'Asm/PartA' },
      { id: 'b', partName: 'Asm/Unknown' },
      { id: 'c', partName: null },
    ];
    const { resolved, unresolvedCount } = partitionAnnotations(list, getPartFn);
    expect(resolved.map((a) => a.id)).toEqual(['a', 'c']);
    expect(unresolvedCount).toBe(1);
  });
});
