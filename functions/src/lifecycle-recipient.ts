/**
 * Who may receive LIFECYCLE mail (welcome, day-1 nudge, weekly digest): the
 * Firebase Auth record's address, and only when that record is verified and
 * enabled. Returns the address, or null to skip.
 *
 * The address comes from the Auth RECORD, never the client-writable profile
 * (2026-10-15 audit: a profile `email` field let a user aim this mail at any
 * inbox). The `emailVerified` half became load-bearing on 2026-11-19: until
 * then no unverified account could own a profile, so every profile-driven
 * sender could assume it. Since the owner relaxed the wall that day
 * (firestore.rules `isOwnerWriter`) an unverified account can complete
 * onboarding and log — and an unverified address is one nobody has proved
 * they control, so mailing it is mailing a stranger on someone's say-so.
 *
 * Not used by `sendVerificationEmail` (verify-email.ts), which exists to mail
 * unverified addresses, nor by `onFeedbackCreated`, which mails the owner.
 */
export interface LifecycleAuthUser {
  email?: string | null;
  emailVerified?: boolean;
  disabled?: boolean;
}

export function lifecycleRecipient(user: LifecycleAuthUser | null | undefined): string | null {
  if (!user || !user.email || user.emailVerified !== true || user.disabled) return null;
  return user.email;
}
