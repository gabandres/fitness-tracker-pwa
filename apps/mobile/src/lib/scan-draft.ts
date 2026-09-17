import AsyncStorage from '@react-native-async-storage/async-storage';
import type { ScannedFoodItem } from '@macrolog/core';

/**
 * The reviewed photo scan, parked on disk so a process death cannot eat it.
 *
 * ## Why this is not part of `offline-cache.ts`
 *
 * That module says of itself that it is "a display cache and nothing more — it
 * never feeds a write". This draft is the opposite: its whole purpose is to
 * still be there when the user taps Add. Same storage, different contract, so
 * it gets its own key and its own lifecycle.
 *
 * ## Why it exists at all
 *
 * A scan is the most expensive state in the app and the least reproducible: one
 * daily-quota slot, one Gemini call, and a photograph of a meal that is about to
 * be eaten. It lived only in `scan.tsx`'s `useState`, so anything that ended the
 * JS process between the result and the Add button destroyed it silently — an
 * auto-applied OTA (`ota-hold.ts` has the case that prompted this), an iOS
 * memory kill after the camera and the base64 encode, or a crash.
 *
 * `ota-hold` removes the cause we control. This removes the consequence of the
 * causes we do not.
 *
 * ## Lifecycle
 *
 * A draft survives an ACCIDENT, never a DECISION. It is cleared when the entry
 * is added and when the user leaves the review deliberately, so the only way one
 * is still on disk at the next mount is that the process went away underneath
 * it. That is what makes an unexpected restore trustworthy rather than
 * confusing.
 */
const KEY = 'ignia.scanDraft.v1';

/**
 * How long a parked scan is still worth restoring.
 *
 * Bounded by meals, not by storage: the entry is written with the timestamp of
 * the Add, so restoring a scan from long enough ago files dinner under
 * breakfast. Six hours covers a restart-and-return — including one where the
 * user put the phone down for a while — and expires before it can land on the
 * wrong meal of the next day.
 */
const TTL_MS = 6 * 60 * 60 * 1000;

export interface ScanDraft {
  /** Whose scan this is. A draft is never restored into another account. */
  uid: string;
  /** When the review was last touched, for {@link TTL_MS}. */
  atMs: number;
  items: ScannedFoodItem[];
  mealName: string;
  portion: number;
  lowConf: boolean;
  note: string;
  remaining: number | null;
}

/** Park the current review. Never throws — a draft we cannot write is a risk we
 *  are back to accepting, not a crash on top of it. */
export async function saveScanDraft(draft: ScanDraft): Promise<void> {
  try {
    if (!draft.uid || !draft.items.length) return;
    await AsyncStorage.setItem(KEY, JSON.stringify(draft));
  } catch {
    /* best effort */
  }
}

/**
 * The parked review for this account, if one is still worth showing.
 *
 * Returns null — and clears — for a draft belonging to someone else or past its
 * TTL, so the expiry happens on the path that would have used it rather than in
 * a sweep nothing calls.
 */
export async function readScanDraft(
  uid: string,
  nowMs: number = Date.now(),
): Promise<ScanDraft | null> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return null;
    const d = JSON.parse(raw) as Partial<ScanDraft>;
    if (!d || typeof d !== 'object') return null;
    if (d.uid !== uid || !Array.isArray(d.items) || d.items.length === 0) {
      await clearScanDraft();
      return null;
    }
    if (typeof d.atMs !== 'number' || nowMs - d.atMs > TTL_MS) {
      await clearScanDraft();
      return null;
    }
    return {
      uid,
      atMs: d.atMs,
      items: d.items,
      mealName: typeof d.mealName === 'string' ? d.mealName : '',
      portion: typeof d.portion === 'number' && d.portion > 0 ? d.portion : 1,
      lowConf: d.lowConf === true,
      note: typeof d.note === 'string' ? d.note : '',
      remaining: typeof d.remaining === 'number' ? d.remaining : null,
    };
  } catch {
    return null;
  }
}

export async function clearScanDraft(): Promise<void> {
  try {
    await AsyncStorage.removeItem(KEY);
  } catch {
    /* best effort */
  }
}
