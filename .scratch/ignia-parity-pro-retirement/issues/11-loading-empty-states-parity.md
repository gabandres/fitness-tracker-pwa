# 11 — Loading / empty / error-state parity

Type: task
Status: resolved
Blocked by:

## Question

The page tickets (02–09) verified the *loaded* state of each surface but did not
systematically compare **non-loaded states**: initial loading (spinner vs
skeleton vs hydration gate), empty states (no data), error states (load
failure), and gate/preview states. Audit each surface's non-loaded states
against mobile (source of truth) and fix genuine deltas; skip truly
platform-specific ones (native splash vs PWA splash images, RN ActivityIndicator
vs web boot loader — note these, don't force-fit).

Known delta (from the /wayfinder Q&A): **Trends insight gate** — mobile shows a
skeleton preview of the insight tiles + "keep logging" nudge below the 3-day
gate; web shows plain text "Log at least 3 days…". Reconcile.

Surfaces: Today, Trends, Body, History, Train, Onboarding, Settings. Verify on
localhost, commit + push, deploy.

## Answer

**Changed — shipped `b4156ad9` + `b5c24a5c`, both deployed.** Two real deltas fixed; rest at parity.

1. **Trends empty-insights skeleton (`b4156ad9`).** Below the 3-day gate, mobile shows faded preview tiles (avg intake / avg protein) + a keep-logging nudge; web showed a bare "Log at least 3 days…" sentence. Replaced with skeleton-preview + nudge (`daysLogged`/`weekStart` + `weekLowHint`), i18n from mobile. Verified on localhost.

2. **Branded flame boot loader (`b5c24a5c`).** The boot / "opening account" gate used a generic dual-ring spinner + "Opening your account…" text; mobile shows a branded `BrandLoader` (flickering Flame + rising embers + "Ignia" wordmark). Added `ui-brand-loader` (reuses the sign-in flame SVG + CSS flicker/ember animation, prefers-reduced-motion aware); swapped into both app-shell loading gates; loading text → sr-only, visible brand = wordmark. Verified on localhost (caught the loader mid-boot: flame + Ignia).

**At parity / platform-appropriate (no change):**
- Empty states: Today day-0 hero + repeat-yesterday, Body no-measurements/no-weight, Train no-templates/week-empty — all match mobile.
- Error states: both use `loadErr` text + a retry path (web also has the openingError retry card for profile-load failure).
- History: web already has a loading skeleton (6×7 placeholder grid).
- Per-tab spinner (RN ActivityIndicator) vs web hydration gates, and native splash vs PWA `apple-touch-startup-image` splashes — inherently platform-specific, left as-is.
