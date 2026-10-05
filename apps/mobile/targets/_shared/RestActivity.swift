import Foundation

#if os(iOS)
  import UserNotifications
#endif

//
//  Ignia — the rest-timer Live Activity's shared half (Train review item 20).
//
//  Same arrangement as `FastActivity.swift`, and read that file's header first:
//  the attributes type must exist in the app (which requests the Activity) and
//  in `Today.appex` (which draws it), `_shared` is the one directory that
//  reaches both, and `modules/rest-timer-activity` reaches the bridge below
//  through the Objective-C runtime because a CocoaPods target cannot see here.
//
//  ## Where it differs from the fast, and why
//
//  A fast is an elapsed timer from a fixed instant, so its `ContentState` is
//  empty and nothing is ever pushed. A rest is a COUNTDOWN whose deadline moves
//  — +30 s, −30 s, a new set ticked mid-rest — so the deadline lives in
//  `ContentState` and the app updates it locally (`Activity.update`). Still no
//  push token, no APNs, no server: every update comes from this device, either
//  from JS while Train is on screen or from the Lock Screen buttons
//  (`LiveActivityIntents.swift`), which run in the app's process.
//
//  The countdown itself is `Text(timerInterval:countsDown:)`, drawn by the
//  system from the clock, so it keeps moving with the JS runtime suspended —
//  which is the entire point: a lifter locks the phone between sets.
//
//  ## Ending at the deadline
//
//  ActivityKit has no "end at time T" for a running Activity — `end` can only
//  be called by code that is running, and at the deadline nothing of ours is.
//  So the Activity is requested with `staleDate: endsAt`; at that instant the
//  system flags it stale and the face switches to "Rest over" by itself
//  (`context.isStale`). The app then ends it on the next foreground
//  (`useRestTimer` reaching zero → `restActivity.end()`), and iOS's own
//  eight-hour ceiling is the backstop for a workout abandoned mid-rest.
//
//  ## The `@objc` contract
//
//  `IgniaRestActivity` and its four selectors are pinned with explicit names and
//  mirrored in `modules/rest-timer-activity/ios/RestTimerActivityModule.swift`.
//  Change one, change both — `src/__tests__/rest-activity-contract.test.ts`
//  greps the two files, because disagreeing is a silent no-op.
//

#if canImport(ActivityKit)
  import ActivityKit

  /// One rest between sets.
  ///
  /// `locale` is an attribute (fixed for the Activity's life) for the reason
  /// `FastActivityAttributes.locale` gives: our locale is a profile preference,
  /// not the phone's. Everything that can move during a workout is state.
  @available(iOS 16.1, *)
  public struct RestActivityAttributes: ActivityAttributes {
    public struct ContentState: Codable, Hashable {
      /// When THIS rest began — the left end of the Lock Screen progress bar.
      public var startedAt: Date
      /// When it is over. Moved by +30 s / −30 s, from the app or the buttons.
      public var endsAt: Date
      /// The exercise the rest follows. State, not an attribute, because the
      /// next set ticked on a different exercise updates the same Activity
      /// rather than replacing it.
      public var exerciseName: String

      public init(startedAt: Date, endsAt: Date, exerciseName: String) {
        self.startedAt = startedAt
        self.endsAt = endsAt
        self.exerciseName = exerciseName
      }
    }

    /// `"en"`, `"es-PR"` or `"pt-BR"`, matching `RestActivityWidget.swift`.
    public let locale: String

    public init(locale: String) {
      self.locale = locale
    }
  }

  @available(iOS 16.2, *)
  enum RestActivityStore {
    /// The one live rest, if any. There is never more than one by
    /// construction (`start` ends extras), but `first` keeps a stray from
    /// becoming a crash.
    static var current: Activity<RestActivityAttributes>? {
      Activity<RestActivityAttributes>.activities.first { $0.activityState == .active }
        ?? Activity<RestActivityAttributes>.activities.first
    }

    static func content(_ state: RestActivityAttributes.ContentState)
      -> ActivityContent<RestActivityAttributes.ContentState>
    {
      // `staleDate` IS the auto-end: see the header.
      ActivityContent(state: state, staleDate: state.endsAt)
    }

    /// End every rest Activity, immediately — a skipped or finished rest left
    /// on the Lock Screen is a timer that is no longer true.
    static func endAll() async {
      for activity in Activity<RestActivityAttributes>.activities {
        await activity.end(nil, dismissalPolicy: .immediate)
      }
    }
  }
#endif

//
//  MARK: - The local "rest over" notification
//
//  `useRestTimer` schedules a local notification at the deadline, with an id
//  that starts `ignia.restDone.` (`REST_DONE_ID_PREFIX` in `useRestTimer.ts`).
//  When a Lock Screen button moves or skips the rest, that notification must
//  move with it, or the phone buzzes "rest over" 30 s early — or for a rest
//  the lifter skipped. The intent runs in the app's process
//  (`LiveActivityIntent`), so it can reach the app's own pending requests;
//  matching on the prefix rather than an id keeps JS free to mint a fresh id per
//  rest, which its stale-schedule guard depends on.
//

#if os(iOS)
  enum RestDoneNotification {
    /// **Must equal `REST_DONE_ID_PREFIX` in `src/hooks/useRestTimer.ts`.**
    static let idPrefix = "ignia.restDone."

    /// Re-arm every pending rest notification for `date`, keeping its content
    /// (already localised by JS) and its id (so JS can still cancel it).
    static func move(to date: Date) async {
      let center = UNUserNotificationCenter.current()
      let pending = await center.pendingNotificationRequests()
      for request in pending where request.identifier.hasPrefix(idPrefix) {
        let interval = date.timeIntervalSinceNow
        guard interval >= 1 else {
          center.removePendingNotificationRequests(withIdentifiers: [request.identifier])
          continue
        }
        // Same identifier → replaces the pending request rather than adding one.
        let replacement = UNNotificationRequest(
          identifier: request.identifier,
          content: request.content,
          trigger: UNTimeIntervalNotificationTrigger(timeInterval: interval, repeats: false))
        try? await center.add(replacement)
      }
    }

    static func cancel() async {
      let center = UNUserNotificationCenter.current()
      let ids = await center.pendingNotificationRequests()
        .map(\.identifier)
        .filter { $0.hasPrefix(idPrefix) }
      if !ids.isEmpty { center.removePendingNotificationRequests(withIdentifiers: ids) }
    }
  }
#endif

//
//  MARK: - The bridge JS reaches
//
//  `perform(_:with:with:)` carries at most two objects, so `start` takes its
//  three values as one dictionary rather than growing a third argument the
//  runtime call cannot pass.
//

@objc(IgniaRestActivity)
public final class IgniaRestActivity: NSObject {

  /// Start the rest countdown, or retarget the one already showing.
  ///
  /// `payload`: `endsAtMs` (NSNumber), `exerciseName`, `locale` (NSString).
  ///
  /// **Update in place when one is live.** Every ticked set starts a rest, and
  /// ending + re-requesting per set would flash the Lock Screen and spend
  /// `Activity.request`, which iOS rate-limits. Only a locale change — an
  /// immutable attribute — forces a replacement.
  @objc(startWithPayload:)
  public static func start(_ payload: NSDictionary) -> NSString? {
    #if canImport(ActivityKit)
      guard #available(iOS 16.2, *) else { return "unsupported" as NSString }
      guard ActivityAuthorizationInfo().areActivitiesEnabled else { return "disabled" as NSString }
      guard let endsAtMs = (payload["endsAtMs"] as? NSNumber)?.doubleValue else {
        return "bad-payload" as NSString
      }
      let name = (payload["exerciseName"] as? String) ?? ""
      let locale = (payload["locale"] as? String) ?? "en"
      let state = RestActivityAttributes.ContentState(
        startedAt: Date(),
        endsAt: Date(timeIntervalSince1970: endsAtMs / 1000),
        exerciseName: name)

      if let live = RestActivityStore.current, live.attributes.locale == locale {
        let extras = Activity<RestActivityAttributes>.activities.filter { $0.id != live.id }
        Task {
          for extra in extras { await extra.end(nil, dismissalPolicy: .immediate) }
          await live.update(RestActivityStore.content(state))
        }
        return nil
      }

      Task { await RestActivityStore.endAll() }
      do {
        _ = try Activity.request(
          attributes: RestActivityAttributes(locale: locale),
          content: RestActivityStore.content(state),
          // Never a push token — every update is local. See the header.
          pushType: nil)
        return nil
      } catch {
        return String(describing: error) as NSString
      }
    #else
      return "unsupported" as NSString
    #endif
  }

  /// Move the deadline of the rest already showing. No-op when none is.
  @objc(updateWithEndsAt:)
  public static func update(_ endsAt: NSDate) -> NSString? {
    #if canImport(ActivityKit)
      guard #available(iOS 16.2, *) else { return "unsupported" as NSString }
      guard let live = RestActivityStore.current else { return "stopped" as NSString }
      var state = live.content.state
      state.endsAt = endsAt as Date
      Task { await live.update(RestActivityStore.content(state)) }
      return nil
    #else
      return "unsupported" as NSString
    #endif
  }

  /// Remove the countdown. Safe with none running.
  @objc(endActivity)
  public static func end() -> NSString? {
    #if canImport(ActivityKit)
      guard #available(iOS 16.2, *) else { return "unsupported" as NSString }
      Task { await RestActivityStore.endAll() }
      return nil
    #else
      return "unsupported" as NSString
    #endif
  }

  /// `"running:<endsAtEpochMillis>"`, `"stopped"`, `"disabled"`,
  /// `"unsupported"`. For JS's own reconciliation and for tests on a device.
  @objc(activityStatus)
  public static func status() -> NSString {
    #if canImport(ActivityKit)
      guard #available(iOS 16.2, *) else { return "unsupported" }
      guard ActivityAuthorizationInfo().areActivitiesEnabled else { return "disabled" }
      guard let live = RestActivityStore.current else { return "stopped" }
      return "running:\(IntentInbox.ms(live.content.state.endsAt))" as NSString
    #else
      return "unsupported"
    #endif
  }
}
