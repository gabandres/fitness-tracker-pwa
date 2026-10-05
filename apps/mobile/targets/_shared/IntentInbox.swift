import Foundation

//
//  Ignia — the intent inbox: how a Live Activity button or a Siri phrase tells
//  the React Native app that something happened while it was not looking.
//
//  ## The problem it solves
//
//  An App Intent runs in Swift, with no JS runtime, no Firebase SDK and — when
//  the system performs it inside `Today.appex` — not even the app's process.
//  Three things it needs to report cannot be finished there honestly:
//
//    - **The rest timer's +30 s / Skip** move a countdown the app ALSO draws
//      (`useRestTimer`). The Lock Screen and the app must agree when the user
//      comes back, or the in-app bar shows a rest the lifter already skipped.
//    - **End fast** from the fasting Live Activity. Ending a fast is a batched
//      Firestore write with an Undo receipt (`ledger.ts` `breakFast`, ADR-0032).
//      Re-implementing that batch over REST here — the `QuickAdd.swift`
//      pattern — would be a third copy of a write whose two halves must commit
//      together, validated against `firestore.rules` from a process nothing can
//      debug. So the intent ENDS THE ACTIVITY (instant, local, the receipt the
//      user sees) and leaves the write to the app's own `breakFast`, carrying
//      the instant the user tapped so the archived fast ends when they said.
//    - **Siri "Log weight" / "Start fast" / "End fast"** open the app, and the
//      app has to know which sheet to put up and with what.
//
//  ## The shape
//
//  A small JSON array in the App Group (`key`), one object per action, each
//  with a `kind` and an `atMs`. Written here; read-and-removed by
//  `modules/intent-inbox` (`take`) from JS. Then a Darwin notification
//  (`darwinName`), so an app process that is alive — the normal case, since a
//  `LiveActivityIntent` runs IN the app's process — drains it at once instead
//  of on the next foreground. The App Group is the durable half; the
//  notification is only a doorbell, and a missed doorbell costs latency, not
//  data.
//
//  **The three constants below are a contract with
//  `modules/intent-inbox/ios/IntentInboxModule.swift`**, which is a CocoaPods
//  target and cannot see this file (the same wall `FastActivity.swift`
//  documents). `src/__tests__/intent-inbox-contract.test.ts` greps both.
//
//  Foundation only, and namespaced, per `Glance.swift`'s two rules: this file is
//  globbed into every target including both watch targets.
//

public enum IntentInbox {
  /// App Group key. **Must equal `KEY` in `IntentInboxModule.swift`.**
  public static let key = "ignia.intentInbox.v1"
  /// Darwin notification name. **Must equal `DARWIN_NAME` in that module.**
  public static let darwinName = "fit.ignia.intentInbox.changed"
  /// Bounded so a JS side that never drains (signed out for a month) cannot
  /// grow the App Group without limit. Oldest drop first.
  static let max = 20

  /// Kinds that only ever mean "the latest state". A second +30 s replaces the
  /// first rather than queueing behind it: the app needs where the countdown
  /// IS, not a history of taps to replay.
  static let latestWins: Set<String> = ["rest"]

  /**
   * Append one action and ring the doorbell.
   *
   * Best-effort and never throws, for the reason every App Group write in this
   * directory gives: a diagnostic or hand-off write must not be able to fail
   * the intent that made it. `fields` must be JSON-serialisable — numbers and
   * strings only, by convention.
   */
  public static func post(_ kind: String, _ fields: [String: Any] = [:], at: Date = Date()) {
    guard let defaults = UserDefaults(suiteName: Glance.appGroup) else { return }
    var list: [[String: Any]] = []
    if let json = defaults.string(forKey: key),
       let parsed = try? JSONSerialization.jsonObject(with: Data(json.utf8)) as? [[String: Any]] {
      list = parsed
    }
    if latestWins.contains(kind) {
      list.removeAll { ($0["kind"] as? String) == kind }
    }
    var entry = fields
    entry["kind"] = kind
    entry["atMs"] = Int((at.timeIntervalSince1970 * 1000).rounded())
    list.append(entry)
    if list.count > max { list.removeFirst(list.count - max) }

    guard let data = try? JSONSerialization.data(withJSONObject: list),
          let out = String(data: data, encoding: .utf8)
    else { return }
    defaults.set(out, forKey: key)

    // Cross-process as well as in-process: Darwin notifications reach the app
    // from `Today.appex` too, when the app happens to be alive.
    CFNotificationCenterPostNotification(
      CFNotificationCenterGetDarwinNotifyCenter(),
      CFNotificationName(darwinName as CFString),
      nil, nil, true)
  }

  /// Epoch milliseconds, the unit every JS reader of this inbox expects.
  public static func ms(_ date: Date) -> Int {
    Int((date.timeIntervalSince1970 * 1000).rounded())
  }
}
