import AppIntents
import Foundation

//
//  Ignia — the buttons ON the Live Activities: the rest timer's "+30 s" and
//  "Skip" (or "Done" once the rest is over), and the fast's "End".
//
//  ## Why `LiveActivityIntent`, and why here
//
//  A `Button(intent:)` in a Live Activity is drawn by `Today.appex`, so the
//  intent type must compile into the extension — but changing an Activity, and
//  reaching the app's own pending notifications, are app-process acts.
//  `LiveActivityIntent` is Apple's documented lever for exactly that: the
//  system performs the intent in the APP's process, launching it in the
//  background if needed (the same routing `LogQuickAddSlotIntent` relies on —
//  see `QuickAddIntents.swift` and ADR-0023). `_shared` is the one directory
//  compiled into both, so the types live here.
//
//  Everything is `#if canImport(ActivityKit)`: this file is globbed into the
//  watch targets too, where ActivityKit does not exist (`FastActivity.swift`).
//  `LiveActivityIntent` is iOS 17; the app floor is 16.4, hence `@available`.
//  The widget target is pinned to 17.0, so `Button(intent:)` needs no check.
//
//  ## None of these are discoverable
//
//  They are bound to a face, not to a sentence — "Skip rest" spoken to Siri
//  with no workout running is meaningless — so `isDiscoverable = false` keeps
//  them out of the Shortcuts app, and they are absent from
//  `IgniaShortcuts`. The spoken fast intents are separate types
//  (`AppActionIntents.swift`) because they open the app; these never do.
//
//  ## The sync rule, stated once
//
//  Each button (1) changes the Activity — the user's receipt, instant and local
//  — then (2) records the outcome in the intent inbox (`IntentInbox.swift`),
//  which JS applies to the in-app state on its next chance: at once when the
//  app process is alive (the Darwin doorbell), else on the next foreground.
//  The inbox write comes FIRST in code, so a process suspended mid-`perform`
//  still leaves the app knowing what the user asked for.
//

#if canImport(ActivityKit)
  import ActivityKit

  /// "+30 s" on the rest timer.
  @available(iOS 17.0, *)
  struct RestAddTimeIntent: LiveActivityIntent {
    static var title: LocalizedStringResource = "Add 30 seconds to rest"
    static var isDiscoverable: Bool = false
    static var openAppWhenRun: Bool = false

    /// Fixed, not a parameter: the face has one button and one meaning, the
    /// same 30 s the in-app rest bar's + adds (`ActiveSession.adjustRest`).
    static let step: TimeInterval = 30

    init() {}

    func perform() async throws -> some IntentResult {
      guard let live = RestActivityStore.current else { return .result() }
      let now = Date()
      // From the deadline while the rest is running; from NOW once it has run
      // out, so +30 s on a stale "Rest over" face is a fresh 30 s, not a
      // deadline still in the past — and `retarget` restarts `startedAt` with
      // it, or the progress bar would draw those 30 s as a nearly-empty bar.
      let current = live.content.state
      let state = RestActivityStore.retarget(
        current, to: max(current.endsAt, now).addingTimeInterval(Self.step), now: now)
      IntentInbox.post("rest", ["endsAtMs": IntentInbox.ms(state.endsAt)])
      await live.update(RestActivityStore.content(state))
      await RestDoneNotification.move(to: state.endsAt)
      return .result()
    }
  }

  /// "Skip" on the rest timer.
  @available(iOS 17.0, *)
  struct RestSkipIntent: LiveActivityIntent {
    static var title: LocalizedStringResource = "Skip rest"
    static var isDiscoverable: Bool = false
    static var openAppWhenRun: Bool = false

    init() {}

    /// Also the stale ("Rest over") face's "Done" button
    /// (`RestActivityWidget.RestButtons`): Skip on a rest that is already over
    /// offered to skip nothing, so that face labels the same act "Done". The
    /// effect is identical — end the Activity, drop any pending buzz, tell the
    /// app the rest is closed (silent; ignored when its own tick already closed
    /// it) — so it stays one type rather than a twin with the same body.
    func perform() async throws -> some IntentResult {
      // `endsAtMs: 0` is the inbox's word for "the rest is over, by choice" —
      // `applyRestInboxAction` in `src/lib/rest-timer-activity.ts` reads it as
      // a skip (silent), not as a rest that ran out (which buzzes).
      IntentInbox.post("rest", ["endsAtMs": 0])
      await RestActivityStore.endAll()
      await RestDoneNotification.cancel()
      return .result()
    }
  }

  /// "End" on the fasting Live Activity.
  ///
  /// Ends the Activity at once and hands the Firestore write to the app — see
  /// `IntentInbox.swift` for why this does not do the REST write itself. The
  /// fast's own start instant rides along, so the app can refuse to end a
  /// DIFFERENT fast than the one the user was looking at (one restarted on
  /// another device in between).
  @available(iOS 17.0, *)
  struct EndFastIntent: LiveActivityIntent {
    static var title: LocalizedStringResource = "End fast"
    static var isDiscoverable: Bool = false
    static var openAppWhenRun: Bool = false

    init() {}

    func perform() async throws -> some IntentResult {
      let ended = Date()
      let live = Activity<FastActivityAttributes>.activities
      guard let first = live.first else { return .result() }
      IntentInbox.post(
        "fastEnd",
        [
          "startedAtMs": IntentInbox.ms(first.attributes.startedAt),
          "endedAtMs": IntentInbox.ms(ended),
        ],
        at: ended)
      for activity in live {
        await activity.end(nil, dismissalPolicy: .immediate)
      }
      return .result()
    }
  }
#endif
