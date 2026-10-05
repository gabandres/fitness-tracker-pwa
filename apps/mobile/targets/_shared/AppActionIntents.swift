import AppIntents
import Foundation

//
//  Ignia — Siri / Shortcuts actions that OPEN the app: "Log weight",
//  "Start fast", "End fast". Their phrases are in `IgniaShortcuts`
//  (`QuickAddIntents.swift`), because an app has exactly one provider.
//
//  ## Why these open the app, when quick-add does not
//
//  Quick-add writes one `dailyLogs` row over REST (`QuickAdd.swift`) because a
//  log is a single idempotent PATCH that the rules validate on its own. None of
//  these is that:
//
//    - **A weigh-in** goes through `writeDailyMetric`, which parks it on disk,
//      converts the display unit, and mirrors it to Apple Health
//      (`ledger-ops.ts`) — three behaviours a REST write here would silently
//      skip, and a kilogram/pound mistake on a spoken number is exactly the
//      error the sheet's preview line ("81.6 → 82.0 kg") and outlier check
//      exist to catch.
//    - **Starting or ending a fast** is the profile scalar plus, on end, a
//      batched archive write with an Undo receipt (ADR-0032).
//
//  So the intent opens the app and drops a note in the intent inbox
//  (`IntentInbox.swift`); Today reads it and runs the ordinary JS path, with the
//  ordinary receipt (the "Fast ended · Undo" toast, the weigh-in sheet). Honest
//  by construction: nothing is reported done until the app has done it, so
//  there is no dialog here to lie in.
//
//  ## Every parameter is OPTIONAL
//
//  An App Shortcut with a required parameter invalidates the WHOLE provider,
//  silently (AGENTS.md "iOS native traps"; build 27). `weight` is optional and
//  the sheet simply opens empty without it.
//

/// "Log my weight in Ignia." Opens the weigh-in sheet on Body, prefilled with
/// the number when one was given (Shortcuts, or "…82.5 kilos" in a shortcut
/// the user built). The number is read in the unit Ignia displays — the same
/// unit the sheet's field is in.
@available(iOS 16.0, *)
struct LogWeightIntent: AppIntent {
  static var title: LocalizedStringResource = "Log weight"
  static var description = IntentDescription(
    "Opens Ignia's weigh-in sheet, filled in with the weight if you give one.")
  static var openAppWhenRun: Bool = true

  /// Optional — see the header. Not range-checked here: the sheet owns the
  /// bounds (`weightBoundsFor`) in whichever unit the user reads, and says so.
  @Parameter(title: "Weight")
  var weight: Double?

  static var parameterSummary: some ParameterSummary {
    Summary("Log weight \(\.$weight)")
  }

  init() {}

  @MainActor
  func perform() async throws -> some IntentResult {
    var fields: [String: Any] = [:]
    if let weight, weight.isFinite, weight > 0 { fields["value"] = weight }
    IntentInbox.post("weight", fields)
    return .result()
  }
}

/// "Start a fast in Ignia." Starts it now, through the app's own `startFast`;
/// if one is already running the app shows it instead of restarting the clock.
@available(iOS 16.0, *)
struct StartFastIntent: AppIntent {
  static var title: LocalizedStringResource = "Start fast"
  static var description = IntentDescription("Starts a fast in Ignia, timed from now.")
  static var openAppWhenRun: Bool = true

  init() {}

  @MainActor
  func perform() async throws -> some IntentResult {
    IntentInbox.post("fastStart")
    return .result()
  }
}

/// "End my fast in Ignia." Ends the running fast at the moment it was spoken —
/// carried as `atMs`, so a slow cold launch does not lengthen the fast.
@available(iOS 16.0, *)
struct StopFastIntent: AppIntent {
  static var title: LocalizedStringResource = "End fast"
  static var description = IntentDescription("Ends the fast that's running in Ignia.")
  static var openAppWhenRun: Bool = true

  init() {}

  @MainActor
  func perform() async throws -> some IntentResult {
    IntentInbox.post("fastStop")
    return .result()
  }
}
