# ビューア追加機能 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** タイトル/スペックカード表示・展示モード（自動回転）・回転中心の任意設定をビューアに追加し、変換ツールの読み込み表示不具合を別プロセス化で修正する。

**Architecture:** ビューアは既存モジュール構成を踏襲し、新規は gestures.js（ダブルタップ判定）と exhibit.js（展示モード状態機械）のみ。カード表示は main.js 配線 + CSS。変換ツールは threading を multiprocessing に置き換え、Windows spawn 対応のモジュールレベルエントリ `worker.py` を新設する。

**Tech Stack:** three 0.184 / Vite / Vitest（既存）、Python multiprocessing（標準ライブラリ）

**設計書:** `docs/superpowers/specs/2026-07-11-viewer-additions-design.md`

**実行上の注意（全タスク共通）:**
- 削除系コマンド禁止。パッケージ追加・ダウンロード禁止。開発サーバー・ブラウザ起動禁止（ランタイム検証はコントローラーが実施）
- 一時ファイルは %TEMP% 配下のみ
- コミットは英語・動詞始まり、末尾に `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`
- 現在のテスト数: viewer vitest 23件 / converter pytest 23件。各タスク完了時に全件green + `npm run build`（viewerタスク時）を維持

---

## ファイル構成（変更対象）

```
viewer/src/
├── storage.js      # meta {title, specs} 対応（Task 1）
├── ui.js           # ダイアログの複数行入力対応（Task 2）
├── main.js         # カード表示・編集、ダブルタップ、展示モード配線（Task 2-4）
├── viewer.js       # setRotationCenter/resetRotationCenter/setAutoRotate（Task 3-4）
├── gestures.js     # 新規: ダブルタップ判定（Task 3）
├── exhibit.js      # 新規: 展示モード状態機械（Task 4）
├── style.css       # カード・パネル再配置（Task 2）
└── index.html      # カード・textarea・展示モードボタン（Task 2-4）
converter/src/
├── worker.py       # 新規: 別プロセスエントリ（Task 5）
├── gui.py          # threading → multiprocessing（Task 6）
└── main.py         # freeze_support 追加（Task 6）
```

---

### Task 1: storage.js の meta 対応（TDD）

**Files:**
- Modify: `viewer/src/storage.js`
- Modify: `viewer/tests/storage.test.js`

- [ ] **Step 1: 失敗するテストを追加** — storage.test.js に:

```js
describe('meta', () => {
  it('metaが無いJSONは title:null / specs:"" になる', () => {
    const p = parseProjectJSON(v1json);
    expect(p.meta).toEqual({ title: null, specs: '' });
  });

  it('metaはround-tripする', () => {
    const json = buildProjectJSON('m.glb', [], [], { title: '搬送ロボット A-100', specs: '寸法: 1200x800mm\n重量: 350kg' });
    const p = parseProjectJSON(json);
    expect(p.meta.title).toBe('搬送ロボット A-100');
    expect(p.meta.specs).toContain('350kg');
  });
});
```

- [ ] **Step 2: 失敗確認** — Run: `cd <リポジトリ>/viewer && npx vitest run tests/storage.test.js` → FAIL（p.metaがundefined）

- [ ] **Step 3: 実装** — storage.js:

```js
function normMeta(m) {
  return {
    title: m?.title != null ? String(m.title) : null,
    specs: m?.specs != null ? String(m.specs) : '',
  };
}
```

- parseProjectJSON の戻り値に `meta: normMeta(data.meta)` を追加
- buildProjectJSON のシグネチャを `buildProjectJSON(modelFile, annotations, bookmarks, meta = { title: null, specs: '' })` に変更し、出力JSONに `meta: { title: meta.title, specs: meta.specs }` を含める

- [ ] **Step 4: green確認** — 既存5件+新2件=7件PASS、全体25件PASS

- [ ] **Step 5: Commit** — `git add viewer/src/storage.js viewer/tests/storage.test.js` / message: "Add title and specs metadata to project JSON"

---

### Task 2: タイトル・スペックカード表示と編集

**Files:**
- Modify: `viewer/index.html` / `viewer/src/ui.js` / `viewer/src/main.js` / `viewer/src/style.css`

- [ ] **Step 1: index.html にカードとtextareaを追加**

`#app` 内（#drop-zone の後）:

```html
<div id="model-title" class="info-card hidden"></div>
<div id="model-specs" class="info-card hidden"></div>
```

`#label-dialog` 内の `#label-input` の直後に:

```html
<textarea id="label-textarea" class="hidden" rows="5"></textarea>
```

- [ ] **Step 2: ui.js の showLabelDialog を複数行対応に**

options に `multiline = false` と `initial = ''` を追加。multiline時は #label-input を隠して #label-textarea を表示し、確定時はアクティブな方の値を使う。Enterキー確定はinput時のみ（textareaは改行のため無効。Escapeは両方有効）:

```js
export function showLabelDialog(onConfirm, onCancel,
    { title = 'ラベルテキストを入力', placeholder = '例: エンジン部', multiline = false, initial = '' } = {}) {
  const dialog = document.getElementById('label-dialog');
  const input = document.getElementById('label-input');
  const textarea = document.getElementById('label-textarea');
  const field = multiline ? textarea : input;
  const confirmBtn = document.getElementById('label-confirm');
  const cancelBtn = document.getElementById('label-cancel');

  if (!dialog.classList.contains('hidden')) return;
  document.getElementById('label-dialog-title').textContent = title;
  input.classList.toggle('hidden', multiline);
  textarea.classList.toggle('hidden', !multiline);
  field.placeholder = placeholder;
  field.value = initial;
  dialog.classList.remove('hidden');
  setTimeout(() => field.focus(), 50);

  function cleanup() {
    confirmBtn.removeEventListener('click', handleConfirm);
    cancelBtn.removeEventListener('click', handleCancel);
    field.removeEventListener('keydown', handleKey);
    dialog.classList.add('hidden');
  }
  function handleConfirm() {
    const text = field.value.trim();
    if (!text && !multiline) return;   // 複数行（スペック）は空で確定=クリア扱いを許可
    cleanup();
    onConfirm(text);
  }
  function handleCancel() { cleanup(); onCancel?.(); }
  function handleKey(e) {
    if (e.key === 'Enter' && !multiline) handleConfirm();
    if (e.key === 'Escape') handleCancel();
  }
  confirmBtn.addEventListener('click', handleConfirm);
  cancelBtn.addEventListener('click', handleCancel);
  field.addEventListener('keydown', handleKey);
}
```

- [ ] **Step 3: main.js にカード状態と編集を配線**

```js
// ─── タイトル・スペックカード ───
let modelMeta = { title: null, specs: '' };

function displayTitle() {
  return modelMeta.title ?? modelFileName.replace(/\.(glb|gltf)$/i, '');
}

function refreshInfoCards() {
  const titleEl = document.getElementById('model-title');
  const specsEl = document.getElementById('model-specs');
  titleEl.textContent = displayTitle();
  titleEl.classList.toggle('hidden', !modelLoaded);
  const showSpecs = modelLoaded && (modelMeta.specs || mode === 'edit');
  specsEl.textContent = modelMeta.specs || 'スペック未入力（タップして入力）';
  specsEl.classList.toggle('placeholder', !modelMeta.specs);
  specsEl.classList.toggle('hidden', !showSpecs);
}

document.getElementById('model-title').addEventListener('click', () => {
  if (mode !== 'edit') return;
  showLabelDialog((text) => { modelMeta.title = text; refreshInfoCards(); }, () => {},
    { title: '機器・装置の名称を入力', placeholder: '例: 搬送ロボット A-100', initial: displayTitle() });
});

document.getElementById('model-specs').addEventListener('click', () => {
  if (mode !== 'edit') return;
  showLabelDialog((text) => { modelMeta.specs = text; refreshInfoCards(); }, () => {},
    { title: 'スペックを入力（複数行可）', placeholder: '寸法: 1200x800mm\n重量: 350kg', multiline: true, initial: modelMeta.specs });
});
```

配線ポイント:
- handleGLBDrop 成功時: `modelMeta = { title: null, specs: '' }; refreshInfoCards();`
- モード切替ハンドラー: `applyMode(mode)` の後に `refreshInfoCards()`（編集モードで空スペックカードを出すため）
- 保存: `buildProjectJSON(modelFileName, annotations, bookmarks, { title: displayTitle(), specs: modelMeta.specs })`
- JSONドロップ: `modelMeta = { title: p.meta.title, specs: p.meta.specs }; refreshInfoCards();`

- [ ] **Step 4: style.css にカードとパネル再配置**

```css
/* 情報カード（タイトル・スペック） */
.info-card {
  position: absolute;
  background: var(--bg-panel);
  color: var(--fg);
  border: 1px solid var(--border);
  border-radius: 12px;
  backdrop-filter: blur(8px);
  z-index: 25;
  max-width: min(340px, 40vw);
}
#model-title {
  top: 16px;
  left: 16px;
  padding: 12px 20px;
  font-size: 18px;
  font-weight: 700;
}
#model-specs {
  bottom: 16px;
  left: 16px;
  padding: 10px 16px;
  font-size: 12.5px;
  line-height: 1.6;
  white-space: pre-wrap;
}
#model-specs.placeholder { color: var(--fg-muted); }
#label-textarea { /* #label-input と同じ見た目で高さのみ可変 */ }
```

- #label-textarea には #label-input と同じ background/border/color/padding/font のルールを適用（セレクタに併記）
- パネル再配置: `#annotation-list` は `top: 72px; left: 16px;`（タイトルの下）、`#bookmark-list` は `bottom: 96px; left: 16px;`（スペックの上）に変更。実機表示で重なる場合は値を微調整してよい（コミットメッセージに記載）
- 編集モード中のカードに `cursor: pointer` とわかりやすい枠（例 `outline: 1px dashed var(--accent)`）を付ける場合は `body` ではなく `:root` にモード用クラスを付与するのではなく、`applyMode` で各カードに `editable` クラスを付け外しして `.info-card.editable { cursor: pointer; outline: 1px dashed var(--accent); }` とする

- [ ] **Step 5: 検証とCommit**

`npx vitest run` 25件PASS・`npm run build` 成功。
`git add viewer/index.html viewer/src/ui.js viewer/src/main.js viewer/src/style.css` / message: "Add title and specs info cards with edit dialogs"

---

### Task 3: 回転中心の任意設定（ダブルタップ）

**Files:**
- Create: `viewer/src/gestures.js`
- Create: `viewer/tests/gestures.test.js`
- Modify: `viewer/src/viewer.js` / `viewer/src/main.js`

- [ ] **Step 1: 失敗するテスト** — `viewer/tests/gestures.test.js`:

```js
import { describe, expect, it } from 'vitest';
import { createDoubleTapDetector } from '../src/gestures.js';

describe('createDoubleTapDetector', () => {
  it('時間・距離内の2連続タップでダブルタップ', () => {
    const feed = createDoubleTapDetector({ maxDelayMs: 350, maxDistPx: 24 });
    expect(feed(100, 100, 1000)).toBe(false);
    expect(feed(105, 102, 1200)).toBe(true);
  });
  it('間隔が長いとダブルタップにならない', () => {
    const feed = createDoubleTapDetector({ maxDelayMs: 350, maxDistPx: 24 });
    feed(100, 100, 1000);
    expect(feed(100, 100, 1500)).toBe(false);
  });
  it('離れた位置ではダブルタップにならない', () => {
    const feed = createDoubleTapDetector({ maxDelayMs: 350, maxDistPx: 24 });
    feed(100, 100, 1000);
    expect(feed(200, 100, 1100)).toBe(false);
  });
  it('3連続タップは2回目のみtrue（リセットされる）', () => {
    const feed = createDoubleTapDetector({ maxDelayMs: 350, maxDistPx: 24 });
    feed(100, 100, 1000);
    expect(feed(100, 100, 1100)).toBe(true);
    expect(feed(100, 100, 1200)).toBe(false);
  });
});
```

- [ ] **Step 2: 失敗確認** — Run: `npx vitest run tests/gestures.test.js` → FAIL（モジュール無し）

- [ ] **Step 3: gestures.js を実装**

```js
/** ダブルタップ判定（純粋ロジック）。タップごとに (x, y, 時刻ms) を渡すと真偽を返す */
export function createDoubleTapDetector({ maxDelayMs = 350, maxDistPx = 24 } = {}) {
  let last = null;
  return function feedTap(x, y, now) {
    if (last && now - last.t <= maxDelayMs
        && Math.hypot(x - last.x, y - last.y) <= maxDistPx) {
      last = null; // 3連打が2連続ダブル判定にならないようリセット
      return true;
    }
    last = { x, y, t: now };
    return false;
  };
}
```

- [ ] **Step 4: viewer.js に回転中心APIを追加**

```js
/** 回転中心を設定し、位置に一瞬マーカーを表示する */
export function setRotationCenter(point) {
  controls.target.copy(point);
  const marker = new THREE.Mesh(
    new THREE.SphereGeometry(modelDiag * 0.008, 16, 12),
    new THREE.MeshBasicMaterial({ color: 0x4fc3f7, transparent: true, opacity: 0.9 }),
  );
  marker.position.copy(point);
  scene.add(marker);
  setTimeout(() => {
    scene.remove(marker);
    marker.geometry.dispose();
    marker.material.dispose();
  }, 600);
}

/** 回転中心をモデル中央（原点）に戻す */
export function resetRotationCenter() {
  controls.target.set(0, 0, 0);
}
```

- [ ] **Step 5: main.js に配線**

- `const feedDoubleTap = createDoubleTapDetector();` をモジュールレベルに追加
- onPointerUp のタップ確定箇所（handleTapSelect呼び出しの直前）で:

```js
const isDouble = feedDoubleTap(e.clientX, e.clientY, Date.now());
if (isDouble) {
  const hit = getRaycastObject(e.clientX, e.clientY);
  if (hit) {
    setRotationCenter(hit.point);
    showMessage('回転中心を設定しました');
  } else {
    resetRotationCenter();
    showMessage('回転中心をモデル中央に戻しました');
  }
  return; // ダブルタップ時は部品選択処理をスキップ（1回目のタップで選択済み）
}
```

- 標準ビューボタンの配線を `standardViewPose(btn.dataset.view, { x: 0, y: 0, z: 0 }, getModelDiag())` に変更（回転中心もモデル中央へリセットされる）

- [ ] **Step 6: 検証とCommit**

`npx vitest run` 29件PASS・`npm run build` 成功。
`git add viewer/src/gestures.js viewer/tests/gestures.test.js viewer/src/viewer.js viewer/src/main.js` / message: "Add double-tap rotation center with visual marker"

---

### Task 4: 展示モード（TDD）

**Files:**
- Create: `viewer/src/exhibit.js`
- Create: `viewer/tests/exhibit.test.js`
- Modify: `viewer/src/viewer.js` / `viewer/src/main.js` / `viewer/index.html`

- [ ] **Step 1: 失敗するテスト** — `viewer/tests/exhibit.test.js`:

```js
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createExhibitMode } from '../src/exhibit.js';

describe('createExhibitMode', () => {
  let calls;
  let exhibit;
  beforeEach(() => {
    vi.useFakeTimers();
    calls = [];
    exhibit = createExhibitMode({ setAutoRotate: (on) => calls.push(on), idleMs: 30000 });
  });
  afterEach(() => vi.useRealTimers());

  it('開始で回転ON、停止でOFF', () => {
    exhibit.start();
    expect(calls).toEqual([true]);
    exhibit.stop();
    expect(calls).toEqual([true, false]);
    expect(exhibit.isActive()).toBe(false);
  });

  it('操作で一時停止し、30秒無操作で再開する', () => {
    exhibit.start();
    exhibit.notifyInteraction();
    expect(calls).toEqual([true, false]);
    vi.advanceTimersByTime(29999);
    expect(calls).toEqual([true, false]);
    vi.advanceTimersByTime(1);
    expect(calls).toEqual([true, false, true]);
  });

  it('操作のたびにタイマーはリセットされる', () => {
    exhibit.start();
    exhibit.notifyInteraction();
    vi.advanceTimersByTime(20000);
    exhibit.notifyInteraction();
    vi.advanceTimersByTime(20000);
    expect(calls.filter((c) => c === true)).toHaveLength(1); // まだ再開しない
    vi.advanceTimersByTime(10000);
    expect(calls[calls.length - 1]).toBe(true);
  });

  it('停止後はタイマーが残っていても再開しない', () => {
    exhibit.start();
    exhibit.notifyInteraction();
    exhibit.stop();
    vi.advanceTimersByTime(60000);
    expect(calls[calls.length - 1]).toBe(false);
  });

  it('非アクティブ時のnotifyInteractionは何もしない', () => {
    exhibit.notifyInteraction();
    expect(calls).toEqual([]);
  });
});
```

- [ ] **Step 2: 失敗確認** — Run: `npx vitest run tests/exhibit.test.js` → FAIL

- [ ] **Step 3: exhibit.js を実装**

```js
/** 展示モード: ターンテーブル自動回転と「操作で停止→無操作で再開」の状態管理 */
export function createExhibitMode({ setAutoRotate, idleMs = 30000 }) {
  let active = false;
  let timer = null;

  function clearTimer() {
    if (timer) { clearTimeout(timer); timer = null; }
  }

  return {
    isActive: () => active,
    start() { active = true; clearTimer(); setAutoRotate(true); },
    stop() { active = false; clearTimer(); setAutoRotate(false); },
    notifyInteraction() {
      if (!active) return;
      setAutoRotate(false);
      clearTimer();
      timer = setTimeout(() => { if (active) setAutoRotate(true); }, idleMs);
    },
  };
}
```

- [ ] **Step 4: viewer.js に自動回転APIを追加**

- initViewer の controls 設定に `controls.autoRotateSpeed = 2.0;`（約30秒/周）を追加
- export を追加:

```js
/** ターンテーブル自動回転のON/OFF（展示モード用） */
export function setAutoRotate(on) { controls.autoRotate = on; }
```

- [ ] **Step 5: main.js と index.html に配線**

index.html の表示設定グループ（#edge-toggle の隣）に `<button id="exhibit-toggle">展示モード</button>` を追加。

main.js:

```js
import { createExhibitMode } from './exhibit.js';
import { setAutoRotate } from './viewer.js';

const exhibit = createExhibitMode({ setAutoRotate });

document.getElementById('exhibit-toggle').addEventListener('click', () => {
  if (!modelLoaded) { showMessage('先に GLB ファイルを読み込んでください'); return; }
  const btn = document.getElementById('exhibit-toggle');
  if (exhibit.isActive()) {
    exhibit.stop();
    btn.classList.remove('active');
    showMessage('展示モードを終了しました');
  } else {
    exhibit.start();
    btn.classList.add('active');
    showMessage('展示モード: 操作すると一時停止し、30秒後に再開します', 5000);
  }
});
```

canvas のリスナー登録箇所（initViewer後）に追加:

```js
canvasEl().addEventListener('pointerdown', () => exhibit.notifyInteraction());
canvasEl().addEventListener('wheel', () => exhibit.notifyInteraction(), { passive: true });
```

（既存の onPointerDown と重複登録になるが、別関数なので干渉しない）

- [ ] **Step 6: 検証とCommit**

`npx vitest run` 34件PASS・`npm run build` 成功。
`git add viewer/src/exhibit.js viewer/tests/exhibit.test.js viewer/src/viewer.js viewer/src/main.js viewer/index.html` / message: "Add exhibit mode with auto-resume turntable rotation"

---

### Task 5: 変換ツールの別プロセスエントリ（TDD）

**Files:**
- Create: `converter/src/worker.py`
- Create: `converter/tests/test_worker.py`

- [ ] **Step 1: 失敗するテスト** — `converter/tests/test_worker.py`:

```python
import multiprocessing as mp
import queue as queue_mod

from tests.conftest import needs_gltfpack


def _drain(q):
    msgs = []
    while True:
        try:
            msgs.append(q.get(timeout=1))
        except queue_mod.Empty:
            return msgs


@needs_gltfpack
def test_run_convert_in_subprocess(fixture_step, tmp_path):
    from src.worker import run_convert
    ctx = mp.get_context("spawn")
    q = ctx.Queue()
    out = tmp_path / "out.glb"
    p = ctx.Process(target=run_convert,
                    args=(str(fixture_step), str(out), "standard", q))
    p.start()
    p.join(timeout=300)
    assert p.exitcode == 0
    msgs = _drain(q)
    stages = [v for k, v in msgs if k == "stage"]
    assert stages == ["load", "tessellate", "build", "compress", "done"]
    assert msgs[-1][0] == "ok"
    assert out.exists()


def test_run_convert_reports_error(tmp_path):
    from src.worker import run_convert
    ctx = mp.get_context("spawn")
    q = ctx.Queue()
    p = ctx.Process(target=run_convert,
                    args=(str(tmp_path / "missing.step"), str(tmp_path / "o.glb"), "standard", q))
    p.start()
    p.join(timeout=120)
    msgs = _drain(q)
    assert msgs[-1][0] == "error"
    assert "STEP" in msgs[-1][1]  # 日本語エラーメッセージが伝わる
```

- [ ] **Step 2: 失敗確認** — Run: `cd <リポジトリ>/converter && .venv/Scripts/python -m pytest tests/test_worker.py -v` → FAIL（src.worker無し）

- [ ] **Step 3: worker.py を実装**

```python
"""変換を別プロセスで実行するエントリ。

OCPのSTEP読み込みはGILを離さないため、スレッドではGUIが固まる。
Windowsのspawn方式で子プロセスからimportできるよう、モジュールレベル関数にする。
"""
from src.pipeline import convert


def run_convert(step_path, out_path, quality, q):
    """queueへ ('stage', name) / ('ok', path) / ('error', message) を送る"""
    try:
        convert(step_path, out_path, quality,
                progress=lambda s: q.put(("stage", s)))
        q.put(("ok", str(out_path)))
    except Exception as e:  # noqa: 例外はすべてGUIへ文字列で伝える
        q.put(("error", str(e)))
```

- [ ] **Step 4: green確認** — 2件PASS、全体25件PASS（子プロセスでの `src` import が失敗する場合は、テスト冒頭で `os.environ["PYTHONPATH"] = str(Path(__file__).parent.parent)` を設定してから Process を起動する方式に調整し、レポートに記載）

- [ ] **Step 5: Commit** — `git add converter/src/worker.py converter/tests/test_worker.py` / message: "Add subprocess conversion entry for GUI responsiveness"

---

### Task 6: 変換ツールGUIの multiprocessing 化

**Files:**
- Modify: `converter/src/gui.py` / `converter/main.py`

- [ ] **Step 1: gui.py を書き換え**

- `import threading` を `import multiprocessing` に置き換え、`from src.worker import run_convert` を追加
- `_STAGE_TEXT` に `"boot": "変換プログラムを準備中…"` を追加
- `__init__` の `self.queue: queue.Queue = queue.Queue()` は削除し、start() で毎回作る
- start() / _run / _poll を以下に置き換え（_runは削除）:

```python
    def start(self):
        out = self.step_path.with_suffix(".glb")
        quality = self.quality.get()
        self.convert_btn.config(state="disabled")
        ctx = multiprocessing.get_context("spawn")
        self.queue = ctx.Queue()
        self.status.config(text=_STAGE_TEXT["boot"], fg="#333")
        self.proc = ctx.Process(
            target=run_convert,
            args=(str(self.step_path), str(out), quality, self.queue),
            daemon=True,
        )
        self.proc.start()
        self.root.after(100, self._poll)

    def _poll(self):
        try:
            while True:
                kind, value = self.queue.get_nowait()
                if kind == "stage":
                    self.status.config(text=_STAGE_TEXT.get(value, value), fg="#333")
                elif kind == "ok":
                    self.status.config(text=f"完了: {value} に保存しました", fg="#060")
                    self.convert_btn.config(state="normal")
                    return
                elif kind == "error":
                    self.status.config(text=f"エラー: {value}", fg="#a00")
                    self.convert_btn.config(state="normal")
                    return
        except queue.Empty:
            pass
        if not self.proc.is_alive() and self.queue.empty():
            # プロセスが異常終了しキューに何も残っていない場合
            self.status.config(text="エラー: 変換プログラムが異常終了しました", fg="#a00")
            self.convert_btn.config(state="normal")
            return
        self.root.after(100, self._poll)
```

（`import queue` は `queue.Empty` のために残す。ファイル選択ボタンの無効化など既存の挙動は変更しない）

- [ ] **Step 2: main.py に freeze_support を追加**

```python
import multiprocessing
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from src.gui import run

if __name__ == "__main__":
    multiprocessing.freeze_support()  # 将来のEXE化(PyInstaller)対応
    run()
```

- [ ] **Step 3: スモークテスト（tkinter・プログラム操作）**

Temp配下のスクリプトで（リポジトリ外・削除しない）: ConverterApp を起動し、`app.step_path` にテスト用STEP（conftest.pyと同じ生成コード）を設定 → `app.start()` → `root.update()` をポーリングし:
- ステータスに「準備中」→「読み込み中」→ … →「完了:」が**順に表示される**こと（今回の修正の主目的。各表示をキャプチャして報告）
- ポーリング中も `root.update()` が短時間で返ること（GUIが固まっていない証拠として、update() 呼び出しの最大所要時間も報告）

- [ ] **Step 4: 全テスト確認** — `cd <リポジトリ>/converter && .venv/Scripts/python -m pytest -v` → 25件PASS

- [ ] **Step 5: Commit** — `git add converter/src/gui.py converter/main.py` / message: "Run conversion in subprocess to keep GUI responsive"

---

### Task 7: 統合検証

- [ ] **Step 1: 両スイートの最終確認**

- viewer: `npx vitest run` 34件PASS + `npm run build` 成功
- converter: pytest 25件PASS

- [ ] **Step 2: コントローラーによるブラウザ検証（実装エージェントは実施しない）**

SampleCar.glb で: タイトルカード（初期値ファイル名）表示 → 編集モードでタイトル/スペック編集 → 保存JSONにmeta → 再読込で復元 → 展示モードON（autoRotate）→操作で停止→30秒で再開 → ダブルタップで回転中心設定・リセット。

- [ ] **Step 3: ユーザーによる実機確認**

タッチPCで: 展示モードの回転の見え方・速さ、ダブルタップの反応、カードの視認性、変換ツールで実STEPを変換して「読み込み中…」表示が出ること。

---

## 完了条件

- viewer vitest 34件 / converter pytest 25件 すべてPASS
- タイトル・スペックカードが表示/編集/保存/復元できる
- 展示モードが「回転→操作で停止→30秒で再開→ボタンで終了」を満たす
- ダブルタップで回転中心の設定/リセットができる
- 変換ツールで読み込み中表示が正しく出て、ウィンドウが固まらない
