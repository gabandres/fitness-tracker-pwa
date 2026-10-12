> **VERDICT** — For a strength logger the score is decided by the **set row** and the **rest timer**, not by visual polish. The verified 2026 bar: every set-row control has a 44×44 pt / 48×48 dp hit area (24×24 is only the WCAG AA *floor*, with an exception for spacing), the row still works at AX5 / 200 % text, every swipe or drag has a single-tap and VoiceOver/TalkBack custom-action equivalent, a completed set never relies on colour alone, and the rest timer keeps running on the Lock Screen / notification shade (Live Activity on iOS, promoted Live Update on Android 16) with ±15 s adjust and skip. Confirmation is for things you cannot undo (discard workout, delete template); deleting a set or an exercise gets **undo**, not an alert. Competitor behaviour is converging: Hevy, Strong and Boostcamp all prefill from the last session, complete a set with one tap, start the rest timer on that tap, and ask "Update template / Keep original" at Finish.
> **Status:** RESEARCHED — rubric and checklist for the Train-tab UX review. Every rule was read from its primary source in this session (2026-10-11); nothing is from memory. Three gaps are listed at the end.
> **Researched:** 2026-10-11
> **Read this only if:** you are scoring or changing the Train tab (`apps/mobile`), i.e. the live-session logger, the rest timer, the template editor or the workout history, and need a threshold plus a citation rather than an opinion.
> **Do not** re-derive the template-builder comparison in [`train-template-ux.md`](train-template-ux.md) §2. §3 below only adds or corrects facts where the current help docs have changed since 2026-08-18.

# Train-tab UX standards, 2026: the scoring rubric and checklist

Weights are fixed by `UX_AUDIT.md` §S18 so scores stay comparable across audits:
**Usability 25 · Accessibility 20 · Platform 15 · Visual 15 · Performance 10 · Copy 10 · Delight 5**.
Score each dimension 0–10, then compute `Σ(score × weight) / 10` for a total out of 100.

**Recorded decisions, not defects** (from `UX_AUDIT.md` §S17-8, §S19, §S20; a reviewer should not mark these down): the raised centre `+`, the brand fonts, predictive back **off** (`predictiveBackGestureEnabled`, which needs a binary), no iPad layout, no Material You dynamic colour, and the **accordion** in a live session (owner's call, 2026-10-07). Where the native work is still missing, treat Platform as capped at about 8.6 (§S19) rather than counting it as a defect.

---

## 1. Scoring rubric: what a 10, 8, 6 and 4 look like in a workout logger

Score the **rendered** screen whenever you can. §S21 found that code-only re-scores came out 3–6 points higher than scores taken from rendered screens, so a code-only score must say that it is code-only.

### Usability (25)
| Score | What it looks like |
|---|---|
| **10** | Starting the next planned workout takes 1 tap from the Train root. Each set row is prefilled (from the template, or else the last session at the same position), and logging an as-planned set is **1 tap** on the checkmark. That tap starts the rest timer. Reaching the next exercise needs no scrolling hunt, because superset/next-set auto-advance exists. Finish shows a summary and asks once whether to update the template (with a values-only option). Every destructive action on a set or exercise can be undone. Empty states offer the one next action. There are at most 2 disclosure levels (R52). |
| **8** | Same flows, plus up to one extra tap on a common path (for example, the rest timer has to be opened to adjust it). Prefill comes from the last session only, not from the template. Undo exists but is short-lived or covers only some actions. |
| **6** | Weight and reps have to be typed on most sets (a placeholder or ghost value is shown instead of a prefill), or finishing / changing the template is ambiguous. Some actions are reachable only through a gesture or a long-press. |
| **4** | Logging needs ≥3 taps per set. Workout state can be lost on navigation, backgrounding or app kill. Confirmation dialogs appear on routine actions (R42–R43), or there is no recovery from mistakes at all. |

### Accessibility (20)
| Score | What it looks like |
|---|---|
| **10** | All rules R1–R22 pass on a device. VoiceOver/TalkBack reads each set row as one coherent element ("Set 2, 135 pounds, 8 reps, not done. Previous 135 by 8") with adjustable or custom actions. Rest-timer start, the 10 s warning and the end are announced. AX5 and Android 200 % lay out without clipped numbers. Contrast is 4.5:1 for text and 3:1 for controls in both themes. |
| **8** | Labels and roles are complete and targets meet 44/48. One or two minor issues: a decorative element is focusable, or one announcement is missing. Tested in code plus the simulator, not with a real screen reader. |
| **6** | Targets of 24–43 pt in the set row, rescued only by the spacing exception. A swipe-only delete with no accessible action. Timer changes are silent. Truncation at AX sizes. |
| **4** | Unlabelled icon buttons, colour as the only "done" signal, text that fails 4.5:1, or a layout that breaks at large text. |

### Platform (15)
| Score | What it looks like |
|---|---|
| **10** | iOS: native sheets with detents and a grabber; Cancel leading and Done/confirm trailing; a `UIContextMenu` with a row preview; a Live Activity rest timer; system haptics used for their documented meanings. Android: M3 bottom sheets (initial height ≤50 %), a predictive-back-aware sheet and full-screen dialog, a promoted ongoing notification with a chronometer, ripple feedback, a top app bar that changes colour on scroll. |
| **8** | Platform idioms are right but JS-drawn (JS sheets, JS menus); a native timer surface on one platform only. |
| **6** | One cross-platform look (iOS chrome on Android, or the reverse); an "X" where the platform expects Cancel/Done; no system-surface timer. |
| **4** | Custom navigation that fights the system back gesture or the edge swipe; nested sheets; alerts used for information. |

### Visual (15)
| Score | What it looks like |
|---|---|
| **10** | Set rows form a scannable table: tabular numerals, aligned columns, a stable row height. Set states (done / warm-up / drop / failure / PR) each have a distinct shape or label as well as colour. One accent per screen. Dark and light themes are equally polished. The hierarchy is clear at a 1-second glance from 60 cm, which is phone-on-the-bench distance. |
| **8** | Clean, with occasional density problems (wrapped headers, uneven columns) at the 360 dp width. |
| **6** | Crowded cards. Several competing accents. The column alignment breaks when values reach 3 digits plus a decimal. |
| **4** | Inconsistent spacing and type scale. Hard to tell planned values from logged ones. |

### Performance (10)
| Score | What it looks like |
|---|---|
| **10** | Checkmark feedback in <100 ms (R58). The screen paints from cache in <1 s (R59). Writes are optimistic and durable offline. No dropped frames while scrolling a 9-exercise session. The timer does not drift when backgrounded. |
| **8** | Feedback is instant, but there is an occasional spinner of 1–2 s, or a visible re-layout on the first open. |
| **6** | A loading state on each open. The timer drifts or resets after backgrounding. Jank while typing. |
| **4** | Lost sets offline, or multi-second waits on a tap. |

### Copy (10)
| Score | What it looks like |
|---|---|
| **10** | Gym vocabulary rather than engine vocabulary (warm-up, drop set, superset, "Previous"). Buttons are verbs ("Finish workout", "Discard workout", "Update template"). The confirmation copy names the object and its consequence ("Discard Push A? 14 logged sets will be lost"). All three locales (en, es-PR, pt-BR) are at parity and fit at AX sizes. |
| **8** | Mostly clear. A few jargon leaks (RIR, cluster) on default surfaces, or a vague "OK" or "Are you sure?". |
| **6** | Engine terms on the main path; inconsistent names for the same thing (template / routine / program). |
| **4** | Untranslated strings, or error messages that do not say how to recover. |

### Delight (5)
| Score | What it looks like |
|---|---|
| **10** | A PR moment with a matching success haptic and a Reduce-Motion-safe animation. A finish summary that compares the session with the last one. Small accelerators: auto-advance, the plate calculator at the keyboard, ±15 s on the timer. Nothing gratuitous during sets. |
| **8** | One or two of these moments. |
| **6** | Functional but flat. |
| **4** | Motion or haptics that get in the way (long animations on every check, buzzing on every keystroke). |

---

## 2. Checklist: testable rules (R1 to R72)

Platform key: **iOS**, **And**roid, **Both**. Thresholds are the source's own numbers. Where the source gives no number, the rule says so.

### 2.1 Touch targets and density (set-row table)
| ID | Rule | Threshold | Plat | Source |
|---|---|---|---|---|
| R1 | Default hit region for every control (checkbox, set number, weight/reps cell, ⋯) | **44×44 pt** default; 28×28 pt is Apple's stated *minimum* control size | iOS | https://developer.apple.com/design/human-interface-guidelines/accessibility · https://developer.apple.com/design/human-interface-guidelines/buttons |
| R2 | Touch target | **≥48×48 dp** (about 9 mm). A 24 dp icon is padded out to 48 | And | https://m3.material.io/foundations/designing/structure · https://developer.android.com/guide/topics/ui/accessibility/apps |
| R3 | Spacing between targets | **≥8 dp** gap (M3). About **12 pt** of padding around bezelled controls and about **24 pt** around borderless ones (HIG) | Both | https://m3.material.io/foundations/designing/structure · https://developer.apple.com/design/human-interface-guidelines/accessibility |
| R4 | WCAG AA floor | **24×24** CSS px. An undersized target passes only if a 24 px circle centred on it intersects no other target or circle (spacing exception), or if an equivalent ≥24 control exists | Both | https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html |
| R5 | AAA / enhanced | **44×44** CSS px | Both | https://www.w3.org/WAI/WCAG22/Understanding/target-size-enhanced.html |
| R6 | In a dense row, keep one primary action. The rest go behind a menu, with the primary taking most of the row and supplementary actions trailing | No number. M3: "primary action should take up the majority of the space" | Both | https://m3.material.io/components/lists/guidelines |
| R7 | Native apps: WCAG applies "as written". WCAG2Mobile (W3C Draft Note, 6 May 2025) maps "page" to "screen" | Draft note | Both | https://www.w3.org/TR/wcag2mobile-22/ |

### 2.2 Text size, Dynamic Type and truncation
| ID | Rule | Threshold | Plat | Source |
|---|---|---|---|---|
| R8 | Body text size | iOS default **17 pt**, minimum **11 pt** | iOS | https://developer.apple.com/design/human-interface-guidelines/accessibility |
| R9 | Support enlargement | **≥200 %** (Apple's stated ideal). Dynamic Type Body runs from 17 pt (Large) up to **53 pt at AX5**, and Caption 2 from 11 to 40 pt | iOS | https://developer.apple.com/design/human-interface-guidelines/typography |
| R10 | Android font scale | Up to **200 %** since Android 14, with non-linear scaling. Test at max | And | https://developer.android.com/about/versions/14/features |
| R11 | Resize text without loss of content or function | **200 %** | Both | https://www.w3.org/WAI/WCAG22/Understanding/resize-text.html |
| R12 | Show as much useful text at the largest AX size as at the largest standard size. Don't truncate in scrolling regions unless a detail view exists. **Stack** inline items and **reduce the column count** at large sizes | No number. Check AX5 against xxxLarge | iOS | https://developer.apple.com/design/human-interface-guidelines/typography |
| R13 | Interface icons that carry meaning (set-type glyphs, PR badge) scale with text | n/a | iOS | https://developer.apple.com/design/human-interface-guidelines/typography |
| R14 | Text-field labels are always visible and never truncated. A placeholder alone is not a label | n/a | Both | https://m3.material.io/components/text-fields/guidelines · https://developer.apple.com/design/human-interface-guidelines/text-fields |

### 2.3 Contrast and colour
| ID | Rule | Threshold | Plat | Source |
|---|---|---|---|---|
| R15 | Text contrast | **4.5:1**. Large text (≥18 pt, or bold) **3:1**. Check both light and dark appearances | Both | https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html · https://developer.apple.com/design/human-interface-guidelines/accessibility |
| R16 | Non-text contrast: checkbox outlines, the "done" fill, field borders, timer ring, chart strokes | **3:1** against adjacent colours (inactive controls exempt) | Both | https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html |
| R17 | Clustered buttons and containers against the background | **3:1** (M3). Nav-bar icons **3:1** with the container | And | https://m3.material.io/foundations/designing/color-contrast · https://m3.material.io/components/navigation-bar/guidelines |
| R18 | Colour is never the only signal. A done set, warm-up/drop/failure, a superset group or a PR needs a shape, glyph or text as well | Pass/fail | Both | https://www.w3.org/WAI/WCAG22/Understanding/use-of-color.html · https://developer.apple.com/design/human-interface-guidelines/accessibility |
| R19 | On Liquid Glass, apply colour sparingly. To emphasise a primary action, tint the **background**, not the glyph | n/a | iOS 26 | https://developer.apple.com/design/human-interface-guidelines/color |

### 2.4 Screen readers, gestures and announcements
| ID | Rule | Threshold | Plat | Source |
|---|---|---|---|---|
| R20 | Every key element has a label that describes its purpose rather than its look (not "pencil"). Don't put the role in the label. Hide decorative images | Pass/fail, counted per screen | Both | https://developer.apple.com/design/human-interface-guidelines/voiceover · https://m3.material.io/foundations/designing/elements |
| R21 | The accessible name contains the visible label text, ideally at its start (Voice Control / Voice Access) | Pass/fail | Both | https://www.w3.org/WAI/WCAG22/Understanding/label-in-name.html |
| R22 | Group related elements (a set row reads as one unit) and keep reading order top-to-bottom, leading-to-trailing | n/a | Both | https://developer.apple.com/design/human-interface-guidelines/voiceover |
| R23 | Every swipe (path-based gesture) has a single-pointer, non-path alternative, such as a tap or ⋯ menu item | Level A | Both | https://www.w3.org/WAI/WCAG22/Understanding/pointer-gestures.html |
| R24 | Every drag (reorder) has a non-drag single-pointer alternative, such as Move up/down or a menu | Level AA | Both | https://www.w3.org/WAI/WCAG22/Understanding/dragging-movements.html |
| R25 | Expose swipe and drag actions as accessibility custom actions (VoiceOver Actions rotor; TalkBack `customActions`). In RN: `accessibilityActions` + `onAccessibilityAction`; `adjustable` role with increment/decrement for steppers | Pass/fail | Both | https://developer.apple.com/documentation/uikit/uiaccessibilitycustomaction · https://developer.android.com/guide/topics/ui/accessibility/principles · https://reactnative.dev/docs/accessibility |
| R26 | Announce state changes that don't move focus: set logged, rest started/ended, PR, "saved offline" | Level AA | Both | https://www.w3.org/WAI/WCAG22/Understanding/status-messages.html · https://developer.apple.com/design/human-interface-guidelines/voiceover · https://reactnative.dev/docs/accessibilityinfo |
| R27 | A focused element is never fully hidden by a sticky rest bar, keyboard bar or tab bar | Level AA | Both | https://www.w3.org/WAI/WCAG22/Understanding/focus-not-obscured-minimum.html |
| R28 | Time limits (auto-dismissing undo, auto-skip) can be turned off, extended ≥10×, or warned with **≥20 s** to extend. HIG: "Minimize use of time-boxed interface elements" | 20 s / 10× | Both | https://www.w3.org/WAI/WCAG22/Understanding/timing-adjustable.html · https://developer.apple.com/design/human-interface-guidelines/accessibility |
| R29 | Auto-dismissing snackbar content must also be shown accessibly near the trigger, or the snackbar stays until acted on | Pass/fail | And | https://m3.material.io/components/snackbar/guidelines |

### 2.5 Sheets, dialogs, menus
| ID | Rule | Threshold | Plat | Source |
|---|---|---|---|---|
| R30 | **One sheet at a time.** Close the first sheet before opening another. No sheet-on-sheet | Pass/fail | iOS | https://developer.apple.com/design/human-interface-guidelines/sheets · https://developer.apple.com/design/human-interface-guidelines/modality |
| R31 | Sheet buttons: **Cancel leading, Done trailing**. A Done button is always paired with Cancel or Back. Never show Cancel, Done and Back together. Support swipe-to-dismiss. If there are unsaved changes, confirm with an **action sheet** | Pass/fail | iOS | https://developer.apple.com/design/human-interface-guidelines/sheets |
| R32 | Detents: large is default; medium is "about half" and suits progressive disclosure. Include a **grabber** on resizable sheets (it also works with VoiceOver) | n/a | iOS | https://developer.apple.com/design/human-interface-guidelines/sheets |
| R33 | M3 modal bottom sheet: initial height capped at **50 %** of the screen. Dismiss via an item, the scrim, a swipe down or a close affordance. A full-screen sheet shows a close affordance | 50 % | And | https://m3.material.io/components/bottom-sheets/guidelines |
| R34 | Show a visible **Close/X** on bottom sheets; don't rely on the grab handle. Avoid **stacked** sheets | n/a | Both | https://www.nngroup.com/articles/bottom-sheet/ |
| R35 | Full-screen dialog (template editor on Android): **X** is the only nav item, and confirm is a specific verb ("Save", "Create", not "Done"/"OK"). Dismissing with changes triggers a discard confirmation. Field errors appear **inline** | Pass/fail | And | https://m3.material.io/components/dialogs/guidelines |
| R36 | Basic dialog: **≤2 actions** (confirm + dismiss); dismiss sits to the left of confirm. No "Are you sure?" or "Warning!" headlines | 2 | And | https://m3.material.io/components/dialogs/guidelines |
| R37 | Alert: **≤3 buttons**; title ≤2 lines; one- or two-word verb button titles; "Cancel" is always the cancel label; avoid "OK" unless the alert is purely informational. Destructive style only when the destruction wasn't the user's deliberate choice | 3 / 2 lines | iOS | https://developer.apple.com/design/human-interface-guidelines/alerts |
| R38 | Action sheet: **≤4 buttons including Cancel**, no scrolling, destructive option at the top. Use an action sheet, not an alert, for choices tied to an intentional action (e.g. Finish → save / discard / keep going) | 4 | iOS | https://developer.apple.com/design/human-interface-guidelines/action-sheets |
| R39 | Context menu: a small number of items, **≤~3 separator groups**, submenus **1 level** deep and **≤~5 items**. Use system icons for common actions. Support it consistently on every comparable row. Offer a context menu *or* an edit menu on an item, not both | 3 / 1 / 5 | iOS | https://developer.apple.com/design/human-interface-guidelines/context-menus · https://developer.apple.com/design/human-interface-guidelines/menus |
| R40 | Menu items don't nest buttons or switches. On phones, prefer a bottom sheet for long menus | n/a | And | https://m3.material.io/components/menus/guidelines |
| R41 | Hidden (long-press or swipe) menus need a visible signifier and another way to reach the same actions | Pass/fail | Both | https://www.nngroup.com/articles/contextual-menus/ · https://www.nngroup.com/articles/contextual-swipe/ |

### 2.6 Destructive actions: confirm vs undo
| ID | Rule | Threshold | Plat | Source |
|---|---|---|---|---|
| R42 | **Don't alert on common, undoable actions, even destructive ones.** Alert only on uncommon *and* irreversible ones. Map: delete set / remove exercise → undo; discard workout / delete template / delete logged workout → confirm | Pass/fail | Both | https://developer.apple.com/design/human-interface-guidelines/alerts · https://www.nngroup.com/articles/confirmation-dialog/ |
| R43 | A confirmation names the object and the consequence ("Discard Push A — 14 sets"). No routine confirmations ("cry wolf") | Pass/fail | Both | https://www.nngroup.com/articles/confirmation-dialog/ |
| R44 | Provide undo / an emergency exit (heuristic #3). Undo shows its result and describes what was undone | n/a | Both | https://www.nngroup.com/articles/user-control-and-freedom/ · https://developer.apple.com/design/human-interface-guidelines/undo-and-redo |
| R45 | M3 snackbar: one action ("Undo"), ≤2 lines on mobile, height 48–64 dp, never in front of the nav bar, FAB or frequent targets | 2 lines / 48–64 dp | And | https://m3.material.io/components/snackbar/guidelines |

### 2.7 Forms and numeric entry
| ID | Rule | Threshold | Plat | Source |
|---|---|---|---|---|
| R46 | Use a keyboard that matches the content: decimal pad for load, number pad for reps. Use a number formatter and respect the locale's decimal separator | Pass/fail | Both | https://developer.apple.com/design/human-interface-guidelines/virtual-keyboards · https://developer.apple.com/design/human-interface-guidelines/text-fields |
| R47 | **Prefill with reasonable defaults.** Prefer choices over typing. Validate as values are entered | n/a | Both | https://developer.apple.com/design/human-interface-guidelines/entering-data · https://www.nngroup.com/articles/the-power-of-defaults/ |
| R48 | Mobile input checklist: good defaults? history or frequent values available? right keyboard? field visible with the keyboard open, in both orientations? | 14-item checklist | Both | https://www.nngroup.com/articles/mobile-input-checklist/ |
| R49 | Steppers only for small deviations from the default, not for large ranges. Pair with a text field when the jumps are big. The value being changed must be obvious | n/a | Both | https://developer.apple.com/design/human-interface-guidelines/steppers · https://www.nngroup.com/articles/input-steppers/ |
| R50 | Error prevention for slips: constraints, suggestions and good defaults rather than after-the-fact errors | n/a | Both | https://www.nngroup.com/articles/slips/ |
| R51 | An input accessory bar above the keyboard is the place for app-specific controls (next field, plate calculator: what both Hevy and Strong do) | n/a | iOS | https://developer.apple.com/design/human-interface-guidelines/virtual-keyboards |

### 2.8 Disclosure, density and heuristics
| ID | Rule | Threshold | Plat | Source |
|---|---|---|---|---|
| R52 | Progressive disclosure: show the few most important options and defer the rest. **Designs that go beyond 2 levels "typically have low usability."** The trigger needs strong information scent | ≤2 levels | Both | https://www.nngroup.com/articles/progressive-disclosure/ |
| R53 | Recognition over recall: the PREVIOUS value is visible on the row, with recent and frequent items surfaced | n/a | Both | https://www.nngroup.com/articles/recognition-and-recall/ |
| R54 | Score findings against the 10 heuristics (canonical list, updated 2020; heuristics unchanged since 1994) | 10 | Both | https://www.nngroup.com/articles/ten-usability-heuristics/ |
| R55 | Modal tasks stay short; no "app within an app"; the title names the task | n/a | iOS | https://developer.apple.com/design/human-interface-guidelines/modality |

### 2.9 Empty states and first run
| ID | Rule | Threshold | Plat | Source |
|---|---|---|---|---|
| R56 | Empty states communicate **status** (never "No records" while still loading), teach in context, and give a **direct path** to the key task | 3 functions | Both | https://www.nngroup.com/articles/empty-state-interface-design/ |
| R57 | No up-front onboarding when the UI can teach. Tutorials are skippable and findable later. Defer non-essential setup; teach by doing. Coach marks show one instruction at a time | n/a | Both | https://www.nngroup.com/articles/mobile-app-onboarding/ · https://www.nngroup.com/articles/mobile-instructional-overlay/ · https://developer.apple.com/design/human-interface-guidelines/onboarding |

### 2.10 Feedback, loading and offline
| ID | Rule | Threshold | Plat | Source |
|---|---|---|---|---|
| R58 | Response limits: **0.1 s** feels instant (the checkmark must hit this); **1 s** keeps flow; **10 s** holds attention | 0.1 / 1 / 10 s | Both | https://www.nngroup.com/articles/response-times-3-important-limits/ |
| R59 | Under 1 s: no skeleton or spinner. Skeletons suit full-page loads under 10 s; spinners a single module at 2–10 s | <1 s none | Both | https://www.nngroup.com/articles/skeleton-screens/ |
| R60 | M3: under 200 ms show the content directly; 200 ms–5 s use a loading indicator (24–240 dp, default 48 dp) | 200 ms / 5 s | And | https://m3.material.io/components/loading-indicator/guidelines · https://m3.material.io/components/progress-indicators/guidelines |
| R61 | Show something immediately; when offline show cached data plus a non-intrusive label (not an alert); refresh automatically | n/a | iOS | https://developer.apple.com/design/human-interface-guidelines/loading · https://developer.apple.com/design/human-interface-guidelines/alerts · https://developer.apple.com/design/human-interface-guidelines/progress-indicators |
| R62 | Integrate status feedback near the item it describes. Confirm significant completions (Finish), not every tap | n/a | iOS | https://developer.apple.com/design/human-interface-guidelines/feedback |

### 2.11 Rest timer, background, haptics, motion
| ID | Rule | Threshold | Plat | Source |
|---|---|---|---|---|
| R63 | Live Activity for tasks with a defined start and end, **≤8 h**. End it immediately when the task ends (the Lock Screen may keep it ≤4 h). Interactive controls only for essentials ("workouts" is named as an example). Lock Screen margin **14 pt**. The minimal presentation shows the remaining time, as the Timer app does | 8 h / 4 h / 14 pt | iOS | https://developer.apple.com/design/human-interface-guidelines/live-activities |
| R64 | Android 16 Live Update: ongoing, user-initiated, time-sensitive. Needs `POST_PROMOTED_NOTIFICATIONS`, `setRequestPromotedOngoing`, FLAG_ONGOING, no custom RemoteViews. A countdown chip via `setUsesChronometer` + `setChronometerCountdown` | Pass/fail | And | https://developer.android.com/develop/ui/views/notifications/live-update |
| R65 | Notifications: concise; no app name in the text; actions are short verbs; no action that merely opens the app; never the only channel for essential information | n/a | iOS | https://developer.apple.com/design/human-interface-guidelines/notifications |
| R66 | Haptics: use system patterns for their documented meanings (Success, Start/Stop for a timer, Selection for changing values); be consistent; don't overuse; complement visual and audio feedback; make them optional | n/a | iOS | https://developer.apple.com/design/human-interface-guidelines/playing-haptics |
| R67 | Android: "clear" haptics (crisp, discrete) to confirm state changes; use predefined `VibrationEffect`s | n/a | And | https://developer.android.com/develop/ui/views/haptics/haptics-principles |
| R68 | Reduce Motion: cut automatic and repetitive animation, swap motion for fades, tighten springs. Motion is never the only carrier of information. Avoid motion on frequent interactions (every set check). Animations can be cancelled | Pass/fail | Both | https://developer.apple.com/design/human-interface-guidelines/accessibility · https://developer.apple.com/design/human-interface-guidelines/motion |

### 2.12 Lists, swipe, reorder, navigation
| ID | Rule | Threshold | Plat | Source |
|---|---|---|---|---|
| R69 | Swipe-to-reveal: users expect it to be **destructive**. Keep the action set small, since actions behind a swipe are mostly undiscovered. The swiped content must stay identifiable | n/a | Both | https://www.nngroup.com/articles/contextual-swipe/ |
| R70 | M3 swipe: the primary action is the last, end-aligned option, and a full swipe triggers it. **Swipeable items must offer another route (e.g. a ⋯ icon)** | Pass/fail | And | https://m3.material.io/components/lists/guidelines |
| R71 | Drag-reorder: clear signifiers, a lift/ghost state, reshuffle on pointer position (not the item's edge), plus a precise alternative (R24) | n/a | Both | https://www.nngroup.com/articles/drag-drop/ |
| R72 | Tab bar is for **navigation, not actions**; single-word labels; badges only for critical information. iOS 26 can minimise the tab bar on scroll. M3 nav bar: 3–5 fixed destinations, filled icon when active. Predictive back is on by default for default back navigation (opt-out via `enableOnBackInvokedCallback="false"`); sheets and full-screen surfaces should preview on back. M3 top app bar fills with colour on scroll | n/a | Both | https://developer.apple.com/design/human-interface-guidelines/tab-bars · https://m3.material.io/components/navigation-bar/guidelines · https://developer.android.com/guide/navigation/custom-back/predictive-back-gesture · https://developer.android.com/design/ui/mobile/guides/patterns/predictive-back · https://m3.material.io/components/app-bars/guidelines |

Supporting platform notes that change the rules above:
- **iOS 26 Liquid Glass.** Toolbar buttons get the Liquid Glass treatment automatically. Use a scroll-edge effect rather than a solid background under controls. Keep to **≤3 toolbar groups**. (Toolbars change log: 9 Sep 2025 and 16 Dec 2025.) https://developer.apple.com/design/human-interface-guidelines/toolbars · https://developer.apple.com/design/human-interface-guidelines/buttons
- **Material 3 Expressive** (Google says this is "not M4"; 46 studies, 18,000+ participants, key elements spotted "up to four times faster"). It adds motion springs, emphasised type, 35 shapes and the new loading indicator. It is a Visual/Delight lever, not a requirement. https://m3.material.io/blog/building-with-m3-expressive
- **Gestures.** "Use shortcut gestures to supplement standard gestures, not replace them", and never shadow a system edge gesture. https://developer.apple.com/design/human-interface-guidelines/gestures · https://developer.android.com/design/ui/mobile/guides/patterns/predictive-back (avoid touch targets under the system gesture insets)

---

## 3. Competitor behaviour (current official docs, read 2026-10-11)

Hevy's help centre is Zendesk; every article below shows `updated_at` 2026-10-07 to 2026-10-11 in its API. Strong's help centre (Help Scout) shows no dates. Boostcamp has no public help centre that I could find, so its official marketing page is used instead.

### 3.1 Logging a set: prefill and the checkmark
- **Hevy.** Previous performance appears "on the left side under the column labelled **Previous**". A setting chooses whether PREVIOUS comes from **Any workout** or the **Same routine**, and it changes only the PREVIOUS column, not the weight/reps values. Routine values (the WEIGHT/REPS columns) update automatically after each workout unless "Update Routine Values" is toggled off on Save; they never update while a rep range is set. https://help.hevyapp.com/hc/en-us/articles/36011896355479 · https://help.hevyapp.com/hc/en-us/articles/34105442929943 · Feature page: "When you add an activity you've done before, the number of sets, the weight, and the reps you've done previously are also added". https://www.hevyapp.com/features/track-workouts/
- **Strong.** "enter the data/details of that set, such as the weight and reps performed, and complete it by hitting the **checkbox**"; "Swipe to Delete" a set; "You can finish your workout at any time (you don't need to complete all the exercises)". https://help.strongapp.io/article/229-my-first-workout. *(Strong's help centre does not document its Previous column; not verified here.)*
- **Boostcamp.** "Tap a set, the timer starts. Hit your reps, the next session's weight is already there." https://www.boostcamp.app/workout-tracker

### 3.2 Rest timer
- **Hevy.** Set per exercise ("Rest Timer" below the exercise name) or as a default in settings; the default applies only to exercises that never had a timer set manually. The timer starts automatically on set completion. While it runs, **+15 / −15**. The timer sound and volume (High / Normal / Low / Off) are separate from the set-check and PR sounds. The timer does **not** start when the next set is a drop set. https://help.hevyapp.com/hc/en-us/articles/35385404949143 · https://help.hevyapp.com/hc/en-us/articles/34896293707927
- **Hevy Live Activity (iOS and Android).** Shows the next activity, sets done and prescribed weight × reps; **mark a set complete without unlocking**; rest timer ±15 s or skip from the widget. https://help.hevyapp.com/hc/en-us/articles/35649846517399
- **Strong.** The default is **2:00**, triggered "immediately after a set is completed". The timer sits top-left and taps to full screen (adjust or Skip; full screen can be the default). Durations are set per exercise via ⋯, with **separate durations for warm-up and working sets**. https://help.strongapp.io/article/231-rest-timer

### 3.3 Supersets
- **Hevy.** ⋯ → "+ Add To Superset" → tap the partner exercise; more than 2 exercises makes a circuit. Each superset gets a **different colour**. **Smart Superset Scrolling** auto-scrolls to the next exercise in the group when a set is checked. https://help.hevyapp.com/hc/en-us/articles/35650286563095
- **Strong.** Grouped exercises show a **vertical line on the left**; "Next" jumps to the next set in the group. On iPhone you multi-select in Add Exercise and then tap Superset; on Android it is ⋯ → Create Superset → chain icon (Strong itself says the two platforms differ). https://help.strongapp.io/article/98-supersets-and-circuits

### 3.4 Routines and templates; finishing a workout
- **Hevy.** Workout tab → **New Routine**, then "Start Routine"; an empty workout via "+ Start Empty Workout"; repeat a past workout via ⋯ → Copy workout. **Finish** (top right) opens the Save Workout screen. If exercises or sets were added, removed or reordered, it asks **"Update Routine" vs "Keep Original Routine"**; it does not ask for rep or weight changes. Routines live in folders and move by "tap, hold, drag and drop". There is a cap of 150 sets per workout or routine. You can pause the workout by tapping the duration. https://help.hevyapp.com/hc/en-us/articles/35361530647959 · https://help.hevyapp.com/hc/en-us/articles/38387296276375 · https://help.hevyapp.com/hc/en-us/articles/34953606698903 · https://help.hevyapp.com/hc/en-us/articles/34513981310615
- **Strong.** "+ Template", or save a past workout as a template. Templates can't complete sets and **have no rest timer while editing**. Free users get **3 templates**. When a template-based workout changes, the options are **Update Template** (shown red when destructive), **Update Values Only**, **Update Template and Values** or **Keep Original Template**, and the prompt can be hidden. An empty workout prompts "Save as Template". Unwanted templates can be archived instead of deleted. https://help.strongapp.io/article/105-about-templates · https://help.strongapp.io/article/177-update-template · https://help.strongapp.io/article/106-edit-template

### 3.5 Warm-up sets and set types
- **Hevy.** Tap the **set number** → W / D / F (warm-up / drop / failure). The Warm-up Calculator (PRO) is ⋯ → Add Warm Up Sets, with a target weight and percentage formula plus plate and dumbbell rounding. Warm-ups are excluded from stats unless a setting includes them. RPE is an opt-in column, 6–10. https://help.hevyapp.com/hc/en-us/articles/34896293707927 · https://help.hevyapp.com/hc/en-us/articles/35650921359639 · https://help.hevyapp.com/hc/en-us/articles/33882110558743 · https://help.hevyapp.com/hc/en-us/articles/35687721776663
- **Strong.** Tap the set number → Set Tag menu (Warm-up / Drop / Failure; tap again to clear). **Warm-ups are excluded from charts and metrics.** The Warm-up Calculator (PRO) is ⋯ → Add/Update Warm-up Sets, for barbell, dumbbell and machine exercises. https://help.strongapp.io/article/166-set-tags · https://help.strongapp.io/article/171-warm-up-calculator
- **Boostcamp.** "apply customizable warmup sets to any working weight." https://www.boostcamp.app/workout-tracker

### 3.6 Reordering exercises; deleting
- **Strong.** "Reorder Exercises by **Drag and Drop** on the exercise name." https://help.strongapp.io/article/229-my-first-workout
- **Hevy.** "Tap the three dots next to any exercise to reveal a menu with additional options, such as to **reorder**, replace, or remove the movement" (a menu entry point rather than drag on the card). Delete a set: **swipe left** → Delete. Delete a workout or routine: ⋯ → Delete → **confirm** in a popup. https://www.hevyapp.com/features/track-workouts/ · https://help.hevyapp.com/hc/en-us/articles/38030200802583

### 3.7 Plate calculator
- **Hevy.** A **Calculator** button above the keyboard when the weight field is focused. Custom bars and plates via Manage; if the target can't be loaded exactly, it shows the closest reachable weight. https://help.hevyapp.com/hc/en-us/articles/34518876511383
- **Strong (PRO).** Tap the weight field, then the plate button on the right of the keyboard; it shows per-side plates. The bar defaults to 20 kg / 45 lb, changeable per exercise via ⋯ → Bar Type. https://help.strongapp.io/article/169-plate-calculator
- **Boostcamp.** "tells you exactly which plates to load on each side of the bar." https://www.boostcamp.app/workout-tracker

### 3.8 Changes since `train-template-ux.md` §2 (2026-08-18)
- Hevy warm-ups: the 08-18 note said "three-dot menu, *Add pre-designed warm-up sets*". The current label is **"Add Warm Up Sets"** with a **PRO** Warm-up Calculator.
- Hevy RPE: still opt-in in settings. Its range is now documented as **6–10**. The current RPE article no longer states the "not available during routine building" restriction, so treat that claim as unverified.
- New since 08-18: Hevy **Update Routine vs Keep Original** (structural changes only), the **Previous: Any workout / Same routine** setting, and **±15 s** rest adjust plus **lock-screen set completion** in the Live Activity.
- Strong: **four** update-template choices including **Update Values Only**, and separate rest durations for warm-up and working sets. Neither is in the 08-18 note.
- Reorder: Strong documents drag on the exercise name; Hevy's public docs show a ⋯ → reorder menu path. The 08-18 note's "reordering is drag-and-drop everywhere else" holds for Strong and Alpha Progression and for Hevy *folders*. It is not documented for Hevy *exercises within a workout*.

---

## 4. What a Train review must measure (derived checklist order)
1. Taps to log an as-planned set (target 1; Hevy, Strong and Boostcamp are all 1) and to start the next planned workout (target 1–2).
2. Set-row hit areas, measured in pt/dp per control (R1–R4), and the AX5 / 200 % layout of the set row (R9–R12).
3. Contrast of the done fill, checkbox outline and placeholder against the row background, in both themes (R15–R16, R18).
4. Accessible alternative and custom action for every swipe and drag (R23–R25); announcements for timer start and end, set logged and PR (R26).
5. Sheet stacking count (R30, R34), button placement (R31), and an inventory of confirm vs undo (R42).
6. Rest timer survives backgrounding and lock, with ±15 s and skip available outside the app (R63–R64; Hevy parity §3.2).

## Gaps (not verified this session)
- Strong's *Previous* column and its prefill behaviour are not documented in Strong's help centre, and strong.app's marketing page doesn't describe them.
- Hevy's drag-to-reorder of exercises inside a workout is not in its help centre; only the ⋯ → reorder path is documented.
- The HIG Sheets multi-step button-placement guidance (changed 24 Mar 2026) is delivered as images in tabs; only the single-view rule (Cancel leading, Done trailing) could be read as text.
