# Photo-scan ships ON and free for everyone in v1 (amends 0015)

## Status

accepted (2026-08-07)

Amends [ADR-0015](0015-macronaut-photo-first-freemium-pivot.md) on **one
point**: who pays for a photo scan. Everything else in 0015 — the split vision
architecture, the Gemini-Flash default, the editable itemized review screen, the
rebrand, the surface area — stands unchanged and is not reopened here.

## Context

0015 made photo scans the paid gate: *"5 lifetime free scans, then Pro (~$29–39/yr)."*
Two things have happened since that make that gate incoherent rather than merely
unenforced.

**1. There is no Pro to gate behind.** `PRO_ENABLED` is `false` on both
platforms and no purchasable product ships. While that is true, `isPaid()` is
forced `true` for everyone, so a client-side paid check unlocks the feature for
the entire free tier — the *opposite* of the intent. The only place the free/paid
distinction survives is the server, which reads the Stripe custom claim directly.
So the choice was never "gate it or not"; it was "gate it on the server, or leave
the whole loop switched off." It was left switched off, and has been since v1.

**2. The cost fear that justified deferring it is off by two orders of
magnitude.** 0015 deferred on recurring AI cost, inheriting the reasoning of
0013. Measured against real billing on 2026-08-04:

| Line | Lifetime spend |
|---|---|
| Secret Manager version storage | **$5.91** |
| Gemini API (all features, all time) | **$0.08** |

A `gemini-2.5-flash` scan costs ~$0.0015. The free tier's 3/day cap is therefore
**~$0.14 per user per month** even for someone who maxes it out every single day,
and the `photo` spend ceiling bounds the worst possible day across all users at
2,000 scans ≈ $3. The dominant cost in this project is *forgotten secret
versions*, not model traffic. Deferring the single strongest acquisition feature
in the category to avoid $0.08 is not cost discipline.

**3. The guards it was waiting for already exist and are already wired.**
`analyzePhoto` has, in order: a 3s per-uid rate limit, the org-wide
`spendCeiling.check("photo")` before the per-user reserve, `dailyQuota.reserve`
(3/day free, 30/day paid), and `spendCeiling.record("photo")` immediately after
the request leaves rather than after it parses. `PHOTO_REQUIRES_PAID` was already
`false` in the deployed function, costed and commented on 2026-08-04. **The
server has been serving this freemium model all along; only the clients were
dark.**

## Decision

**Turn photo-scan on, free, on both platforms, in v1.** Concretely:

- Web `FEATURES.photoScan` → `true`.
- Mobile `FEATURES.photoScan` → a **hardcoded `true`**, replacing the
  `process.env.EXPO_PUBLIC_FEATURE_PHOTO_SCAN !== '0'` read. See "The flag had
  to stop being an env var" below — this is the load-bearing part of the
  decision, not an implementation detail.
- Tiering stays exactly where it is: **server-side**, 3/day free and 30/day paid,
  with the shared spend ceiling as the solvency guard. No client-side entitlement
  check is added, because a client cannot express "paid" while `PRO_ENABLED` is
  false.
- The welcome email's "three ways to log a meal" becomes four and says the
  photo path is free. The test that pinned the *opposite* invariant is inverted,
  not deleted, so copy and gate stay coupled in both directions.

The client flags remain in place as a **kill switch**, not a rollout gate. They
are the client half of an incident response; they are not a cost control and must
never be described as one.

### The flag had to stop being an env var

The obvious change — delete `EXPO_PUBLIC_FEATURE_PHOTO_SCAN=0` from `eas.json` —
was tried first and **reverted**, because `eas.json` is hashed into the EAS
Update **fingerprint**. Measured 2026-08-07:

| State | Android fingerprint | Reaches the shipped binary? |
|---|---|---|
| HEAD | `c0b85c15…` | ✅ (vc 11 / build 24) |
| env key deleted from `eas.json` | `30043793…` | ❌ nobody |
| env read replaced by a hardcoded `true` | `c0b85c15…` | ✅ |

Editing a JS source file does not move the fingerprint; editing `eas.json` does.
So a flag whose value comes from a build profile's `env` block **cannot be
changed without a new binary on both platforms** — and doing that here would have
meant cancelling and resubmitting iOS build 24, which is in App Review, for the
second time in one day.

The generalization is worth more than this feature: **an env-var flag is a
build-gated switch measured in hours; a hardcoded constant is an OTA-gated switch
measured in seconds.** For something whose entire purpose is to be flipped fast
in an incident, the constant is not the compromise — it is the correct design,
and the env var was the bug. Any future kill switch in this app should be a
constant for the same reason.

The now-inert `EXPO_PUBLIC_FEATURE_PHOTO_SCAN: "0"` is deliberately **left in
`eas.json`**: removing it would move the fingerprint for no benefit. It is
flagged in `apps/mobile/src/lib/features.ts` for deletion alongside the next
change that legitimately requires a native build.

## Consequences

- **Positioning sharpens rather than shifts.** 0015 expected to move from
  "free/private tracker" to "free manual + paid AI-photo." That move does not
  happen. Ignia now gives away free the exact feature Cal AI charges $29.99/yr
  for, alongside the barcode, voice logging, coach and fasting timer that
  MyFitnessPal and Cronometer paywall. The wedge in `docs/research/competitive-feature-scan.md`
  §"We give away what they paywall" gains its strongest entry.
- **Ignia is now the only app in the surveyed set shipping both photo-AI *and*
  MacroFactor-style learning TDEE**, which is the combination `UX_AUDIT.md` §S12
  named as the positioning. Until now, half of it was switched off.
- **The spend ceiling becomes genuinely load-bearing**, which is the intended
  design: per-user quotas are a fairness mechanism, the ceiling is the solvency
  one, and a free tier is exactly the condition that makes the second half the
  one that matters. Its sibling kill-switch deliberately does not auto-reset.
- **Accuracy risk is now user-visible**, and 0015's mitigation is what carries
  it: the itemized editable review screen means a wrong estimate is a number the
  user corrects, not a black-box total they must accept. Cal AI's own reviews
  ("8000 cal for popcorn") are the failure mode being mitigated.
- **When Pro launches, this becomes a real decision again.** Flipping
  `PHOTO_REQUIRES_PAID` to `true` in `analyze-photo.ts` is the one-word change
  that reinstates 0015's gate, and the server is the only place it works.
  Re-derive the per-scan cost first if `PHOTO_PROVIDER` has moved to `anthropic`
  (~2.7× Gemini, and no free tier).

## Alternatives considered

- **Keep it off until Pro launches (0015 as written):** rejected — it holds the
  category's #1 install driver hostage to a paid tier with no ship date, for a
  measured $0.08 of lifetime model spend. It also leaves the app's stated
  positioning half-implemented indefinitely.
- **Ship it as 5 lifetime free scans, then a wall (0015's exact terms):**
  rejected — the wall leads nowhere while `PRO_ENABLED` is false. A user who
  hits scan 6 would be shown a purchase surface that does not exist, which is
  worse than either shipping it free or not shipping it.
- **Ship free but drop the daily cap:** rejected — the cap is what makes the
  worst case knowable. 3/day is above real logging behaviour (three meals) and
  bounds abuse without being felt by an honest user.
- **Flip `eas.json` to `"1"`, or delete the key:** rejected — both move the EAS
  Update fingerprint, which turns a seconds-long OTA into a multi-hour build on
  two platforms and an App Review resubmission. See "The flag had to stop being
  an env var". This was the first approach attempted and the measurement is what
  killed it.
