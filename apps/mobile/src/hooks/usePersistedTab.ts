import { useCallback, useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Remember which face of a consolidated panel the user last looked at
 * (ADR-0034 decision 4).
 *
 * ## What this is, and what it deliberately is not
 *
 * It is a **cache**, in the `localStorage` sense — device-local, disposable,
 * and worth nothing to anyone but the person holding the phone. It is NOT
 * ADR-0034's option C, and the difference is the entire cost of the feature:
 *
 * - Option C stores *which cards you have hidden* on the **profile**, which
 *   means a `firestore.rules` change. `hasOnly` is evaluated against the merged
 *   document, so that deploy is cross-frontend — get it wrong and the FROZEN
 *   web's profile writes start failing too. Under a freeze that is the
 *   expensive kind of change.
 * - This stores *which tab you were on* in AsyncStorage. No profile field, no
 *   rules, no deploy ordering, nothing the web can trip over, and nothing to
 *   migrate. Losing it on reinstall costs the user one tap.
 *
 * So it is not a settings screen, and it should not grow into one. If it ever
 * needs to sync across devices, that is the moment it has become option C and
 * should be priced as option C.
 *
 * ## The stored value is validated, not trusted
 *
 * A key that is no longer a tab — renamed, or a panel that lost a face — falls
 * back rather than selecting nothing and rendering an empty panel. That is the
 * miniature version of the migration rule ADR-0034 attached to option C, and it
 * costs one `includes` here instead of a permanent invariant there.
 *
 * ## Why the module-level memo
 *
 * Trends unmounts every time the user visits another tab, so without it every
 * return to the screen would repaint the default face and then flip to the
 * stored one a frame later. The memo makes that flip happen at most once per
 * app launch; `AsyncStorage` remains the source of truth across launches.
 */
const memo = new Map<string, string>();

/**
 * Pre-select a persisted tab from OUTSIDE the panel that renders it — the
 * Today habit shortcut writes the face it is about to land on, then navigates.
 *
 * Writing the module memo (not just AsyncStorage) is the load-bearing half:
 * Trends unmounts when the user leaves it, and on remount the hook seeds its
 * state from the memo synchronously — so the target face paints on the first
 * frame, with no flash through whatever face was stored before. The caller is
 * trusted to pass a value the panel's `valid` list contains; a stale one costs
 * nothing (the hook's render-site fallback handles absence, exactly as it does
 * for a face whose card has gone quiet).
 */
export function setPersistedTab(key: string, value: string): void {
  memo.set(key, value);
  // Fire and forget, same contract as `select` below.
  void AsyncStorage.setItem(key, value).catch(() => {});
}

export function usePersistedTab(
  key: string,
  valid: readonly string[],
  fallback: string,
): [string, (next: string) => void] {
  const [tab, setTab] = useState(() => memo.get(key) ?? fallback);

  useEffect(() => {
    if (memo.has(key)) return;
    let alive = true;
    void AsyncStorage.getItem(key)
      .then((stored) => {
        if (!alive || stored == null) return;
        // Validated, not trusted — see the header.
        if (!valid.includes(stored)) return;
        memo.set(key, stored);
        setTab(stored);
      })
      // A cache that cannot be read is not an error worth surfacing: the user
      // gets the default face, which is a correct screen.
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [key, valid]);

  const select = useCallback(
    (next: string) => {
      setTab(next);
      memo.set(key, next);
      // Fire and forget. The tab has already changed on screen; a failed write
      // costs the next launch one tap and must not interrupt anything.
      void AsyncStorage.setItem(key, next).catch(() => {});
    },
    [key],
  );

  return [tab, select];
}
