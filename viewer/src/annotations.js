import * as THREE from 'three';
import { toScreenPosition } from './viewer.js';
import { getPart } from './parts.js';

/**
 * @type {{ id: string, label: string, partName: string|null, position: THREE.Vector3,
 *          element: HTMLElement, line: SVGLineElement }[]}
 * position は partName があれば部品ローカル座標、無ければワールド座標
 */
let annotations = [];
let labelsVisible = true;

/** ラベル・引出し線の一括表示/非表示を切り替える */
export function setLabelsVisible(visible) {
  labelsVisible = visible;
}

const overlay = () => document.getElementById('annotation-overlay');
const svg = () => document.getElementById('leader-svg');

const LABEL_OFFSET_Y = -48; // アンカーの上に浮かせて引出し線を見せる

/**
 * アノテーションを1件追加する。部品に紐づく場合はローカル座標で保持する（部品の非表示に追従できる）
 * @param {string} id
 * @param {string} label
 * @param {THREE.Vector3} worldPoint
 * @param {string|null} partName
 */
export function addAnnotation(id, label, worldPoint, partName = null) {
  let position = worldPoint.clone();
  if (partName) {
    const part = getPart(partName);
    if (part) position = part.node.worldToLocal(worldPoint.clone());
    else partName = null;
  }
  _addRaw(id, label, partName, position);
}

/**
 * 指定IDのアノテーションを削除する（HTML要素と引出し線の両方）
 * @param {string} id
 */
export function removeAnnotation(id) {
  const idx = annotations.findIndex((a) => a.id === id);
  if (idx === -1) return;
  annotations[idx].element.remove();
  annotations[idx].line.remove();
  annotations.splice(idx, 1);
}

/** 全アノテーションを削除する（HTML要素と引出し線の両方） */
export function clearAnnotations() {
  annotations.forEach((a) => {
    a.element.remove();
    a.line.remove();
  });
  annotations = [];
}

/**
 * partName が現在のモデルで解決できるかどうかでリストを振り分ける（DOMに触れない純粋関数）。
 * partName が保存されていても部品が見つからなければ、ローカル座標をワールド座標と誤解釈して
 * 誤った位置に表示してしまうため、そのアノテーションはロード対象から除外する。
 * @param {{ partName: string|null }[]} list
 * @param {(name: string) => object|null} getPartFn
 * @returns {{ resolved: object[], unresolvedCount: number }}
 */
export function partitionAnnotations(list, getPartFn) {
  const resolved = [];
  let unresolvedCount = 0;
  list.forEach((a) => {
    if (a.partName && !getPartFn(a.partName)) {
      unresolvedCount += 1;
    } else {
      resolved.push(a);
    }
  });
  return { resolved, unresolvedCount };
}

/**
 * パース済みリストからアノテーションを一括ロードする。
 * 保存済み座標はそのまま復元する（addAnnotationはワールド→ローカル変換を行うため使わない）。
 * @param {{ id: string, label: string, partName: string|null, position: { x: number, y: number, z: number } }[]} list
 * @returns {number} 部品が解決できずスキップした件数
 */
export function loadAnnotations(list) {
  clearAnnotations();
  const { resolved, unresolvedCount } = partitionAnnotations(list, getPart);
  resolved.forEach((a) => {
    const v = new THREE.Vector3(a.position.x, a.position.y, a.position.z);
    _addRaw(a.id, a.label, a.partName, v);
  });
  return unresolvedCount;
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

/**
 * 現在のアノテーションをシリアライズ可能な形式で返す
 * @returns {{ id: string, label: string, partName: string|null, position: { x: number, y: number, z: number } }[]}
 */
export function getAnnotations() {
  return annotations.map((a) => ({
    id: a.id,
    label: a.label,
    partName: a.partName,
    position: { x: a.position.x, y: a.position.y, z: a.position.z },
  }));
}

/** 内部配列をそのまま返す（一覧パネル用。element/line参照を含む） */
export function getAnnotationsRaw() {
  return annotations;
}

/** アンカーのワールド座標を返す（部品アンカーは毎回部品の現在の変換を適用する） */
export function annotationWorldPoint(a) {
  if (a.partName) {
    const part = getPart(a.partName);
    if (part) return part.node.localToWorld(a.position.clone());
  }
  return a.position.clone();
}

/**
 * 毎フレーム呼び出す。各ラベル・引出し線のHTML要素位置を3D座標から更新する。
 * 紐づく部品が非表示、またはカメラの後ろにある場合、またはラベル表示がOFFの場合はラベルと引出し線を隠す。
 * viewer.js の onEachFrame に登録して使う。
 */
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
