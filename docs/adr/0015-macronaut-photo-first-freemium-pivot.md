# Macronaut: rebrand + photo-first AI calorie core, freemium (supersedes 0013)

## Status

accepted (2026-07-04)

## Context

Two forcing functions arrived together:

1. **Brand collision.** "Macro Log" is an existing iOS App Store app, so the
   name can't ship to the App Store. A distinct, clearable brand is required.
2. **Strategic pivot.** The owner wants to compete with **Cal AI** — a
   photo → AI → macros logging loop — as the product's *core function*. This
   directly reverses [ADR-0013](0013-food-resolution-my-foods-library.md),
   which rejected meal-photo guessing on accuracy (~26–36% error) and
   recurring AI cost grounds.

This ADR was reached by re-grilling the pivot end-to-end (accuracy, cost,
monetization, differentiation, surface area) against fresh 2025 research,
rather than reversing 0013 silently.

### What the accuracy research actually says (2025)

- General LLM vision is **weak at nutrient *numbers*** — all tested models
  showed **>60% error on protein**, the app's core metric. In one head-to-head
  (Fridolfsson et al., 2025), **Gemini was the worst** (64–110% MAPE; ~65–70%
  energy error) vs ChatGPT/Claude (~36%).
- Purpose-built nutrition models (DietAI24 ~48 kcal MAE/dish, SnapCalorie,
  Foodvisor) beat raw LLMs. Cal AI is not a raw Gemini call.
- **Key reframe:** the weakness is in *emitting macro numbers*, not in
  *identifying food and estimating portions*. Split those two jobs and the
  accuracy objection largely dissolves.

## Decision

**Rebrand to "Macronaut"** (App-Store-clear as of 2026-07-04; USPTO + domain
clearance pending before the code rename — see roadmap) and adopt a
**photo-first AI calorie core** on a **freemium** model, built by **evolving
the existing Expo app** (not a rebuild) with **Firebase as the source of
truth**.

1. **Split vision architecture (the accuracy mitigation).**
   Vision model does **recognition + portion only** ("grilled chicken breast,
   ~150 g"); the **USDA CC0 DB + `customFoods`** (built in ADR-0013) produce
   the actual macros. An **editable, itemized review screen** lets the user
   correct *portions/items*, not a black-box total. Barcode/label path stays
   for packaged food (near-exact).

2. **Vision engine: default Gemini Flash, gated.** Reuse the existing
   Gemini/Vertex key + the `consultationStream`-style **Cloud Function SSE
   proxy** (never key on client). Because the LLM now only does
   recognition+portion, Gemini's numeric weakness may not apply — **validate on
   30–50 real food photos** (judge item list + portion, not macros) before
   committing; escalate to GPT-4o/Claude *only if it fails*.

3. **Freemium.** Manual/text/barcode logging is **free forever** (protects the
   original free-tracker promise and gives non-payers a reason to stay).
   **Photo scans** are the paid gate: **5 lifetime free scans** (enough to log
   a full day once and feel the loop), then **Pro** (≈$29–39/yr) unlocks
   unlimited scans **+ the archived AI Coach**. Quota is **server-enforced in
   the CF** via `packages/core/tier-limits.ts` (client can't bypass), plus a
   hard daily ceiling to cap runaway/abuse cost.

4. **Surface area (4 tabs + camera + settings-on-avatar).**
   `Home | Train | 📷 Camera | Progress | History`.
   - **Camera** replaces the center "Log" button as the hero action.
   - **Progress** = Body (weight/goal/progress-photos) **+** Trends, folded.
   - **Train stays** — the differentiator (AI-photo macros + a *real strength
     log* is rare; Cal AI has none; MacroFactor only added workouts Jan 2026).
   - **Coach → archived** (code retained), returns as a **Pro** feature.

5. **Retention: local-first smart nudges.** Extend
   `apps/mobile/src/lib/reminders.ts` from one daily nudge to **meal-window
   nudges** (breakfast/lunch/dinner, opt-in) **+ an evening streak-at-risk
   nudge**, all on-device (`expo-notifications`, works in Expo Go, $0).
   **Smart-reschedule on app-open / after each log**: skip a window already
   logged; cancel the streak nudge once today's first log lands. **Streak-freeze**
   (already coded as `computeStreak`'s `freezeMaxGap`) becomes a **Pro** perk.
   Remote/server push (re-engage lapsed users) is **deferred post-launch**
   (needs a dev build + FCM token).

## Consequences

- **Cost is bounded, not open-ended:** a Gemini Flash scan is fractions of a
  cent; the real risk is abuse, handled by server-side per-user + daily caps.
  Subscription revenue funds the vision spend. This satisfies the cost-averse
  constraint that drove 0013.
- **Accuracy risk concentrates in the portion estimate** (the vision step) —
  the itemized editable screen is the required UX mitigation; validate before
  shipping.
- **Positioning shifts** from "free/private/$0 tracker" to "free manual
  tracker + paid AI-photo + strength log." The free tier keeps the original
  promise intact.
- **Discoverability wedge:** lead ASO/SEO with the *combination* nobody else
  ships — "AI photo calorie tracker **with a real workout log**."

## Alternatives considered

- **Keep 0013 as-is (no photo AI):** rejected — owner wants to compete with
  Cal AI; photo logging is the growth loop.
- **Raw LLM emits macros (Cal-AI-naive):** rejected — >60% protein error.
- **Specialized nutrition-vision API (SnapCalorie/Passio/Foodvisor):** parked —
  better accuracy but new vendor dependency + cost + less control; revisit only
  if the split+Gemini validation fails.
- **Local-only first, DB later:** rejected — the paywall quota and the vision
  key both *require* a server; Firebase already provides it.
- **Fresh rebuild:** rejected — the Expo app already has logging, history,
  charts, streaks, and push scaffolding to reuse.
- **Cut Train for a pure Cal-AI clone:** rejected — Train is the differentiator.
