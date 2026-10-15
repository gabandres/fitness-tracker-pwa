// In-app account deletion. Apple 5.1.1(v) requires an account-deletion flow
// that is initiated and completed INSIDE the app — linking out to a web page
// does not satisfy it, which is what mobile Settings used to do.
//
// This calls the same `deleteAccount` callable the PWA uses (functions/src/
// gdpr.ts): it cascades every subcollection, purges progress-photo bytes from
// Storage, deletes the profile doc, then deletes the Firebase Auth user.

import { httpsCallable } from 'firebase/functions';
import { functions } from '@/lib/firebase';
import { clearStoredSession } from '@/lib/session-restore';

/** Deleting the Auth user invalidates the ID token, so the callable can report
 *  success while the client is already unauthenticated. Callers should treat a
 *  resolved promise as "deleted" and sign out locally regardless. */
export async function deleteAccountForever(): Promise<void> {
  const call = httpsCallable<Record<string, never>, { success: boolean }>(functions, 'deleteAccount');
  await call({});
  // Also drop the Block Store copy of the session (#107). The sign-out path
  // already does this and callers are told to sign out, but a refresh token for
  // a deleted account sitting in Google's cloud backup is exactly the kind of
  // residue #99 is about — and it costs one call to be sure rather than to rely
  // on every caller remembering.
  await clearStoredSession();
}

/**
 * Whether a failed deletion left this device holding a session that can no
 * longer act for the account: the Auth user is gone (the callable did its job
 * and only the RESPONSE was lost, or an earlier attempt half-finished) or the
 * token cannot be refreshed. Staying "signed in" then is a dead end — every
 * write and every retry fails — so the only useful move is to sign out.
 *
 * Any other failure (`internal` from the callable, a network error) means the
 * account is still there and the user is still signed into it, so they get
 * the error and can try again.
 */
export function isDeadSessionError(e: unknown): boolean {
  const code = String((e as { code?: unknown } | null)?.code ?? '');
  return (
    code.includes('user-token-expired') ||
    code.includes('user-not-found') ||
    code.includes('user-disabled') ||
    code.includes('unauthenticated')
  );
  // NOT `functions/not-found`: from a callable that is a 404 — the function
  // is missing or misrouted — and says nothing about the session. The account
  // is intact then, and signing out would let the user believe it was deleted.
}

/** What `runAccountDeletion` needs from the auth layer — injected so the
 *  sequence is testable without a Firebase session. */
export interface AccountDeletionSteps {
  /** Raise the "deleting" state and stop analytics BEFORE the server erases
   *  anything: the gate must not read the vanished profile as a new account,
   *  and nothing may be counted against an erased uid. */
  begin: () => void;
  /** The server-side erasure (`deleteAccountForever`). */
  erase: () => Promise<void>;
  /** The full local sign-out, analytics discarded rather than flushed. */
  signOut: () => Promise<void>;
  /** Last resort when the full sign-out throws part-way: drop the Firebase
   *  session itself, so a deleted account can never stay "signed in". */
  forceSignOut: () => Promise<void>;
  /** Deletion did not happen: lower the state and re-bind analytics. */
  abort: () => void;
}

/**
 * Delete the account, then sign out — in the order that leaves no window for
 * the routing gate or analytics to act on a half-deleted account (audit
 * 2026-10-15). Resolves `'deleted'`, or `'signed-out'` when the deletion
 * failed in a way that killed the session anyway; rejects only when the
 * account is still there and the user is still signed into it.
 */
export async function runAccountDeletion(steps: AccountDeletionSteps): Promise<'deleted' | 'signed-out'> {
  steps.begin();
  let outcome: 'deleted' | 'signed-out' = 'deleted';
  try {
    await steps.erase();
  } catch (e) {
    if (!isDeadSessionError(e)) {
      steps.abort();
      throw e;
    }
    outcome = 'signed-out';
  }
  try {
    await steps.signOut();
  } catch {
    await steps.forceSignOut().catch(() => {});
  }
  return outcome;
}
