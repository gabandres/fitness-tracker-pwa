# Macro App workspace notes

## Workspace shape

- The current workspace root is `Z:\macro-app`.
- The actual product codebase lives in `fitness-tracker-pwa\`.
- The workspace root also contains many screenshot artifacts used for UX review.
- `fitness-tracker-pwa\` is the Git repository; the workspace root is not.

## Product summary

- App name: **Macro Log** / **fitness-tracker-pwa**
- Type: Angular 21 single-page PWA for calorie, protein, weight, fasting, and body-measurement tracking.
- Primary UX pattern: **log-first ledger on the left, analytics + coaching on the right** on desktop; single-column on mobile.
- Core design language: warm cream paper, dark charcoal, oxblood accent, serif + mono editorial aesthetic ("Personal Calibration Log").

## Core user flow

1. Google sign-in
2. Onboarding/profile setup
3. Daily logging in the ledger
4. Review analytics, measurements, fasting, and AI coaching

## Main surfaces called out in project docs

- Daily ledger with date chips, streaks, weight, add/edit entry flow, presets, barcode scan, photo capture, and undo delete
- Dashboard with calorie budget, TDEE, weight trends, weekly summary, sparklines, exports, and cached Gemini report
- Measurements panel
- Fasting chronometer / fasting strip
- Consultation panel with streamed Gemini coaching
- Settings, reminders, travel mode, push notifications, subscription state

## Tech stack

- Angular 21
- TypeScript
- Firebase / Firestore / Auth / Cloud Functions / Hosting
- Angular service worker for PWA behavior
- Vitest via `ng test`
- Stripe via Firebase extension
- Gemini integration for photo analysis and consultation
- Sentry for error monitoring

## Useful commands

Run these from `Z:\macro-app\fitness-tracker-pwa`:

```sh
npm start
npm run build
npm test
```

Angular CLI commands are also available through `npm run ng` or `npx ng`.

## Architecture notes

- Favor the existing **single reactive data layer** approach; the changelog notes `FitnessStore` as the shared state backbone.
- Preserve the **log-first** information hierarchy. Analytics should support logging, not compete with it.
- Reuse existing capture paths instead of creating parallel ones.
- Keep the two-column desktop structure unless there is a strong product reason to change it.

## UX and product constraints

- Preserve the "Personal Calibration Log" aesthetic in typography, framing, and layout.
- Do **not** let brand voice reduce clarity. Project docs explicitly prefer plain, first-time-user-friendly labels over clever copy.
- Maintain strong accessibility defaults: visible focus states, labeled icon buttons, semantic landmarks/headings, and live-region announcements for state changes.
- Avoid regressions to freshness of data after mutations; the UX audit treats stale views as a major failure.
- The primary question should stay easy to answer: **"how many calories do I have left today?"**

## Current project direction from docs

- Recent work focused on UX clarity, onboarding friction, settings discoverability, accessibility, Stripe subscriptions, consultation quotas, PWA install nudges, and feedback/reporting flows.
- `UX_AUDIT.md` is the living backlog for product and interface improvements.
- `CHANGELOG.md` records notable shipped features and recent priorities.
- `STRIPE_SETUP.md` documents the one-time Stripe/Firebase extension setup.

## Working conventions for future changes

- Search the codebase before adding new helpers or duplicating logic.
- Follow Angular project conventions already present in `fitness-tracker-pwa`.
- Prefer small, behavior-safe changes that preserve the existing visual language.
- Update nearby docs when making changes to onboarding, billing, analytics, or other user-facing flows that are already documented.
- When unsure about intent, inspect `README.md`, `UX_AUDIT.md`, `CHANGELOG.md`, and `package.json` first.

### Custom Agent Skills

**The `/grill` Command (Requirement Gathering)**
If my prompt includes the command `/grill`, you must STRICTLY obey the following protocol:
1. Do NOT write any code or draft any worktrees.
2. Adopt the persona of a strict Lead Systems Architect.
3. Ask me exactly ONE question about edge cases, state management, or potential architectural failures regarding my feature request.
4. Wait for my answer. 
5. Ask the next question based on my answer. Repeat this loop until you have 100% clarity on the feature requirements.

### Architectural Constraints & QA Loop
Whenever you write or modify code in this repository, you MUST adhere to the following rules before presenting the final output:
1. **Strict Angular:** Always use Angular Standalone Components. Never generate `.module.ts` files. 
2. **Strict Typing:** Never use `any`. Always use the strict types defined in `src/app/models/` (e.g., `MacroEstimate`).
3. **The QA Loop:** Before telling me a task is complete, you must silently review your own code. Ask yourself: "Did I break any existing `firestore.rules`? Did I leave any unhandled asynchronous subscriptions in the UI?" Fix any issues you find before answering.