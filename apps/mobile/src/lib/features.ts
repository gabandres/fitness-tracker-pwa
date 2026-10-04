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
 * The inert `EXPO_PUBLIC_FEATURE_PHOTO_SCAN: "0"` that used to sit in
 * `eas.json`'s `production` and `preview` profiles was **deleted 2026-08-08**,
 * riding along with the App Shortcuts fix that needed a native build anyway —
 * exactly the moment this comment used to reserve for it.
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
   * Tip jar (iOS IAP TipSheet + Android Ko-fi link). OFF 2026-08-19: all
   * donation intake is paused until the app's operations transfer to
   * Bermudez Systems LLC — no revenue may reach the owner personally while
   * they remain a PR resident. Hardcoded (OTA-gated) for the same reason as
   * `photoScan` above. Re-enable only once payouts land in the LLC's bank
   * account. The ASC consumables (`fit.ignia.tip.*`) are deactivated
   * server-side too; flipping this back on requires reactivating those.
   */
  tips: false,
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
  /**
   * Composition-adjusted maintenance + the recomp signal card on Trends, and
   * the measured body-fat % field on Body (ADR-0043). `'admin'` = ON for the
   * owner's account only (the `admin` custom claim), OFF for everyone else;
   * `true`/`false` turn it on/off for all. Display-only — nothing behind it
   * feeds the calorie target. Hardcoded (OTA-gated), like `photoScan`.
   * The body-fat field writes `bodyFatPct`/`bodyFatMethod`, so
   * `firestore:rules` must be deployed before this reaches anyone.
   */
  compositionMaintenance: 'admin',
  /**
   * The Forbes prior (ADR-0043 §Forbes): price scale change at the Forbes
   * FM/FFM split when there is no composition data. OFF — it comes from
   * non-training cohorts and overstates lean loss for a lifter. Computed in
   * core (`forbesMaintenance`), surfaced nowhere while this is false.
   */
  forbesPrior: false,
} as const;

/** A flag's rollout: everyone, no one, or the admin account only. */
export type FeatureRollout = boolean | 'admin';

/** Whether a rollout flag is on for this user. */
export function isFeatureOn(rollout: FeatureRollout, who: { isAdmin?: boolean }): boolean {
  return rollout === 'admin' ? who.isAdmin === true : rollout;
}
