# Validation Protocol: Does the Activity-Informed Estimate Beat the Multiplier?

The falsification test for the wayfinder question (issue #26): **how do we know the activity-informed TDEE estimate actually beats `Mifflin × self-reported multiplier`?** This note locks the *test*, not the *result* — it is a protocol to run *later*, once production activity data exists.

This is a plan-only artifact. It assumes the composition model from [#22](https://github.com/gabandres/fitness-tracker-pwa/issues/22) (activity *corrects* `profile.activityLevel`; the day's arithmetic is untouched), the sufficiency gate from [#23](https://github.com/gabandres/fitness-tracker-pwa/issues/23) (`usableDays ≥ 21` over the trailing-28 window), and the seed/pre-fill mechanism from [#24](https://github.com/gabandres/fitness-tracker-pwa/issues/24).

_Last updated: 2026-07-24. **No production activity data exists yet** — the importer has never run on a device; it ships with the August EAS build. Nothing here can be run until then. The protocol is designed to be **falsifiable later**, not validated now._

> **Premise corrected 2026-08-15.** The line above is preserved as written, but the importer **has shipped and has been running on devices since 1.1.0** (App Store, 2026-08-08) — the release notes for it say so: "Apple Health now imports steps and active energy, and your activity level corrects itself from what you actually did." So "nothing here can be run until then" no longer applies; production activity data plausibly exists now. **What is still true is that this protocol has never been RUN** — nothing in `STATUS.md` tracks it either way. Treat it as pending work with its blocker removed, not as a plan waiting on a build.


---

## Bottom line

- **Ship on the structural argument, validate opportunistically.** The [#21](https://github.com/gabandres/fitness-tracker-pwa/issues/21)/[#22](https://github.com/gabandres/fitness-tracker-pwa/issues/22) reasoning is sound enough to ship the correction behind a **kill-switch**; this protocol is the trip-wire that flips it. Gating the *ship* on validation would mean the feature never ships this cycle (no data for months).
- **The yardstick is `measured` mode.** `measured` TDEE (`avgDailyIntake − weightSlope × 3500`) is a pure energy-balance derivation — the closest thing to a true TDEE the app ever computes — so it is ground truth for a *retrospective* back-test.
- **Head-to-head against the self-reported multiplier.** A pass requires `E_activity` to land closer to ground truth than `E_self` (the status-quo `Mifflin × multiplier[self-reported activityLevel]`). The flat seed is not a baseline — it never surfaces as a target for profiled users ([#24](https://github.com/gabandres/fitness-tracker-pwa/issues/24)).
- **Ground truth must be clean.** A 14-day weight slope is dominated by water/glycogen noise (±several hundred kcal of its own TDEE error), which would swamp a ~50 kcal effect. So `T` is admitted **only when built on ≥56 measured days**. Fewer, slower datapoints; each one trustworthy.
- **Three outcomes, not two.** PASS / INCONCLUSIVE / FAIL, effect-sized. Small n rarely gives a clean pass, so the correction **stays shipped while inconclusive** and is only killed on evidence it is net *worse*.
- **FAIL kills both surfaces.** A single kill-switch disables the correction card **and** the Refine Targets pre-fill; the activity question reverts to an un-defaulted cold pick.

---

## 1. The retrospective back-test

The correction can only be judged where it would actually *fire*. Per [#22](https://github.com/gabandres/fitness-tracker-pwa/issues/22)/[#23](https://github.com/gabandres/fitness-tracker-pwa/issues/23), it fires only when the activity-derived bucket differs from the stored self-reported bucket by more than the full-bucket deadband. Elsewhere `E_activity ≡ E_self` and the comparison is vacuous. So the test population is the **differing-bucket subset**, and everything is computed *retrospectively* at the point a qualifying user crossed into `measured` mode.

### 1.1 Admission criteria (per user)

A user enters the back-test only if **all** hold:

| Criterion | Value | Why |
|---|---|---|
| Measured window | `measuredDays ≥ 56` | Clean weight slope → trustworthy `T`. Divergent from the ≥14 that *engages* measured mode in-app; this is a stricter bar for *validation only*. |
| Activity coverage | `usableActivityDays ≥ 21` in trailing-28 ([#23](https://github.com/gabandres/fitness-tracker-pwa/issues/23)) | The derived bucket must itself be trustworthy. |
| Bucket disagreement | `derivedBucket ≠ selfReportedBucket` (past the deadband) | The only population where the correction changes the number. |

### 1.2 The three numbers, at the pre-measured crossover

- `T` = the user's `measured` TDEE, computed over the ≥56-day slope — **ground truth**.
- `E_self` = `mifflinStJeor(profile, weight) × ACTIVITY_MULTIPLIERS[selfReportedBucket]` — the status-quo baseline.
- `E_activity` = `mifflinStJeor(profile, weight) × ACTIVITY_MULTIPLIERS[derivedBucket]` — the new path.

Same basal on both sides (Mifflin, unadjusted) keeps the comparison apples-to-apples ([#22](https://github.com/gabandres/fitness-tracker-pwa/issues/22)).

### 1.3 Per-user scoring

- `absErr_self     = |E_self − T|`
- `absErr_activity = |E_activity − T|`
- **win** ⟺ `absErr_activity < absErr_self` (the correction moved the estimate closer to ground truth).

---

## 2. The verdict rule

Declared over the pool of admitted (clean-T, differing-bucket) users.

```
Let n = count of admitted users.

FAIL   if  mean(absErr_activity − absErr_self) > 0        # net worse — any n ≥ 3
PASS   if  n ≥ 8  AND  win-rate ≥ ⅔  AND  mean error-reduction ≥ 50 kcal
INCONCL otherwise                                          # includes all n < 8 that aren't FAIL
```

- **Mean error-reduction** = `mean(absErr_self − absErr_activity)` (positive = the correction helps).
- **50 kcal** clears the ≤150 kcal bucket-quantization noise [#22](https://github.com/gabandres/fitness-tracker-pwa/issues/22) accepted, without demanding an implausibly large effect.
- **FAIL trips at n ≥ 3** deliberately — a consistently *worse* estimate is dangerous and shouldn't wait for n=8 to be pulled. A *good* result must clear the higher n=8 bar.
- **INCONCLUSIVE ⇒ stay shipped, keep watching.** The correction is not disabled on absence of proof, only on proof of harm.
- The **owner alone is n=1** once the August build lands and ~400 days backfill (needs ~2 months of continued logging to reach a clean ≥56-day `T`). n=1 is a **directional sanity read only — never a verdict.**

---

## 3. On FAIL — what the spec commits to

FAIL flips **one kill-switch** that disables **both** activity-derived surfaces:

- **Correction card** (re-suggest a bucket for users who already have one) → **OFF**.
- **Refine Targets pre-fill** (default the activity question for users who have none, [#24](https://github.com/gabandres/fitness-tracker-pwa/issues/24)) → **OFF**; the question reverts to an un-defaulted cold pick.

Rationale: the back-test judges the correction card directly, but a FAIL is equally evidence the derived bucket is a poor *default*. There is no honest reason to keep steering the pre-fill toward a bucket the data says is worse. One switch, both surfaces off — the app falls back to self-reported `activityLevel` only, exactly as it behaves today.

A FAIL is a **real result**, not a bug: it means measured active energy does *not* out-predict a user's own self-report for this population, and the correct product response is to trust the human's answer.

---

## 4. Trip-wire, not a gate (summary)

| Stage | Data available | What it produces |
|---|---|---|
| **Ship (August)** | none | Correction ships behind kill-switch on the [#22](https://github.com/gabandres/fitness-tracker-pwa/issues/22) structural argument. |
| **Directional (≈Oct, owner n=1)** | owner ≥56-day `T` | Sanity read. Cannot pass or fail. A net-worse read on n=1 is a prompt to look, not to kill. |
| **Verdict (n ≥ 8)** | 8+ clean-T differing-bucket users | PASS / INCONCLUSIVE / FAIL per §2. FAIL → §3 kill-switch. |

The feature is not gated on this test. It ships, serves users, and this protocol runs quietly against accruing data — falsifying the correction if and only if the evidence says it makes the estimate worse.
