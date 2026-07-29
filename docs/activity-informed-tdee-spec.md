# Build spec — activity-informed TDEE before measured mode

**Status:** decision-complete, ready to build. Hand off to a `/tdd` session.
**Source of truth:** wayfinder map [#19](https://github.com/gabandres/fitness-tracker-pwa/issues/19) and its ten closed tickets (#20–#30). This file is the *build-ordered* consolidation; when a decision's rationale is needed, follow the ticket link — the reasoning is not repeated here.
**Companion docs (already written):** [`health-active-energy-semantics.md`](./research/health-active-energy-semantics.md) (what the OSes mean by active energy + §5 falsifiable-later list), [`activity-tdee-composition-survey.md`](./research/activity-tdee-composition-survey.md) (competitor survey → Shape A), [`activity-tdee-validation-protocol.md`](./activity-tdee-validation-protocol.md) (the post-ship trip-wire).

---

## 1. What we are building, in one paragraph

Imported Health `activeKcal` **corrects the user's self-reported `profile.activityLevel` bucket** — it never touches `calculateTdee`'s arithmetic. We reduce a trailing window of `activeKcal` to a mean, turn that into an *implied* Mifflin activity multiplier, snap it to one of the five existing `ActivityLevel` buckets, and **suggest** that bucket through the existing Refine Targets path (no new profile field, no rules change). Two surfaces present the suggestion; the user always confirms. The whole new domain surface is one pure `packages/core` module plus mobile glue. `calculateTdee`/`dailyTargets`/the completeness predicate/the rules are **unchanged**.

## 2. Scope fence

**In:** the `seed` and `formula` pre-measured paths, **mobile only** (#30 — a browser can't import from Health; web inherits the corrected bucket via the synced `profile.activityLevel` and gets no new surface).

**Out (do not build):**
- `measured` mode (≥14 days) — energy balance already contains every training calorie; adding `activeKcal` double-counts. Untouched.
- `steps` as an energy input — display-only; selects no branch (#23 §6).
- Any web read of `dailyActivity` (#30). Web's self-reported `activityLevel` selector stays exactly as-is.
- Seed's weight-blind 2450 — a real defect but a *weight* problem, not an activity one (#24). Not in this map.
- The two `health.ts` API-shape bugs from #20 (`saveWorkoutSample` signature; iOS date filter) — fix separately; they don't move the TDEE number.

## 3. The locked model (all constants final)

- **Window:** trailing **28 calendar days `[today − 28, today − 1]`**. Today is excluded unconditionally (#23).
- **Reducer:** plain arithmetic **mean, no trim**; a day counts iff its stored `activeKcal > 0` — `=== 0` is *absence*, excluded from both the mean and the day count (#29). `usableDays` = count of `> 0` days in the window.
- **Gate:** `usableDays >= 21` (four clean weeks minus one; 21/28 makes weekend-blindness arithmetically impossible). Below the gate → return `null`, stay on the self-reported bucket (#23).
- **Implied multiplier:** `impliedMultiplier = (1 + mean/basal) / (1 − TEF_FRACTION)`, **`TEF_FRACTION = 0.10`** (#22 — TEF moves into the denominator; omitting it biases everyone one bucket low).
- **Basal:** Mifflin-St Jeor **unadjusted** (the bare BMR, no activity factor), same basal on both sides of the comparison (#22).
- **Snap:** nearest of the five `ACTIVITY_MULTIPLIERS` buckets (`sedentary 1.2 · light 1.375 · moderate 1.55 · active 1.725 · very_active 1.9`).
- **Deadband (hysteresis):** only re-suggest when the *continuous* implied multiplier differs from the current bucket's multiplier by **`>= 0.175`** (a full bucket; bare `snap()` flips at a 0.0875 midpoint and would flap). **Skipped at seed** (nothing to compare against) (#23/#24).
- **Decline memory:** device-local only, one `ActivityLevel`, most-recent-wins, **no TTL, cleared on accept** (#23/#25).

## 4. Build order (dependency-sorted; TDD each step)

### Step 1 — core refactor: expose the basal (pure, byte-identical `calculateTdee`)
`packages/core/src/tdee.ts`. Today `mifflinStJeor()` (line 134) returns **BMR × multiplier** (misnamed — it's TDEE). Extract the bare BMR into an exported pure fn and rebuild the old behavior on top:

```ts
export function basalMifflinStJeor(
  p: { heightIn: number; age: number; sex: 'male' | 'female' }, weightLbs: number
): number { /* the bmr expression only, no ACTIVITY_MULTIPLIERS */ }

export const ACTIVITY_MULTIPLIERS: Record<ActivityLevel, number> = { /* unchanged, now exported */ };
// mifflinStJeor(profile, w) === basalMifflinStJeor(profile, w) * ACTIVITY_MULTIPLIERS[profile.activityLevel]
```

**Tests:** `calculateTdee` output byte-identical on the existing `tdee.test.ts` fixtures (regression); `basalMifflinStJeor` matches the male `+5` / female `−161` constants for a known input; the identity above holds for all five buckets. `basalMifflinStJeor` takes height+age+sex+weight and **must not require `activityLevel`** (Refine calls it before a bucket exists).

### Step 2 — core: new pure module `packages/core/src/activity-level.ts` (the heart — heaviest TDD)
Export, and add `export * from './activity-level'` to `src/index.ts`:
- `reduceActivityWindow(activeKcals: number[]): { mean: number; usableDays: number }` — `> 0` filter, arithmetic mean (§3).
- `impliedMultiplier(mean: number, basalKcal: number): number` — `(1 + mean/basalKcal) / 0.90`.
- `snapMultiplier(m: number): ActivityLevel` / `deriveActivityLevel(mean, basalKcal): ActivityLevel`.
- `classifyActivityWindow(...): 'none' | 'steps-only' | 'insufficient' | 'sufficient'` — defined now; only `'sufficient'` drives UI this release (steps-only copy deferred to the Coverage fog).
- **Single entry** `suggestActivityLevel({ activeKcals, basalKcal, currentBucket, declinedBucket }): ActivityLevel | null` — folds gate (`usableDays >= 21`) + deadband (`>= 0.175` on the continuous multiplier, **skipped when `currentBucket == null`** i.e. seed) + decline (return `null` if the derived bucket equals `declinedBucket`). Returns `null` = "no suggestion, keep current".

**Tests (this is where TDD earns its keep):** gate boundary 20 vs 21 usable days; `=== 0` days excluded from both mean and count (#29); TEF denominator present (a fixture that would land one bucket low without `/0.90`); deadband holds a bucket at 0.17 delta and flips at 0.18; seed path (`currentBucket=null`) ignores the deadband; declined bucket suppressed; empty/all-zero window → `null`.

### Step 3 — mobile data: `getActivityWindow`
`apps/mobile/src/lib/ledger.ts` (near `subscribeDailyActivity`, ~L270). Add `getActivityWindow(uid, from, to)` — one-shot **bounded `getDocs`** over `[today − 28, today − 1]`, returns the full docs. **Leave `subscribeDailyActivity` untouched** (ADR-0016 — per-surface reads, no shared hook).

### Step 4 — mobile decline memory: `apps/mobile/src/lib/activity-suggestion.ts`
AsyncStorage helpers over key **`ignia.activity.declinedBucket`** (one `ActivityLevel`, most-recent-wins, no TTL, cleared-on-accept). `getDeclinedBucket()` / `setDeclinedBucket(b)` / `clearDeclinedBucket()`.

### Step 5 — mobile surface A: Refine Targets pre-fill
`apps/mobile/src/app/(app)/refine-targets.tsx` (the form already has the five fields; `activity` state at L50). When `profile?.activityLevel` is **absent**, the activity field's default becomes the derived bucket: compute `basalKcal` from **live form values** via `basalMifflinStJeor`, call `suggestActivityLevel({ ..., currentBucket: null })`. **Reactive until touched** — recompute as sex/height/age change; the **first manual tap freezes** it. If the user overrides a non-null pre-fill, **write a decline** (Step 4) so the card won't re-suggest what they just rejected by hand. Disclose with one inline line ("Estimated from your Health activity"). A **stored** `activityLevel` is never swapped underneath a user who came to edit pace.

### Step 6 — mobile surface B: Trends correction card
New card in `apps/mobile/src/app/(app)/trends.tsx`, **under the maintenance hero** (distinct from `RecalibrationCard.tsx`, which is measured-mode only). `currentBucket = profile.activityLevel`; call `suggestActivityLevel` with the trailing window. Render only when it returns non-null. **Tap → Refine Targets pre-filled** on the suggested bucket; **dismiss → write a decline** (Step 4). Fires only when the derived bucket differs from the stored one (the deadband guarantees this).

### Step 7 — kill-switch
One flag gating **both** surfaces (Steps 5 & 6). Default on; when flipped, both fall back to the self-reported `activityLevel` (#26). This is the lever the validation protocol pulls on proof of harm — it must kill the pre-fill *and* the card together.

## 5. Time-sensitive pre-August code touch (do this even before the surfaces)

The importer ships in the August EAS build and has never run on a device. #29 calls for an **Android adapter guard** (`apps/mobile/src/lib/health.ts`, ~1 line): skip writing a day whose `Math.round(value) === 0`, matching iOS's existing empty-drop, so the ~400-day backfill doesn't write hundreds of `0` docs. The reducer (Step 2) is authoritative regardless (`> 0`), but this spares the writes. **Cheaper to land before the build ships than to re-import poisoned history.**

## 6. Web, rules, i18n

- **Web:** no code change. Verify only that `profile.activityLevel` continues to flow into the web Refine Targets selector and `dailyTargets` (it does today).
- **Rules:** `firestore.rules:520` already carries the `dailyActivity` read+write clause (shipped `4a84dc64`). **No rules deploy needed** — the suggestion writes through the existing `activityLevel` profile path. Cover any new nothing here; no new top-level field.
- **i18n:** the disclosure line + card copy need keys in **both** locales, mobile flat shape (`apps/mobile/src/i18n/{en,es-PR}.ts`, `{var}` braces).

## 7. Not a ship gate — the validation trip-wire (post-August)

Do **not** block the build on proof. The correction ships behind the Step-7 kill-switch on the structural argument (#21/#22). [`activity-tdee-validation-protocol.md`](./activity-tdee-validation-protocol.md) runs retrospectively against accruing data (yardstick = `measured` TDEE on a clean `measuredDays >= 56` slope; head-to-head vs `Mifflin × mult[self-reported]` on the differing-bucket population) and flips the switch only on **FAIL** (proof of harm). INCONCLUSIVE stays shipped.

## 8. Known-open, deliberately deferred (not this build)

- **formula → measured discontinuity** — verify during build that `tdee-recalibration.ts` / `RecalibrationCard` does **not** misfire when a bucket correction lands (the correction sharpens the formula number *toward* measured, so the day-13→14 jump should shrink, not grow). This is a build-time *verification*, not a decision; only escalate to a ticket if a real choice appears.
- **Coverage** — who actually has usable `activeKcal` (watch vs bare iPhone). Device-gated; can't be sharpened until the August build produces real data. Steps-only UI copy is parked here.

## Definition of done (build session)

Core: Steps 1–2 with full unit coverage, `calculateTdee` regression-green. Mobile: Steps 3–7 wired, both surfaces confirm-not-silent, decline memory round-trips, kill-switch kills both. Pre-August adapter guard (§5) landed. i18n parity both mobile locales. Web/rules untouched and verified inert. No change to `calculateTdee`, `dailyTargets`, `toProfileFields`, or `firestore.rules`.
