import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createContextRecovery } from '../src/context-recovery.js';

describe('createContextRecovery', () => {
  let messages;
  let recovery;
  beforeEach(() => {
    vi.useFakeTimers();
    messages = [];
    recovery = createContextRecovery({
      showMessage: (text) => messages.push(text),
      timeoutMs: 15000,
    });
  });
  afterEach(() => { vi.useRealTimers(); });

  it('喪失時に復旧中メッセージを出す', () => {
    recovery.onLost();
    expect(messages[0]).toContain('復旧');
  });

  it('時間内に復旧しなければ再読み込み案内を出す', () => {
    recovery.onLost();
    vi.advanceTimersByTime(15000);
    expect(messages.at(-1)).toContain('再読み込み');
  });

  it('復旧したら案内タイマーを止めて復旧メッセージを出す', () => {
    recovery.onLost();
    recovery.onRestored();
    vi.advanceTimersByTime(60000);
    expect(messages.at(-1)).toContain('復旧しました');
    expect(messages.some((m) => m.includes('再読み込み'))).toBe(false);
  });

  it('喪失が2回続いてもタイマーが多重にならない', () => {
    recovery.onLost();
    vi.advanceTimersByTime(5000);
    recovery.onLost();
    vi.advanceTimersByTime(10000); // 1回目から15秒経過、2回目からは10秒
    expect(messages.some((m) => m.includes('再読み込み'))).toBe(false);
    vi.advanceTimersByTime(5000); // 2回目から15秒経過
    expect(messages.at(-1)).toContain('再読み込み');
  });

  it('onLostを呼ばずにonRestoredを呼んでもエラーにならない', () => {
    expect(() => recovery.onRestored()).not.toThrow();
    expect(messages.at(-1)).toContain('復旧しました');
  });

  it('復旧しない場合の案内は長め（5分）に表示される', () => {
    const calls = [];
    const r = createContextRecovery({ showMessage: (...args) => calls.push(args), timeoutMs: 15000 });
    r.onLost();
    vi.advanceTimersByTime(15000);
    const last = calls.at(-1);
    expect(last[1]).toBe(300000);
  });
});
