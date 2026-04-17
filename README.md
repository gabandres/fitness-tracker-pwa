# Macro Log

Calorie, protein, weight, fasting, and body-measurement tracker. Live at **<https://macrolog.web.app>**.

Angular 21 PWA backed by Firebase (Firestore, Auth, Cloud Functions, Hosting). Stripe for subscriptions via the `firestore-stripe-payments` extension. Gemini for photo→macros and the AI consultation.

## Project map

- `src/` — Angular app. `services/fitness-store.service.ts` is the single reactive data layer; components inject it and read signals.
- `functions/` — Cloud Functions (gen2, Node 22). `analyzePhoto`, `reserveConsultation`, `releaseConsultation`, `checkAccessStatus`, `logWebhook`, `deleteAccount`.
- `src/app/i18n/` — Transloco locales (`en`, `es-PR`).

## Reference docs

- **`CHANGELOG.md`** — significant ships, newest first.
- **`UX_AUDIT.md`** — living UX backlog.
- **`STRIPE_SETUP.md`** — one-time Stripe + Firebase Extension wiring.

## Daily commands

```sh
npm start          # ng serve on http://localhost:4200
npm run build      # production build → dist/
npm test           # vitest via ng test
```

## Deploy

```sh
npm run build
firebase deploy                  # hosting + functions
firebase deploy --only hosting   # hosting only (no function changes)
firebase deploy --only functions # function changes only
```

Firebase project: `fitness-tracker-gb-1775407101`. Hosting site: `macrolog`.
