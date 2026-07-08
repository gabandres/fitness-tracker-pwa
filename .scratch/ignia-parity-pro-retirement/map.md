# Map: Ignia — PWA↔mobile parity + web Pro-retirement

Label: `wayfinder:map`

## Destination

The web PWA (`src/`, Angular 21) matches the mobile app (`apps/mobile`, the **source of truth**) page-by-page — same features, IA, brand/voice (not pixel-identical) — **and** all web Pro apparatus is retired client-side so web mirrors mobile's free/ungated v1. Done = shipped to `ignia.fit`, not merely spec'd.

## Notes

**Mode override:** this is an **execute** map, NOT plan-only. Each ticket decides *and makes* the change. DoD per ticket: read mobile screen for behavior/IA/brand → align web component → verify on `localhost:4200` (Playwright, mobile viewport ~402px; local `ng serve` auto-logs-in as gabilon2011) → **commit + push**. Deployment is deferred to ticket 10 (single batch deploy) to avoid repeated service-worker update-banner churn.

**Source of truth = mobile.** Mobile screens live in `apps/mobile/src/app/(app)/` (+ `onboarding.tsx`, `sign-in.tsx`). Parity means match mobile's behavior/IA/brand; where they differ, web changes to match mobile unless a per-page editorial exception is noted (landing keeps some editorial voice — out of the per-page audit, it's a marketing page). Mobile is the endgame; **no mobile-port tickets** — this map only moves web toward mobile. If an audit reveals a bug that should be fixed in *both*, note it but don't expand scope here.

**Web page ↔ component map** (routes are inline/lazy; use this instead of grepping `path:`):
Today→`components/today/` · Train→`train/` · Trends→`trends/` · Body→`body/` · History→`history/`+`day-detail/` · Settings→`settings-sheet/` · Onboarding→`onboarding/` · Refine-targets→`refine-targets-sheet/` · Coach→`consultation/` · Scan→`photo-capture/`+`barcode-scanner/`. Shell = `src/app/app.ts`.

**Skills to consult:** `run` (drive PWA), Playwright MCP (screenshot compare, mobile viewport — already wired), `frontend-design` (on-brand reshaping), `code-review` (after sweep — missed `isPro`/dead strings). Update memory `project_ignia_publishing.md` as work lands.

**Key gotchas:** verify on localhost not prod (SW banner). i18n parity: web `src/app/i18n/{en,es-PR}.json` (2-space) — keep both locales in sync. **Single Firebase SDK copy rule** — never import plain `firebase/firestore` in app-bundle code. Typecheck: web validated by prod build (AOT). Microsoft sign-in is a permanent dead-end — don't re-chase.

**References:** handoff `%TEMP%\handoff-ignia-parity-pro-retirement.md`; `CLAUDE.md`; ADR-0015 (free/photo-scan pivot); memory `feedback_mobile_is_endgame`, `project_ignia_publishing.md`.

## Decisions so far

<!-- one line per resolved ticket: gist + link -->

- [01 — Retire web Pro apparatus](issues/01-retire-web-pro-apparatus.md) — shipped `a7f79454` (deployed live): mirror mobile's two-flag model — added web `PRO_ENABLED=false`, `isPaid()` forced true (ungates themes/limits/streak-freeze), Trends Pro weekly AI report **hidden** (cost-averse, matches mobile — not exposed to all); deleted /subscribe + upsell-card + membership-section + UpsellService; dead i18n dropped.
- [02 — Today parity](issues/02-today-parity.md) — audited, **already at parity**, no change: header/rings/metrics(Fasting→Water→Sleep)/day-0 all match; web's extra nudges are web-only.
- [03 — Train parity](issues/03-train-parity.md) — audited, **already at parity**, no change: same IA (week hero → start → templates → history); web feature-set is a superset; mobile UX batch was native-only polish.
- [05 — Body parity](issues/05-body-parity.md) — audited, **already at parity**, no change: weight+sparkline+goal bar, Navy body-fat, collapsible measurements all match; no progress photos on either (v1 privacy).
- [06 — History parity](issues/06-history-parity.md) — audited, **already at parity**, no change: both = month calendar grid (dots + today) + Recent list + day-detail; mobile calendar built from hardcoded weekdays so keys differ but structure matches.
- [04 — Trends parity](issues/04-trends-parity.md) — shipped `aa19b833`: **added maintenance/TDEE hero** (was missing on web, mobile foregrounds it); coach kept inline (platform-appropriate); report dead-branches kept (correct for Pro re-enable).
- [07 — Settings parity](issues/07-settings-parity.md) — shipped `42f59d4b`: **added Ko-fi "Support the app" card** (was landing-only); public-profile kept dropped (matches mobile); rest at parity. Minor: mobile has finer unit sub-toggles web lacks (noted).
- [08 — Onboarding + Refine parity](issues/08-onboarding-refine-parity.md) — audited, **at functional parity**, no change: refine = superset; onboarding collects same data; minor cosmetic deltas (mobile welcome intro + step order) noted, not force-fit.
- [09 — Coach + Scan parity](issues/09-coach-scan-parity.md) — shipped `77f64453`: **photo-scan gated OFF on web** (utils/features.ts, matches mobile prod & ADR-0015 defer); coach at parity (inline vs screen; remaining-quota counter shown → no silent wall).
- [10 — Deploy](issues/10-deploy.md) — **DONE**: prod build + firebase deploy (hosting[macrolog]) x2; TDEE hero confirmed live on ignia.fit/trends. **Effort complete.**

## Not yet specified

- A page audit may surface a delta large enough to graduate into its own ticket (a new/missing component, a shared bug). Split it out when it appears rather than cramming it into the page ticket.

## Out of scope

- **Server-side Pro/referral apparatus** — `firestore-stripe-payments` Stripe extension (`firebase.json`), referral Cloud Functions, Profile fields `referredBy`/`compedUntil`. Dormant, no user-facing surface; removing touches prod infra + Secret Manager versions. Left in place; revisit only as a separate effort.
- **Landing page** (`components/landing/`) — marketing surface, intentionally keeps editorial voice; not part of the app page-by-page parity audit.
