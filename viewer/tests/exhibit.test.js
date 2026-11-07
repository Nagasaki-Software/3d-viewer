import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createExhibitMode } from '../src/exhibit.js';

describe('createExhibitMode', () => {
  let calls;
  let exhibit;
  beforeEach(() => {
    vi.useFakeTimers();
    calls = [];
    exhibit = createExhibitMode({ setAutoRotate: (on) => calls.push(on), idleMs: 30000 });
  });
  afterEach(() => vi.useRealTimers());

  it('開始で回転ON、停止でOFF', () => {
    exhibit.start();
    expect(calls).toEqual([true]);
    exhibit.stop();
    expect(calls).toEqual([true, false]);
    expect(exhibit.isActive()).toBe(false);
  });

  it('操作で一時停止し、30秒無操作で再開する', () => {
    exhibit.start();
    exhibit.notifyInteraction();
    expect(calls).toEqual([true, false]);
    vi.advanceTimersByTime(29999);
    expect(calls).toEqual([true, false]);
    vi.advanceTimersByTime(1);
    expect(calls).toEqual([true, false, true]);
  });

  it('操作のたびにタイマーはリセットされる', () => {
    exhibit.start();
    exhibit.notifyInteraction();
    vi.advanceTimersByTime(20000);
    exhibit.notifyInteraction();
    vi.advanceTimersByTime(20000);
    expect(calls.filter((c) => c === true)).toHaveLength(1); // まだ再開しない
    vi.advanceTimersByTime(10000);
    expect(calls[calls.length - 1]).toBe(true);
  });

  it('停止後はタイマーが残っていても再開しない', () => {
    exhibit.start();
    exhibit.notifyInteraction();
    exhibit.stop();
    vi.advanceTimersByTime(60000);
    expect(calls[calls.length - 1]).toBe(false);
  });

  it('非アクティブ時のnotifyInteractionは何もしない', () => {
    exhibit.notifyInteraction();
    expect(calls).toEqual([]);
  });
});
