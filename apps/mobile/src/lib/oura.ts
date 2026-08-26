import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { doc, getDoc, onSnapshot } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { needsOuraScopeUpgrade, parseOuraDaily } from '@macrolog/core';
import * as WebBrowser from 'expo-web-browser';
import { parseOuraWorkouts } from '@macrolog/core';
import { db, functions } from './firebase';
import { partitionImportable, writeImportedBlocks } from './health-sync';
import {
  getDayBoundaryOnce,
  importDailySleep,
  setDailyActiveEnergy,
  setDailySteps,
} from './ledger';

/**
 * Oura Cloud API — the client half (issue #72, ADR-0026 Amendment 2).
 *
 * ## The division of labour, and why it is where it is
 *
 * - **The credential never comes here.** It lives at
 *   `users/{uid}/private/oura`, which matches no rule in `firestore.rules` and
 *   is denied to every client by the catch-all. That denial IS the access
 *   control, and two rules specs pin it.
 * - **The authorize URL cannot be built here either.** `state` is an HMAC
 *   under a key derived from the client secret, and it carries identity as
 *   well as CSRF — the callback is a bare browser redirect with no Firebase
 *   session on it. So `beginOuraLink` mints it and we open what it returns.
 * - **The fetch runs server-side** (`fetchOuraWorkouts`) for the same reason
 *   the credential does, and returns Oura's records *unparsed*.
 * - **The parsing and the writing happen here**, through `@macrolog/core`'s
 *   `parseOuraWorkouts` and the same `health-sync` write path the OS health
 *   store feeds. One mapper, one set of writes, two roads.
 *
 * ## The status doc is separate from the credential, deliberately
 *
 * `users/{uid}/integrations/oura` holds `{ connected, scope, connectedAt }`:
 * owner-readable, server-written. It is NOT a profile field, because
 * `isValidProfile` is a `hasOnly()` allow-list and a server-written key missing
 * from it does not fail at write time — it breaks every subsequent *client*
 * profile update instead.
 */

/** What the client may know about the link. Mirrors the server-written doc. */
export interface OuraStatus {
  connected: boolean;
  scope?: string;
  connectedAt?: Date;
  /** When the ring was last read, stamped by `fetchOuraWorkouts`. A client
   *  cannot write it — `integrations/{provider}` is `allow write: if false` —
   *  which is also why it is correct across devices rather than per-install. */
  lastSyncedAt?: Date;
  /** How many records came back on that read. Zero is a real answer (a rest
   *  week), and is rendered as such rather than as a failure. */
  lastRecordCount?: number;
}

const statusDoc = (uid: string) => doc(db, `users/${uid}/integrations/oura`);

/**
 * Live "is Oura connected".
 *
 * A snapshot listener rather than a one-shot read, and that is load-bearing:
 * the link completes in a **system browser**, outside this app's process. The
 * app never sees a callback, an event, or a return value — the only thing that
 * changes is a Firestore document the server wrote. So the listener is what
 * turns "the user finished consenting in Safari" into a screen that says
 * Connected, with no polling and no "pull to refresh" the user has to guess at.
 *
 * Focus-gated by the caller, per ADR-0016 — this hook is used from one screen
 * and must not hold a permanent listener.
 */
export function useOuraStatus(uid: string | undefined) {
  const [status, setStatus] = useState<OuraStatus>({ connected: false });
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!uid) {
      setStatus({ connected: false });
      setReady(true);
      return;
    }
    const unsub = onSnapshot(
      statusDoc(uid),
      (snap) => {
        const d = snap.data();
        setStatus({
          connected: d?.['connected'] === true,
          scope: typeof d?.['scope'] === 'string' ? d['scope'] : undefined,
          connectedAt: d?.['connectedAt']?.toDate?.(),
          lastSyncedAt: d?.['lastSyncedAt']?.toDate?.(),
          lastRecordCount:
            typeof d?.['lastRecordCount'] === 'number' ? d['lastRecordCount'] : undefined,
        });
        setReady(true);
      },
      () => {
        // A listener error is not evidence of being disconnected — offline is
        // the common cause. Report "not connected" but say we are ready, so
        // the card renders its connect affordance instead of a spinner that
        // never resolves.
        setStatus({ connected: false });
        setReady(true);
      },
    );
    return unsub;
  }, [uid]);

  return { status, ready };
}

/**
 * "Is Oura linked?", once, with no listener.
 *
 * {@link useOuraStatus} is the live answer and is right for a screen whose job
 * is the integration. This exists for a caller that needs the fact exactly once
 * and must not hold a channel open for it — the Trends sleep card, which uses
 * it only to decide whether its empty row says *connect a source* or *connected
 * to Oura, no nights yet* (ADR-0033 decision 6, ADR-0026's empty-state rule).
 *
 * Resolves `false` on any read failure. The failure direction matters: the
 * wrong answer here understates the integration ("connect Oura") rather than
 * claiming a connection that may not exist.
 */
export async function isOuraConnectedOnce(uid: string): Promise<boolean> {
  if (!uid) return false;
  const snap = await getDoc(statusDoc(uid));
  return snap.data()?.['connected'] === true;
}

/**
 * Start the OAuth flow.
 *
 * Returns `true` only when the browser session ended in a way that could have
 * completed the link. It deliberately does NOT return "connected" — this app
 * cannot know that. The authorization is granted in a browser and recorded by
 * a Cloud Function; the only honest source of truth is the status doc, which
 * {@link useOuraStatus} is already listening to. A caller that treats this
 * boolean as "linked" will show Connected for a user who tapped Cancel.
 */
export async function connectOura(): Promise<boolean> {
  const begin = httpsCallable<Record<string, never>, { url: string; scope: string }>(
    functions,
    'beginOuraLink',
  );
  const { data } = await begin({});
  if (!data?.url) return false;

  // `openAuthSessionAsync`, not `openBrowserAsync`: it is the ephemeral,
  // app-associated session both platforms provide for exactly this flow.
  //
  // **The second argument must be the APP SCHEME, not the https redirect.** iOS
  // `ASWebAuthenticationSession` can only intercept a custom scheme — matching
  // an `https://` URL needs Universal Links, which this app does not configure.
  // Passing the Oura-registered `https://ignia.fit/oura/callback` here meant the
  // session could never match its own redirect, so the browser sat open on the
  // success page and the user had to tap Done. `ouraCallback` now bounces to
  // `ignia://oura/callback` once the token exchange is finished, and THAT is
  // what this matches. Oura's registered redirect URI is unchanged.
  const result = await WebBrowser.openAuthSessionAsync(data.url, 'ignia://oura/callback');
  return result.type === 'success' || result.type === 'dismiss';
}

/**
 * Forget the stored credential.
 *
 * This revokes Ignia's copy, not Oura's grant — the user should also remove
 * the app at cloud.ouraring.com if they want the authorization itself gone,
 * and the UI says so. Deleting our copy is the part we can actually guarantee,
 * and doing it locally means "disconnect" never depends on Oura being up.
 */
export async function disconnectOura(): Promise<void> {
  const unlink = httpsCallable<Record<string, never>, { ok: boolean }>(functions, 'unlinkOura');
  await unlink({});
}

/** What an import attempt did, in terms a UI can render honestly. */
export interface OuraDailyImportResult {
  /** Days for which at least one metric was written. */
  days: number;
  /** True when Oura refused one of the daily collections — the signature of a
   *  grant that predates the `daily` scope. */
  scopeDenied: boolean;
}

export interface OuraImportResult {
  /** Sessions written. Zero is a normal outcome — a rest week. */
  written: number;
  /** The server had no usable credential. The UI must say *reconnect*, not
   *  *try again*: retrying a revoked grant loops forever. */
  linked: boolean;
  /** Records Oura sent that our parser could not read. Non-zero here means
   *  the wire shape is not what `packages/core/src/oura-workouts.ts` believes
   *  — which is the one thing that file admits it cannot verify. */
  skipped: number;
  /** Records that parsed fine and were deliberately NOT imported, because they
   *  are not cardio — Oura's `strengthTraining`, and anything the modality
   *  table places as `other`.
   *
   *  This is NOT a failure and the UI must not present it as one. Importing a
   *  strength session as cardio would duplicate what the user logs in Train by
   *  hand, with no way to tell the copies apart afterwards.
   *
   *  It exists because without it the screen said "no workouts" — the same
   *  words it uses for a ring that recorded nothing — while two real records
   *  were being fetched and correctly declined on every sync. That is #102,
   *  and the bug was the reporting, not the filtering. */
  declined: number;
  /** Oura had more pages than one call is allowed to walk. */
  truncated: boolean;
}

/**
 * Pull workouts from the Oura Cloud API and fold them into Train history.
 *
 * The second transport for the same destination: the records arrive as
 * `HealthWorkout` (via `parseOuraWorkouts`) and go through the exact filter
 * and write path the OS health store feeds. A run that reaches us by both
 * roads is therefore two blocks with two `sourceId`s — kept, not merged, and
 * surfaced to the user by `looksLikeSameEffort`. Silently collapsing them is
 * the merge ADR-0026 decision 4 refuses, because a false positive destroys a
 * real training record.
 *
 * `skipped` is returned rather than swallowed on purpose. A zero-import from a
 * quiet week and a zero-import from twenty unparseable records look identical
 * from the outside and mean completely different things, and only one of them
 * is our bug.
 */
export async function importOuraWorkouts(uid: string): Promise<OuraImportResult> {
  if (!uid) return { written: 0, linked: false, skipped: 0, declined: 0, truncated: false };

  const call = httpsCallable<
    { days?: number },
    { linked: boolean; data: unknown[]; truncated: boolean }
  >(functions, 'fetchOuraWorkouts');
  const { data: res } = await call({});

  if (!res?.linked) return { written: 0, linked: false, skipped: 0, declined: 0, truncated: false };

  const { workouts, skipped } = parseOuraWorkouts({ data: res.data });
  const { blocks, nonCardio } = partitionImportable(workouts);
  const written = await writeImportedBlocks(uid, blocks);
  return { written, linked: true, skipped, declined: nonCardio, truncated: res.truncated === true };
}

/**
 * Import Oura's daily sleep and activity totals into the rows Ignia already
 * keeps (ADR-0026, `daily` scope).
 *
 * These land in exactly the same documents the Apple Health / Health Connect
 * importer writes — `setDailySleep`, `setDailySteps`, `setDailyActiveEnergy` —
 * so a user on either transport, or both, ends up with one number per day
 * rather than two competing ones. **Last writer wins, and that is correct
 * here**: unlike a workout, a daily total is not a record of a distinct event
 * that could be double-counted. Two sources reporting the same day are two
 * measurements of one quantity, and the newer read is the better one.
 *
 * Failures are per-day and non-fatal. One bad write must not abandon the other
 * thirteen days, and a partially imported fortnight is strictly better than an
 * abandoned one.
 */
export async function importOuraDaily(uid: string): Promise<OuraDailyImportResult> {
  if (!uid) return { days: 0, scopeDenied: false };

  const call = httpsCallable<
    { days?: number },
    { linked: boolean; activity: unknown[]; sleep: unknown[]; truncated: boolean; scopeDenied: boolean }
  >(functions, 'fetchOuraDaily');
  const { data: res } = await call({});
  if (!res?.linked) return { days: 0, scopeDenied: false };

  const { rows } = parseOuraDaily(res.activity ?? [], res.sleep ?? []);
  // One profile read for the whole import, not one per night — the sleep guard
  // needs the account's day boundary to know which document could hold the
  // manual twin of a night (#80). Falls back to MIDNIGHT, under which the guard
  // is byte-for-byte what it was before.
  const boundary = await getDayBoundaryOnce(uid);
  let days = 0;
  for (const row of rows) {
    let wrote = false;
    try {
      if (row.sleepHours != null) {
        // Declines when the user typed that night themselves — see
        // `importDailySleep`. A skip is not a failure and is not counted.
        // `wakeMs` is Oura's own `bedtime_end`: it is passed for the guard and
        // is never stored.
        if (
          await importDailySleep(uid, row.dateKey, row.sleepHours, {
            wakeAt: row.wakeMs,
            boundary,
          })
        ) {
          wrote = true;
        }
      }
      if (row.steps != null) {
        await setDailySteps(uid, row.dateKey, row.steps);
        wrote = true;
      }
      if (row.activeKcal != null) {
        await setDailyActiveEnergy(uid, row.dateKey, row.activeKcal);
        wrote = true;
      }
    } catch {
      // Keep going — see the note above.
    }
    if (wrote) days++;
  }
  return { days, scopeDenied: res.scopeDenied === true };
}

/**
 * The Settings card's whole behaviour, in one hook.
 *
 * `busy` covers connect, disconnect and sync together rather than one flag
 * each: they are three buttons on one card and any of them running is a reason
 * the other two should not start. The alternative — a flag per action — is how
 * a double-tap on *Sync now* mid-connect produces two imports of the same run.
 */
export function useOura(uid: string | undefined) {
  const { status, ready } = useOuraStatus(uid);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<OuraImportResult | null>(null);
  const [daily, setDaily] = useState<OuraDailyImportResult | null>(null);
  const [failed, setFailed] = useState(false);

  const connect = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    setFailed(false);
    try {
      await connectOura();
      // Deliberately no optimistic "connected". The status doc is the only
      // thing that knows, and the listener above will say so within a moment.
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }, [busy]);

  const disconnect = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    setFailed(false);
    try {
      await disconnectOura();
      setResult(null);
      setDaily(null);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }, [busy]);

  const syncNow = useCallback(async () => {
    if (busy || !uid) return;
    setBusy(true);
    setFailed(false);
    try {
      // Workouts first: they are the reason the integration exists, and a
      // failure importing daily totals should not cost the user their cardio.
      const workouts = await importOuraWorkouts(uid);
      setResult(workouts);
      if (workouts.linked) {
        try {
          setDaily(await importOuraDaily(uid));
        } catch {
          // Non-fatal — the workout half already landed and is already shown.
        }
      }
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }, [busy, uid]);

  /**
   * True when this user consented under a narrower scope than Ignia now reads.
   *
   * Always false today, because `workout` is the only scope and everybody
   * connected under it — which is exactly why it ships now rather than with the
   * feature that needs it. The day sleep is added, every already-connected user
   * flips to true and gets a reconnect prompt, instead of an empty card and no
   * explanation. See `packages/core/src/oura-scopes.ts`.
   */
  const needsScopeUpgrade = status.connected && needsOuraScopeUpgrade(status.scope);

  return {
    status,
    ready,
    busy,
    result,
    daily,
    failed,
    needsScopeUpgrade,
    connect,
    disconnect,
    syncNow,
  };
}


/**
 * Minimum gap between automatic imports, per app foreground.
 *
 * Oura's data changes a few times a day, not continuously, and a ring's night
 * is finalised once. Re-reading on every single foreground would spend a user's
 * battery and Oura's rate budget to re-fetch what we already have — so the
 * automatic path is throttled and the manual button stays for "I want it now".
 */
const AUTO_IMPORT_MIN_GAP_MS = 60 * 60 * 1000;

/**
 * Import Oura in the background, without anyone tapping anything.
 *
 * **Why this exists.** The first version had one button, and it produced
 * exactly the confusion it should have: a tester connected her ring, tapped
 * Import on the Connected apps screen, was told 15 days had landed, went to
 * Today and saw nothing to connect the two. The data was in Firestore the whole
 * time — an import that needs to be asked for is an import most people will
 * never ask for twice.
 *
 * Mirrors `useHealthAutoImport`, deliberately: same placement in the app
 * layout, same AppState trigger, same "only on the way back IN" rule.
 *
 * Three differences, each because this one crosses the network to a third party
 * rather than reading a local store:
 *
 * - **Throttled** to {@link AUTO_IMPORT_MIN_GAP_MS}, read from the
 *   server-stamped `lastSyncedAt` so the throttle survives a reinstall and is
 *   shared across the user's devices.
 * - **Silent on failure.** An unreachable Oura is not something to interrupt
 *   someone's day with; the Connected apps screen is where that is reported.
 * - **Skipped entirely when the grant is stale.** Re-running an import that
 *   cannot return sleep would refresh `lastSyncedAt` and make a broken link
 *   look healthy. The reconnect notice is the correct surface for that.
 */
export function useOuraAutoImport(uid: string | undefined): void {
  const running = useRef(false);

  useEffect(() => {
    if (!uid) return;

    const run = async (): Promise<void> => {
      if (running.current) return;
      running.current = true;
      try {
        const snap = await getDoc(statusDoc(uid));
        const d = snap.data();
        if (d?.['connected'] !== true) return;
        // A grant that predates a scope cannot import what the app now reads;
        // stamping a fresh sync would disguise that.
        if (needsOuraScopeUpgrade(typeof d['scope'] === 'string' ? d['scope'] : undefined)) return;

        const last = d['lastSyncedAt']?.toDate?.()?.getTime?.() ?? 0;
        if (last && Date.now() - last < AUTO_IMPORT_MIN_GAP_MS) return;

        await importOuraWorkouts(uid);
        await importOuraDaily(uid);
      } catch {
        // Silent by design — see the note above.
      } finally {
        running.current = false;
      }
    };

    void run();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void run();
    });
    return () => sub.remove();
  }, [uid]);
}
