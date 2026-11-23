---
paths:
  - "apps/mobile/**"
  - "packages/core/**"
  - "functions/src/**"
---

# The mobile app: data layer, theming, Pro flags

## Data layer (`apps/mobile`)

The Expo app talks to Firestore through the Firebase JS SDK directly in `apps/mobile/src/lib/ledger.ts` — a flat file
of thin `subscribe*` (onSnapshot) + async CRUD functions. **Its doc shapes are now the only client implementation**;
`firestore.rules` and `CONTEXT.md` document them.

State is **per-tab hooks** (`useToday`, `useHistory`, `useBody`, `useTrain`); each hook independently
`onSnapshot`-subscribes, so the same collection (e.g. `presets`, `customFoods`) is **deliberately subscribed in
multiple hooks** rather than shared through one context — match this precedent, don't extract a lone shared hook
(**ADR-0016**; listeners are wrapped in `trackSubs` and never outlive their screen). **Since 2026-10-22 a blur closes
nothing**: a `'focus'`-gated feed opens on the screen's first focus and holds its listeners until unmount, because
re-opening a tab's set on every visit was the measured tab-switch lag, 120–350 ms of frozen JS per press — ADR-0016
amendment 2. Do not re-propose a shared subscription cache; the concurrent multiplier it targets doesn't exist and the
model is intentional.

**Since 2026-09-14 the gating/provenance/readiness glue is stated once in `hooks/useLedgerFeed.ts`** — a hook passes
its own channels and still opens its own `subscribe*` inside each one, so the listener model is unchanged (ADR-0016
amendment); new reading hooks go through it rather than re-rolling the `useFocusEffect` + `trackSubs` block. Its
write-side counterpart is `lib/ledger-ops.ts`, where a **ledger operation** (`finishWorkout`, `repeatYesterday`,
`writeDailyMetric`) is the multi-step sequence a screen used to assemble — it sits ABOVE `ledger.ts` because
`health-sync.ts` and `pending-logs.ts` already import it.

## Theming (ADR-0014)

The Expo app is dual-theme, dark leads. Components read the palette via `useTheme()`/`useThemedStyles()` from
`src/lib/theme-context` — never a static `colors` import from `theme.ts` (those exports are gone; `ShareCard` pins
`palettes.light` on purpose). Text on `colors.ink` surfaces uses `colors.onInk`; text and icons on an `accent` /
`danger` / `tealSolid` fill use `colors.onFill` (dark in dark mode — white there fails AA; `theme-contrast.test.ts`);
field/chip fills use `colors.inputBg`. Custom font families (`type.display/heading`) must not be paired with
`fontWeight`. The app uses StyleSheet, NOT NativeWind (a tailwind v3/v4 monorepo conflict, ADR-0012).

## Pro and feature flags (v1 is free)

Pro/deferred features are gated OFF via flags, not deleted (kept for a later re-enable). No purchasable product ships.
The flags live on mobile only: `PRO_ENABLED` in `apps/mobile/src/lib/subscription.ts` (when false, `isPro()` is forced
`true` so non-cost perks — themes, higher limits, streak-freeze — unlock for everyone) and `FEATURES` in
`apps/mobile/src/lib/features.ts`.

**Two distinct flags**: `isPro`-gated code = non-cost perks (unlocked in v1); `PRO_ENABLED`/`FEATURES`-gated code =
purchase surfaces + AI-cost features (weekly report) — these stay **hidden**.

**Photo-scan is the exception and is ON and free** (ADR-0017, amending 0015's paid gate): `FEATURES.photoScan = true`
is hardcoded in `apps/mobile/src/lib/features.ts` — no env read. Its tiering is **server-side only** (`dailyQuota`
3/day free · 30/day paid, plus the `photo` `spendCeiling`) because a client cannot express "paid" while `PRO_ENABLED`
is false — a client-side paid check there unlocks it for everyone, the opposite of the intent. The client flag is a
kill switch, not a cost control.

**The Stripe extension was REMOVED 2026-08-31** (owner's call: if subscriptions ever ship they go through Apple/Google
IAP, not Stripe) — its two secrets went with it, putting Secret Manager exactly at the free tier. The `stripeRole`
custom claim SURVIVES as the paid-tier marker (set manually via the admin console; read by `caller-access.ts` for quota
tiering) — the name is historical. Referral CFs remain dormant.
