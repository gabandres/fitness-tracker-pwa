import { useCallback, useEffect, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { needsOuraScopeUpgrade } from '@macrolog/core';
import * as WebBrowser from 'expo-web-browser';
import { parseOuraWorkouts } from '@macrolog/core';
import { db, functions } from './firebase';
import { toImportableBlocks, writeImportedBlocks } from './health-sync';

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
  // app-associated session both platforms provide for exactly this flow, and
  // it closes itself when the redirect lands rather than leaving the user on
  // a success page wondering how to get back.
  const result = await WebBrowser.openAuthSessionAsync(data.url, 'https://ignia.fit/oura/callback');
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
  if (!uid) return { written: 0, linked: false, skipped: 0, truncated: false };

  const call = httpsCallable<
    { days?: number },
    { linked: boolean; data: unknown[]; truncated: boolean }
  >(functions, 'fetchOuraWorkouts');
  const { data: res } = await call({});

  if (!res?.linked) return { written: 0, linked: false, skipped: 0, truncated: false };

  const { workouts, skipped } = parseOuraWorkouts({ data: res.data });
  const written = await writeImportedBlocks(uid, toImportableBlocks(workouts));
  return { written, linked: true, skipped, truncated: res.truncated === true };
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
      setResult(await importOuraWorkouts(uid));
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
    failed,
    needsScopeUpgrade,
    connect,
    disconnect,
    syncNow,
  };
}
