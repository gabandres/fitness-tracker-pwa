import ExpoModulesCore
import WatchConnectivity

//
//  WatchLink — the phone half of the watch transport. One function.
//
//  ## Why this is hand-written and not a package
//
//  `react-native-watch-connectivity@2.0.0` is a genuine TurboModule on a
//  supported RN floor, and was still rejected: it ships **no `app.plugin.js`**
//  and the author claims only "Bare Workflow with EAS Build", so autolinking
//  under SDK 54 CNG prebuild is unverified. EAS iOS builds are the scarce
//  resource here, not money, and discovering an autolink failure costs one. A
//  first-party Expo Module autolinks by construction (#37 §3).
//
//  The tradeoff accepted: we own this Swift across SDK bumps. It is one
//  function.
//
//  ## It is a dumb pipe, on purpose
//
//  This module never learns the snapshot contract. It forwards a dictionary
//  from JS and compares it against what was last sent. The wire shape, the key
//  names, the version gate and the staleness rule all live in
//  `packages/core/src/widget-snapshot.ts` and its Swift mirror
//  `targets/_shared/Glance.swift`, neither of which this pod can see — Expo
//  Modules are CocoaPods targets, not apple-targets. Under this design it does
//  not need to (#38, consequence A).
//
//  ## It returns rather than throws
//
//  `WCSession` on an iPhone activates fine with no watch paired, and then
//  raises `WCError.deviceNotPaired` / `.watchAppNotInstalled` on send. That is
//  the **normal** case on most installs, not an edge case. A dumb pipe that
//  throws on every watch-less iPhone is a trap, and pushing the guard into JS
//  would mean re-deriving watch-pairing state on the TS side — exactly the
//  knowledge this module exists to hold (#44 §5.3).
//
//  Note `isPaired` cannot serve as a pre-check: Apple documents it as "only
//  valid when the session's activationState is .activated".
//

private final class WatchLinkSession: NSObject, WCSessionDelegate {
  static let shared = WatchLinkSession()

  /// The last context JS asked us to assert. Held in memory so it can be
  /// re-asserted on the two transitions that create a delivery hole: session
  /// activation, and the watch being paired or the watch app installed while
  /// this process is alive (#39 §4).
  ///
  /// The model in one line: **the phone asserts what the wrist should show, on
  /// every activation. When there is no session, the answer is nothing** — JS
  /// pushes the clear envelope on sign-out, so "nothing" is just another
  /// desired context and needs no special case here (#44 §6).
  private var desired: [String: Any]?

  private override init() { super.init() }

  var isSupported: Bool { WCSession.isSupported() }

  private var activatedSession: WCSession? {
    guard WCSession.isSupported() else { return nil }
    let session = WCSession.default
    guard session.activationState == .activated else { return nil }
    return session
  }

  var isPaired: Bool { activatedSession?.isPaired ?? false }
  var isWatchAppInstalled: Bool { activatedSession?.isWatchAppInstalled ?? false }

  /// Whether the complication is on an ACTIVE WATCH FACE. Deliberately
  /// surfaced to JS: it is the single fact that decides whether the waking
  /// path in `assert` runs at all, and it is `false` for a widget sitting in
  /// the Smart Stack — which looks identical to the user and is the most
  /// likely reason a "why is my face stale" report has no obvious cause.
  var isComplicationEnabled: Bool { activatedSession?.isComplicationEnabled ?? false }

  /// How many of the day's 50 complication transfers are left. Read-only
  /// diagnostics; nothing branches on it but `assert`.
  var remainingComplicationTransfers: Int {
    activatedSession?.remainingComplicationUserInfoTransfers ?? 0
  }

  func start() {
    guard WCSession.isSupported() else { return }
    let session = WCSession.default
    session.delegate = self
    session.activate()
  }

  /// Send `record` unless the counterpart already holds exactly it.
  ///
  /// Returns whether anything was handed to the system. `false` covers both
  /// "no watch to send to" and "already in sync" — neither is an error, and
  /// the caller treats them identically.
  ///
  /// ## Two queues, on purpose (2026-08-10)
  ///
  /// `updateApplicationContext` alone was the whole transport, and it is why
  /// the face went stale: Apple delivers it **opportunistically** and it does
  /// not reliably wake a watch app that is not already running. No wake means
  /// no App Group write, which means the complication has nothing new to
  /// render — and the hourly re-ask in the complication's own timeline cannot
  /// help, because it re-reads the same container it read an hour ago.
  ///
  /// `transferCurrentComplicationUserInfo` is the API documented to **wake the
  /// watch app** even when it is backgrounded or has never been opened. It is
  /// the one that actually moves data. But it is not sufficient alone either:
  ///
  ///   - it needs `isComplicationEnabled`, which is **false when the widget
  ///     lives in the Smart Stack** rather than on an active watch face, and
  ///   - it is capped at **50 transfers per watch per day**
  ///     (`remainingComplicationUserInfoTransfers`), and
  ///   - developers report it failing to wake the extension on some real
  ///     watchOS 10/11 devices while working in the simulator.
  ///
  /// So both are sent. They are separate delivery queues carrying the identical
  /// envelope, the watch stores from either one through the same `store()`, and
  /// whichever arrives first simply wins — the payload is latest-wins by
  /// construction, so a double delivery is a no-op, not a duplicate.
  @discardableResult
  func assert(_ record: [String: Any]) -> Bool {
    desired = record
    guard let session = activatedSession else { return false }

    // The dedupe gate guards BOTH sends, and it now protects a hard quota as
    // well as a soft one: a redundant send spends a wake on the watch (whose
    // `reloadTimelines` counts against the 40–75/day reload budget) and, with
    // the complication queue in play, one of only 50 daily transfers.
    if sameContext(session.applicationContext, record) { return false }

    var handedOff = false

    // 1. The waking path. Skipped when the complication is not on a face, or
    //    when the day's 50 are spent — in both cases (2) still runs.
    if session.isComplicationEnabled, session.remainingComplicationUserInfoTransfers > 0 {
      session.transferCurrentComplicationUserInfo(record)
      handedOff = true
    }

    // 2. The durable path. Latest-wins, never queues, and survives as
    //    `receivedApplicationContext` for a watch app that starts later — which
    //    is what `ingest()` and `start()` on the watch side read.
    do {
      try session.updateApplicationContext(record)
      handedOff = true
    } catch {
      // `deviceNotPaired` / `watchAppNotInstalled` are the ordinary case, not
      // a fault. Anything else is equally unactionable from JS: there is no
      // retry that would help, and the next `assert` re-sends anyway.
    }

    return handedOff
  }

  /// Equality over the one-key string envelope this transport carries. Kept
  /// deliberately narrow — a general `NSDictionary` compare would invite
  /// richer payloads, and the whole point of the envelope is that there is
  /// only ever one string in it (#38 §3).
  private func sameContext(_ a: [String: Any], _ b: [String: Any]) -> Bool {
    guard a.count == b.count else { return false }
    for (key, value) in b {
      guard let lhs = a[key] as? String, let rhs = value as? String, lhs == rhs else {
        return false
      }
    }
    return true
  }

  private func reassert() {
    guard let desired else { return }
    _ = assert(desired)
  }

  // MARK: WCSessionDelegate
  //
  // No phone-side events reach JS. The phone never listens; the watch does
  // (#37 §3). These callbacks exist only to re-assert.

  func session(
    _ session: WCSession,
    activationDidCompleteWith activationState: WCSessionActivationState,
    error: Error?
  ) {
    guard error == nil, activationState == .activated else { return }
    reassert()
  }

  /// Fires on exactly the pairing and installation transitions that strand a
  /// context in the daemon.
  func sessionWatchStateDidChange(_ session: WCSession) {
    reassert()
  }

  // Required on iOS. Switching to a second watch deactivates the session and
  // hands us a new one; re-activating and re-asserting is what keeps the new
  // wrist in step.
  func sessionDidBecomeInactive(_ session: WCSession) {}

  func sessionDidDeactivate(_ session: WCSession) {
    session.activate()
  }
}

public class WatchLinkModule: Module {
  public func definition() -> ModuleDefinition {
    Name("WatchLink")

    OnCreate {
      WatchLinkSession.shared.start()
    }

    Property("isSupported") { WatchLinkSession.shared.isSupported }
    Property("isPaired") { WatchLinkSession.shared.isPaired }
    Property("isWatchAppInstalled") { WatchLinkSession.shared.isWatchAppInstalled }
    Property("isComplicationEnabled") { WatchLinkSession.shared.isComplicationEnabled }
    Property("remainingComplicationTransfers") {
      WatchLinkSession.shared.remainingComplicationTransfers
    }

    /// The single verb. `record` is the envelope JS built; this module does not
    /// know or care what is inside it.
    ///
    /// **The name is now narrower than the behaviour, and it stays anyway.**
    /// Since 2026-08-10 this asserts the context over both WatchConnectivity
    /// queues, not just the application context. Renaming it would be more
    /// honest and is exactly the wrong trade here: Expo Modules bind by name,
    /// Swift under `modules/` does NOT move the runtime fingerprint, and a
    /// JS-only OTA carrying a renamed call would therefore land happily on an
    /// older binary whose native side still exports the old name — breaking the
    /// watch push on every install that had not taken the new build. The
    /// doc comment is the cheaper half of that trade.
    Function("updateApplicationContext") { (record: [String: Any]) -> Bool in
      WatchLinkSession.shared.assert(record)
    }
  }
}
