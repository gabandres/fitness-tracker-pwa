---
paths:
  - "src/**"
  - "public/**"
  - "scripts/prerender-seo.mjs"
  - "functions/src/admin*"
  - "firebase.json"
---

# The web shell (Angular, `src/`) — what is left after ADR-0036

**The web logging app was retired 2026-08-30 (ADR-0036; frozen from ADR-0022 until then)** — Today/Trends/Body/Train,
the `LEDGER_PORT` data layer, the service worker and web push are deleted, and the old routes render a "moved to the
apps" page. The measurement ADR-0022 asked for came back at **web 3 of 104 active day-documents (2.9%)** and the owner
retired it. Features are mobile-only; "the web version of this is missing" is by design and is not a gap to file —
there is nothing to port to.

What `ignia.fit` still is: the marketing/compliance **shell** (landing, `/vs`, `/calculator`, `/faq`, `/privacy`,
`/terms`, `/support`, `/status`, the prerendered SEO pages, `/u/**` public profiles, `app-version.json`, the
`firebase.json` rewrites) and **`/admin`**, the owner's single-admin panel. The shell is **not** optional: Apple
requires the live privacy URL and Play requires the delete-account URL, both on `ignia.fit`, the Oura redirect and the
Google Sign-In authorized domain live there, and the mobile app links to it. Do not propose deleting the website. Two
items ADR-0036 records as OPEN (owner's call, reversible default taken): the SEO/marketing pages and the public profile
pages are **kept**.

There is no data layer on the web any more. The shell's components read at most one Firestore doc each
(`public/stats`, `publicProfiles/{slug}`, `status/heartbeat` — `statusPulse` is the FUNCTION, `status/heartbeat` is the
doc it writes) through the injected `Firestore`, and `/admin` goes through `AdminService` → `CallableGateway` → the
`admin*` callables, gated on the `admin` custom claim (`src/app/app.ts` renders it only signed-in and only at desktop
width; `AdminComponent` handles signed-in-but-not-admin). Routing is a signal read off `location.pathname` in `app.ts`
— there is no `<router-outlet>`, which is what lets `scripts/prerender-seo.mjs` serve every content page from the same
`index.html`. The retired logging routes (`/app`, `/history`, `/trends`, `/body`, `/train`, `/onboarding`) render
`RetiredComponent`, not a 404. **`LEDGER_PORT`, `FitnessStore`, `FirestoreLedgerCore` and `in-memory-ledger.adapter`
are gone** — if a doc still cites them it is stale.

**The admin.** The one admin is the owner's Gmail, the sole entry of `SEED_ADMINS` in `functions/src/admin-claims.ts`,
and **there is no grant path**: `setAdminClaims` was deleted 2026-08-30, so a second admin needs a code change +
deploy + re-bootstrap. The `/admin` gate says "Admin" and offers one Google button — nothing else, on purpose. **The
console itself** (`src/app/components/admin/`, revamped 2026-08-30) is a sidebar shell + ⌘K palette over eight
sections; its numbers come from `AdminDataService` (one cache for every callable) and its Overview prints plain-English
insights from `admin-insights.ts` — pure, unit-tested, thresholds stated in the code. DAU/WAU/MAU come from the
`adminGetUsageSeries` callable because `usageEvents` is owner-read only. To see it without your Google session:
`npm start` then `/admin?preview=1` (dev builds only, fixture data, no callables).

**Pro/feature flags are mobile-only since ADR-0036**: the web copies (`src/app/services/subscription.service.ts`,
`src/app/utils/features.ts`) were deleted with the web logging app.

Tailwind v4 comes in through `@tailwindcss/postcss`. Component naming dropped the `-v2` suffix (ADR-0006); the v1 app
was fully retired.
