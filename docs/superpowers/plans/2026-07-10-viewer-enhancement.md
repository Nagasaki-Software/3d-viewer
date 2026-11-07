# ビューア強化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 既存Three.jsビューアを、meshopt圧縮GLB（500MB級STEP由来）を快適に表示でき、機械系エンジニア向け機能（部品タップ操作・エッジ表示・標準ビュー・注釈強化・視点ブックマーク・ライトモード）を備えたアプリに強化する。

**Architecture:** 既存の Vite + Three.js 構成とモジュール分割（viewer / annotations / storage / ui）を維持しつつ `viewer/` サブディレクトリへ移設。新規モジュール parts（部品レジストリ・選択）、bookmarks、views（標準ビュー・カメラ移動）、theme を追加。純粋ロジックは Vitest でTDD、3D描画・タッチは実データ（SampleCar.glb）で手動検証。

**Tech Stack:** Vite 8, three 0.184（既存）, MeshoptDecoder（threeに同梱）, Vitest（新規devDependency）

**前提知識（変換ツール側の出力仕様）:**
- GLBの部品 = 名前付きノード（名前は `"SampleCar/Chassis/Cover rear"` のようなパス。重複時は `#2` サフィックスで一意）
- 各部品メッシュは TRIANGLES プリミティブ + LINES プリミティブ（稜線）。three.js では named Object3D の下に Mesh と LineSegments として現れる
- gltfpack が**名前なしラッパーノード**を追加することがある（名前付きノードの祖先）。名前なしノードは部品ではない
- 法線（NORMAL属性）は**含まれない** → 読み込み後に `computeVertexNormals()` が必要
- テストデータ: `<作業PCのデスクトップ>\SampleCar.glb`（10.9MB、519部品、237万三角形）

**実行上の注意（ユーザールール・全タスク共通）:**
- 削除系コマンド（rm/rmdir/del）は実行禁止。一時ファイルは残してよい
- パッケージ追加（Task 1のvitest）は package-security-scan スキルでスキャンし、ユーザー承認を得てから
- コミットメッセージは英語・動詞始まり、末尾に `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>` を付ける
- パスはすべて `apps/3d-viewer/` からの相対

---

## ファイル構成（完成形）

```
apps/3d-viewer/
├── converter/            # 変換ツール（完成済み・触らない）
├── viewer/               # ← 既存ルートのビューア一式を移設
│   ├── index.html
│   ├── package.json      # vite, three, vitest(新規)
│   ├── vite.config.js
│   ├── public/
│   ├── src/
│   │   ├── main.js       # 配線のみ
│   │   ├── viewer.js     # シーン/カメラ/コントロール/ロード/フレームループ/ズーム安定化
│   │   ├── parts.js      # 部品レジストリ・選択・表示/非表示・強調（新規）
│   │   ├── annotations.js# 注釈v2（部品アンカー・引出し線）
│   │   ├── bookmarks.js  # 視点ブックマーク（新規）
│   │   ├── views.js      # 標準ビュー・カメラ移動アニメ（新規）
│   │   ├── theme.js      # ダーク/ライト切替（新規）
│   │   ├── storage.js    # JSON v2 パース/ビルド/v1移行
│   │   ├── ui.js         # メッセージ/ダイアログ/パネルDOM
│   │   └── style.css
│   └── tests/
│       ├── storage.test.js
│       ├── parts.test.js
│       ├── camera.test.js
│       └── bookmarks.test.js
└── docs/
```

---

### Task 1: viewer/ への移設と Vitest 導入

**Files:**
- Move: `index.html` `src/` `public/` `vite.config.js` `package.json` `package-lock.json` → `viewer/` 配下
- Modify: `viewer/package.json`（vitest追加・testスクリプト）
- Modify: `.gitignore`

- [ ] **Step 1: git mv で移設**

```bash
cd apps/3d-viewer
mkdir viewer
git mv index.html src public vite.config.js package.json package-lock.json viewer/
```

ルートの `node_modules/` は移動せず放置してよい（git管理外。削除はユーザー承認が要るため触らない）。`.gitignore` に `viewer/node_modules/` を追記する（既存の `node_modules/` 行は残す）。

- [ ] **Step 2: vitest のセキュリティスキャンとユーザー承認**

package-security-scan スキルで `vitest` をスキャン（npm系は package.json に追記して osv-scanner / npm audit）。その後ユーザーに承認を得る:
- 何を: vitest（テストランナー）を devDependencies に追加、既存の vite/three を `viewer/node_modules` に再インストール
- なぜ: storage/parts等の純粋ロジックの自動テストに必要
- 影響: `viewer/node_modules/` へのローカルインストールのみ

- [ ] **Step 3: package.json を更新してインストール**

`viewer/package.json` の scripts と devDependencies に追記:

```json
{
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview",
    "test": "vitest run"
  },
  "devDependencies": {
    "vite": "^8.0.4",
    "vitest": "^4.0.0"
  }
}
```

```bash
cd apps/3d-viewer/viewer
npm install
```

- [ ] **Step 4: 動作確認**

```bash
cd apps/3d-viewer/viewer
npm run build
```
Expected: `dist/` が生成されエラーなし（Viteのルートは viewer/ になったのでそのまま動く。`vite.config.js` の変更は不要のはず。壊れる場合のみ最小修正）。

`npx vitest run` → 「No test files found」で終了コード0または1（テスト未作成なので空でよい。以降のタスクで追加）。

- [ ] **Step 5: Commit**

```bash
git add -A viewer .gitignore
git commit -m "Move viewer app into viewer/ subdirectory and add vitest"
```

---

### Task 2: storage.js の JSON v2 対応（TDD）

注釈+ブックマークを1ファイルに保存する v2 スキーマと、旧v1（annotationsのみ・ワールド座標）の互換読み込み。

**スキーマ（v2）:**

```json
{
  "version": 2,
  "modelFile": "model.glb",
  "annotations": [
    { "id": "uuid", "label": "軸受け", "partName": "SampleCar/Axle" , "position": { "x": 0, "y": 0, "z": 0 } }
  ],
  "bookmarks": [
    { "id": "uuid", "name": "正面全体", "camera": { "position": {"x":0,"y":0,"z":3}, "target": {"x":0,"y":0,"z":0} }, "hiddenParts": ["SampleCar/Door left"], "background": "dark" }
  ]
}
```

- `partName` があれば position は**部品ローカル座標**、`partName: null` なら**ワールド座標**（v1由来）
- v1（versionフィールドなし）は `{ version: 2, annotations: [...partName:null...], bookmarks: [] }` に移行して返す

**Files:**
- Modify: `viewer/src/storage.js`（全面書き換え）
- Create: `viewer/tests/storage.test.js`

- [ ] **Step 1: 失敗するテストを書く** — `viewer/tests/storage.test.js`:

```js
import { describe, expect, it } from 'vitest';
import { buildProjectJSON, parseProjectJSON } from '../src/storage.js';

const v1json = JSON.stringify({
  modelFile: 'a.glb',
  annotations: [{ id: '1', label: 'L1', position: { x: 1, y: 2, z: 3 } }],
});

describe('parseProjectJSON', () => {
  it('v1を読み込むと partName:null の v2 になる', () => {
    const p = parseProjectJSON(v1json);
    expect(p.version).toBe(2);
    expect(p.annotations).toHaveLength(1);
    expect(p.annotations[0].partName).toBeNull();
    expect(p.annotations[0].position).toEqual({ x: 1, y: 2, z: 3 });
    expect(p.bookmarks).toEqual([]);
  });

  it('v2はそのまま読み込める（round-trip）', () => {
    const json = buildProjectJSON('m.glb',
      [{ id: 'a', label: 'ラベル', partName: 'P/Q', position: { x: 0.12345, y: 0, z: 0 } }],
      [{ id: 'b', name: 'view1', camera: { position: { x: 1, y: 1, z: 1 }, target: { x: 0, y: 0, z: 0 } }, hiddenParts: ['P/Q'], background: 'light' }]);
    const p = parseProjectJSON(json);
    expect(p.annotations[0].partName).toBe('P/Q');
    expect(p.bookmarks[0].name).toBe('view1');
    expect(p.bookmarks[0].hiddenParts).toEqual(['P/Q']);
    expect(p.bookmarks[0].background).toBe('light');
  });

  it('不正JSONは日本語メッセージで throw する', () => {
    expect(() => parseProjectJSON('{{')).toThrow(/JSON/);
  });

  it('annotations も bookmarks も無いJSONは throw する', () => {
    expect(() => parseProjectJSON('{"foo":1}')).toThrow();
  });

  it('数値でない座標は 0 に補正される', () => {
    const p = parseProjectJSON(JSON.stringify({
      version: 2, annotations: [{ id: '1', label: 'x', position: { x: 'bad' } }], bookmarks: [],
    }));
    expect(p.annotations[0].position).toEqual({ x: 0, y: 0, z: 0 });
  });
});
```

- [ ] **Step 2: 実行して失敗を確認**

Run: `cd apps/3d-viewer/viewer && npx vitest run tests/storage.test.js`
Expected: FAIL（parseProjectJSON / buildProjectJSON 未定義）

- [ ] **Step 3: storage.js を実装**

```js
/** プロジェクトJSON（注釈+ブックマーク）のパース/ビルド。v1互換読み込み対応 */

function num(v) { return Number.isFinite(Number(v)) ? Number(v) : 0; }
function vec(p) { return { x: num(p?.x), y: num(p?.y), z: num(p?.z) }; }

function normAnnotation(a, i) {
  return {
    id: String(a.id ?? crypto.randomUUID()),
    label: String(a.label ?? `ラベル ${i + 1}`),
    partName: a.partName != null ? String(a.partName) : null,
    position: vec(a.position),
  };
}

function normBookmark(b, i) {
  return {
    id: String(b.id ?? crypto.randomUUID()),
    name: String(b.name ?? `ビュー ${i + 1}`),
    camera: { position: vec(b.camera?.position), target: vec(b.camera?.target) },
    hiddenParts: Array.isArray(b.hiddenParts) ? b.hiddenParts.map(String) : [],
    background: b.background === 'light' ? 'light' : 'dark',
  };
}

/**
 * @returns {{ version: 2, modelFile: string, annotations: [], bookmarks: [] }}
 * @throws {Error} JSONが不正またはフォーマット違い
 */
export function parseProjectJSON(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('JSON の解析に失敗しました');
  }
  const hasAnn = Array.isArray(data?.annotations);
  const hasBm = Array.isArray(data?.bookmarks);
  if (!hasAnn && !hasBm) {
    throw new Error('annotations / bookmarks フィールドが見つかりません');
  }
  return {
    version: 2,
    modelFile: String(data.modelFile ?? ''),
    annotations: (hasAnn ? data.annotations : []).map(normAnnotation),
    bookmarks: (hasBm ? data.bookmarks : []).map(normBookmark),
  };
}

export function buildProjectJSON(modelFile, annotations, bookmarks) {
  const r4 = (v) => parseFloat(num(v).toFixed(4));
  const rvec = (p) => ({ x: r4(p?.x), y: r4(p?.y), z: r4(p?.z) });
  return JSON.stringify({
    version: 2,
    modelFile,
    annotations: annotations.map((a) => ({
      id: a.id, label: a.label, partName: a.partName ?? null, position: rvec(a.position),
    })),
    bookmarks: bookmarks.map((b) => ({
      id: b.id, name: b.name,
      camera: { position: rvec(b.camera.position), target: rvec(b.camera.target) },
      hiddenParts: b.hiddenParts, background: b.background,
    })),
  }, null, 2);
}

/** JSONテキストをファイルとしてダウンロードさせる（既存実装を維持） */
export function downloadJSON(filename, text) {
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 100);
}
```

（旧 `parseAnnotationJSON` / `buildAnnotationJSON` は削除し、呼び出し側 main.js は後続タスクで新APIに切り替える。このタスク時点では main.js が旧APIを参照したままでビルドが壊れるため、main.js の該当 import と使用箇所を最小修正して `parseProjectJSON` / `buildProjectJSON(modelFileName, getAnnotations(), [])` に置き換えること）

- [ ] **Step 4: テスト green を確認**

Run: `cd apps/3d-viewer/viewer && npx vitest run tests/storage.test.js`
Expected: 5 passed
`npm run build` も成功すること。

- [ ] **Step 5: Commit**

```bash
git add viewer/src/storage.js viewer/src/main.js viewer/tests/storage.test.js
git commit -m "Add project JSON v2 schema with v1 migration"
```

---

### Task 3: meshopt読み込み・法線・部品レジストリ

**Files:**
- Modify: `viewer/src/viewer.js`
- Create: `viewer/src/parts.js`
- Create: `viewer/tests/parts.test.js`

- [ ] **Step 1: 失敗するテストを書く** — `viewer/tests/parts.test.js`:

three のシーングラフはWebGL不要で構築できるため、node環境でレジストリロジックを直接検証する。

```js
import * as THREE from 'three';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  buildPartRegistry, getPartNames, getPart, setPartVisible,
  resolvePartName, hiddenPartNames, showAllParts,
} from '../src/parts.js';

function makeScene() {
  // gltfpack出力を模したツリー: root → 無名ラッパー → 名前付き部品ノード → Mesh + LineSegments
  const root = new THREE.Group();
  const wrapper = new THREE.Group(); // 無名
  const partA = new THREE.Group();
  partA.name = 'Asm/PartA';
  const meshA = new THREE.Mesh(new THREE.BufferGeometry());
  const edgeA = new THREE.LineSegments(new THREE.BufferGeometry());
  partA.add(meshA, edgeA);
  wrapper.add(partA);
  const partB = new THREE.Group();
  partB.name = 'Asm/PartB';
  partB.add(new THREE.Mesh(new THREE.BufferGeometry()));
  root.add(wrapper, partB);
  return { root, meshA, edgeA };
}

describe('parts registry', () => {
  let s;
  beforeEach(() => { s = makeScene(); buildPartRegistry(s.root); });

  it('名前付きでメッシュを持つノードだけを部品として登録する', () => {
    expect(getPartNames().sort()).toEqual(['Asm/PartA', 'Asm/PartB']);
  });

  it('メッシュから部品名を解決できる', () => {
    expect(resolvePartName(s.meshA)).toBe('Asm/PartA');
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
```

- [ ] **Step 2: 実行して失敗を確認**

Run: `cd apps/3d-viewer/viewer && npx vitest run tests/parts.test.js`
Expected: FAIL（src/parts.js 未存在）

- [ ] **Step 3: parts.js を実装**

```js
/** 部品レジストリ: GLBの名前付きノードを部品として管理する */

let registry = new Map(); // name -> { node, meshes: Mesh[], edges: LineSegments[] }

function hasMeshDescendant(obj) {
  let found = false;
  obj.traverse((o) => { if (o.isMesh || o.isLineSegments) found = true; });
  return found;
}

/** モデルルートを走査して部品レジストリを構築する（モデル読み込みごとに呼ぶ） */
export function buildPartRegistry(root) {
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
    registry.set(obj.name, { node: obj, meshes, edges });
  });
}

export function getPartNames() { return [...registry.keys()]; }
export function getPart(name) { return registry.get(name) ?? null; }
export function resolvePartName(obj) { return obj?.userData?.partName ?? null; }

export function setPartVisible(name, visible) {
  const part = registry.get(name);
  if (part) part.node.visible = visible;
}

export function hiddenPartNames() {
  return [...registry.entries()].filter(([, p]) => !p.node.visible).map(([n]) => n);
}

export function showAllParts() {
  registry.forEach((p) => { p.node.visible = true; });
}

/** エッジ（稜線）表示の一括ON/OFF */
export function setEdgesVisible(visible) {
  registry.forEach((p) => p.edges.forEach((e) => { e.visible = visible; }));
}
```

- [ ] **Step 4: viewer.js に meshopt デコーダーと法線計算を組み込む**

`viewer.js` の変更点（完全なコード。既存 loadModel を置き換え）:

```js
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
```

loadModel 内、`const loader = new GLTFLoader();` の直後に:

```js
loader.setMeshoptDecoder(MeshoptDecoder);
```

gltf 読み込み成功コールバック内、`currentModel = gltf.scene;` の直後に:

```js
// 変換ツール出力は法線を持たないため計算する（無い場合のみ）
currentModel.traverse((obj) => {
  if (obj.isMesh && !obj.geometry.attributes.normal) {
    obj.geometry.computeVertexNormals();
  }
});
```

また `renderer = new THREE.WebGLRenderer({ antialias: true })` を
`new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' })` に変更。

loadModel の resolve 前に `buildPartRegistry(currentModel)` を呼び、エッジは既定OFFにする:

```js
import { buildPartRegistry, setEdgesVisible } from './parts.js';
// ...
buildPartRegistry(currentModel);
setEdgesVisible(false); // 稜線は既定OFF（描画コール削減）。トグルはTask 8
```

既存のモデル破棄処理（dispose）はそのまま維持する。

- [ ] **Step 5: テスト green + 実データで手動確認**

Run: `npx vitest run` → storage + parts 全green。
`npm run dev` でブラウザを開き、`SampleCar.glb`（デスクトップ）をドロップ → モデルが陰影付きで表示され、コンソールにエラーがないこと。

- [ ] **Step 6: Commit**

```bash
git add viewer/src/viewer.js viewer/src/parts.js viewer/tests/parts.test.js
git commit -m "Add meshopt GLB loading, normals, and part registry"
```

---

### Task 4: ズーム安定化

**Files:**
- Modify: `viewer/src/viewer.js`
- Create: `viewer/src/camera-range.js`（純粋関数）
- Create: `viewer/tests/camera.test.js`

- [ ] **Step 1: 失敗するテストを書く** — `viewer/tests/camera.test.js`:

```js
import { describe, expect, it } from 'vitest';
import { computeCameraRange, computeControlLimits } from '../src/camera-range.js';

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
```

- [ ] **Step 2: 失敗を確認** → Run: `npx vitest run tests/camera.test.js` → FAIL

- [ ] **Step 3: camera-range.js を実装**

```js
/** カメラのnear/farとズーム限界の計算（純粋関数） */

/**
 * 注視点までの距離に応じて near/far を決める。
 * 拡大時は near を距離に比例して縮め、Zファイティングと手前欠けを防ぐ。
 * @param {number} dist カメラ→注視点距離
 * @param {number} diag モデルのバウンディングボックス対角長
 */
export function computeCameraRange(dist, diag) {
  const near = Math.max(dist / 1000, diag / 1e6);
  const far = Math.max(dist * 4 + diag * 2, near * 1000);
  return { near, far };
}

/** モデル対角長から OrbitControls の min/max ズーム距離を決める */
export function computeControlLimits(diag) {
  return { minDistance: diag * 0.005, maxDistance: diag * 4 };
}
```

- [ ] **Step 4: viewer.js に配線**

- モジュール先頭に `let modelDiag = 2;` を追加し、loadModel の自動スケーリング後（scale適用後のモデルは対角がほぼ2になるよう正規化されている）に `modelDiag = 2 * scale * maxDim / maxDim` ではなく、スケール後のboxを再計算して設定:

```js
const scaledBox = new THREE.Box3().setFromObject(currentModel);
modelDiag = scaledBox.getSize(new THREE.Vector3()).length();
const limits = computeControlLimits(modelDiag);
controls.minDistance = limits.minDistance;
controls.maxDistance = limits.maxDistance;
```

- initViewer 内の controls 設定に追加:

```js
controls.zoomToCursor = true; // 指の位置に向かってズーム
```

- animate() 内、`controls.update()` の直後に毎フレーム:

```js
const dist = camera.position.distanceTo(controls.target);
const range = computeCameraRange(dist, modelDiag);
if (Math.abs(camera.near - range.near) / range.near > 0.1) {
  camera.near = range.near;
  camera.far = range.far;
  camera.updateProjectionMatrix();
}
```

（毎フレーム updateProjectionMatrix を無条件に呼ばない — 10%以上変化した時のみ更新して負荷を抑える）

- [ ] **Step 5: green確認 + 実データ手動確認**

`npx vitest run` 全green。`npm run dev` で SampleCar.glb を読み込み:
- ホイール/ピンチでカーソル位置に向かってズームする
- ボルト1本が画面いっぱいになるまで拡大しても表面がチラつかない・手前が欠けない
- ズームアウトしてもモデルを見失わない（maxDistanceで止まる）

- [ ] **Step 6: Commit**

```bash
git add viewer/src/viewer.js viewer/src/camera-range.js viewer/tests/camera.test.js
git commit -m "Stabilize zoom with cursor targeting and dynamic clip planes"
```

---

### Task 5: 部品タップ選択と操作

設計書の「強調」ボタンは、**タップ＝選択＝強調表示**として実現する（選択された部品は常にハイライトされるため、独立したボタンは冗長）。パネルのボタンは「隠す」「すべて再表示」の2つ。

**Files:**
- Modify: `viewer/src/parts.js`（選択・強調を追加）
- Modify: `viewer/src/main.js`（タップ判定・配線）
- Modify: `viewer/index.html` / `viewer/src/style.css`（部品情報パネル）
- Modify: `viewer/tests/parts.test.js`（選択のテスト追加）

- [ ] **Step 1: 失敗するテストを追加** — parts.test.js に:

```js
import { selectPart, clearSelection, getSelectedPartName, setPartHighlight } from '../src/parts.js';

describe('part selection', () => {
  let s;
  beforeEach(() => { s = makeScene(); buildPartRegistry(s.root); });

  it('選択するとマテリアルが強調用に差し替わり、解除で元に戻る', () => {
    s.meshA.material = new THREE.MeshStandardMaterial();
    const orig = s.meshA.material;
    selectPart('Asm/PartA');
    expect(getSelectedPartName()).toBe('Asm/PartA');
    expect(s.meshA.material).not.toBe(orig);
    clearSelection();
    expect(getSelectedPartName()).toBeNull();
    expect(s.meshA.material).toBe(orig);
  });

  it('別の部品を選択すると前の選択は解除される', () => {
    s.meshA.material = new THREE.MeshStandardMaterial();
    const orig = s.meshA.material;
    selectPart('Asm/PartA');
    selectPart('Asm/PartB');
    expect(s.meshA.material).toBe(orig);
    expect(getSelectedPartName()).toBe('Asm/PartB');
  });
});
```

- [ ] **Step 2: 失敗確認** → `npx vitest run tests/parts.test.js` → 新規2件FAIL

- [ ] **Step 3: parts.js に選択・強調を実装**

```js
let selected = null;         // { name, restores: [{mesh, material}] }
const HIGHLIGHT = { color: 0x4fc3f7, emissive: 0x1a4f66 };

export function getSelectedPartName() { return selected?.name ?? null; }

export function clearSelection() {
  if (!selected) return;
  selected.restores.forEach(({ mesh, material }) => {
    mesh.material.dispose();
    mesh.material = material;
  });
  selected = null;
}

/** 部品を選択して強調表示する（既存選択は解除） */
export function selectPart(name) {
  clearSelection();
  const part = registry.get(name);
  if (!part) return;
  const restores = part.meshes.map((mesh) => {
    const material = mesh.material;
    const hl = material.clone();
    if (hl.emissive !== undefined) hl.emissive.setHex(HIGHLIGHT.emissive);
    mesh.material = hl;
    return { mesh, material };
  });
  selected = { name, restores };
}

/** 一時的な強調（ブックマーク等から使う。選択と同じ見た目） */
export function setPartHighlight(name, on) {
  if (on) selectPart(name); else clearSelection();
}
```

注意: `buildPartRegistry` の先頭で `clearSelection()` を呼ぶこと（モデル再読込時に古い参照を残さない）。

- [ ] **Step 4: main.js にタップ判定と部品パネルを配線**

index.html に部品情報パネルを追加:

```html
<div id="part-panel" class="hidden">
  <p id="part-name"></p>
  <div class="part-actions">
    <button id="part-hide">隠す</button>
    <button id="part-show-all">すべて再表示</button>
  </div>
</div>
```

main.js に追加（タップとドラッグの区別・レイキャスト・パネル制御）:

```js
import { buildPartRegistry, clearSelection, getSelectedPartName, resolvePartName, selectPart, setPartVisible, showAllParts } from './parts.js';
import { getRaycastObject } from './viewer.js';

const partPanel = document.getElementById('part-panel');
const partNameEl = document.getElementById('part-name');

let downX = 0, downY = 0, downTime = 0;
const canvasEl = () => getRenderer().domElement;

function onPointerDown(e) { downX = e.clientX; downY = e.clientY; downTime = Date.now(); }

function onPointerUp(e) {
  // 8px以上動いた、または500ms以上押していたらドラッグ（回転）とみなす
  if (Math.hypot(e.clientX - downX, e.clientY - downY) > 8) return;
  if (Date.now() - downTime > 500) return;
  handleTapSelect(e.clientX, e.clientY);
}

function handleTapSelect(x, y) {
  const hit = getRaycastObject(x, y);
  const name = hit ? resolvePartName(hit.object) : null;
  if (!name) {
    clearSelection();
    partPanel.classList.add('hidden');
    return;
  }
  selectPart(name);
  partNameEl.textContent = name.split('/').pop(); // 表示は末尾の部品名
  partNameEl.title = name;                        // フルパスはツールチップ
  partPanel.classList.remove('hidden');
}

document.getElementById('part-hide').addEventListener('click', () => {
  const name = getSelectedPartName();
  if (!name) return;
  clearSelection();
  setPartVisible(name, false);
  partPanel.classList.add('hidden');
});

document.getElementById('part-show-all').addEventListener('click', () => {
  showAllParts();
  showMessage('すべての部品を表示しました');
});
```

`initViewer` 後に `canvasEl().addEventListener('pointerdown', onPointerDown)` / `('pointerup', onPointerUp)` を登録する（モデル読込後でも同じcanvasなので初期化時でよい）。

viewer.js には交差オブジェクトを返す関数を追加（既存 getRaycastPoint と同じ計算で object も返す）:

```js
/** タッチ/クリック座標の交差情報（{point, object}）を返す。非表示部品は無視する */
export function getRaycastObject(clientX, clientY) {
  const rect = renderer.domElement.getBoundingClientRect();
  const x = ((clientX - rect.left) / rect.width) * 2 - 1;
  const y = -((clientY - rect.top) / rect.height) * 2 + 1;
  const raycaster = new THREE.Raycaster();
  raycaster.setFromCamera(new THREE.Vector2(x, y), camera);
  const hits = raycaster.intersectObjects(scene.children, true)
    .filter((h) => h.object.visible && h.object.isMesh); // 稜線・非表示は対象外
  return hits.length > 0 ? hits[0] : null;
}
```

既存 getRaycastPoint はこの関数を使うよう書き換え（`return getRaycastObject(x,y)?.point.clone() ?? null`）。
※ Raycaster は visible=false の枝も traverse するため filter が必要。祖先が非表示の場合は `h.object.parent` 連鎖の visible 確認も入れる（ヘルパー `isActuallyVisible(obj)` を parts.js に置き、`for (let o = obj; o; o = o.parent) if (!o.visible) return false; return true;`）。

style.css に部品パネルのスタイルを追加（右下固定・大きめタッチターゲット44px以上・既存パネルと同トーン。詳細な見た目はTask 9で設計システムに合わせるため最低限でよい）。

- [ ] **Step 5: green確認 + 実データ手動確認**

`npx vitest run` 全green。`npm run dev` + SampleCar.glb:
- 部品をタップ → 青系に強調され右下に部品名（例「Abdeckung hinten」）
- 「隠す」→ 消える。奥の部品が見える。「すべて再表示」で戻る
- 空きスペースタップ → 選択解除・パネル消える
- ドラッグ回転してもタップ扱いにならない

- [ ] **Step 6: Commit**

```bash
git add viewer/src viewer/index.html viewer/tests/parts.test.js
git commit -m "Add part tap selection with hide and highlight actions"
```

---

### Task 6: 注釈の強化（部品アンカー・引出し線・一覧）

**Files:**
- Modify: `viewer/src/annotations.js`（全面改修）
- Modify: `viewer/src/main.js`（追加フロー・保存/読込の v2 化）
- Modify: `viewer/index.html` / `viewer/src/style.css`（一覧パネル・引出し線SVG）

- [ ] **Step 1: annotations.js を改修**

データ構造: `{ id, label, partName, position(THREE.Vector3, partNameありならローカル座標), element, line }`

```js
import * as THREE from 'three';
import { toScreenPosition } from './viewer.js';
import { getPart } from './parts.js';

let annotations = [];
const overlay = () => document.getElementById('annotation-overlay');
const svg = () => document.getElementById('leader-svg');

const LABEL_OFFSET_Y = -48; // アンカーの上に浮かせて引出し線を見せる

export function addAnnotation(id, label, worldPoint, partName = null) {
  // 部品に紐づく場合はローカル座標で保持（部品の非表示に追従できる）
  let position = worldPoint.clone();
  if (partName) {
    const part = getPart(partName);
    if (part) position = part.node.worldToLocal(worldPoint.clone());
    else partName = null;
  }
  _addRaw(id, label, partName, position);
}

export function removeAnnotation(id) {
  const i = annotations.findIndex((a) => a.id === id);
  if (i === -1) return;
  annotations[i].element.remove();
  annotations[i].line.remove();
  annotations.splice(i, 1);
}

export function clearAnnotations() {
  annotations.forEach((a) => { a.element.remove(); a.line.remove(); });
  annotations = [];
}

export function loadAnnotations(list) {
  clearAnnotations();
  list.forEach((a) => {
    const v = new THREE.Vector3(a.position.x, a.position.y, a.position.z);
    // 保存済み座標はそのまま復元する（addAnnotationはワールド→ローカル変換を行うため使わない）
    _addRaw(a.id, a.label, a.partName && getPart(a.partName) ? a.partName : null, v);
  });
}

/** DOM要素と引出し線を生成して登録する（座標変換は行わない） */
function _addRaw(id, label, partName, position) {
  const el = document.createElement('div');
  el.className = 'annotation-label';
  el.textContent = label;
  overlay().appendChild(el);
  const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
  line.setAttribute('class', 'leader-line');
  svg().appendChild(line);
  annotations.push({ id, label, partName, position, element: el, line });
}

export function getAnnotations() {
  return annotations.map((a) => ({
    id: a.id, label: a.label, partName: a.partName,
    position: { x: a.position.x, y: a.position.y, z: a.position.z },
  }));
}

/** アンカーのワールド座標（部品アンカーは毎回部品の変換を適用） */
export function annotationWorldPoint(a) {
  if (a.partName) {
    const part = getPart(a.partName);
    if (part) return part.node.localToWorld(a.position.clone());
  }
  return a.position.clone();
}

export function updateAnnotationPositions() {
  annotations.forEach((a) => {
    const part = a.partName ? getPart(a.partName) : null;
    const hidden = part ? !part.node.visible : false;
    const world = annotationWorldPoint(a);
    const { x, y, behindCamera } = toScreenPosition(world);
    const show = !hidden && !behindCamera;
    a.element.style.visibility = show ? 'visible' : 'hidden';
    a.line.style.visibility = show ? 'visible' : 'hidden';
    if (show) {
      a.element.style.left = `${x}px`;
      a.element.style.top = `${y + LABEL_OFFSET_Y}px`;
      a.line.setAttribute('x1', x); a.line.setAttribute('y1', y);
      a.line.setAttribute('x2', x); a.line.setAttribute('y2', y + LABEL_OFFSET_Y + 8);
    }
  });
}
```

実装時は `_addRaw` を実体化し `addAnnotation` から呼ぶ構造にすること（引出し線・DOM生成の重複を避ける）。

index.html: `#annotation-overlay` の直前に `<svg id="leader-svg"></svg>` を追加し、CSSで `position:absolute; inset:0; pointer-events:none; z-index:19; width:100%; height:100%` とする。`.leader-line` は `stroke: currentColor; stroke-width: 1.5;`（色はテーマ変数に従う）。`.annotation-label` の transform は `translate(-50%, -100%)` に変更。

- [ ] **Step 2: 注釈一覧パネルとカメラジャンプ**

index.html にパネル追加:

```html
<button id="annotation-list-btn">注釈一覧</button>  <!-- #ui-panel 内 -->
<div id="annotation-list" class="hidden"></div>
```

main.js:

```js
import { annotationWorldPoint, getAnnotationsRaw } from './annotations.js';
// カメラ移動はこのタスクでは即時版 moveCamera を使う（Task 7でなめらかな移動に差し替え）

function refreshAnnotationList() {
  const box = document.getElementById('annotation-list');
  box.innerHTML = '';
  getAnnotationsRaw().forEach((a) => {
    const row = document.createElement('div');
    row.className = 'annotation-row';
    const jump = document.createElement('button');
    jump.textContent = a.label;
    jump.addEventListener('click', () => focusAnnotation(a));
    const del = document.createElement('button');
    del.className = 'annotation-del';
    del.textContent = '削除';
    del.addEventListener('click', () => { removeAnnotation(a.id); refreshAnnotationList(); });
    row.append(jump, del);
    box.appendChild(row);
  });
}

function focusAnnotation(a) {
  const target = annotationWorldPoint(a);
  const cam = getCamera();
  const dir = cam.position.clone().sub(getControls().target).normalize();
  const dist = Math.max(getModelDiag() * 0.3, getControls().minDistance * 4);
  moveCamera(target.clone().add(dir.multiplyScalar(dist)), target); // Task 7のtweenに差し替え
}
```

（viewer.js に `getCamera()` / `getControls()` / `getModelDiag()` / `moveCamera(pos, target)`（即時版）のエクスポートを追加する。moveCameraは `camera.position.copy(pos); controls.target.copy(target); controls.update();`）

annotations.js に内部配列を返す `getAnnotationsRaw()` を追加（一覧用。element参照を含む生データ）。

- [ ] **Step 3: ラベル追加フローを部品アンカー対応に**

main.js の add-label-btn ハンドラー内、`getRaycastPoint` を `getRaycastObject` に変え、交差した部品名を渡す:

```js
const hit = getRaycastObject(clientX, clientY);
if (!hit) { showMessage('モデル上をタップしてください'); return; }
showLabelDialog((text) => {
  addAnnotation(crypto.randomUUID(), text, hit.point.clone(), resolvePartName(hit.object));
  refreshAnnotationList();
}, () => {});
```

保存ボタンは `buildProjectJSON(modelFileName, getAnnotations(), getBookmarks())`（bookmarksはTask 7まで `[]`）、JSONドロップは `parseProjectJSON` → `loadAnnotations(p.annotations)` に置き換え（Task 2で仮置きした部分を確定）。

- [ ] **Step 4: 手動確認**

`npm run dev` + SampleCar.glb:
- 編集モード → ラベル追加 → 部品タップ → テキスト入力 → ラベルが引出し線付きで表示
- その部品を「隠す」→ ラベルも消える。再表示で戻る
- 注釈一覧 → タップでその注釈へカメラ移動、削除で消える
- 保存 → JSONに partName が入っている。再読込で復元される
- 旧v1のJSON（変換前に作った既存ファイルがあれば）もエラーなく読める

`npx vitest run` 全green維持。

- [ ] **Step 5: Commit**

```bash
git add viewer/src viewer/index.html
git commit -m "Anchor annotations to parts with leader lines and list panel"
```

---

### Task 7: 視点ブックマーク

**Files:**
- Create: `viewer/src/bookmarks.js`
- Create: `viewer/src/views.js`（カメラtween。標準ビューはTask 8で使う）
- Create: `viewer/tests/bookmarks.test.js`
- Modify: `viewer/src/main.js` / `viewer/index.html` / `viewer/src/style.css`

- [ ] **Step 1: 失敗するテストを書く** — `viewer/tests/bookmarks.test.js`:

```js
import { describe, expect, it } from 'vitest';
import { captureBookmark, applyBookmarkState } from '../src/bookmarks.js';

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

  it('適用時に部品可視状態とテーマを復元するコールバックを呼ぶ', () => {
    const calls = [];
    applyBookmarkState(
      { camera: { position: { x: 1, y: 1, z: 1 }, target: { x: 0, y: 0, z: 0 } }, hiddenParts: ['X'], background: 'dark' },
      {
        moveCamera: (p, t) => calls.push(['move', p.x, t.x]),
        showAllParts: () => calls.push(['showAll']),
        hidePart: (n) => calls.push(['hide', n]),
        setTheme: (bg) => calls.push(['theme', bg]),
      },
    );
    expect(calls).toEqual([['showAll'], ['hide', 'X'], ['theme', 'dark'], ['move', 1, 0]]);
  });
});
```

- [ ] **Step 2: 失敗確認** → `npx vitest run tests/bookmarks.test.js` → FAIL

- [ ] **Step 3: bookmarks.js を実装**

```js
/** 視点ブックマーク: カメラ・部品可視状態・背景モードのスナップショット */

export function captureBookmark(name, { cameraPosition, target, hiddenParts, background }) {
  return {
    id: crypto.randomUUID(),
    name,
    camera: {
      position: { ...cameraPosition },
      target: { ...target },
    },
    hiddenParts: [...hiddenParts],
    background,
  };
}

/**
 * ブックマークを適用する。副作用はコールバック経由（テスト可能にするため）。
 * 順序: 可視状態リセット → 非表示適用 → テーマ → カメラ移動
 */
export function applyBookmarkState(bookmark, { moveCamera, showAllParts, hidePart, setTheme }) {
  showAllParts();
  bookmark.hiddenParts.forEach((n) => hidePart(n));
  setTheme(bookmark.background);
  moveCamera(bookmark.camera.position, bookmark.camera.target);
}
```

- [ ] **Step 4: views.js のカメラtweenを実装**

```js
/** カメラのなめらかな移動（フレームループに乗せた線形補間+イージング） */
import * as THREE from 'three';

let active = null; // { fromPos, toPos, fromTarget, toTarget, start, ms, camera, controls }

export function animateCameraTo(camera, controls, toPos, toTarget, ms = 450) {
  active = {
    camera, controls, ms,
    fromPos: camera.position.clone(),
    toPos: new THREE.Vector3(toPos.x, toPos.y, toPos.z),
    fromTarget: controls.target.clone(),
    toTarget: new THREE.Vector3(toTarget.x, toTarget.y, toTarget.z),
    start: performance.now(),
  };
}

/** 毎フレーム呼ぶ（viewer.jsのonEachFrameに登録）。アニメ中true */
export function updateCameraAnimation() {
  if (!active) return false;
  const t = Math.min((performance.now() - active.start) / active.ms, 1);
  const e = 1 - Math.pow(1 - t, 3); // easeOutCubic
  active.camera.position.lerpVectors(active.fromPos, active.toPos, e);
  active.controls.target.lerpVectors(active.fromTarget, active.toTarget, e);
  if (t >= 1) active = null;
  return true;
}
```

main.js の初期化で `onEachFrame(updateCameraAnimation)` を登録。Task 6 の `focusAnnotation` / `moveCamera` 呼び出しを `animateCameraTo(getCamera(), getControls(), pos, target)` に差し替える。

- [ ] **Step 4b: theme.js をこのタスクで作成（ブックマークが背景モードを保存するため）**

`viewer/src/theme.js`:

```js
/** ダーク/ライトテーマ切替。CSS変数とThree.js背景色を同期する */
import { setSceneBackground } from './viewer.js';

const COLORS = { dark: 0x111118, light: 0xf2f3f5 };
let current = 'dark';

export function getTheme() { return current; }

export function setTheme(mode) {
  current = mode === 'light' ? 'light' : 'dark';
  document.documentElement.dataset.theme = current;
  setSceneBackground(COLORS[current]);
}

export function toggleTheme() { setTheme(current === 'dark' ? 'light' : 'dark'); }
```

viewer.js に追加:

```js
export function setSceneBackground(hex) { scene.background = new THREE.Color(hex); }
```

（切替ボタンとCSS変数化は Task 8。このタスクでは API だけ用意する）

- [ ] **Step 5: UIパネル（保存・一覧・適用）**

index.html: `#ui-panel` に `<button id="bookmark-btn">ビュー保存</button>` `<button id="bookmark-list-btn">ビュー一覧</button>`、一覧 `<div id="bookmark-list" class="hidden"></div>` を追加。

main.js:

```js
import { applyBookmarkState, captureBookmark } from './bookmarks.js';
import { hiddenPartNames, setPartVisible, showAllParts } from './parts.js';
import { getTheme, setTheme } from './theme.js'; // Step 4b で作成済み

let bookmarks = [];
export function getBookmarks() { return bookmarks; }

document.getElementById('bookmark-btn').addEventListener('click', () => {
  showLabelDialog((name) => {   // 既存のテキスト入力ダイアログを名前入力に流用
    const cam = getCamera(), ctl = getControls();
    bookmarks.push(captureBookmark(name, {
      cameraPosition: { x: cam.position.x, y: cam.position.y, z: cam.position.z },
      target: { x: ctl.target.x, y: ctl.target.y, z: ctl.target.z },
      hiddenParts: hiddenPartNames(),
      background: getTheme(),
    }));
    refreshBookmarkList();
    showMessage(`ビュー「${name}」を保存しました`);
  }, () => {});
});

function applyBookmark(b) {
  applyBookmarkState(b, {
    moveCamera: (p, t) => animateCameraTo(getCamera(), getControls(), p, t),
    showAllParts,
    hidePart: (n) => setPartVisible(n, false),
    setTheme,
  });
}
```

一覧のDOM生成は注釈一覧と同パターン（名前ボタン=適用、削除ボタン）。保存/読込: Task 6の save/load を `getBookmarks()` / `p.bookmarks` で完全化し、読込時に `bookmarks = p.bookmarks; refreshBookmarkList();`。

showLabelDialog のプレースホルダー文言は引数化する（`showLabelDialog(onConfirm, onCancel, { title = 'ラベルテキストを入力', placeholder = '例: エンジン部' } = {})`）。ブックマーク保存時は `{ title: 'ビュー名を入力', placeholder: '例: 正面全体' }`。

- [ ] **Step 6: green + 手動確認**

`npx vitest run` 全green。実データで: 部品をいくつか隠す → ビュー保存 → 全表示に戻す＆回転 → 一覧から適用 → カメラがなめらかに移動し隠した部品状態も再現。保存JSONに bookmarks が入り、読込で一覧が復元される。

- [ ] **Step 7: Commit**

```bash
git add viewer/src viewer/index.html viewer/tests/bookmarks.test.js
git commit -m "Add view bookmarks with camera tween and state restore"
```

---

### Task 8: 標準ビュー・エッジ表示・ライトモード

**Files:**
- Modify: `viewer/src/views.js`（標準ビュー方向）
- Modify: `viewer/src/main.js` / `viewer/index.html` / `viewer/src/style.css`
- Modify: `viewer/tests/camera.test.js`（標準ビューの計算テスト追加）

- [ ] **Step 1: 失敗するテストを追加** — camera.test.js に:

```js
import { standardViewPose } from '../src/views.js';

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
```

- [ ] **Step 2: 失敗確認** → FAIL（standardViewPose未定義）

- [ ] **Step 3: views.js に標準ビューを実装**

```js
const DIRS = {
  front: [0, 0, 1], back: [0, 0, -1],
  top: [0, 1, 0.001], bottom: [0, -1, 0.001], // 真上/真下は極特異点回避で僅かにZを足す
  left: [-1, 0, 0], right: [1, 0, 0],
  iso: [1, 0.8, 1],
};

/** 標準ビューのカメラ位置を返す（注視点は原点=モデル中心のまま） */
export function standardViewPose(name, target, diag) {
  const d = DIRS[name] ?? DIRS.front;
  const len = Math.hypot(...d);
  const dist = diag * 1.6;
  return {
    position: {
      x: target.x + (d[0] / len) * dist,
      y: target.y + (d[1] / len) * dist,
      z: target.z + (d[2] / len) * dist,
    },
    target: { ...target },
  };
}
```

- [ ] **Step 4: CSS変数によるテーマ対応（theme.js は Task 7 で作成済み）**

style.css をCSS変数化: `:root { --bg-panel: rgba(0,0,0,.65); --fg: #fff; --border: rgba(255,255,255,.25); --accent: #4fc3f7; }` / `:root[data-theme="light"] { --bg-panel: rgba(255,255,255,.85); --fg: #1a1a24; --border: rgba(0,0,0,.2); --accent: #0277bd; }` とし、パネル・ラベル・引出し線・メッセージの色指定を変数参照に置き換える（機械的な置換。全セレクタを漏れなく）。

- [ ] **Step 5: UIボタン配線**

index.html の #ui-panel に:

```html
<div id="view-buttons">
  <button data-view="front">正面</button><button data-view="back">背面</button>
  <button data-view="top">上</button><button data-view="bottom">下</button>
  <button data-view="left">左</button><button data-view="right">右</button>
  <button data-view="iso">等角</button>
</div>
<button id="edge-toggle">エッジ表示</button>
<button id="theme-toggle">ライトモード</button>
```

main.js:

```js
import { standardViewPose } from './views.js';
import { setEdgesVisible } from './parts.js';
import { toggleTheme, getTheme } from './theme.js';

document.querySelectorAll('#view-buttons [data-view]').forEach((btn) => {
  btn.addEventListener('click', () => {
    const pose = standardViewPose(btn.dataset.view, getControls().target, getModelDiag());
    animateCameraTo(getCamera(), getControls(), pose.position, pose.target);
  });
});

let edgesOn = false;
document.getElementById('edge-toggle').addEventListener('click', () => {
  edgesOn = !edgesOn;
  setEdgesVisible(edgesOn);
  document.getElementById('edge-toggle').classList.toggle('active', edgesOn);
});

document.getElementById('theme-toggle').addEventListener('click', () => {
  toggleTheme();
  document.getElementById('theme-toggle').textContent =
    getTheme() === 'dark' ? 'ライトモード' : 'ダークモード';
});
```

- [ ] **Step 6: green + 手動確認**

`npx vitest run` 全green。実データで: 各標準ビューボタンでなめらかに視点切替、エッジONでCAD風の輪郭線表示（OFFに戻せる）、ライトモードで背景・パネル・ラベルが明色に切り替わり屋外でも見やすい。エッジON時のフレームレートが実用的（カクつく場合は報告のみ、対処はTask 10で判断）。

- [ ] **Step 7: Commit**

```bash
git add viewer/src viewer/index.html
git commit -m "Add standard views, edge toggle, and light theme"
```

---

### Task 9: UIデザインの仕上げ

**Files:**
- Modify: `viewer/src/style.css` / `viewer/index.html`（構造変更は最小限）

- [ ] **Step 1: ui-ux-pro-max スキルで設計システムを生成**

対象: タッチ操作前提の3Dビューア（工場・会議室での利用、ダーク/ライト両対応、メイリオ優先）。配色・タイポグラフィ・ボタンスタイル・パネルレイアウトの指針を得る。

- [ ] **Step 2: frontend-design スキルで実装**

Step 1の指針に沿って style.css / index.html を磨く。制約:
- 機能・DOM構造・id は変えない（JSの配線を壊さない）
- タッチターゲット最小44px、ボタン間隔8px以上
- `font-family: "Meiryo UI", Meiryo, sans-serif`
- ボタン数が増えたため #ui-panel は折りたたみ（ハンバーガー）or グループ化を検討し、モデル表示領域を最大化する
- ライト/ダーク両テーマで全要素のコントラストを確認

- [ ] **Step 3: 手動確認 + Commit**

全機能をダーク/ライト両方で目視確認（タップ・パネル・ラベル・一覧）。
`npx vitest run` green、`npm run build` 成功。

```bash
git add viewer/src/style.css viewer/index.html
git commit -m "Polish viewer UI with touch-first design system"
```

---

### Task 10: 実データ検証（性能・操作チェックリスト）

**Files:**
- Create: `.claude/launch.json`（未存在なら）

- [ ] **Step 1: launch.json を作成**

```json
{
  "version": "0.0.1",
  "configurations": [
    { "name": "viewer", "runtimeExecutable": "npm", "runtimeArgs": ["--prefix", "viewer", "run", "dev"], "port": 5173 }
  ]
}
```

- [ ] **Step 2: SampleCar.glb で性能検証**

`<作業PCのデスクトップ>\SampleCar.glb`（10.9MB・519部品・237万三角形）をドロップし記録:
- 読み込み時間（ドロップ→表示まで）: 目標5秒以内
- 回転・ズーム操作のなめらかさ（体感 + `renderer.info.render.calls` をコンソールで確認。エッジOFF時 ~520、ON時 ~1040 のはず）
- エッジON/OFF両方での操作感
- ブラウザのタスクマネージャーでメモリ使用量（目標: タブあたり1.5GB以下）
- 拡大限界付近（ボルト1本）での表示品質とチラつきの有無

- [ ] **Step 3: タッチ操作チェックリスト（タッチ対応PCで実施）**

| # | 操作 | 期待結果 |
|---|---|---|
| 1 | 1本指ドラッグ | 回転 |
| 2 | ピンチ | 指の中心に向かってズーム |
| 3 | 2本指ドラッグ | パン |
| 4 | 部品タップ | 強調+部品名パネル |
| 5 | 「隠す」→内部の部品をタップ | 奥の部品が選択できる |
| 6 | 空きスペースタップ | 選択解除 |
| 7 | 編集モード→ラベル追加→タップ→入力 | 引出し線付きラベル |
| 8 | 注釈一覧から選択 | カメラ移動 |
| 9 | ビュー保存→変更→適用 | 状態復元 |
| 10 | 標準ビュー7種 | 各視点へ移動 |
| 11 | エッジ・テーマトグル | 即時切替 |
| 12 | 保存→JSON再ドロップ | 注釈+ビュー復元 |
| 13 | 旧v1注釈JSONのドロップ | エラーなく読める |
| 14 | 非対応ファイルのドロップ | 日本語エラーメッセージ |

問題があれば箇条書きで記録し、修正は別コミットで対応。

- [ ] **Step 4: Commit（launch.json と、検証で入った修正）**

```bash
git add .claude/launch.json
git commit -m "Add dev server launch config"
```

---

### Task 11: README とルート整備

**Files:**
- Create: `README.md`（リポジトリルート）

- [ ] **Step 1: ルートREADMEを書く**

```markdown
# 3D モデルビューア

タッチパネルで3Dモデル（CAD由来）を自在に動かしながら詳細を確認できるアプリ。

## 構成

| フォルダ | 役割 |
|---|---|
| `converter/` | STEP → 圧縮GLB 変換ツール（Python）。使い方は converter/README.md |
| `viewer/` | ブラウザで動く3Dビューア（Vite + Three.js） |

## 使い方（ビューア）

```
cd viewer
npm install   # 初回のみ
npm run dev
```

ブラウザで http://localhost:5173 を開き、変換済みの `.glb` をドラッグ&ドロップ。

- 部品タップ: 部品名表示・隠す・すべて再表示
- 編集モード: ラベル（注釈）追加、JSON保存/読込
- ビュー保存: カメラ位置と表示状態を記録・再現
- 標準ビュー / エッジ表示 / ライトモード切替

## テスト

- ビューア: `cd viewer && npm test`
- 変換ツール: `cd converter && .venv\Scripts\python -m pytest`
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "Add root README describing converter and viewer"
```

---

## 完了条件

- `viewer/` の vitest 全green・`npm run build` 成功
- SampleCar.glb（519部品・237万三角形）が5秒以内に表示され、回転・ズームがなめらか
- タッチ操作チェックリスト14項目すべて合格
- 設計書の採用機能（部品タップ操作・エッジ・標準ビュー・注釈v2・ブックマーク・ライトモード・ズーム安定化）がすべて動作
- 旧v1注釈JSONの互換読み込みが動作
