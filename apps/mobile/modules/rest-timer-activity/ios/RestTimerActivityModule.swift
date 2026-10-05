import ExpoModulesCore

/**
 * The JS entry point for the rest-timer Live Activity (Train review item 20).
 *
 * ## This file owns no ActivityKit code, on purpose
 *
 * Exactly the arrangement `FastingLiveActivityModule.swift` documents, for the
 * same reason: `Activity.request` needs `RestActivityAttributes`, which must be
 * the one declaration the widget extension renders against, so it lives in
 * `targets/_shared/RestActivity.swift`. An Expo Module is a CocoaPods target and
 * cannot see `_shared`, so this calls across through the Objective-C runtime —
 * all of it is linked into one binary, so `NSClassFromString` resolves.
 *
 * ## The contract
 *
 * `IgniaRestActivity` and the four selectors below are pinned with explicit
 * `@objc(...)` names in `targets/_shared/RestActivity.swift`. **Change one,
 * change both in the same commit.** Disagreeing is a silent no-op — the rest
 * still counts in the app, the Lock Screen stays empty — so
 * `src/__tests__/rest-activity-contract.test.ts` greps both files.
 *
 * Every call returns a status string rather than throwing. A Lock Screen timer
 * that will not start must never break a set being ticked.
 */
public class RestTimerActivityModule: Module {
  /// Must equal the `@objc(...)` name on `IgniaRestActivity`.
  private static let BRIDGE_CLASS = "IgniaRestActivity"
  /// Must equal the `@objc(...)` selector names in `_shared/RestActivity.swift`.
  private static let SEL_START = "startWithPayload:"
  private static let SEL_UPDATE = "updateWithEndsAt:"
  private static let SEL_END = "endActivity"
  private static let SEL_STATUS = "activityStatus"

  public func definition() -> ModuleDefinition {
    Name("RestTimerActivity")

    /// Start the countdown to `endsAtMs`, or retarget the one showing.
    /// Returns `nil` on success, else a reason.
    ///
    /// The deadline is absolute (epoch ms), never a duration: the Lock Screen
    /// draws a system timer counting down to a DATE, which is what keeps it
    /// right while JS is suspended.
    AsyncFunction("start") { (endsAtMs: Double, exerciseName: String, locale: String) -> String? in
      let payload: NSDictionary = [
        "endsAtMs": NSNumber(value: endsAtMs),
        "exerciseName": exerciseName,
        "locale": locale,
      ]
      return Self.call(Self.SEL_START, with: payload)
    }

    AsyncFunction("update") { (endsAtMs: Double) -> String? in
      Self.call(Self.SEL_UPDATE, with: NSDate(timeIntervalSince1970: endsAtMs / 1000))
    }

    AsyncFunction("end") { () -> String? in
      Self.call(Self.SEL_END)
    }

    /// `"running:<endsAtEpochMillis>"`, `"stopped"`, `"disabled"`,
    /// `"unsupported"` — or `"unavailable"` when the bridge class is missing,
    /// which means this pod shipped without `_shared`.
    AsyncFunction("status") { () -> String in
      Self.call(Self.SEL_STATUS) ?? "unavailable"
    }
  }

  /// Invoke a class method on the app-target bridge. Same body, same ownership
  /// reasoning (+0 autoreleased `NSString`, `takeUnretainedValue`) and same
  /// nil-on-missing behaviour as `FastingLiveActivityModule.call`.
  private static func call(_ selectorName: String, with a: Any? = nil) -> String? {
    guard let cls = NSClassFromString(BRIDGE_CLASS) else { return nil }
    let target = cls as AnyObject
    let selector = NSSelectorFromString(selectorName)
    guard target.responds(to: selector) else { return nil }
    let result = target.perform(selector, with: a)
    return result?.takeUnretainedValue() as? String
  }
}
