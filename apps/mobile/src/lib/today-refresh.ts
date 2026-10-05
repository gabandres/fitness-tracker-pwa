import { doc, getDoc } from 'firebase/firestore';
import { needsOuraScopeUpgrade } from '@macrolog/core';
import { db } from '@/lib/firebase';
import { isExpectedHealthState } from '@/lib/health-errors';
import { importAll } from '@/lib/health-sync';
import { importOuraDaily, importOuraWorkouts } from '@/lib/oura';
import { captureError } from '@/lib/sentry';

/**
 * What Today's pull-to-refresh does (UX_AUDIT Today review U7).
 *
 * The diary itself never needs a refresh — every number on Today is a live
 * `onSnapshot`, and a pull that only re-read them would be a gesture that
 * does nothing. What a pull CAN honestly do is the part that is not live: the
 * imports. Sleep from last night, this morning's scale reading and today's
 * steps arrive from Apple Health / Health Connect and Oura on app-open and
 * foreground only, so "I just weighed in, where is it?" had no answer short
 * of backgrounding the app. The listeners deliver whatever the imports write.
 *
 * Both run, neither blocks the other, and neither throws:
 *
 * - **Health** — the same `importAll` the foreground hook runs (it carries its
 *   own re-entrancy guard and no-ops when not connected). A locked-device
 *   refusal is expected and silent; anything else goes to Sentry.
 * - **Oura** — the same imports, WITHOUT the auto-import's 30-minute throttle:
 *   a deliberate pull is the user asking. It still skips a grant missing a
 *   scope, for the reason `useOuraAutoImport` gives — a fresh `lastSyncedAt`
 *   would make a broken link look healthy.
 */
export async function refreshImports(uid: string | undefined): Promise<void> {
  if (!uid) return;
  await Promise.allSettled([
    importAll(uid).catch((err: unknown) => {
      if (!isExpectedHealthState(err)) captureError(err, { where: 'today.refresh.health' });
    }),
    (async () => {
      try {
        // The status doc `useOuraAutoImport` reads, read the same way.
        const d = (await getDoc(doc(db, `users/${uid}/integrations/oura`))).data();
        if (d?.['connected'] !== true) return;
        if (needsOuraScopeUpgrade(typeof d['scope'] === 'string' ? d['scope'] : undefined)) return;
        await importOuraWorkouts(uid);
        await importOuraDaily(uid);
      } catch {
        // Silent, like the auto-import: an unreachable Oura is reported on
        // the Connected apps screen, not in the middle of someone's day.
      }
    })(),
  ]);
}
