# Macro Log — UX Audit

> Living document. Check items off as they ship. Last updated: 2026-04-12.

---

## How to use this doc

- **Status legend:** `[ ]` open · `[~]` in progress · `[x]` shipped · `[-]` decided against
- When you ship a fix, tick the box and note the commit/date inline.
- Add new findings under the appropriate severity section; don't reshuffle existing ones.
- Keep rationale ("Why:") intact so future us can tell whether a still-open item is worth doing.

---

## 1. App understanding (verified 2026-04-12)

**Shape:** single-page Angular 21 PWA. Two auth gates (sign-in → onboarding), then a two-column layout on desktop (single column on mobile).

**Left column — daily ledger (`daily-ledger.component`):**
- Travel-mode banner (if active)
- Streak badge
- 14-day date-chip strip (swipe + tap to navigate)
- Today weight + "new entry" CTA
- Add/edit entry panel (hosts `entry-form`, `photo-capture`, `barcode-scanner`, `preset-picker`)
- Log tape grouped by day (progress bars on today, inline per-day add, tap-to-edit meals)
- Undo-delete toast (5s)

**Right column — stacked:**
- `measurements.component` — waist/chest/bicep/hip with deltas
- `fasting.component` — 16h analog chronometer (start/break fast)
- `dashboard.component` — target · true TDEE · weight readout; adaptive-TDEE transition card; goal bar; weekly summary; weekly envelope; Gemini weekly report (cached); all-time progress; 14-day + all-time sparklines; CSV export
- `consultation.component` — streamed Gemini coach with suggested prompts

**Footer (global):** edit profile · travel mode · webhook · enable push · reminder hour dropdown.

**Global surfaces (`app.ts`):** SwUpdate modal, offline indicator, after-hours reminder banner, masthead (monogram, date, theme toggle, sign-out).

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
- [ ] Add "?" affordance to each dashboard readout (`target`, `true tdee`, `weight`) with a one-line tooltip
- [ ] Relabel "cut pace" in onboarding as "weekly fat-loss target" (keep "cut pace" as secondary text)
- [ ] Drop "fin" footer divider (rule itself is sufficient)
- [ ] Replace `specimen · personal use · confidential` footer text with version + "made for you"
- [ ] Rename onboarding section title from `field form · 001` to plain "your details" (keep stamp marks)

**Why:** brand voice should live in typography + frames, not in *function-gating* words. New users should never have to decode a label to continue.

### 🔴 S2 — Onboarding friction

- [ ] Add top-line summary above the form: "6 quick answers, ~60 seconds — editable later"
- [ ] Move rationale (why we need your age/sex) to the top, not inside section iii
- [ ] Mark required fields with `*`; mark goal-weight row with a visible "(skip if none)" pill
- [ ] On submit error, focus the offending input (currently error appears below submit, focus doesn't move)
- [ ] (Medium) Split into 3 steps with a progress indicator: identity → activity → target

**Why:** first-run is the only time we get the user to fill a 6-field form. Any friction here correlates directly with abandonment.

### 🟠 S3 — Hidden settings / discoverability

- [ ] Consolidate footer links into a single "settings" sheet in the masthead (edit profile, travel mode, webhook, reminder hour, push, export CSV)
- [ ] Keep footer for version/credits only
- [ ] Raise barcode (`⊟ scan`) and photo (`📷 snap`) buttons to full 44px with visible labels

**Why:** a first-time user scans the main surface; they'll never read the footer. Core capture paths (barcode, photo) are currently 11px buttons — below the scanning threshold.

### 🟠 S4 — Dashboard assumes statistical literacy

- [ ] Promote a single hero number above the ledger: "kcal remaining today" with target/eaten subtitle
- [ ] Collapse weekly envelope into one sentence ("You're 380 kcal under for the week. Aim 2,290 over the next 4 days.")
- [ ] Merge 14-day and all-time sparklines into one tabbed chart
- [ ] Re-expose the adaptive-TDEE explanation (once dismissed, there's no way back)

**Why:** the primary user question is "how many calories do I have left?" — it should be answerable in < 1 second. Today it requires parsing a progress bar.

### 🟠 S5 — Accessibility gaps

- [x] Add `:focus-visible` outline to all interactive elements globally *(2026-04-12)*
- [x] Add skip-link to `#main` *(2026-04-12)*
- [x] Add `role="status"` + `aria-live="polite"` to offline, reminder, update banners *(2026-04-12)*
- [x] Add `aria-label` on icon-only buttons (theme toggle, sign-out "out", day "+" buttons, barcode, photo, cancel "×") *(2026-04-12)*
- [x] Wrap sub-sections in `<h2>` or give `.rule` spans semantic heading roles *(2026-04-12)*
- [x] Add `<main id="main">` landmark *(2026-04-12)*
- [ ] Audit contrast: `--color-graphite-soft #716960` on paper `#f4f0e8` ≈ 4.3:1 (fails AA 4.5:1 for body text); `--color-aged #b8a480` ≈ 2.1:1 (text-unusable — verify only used decoratively)
- [ ] Add `role="alert"` + focusable toast for undo-delete (currently not announced)

**Why:** small fixes, compounding benefit. Cheap to do before surface grows.

### 🟠 S6 — Quiet state feedback

- [ ] Lengthen undo-delete toast to 8–10s and make the whole toast tappable
- [ ] Photo-analyze errors should toast, not render inline where scroll hides them
- [ ] "filing…" / "transmitting…" / "saving…" — pick one verb; reuse everywhere (addressed partially in S1)

**Why:** ghost-mutations (silent saves, too-short undo windows) are the #1 source of confidence loss in mobile logging apps.

### 🟡 S7 — Right-column density on desktop

- [ ] Decide the grouping: does measurements + fasting belong next to analytics, or in a "body" tab, or collapsed by default? *User decision required.*
- [ ] Make fasting chronometer a compact ledger-strip when active rather than a 200px SVG in the analytics column

**Why:** fasting is a chronometer, not analytics. Current stacking creates a ~6-screen scroll on desktop with weak topical grouping.

### 🟡 S8 — Cold-start / empty-state

- [ ] Fix ledger empty-state copy: "tap the button below" when button is at the *top*
- [ ] Add try-this specimen card for first run with tap-to-fill examples (coffee, chicken+rice)
- [ ] Hide consultation panel until ≥3 entries exist (otherwise Gemini has nothing to analyze)

**Why:** the first 2 minutes decide whether a fitness-logging user comes back tomorrow.

### 🟡 S9 — Micro-interactions

- [ ] Date chip: two red signals (dot = data; border = today) — differentiate
- [ ] Add once-per-session swipe hint on ledger ("swipe to change day ↔")
- [ ] Space sign-out / theme toggle apart + add icons; currently 2 chars apart, easy to mis-tap

---

## 4. Prioritised change list

### Ship this week (cheap, high-impact)
- [x] **Copy pass** (S1 items checked above) — *2026-04-12*
- [x] **A11y foundations** (S5 items checked above) — *2026-04-12*
- [ ] Fix ledger empty-state copy contradiction (S8)
- [ ] Lengthen undo toast to 8s, full-toast tappable (S6)
- [ ] Promote "kcal remaining today" hero (S4)

### Ship next (small surgery)
- [ ] Consolidate footer → settings sheet (S3)
- [ ] Onboarding: top-line summary, required/optional pills, focus-on-error (S2)
- [ ] Merge weight trends into tabbed chart (S4)
- [ ] Raise barcode/photo buttons to 44px with labels (S3)
- [ ] Contrast audit — fix graphite-soft / aged usage (S5)

### Needs a design decision first
- [ ] Right-column grouping (S7) — user call

---

## 5. Notes for future additions

- When adding a new surface, check it against: (a) does copy work for a first-time user; (b) is every icon-only button labelled; (c) does it announce state changes via `aria-live`.
- The "Personal Calibration Log" aesthetic is the differentiator — preserve it in *typography and frames*, not in *function-gating* words.

---

## 6. Change log

- **2026-04-12** — Initial audit written; S1 copy pass + S5 a11y foundations shipped in same commit.
