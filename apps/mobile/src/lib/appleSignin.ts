// Sign in with Apple token capture. After a successful Apple sign-in the client
// hands Apple's one-time authorization code to a Cloud Function, which exchanges
// it for a refresh token and stores it so account deletion can revoke the Apple
// token (App Review 5.1.1(v)). Fire-and-forget: a failure here only means we
// can't revoke on deletion — it must never block sign-in.

import { httpsCallable } from 'firebase/functions';
import { functions } from '@/lib/firebase';

export async function registerAppleRefreshToken(authorizationCode: string): Promise<void> {
  const call = httpsCallable<{ authorizationCode: string }, { ok: boolean }>(
    functions,
    'registerAppleRefreshToken',
  );
  await call({ authorizationCode });
}
