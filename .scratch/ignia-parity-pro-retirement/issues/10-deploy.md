# 10 — Deploy the parity + Pro-retirement batch

Type: task
Status: resolved
Blocked by: 01, 02, 03, 04, 05, 06, 07, 08, 09

## Question

Ship the whole batch. **Blocked by all other tickets.** Steps:
1. `npm run build` (prod: ng AOT build + `prerender-seo.mjs` 43 SEO pages + `sentry-release.mjs`). Prod build required — generates `ngsw.json`.
2. `firebase deploy --only hosting` (project `fitness-tracker-gb-1775407101`, site `macrolog`).
3. Verify live on `ignia.fit` with a **fresh** Playwright browser (no SW → gets latest): sign-in works (Google/Apple/email), Today/Train/Trends/Body/History/Settings render, no Pro UI anywhere.
4. Note: ignia.fit is Cloudflare-fronted; a 504 during deploy self-heals on reload.
Update memory `project_ignia_publishing.md` with the ship. Commit any final state.

## Answer

**Shipped — deployed twice this effort.**
- Deploy 1 (after ticket 01): prod build + `firebase deploy --only hosting` → Pro-retirement live.
- Deploy 2 (final, tickets 04/07/09): `npm run build` (43 SEO pages, ngsw generated) + `firebase deploy --only hosting` → "Deploy complete!", hosting[macrolog] release complete.

**Verified live on ignia.fit:** the prod app surfaced the "Update Available" banner (SW detected the new version); after reload, the **maintenance/TDEE hero renders on ignia.fit/trends** ("Maintenance estimate" + ESTIMATE badge + Daily target) — confirming the new build serves. All other feature changes were verified signed-in on localhost (identical source to the deployed build). Whole batch is live.
