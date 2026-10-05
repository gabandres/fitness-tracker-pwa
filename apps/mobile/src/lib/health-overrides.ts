import AsyncStorage from '@react-native-async-storage/async-storage';
import type { ManualOverrides } from '@macrolog/core';

/**
 * Days the user has corrected by hand, which the Health importer must not undo.
 *
 * `importScalars` writes back any Health day whose value differs from
 * Firestore's (`valuesToApply`), and it runs on every foreground. So a weigh-in
 * the user deleted came back the next time they opened the app whenever a scale
 * (or any other app) had written that day's sample — and a typed correction
 * over a scale's reading was "corrected" back to the scale's number the same
 * way. Both read as the app ignoring the person using it (Body review, bug 1).
 *
 * The fix is a record of WHEN the user acted on a day, honoured by the import
 * through `dropOverriddenSamples` in `@macrolog/core`: a sample that ended
 * before the act is superseded by it, and a later reading still imports.
 *
 * ## Why AsyncStorage and not a Firestore tombstone
 *
 * A tombstone field on `dailyWeights` would need a `firestore.rules` deploy
 * before any client could write it (CLAUDE.md: rules first, then clients), and
 * the thing it protects against is THIS phone's importer reading THIS phone's
 * health store. A second device has its own health store and its own copy of
 * the problem; a server-side flag would not stop that device's scale samples
 * either, because they never reached this one. The cost of a lost record (a
 * reinstall) is the old behaviour for one day, not data loss.
 *
 * Namespaced by uid so a second account on the device starts clean, and pruned
 * past the import window, beyond which no sample can be read to resurrect.
 */

const KEY = 'ignia.health.overrides.v1';

/** Matches `IMPORT_DAYS` in `health-sync.ts`: an override older than the
 *  window guards a day the importer will never read again. */
const KEEP_MS = 400 * 86_400_000;

/** Every kind the importer writes could carry an override; only weight does
 *  today (it is the one the user can delete from a list). */
export type OverrideKind = 'weight' | 'sleep' | 'water';

type Store = Record<string, Partial<Record<OverrideKind, Record<string, number>>>>;

async function readStore(): Promise<Store> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : null;
    return parsed && typeof parsed === 'object' ? (parsed as Store) : {};
  } catch {
    return {};
  }
}

/** One read-modify-write at a time, same reason `quick-add.ts` serialises its
 *  queue: two deletes in quick succession each read the same map and the
 *  second write drops the first day. */
let chain: Promise<unknown> = Promise.resolve();
function serial<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(fn, fn);
  chain = run.catch(() => undefined);
  return run;
}

/**
 * Record that the user acted on `dateKey` by hand at `atMs`. Best-effort: a
 * storage failure leaves the old behaviour for that day rather than failing
 * the write it accompanies.
 */
export function recordManualOverride(
  uid: string,
  kind: OverrideKind,
  dateKey: string,
  atMs: number = Date.now(),
): Promise<void> {
  return serial(async () => {
    try {
      const store = await readStore();
      const mine = (store[uid] ??= {});
      const days = (mine[kind] ??= {});
      days[dateKey] = Math.max(days[dateKey] ?? 0, atMs);
      // Prune on write: the map only grows by one per manual act, so this
      // keeps it bounded without a separate sweep.
      const floor = atMs - KEEP_MS;
      for (const [k, at] of Object.entries(days)) if (at < floor) delete days[k];
      await AsyncStorage.setItem(KEY, JSON.stringify(store));
    } catch {
      /* Best-effort — see the doc comment. */
    }
  });
}

/** The overrides for one account and kind, `dateKey → epoch ms`. Never throws. */
export async function readManualOverrides(uid: string, kind: OverrideKind): Promise<ManualOverrides> {
  const store = await readStore();
  return store[uid]?.[kind] ?? {};
}
