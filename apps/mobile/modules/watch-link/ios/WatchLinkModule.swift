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
  @discardableResult
  func assert(_ record: [String: Any]) -> Bool {
    desired = record
    guard let session = activatedSession else { return false }

    // `updateApplicationContext` is latest-wins and never queues, so a
    // redundant send costs nothing on the phone — but it does spend a
    // background wake on the watch, and a wake's `reloadTimelines` counts
    // against the 40–75/day reload budget. Skipping the no-op keeps the steady
    // state free (#39 §4).
    if sameContext(session.applicationContext, record) { return false }

    do {
      try session.updateApplicationContext(record)
      return true
    } catch {
      // `deviceNotPaired` / `watchAppNotInstalled` are the ordinary case, not
      // a fault. Anything else is equally unactionable from JS: there is no
      // retry that would help, and the next `assert` re-sends anyway.
      return false
    }
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

    /// The single verb. `record` is the envelope JS built; this module does not
    /// know or care what is inside it.
    Function("updateApplicationContext") { (record: [String: Any]) -> Bool in
      WatchLinkSession.shared.assert(record)
    }
  }
}
