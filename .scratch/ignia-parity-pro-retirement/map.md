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

- [01 — Retire web Pro apparatus](issues/01-retire-web-pro-apparatus.md) — shipped `a7f79454`: mirror mobile's two-flag model — added web `PRO_ENABLED=false`, `isPaid()` forced true (ungates themes/limits/streak-freeze), Trends Pro weekly AI report **hidden** (cost-averse, matches mobile — not exposed to all); deleted /subscribe + upsell-card + membership-section + UpsellService; dead i18n dropped.

## Not yet specified

- A page audit may surface a delta large enough to graduate into its own ticket (a new/missing component, a shared bug). Split it out when it appears rather than cramming it into the page ticket.

## Out of scope

- **Server-side Pro/referral apparatus** — `firestore-stripe-payments` Stripe extension (`firebase.json`), referral Cloud Functions, Profile fields `referredBy`/`compedUntil`. Dormant, no user-facing surface; removing touches prod infra + Secret Manager versions. Left in place; revisit only as a separate effort.
- **Landing page** (`components/landing/`) — marketing surface, intentionally keeps editorial voice; not part of the app page-by-page parity audit.
