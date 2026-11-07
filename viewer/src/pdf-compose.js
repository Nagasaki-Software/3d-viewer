/** PDF1ページ分（A4横・150dpi相当）をcanvasに組み立てる（ブラウザ専用） */
import { formatReportDate, wrapText } from './pdf-report.js';

const PAGE_W = 1754;
const PAGE_H = 1240;
const M = 60; // 余白
const FONT = "'Meiryo', 'メイリオ', sans-serif";
const LIST_H = 300; // 下部（注釈一覧・メモ）の高さ

/**
 * @param {{ viewCanvas: HTMLCanvasElement, modelName: string, date: Date,
 *   labels: {n: number, text: string, x: number, y: number}[],  // viewCanvasの画素座標
 *   annotationTexts: string[], memo: string }} p
 */
export function composeReportCanvas({ viewCanvas, modelName, date, labels, annotationTexts, memo }) {
  const c = document.createElement('canvas');
  c.width = PAGE_W;
  c.height = PAGE_H;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, PAGE_W, PAGE_H);
  ctx.textBaseline = 'top';

  // 見出し：モデル名と日時
  ctx.fillStyle = '#111111';
  ctx.font = `bold 40px ${FONT}`;
  ctx.fillText(wrapText(ctx, modelName || '（名称なし）', PAGE_W - 2 * M - 420, 1)[0] ?? '', M, M);
  ctx.font = `28px ${FONT}`;
  ctx.textAlign = 'right';
  ctx.fillText(formatReportDate(date), PAGE_W - M, M + 8);
  ctx.textAlign = 'left';

  // 3D画面（縦横比を保って枠に収める）
  const area = { x: M, y: M + 70, w: PAGE_W - 2 * M, h: PAGE_H - M - LIST_H - (M + 70) };
  const scale = Math.min(area.w / viewCanvas.width, area.h / viewCanvas.height);
  const dw = viewCanvas.width * scale;
  const dh = viewCanvas.height * scale;
  const dx = area.x + (area.w - dw) / 2;
  const dy = area.y + (area.h - dh) / 2;
  ctx.fillStyle = '#f2f2f2';
  ctx.fillRect(area.x, area.y, area.w, area.h);
  ctx.drawImage(viewCanvas, dx, dy, dw, dh);
  ctx.strokeStyle = '#999999';
  ctx.lineWidth = 2;
  ctx.strokeRect(area.x, area.y, area.w, area.h);

  // 注釈ラベル（番号の丸と文字）
  ctx.font = `bold 20px ${FONT}`;
  labels.forEach((l) => {
    const x = dx + l.x * scale;
    const y = dy + l.y * scale;
    if (x < dx || x > dx + dw || y < dy || y > dy + dh) return;
    ctx.fillStyle = '#e53935';
    ctx.beginPath();
    ctx.arc(x, y, 16, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(l.n), x, y + 1);
    ctx.textAlign = 'left';
    const t = wrapText(ctx, l.text, 360, 1)[0] ?? '';
    const tw = ctx.measureText(t).width;
    ctx.fillStyle = 'rgba(255,255,255,0.88)';
    ctx.fillRect(x + 22, y - 16, tw + 16, 32);
    ctx.fillStyle = '#111111';
    ctx.fillText(t, x + 30, y + 1);
    ctx.textBaseline = 'top';
  });

  // 下部：注釈一覧（左）とメモ（右）
  const listTop = PAGE_H - M - LIST_H + 20;
  const colW = (PAGE_W - 2 * M - 40) / 2;
  ctx.fillStyle = '#111111';
  ctx.font = `bold 26px ${FONT}`;
  ctx.fillText('注釈', M, listTop);
  ctx.fillText('メモ', M + colW + 40, listTop);
  ctx.font = `22px ${FONT}`;
  const MAX_ITEMS = 8;
  const items = annotationTexts.slice(0, MAX_ITEMS).map((t, i) => wrapText(ctx, `${i + 1}. ${t}`, colW, 1)[0] ?? '');
  if (annotationTexts.length > MAX_ITEMS) items.push(`ほか ${annotationTexts.length - MAX_ITEMS} 件`);
  if (annotationTexts.length === 0) items.push('（なし）');
  items.forEach((t, i) => ctx.fillText(t, M, listTop + 40 + i * 30));
  const memoLines = wrapText(ctx, memo, colW, 6);
  (memoLines.length ? memoLines : ['（なし）']).forEach((t, i) => ctx.fillText(t, M + colW + 40, listTop + 40 + i * 30));
  return c;
}
