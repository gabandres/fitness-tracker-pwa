import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RestTimer } from './rest-timer';

describe('RestTimer', () => {
  let timer: RestTimer;

  beforeEach(() => {
    vi.useFakeTimers();
    timer = new RestTimer();
  });

  afterEach(() => {
    timer.stop();
    vi.useRealTimers();
  });

  it('starts idle', () => {
    expect(timer.remaining()).toBe(0);
  });

  it('counts down one second per tick', () => {
    timer.start(90);
    expect(timer.remaining()).toBe(90);
    vi.advanceTimersByTime(1000);
    expect(timer.remaining()).toBe(89);
    vi.advanceTimersByTime(4000);
    expect(timer.remaining()).toBe(85);
  });

  it('stops at zero and stays there', () => {
    timer.start(2);
    vi.advanceTimersByTime(2000);
    expect(timer.remaining()).toBe(0);
    // No further ticks — the interval is cleared at zero.
    vi.advanceTimersByTime(10_000);
    expect(timer.remaining()).toBe(0);
  });

  it('restart replaces a running countdown instead of stacking', () => {
    timer.start(60);
    vi.advanceTimersByTime(5000);
    timer.start(120);
    expect(timer.remaining()).toBe(120);
    vi.advanceTimersByTime(1000);
    // One interval, one tick — a stacked timer would have dropped 2.
    expect(timer.remaining()).toBe(119);
  });

  it('stop() cancels and resets, and is idempotent', () => {
    timer.start(60);
    vi.advanceTimersByTime(3000);
    timer.stop();
    expect(timer.remaining()).toBe(0);
    vi.advanceTimersByTime(5000);
    expect(timer.remaining()).toBe(0);
    timer.stop(); // no throw when already idle
  });

  it('formats the label as m:ss', () => {
    timer.start(125);
    expect(timer.label()).toBe('2:05');
    vi.advanceTimersByTime(120_000);
    expect(timer.label()).toBe('0:05');
    vi.advanceTimersByTime(5000);
    expect(timer.label()).toBe('0:00');
  });
});
