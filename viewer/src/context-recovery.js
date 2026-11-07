/** WebGLコンテキスト喪失（GPUドライバのリセット等で描画が止まる現象）からの復旧監視。
 * three.js は contextrestored 後に内部状態とGPUバッファを自動再構築するため、
 * ここでの仕事はユーザーへの状況通知と「復旧しない場合の案内」のみ。
 * 自動リロードは行わない（未保存の注釈が失われるため）。
 */
export function createContextRecovery({ showMessage, timeoutMs = 15000 }) {
  let timer = null;
  return {
    onLost() {
      showMessage('描画がリセットされました。復旧を試みています…', timeoutMs);
      clearTimeout(timer);
      timer = setTimeout(() => {
        // 非エンジニアのユーザーがすぐ気づけるとは限らないため、長めに表示し続ける
        showMessage('自動復旧できませんでした。ブラウザの再読み込みを行ってください', 300000);
      }, timeoutMs);
    },
    onRestored() {
      clearTimeout(timer);
      timer = null;
      showMessage('描画が復旧しました');
    },
  };
}
