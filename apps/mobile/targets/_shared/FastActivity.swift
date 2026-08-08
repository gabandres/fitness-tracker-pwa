import Foundation

//
//  Ignia — N3, the fasting Live Activity's shared half.
//
//  ## What is shared and why it has to be
//
//  ActivityKit pairs a running `Activity<A>` with the `ActivityConfiguration(for:
//  A.self)` that renders it. The attributes type must therefore exist in BOTH the
//  app (which starts the Activity) and the widget extension (which draws it) —
//  Apple's own setup is one source file with two target memberships, i.e. two
//  distinct Swift modules compiling the same declaration. `targets/_shared/` is
//  this repo's version of that, and the only directory that reaches both.
//
//  ## The design: nothing is ever pushed to this Activity
//
//  A fast is an elapsed timer from a fixed start date, so the ENTIRE dynamic part
//  is `Text(timerInterval:)`, which SwiftUI redraws on-device from the system
//  clock. That is the whole cost story: no APNs push token, no background
//  refresh, no Cloud Function, no secret, no Firestore field. Two calls exist in
//  the lifetime of a fast — `start` and `end` — and `ContentState` is empty
//  because there is genuinely nothing to update.
//
//  Do not add a field to `ContentState` without re-reading that paragraph. The
//  moment something in here needs updating, N3 stops being free.
//
//  ## The eight-hour ceiling is real, and the mitigation lives in JS
//
//  iOS ends a Live Activity after **8 hours** and removes it from the Lock Screen
//  4 hours after that. A 16:8 fast outlives both. Nothing here can prevent it —
//  an Activity can only be *requested* while the app is in the foreground, so the
//  system cannot be asked to extend one from the background.
//
//  What makes it survivable is that `startedAt` is the true fast start, not the
//  Activity's start: re-requesting produces a timer showing the correct elapsed
//  time, not one restarting from zero. So `src/hooks/useFastActivity.ts` re-arms
//  on every app foreground when a fast is running and no Activity is live. A
//  16-hour fast therefore shows a correct timer whenever the user has opened the
//  app in the last 8 hours, and shows nothing otherwise. That is the honest
//  ceiling of the feature; it is not a bug to be fixed later.
//
//  ## Availability
//
//  This file compiles into the watch app and the watch complication too (the
//  `_shared` glob is unconditional — see `Glance.swift` rule 1), and ActivityKit
//  does not exist on watchOS 10. Hence `#if canImport(ActivityKit)` rather than
//  an `@available` alone. The main app's floor is 16.4 and ActivityKit's is 16.1,
//  so the `@available(iOS 16.1, *)` guards are satisfied everywhere they compile.
//

#if canImport(ActivityKit)
  import ActivityKit

  /// The fast being displayed. Every field is fixed for the life of the Activity.
  ///
  /// `startedAt` is `profile.fastStartedAt` (`packages/core/src/types.ts`), the
  /// same instant `DailyMetrics` counts from, so the Lock Screen and the app can
  /// never disagree by construction.
  ///
  /// `locale` is carried rather than read from the device for the reason
  /// `Glance.strings` documents: our locale is a *profile* preference in
  /// Firestore, and a user whose app language differs from their phone's would
  /// otherwise get a Lock Screen in the wrong language.
  @available(iOS 16.1, *)
  public struct FastActivityAttributes: ActivityAttributes {
    /// Deliberately empty. See the header — nothing is ever pushed.
    public struct ContentState: Codable, Hashable {
      public init() {}
    }

    public let startedAt: Date
    /// `"en"` or `"es-PR"`, matching `Glance.strings`.
    public let locale: String

    public init(startedAt: Date, locale: String) {
      self.startedAt = startedAt
      self.locale = locale
    }
  }
#endif

//
//  MARK: - The bridge JS reaches
//
//  `Activity.request` must run in the app's process with the app in the
//  foreground, and the attributes type above lives in the app target. React
//  Native cannot call either directly: `modules/fasting-live-activity` is an Expo
//  Module, which is a CocoaPods target and **cannot see `_shared`** — the same
//  wall `QuickAddCredentialsModule.swift` and `modules/watch-link` document.
//
//  Rather than duplicate the attributes struct into the pod (two declarations of
//  the type ActivityKit matches by name, free to drift, drift detectable only on
//  a device), the pod finds this class through the Objective-C runtime. Both are
//  linked into one binary, so `NSClassFromString` resolves at runtime with no
//  build-time dependency in either direction.
//
//  **The `@objc` names below are a contract with
//  `modules/fasting-live-activity/ios/FastingLiveActivityModule.swift`.** They are
//  pinned explicitly, not synthesised, so Swift name mangling cannot move them.
//  Change one, change both in the same commit. The failure mode of disagreeing is
//  a silent no-op: the fast still starts, nothing appears on the Lock Screen, and
//  nothing anywhere errors — so it is checked by
//  `src/__tests__/fast-activity-contract.test.ts`, which greps both files.
//
//  Every method returns `NSString?`: `nil` means it worked, anything else is a
//  reason, surfaced to JS and swallowed there. A Live Activity that will not
//  start must never break `startFast` — the fast is the feature, the Lock Screen
//  is decoration.
//

@objc(IgniaFastActivity)
public final class IgniaFastActivity: NSObject {

  /// Start (or replace) the fast Live Activity.
  ///
  /// Replacing rather than reusing is deliberate: `startedAt` is in the
  /// attributes, which are immutable, so a fast that is stopped and restarted
  /// needs a new Activity. Ending the old one first keeps at most one alive.
  @objc(startWithStartedAt:locale:)
  public static func start(_ startedAt: NSDate, _ locale: NSString) -> NSString? {
    #if canImport(ActivityKit)
      guard #available(iOS 16.1, *) else { return "unsupported" as NSString }
      guard ActivityAuthorizationInfo().areActivitiesEnabled else {
        // The user switched Live Activities off for Ignia in Settings. Not an
        // error — a preference, and one we must not nag about.
        return "disabled" as NSString
      }

      endAllSync()

      do {
        _ = try Activity.request(
          attributes: FastActivityAttributes(
            startedAt: startedAt as Date, locale: locale as String),
          // `staleDate: nil` — there is no state that can go stale. The system's
          // own 8-hour ceiling is what ends this, not us.
          content: .init(state: FastActivityAttributes.ContentState(), staleDate: nil),
          // `.none`, emphatically. A push token would mean APNs, a server, and a
          // secret, for a timer the device can already draw.
          pushType: nil)
        return nil
      } catch {
        return String(describing: error) as NSString
      }
    #else
      return "unsupported" as NSString
    #endif
  }

  /// End the fast Live Activity, if one is running.
  ///
  /// `.immediate` because the fast is over the instant the user taps: leaving a
  /// finished fast on the Lock Screen for the default four hours would show a
  /// timer that is no longer true.
  @objc(endActivity)
  public static func end() -> NSString? {
    #if canImport(ActivityKit)
      guard #available(iOS 16.1, *) else { return "unsupported" as NSString }
      endAllSync()
      return nil
    #else
      return "unsupported" as NSString
    #endif
  }

  /// `"stopped"`, `"disabled"`, `"unsupported"` — or, when one is live,
  /// `"running:<startedAtEpochMillis>:<locale>"`.
  ///
  /// This is what makes the 8-hour ceiling survivable: JS asks on every
  /// foreground and re-arms when a fast is running but the Activity is not.
  ///
  /// The running case carries the attributes back rather than answering a bare
  /// `"running"` because a live Activity's attributes are immutable and JS
  /// cannot otherwise see them. Without it, an app launched cold after the fast
  /// was changed elsewhere — broken and restarted in the web PWA, which writes
  /// the same `fastStartedAt` — would find `"running"`, decide there was nothing
  /// to do, and leave a Lock Screen counting from the wrong instant with no
  /// event that would ever correct it.
  ///
  /// A delimited string rather than a dictionary because the whole bridge
  /// crosses `perform(_:with:with:)`, which returns one object; `:` is safe as a
  /// separator since the other two fields are digits and a locale identifier.
  @objc(activityStatus)
  public static func status() -> NSString {
    #if canImport(ActivityKit)
      guard #available(iOS 16.1, *) else { return "unsupported" }
      guard ActivityAuthorizationInfo().areActivitiesEnabled else { return "disabled" }
      guard let live = Activity<FastActivityAttributes>.activities.first else { return "stopped" }
      let ms = Int((live.attributes.startedAt.timeIntervalSince1970 * 1000).rounded())
      return "running:\(ms):\(live.attributes.locale)" as NSString
    #else
      return "unsupported"
    #endif
  }

  #if canImport(ActivityKit)
    /// End every fast Activity we can see.
    ///
    /// `Activity.end` is `async`; this is called from synchronous `@objc` entry
    /// points, so the work is detached. Ending is best-effort by nature — the
    /// system may already have ended it at the 8-hour mark — so there is nothing
    /// useful to await or report.
    @available(iOS 16.1, *)
    private static func endAllSync() {
      for activity in Activity<FastActivityAttributes>.activities {
        Task {
          await activity.end(
            ActivityContent(state: FastActivityAttributes.ContentState(), staleDate: nil),
            dismissalPolicy: .immediate)
        }
      }
    }
  #endif
}
