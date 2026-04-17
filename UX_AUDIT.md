# Macro Log — UX Audit

> Living document. Check items off as they ship. Last updated: 2026-04-17 (post-launch S1 + S2 pass; S3 items logged under S11).

---

## How to use this doc

- **Status legend:** `[ ]` open · `[~]` in progress · `[x]` shipped · `[-]` decided against
- When you ship a fix, tick the box and note the commit/date inline.
- Add new findings under the appropriate severity section; don't reshuffle existing ones.
- Keep rationale ("Why:") intact so future us can tell whether a still-open item is worth doing.

---

## 1. App understanding (verified 2026-04-15)

**Shape:** single-page Angular 21 PWA. Two auth gates (sign-in → onboarding), then a two-column layout on desktop (single column on mobile).

**Left column — daily ledger (`daily-ledger.component`):**
- Fasting strip (if active)
- Install-as-app prompt (after first logged meal, platform-aware)
- Travel-mode banner (if active)
- Streak badge
- 14-day date-chip strip (swipe + tap to navigate) + once-per-session swipe hint
- Today weight + "new entry" CTA
- Add/edit entry panel (hosts `entry-form`, `photo-capture`, `barcode-scanner`, `preset-picker`)
- Cold-start starter-food specimen card before first entry
- Log tape grouped by day (progress bars on today, inline per-day add, tap-to-edit meals)
- Undo-delete toast (8s, fully tappable)

**Right column — stacked:**
- `measurements.component` — waist/chest/bicep/hip with deltas
- `fasting.component` — 16h analog chronometer (start/break fast)
- `dashboard.component` — target · true TDEE · weight readout; adaptive-TDEE transition card; goal bar; weekly summary; weekly envelope; Gemini weekly report (cached); all-time progress; 14-day + all-time sparklines; CSV export
- `consultation.component` — streamed Gemini coach with suggested prompts

**Settings sheet (`settings-sheet.component`):** profile · reminders · language · modes · data/webhook · subscription · feedback · legal.

**Footer (global):** version/identity + privacy · terms · contact only.

**Global surfaces (`app.ts`):** SwUpdate modal, offline indicator, after-hours reminder banner, masthead (monogram, date, theme toggle, settings gear), auth gate, onboarding gate.

**Design language:** Instrument Serif + DM Sans + JetBrains Mono; warm cream paper / dark charcoal; oxblood accent, olive (on-track), terracotta (protein), gold (warning/travel). Lowercase copy with rotated stamp marks, ruler edges, tape strips, crop marks — "Personal Calibration Log" aesthetic.

---

## 2. Strengths to preserve

- Log-first layout — capture before analytics.
- Many paths to the same form (preset, barcode, photo, webhook).
- Adherence-neutral colors (no red/green shaming).
- Signals everywhere; views never stale after mutations.
- SwUpdate banner + 5-min poll keeps users on latest.

Don't regress these while fixing below.

---

## 3. Findings

Ordered by severity. Severity is impact × how many users hit it, not effort.

### 🔴 S1 — Copy is clever at the expense of comprehension

- [x] Replace "dispatch ⟶" / "transmitting…" → "ask" / "asking…" *(2026-04-12)*
- [x] Replace "break fast" → "end fast" (literal collision with "breakfast") *(2026-04-12)*
- [x] Consolidate save verbs: "filing…" (onboarding) → "saving…" to match entry-form *(2026-04-12)*
- [x] Add plain sub-headline on sign-in: one sentence on what the app does *(2026-04-12)*
- [x] Add "?" affordance to each dashboard readout (`target`, `true tdee`, `weight`) with a one-line tooltip *(2026-04-12)*
- [x] Relabel "cut pace" in onboarding as "weekly fat-loss target" (keep "cut pace" as secondary text) *(2026-04-12)*
- [x] Drop "fin" footer divider (rule itself is sufficient) *(2026-04-12)*
- [x] Replace `specimen · personal use · confidential` footer text with "made for you · private" *(2026-04-12)*
- [x] Rename onboarding section title from `field form · 001` to plain "your details" (keep stamp marks) *(2026-04-12)*

**Why:** brand voice should live in typography + frames, not in *function-gating* words. New users should never have to decode a label to continue.

### 🔴 S2 — Onboarding friction

- [x] Add top-line summary above the form: "six quick answers, about a minute — editable later" *(2026-04-13)*
- [x] Top-level reassurance row: ✓ private · ✓ no selling · ✓ editable anytime *(2026-04-13)*
- [x] Mark required fields with `*`; goal-weight row has a visible "skip if none" pill *(2026-04-13)*
- [x] On submit with missing fields → focus the first empty input; on height-out-of-bounds → focus heightFt *(2026-04-13)*
- [x] Submit button enabled on incomplete forms (was disabled) so taps still land feedback via focus *(2026-04-13)*
- [x] Split into 3 steps with a progress indicator: identity → activity → target. Same guided flow now applies in both first-run and edit mode, with sequential Back/Continue navigation, per-step explainer copy, and local-only progress until final save. *(2026-04-15)*

**Why:** first-run is the only time we get the user to fill a 6-field form. Any friction here correlates directly with abandonment.

### 🟠 S3 — Hidden settings / discoverability

- [x] Consolidate footer links into a single "settings" sheet opened via gear icon in the masthead (profile, reminders, modes, data, subscription, legal) *(2026-04-13)*
- [x] Keep footer for version/credits + legal only *(2026-04-13)*
- [x] Raise barcode + photo buttons to 44px with visible labels (new `.capture-btn` class) — "⊟ barcode" / "📷 photo" *(2026-04-12)*

**Why:** a first-time user scans the main surface; they'll never read the footer. Core capture paths (barcode, photo) are currently 11px buttons — below the scanning threshold.

### 🟠 S4 — Dashboard assumes statistical literacy

- [x] Promote a single hero number above the ledger: "kcal remaining today" with target/eaten subtitle *(2026-04-12)*
- [x] Collapse weekly envelope into one sentence. Kept the budget bar + consumed/budget labels underneath as at-a-glance trend. *(2026-04-12)*
- [x] Merge 14-day and all-time sparklines into one tabbed chart *(2026-04-17)*
- [x] Re-expose the adaptive-TDEE explanation — adaptive caption + always-visible source stamp *(2026-04-17)*

**Why:** the primary user question is "how many calories do I have left?" — it should be answerable in < 1 second. Today it requires parsing a progress bar.

### 🟠 S5 — Accessibility gaps

- [x] Add `:focus-visible` outline to all interactive elements globally *(2026-04-12)*
- [x] Add skip-link to `#main` *(2026-04-12)*
- [x] Add `role="status"` + `aria-live="polite"` to offline, reminder, update banners *(2026-04-12)*
- [x] Add `aria-label` on icon-only buttons (theme toggle, sign-out "out", day "+" buttons, barcode, photo, cancel "×") *(2026-04-12)*
- [x] Wrap sub-sections in `<h2>` or give `.rule` spans semantic heading roles *(2026-04-12)*
- [x] Add `<main id="main">` landmark *(2026-04-12)*
- [x] Contrast audit — reran the math: `graphite-soft #716960` actually passes at 4.79:1 (prior audit math was off). `aged #b8a480` at 2.1:1 does fail, but was only used as text in `.field-input::placeholder`. Switched placeholder to `graphite-soft` — passes. `aged` retained for decoration only. *(2026-04-13)*
- [x] Add `role="alert"` + focusable toast for undo-delete — auto-focus undo button on appear *(2026-04-17)*

**Why:** small fixes, compounding benefit. Cheap to do before surface grows.

### 🟠 S6 — Quiet state feedback

- [x] ~~Lengthen undo-delete toast to 8–10s~~ — already 8s in `fitness-store.service.ts:390`; audit was stale *(2026-04-12)*
- [x] Make the whole undo toast tappable (was undo-button-only) *(2026-04-12)*
- [x] Photo-analyze errors promoted to `role="alert"` so screen readers announce immediately *(2026-04-17)*
- [x] Save-verb consolidated to "save"/"guardar" everywhere *(2026-04-17)*

**Why:** ghost-mutations (silent saves, too-short undo windows) are the #1 source of confidence loss in mobile logging apps.

### 🟡 S7 — Right-column density on desktop

- [x] Decide the grouping — right column reordered to `dashboard → consultation → fasting → measurements` (high-use analytics first). Measurements + fasting stay in column but now below the primary analytics stack. *(2026-04-13)*
- [x] Make fasting chronometer a compact ledger-strip when active. New `FastingStripComponent` renders at the top of the ledger showing elapsed time + end-fast button. The full 200px analog dial self-hides while fasting; re-appears idle for the start-fast CTA. *(2026-04-13)*

**Why:** fasting is a chronometer, not analytics. Current stacking creates a ~6-screen scroll on desktop with weak topical grouping.

### 🟡 S8 — Cold-start / empty-state

- [x] Fix ledger empty-state copy: "tap the button below" when button is at the *top* *(2026-04-12)*
- [x] Try-this specimen card for first run — 18 curated foods (drinks, breakfast, protein, carbs, fast food, PR staples). One tap opens the form pre-filled. Auto-hides after first entry. *(2026-04-13)*
- [x] Hide consultation panel until ≥3 entries exist (otherwise Gemini has nothing to analyze) *(2026-04-13)*

**Why:** the first 2 minutes decide whether a fitness-logging user comes back tomorrow.

### 🟡 S9 — Micro-interactions

- [x] Date chip: differentiated the two signals — has-data dot is now olive, today border stays oxblood *(2026-04-12)*
- [x] Add once-per-session swipe hint on ledger ("swipe to change day ↔") *(2026-04-13)*
- [x] Space sign-out / theme toggle apart + add icons; currently 2 chars apart, easy to mis-tap *(2026-04-17)*

### 🔴 S10 — Post-launch audit (2026-04-17)

All shipped in the S1+S2 pass. S3 items are in the next section.

- [x] Photo size message alignment — client said 15 MB, server said 5 MB. Now both paths quote 15 MB; server message neutralised to "too large after processing". *(2026-04-17)*
- [x] Settings sheet TOC — sticky chip row at top of sheet jumps to each section; IDs + scroll-mt-16 added to all 8 sections. *(2026-04-17)*
- [x] Privacy GDPR contact fallback — added GitHub issue + in-app feedback as alternatives to mailto, plus stated 30-day response window. *(2026-04-17)*
- [x] UTC reset hint — title attr on photo + consultation captions, explicit note in settings → reminders section. *(2026-04-17)*
- [x] Ledger empty-state copy — replaced "tap the button above" with "press the New Entry button" for non-spatial navigation. *(2026-04-17)*

### 🟡 S11 — Open S3 items from the same audit (lower priority)

Tracked here so they surface in the next UX pass. Each is low-impact individually; several share themes (button feedback, responsive breakpoints) that could be batched.

- [ ] Consultation suggested-prompt pills look identical to the main "ask" button — de-emphasize so first-time users don't think selection is required
- [ ] Tablet 800–1023px — mobile tabs render but two-column desktop layout doesn't; "insights" tab has orphaned space
- [x] Apple Shortcuts "copy key" button has no success feedback — label flips to "✓ copied" for 2s + aria-live status *(2026-04-17)*
- [x] Onboarding back button on step 1 should be disabled — **already correct**: back is wrapped in `@if (currentStep() > 1)` so never rendered on step 1 *(verified 2026-04-17)*
- [ ] CSV export button has no filename hint / size estimate — iOS can silently fail
- [ ] Fasting dial → strip transition can feel broken on end-fast; idle "start fast" CTA hard to reach on desktop during active fast
- [x] Async buttons — **already correct**: dashboard refresh, verify-email check-now + resend, offline retry all have `[disabled]` + loading-label swaps *(verified 2026-04-17)*
- [x] Preset picker has no empty state — one-line caption shown when list is empty *(2026-04-17)*
- [ ] Dashboard sparkline may show stale data briefly after rapid-successive weight logs

---

## 4. Prioritised change list

### Ship this week (cheap, high-impact)
- [x] **Copy pass** (S1 items checked above) — *2026-04-12*
- [x] **A11y foundations** (S5 items checked above) — *2026-04-12*
- [x] Fix ledger empty-state copy contradiction (S8) — *2026-04-12*
- [x] Make undo toast fully tappable (S6) — toast was already 8s — *2026-04-12*
- [x] Promote "kcal remaining today" hero (S4) — placed at top of ledger, keeps dashboard 3-up row intact per "ship the additive change first, restructure with evidence later" — *2026-04-12*

### Ship next (small surgery)
- [x] Consolidate footer → settings sheet (S3) *(2026-04-13)*
- [x] Onboarding: top-line summary, required/optional pills, focus-on-error (S2) *(2026-04-13)*
- [x] Split onboarding into a 3-step guided flow with progress indicator (S2) *(2026-04-15)*
- [x] Merge weight trends into tabbed chart (S4) *(2026-04-17)*
- [x] Raise barcode/photo buttons to 44px with labels (S3) — *2026-04-12*
- [x] Contrast audit — fix graphite-soft / aged usage (S5) *(2026-04-13)*

### Needs a design decision first
- [x] Right-column grouping (S7) — reordered + fasting made ambient via strip *(2026-04-13)*

---

## 5. Notes for future additions

- When adding a new surface, check it against: (a) does copy work for a first-time user; (b) is every icon-only button labelled; (c) does it announce state changes via `aria-live`.
- The "Personal Calibration Log" aesthetic is the differentiator — preserve it in *typography and frames*, not in *function-gating* words.

---

## 6. Change log

- **2026-04-12** — Initial audit written; S1 copy pass + S5 a11y foundations shipped in same commit.
- **2026-04-12** — S8 empty-state copy fixed; S6 undo toast made fully tappable (toast was already 8s — audit initially said 5s, corrected).
- **2026-04-12** — S4 "kcal remaining today" hero shipped at top of the ledger (below travel-mode banner, above streak). Dashboard 3-up readout left untouched deliberately; re-evaluate after a week of use.
- **2026-04-12** — Copy/cheap bucket: "?" tooltips on dashboard readouts (tap-to-reveal), "cut pace" → "weekly fat-loss target", dropped "fin", footer "specimen · confidential" → "made for you · private", onboarding "field form · 001" → "your details", date-chip has-data dot changed from oxblood to olive (differentiates from today's border).
- **2026-04-12** — S3: barcode/photo capture buttons upgraded to 44px tap targets with visible labels ("⊟ barcode" / "📷 photo") via new `.capture-btn` class. S4: weekly envelope collapsed from 4-data-point grid to a one-sentence summary; budget bar kept for at-a-glance trend.
- **2026-04-13** — Audit catch-up: settings sheet replaced the old utility footer; install prompt, swipe hint, consultation cold-start hide, and contrast fix all shipped. Backlog updated on **2026-04-15** to remove stale open items.
- **2026-04-15** — S2 shipped: onboarding is now a 3-step guided flow (`identity → activity → target`) with a progress tracker, short explainer copy per step, Back/Continue navigation, and the same flow reused for edit mode.
- **2026-04-17** — Big audit catch-up day. Shipped: S4 sparkline merge (14d/all toggle), S4 adaptive-TDEE caption + always-visible source stamp, S5 undo toast `role="alert"` + auto-focus, S6 photo-error promoted to `role="alert"`, S6 save-verb consolidated to "save"/"guardar". Plus shipped (not in audit): annual tier ($24/yr) + cadence toggle, Microsoft sign-in, email/password sign-in + verify gate, motion design tokens, offline-banner retry button, install-prompt rationale rewritten, mobile measurements grid responsive, **Pro fulfillment Slice F kickoff** (photo/consultation tier split, presets cap, CSV 30-day window, chart 90-day window).
- **2026-04-17** — Production-readiness pass. S9 masthead mis-tap closed (gap-4 + 36×36 tap targets, the last open S9 item). Landing CTAs simplified to `/app` redirects so users see the full sign-in surface instead of a Google-only popup. 404 page added for unknown paths. Health "not medical advice" line on consultation intro + onboarding step 1. Password policy tightened on signup (10+ chars, letter + digit, no whitespace). See `CHANGELOG.md` 2026-04-17 entry for the non-UX items from the same pass (CI, Sentry sourcemaps, rate limits, GDPR/CCPA, backups, monitoring).
- **2026-04-17** — Post-launch S1 + S2 pass (S10). Photo size error messaging aligned between client (15 MB raw) and server (20 MB base64); contradictory numbers removed. Settings sheet gained a sticky TOC chip row + section IDs for jump navigation. Privacy GDPR section now offers GitHub issue + in-app feedback as mailto alternatives, with a stated 30-day response SLA. UTC quota-reset hint surfaced via `title` on remaining-count captions and an explicit note in Settings → Reminders. Ledger empty-state copy now names the button ("press the New Entry button") instead of the spatial "above". S3 items parked under S11 for a future pass.
