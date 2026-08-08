# Logging from outside the app: Android reuses our JS write path, iOS gets a REST one

## Status

accepted (2026-08-07). Covers the backlog items `UX_AUDIT.md` §S15 calls **N1**
(Siri / App Intents + Android Quick Settings tile) and **N4** (interactive widget
quick-add), which share one hard problem and are therefore one decision. Extends
`apps/mobile/WIDGET.md`, whose Locked Decisions table put App Intents explicitly
*out* of the widget batch — this is the ADR that takes them back in, and the
`WIDGET.md` deferral note for "interactive widgets" is superseded by it.

Depends on [ADR-0016](0016-mobile-per-hook-subscriptions-intentional.md) (the
per-hook subscription model the Settings picker follows) and on the client-minted
`setDoc` in both ledger adapters, without which none of this is safe to retry.

## Context

Every glanceable surface the app has today is **read-only**. The widget, the Lock
Screen families, the watch complication and the watch screen all render the same
snapshot blob the app writes on each log (`WIDGET.md`). Nothing outside the app
has ever *written* to the ledger.

The two backlog items both need exactly that, and the reason they were deferred
rather than done is one question:

> Where does the write happen when the user is not in the app, and how does it
> reach Firestore?

An iOS App Intent runs in a process with no React Native runtime. An Android
Quick Settings tile is a Kotlin `TileService`. Neither can call
`apps/mobile/src/lib/ledger.ts`, which is where every write in this app lives.

Four answers were on the table, and none was obviously right:

1. **Firebase's native SDK inside the extension.** Heaviest option, and it puts a
   second Firestore client into a codebase whose one hard architectural rule is a
   single SDK copy — a rule that exists because a second copy broke production
   sign-in once (`CLAUDE.md`).
2. **Enqueue locally, flush on next app launch.** Cheap; reuses the App Group /
   `AsyncStorage` seam the snapshot already uses. But "Hey Siri, log my shake"
   that does not appear until the app is next opened is a broken promise, and a
   widget button whose numbers move while the ledger has no row is worse.
3. **Deep-link into the app and let JS write.** Nearly free and completely
   reliable — and it defeats the entire premise, which is logging in ~2s without
   opening anything.
4. **A new HTTPS callable.** One function and a token-storage decision, for a
   write that needs neither.

### The two facts that decided it

**Android already has auth in a headless context.**
`apps/mobile/src/lib/firebase.ts` initialises auth with
`getReactNativePersistence(AsyncStorage)`. `react-native-android-widget` invokes
a **JS** task handler for widget events, and a `TileService` can start a
`HeadlessJsTaskService`. So on Android the signed-in session rehydrates in a
context with no UI, and the write can be `ledger.ts` unchanged. Android needs no
native write path at all.

**iOS can write to Firestore without Firebase.** The JS SDK exposes
`user.refreshToken`; `securetoken.googleapis.com` exchanges it for an ID token;
the Firestore REST API accepts that token as a bearer credential. A REST write is
an ordinary write, so `firestore.rules` enforces exactly what it enforces for the
SDK. Two `URLSession` calls, no native Firebase dependency, no new Cloud
Function, no new secret.

## Decision

**Android reuses the JS write path. iOS writes through the Firestore REST API
with a token minted from a shared refresh token. The asymmetry is deliberate.**

### The shared half (`packages/core/src/quick-add.ts`)

Pure, tested, and the single source of every rule both platforms obey:

- **Slot resolution.** The user designates up to **3** presets. Order is theirs.
  A slot whose preset was deleted, renamed to nothing, or reduced to zero
  calories silently disappears rather than rendering a button that logs nothing.
- **The row that gets written.** `mealLabel` is the preset name; the timestamp is
  the **tap** time, not the write time, so a queued write still lands on the day
  it was tapped. No `mealType` — a preset has none, and inferring one from the
  clock is the app deciding that 4pm is a snack.
- **The doc id is minted BEFORE the attempt** (`newLedgerId`), in Firestore's own
  20-character alphabet. This is the load-bearing decision of the whole design;
  see below.
- **The offline queue.** Capped at 25, TTL 7 days, deduped by id, and every row
  carries its **uid**.

### Why the id is minted early

A quick-add is the flakiest write in the app: a tile tap in a lift, a widget
button on a train. When the socket dies mid-`Write`, the client cannot distinguish
a request that never arrived from one that landed and lost its ack. Minting the id
up front makes the retry a `setDoc` of the *same* document — an idempotent
overwrite of identical bytes rather than a second meal on the user's day.

This is the same property `createDoc` bought for in-app creates (Sentry
`IGNIA-MOBILE-6`), extended to survive being parked on disk across a process
death. It is also what lets Swift and JS park writes into the same queue: an id is
just a name, and both sides can mint one.

### Why a pending row carries its uid

A queued write is flushed later, by the app, against whatever session is signed
in *then*. Landing one person's meal on another account is worse than losing the
tap, so the uid rides along and the flush drops anything that does not match —
which is also what makes sign-out a queue clear, with no extra mechanism.

The corollary is sharper: **a surface that cannot resolve a uid at tap time must
not enqueue.** It has nothing to address the row to. It writes nothing, and the
tile or button says so by not moving.

### No confirmation step; the receipt is the numbers

Neither surface has a review screen, unlike photo-scan. A confirmation would kill
the ~2s premise that justifies the feature. So:

- The write is silent and immediate.
- The **receipt** is the surface redrawing with the new totals — and it has to be
  produced deliberately, because the app that normally writes the snapshot is not
  running. `applyQuickAddToSnapshot` folds the row into the blob on disk.
- That fold is an **optimistic local edit, not a recomputation**: a widget process
  holds one day's totals and no log list. It is close, not authoritative, and the
  app's next `syncWidget` replaces it with the real summary.
- A **queued** write moves the numbers and says it is queued. A **signed-out** tap
  moves nothing, because the row is unattributable and always will be.
- There is **no new undo mechanism.** A mis-logged row is deletable in History,
  which is the existing model for every other entry.

### Slots are device-local

The slot list lives in `AsyncStorage`, not in the Firestore profile. A tile and a
home screen belong to *this* device, the same way the reminder and
Health-connection preferences already do. Consequence worth stating: this feature
needed **no new Firestore field and therefore no `firestore.rules` deploy**,
which is otherwise the standing prerequisite for any new client write.

### The snapshot contract grows additively, and the version does NOT move

`WidgetSnapshot` gains an optional `quickAdd` array, because a widget process has
no other way to learn a preset's name. `WIDGET_SNAPSHOT_VERSION` stays at 1 on
purpose: bumping it makes already-shipped Swift reject an otherwise-valid blob,
and the visible result is a **blank widget** on iOS build 25 — the same class of
silent breakage as the `useMemoCache` defect that shipped in Android vc 4, 6 and
8. A malformed `quickAdd` is stripped rather than invalidating the blob, because
the numbers are the primary payload and a missing button is a smaller failure
than a blank face.

### Android's tile is Kotlin that knows nothing

`apps/mobile/modules/quick-add-tile` is the repo's second local Expo module (after
`modules/watch-link`) and is deliberately as dumb as that one:

- `QuickAddTileService` reads a mirrored label, sets the tile's state, and on tap
  starts a `HeadlessJsTaskService`. All domain logic is in the JS it wakes.
- The tile is **labelled with the preset name**, because a Quick Settings tap is
  blind: no list, no sheet, no confirmation. An unlabelled tile that writes a meal
  is the one shape of this feature that would be indefensible. With nothing
  designated the tile goes inactive and its tap **opens the app** instead.
- Kotlin cannot read `AsyncStorage` — on Android it is a SQLite database
  (`RKStorage`), not `SharedPreferences` — so JS mirrors just the label and an
  enabled flag across. It is a mirror, never a source of truth.
- The label is set from JS, so it follows the **app's** locale rather than the
  device's, and it reuses the widget's own string table rather than adding a
  second one. The manifest's `android:label` stays the brand name, since that
  string *is* resolved by device locale.

## Consequences

**A third mirror of a doc shape exists, and that is the real cost.**
`WIDGET.md` already holds the line "what can silently show wrong *numbers* is
shared; what can only look wrong is not", and the log doc shape is now written in
three places: `firestore-writers.ts` (both apps), `Glance.swift`'s decode, and —
once the iOS half lands — a Swift encoder for the REST payload. This is the
drift risk to watch, and the reason the queue's wire shape is flat and
primitive-only.

**A long-lived credential is stored on iOS.** The refresh token belongs in the
**Keychain**, not App Group `UserDefaults`, which is a plist. It is written on
auth-state change from the same hook that writes the snapshot, cleared on sign-out
beside the snapshot clear, and on a 400 from `securetoken` both it and the queue
are dropped — a queue held against a revoked credential is data that can never
land, and holding it is worse than losing it.

> **Amended during implementation (same day): the app's own Keychain, not a
> shared access group.** This ADR originally specified a *shared* Keychain access
> group, on the assumption that the intent runs in its own process. It does not:
> App Shortcuts declared in the app target and widget `Button(intent:)` are both
> performed by launching the **app** in the background, so `perform()` runs in the
> app's process and reaches the app's default Keychain directly. That removes the
> `keychain-access-groups` entitlement, the group id, and one more thing that has
> to match across `app.json` and two targets — strictly less surface for the same
> result. The envelope also carries the public API key and project id rather than
> Swift holding copies, so `firebase.ts` stays the single source of both.

**The pending queue is in a different store on each platform, and it has to be.**
Android's only writer is JS, so `AsyncStorage`. On iOS the writer is Swift, which
cannot reach `AsyncStorage` (a SQLite database in the app's own container), so the
queue lives in the **App Group** — the one store both processes see — under the
same key and in the same wire shape. This is the sharpest silent-failure risk in
the whole feature: read the wrong store and every iOS quick-add appears to queue
and then never lands, with nothing to see anywhere. It is covered by four tests,
one of which feeds in the exact bytes the Swift side emits.

**The Android tap has a fallback that is slower than the promise.**
`startService` from a background app throws on Android 8+, and a tapped tile is
not a contractual foreground signal. The throw is caught and the tap degrades to
`ignia://?quickAddSlot=0`, which opens the app and logs. That is not what the
feature promises — but it is visible, and a swallowed exception there is a tile
that does nothing, which is precisely how the Android widget stayed broken for a
month.

**No web analogue is owed.** `CLAUDE.md` makes parity bidirectional and expects a
mobile feature to be followed by a web port. This is the documented exception: a
Quick Settings tile, an App Intent and a home-screen widget button are
OS-integration surfaces with no browser equivalent. Stating it here is the point —
a silent gap is what makes the parity rule unenforceable.

**Runtime cost is $0** and no new infrastructure exists: no Cloud Function, no
scheduled job, no secret, no Firestore field, no rules change. Both `CLAUDE.md`
cost ceilings (3 scheduler jobs, 6 secret versions) are untouched.

## Alternatives rejected

- **Firebase native SDK in the iOS intent** — a second Firestore client for a
  write REST already does.
- **A new HTTPS callable** — a function and a token decision, for the same reason.
- **Enqueue-only on both platforms** — makes the feature's core promise false; kept
  as the *failure* path, where it is exactly right.
- **Deep-link on both platforms** — defeats the premise; kept as Android's
  fallback, where it beats silence.
- **Symmetric native write paths, for tidiness** — would mean duplicating the
  Android write in Kotlin so both platforms looked alike. Rejected: reusing
  `ledger.ts` means Android has *zero* duplicated write logic, which is worth
  more than cross-platform symmetry looks.
- **MRU instead of explicit slots** — a tile whose label names a preset must not
  silently change what a labelled tap does.
- **A confirmation state on the widget button** — two taps is not a quick-add.
- **A real undo stack** — inverts the effort against the app's cheapest write
  paths; History already deletes rows.
