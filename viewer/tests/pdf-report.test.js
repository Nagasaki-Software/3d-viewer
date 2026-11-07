import { describe, expect, it } from 'vitest';
import { buildImagePdf, formatReportDate, pdfFileName, wrapText } from '../src/pdf-report.js';

const D = new Date(2026, 10, 7, 9, 5, 3); // 2026/11/07 09:05:03（ローカル時刻）

describe('pdfFileName', () => {
  it('モデル名_日時.pdf の形にする', () => {
    expect(pdfFileName('PumpA', D)).toBe('PumpA_20261107-090503.pdf');
  });
  it('ファイル名に使えない文字を_に置き換える', () => {
    // / と : で2つ、*?"<>|\ の7文字で7つ、区切りの1つ → 「改」のあとに _ が8個
    expect(pdfFileName('ポンプ/A:改*?"<>|\\', D)).toBe('ポンプ_A_改________20261107-090503.pdf');
  });
  it('末尾の空白・ドットは取り除く（Windowsで作れない名前を避ける）', () => {
    expect(pdfFileName('Model. ', D)).toBe('Model_20261107-090503.pdf');
  });
  it('空の名前は view にする', () => {
    expect(pdfFileName('', D)).toBe('view_20261107-090503.pdf');
    expect(pdfFileName(null, D)).toBe('view_20261107-090503.pdf');
  });
});

describe('formatReportDate', () => {
  it('YYYY/MM/DD HH:mm', () => {
    expect(formatReportDate(D)).toBe('2026/11/07 09:05');
  });
});

describe('buildImagePdf', () => {
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 0xff, 0xd9]);
  const pdf = buildImagePdf(jpeg, 1754, 1240);
  const text = new TextDecoder('latin1').decode(pdf);

  it('%PDF- で始まり %%EOF で終わる', () => {
    expect(text.startsWith('%PDF-1.4')).toBe(true);
    expect(text.trimEnd().endsWith('%%EOF')).toBe(true);
  });
  it('A4横のページで、JPEGをそのまま埋め込む', () => {
    expect(text).toContain('/MediaBox [0 0 842 595]');
    expect(text).toContain('/Filter /DCTDecode');
    expect(text).toContain('/Width 1754 /Height 1240');
    expect(text).toContain(`/Length ${jpeg.length}`);
  });
  it('xref の各オフセットが、その位置の「N 0 obj」を指している', () => {
    const xrefPos = Number(text.match(/startxref\n(\d+)/)[1]);
    expect(text.slice(xrefPos, xrefPos + 4)).toBe('xref');
    const entries = text.slice(xrefPos).split('\n').slice(3, 8);
    entries.forEach((line, i) => {
      const off = Number(line.slice(0, 10));
      expect(text.slice(off, off + `${i + 1} 0 obj`.length)).toBe(`${i + 1} 0 obj`);
    });
  });
});

describe('wrapText', () => {
  const ctx = { measureText: (s) => ({ width: s.length * 10 }) }; // 1文字10px
  it('幅に収まるよう折り返す。改行も尊重する', () => {
    expect(wrapText(ctx, 'あいうえおかき\nく', 50, 10)).toEqual(['あいうえお', 'かき', 'く']);
  });
  it('行数を超えた分は最後の行を…で切る', () => {
    expect(wrapText(ctx, 'あいうえおかきくけこさしす', 50, 2)).toEqual(['あいうえお', 'かきくけ…']);
  });
  it('空文字は空配列', () => {
    expect(wrapText(ctx, '', 50, 3)).toEqual([]);
  });
});
