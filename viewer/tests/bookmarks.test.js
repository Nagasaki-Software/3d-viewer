import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { captureBookmark, applyBookmarkState } from '../src/bookmarks.js';
import { buildPartRegistry, hiddenPartNames, showAllParts } from '../src/parts.js';

describe('bookmarks', () => {
  it('現在状態をスナップショットする', () => {
    const b = captureBookmark('全体', {
      cameraPosition: { x: 1, y: 2, z: 3 }, target: { x: 0, y: 0, z: 0 },
      hiddenParts: ['A/B'], background: 'light',
    });
    expect(b.name).toBe('全体');
    expect(b.camera.position).toEqual({ x: 1, y: 2, z: 3 });
    expect(b.hiddenParts).toEqual(['A/B']);
    expect(b.background).toBe('light');
    expect(b.id).toBeTruthy();
  });

  it('適用時に可視リセット→テーマ→カメラ移動の順でコールバックを呼ぶ', () => {
    const calls = [];
    applyBookmarkState(
      { camera: { position: { x: 1, y: 1, z: 1 }, target: { x: 0, y: 0, z: 0 } }, hiddenParts: [], background: 'dark' },
      {
        moveCamera: (p, t) => calls.push(['move', p.x, t.x]),
        showAllParts: () => calls.push(['showAll']),
        setTheme: (bg) => calls.push(['theme', bg]),
      },
    );
    expect(calls).toEqual([['showAll'], ['theme', 'dark'], ['move', 1, 0]]);
  });

  it('hiddenPartsの部品はまとめて非表示になる', () => {
    const root = new THREE.Group();
    ['Asm/P1', 'Asm/P2'].forEach((name, i) => {
      const p = new THREE.Group();
      p.name = name;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
        i * 10, 0, 0, i * 10 + 1, 0, 0, i * 10, 1, 0,
      ]), 3));
      p.add(new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: 0xff0000 })));
      root.add(p);
    });
    buildPartRegistry(root);
    applyBookmarkState(
      { camera: { position: { x: 0, y: 0, z: 1 }, target: { x: 0, y: 0, z: 0 } }, hiddenParts: ['Asm/P1'], background: 'light' },
      { moveCamera: () => {}, showAllParts, setTheme: () => {} },
    );
    expect(hiddenPartNames()).toEqual(['Asm/P1']);
  });
});
