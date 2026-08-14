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

  /// The two marks, rendered. Shown at the bottom of the mirror screen — the
  /// only place on this device that can answer "was I woken, and was I drawn".
  ///
  /// It is on the user-visible screen rather than behind a debug flag for the
  /// same reason the phone's card is: this has to be readable on a TestFlight
  /// build, on a wrist, by whoever is standing there. It is one dim line below
  /// everything else and costs a scroll on 40mm.
  @Published var diagnostics: String = ""

  private override init() { super.init() }

  func start(source: String = "launch") {
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
    store(session.receivedApplicationContext, from: source)
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
    let locale = next.locale
    // Read both marks here rather than in the view: the view re-renders for
    // many reasons and these are two App Group reads, while `refresh()` is
    // already the one place that re-derives everything from disk.
    let ingest = Glance.markLine("in", Glance.readMark(Glance.watchIngestKey), locale: locale)
    let drawn = Glance.markLine("draw", Glance.readMark(Glance.watchTimelineKey), locale: locale)
    DispatchQueue.main.async {
      self.face = next
      self.diagnostics = "\(ingest)   \(drawn)"
    }
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
  /// Set by `store()` on every successful ingest, so `ingest()` can tell a
  /// delegate delivery that landed during its wait from one that never came.
  private var storedDuringWake = false

  func ingest() async {
    storedDuringWake = false
    start(source: "wake")
    for _ in 0..<20 {
      if WCSession.default.activationState == .activated { break }
      try? await Task.sleep(nanoseconds: 100_000_000)  // 0.1s, so ≤2s total
    }
    // The application-context queue exposes its latest value as a property, so
    // it can be read outright.
    store(WCSession.default.receivedApplicationContext, from: "wake")

    // The complication queue does NOT: `transferCurrentComplicationUserInfo`
    // arrives only through `didReceiveUserInfo`, and this wake may have been
    // caused by exactly that. The delegate is registered by `start()` above, so
    // give it a bounded moment to fire before letting the system suspend us —
    // returning immediately here is the same mistake that made the original
    // background handler useless (see the note above), one queue over.
    //
    // Only waits when the read found nothing, so the common case costs nothing.
    if !storedDuringWake {
      for _ in 0..<20 {
        if storedDuringWake { break }
        try? await Task.sleep(nanoseconds: 100_000_000)  // 0.1s, so ≤2s total
      }
    }
  }

  /// Store whatever arrived and reload. **No validation here, by design.**
  ///
  /// The `dateKey`/staleness guard lives only at render (`Glance.face`), for
  /// two reasons: one guard implementation means the screen and the face can
  /// never disagree about what "stale" means, and on a transient two-clock
  /// disagreement a validating delegate would discard the only copy of data it
  /// has **no way to re-request** — there is no pull on this transport
  /// (#39 §5).
  private func store(_ context: [String: Any], from source: String) {
    guard let json = context[Glance.contextKey] as? String else { return }
    let defaults = UserDefaults(suiteName: Glance.appGroup)

    // ## The dedupe, added 2026-08-14 — and it is a BUG FIX, not a saving
    //
    // This used to write and call `reloadAllTimelines()` unconditionally, on
    // every path, every time. That is not free and it is not idempotent:
    //
    //   - `reloadAllTimelines()` counts against the watch's **40–75 reloads
    //     per day** budget (#37 §5, and the same figure the phone side already
    //     dedupes against in `WatchLinkSession.assert`);
    //   - `start()` calls this on **every** app launch, with whatever
    //     `receivedApplicationContext` happens to hold — usually the same bytes
    //     as last time;
    //   - `ingest()` calls it **twice per background wake**, once through
    //     `start()` and once after the activation wait.
    //
    // So opening the watch app ten times spent ten reloads on identical bytes,
    // and every background wake spent two. Once that budget is gone WidgetKit
    // throttles the reload and the face stops moving — which is
    // indistinguishable, from the wrist, from the delivery never arriving.
    //
    // **The phone has deduped since 2026-08-10 for exactly this reason and the
    // watch never did.** That asymmetry is the defect: the transport's cheap
    // end was careful and its expensive end was not.
    //
    // The comparison is the stored JSON, not a decoded value: the payload is
    // latest-wins bytes and byte equality is precisely the question.
    guard defaults?.string(forKey: Glance.snapshotKey) != json else {
      Glance.bumpMark(Glance.watchIngestKey, label: "\(source):same")
      return
    }

    // Set only for a delivery that actually carried something NEW. `ingest()`
    // reads this to decide whether to keep waiting for the complication queue,
    // and "the app-context read handed me the same bytes I already had" must
    // not be mistaken for "new data landed" — that would cut the wait short on
    // exactly the wake that still had a real payload in flight.
    storedDuringWake = true
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
    WidgetCenter.shared.reloadAllTimelines()
    // After the reload request, so the mark the screen shows is the one this
    // ingest just made rather than the previous one.
    Glance.bumpMark(Glance.watchIngestKey, label: source)
    refresh()
  }

  // MARK: WCSessionDelegate

  func session(
    _ session: WCSession,
    activationDidCompleteWith activationState: WCSessionActivationState,
    error: Error?
  ) {
    guard error == nil else { return }
    store(session.receivedApplicationContext, from: "activation")
  }

  func session(_ session: WCSession, didReceiveApplicationContext context: [String: Any]) {
    store(context, from: "context")
  }

  /// The complication queue's arrival point (2026-08-10).
  ///
  /// `transferCurrentComplicationUserInfo` on the phone lands **here**, not in
  /// `didReceiveApplicationContext` — they are different queues. Without this
  /// callback the phone's waking send is delivered and then dropped on the
  /// floor, which is worse than not sending it: it spends one of the day's 50
  /// transfers and a watch wake to achieve nothing.
  ///
  /// Same envelope, same `store()`, so there is still exactly one decode path
  /// and one staleness guard. Whichever queue arrives first wins; the payload
  /// is latest-wins, so a double delivery writes identical bytes twice.
  /// `userInfo` in the diagnostics line is **the single most valuable reading
  /// on this device**: it is the only label that can only have come from
  /// `transferCurrentComplicationUserInfo`, so seeing it proves the waking
  /// queue both arrived and woke this app. Its absence, against a phone that
  /// recorded `sent`, is the proof that the wake is what fails.
  func session(_ session: WCSession, didReceiveUserInfo userInfo: [String: Any]) {
    store(userInfo, from: "userInfo")
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

        // The two marks, below everything, in both face states — the empty
        // state is exactly when you most want to know whether anything ever
        // arrived. Dim and terse; it costs a scroll on 40mm and answers the
        // only question this device cannot otherwise be asked.
        Text(link.diagnostics)
          .font(.system(size: 9))
          .foregroundStyle(.tertiary)
          .multilineTextAlignment(.center)
          .padding(.top, 10)
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
