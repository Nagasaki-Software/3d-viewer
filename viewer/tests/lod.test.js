import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { buildLodBatches, createMotionTracker, interactionPixelRatio, createRenderScheduler, createTierGovernor } from '../src/lod.js';

function triGeometry(offsetX = 0) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
    offsetX, 0, 0, offsetX + 1, 0, 0, offsetX, 1, 0,
  ]), 3));
  g.setIndex([0, 1, 2]);
  return g;
}

function makeLodScene() {
  const root = new THREE.Group();
  const m1 = new THREE.Mesh(triGeometry(0), new THREE.MeshStandardMaterial({ color: 0xff0000 }));
  const m2 = new THREE.Mesh(triGeometry(10), new THREE.MeshStandardMaterial({ color: 0x00ff00 }));
  root.add(m1, m2);
  return root;
}

describe('buildLodBatches', () => {
  it('opacityが同じメッシュを1つのBatchedMeshにまとめる', () => {
    const group = buildLodBatches(makeLodScene());
    const batches = group.children.filter((c) => c.isBatchedMesh);
    expect(batches).toHaveLength(1);
  });

  it('各メッシュ固有の色をper-instance colorで保持する', () => {
    const group = buildLodBatches(makeLodScene());
    const batch = group.children.find((c) => c.isBatchedMesh);
    const c0 = new THREE.Color();
    const c1 = new THREE.Color();
    batch.getColorAt(0, c0);
    batch.getColorAt(1, c1);
    const hexes = [c0.getHexString(), c1.getHexString()].sort();
    expect(hexes).toEqual(['00ff00', 'ff0000']);
  });

  it('親やrootの変換を反映したワールド相対行列でインスタンスを配置する', () => {
    // root自身の変換はrootInvで打ち消され、親の変換だけがインスタンスに残る想定
    const root = new THREE.Group();
    root.position.set(0, 2, 0);
    const parent = new THREE.Group();
    parent.position.set(5, 0, 0);
    const mesh = new THREE.Mesh(triGeometry(0), new THREE.MeshStandardMaterial({ color: 0xff0000 }));
    parent.add(mesh);
    root.add(parent);

    const group = buildLodBatches(root);
    const batch = group.children.find((c) => c.isBatchedMesh);
    const m = new THREE.Matrix4();
    batch.getMatrixAt(0, m);
    const pos = new THREE.Vector3().setFromMatrixPosition(m);
    expect(pos.x).toBeCloseTo(5); // 親のposition(5,0,0)が反映される
    expect(pos.y).toBeCloseTo(0); // rootのy=2はrootInvで打ち消される
  });

  it('バッチ化できるメッシュが無ければnullを返す', () => {
    expect(buildLodBatches(new THREE.Group())).toBeNull();
  });

  it('バッチをraycast対象から除外する（LODは部品選択の対象にしないため）', () => {
    const group = buildLodBatches(makeLodScene());
    const batch = group.children.find((c) => c.isBatchedMesh);
    const rc = new THREE.Raycaster(new THREE.Vector3(0.3, 0.3, 5), new THREE.Vector3(0, 0, -1));
    const intersects = [];
    batch.raycast(rc, intersects);
    expect(intersects).toHaveLength(0);
  });
});

describe('createMotionTracker', () => {
  it('静止状態が続く間は何も返さない', () => {
    const t = createMotionTracker();
    expect(t.update(0, 0.001, 0)).toBeNull();
    expect(t.isShowing()).toBe(false);
  });

  it('閾値を超えて動いたら show を返す', () => {
    const t = createMotionTracker();
    expect(t.update(1, 0.001, 0)).toBe('show');
    expect(t.isShowing()).toBe(true);
  });

  it('動き続けている間は show を繰り返さない', () => {
    const t = createMotionTracker();
    t.update(1, 0.001, 0);
    expect(t.update(1, 0.001, 16)).toBeNull();
    expect(t.isShowing()).toBe(true);
  });

  it('静止しても猶予(250ms)内は軽量版を保持する', () => {
    const t = createMotionTracker({ holdMs: 250 });
    t.update(1, 0.001, 0);       // show
    expect(t.update(0, 0.001, 100)).toBeNull(); // 100ms経過、まだ保持
    expect(t.isShowing()).toBe(true);
  });

  it('静止して猶予を超えたら hide を返す', () => {
    const t = createMotionTracker({ holdMs: 250 });
    t.update(1, 0.001, 0);        // show
    t.update(0, 0.001, 100);      // 保持
    expect(t.update(0, 0.001, 300)).toBe('hide'); // 300ms経過
    expect(t.isShowing()).toBe(false);
  });

  it('holdMsの指定値が反映される（既定250msと異なる値でも動作する）', () => {
    const t = createMotionTracker({ holdMs: 100 });
    t.update(1, 0.001, 0);                        // show
    expect(t.update(0, 0.001, 80)).toBeNull();    // 80ms: まだ保持（<100）
    expect(t.update(0, 0.001, 150)).toBe('hide'); // 150ms: 猶予超過（>100）。既定250なら保持のまま
  });

  it('hide後に再び動くと show を返せる（セッション中の繰り返しに対応）', () => {
    const t = createMotionTracker({ holdMs: 250 });
    t.update(1, 0.001, 0);        // show
    t.update(0, 0.001, 300);      // hide
    expect(t.update(1, 0.001, 320)).toBe('show'); // 再度動いたらshow
    expect(t.isShowing()).toBe(true);
  });

  it('resetで静止状態に戻る（モデル切替時に前のモデルの状態を引き継がないため）', () => {
    const t = createMotionTracker();
    t.update(1, 0.001, 0); // show
    expect(t.isShowing()).toBe(true);
    t.reset();
    expect(t.isShowing()).toBe(false);
    expect(t.update(1, 0.001, 1000)).toBe('show'); // resetしていればまたshowを返せる
  });
});

describe('interactionPixelRatio', () => {
  it('静止時はdevicePixelRatioを上限2でそのまま使う（現行の描画設定と同じ）', () => {
    expect(interactionPixelRatio(2, false)).toBe(2);
    expect(interactionPixelRatio(3, false)).toBe(2);
    expect(interactionPixelRatio(1.5, false)).toBe(1.5);
    expect(interactionPixelRatio(1, false)).toBe(1);
  });

  it('操作中は1まで下げてフィルレートを減らす（元々1以下ならそのまま）', () => {
    expect(interactionPixelRatio(2, true)).toBe(1);
    expect(interactionPixelRatio(1.5, true)).toBe(1);
    expect(interactionPixelRatio(0.8, true)).toBe(0.8);
  });
});

describe('createRenderScheduler', () => {
  it('カメラが動いたフレームは描く', () => {
    const s = createRenderScheduler();
    expect(s.shouldRender(0.001, 0)).toBe(true);
  });
  it('動きも予約も無ければ描かない（静止中の再描画停止）', () => {
    const s = createRenderScheduler();
    expect(s.shouldRender(0, 1000)).toBe(false);
  });
  it('予約した期間だけ描き、過ぎたら描かない', () => {
    const s = createRenderScheduler();
    s.request(500, 1000);
    expect(s.shouldRender(0, 1000)).toBe(true);
    expect(s.shouldRender(0, 1500)).toBe(true);
    expect(s.shouldRender(0, 1501)).toBe(false);
  });
  it('目に見えないほど小さい動き（慣性の余韻の末尾）は描かない', () => {
    const s = createRenderScheduler();
    expect(s.shouldRender(0.00001, 1000, 0.0001)).toBe(false);
    expect(s.shouldRender(0.001, 1000, 0.0001)).toBe(true);
  });
  it('短い予約が長い予約を縮めない', () => {
    const s = createRenderScheduler();
    s.request(500, 1000);
    s.request(0, 1100);
    expect(s.shouldRender(0, 1400)).toBe(true);
  });
});

describe('createTierGovernor', () => {
  it('サンプルが揃うまでは判定しない', () => {
    const g = createTierGovernor({ slowMs: 66, samples: 10 });
    for (let i = 0; i < 9; i++) expect(g.record(200)).toBe(false);
    expect(g.isDemoted()).toBe(false);
  });
  it('直近10フレームの中央値が66msを超えたら1回だけtrueを返す', () => {
    const g = createTierGovernor({ slowMs: 66, samples: 10 });
    const results = Array.from({ length: 10 }, () => g.record(100));
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(results[9]).toBe(true);
    expect(g.isDemoted()).toBe(true);
    expect(g.record(100)).toBe(false); // 2回目は返さない
  });
  it('中央値が66ms以下なら下げない（たまに遅いフレームが混ざっても下げない）', () => {
    const g = createTierGovernor({ slowMs: 66, samples: 10 });
    [16, 16, 16, 16, 16, 16, 16, 200, 200, 200].forEach((ms) => g.record(ms));
    expect(g.isDemoted()).toBe(false);
  });
  it('clearSamplesで集計をやり直す（操作の切れ目をまたいだ間隔を混ぜない）', () => {
    const g = createTierGovernor({ slowMs: 66, samples: 10 });
    for (let i = 0; i < 9; i++) g.record(200);
    g.clearSamples();
    expect(g.record(200)).toBe(false);
    expect(g.isDemoted()).toBe(false);
  });
  it('resetで下げた状態も戻る（モデル切替時）', () => {
    const g = createTierGovernor({ slowMs: 66, samples: 10 });
    for (let i = 0; i < 10; i++) g.record(200);
    g.reset();
    expect(g.isDemoted()).toBe(false);
  });
});
