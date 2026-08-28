/**
 * Pure predicates over the errors the OS health stores throw.
 *
 * A separate module with NO imports, and that is the whole reason it exists:
 * `health-sync.ts` reaches Firestore through `ledger.ts`, so `jest.setup.js`
 * mocks it globally and a test cannot reach past that mock without pulling
 * Firebase's ESM build through a transform that does not handle it. A pure
 * predicate that decides whether a real user sees a crash report deserves a
 * seam it can actually be tested through.
 */

/**
 * HealthKit states the auto-import cannot act on and must not report.
 *
 * Code=6 is a LOCKED device — the store is encrypted until first unlock.
 *
 * Code=5 is "Authorization not determined", added 2026-08-27 from
 * IGNIA-MOBILE-H on release 1.2.1 / build 60, the live App Store binary. It
 * means the local `connected` flag says yes while iOS holds no grant, which is
 * what a reinstall, a restore from backup, or a revoke in Settings -> Privacy
 * -> Health leaves behind: AsyncStorage survives, the HealthKit grant does not.
 *
 * Both are expected OS states rather than defects, and NEITHER is actionable
 * from a background import that fires on every foreground — so re-throwing
 * turns an unremarkable device condition into an unhandled rejection that
 * Sentry reports exactly like a crash. `useHealthSync`'s foreground *Sync now*
 * path still surfaces failures to the user, which is where a person can
 * actually do something about it.
 *
 * DELIBERATELY NOT DONE HERE: flipping `connected` back to false on a Code=5.
 * It is tempting — the user believes Health is connected and it is not — but a
 * transient "not determined" during a restore would then silently disconnect a
 * working account, and this function runs on every single foreground. Offering
 * a reconnect is a UI decision, not a catch-block one.
 */
export function isExpectedHealthState(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err ?? '');
  return msg.includes('Protected health data is inaccessible')
    || msg.includes('com.apple.healthkit Code=6')
    || msg.includes('com.apple.healthkit Code=5')
    || msg.includes('Authorization not determined');
}
