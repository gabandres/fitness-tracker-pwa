/**
 * The JS half of the watch push's "never dropped" guarantee.
 *
 * The Swift half is where the mechanism lives: an intent that runs before
 * `WCSession` has finished activating parks its envelope in the App Group, and
 * `WatchLinkSession` drains it on `activationDidCompleteWith` — milliseconds
 * later, before React Native has finished booting. None of that is testable
 * from here; there is no Swift test harness in this repo and the behaviour is
 * cross-process.
 *
 * What IS testable from here is the one thing JS owns, and it is the half that
 * bounds staleness rather than the half that delivers: **anything JS asserts is
 * strictly newer than a park, so the park is spent.** Without this, an envelope
 * parked on a phone with no watch survives until a watch is paired — an event
 * that fires `sessionWatchStateDidChange` and drains it verbatim, days later,
 * asserting whichever day's numbers it was written with.
 *
 * The failure is quiet in exactly the way this surface always fails: the wrist
 * shows *a* number, it is simply the wrong day's, and the day-key guard in
 * `Glance.swift` is the only reason it degrades to the empty face instead of
 * presenting yesterday's calories as today's.
 */
import { Platform } from 'react-native';
import type { WidgetSnapshot } from '@macrolog/core';

// `jest.setup.js` stubs this module globally, because almost every suite only
// needs it to not touch an App Group. This one is about the module itself.
jest.mock('@/lib/widget', () => jest.requireActual('@/lib/widget'));

// `supported` gates every function here on not being Expo Go, and jest-expo
// reports the store client by default — which would make each assertion below
// pass vacuously.
jest.mock('expo-constants', () => ({
  __esModule: true,
  ExecutionEnvironment: { StoreClient: 'storeClient', Standalone: 'standalone', Bare: 'bare' },
  default: { executionEnvironment: 'standalone' },
}));

const mockUpdateApplicationContext = jest.fn(() => true);

jest.mock('../../modules/watch-link', () => ({
  updateApplicationContext: (...a: unknown[]) => mockUpdateApplicationContext(...(a as [])),
}));

const mockAppGroup = new Map<string, string>();

jest.mock('@bacons/apple-targets', () => ({
  ExtensionStorage: class {
    get(key: string) {
      return mockAppGroup.get(key);
    }
    set(key: string, value: string | undefined) {
      if (value === undefined) mockAppGroup.delete(key);
      else mockAppGroup.set(key, value);
    }
    static reloadWidget() {}
  },
}));

import {
  WATCH_ASSERT_KEY,
  WATCH_CONTEXT_KEY,
  WATCH_PENDING_KEY,
  assertWatchSnapshot,
  readWatchAssertOutcome,
} from '@/lib/widget';

const SNAPSHOT: WidgetSnapshot = {
  v: 1,
  dateKey: '2026-08-14',
  kcalConsumed: 1200,
  kcalTarget: 1850,
  proteinConsumed: 90,
  proteinTarget: 140,
  updatedMs: 1_760_000_000_000,
  locale: 'en',
};

/** `Platform.OS` is read at call time, so overriding the property is enough. */
function setPlatform(os: 'ios' | 'android') {
  Object.defineProperty(Platform, 'OS', { get: () => os, configurable: true });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockAppGroup.clear();
  setPlatform('ios');
});

describe('assertWatchSnapshot', () => {
  it('spends a parked envelope — what JS asserts is always newer', () => {
    mockAppGroup.set(WATCH_PENDING_KEY, JSON.stringify({ [WATCH_CONTEXT_KEY]: '{"stale":true}' }));

    assertWatchSnapshot(SNAPSHOT);

    expect(mockUpdateApplicationContext).toHaveBeenCalledWith({
      [WATCH_CONTEXT_KEY]: JSON.stringify(SNAPSHOT),
    });
    expect(mockAppGroup.has(WATCH_PENDING_KEY)).toBe(false);
  });

  it('leaves the park alone on Android, which has no watch half at all', () => {
    setPlatform('android');
    mockAppGroup.set(WATCH_PENDING_KEY, 'untouched');

    assertWatchSnapshot(SNAPSHOT);

    expect(mockUpdateApplicationContext).not.toHaveBeenCalled();
    expect(mockAppGroup.get(WATCH_PENDING_KEY)).toBe('untouched');
  });
});

describe('readWatchAssertOutcome', () => {
  // The whole point of the key: from the wrist, every one of these outcomes
  // looks like a number that did not move. Two speculative fixes shipped to
  // this surface on 2026-08-13 without either being distinguishable.
  it.each([
    ['sent', 'app'],
    ['sent:after-wait', 'app'],
    ['parked:not-activated', 'app'],
    ['parked:appex', 'appex'],
    ['skipped:unsupported', 'app'],
  ])('reads back %s from %s', (outcome, process) => {
    mockAppGroup.set(WATCH_ASSERT_KEY, JSON.stringify({ outcome, atMs: '1760000000000', process }));

    expect(readWatchAssertOutcome()).toEqual({
      outcome,
      atMs: 1_760_000_000_000,
      process,
    });
  });

  it('is null when no native push has ever run', () => {
    expect(readWatchAssertOutcome()).toBeNull();
  });

  // Swift writes `atMs` as a string (JSONSerialization over [String: String]),
  // and a number here would silently render as "Invalid Date" in the
  // diagnostics card rather than failing anywhere visible.
  it('survives a malformed record rather than throwing into the settings screen', () => {
    mockAppGroup.set(WATCH_ASSERT_KEY, 'not json');
    expect(readWatchAssertOutcome()).toBeNull();

    mockAppGroup.set(WATCH_ASSERT_KEY, JSON.stringify({ atMs: '1' }));
    expect(readWatchAssertOutcome()).toBeNull();

    mockAppGroup.set(WATCH_ASSERT_KEY, JSON.stringify({ outcome: 'sent' }));
    expect(readWatchAssertOutcome()).toEqual({ outcome: 'sent', atMs: 0, process: 'app' });
  });
});
