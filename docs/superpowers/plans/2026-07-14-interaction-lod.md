# 操作中の簡易表示（LOD）実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** カメラが動いている間だけ大幅に簡略化した軽量モデルを表示し、静止したら精密モデルに戻すことで、巨大アセンブリの操作fpsを改善する。

**Architecture:** コンバータが通常GLBに加えて超簡略版 `<name>_lod.glb` も出力する。ビューアはサーバーから両方を読み込み、精密版の子として軽量版を重ね、`animate()` ループでカメラの動きを検知して表示を切り替える。軽量版は部品ごとの状態を持たない表示専用オブジェクト。既存モデル（_lod.glbなし）は自動的に従来動作にフォールバックする。

**Tech Stack:** Python (gltfpack/subprocess, pytest), JavaScript (three.js BatchedMesh, GLTFLoader, vitest)

**設計書:** `docs/superpowers/specs/2026-07-14-interaction-lod-design.md`

---

### Task 1: コンバータに超簡略版の圧縮関数を追加

**Files:**
- Modify: `converter/src/compress.py`
- Test: `converter/tests/test_compress.py`

gltfpack呼び出しの共通部分を `_run_gltfpack` に切り出し、既存 `compress_glb` と新規 `compress_glb_lod`（三角形数を目標5%まで `-sa` で強制簡略化）から使う。

- [ ] **Step 1: 失敗するテストを書く**

`converter/tests/test_compress.py` の末尾に追加:

```python
def test_compress_lod_passes_aggressive_flags(tmp_path, monkeypatch):
    # LOD(操作中の軽量表示)用は三角形数を大幅に削るため、目標比率5%を
    # 品質より優先する -sa と組み合わせる
    import subprocess

    import src.compress as c

    captured = {}

    def fake_run(args, **kwargs):
        captured["args"] = args
        out_path = Path(args[args.index("-o") + 1])
        out_path.write_bytes(b"dummy")
        return subprocess.CompletedProcess(args, 0, "", "")

    monkeypatch.setattr(c, "find_gltfpack", lambda: Path("gltfpack.exe"))
    monkeypatch.setattr(c.subprocess, "run", fake_run)

    c.compress_glb_lod(tmp_path / "a.glb", tmp_path / "b_lod.glb")

    args = captured["args"]
    assert "-sa" in args
    ratio = float(args[args.index("-si") + 1])
    assert 0 < ratio <= 0.1  # 大幅削減
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `cd converter && .venv/Scripts/python.exe -m pytest tests/test_compress.py -v`
Expected: FAIL（`compress_glb_lod` が存在せず ImportError/AttributeError）

- [ ] **Step 3: 実装する**

`converter/src/compress.py` の `_SIMPLIFY_RATIO = 0.5` の直後に追加:

```python
# LOD(操作中の軽量表示)用の削減比率。静止時は精密版を表示するため、
# 多少の粗さより三角形数の大幅削減を優先する（-saで比率を強制）
_LOD_SIMPLIFY_RATIO = 0.05
```

`compress_glb` 関数全体を、共通化した以下の3関数で置き換える:

```python
def _run_gltfpack(src: Path, dst: Path, extra_args: list[str]) -> None:
    exe = find_gltfpack()
    if exe is None:
        raise RuntimeError(
            "gltfpack.exe が見つかりません。converter/bin/ に配置してください"
        )
    # 一時ファイルへ出力し成功時のみdstへ置き換える（失敗時にdstを壊さない）。
    # gltfpackは出力拡張子が.gltf/.glbであることを要求するため拡張子は保持する
    tmp_dst = dst.with_name(dst.stem + ".tmp" + dst.suffix)
    result = subprocess.run(
        [str(exe), "-i", str(src), "-o", str(tmp_dst), *extra_args],
        capture_output=True, text=True, errors="replace",
    )
    if result.returncode != 0:
        raise RuntimeError(f"圧縮に失敗しました: {result.stderr.strip()}")
    os.replace(tmp_dst, dst)


def compress_glb(src: Path, dst: Path) -> None:
    # -cc: meshopt高圧縮  -kn: ノード名を保持（部品選択に必須）
    # -si: 三角形数を比率で簡略化（誤差上限は既定値=形状の破綻を防ぐ）
    _run_gltfpack(src, dst, ["-cc", "-kn", "-si", str(_SIMPLIFY_RATIO)])


def compress_glb_lod(src: Path, dst: Path) -> None:
    # 操作中の軽量表示専用。部品選択はしないのでノード名保持(-kn)は不要。
    # -sa で目標比率を品質より優先して大幅に削減する
    _run_gltfpack(src, dst, ["-cc", "-si", str(_LOD_SIMPLIFY_RATIO), "-sa"])
```

- [ ] **Step 4: テストが通ることを確認**

Run: `cd converter && .venv/Scripts/python.exe -m pytest tests/test_compress.py -v`
Expected: PASS（新規テスト＋既存3テストすべて）

- [ ] **Step 5: コミット**

```bash
git add converter/src/compress.py converter/tests/test_compress.py
git commit -m "Add aggressive LOD compression to converter"
```

---

### Task 2: パイプラインで _lod.glb を生成する

**Files:**
- Modify: `converter/src/pipeline.py`
- Test: `converter/tests/test_pipeline.py`

**Files:**
- Modify: `converter/src/pipeline.py:45-49`（compressステージ）

- [ ] **Step 1: 失敗するテストを書く**

`converter/tests/test_pipeline.py` の `test_convert_reports_triangles_after_simplification` の直後に追加:

```python
def test_convert_generates_lod_file(monkeypatch, fixture_step, tmp_path):
    # 通常GLBに加え、操作中の軽量表示用 <name>_lod.glb も出力する。
    # 統計(triangles)は通常版のみを反映する
    import src.pipeline as pipeline

    def fake_compress(src, dst):
        dst.write_bytes(_make_glb(10))

    def fake_compress_lod(src, dst):
        dst.write_bytes(_make_glb(1))

    monkeypatch.setattr(pipeline, "compress_glb", fake_compress)
    monkeypatch.setattr(pipeline, "compress_glb_lod", fake_compress_lod)

    out = tmp_path / "model.glb"
    stats = pipeline.convert(fixture_step, out, quality="standard",
                              progress=lambda s: None)

    assert (tmp_path / "model_lod.glb").exists()
    assert stats["triangles"] == 10  # 通常版の三角形数（LOD版の1ではない）
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `cd converter && .venv/Scripts/python.exe -m pytest tests/test_pipeline.py::test_convert_generates_lod_file -v`
Expected: FAIL（`model_lod.glb` が生成されない）

- [ ] **Step 3: 実装する**

`converter/src/pipeline.py` の import 行を変更:

```python
from src.compress import compress_glb, compress_glb_lod
```

`convert()` の compress ブロックを次に置き換える（`compress_glb(raw, out_path)` の後に LOD 生成を追加。同じ tempdir 内で raw を再利用する）:

```python
        progress("compress")
        with tempfile.TemporaryDirectory() as td:
            raw = Path(td) / "raw.glb"
            raw.write_bytes(glb)
            compress_glb(raw, out_path)
            # 操作中の軽量表示用。同じ生GLBを別パラメータで再圧縮するだけなので追加コストは小さい
            lod_path = out_path.with_name(out_path.stem + "_lod" + out_path.suffix)
            compress_glb_lod(raw, lod_path)
```

- [ ] **Step 4: テストが通ることを確認**

Run: `cd converter && .venv/Scripts/python.exe -m pytest tests/test_pipeline.py -v`
Expected: PASS（新規＋既存すべて）

- [ ] **Step 5: コンバータ全体テストで回帰がないことを確認**

Run: `cd converter && .venv/Scripts/python.exe -m pytest tests/`
Expected: 全PASS

- [ ] **Step 6: コミット**

```bash
git add converter/src/pipeline.py converter/tests/test_pipeline.py
git commit -m "Generate LOD glb alongside normal glb in pipeline"
```

---

### Task 3: parts.js のバッチ化ヘルパーをエクスポートし、精密版の一括表示切替を追加

**Files:**
- Modify: `converter` なし。`viewer/src/parts.js`
- Test: `viewer/tests/parts.test.js`

`isBatchable`/`materialKey`/`normalizeGeometry` を lod.js から再利用できるよう `export` する。さらに LOD 切替時に精密版（バッチ＋稜線）を一括で表示/非表示する `setInteractiveVisible` を追加する。稜線復帰のため `setEdgesVisible` の状態を内部フラグ `edgesEnabled` に記録する。

- [ ] **Step 1: 失敗するテストを書く**

`viewer/tests/parts.test.js` の import に `setInteractiveVisible` を追加:

```javascript
import {
  buildPartRegistry, getPartNames, getPart, setPartVisible, setPartsVisible,
  resolvePartName, resolveHitPartName, hiddenPartNames, showAllParts,
  selectPart, clearSelection, getSelectedPartName, setPartHighlight,
  setEdgesVisible, setInteractiveVisible,
} from '../src/parts.js';
```

`draw-call batching` describe ブロックの末尾（`});` の前）に追加:

```javascript
  it('setInteractiveVisibleでバッチの表示/非表示を一括切替できる', () => {
    const batch = batchesOf(s.root)[0];
    setInteractiveVisible(false);
    expect(batch.visible).toBe(false);
    setInteractiveVisible(true);
    expect(batch.visible).toBe(true);
  });

  it('setInteractiveVisible(true)でも、エッジOFF時は稜線を表示しない', () => {
    setEdgesVisible(false); // エッジは既定OFF
    setInteractiveVisible(false);
    setInteractiveVisible(true);
    // 稜線は統合LineSegmentsとしてrootに存在するが、エッジOFFなので非表示のまま
    const lines = s.root.children.find((c) => c.isLineSegments);
    expect(lines.visible).toBe(false);
  });

  it('setInteractiveVisible(true)は、エッジON時に稜線表示を復帰する', () => {
    setEdgesVisible(true);
    setInteractiveVisible(false);
    const lines = s.root.children.find((c) => c.isLineSegments);
    expect(lines.visible).toBe(false); // 非表示中
    setInteractiveVisible(true);
    expect(lines.visible).toBe(true); // 復帰
  });
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `cd viewer && npx vitest run tests/parts.test.js`
Expected: FAIL（`setInteractiveVisible` が未エクスポート）

- [ ] **Step 3: 実装する**

`viewer/src/parts.js` の3つのヘルパー定義に `export` を付ける:

```javascript
export function isBatchable(mesh) {
```
```javascript
export function materialKey(material) {
```
```javascript
export function normalizeGeometry(geometry) {
```

モジュール先頭の状態変数群（`let edgeIndexDirty = false;` の下）に追加:

```javascript
let edgesEnabled = false; // 稜線表示ON/OFFの記憶（LOD切替時の稜線復帰に使う）
```

`setEdgesVisible` の先頭で状態を記録する:

```javascript
export function setEdgesVisible(visible) {
  edgesEnabled = visible;
  if (mergedEdges) {
    mergedEdges.lines.visible = visible;
    if (visible && edgeIndexDirty) {
      rebuildEdgeIndex();
      edgeIndexDirty = false;
    }
  }
  registry.forEach((p) => p.edges.forEach((e) => { e.visible = visible; }));
}
```

`setEdgesVisible` の直後に新関数を追加:

```javascript
/** 精密版（色バッチと統合稜線）の表示/非表示を一括で切り替える。
 * LOD(操作中の軽量表示)へ切り替える間だけ精密版を隠すために使う。
 * 個々の部品のsetVisibleAt状態はバッチのvisible切替では変わらないため、
 * 表示に戻しても非表示にした部品は非表示のまま保たれる。
 * 稜線はエッジ表示ONのときだけ復帰させる */
export function setInteractiveVisible(visible) {
  activeBatches.forEach((b) => { b.visible = visible; });
  if (mergedEdges) mergedEdges.lines.visible = visible && edgesEnabled;
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `cd viewer && npx vitest run tests/parts.test.js`
Expected: PASS（新規3件＋既存すべて）

- [ ] **Step 5: コミット**

```bash
git add viewer/src/parts.js viewer/tests/parts.test.js
git commit -m "Export batching helpers and add setInteractiveVisible to parts"
```

---

### Task 4: lod.js — 軽量版バッチの組み立てと破棄

**Files:**
- Create: `viewer/src/lod.js`
- Test: `viewer/tests/lod.test.js`

LOD用glTFシーンから、色分けした表示専用BatchedMesh群を1つの `THREE.Group` にまとめて返す。parts.js のレジストリのような対話的状態は持たない。

- [ ] **Step 1: 失敗するテストを書く**

`viewer/tests/lod.test.js` を新規作成:

```javascript
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { buildLodBatches } from '../src/lod.js';

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

  it('バッチ化できるメッシュが無ければnullを返す', () => {
    expect(buildLodBatches(new THREE.Group())).toBeNull();
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `cd viewer && npx vitest run tests/lod.test.js`
Expected: FAIL（`../src/lod.js` が存在しない）

- [ ] **Step 3: 実装する**

`viewer/src/lod.js` を新規作成:

```javascript
/** LOD（操作中の軽量表示）: 簡略版glTFシーンから表示専用のBatchedMesh群を組み立てる。
 * parts.jsのような部品レジストリ・選択・個別表示制御は持たない（動作中の見た目の代役専用）。
 */
import * as THREE from 'three';
import { isBatchable, materialKey, normalizeGeometry } from './parts.js';

/** 簡略版シーンから色分けBatchedMesh群を1つのGroupにまとめて返す。
 * バッチ化対象が無ければ null。 */
export function buildLodBatches(root) {
  root.updateMatrixWorld(true);
  const rootInv = new THREE.Matrix4().copy(root.matrixWorld).invert();

  const groups = new Map(); // key -> { material, items: Mesh[] }
  root.traverse((mesh) => {
    if (!mesh.isMesh || !isBatchable(mesh)) return;
    const key = materialKey(mesh.material);
    if (!groups.has(key)) groups.set(key, { material: mesh.material, items: [] });
    groups.get(key).items.push(mesh);
  });
  if (groups.size === 0) return null;

  const group = new THREE.Group();
  groups.forEach(({ material, items }) => {
    const normalized = items.map((mesh) => normalizeGeometry(mesh.geometry));
    const totalVerts = normalized.reduce((s, g) => s + g.getAttribute('position').count, 0);
    const totalIndices = normalized.reduce((s, g) => s + g.index.count, 0);

    const batchMaterial = material.clone();
    batchMaterial.color = new THREE.Color(0xffffff); // 色はper-instanceで持つ
    batchMaterial.map = null;

    const batch = new THREE.BatchedMesh(items.length, totalVerts, totalIndices, batchMaterial);
    items.forEach((mesh, i) => {
      const baseColor = mesh.material.color.clone();
      const id = batch.addInstance(batch.addGeometry(normalized[i]));
      const rel = new THREE.Matrix4().multiplyMatrices(rootInv, mesh.matrixWorld);
      batch.setMatrixAt(id, rel);
      batch.setColorAt(id, baseColor);
      normalized[i].dispose();
    });
    batch.raycast = () => {}; // LODは部品選択の対象にしない（タップは常に精密版側で処理する）
    group.add(batch);
  });
  return group;
}
```

（LODバッチの破棄は独立の関数を設けない。モデル差し替え時に旧`currentModel`を破棄する既存の traverse が、その子である LODバッチ（`isBatchedMesh`）もまとめて解放するため。）

**重要**: `batch.raycast = () => {}` を付けないと、LOD表示中にタップした際に `resolveHitPartName`（`parts.js`）が `hit.object.userData.batchIdToName.get(...)` で例外を投げる（LODバッチには`batchIdToName`が無いため）。Task 7実装時のコードレビューで実際に検出された不具合。`parts.js`側にも `?.` による防御を入れる（Task 3の該当箇所を参照）。

- [ ] **Step 4: テストが通ることを確認**

Run: `cd viewer && npx vitest run tests/lod.test.js`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add viewer/src/lod.js viewer/tests/lod.test.js
git commit -m "Add LOD batch builder module"
```

---

### Task 5: lod.js — カメラ移動の状態遷移トラッカー

**Files:**
- Modify: `viewer/src/lod.js`
- Test: `viewer/tests/lod.test.js`

カメラの動き量から「軽量表示を出す/戻す」を判定する純粋ロジック。250ms の猶予（静止後この時間だけ軽量版を保持）を持つ。

- [ ] **Step 1: 失敗するテストを書く**

`viewer/tests/lod.test.js` の先頭 import 行に `createMotionTracker` を足す:

```javascript
import { buildLodBatches, createMotionTracker } from '../src/lod.js';
```

同ファイルの末尾に追加:

```javascript
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
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `cd viewer && npx vitest run tests/lod.test.js`
Expected: FAIL（`createMotionTracker` が未実装）

- [ ] **Step 3: 実装する**

`viewer/src/lod.js` の末尾に追加:

```javascript
/** カメラの動き量から、軽量表示(LOD)を出す/戻すの状態遷移を判定する純粋ロジック。
 * update()は状態が変わったフレームだけ 'show'/'hide' を返し、変化なしは null を返す。
 * 静止後 holdMs だけ軽量版を保持してから精密版に戻す（減衰運動の余韻をまたぐため）。
 * @param {{holdMs?: number}} [opts]
 */
export function createMotionTracker({ holdMs = 250 } = {}) {
  let showing = false;
  let lastMotion = 0;
  return {
    /** @param {number} moved 動き量  @param {number} threshold 判定閾値  @param {number} now 現在時刻ms */
    update(moved, threshold, now) {
      if (moved > threshold) {
        lastMotion = now;
        if (!showing) { showing = true; return 'show'; }
      } else if (showing && now - lastMotion > holdMs) {
        showing = false;
        return 'hide';
      }
      return null;
    },
    isShowing: () => showing,
    reset() { showing = false; lastMotion = 0; }, // モデル切替時に前のモデルの動き検知状態を引き継がないようにする
  };
}
```

**重要**: `reset()` が無いと、モデルAをドラッグ中（`showing=true`）にモデルBへ切り替えた場合、Bの新しいドラッグ開始時に `showing` が既に`true`のままのため `'show'` イベントが出ず、LODが効かないまま重い表示が続く。Task 7で `lodGroup = null` と同じ箇所（`loadModel`）で `lodTracker.reset()` を呼ぶ必要がある。Task 7実装時のコードレビューで実際に検出された不具合。

- [ ] **Step 4: テストが通ることを確認**

Run: `cd viewer && npx vitest run tests/lod.test.js`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add viewer/src/lod.js viewer/tests/lod.test.js
git commit -m "Add motion tracker for LOD switching"
```

---

### Task 6: modelsource.js に LOD ファイルのパスを追加

**Files:**
- Modify: `viewer/src/modelsource.js`
- Test: `viewer/tests/modelsource.test.js`

- [ ] **Step 1: 失敗するテストを書く**

`viewer/tests/modelsource.test.js` の `modelPaths` を検証する箇所（describe内）に追加。既存の `modelPaths` テストブロックへ次を追記:

```javascript
  it('LOD(軽量表示)用GLBのパスを返す', () => {
    expect(modelPaths('robot').lod).toBe('/models/robot_lod.glb');
  });
```

（`modelPaths` が未 import の場合は import 行に追加する）

- [ ] **Step 2: テストが失敗することを確認**

Run: `cd viewer && npx vitest run tests/modelsource.test.js`
Expected: FAIL（`lod` が undefined）

- [ ] **Step 3: 実装する**

`viewer/src/modelsource.js` の `modelPaths` に `lod` を追加:

```javascript
export function modelPaths(name) {
  return {
    glb: `/models/${encodeURIComponent(name)}.glb`,
    json: `/models/${encodeURIComponent(name)}_annotations.json`,
    lod: `/models/${encodeURIComponent(name)}_lod.glb`,
  };
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `cd viewer && npx vitest run tests/modelsource.test.js`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add viewer/src/modelsource.js viewer/tests/modelsource.test.js
git commit -m "Add LOD file path to modelPaths"
```

---

### Task 7: viewer.js / main.js の配線とブラウザ検証

**Files:**
- Modify: `viewer/src/viewer.js`（import・状態変数・loadModel・loadLodModel・animate）
- Modify: `viewer/src/main.js`（import・loadFromServer）

自動テストが難しい統合部分。ユニットテスト済みの部品を配線し、ブラウザで動作を確認する。

- [ ] **Step 1: viewer.js に import と状態変数を追加**

`viewer/src/viewer.js` の parts.js import に `setPreciseVisible` を追加し、lod.js の import を足す（注: Task 3 のレビューで `setInteractiveVisible` は `setPreciseVisible` にリネーム済み）:

```javascript
import { buildPartRegistry, setEdgesVisible, isActuallyVisible, setPreciseVisible } from './parts.js';
import { buildLodBatches, createMotionTracker } from './lod.js';
```

`const frameCallbacks = [];` の下に状態変数を追加:

```javascript
// LOD(操作中の軽量表示)。lodGroupは精密版currentModelの子として重ねる
let lodGroup = null;
const lodTracker = createMotionTracker();
const _prevCamPos = new THREE.Vector3();
const _prevTarget = new THREE.Vector3();
```

- [ ] **Step 2: loadModel でモデル差し替え時に古い LOD を破棄**

`viewer/src/viewer.js` の `currentModel = gltf.scene;`（旧モデル破棄traverseの直後）の行の直前に追加:

```javascript
        lodGroup = null; // 旧LODは旧currentModelごと上のtraverseで破棄済み。参照だけ切る
        lodTracker.reset(); // 前のモデルの動き検知状態を引き継がないようにする
```

（旧 `currentModel` を破棄する既存の traverse は `isBatchedMesh` を dispose するため、子だった LOD バッチもそこで解放される）

- [ ] **Step 3: loadModel の末尾に loadLodModel を追加**

`viewer/src/viewer.js` の `loadModel` 関数の閉じ `}` の直後（`export function setControlsEnabled` の前）に新関数を追加:

```javascript
/** LOD(軽量表示)用GLBを読み込み、精密モデルの子として重ねる。動作中だけ表示する。
 * currentModelが無い/読み込み失敗時は何もしない（LODなしで通常動作にフォールバック）。
 * @param {File} file
 * @returns {Promise<void>}
 */
export function loadLodModel(file) {
  return new Promise((resolve) => {
    if (!currentModel) { resolve(); return; }
    const target = currentModel; // 非同期中にモデルが差し替わっても取り違えないよう捕捉
    const url = URL.createObjectURL(file);
    const loader = new GLTFLoader();
    loader.setMeshoptDecoder(MeshoptDecoder);
    loader.load(
      url,
      (gltf) => {
        URL.revokeObjectURL(url);
        if (currentModel !== target) return resolve(); // 既に別モデルへ差し替わっていた
        gltf.scene.traverse((o) => {
          if (o.isMesh && !o.geometry.attributes.normal) o.geometry.computeVertexNormals();
        });
        const group = buildLodBatches(gltf.scene);
        if (group) {
          group.visible = false; // 静止時は精密版を表示。動いたときだけONにする
          target.add(group);
          lodGroup = group;
          _prevCamPos.copy(camera.position);
          _prevTarget.copy(controls.target);
        }
        resolve();
      },
      undefined,
      () => { URL.revokeObjectURL(url); resolve(); }, // 失敗してもLODなしで続行
    );
  });
}
```

- [ ] **Step 4: animate に切り替えロジックを追加**

`viewer/src/viewer.js` の `animate()` 内、`controls.update();` の直後に追加:

```javascript
  if (lodGroup) {
    const moved = camera.position.distanceTo(_prevCamPos) + controls.target.distanceTo(_prevTarget);
    const change = lodTracker.update(moved, modelDiag * 1e-4, performance.now());
    if (change === 'show') { lodGroup.visible = true; setPreciseVisible(false); }
    else if (change === 'hide') { lodGroup.visible = false; setPreciseVisible(true); }
    _prevCamPos.copy(camera.position);
    _prevTarget.copy(controls.target);
  }
```

- [ ] **Step 5: main.js で LOD を読み込む**

`viewer/src/main.js` の viewer.js import 行に `loadLodModel` を追加（`loadModel,` の直後など）。

`loadFromServer` の注釈JSON読み込みブロック（`if (jsonRes?.ok) { ... }`）の直後に追加:

```javascript
  // 軽量表示(LOD)用ファイルがあれば重ねて読み込む（大規模モデルの操作中だけ使う）
  const lodRes = await fetch(paths.lod).catch(() => null);
  if (lodRes?.ok) {
    await loadLodModel(new File([await lodRes.blob()], `${name}_lod.glb`));
  }
```

- [ ] **Step 6: 全ユニットテストで回帰がないことを確認**

Run: `cd viewer && npx vitest run`
Expected: 全PASS

- [ ] **Step 7: 切り替え機構をブラウザで検証（LODファイルの代役を用意）**

実際の低ポリLODを別PCで作る前に、切り替え機構そのものを手元で確認する。既存GLBを複製して `_lod.glb` を用意する（低ポリではないが、表示/非表示の切替ロジックの検証には十分）:

```bash
cp viewer/models/Scania-8x4.glb viewer/models/Scania-8x4_lod.glb
```

`preview_start`（name: viewer）で起動し、`http://localhost:4000/?model=Scania-8x4` を開く。読み込み後、`javascript_tool` で以下を確認する（静止時は lodGroup 非表示、動かすと表示に切り替わる）:

- 静止状態で `scene` を走査し、可視な BatchedMesh のうち LOD グループのものが非表示であること
- カメラをドラッグ（`computer` の `left_click_drag` を canvas 上で実行）→ ドラッグ中に LOD グループが可視・精密バッチが非可視へ切り替わること
- 手を離して250ms以上経過後、精密バッチが再び可視・LOD非可視に戻ること

確認後、代役ファイルを削除する（実際のLODは別PCで再変換して生成するため）:

```bash
rm viewer/models/Scania-8x4_lod.glb
```

（削除は事前にユーザーへ対象ファイル名と理由を伝えて承認を得てから実行する）

- [ ] **Step 8: コミット**

```bash
git add viewer/src/viewer.js viewer/src/main.js
git commit -m "Wire LOD switching into viewer and server loading"
```

---

## 完了後の確認事項（ユーザー対応）

- 別PCで、対象モデルを新コンバータ（EXE再ビルド後）で再変換し、`<name>.glb` と `<name>_lod.glb` の両方が `viewer/models/` に置かれた状態で操作fps（画面左下表示）が改善するか実測してもらう。
- LODファイルは新規変換分のみ生成される。既存モデルにLODを効かせるには再変換が必要。
