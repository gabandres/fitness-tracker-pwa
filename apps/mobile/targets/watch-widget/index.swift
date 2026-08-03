import SwiftUI
import WidgetKit

//
//  Ignia — Apple Watch face complication.
//
//  Reads the watch's own App Group, which the watch app writes on every
//  WatchConnectivity delivery (`targets/watch/index.swift`). This process never
//  talks to the phone, the network, or Firestore — same snapshot-not-subscribe
//  contract as the iPhone widget, one hop further out.
//
//  Families: circular, rectangular, inline — mirroring the Lock Screen exactly
//  (#40 §0). `.accessoryCorner` is deliberately absent; it is the only family
//  with no Lock Screen counterpart, so it would be the only net-new layout.
//
//  ## The one thing this face says that the phone's does not
//
//  An unconditional `as of 8:04 AM` on rectangular. On the phone that row would
//  imply a doubt that does not exist; here the number really can be an hour
//  old, or older while the two devices are apart. Circular and inline stay bare
//  **by decision, not by omission** — one tap reaches the watch app, which
//  always shows the honest answer (#40 §2, #39 §6). Do not "fix" that later.
//
//  ## Why there is no staleness *mark*
//
//  It would have been free — the reload budget meters `getTimeline` calls, not
//  entries within a timeline — and it is still wrong. `updatedMs` is the age of
//  the last **log**, not the age of the last **contact**, so it cannot tell
//  "logged lunch, watch never received it" from "simply hasn't eaten since
//  breakfast". The second is the common case, and an ordinary day has 4½- and
//  6½-hour gaps, so the mark would be lit through most of waking hours. A
//  timestamp asserts nothing, so it has no false-positive class (#40 §1).
//

private struct Entry: TimelineEntry {
  let date: Date
  let face: Glance.Face
}

private struct Provider: TimelineProvider {
  func placeholder(in context: Context) -> Entry {
    Entry(
      date: Date(),
      face: Glance.face(
        raw: """
          {"v":1,"dateKey":"\(Glance.localDateKey(Date()))","kcalConsumed":1240,\
          "kcalTarget":2000,"proteinConsumed":92,"proteinTarget":160,\
          "updatedMs":\(Date().timeIntervalSince1970 * 1000),"locale":"en"}
          """,
        now: Date()))
  }

  func getSnapshot(in context: Context, completion: @escaping (Entry) -> Void) {
    completion(Entry(date: Date(), face: Glance.load(now: Date())))
  }

  func getTimeline(in context: Context, completion: @escaping (Timeline<Entry>) -> Void) {
    let now = Date()
    let current = Glance.load(now: now)
    var entries = [Entry(date: now, face: current)]

    // The midnight backstop, same as the phone widget's. On the wrist it does
    // more than freshness: it is the privacy bound on a sign-out whose clear
    // never reached this device. "Cleared on next contact, or at the watch's
    // local midnight, whichever comes first" (#44 §3).
    let cal = Calendar.current
    if let midnight = cal.nextDate(
      after: now, matching: DateComponents(hour: 0, minute: 0, second: 5),
      matchingPolicy: .nextTime)
    {
      entries.append(Entry(date: midnight, face: .empty(locale: current.locale)))
    }

    completion(Timeline(entries: entries, policy: .atEnd))
  }
}

// MARK: - Families
//
// `.primary` / `.secondary` and `.tint(.primary)` only — no brand colour, for
// the same reason as the Lock Screen: hierarchy is carried by weight and size.

private struct CircularView: SwiftUI.View {
  let face: Glance.Face

  var body: some SwiftUI.View {
    switch face {
    case .empty:
      // Wordless, and the slot never changes shape between states — which
      // matters most at midnight, the one transition we would rather not draw
      // the eye to.
      Gauge(value: 0.0) {
        Image(systemName: "flame")
      }
      .gaugeStyle(.accessoryCircularCapacity)

    case let .ready(kcal, _, _):
      Gauge(value: kcal.progress) {
        Text(kcal.isOver ? "+" : "")
      } currentValueLabel: {
        // `progress` is clamped to 0...1, so at 140% of target the ring looks
        // identical to 100%. The `+` is what distinguishes them, and it needs
        // no es-PR translation.
        Text(kcal.isOver ? "+\(Glance.grouped(kcal.value))" : Glance.grouped(kcal.value))
          .minimumScaleFactor(0.5)
          .lineLimit(1)
      }
      .gaugeStyle(.accessoryCircularCapacity)
    }
  }
}

private struct RectangularView: SwiftUI.View {
  let face: Glance.Face

  var body: some SwiftUI.View {
    switch face {
    case let .empty(locale):
      Label(Glance.strings(locale ?? "en").emptyWatch, systemImage: "flame")
        .font(.headline)
        .lineLimit(1)
        .minimumScaleFactor(0.7)

    case let .ready(kcal, protein, snap):
      let s = Glance.strings(snap.locale)

      // The smallest supported screen is 40mm `324 x 394`; the owner wears a
      // 46mm `416 x 496`. Rather than measure once and hope, the layout
      // degrades predictably: 4 rows where they fit, 3 where they do not. If
      // the row has to go, it is `as of` that goes and never protein —
      // rectangular is the only family carrying protein at all (#40, #43 §3).
      //
      // THREE DETAILS ARE LOAD-BEARING HERE. In descending order of how
      // expensive they are to get wrong:
      //
      // (a) `.lineLimit(1)` is a CORRECTNESS PREREQUISITE, not a preference.
      //     `ViewThatFits` measures a child's *ideal* size, and a `Text`'s
      //     ideal height is one line no matter how long the string is. Without
      //     an explicit line limit the 4-row candidate reports "fits", is
      //     selected, and then wraps at render — clipping. The measurement
      //     would lie in exactly the case this defends against, and hardest in
      //     es-PR. Removing it to "let the Spanish string breathe" silently
      //     re-arms the bug.
      //
      // (b) `in: .vertical`, not the default. The default constrains both axes,
      //     so es-PR's ~40%-longer `68g de proteína restantes` could fail the
      //     HORIZONTAL check and drop the honesty row on a 46mm watch with
      //     ample vertical room. Width is handled by scaling; this branch is
      //     about row count only.
      //
      // (c) The two candidates must differ ONLY by row count. Anything that
      //     reduces the first candidate's ideal height — a smaller font on the
      //     4-row variant, a `fixedSize`, a frame cap — makes `ViewThatFits`
      //     always pick it and the fallback never fires. (`.minimumScaleFactor`
      //     does not alter ideal size, so it is safe.)
      ViewThatFits(in: .vertical) {
        VStack(alignment: .leading, spacing: 1) {  // 46mm lands here
          Text(Glance.kcalLine(kcal, s)).lineLimit(1).minimumScaleFactor(0.7)
          Gauge(value: kcal.progress) { EmptyView() }
            .gaugeStyle(.accessoryLinearCapacity)
            .tint(.primary)
          Text(Glance.proteinLine(protein, s))
            .lineLimit(1).minimumScaleFactor(0.7)
          Text(Glance.asOfLine(updatedMs: snap.updatedMs, locale: snap.locale))
            .font(.caption2)
            .foregroundStyle(.secondary)
            .lineLimit(1).minimumScaleFactor(0.7)
        }
        VStack(alignment: .leading, spacing: 1) {  // 40mm falls here
          Text(Glance.kcalLine(kcal, s)).lineLimit(1).minimumScaleFactor(0.7)
          Gauge(value: kcal.progress) { EmptyView() }
            .gaugeStyle(.accessoryLinearCapacity)
            .tint(.primary)
          Text(Glance.proteinLine(protein, s))
            .lineLimit(1).minimumScaleFactor(0.7)
        }
      }
      .frame(maxWidth: .infinity, alignment: .leading)
    }
  }
}

private struct InlineView: SwiftUI.View {
  let face: Glance.Face

  var body: some SwiftUI.View {
    switch face {
    case let .empty(locale):
      Label(Glance.strings(locale ?? "en").emptyWatch, systemImage: "flame")
    case let .ready(kcal, _, snap):
      Label(Glance.kcalLine(kcal, Glance.strings(snap.locale)), systemImage: "flame")
    }
  }
}

private struct ComplicationView: SwiftUI.View {
  @Environment(\.widgetFamily) private var family
  let entry: Entry

  var body: some SwiftUI.View {
    switch family {
    case .accessoryRectangular: RectangularView(face: entry.face)
    case .accessoryInline: InlineView(face: entry.face)
    default: CircularView(face: entry.face)
    }
  }
}

@main
struct IgniaComplication: Widget {
  let kind = Glance.complicationKind

  var body: some WidgetConfiguration {
    StaticConfiguration(kind: kind, provider: Provider()) { entry in
      ComplicationView(entry: entry)
    }
    .configurationDisplayName("Ignia")
    .description("Calories and protein left today.")
    // No `widgetURL`. The watch app is one screen with no navigation, so there
    // is nothing to deep-link to — a tap opens it, which is the default (#39 §8).
    .supportedFamilies([.accessoryCircular, .accessoryRectangular, .accessoryInline])
  }
}
