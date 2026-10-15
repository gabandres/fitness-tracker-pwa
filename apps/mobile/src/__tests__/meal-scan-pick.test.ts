/**
 * Audit 2026-10-15 #5: a refused photo-library permission was returned as a
 * plain `null` — the same as the user cancelling the picker — so the scan
 * screen did nothing at all, with no word about why or where to fix it.
 */
jest.mock('firebase/functions', () => ({ httpsCallable: () => async () => ({ data: {} }) }));
jest.mock('@/lib/firebase', () => ({ functions: {} }));
const mockLibPerm = jest.fn();
const mockLaunch = jest.fn();
jest.mock('expo-image-picker', () => ({
  requestMediaLibraryPermissionsAsync: () => mockLibPerm(),
  requestCameraPermissionsAsync: jest.fn(),
  launchImageLibraryAsync: (...a: unknown[]) => mockLaunch(...a),
  launchCameraAsync: jest.fn(),
}));

import { pickMealPhoto } from '@/lib/mealScan';

it('tells a refused library apart from a cancelled pick', async () => {
  mockLibPerm.mockResolvedValue({ granted: false, canAskAgain: false });
  expect(await pickMealPhoto('library')).toEqual({ denied: true, canAskAgain: false });
  mockLibPerm.mockResolvedValue({ granted: true, canAskAgain: true });
  mockLaunch.mockResolvedValue({ canceled: true });
  expect(await pickMealPhoto('library')).toBeNull();
});
