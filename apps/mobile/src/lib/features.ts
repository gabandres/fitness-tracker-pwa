/**
 * Feature flags. The Ignia photo-scan loop (ADR-0015) ships behind a flag
 * so `main` stays releasable while it's built out. Flip `photoScan` to reroute
 * the center tab button from text-add to the camera flow. Env override lets a
 * build turn it on without a code change.
 */
export const FEATURES = {
  /** Meal-photo → macros loop (camera → review → add). On by default; set
   *  EXPO_PUBLIC_FEATURE_PHOTO_SCAN=0 to fall back to the text-add sheet. */
  photoScan: process.env.EXPO_PUBLIC_FEATURE_PHOTO_SCAN !== '0',
} as const;
