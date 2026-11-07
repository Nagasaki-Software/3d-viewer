import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { buildPartRegistry, setEdgesVisible, isActuallyVisible, setPreciseVisible } from './parts.js';
import { buildLodBatches, createMotionTracker, interactionPixelRatio, createRenderScheduler, createTierGovernor } from './lod.js';
import { computeCameraRange, computeControlLimits } from './camera-range.js';
import { standardViewPose, axisUpRotation } from './views.js';
import { showMessage } from './ui.js';
import { createContextRecovery } from './context-recovery.js';
import { rotateAroundTarget, panByScreenDirection, zoomByFactor } from './manual-controls.js';

let scene, camera, renderer, controls;
let currentModel = null;
let modelDiag = 2;
let rawModelSize = { x: 1, y: 1, z: 1 };
let currentUpAxis = { axis: 'y', sign: 1 };
const frameCallbacks = [];

// LOD(操作中の軽量表示)。lodGroupは精密版currentModelの子として重ねる
let lodGroup = null;
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
  midTriangleCount = null;
  if (wasShowing && lodGroup) lodGroup.visible = true;
  updateDiagCounter();
  requestRender();
}
const lodTracker = createMotionTracker();
const _prevCamPos = new THREE.Vector3();
const _prevTarget = new THREE.Vector3();
let containerEl = null; // 解像度変更時のsetSizeに使う
let interactionLowRes = false; // 操作中の低解像度モード適用中か

// 描画オンデマンド。静止中は描かず、動いた・触れた・表示が変わったときだけ描く
const renderScheduler = createRenderScheduler();
const INPUT_RENDER_MS = 500; // 触れたあと念のため描き続ける時間

/** 次のフレームから ms ミリ秒のあいだ描画する（クリック以外を起点にした表示変更から呼ぶ） */
export function requestRender(ms = 100) {
  renderScheduler.request(ms, performance.now());
}

// 操作時の重さがGPU描画由来かどうかを切り分けるための一時的な調査用表示
let fpsEl = null;
let fpsFrameCount = 0;
let fpsLastTime = 0;

function initFpsCounter(container) {
  fpsEl = document.createElement('div');
  fpsEl.style.cssText =
    'position:absolute;bottom:8px;left:8px;color:#0f0;background:rgba(0,0,0,0.55);' +
    'padding:2px 6px;font-size:12px;font-family:monospace;z-index:9999;pointer-events:none;';
  fpsEl.textContent = '… fps';
  container.appendChild(fpsEl);
  fpsLastTime = performance.now();
}

function updateFpsCounter() {
  fpsFrameCount += 1;
  const now = performance.now();
  const elapsed = now - fpsLastTime;
  if (elapsed >= 500) {
    fpsEl.textContent = `${((fpsFrameCount * 1000) / elapsed).toFixed(0)} fps`;
    fpsFrameCount = 0;
    fpsLastTime = now;
  }
}

// ピンチズームがWebページより手前（OS/ブラウザ側）で処理されていないかを
// 切り分けるための一時的な調査用表示。ページがポインターを受け取れていれば
// 指の本数がここに表示される（受け取れていなければ0のまま増えない）
let pointerCountEl = null;
const activePointers = new Set();

function initPointerCounter(container) {
  pointerCountEl = document.createElement('div');
  pointerCountEl.style.cssText =
    'position:absolute;bottom:8px;left:70px;color:#0ff;background:rgba(0,0,0,0.55);' +
    'padding:2px 6px;font-size:12px;font-family:monospace;z-index:9999;pointer-events:none;';
  pointerCountEl.textContent = '指: 0';
  container.appendChild(pointerCountEl);

  const update = () => { pointerCountEl.textContent = `指: ${activePointers.size}`; };
  window.addEventListener('pointerdown', (e) => { activePointers.add(e.pointerId); update(); }, { capture: true });
  window.addEventListener('pointerup', (e) => { activePointers.delete(e.pointerId); update(); }, { capture: true });
  window.addEventListener('pointercancel', (e) => { activePointers.delete(e.pointerId); update(); }, { capture: true });
}

// LODでも重い場合に、三角形数以外(解像度によるフィルレート等)が
// ボトルネックになっていないか切り分けるための一時的な調査用表示
let diagEl = null;
let lodTriangleCount = null;

function initDiagCounter(container) {
  diagEl = document.createElement('div');
  diagEl.style.cssText =
    'position:absolute;bottom:32px;left:8px;color:#ff0;background:rgba(0,0,0,0.55);' +
    'padding:2px 6px;font-size:12px;font-family:monospace;z-index:9999;pointer-events:none;white-space:pre;';
  container.appendChild(diagEl);
  updateDiagCounter();
}

function updateDiagCounter() {
  if (!diagEl || !renderer) return;
  const w = renderer.domElement.width;
  const h = renderer.domElement.height;
  const lodText = lodTriangleCount === null ? 'なし' : lodTriangleCount.toLocaleString();
  const midText = midTriangleCount === null ? 'なし' : midTriangleCount.toLocaleString();
  const tier = midGroup && interactionGroup() === midGroup ? '中間' : (lodGroup ? '軽量' : 'なし');
  diagEl.textContent = `解像度:${w}x${h} dpr:${window.devicePixelRatio} LOD三角形数:${lodText} 中間:${midText} 操作中:${tier}`;
}

export function initViewer(container) {
  containerEl = container;
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x111118);

  camera = new THREE.PerspectiveCamera(45, container.clientWidth / container.clientHeight, 0.001, 2000);
  camera.position.set(0, 1, 3);

  renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(interactionPixelRatio(window.devicePixelRatio, false));
  renderer.setSize(container.clientWidth, container.clientHeight);
  container.appendChild(renderer.domElement);

  // GPUドライバリセット等で描画が止まったとき、ブラウザの自動復旧を有効にして状況を通知する
  const recovery = createContextRecovery({ showMessage });
  renderer.domElement.addEventListener('webglcontextlost', (e) => {
    e.preventDefault(); // これを呼ばないとブラウザは復旧処理を行わない
    recovery.onLost();
  });
  renderer.domElement.addEventListener('webglcontextrestored', () => {
    recovery.onRestored();
    requestRender();
  });

  // 画面に触れた・操作したら描く。UIボタンでの部品の色・表示・稜線・テーマの変更も
  // すべてクリックを起点にしているため、ここでまとめて拾える
  for (const type of ['pointerdown', 'pointermove', 'pointerup', 'wheel', 'keydown', 'click', 'drop']) {
    document.addEventListener(type, () => requestRender(INPUT_RENDER_MS), { capture: true, passive: true });
  }

  initFpsCounter(container);
  initPointerCounter(container);
  initDiagCounter(container);

  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.05;
  controls.zoomToCursor = true; // 指の位置に向かってズーム
  controls.autoRotateSpeed = 2.0; // 約30秒/周

  const ambient = new THREE.AmbientLight(0xffffff, 0.6);
  scene.add(ambient);
  const dirLight = new THREE.DirectionalLight(0xffffff, 1.2);
  dirLight.position.set(5, 10, 5);
  scene.add(dirLight);

  window.addEventListener('resize', () => {
    camera.aspect = container.clientWidth / container.clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(container.clientWidth, container.clientHeight);
    updateDiagCounter();
    requestRender();
  });

  animate();
}

/** 操作中の軽量化（LOD表示への切替と描画解像度の低下）を一括で適用/解除する。
 * LODファイルの無いモデルでも解像度低下だけは効かせる（再変換なしで恩恵を受けられる） */
function applyInteractionQuality(on) {
  const group = interactionGroup();
  if (group) {
    if (lodGroup) lodGroup.visible = on && group === lodGroup;
    if (midGroup) midGroup.visible = on && group === midGroup;
    setPreciseVisible(!on);
  }
  if (on) midFramesSinceShow = 0;
  else tierGovernor.clearSamples(); // 操作の切れ目をまたいだ間隔を混ぜない
  if (interactionLowRes !== on) {
    interactionLowRes = on;
    renderer.setPixelRatio(interactionPixelRatio(window.devicePixelRatio, on));
    renderer.setSize(containerEl.clientWidth, containerEl.clientHeight);
    updateDiagCounter();
  }
  requestRender();
}

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
  // 基準は軽量表示の切替(lodTracker)と同じ 1e-4。これより小さくすると、精密版に戻ったあとも
  // 慣性の余韻だけで重い精密版を数秒描き続けてしまう（余韻の残りは合計でも数画素程度）
  if (!renderScheduler.shouldRender(moved, now, modelDiag * 1e-4)) {
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
  updateFpsCounter();
  frameCallbacks.forEach((fn) => fn()); // render前に更新することでラベルのズレを防ぐ
  renderer.render(scene, camera);
}

/** アニメーションループの毎フレームに処理を登録する */
export function onEachFrame(fn) {
  frameCallbacks.push(fn);
}

/**
 * 指定した軸が上(+Y)を向くようモデルを回転し、中央寄せ・スケール・カメラを再計算する
 * @param {'x'|'y'|'z'} axis
 * @param {1|-1} sign
 */
function frameModel(axis, sign) {
  currentUpAxis = { axis, sign };
  const rot = axisUpRotation(axis, sign);
  currentModel.rotation.set(rot.x, rot.y, rot.z);
  currentModel.scale.setScalar(1);
  currentModel.position.set(0, 0, 0);

  // モデルを画面中央に収まるよう自動スケーリング
  const box = new THREE.Box3().setFromObject(currentModel);
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z);
  const scale = 2 / maxDim;
  currentModel.scale.setScalar(scale);
  currentModel.position.sub(center.multiplyScalar(scale));

  const scaledBox = new THREE.Box3().setFromObject(currentModel);
  modelDiag = scaledBox.getSize(new THREE.Vector3()).length();

  // 等角ビューと同じ配置にする。モデルの縦横比によらず全体が画面に収まるようにするため
  // （固定位置だと、細長い形状のモデルで極端に小さく偏って表示されることがある）
  const pose = standardViewPose('iso', { x: 0, y: 0, z: 0 }, modelDiag);
  camera.position.set(pose.position.x, pose.position.y, pose.position.z);
  controls.target.set(0, 0, 0);
  controls.update();

  const limits = computeControlLimits(modelDiag);
  controls.minDistance = limits.minDistance;
  controls.maxDistance = limits.maxDistance;

  // 視点の瞬間ジャンプ（読み込み直後・軸変更）を「操作の動き」と誤検知して
  // 軽量表示や低解像度が一瞬発動するのを防ぐため、動き判定の基準を更新する
  _prevCamPos.copy(camera.position);
  _prevTarget.copy(controls.target);
  requestRender(); // 基準を更新したので「動いていない」扱いになる。配置し直した姿を描く
}

/** ユーザーが指定した軸を上(+Y)としてモデルを再配置する（向きの手動修正用） */
export function setUpAxis(axis, sign) {
  if (!currentModel) return;
  frameModel(axis, sign);
}

/** 現在適用中の上方向軸設定を返す */
export function getUpAxis() {
  return currentUpAxis;
}

/** 回転前のモデル実寸（軸選択UIでの辺の長さ表示用） */
export function getRawModelSize() {
  return { x: rawModelSize.x, y: rawModelSize.y, z: rawModelSize.z };
}

/**
 * GLBファイルを読み込む
 * @param {File} file
 * @param {(ratio: number) => void} onProgress 0〜1 の進捗
 * @returns {Promise<void>}
 */
export function loadModel(file, onProgress) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const loader = new GLTFLoader();
    loader.setMeshoptDecoder(MeshoptDecoder);

    loader.load(
      url,
      (gltf) => {
        if (currentModel) {
          scene.remove(currentModel);
          currentModel.traverse((obj) => {
            // isLineSegments（稜線）は isLine も true になるため、mesh/line 両方をここで処理する
            if (obj.isBatchedMesh) {
              obj.dispose(); // 内部ジオメトリと行列・色テクスチャを解放する
              obj.material.dispose();
            } else if (obj.isMesh || obj.isLine) {
              obj.geometry.dispose();
              if (Array.isArray(obj.material)) {
                obj.material.forEach((m) => m.dispose());
              } else {
                obj.material.dispose();
              }
            }
          });
        }
        lodGroup = null; // 旧LODは旧currentModelごと上のtraverseで破棄済み。参照だけ切る
        midGroup = null; // 中間版も同じ（currentModelの子）
        midTriangleCount = null;
        tierGovernor.reset();
        lodTracker.reset(); // 前のモデルの動き検知状態を引き継がないようにする
        currentModel = gltf.scene;
        // 変換ツール出力は法線を持たないため計算する（無い場合のみ）
        currentModel.traverse((obj) => {
          if (obj.isMesh && !obj.geometry.attributes.normal) {
            obj.geometry.computeVertexNormals();
          }
        });
        scene.add(currentModel);

        // 回転前の実寸（軸選択UIで各辺の長さを表示するために保持）
        rawModelSize = new THREE.Box3().setFromObject(currentModel).getSize(new THREE.Vector3()).clone();

        frameModel('y', 1);

        // GLTFLoaderはノード名を変換（スペース→_、/等を除去）するため元の名前に戻す
        const assoc = gltf.parser.associations;
        currentModel.traverse((obj) => {
          const ref = assoc.get(obj);
          if (ref && ref.nodes !== undefined) {
            const orig = gltf.parser.json.nodes[ref.nodes].name;
            if (orig) obj.name = orig;
          }
        });

        buildPartRegistry(currentModel);
        setEdgesVisible(false); // 稜線は既定OFF(描画コール削減)。トグルはTask 8

        URL.revokeObjectURL(url);
        requestRender();
        resolve();
      },
      (event) => {
        if (onProgress && event.total > 0) {
          onProgress(event.loaded / event.total);
        }
      },
      (error) => {
        URL.revokeObjectURL(url);
        reject(error);
      }
    );
  });
}

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
        let triCount = 0;
        gltf.scene.traverse((o) => {
          if (!o.isMesh) return;
          if (!o.geometry.attributes.normal) o.geometry.computeVertexNormals();
          const g = o.geometry;
          triCount += (g.index ? g.index.count : g.attributes.position.count) / 3;
        });
        lodTriangleCount = Math.round(triCount);
        updateDiagCounter();
        const group = buildLodBatches(gltf.scene);
        if (group) {
          group.visible = false; // 静止時は精密版を表示。動いたときだけONにする
          target.add(group);
          lodGroup = group;
          _prevCamPos.copy(camera.position);
          _prevTarget.copy(controls.target);
        }
        requestRender();
        resolve();
      },
      undefined,
      () => { URL.revokeObjectURL(url); resolve(); }, // 失敗してもLODなしで続行
    );
  });
}

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

/** OrbitControls の有効/無効を切り替える（ラベル配置中は無効にする） */
export function setControlsEnabled(enabled) {
  controls.enabled = enabled;
  if (!enabled) {
    // 操作無効化中（ラベル配置等）はタップの当たり判定に必ず精密版・通常解像度を使えるようにする。
    // animate()側もenabled中のみ切替を行うため、以後は再度有効化されるまでこの状態を保つ
    applyInteractionQuality(false);
    lodTracker.reset(); // 再有効化後の最初の操作で確実に'show'が発火するようにする
  } else {
    // 再有効化時、無効化中に慣性で動いていた分を「新たな動き」と誤検知しないよう基準を更新する
    _prevCamPos.copy(camera.position);
    _prevTarget.copy(controls.target);
  }
}

/** OrbitControls が現在有効かどうか */
export function getControlsEnabled() {
  return controls.enabled;
}

/** 3D座標をスクリーン座標（px）に変換する */
export function toScreenPosition(position3D) {
  const vector = position3D.clone().project(camera);
  const canvas = renderer.domElement;
  return {
    x: (vector.x * 0.5 + 0.5) * canvas.clientWidth,
    y: (-vector.y * 0.5 + 0.5) * canvas.clientHeight,
    behindCamera: vector.z > 1 || vector.z < -1,
  };
}

/**
 * タッチ/クリック座標の交差情報（{point, object}）を返す。非表示部品は無視する
 * @param {number} clientX
 * @param {number} clientY
 * @returns {{point: THREE.Vector3, object: THREE.Object3D} | null}
 */
export function getRaycastObject(clientX, clientY) {
  const rect = renderer.domElement.getBoundingClientRect();
  const x = ((clientX - rect.left) / rect.width) * 2 - 1;
  const y = -((clientY - rect.top) / rect.height) * 2 + 1;
  const raycaster = new THREE.Raycaster();
  raycaster.setFromCamera(new THREE.Vector2(x, y), camera);
  const hits = raycaster.intersectObjects(scene.children, true)
    .filter((h) => h.object.isMesh && isActuallyVisible(h.object)); // 稜線・非表示部品は対象外
  return hits.length > 0 ? hits[0] : null;
}

/**
 * タッチ/クリック座標からレイキャストで3D交点を取得する
 * @param {number} clientX
 * @param {number} clientY
 * @returns {THREE.Vector3 | null}
 */
export function getRaycastPoint(clientX, clientY) {
  return getRaycastObject(clientX, clientY)?.point.clone() ?? null;
}

/** シーンの背景色を設定する（theme.js から呼ばれる） */
export function setSceneBackground(hex) { scene.background = new THREE.Color(hex); }

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
    requestRender();
  }, 600);
}

/** 回転中心をモデル中央（原点）に戻す */
export function resetRotationCenter() {
  controls.target.set(0, 0, 0);
}

/** ターンテーブル自動回転のON/OFF（展示モード用） */
export function setAutoRotate(on) { controls.autoRotate = on; requestRender(); }

/** PDF用に、精密版・通常解像度で今の視点を描き、描いた直後のcanvasを返す。
 * WebGLの描画結果は次の描画で消えるため、呼び出し側は同じ処理の中ですぐ drawImage すること */
export function renderForCapture() {
  applyInteractionQuality(false); // 操作中の軽量版・低解像度を解除する
  lodTracker.reset();
  frameCallbacks.forEach((fn) => fn());
  renderer.render(scene, camera);
  return renderer.domElement;
}

export function getRenderer() { return renderer; }
export function getCamera() { return camera; }
export function getControls() { return controls; }
export function getModelDiag() { return modelDiag; }

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
