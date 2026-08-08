import ExpoModulesCore

/**
 * The JS entry point for the fasting Live Activity (N3).
 *
 * ## This file owns no ActivityKit code, on purpose
 *
 * `Activity.request` needs the `FastActivityAttributes` type, and that type must
 * be the one the widget extension renders against. It therefore lives in
 * `targets/_shared/FastActivity.swift`, which `@bacons/apple-targets` links into
 * both the main app and `Today.appex` — the standard ActivityKit arrangement,
 * where one declaration is compiled into the app and the extension.
 *
 * An Expo Module is neither: it is a CocoaPods target, and **cannot see
 * `_shared`** (the same wall `QuickAddCredentialsModule.swift` and
 * `modules/watch-link` document). The two options were to declare a second copy
 * of the attributes struct here, or to call across at runtime. A second copy is
 * free to drift, and drift would be invisible until a device shows no Lock
 * Screen — so this calls across instead. All three targets are linked into one
 * binary, so the Objective-C runtime resolves `IgniaFastActivity` with no
 * build-time dependency in either direction.
 *
 * ## The contract
 *
 * `IgniaFastActivity` and the three selectors below are pinned with explicit
 * `@objc(...)` names in `targets/_shared/FastActivity.swift`. **Change one,
 * change both in the same commit.** Disagreeing is a silent no-op: the fast
 * starts, the Lock Screen stays empty, nothing errors — so
 * `src/__tests__/fast-activity-contract.test.ts` greps the two files and fails
 * when they diverge, which is the only check that runs without a device.
 *
 * Every call returns a status string rather than throwing. A Live Activity that
 * will not start must never break `startFast`: the fast is the feature, the Lock
 * Screen is decoration.
 */
public class FastingLiveActivityModule: Module {
  /// Must equal the `@objc(...)` name on `IgniaFastActivity`.
  private static let BRIDGE_CLASS = "IgniaFastActivity"
  /// Must equal the `@objc(...)` selector names in `_shared/FastActivity.swift`.
  private static let SEL_START = "startWithStartedAt:locale:"
  private static let SEL_END = "endActivity"
  private static let SEL_STATUS = "activityStatus"

  public func definition() -> ModuleDefinition {
    Name("FastingLiveActivity")

    /// Start (or replace) the Live Activity for a fast that began at
    /// `startedAtMs`. Returns `nil` on success, else a reason.
    ///
    /// The start instant comes from JS rather than being taken here, because the
    /// authority is `profile.fastStartedAt` in Firestore — the same value
    /// `DailyMetrics` counts from. Using `Date()` here would make the Lock Screen
    /// disagree with the app by the round-trip, and would restart the timer at
    /// zero every time the 8-hour ceiling forces a re-arm.
    AsyncFunction("start") { (startedAtMs: Double, locale: String) -> String? in
      let startedAt = NSDate(timeIntervalSince1970: startedAtMs / 1000)
      return Self.call(
        Self.SEL_START, with: startedAt, with: locale as NSString)
    }

    AsyncFunction("end") { () -> String? in
      Self.call(Self.SEL_END)
    }

    /// `"stopped"`, `"disabled"`, `"unsupported"`,
    /// `"running:<startedAtEpochMillis>:<locale>"` — or `"unavailable"` if the
    /// bridge class is missing, which means this pod shipped without `_shared`.
    /// Parsed on the TS side; see `index.ts`.
    AsyncFunction("status") { () -> String in
      Self.call(Self.SEL_STATUS) ?? "unavailable"
    }
  }

  /// Invoke a class method on the app-target bridge.
  ///
  /// `perform` returns `Unmanaged<AnyObject>!`; the returned `NSString` is
  /// autoreleased (+0), so `takeUnretainedValue` is the correct transfer. A
  /// missing class or selector yields `nil`, which every caller above treats as
  /// "not available" rather than crashing — a `perform` against an unimplemented
  /// selector would otherwise raise.
  private static func call(
    _ selectorName: String, with a: Any? = nil, with b: Any? = nil
  ) -> String? {
    guard let cls = NSClassFromString(BRIDGE_CLASS) else { return nil }
    // Through `AnyObject`, not `AnyClass`: `responds(to:)`/`perform` come from
    // `NSObjectProtocol`, which `AnyClass` does not carry. Sent to the class
    // object, both address the CLASS methods, which is what the bridge declares.
    let target = cls as AnyObject
    let selector = NSSelectorFromString(selectorName)
    guard target.responds(to: selector) else { return nil }
    let result = target.perform(selector, with: a, with: b)
    return result?.takeUnretainedValue() as? String
  }
}
