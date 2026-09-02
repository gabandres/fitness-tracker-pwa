import {
  LOG_SECS_CAP,
  clearLogTimer,
  resetLogTimer,
  startLogTimer,
  takeLogTimerSecs,
} from '@/lib/log-timer';

beforeEach(() => resetLogTimer());

describe('log timer', () => {
  it('reads 0 when no surface started it — quick add, repeat, widget, watch', () => {
    expect(takeLogTimerSecs(10_000)).toBe(0);
  });

  it('credits the first log with the wait and restarts for the next', () => {
    // A photo scan that logs three items: one 40 s wait, then two ~0 s items.
    startLogTimer(0);
    expect(takeLogTimerSecs(40_000)).toBe(40);
    expect(takeLogTimerSecs(40_300)).toBe(0);
    expect(takeLogTimerSecs(41_000)).toBe(1);
  });

  it('caps a sheet left open at LOG_SECS_CAP', () => {
    startLogTimer(0);
    expect(takeLogTimerSecs(20 * 60_000)).toBe(LOG_SECS_CAP);
  });

  it('a closed surface leaves nothing behind for the next write', () => {
    startLogTimer(0);
    clearLogTimer();
    expect(takeLogTimerSecs(5_000)).toBe(0);
  });

  it('never goes negative on a clock that stepped back', () => {
    startLogTimer(10_000);
    expect(takeLogTimerSecs(9_000)).toBe(0);
  });
});
