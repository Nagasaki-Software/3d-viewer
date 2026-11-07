/** 部品レジストリ: GLBの名前付きノードを部品として管理する。
 *
 * 描画は部品ごとのMeshではなく、色ごとにまとめたTHREE.BatchedMeshで行う
 * （部品数千のモデルでドローコールが部品数ぶん発生して操作が重くなるのを防ぐ）。
 * 部品ノード（Group）と稜線LineSegmentsはツリーに残し、注釈のローカル座標変換や
 * エッジ表示は従来どおりノード経由で行う。
 */
import * as THREE from 'three';

let registry = new Map(); // name -> { node, meshes: Mesh[], edges: LineSegments[], batched: [{batch, batchId, baseColor}] }
let selected = null; // { name, restores: [{mesh, material}], batchRestores: [{batch, batchId, baseColor}] } | null
let activeBatches = []; // 現在のモデルのBatchedMesh一覧（再構築時に破棄する）
let mergedEdges = null; // { lines: LineSegments, ranges: Map(name -> [{start,count}]), indexArray: Uint32Array }
let edgeIndexDirty = false; // エッジ非表示中に可視状態が変わった（次の表示ONで組み直しが必要）
let edgesEnabled = false; // 稜線表示ON/OFFの記憶（LOD切替時の稜線復帰に使う）
const HIGHLIGHT_COLOR = new THREE.Color(0x4fc3f7);

function hasMeshDescendant(obj) {
  let found = false;
  obj.traverse((o) => { if (o.isMesh || o.isLineSegments) found = true; });
  return found;
}

/** バッチ化の対象か（テクスチャ付きは色だけで表現できないため従来描画のまま残す） */
export function isBatchable(mesh) {
  const m = mesh.material;
  if (!mesh.geometry?.getAttribute('position')) return false; // 空ジオメトリは対象外
  return m && !Array.isArray(m) && !m.map && m.color !== undefined;
}

/** バッチ分けの基準。色はper-instance colorで保持するため基準に含めない
 * （色ごとに分けるとCADアセンブリで色数=ドローコール数になり、まとめる意味が薄れる） */
export function materialKey(material) {
  return `${material.opacity}|${material.transparent}`;
}

/** バッチへ追加できる形にジオメトリを正規化する（position+normal+index のみのコピーを作る） */
export function normalizeGeometry(geometry) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', geometry.getAttribute('position').clone());
  if (geometry.getAttribute('normal')) {
    g.setAttribute('normal', geometry.getAttribute('normal').clone());
  } else {
    g.computeVertexNormals();
  }
  if (geometry.index) {
    g.setIndex(geometry.index.clone());
  } else {
    const count = g.getAttribute('position').count;
    g.setIndex([...Array(count).keys()]);
  }
  return g;
}

/** 全部品の稜線を1本のLineSegmentsに統合する（エッジ表示ONでもドローコール1回にする）。
 * 全稜線が単一マテリアル前提（変換ツールは共有 "edge" マテリアル1個を出力）。
 * 部品ごとの表示/非表示はインデックスの組み直し（rebuildEdgeIndex）で行う */
function mergeEdges(root, rootInv) {
  const items = []; // { name, line }
  registry.forEach((entry, name) => {
    entry.edges.forEach((line) => {
      if (line.geometry?.getAttribute('position')) items.push({ name, line });
    });
  });
  if (items.length === 0) return null;

  // index付きジオメトリはindex順に頂点を展開して統合する
  const vertexCountOf = (line) =>
    (line.geometry.index ? line.geometry.index.count : line.geometry.getAttribute('position').count);
  const total = items.reduce((s, { line }) => s + vertexCountOf(line), 0);
  const positions = new Float32Array(total * 3);
  const ranges = new Map();
  const rel = new THREE.Matrix4();
  const v = new THREE.Vector3();
  let offset = 0;
  items.forEach(({ name, line }) => {
    const pos = line.geometry.getAttribute('position');
    const idx = line.geometry.index;
    const count = idx ? idx.count : pos.count;
    rel.multiplyMatrices(rootInv, line.matrixWorld);
    for (let i = 0; i < count; i++) {
      v.fromBufferAttribute(pos, idx ? idx.getX(i) : i).applyMatrix4(rel);
      positions[(offset + i) * 3] = v.x;
      positions[(offset + i) * 3 + 1] = v.y;
      positions[(offset + i) * 3 + 2] = v.z;
    }
    if (!ranges.has(name)) ranges.set(name, []);
    ranges.get(name).push({ start: offset, count });
    offset += count;

    line.removeFromParent();
    line.geometry.dispose();
  });

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const indexArray = new Uint32Array(total);
  g.setIndex(new THREE.BufferAttribute(indexArray, 1));
  const lines = new THREE.LineSegments(g, items[0].line.material.clone());
  // 部品ピッキングはBatchedMesh側で行う。統合稜線は部品単位で可視管理できず
  // （遅延組み直し中は非表示部品の区間が残る）、誤ヒットの元になるため対象外にする
  lines.raycast = () => {};
  lines.visible = false; // エッジは既定OFF（既存仕様）
  return { lines, ranges, indexArray };
}

/** 表示中の部品の稜線区間だけでインデックスを組み直す */
function rebuildEdgeIndex() {
  if (!mergedEdges) return;
  const { lines, ranges, indexArray } = mergedEdges;
  let n = 0;
  registry.forEach((entry, name) => {
    if (!entry.node.visible) return;
    (ranges.get(name) ?? []).forEach(({ start, count }) => {
      for (let i = 0; i < count; i++) indexArray[n++] = start + i;
    });
  });
  lines.geometry.setDrawRange(0, n);
  const indexAttr = lines.geometry.index;
  indexAttr.clearUpdateRanges();
  indexAttr.addUpdateRange(0, n); // GPU転送は使用中の先頭n要素だけに限定
  indexAttr.needsUpdate = true;
}

/** エッジ表示中は即時、非表示中は次にONになるまで組み直しを遅延する */
function syncEdgeIndex() {
  if (!mergedEdges) return;
  if (mergedEdges.lines.visible) {
    rebuildEdgeIndex();
    edgeIndexDirty = false;
  } else {
    edgeIndexDirty = true;
  }
}

/** モデルルートを走査して部品レジストリを構築し、色ごとのBatchedMeshをrootに追加する */
export function buildPartRegistry(root) {
  clearSelection(); // モデル再読込時に古い選択（破棄済みノードへの参照）を残さない
  activeBatches.forEach((b) => {
    b.removeFromParent();
    b.dispose();
    b.material.dispose();
  });
  activeBatches = [];
  if (mergedEdges) {
    mergedEdges.lines.removeFromParent();
    mergedEdges.lines.geometry.dispose();
    mergedEdges.lines.material.dispose();
    mergedEdges = null;
  }
  edgeIndexDirty = false;
  registry = new Map();

  root.traverse((obj) => {
    // 部品 = 名前付きかつメッシュ子孫を持つノード。祖先に既登録の部品があれば子は部品でない
    if (!obj.name || !hasMeshDescendant(obj)) return;
    for (let p = obj.parent; p; p = p.parent) {
      if (registry.has(p.name)) return;
    }
    const meshes = [], edges = [];
    obj.traverse((o) => {
      if (o.isLineSegments) edges.push(o);
      else if (o.isMesh) meshes.push(o);
      o.userData.partName = obj.name; // タップ→部品名解決用
    });
    registry.set(obj.name, { node: obj, meshes, edges, batched: [] });
  });

  // ---- 色ごとにBatchedMeshへ集約 ----
  root.updateMatrixWorld(true);
  const rootInv = new THREE.Matrix4().copy(root.matrixWorld).invert();

  const groups = new Map(); // key -> { material, items: [{name, mesh}] }
  registry.forEach((entry, name) => {
    entry.meshes.forEach((mesh) => {
      if (!isBatchable(mesh)) return;
      const key = materialKey(mesh.material);
      if (!groups.has(key)) groups.set(key, { material: mesh.material, items: [] });
      groups.get(key).items.push({ name, mesh });
    });
  });

  groups.forEach(({ material, items }) => {
    const normalized = items.map(({ mesh }) => normalizeGeometry(mesh.geometry));
    const totalVerts = normalized.reduce((s, g) => s + g.getAttribute('position').count, 0);
    const totalIndices = normalized.reduce((s, g) => s + g.index.count, 0);

    // 部品の色はper-instance colorで持つ（マテリアルは白）。選択強調を
    // マテリアル差し替えではなく色の置換で行えるようにするため
    const batchMaterial = material.clone();
    batchMaterial.color = new THREE.Color(0xffffff);
    batchMaterial.map = null;

    const batch = new THREE.BatchedMesh(items.length, totalVerts, totalIndices, batchMaterial);
    batch.userData.batchIdToName = new Map();

    items.forEach(({ name, mesh }, i) => {
      // 色はopacity/transparentが同じでも部品ごとに異なりうるため、グループ代表の
      // materialではなく各部品自身のmaterial.colorを使う
      const baseColor = mesh.material.color.clone();
      const batchId = batch.addInstance(batch.addGeometry(normalized[i]));
      const rel = new THREE.Matrix4().multiplyMatrices(rootInv, mesh.matrixWorld);
      batch.setMatrixAt(batchId, rel);
      batch.setColorAt(batchId, baseColor);
      batch.userData.batchIdToName.set(batchId, name);
      registry.get(name).batched.push({ batch, batchId, baseColor });
      normalized[i].dispose();

      // 元のMeshは描画ツリーから外し、GPUに載る前にジオメトリを解放する
      mesh.removeFromParent();
      mesh.geometry.dispose();
    });

    root.add(batch);
    activeBatches.push(batch);
  });

  // entry.meshes にはバッチ化されなかった（テクスチャ付き等の）Meshだけを残す
  registry.forEach((entry) => {
    entry.meshes = entry.meshes.filter((m) => m.parent !== null);
  });

  mergedEdges = mergeEdges(root, rootInv);
  if (mergedEdges) {
    root.add(mergedEdges.lines);
    rebuildEdgeIndex();
  }
  // entry.edges にはツリーに残った（空ジオメトリ等の）稜線だけを残す
  registry.forEach((entry) => {
    entry.edges = entry.edges.filter((e) => e.parent !== null);
  });
}

export function getPartNames() { return [...registry.keys()]; }
export function getPart(name) { return registry.get(name) ?? null; }
export function resolvePartName(obj) { return obj?.userData?.partName ?? null; }

/** Raycasterのヒット結果から部品名を解決する（バッチ経由のヒットはbatchIdで引く） */
export function resolveHitPartName(hit) {
  if (!hit) return null;
  if (hit.object?.isBatchedMesh && hit.batchId !== undefined) {
    return hit.object.userData.batchIdToName?.get(hit.batchId) ?? null;
  }
  return resolvePartName(hit.object);
}

export function setPartVisible(name, visible) {
  setPartsVisible([name], visible);
}

/** 複数部品の表示/非表示を一括で切り替える（稜線インデックスの組み直しは1回だけ） */
export function setPartsVisible(names, visible) {
  names.forEach((name) => {
    const part = registry.get(name);
    if (!part) return;
    part.node.visible = visible;
    part.batched.forEach(({ batch, batchId }) => batch.setVisibleAt(batchId, visible));
  });
  syncEdgeIndex();
}

export function hiddenPartNames() {
  return [...registry.entries()].filter(([, p]) => !p.node.visible).map(([n]) => n);
}

export function showAllParts() {
  registry.forEach((p) => {
    p.node.visible = true;
    p.batched.forEach(({ batch, batchId }) => batch.setVisibleAt(batchId, true));
  });
  syncEdgeIndex();
}

/** 統合稜線の表示を適用する。表示に戻す際、非表示中に遅延させた
 * インデックス組み直し(edgeIndexDirty)があればここで反映して、稜線が
 * 古い部品可視状態のまま表示されるのを防ぐ */
function applyEdgeVisible(visible) {
  if (!mergedEdges) return;
  mergedEdges.lines.visible = visible;
  if (visible && edgeIndexDirty) {
    rebuildEdgeIndex();
    edgeIndexDirty = false;
  }
}

/** エッジ（稜線）表示の一括ON/OFF */
export function setEdgesVisible(visible) {
  edgesEnabled = visible;
  applyEdgeVisible(visible);
  registry.forEach((p) => p.edges.forEach((e) => { e.visible = visible; }));
}

/** 精密版（色バッチと統合稜線）の表示/非表示を一括で切り替える。
 * LOD(操作中の軽量表示)へ切り替える間だけ精密版を隠すために使う。
 * 個々の部品のsetVisibleAt状態はバッチのvisible切替では変わらないため、
 * 表示に戻しても非表示にした部品は非表示のまま保たれる。
 * 稜線はエッジ表示ONのときだけ復帰させ、遅延された組み直しも反映する */
export function setPreciseVisible(visible) {
  activeBatches.forEach((b) => { b.visible = visible; });
  applyEdgeVisible(visible && edgesEnabled);
}

export function getSelectedPartName() { return selected?.name ?? null; }

/** 選択を解除し、強調表示を元に戻す */
export function clearSelection() {
  if (!selected) return;
  selected.restores.forEach(({ mesh, material }) => {
    mesh.material.dispose();
    mesh.material = material;
  });
  selected.batchRestores.forEach(({ batch, batchId, baseColor }) => {
    batch.setColorAt(batchId, baseColor);
  });
  selected = null;
}

/** 部品を選択して強調表示する（既存選択は解除） */
export function selectPart(name) {
  clearSelection();
  const part = registry.get(name);
  if (!part) return;
  // バッチ化されていないMesh（テクスチャ付き等）は従来どおりマテリアル差し替え
  const restores = part.meshes.map((mesh) => {
    const material = mesh.material;
    const hl = material.clone();
    if (hl.emissive !== undefined) hl.emissive.setHex(0x1a4f66);
    mesh.material = hl;
    return { mesh, material };
  });
  const batchRestores = part.batched.map(({ batch, batchId, baseColor }) => {
    batch.setColorAt(batchId, HIGHLIGHT_COLOR);
    return { batch, batchId, baseColor };
  });
  selected = { name, restores, batchRestores };
}

/** 一時的な強調（ブックマーク等から使う。選択と同じ見た目） */
export function setPartHighlight(name, on) {
  if (on) selectPart(name); else clearSelection();
}

/** obj自身と祖先すべてが visible=true かどうか（Raycasterは非表示の枝も辿るため必要） */
export function isActuallyVisible(obj) {
  for (let o = obj; o; o = o.parent) {
    if (!o.visible) return false;
  }
  return true;
}
