# エッジ表示のバッチ化 + WebGLコンテキスト喪失からの自動復旧 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 部品数千のモデルでもエッジ表示を実用速度で使えるようにし、GPUドライバリセット（WebGLコンテキスト喪失）で画面が黒いまま止まる問題から自動復旧できるようにする。

**Architecture:**
エッジ（稜線）は現在部品ごとの LineSegments（部品数ぶんのドローコール）。これを部品本体のBatchedMesh化と同様に、モデル1つあたり1本の LineSegments に統合する（エッジは全部品で単一マテリアルなので1ドローコール）。部品ごとの非表示は、統合ジオメトリのインデックスを「表示中の部品の範囲だけ」で組み直すことで実現する。
コンテキスト喪失は `webglcontextlost` / `webglcontextrestored` イベントで検知し、`preventDefault()` でブラウザの自動復旧を有効化。復旧待ちのユーザー向けメッセージと、復旧しない場合の案内をタイマーで出す（three.js r184 は restored 後に内部状態とGPUバッファを自動再構築するため、再アップロード処理は不要）。

**Tech Stack:** three.js 0.184（LineSegments / BufferGeometry.setDrawRange）、vitest

**前提知識:**
- 変換ツール出力のGLBでは、エッジは mode:1（LINES）・非インデックス・全部品共有の単一マテリアル "edge"。GLTFLoaderはこれを部品ノード配下の LineSegments として生成する
- `viewer/src/parts.js` は直前のバッチ化改修で、部品本体を色ごとの BatchedMesh に統合済み。エッジはまだ部品ごとに残っている
- テスト実行はすべて `viewer/` ディレクトリで `npm test -- --run <ファイル>`
- **削除系コマンド（rm等）はユーザー承認なしに実行しないこと**

---

### Task 1: エッジ統合のテスト（RED）

**Files:**
- Modify: `viewer/tests/parts.test.js`

- [ ] **Step 1: makeSceneのエッジに実ジオメトリを持たせ、エッジ統合のテストを追加する**

`viewer/tests/parts.test.js` の `makeScene` 内、`const edgeA = new THREE.LineSegments(new THREE.BufferGeometry());` を次に置き換える:

```js
  const edgeA = new THREE.LineSegments(lineGeometry(0), new THREE.LineBasicMaterial());
```

`triGeometry` の下にヘルパーを追加:

```js
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
```

`describe('edges', ...)` ブロック全体を次に置き換える:

```js
function mergedEdgesOf(root) {
  return root.children.find((c) => c.isLineSegments) ?? null;
}

describe('edges', () => {
  let s;
  beforeEach(() => { s = makeScene(); buildPartRegistry(s.root); });

  it('実ジオメトリを持つ稜線は1本のLineSegmentsに統合され、元はツリーから外れる', () => {
    expect(mergedEdgesOf(s.root)).not.toBeNull();
    expect(s.edgeA.parent).toBeNull();
  });

  it('setEdgesVisibleで統合稜線の表示を切り替えられる（既定は非表示）', () => {
    const merged = mergedEdgesOf(s.root);
    expect(merged.visible).toBe(false);
    setEdgesVisible(true);
    expect(merged.visible).toBe(true);
    setEdgesVisible(false);
    expect(merged.visible).toBe(false);
  });

  it('部品を非表示にするとその部品の稜線区間が描画対象から外れる', () => {
    const merged = mergedEdgesOf(s.root);
    const fullCount = merged.geometry.drawRange.count;
    expect(fullCount).toBe(4); // PartAの2線分=4頂点
    setPartVisible('Asm/PartA', false);
    expect(merged.geometry.drawRange.count).toBe(0);
    showAllParts();
    expect(merged.geometry.drawRange.count).toBe(fullCount);
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
```

- [ ] **Step 2: 失敗することを確認する**

Run: `npm test -- --run tests/parts.test.js`
Expected: FAIL（`mergedEdgesOf(s.root)` が null、`s.edgeA.parent` が partA のまま等、新テスト4件が失敗。既存テストは成功のまま）

---

### Task 2: parts.js のエッジ統合実装（GREEN）

**Files:**
- Modify: `viewer/src/parts.js`

- [ ] **Step 1: モジュール状態と統合関数を追加する**

`let activeBatches = [];` の直後に追加:

```js
let mergedEdges = null; // { lines: LineSegments, ranges: Map(name -> [{start,count}]), indexArray: Uint32Array }
```

`normalizeGeometry` 関数の下に追加:

```js
/** 全部品の稜線を1本のLineSegmentsに統合する（エッジ表示ONでもドローコール1回にする）。
 * 部品ごとの表示/非表示はインデックスの組み直し（rebuildEdgeIndex）で行う */
function mergeEdges(root, rootInv) {
  const items = []; // { name, line }
  registry.forEach((entry, name) => {
    entry.edges.forEach((line) => {
      if (line.geometry?.getAttribute('position')) items.push({ name, line });
    });
  });
  if (items.length === 0) return null;

  const total = items.reduce((s, { line }) => s + line.geometry.getAttribute('position').count, 0);
  const positions = new Float32Array(total * 3);
  const ranges = new Map();
  const rel = new THREE.Matrix4();
  const v = new THREE.Vector3();
  let offset = 0;
  items.forEach(({ name, line }) => {
    const pos = line.geometry.getAttribute('position');
    rel.multiplyMatrices(rootInv, line.matrixWorld);
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(rel);
      positions[(offset + i) * 3] = v.x;
      positions[(offset + i) * 3 + 1] = v.y;
      positions[(offset + i) * 3 + 2] = v.z;
    }
    if (!ranges.has(name)) ranges.set(name, []);
    ranges.get(name).push({ start: offset, count: pos.count });
    offset += pos.count;

    line.removeFromParent();
    line.geometry.dispose();
  });

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const indexArray = new Uint32Array(total);
  g.setIndex(new THREE.BufferAttribute(indexArray, 1));
  const lines = new THREE.LineSegments(g, items[0].line.material.clone());
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
  lines.geometry.index.needsUpdate = true;
}
```

- [ ] **Step 2: buildPartRegistry に統合処理を組み込む**

`buildPartRegistry` 冒頭の `activeBatches = [];` の直後に追加:

```js
  if (mergedEdges) {
    mergedEdges.lines.removeFromParent();
    mergedEdges.lines.geometry.dispose();
    mergedEdges.lines.material.dispose();
    mergedEdges = null;
  }
```

同関数末尾の `registry.forEach((entry) => { entry.meshes = entry.meshes.filter(...) });` の直後に追加:

```js
  mergedEdges = mergeEdges(root, rootInv);
  if (mergedEdges) {
    root.add(mergedEdges.lines);
    rebuildEdgeIndex();
  }
  // entry.edges にはツリーに残った（空ジオメトリ等の）稜線だけを残す
  registry.forEach((entry) => {
    entry.edges = entry.edges.filter((e) => e.parent !== null);
  });
```

- [ ] **Step 3: 表示切替関数を統合稜線に対応させる**

`setPartVisible` の末尾（batched更新の後）に1行追加:

```js
export function setPartVisible(name, visible) {
  const part = registry.get(name);
  if (!part) return;
  part.node.visible = visible;
  part.batched.forEach(({ batch, batchId }) => batch.setVisibleAt(batchId, visible));
  rebuildEdgeIndex();
}
```

`showAllParts` は部品ごとの再構築を避けて最後に1回だけ組み直す形に置き換える:

```js
export function showAllParts() {
  registry.forEach((p) => {
    p.node.visible = true;
    p.batched.forEach(({ batch, batchId }) => batch.setVisibleAt(batchId, true));
  });
  rebuildEdgeIndex();
}
```

`setEdgesVisible` を置き換える:

```js
/** エッジ（稜線）表示の一括ON/OFF */
export function setEdgesVisible(visible) {
  if (mergedEdges) mergedEdges.lines.visible = visible;
  registry.forEach((p) => p.edges.forEach((e) => { e.visible = visible; }));
}
```

- [ ] **Step 4: テストが通ることを確認する**

Run: `npm test -- --run tests/parts.test.js`
Expected: PASS（全件）

Run: `npm test -- --run`
Expected: PASS（77件+新規。annotations/bookmarks等の既存テストに影響がないこと）

- [ ] **Step 5: コミット**

```bash
git add viewer/src/parts.js viewer/tests/parts.test.js
git commit -m "Merge part edge lines into a single draw call"
```

---

### Task 3: コンテキスト喪失復旧ヘルパー（RED→GREEN）

**Files:**
- Create: `viewer/src/context-recovery.js`
- Create: `viewer/tests/context-recovery.test.js`

- [ ] **Step 1: 失敗するテストを書く**

`viewer/tests/context-recovery.test.js` を新規作成:

```js
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createContextRecovery } from '../src/context-recovery.js';

describe('createContextRecovery', () => {
  let messages;
  let recovery;
  beforeEach(() => {
    vi.useFakeTimers();
    messages = [];
    recovery = createContextRecovery({
      showMessage: (text) => messages.push(text),
      timeoutMs: 15000,
    });
  });
  afterEach(() => { vi.useRealTimers(); });

  it('喪失時に復旧中メッセージを出す', () => {
    recovery.onLost();
    expect(messages[0]).toContain('復旧');
  });

  it('時間内に復旧しなければ再読み込み案内を出す', () => {
    recovery.onLost();
    vi.advanceTimersByTime(15000);
    expect(messages.at(-1)).toContain('再読み込み');
  });

  it('復旧したら案内タイマーを止めて復旧メッセージを出す', () => {
    recovery.onLost();
    recovery.onRestored();
    vi.advanceTimersByTime(60000);
    expect(messages.at(-1)).toContain('復旧しました');
    expect(messages.some((m) => m.includes('再読み込み'))).toBe(false);
  });

  it('喪失が2回続いてもタイマーが多重にならない', () => {
    recovery.onLost();
    vi.advanceTimersByTime(5000);
    recovery.onLost();
    vi.advanceTimersByTime(10000); // 1回目から15秒経過、2回目からは10秒
    expect(messages.some((m) => m.includes('再読み込み'))).toBe(false);
    vi.advanceTimersByTime(5000); // 2回目から15秒経過
    expect(messages.at(-1)).toContain('再読み込み');
  });
});
```

- [ ] **Step 2: 失敗することを確認する**

Run: `npm test -- --run tests/context-recovery.test.js`
Expected: FAIL（`Cannot find module '../src/context-recovery.js'`）

- [ ] **Step 3: 実装する**

`viewer/src/context-recovery.js` を新規作成:

```js
/** WebGLコンテキスト喪失（GPUドライバのリセット等で描画が止まる現象）からの復旧監視。
 * three.js は contextrestored 後に内部状態とGPUバッファを自動再構築するため、
 * ここでの仕事はユーザーへの状況通知と「復旧しない場合の案内」のみ。
 * 自動リロードは行わない（未保存の注釈が失われるため）。
 */
export function createContextRecovery({ showMessage, timeoutMs = 15000 }) {
  let timer = null;
  return {
    onLost() {
      showMessage('描画がリセットされました。復旧を試みています…', timeoutMs);
      clearTimeout(timer);
      timer = setTimeout(() => {
        showMessage('自動復旧できませんでした。ブラウザの再読み込みを行ってください', 60000);
      }, timeoutMs);
    },
    onRestored() {
      clearTimeout(timer);
      timer = null;
      showMessage('描画が復旧しました');
    },
  };
}
```

- [ ] **Step 4: テストが通ることを確認する**

Run: `npm test -- --run tests/context-recovery.test.js`
Expected: PASS（4件）

- [ ] **Step 5: コミット**

```bash
git add viewer/src/context-recovery.js viewer/tests/context-recovery.test.js
git commit -m "Add WebGL context loss recovery helper"
```

---

### Task 4: viewer.js への配線とブラウザ検証

**Files:**
- Modify: `viewer/src/viewer.js`（initViewer内、renderer生成の直後）

- [ ] **Step 1: イベントリスナーを配線する**

`viewer/src/viewer.js` の import 群に追加:

```js
import { showMessage } from './ui.js';
import { createContextRecovery } from './context-recovery.js';
```

`initViewer` 内、`container.appendChild(renderer.domElement);` の直後に追加:

```js
  // GPUドライバリセット等で描画が止まったとき、ブラウザの自動復旧を有効にして状況を通知する
  const recovery = createContextRecovery({ showMessage });
  renderer.domElement.addEventListener('webglcontextlost', (e) => {
    e.preventDefault(); // これを呼ばないとブラウザは復旧処理を行わない
    recovery.onLost();
  });
  renderer.domElement.addEventListener('webglcontextrestored', () => recovery.onRestored());
```

- [ ] **Step 2: 全テストが通ることを確認する**

Run: `npm test -- --run`
Expected: PASS（全件）

- [ ] **Step 3: ブラウザでエッジ統合を検証する**

1. preview_start（name: "viewer"）で開発サーバーを起動し `http://localhost:4000/?model=Scania-8x4` を開く
2. 「表示設定 > エッジ表示」をONにし、エラーがないこと・エッジが描画されることを確認
   （`read_console_messages` でエラーなし、可能ならスクリーンショット）
3. 部品をタップ→「隠す」で、その部品のエッジも一緒に消えることを確認
4. 「すべて再表示」でエッジも戻ることを確認

- [ ] **Step 4: ブラウザでコンテキスト喪失復旧を検証する**

javascript_tool で強制的に喪失→復旧させる:

```js
(function(){
  const c = document.querySelector('canvas');
  const gl = c.getContext('webgl2') || c.getContext('webgl');
  const ext = gl.getExtension('WEBGL_lose_context');
  ext.loseContext();
  setTimeout(() => ext.restoreContext(), 2000);
  return 'triggered';
})();
```

確認事項:
- 喪失直後に「描画がリセットされました。復旧を試みています…」が表示される
- 2秒後の復旧で「描画が復旧しました」が表示され、モデルが再描画される（タップ選択が再び機能する）

- [ ] **Step 5: コミット**

```bash
git add viewer/src/viewer.js
git commit -m "Wire context loss recovery into the renderer"
```

---

## Self-Review 結果

- スペック網羅: エッジ統合（Task 1-2）・部品非表示との連動（Task 2 Step 3）・喪失検知と通知（Task 3-4）・復旧検証（Task 4 Step 4）✓
- プレースホルダなし・全ステップに実コード/実コマンドあり ✓
- 型・命名の整合: `mergedEdges.{lines,ranges,indexArray}` / `rebuildEdgeIndex` / `createContextRecovery.{onLost,onRestored}` で統一 ✓
