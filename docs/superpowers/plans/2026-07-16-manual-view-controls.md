# ボタンによる視点操作（ピンチ操作の代替） Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** タッチパネル上に回転・平行移動・ズームのボタンを追加し、ピンチ等の複数指操作が苦手なユーザーでも視点操作ができるようにする。

**Architecture:** `camera-range.js`/`views.js`と同じ「純粋関数モジュール＋viewer.jsが薄くラップ」の設計。新規`viewer/src/manual-controls.js`にカメラ位置・注視点の計算だけを行う3つの純粋関数を実装し、viewer.jsがOrbitControls(`camera`/`controls`)の現在値を渡して呼び出し、結果を反映する。UIは既存の`<details class="ui-group">`パターンで折りたたみセクションを1つ追加するのみ。

**Tech Stack:** three.js（`THREE.Vector3`/`THREE.Spherical`）、Vitest（純粋関数のユニットテスト）、素のDOM（クリックハンドラ）。

参照設計書: `docs/superpowers/specs/2026-07-15-manual-view-controls-design.md`

---

## 前提知識（既存コードから）

- `viewer/src/viewer.js`はモジュールスコープに`camera`（`THREE.PerspectiveCamera`）と`controls`（`OrbitControls`）を持つ。カメラ位置を直接変更した後は必ず`controls.update()`を呼ぶ（既存の`frameModel()`と同じ作法。`viewer/src/viewer.js:215-217`）。
- `controls.minDistance`/`controls.maxDistance`は`computeControlLimits(modelDiag)`（`viewer/src/camera-range.js`）で既に設定済み。ズームのクランプ範囲はこれをそのまま使う。
- 既存の純粋関数モジュール（`viewer/src/views.js`の`standardViewPose`/`axisUpRotation`）は、`THREE.Vector3`ではなく`{x, y, z}`のプレーンオブジェクトを引数・戻り値に使う（テストしやすく、呼び出し側がどんな型でも`.x/.y/.z`さえあれば渡せるようにするため）。新モジュールもこの慣習に合わせる。
- `controls.enabled === false`のときは操作を無視する（ラベル配置モード中など）。既存の`setControlsEnabled`（`viewer/src/viewer.js:365-378`）でこのフラグが管理されている。
- UIパネルの折りたたみセクションは`<details class="ui-group">`＋`<summary>`のみで実装されており、新しい開閉JSは不要（`viewer/index.html:53-99`）。ボタンは全てテキストのみ（アイコン画像なし）、CSSの`#ui-panel button`が`min-height: 44px`を保証済み。

---

### Task 1: `manual-controls.js` — `rotateAroundTarget`

**Files:**
- Create: `viewer/src/manual-controls.js`
- Create: `viewer/tests/manual-controls.test.js`

- [ ] **Step 1: 失敗するテストを書く**

`viewer/tests/manual-controls.test.js`を新規作成:

```js
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { rotateAroundTarget } from '../src/manual-controls.js';

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
```

- [ ] **Step 2: テストが失敗することを確認する**

Run (in `viewer/` directory): `npx vitest run tests/manual-controls.test.js`
Expected: FAIL — `manual-controls.js`が存在しない、または`rotateAroundTarget`が未定義というエラー。

- [ ] **Step 3: 最小限の実装を書く**

`viewer/src/manual-controls.js`を新規作成:

```js
/** ボタン操作（ピンチ操作の代替）用の純粋関数群。
 * OrbitControlsの内部には触れず、カメラ位置・注視点の値だけを受け取って
 * 新しいカメラ位置を計算して返す（viewer.js側がcamera.position/controls.targetに反映する）。
 */
import * as THREE from 'three';

/**
 * 注視点を中心にカメラを回転させた新しい位置を返す。
 * @param {{x:number,y:number,z:number}} cameraPos 現在のカメラ位置
 * @param {{x:number,y:number,z:number}} target 注視点
 * @param {'horizontal'|'vertical'} axis horizontal=左右(theta), vertical=上下(phi)
 * @param {number} angleRad 回転量（ラジアン）
 * @param {{min:number,max:number}} [polarLimits] verticalのクランプ範囲（既定: 真上0〜真下π）
 */
export function rotateAroundTarget(cameraPos, target, axis, angleRad, polarLimits = { min: 0, max: Math.PI }) {
  const offset = new THREE.Vector3(cameraPos.x - target.x, cameraPos.y - target.y, cameraPos.z - target.z);
  const spherical = new THREE.Spherical().setFromVector3(offset);

  if (axis === 'horizontal') {
    spherical.theta += angleRad;
  } else {
    spherical.phi = Math.max(polarLimits.min, Math.min(polarLimits.max, spherical.phi + angleRad));
  }

  const newOffset = new THREE.Vector3().setFromSpherical(spherical);
  return { x: target.x + newOffset.x, y: target.y + newOffset.y, z: target.z + newOffset.z };
}
```

- [ ] **Step 4: テストが通ることを確認する**

Run: `npx vitest run tests/manual-controls.test.js`
Expected: PASS（5件すべて）

- [ ] **Step 5: コミット**

```bash
git add viewer/src/manual-controls.js viewer/tests/manual-controls.test.js
git commit -m "feat: add rotateAroundTarget for manual view controls"
```

---

### Task 2: `manual-controls.js` — `panByScreenDirection`

**Files:**
- Modify: `viewer/src/manual-controls.js`
- Modify: `viewer/tests/manual-controls.test.js`

- [ ] **Step 1: 失敗するテストを書く**

`viewer/tests/manual-controls.test.js`の末尾（`rotateAroundTarget`の`describe`の後）に追加。まずimport行を更新:

```js
import { rotateAroundTarget, panByScreenDirection } from '../src/manual-controls.js';
```

追加するテスト:

```js
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
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `npx vitest run tests/manual-controls.test.js`
Expected: FAIL — `panByScreenDirection`が未定義というエラー（`rotateAroundTarget`のテストは引き続きPASS）。

- [ ] **Step 3: 最小限の実装を書く**

`viewer/src/manual-controls.js`の末尾に追加:

```js
const PAN_DIRECTIONS = {
  up: { axis: 1, sign: 1 },
  down: { axis: 1, sign: -1 },
  left: { axis: 0, sign: -1 },
  right: { axis: 0, sign: 1 },
};

/**
 * カメラのローカル画面方向（上下左右）へ、距離に比例した移動量のオフセットを返す。
 * 呼び出し側がこのオフセットをカメラ位置と注視点の両方に加算する。
 * @param {THREE.Matrix4} cameraMatrix カメラのワールド行列（回転成分を使う）
 * @param {'up'|'down'|'left'|'right'} direction
 * @param {number} distanceToTarget カメラ→注視点の距離
 * @param {number} panRatio 距離に対する移動量の割合（例: 0.1 = 10%）
 */
export function panByScreenDirection(cameraMatrix, direction, distanceToTarget, panRatio) {
  const { axis, sign } = PAN_DIRECTIONS[direction];
  const axisVec = new THREE.Vector3().setFromMatrixColumn(cameraMatrix, axis);
  const amount = distanceToTarget * panRatio * sign;
  return { x: axisVec.x * amount, y: axisVec.y * amount, z: axisVec.z * amount };
}
```

- [ ] **Step 4: テストが通ることを確認する**

Run: `npx vitest run tests/manual-controls.test.js`
Expected: PASS（全件）

- [ ] **Step 5: コミット**

```bash
git add viewer/src/manual-controls.js viewer/tests/manual-controls.test.js
git commit -m "feat: add panByScreenDirection for manual view controls"
```

---

### Task 3: `manual-controls.js` — `zoomByFactor`

**Files:**
- Modify: `viewer/src/manual-controls.js`
- Modify: `viewer/tests/manual-controls.test.js`

- [ ] **Step 1: 失敗するテストを書く**

import行を更新:

```js
import { rotateAroundTarget, panByScreenDirection, zoomByFactor } from '../src/manual-controls.js';
```

`viewer/tests/manual-controls.test.js`の末尾に追加:

```js
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
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `npx vitest run tests/manual-controls.test.js`
Expected: FAIL — `zoomByFactor`が未定義というエラー。

- [ ] **Step 3: 最小限の実装を書く**

`viewer/src/manual-controls.js`の末尾に追加:

```js
/**
 * 注視点からの距離をzoomStep倍（in）または1/zoomStep倍（out）にした新しいカメラ位置を返す。
 * @param {{x:number,y:number,z:number}} cameraPos
 * @param {{x:number,y:number,z:number}} target
 * @param {'in'|'out'} direction
 * @param {number} zoomStep 1回のタップで距離にかける倍率（例: 0.9）
 * @param {number} minDistance
 * @param {number} maxDistance
 */
export function zoomByFactor(cameraPos, target, direction, zoomStep, minDistance, maxDistance) {
  const offset = new THREE.Vector3(cameraPos.x - target.x, cameraPos.y - target.y, cameraPos.z - target.z);
  const dist = offset.length();
  const factor = direction === 'in' ? zoomStep : 1 / zoomStep;
  const newDist = Math.max(minDistance, Math.min(maxDistance, dist * factor));
  offset.setLength(newDist);
  return { x: target.x + offset.x, y: target.y + offset.y, z: target.z + offset.z };
}
```

- [ ] **Step 4: テストが通ることを確認する**

Run: `npx vitest run tests/manual-controls.test.js`
Expected: PASS（全件、`manual-controls.test.js`は合計13件）

- [ ] **Step 5: コミット**

```bash
git add viewer/src/manual-controls.js viewer/tests/manual-controls.test.js
git commit -m "feat: add zoomByFactor for manual view controls"
```

---

### Task 4: `viewer.js` — `rotateStep`/`panStep`/`zoomStep`の配線

**Files:**
- Modify: `viewer/src/viewer.js`

このタスクにユニットテストはない（既存の`setUpAxis`等と同じく、生きた`camera`/`controls`状態に依存する統合コードのため。ブラウザでの動作確認はTask 6で行う）。

- [ ] **Step 1: import文に`manual-controls.js`を追加**

`viewer/src/viewer.js`の先頭付近、既存のimport群（1〜9行目）に1行追加:

```js
import { rotateAroundTarget, panByScreenDirection, zoomByFactor } from './manual-controls.js';
```

- [ ] **Step 2: 定数とラッパー関数を追加**

`viewer/src/viewer.js`末尾（`export function getModelDiag() { return modelDiag; }`の後）に追加:

```js
const MANUAL_ROTATE_STEP_RAD = Math.PI / 12; // 15度
const MANUAL_PAN_RATIO = 0.1; // 距離の10%
const MANUAL_ZOOM_STEP = 0.9;

/** ボタン操作: 回転（axis: 'horizontal'|'vertical', sign: 1|-1） */
export function rotateStep(axis, sign) {
  if (!controls.enabled) return;
  const newPos = rotateAroundTarget(camera.position, controls.target, axis, sign * MANUAL_ROTATE_STEP_RAD);
  camera.position.set(newPos.x, newPos.y, newPos.z);
  controls.update();
}

/** ボタン操作: 平行移動（direction: 'up'|'down'|'left'|'right'） */
export function panStep(direction) {
  if (!controls.enabled) return;
  camera.updateMatrixWorld();
  const distanceToTarget = camera.position.distanceTo(controls.target);
  const offset = panByScreenDirection(camera.matrixWorld, direction, distanceToTarget, MANUAL_PAN_RATIO);
  camera.position.x += offset.x;
  camera.position.y += offset.y;
  camera.position.z += offset.z;
  controls.target.x += offset.x;
  controls.target.y += offset.y;
  controls.target.z += offset.z;
  controls.update();
}

/** ボタン操作: ズーム（direction: 'in'|'out'） */
export function zoomStep(direction) {
  if (!controls.enabled) return;
  const newPos = zoomByFactor(camera.position, controls.target, direction, MANUAL_ZOOM_STEP, controls.minDistance, controls.maxDistance);
  camera.position.set(newPos.x, newPos.y, newPos.z);
  controls.update();
}
```

- [ ] **Step 3: 既存テストが壊れていないことを確認する**

Run (in `viewer/` directory): `npm test`
Expected: PASS（既存の全テストスイートが通ること。新規テストは追加していないので件数は変わらない）

- [ ] **Step 4: コミット**

```bash
git add viewer/src/viewer.js
git commit -m "feat: wire manual-controls pure functions into viewer.js"
```

---

### Task 5: UI — `index.html`と`style.css`

**Files:**
- Modify: `viewer/index.html`
- Modify: `viewer/src/style.css`

- [ ] **Step 1: `index.html`に新しい折りたたみセクションを追加**

`viewer/index.html`の「標準ビュー」の`</details>`（41〜51行目）の直後、「注釈」セクションの直前に追加:

```html
      <details class="ui-group" id="manual-controls-group">
        <summary>ボタンで操作</summary>
        <p class="manual-controls-hint">ピンチ操作が難しいときに、ボタンで視点を操作できます</p>
        <div class="manual-controls-section">
          <p class="manual-controls-label">回転</p>
          <div class="ui-group-buttons">
            <button data-action="rotate" data-dir="up" aria-label="上に回転">↑</button>
            <button data-action="rotate" data-dir="down" aria-label="下に回転">↓</button>
            <button data-action="rotate" data-dir="left" aria-label="左に回転">←</button>
            <button data-action="rotate" data-dir="right" aria-label="右に回転">→</button>
          </div>
        </div>
        <div class="manual-controls-section">
          <p class="manual-controls-label">平行移動</p>
          <div class="ui-group-buttons">
            <button data-action="pan" data-dir="up" aria-label="上へ移動">↑</button>
            <button data-action="pan" data-dir="down" aria-label="下へ移動">↓</button>
            <button data-action="pan" data-dir="left" aria-label="左へ移動">←</button>
            <button data-action="pan" data-dir="right" aria-label="右へ移動">→</button>
          </div>
        </div>
        <div class="manual-controls-section">
          <p class="manual-controls-label">ズーム</p>
          <div class="ui-group-buttons">
            <button data-action="zoom" data-dir="in" aria-label="拡大">＋</button>
            <button data-action="zoom" data-dir="out" aria-label="縮小">－</button>
          </div>
        </div>
      </details>
```

- [ ] **Step 2: `style.css`にラベル・見出しのスタイルを追加**

`viewer/src/style.css`の`.ui-group-buttons`ブロック（320〜325行目）の直後に追加:

```css
/* ボタンによる視点操作（回転・平行移動・ズームの各グループの見出し・注意書き） */
.manual-controls-hint {
  font-size: 12px;
  color: var(--fg-muted);
  margin: 4px 4px 8px;
}

.manual-controls-section + .manual-controls-section {
  margin-top: 8px;
}

.manual-controls-label {
  font-size: 12px;
  color: var(--fg-muted);
  margin: 0 4px 4px;
}
```

（ボタン自体は`#ui-panel button`、行の並びは既存の`.ui-group-buttons`をそのまま再利用するため、新規CSSは見出し・間隔のみ）

- [ ] **Step 3: コミット**

```bash
git add viewer/index.html viewer/src/style.css
git commit -m "feat: add manual view controls UI section"
```

---

### Task 6: `main.js` — クリックハンドラの配線とブラウザ動作確認

**Files:**
- Modify: `viewer/src/main.js`

- [ ] **Step 1: import文に`rotateStep`/`panStep`/`zoomStep`を追加**

`viewer/src/main.js`の1行目（`viewer.js`からのimport）に3つ追加:

```js
import { initViewer, loadModel, loadLodModel, getRaycastObject, onEachFrame, setControlsEnabled, getControlsEnabled, getRenderer, getCamera, getControls, getModelDiag, setRotationCenter, resetRotationCenter, setAutoRotate, setUpAxis, getUpAxis, getRawModelSize, rotateStep, panStep, zoomStep } from './viewer.js';
```

- [ ] **Step 2: クリックハンドラを追加**

`viewer/src/main.js`の「標準ビュー」セクション（`document.querySelectorAll('#view-buttons [data-view]')...`のブロック、592〜597行目）の直後に追加:

```js
// ─── ボタンによる視点操作（ピンチ操作の代替） ─────────────────────

const MANUAL_ROTATE_AXIS_SIGN = {
  up: ['vertical', -1],
  down: ['vertical', 1],
  left: ['horizontal', -1],
  right: ['horizontal', 1],
};

document.querySelectorAll('#manual-controls-group [data-action="rotate"]').forEach((btn) => {
  btn.addEventListener('click', () => {
    const [axis, sign] = MANUAL_ROTATE_AXIS_SIGN[btn.dataset.dir];
    rotateStep(axis, sign);
  });
});

document.querySelectorAll('#manual-controls-group [data-action="pan"]').forEach((btn) => {
  btn.addEventListener('click', () => panStep(btn.dataset.dir));
});

document.querySelectorAll('#manual-controls-group [data-action="zoom"]').forEach((btn) => {
  btn.addEventListener('click', () => zoomStep(btn.dataset.dir));
});
```

- [ ] **Step 3: 既存テストが壊れていないことを確認する**

Run (in `viewer/` directory): `npm test`
Expected: PASS（全件）

- [ ] **Step 4: コミット**

```bash
git add viewer/src/main.js
git commit -m "feat: wire manual view control buttons in main.js"
```

- [ ] **Step 5: ブラウザで動作確認する（コーディネーターが実施。ユニットテスト対象外の統合部分）**

1. `npm run dev`（`viewer/`ディレクトリ）でプレビューを開き、モデルを1つ読み込む。
2. 右上パネルの「ボタンで操作」をタップして開き、44px角のボタンが4+4+2個、見やすい間隔で並んでいることを確認する。
3. 回転の↑↓←→を各1回ずつタップし、視点が15°ずつ回転すること、真上・真下付近まで回転させても反転しないこと（上限/下限クランプ）を確認する。
4. 平行移動の↑↓←→を各1回ずつタップし、視点が横にずれる（回転しない）ことを確認する。
5. ズームの＋－を各1回ずつタップし、モデルが近づく/遠ざかることを確認する。
6. 「ラベル追加」を押して操作無効化状態（`controls.enabled === false`）にし、その状態でボタンをタップしても視点が変化しない（無視される）ことを確認する。
7. マウスによるドラッグ・ホイール操作（既存のOrbitControls操作）が引き続き問題なく動作することを確認する（今回の変更が既存操作に影響していないこと）。

---

## 完了後

全タスク完了後、`superpowers:finishing-a-development-branch`スキルの4択（ローカルマージ／PR作成／このまま保持／破棄）をユーザーに提示する。
