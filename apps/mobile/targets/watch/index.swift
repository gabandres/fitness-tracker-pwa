import SwiftUI
import WatchConnectivity
import WidgetKit

//
//  Ignia — watchOS app.
//
//  ## This app is link 2 of the transport, not decoration
//
//  #37 chose `WCSession.updateApplicationContext` as the sole transport, and
//  WatchConnectivity delivers to the *watch app*, never to a complication
//  directly. So this target has a job it must do whether or not anyone ever
//  opens it: receive the context, write it into the watch's own App Group, and
//  ask WidgetKit to reload. Everything the user can see here is additive to
//  that (#39).
//
//  It is (c) in #39's taxonomy — a one-screen read-only mirror. Not (a), an
//  empty shell, because a complication tap opens the containing app and "watch
//  binary whose only screen is empty" is the minimum-functionality shape that
//  has already cost this app two rejections. Not (b), a quick-log affordance,
//  because that needs a watch→phone write path this design does not have.
//
//  ## The chain, end to end
//
//    phone: widget.ts persist() → WatchReceiver.updateApplicationContext(json)
//      → [system daemon, latest-wins, opportunistic delivery]
//      → watch: session(_:didReceiveApplicationContext:)
//      → UserDefaults(suiteName: Glance.appGroup).set(json, forKey:)
//      → WidgetCenter.shared.reloadAllTimelines()
//      → complication re-renders from the App Group
//
//  ## What it honestly buys
//
//  Seconds-to-minutes after a log with the watch on the wrist and the phone in
//  pocket; 15–60 minutes once the day's reloads throttle; **unbounded** while
//  watch and phone are out of range. Apple promises no latency at all —
//  delivery is explicitly "when the opportunity arises". This is a best-effort
//  surface and cannot be made into a live number. That is why the screen below
//  always shows `as of`, and why there is no refresh affordance: the transport
//  is one-directional and the watch cannot request anything. A control that
//  cannot work is worse than none (#39 §8).
//

// MARK: - Receiver

/// Owns the `WCSession` on the watch side. Single instance, activated at app
/// launch and never torn down.
final class WatchReceiver: NSObject, ObservableObject, WCSessionDelegate {
  static let shared = WatchReceiver()

  /// What to draw right now. Republished on every receipt and re-derived from
  /// the App Group whenever the screen appears, so the day-key guard is
  /// re-evaluated against the *current* clock rather than the one at receipt.
  @Published var face: Glance.Face = .empty(locale: nil)

  private override init() { super.init() }

  func start() {
    guard WCSession.isSupported() else {
      // A watch app always has a counterpart, so this should be unreachable —
      // but activating an unsupported session traps, so it is guarded anyway.
      refresh()
      return
    }
    let session = WCSession.default
    session.delegate = self
    session.activate()

    // Read what already arrived. Apple delivers the last known context shortly
    // after activation, but a context that landed while this process was dead
    // is sitting in `receivedApplicationContext` right now and the delegate
    // callback may not fire again. One line, covers delivery that happened
    // before the view appeared (#39 §4).
    store(session.receivedApplicationContext)
    refresh()
  }

  /// Re-derive the face from the App Group without waiting for a delivery.
  /// Cheap, and the only thing that moves the screen across local midnight.
  ///
  /// **This does not ingest anything.** It re-reads what is already stored. A
  /// background wake that only calls this writes nothing and asks WidgetKit for
  /// nothing — see `ingest()`.
  func refresh() {
    let next = Glance.load(now: Date())
    DispatchQueue.main.async { self.face = next }
  }

  /// Handle a WatchConnectivity background wake, and do it **before returning**.
  ///
  /// Two things went wrong here on device (2026-08-04, build 16) and they
  /// compound, which is why the face rendered correct numbers at install and
  /// then never moved again:
  ///
  /// 1. The background handler used to call `refresh()`, which only re-reads
  ///    the App Group. It never called `store()`, so a freshly delivered
  ///    context was never written and `reloadAllTimelines()` was never
  ///    requested. The complication had nothing to be woken for.
  /// 2. It returned immediately. `receivedApplicationContext` is only
  ///    meaningful once the session has activated, and activation is
  ///    asynchronous — so even the delegate path could lose the race, with the
  ///    system suspending the app before `activationDidCompleteWith` fired.
  ///
  /// Hence: wait (briefly, bounded) for activation, then store synchronously.
  /// Polling rather than a continuation on purpose — this runs in a background
  /// wake with a short, unforgiving budget, and a bounded loop that always
  /// terminates is worth more here than an elegant one that can hang.
  func ingest() async {
    start()
    for _ in 0..<20 {
      if WCSession.default.activationState == .activated { break }
      try? await Task.sleep(nanoseconds: 100_000_000)  // 0.1s, so ≤2s total
    }
    store(WCSession.default.receivedApplicationContext)
  }

  /// Store whatever arrived and reload. **No validation here, by design.**
  ///
  /// The `dateKey`/staleness guard lives only at render (`Glance.face`), for
  /// two reasons: one guard implementation means the screen and the face can
  /// never disagree about what "stale" means, and on a transient two-clock
  /// disagreement a validating delegate would discard the only copy of data it
  /// has **no way to re-request** — there is no pull on this transport
  /// (#39 §5).
  private func store(_ context: [String: Any]) {
    guard let json = context[Glance.contextKey] as? String else { return }
    let defaults = UserDefaults(suiteName: Glance.appGroup)
    defaults?.set(json, forKey: Glance.snapshotKey)
    // Force the write out before asking WidgetKit to re-read it. `synchronize()`
    // is deprecated and Apple's position is that it is unnecessary — that
    // position is about a process reading its OWN defaults, where the in-memory
    // value is authoritative. Here a DIFFERENT process is about to open the
    // same container microseconds later, and it sees only what has landed.
    //
    // Belt-and-braces, not the actual fix: if this is a no-op on some watchOS
    // build, the hourly re-ask in the complication's timeline is what recovers
    // the face. Do not remove that on the strength of this line.
    defaults?.synchronize()
    // A sign-out sends the empty string. It fails the decode and collapses to
    // `.empty` exactly as an absent or unreadable blob does — no fourth reason,
    // no new key, no second decode path (#44 §2).
    refresh()
    WidgetCenter.shared.reloadAllTimelines()
  }

  // MARK: WCSessionDelegate

  func session(
    _ session: WCSession,
    activationDidCompleteWith activationState: WCSessionActivationState,
    error: Error?
  ) {
    guard error == nil else { return }
    store(session.receivedApplicationContext)
  }

  func session(_ session: WCSession, didReceiveApplicationContext context: [String: Any]) {
    store(context)
  }
}

// MARK: - Palette
//
// watchOS has no light mode, so there is no theme branch and no Swift port of
// ADR-0014 here. Text is `.primary`/`.secondary` exactly like the complication;
// a single accent tints the gauge so the App Store watch screenshot is not
// unbranded. It is a CONSTANT, not a palette — do not grow it into a colour set
// (#39 §3).

private let igAccent = Color(
  .sRGB, red: 0xff / 255, green: 0x6a / 255, blue: 0x3d / 255, opacity: 1)  // theme.ts `ring`

// MARK: - The screen

private struct MirrorView: SwiftUI.View {
  @ObservedObject var link = WatchReceiver.shared
  @Environment(\.scenePhase) private var scenePhase

  var body: some SwiftUI.View {
    // `ScrollView` rather than a fitted layout: this screen has more content
    // than the complication and the 40mm class (324 x 394) is ~22% narrower
    // than the 46mm the owner wears. Scrolling means nothing is ever cut, at
    // any size, in any locale (#43 §5).
    ScrollView {
      VStack(spacing: 2) {
        switch link.face {
        case let .empty(locale):
          let s = Glance.strings(locale ?? "en")
          Text(s.emptyWatch)
            .font(.headline)
            .multilineTextAlignment(.center)
          // The entire feature's explanatory copy, and it lives here because
          // this screen is the tap target from the face — exactly where a
          // confused user arrives. There is no settings line and no onboarding
          // moment; both were declined (#40 §5).
          Text(s.watchSubline)
            .font(.caption2)
            .foregroundStyle(.secondary)
            .multilineTextAlignment(.center)
            .padding(.top, 4)

        // The protein `Metric` is deliberately not bound: this screen shows
        // protein as consumed/target (`protein 88/150`, #39 §2), not as a
        // remaining-vs-over metric the way the face does, so it reads the raw
        // snapshot fields below instead.
        case let .ready(kcal, _, snap):
          let s = Glance.strings(snap.locale)

          // Hero. If `as of` is not visible without scrolling on 40mm, the
          // pre-decided fix is 44 → 36 — decided here so a Mac sitting produces
          // a boolean rather than new design work (#43 §5).
          Text(Glance.grouped(kcal.value))
            .font(.system(size: 44, weight: .bold, design: .rounded))
            .minimumScaleFactor(0.5)
            .lineLimit(1)
          Text(kcal.isOver ? s.kcalOverLabel : s.kcalLeftLabel)
            .font(.caption)
            .foregroundStyle(.secondary)
            .lineLimit(1)
            .minimumScaleFactor(0.7)

          Gauge(value: kcal.progress) { EmptyView() }
            .gaugeStyle(.accessoryLinearCapacity)
            .tint(igAccent)
            .padding(.vertical, 4)

          // The denominators are this screen's whole reason to exist — the
          // face has no room for them (#39 §2). Both are read straight off the
          // snapshot; no new fields were added for the watch.
          Text("\(Glance.grouped(snap.kcalConsumed)) / \(Glance.grouped(snap.kcalTarget))")
            .font(.footnote)
            .lineLimit(1)
            .minimumScaleFactor(0.7)
          Text(
            "\(s.protein) \(Glance.grouped(snap.proteinConsumed))/"
              + "\(Glance.grouped(snap.proteinTarget))"
          )
          .font(.footnote)
          .foregroundStyle(.secondary)
          .lineLimit(1)
          .minimumScaleFactor(0.7)

          // Unconditional — no age threshold, no appear-past-N-minutes
          // behaviour. This is the point of having a screen at all: it buys the
          // face the right to stay terse (#39 §6).
          Text(Glance.asOfLine(updatedMs: snap.updatedMs, locale: snap.locale))
            .font(.caption2)
            .foregroundStyle(.secondary)
            .padding(.top, 6)
            .lineLimit(1)
            .minimumScaleFactor(0.7)
        }
      }
      .frame(maxWidth: .infinity)
    }
    // No pull-to-refresh and no "sync now" anywhere on this screen. Re-deriving
    // the face from the App Group is not a refresh — it cannot fetch anything,
    // it only re-runs the day-key guard against the current clock.
    .onAppear { link.refresh() }
    .onChange(of: scenePhase) { _, phase in
      if phase == .active { link.refresh() }
    }
  }
}

@main
struct IgniaWatchApp: App {
  init() { WatchReceiver.shared.start() }

  var body: some Scene {
    WindowGroup {
      MirrorView()
    }
    // The system wakes us here when a context is delivered, and this closure
    // must do the work — writing the App Group and requesting the reload —
    // rather than assume the delegate will get there first. Returning early
    // lets the app be suspended mid-delivery, which is how the complication
    // ended up rendering once at install and never moving again.
    //
    // Note a background wake's `reloadTimelines` DOES count against the
    // 40–75/day budget — Apple's exemption list is exhaustive and background
    // execution is not on it (#37 §5).
    .backgroundTask(.watchConnectivity) {
      await WatchReceiver.shared.ingest()
    }
  }
}
