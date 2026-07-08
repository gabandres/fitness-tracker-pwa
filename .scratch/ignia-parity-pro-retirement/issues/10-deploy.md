# 10 — Deploy the parity + Pro-retirement batch

Type: task
Status: claimed
Blocked by: 01, 02, 03, 04, 05, 06, 07, 08, 09

## Question

Ship the whole batch. **Blocked by all other tickets.** Steps:
1. `npm run build` (prod: ng AOT build + `prerender-seo.mjs` 43 SEO pages + `sentry-release.mjs`). Prod build required — generates `ngsw.json`.
2. `firebase deploy --only hosting` (project `fitness-tracker-gb-1775407101`, site `macrolog`).
3. Verify live on `ignia.fit` with a **fresh** Playwright browser (no SW → gets latest): sign-in works (Google/Apple/email), Today/Train/Trends/Body/History/Settings render, no Pro UI anywhere.
4. Note: ignia.fit is Cloudflare-fronted; a 504 during deploy self-heals on reload.
Update memory `project_ignia_publishing.md` with the ship. Commit any final state.
