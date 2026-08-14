import Foundation

//
//  Ignia — the one Swift mirror of `packages/core/src/widget-snapshot.ts`.
//
//  ## Why this file is here and not in each target
//
//  `@bacons/apple-targets@5.0.0` globs `targets/_shared/*` and attaches it to
//  EVERY target in the project (`build/with-xcode-changes.js`, README §_shared).
//  So this is the only directory that reaches the iPhone widget, the watch app
//  and the watch complication at once. Per-target `targets/<name>/_shared/`
//  would reach one target each and put us back at three copies (#38 §1).
//
//  The deletion test: remove this file and the staleness guard reappears in
//  three Swift targets. A drifted guard does not fail loudly — it renders
//  yesterday's calories as today's, the single most dangerous bug this feature
//  has.
//
//  ## Two hard rules for anything added here
//
//  1. **No SwiftUI. No unguarded WidgetKit. Nothing whose floor is above the
//     lowest target here.** The shared group is linked into the MAIN APP target
//     unconditionally, so everything here compiles against the phone app's iOS
//     floor (16.4, `expo-build-properties` in app.json) *and* against watchOS 10.
//     `Gauge` is iOS 16+, `.containerBackground` is iOS 17+; shared SwiftUI would
//     need `@available` guards on code that can only be compiled by spending an
//     EAS build. Views are deliberately NOT shared (#38 §2).
//
//     The dividing line, stated once: **what can silently show wrong _numbers_
//     is shared; what can only look wrong is not.**
//
//     This file itself stays Foundation-only. The rule was originally written as
//     "Foundation only" and is **widened, not broken, by ADR-0020**: `QuickAdd.swift`
//     and `QuickAddIntents.swift` also live here and import `Security` and
//     `AppIntents`, both of which clear iOS 16.4 and watchOS 10, and `WidgetKit`
//     behind `#if canImport`. The constraint that actually matters is the floor,
//     not the framework list — and App Intents *must* be here, because App
//     Shortcuts are only discovered from the main app's metadata and `_shared` is
//     the one directory that reaches the app target.
//
//  2. **Namespaced under `Glance`.** These symbols land in the main app module
//     too, so bare top-level names like `Snapshot` or `strings` would be a
//     collision waiting to happen.
//
//  Prebuild must be re-run on any add/rename/remove in this directory — the
//  glob runs at prebuild time and is non-recursive (one level).
//
//  Spec: `packages/core/src/widget-snapshot.ts`; its vitest suite is the
//  reference for every rule below. When one side changes, change both.
//

public enum Glance {

  // MARK: - Contract constants
  //
  // Under `_shared` these stop being the prose "Must equal …" contracts the
  // per-target copies used to carry and become actual shared constants
  // compiled into every Apple target (#38 §1).

  /// Must equal `WIDGET_SNAPSHOT_KEY` in `packages/core/src/widget-snapshot.ts`.
  ///
  /// The watch stores under this same key in **its own** App Group container.
  /// No collision — App Groups are per-device, which is the whole reason the
  /// WCSession transport exists (#32).
  public static let snapshotKey = "ignia.widget.snapshot.v1"

  /// Must equal `APP_GROUP` in `src/lib/widget.ts` and the entitlement in
  /// app.json. On the watch this names the watch app ↔ complication container.
  public static let appGroup = "group.fit.ignia.app"

  /// Must equal `WIDGET_SNAPSHOT_VERSION`. A blob written by a newer app is
  /// rejected rather than partially decoded — during an app update the widget
  /// extension keeps running old code until the OS reloads it. An old watch
  /// binary receiving a v2 blob stores it, fails this gate at render, and shows
  /// the empty face — identical to the phone widget's behaviour (#38 §3).
  public static let version = 1

  /// The `kind` the iPhone widget declares and `ExtensionStorage.reloadWidget`
  /// addresses. Must equal `WIDGET_NAME` in `src/lib/widget.ts`.
  public static let widgetKind = "Today"

  /// Where a quick-add records what happened to it. Must equal
  /// `QUICK_ADD_OUTCOME_KEY` in `src/lib/quick-add.ts`.
  ///
  /// ## Why a glanceable surface needs an outbox at all
  ///
  /// A widget button and a Quick Settings tile cannot answer back. There is no
  /// dialog, no toast, no screen — `LogQuickAddSlotIntent` returns a bare
  /// `.result()` by necessity. The widget's numbers moving is the entire
  /// receipt, and the two failure paths that matter (`.signedOut`, and a slot
  /// index that no longer exists) deliberately do **not** move them, because
  /// moving them would be a lie.
  ///
  /// So a failed tap is indistinguishable from a successful one, and from a
  /// button that was never wired up. That is not hypothetical: an unreachable
  /// keychain made every widget quick-add a no-op from build 27 to build 32 —
  /// five binaries, one of which announced the feature to testers — and nothing
  /// anywhere recorded it. Not the build, not the tests, not Sentry, which does
  /// not exist in a Swift extension.
  ///
  /// The App Group is the one channel both processes share, so the outcome is
  /// parked here and the app surfaces it on next foreground. It is diagnosis,
  /// not telemetry: nothing leaves the device.
  public static let quickAddOutcomeKey = "ignia.quickAdd.outcome.v1"

  /// Where a process that wanted to reach the watch and could not parks the
  /// envelope, for whichever process next holds an activated `WCSession`.
  /// Must equal `WATCH_PENDING_KEY` in `src/lib/widget.ts` and `pendingKey` in
  /// `modules/watch-link/ios/WatchLinkModule.swift`.
  ///
  /// ## Why a park and not just a send
  ///
  /// `WCSession` exists only in the app process, and even there it is
  /// **activated asynchronously**: `WatchLinkModule` calls `activate()` at
  /// launch and the state flips a moment later, on a delegate callback. An
  /// intent performed on a cold launch runs inside that window, so the honest
  /// answer to "can I send right now" is *not yet* rather than *no* — and the
  /// old code treated the two identically and dropped the push, which is the
  /// whole reason a Siri-logged meal never reached the wrist.
  ///
  /// The value is the same one-key envelope the transport carries
  /// (`[contextKey: snapshotJSON]`), serialized. Latest-wins, exactly like the
  /// application context itself: a second park overwrites the first, because
  /// the question is only ever "what should the wrist show now".
  public static let watchPendingKey = "ignia.watch.pending.v1"

  /// Where an attempt to reach the watch records which of its guards fired.
  /// Must equal `WATCH_ASSERT_KEY` in `src/lib/widget.ts`.
  ///
  /// Same reasoning as `quickAddOutcomeKey`, one device further out: a watch
  /// that does not move looks identical whether the send was skipped in the
  /// widget extension, skipped because the session had not activated, or made
  /// and lost in transit. Two speculative fixes were shipped to this surface on
  /// 2026-08-13 without either being distinguishable from the other. This names
  /// the guard, on the device, in the App Group both processes share.
  ///
  /// Diagnosis, not telemetry: nothing leaves the device.
  public static let watchAssertKey = "ignia.watch.assert.v1"

  /// **On the WATCH's own container**: what last wrote the snapshot, and how
  /// many times the complication has been asked to reload today.
  ///
  /// The phone's `watchAssertKey` proved the phone did its job (`sent · app`,
  /// complication on the active face, 32 transfers left — so the waking queue
  /// really was used). That moved the question one device out, to a device with
  /// **no instrumentation at all**, where two causes are indistinguishable: the
  /// wake never happened, or it happened and the reload was throttled.
  ///
  /// `label` names the callback that stored — `userInfo` is the waking queue
  /// and seeing it is the proof that `transferCurrentComplicationUserInfo`
  /// woke this app.
  public static let watchIngestKey = "ignia.watch.ingest.v1"

  /// **On the WATCH's own container**: when the complication last built a
  /// timeline, and how many it has built today.
  ///
  /// The other half of the same question, and the half that separates the two
  /// causes outright. If ingest fired at 10:01 and the last timeline build is
  /// 09:14, WidgetKit is throttling us and the reload budget is the problem. If
  /// the timeline built at 10:01 and the face still shows old numbers, the
  /// container read is the problem. Neither is guessable from the wrist.
  public static let watchTimelineKey = "ignia.watch.timeline.v1"

  /// The watch complication's `kind`. Only the watch app reloads it, and it
  /// does so via `reloadAllTimelines`, so this is not a cross-process contract
  /// the way `widgetKind` is — it is here so the two watch targets agree.
  public static let complicationKind = "IgniaGlance"

  /// The single key inside the WCSession application-context envelope. The
  /// value is the already-serialized snapshot JSON — byte-identical to what
  /// `ExtensionStorage` writes phone-side — so there is no second wire format
  /// and no second decode path in Swift (#38 §3).
  public static let contextKey = "snapshot"

  // MARK: - Wire shape

  /// Mirrors `WidgetSnapshot`. Every field is a primitive and every number is a
  /// rounded integer, so JS and Swift cannot disagree about formatting.
  public struct Snapshot: Codable {
    public let v: Int
    public let dateKey: String
    public let kcalConsumed: Int
    public let kcalTarget: Int
    public let proteinConsumed: Int
    public let proteinTarget: Int
    public let updatedMs: Double
    public let locale: String
    /// The user's quick-add slots (ADR-0020). **Optional, and the wire version
    /// deliberately did NOT move for it.**
    ///
    /// `Codable` makes an optional field tolerant in both directions, which is
    /// the whole point: this binary decodes a blob written before the field
    /// existed, and an older binary — build 25, already on TestFlight — decodes
    /// one written with it. Bumping `version` instead would have made build 25
    /// reject a perfectly good blob and show a blank widget, which is the same
    /// silent class of failure as the `useMemoCache` defect on Android.
    public let quickAdd: [QuickAddSlot]?

    public init(
      v: Int, dateKey: String, kcalConsumed: Int, kcalTarget: Int,
      proteinConsumed: Int, proteinTarget: Int, updatedMs: Double, locale: String,
      quickAdd: [QuickAddSlot]? = nil
    ) {
      self.v = v
      self.dateKey = dateKey
      self.kcalConsumed = kcalConsumed
      self.kcalTarget = kcalTarget
      self.proteinConsumed = proteinConsumed
      self.proteinTarget = proteinTarget
      self.updatedMs = updatedMs
      self.locale = locale
      self.quickAdd = quickAdd
    }
  }

  /// Mirrors `QuickAddTarget` in `packages/core/src/quick-add.ts`: a preset
  /// flattened into everything needed to draw a button and write a row, with no
  /// Firestore read and no auth.
  ///
  /// Macros are optional here for the same reason they are optional there — an
  /// absent macro must stay absent through the write, because a `0` would be
  /// stored as a real zero and a missing key would not.
  public struct QuickAddSlot: Codable, Identifiable, Hashable {
    public let presetId: String
    public let name: String
    public let calories: Int
    public let protein: Double?
    public let carbs: Double?
    public let fat: Double?

    /// `Identifiable` off the preset id, so SwiftUI and the App Intents entity
    /// query agree on identity without a second notion of it.
    public var id: String { presetId }

    public init(
      presetId: String, name: String, calories: Int,
      protein: Double? = nil, carbs: Double? = nil, fat: Double? = nil
    ) {
      self.presetId = presetId
      self.name = name
      self.calories = calories
      self.protein = protein
      self.carbs = carbs
      self.fat = fat
    }
  }

  /// Mirrors `WidgetMetric`: distance from target, which side of it, and the
  /// clamped ratio.
  ///
  /// `progress` is a **derived view field, not a wire field** — it is computed
  /// here and never stored (#38 §5, which is why no version bump was needed).
  /// It is clamped to `0...1`, so a gauge cannot overshoot: at 140% of target
  /// the ring looks identical to 100%. That clamp is what forces the
  /// over-target text treatment (#33).
  public struct Metric {
    public let value: Int
    public let isOver: Bool
    public let progress: Double

    public init(consumed: Int, target: Int) {
      isOver = consumed > target
      value = abs(target - consumed)
      progress = target > 0 ? min(1, max(0, Double(consumed) / Double(target))) : 0
    }
  }

  /// Mirrors `WidgetView`, named `Face` so it cannot collide with SwiftUI's
  /// `View` in the targets that import SwiftUI.
  ///
  /// The three `WidgetEmptyReason`s are collapsed into one case because every
  /// Apple surface renders them identically and the user cannot act on the
  /// difference. The TS side keeps them apart only so its tests can tell an app
  /// that has never run from one that hasn't been opened today.
  ///
  /// `locale` is `nil` **only** for `no-snapshot` — nothing on disk means there
  /// is no stored preference to honour, the one case where falling back to
  /// English is the only option. For `stale` and `no-targets` the blob exists
  /// and names the user's locale, so an es-PR Lock Screen no longer flips to
  /// English at midnight (#33).
  public enum Face {
    case empty(locale: String?)
    case ready(kcal: Metric, protein: Metric, snapshot: Snapshot)

    /// The locale to render this face in, resolved. Used when a timeline has to
    /// carry today's locale into a *future* entry (the post-midnight blank).
    public var locale: String {
      switch self {
      case let .empty(l): return l ?? "en"
      case let .ready(_, _, snap): return snap.locale
      }
    }
  }

  // MARK: - Decode + the staleness guard
  //
  // This guard is the reason the file exists. It also does privacy work nobody
  // originally noticed: after a sign-out whose watch clear never landed, the
  // day-key rule is what blanks the previous account's numbers at the rendering
  // device's local midnight (#44).

  /// Mirrors `parseWidgetSnapshot` + `widgetView`. Anything unreadable, foreign
  /// versioned, from another day, or without a calorie target collapses to
  /// `.empty` — **never a thrown error**, which would show the OS's "unable to
  /// load" placeholder and read as a crashed app.
  public static func face(raw: String?, now: Date) -> Face {
    guard
      let raw,
      let data = raw.data(using: .utf8),
      let snap = try? JSONDecoder().decode(Snapshot.self, from: data),
      snap.v == version
    else {
      return .empty(locale: nil)
    }

    guard snap.dateKey == localDateKey(now) else { return .empty(locale: snap.locale) }
    guard snap.kcalTarget > 0 else { return .empty(locale: snap.locale) }

    return .ready(
      kcal: Metric(consumed: snap.kcalConsumed, target: snap.kcalTarget),
      protein: Metric(consumed: snap.proteinConsumed, target: snap.proteinTarget),
      snapshot: snap
    )
  }

  /// The face WidgetKit shows in the gallery and while a real entry loads.
  ///
  /// Plausible numbers rather than the empty state, so the gallery preview
  /// sells what the surface does. Shared so the phone widget and the watch
  /// complication cannot advertise different numbers, and built as a value
  /// rather than a JSON string so a typo in a hand-written literal cannot
  /// silently degrade the preview to `.empty`.
  public static func preview(now: Date = Date()) -> Face {
    let snap = Snapshot(
      v: version,
      dateKey: localDateKey(now),
      kcalConsumed: 1240,
      kcalTarget: 2000,
      proteinConsumed: 92,
      proteinTarget: 160,
      updatedMs: now.timeIntervalSince1970 * 1000,
      locale: "en")
    return .ready(
      kcal: Metric(consumed: snap.kcalConsumed, target: snap.kcalTarget),
      protein: Metric(consumed: snap.proteinConsumed, target: snap.proteinTarget),
      snapshot: snap)
  }

  /// Read the blob out of the App Group and decode it. Same call on the phone
  /// (written by `ExtensionStorage`) and on the watch (written by the watch
  /// app's `WCSessionDelegate`) — the container differs, the code does not.
  ///
  /// `UserDefaults(suiteName:)` returns nil when the process is not entitled to
  /// the group, which is a silent failure mode; it collapses to `.empty` here
  /// exactly like an absent blob.
  public static func load(now: Date) -> Face {
    let raw = UserDefaults(suiteName: appGroup)?.string(forKey: snapshotKey)
    return face(raw: raw, now: now)
  }

  /// Mirrors `localDateKey` from `packages/core/src/date.ts`: `YYYY-MM-DD` in
  /// the device's *local* zone. Must not be UTC — the whole point of the date
  /// key is that it flips at the user's midnight, not at Greenwich's.
  public static func localDateKey(_ date: Date) -> String {
    let f = DateFormatter()
    f.calendar = Calendar(identifier: .gregorian)
    f.locale = Locale(identifier: "en_US_POSIX")
    f.dateFormat = "yyyy-MM-dd"
    return f.string(from: date)
  }

  // MARK: - Strings
  //
  // One flat table, EVERY key present, keyed by locale only (#38 §4). The watch
  // introduced a new axis the phone never had — the same locale needs different
  // empty copy per surface — and that axis is absorbed by key names, not by a
  // second lookup dimension. Each target reads only the keys it renders; the
  // cost is a few dozen bytes of another surface's copy per binary, the benefit
  // is one place to check en/es-PR parity.
  //
  // Not a String Catalog: our locale comes from the BLOB, not the system, and
  // forcing a non-system locale means the `lproj` bundle dance (see
  // `src/widgets/strings.ts:1-11`).
  //
  // The Android widget keeps its own table in `src/widgets/strings.ts` — it
  // runs in JS and cannot read this. Two tables total, not three.

  public struct Strings {
    /// Unit word. Same in both locales; kept as a key so a third locale can
    /// change it.
    public let kcal: String
    /// Under target. `1,240 kcal **left**`
    public let left: String
    /// Over target. `1,240 kcal **over**`
    public let over: String
    public let protein: String
    /// Phone Lock Screen / Home Screen empty state — an instruction, because on
    /// a phone the instruction works: tap, the app writes, the widget heals.
    public let empty: String
    /// Same instruction for families with no room (`.accessoryInline`).
    public let emptyShort: String
    /// Verb that prefixes a quick-add button's accessibility label — "Log
    /// Protein shake" (ADR-0020). The visible caption is `+ <name>`, which
    /// VoiceOver would otherwise read as "plus". Mirrors `quickAddA11y` in
    /// `src/widgets/strings.ts`, which the Android face and the Quick Settings
    /// tile share.
    public let quickAddVerb: String
    /// Watch empty state. Deliberately NOT "Open Ignia" — a complication tap
    /// opens the read-only mirror, which has the same nothing on it, because
    /// the watch has no pull path. Telling someone to open an app that cannot
    /// help them is a dead end, not a nag (#40 §4).
    ///
    /// A status, not an instruction, so it cannot nag; and it states a fact
    /// about the *watch's own knowledge* rather than a claim about the phone.
    /// It also reads correctly at 00:05 after a night apart — the single most
    /// common way a watch reaches this state.
    public let emptyWatch: String
    /// The whole feature's explanatory copy, shown once, on the watch screen's
    /// empty state — exactly where a confused user arrives from the face
    /// (#40 §5). There is no settings line and no onboarding moment.
    public let watchSubline: String
    /// Format for the honesty row. `%@` is a locale-formatted time.
    public let asOf: String
    /// Watch mirror screen only: the label under the hero number.
    public let kcalLeftLabel: String
    /// Watch mirror screen only: the label under the hero number, over target.
    public let kcalOverLabel: String
    /// Fasting Live Activity (N3): the label above the elapsed timer. A noun,
    /// not a verb — the Lock Screen states what is happening, it does not
    /// instruct. Mirrors `metrics.fasting` in `src/i18n/`.
    public let fasting: String
    /// Fasting Live Activity: the honesty row under the timer. `%@` is a
    /// locale-formatted clock time. The timer alone cannot say *which* fast this
    /// is after a night's sleep; the start time can.
    public let fastSince: String
  }

  /// Keyed by the locale carried in the snapshot — our locale is a *profile*
  /// preference stored in Firestore, so the device locale would be wrong for
  /// anyone whose app language differs from their phone's. System locale is the
  /// fallback only when no blob has ever arrived, which is what `.empty(nil)`
  /// resolving to `"en"` expresses.
  public static func strings(_ locale: String) -> Strings {
    switch locale {
    case "es-PR":
      return Strings(
        kcal: "kcal",
        left: "restantes",
        over: "de más",
        protein: "proteína",
        empty: "Abre Ignia para empezar",
        emptyShort: "Abre Ignia",
        quickAddVerb: "Registrar",
        emptyWatch: "Esperando al iPhone",
        watchSubline: "Tus números se actualizan cuando tu iPhone está cerca.",
        asOf: "a las %@",
        kcalLeftLabel: "kcal restantes",
        kcalOverLabel: "kcal de más",
        fasting: "Ayuno",
        fastSince: "desde las %@"
      )
    default:
      return Strings(
        kcal: "kcal",
        left: "left",
        over: "over",
        protein: "protein",
        empty: "Open Ignia to start",
        emptyShort: "Open Ignia",
        quickAddVerb: "Log",
        emptyWatch: "Waiting for iPhone",
        watchSubline: "Your numbers update when your iPhone is nearby.",
        asOf: "as of %@",
        kcalLeftLabel: "kcal left",
        kcalOverLabel: "kcal over",
        fasting: "Fasting",
        fastSince: "since %@"
      )
    }
  }

  // MARK: - Marks
  //
  // A dated label + counter, written by whichever process did the thing and
  // read by whichever process can show it. Two callers today — the watch app's
  // ingest and the complication's timeline build — and they share this rather
  // than each hand-rolling the same JSON, because the whole value of a mark is
  // that two of them can be compared, and two encodings that drift cannot be.

  /// One recorded event: what happened, when, and how many times today.
  public struct Mark {
    public let label: String
    public let at: Date
    /// Resets at local midnight, because the budget it measures does.
    public let countToday: Int
  }

  /// Record that `label` just happened, incrementing today's counter.
  ///
  /// Best-effort and never throws: a diagnostic write must not be able to break
  /// the delivery it is describing. Same rule as `QuickAdd.record`.
  public static func bumpMark(_ key: String, label: String, now: Date = Date()) {
    guard let defaults = UserDefaults(suiteName: appGroup) else { return }
    let day = localDateKey(now)
    var count = 0
    if let existing = readMark(key), localDateKey(existing.at) == day {
      count = existing.countToday
    }
    let payload: [String: String] = [
      "label": label,
      "atMs": String(Int(now.timeIntervalSince1970 * 1000)),
      "count": String(count + 1),
    ]
    guard let data = try? JSONSerialization.data(withJSONObject: payload),
          let json = String(data: data, encoding: .utf8)
    else { return }
    defaults.set(json, forKey: key)
  }

  public static func readMark(_ key: String) -> Mark? {
    guard let defaults = UserDefaults(suiteName: appGroup),
          let json = defaults.string(forKey: key),
          let parsed = try? JSONSerialization.jsonObject(with: Data(json.utf8))
            as? [String: String],
          let label = parsed["label"],
          let ms = Double(parsed["atMs"] ?? "")
    else { return nil }
    return Mark(
      label: label,
      at: Date(timeIntervalSince1970: ms / 1000),
      countToday: Int(parsed["count"] ?? "0") ?? 0)
  }

  /// `userInfo 10:01 ·7` — deliberately terse and deliberately untranslated.
  /// It is a reading, not copy: the labels are the Swift callback names a
  /// diagnosis is made from, and translating them would break the only thing
  /// they are for.
  public static func markLine(_ prefix: String, _ mark: Mark?, locale: String) -> String {
    guard let mark else { return "\(prefix) —" }
    let f = DateFormatter()
    f.locale = Locale(identifier: locale)
    f.timeStyle = .short
    f.dateStyle = .none
    return "\(prefix) \(mark.label) \(f.string(from: mark.at)) ·\(mark.countToday)"
  }

  // MARK: - Formatting

  /// Digit grouping. Hardcodes `,` rather than following the blob's locale,
  /// because this is the formatter the shipped-and-device-verified iPhone
  /// widget already uses — one implementation across all surfaces is worth more
  /// here than per-locale separators, and switching would silently change a
  /// face that is live on the App Store.
  public static func grouped(_ n: Int) -> String {
    let f = NumberFormatter()
    f.numberStyle = .decimal
    f.groupingSeparator = ","
    return f.string(from: NSNumber(value: n)) ?? String(n)
  }

  /// `1,240 kcal left` / `1,240 kcal de más`.
  public static func kcalLine(_ m: Metric, _ s: Strings) -> String {
    "\(grouped(m.value)) \(s.kcal) \(m.isOver ? s.over : s.left)"
  }

  /// `68g protein left` / `68g de proteína restantes`.
  ///
  /// The es-PR string runs ~40% longer than the English one, which is why every
  /// layout carrying it is designed against es-PR rather than en (#43).
  public static func proteinLine(_ m: Metric, _ s: Strings) -> String {
    "\(grouped(m.value))g \(s.protein) \(m.isOver ? s.over : s.left)"
  }

  /// `as of 8:04 AM` / `a las 8:04`.
  ///
  /// Time goes through the OS for the **blob's** locale, so 12h/24h follows the
  /// user's own settings and nothing is hand-rolled. "as of" is not optional:
  /// a bare `8:04 AM` on a watch face sits inches from the actual clock reading
  /// 1:47 PM and reads as a second timepiece (#40 §2).
  public static func asOfLine(updatedMs: Double, locale: String) -> String {
    let f = DateFormatter()
    f.locale = Locale(identifier: locale)
    f.timeStyle = .short
    f.dateStyle = .none
    let time = f.string(from: Date(timeIntervalSince1970: updatedMs / 1000))
    return String(format: strings(locale).asOf, time)
  }

  /// `since 8:14 PM` / `desde las 20:14` — the fasting Live Activity's honesty
  /// row (N3).
  ///
  /// Same construction as `asOfLine`, and for the same reason: the clock format
  /// follows the *profile* locale through the OS rather than being hand-rolled.
  /// It is a separate function only because its input is a `Date` (the fast's
  /// start, carried in `FastActivityAttributes`) and not a snapshot's epoch
  /// milliseconds.
  public static func fastSinceLine(startedAt: Date, locale: String) -> String {
    let f = DateFormatter()
    f.locale = Locale(identifier: locale)
    f.timeStyle = .short
    f.dateStyle = .none
    return String(format: strings(locale).fastSince, f.string(from: startedAt))
  }
}
