# 静止中の再描画停止・gltfpack 1.3・中間LOD 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 静止中は描画を止めて操作開始の反応を速くする。あわせて、操作中に表示する中間版（約15%）を足し、遅い機械では自動で5%版へ下げる。

**Architecture:** 判定は副作用のない純粋関数として `viewer/src/lod.js` に置き（`createRenderScheduler`、`createTierGovernor`）、`viewer.js` の `animate()` から使う。変換ツールは、既存の軽量版と同じ方式で `_mid.glb` を追加で出力する。gltfpack は 1.3 に差し替え、`-sv` は比較してから採否を決める。

**Tech Stack:** three.js 0.184（BatchedMesh）、Vite 8 / vitest 4、Python 3.12 + cadquery 2.5.2（OCP）、gltfpack（meshoptimizer）

**Spec:** `docs/superpowers/specs/2026-11-07-render-on-demand-and-mid-lod-design.md`

## Global Constraints

- **コミットしない。** ユーザーが明示的に依頼したときだけ行う。各タスクの最後は「差分の確認」で代える（サブエージェントを使う場合は、依頼文に「git commit/add/init 禁止」と書く）
- ポート4000（本番：`node server.js 4000`）は止めない。`viewer/dist` は本番が配信しているので、`npm run build` はユーザーの許可を得てから行う
- 実機確認の開発サーバーはポート4001。`viewer/models/` は本番と共有しているため、確認用のモデルを置かない（Task 6 の確認用ラッパーを使う）
- 精密版（`compress_glb`）の引数は変えない
- 中間版の比率は `0.15`、自動で下げる判定は `slowMs: 66`・`samples: 10`。触ったあとに描き続ける時間は `500ms`
- ファイル入出力は `encoding=` を明示する。Python で書き戻すときは `newline='\n'`
- 外部ファイル（gltfpack 1.3）のダウンロードは、ファイル名・入手元・サイズを示してユーザーの許可を得てから行う

## Review Focus

1. **静止中に起きた変化が画面に出ない** — クリックを起点にしない画面の変化（注釈JSONの非同期読み込み、回転中心マーカーの自動消去、展示モードの自動回転開始、GPUの復旧）で、描き直しが漏れること。Task 2 で、それぞれに `requestRender` を入れる
2. **指を止めたまま押さえているときの誤判定** — 描かないフレームを挟んだ間隔を「遅いフレーム」と数えて、誤って5%版に下げること。Task 1 と Task 2 で、連続して描いたフレームの間隔だけを数える
3. **中間版だけがあり、軽量版が無いモデル** — 下げる先が無いのに中間版を捨てること。Task 3 で、`lodGroup` があるときだけ判定する
4. **モデルを読み込み直したときの状態の持ち越し** — 前のモデルで下げた状態が、次のモデルに残ること。Task 3 で、`loadModel` に `tierGovernor.reset()` を入れる
5. **読み込み直後に画面が真っ暗・古いまま** — `frameModel` が動き判定の基準を更新するので、カメラが「動いていない」扱いになり、描かれないこと。Task 2 で、`frameModel` の最後に `requestRender()` を入れる

---

### Task 1: 判定ロジック（lod.js）

**Files:**
- Modify: `viewer/src/lod.js`（末尾に2関数を追加）
- Test: `viewer/tests/lod.test.js`

**Interfaces:**
- Produces: `createRenderScheduler()` → `{ request(ms: number, now: number): void, shouldRender(moved: number, now: number): boolean }`
- Produces: `createTierGovernor({ slowMs = 66, samples = 10 } = {})` → `{ record(intervalMs: number): boolean, clearSamples(): void, isDemoted(): boolean, reset(): void }`。`record` は「下げる」と判定した1回だけ `true` を返す

- [ ] **Step 1: 失敗するテストを書く**（`viewer/tests/lod.test.js` の import に2関数を足し、末尾に追加）

```js
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
```

- [ ] **Step 2: 失敗を確認する**

Run: `cd viewer && npx vitest run tests/lod.test.js`
Expected: FAIL（`createRenderScheduler is not a function` など）

- [ ] **Step 3: 実装する**（`viewer/src/lod.js` の末尾に追加）

```js
/** 描画オンデマンドの判定。静止中は描かず、カメラが動いたフレームと、
 * request(ms, now) で予約した期間（now から ms ミリ秒）だけ描く */
export function createRenderScheduler() {
  let until = -Infinity;
  return {
    request(ms, now) { until = Math.max(until, now + ms); },
    shouldRender(moved, now) { return moved > 0 || now <= until; },
  };
}

/** 操作中の表示を中間版から軽量版へ下げるかの判定。中間版を表示している間の
 * 連続描画フレームの間隔を record() に渡す。直近 samples 個の中央値が slowMs を
 * 超えたら1回だけ true を返し、以後は下げたまま（行ったり来たりを防ぐ） */
export function createTierGovernor({ slowMs = 66, samples = 10 } = {}) {
  let intervals = [];
  let demoted = false;
  return {
    record(intervalMs) {
      if (demoted) return false;
      intervals.push(intervalMs);
      if (intervals.length > samples) intervals.shift();
      if (intervals.length < samples) return false;
      const sorted = [...intervals].sort((a, b) => a - b);
      const mid = (samples - 1) / 2;
      const median = (sorted[Math.floor(mid)] + sorted[Math.ceil(mid)]) / 2;
      if (median > slowMs) { demoted = true; return true; }
      return false;
    },
    clearSamples() { intervals = []; },
    isDemoted: () => demoted,
    reset() { intervals = []; demoted = false; },
  };
}
```

- [ ] **Step 4: 合格を確認する**

Run: `cd viewer && npx vitest run tests/lod.test.js`
Expected: PASS

- [ ] **Step 5: 差分を確認する**（コミットしない）

Run: `git diff --stat`

---

### Task 2: 描画オンデマンド（viewer.js / main.js）

**Files:**
- Modify: `viewer/src/viewer.js`（import、状態変数、`initViewer`、`applyInteractionQuality`、`animate`、`frameModel`、`loadModel`、`loadLodModel`、`setRotationCenter`、`setAutoRotate`、新しい export `requestRender`）
- Modify: `viewer/src/main.js`（`handleJSONDrop` の `reader.onload`）

**Interfaces:**
- Consumes: `createRenderScheduler`（Task 1）
- Produces: `export function requestRender(ms = 100)`（viewer.js）

このタスクは画面の動きなので、単体テストは置かない。Task 6 の実機確認で検証する。

- [ ] **Step 1: import と状態を追加する**

`viewer/src/viewer.js` 6行目の import を次に変える。

```js
import { buildLodBatches, createMotionTracker, interactionPixelRatio, createRenderScheduler, createTierGovernor } from './lod.js';
```

`let interactionLowRes = false;` の下に追加する。

```js
// 描画オンデマンド。静止中は描かず、動いた・触れた・表示が変わったときだけ描く
const renderScheduler = createRenderScheduler();
const INPUT_RENDER_MS = 500; // 触れたあと念のため描き続ける時間

/** 次のフレームから ms ミリ秒のあいだ描画する（クリック以外を起点にした表示変更から呼ぶ） */
export function requestRender(ms = 100) {
  renderScheduler.request(ms, performance.now());
}
```

- [ ] **Step 2: 入力・窓サイズ・GPU復旧で描画を予約する**（`initViewer` 内）

`renderer.domElement.addEventListener('webglcontextrestored', () => recovery.onRestored());` を次に変える。

```js
  renderer.domElement.addEventListener('webglcontextrestored', () => {
    recovery.onRestored();
    requestRender();
  });

  // 画面に触れた・操作したら描く。UIボタンでの部品の色・表示・稜線・テーマの変更も
  // すべてクリックを起点にしているため、ここでまとめて拾える
  for (const type of ['pointerdown', 'pointermove', 'pointerup', 'wheel', 'keydown', 'click', 'drop']) {
    document.addEventListener(type, () => requestRender(INPUT_RENDER_MS), { capture: true, passive: true });
  }
```

`resize` ハンドラの `updateDiagCounter();` の下に `requestRender();` を追加する。

- [ ] **Step 3: animate() を描画オンデマンドにする**

`function animate() { ... }` 全体を次に置き換える（中間版の判定は Task 3 で足す）。

```js
function animate() {
  requestAnimationFrame(animate);
  const now = performance.now();
  controls.update();
  const moved = camera.position.distanceTo(_prevCamPos) + controls.target.distanceTo(_prevTarget);
  // controls.enabled中のみ軽量化の切替を行う。damping(慣性)はenabled=falseでも
  // update()が動き続けてしまうため、無効化していないと操作無効中（ラベル配置等）
  // に慣性の余韻だけで精密版が隠れたままになり、タップ判定ができなくなる
  if (currentModel && controls.enabled) {
    const change = lodTracker.update(moved, modelDiag * 1e-4, now);
    if (change === 'show') applyInteractionQuality(true);
    else if (change === 'hide') applyInteractionQuality(false);
  }
  _prevCamPos.copy(camera.position);
  _prevTarget.copy(controls.target);
  const dist = camera.position.distanceTo(controls.target);
  const range = computeCameraRange(dist, modelDiag);
  if (Math.abs(camera.near - range.near) / range.near > 0.1) {
    camera.near = range.near;
    camera.far = range.far;
    camera.updateProjectionMatrix();
  }
  // 静止中は描かない。精密版の1フレームが重い（大規模モデルで約0.25秒）ため、
  // 描き続けると触った瞬間に描画途中のフレームを待つことになる
  if (!renderScheduler.shouldRender(moved, now)) return;
  updateFpsCounter();
  frameCallbacks.forEach((fn) => fn()); // render前に更新することでラベルのズレを防ぐ
  renderer.render(scene, camera);
}
```

- [ ] **Step 4: 表示が変わる処理で描画を予約する**

- `applyInteractionQuality(on)` の関数の最後に `requestRender();` を追加する
- `frameModel` の最後（`_prevTarget.copy(controls.target);` の下）に `requestRender();` を追加する
- `loadModel` の成功時コールバックで `resolve()` を呼ぶ直前に `requestRender();` を追加する
- `loadLodModel` の成功時コールバックの最後の `resolve();` の直前に `requestRender();` を追加する
- `setRotationCenter` の `setTimeout(() => { ... }, 600);` の中で `marker.material.dispose();` の下に `requestRender();` を追加する
- `setAutoRotate(on)` を `export function setAutoRotate(on) { controls.autoRotate = on; requestRender(); }` にする

- [ ] **Step 5: 注釈JSONの非同期読み込みで描画を予約する**

`viewer/src/main.js` の import 行（1行目）に `requestRender` を足す。`handleJSONDrop` の `reader.onload = (e) => {` の直後の行に次を追加する（try の成否にかかわらず描くため、関数の先頭に置く）。

```js
    requestRender();
```

- [ ] **Step 6: 既存テストが通ることを確認する**

Run: `cd viewer && npx vitest run`
Expected: すべて PASS

- [ ] **Step 7: 差分を確認する**（コミットしない）

Run: `git diff --stat`

---

### Task 3: 中間版の表示と自動で下げる処理（viewer）

**Files:**
- Modify: `viewer/src/modelsource.js`（`modelPaths` に `mid`）
- Modify: `viewer/models-api.js`（一覧から `_mid.glb` を除く）
- Modify: `viewer/src/viewer.js`（`midGroup`、`loadMidModel`、`applyInteractionQuality`、`animate`、`loadModel`、診断表示）
- Modify: `viewer/src/main.js`（`loadFromServer` で中間版を読み込む）
- Test: `viewer/tests/modelsource.test.js`、`viewer/tests/models-api.test.js`

**Interfaces:**
- Consumes: `createTierGovernor`（Task 1）、`requestRender`（Task 2）、`buildLodBatches`（既存）
- Produces: `modelPaths(name).mid === '/models/<name>_mid.glb'`、`export function loadMidModel(file: File): Promise<void>`（viewer.js）

- [ ] **Step 1: 失敗するテストを書く**

`viewer/tests/modelsource.test.js` の `lod` を確かめている行（45行目）の下に追加する。

```js
    expect(modelPaths('robot').mid).toBe('/models/robot_mid.glb');
```

`viewer/tests/models-api.test.js` の `describe('listModels'` 内の末尾に追加する。

```js
  it('中間版の_mid.glbもギャラリー一覧に出さない', () => {
    fs.writeFileSync(path.join(dir, 'CarA_mid.glb'), Buffer.from('midDummy'));
    const list = listModels(dir);
    expect(list.map((m) => m.name).sort()).toEqual(['CarA', 'CarB']);
  });
```

- [ ] **Step 2: 失敗を確認する**

Run: `cd viewer && npx vitest run tests/modelsource.test.js tests/models-api.test.js`
Expected: FAIL（`mid` が undefined、一覧に `CarA_mid` が出る）

- [ ] **Step 3: パスと一覧を直す**

`viewer/src/modelsource.js` の `modelPaths` の戻り値に追加し、docstring を「GLB・注釈JSON・LOD(軽量表示)・中間版GLBの取得パスを返す」に直す。

```js
    mid: `/models/${encodeURIComponent(name)}_mid.glb`,
```

`viewer/models-api.js` の filter と、その上のコメントを直す。

```js
 * LOD(軽量表示)用の"_lod.glb"と中間版の"_mid.glb"は単体では意味を持たない付属ファイルのため、
```

```js
      .filter((f) => f.toLowerCase().endsWith('.glb') && !/_(lod|mid)\.glb$/i.test(f))
```

- [ ] **Step 4: 合格を確認する**

Run: `cd viewer && npx vitest run tests/modelsource.test.js tests/models-api.test.js`
Expected: PASS

- [ ] **Step 5: viewer.js に中間版の状態を追加する**

`let lodGroup = null;` の下に追加する。

```js
// 中間版（約15%）。操作中はまず中間版を出し、描画が遅ければ軽量版(lodGroup)へ下げる
let midGroup = null;
let midTriangleCount = null;
const tierGovernor = createTierGovernor();
let lastRenderTime = 0;
let prevFrameRendered = false; // 直前のrAFで描いたか（描かないフレームを挟んだ間隔は数えない）
let midFramesSinceShow = 0;    // 中間版を出してから描いたフレーム数（最初の間隔は切替の重さを含むので数えない）

/** 操作中に表示する段階。中間版があり、まだ下げていなければ中間版 */
function interactionGroup() {
  return midGroup && !tierGovernor.isDemoted() ? midGroup : lodGroup;
}

/** 中間版を捨てて軽量版へ切り替え、メモリを空ける（モデルを読み直すまで戻さない） */
function demoteToLod() {
  if (!midGroup) return;
  const wasShowing = midGroup.visible;
  midGroup.removeFromParent();
  midGroup.traverse((o) => {
    if (o.isBatchedMesh) { o.dispose(); o.material.dispose(); }
  });
  midGroup = null;
  if (wasShowing && lodGroup) lodGroup.visible = true;
  updateDiagCounter();
  requestRender();
}
```

- [ ] **Step 6: 診断表示に中間版と現在の段階を出す**

`updateDiagCounter` の本体を次に変える。

```js
function updateDiagCounter() {
  if (!diagEl || !renderer) return;
  const w = renderer.domElement.width;
  const h = renderer.domElement.height;
  const lodText = lodTriangleCount === null ? 'なし' : lodTriangleCount.toLocaleString();
  const midText = midTriangleCount === null ? 'なし' : midTriangleCount.toLocaleString();
  const tier = interactionGroup() === midGroup && midGroup ? '中間' : (lodGroup ? '軽量' : 'なし');
  diagEl.textContent = `解像度:${w}x${h} dpr:${window.devicePixelRatio} LOD三角形数:${lodText} 中間:${midText} 操作中:${tier}`;
}
```

（`interactionGroup` と `midGroup` は関数宣言より前に使われるが、呼ばれるのは初期化後なので問題ない。`let` の宣言位置は Step 5 のとおり `updateDiagCounter` より上に置くこと）

- [ ] **Step 7: 切り替えを3段階にする**

`applyInteractionQuality` の先頭の `if (lodGroup) { ... }` を次に置き換える。

```js
  const group = interactionGroup();
  if (group) {
    if (lodGroup) lodGroup.visible = on && group === lodGroup;
    if (midGroup) midGroup.visible = on && group === midGroup;
    setPreciseVisible(!on);
  }
  if (on) midFramesSinceShow = 0;
  else tierGovernor.clearSamples(); // 操作の切れ目をまたいだ間隔を混ぜない
```

- [ ] **Step 8: animate() で中間版の速さを測る**

Task 2 で書いた `animate()` の、`if (!renderScheduler.shouldRender(moved, now)) return;` を次に置き換える。

```js
  if (!renderScheduler.shouldRender(moved, now)) {
    prevFrameRendered = false;
    return;
  }
  // 中間版の表示中だけ、連続して描いたフレームの間隔を測る。下げる先(lodGroup)が無ければ測らない
  if (midGroup && midGroup.visible && lodGroup) {
    if (prevFrameRendered && midFramesSinceShow >= 2 && tierGovernor.record(now - lastRenderTime)) {
      demoteToLod();
    }
    midFramesSinceShow += 1;
  }
  lastRenderTime = now;
  prevFrameRendered = true;
```

- [ ] **Step 9: モデル切替時に初期化する**

`loadModel` の `lodGroup = null; // 旧LODは…` の下に追加する（中間版も `currentModel` の子なので、上の traverse で破棄済み）。

```js
        midGroup = null;
        midTriangleCount = null;
        tierGovernor.reset();
```

- [ ] **Step 10: loadMidModel を追加する**

`loadLodModel` の下に追加する。

```js
/** 中間版GLBを読み込み、精密モデルの子として重ねる（操作中だけ表示）。
 * 失敗しても何もしない（中間版なしで、軽量版または精密版のみで動く） */
export function loadMidModel(file) {
  return new Promise((resolve) => {
    if (!currentModel) { resolve(); return; }
    const target = currentModel;
    const url = URL.createObjectURL(file);
    const loader = new GLTFLoader();
    loader.setMeshoptDecoder(MeshoptDecoder);
    loader.load(
      url,
      (gltf) => {
        URL.revokeObjectURL(url);
        if (currentModel !== target) return resolve();
        let triCount = 0;
        gltf.scene.traverse((o) => {
          if (!o.isMesh) return;
          if (!o.geometry.attributes.normal) o.geometry.computeVertexNormals();
          const g = o.geometry;
          triCount += (g.index ? g.index.count : g.attributes.position.count) / 3;
        });
        const group = buildLodBatches(gltf.scene);
        if (group) {
          group.visible = false;
          target.add(group);
          midGroup = group;
          midTriangleCount = Math.round(triCount);
          // 操作中に読み込みが終わった場合は、次の操作から中間版を使う（表示中の段階は変えない）
        }
        updateDiagCounter();
        requestRender();
        resolve();
      },
      undefined,
      () => { URL.revokeObjectURL(url); resolve(); },
    );
  });
}
```

- [ ] **Step 11: main.js で中間版を読み込む**

`viewer/src/main.js` 1行目の import に `loadMidModel` を足す。`loadFromServer` の軽量版の読み込み（`await loadLodModel(...)` の `if` ブロック）の下に追加する。

```js
  // 中間版があれば重ねて読み込む（操作中はまず中間版、描画が遅い機械では軽量版に自動で下げる）
  const midRes = await fetch(paths.mid).catch(() => null);
  if (midRes?.ok) {
    await loadMidModel(new File([await midRes.blob()], `${name}_mid.glb`));
  }
```

- [ ] **Step 12: すべてのテストを通す**

Run: `cd viewer && npx vitest run`
Expected: すべて PASS

- [ ] **Step 13: 差分を確認する**（コミットしない）

Run: `git diff --stat`

---

### Task 4: 変換ツールで中間版を出す（converter）

**Files:**
- Modify: `converter/src/compress.py`（`_MID_SIMPLIFY_RATIO`、`compress_glb_mid`）
- Modify: `converter/src/pipeline.py`（`_mid.glb` の生成）
- Test: `converter/tests/test_compress.py`、`converter/tests/test_pipeline.py`

**Interfaces:**
- Produces: `compress_glb_mid(src: Path, dst: Path) -> None`
- Produces: `convert()` が `<stem>_mid.glb` を出力する（失敗しても変換は成功）

- [ ] **Step 1: 失敗するテストを書く**

`converter/tests/test_compress.py` の末尾に追加する。

```python
def test_compress_mid_passes_middle_ratio(tmp_path, monkeypatch):
    # 中間版は軽量版(5%)と精密版の間。比率を品質より優先する -sa を付け、
    # 部品選択はしないので -kn は付けない
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

    c.compress_glb_mid(tmp_path / "a.glb", tmp_path / "b_mid.glb")

    args = captured["args"]
    assert "-sa" in args
    assert float(args[args.index("-si") + 1]) == pytest.approx(0.15)
    assert "-kn" not in args
```

`converter/tests/test_pipeline.py` の `test_convert_survives_lod_failure` の下に追加する。

```python
def test_convert_generates_mid_file(monkeypatch, fixture_step, tmp_path):
    # 中間版 <name>_mid.glb も出力する。統計は通常版のみ
    import src.pipeline as pipeline

    def fake_compress(src, dst):
        dst.write_bytes(_make_glb(10))

    def fake_small(src, dst):
        dst.write_bytes(_make_glb(1))

    monkeypatch.setattr(pipeline, "compress_glb", fake_compress)
    monkeypatch.setattr(pipeline, "compress_glb_lod", fake_small)
    monkeypatch.setattr(pipeline, "compress_glb_mid", fake_small)

    out = tmp_path / "model.glb"
    stats = pipeline.convert(fixture_step, out, quality="standard",
                              progress=lambda s: None)

    assert (tmp_path / "model_mid.glb").exists()
    assert stats["triangles"] == 10


def test_convert_survives_mid_failure(monkeypatch, fixture_step, tmp_path):
    # 中間版も任意の付加物。失敗しても本体と軽量版は残り、変換は成功する
    import src.pipeline as pipeline

    def fake_compress(src, dst):
        dst.write_bytes(_make_glb(10))

    def fake_lod(src, dst):
        dst.write_bytes(_make_glb(1))

    def boom_mid(src, dst):
        raise RuntimeError("mid boom")

    monkeypatch.setattr(pipeline, "compress_glb", fake_compress)
    monkeypatch.setattr(pipeline, "compress_glb_lod", fake_lod)
    monkeypatch.setattr(pipeline, "compress_glb_mid", boom_mid)

    out = tmp_path / "model.glb"
    stats = pipeline.convert(fixture_step, out, quality="standard",
                              progress=lambda s: None)

    assert out.exists()
    assert (tmp_path / "model_lod.glb").exists()
    assert not (tmp_path / "model_mid.glb").exists()
    assert stats["triangles"] == 10
```

- [ ] **Step 2: 失敗を確認する**

Run: `cd converter && .venv/Scripts/python.exe -m pytest tests/test_compress.py tests/test_pipeline.py -q`
Expected: FAIL（`compress_glb_mid` が無い）

- [ ] **Step 3: compress.py に追加する**

`_LOD_SIMPLIFY_RATIO = 0.05` の下に追加する。

```python
# 中間版（操作中にまず表示する段階）の削減比率。軽量版(5%)より見た目を保ち、
# 内蔵グラフィックスでも操作できる三角形数を狙う。遅い機械ではビューアが軽量版へ下げる
_MID_SIMPLIFY_RATIO = 0.15
```

ファイル末尾に追加する。

```python
def compress_glb_mid(src: Path, dst: Path) -> None:
    # 操作中の中間表示専用。軽量版と同じく部品選択はしないので -kn は付けない
    _run_gltfpack(src, dst, ["-cc", "-si", str(_MID_SIMPLIFY_RATIO), "-sa"])
```

- [ ] **Step 4: pipeline.py で生成する**

import を `from src.compress import compress_glb, compress_glb_lod, compress_glb_mid` にする。軽量版の `try/except` ブロックの下（同じ `with tempfile...` の中）に追加する。

```python
            mid_path = out_path.with_name(out_path.stem + "_mid" + out_path.suffix)
            try:
                compress_glb_mid(raw, mid_path)
            except Exception as e:
                print(f"中間版の生成をスキップしました: {e}", file=sys.stderr)
```

- [ ] **Step 5: 合格を確認する**

Run: `cd converter && .venv/Scripts/python.exe -m pytest -q`
Expected: すべて PASS（41件＋3件）

- [ ] **Step 6: 差分を確認する**（コミットしない）

Run: `git diff --stat`

---

### Task 5: gltfpack 1.3 への差し替えと -sv の比較

**Files:**
- Modify: `converter/bin/gltfpack.exe`（差し替え）
- Modify（`-sv` を採用する場合のみ）: `converter/src/compress.py`、`converter/tests/test_compress.py`
- 比較用の作業ファイルは scratchpad に置く

- [ ] **Step 1: 入手先を確かめ、ユーザーの許可を得る**

Run: `gh release view v1.3 -R zeux/meshoptimizer --json assets --jq '.assets[] | {name, size}'`
Windows 用 gltfpack のファイル名とサイズを確かめ、「ファイル名・入手元（GitHub zeux/meshoptimizer の Releases）・サイズ」を示してユーザーの許可を得る。許可が出るまで先へ進まない。

- [ ] **Step 2: scratchpad にダウンロードして展開し、版を確かめる**

Run: `gh release download v1.3 -R zeux/meshoptimizer -p '<Step 1で確かめたファイル名>' -D <scratchpad>/gltfpack13`
展開後、`<展開先>/gltfpack.exe -v` が `1.3` を表示すること。`-h` の出力で `-sv` の説明を読み、内容を記録する。

- [ ] **Step 3: -sv あり・なしを比べる**

scratchpad で、cadquery の見本アセンブリ（円柱・球・穴あきの箱など曲面を含む3部品）から `build_glb` の生GLBを作る。gltfpack 1.3 で次の4つを出力する。
- 中間版（`-cc -si 0.15 -sa`）、および同じ引数に `-sv` を足したもの
- 軽量版（`-cc -si 0.05 -sa`）、および同じ引数に `-sv` を足したもの

比べるのは、三角形数（`src.pipeline._count_triangles`）、ファイルサイズ、見た目の3つ。見た目は Task 6 の確認用サーバーで、ドラッグ&ドロップで開いて撮る。

- [ ] **Step 4: 採否を決めてユーザーに報告する**

形の崩れが減る、または同じ見た目でサイズが小さい場合は採用し、`compress_glb_mid` と `compress_glb_lod` の引数に `"-sv"` を足す。あわせて、両方のテストに `assert "-sv" in args` を足す。効果が無い、またはエラーになる場合は採用しない。結果は数値と画像で報告する。

- [ ] **Step 5: 差し替えて全テストを通す**

`converter/bin/gltfpack.exe` を 1.3 に置き換える（上書き前に、旧版を scratchpad に退避する）。
Run: `cd converter && converter/bin/gltfpack.exe -v && .venv/Scripts/python.exe -m pytest -q`
Expected: `1.3` を表示し、すべて PASS

---

### Task 6: 実機確認（開発サーバー）

**Files:**
- Create（scratchpad）: 確認用の vite 設定 `verify.vite.config.mjs`、確認用の models フォルダ
- 一時的に Modify: 開発フォルダの `.claude\launch.json`（確認用の項目を足す。共有ファイルなのでユーザーの許可を得る。終わったら消す）

- [ ] **Step 1: 確認用モデルを作る**

scratchpad で、見本アセンブリを `convert()` にかけ、`Verify.glb`、`Verify_lod.glb`、`Verify_mid.glb` を scratchpad の `models` に出力する。

- [ ] **Step 2: 確認用サーバーの設定を作る**

`verify.vite.config.mjs` は、`root` を `<リポジトリ>/viewer`（絶対パス） にし、プロジェクトの `models-api.js` を import して `MODELS_DIR` だけを scratchpad の `models` に向ける（`vite.config.js` の `modelsDirPlugin` と同じ形）。launch.json に `"3d-viewer-verify"`（`npx vite --config <絶対パス> --port 4001`）を足し、`preview_start` で開く。

- [ ] **Step 3: 動きを確かめる**

`http://localhost:4001/?model=Verify` を開き、次の5点を確かめる。
1. 読み込み後、モデルが表示される
2. 静止して1秒たったら、FPS表示の更新が止まる（`javascript_tool` で `renderer.info.render.frame` が増えないことを確かめる）
3. ドラッグ中は、診断表示が「操作中:中間」になる
4. 自動で下げる処理を確かめる。`viewer/src/viewer.js` の `createTierGovernor()` を一時的に `createTierGovernor({ slowMs: 1 })` に変え、1秒以上ドラッグして「操作中:軽量」・「中間:なし」に変わることを確かめる。確かめたら元に戻し、`git diff viewer/src/viewer.js` に `slowMs: 1` が残っていないことを確かめる
5. タップで部品名が出る。ラベル表示・稜線・テーマの切り替えがすぐ画面に出る

- [ ] **Step 4: 後片付け**

launch.json の確認用項目を消し、サーバーを止める。scratchpad のファイルはそのまま残す。

---

### Task 7: 変換ツールの EXE を作り直す

- [ ] **Step 1: ビルドする**

Run（バックグラウンド）: `cd converter && .venv/Scripts/pyinstaller.exe --clean --noconfirm Converter3DViewer.spec`。終わったら `bin/gltfpack.exe` を `dist/Converter3DViewer/bin/` にコピーする。

- [ ] **Step 2: 確かめる**

- `dist/Converter3DViewer/bin/gltfpack.exe -v` が `1.3` を表示する
- `CArchiveReader` で EXE 内の `src.compress` を取り出し、`co_consts` に `0.15` があることを確かめる
- EXE を起動して画面が出たら、自分で起動したPIDだけを `taskkill /T /F /PID` で閉じる

- [ ] **Step 3: ユーザーに報告する**

報告すること：
- 本番の反映には `viewer` の `npm run build` が必要で、本番が配信している `dist` を書き換える。実行してよいかを聞く
- 変換用PCへ EXE を入れ替える手順
- サーバーの `models` フォルダには、`_mid.glb` も置くこと
- コミットするかどうか
