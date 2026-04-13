# Changelog

Significant ships to [macrolog.web.app](https://macrolog.web.app), newest first.

Small copy tweaks, internal refactors, test additions, and bug fixes aren't listed here — see `git log` for the full record, and `UX_AUDIT.md` for the living UX backlog.

---

## 2026-04-12 — Privacy, terms, account deletion

- **Privacy policy** at `/privacy` — plain English, covers what's stored, what goes to Google's Gemini (photos + consultation context), what we don't do (no selling, no ads, no AI training on your data), and your export/delete rights.
- **Terms of use** at `/terms` — short version: use it as intended, not medical advice, you own your data.
- **Account deletion** — "delete my account" button on the privacy page. Confirmation-gated. Calls a new `deleteAccount` Cloud Function that cascades Firestore subcollections (dailyLogs, presets, reports, dailyWeights, measurements), purges photoQuota, deletes the profile doc, and removes the Firebase Auth user. Irreversible; GDPR-compliant.
- **Footer links** — privacy · terms · contact (mailto:macrolog.support&#64;gmail.com).

## 2026-04-12 — UX audit foundations

- **"kcal remaining today" hero** — the primary user question ("can I eat this?") is now answered in a big serif number at the top of the ledger. Oxblood when over budget.
- **Weekly envelope rewritten** — the 4-data-point grid became a single plain-english sentence: *"you're 380 kcal under for the week — aim 2,290 over the next 4 days."*
- **Capture buttons enlarged** — barcode + photo went from 36px/11px to 44px/12px with real labels (`⊟ barcode`, `📷 photo`).
- **Accessibility foundations** — global `:focus-visible` outline, skip link, `<main>` landmark, aria-labels on icon buttons, `role="status"` on offline/reminder/update banners, tappable undo toast.
- **Copy pass** — "cut pace" → "weekly fat-loss target", "break fast" → "end fast" (no more collision with "breakfast"), "dispatch" → "ask", "filing…" → "saving…", plain sub-headline on sign-in explaining what the app does.
- **Dashboard readouts** — each of `target / true tdee / weight` now has a "?" button revealing a plain-english explanation.
- **UX_AUDIT.md** — living audit doc added at the repo root.

## 2026-04-11

- **Cardio + lift training toggles** redesigned with clearer on/off indicators and better aria support.

## 2026-04-09

- **Photo-to-macros upgraded** to Gemini 2.0 Flash — structured output, confidence signal in the UI when low.
- **Daily photo quota** (8/day per user) added to protect the Gemini budget.
- **iOS PWA tap-to-edit** fixed after a subtle interaction between swipe listeners, animation stacking contexts, and GPU layers.

## 2026-04-08 — Ledger depth

- **Protein target progress bar** on the day header.
- **All-time weight chart** in addition to the 14-day sparkline.
- **Swipe-to-navigate days** on the ledger.
- **Two-column desktop layout** — ledger on the left, analytics/coach on the right.
- **Weight promoted to the day header**, stored in a dedicated Firestore collection (no more ghost-meal workaround).
- Internal: extracted `EntryFormManager` and per-day child components.

## 2026-04-07 — Calibration polish

- **Adaptive TDEE transition card** — fires once when measured mode kicks in at day 14, showing formula vs. measured diff.
- **Configurable daily reminder hour** via footer dropdown.
- **All-time summary** card added to the dashboard.
- **Typography + spacing overhaul** ("Legible Instrument v2") — cooler cream, larger fonts, higher contrast, tighter vertical rhythm.
- Date editing now persists correctly in edit mode.

## 2026-04-06 — Big feature wave

- **Body measurements** (waist / chest / bicep / hip) with deltas.
- **Barcode scanner** (OpenFoodFacts lookup).
- **FCM push notifications**.
- **Cloud Functions** — Apple Shortcuts webhook (`logWebhook`) and server-side Photo-to-Macros (`analyzePhoto`).
- **Meal-based entries** with day-header grouping; multiple meals per day.
- **Travel mode**, **weekly calorie envelope**, **fasting chronometer** (16h analog dial).
- **Undo-delete toast**, **after-hours daily reminder**, **14-day date navigation strip**, **weekly auto-generated AI report**.
- Internal: `FitnessStore` single reactive data layer replaces fragmented per-component fetching.

## 2026-04-05 — Initial launch

- Deployed to [macrolog.web.app](https://macrolog.web.app) as a PWA (`Macro Log` / `Macros`).
- **Google Sign-In** (Gmail only) + per-user Firestore isolation.
- **Profile onboarding** with Mifflin-St Jeor formula as the TDEE seed.
- **Daily logging** — calorie + protein entries, meal labels, edit/delete, meal presets.
- **Gemini consultation** — streamed coaching grounded in 14-day context.
- **EMA weight smoothing** on a 14-day sparkline, goal progress bar, streak counter.
- **Weekly summary**, **CSV export**, **dark mode**.
- **Log-first tape-strip layout** with the "Personal Calibration Log" aesthetic (Instrument Serif, JetBrains Mono, warm cream/oxblood palette).
- **Offline support** via Firestore IndexedDB persistence.
- **SwUpdate reload banner** with 5-minute polling.
