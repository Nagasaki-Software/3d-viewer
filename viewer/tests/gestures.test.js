import { describe, expect, it } from 'vitest';
import { createDoubleTapDetector } from '../src/gestures.js';

describe('createDoubleTapDetector', () => {
  it('時間・距離内の2連続タップでダブルタップ', () => {
    const feed = createDoubleTapDetector({ maxDelayMs: 350, maxDistPx: 24 });
    expect(feed(100, 100, 1000)).toBe(false);
    expect(feed(105, 102, 1200)).toBe(true);
  });
  it('間隔が長いとダブルタップにならない', () => {
    const feed = createDoubleTapDetector({ maxDelayMs: 350, maxDistPx: 24 });
    feed(100, 100, 1000);
    expect(feed(100, 100, 1500)).toBe(false);
  });
  it('離れた位置ではダブルタップにならない', () => {
    const feed = createDoubleTapDetector({ maxDelayMs: 350, maxDistPx: 24 });
    feed(100, 100, 1000);
    expect(feed(200, 100, 1100)).toBe(false);
  });
  it('3連続タップは2回目のみtrue（リセットされる）', () => {
    const feed = createDoubleTapDetector({ maxDelayMs: 350, maxDistPx: 24 });
    feed(100, 100, 1000);
    expect(feed(100, 100, 1100)).toBe(true);
    expect(feed(100, 100, 1200)).toBe(false);
  });
});
