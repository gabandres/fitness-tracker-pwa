import { isTodayLoading } from '@/lib/today-gate';

// Today's spinner has failed in both directions historically: clearing too
// early paints numbers that are not the user's, and clearing too late — or
// never — is a permanent spinner on a cold cache offline. Both are pinned here.

const gate = (logsReady: boolean, profileReady: boolean, failed = false) =>
  isTodayLoading({ logsReady, profileReady, failed });

describe('isTodayLoading', () => {
  it('draws once BOTH the logs and the profile have answered', () => {
    expect(gate(true, true)).toBe(false);
  });

  // The 2026-08-28 defect. `snapshotArrived` is latched by the logs listener
  // alone, so this combination used to render — and `dailyTargets(null, …)`
  // returns a seed: calorieTarget 1800, proteinTarget 0. Today showed a hero
  // belonging to nobody, then count-upped to the real target once the profile
  // landed, sweeping the big number through values that were never true.
  it('WAITS when the logs have answered but the profile has not', () => {
    expect(gate(true, false)).toBe(true);
  });

  it('waits when the profile has answered but the logs have not', () => {
    expect(gate(false, true)).toBe(true);
  });

  it('waits when neither has answered', () => {
    expect(gate(false, false)).toBe(true);
  });

  // The no-hang guarantee, and it must hold for EVERY combination — a failure
  // that left the spinner up would turn a bad network into a dead screen.
  // Today renders its error line instead.
  it('never hangs: a failure clears the spinner whatever else is pending', () => {
    for (const logsReady of [true, false]) {
      for (const profileReady of [true, false]) {
        expect(gate(logsReady, profileReady, true)).toBe(false);
      }
    }
  });
});
