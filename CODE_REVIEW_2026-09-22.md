# Code review — apps/mobile, 2026-09-22

**A review artifact, not a status doc.** Triage it into `STATUS.md` (open work),
`UX_AUDIT.md` (UX backlog), an ADR (rationale) or GitHub issues, then **delete
this file** — same housekeeping rule as a plan doc. Git keeps the original.

**Tree reviewed:** `9358dc6f` (main). **Method:** six parallel agents, one per
surface, reading source only. Every finding cites `file:line` and a concrete
failure scenario. Findings marked ✅ below were independently re-verified
against the source by the orchestrator; the rest are agent-reported at the
evidence standard above and are worth confirming before you act on them.

**Scope delivered:** code review of every mobile surface, plus a mechanical
i18n audit. **Not delivered:** the Maestro UX sweep — blocked, see §0.

---

## §0 BLOCKER — the next iOS build will not launch (iOS 27 / UIScene)

Found by accident while preparing the UX sweep. This outranks everything else
in this document.

A Release build cut on `ignia-mac` today installs, launches, and dies on the
first frame:

```
Ignia[86451] (UIKitCore) failure in _UIApplicationEvaluateRuntimeIssueForNoSceneLifecycleAdoption
Application failed to launch: UIScene life cycle is required for apps built with this SDK.
```

Evidence:

| Fact | Value |
|---|---|
| Xcode on `ignia-mac` | **27.0** (`27A266a`) — upgraded since the 2026-09-17 build |
| iOS simulator runtimes available | **iOS 27.0 only.** `iOS-26-5` is gone; the device list still shows orphaned 26.5 devices |
| `Ignia-QA` runtime | now **iOS 27.0** (the suite README still says iPhone 17 / iOS 26.5) |
| Built app SDK | `DTSDKName = iphonesimulator27.0` |
| `UIApplicationSceneManifest` in built `Info.plist` | **absent** — no scene keys at all |
| `UIWindowSceneDelegate` in `react-native@0.86.2` | **none** (no `willConnectTo` anywhere) |
| `UIWindowSceneDelegate` in `expo@57.0.14` / `expo-modules-core` | **none** |
| `ios/Ignia/AppDelegate.swift` | pre-scene shape — builds `UIWindow(frame: UIScreen.main.bounds)` in `didFinishLaunchingWithOptions` |

**There is no `app.json`-only fix.** `UIApplicationSceneManifest` is a pointer
to a scene delegate, and this toolchain ships none — adding the key alone most
likely trades the launch abort for a black window.

**Production is NOT affected today.** App Store build 64 (1.2.3) was cut with
the previous Xcode and is unaffected. The exposure is the *next* iOS binary cut
on this machine.

**Caveat worth testing before acting:** the abort was observed on the iOS 27
*simulator*. The check is SDK-linked rather than simulator-specific, so a device
build with Xcode 27 should be treated as blocked until proven otherwise — but
that has not been measured here.

Options, none of them free:

1. **Pin the build host to Xcode 26.x** — restores the documented QA setup and
   unblocks builds with zero app changes. Needs an Xcode 26 download plus an
   iOS 26 simulator runtime. Expires whenever Apple raises the minimum SDK for
   App Store submission.
2. **Custom `SceneDelegate` via an Expo config plugin** — the genuine fix, ahead
   of upstream. Touches deep links, push, Live Activities, the widget and the
   watch target; several build cycles to validate. Note `app.json` is hashed
   whole, so this moves BOTH runtime fingerprints.
3. **Wait for Expo/RN upstream** to adopt UIScene, and cut no iOS build with
   Xcode 27 until then.

Side effect: **the Sep 17 QA binary is no longer a fallback** — it only ran
because the iOS 26.5 runtime still existed.

---

## §1 Cross-cutting patterns

These recur across slices and are worth fixing as classes, not as individual
lines.

1. **Optimistic UI vs. awaited Firestore acks.** `useTrain.ts:316` awaits every
   server ack, so offline the Start button does nothing and Finish hangs on
   "Saving…" forever — and a second tap mints a second `status:'active'`
   session that `getActiveSession`'s `limit(1)` will hide. Food logging already
   solved this with the durable queue (ADR-0020); Train does not use it.
   `EntrySheet.save()` has no catch, so a rejected *edit* leaves the typed value
   on screen and the user believing it saved.

2. **Index keys over components holding their own text buffers.** `SetRow`
   (`train.tsx:1479`) and `CardioBlockCard` (`train.tsx:1111`) key on array
   index while seeding `useState` buffers at mount. Delete a row and the deleted
   row's numbers render on — and get typed into — the row that slides up.

3. **Silent no-ops on CTAs a new user cannot get past.** Clearing the onboarding
   protein field leaves "Set my plan" fully enabled and doing nothing
   (`onboarding.tsx:258`); typing ≥1000 fails the rules and reports *"verify
   your email"*. On sign-in, once `pendingLink` is set it hides every subsequent
   error permanently, and no screen calls the exported `clearPendingLink`.

4. **Time.** ✅ Nothing in the app re-derives the day key — verified, the grep
   is empty. Today never rolls over on its own, and `useWidgetSync` recomputes
   `dayStamp` fresh on foreground while reading stale totals, writing
   **yesterday's numbers under today's dateKey** — the exact defect dateKey
   exists to prevent.

5. **Accessibility is correct in some files and wholly absent in others.**
   `settings.tsx`, `connected-apps.tsx`, `refine-targets.tsx`, `coach.tsx` and
   `SignInMethodsCard.tsx` have *zero* accessibility props between them. Touch
   targets run 22–36pt against the 44pt minimum on the most-tapped controls:
   Train's done box (30), set-number cell (24), water pills (26), coach chips
   (26), "Forgot password?" (22).

6. **Unit and locale drift at the display layer.** Trends prints `lb/wk` to
   metric users while the Body chip converts correctly; the share card is
   pounds-only; `fl oz`, the `P`/`C`/`F` initials and `8 PM` are hardcoded
   English; several weight call sites bypass `formatNumber`, so pt-BR sees
   `81,6` and `81.6 kg` on one screen.

---

## §2 Findings by surface

### Today (`index.tsx`, `DailyMetrics`, `HeroRings`, `MealEntries`, …)

- **[HIGH] `useToday.ts:271`** — `todayKey` computed at render with no clock
  trigger; Today never rolls over. Poisons the widget as above. ✅
- **[HIGH] `index.tsx:118` + `:478`** — `useRecalibration` mounted twice, so a
  second full `useCoreSnapshot` opens. `subscribeRecentLogs(…, 400)` attaches
  **four** times per focus of the most-visited tab instead of three.
- **[HIGH] `UpdateBanner.tsx:22`** — dismissing the store-update banner doesn't
  reach the `useStoreUpdate` instance owning the Nudge slot, permanently
  suppressing the recalibration card; also two `app-version.json` fetches per
  mount.
- **[MED] `DailyMetrics.tsx:472`** — Sleep sheet re-keys on `initial`, so a
  Health/Oura import overwrites what the user is typing. `WaterModal` above it
  has the correct `[visible]` shape.
- **[MED] `useMilestones.ts:139`** — listener is mount-gated and untracked (not
  `useLedgerFeed`), and ignores snapshot provenance, re-attempting earned-
  milestone writes on every offline launch.
- **[MED] `index.tsx:281`** — "Repeat yesterday" fires a success haptic when it
  copied zero rows, and has no catch.
- **[MED] `MicButton.tsx:101`** — unmounting while listening never calls
  `stopListening()`; the OS mic indicator stays lit.
- **[MED] `DailyMetrics.tsx:249`** — ~26dp controls, 4dp apart, no `hitSlop`.
- **[MED] `DailyMetrics.tsx:242`** — hardcoded `fl oz`; es-PR says `oz` in the
  sheet it opens.
- **[LOW]** `MealEntries.tsx:22` hardcoded `P`/`C`/`F`; `HeroRings.tsx:200`
  bypasses `formatNumber`; `useDayFasts.ts:60` docstring describes a call site
  that no longer exists.

### Train (`train.tsx` 2186 lines, `components/train/**`)

- **[HIGH] `train.tsx:1479`** — `SetRow` index key + own text buffers (pattern 2).
- **[HIGH] `train.tsx:1810`** — the one-tap done fallback tests the local text
  buffer, not the set, so it overwrites an engine load the user just accepted
  with last session's weight; the engine then reads a stall.
- **[HIGH] `useTrain.ts:316`** — awaits server acks (pattern 1).
- **[HIGH] `train.tsx:1306`** — `engineHasCall = rec.action !== 'none'`
  suppresses the whole recommendation note, cancelling ADR-0040 decision 4 at
  the render layer while the pure function is unit-tested for it. "Next session"
  renders nothing for a straight-set template while the toggle flips to "Hide".
- **[MED]** `TemplateEditorModal.tsx:622` stores a metric user's 2.5 **kg**
  default increment as 2.5 **lb**; `useTrain.ts:229` focus refetch can overwrite
  a local edit; `useRestTimer.ts:44` has no wall-clock anchor so it freezes when
  backgrounded; `useTrain.ts:664` omits `profile` from deps, pinning the day
  boundary; `train.tsx:1111` cardio index keys; `train.tsx:1584` deletes a fully
  logged exercise on one menu tap with no confirm; `train.tsx:317` start has no
  debounce and its guard sits behind an await.
- **[LOW]** `train-styles.ts:149` 24pt/30pt targets, done box has no checkbox
  role; `train-styles.ts:609` "SKIP" at ~2.6:1 on the dark rest bar;
  `train.tsx:1319` re-implements `structureOf` inline beside its unused import.

### Food logging (`scan.tsx`, `FoodSearch`, `EntrySheet`, `RecipeBuilder`, …)

- **[HIGH] `scan.tsx:384`** ✅ — `rescaleScannedItem` rescales from the item's
  already-rounded current values, per keystroke. Typing `150` over `100 g` runs
  1→15→150 and lands **300 kcal / 0 P** instead of 360 / 6.6. Clearing the field
  first sets `grams: 0`, after which the `item.grams <= 0` early return means
  macros stay zeroed **permanently**.
- **[HIGH] `off-product.ts:235`** — a barcode with only per-100 g data prefills
  100 g of macros with nothing on screen saying "per 100 g". A 330 ml bottle
  logs 42 kcal instead of ~139. Directly against ADR-0013's grams-first rule.
- **[MED]** `EntrySheet.tsx:409` one-tap relog of a recent meal drops carbs and
  fat (and mirrors the gap to Apple Health); `scan.tsx:342` applies a quantity
  whose *unit* it discarded ("2 tbsp" → 2 servings); `scan.tsx:350` asserts
  `carbs: 0, fat: 0` for foods that simply have none, tripping a false
  macro-mismatch warning; `EntrySheet.tsx:282` swallows failed edit/delete;
  `BarcodeScanner.tsx:151` paints `colors.ink` and draws `colors.white` on it —
  white-on-white in dark theme.
- **[LOW]** `FoodSearch.tsx:163` no stale-request guard on `openDetail`;
  `FoodSearch.tsx:414` 36pt steppers, unlabelled; `RecipeImport.tsx:200`
  2.3:1 contrast in dark; `scan.tsx:349` re-implements `scaleCustomFood` with
  different rounding, so the same food logs 5 g here and 4.5 g in the add sheet.

### Body / Trends / History

- **[HIGH] `useHistory.ts:55`** ✅ — the calendar is backed by
  `LOG_WINDOW_ROWS = 400` (core's own docs: ~84 logged days) while
  `history/index.tsx` pages back forever. A fully-logged month beyond the window
  renders blank. This is precisely the ADR-0004 footgun, and `CONTEXT.md:217`
  claims `useHistory` is all-time, which the code contradicts.
- **[HIGH] `history/[date].tsx:55`** — a day outside the window renders as a real
  `0 kcal` day with "No entries" and a FAB inviting a re-log; duplicates then
  feed the TDEE estimator. No loaded/not-loaded discriminator.
- **[HIGH] `useBody.ts:158,174,185`** — Body's three weight windows drop the day
  boundary that every sibling threads, so Body and Trends print two different
  slopes for the same quantity for anyone with a non-midnight day start.
- **[MED]** `trends.tsx:702` Budget strip renders an unlogged day identically to
  a future day and banks the gap as surplus; `Sparkline.tsx:36` plots a
  gap-compressed series on an index axis, so a 7-day forecast occupies 78% of the
  chart; `trends.tsx:41` prints `lb/wk` to metric users; `trends.tsx:120` vs
  `:132` — "This week" is a trailing 7 days on one face and the ISO week on the
  other, under one label; `history/index.tsx:153` a workout-only day tells three
  different stories on three surfaces; `body.tsx:235` bypasses `formatNumber`;
  `share-card.ts:43` is pounds-only and locale-blind; `history/index.tsx:101`
  calendar cells have no role or label.
- **[LOW]** `trends.tsx:510` tab strip has no role and a sub-44pt target.
- **Incidental:** `useTrends.ts:127` computes `weightSeries` every render and
  nothing consumes it — dead code, and notably the only boundary-aware copy of
  the window `useBody` should have been using.

### Settings / Coach / Targets

**Flag audit: no leaks.** Every purchase and AI-cost surface traces to a literal
`false`; `isPro` forced true unlocks only non-cost perks, as intended; Coach sits
behind both server guards; no Stripe residue beyond the historical `stripeRole`
name.

- **[MED]** `refine-targets.tsx:186` — tapping the activity row you are *already*
  on deletes your stored device multiplier, moving the calorie target by up to
  ~140 kcal/day silently; `coach.tsx:32` maps ceiling/kill-switch rejections to
  "Something went wrong. Please try again.", inviting retries that cannot
  succeed and re-invoke the function; `daily-targets.tsx:131` accepts a custom
  protein target below the user's own floor, saves it, then silently overrides
  it; `connected-apps.tsx:86` three health handlers await rejectable calls with
  no catch (unhandled rejection, no user feedback) — same shape in five Settings
  handlers including `signOut`; `settings.tsx:151` the delete-account failure
  path leaves the user signed in with an invalid token even when the server may
  have completed the deletion (Apple 5.1.1(v) surface);
  `SignInMethodsCard.tsx:97` weak-password gets a generic error the sign-up
  screen handles specifically.
- **[LOW]** `settings.tsx:57` hardcoded English AM/PM beside a 24-hour pt-BR
  label; zero accessibility props across all five files; `coach.tsx:252` ~26pt
  chips where a mis-tap spends a daily consultation.
- **[LOW, ADR rather than code] `tdee.ts:1300`** — the device multiplier *does*
  reach the target at partial confidence, because `trueTdee` blends toward a
  Mifflin anchor that prefers `profile.activityMultiplier`. The pinning test only
  covers a 120-day history where confidence is 1. Recommendation: amend
  ADR-0024's absolute wording and add a 20-logged-day case — not a math change.

### Auth / onboarding / shell

- **[HIGH] `sign-in.tsx:284`** — `pendingLink` permanently hides every
  subsequent error; `clearPendingLink` has zero screen callers.
- **[HIGH] `onboarding.tsx:258`** — protein ≥1000 is accepted by the client,
  rejected by the rules, and reported as "verify your email".
  `validateProteinTarget` exists and is not called.
- **[HIGH] `onboarding.tsx:188,230,258`** — clearing the protein field leaves the
  final CTA enabled and inert.
- **[MED]** `sign-in.tsx:426` cancelling **Apple** sign-in says **Google** was
  cancelled, in all three locales, on the platform where Apple sign-in is
  mandatory; `onboarding.tsx:666` a rejected kcal value greys the CTA with no
  explanation unless the issue is `belowFloor`; `verify-email.tsx:68` Resend
  latches off permanently after one success; `onboarding.tsx` Android hardware
  back mid-funnel quits the app and discards every answer; `auth.tsx:1041` a
  failed verification send is swallowed, so the wall claims a mail is in flight
  that never was; `verify-email.tsx:116` none of the three controls is exposed as
  a button.
- **[LOW]** `sign-in.tsx:345` Google button painted disabled but pressable, with
  the wrong message; `HeaderAvatar.tsx:36` hardcoded English a11y label on the
  only Settings entry point; `sign-in.tsx:319` "Forgot password?" is the smallest
  target on the screen at ~22pt.
- **Theming: clean.** Zero static `colors` imports anywhere in `apps/mobile/src`;
  zero `type.display`/`type.heading` + `fontWeight` pairings; `onInk` and
  `inputBg` used correctly throughout the slice.

---

## §3 i18n audit (mechanical, all three locales)

| Metric | en | es-PR | pt-BR |
|---|---|---|---|
| Keys | 1305 | 1305 | 1305 |
| Missing vs en | — | 0 | 0 |
| Orphans | — | 0 | 0 |
| Placeholder mismatches | — | 0 | 0 |

**Key parity is perfect and test-enforced.** The residual risk is *value*
parity, which nothing checks: **13 strings are English in one locale and
translated in the other** — 6 English-in-es-PR (`settings.themeSystem`,
`settings.legal`, `metrics.fastMinutes`, `settings.dayStartHour`,
`settings.healthSection`, `tour.numbers.calories`) and 7 English-in-pt-BR
(`train.kind.drop`, `train.weekVolume`, `train.glossary.volume`, `water.unit`,
`water.preview`, `cardio.hrUnit`, `cardio.via`).

**Structural note:** `es-PR.ts:5` declares `Record<I18nKey, string>` inline;
`pt-BR.ts:4` does not (bare `as const`), so pt-BR is only caught one level
removed by `registry.ts:32`. That asymmetry is the structural reason the
2026-09-16 two-of-three-locales incident was possible. Adding the annotation to
`pt-BR.ts` moves the error to the file that is wrong.

---

## §4 Harness and host findings

- **`22-train-rest-pause.yaml` is not in `config.yaml`'s `flowsOrder`.** It
  therefore runs unpinned *after* `20-units-metric`, which the config explicitly
  requires to stay last ("20 flips the account to metric and restores it in its
  own tail — keep it LAST"). The config's own comment says a new flow file MUST
  be added to both. Add `22-train-rest-pause` before `20-units-metric`.
- **`.maestro/regression/README.md` is stale on the host setup.** `Ignia-QA` is
  now iOS **27.0**, not iPhone 17 / iOS 26.5, and the `simctl create` recipe
  names a runtime (`iOS-26-5`) that no longer exists on the machine.
- **No ADC on `ignia-mac`**, so `scripts/qa-regression-verify.mjs` cannot run
  here — the Firestore ground-truth half of flows 11–13 and the whole
  fresh-account arc (`empty/`, which needs `reset-empty`) are unavailable on
  this host. Worth noting that three HIGH findings above sit in exactly that
  unrunnable funnel.
- **`DerivedData` is now 20 GB** (was 11 GB before today's builds) and free disk
  went 67 GB → 37 GB. The suite README says to clear it after a session.
- **The machine is shared and was heavily contended** throughout: another
  project's Maestro suite ran on the `iPhone 17` sim for the entire session,
  alongside an Android emulator, on 16 GB. One build died at
  `[CP-User] Build ExpoModulesJSI xcframework` under that pressure and succeeded
  on a clean retry.

---

## §5 Not covered

- **The entire UX/visual review** — no screenshots were captured. Blocked by §0.
- **Fresh-account arc** (onboarding funnel, every empty state) — needs ADC.
- **Barcode and mic** — camera and speech recognizer are unavailable on a
  simulator; both are hardware-only checks per `coverage.md`.
- **Android** — no host decision made this session; the sweep was iOS-only by
  request.
