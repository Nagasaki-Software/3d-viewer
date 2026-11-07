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
