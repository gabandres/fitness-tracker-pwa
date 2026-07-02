/**
 * Profile-secret redaction — the single place that strips bearer secrets from
 * any profile copy that leaves the server-side store.
 *
 * `webhookApiKey` is a long-lived shared secret for the Apple Shortcuts
 * webhook; `fcmToken` binds a device's push channel. Neither is "personal
 * data" in the GDPR Art. 20 sense, and shipping them in a downloadable export
 * or an admin inspector widens their blast radius. Both the GDPR export
 * (`gdpr.ts`) and the admin user-inspector (`admin-ops.ts`) route through
 * here, so a NEW secret field only has to be added to
 * {@link PROFILE_SECRET_FIELDS} once to stay out of both.
 */

/** Profile fields that are secrets, never personal data — stripped from every
 *  outbound profile copy. Extend this when a new secret field is added. */
export const PROFILE_SECRET_FIELDS = ['webhookApiKey', 'fcmToken'] as const;

/**
 * Return a shallow copy of `profile` with every {@link PROFILE_SECRET_FIELDS}
 * entry removed. Null-safe: a null/undefined profile passes through as null so
 * callers can hand it a possibly-missing document's data directly.
 */
export function redactProfileSecrets(
  profile: Record<string, unknown> | null | undefined,
): Record<string, unknown> | null {
  if (!profile) return null;
  const safe: Record<string, unknown> = { ...profile };
  for (const field of PROFILE_SECRET_FIELDS) delete safe[field];
  return safe;
}
