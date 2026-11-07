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
