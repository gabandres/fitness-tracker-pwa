/**
 * Feature flags — the web mirror of `apps/mobile/src/lib/features.ts`.
 *
 * The Ignia photo-scan loop (meal photo → macros) is **ON, free for everyone,
 * on both platforms** as of 2026-08-07 (ADR-0017, which reverses ADR-0015's
 * paid gate). Mobile turns it on by *absence* — its flag defaults on and
 * `eas.json` no longer sets `EXPO_PUBLIC_FEATURE_PHOTO_SCAN=0` — so the two
 * platforms agree without sharing a mechanism.
 *
 * This flag is a kill switch, not a rollout gate: the tiering that matters is
 * server-side (`dailyQuota` 3/day free, and the `photo` `spendCeiling`), so
 * flipping this to `false` is the client half of an incident response, not a
 * cost control. The cost control cannot be bypassed by a client at all, which
 * is the whole reason it lives in `functions/src/analyze-photo.ts`.
 */
export const FEATURES = {
  /** Meal-photo → macros loop. On, free, both platforms (ADR-0017). */
  photoScan: true,
} as const;
