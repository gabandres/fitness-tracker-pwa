> **VERDICT** — The current bar for a consumer tracker on phones is still WCAG 2.2 AA applied per screen, plus the platform rules (Apple HIG for iOS 27 with Liquid Glass; Android 17 with Material 3 / M3 Expressive and a Play-mandated target of API 36), plus the store must-shows. For "hard to understand", the testable core is this: every number carries its unit and a plain label, every term of art is defined where it appears or one tap away, each screen puts the one thing that matters first, and errors and empty states say what to do next. Three things changed since 2026-10-11. (1) The **Google Play extension window closed on 2026-11-01**, so every update must now target API 36: edge-to-edge can no longer be opted out of, predictive-back animations are on by default unless opted out, and orientation locks are ignored on screens ≥600 dp. (2) HIG **Live Activities** gained limited-width layouts on 2026-10-13. (3) Nothing else in the design guidance changed for iPhone or Android phones: WCAG 3 is still a Working Draft (10 Sep 2026) and WCAG2Mobile is still a Draft Note (6 May 2025).
> **Status:** RESEARCHED · **Researched:** 2026-11-19 · every rule was read from its primary source in this session; unverified items are marked.
> **Read this only if:** you are scoring or changing any screen of the mobile app.
> **Supersedes nothing:** `train-ux-standards-2026.md` stays the Train-specific rule set; this file is the app-wide one.

# App-wide UX standards, 2026-11-19: the scoring rubric and checklist

**Current platform versions (checked 2026-11-19).**
- **iOS 27.** The HIG change log names iOS 27 (Wallet, 8 Jun 2026; the iOS 27 UI kits), and Liquid Glass is still the current material, with no successor named (https://developer.apple.com/design/whats-new/). Only a secondary design site dates the release, to 14 Sep 2026.
- **Android 17 (API 37).** Stable since June 2026; the exact day comes from press reports (16 Jun), not from Google. Its behaviour-changes page is live (https://developer.android.com/about/versions/17/behavior-changes-17). Google Play requires **target API 36** (Android 16) for new apps and updates from 31 Aug 2026, with extensions until 1 Nov 2026 (https://developer.android.com/google/play/requirements/target-sdk).

---

## 1. Weights and how to score

The weights are unchanged from `UX_AUDIT.md` §S18 and `train-ux-standards-2026.md` §1, so scores stay comparable: **Usability 25 · Accessibility 20 · Platform 15 · Visual 15 · Performance 10 · Copy 10 · Delight 5**. Score each dimension 0–10, then compute the total out of 100 as `Σ(score × weight) / 10`.

- **Score the rendered screen** (a device, a simulator or a screenshot) at default text size **and** at the largest accessibility size, in **both** themes, in en **and** at least one of es-PR or pt-BR (the longer strings).
- **A code-only score must say "code-only" next to the number.** §S21 found that code-only re-scores ran 3–6 points higher than scores taken from rendered screens.
- **A Copy or Usability score that claims comprehension** ("users understand X") must cite a reader test, even one person thinking aloud. Otherwise write "not reader-tested". ISO 24495-1's fourth principle is that the text is *evaluated with readers* (A65).
- Count failures per rule ID, list them per screen, then score. One Level A failure on a primary path caps Accessibility at 6. Any store must-show failure (A82–A88) caps Platform at 6.

**Recorded decisions, not defects** (from `UX_AUDIT.md` §S17-8, §S19, §S20 and the Train file; don't mark these down):
- the raised centre `+`;
- the brand fonts;
- **predictive back off**. Since target API 36 this is an explicit opt-out (`enableOnBackInvokedCallback=false`, which Expo sets through `predictiveBackGestureEnabled`), and it still needs a binary;
- no iPad layout;
- no Material You dynamic colour;
- the accordion in a live session.

Where native work is missing, cap Platform at about 8.6 (§S19) rather than counting each gap as a defect.

**Two items that may conflict with those decisions.** These are for the owner to decide; this file does not decide them.
- **Android large screens.** On apps targeting API 36, Android ignores portrait locks and resizability limits on screens ≥600 dp, so Android tablets and foldables get a stretched phone layout whether or not an iPad layout exists. The opt-out disappears at API 37 (A7).
- **Portrait lock.** WCAG 1.3.4 Orientation is **Level AA**, and its "essential" exceptions are things like cheque capture and piano keys (A8).

---

## 2. What changed since 2026-10-11

| Source | What changed (date) | Rule affected |
|---|---|---|
| Google Play target-API policy | New apps and updates must target API 36 from 31 Aug 2026. The extension ran **to 1 Nov 2026 and has now ended**, so every new upload has to target 36 | A4, A7, A31; Train R72 (predictive back is now a default you opt out of, not something you opt into) |
| Android 16 behaviour changes (bite at target 36) | Edge-to-edge opt-out is disabled. Predictive-back system animations are on by default, `onBackPressed` is no longer called, and the opt-out is `enableOnBackInvokedCallback=false`. Orientation, resizability and aspect-ratio limits are ignored at sw ≥600 dp | A4, A7, A31 |
| Android 17 behaviour changes (target 37, not required yet) | The sw ≥600 dp orientation/resizability opt-out is **removed** for API 37 | A7 (plan for it) |
| HIG Live Activities (13 Oct 2026) | Limited-width layouts added: compact and minimal views must fit a **28 pt circle**; if both sides don't fit, use the leading view only | A92; Train R63 |
| HIG Gestures, Pointing devices, Designing for macOS (28 Oct 2026) | Touch input on Mac only. Nothing for iPhone | none |
| ADA Title II rule (ada.gov) | A 2026 interim final rule moved the deadlines to 26 Apr 2027 / 26 Apr 2028. It covers state and local governments only (the exact date of the interim rule is not verified) | §5 only |
| Corrections to the Train file (pages changed **before** 2026-10-11, missed then) | HIG Tab bars (8 Jun 2026): minimise-on-scroll is described for tab bars **with an accessory** (MiniPlayer), not tab bars in general. HIG Live Activities (Dec 2025 text): interactivity is "ideally a single element". WCAG 3 reached a new Working Draft on 10 Sep 2026 | Train R72, R63 |

**No change since 2026-10-11** in these pages:
- HIG Accessibility (last changed 9 Jun 2025), Typography (16 Dec 2025), Sheets (24 Mar 2026), Writing (16 Dec 2025), Onboarding (10 Jun 2024), Privacy (21 Jun 2023), Notifications (24 Oct 2023), Layout (9 Sep 2026), Charts (23 Sep 2022);
- WCAG 2.2 (Recommendation of 12 Dec 2024), WCAG2Mobile (Draft Note of 6 May 2025);
- the App Review Guidelines rules quoted below.

The Train rules R1–R72 therefore stand as written, apart from the two corrections in the table.

---

## 3. Rules

Each rule is one testable line. **(R##)** means the Train file holds the full threshold and this rule applies it app-wide. Every source below was read on 2026-11-19. HIG pages were read through their JSON data endpoints, because the HTML pages render nothing without JavaScript (§5).

### 3.1 Targets and layout
- **A1** Every tappable control has a hit area of at least **44×44 pt on iOS / 48×48 dp on Android**, even where the visible glyph is smaller (R1, R2).
  (source: https://developer.apple.com/design/human-interface-guidelines/accessibility · https://developer.android.com/design/ui/mobile/guides/foundations/accessibility, read 2026-11-19)
- **A2** Gap between targets: about **12 pt** around bezelled controls and **24 pt** around borderless ones on iOS; ≥8 dp on Android (R3).
  (source: https://developer.apple.com/design/human-interface-guidelines/accessibility, read 2026-11-19)
- **A3** No tap or drag target sits inside the system gesture insets (the bottom home-indicator band and the side back-swipe edges). Text and buttons are inset; only backgrounds and dividers run edge to edge.
  (source: https://developer.android.com/design/ui/mobile/guides/layout-and-content/edge-to-edge, read 2026-11-19)
- **A4** Android edge-to-edge: content scrolls under the status bar, which keeps a translucent protection there. The gesture-navigation bar stays transparent with no extra scrim; with 3-button navigation, a scrim appears when a bottom bar animates away. Critical UI is inset from display cutouts.
  (source: https://developer.android.com/design/ui/mobile/guides/layout-and-content/edge-to-edge · https://developer.android.com/about/versions/16/behavior-changes-16, read 2026-11-19)
- **A5** iOS: content and controls respect the safe area. Controls are separated from content by a scroll-edge effect, not by a solid or semi-opaque bar.
  (source: https://developer.apple.com/design/human-interface-guidelines/layout, read 2026-11-19)
- **A6** Each screen puts its most important item near the top and leading edge, and groups related items with space, a container or a separator.
  (source: https://developer.apple.com/design/human-interface-guidelines/layout, read 2026-11-19)
- **A7** Android at sw ≥600 dp (tablet, unfolded foldable) with target ≥36: the app fills the window with no stretched or off-screen elements, and state survives rotation. Opting out is possible at 36 and impossible at 37.
  (source: https://developer.android.com/about/versions/16/behavior-changes-16 · https://developer.android.com/about/versions/17/behavior-changes-17, read 2026-11-19)
- **A8** Display is not locked to one orientation unless that is essential. This is **WCAG 1.3.4, Level AA**; see §1 for how it sits next to the recorded decisions.
  (source: https://www.w3.org/WAI/WCAG22/Understanding/orientation.html, read 2026-11-19)
- **A9** For WCAG purposes a "page" is one **screen** of the app (R7; WCAG2Mobile, W3C Group **Draft** Note of 6 May 2025, still not final).
  (source: https://www.w3.org/TR/wcag2mobile-22/, read 2026-11-19)

### 3.2 Text size
- **A10** Body text is 17 pt by default on iOS and never under 11 pt. Android body text is at least **12 sp** and every font size is in sp.
  (source: https://developer.apple.com/design/human-interface-guidelines/typography · https://developer.android.com/design/ui/mobile/guides/foundations/accessibility, read 2026-11-19)
- **A11** Text enlarges to **200 %** with no clipped numbers or overlapping text (iOS AX5; Android font scale 200 %). App Store "Larger Text" support also means 200 % or more across all common tasks (R9–R11).
  (source: https://developer.apple.com/design/human-interface-guidelines/accessibility · https://developer.apple.com/help/app-store-connect/manage-app-accessibility/overview-of-accessibility-nutrition-labels, read 2026-11-19)
- **A12** At large sizes, horizontally adjacent items stack, rows grow in height, the column count drops, and nothing truncates in a scrolling region unless a detail view shows the rest (R12).
  (source: https://developer.apple.com/design/human-interface-guidelines/typography · https://developer.apple.com/design/human-interface-guidelines/layout, read 2026-11-19)
- **A13** Custom (brand) fonts honour Dynamic Type **and** Bold Text the way system fonts do. No Ultralight, Thin or Light weights at small sizes.
  (source: https://developer.apple.com/design/human-interface-guidelines/typography, read 2026-11-19)
- **A14** When text grows, the content people care about most grows. Secondary chrome such as tab titles may stay fixed. Meaningful icons scale with text (R13).
  (source: https://developer.apple.com/design/human-interface-guidelines/typography, read 2026-11-19)

### 3.3 Contrast and colour
- **A15** Text contrast is **4.5:1**, or **3:1** for text ≥18 pt or bold, measured in light **and** dark (R15).
  (source: https://developer.apple.com/design/human-interface-guidelines/accessibility · https://developer.android.com/design/ui/mobile/guides/foundations/accessibility, read 2026-11-19)
- **A16** Non-text contrast is **3:1** for icons, field borders, ring and progress strokes, and chart lines against their surface (R16).
  (source: https://developer.android.com/design/ui/mobile/guides/foundations/accessibility, read 2026-11-19)
- **A17** Colour is never the only signal. In particular, over/under target, red/green and blue/orange pairs always carry a text, glyph or shape as well (R18).
  (source: https://developer.apple.com/design/human-interface-guidelines/accessibility, read 2026-11-19)
- **A18** Chart series and states are told apart by shape, pattern or direct label as well as colour.
  (source: https://developer.apple.com/design/human-interface-guidelines/charts, read 2026-11-19)
- **A19** If a default colour pair is borderline, the app offers higher contrast when Increase Contrast is on.
  (source: https://developer.apple.com/design/human-interface-guidelines/accessibility, read 2026-11-19)

### 3.4 Screen readers and gestures
- **A20** Every control has an accessible label that describes its purpose, and decorative images are hidden (R20).
  (source: https://developer.android.com/design/ui/mobile/guides/foundations/accessibility, read 2026-11-19)
- **A21** The accessible name contains the visible label (R21).
  (source: https://www.w3.org/WAI/WCAG22/Understanding/label-in-name.html, read 2026-11-19)
- **A22** A compound row reads as one element with its units spelled out ("Greek yogurt, 150 kilocalories, 15 grams protein"), not as a run of numbers (R22).
  (source: https://developer.apple.com/design/human-interface-guidelines/charts, read 2026-11-19, rule "spell out units")
- **A23** Every core function works through more than one interaction type. Each swipe or long-press has a visible tap alternative and an accessibility action (R23–R25, R41).
  (source: https://developer.apple.com/design/human-interface-guidelines/accessibility · https://developer.android.com/design/ui/mobile/guides/foundations/accessibility, read 2026-11-19)
- **A24** Each chart exposes a title and a one-sentence summary to assistive tech, plus labels for its values. Without Audio Graphs it states the chart type, what each axis means and the axis bounds. Visible tick labels are hidden from assistive tech.
  (source: https://developer.apple.com/design/human-interface-guidelines/charts · https://developer.apple.com/design/human-interface-guidelines/charting-data, read 2026-11-19)
- **A25** Changes that don't move focus (saved, synced, offline, target reached) are announced (R26). Time-boxed UI such as undo toasts meets R28, and the HIG says to "minimize use of time-boxed interface elements".
  (source: https://developer.apple.com/design/human-interface-guidelines/accessibility, read 2026-11-19)

### 3.5 Sheets, dialogs, navigation
- **A26** Only one sheet at a time: a sheet that leads to another closes first (R30).
  (source: https://developer.apple.com/design/human-interface-guidelines/sheets, read 2026-11-19)
- **A27** Single-view sheet: **Cancel** leading, **Done** trailing, and Done is always paired with Cancel or Back. Never show all three.
  (source: https://developer.apple.com/design/human-interface-guidelines/sheets, read 2026-11-19)
- **A28** Multi-step sheet (for example onboarding or a custom-food builder in a sheet): step 1 has Cancel and an inactive Done; later steps swap Cancel for Back; Done becomes active only on the final step (HIG change of 24 Mar 2026).
  (source: https://developer.apple.com/design/human-interface-guidelines/sheets, read 2026-11-19)
- **A29** A swipe-down on a sheet with unsaved changes asks through an action sheet. Resizable sheets show a grabber. The medium detent is used for progressive disclosure, such as a quick-add sheet.
  (source: https://developer.apple.com/design/human-interface-guidelines/sheets, read 2026-11-19)
- **A30** Tab bar: used for navigation only, with single-word labels, visible across sections, and no tab ever hidden or disabled. An empty section explains why it is empty. Default ≤5 tabs. Badges only for critical information (R72 as corrected in §2).
  (source: https://developer.apple.com/design/human-interface-guidelines/tab-bars, read 2026-11-19)
- **A31** Android back: with predictive back opted out (the recorded decision), system back still closes the topmost sheet or dialog before leaving the screen, and never discards unsaved input silently. If it is ever enabled, sheets preview on back and full-screen surfaces scale to 90 %.
  (source: https://developer.android.com/about/versions/16/behavior-changes-16 · https://developer.android.com/design/ui/mobile/guides/patterns/predictive-back, read 2026-11-19)
- **A32** Confirmation dialogs are only for uncommon, irreversible actions, with ≤3 buttons and verb labels; everything else gets undo (R37, R42, R43).
  (source: https://developer.apple.com/design/human-interface-guidelines/alerts, cited via R37; not re-read this session)
- **A33** Android modal bottom sheet opens at ≤50 % height and has a visible close route (R33). **Unverified this session**: m3.material.io renders no text without JavaScript (§5).

### 3.6 Forms and numeric entry
- **A34** Every input has a visible label, not just a placeholder. The placeholder or hint shows the expected format ("e.g. 72.5"), as WCAG 3.3.2 Labels or Instructions (Level A) requires (R14).
  (source: https://www.w3.org/WAI/WCAG22/Understanding/labels-or-instructions.html · https://developer.apple.com/design/human-interface-guidelines/writing, read 2026-11-19)
- **A35** Every numeric field shows its unit (kcal, g, kg/lb, cm/in) inside or beside the field. A bare number box fails. This is house rule derived from A34 and A51; WCAG 3.3.2 names format, not units.
- **A36** Numeric fields open a decimal or number pad and follow the locale's decimal separator: en and es-PR use ".", pt-BR uses "," (R46).
- **A37** Fields are prefilled with sensible defaults or the last value (R47). Defaults are set up so people can start without configuring anything.
  (source: https://developer.apple.com/design/human-interface-guidelines/onboarding, read 2026-11-19)
- **A38** When the app can detect an input error and knows the fix, it offers the fix (**WCAG 3.3.3, AA**). The error sits next to the field, and the user's input is kept.
  (source: https://www.w3.org/WAI/WCAG22/Understanding/error-suggestion.html · https://www.nngroup.com/articles/error-message-guidelines/, read 2026-11-19)
- **A39** The focused field is never hidden by the keyboard, tab bar or a sticky footer (R27).

### 3.7 First run, permissions and onboarding
- **A40** Someone can log their first food without completing any optional onboarding step. Non-essential setup is postponed, and defaults cover the rest.
  (source: https://developer.apple.com/design/human-interface-guidelines/onboarding, read 2026-11-19)
- **A41** A tutorial or tour can be skipped. Once skipped it is not shown on later launches, and it can be found again in Settings or Help.
  (source: https://developer.apple.com/design/human-interface-guidelines/onboarding, read 2026-11-19)
- **A42** The app teaches by doing: context tips at first use, one instruction at a time, rather than a deck of cards up front. If cards are used, keep them few, one concept per card, with a highly visible Skip (R57).
  (source: https://developer.apple.com/design/human-interface-guidelines/onboarding · https://www.nngroup.com/articles/mobile-app-onboarding/, read 2026-11-19)
- **A43** Onboarding asks only for data the first target needs (for example weight for a diet app, which NN/g names as a valid onboarding reason) and does no visual customisation. No licence text appears in onboarding.
  (source: https://www.nngroup.com/articles/mobile-app-onboarding/ · https://developer.apple.com/design/human-interface-guidelines/onboarding, read 2026-11-19)
- **A44** Report the onboarding length as a measured number: screens and taps from first launch to the first logged item. **There is no platform threshold.** The only benchmark found is a **vendor** sample with a median of 20.5 screens for health & fitness apps (n=26, July 2026), which is context, not a target.
  (source: https://www.lazyweb.com/research/health-fitness-onboarding-length, vendor, read 2026-11-19)
- **A45** Each permission is requested when the feature is first used, not at launch, unless the app cannot function without it. Health access is requested when the person logs that kind of data ("weight … when people log their weight").
  (source: https://developer.apple.com/design/human-interface-guidelines/privacy · https://developer.apple.com/design/human-interface-guidelines/healthkit, read 2026-11-19)
- **A46** A pre-permission screen, if one exists, has **one** button titled "Continue" or "Next" (never "Allow"), no Cancel or Close, and does not imitate or annotate the system alert.
  (source: https://developer.apple.com/design/human-interface-guidelines/privacy, read 2026-11-19)
- **A47** Purpose strings are one brief, complete, active sentence in sentence case ending in a period, saying how and why the data is used ("The app reads your weight from Apple Health to update your calorie target.").
  (source: https://developer.apple.com/design/human-interface-guidelines/privacy · https://developer.apple.com/app-store/review/guidelines/ §5.1.1(ii), read 2026-11-19)
- **A48** iOS notifications: the system prompts **only once**, so the request comes in a context that explains it (for example after the first reminder is set up). Provisional (quiet) authorisation is an option.
  (source: https://developer.apple.com/documentation/usernotifications/asking-permission-to-use-notifications, read 2026-11-19)
- **A49** Android `POST_NOTIFICATIONS`: the request is triggered by a user action, or deferred until the person knows the app ("the third or fourth time"). A rationale screen appears only when `shouldShowRequestPermissionRationale()` is true.
  (source: https://developer.android.com/develop/ui/views/notifications/notification-permission, read 2026-11-19)
- **A50** A denied permission never blocks the app: a manual path exists, and the screen links straight to the setting rather than describing where it is.
  (source: https://developer.apple.com/app-store/review/guidelines/ §5.1.1(iv) · https://developer.apple.com/design/human-interface-guidelines/writing, read 2026-11-19)

### 3.8 Comprehension, plain language and numbers
- **A51** Every number on a primary screen has its **unit and a plain-words label in the same visual group** ("1,240 kcal left today", "112 g protein of 150 g"). A bare figure, or a unit only in a distant header, fails.
  (source: https://developer.apple.com/design/human-interface-guidelines/charts "spell out units" · https://www.nngroup.com/articles/web-writing-show-numbers-as-numerals/ "explain … unusual units", read 2026-11-19)
- **A52** Every term of art (TDEE, BMR, maintenance, deficit, macro, e1RM, RIR, volume, adaptive target) is **defined at first use or one tap away** on the screen where it appears (an inline ⓘ, a sheet or a glossary). The source is WCAG 3.1.3 (**Level AAA**), adopted here as a house rule because W3C encourages it for "specialized content aimed at non-specialists", and HIG Inclusion: "Define specialized or technical terms first".
  (source: https://www.w3.org/WAI/WCAG22/Understanding/unusual-words.html · https://developer.apple.com/design/human-interface-guidelines/inclusion, read 2026-11-19)
- **A53** Every abbreviation (kcal, g, TDEE, PR, RPE) can be expanded on that screen (WCAG 3.1.4, **AAA**, house rule). Screen-reader labels use the spoken form ("kilocalories").
  (source: https://www.w3.org/WAI/WCAG22/Understanding/abbreviations.html, read 2026-11-19)
- **A54** Primary-path copy reads at about a **lower-secondary level**, which is WCAG 3.1.5 (AAA), and NN/g gives grades 6–8 for general audiences. Sentences are ≤20 words. Test the English strings with a readability formula; test es-PR and pt-BR by reading them aloud.
  (source: https://www.w3.org/WAI/WCAG22/Understanding/reading-level.html · https://www.nngroup.com/articles/plain-language-experts/, read 2026-11-19)
- **A55** One concept, one term, on every screen and in every locale. Keep a term list and check the i18n files against it: the same thing must never appear as both "target" and "goal" or "budget".
  (source: https://developer.apple.com/design/human-interface-guidelines/writing, read 2026-11-19)
- **A56** Each screen states its purpose before its detail. Most important information first, then supporting numbers, then advanced data (ISO 24495-1 "relevant" and "findable"; Health Literacy Online "put the most important information first").
  (source: https://odphp.health.gov/healthliteracyonline/ · https://developer.apple.com/design/human-interface-guidelines/writing, read 2026-11-19; ISO text via secondary summary, §5)
- **A57** A 5-second look at any primary screen answers "where am I, what is my status, what do I do next". The title names the screen and there is **one** visually primary action. (Derived from ISO 24495-1 "usable" and R52; testable by the 5-second screenshot read in §1.)
- **A58** Advanced metrics (e1RM, adaptive TDEE trend, macro splits beyond protein) sit behind progressive disclosure at most 2 levels deep, and a default screen never shows more than one unexplained metric (R52).
  (source: https://www.nngroup.com/articles/progressive-disclosure/, cited via R52)
- **A59** Numbers are numerals, never words, with locale grouping ("1,240" in en and es-PR, "1.240" in pt-BR). Rounding is consistent: kcal as integers, grams as integers, body weight to 0.1.
  (source: https://www.nngroup.com/articles/web-writing-show-numbers-as-numerals/ · https://developer.apple.com/design/human-interface-guidelines/inclusion, read 2026-11-19)
- **A60** Every estimate (calorie target, TDEE, e1RM, projected date) is labelled as an estimate, with "How this is calculated" one tap away. App Review requires apps to "clearly disclose data and methodology to support accuracy claims relating to health measurements".
  (source: https://developer.apple.com/app-store/review/guidelines/ §1.4.1, read 2026-11-19)
- **A61** A settings toggle's label says what happens when it is **on**.
  (source: https://developer.apple.com/design/human-interface-guidelines/writing, read 2026-11-19)
- **A62** Copy talks to "you" and avoids an unclear "we", gendered terms, idioms and an academic tone. Humour is rare, since it doesn't translate.
  (source: https://developer.apple.com/design/human-interface-guidelines/writing · https://developer.apple.com/design/human-interface-guidelines/inclusion, read 2026-11-19)
- **A63** Buttons are verbs. Flows use one pattern ("Get started" → "Continue" → "Done"). "Tap", never "click".
  (source: https://developer.apple.com/design/human-interface-guidelines/writing, read 2026-11-19)
- **A64** Charts carry an information-rich title that states the takeaway ("Down 1.2 kg in 4 weeks"), keep axis labels short, put units in the title, and use the same chart type, colours and terms wherever they show the same data.
  (source: https://developer.apple.com/design/human-interface-guidelines/charts · https://developer.apple.com/design/human-interface-guidelines/charting-data, read 2026-11-19)
- **A65** A change to a primary-screen explanation is checked with at least one real reader before a comprehension score is claimed (ISO 24495-1, principle 4, "evaluate … with readers").
  (source: https://www.iso.org/standard/78907.html, **would not load (403)**; principle taken from the standard's published table of contents via secondary summaries, §5)

### 3.9 Errors, empty states, feedback, offline
- **A66** An error says what happened and what to do next, sits next to the problem, avoids blame, codes and "oops", and keeps the input ("Enter a weight between 30 and 300 kg", not "Invalid value").
  (source: https://developer.apple.com/design/human-interface-guidelines/writing · https://www.nngroup.com/articles/error-message-guidelines/, read 2026-11-19)
- **A67** Presentation matches severity: inline for a field, a banner or toast for transient problems, a modal only for severe ones. Errors are never sent as notifications.
  (source: https://www.nngroup.com/articles/error-message-guidelines/ · https://developer.apple.com/design/human-interface-guidelines/notifications, read 2026-11-19)
- **A68** An empty state shows its status (never "No data" while still loading), says what will appear there, and offers a button for the next action. Crucial information is never placed only in an empty state.
  (source: https://www.nngroup.com/articles/empty-state-interface-design/ · https://developer.apple.com/design/human-interface-guidelines/writing, read 2026-11-19)
- **A69** Feedback timing: 0.1 s feels instant; under 1 s, no spinner or skeleton (R58–R60).
- **A70** Offline: cached data plus a quiet label, never an alert, and writes are queued (R61).

### 3.10 Health-specific content and safety
- **A71** The app never proposes a daily target at or below **800 kcal**, which NIDDK defines as a very-low-calorie diet "supervised by a health care professional". If a person enters one, the screen says so and points them to a clinician.
  (source: https://www.niddk.nih.gov/Dictionary/V/very-low-calorie-diet, read 2026-11-19)
- **A72** The default weight-loss pace sits within **about 1–2 lb (0.45–0.9 kg) per week**, the CDC's "gradual, steady pace". A faster chosen pace is labelled as faster than recommended.
  (source: https://www.cdc.gov/healthy-weight-growth/losing-weight/index.html, page dated 17 Jan 2025, read 2026-11-19)
- **A73** Target-setting and body screens carry a reachable "check with a doctor before medical decisions" note (App Review 1.4.1). The Play listing states the app is "not a medical device and does not diagnose, treat, cure, or prevent any medical condition".
  (source: https://developer.apple.com/app-store/review/guidelines/ · https://support.google.com/googleplay/android-developer/answer/16679511, read 2026-11-19)
- **A74** No copy claims accuracy or precision for a health number that the app cannot validate (App Review 1.4.1; Play prohibits "misleading health claims").
  (source: same as A73)
- **A75** UI text says "Apple Health", never "HealthKit", and uses the system's translation of "Health". The Apple Health icon is unaltered, not a button, and no smaller than the other app icons beside it.
  (source: https://developer.apple.com/design/human-interface-guidelines/healthkit, read 2026-11-19)
- **A76** No custom screen replicates the Health permission sheet. Data sharing is managed only in system settings, and the in-app setting links there.
  (source: https://developer.apple.com/design/human-interface-guidelines/healthkit, read 2026-11-19)
- **A77** Ring-shaped progress indicators are clearly different from Apple Activity rings (padding, labels, colour), and no ring appears in notifications.
  (source: https://developer.apple.com/design/human-interface-guidelines/healthkit, read 2026-11-19)
- **A78** Imported data (Health Connect on Android) shows the source app's name, and its icon where possible. Settings has a sync toggle and a "Manage access" link into Health Connect. If permission is cancelled twice, a screen explains how to re-enable it in Health Connect settings.
  (source: https://developer.android.com/health-and-fitness/health-connect/ui/data · https://developer.android.com/health-and-fitness/health-connect/ui/permissions, read 2026-11-19)
- **A79** If the app asks for sex or gender for an estimate, the field says why it is asked, and HIG Inclusion lists options such as "nonbinary", "self-identify" and "decline to state". **Flag only**: a sex-based TDEE equation needs a stated fallback; this is the owner's call.
  (source: https://developer.apple.com/design/human-interface-guidelines/inclusion, read 2026-11-19)
- **A80** Workout or diet copy never urges risky activity (App Review 1.4.5), and imagery shows varied bodies and ages.
  (source: https://developer.apple.com/app-store/review/guidelines/ · https://developer.apple.com/design/human-interface-guidelines/inclusion, read 2026-11-19)
- **A81** Notification text holds no sensitive health detail (no weight, no deficit) and supplies a generic body for hidden previews.
  (source: https://developer.apple.com/design/human-interface-guidelines/notifications, read 2026-11-19)

### 3.11 Store-policy must-shows
- **A82** Account deletion can be started **inside the app**, plus a web deletion link for Play. The path is findable from Settings in ≤3 taps (house threshold).
  (source: https://developer.apple.com/app-store/review/guidelines/ §5.1.1(v) · https://support.google.com/googleplay/android-developer/answer/13327111, read 2026-11-19)
- **A83** The privacy policy is linked in the app "in an easily accessible manner".
  (source: https://developer.apple.com/app-store/review/guidelines/ §5.1.1(i), read 2026-11-19)
- **A84** Consent can be withdrawn through an "easily accessible and understandable" control, and paid functionality never depends on granting data access.
  (source: https://developer.apple.com/app-store/review/guidelines/ §5.1.1(ii), read 2026-11-19)
- **A85** If a third-party or social login is the primary account, an equivalent privacy-preserving login is offered (App Review 4.8). Without significant account-based features, the app works without login (5.1.1(v)).
  (source: https://developer.apple.com/app-store/review/guidelines/, read 2026-11-19)
- **A86** Push is never required to use the app. Marketing push only follows explicit in-app opt-in language, with an in-app opt-out (App Review 4.5.4).
  (source: https://developer.apple.com/app-store/review/guidelines/, read 2026-11-19)
- **A87** Notifications: no duplicates for one event, ≤4 actions with short title-case labels, no action that only opens the app, and the badge used only for unread counts.
  (source: https://developer.apple.com/design/human-interface-guidelines/notifications, read 2026-11-19)
- **A88** Play Console's Health apps declaration is complete, and Health Connect data is treated as personal and sensitive. This is a listing/console item, checked once per release, not per screen.
  (source: https://support.google.com/googleplay/android-developer/answer/16679511, read 2026-11-19)

### 3.12 Motion and performance
- **A89** Reduce Motion: automatic and repetitive animation is cut, and movement is swapped for fades; motion never carries information on its own (R68).
  (source: https://developer.apple.com/design/human-interface-guidelines/accessibility, read 2026-11-19)
- **A90** Haptics follow the system meanings, are not overused, and are paired with visual feedback (R66, R67). Sounds are always paired with haptics or visuals.
  (source: https://developer.apple.com/design/human-interface-guidelines/accessibility, read 2026-11-19)
- **A91** A screen paints from cache in under 1 s, and optimistic writes show feedback within 0.1 s (R58, R59).
- **A92** Any Live Activity: ≤8 h, removed promptly when done, at most one interactive element, animation ≤2 s, and the compact and minimal views fit a **28 pt** limited-width circle (new 13 Oct 2026).
  (source: https://developer.apple.com/design/human-interface-guidelines/live-activities, read 2026-11-19)

---

## 4. What a 10, 8, 6 and 4 look like on non-Train screens

The screens these rows refer to are Today, the add-food sheet, Trends, Body, Settings and onboarding.

### Usability (25)
| Score | Looks like |
|---|---|
| **10** | Today answers "how much is left, and of what?" in one glance. Adding a recent food takes ≤2 taps from Today, and search plus a custom food take ≤4. A first-time user logs a food before finishing any optional step (A40). Trends and Body each lead with one sentence that gives the takeaway (A64). Settings reaches deletion, privacy and units in ≤3 taps (A82). Every empty state has its button (A68). |
| **8** | The same flows with one extra tap on a common path, or one secondary screen (Body or Trends) that needs a scroll to reach its point. Onboarding is longer than needed, but skippable. |
| **6** | Logging means search every time (no recents or defaults). Onboarding blocks first use on optional data. Some actions exist only behind a long-press or swipe. Trends shows charts without a takeaway. |
| **4** | People can't tell what the main number means. Data is lost on backgrounding or a dismissed sheet. There are dead ends with no next action. |

### Accessibility (20)
| Score | Looks like |
|---|---|
| **10** | A1–A25 pass on a device in both themes. At AX5 or 200 %, Today's numbers and the add-food rows stack instead of clipping. Charts carry summaries and value labels (A24). Every icon button is labelled. |
| **8** | One or two minor misses: a decorative element is focusable, or one status change is unannounced. Tested in code and the simulator, not with a real screen reader. |
| **6** | Clipped numbers at large sizes, a swipe-only action, colour-only over/under states, or 24–43 pt targets. |
| **4** | Unlabelled icon buttons, text below 4.5:1, a layout that breaks at large text, or a chart invisible to the screen reader. |

### Platform (15)
| Score | Looks like |
|---|---|
| **10** | iOS: sheets follow A26–A29; permissions are asked in context with correct purpose strings (A45–A48); the Apple Health wording is right (A75). Android: edge-to-edge done properly (A3, A4); back closes the topmost layer (A31); Health Connect attribution and settings are in place (A78); tablet and foldable windows don't break (A7). All store must-shows pass (A82–A88). |
| **8** | Idioms are right but JS-drawn. One platform polished, the other generic. A small inset or scrim slip. |
| **6** | iOS chrome on Android or the reverse. A permission requested at launch. "HealthKit" in UI text. Content under the gesture bar. |
| **4** | A store must-show missing (no in-app deletion, no privacy link). Sheets stacked on sheets. Back exits a sheet with data lost. |

### Visual (15)
| Score | Looks like |
|---|---|
| **10** | One hero number per screen and one accent. Units are set beside the numbers in a quieter weight (A51). Tabular, aligned figures. Light and dark are equally finished. The hierarchy reads in 1 s. |
| **8** | Clean, with occasional density problems at 360 dp or with es-PR/pt-BR string lengths. |
| **6** | Several numbers compete for attention. Many accents. Rings and bars use colour as the only state cue. |
| **4** | Inconsistent spacing and type. You can't tell logged values from target values. |

### Performance (10)
| Score | Looks like |
|---|---|
| **10** | Today, Trends and Body paint from cache in under 1 s. Add-food results update as you type with no visible lag. Writes are optimistic and survive offline (A69–A71, A91). |
| **8** | Feedback is instant, with an occasional 1–2 s spinner on a cold open. |
| **6** | A spinner on every tab visit. Search lags behind typing. |
| **4** | Lost entries offline, or multi-second waits on a tap. |

### Copy (10)
| Score | Looks like |
|---|---|
| **10** | A51–A65 pass. Every term of art is defined where it appears. One term per concept across en, es-PR and pt-BR. Estimates say they are estimates and show how they are computed. Errors and empty states say what to do. Reader-tested. |
| **8** | Clear, with a few undefined terms on secondary screens (for example "TDEE" on Body with no ⓘ), or one synonym pair. |
| **6** | Jargon on Today or onboarding. Bare numbers without labels. "Invalid" or "Error" messages. Locales out of parity. |
| **4** | Untranslated strings. Copy that contradicts the number shown. Health claims the app can't support. |

### Delight (5)
| Score | Looks like |
|---|---|
| **10** | A small, Reduce-Motion-safe moment when a protein or kcal target is met. Plain-words weekly insight. Respectful tone around weight. Nothing gratuitous on the logging path. |
| **8** | One or two such moments. |
| **6** | Functional but flat. |
| **4** | Motion or haptics on every keystroke, or shaming copy about intake or weight. |

---

## 5. Gaps: what could not be verified, and why

- **Material Design 3 component pages** (bottom sheets, navigation bar, dialogs, snackbar, M3 Expressive). m3.material.io returns only the page title to a non-JavaScript fetch, so **A33 is unverified** and R33, R36, R45 and R70 were not re-read. The M3 Expressive status after May 2026 rests on press reports only, with no primary source found.
- **Apple HIG pages** render nothing as HTML without JavaScript. They were read through Apple's own JSON data endpoints (`developer.apple.com/tutorials/data/design/human-interface-guidelines/<page>.json`). These are the same content with the same change logs, but say so if challenged. The HIG Alerts page was not re-read this session (A32 relies on R37/R42). Typography was read only to its first 100k characters (the watchOS and tvOS tables were cut off; the iOS rules were complete).
- **The iOS 27 and Android 17 release dates** come from secondary sources. The primary sources (the HIG change log and the Android 17 behaviour-changes page) confirm that both versions exist and are current, not their release day.
- **ISO 24495-1:2023.** iso.org returned 403, and the IPLF summary page returned 404. The four principles (relevant, findable, understandable, usable, with evaluation with readers) come from the standard's published table of contents as quoted by secondary summaries, so A56 and A65 cite them as such.
- **European Accessibility Act.** The facts below are from the Directive text on EUR-Lex (Arts. 2, 3(23) and 4(5)); the Commission's EAA page did not state the exemption. The Act applies to services provided to consumers after **28 Jun 2025**, and its listed services include **e-commerce services**. A **microenterprise** has fewer than 10 persons and an annual turnover or balance-sheet total of ≤EUR 2 million, and microenterprises **providing services are exempt** from the service accessibility requirements. Whether a free tracker with no sales is in scope at all was not established. EN 301 549 was not opened this session. **United States:** the DOJ's 2024 ADA Title II web and mobile-app rule (WCAG 2.1 AA) covers **state and local governments** only, with deadlines now 26 Apr 2027 / 26 Apr 2028. No federal technical standard for private consumer apps was found. Facts only, not legal advice.
- **Calorie-safety guidance.** NHS pages were reachable but did not hold the safe-rate figures. CDC (1–2 lb/week) and NIDDK (VLCD ≤800 kcal, supervised) are the sources used. No platform policy sets a calorie floor.
- **Onboarding length and time-to-first-value.** No platform or standards body publishes a number. The only figure (a median of 20.5 screens for health & fitness, n=26) is a vendor sample; the "<60 s time-to-value" claims found came from vendor blogs with no methodology, and were not used.
- **Apple Accessibility Nutrition Labels** are voluntary today. Apple says they will become required for submissions "with advance notice"; no date has been announced.
- **WCAG 3** is a W3C **Working Draft** (10 Sep 2026) that calls itself a work in progress. **Do not score against it.**
