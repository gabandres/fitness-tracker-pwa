/**
 * "Update required" — the server-controlled floor under which a binary is
 * retired (`lib/update-required.ts`). Every case here errs toward NOT
 * blocking: a false positive locks someone out of their own app behind a store
 * page that may have nothing for them.
 */
import { act, renderHook } from '@testing-library/react-native';
import { AppState, type AppStateStatus } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

let mockGateable = true;
let mockInstalled = { build: '70', version: '1.2.6' };
const mockFetch = jest.fn();
jest.mock('@/lib/app-update', () => {
  const actual = jest.requireActual('@/lib/app-update');
  return {
    versionKey: actual.versionKey,
    isGateableRuntime: () => mockGateable,
    installedIdentity: () => mockInstalled,
    fetchVersionManifest: () => mockFetch(),
  };
});

import {
  MIN_CACHE_KEY,
  currentKey,
  isUpdateRequired,
  minKey,
  rawMinimum,
  useUpdateRequired,
} from '@/lib/update-required';

describe('isUpdateRequired (pure)', () => {
  it('requires only when the running binary is strictly below the minimum', () => {
    expect(isUpdateRequired(49, 50)).toBe(true);
    expect(isUpdateRequired(50, 50)).toBe(false);
    expect(isUpdateRequired(51, 50)).toBe(false);
  });

  it('never guesses — unknown on either side is not required', () => {
    expect(isUpdateRequired(null, 50)).toBe(false);
    expect(isUpdateRequired(49, null)).toBe(false);
    expect(isUpdateRequired(null, null)).toBe(false);
  });
});

describe('minimum key spaces (pure)', () => {
  it('Android: a positive integer versionCode; anything else is no gate', () => {
    expect(minKey('android', 50)).toBe(50);
    expect(minKey('android', '50')).toBe(50);
    expect(minKey('android', 0)).toBeNull();
    expect(minKey('android', 4.5)).toBeNull();
    expect(minKey('android', 'x')).toBeNull();
    expect(minKey('android', null)).toBeNull();
  });

  it('iOS: a marketing version ordered by versionKey', () => {
    expect(minKey('ios', '1.2.6')).toBe(1_002_006);
    expect(minKey('ios', '1.2.6-beta')).toBeNull();
    expect(minKey('ios', 70)).toBeNull();
  });

  it('reads each platform\'s own field from the manifest', () => {
    const m = { android: { latestVersionCode: 51, minVersionCode: 50 }, ios: { latestVersion: '1.2.7', minVersion: '1.2.6' } };
    expect(rawMinimum(m, 'android')).toBe(50);
    expect(rawMinimum(m, 'ios')).toBe('1.2.6');
    expect(rawMinimum({ android: { latestVersionCode: 51 } }, 'android')).toBeNull();
    expect(rawMinimum({ ios: { minVersion: 'junk' } }, 'ios')).toBeNull();
  });

  it('compares the running binary in the same space', () => {
    expect(currentKey('android', { build: '49', version: '1.2.5' })).toBe(49);
    expect(currentKey('ios', { build: '70', version: '1.2.6' })).toBe(1_002_006);
    expect(currentKey('android', { build: null, version: null })).toBeNull();
  });
});

// jest-expo reports iOS, so the hook below compares marketing versions.
describe('useUpdateRequired', () => {
  let appStateListener: ((s: AppStateStatus) => void) | null = null;

  beforeEach(async () => {
    mockGateable = true;
    mockInstalled = { build: '70', version: '1.2.6' };
    mockFetch.mockReset();
    await AsyncStorage.clear();
    appStateListener = null;
    jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, fn) => {
      appStateListener = fn as (s: AppStateStatus) => void;
      return { remove: jest.fn() } as never;
    });
  });

  afterEach(() => jest.restoreAllMocks());

  const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

  it('blocks when the server minimum is above this binary, and caches it', async () => {
    mockFetch.mockResolvedValue({ ios: { latestVersion: '1.2.7', minVersion: '1.2.7' } });
    const { result } = await renderHook(() => useUpdateRequired());
    await settle();
    expect(result.current).toBe(true);
    expect(await AsyncStorage.getItem(MIN_CACHE_KEY)).toBe('1.2.7');
  });

  it('does not block at or above the minimum', async () => {
    mockFetch.mockResolvedValue({ ios: { minVersion: '1.2.6' } });
    const { result } = await renderHook(() => useUpdateRequired());
    await settle();
    expect(result.current).toBe(false);
  });

  it('never blocks when the manifest cannot be fetched and nothing is cached', async () => {
    mockFetch.mockResolvedValue(null);
    const { result } = await renderHook(() => useUpdateRequired());
    await settle();
    expect(result.current).toBe(false);
    expect(await AsyncStorage.getItem(MIN_CACHE_KEY)).toBeNull();
  });

  it('holds a previously fetched minimum offline', async () => {
    await AsyncStorage.setItem(MIN_CACHE_KEY, '1.2.7');
    mockFetch.mockResolvedValue(null);
    const { result } = await renderHook(() => useUpdateRequired());
    await settle();
    expect(result.current).toBe(true);
    expect(await AsyncStorage.getItem(MIN_CACHE_KEY)).toBe('1.2.7');
  });

  it('a manifest with no minimum lifts the gate and clears the cache', async () => {
    await AsyncStorage.setItem(MIN_CACHE_KEY, '1.2.7');
    mockFetch.mockResolvedValue({ ios: { latestVersion: '1.2.7' } });
    const { result } = await renderHook(() => useUpdateRequired());
    await settle();
    expect(result.current).toBe(false);
    expect(await AsyncStorage.getItem(MIN_CACHE_KEY)).toBeNull();
  });

  it('re-checks on foreground, so a minimum raised mid-session lands', async () => {
    mockFetch.mockResolvedValue({ ios: { latestVersion: '1.2.6' } });
    const { result } = await renderHook(() => useUpdateRequired());
    await settle();
    expect(result.current).toBe(false);

    mockFetch.mockResolvedValue({ ios: { latestVersion: '1.2.7', minVersion: '1.2.7' } });
    await act(async () => appStateListener!('active'));
    await settle();
    expect(result.current).toBe(true);
  });

  it('never gates Expo Go / dev, and never fetches there', async () => {
    mockGateable = false;
    await AsyncStorage.setItem(MIN_CACHE_KEY, '9.9.9');
    const { result } = await renderHook(() => useUpdateRequired());
    await settle();
    expect(result.current).toBe(false);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('never gates a binary whose version cannot be read', async () => {
    mockInstalled = { build: '70', version: 'weird' };
    await AsyncStorage.setItem(MIN_CACHE_KEY, '9.9.9');
    const { result } = await renderHook(() => useUpdateRequired());
    await settle();
    expect(result.current).toBe(false);
  });

  it('a stale cached minimum read late never overrides a fresher server answer', async () => {
    await AsyncStorage.setItem(MIN_CACHE_KEY, '1.2.7');
    let releaseCache: () => void = () => undefined;
    // The read sees the stale '1.2.7' but is delivered late.
    jest.spyOn(AsyncStorage, 'getItem').mockImplementation(
      () => new Promise<string | null>((r) => { releaseCache = () => r('1.2.7'); }),
    );
    // The server has CLEARED the minimum; a foreground check gets there first.
    // ...and the launch check that follows the cache read is still in flight,
    // so nothing would correct a wrong verdict until it lands.
    mockFetch.mockResolvedValueOnce({ ios: { latestVersion: '1.2.7' } }).mockReturnValue(new Promise(() => undefined));
    const { result } = await renderHook(() => useUpdateRequired());
    await act(async () => appStateListener!('active'));
    await settle();
    expect(result.current).toBe(false);
    await act(async () => releaseCache());
    await settle();
    expect(result.current).toBe(false);
  });
});
