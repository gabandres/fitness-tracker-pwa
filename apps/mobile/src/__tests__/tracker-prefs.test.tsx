import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, renderHook } from '@testing-library/react-native';
import {
  ALL_TRACKERS_ON,
  NEW_ACCOUNT_TRACKERS,
  __resetTrackerPrefsCache,
  allTrackersOff,
  initTrackerPrefsForNewAccount,
  loadTrackerPrefs,
  mergeTrackerPrefs,
  parseTrackerPrefs,
  saveTrackerPrefs,
  trackerPrefsKey,
  useTrackerPrefs,
} from '@/lib/tracker-prefs';

const mockAuth = { user: { uid: 'u1' } as { uid: string } | null };
jest.mock('@/lib/auth', () => ({ useAuth: () => mockAuth }));

beforeEach(async () => {
  await AsyncStorage.clear();
  __resetTrackerPrefsCache();
  mockAuth.user = { uid: 'u1' };
});

describe('parse / merge', () => {
  it('nothing stored is null (caller shows everything)', () => {
    expect(parseTrackerPrefs(null)).toBeNull();
    expect(parseTrackerPrefs('not json')).toBeNull();
    expect(parseTrackerPrefs('[]')).toBeNull();
  });
  it('missing, unknown or non-boolean keys default to ON', () => {
    expect(parseTrackerPrefs('{"fasting":false,"bogus":false,"water":"no"}')).toEqual({
      ...ALL_TRACKERS_ON,
      fasting: false,
    });
    expect(mergeTrackerPrefs({})).toEqual(ALL_TRACKERS_ON);
  });
  it('new-account defaults: water and sleep on, the rest off', () => {
    expect(NEW_ACCOUNT_TRACKERS).toEqual({ fasting: false, water: true, sleep: true, hunger: false, dayLogged: false });
    expect(allTrackersOff(NEW_ACCOUNT_TRACKERS)).toBe(false);
    expect(allTrackersOff({ fasting: false, water: false, sleep: false, hunger: false, dayLogged: false })).toBe(true);
  });
});

describe('storage', () => {
  it('an existing user (nothing stored) sees every tracker', async () => {
    expect(await loadTrackerPrefs('u1')).toEqual(ALL_TRACKERS_ON);
  });
  it('save then load round-trips, per account', async () => {
    await saveTrackerPrefs('u1', { ...ALL_TRACKERS_ON, sleep: false });
    expect(await loadTrackerPrefs('u1')).toEqual({ ...ALL_TRACKERS_ON, sleep: false });
    expect(await loadTrackerPrefs('u2')).toEqual(ALL_TRACKERS_ON);
    expect(await AsyncStorage.getItem(trackerPrefsKey('u1'))).toContain('"sleep":false');
  });
  it('init writes the new-account set only when nothing is stored', async () => {
    await initTrackerPrefsForNewAccount('u1');
    expect(await loadTrackerPrefs('u1')).toEqual(NEW_ACCOUNT_TRACKERS);
    await saveTrackerPrefs('u2', { ...ALL_TRACKERS_ON, water: false });
    await initTrackerPrefsForNewAccount('u2');
    expect(await loadTrackerPrefs('u2')).toEqual({ ...ALL_TRACKERS_ON, water: false });
  });
  it('tolerates storage failure: load shows everything, init never throws', async () => {
    // `Once`, not spy + restore: the official mock's getItem is already a
    // jest.fn, and restoring it would strip its implementation for later tests.
    (AsyncStorage.getItem as jest.Mock)
      .mockRejectedValueOnce(new Error('disk'))
      .mockRejectedValueOnce(new Error('disk'));
    expect(await loadTrackerPrefs('u1')).toEqual(ALL_TRACKERS_ON);
    await expect(initTrackerPrefsForNewAccount('u1')).resolves.toBeUndefined();
  });
});

describe('useTrackerPrefs', () => {
  it('is not ready until the first read, then has the stored value', async () => {
    await saveTrackerPrefs('u1', { ...ALL_TRACKERS_ON, hunger: false });
    __resetTrackerPrefsCache();
    const { result } = await renderHook(() => useTrackerPrefs());
    expect(result.current.ready).toBe(true);
    expect(result.current.prefs.hunger).toBe(false);
  });

  it('setTracker updates every mounted consumer and persists', async () => {
    const a = await renderHook(() => useTrackerPrefs());
    const b = await renderHook(() => useTrackerPrefs());
    await act(async () => {
      a.result.current.setTracker('fasting', false);
    });
    expect(a.result.current.prefs.fasting).toBe(false);
    expect(b.result.current.prefs.fasting).toBe(false);
    expect(await loadTrackerPrefs('u1')).toEqual({ ...ALL_TRACKERS_ON, fasting: false });
  });

  it('signed out: never ready, shows everything', async () => {
    mockAuth.user = null;
    const { result } = await renderHook(() => useTrackerPrefs());
    expect(result.current.ready).toBe(false);
    expect(result.current.prefs).toEqual(ALL_TRACKERS_ON);
  });
});
