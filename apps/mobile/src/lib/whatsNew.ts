import AsyncStorage from '@react-native-async-storage/async-storage';

// Bump this when there's something new worth a one-time banner on Today.
// Mirrors the PWA's WHATS_NEW_VERSION pattern: the banner shows until the
// user dismisses it, then the seen version is stored so it stays hidden until
// the next bump. Device-local (AsyncStorage), like the reminder prefs.
export const WHATS_NEW_VERSION = '2026-06-30';

const KEY = 'whatsNew.seen';

export async function getWhatsNewSeen(): Promise<string | null> {
  return AsyncStorage.getItem(KEY);
}

export async function markWhatsNewSeen(): Promise<void> {
  await AsyncStorage.setItem(KEY, WHATS_NEW_VERSION);
}
