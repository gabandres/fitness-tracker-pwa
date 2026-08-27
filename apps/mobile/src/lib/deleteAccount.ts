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
