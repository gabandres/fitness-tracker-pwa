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
  /**
   * Activity-informed activity-level correction: imported Health activeKcal
   * suggests a better `profile.activityLevel` bucket (docs/activity-informed-
   * tdee-spec.md). ONE flag gates BOTH surfaces — the Refine Targets pre-fill
   * and the Trends correction card — so flipping it falls the whole feature
   * back to the self-reported bucket. This is the lever the validation
   * protocol pulls on proof of harm; it must kill both together or the
   * protocol can't be honoured. Set EXPO_PUBLIC_FEATURE_ACTIVITY_TDEE=0.
   */
  activityTdee: process.env.EXPO_PUBLIC_FEATURE_ACTIVITY_TDEE !== '0',
} as const;
