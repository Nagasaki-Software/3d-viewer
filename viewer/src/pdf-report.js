/** PDF保存の純粋関数（ブラウザとNodeの両方から使う。DOM・three.jsに依存しないこと） */

const pad = (n) => String(n).padStart(2, '0');

/** 保存ファイル名 <モデル名>_YYYYMMDD-HHmmss.pdf。Windowsで使えない文字は_に置き換える */
export function pdfFileName(modelName, date) {
  const stamp = `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`
    + `-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
  const base = String(modelName ?? '')
    .replace(/[\\/:*?"<>|\x00-\x1f]/g, '_')
    .replace(/[. ]+$/, '')
    .trim() || 'view';
  return `${base}_${stamp}.pdf`;
}

/** PDFに印字する日時 YYYY/MM/DD HH:mm */
export function formatReportDate(date) {
  return `${date.getFullYear()}/${pad(date.getMonth() + 1)}/${pad(date.getDate())}`
    + ` ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** JPEG1枚をA4横のページ全面に貼った、最小構成のPDFを作る（ライブラリ不要） */
export function buildImagePdf(jpeg, imgW, imgH) {
  const enc = new TextEncoder();
  const W = 842, H = 595; // A4横（pt）
  const content = `q\n${W} 0 0 ${H} 0 0 cm\n/Im0 Do\nQ\n`;
  const chunks = [];
  let len = 0;
  const push = (bytes) => { chunks.push(bytes); len += bytes.length; };
  const offsets = [];

  push(enc.encode('%PDF-1.4\n'));
  push(new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a])); // バイナリを含むことを示すコメント行
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>`,
    null, // 4: 画像（バイナリなので下で別に書く）
    `<< /Length ${content.length} >>\nstream\n${content}endstream`,
  ];
  objects.forEach((body, i) => {
    offsets.push(len);
    if (body === null) {
      push(enc.encode(`${i + 1} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${imgW} /Height ${imgH}`
        + ` /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`));
      push(jpeg);
      push(enc.encode('\nendstream\nendobj\n'));
    } else {
      push(enc.encode(`${i + 1} 0 obj\n${body}\nendobj\n`));
    }
  });
  const xrefPos = len;
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  offsets.forEach((o) => { xref += `${String(o).padStart(10, '0')} 00000 n \n`; });
  xref += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF\n`;
  push(enc.encode(xref));

  const out = new Uint8Array(len);
  let p = 0;
  chunks.forEach((c) => { out.set(c, p); p += c.length; });
  return out;
}

/** canvasの文字幅で折り返す。maxLinesを超えた分は最後の行を「…」で切る */
export function wrapText(ctx, text, maxWidth, maxLines) {
  if (text == null || text === '') return [];
  const lines = [];
  for (const para of String(text).split('\n')) {
    let line = '';
    for (const ch of para) {
      if (line && ctx.measureText(line + ch).width > maxWidth) {
        lines.push(line);
        line = ch;
      } else {
        line += ch;
      }
    }
    lines.push(line);
  }
  if (lines.length <= maxLines) return lines;
  const kept = lines.slice(0, maxLines);
  let last = kept[maxLines - 1];
  while (last && ctx.measureText(last + '…').width > maxWidth) last = last.slice(0, -1);
  kept[maxLines - 1] = last + '…';
  return kept;
}
