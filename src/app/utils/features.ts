/**
 * Feature flags — the web mirror of `apps/mobile/src/lib/features.ts`.
 *
 * The Ignia photo-scan loop (meal photo → macros, ADR-0015) is deferred to
 * v1.1. It is OFF in the shipped app on BOTH platforms — mobile sets
 * `EXPO_PUBLIC_FEATURE_PHOTO_SCAN=0` in its prod (eas) build; web pins it off
 * here. The photo-capture code stays in the bundle (gate, don't delete) so
 * flipping this to `true` re-enables the Photo entry segment when the loop
 * ships.
 */
export const FEATURES = {
  /** Meal-photo → macros loop. Off for v1 (parity with mobile prod). */
  photoScan: false,
} as const;
