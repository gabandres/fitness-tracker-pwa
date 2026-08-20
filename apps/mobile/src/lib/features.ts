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
   * The activity-correction card in **measured** mode, plus the evidence line
   * that shows the window behind a suggestion. **OFF, and it must stay off
   * until the activity multiplier is continuous.**
   *
   * ## Why a second flag rather than widening `activityTdee`
   *
   * `activityTdee` gates a feature that is shipped and correct for its cohort.
   * The Trends card is deliberately `enabled: tdee.source !== 'measured'`,
   * because until 2026-08-19 the activity bucket did not enter measured mode at
   * all — energy balance already contains every training calorie, so folding
   * activity in would double-count it (`docs/activity-informed-tdee-spec.md`).
   *
   * **That stopped being true the same day.** `measuredConfidence` blends a
   * thin measured estimate toward the Mifflin × activity anchor, so the bucket
   * now moves the number for measured-mode users — and they are exactly the
   * users the card is hidden from. This flag is the fix, and it is dark on
   * purpose.
   *
   * ## Why it is dark
   *
   * Measured on the owner's account 2026-08-19, from 28 of 28 usable days of
   * real Health data: mean activeKcal 246/day over a bare Mifflin basal of
   * 1,632 gives an implied multiplier of 1.278, which the five-bucket ladder
   * snaps to SEDENTARY (anchor 1,958). The account's own 97-day energy balance
   * says 2,385. So the suggestion this card would show is **17.9% low — worse
   * than the `moderate` already stored**, which is 6.0% high.
   *
   * Two causes, both real: the ladder cannot express 1.278 (its rungs are
   * 0.175 apart, ±285 kcal on this account), and Apple's `activeKcal`
   * understates NEAT, so the implied multiplier is biased low before it is
   * even snapped. A visible recommendation that degrades the estimate is worse
   * than no recommendation.
   *
   * **Unflag only when the continuous multiplier lands and the anchor sits
   * BELOW the measured value for this account** — that is the acceptance test,
   * because it is what makes `d(damped)/dc` positive, i.e. better logging
   * finally raising the estimate instead of lowering it. Hardcoded, so
   * flipping it is an OTA and not a build (see `photoScan` above).
   */
  activityTdeeInMeasured: false,
} as const;
