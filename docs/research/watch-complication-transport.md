> **VERDICT** — With any transport we control, "calories left today" on a watch face is a best-effort, minutes-to-an-hour-stale number that goes arbitrarily stale when watch and phone part company; `WCSession.updateApplicationContext` (A1) is the only option that preserves the widget's $0, no-network, no-auth design, and reading Firestore directly on the watch (B) is structurally unavailable, not merely expensive.
> **Status:** OPEN QUESTION REMAINS (the transport choice belongs to #37; every latency and budget number here is device-gated) · **Researched:** 2026-07-24
> **Read this only if:** you are choosing, implementing, or costing the phone-to-watch hop for the complication — or designing what the face shows when the snapshot is stale.
> **Do not** re-derive the conclusions below; cite them.

# How does a snapshot reach a watch complication, and how fresh can it honestly be?

Research for [#34](https://github.com/gabandres/fitness-tracker-pwa/issues/34), on the map
[Apple glanceable surfaces — iPhone Lock Screen + Watch face complication](https://github.com/gabandres/fitness-tracker-pwa/issues/31).

**Date:** 2026-07-24 · **Verdict:** *no winner picked* — [#37](https://github.com/gabandres/fitness-tracker-pwa/issues/37)
owns the choice. This doc is the price list.

---

## Scope

[#32](https://github.com/gabandres/fitness-tracker-pwa/issues/32) established that we *can* generate
a watch app + complication from managed prebuild
(`docs/research/watchos-target-viability.md`), and that the complication's free App Group
(`group.fit.ignia.app`, via `appGroupsByDefault`) shares a container **with the watch app on the
watch** and never with the phone. This ticket asks the next question: what carries
`packages/core/src/widget-snapshot.ts`'s 152-byte blob across that gap, and what does the user
actually see on their wrist.

Everything below is measured against the existing iOS widget's design (`apps/mobile/targets/widget/index.swift`,
`apps/mobile/src/lib/widget.ts`): **snapshot, not subscribe — no network, no auth, no Firestore in
the rendering process.**

---

## Options at a glance

| | Freshness (realistic) | GCP / Firestore cost | Swift work | RN / JS work | New deps | Risk |
| --- | --- | --- | --- | --- | --- | --- |
| **A1 · `WCSession.updateApplicationContext`** (latest-wins) | minutes when watch is near phone; **unbounded while out of range**; throttled by the WidgetKit reload budget on heavy days | **$0** | watch app (WCSession delegate + background task + App Group write + reload) | phone-side WCSession bridge | one RN native module (or write our own) | delivery is explicitly *opportunistic*; watch-side wake is a documented but unbenchmarked path |
| **A2 · `WCSession.transferUserInfo`** (FIFO, guaranteed) | same as A1 | **$0** | same as A1 | same as A1 | same as A1 | N logs ⇒ N background wakes ⇒ N reload requests against a 40–75/day budget. Strictly worse than A1 for a latest-value payload |
| **A3 · `transferCurrentComplicationUserInfo`** (the complication channel, **50/day documented**) | would be the best of the three, *if it worked* | **$0** | same as A1 | same as A1 + budget accounting | same as A1 | **Apple staff, Jul 2024: "does not currently work with WidgetKit-based complications."** One unverified Jul 2026 community report says it works on 26.5 |
| **A4 · `WCSession.sendMessage`** | instant, but only while **both apps are foreground** | **$0** | trivial | trivial | same as A1 | phone→watch `sendMessage` does **not** wake the watch counterpart. Useless for a complication |
| **B · Watch app / complication reads Firestore directly** | on-demand, but see the budget section — the render process still only wakes 40–75×/day | **breaks the $0 design.** ~70–630 reads/user/day (working below) | large: Firebase SPM into a watchOS target, auth bootstrap, networking | token hand-off over WCSession anyway | `firebase-ios-sdk` (SPM) | **Cloud Firestore has no watchOS support in Firebase's own platform matrix.** Auth is "partial". Dead as drawn |
| **C · WidgetKit push notifications** (`WidgetPushHandler`) | opportunistic, works with the phone out of range | CF invocation per log write, **plus** whatever B costs to actually fetch the data | push handler + fetch path | token registration + a Cloud Function | APNs key, server work | **watchOS 26.0+ floor.** A push *reloads the timeline*; it carries **no payload**, so it doesn't solve the data problem on its own |

The honest read of this table: **A1 is the only option that preserves the widget's $0, no-network,
no-auth design**, and B is not merely expensive but structurally unavailable. That is a finding,
not a recommendation — #37 still owns the call, and there are reasons (LTE watches, phone-free
users) that might make someone want to pay for B or C anyway.

---

## Option A — WatchConnectivity (`WCSession`)

### The four methods, compared

All four are `[String: Any]` **property-list types only**, and all four are programmer errors
unless `activationState == .activated`.

| | Delivery | Counterpart must be reachable? | Wakes the watch app in the background? | Available |
| --- | --- | --- | --- | --- |
| `updateApplicationContext(_:)` | **Latest-wins.** "This method replaces the previous dictionary that was set" | **No** — "You may call this method when the counterpart is not currently reachable" | **Yes** | iOS 9 / watchOS 2 |
| `transferUserInfo(_:)` | **Queued FIFO.** "queued on the other device and delivered in the order in which they were sent… the transfer operation continues even if the app is suspended" | No | **Yes** | iOS 9 / watchOS 2 |
| `transferCurrentComplicationUserInfo(_:)` | Queued, but on a privileged complication channel | No | **Yes** | **iOS 9 only** — there is no watchOS row; it is phone→watch only |
| `sendMessage(_:replyHandler:errorHandler:)` | Immediate, serial | **Yes.** "Sending messages to a counterpart that is not reachable results in an error" | **No** — "Calling this method from your iOS app does not wake up the corresponding WatchKit extension" | iOS 9 / watchOS 2 |

Sources: [`updateApplicationContext(_:)`](https://developer.apple.com/documentation/watchconnectivity/wcsession/updateapplicationcontext(_:)),
[`transferUserInfo(_:)`](https://developer.apple.com/documentation/watchconnectivity/wcsession/transferuserinfo(_:)),
[`transferCurrentComplicationUserInfo(_:)`](https://developer.apple.com/documentation/watchconnectivity/wcsession/transfercurrentcomplicationuserinfo(_:)),
[`sendMessage(_:replyHandler:errorHandler:)`](https://developer.apple.com/documentation/watchconnectivity/wcsession/sendmessage(_:replyhandler:errorhandler:)),
[`isReachable`](https://developer.apple.com/documentation/watchconnectivity/wcsession/isreachable).

`updateApplicationContext` is the shape our payload already has. `widget-snapshot.ts` is a
last-known-value blob with a `widgetSnapshotChanged` guard in front of it — a queue would deliver
a history nobody wants and burn a background wake per entry.

### Payload size: Apple publishes no number

`WCError.Code.payloadTooLarge` exists and is documented only as *"An error indicating an attempt to
send an item that exceeds the maximum size limit"*
([WCError.Code](https://developer.apple.com/documentation/watchconnectivity/wcerror-swift.struct/code)).
Apple states **no byte figure** on any of the four method pages or on the framework page. The
commonly-repeated 65,536-byte figure is **community folklore, unverified** — do not put it in a
comment as if Apple said it.

It does not matter for us. The blob is:

```
{"v":1,"dateKey":"2026-07-24","kcalConsumed":1234,"kcalTarget":2100,
 "proteinConsumed":98,"proteinTarget":150,"updatedMs":1753372800000,"locale":"es-PR"}
```

**152 bytes** as JSON, and every field is already a property-list type — so it can travel as a
native 8-key dictionary with no JSON step at all. Whatever the undocumented ceiling is, we are
three orders of magnitude under it.

### The 50/day complication budget — real, documented, and probably unusable

Apple documents the number precisely, which is rare in this area:

> The number of remaining times that you can call `transferCurrentComplicationUserInfo(_:)` during
> the current day. If this property is set to 0, any additional calls to
> `transferCurrentComplicationUserInfo(_:)` use `transferUserInfo(_:)` instead.
>
> **If the complication is on the active watch face, you are given 50 transfers a day. If the
> complication is not active, this property defaults to 0.**
>
> — [`WCSession.remainingComplicationUserInfoTransfers: Int`](https://developer.apple.com/documentation/watchconnectivity/wcsession/remainingcomplicationuserinfotransfers) (iOS 10.0+)

Paired with [`isComplicationEnabled: Bool`](https://developer.apple.com/documentation/watchconnectivity/wcsession/iscomplicationenabled),
whose docs say calls "fail immediately" when it is `false`.

**Neither property is marked deprecated** in Apple's current documentation (iOS 9.0+ / iOS 10.0+,
`deprecated: false`, no deprecation summary), and `transferCurrentComplicationUserInfo(_:)` itself
is likewise not deprecated. ClockKit's deprecation did not take these with it.

**But they appear not to function with WidgetKit complications.** On
[Apple Developer Forums thread 759389](https://developer.apple.com/forums/thread/759389) (Jul 2024)
an Apple *Frameworks Engineer* gave the accepted answer to exactly our architecture — phone
`transferCurrentComplicationUserInfo` → watch `didReceiveUserInfo` → App Group → `reloadAllTimelines`:

> Unfortunately, `transferCurrentComplicationUserInfo()` does not currently work with
> WidgetKit-based complications.

The longer-running [thread 735352](https://developer.apple.com/forums/thread/735352) (Aug 2023 →
Jul 2026, Apple bug **FB12926788**) adds, as **community reports, unverified**: that
`isComplicationEnabled` returns `false` on watchOS 10 when the complication is only in the Smart
Stack; that WatchKit-lifecycle watch apps fail here where pure-SwiftUI watchOS 9+ apps work; and —
from a July 2026 post — that on iOS/watchOS 26.5 the call *did* wake a backgrounded watch app and
the complication *did* re-render. That last report is the only positive signal and it is one
person's device.

**Practical consequence for #37:** design on `updateApplicationContext`, and treat
`transferCurrentComplicationUserInfo` + its 50/day allowance as a *possible bonus* to probe on
device, not a load-bearing beam. Also note that a WWDR engineer's guidance in the same thread is
that the reload decision is the system's, and that Console.app system logs will tell you when
you have exceeded the daily budget — which is the only way anyone gets a real number out of this.

### The wake-up chain — every link cited

1. **Phone → system.** RN calls `updateApplicationContext(snapshot)`. Apple: *"The system sends
   context data when the opportunity arises, with the goal of having the data ready to use by the
   time the counterpart wakes up."* Note what that sentence does **not** promise.
2. **System → watch app process.** [`WKWatchConnectivityRefreshBackgroundTask`](https://developer.apple.com/documentation/watchkit/wkwatchconnectivityrefreshbackgroundtask)
   (watchOS 3.0+): *"when this background watch connectivity task is triggered, **the system
   launches your app in the background**"* — and it names all four transfer methods, including
   `updateApplicationContext(_:)`, as triggers. This is the link the whole design rests on, and
   Apple states it plainly.
3. **Modern lifecycle.** The same page: *"In watchOS 9 and later, SwiftUI Background tasks are the
   preferred way."* [`Scene.backgroundTask(_:action:)`](https://developer.apple.com/documentation/swiftui/scene/backgroundtask(_:action:))
   is watchOS 9.0+, and [`.watchConnectivity`](https://developer.apple.com/documentation/swiftui/backgroundtask/watchconnectivity)
   is watchOS 9.0+. This matches the Xcode-14-style single-target SwiftUI watch app that
   `@bacons/apple-targets` generates (`docs/research/watchos-target-viability.md`) — no `WKExtensionDelegate`.
   The forum evidence above says the SwiftUI lifecycle is also the one that *works*.
4. **Watch app → App Group.** `WCSessionDelegate.session(_:didReceiveApplicationContext:)` fires;
   the watch app writes `UserDefaults(suiteName: "group.fit.ignia.app")` — the container the
   `watch-widget` target already gets for free.
5. **App Group → pixels.** `WidgetCenter.shared.reloadTimelines(ofKind:)`
   ([watchOS 9.0+](https://developer.apple.com/documentation/widgetkit/widgetcenter/reloadtimelines(ofkind:))).
   Then the budget section below applies.

Defer `setTaskCompleted()` until `WCSession.hasContentPending` is false — Apple calls this out
explicitly on the background-task page.

### The React Native bridging question

`apps/mobile/package.json` has **no WatchConnectivity module of any kind** today. `WCSession` lives
on the *phone*, and our phone app is React Native, so link 1 of the chain needs a native module.
Three candidates, all inspected at source:

**`react-native-watch-connectivity` — the strongest option.**

- `2.0.0`, published **2026-03-20** (npm registry), after a 3.5-year gap from `1.1.0` (2022-09-29).
  The 2.0.0 changelog entry is one line: *"Modernised project scaffold."*
- **New Architecture: yes.** `package.json` declares `codegenConfig: { name: "WatchConnectivitySpec", type: "modules" }`
  and `src/NativeWatchConnectivity.ts` is a `TurboModule` spec. README states **"React Native 0.76+"**
  — we are on 0.81.5.
- **API surface is exactly right.** The spec exports `updateApplicationContext`, `getApplicationContext`,
  `transferUserInfo`, **`transferCurrentComplicationUserInfo`**, `sendMessage`, `sendMessageData`,
  file transfer, and reachability/paired/installed hooks. `ios/WatchConnectivity.mm` calls straight
  through to `WCSession`.
- **Gap:** it does **not** expose `remainingComplicationUserInfoTransfers` or `isComplicationEnabled`
  (grepped the `.mm` — absent). So if #37 ever wants to budget-account complication transfers, that
  is a patch or a fork.
- **Expo:** README says only *"This library has been successfully used in Expo apps (Bare Workflow
  with EAS Build)"*, and the published `files` list contains **no `app.plugin.js`** — so there is no
  Expo config plugin. That is probably fine rather than fatal: WatchConnectivity needs no
  entitlement and no `Info.plist` key, so Expo autolinking via the shipped `react-native.config.js`
  + podspec should pick it up during `expo prebuild`. **Unverified** — nobody has run it here, and
  "Bare Workflow" is the only Expo configuration the author claims.

**`expo-watch-connectivity` — right shape, wrong maturity.**

- A real Expo Module (`expo-module.config.json`, Swift + Kotlin), so it autolinks cleanly under CNG.
- `0.1.8`, published **2025-02-16**; repo `Duell10111/expo-watch-connectivity` last pushed
  2025-02-16, **0 stars**, no README (the GitHub `README.md` 404s), `peerDependencies: { expo: "*" }`
  — no SDK 54 claim.
- Its `index.d.ts` exposes `updateApplicationContext` / `getApplicationContext` /
  `addApplicationContextListener`, `sendMessage`, file transfer and reachability — **but no
  `transferUserInfo` and no `transferCurrentComplicationUserInfo`.** For an A1-only design that is
  sufficient; for anything else it is a dead end.

**`react-native-watch-connectivity-expo`** — a single 2024-06-09 publish of a fork whose
`repository` URL points at a GitHub *branches* page. Not a serious candidate.

**If neither survives contact:** the honest answer is a custom Expo Module in
`apps/mobile/modules/`. The surface is small — it is not a general WatchConnectivity binding, it is
one function. Roughly: a Swift `WCSessionDelegate` singleton activated at module init, plus
`isSupported`/`isPaired`/`isWatchAppInstalled` getters and a single
`updateApplicationContext(record: [String: Any])` async function. No events needed on the phone side,
because the phone never listens — the watch does. That is materially less code than the existing
`apps/mobile/src/lib/widget.ts` adapter, and it removes a dependency whose maintenance history is a
3.5-year gap.

Note that whichever way this goes, the module only buys link 1. Links 2–5 are hand-written Swift in
the watch app regardless — which is the same conclusion `docs/research/watchos-target-viability.md` reached:
React Native does not run on watchOS.

---

## Option B — a watch app talking to Firestore directly

**Cloud Firestore does not support watchOS.** Firebase's own platform matrix
([Firebase — library support by platform](https://firebase.google.com/docs/ios/learn-more#firebase_library_support_by_platform))
has an **empty watchOS cell** for Cloud Firestore, and the page's preamble says *"For the time being,
visionOS and watchOS are community-supported only."* Parsed in full, the watchOS column reads:

| Product | watchOS |
| --- | --- |
| **Cloud Firestore** | **— (blank)** |
| **Realtime Database** | **— (blank)** |
| **Authentication** | **partial** |
| Cloud Functions | ✔ |
| Cloud Messaging | ✔ |
| Cloud Storage | ✔ |
| Remote Config, Crashlytics, A/B Testing, Installations | ✔ |
| Analytics | — (blank) |
| App Check (DeviceCheck / App Attest) | watchOS 9+ |

The `firebase-ios-sdk` README agrees and is blunter: *"Firebase provides official beta support for
macOS, Catalyst, and tvOS. visionOS and watchOS are community supported… there may be some changes
where the SDK no longer works as expected on watchOS."*
([README](https://github.com/firebase/firebase-ios-sdk/blob/main/README.md)). `Package.swift`
declares `.watchOS(.v7)` at package level, so *things compile* — that is not the same as Firestore
being supported, and the matrix is the authority.

Three further problems, any one of which is disqualifying on its own:

1. **We don't even use that SDK.** `apps/mobile` uses the **Firebase JS SDK** (`firebase@^12.11.0`),
   which does not run on watchOS at all. This would introduce `firebase-ios-sdk` via SPM into a
   target generated by `@bacons/apple-targets` — and the plugin's config surface
   (`frameworks`, `entitlements`, `deploymentTarget`, …) has no SPM-package field.
2. **Auth state cannot get there.** Firebase Auth is "partial" on watchOS, and an auth session is
   not a thing that crosses devices — App Groups are per-device (established in #32), and Firebase
   does not mark its keychain items iCloud-synchronizable. The only realistic bootstrap is *minting
   a custom token on the phone and shipping it over WCSession* — i.e. you build Option A anyway, and
   then build Option B on top of it.
3. **It inverts the design.** `packages/core/src/widget-snapshot.ts`'s header comment is explicit:
   *"the widget renders that blob without any network or auth."* `index.swift`'s header repeats it.
   Undoing that is a real architectural decision, not an implementation detail.

### The read-count price, so #37 can price it

There is no watchOS Firestore client, so the only Firebase-native path is
**watch → callable Cloud Function → CF reads Firestore**. Order of magnitude, per user per day, at
a plausible cadence of one refresh per waking ~15 min (≈70 refreshes/day — which is also roughly the
reload ceiling, see below):

| Shape | Reads/user/day | Spark free tier (50,000 reads/day) exhausted at |
| --- | --- | --- |
| One denormalized "today" doc per user | ~70 | **~700 users** |
| Re-query today's `dailyLogs` (~8 docs) + profile | ~630 | **~79 users** |

Free-tier and listener-billing figures from [Firestore — Understand billing](https://firebase.google.com/docs/firestore/pricing):
50,000 document reads/day, 20,000 writes, 20,000 deletes on Spark. Two rules make this worse than it
looks for a watch: *"you are charged for a read each time a document in the result set is added or
updated"*, and if a listener is disconnected for over 30 minutes you are *"charged for documents and
index entries read as if you had issued a brand-new query"* — a widget process that lives for
seconds at a time can never amortize a listener, so **every** wake is a cold query. Plus Cloud
Function invocations, which are a second meter.

Against a stated $0 runtime cost for the current widget (`apps/mobile/WIDGET.md`), and an owner
who is GCP-cost-averse (`CLAUDE.md`), this is the number that decides it.

---

## Option C — WidgetKit push notifications

Worth naming because Apple added it and it is the only transport that works with the phone out of
range. [Updating widgets with WidgetKit push notifications](https://developer.apple.com/documentation/widgetkit/updating-widgets-with-widgetkit-push-notifications):
add the Push Notifications capability to the *widget extension*, implement
[`WidgetPushHandler`](https://developer.apple.com/documentation/widgetkit/widgetpushhandler)
(**iOS 26.0 / watchOS 26.0+**), ship tokens to a server, and send via APNs.

Two things kill it as a *primary* transport for us:

- **It carries no data.** *"When WidgetKit receives a push notification, it reloads your timelines,
  similar to when you call `reloadAllTimelines()`."* A reload with nothing new in the App Group
  renders the same face. To benefit you must then **fetch** — which is Option B, with Option B's
  costs and Option B's missing Firestore client.
- **It is budgeted too.** *"Like timeline updates, the system budgets WidgetKit push notifications
  and delivers them opportunistically."*

Plus a watchOS 26.0 deployment floor, an APNs auth key, token lifecycle code, and a Cloud Function
firing on every log write.

---

## WidgetKit reload budgets on watchOS — independent of transport

This is the ceiling every option shares, so it is worth getting right.

**The watchOS-specific number.** From
[Migrating ClockKit complications to WidgetKit](https://developer.apple.com/documentation/widgetkit/converting-a-clockkit-app):

> WidgetKit's daily budget for reloading the timeline works differently than ClockKit's. Your
> widget-based complication receives **up to 75 updates per day**, based on how often they're
> viewed. **If you have a complication on the Apple Watch face, it's always considered viewed, so
> your budget tends towards the higher end of that range.**

So yes — **the active-watch-face allowance is real and Apple states it**, and it is stated as
"always considered viewed" rather than a separate larger pool.

**The general (iOS-flavoured) framing**, from
[Keeping a widget up to date](https://developer.apple.com/documentation/widgetkit/keeping-a-widget-up-to-date):

- *"A widget's budget applies to a 24-hour period. WidgetKit tunes the 24-hour window to the user's
  daily usage pattern, which means the daily budget doesn't necessarily reset at exactly midnight."*
- *"For a widget the user frequently views, a daily budget typically includes from **40 to 70
  refreshes**. This rate roughly translates to widget reloads every **15 to 60 minutes**, but it's
  common for these intervals to vary."*
- *"WidgetKit maintains different budgets for each active widget"* — so a phone widget and a watch
  complication do **not** share a budget.
- *"WidgetKit imposes a minimum amount of time before it reloads a widget. Your timeline provider
  should create timeline entries that are at least about **5 minutes** apart."*
- *"The system takes a few days to learn the user's behavior. During this learning period, your
  widget may receive more reloads than normal."*

**What does *not* count against the budget** (verbatim list): the containing app is **in the
foreground**; the app has an active audio or navigation session; the widget performs an app intent;
the widget performs an animation; the system locale changes; Dynamic Type / Accessibility settings
change. StandBy refreshes also don't count.

Two consequences that matter more than the numbers:

1. **A user-initiated reload from a foreground app is free — but only the *containing* app's
   foreground counts.** For the phone widget that is our RN app, which is why
   `apps/mobile/src/lib/widget.ts` gets away with calling `ExtensionStorage.reloadWidget` on every
   change. For the watch complication the containing app is the **watch app**, which the user is
   almost never in. So the phone being in the foreground buys the complication nothing.
2. **A WCSession-woken background wake is NOT foreground, so its `reloadTimelines` call counts
   against the budget.** The exemption list is exhaustive and background execution is not on it.
   This is the single most important sentence in this document: *the transport does not escape the
   budget; it only decides what data is waiting when the budget is spent.*

`TimelineReloadPolicy` (watchOS 9.0+) — `.atEnd`, `.after(_:)`, `.never` — is a *request*, not a
guarantee, and Apple's advice is to make timelines as long and as sparse as the content allows.
For "calories left today" the natural shape is a `.never` (or long `.after`) timeline with a single
entry, since the value only changes on a log — plus a `.after(next midnight)` backstop so the
`dateKey` guard flips the face to the empty state on time even with no transport traffic.

**What this means for a value that changes several times a day at unpredictable times:** it is
about the worst possible fit for WidgetKit's model. WidgetKit is built for *predictable* futures
(weather at the hour, market close on Friday). Ours is a pure push-on-change value, so we are
spending budget on unscheduled reloads, which is exactly the case the 5-minute floor and the
40–75/day cap are designed to throttle. A user who logs breakfast, a snack, lunch, a snack, dinner
and a late snack needs **six** reloads — comfortably inside any budget. A user fiddling with
quantities in a form generates dozens; `widgetSnapshotChanged` in `packages/core/src/widget-snapshot.ts`
already exists to swallow those and will need to be honoured on the watch path too.

---

## The honest freshness verdict

Realistic worst case the user would actually see on the wrist:

| Transport | Typical | Worst case in normal use | Pathological |
| --- | --- | --- | --- |
| **A1 `updateApplicationContext`** | seconds to a few minutes after a log, watch on wrist and phone in pocket | **15–60 min** once the day's reloads throttle (Apple's own "every 15 to 60 minutes") | **Unbounded** while the watch is out of Bluetooth/Wi-Fi range of the phone. Delivery is explicitly "when the opportunity arises" — Apple promises no latency at all |
| **A2 `transferUserInfo`** | same | same, and reaches the cap sooner because every queued entry asks for its own reload | same |
| **A3 complication channel** | unknown | unknown | Per Apple staff, currently doesn't work with WidgetKit complications at all ⇒ **infinite** |
| **B Firestore/CF fetch** | seconds after a wake — but the wake is still budgeted | same 15–60 min, because the render process's wake cadence is the binding constraint, not the network | same as A when the fetch fails; plus a bill |
| **C WidgetKit push** | opportunistic; survives phone-out-of-range | budgeted like a timeline reload | no data without B underneath |

**The one-line answer for #37:** with any transport we control, "calories left today" on a watch
face is honestly a **best-effort, minutes-to-an-hour-stale** value that goes arbitrarily stale when
the watch and phone part company. It is not, and cannot be made into, a live number. Design the
face for that: `WidgetSnapshot.updatedMs` already travels in the blob and is currently unrendered —
on a wrist, a small "as of 1:42 PM" is the difference between an honest surface and one that lies.

### How the `dateKey` guard behaves in that world

`widgetView()` in `packages/core/src/widget-snapshot.ts` blanks to `reason: 'stale'` whenever
`snapshot.dateKey !== todayKey`, and `todayKey` is computed from the **rendering device's** clock
(`localDateKey(now)` in `index.swift`). On a watch that has three consequences:

1. **The intended one.** Watch parts from phone at 9 PM, midnight passes, no context arrives. At
   the first reload after midnight the complication goes to "Open Ignia" rather than showing
   yesterday's remaining calories as today's. Correct, and it is the *only* thing standing between
   the user and a confidently wrong number. It also means **the empty state is a normal, frequent
   state on a watch**, far more so than on a phone home screen — worth designing rather than
   tolerating.
2. **A reload is still required to notice.** The guard runs at render time, so a complication that
   is out of budget at 00:05 can keep drawing yesterday's numbers until its next reload. The
   `.after(next local midnight)` backstop above is the fix, and it is cheap.
3. **A new failure mode: two clocks.** The phone writes `dateKey`; the watch computes `todayKey`.
   They are normally identical, but around midnight, or across a time-zone change where the watch
   and phone disagree transiently, the guard fires and the face blanks. That is fail-safe (blank
   beats wrong) but it is a behaviour [#38](https://github.com/gabandres/fitness-tracker-pwa/issues/38)
   should encode deliberately when it mirrors the contract, not discover on a plane.

---

## Settling the `WATCHOS_DEPLOYMENT_TARGET` pin (handed over from #32)

#32 flagged the plugin's `9.4` default as a decision for this ticket. Version floors, all from
Apple's own availability metadata:

| API | Earliest watchOS |
| --- | --- |
| `WidgetCenter.reloadTimelines(ofKind:)`, `TimelineReloadPolicy` | **9.0** |
| `WidgetFamily.accessoryCorner` | **9.0** |
| `AccessoryWidgetBackground`, `View.widgetLabel(label:)` | **9.0** |
| `Scene.backgroundTask(_:action:)`, `BackgroundTask.watchConnectivity` | **9.0** |
| `View.containerBackground(_:for:)` | **10.0** |
| `TimelineProvider.relevance()`, `WidgetRelevance` (Smart Stack ranking) | **11.0** |
| `WidgetPushHandler` (Option C) | **26.0** |

Hardware, from Apple: [watchOS 11 is available today](https://www.apple.com/newsroom/2024/09/watchos-11-is-available-today/)
— *"watchOS 11 is available today for Apple Watch Series 6 and later"*; and
[Apple Watch models](https://support.apple.com/guide/watch/apple-watch-models-apd2054d0d5b/watchos)
— watchOS 26 lists Series 6 and later. **watchOS 11 and watchOS 26 have the same hardware floor**,
so moving from 11 upward costs no devices at all.

**Recommendation: pin `deploymentTarget: "10.0"` explicitly. Do not inherit 9.4.**

Reasoning:

- Every API a complication strictly needs is watchOS 9.0, so 9.4 is *sufficient* — which is exactly
  why it is a trap: it looks free. It is not. It forces `if #available(watchOS 10, *)` branches
  around `containerBackground`, and it keeps us on the side of the watchOS 9 / watchOS 10 line where
  the **Smart Stack does not exist** — and the Smart Stack is where an Apple Watch widget is
  actually discovered today (Apple: *"On Apple Watch, widgets automatically appear in the Smart
  Stack"*).
- watchOS 10 shipped September 2023. Every device that can run watchOS 9 can run watchOS 10, so a
  10.0 floor excludes no hardware — only users who have declined ~3 years of updates.
- Going further to **11.0 is defensible** and #37 may prefer it: it costs Series 4/5/SE-1 (which
  cannot run watchOS 11), and it buys `relevance()`, which is the documented way to earn Smart Stack
  visibility. It is a product call, not a technical one.
- **26.0 is only justified if #37 picks Option C**, since `WidgetPushHandler` is the sole
  watchOS-26 API in play. Do not pay that floor for Option A.
- Set it as an explicit `deploymentTarget` in the target config on **both** the `watch` and
  `watch-widget` targets, so the two can never drift and neither silently inherits a plugin default
  that changes on a dependency bump.

---

## What this means for the rest of the map

- **[#37](https://github.com/gabandres/fitness-tracker-pwa/issues/37) — choose the transport.** The
  direct consumer. Option B is not a trade-off, it is unavailable (no watchOS Firestore); if #37
  wants it anyway, it must be specced as watch → callable CF, priced at the read table above, and
  it still needs Option A underneath to bootstrap auth. The live decision is really
  *A1-only* vs *A1 + an on-device probe of A3's 50/day channel*. Also on #37's plate: which RN
  bridge (`react-native-watch-connectivity` 2.0.0 vs. a ~one-function custom Expo Module), and
  whether the complication renders `updatedMs`.
- **[#39](https://github.com/gabandres/fitness-tracker-pwa/issues/39) — what the watch app is.**
  This research constrains it: the watch app is not optional decoration, it is **link 2 of the
  transport**. It must be a pure-SwiftUI watchOS 9+ app (both because that is what
  `@bacons/apple-targets` generates, and because the forum evidence says the WatchKit lifecycle is
  where WidgetKit complication reloads go to die), it must own the `WCSession` delegate, and it must
  run `.backgroundTask(.watchConnectivity)`. Anything the user can *see* in that app is additive to
  a job it has to do regardless.
- **[#38](https://github.com/gabandres/fitness-tracker-pwa/issues/38) — snapshot contract
  mirroring.** Three consumers now (TSX Android, Swift iOS widget, Swift watch complication) plus a
  wire format on the WCSession hop. Two new obligations: the property-list dictionary shape (no
  JSON needed on this hop, but then the field names are the contract twice over), and the two-clock
  `dateKey` behaviour above.
- **[#35](https://github.com/gabandres/fitness-tracker-pwa/issues/35) — EAS build quota.** Nothing
  here can be verified without a device. The reload budget, the background-wake latency, whether
  `transferCurrentComplicationUserInfo` works on current watchOS, and whether
  `react-native-watch-connectivity` autolinks under CNG are **all** build-gated. Budget at least two
  builds in the August batch: one to prove the targets sign, one to prove the transport moves a
  number.
- **[#33](https://github.com/gabandres/fitness-tracker-pwa/issues/33) — Lock Screen.** Untouched, as
  #32 found. Accessory families on the existing `Today` target, same process, same App Group, same
  device. No transport, no watch app, no new bundle id.

---

## Open questions this research could NOT settle

1. **The WatchConnectivity payload size limit.** Apple documents `payloadTooLarge` and no number.
   Irrelevant at 152 bytes, but do not let a folklore figure into a code comment.
2. **Actual background-wake latency for `updateApplicationContext`.** Apple says "when the
   opportunity arises" and nothing more. There is no published distribution, and no way to get one
   except measuring on hardware.
3. **Whether `transferCurrentComplicationUserInfo` works today.** Apple staff said no (Jul 2024,
   thread 759389); one community post says yes on 26.5 (Jul 2026, thread 735352). FB12926788 has no
   public resolution. Only a device test settles it.
4. **Whether `isComplicationEnabled` / `remainingComplicationUserInfoTransfers` report correctly for
   a WidgetKit complication**, and whether a complication that lives only in the Smart Stack counts
   as "on the active watch face" for the 50/day allowance. Apple's docs predate WidgetKit
   complications and were written against ClockKit.
5. **How the 75/day watchOS figure and the 40–70/day general figure relate.** They appear in two
   different Apple documents with no cross-reference. Both are "typically"/"up to" language.
6. **Whether `containerBackground` is required for accessory-family complications**, as opposed to
   the system families. Apple documents its availability (watchOS 10.0) but I found no statement
   that accessory widgets must adopt it. The 10.0 recommendation above rests on the Smart Stack
   argument, not on this.
7. **Whether `react-native-watch-connectivity@2.0.0` autolinks and builds under Expo SDK 54 CNG
   prebuild.** The author claims only "Bare Workflow with EAS Build". There is no config plugin.
   Unverifiable without a build.
8. **Whether `@bacons/apple-targets` can add an SPM dependency to a generated watch target** — the
   documented config surface has no field for it. Only blocks Option B, which has bigger problems.

---

## Sources

**Apple — WatchConnectivity**
- [`WCSession`](https://developer.apple.com/documentation/watchconnectivity/wcsession)
- [`updateApplicationContext(_:)`](https://developer.apple.com/documentation/watchconnectivity/wcsession/updateapplicationcontext(_:))
- [`transferUserInfo(_:)`](https://developer.apple.com/documentation/watchconnectivity/wcsession/transferuserinfo(_:))
- [`transferCurrentComplicationUserInfo(_:)`](https://developer.apple.com/documentation/watchconnectivity/wcsession/transfercurrentcomplicationuserinfo(_:))
- [`remainingComplicationUserInfoTransfers`](https://developer.apple.com/documentation/watchconnectivity/wcsession/remainingcomplicationuserinfotransfers) — the 50/day figure
- [`isComplicationEnabled`](https://developer.apple.com/documentation/watchconnectivity/wcsession/iscomplicationenabled)
- [`sendMessage(_:replyHandler:errorHandler:)`](https://developer.apple.com/documentation/watchconnectivity/wcsession/sendmessage(_:replyhandler:errorhandler:))
- [`isReachable`](https://developer.apple.com/documentation/watchconnectivity/wcsession/isreachable)
- [`WCError.Code`](https://developer.apple.com/documentation/watchconnectivity/wcerror-swift.struct/code) — `payloadTooLarge`, no number
- [Watch Connectivity (framework overview)](https://developer.apple.com/documentation/watchconnectivity)

**Apple — background wake on watchOS**
- [`WKWatchConnectivityRefreshBackgroundTask`](https://developer.apple.com/documentation/watchkit/wkwatchconnectivityrefreshbackgroundtask) — "the system launches your app in the background"
- [`Scene.backgroundTask(_:action:)`](https://developer.apple.com/documentation/swiftui/scene/backgroundtask(_:action:)) (watchOS 9.0+)
- [`BackgroundTask.watchConnectivity`](https://developer.apple.com/documentation/swiftui/backgroundtask/watchconnectivity) (watchOS 9.0+)

**Apple — WidgetKit budgets and complication APIs**
- [Keeping a widget up to date](https://developer.apple.com/documentation/widgetkit/keeping-a-widget-up-to-date) — 40–70/day, 15–60 min, the exemption list, the ~5-minute floor
- [Migrating ClockKit complications to WidgetKit](https://developer.apple.com/documentation/widgetkit/converting-a-clockkit-app) — **75 updates/day**, active-face "always considered viewed"
- [Creating accessory widgets and watch complications](https://developer.apple.com/documentation/widgetkit/creating-accessory-widgets-and-watch-complications)
- [`WidgetCenter.reloadTimelines(ofKind:)`](https://developer.apple.com/documentation/widgetkit/widgetcenter/reloadtimelines(ofkind:)) · [`TimelineReloadPolicy`](https://developer.apple.com/documentation/widgetkit/timelinereloadpolicy)
- [`WidgetFamily.accessoryCorner`](https://developer.apple.com/documentation/widgetkit/widgetfamily/accessorycorner) · [`AccessoryWidgetBackground`](https://developer.apple.com/documentation/widgetkit/accessorywidgetbackground) · [`View.widgetLabel(label:)`](https://developer.apple.com/documentation/swiftui/view/widgetlabel(label:)) · [`View.containerBackground(_:for:)`](https://developer.apple.com/documentation/swiftui/view/containerbackground(_:for:)) · [`TimelineProvider.relevance()`](https://developer.apple.com/documentation/widgetkit/timelineprovider/relevance()) · [`WidgetRelevance`](https://developer.apple.com/documentation/widgetkit/widgetrelevance)
- [Updating widgets with WidgetKit push notifications](https://developer.apple.com/documentation/widgetkit/updating-widgets-with-widgetkit-push-notifications) · [`WidgetPushHandler`](https://developer.apple.com/documentation/widgetkit/widgetpushhandler) (26.0+)
- [WWDC22 — Complications and widgets: Reloaded](https://developer.apple.com/videos/play/wwdc2022/10050/) · [WWDC22 — Go further with Complications in WidgetKit](https://developer.apple.com/videos/play/wwdc2022/10051/) (checked; neither transcript states a budget number)

**Apple Developer Forums** (Apple-staff replies are authoritative; other posts are labelled as community reports)
- [Thread 759389 — "Updating watchOS complication when…"](https://developer.apple.com/forums/thread/759389) — Frameworks Engineer, Jul 2024
- [Thread 735352 — "WidgetKit complications won't update"](https://developer.apple.com/forums/thread/735352) — WWDR engineer on reload budgets; FB12926788; Jul 2026 26.5 report

**Apple — platform/hardware**
- [watchOS 11 is available today (Newsroom, 2024-09)](https://www.apple.com/newsroom/2024/09/watchos-11-is-available-today/) — Series 6 and later
- [Apple Watch models (watchOS 26 user guide)](https://support.apple.com/guide/watch/apple-watch-models-apd2054d0d5b/watchos) — Series 6 and later

**Firebase**
- [Firebase library support by platform](https://firebase.google.com/docs/ios/learn-more#firebase_library_support_by_platform) — Firestore/RTDB blank on watchOS, Auth "partial"
- [`firebase-ios-sdk` README](https://github.com/firebase/firebase-ios-sdk/blob/main/README.md) and [`Package.swift`](https://github.com/firebase/firebase-ios-sdk/blob/main/Package.swift) (`.watchOS(.v7)`)
- [Cloud Firestore — Understand billing](https://firebase.google.com/docs/firestore/pricing) — 50k reads/day free tier, listener billing, the 30-minute rule

**React Native / Expo modules** (npm registry metadata + repo source, read 2026-07-24)
- [`react-native-watch-connectivity`](https://github.com/mtford90/react-native-watch-connectivity) — `2.0.0` (2026-03-20); `README.md`, `package.json` (`codegenConfig`), `src/NativeWatchConnectivity.ts`, `ios/WatchConnectivity.mm`, `CHANGELOG.md`
- [`expo-watch-connectivity`](https://github.com/Duell10111/expo-watch-connectivity) — `0.1.8` (2025-02-16); package contents and `build/index.d.ts` via unpkg
- `react-native-watch-connectivity-expo` — npm registry metadata only

**Local**
- `docs/research/watchos-target-viability.md` (#32) — target generation, App Group scope, `WATCHOS_DEPLOYMENT_TARGET` 9.4 default
- `packages/core/src/widget-snapshot.ts` — the contract, the `dateKey` guard, `widgetSnapshotChanged`
- `apps/mobile/src/lib/widget.ts` — App Group write + `ExtensionStorage.reloadWidget`, `APP_GROUP`, `WIDGET_NAME`
- `apps/mobile/targets/widget/index.swift` — the Swift mirror, `localDateKey(now)`
- `apps/mobile/package.json` — no WatchConnectivity module installed; `firebase@^12.11.0` (JS SDK)
- `apps/mobile/app.json` — no `ios.deploymentTarget`; `group.fit.ignia.app` entitlement
- `apps/mobile/WIDGET.md` — the $0 runtime baseline; "Apple Watch complication / app — separate target, larger"
- `STATUS.md` §3, [#35](https://github.com/gabandres/fitness-tracker-pwa/issues/35) — the build gate
