import AppIntents
import Foundation

//
//  Ignia — the buttons ON the Live Activities: the rest timer's "+30 s" and
//  "Skip" (or "Done" once the rest is over), "Done set" inside a workout
//  (S23-8), and the fast's "End".
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
      // In line behind every other change to the Activity (RestActivityLane):
      // two quick taps cannot both read the same state (review P2-9).
      await RestActivityLane.run { await Self.apply() }.value
      return .result()
    }

    private static func apply() async {
      guard let live = RestActivityStore.current else { return }
      let now = Date()
      // From the deadline while the rest is running; from NOW once it has run
      // out, so +30 s on a stale "Rest over" face is a fresh 30 s, not a
      // deadline still in the past — and `retarget` restarts `startedAt` with
      // it, or the progress bar would draw those 30 s as a nearly-empty bar.
      let current = live.content.state
      var state = RestActivityStore.retarget(
        current, to: max(current.endsAt, now).addingTimeInterval(Self.step), now: now)
      state.idle = false
      IntentInbox.post("rest", ["endsAtMs": IntentInbox.ms(state.endsAt)])
      await live.update(RestActivityStore.content(state))
      await RestDoneNotification.move(to: state.endsAt)
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
      // In line behind every other change to the Activity (RestActivityLane):
      // two quick taps cannot both read the same state (review P2-9).
      await RestActivityLane.run { await Self.apply() }.value
      return .result()
    }

    private static func apply() async {
      // `endsAtMs: 0` is the inbox's word for "the rest is over, by choice" —
      // `applyRestInboxAction` in `src/lib/rest-timer-activity.ts` reads it as
      // a skip (silent), not as a rest that ran out (which buzzes).
      IntentInbox.post("rest", ["endsAtMs": 0])
      // Inside a workout (S23-8) the face stays, on the next set; otherwise
      // the rest was all it showed.
      if let live = RestActivityStore.current, let idle = RestActivityStore.idle(live.content.state) {
        await live.update(RestActivityStore.content(idle))
      } else {
        await RestActivityStore.endAll()
      }
      await RestDoneNotification.cancel()
    }
  }

  /// "Done set" — log the next planned set without unlocking (S23-8, Hevy
  /// parity).
  ///
  /// The set's identity and numbers come from the face itself (`upcoming`,
  /// built by JS with what a tick in the app would log), so what is logged is
  /// exactly what the lifter read. Natively this only moves the face: the
  /// rest that follows the set starts counting, the queue advances, and a
  /// "rest over" is scheduled for it. Ticking the set is the app's job —
  /// a Firestore write with the session's own rules — so the entry goes to
  /// the inbox and `applySetInboxAction` (`src/lib/rest-timer-activity.ts`)
  /// ticks that exact set, or ignores it if the workout moved on meanwhile.
  @available(iOS 17.0, *)
  struct SetDoneIntent: LiveActivityIntent {
    static var title: LocalizedStringResource = "Log next set"
    static var isDiscoverable: Bool = false
    static var openAppWhenRun: Bool = false

    init() {}

    func perform() async throws -> some IntentResult {
      // In line behind every other change to the Activity (RestActivityLane):
      // two quick taps cannot both read the same state (review P2-9).
      await RestActivityLane.run { await Self.apply() }.value
      return .result()
    }

    private static func apply() async {
      guard let live = RestActivityStore.current else { return }
      var state = live.content.state
      guard var queue = state.upcoming, !queue.isEmpty else { return }
      let set = queue.removeFirst()
      let now = Date()
      let resting = set.restSec > 0
      let endsAt = now.addingTimeInterval(resting ? set.restSec : 0)

      var fields: [String: Any] = [
        "sessionId": state.sessionId ?? "",
        "exerciseId": set.exerciseId,
        "exerciseIndex": set.exerciseIndex,
        "setIndex": set.setIndex,
        "endsAtMs": resting ? IntentInbox.ms(endsAt) : 0,
      ]
      if let w = set.weight { fields["weight"] = w }
      if let r = set.reps { fields["reps"] = r }
      if let d = set.durationSec { fields["durationSec"] = d }
      if let k = set.setKind { fields["setKind"] = k }
      if let g = set.group { fields["group"] = g }
      if let c = set.setCount { fields["setCount"] = c }
      // Inbox first, as every button here: a process suspended mid-perform
      // still leaves the app knowing which set the lifter confirmed.
      IntentInbox.post("set", fields, at: now)

      state.upcoming = queue
      state.exerciseName = set.name
      state.startedAt = now
      state.endsAt = endsAt
      state.idle = !resting
      if !resting && queue.isEmpty {
        await RestActivityStore.endAll()
        await RestDoneNotification.cancel()
        return
      }
      await live.update(RestActivityStore.content(state))
      if resting {
        await RestDoneNotification.schedule(at: endsAt)
      } else {
        await RestDoneNotification.cancel()
      }
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
