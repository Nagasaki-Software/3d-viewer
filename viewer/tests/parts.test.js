import * as THREE from 'three';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  buildPartRegistry, getPartNames, getPart, setPartVisible, setPartsVisible,
  resolvePartName, resolveHitPartName, hiddenPartNames, showAllParts,
  selectPart, clearSelection, getSelectedPartName, setPartHighlight,
  setEdgesVisible, setPreciseVisible,
} from '../src/parts.js';

/** 原点付近に単一三角形を持つジオメトリ（レイキャスト検証用に位置を指定できる） */
function triGeometry(offsetX = 0) {
  const g = new THREE.BufferGeometry();
  const verts = new Float32Array([
    offsetX, 0, 0,
    offsetX + 1, 0, 0,
    offsetX, 1, 0,
  ]);
  g.setAttribute('position', new THREE.BufferAttribute(verts, 3));
  g.setIndex([0, 1, 2]);
  return g;
}

/** 2線分（4頂点）の非インデックスLINESジオメトリ（変換ツール出力のエッジを模す） */
function lineGeometry(offsetX = 0) {
  const g = new THREE.BufferGeometry();
  const verts = new Float32Array([
    offsetX, 0, 0, offsetX + 1, 0, 0,
    offsetX + 1, 0, 0, offsetX + 1, 1, 0,
  ]);
  g.setAttribute('position', new THREE.BufferAttribute(verts, 3));
  return g;
}

function makeScene() {
  // gltfpack出力を模したツリー: root → 無名ラッパー → 名前付き部品ノード → Mesh + LineSegments
  const root = new THREE.Group();
  const wrapper = new THREE.Group(); // 無名
  const partA = new THREE.Group();
  partA.name = 'Asm/PartA';
  const meshA = new THREE.Mesh(triGeometry(0), new THREE.MeshStandardMaterial({ color: 0xff0000 }));
  const edgeA = new THREE.LineSegments(lineGeometry(0), new THREE.LineBasicMaterial());
  partA.add(meshA, edgeA);
  wrapper.add(partA);
  const partB = new THREE.Group();
  partB.name = 'Asm/PartB';
  const meshB = new THREE.Mesh(triGeometry(10), new THREE.MeshStandardMaterial({ color: 0xff0000 }));
  const edgeB = new THREE.LineSegments(lineGeometry(10), new THREE.LineBasicMaterial());
  partB.add(meshB, edgeB);
  const partC = new THREE.Group();
  partC.name = 'Asm/PartC';
  const meshC = new THREE.Mesh(triGeometry(20), new THREE.MeshStandardMaterial({ color: 0x00ff00 }));
  partC.add(meshC);
  root.add(wrapper, partB, partC);
  return { root, meshA, edgeA, meshB, edgeB, meshC };
}

function batchesOf(root) {
  return root.children.filter((c) => c.isBatchedMesh);
}

describe('parts registry', () => {
  let s;
  beforeEach(() => { s = makeScene(); buildPartRegistry(s.root); });

  it('名前付きでメッシュを持つノードだけを部品として登録する', () => {
    expect(getPartNames().sort()).toEqual(['Asm/PartA', 'Asm/PartB', 'Asm/PartC']);
  });

  it('稜線オブジェクトから部品名を解決できる', () => {
    expect(resolvePartName(s.edgeA)).toBe('Asm/PartA');
  });

  it('部品の表示/非表示を切り替えられる', () => {
    setPartVisible('Asm/PartA', false);
    expect(getPart('Asm/PartA').node.visible).toBe(false);
    expect(hiddenPartNames()).toEqual(['Asm/PartA']);
    showAllParts();
    expect(hiddenPartNames()).toEqual([]);
    expect(getPart('Asm/PartA').node.visible).toBe(true);
  });
});

describe('draw-call batching', () => {
  let s;
  beforeEach(() => { s = makeScene(); buildPartRegistry(s.root); });

  it('色が違ってもopacity/transparentが同じなら1つのBatchedMeshにまとめる', () => {
    // 色は per-instance color で保持されるため、バッチ分けの基準にする必要がない。
    // 赤2部品 + 緑1部品 → ドローコール削減のためバッチは1つにまとまる
    expect(batchesOf(s.root)).toHaveLength(1);
  });

  it('バッチをまとめても各部品固有の色はper-instance colorで保たれる', () => {
    const batch = batchesOf(s.root)[0];
    const { batchId: idA } = getPart('Asm/PartA').batched[0]; // 赤
    const { batchId: idC } = getPart('Asm/PartC').batched[0]; // 緑
    const colorA = new THREE.Color();
    const colorC = new THREE.Color();
    batch.getColorAt(idA, colorA);
    batch.getColorAt(idC, colorC);
    expect(colorA.getHexString()).toBe('ff0000');
    expect(colorC.getHexString()).toBe('00ff00');
  });

  it('元のMeshはツリーから取り除かれる（描画されない）', () => {
    let meshCount = 0;
    s.root.traverse((o) => { if (o.isMesh && !o.isBatchedMesh) meshCount += 1; });
    expect(meshCount).toBe(0);
  });

  it('batchIdから部品名を解決できる', () => {
    const entry = getPart('Asm/PartB');
    expect(entry.batched).toHaveLength(1);
    const { batch, batchId } = entry.batched[0];
    expect(resolveHitPartName({ object: batch, batchId })).toBe('Asm/PartB');
  });

  it('resolveHitPartNameはbatchIdToNameが無いBatchedMesh(LOD等)でも例外を投げずnullを返す', () => {
    const fakeBatch = { isBatchedMesh: true, userData: {} };
    expect(() => resolveHitPartName({ object: fakeBatch, batchId: 0 })).not.toThrow();
    expect(resolveHitPartName({ object: fakeBatch, batchId: 0 })).toBeNull();
  });

  it('部品を非表示にするとバッチ側インスタンスも非表示になる', () => {
    const { batch, batchId } = getPart('Asm/PartA').batched[0];
    setPartVisible('Asm/PartA', false);
    expect(batch.getVisibleAt(batchId)).toBe(false);
    showAllParts();
    expect(batch.getVisibleAt(batchId)).toBe(true);
  });

  it('テクスチャ付きマテリアルの部品はバッチ化せず従来のMeshのまま残す', () => {
    const s2 = makeScene();
    const texMesh = new THREE.Mesh(triGeometry(30), new THREE.MeshStandardMaterial({ map: new THREE.Texture() }));
    const partT = new THREE.Group();
    partT.name = 'Asm/PartT';
    partT.add(texMesh);
    s2.root.add(partT);
    buildPartRegistry(s2.root);
    expect(texMesh.parent).toBe(partT); // ツリーに残る
    expect(getPart('Asm/PartT').meshes).toContain(texMesh);
  });

  it('setPreciseVisibleでバッチの表示/非表示を一括切替できる', () => {
    const batch = batchesOf(s.root)[0];
    setPreciseVisible(false);
    expect(batch.visible).toBe(false);
    setPreciseVisible(true);
    expect(batch.visible).toBe(true);
  });

  it('setPreciseVisible(true)でも、エッジOFF時は稜線を表示しない', () => {
    setEdgesVisible(false); // エッジは既定OFF
    setPreciseVisible(false);
    setPreciseVisible(true);
    // 稜線は統合LineSegmentsとしてrootに存在するが、エッジOFFなので非表示のまま
    const lines = s.root.children.find((c) => c.isLineSegments);
    expect(lines.visible).toBe(false);
  });

  it('setPreciseVisible(true)は、エッジON時に稜線表示を復帰する', () => {
    setEdgesVisible(true);
    setPreciseVisible(false);
    const lines = s.root.children.find((c) => c.isLineSegments);
    expect(lines.visible).toBe(false); // 非表示中
    setPreciseVisible(true);
    expect(lines.visible).toBe(true); // 復帰
  });

  it('setPreciseVisibleの表示切替は、個別に隠した部品の状態を保つ', () => {
    const { batch, batchId } = getPart('Asm/PartA').batched[0];
    setPartVisible('Asm/PartA', false);
    setPreciseVisible(false);
    setPreciseVisible(true);
    expect(batch.getVisibleAt(batchId)).toBe(false); // 隠したまま保たれる
  });

  it('精密版を隠している間に部品を隠しても、復帰時に稜線インデックスが正しく組み直される', () => {
    setEdgesVisible(true);
    const lines = s.root.children.find((c) => c.isLineSegments);
    const fullCount = lines.geometry.drawRange.count; // PartA+PartB の全稜線
    setPreciseVisible(false);           // カメラ移動でLOD表示中（精密版と稜線を隠す）
    setPartVisible('Asm/PartA', false); // その間に部品を隠す（稜線組み直しは遅延される）
    setPreciseVisible(true);            // 静止して精密版に復帰
    expect(lines.visible).toBe(true);
    expect(lines.geometry.drawRange.count).toBeLessThan(fullCount); // PartAの稜線が除外
  });
});

describe('part selection', () => {
  let s;
  beforeEach(() => { s = makeScene(); buildPartRegistry(s.root); });

  it('選択するとインスタンス色がハイライト色になり、解除で元の色に戻る', () => {
    const { batch, batchId } = getPart('Asm/PartA').batched[0];
    const c = new THREE.Color();
    selectPart('Asm/PartA');
    expect(getSelectedPartName()).toBe('Asm/PartA');
    batch.getColorAt(batchId, c);
    expect(c.getHex()).not.toBe(0xff0000);
    clearSelection();
    expect(getSelectedPartName()).toBeNull();
    batch.getColorAt(batchId, c);
    expect(c.getHex()).toBe(0xff0000);
  });

  it('別の部品を選択すると前の選択は解除される', () => {
    const a = getPart('Asm/PartA').batched[0];
    const c = new THREE.Color();
    selectPart('Asm/PartA');
    selectPart('Asm/PartB');
    a.batch.getColorAt(a.batchId, c);
    expect(c.getHex()).toBe(0xff0000);
    expect(getSelectedPartName()).toBe('Asm/PartB');
  });

  it('setPartHighlightは選択と同じ見た目の一時強調を行う', () => {
    setPartHighlight('Asm/PartC', true);
    expect(getSelectedPartName()).toBe('Asm/PartC');
    setPartHighlight('Asm/PartC', false);
    expect(getSelectedPartName()).toBeNull();
  });
});

describe('raycast through batches', () => {
  let s;
  beforeEach(() => { s = makeScene(); buildPartRegistry(s.root); s.root.updateMatrixWorld(true); });

  function castAt(x) {
    const rc = new THREE.Raycaster(new THREE.Vector3(x, 0.2, 5), new THREE.Vector3(0, 0, -1));
    return rc.intersectObject(s.root, true);
  }

  it('バッチ経由でも部品にヒットし、部品名を解決できる', () => {
    const hits = castAt(10.2); // PartBの三角形の上
    expect(hits.length).toBeGreaterThan(0);
    expect(resolveHitPartName(hits[0])).toBe('Asm/PartB');
  });

  it('非表示にした部品にはヒットしない', () => {
    setPartVisible('Asm/PartB', false);
    expect(castAt(10.2)).toHaveLength(0);
  });
});

function mergedEdgesOf(root) {
  return root.children.find((c) => c.isLineSegments) ?? null;
}

describe('edges', () => {
  let s;
  beforeEach(() => { s = makeScene(); buildPartRegistry(s.root); });

  it('実ジオメトリを持つ稜線は1本のLineSegmentsに統合され、元はツリーから外れる', () => {
    expect(mergedEdgesOf(s.root)).not.toBeNull();
    expect(s.edgeA.parent).toBeNull();
    expect(s.edgeB.parent).toBeNull();
  });

  it('setEdgesVisibleで統合稜線の表示を切り替えられる（既定は非表示）', () => {
    const merged = mergedEdgesOf(s.root);
    expect(merged.visible).toBe(false);
    setEdgesVisible(true);
    expect(merged.visible).toBe(true);
    setEdgesVisible(false);
    expect(merged.visible).toBe(false);
  });

  it('エッジ表示中に部品を隠すと、その部品の区間だけが描画対象から外れる', () => {
    const merged = mergedEdgesOf(s.root);
    setEdgesVisible(true);
    expect(merged.geometry.drawRange.count).toBe(8); // PartA 4頂点 + PartB 4頂点
    setPartVisible('Asm/PartA', false);
    expect(merged.geometry.drawRange.count).toBe(4); // PartB分のみ
    const idx = merged.geometry.index;
    // 残った先頭4要素はPartBの区間（統合バッファ内オフセット4〜7）を指す
    expect([idx.getX(0), idx.getX(1), idx.getX(2), idx.getX(3)]).toEqual([4, 5, 6, 7]);
    showAllParts();
    expect(merged.geometry.drawRange.count).toBe(8);
  });

  it('エッジ非表示中の可視切替は組み直しを遅延し、表示ON時にまとめて反映される', () => {
    const merged = mergedEdgesOf(s.root);
    setPartVisible('Asm/PartA', false); // エッジOFFのまま
    expect(merged.geometry.drawRange.count).toBe(8); // まだ組み直さない
    setEdgesVisible(true);
    expect(merged.geometry.drawRange.count).toBe(4); // ONにした時点で反映
  });

  it('setPartsVisibleで複数部品を一括切替でき、稜線にも反映される', () => {
    const merged = mergedEdgesOf(s.root);
    setEdgesVisible(true);
    setPartsVisible(['Asm/PartA', 'Asm/PartB'], false);
    expect(getPart('Asm/PartA').node.visible).toBe(false);
    expect(getPart('Asm/PartB').node.visible).toBe(false);
    expect(merged.geometry.drawRange.count).toBe(0);
  });

  it('インデックス付き稜線はindex順に頂点を展開して統合される', () => {
    const s2 = makeScene();
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
      30, 0, 0,
      31, 0, 0,
      31, 1, 0,
    ]), 3));
    g.setIndex([0, 1, 1, 2]); // 3頂点を2線分=4頂点に展開
    const edgeI = new THREE.LineSegments(g, new THREE.LineBasicMaterial());
    const partI = new THREE.Group();
    partI.name = 'Asm/PartI';
    partI.add(new THREE.Mesh(triGeometry(30), new THREE.MeshStandardMaterial({ color: 0xff00ff })), edgeI);
    s2.root.add(partI);
    buildPartRegistry(s2.root);
    const merged = mergedEdgesOf(s2.root);
    expect(merged.geometry.drawRange.count).toBe(12); // PartA 4 + PartB 4 + PartI 4（index展開後）
    // PartIの区間（先頭のPartA 4頂点 + PartB 4頂点の後、オフセット8〜11）が
    // index [0,1,1,2] をposition順に展開した座標と一致することを値レベルで確認する
    const pos = merged.geometry.getAttribute('position');
    const got = [];
    for (let i = 8; i < 12; i++) got.push(pos.getX(i), pos.getY(i), pos.getZ(i));
    expect(got).toEqual([
      30, 0, 0,
      31, 0, 0,
      31, 0, 0,
      31, 1, 0,
    ]);
  });

  it('空ジオメトリの稜線は従来どおり個別にツリーへ残り、表示切替できる', () => {
    const s2 = makeScene();
    const legacyEdge = new THREE.LineSegments(new THREE.BufferGeometry());
    const partL = new THREE.Group();
    partL.name = 'Asm/PartL';
    partL.add(new THREE.Mesh(triGeometry(40), new THREE.MeshStandardMaterial({ color: 0x0000ff })), legacyEdge);
    s2.root.add(partL);
    buildPartRegistry(s2.root);
    expect(legacyEdge.parent).toBe(partL);
    setEdgesVisible(true);
    expect(legacyEdge.visible).toBe(true);
  });
});
