# 注釈ラベルの表示/非表示トグル Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 既存の注釈ラベル（吹き出し）と引出し線を、右上パネルの「表示設定」メニュー内のボタン1つでワンタップ一括表示/非表示にできるようにする。

**Architecture:** `annotations.js`にモジュール内フラグ`labelsVisible`を追加し、毎フレームの表示判定（`updateAnnotationPositions`）に組み込む。`index.html`にトグルボタンを1つ追加し、`main.js`でクリック時に`setLabelsVisible()`を呼んでボタンの見た目（`active`クラス）を同期する。既存の「エッジ表示」トグルと同じパターンを踏襲する。

**Tech Stack:** Vanilla JS（Three.js, Vite）。新規ライブラリなし。

**設計書:** `docs/superpowers/specs/2026-07-22-label-visibility-toggle-design.md`

**テスト方針:** この機能はDOM状態の一括切り替えのみで、新規の純粋関数（`camera-range.js`や`manual-controls.js`のような単体テスト対象）を作らない。設計書の方針どおり、ユニットテストは追加せず、Task 4でブラウザによる動作確認を行う。

---

### Task 1: annotations.js に表示/非表示フラグを追加する

**Files:**
- Modify: `viewer/src/annotations.js:10`（状態宣言部）
- Modify: `viewer/src/annotations.js:136-154`（`updateAnnotationPositions`関数）

- [ ] **Step 1: フラグと切り替え関数を追加**

`viewer/src/annotations.js`の10行目、`let annotations = [];`の直後に以下を追加する。

```js
let annotations = [];
let labelsVisible = true;

/** ラベル・引出し線の一括表示/非表示を切り替える */
export function setLabelsVisible(visible) {
  labelsVisible = visible;
}
```

- [ ] **Step 2: 表示判定にフラグを組み込む**

`updateAnnotationPositions`関数内（136〜154行目付近）の`const show = !hidden && !behindCamera;`を、以下のように変更する。

変更前:
```js
    const show = !hidden && !behindCamera;
```

変更後:
```js
    const show = labelsVisible && !hidden && !behindCamera;
```

関数全体は次の形になる（確認用。他の行は変更しない）:

```js
export function updateAnnotationPositions() {
  annotations.forEach((a) => {
    const part = a.partName ? getPart(a.partName) : null;
    const hidden = part ? !part.node.visible : false;
    const world = annotationWorldPoint(a);
    const { x, y, behindCamera } = toScreenPosition(world);
    const show = labelsVisible && !hidden && !behindCamera;
    a.element.style.visibility = show ? 'visible' : 'hidden';
    a.line.style.visibility = show ? 'visible' : 'hidden';
    if (show) {
      a.element.style.left = `${x}px`;
      a.element.style.top = `${y + LABEL_OFFSET_Y}px`;
      a.line.setAttribute('x1', x);
      a.line.setAttribute('y1', y);
      a.line.setAttribute('x2', x);
      a.line.setAttribute('y2', y + LABEL_OFFSET_Y + 8);
    }
  });
}
```

- [ ] **Step 3: Viteのビルドエラーがないことを確認**

Run: `cd viewer && npx vite build`
Expected: `built in` のメッセージが出てエラーなく完了する（この段階ではボタン未配線のため、機能はまだ使えない状態でよい）。

- [ ] **Step 4: コミット**

```bash
git add viewer/src/annotations.js
git commit -m "feat: add labelsVisible flag to annotations module"
```

---

### Task 2: index.html にトグルボタンを追加する

**Files:**
- Modify: `viewer/index.html:108-114`（「表示設定」の`ui-group`）

- [ ] **Step 1: ボタンを追加**

`viewer/index.html`の「表示設定」グループ（108〜114行目）を以下のように変更する。

変更前:
```html
      <details class="ui-group">
        <summary>表示設定</summary>
        <div class="ui-group-buttons">
          <button id="edge-toggle">エッジ表示</button>
          <button id="exhibit-toggle">展示モード</button>
          <button id="theme-toggle">ライトモード</button>
        </div>
```

変更後:
```html
      <details class="ui-group">
        <summary>表示設定</summary>
        <div class="ui-group-buttons">
          <button id="labels-toggle" class="active">ラベル表示</button>
          <button id="edge-toggle">エッジ表示</button>
          <button id="exhibit-toggle">展示モード</button>
          <button id="theme-toggle">ライトモード</button>
        </div>
```

`class="active"`を初期状態で付けておくことで、既存の`#ui-panel button.active`スタイル（`viewer/src/style.css:254`）がそのまま適用され、新規CSSは不要になる。

- [ ] **Step 2: コミット**

```bash
git add viewer/index.html
git commit -m "feat: add labels-toggle button to display settings group"
```

---

### Task 3: main.js でクリックハンドラを配線する

**Files:**
- Modify: `viewer/src/main.js:4`（import文）
- Modify: `viewer/src/main.js:623-630`（エッジ表示トグルの直前に追加）

- [ ] **Step 1: import文に`setLabelsVisible`を追加**

`viewer/src/main.js`の4行目を以下のように変更する。

変更前:
```js
import { addAnnotation, removeAnnotation, loadAnnotations, getAnnotations, getAnnotationsRaw, annotationWorldPoint, updateAnnotationPositions, clearAnnotations } from './annotations.js';
```

変更後:
```js
import { addAnnotation, removeAnnotation, loadAnnotations, getAnnotations, getAnnotationsRaw, annotationWorldPoint, updateAnnotationPositions, clearAnnotations, setLabelsVisible } from './annotations.js';
```

- [ ] **Step 2: クリックハンドラを追加**

`viewer/src/main.js`の「エッジ表示トグル」セクション（`// ─── エッジ表示トグル ───`、623行目付近）の直前に、以下を追加する。

```js
// ─── ラベル表示トグル ─────────────────────────────────────────

let labelsOn = true;
document.getElementById('labels-toggle').addEventListener('click', () => {
  labelsOn = !labelsOn;
  setLabelsVisible(labelsOn);
  document.getElementById('labels-toggle').classList.toggle('active', labelsOn);
});

```

- [ ] **Step 3: Viteのビルドエラーがないことを確認**

Run: `cd viewer && npx vite build`
Expected: `built in` のメッセージが出てエラーなく完了する。

- [ ] **Step 4: コミット**

```bash
git add viewer/src/main.js
git commit -m "feat: wire labels-toggle button to setLabelsVisible"
```

---

### Task 4: ブラウザで動作確認する

**Files:** なし（動作確認のみ）

- [ ] **Step 1: 開発サーバーを起動**

Run: `cd viewer && npx vite`
Expected: `Local: http://localhost:5173/` のようなURLが表示される。

- [ ] **Step 2: GLBモデルを読み込み、注釈ラベルを最低1つ追加する**

編集モードでモデルをドラッグ&ドロップし、「ラベル追加」で部品をタップしてラベルを1つ以上作成する（既に注釈JSONがあるモデルならそれを使ってもよい）。

- [ ] **Step 3: 「表示設定」→「ラベル表示」をタップし、ラベル・引出し線が一括で非表示になることを確認する**

Expected: 全てのラベルの吹き出しと引出し線が消える。3Dモデル自体の表示・操作（回転・パン・ズーム、部品タップ）は影響を受けない。

- [ ] **Step 4: 再度タップし、ラベルが再表示されることを確認する**

Expected: 全てのラベル・引出し線が元通り表示される。

- [ ] **Step 5: 非表示中に新しいラベルを追加した場合の挙動を確認する**

「ラベル表示」をOFFのまま「ラベル追加」で新規ラベルを1つ作成する。

Expected: 新規追加したラベルも非表示のままになる（表示されない）。

- [ ] **Step 6: 閲覧モードでもボタンが使えることを確認する**

「編集モードへ」ボタンで閲覧モードに切り替え、「表示設定」→「ラベル表示」がタップでき、ON/OFFが切り替わることを確認する。

- [ ] **Step 7: モード切り替えでボタンの状態が保たれることを確認する**

ラベル表示をOFFにした状態で閲覧⇔編集モードを切り替え、OFF状態が維持されることを確認する。

- [ ] **Step 8: ページを再読み込みし、ラベル表示が「ON」に戻ることを確認する**

Expected: リロード後は初期状態（ON）に戻る（状態は保存しない設計のため）。

- [ ] **Step 9: 開発サーバーを停止**

動作確認が完了したらターミナルで`Ctrl+C`を押して開発サーバーを停止する。
