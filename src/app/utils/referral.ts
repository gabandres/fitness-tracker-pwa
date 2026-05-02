/**
 * Referral capture. When a visitor lands on any public surface with
 * `?ref=<uid>` we stash the referrer's uid in localStorage; the next
 * profile-create writes it as `referredBy`. Survives the entire
 * sign-up funnel — landing → /calculator → /app → email-verify →
 * onboarding — without needing to thread the param through routes.
 *
 * localStorage (not sessionStorage) so a user who bookmarks a friend's
 * link, closes the tab, and comes back the next day still attributes.
 * The latch is cleared the moment the profile is created so a future
 * different account on the same browser doesn't inherit a stale ref.
 */

const KEY = 'macrolog.referrer-uid';

/** Firebase Auth uids are 28-char base64url strings. Loose validation
 *  catches obvious garbage / SSRF-ish nonsense from the URL bar without
 *  pretending we're authenticating the value — the server still needs
 *  to confirm the referrer exists before granting any reward. */
function looksLikeUid(s: string): boolean {
  return /^[A-Za-z0-9_-]{20,40}$/.test(s);
}

/** Read `?ref=<uid>` from the current URL and stash for later. No-op
 *  if the param is missing or malformed. Idempotent — safe to call on
 *  every route mount. Preserves an already-stored ref if a fresh visit
 *  doesn't carry the param (so the user clicking around the site
 *  doesn't lose the attribution). */
export function captureReferrerFromUrl(): void {
  if (typeof window === 'undefined') return;
  try {
    const ref = new URL(window.location.href).searchParams.get('ref');
    if (!ref || !looksLikeUid(ref)) return;
    localStorage.setItem(KEY, ref);
  } catch { /* ignore */ }
}

/** Returns the stashed referrer uid (without clearing it). */
export function readReferrer(): string | null {
  if (typeof localStorage === 'undefined') return null;
  try { return localStorage.getItem(KEY); } catch { return null; }
}

/** Clear the latch — called once the referrer is written to a profile
 *  doc, so a different user on this device gets no inherited ref. */
export function clearReferrer(): void {
  if (typeof localStorage === 'undefined') return;
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}

/** Build the share URL the user copies / sends to their friends. The
 *  landing page is the right entry point — it shows the pitch, the
 *  /calculator link, the pricing, and threads the ref through the
 *  whole funnel. */
export function buildReferralLink(myUid: string): string {
  return `https://macrolog.web.app/?ref=${encodeURIComponent(myUid)}`;
}
