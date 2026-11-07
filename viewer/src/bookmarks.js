/** 視点ブックマーク: カメラ・部品可視状態・背景モードのスナップショット */
import { setPartsVisible } from './parts.js';

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
 * ブックマークを適用する。カメラ・テーマはコールバック経由（テスト可能にするため）。
 * 非表示適用は部品ごとではなく一括API（稜線インデックスの組み直しを1回に抑える）。
 * 順序: 可視状態リセット → 非表示適用 → テーマ → カメラ移動
 */
export function applyBookmarkState(bookmark, { moveCamera, showAllParts, setTheme }) {
  showAllParts();
  setPartsVisible(bookmark.hiddenParts, false);
  setTheme(bookmark.background);
  moveCamera(bookmark.camera.position, bookmark.camera.target);
}
