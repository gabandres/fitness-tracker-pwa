/**
 * Feature flags. The Ignia photo-scan loop ships behind a flag so `main` stays
 * releasable while it's built out. `photoScan` reroutes the center tab button
 * from text-add to the camera flow.
 *
 * **`photoScan` is ON in production as of 2026-08-07** (ADR-0017, amending
 * ADR-0015's paid gate).
 *
 * **It is a hardcoded `true`, and that is deliberate — do not "restore" the
 * `process.env.EXPO_PUBLIC_FEATURE_PHOTO_SCAN` read it replaced.** `eas.json`
 * is hashed into the EAS Update **fingerprint**, so a flag driven by a build
 * profile's `env` block cannot be changed without changing the runtime version
 * — measured 2026-08-07: deleting that key moved the Android fingerprint from
 * `c0b85c15…` to `30043793…`, which would have stranded the update on a
 * runtime no installed binary is running. An env-var flag is therefore a
 * *build-gated* switch that takes hours; a hardcoded constant is an
 * OTA-gated one that takes seconds. For a kill switch, seconds is the whole
 * point.
 *
 * **`eas.json` still carries a now-inert `EXPO_PUBLIC_FEATURE_PHOTO_SCAN: "0"`
 * in its `production` and `preview` profiles.** Nothing reads it. It is left
 * there ONLY because removing it would change the fingerprint for no benefit;
 * delete it in the same commit as the next change that legitimately requires a
 * native build, and delete this paragraph with it.
 *
 * Turning photo-scan off is a client-side kill switch only. The per-user cap
 * (3/day free) and the org-wide `photo` spend ceiling live in
 * `functions/src/analyze-photo.ts` and cannot be bypassed from here.
 */
export const FEATURES = {
  /** Meal-photo → macros loop (camera → review → add). ON and free for
   *  everyone (ADR-0017). Flip to `false` and `eas update` to kill it. */
  photoScan: true,
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
