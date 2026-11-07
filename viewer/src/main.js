import { initViewer, loadModel, loadLodModel, loadMidModel, requestRender, getRaycastObject, onEachFrame, setControlsEnabled, getControlsEnabled, getRenderer, getCamera, getControls, getModelDiag, setRotationCenter, resetRotationCenter, setAutoRotate, setUpAxis, getUpAxis, getRawModelSize, rotateStep, panStep, zoomStep, renderForCapture, toScreenPosition } from './viewer.js';
import { createDoubleTapDetector } from './gestures.js';
import { createExhibitMode } from './exhibit.js';
import { addAnnotation, removeAnnotation, loadAnnotations, getAnnotations, getAnnotationsRaw, annotationWorldPoint, updateAnnotationPositions, clearAnnotations, setLabelsVisible } from './annotations.js';
import { parseProjectJSON, buildProjectJSON, downloadJSON } from './storage.js';
import { showMessage, updateProgress, applyMode, showLabelDialog } from './ui.js';
import { clearSelection, getSelectedPartName, resolveHitPartName, selectPart, setPartVisible, showAllParts, hiddenPartNames, setEdgesVisible } from './parts.js';
import { animateCameraTo, updateCameraAnimation, standardViewPose } from './views.js';
import { applyBookmarkState, captureBookmark } from './bookmarks.js';
import { getTheme, setTheme, toggleTheme } from './theme.js';
import { FONT_LIMITS, applyFontSizes, loadFontSizes, saveFontSizes } from './fontsize.js';
import { modelPaths, sanitizeModelName } from './modelsource.js';
import { buildImagePdf } from './pdf-report.js';
import { composeReportCanvas } from './pdf-compose.js';

const app = document.getElementById('app');
const dropZone = document.getElementById('drop-zone');

// touch-action:none（style.css）だけでは、要素構成によってはブラウザのピンチズームが
// 抑止されない場合がある（実機で確認済み）。2本指のtouchstartを直接preventDefault()する
// ことで、対象要素によらず確実にネイティブのピンチズームを止める
document.addEventListener('touchstart', (e) => {
  if (e.touches.length > 1) e.preventDefault();
}, { passive: false });

// タッチパネルの機種によっては、ピンチ操作が「Ctrl+ホイール」信号としてブラウザに届き、
// 上記のタッチ対策をすり抜けてページ拡大が起きる（実機で上記対策後も再発を確認）。
// この経路も画面全体で無効化する。失われるのはCtrl+ホイールでのブラウザ拡大のみで、
// 通常のスクロール・モデルのズーム・キーボードのCtrl +/− には影響しない
document.addEventListener('wheel', (e) => {
  if (e.ctrlKey) e.preventDefault();
}, { passive: false });

let mode = 'view';       // 'view' | 'edit'
let modelFileName = 'model.glb';
let modelLoaded = false;
let bookmarks = [];
let jsonFileHandle = null; // ドラッグ&ドロップで取得した注釈JSONの書き込みハンドル（対応ブラウザのみ）
let serverModelName = null; // サーバー上のモデル一覧/URLから読み込んだ場合のモデル名（保存時の書き込み先の判定に使う）

// ─── タイトル・スペックカード ───
let modelMeta = { title: null, specs: '', upAxis: null };

function displayTitle() {
  return modelMeta.title ?? modelFileName.replace(/\.(glb|gltf)$/i, '');
}

function refreshInfoCards() {
  const titleEl = document.getElementById('model-title');
  const specsEl = document.getElementById('model-specs');
  titleEl.textContent = displayTitle();
  titleEl.classList.toggle('hidden', !modelLoaded);
  titleEl.classList.toggle('editable', mode === 'edit');
  const showSpecs = modelLoaded && (modelMeta.specs || mode === 'edit');
  specsEl.textContent = modelMeta.specs || 'スペック未入力（タップして入力）';
  specsEl.classList.toggle('placeholder', !modelMeta.specs);
  specsEl.classList.toggle('hidden', !showSpecs);
  specsEl.classList.toggle('editable', mode === 'edit');
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

// ─── モデルの向き ─────────────────────────────────────────────

const AXIS_LABEL = { x: 'X軸', y: 'Y軸', z: 'Z軸' };

function refreshUpAxisButtons() {
  const size = getRawModelSize();
  const active = getUpAxis();
  document.querySelectorAll('#up-axis-buttons button').forEach((btn) => {
    const axis = btn.dataset.axis;
    const meters = (size[axis] / 1000).toFixed(1);
    btn.textContent = `${AXIS_LABEL[axis]}（${meters}m）を上に`;
    btn.classList.toggle('active', active.axis === axis);
  });
}

document.querySelectorAll('#up-axis-buttons button').forEach((btn) => {
  btn.addEventListener('click', () => {
    const axis = btn.dataset.axis;
    const current = getUpAxis();
    // 同じ軸をもう一度押すと上下を反転する
    const sign = current.axis === axis ? -current.sign : 1;
    setUpAxis(axis, sign);
    modelMeta.upAxis = { axis, sign };
    refreshUpAxisButtons();
  });
});

// Three.js ビューアを初期化し、毎フレームのアノテーション位置更新・カメラtweenを登録
initViewer(app);
onEachFrame(updateAnnotationPositions);
onEachFrame(updateCameraAnimation);

// ─── 部品タップ選択 ───────────────────────────────────────────

const partPanel = document.getElementById('part-panel');
const partNameEl = document.getElementById('part-name');

let downX = 0, downY = 0, downTime = 0, downControlsEnabled = true;
const feedDoubleTap = createDoubleTapDetector();

function onPointerDown(e) {
  downX = e.clientX;
  downY = e.clientY;
  downTime = Date.now();
  // ラベル配置フロー中(touchstartで即座に再有効化される)でも押下時点の状態で判定するため記録する
  downControlsEnabled = getControlsEnabled();
}

function onPointerUp(e) {
  // ラベル配置中に始まった操作はタップ選択の対象にしない
  if (!downControlsEnabled) return;
  // 8px以上動いた、または500ms以上押していたらドラッグ（回転）とみなす
  if (Math.hypot(e.clientX - downX, e.clientY - downY) > 8) return;
  if (Date.now() - downTime > 500) return;

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

  handleTapSelect(e.clientX, e.clientY);
}

function handleTapSelect(x, y) {
  const hit = getRaycastObject(x, y);
  const name = hit ? resolveHitPartName(hit) : null;
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

const canvasEl = getRenderer().domElement;
canvasEl.addEventListener('pointerdown', onPointerDown);
canvasEl.addEventListener('pointerup', onPointerUp);

const exhibit = createExhibitMode({ setAutoRotate });
canvasEl.addEventListener('pointerdown', () => exhibit.notifyInteraction());
canvasEl.addEventListener('wheel', () => exhibit.notifyInteraction(), { passive: true });

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

// ─── ドラッグ&ドロップ ────────────────────────────────────────

app.addEventListener('dragover', (e) => {
  e.preventDefault();
  dropZone.classList.add('drag-over');
});

app.addEventListener('dragleave', (e) => {
  // app の外に出たときのみ drag-over を外す
  if (!app.contains(e.relatedTarget)) {
    dropZone.classList.remove('drag-over');
  }
});

app.addEventListener('drop', async (e) => {
  e.preventDefault();
  dropZone.classList.remove('drag-over');

  const item = e.dataTransfer?.items?.[0];
  const file = e.dataTransfer?.files[0];
  if (!file) return;

  const ext = file.name.split('.').pop().toLowerCase();

  if (ext === 'glb' || ext === 'gltf') {
    await handleGLBDrop(file);
  } else if (ext === 'json') {
    // 対応ブラウザでは、次回以降の保存でこのファイルへ直接上書きできるようハンドルを取得しておく
    let handle = null;
    if (item?.getAsFileSystemHandle) {
      try {
        const h = await item.getAsFileSystemHandle();
        if (h?.kind === 'file') handle = h;
      } catch {
        handle = null;
      }
    }
    handleJSONDrop(file, handle);
  } else {
    showMessage('.glb / .gltf / .json ファイルのみ対応しています');
  }
});

// モデルを読み込むたびに増える番号。付属ファイル（軽量版・中間版）の取得中に別のモデルへ
// 切り替わったとき、前のモデルの付属ファイルを新しいモデルに付けないために使う
let modelLoadSeq = 0;

async function handleGLBDrop(file) {
  modelLoadSeq += 1;
  modelFileName = file.name;
  modelLoaded = false;
  clearAnnotations();
  refreshAnnotationList();
  bookmarks = []; // モデルが変わると旧ビュー（カメラ・部品状態）は無効になる
  refreshBookmarkList();

  // ロード中はUIパネルを操作不可にする（仕様: ロード完了前はUI操作を無効化）
  const uiPanel = document.getElementById('ui-panel');
  uiPanel.style.pointerEvents = 'none';
  uiPanel.style.opacity = '0.4';

  try {
    await loadModel(file, (ratio) => updateProgress(ratio));
    updateProgress(1);
    dropZone.classList.add('hidden');
    modelLoaded = true;
    modelMeta = { title: null, specs: '', upAxis: null };
    refreshInfoCards();
    refreshUpAxisButtons();
    document.getElementById('back-to-gallery-btn').classList.remove('hidden');

    // 新モデルには旧モデルの部品パネル・エッジ表示状態・注釈ファイルの上書き先は引き継がない
    partPanel.classList.add('hidden');
    edgesOn = false;
    document.getElementById('edge-toggle').classList.remove('active');
    jsonFileHandle = null;
    serverModelName = null;
  } catch (err) {
    updateProgress(1);
    showMessage('モデルの読み込みに失敗しました。ファイルサイズが大きすぎる可能性があります。');
    console.error(err);
  } finally {
    uiPanel.style.pointerEvents = '';
    uiPanel.style.opacity = '';
  }
}

function handleJSONDrop(file, handle = null) {
  const reader = new FileReader();
  reader.onload = (e) => {
    requestRender(); // 注釈・稜線・向きの変更はクリックを起点にしない非同期処理なので明示的に描く
    try {
      const p = parseProjectJSON(e.target.result);
      const unresolved = loadAnnotations(p.annotations);
      refreshAnnotationList();
      bookmarks = p.bookmarks;
      refreshBookmarkList();
      modelMeta = { title: p.meta.title, specs: p.meta.specs, upAxis: p.meta.upAxis };
      if (p.meta.upAxis) setUpAxis(p.meta.upAxis.axis, p.meta.upAxis.sign);
      refreshInfoCards();
      refreshUpAxisButtons();
      edgesOn = p.meta.edgesVisible;
      setEdgesVisible(edgesOn);
      document.getElementById('edge-toggle').classList.toggle('active', edgesOn);
      jsonFileHandle = handle; // 解析に成功した場合のみ、以降の保存先として記憶する
      const loaded = p.annotations.length - unresolved;
      if (unresolved > 0) {
        showMessage(`注釈 ${loaded} 件・ビュー ${p.bookmarks.length} 件を読み込みました（${unresolved} 件は部品が見つからずスキップ）`, 6000);
      } else {
        showMessage(`注釈 ${loaded} 件・ビュー ${p.bookmarks.length} 件を読み込みました`);
      }
    } catch (err) {
      showMessage('アノテーションファイルの読み込みに失敗しました');
    }
  };
  reader.readAsText(file);
}

// ─── サーバー上のモデル（LAN共有: 一覧と ?model= 自動読み込み）───

async function loadFromServer(name) {
  const paths = modelPaths(name);
  showMessage('サーバーからモデルを読み込んでいます…', 8000);
  let res;
  try {
    res = await fetch(paths.glb);
  } catch {
    showMessage('サーバーに接続できませんでした');
    return;
  }
  if (!res.ok) {
    showMessage(`モデルが見つかりません: ${name}`);
    return;
  }
  const blob = await res.blob();
  await handleGLBDrop(new File([blob], `${name}.glb`));
  serverModelName = name; // handleGLBDropがリセットするため、その後に設定する

  // 同名の注釈JSONがあれば自動で重ねて読み込む
  const jsonRes = await fetch(paths.json).catch(() => null);
  if (jsonRes?.ok) {
    handleJSONDrop(new File([await jsonRes.blob()], `${name}_annotations.json`));
  }

  // 付属ファイルの取得中に別のモデルへ切り替わっていたら、以降は何もしない
  const mySeq = modelLoadSeq;
  const stillCurrent = () => mySeq === modelLoadSeq;

  // 軽量表示(LOD)用ファイルがあれば重ねて読み込む（大規模モデルの操作中だけ使う）
  const lodRes = await fetch(paths.lod).catch(() => null);
  if (!stillCurrent()) return;
  if (lodRes?.ok) {
    const lodBlob = await lodRes.blob();
    if (!stillCurrent()) return;
    await loadLodModel(new File([lodBlob], `${name}_lod.glb`));
  }

  // 中間版があれば重ねて読み込む（操作中はまず中間版、描画が遅い機械では軽量版に自動で下げる）
  const midRes = await fetch(paths.mid).catch(() => null);
  if (!stillCurrent()) return;
  if (midRes?.ok) {
    const midBlob = await midRes.blob();
    if (!stillCurrent()) return;
    await loadMidModel(new File([midBlob], `${name}_mid.glb`));
  }

  // このモデルを指すURLに書き換える（コピーすれば人に共有できる）
  history.replaceState(null, '', `?model=${encodeURIComponent(name)}`);
}

async function refreshModelGallery() {
  const gallery = document.getElementById('model-gallery');
  let list;
  try {
    const res = await fetch('/api/models');
    if (!res.ok) return;
    list = await res.json();
  } catch {
    return; // 一覧機能がないサーバー（本番ビルド等）では何も表示しない
  }
  if (!Array.isArray(list) || list.length === 0) return;

  gallery.innerHTML = '';
  const heading = document.createElement('p');
  heading.id = 'model-gallery-heading';
  heading.textContent = 'サーバー上のモデル（タップで開く）';
  gallery.appendChild(heading);
  list.forEach((m) => {
    const btn = document.createElement('button');
    btn.className = 'model-gallery-item';
    const sizeMb = (m.size / 1048576).toFixed(1);
    btn.textContent = `${m.name}（${sizeMb} MB${m.hasAnnotations ? '・注釈あり' : ''}）`;
    btn.addEventListener('click', () => loadFromServer(m.name));
    gallery.appendChild(btn);
  });
}

const urlModelName = sanitizeModelName(
  new URLSearchParams(window.location.search).get('model') ?? '',
);
if (urlModelName) {
  loadFromServer(urlModelName);
} else {
  refreshModelGallery();
}

// ─── モデル一覧に戻る ─────────────────────────────────────────

document.getElementById('back-to-gallery-btn').addEventListener('click', () => {
  // 状態を個別にリセットするより、ページ再読み込みの方が確実で安全なため採用
  location.href = location.pathname;
});

// ─── モードトグル ─────────────────────────────────────────────

document.getElementById('mode-toggle').addEventListener('click', () => {
  mode = mode === 'view' ? 'edit' : 'view';
  applyMode(mode);
  refreshInfoCards();
  if (mode === 'edit') refreshPdfFolder();
});

// ─── PDF保存 ──────────────────────────────────────────────────

const pdfBtn = document.getElementById('pdf-btn');
const pdfDialog = document.getElementById('pdf-dialog');
const pdfMemo = document.getElementById('pdf-memo');
const pdfFolderInput = document.getElementById('pdf-folder');

async function refreshPdfFolder() {
  try {
    const res = await fetch('/api/pdf-settings');
    if (res.ok) pdfFolderInput.value = (await res.json()).folder ?? '';
  } catch { /* 取得できなくても入力欄が空のままになるだけ */ }
}

document.getElementById('pdf-folder-save').addEventListener('click', async () => {
  try {
    const res = await fetch('/api/pdf-settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ folder: pdfFolderInput.value }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error ?? `設定できませんでした（${res.status}）`);
    pdfFolderInput.value = body.folder;
    showMessage(`PDF保存先を設定しました：${body.folder}`, 5000);
  } catch (e) {
    showMessage(e instanceof TypeError ? 'サーバーに接続できませんでした' : e.message, 8000);
  }
});

pdfBtn.addEventListener('click', () => {
  if (!modelLoaded) { showMessage('先にモデルを開いてください'); return; }
  pdfMemo.value = '';
  pdfDialog.classList.remove('hidden');
  pdfMemo.focus();
});

document.getElementById('pdf-cancel').addEventListener('click', () => {
  pdfDialog.classList.add('hidden');
});

document.getElementById('pdf-confirm').addEventListener('click', async () => {
  pdfDialog.classList.add('hidden');
  pdfBtn.disabled = true;
  try {
    const name = serverModelName ?? modelFileName.replace(/\.glb$/i, '');
    const date = new Date();
    const raw = getAnnotationsRaw();
    // 描画直後でないとWebGLの画面が読めないため、撮影からページ組み立てまでを続けて行う。
    // ラベルは、撮影時に画面上で見えているもの（ラベル表示ON・部品が表示中・カメラの前）だけ描く
    const view = renderForCapture();
    const ratio = view.width / view.clientWidth;
    const labels = raw.map((a, i) => {
      if (a.element.style.visibility !== 'visible') return null;
      const s = toScreenPosition(annotationWorldPoint(a));
      return { n: i + 1, text: a.label, x: s.x * ratio, y: s.y * ratio };
    }).filter(Boolean);
    const page = composeReportCanvas({
      viewCanvas: view, modelName: name, date, labels,
      annotationTexts: raw.map((a) => a.label), memo: pdfMemo.value.slice(0, 500),
    });
    const jpeg = await new Promise((resolve) => page.toBlob(resolve, 'image/jpeg', 0.85));
    const pdf = buildImagePdf(new Uint8Array(await jpeg.arrayBuffer()), page.width, page.height);
    const res = await fetch(`/api/pdf?model=${encodeURIComponent(name)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/pdf' },
      body: pdf,
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error ?? `保存できませんでした（${res.status}）`);
    showMessage(`PDFを保存しました：${body.fileName}`, 6000);
  } catch (e) {
    showMessage(e instanceof TypeError ? 'サーバーに接続できませんでした' : e.message, 8000);
  } finally {
    pdfBtn.disabled = false;
  }
});

// ─── 保存ボタン ───────────────────────────────────────────────

document.getElementById('save-btn').addEventListener('click', async () => {
  const annotations = getAnnotations();
  if (annotations.length === 0 && bookmarks.length === 0 && !modelMeta.upAxis) {
    showMessage('保存する注釈・ビューがありません');
    return;
  }
  const json = buildProjectJSON(modelFileName, annotations, bookmarks,
    { title: displayTitle(), specs: modelMeta.specs, upAxis: modelMeta.upAxis, edgesVisible: edgesOn });

  // 以前ドラッグ&ドロップしたJSONがあれば、新しいファイルを作らずそこへ直接上書きする
  if (jsonFileHandle) {
    try {
      if ((await jsonFileHandle.queryPermission({ mode: 'readwrite' })) !== 'granted') {
        if ((await jsonFileHandle.requestPermission({ mode: 'readwrite' })) !== 'granted') {
          throw new Error('write permission not granted');
        }
      }
      const writable = await jsonFileHandle.createWritable();
      await writable.write(json);
      await writable.close();
      showMessage(`${jsonFileHandle.name} に上書き保存しました`);
      return;
    } catch (err) {
      console.error(err);
      showMessage('上書き保存できなかったため、新しいファイルとしてダウンロードします', 5000);
    }
  }

  // サーバー上のモデル一覧/URLから読み込んだ場合は、サーバー側のファイルへ直接保存する
  if (serverModelName) {
    try {
      const res = await fetch(modelPaths(serverModelName).json, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: json,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      showMessage(`サーバーの ${serverModelName}_annotations.json に保存しました`);
      return;
    } catch (err) {
      console.error(err);
      showMessage('サーバーへの保存に失敗したため、新しいファイルとしてダウンロードします', 5000);
    }
  }

  const outName = modelFileName.replace(/\.(glb|gltf)$/i, '_annotations.json');
  downloadJSON(outName, json);
  showMessage(`${outName} を保存しました`);
});

// ─── ラベル追加 ───────────────────────────────────────────────

document.getElementById('add-label-btn').addEventListener('click', () => {
  if (!modelLoaded) {
    showMessage('先に GLB ファイルを読み込んでください');
    return;
  }

  showMessage('3D モデル上をタップしてラベルを配置してください', 6000);

  // OrbitControls を一時無効にしてタップを横取りされないようにする
  setControlsEnabled(false);

  const canvas = getRenderer().domElement;

  function handleTap(e) {
    // touchstart と click が両方発火するのを防ぐ
    canvas.removeEventListener('touchstart', handleTap);
    canvas.removeEventListener('click', handleTap);
    setControlsEnabled(true);

    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;

    const hit = getRaycastObject(clientX, clientY);
    if (!hit) {
      showMessage('モデル上をタップしてください');
      return;
    }

    showLabelDialog(
      (text) => {
        const id = crypto.randomUUID();
        addAnnotation(id, text, hit.point.clone(), resolveHitPartName(hit));
        refreshAnnotationList();
      },
      () => {
        // キャンセル時は何もしない
      }
    );
  }

  canvas.addEventListener('touchstart', handleTap, { passive: true });
  canvas.addEventListener('click', handleTap);
});

// ─── 注釈一覧 ─────────────────────────────────────────────────

const annotationListPanel = document.getElementById('annotation-list');

document.getElementById('annotation-list-btn').addEventListener('click', () => {
  annotationListPanel.classList.toggle('hidden');
});

function refreshAnnotationList() {
  annotationListPanel.innerHTML = '';
  getAnnotationsRaw().forEach((a) => {
    const row = document.createElement('div');
    row.className = 'annotation-row';

    const jump = document.createElement('button');
    jump.textContent = a.label;
    jump.addEventListener('click', () => focusAnnotation(a));

    const del = document.createElement('button');
    del.className = 'annotation-del';
    del.textContent = '削除';
    del.addEventListener('click', () => {
      removeAnnotation(a.id);
      refreshAnnotationList();
    });

    row.append(jump, del);
    annotationListPanel.appendChild(row);
  });
}

function focusAnnotation(a) {
  const target = annotationWorldPoint(a);
  const cam = getCamera();
  const controls = getControls();
  const dir = cam.position.clone().sub(controls.target).normalize();
  const dist = Math.max(getModelDiag() * 0.3, controls.minDistance * 4);
  const pos = target.clone().add(dir.multiplyScalar(dist));
  animateCameraTo(cam, controls, pos, target);
}

// ─── 視点ブックマーク ─────────────────────────────────────────

const bookmarkListPanel = document.getElementById('bookmark-list');

document.getElementById('bookmark-btn').addEventListener('click', () => {
  if (!modelLoaded) {
    showMessage('先に GLB ファイルを読み込んでください');
    return;
  }

  showLabelDialog(
    (name) => {
      const cam = getCamera();
      const ctl = getControls();
      bookmarks.push(captureBookmark(name, {
        cameraPosition: { x: cam.position.x, y: cam.position.y, z: cam.position.z },
        target: { x: ctl.target.x, y: ctl.target.y, z: ctl.target.z },
        hiddenParts: hiddenPartNames(),
        background: getTheme(),
      }));
      refreshBookmarkList();
      showMessage(`ビュー「${name}」を保存しました`);
    },
    () => {},
    { title: 'ビュー名を入力', placeholder: '例: 正面全体' },
  );
});

document.getElementById('bookmark-list-btn').addEventListener('click', () => {
  bookmarkListPanel.classList.toggle('hidden');
});

function refreshBookmarkList() {
  bookmarkListPanel.innerHTML = '';
  bookmarks.forEach((b) => {
    const row = document.createElement('div');
    row.className = 'annotation-row';

    const apply = document.createElement('button');
    apply.textContent = b.name;
    apply.addEventListener('click', () => applyBookmark(b));

    const del = document.createElement('button');
    del.className = 'annotation-del';
    del.textContent = '削除';
    del.addEventListener('click', () => {
      bookmarks = bookmarks.filter((x) => x.id !== b.id);
      refreshBookmarkList();
    });

    row.append(apply, del);
    bookmarkListPanel.appendChild(row);
  });
}

function applyBookmark(b) {
  clearSelection();
  partPanel.classList.add('hidden');
  applyBookmarkState(b, {
    moveCamera: (p, t) => animateCameraTo(getCamera(), getControls(), p, t),
    showAllParts,
    setTheme,
  });
  updateThemeToggleLabel(); // ブックマークがテーマを変更する場合があるためラベルを同期する
}

// ─── 標準ビュー ───────────────────────────────────────────────

document.querySelectorAll('#view-buttons [data-view]').forEach((btn) => {
  btn.addEventListener('click', () => {
    const pose = standardViewPose(btn.dataset.view, { x: 0, y: 0, z: 0 }, getModelDiag());
    animateCameraTo(getCamera(), getControls(), pose.position, pose.target);
  });
});

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

// ─── ラベル表示トグル ─────────────────────────────────────────

let labelsOn = true;
document.getElementById('labels-toggle').addEventListener('click', () => {
  labelsOn = !labelsOn;
  setLabelsVisible(labelsOn);
  document.getElementById('labels-toggle').classList.toggle('active', labelsOn);
});

// ─── エッジ表示トグル ─────────────────────────────────────────

let edgesOn = false;
document.getElementById('edge-toggle').addEventListener('click', () => {
  edgesOn = !edgesOn;
  setEdgesVisible(edgesOn);
  document.getElementById('edge-toggle').classList.toggle('active', edgesOn);
});

// ─── 展示モード ───────────────────────────────────────────────

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

// ─── ライトモードトグル ───────────────────────────────────────

/** #theme-toggle のラベルを現在のテーマに同期する */
function updateThemeToggleLabel() {
  document.getElementById('theme-toggle').textContent =
    getTheme() === 'dark' ? 'ライトモード' : 'ダークモード';
}

document.getElementById('theme-toggle').addEventListener('click', () => {
  toggleTheme();
  updateThemeToggleLabel();
});

// ─── フォントサイズ設定 ─────────────────────────────────────

const fontSizes = loadFontSizes();
applyFontSizes(fontSizes);

for (const key of Object.keys(FONT_LIMITS)) {
  const slider = document.getElementById(`font-${key}`);
  const valueLabel = document.getElementById(`font-${key}-val`);
  slider.value = fontSizes[key];
  valueLabel.textContent = `${fontSizes[key]}px`;
  slider.addEventListener('input', () => {
    fontSizes[key] = Number(slider.value);
    valueLabel.textContent = `${slider.value}px`;
    applyFontSizes(fontSizes);
    saveFontSizes(fontSizes);
  });
}
