/**
 * The push-token slice (#114) ships MONTHS before the native config that makes
 * it work, so the property under test is not "it registers" — it is "it can
 * only ever succeed or vanish". On every binary that exists today
 * `getExpoPushTokenAsync` throws (no FCM config on Android, no push
 * entitlement on iOS), and a registration nobody asked for must never surface
 * that, never retry, and never write garbage.
 */
const mockGetExpoPushTokenAsync = jest.fn();
const mockAddListener = jest.fn();
const mockSetExpoPushToken = jest.fn();
const mockCheckAndFetchOta = jest.fn();

jest.mock('expo-notifications', () => ({
  getExpoPushTokenAsync: (...a: unknown[]) => mockGetExpoPushTokenAsync(...(a as [])),
  addNotificationReceivedListener: (...a: unknown[]) => mockAddListener(...(a as [])),
}));
jest.mock('expo-constants', () => ({
  __esModule: true,
  default: { expoConfig: { extra: { eas: { projectId: 'test-project-id' } } } },
}));
jest.mock('@/lib/ledger', () => ({
  setExpoPushToken: (...a: unknown[]) => mockSetExpoPushToken(...(a as [])),
}));
jest.mock('@/lib/app-update', () => ({
  checkAndFetchOta: (...a: unknown[]) => mockCheckAndFetchOta(...(a as [])),
}));

import { registerPushToken, shouldFetchOnPush } from '@/lib/push-token';

beforeEach(() => {
  mockGetExpoPushTokenAsync.mockReset();
  mockSetExpoPushToken.mockReset();
  mockSetExpoPushToken.mockResolvedValue(undefined);
  mockCheckAndFetchOta.mockReset();
});

describe('registerPushToken', () => {
  it('writes the token to the profile on success', async () => {
    mockGetExpoPushTokenAsync.mockResolvedValue({ data: 'ExponentPushToken[abc123]' });
    await registerPushToken('uid-1');
    expect(mockGetExpoPushTokenAsync).toHaveBeenCalledWith({ projectId: 'test-project-id' });
    expect(mockSetExpoPushToken).toHaveBeenCalledWith('uid-1', 'ExponentPushToken[abc123]');
  });

  it('silently no-ops when the token call throws (today: every binary)', async () => {
    mockGetExpoPushTokenAsync.mockRejectedValue(new Error('No aps-environment entitlement'));
    await expect(registerPushToken('uid-1')).resolves.toBeUndefined();
    expect(mockSetExpoPushToken).not.toHaveBeenCalled();
  });

  it('silently no-ops when the profile write itself fails', async () => {
    // Rules rejection or offline — same contract: swallow, no retry.
    mockGetExpoPushTokenAsync.mockResolvedValue({ data: 'ExponentPushToken[abc123]' });
    mockSetExpoPushToken.mockRejectedValue(new Error('permission-denied'));
    await expect(registerPushToken('uid-1')).resolves.toBeUndefined();
  });

  it('does nothing when signed out', async () => {
    await registerPushToken(undefined);
    await registerPushToken(null);
    expect(mockGetExpoPushTokenAsync).not.toHaveBeenCalled();
    expect(mockSetExpoPushToken).not.toHaveBeenCalled();
  });

  it('writes nothing when the token comes back empty', async () => {
    mockGetExpoPushTokenAsync.mockResolvedValue({ data: '' });
    await registerPushToken('uid-1');
    expect(mockSetExpoPushToken).not.toHaveBeenCalled();
  });
});

describe('shouldFetchOnPush', () => {
  it('accepts an ota-published payload for this platform', () => {
    expect(shouldFetchOnPush({ type: 'ota-published', platform: 'ios' }, 'ios')).toBe(true);
  });

  it('accepts a payload with no platform stamp (broadcast)', () => {
    expect(shouldFetchOnPush({ type: 'ota-published' }, 'android')).toBe(true);
  });

  it('ignores a publish for the OTHER platform', () => {
    // The sender pushes to every registered token because a token does not
    // encode its platform; the device filters itself out here.
    expect(shouldFetchOnPush({ type: 'ota-published', platform: 'android' }, 'ios')).toBe(false);
  });

  it('ignores every other payload shape', () => {
    expect(shouldFetchOnPush({ type: 'reminder' }, 'ios')).toBe(false);
    expect(shouldFetchOnPush({}, 'ios')).toBe(false);
    expect(shouldFetchOnPush(null, 'ios')).toBe(false);
    expect(shouldFetchOnPush('ota-published', 'ios')).toBe(false);
    expect(shouldFetchOnPush(undefined, 'ios')).toBe(false);
  });
});
