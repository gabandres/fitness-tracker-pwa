import { useCallback, useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Let a Trends stub row be dismissed (ADR-0034, issue #103).
 *
 * ## Why this exists instead of "My View"
 *
 * ADR-0034 refused a show/hide catalogue, and named the strongest objection to
 * its own decision in the same breath: *"A user who fasts daily and owns no
 * wearable now has a Trends screen with a permanently unhideable sleep stub row
 * on it… The person who asked the original question is plausibly exactly that
 * user."*
 *
 * That objection is correct, and it is much narrower than a settings screen. On
 * a screen consolidated to four elements there is nothing worth hiding — the
 * cards already gate on their own evidence and vanish when they have nothing to
 * say. **The one thing a user genuinely cannot get rid of is a row that exists
 * only to tell them they have no data.** So that row gets a dismiss, and the
 * catalogue does not get built.
 *
 * ## It dismisses the STUB, never the card
 *
 * The flag is only ever read in the empty state. The moment the feature has
 * evidence — a third night, a third completed fast — the card renders regardless
 * of what is stored here, because at that point it is no longer a nag and has
 * something to say. That self-healing is what makes a one-way dismiss
 * acceptable with no "restore" affordance to build or explain: the only way to
 * lose something permanently is to never produce the data, and in that case the
 * row was never going to be useful.
 *
 * ## Device-local, and it must stay that way
 *
 * AsyncStorage, exactly like `usePersistedTab`. ADR-0034's option C stores
 * hidden ids on the PROFILE, which needs a `firestore.rules` change — and
 * `hasOnly` is evaluated against the merged document, so that deploy is
 * cross-frontend and can start rejecting the FROZEN web's profile writes. This
 * needs none of it. If a dismissal ever has to follow a user between devices,
 * it has become option C and should be priced as option C.
 */
const memo = new Map<string, boolean>();

export function useDismissedStub(key: string): [boolean, () => void] {
  const [dismissed, setDismissed] = useState(() => memo.get(key) ?? false);

  useEffect(() => {
    if (memo.has(key)) return;
    let alive = true;
    void AsyncStorage.getItem(key)
      .then((stored) => {
        if (!alive || stored !== '1') return;
        memo.set(key, true);
        setDismissed(true);
      })
      // A cache that cannot be read shows the row. Erring toward showing it is
      // the right direction for a one-way action: a row that reappears is a
      // small annoyance, one that vanishes unbidden is a bug report.
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [key]);

  const dismiss = useCallback(() => {
    setDismissed(true);
    memo.set(key, true);
    void AsyncStorage.setItem(key, '1').catch(() => {});
  }, [key]);

  return [dismissed, dismiss];
}
