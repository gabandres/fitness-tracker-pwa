import SwiftUI
import WidgetKit

//
//  Ignia — "Today" widget (iOS): Home Screen `systemSmall` + the three Lock
//  Screen accessory families.
//
//  The decode, the staleness guard, the metrics, the string table and every
//  contract constant now live in `targets/_shared/Glance.swift`, which the
//  apple-targets plugin links into every target. This file is SwiftUI, a
//  `TimelineProvider`, and `@main` — nothing else (#38 §1).
//
//  Data flow is unchanged and deliberately dumb: the RN app writes a JSON
//  string into the App Group's UserDefaults (`src/lib/widget.ts`) and asks
//  WidgetKit to reload. This provider reads that string back. No network, no
//  auth, no Firestore — a widget process has none of them.
//
//  Verified on a physical iPhone from TestFlight build 13 on 2026-08-03: kcal
//  left and protein left render, and the numbers move after a logged meal.
//

// MARK: - Palette (mirrors src/theme.ts heroPanel family)
//
// Used by `systemSmall` ONLY. The accessory families never name a brand colour
// — the Lock Screen renders them in the OS's tinted/vibrant mode, which
// flattens orange and green toward the same tint, exactly where colour was
// doing all the work of telling the two metrics apart. There hierarchy is
// carried by weight and size (#33). Two palettes, split cleanly by family, so
// there is no Swift copy of ADR-0014's rules to keep in step.

private extension Color {
  /// `theme.ts` colours are hex strings; this is the only way to reuse the
  /// exact same values without a build-time codegen step.
  init(hex: UInt32) {
    self.init(
      .sRGB,
      red: Double((hex >> 16) & 0xff) / 255,
      green: Double((hex >> 8) & 0xff) / 255,
      blue: Double(hex & 0xff) / 255,
      opacity: 1)
  }

  // Dark in BOTH app themes on purpose (ADR-0014) — the widget sits on the
  // user's wallpaper and can't follow our in-app theme, so it wears the one
  // fixed brand face.
  static let igPanel = Color(hex: 0x161412)  // heroPanel
  static let igMuted = Color(hex: 0xa39c91)  // heroMuted
  static let igKcal = Color(hex: 0xff6a3d)  // ring
  static let igProtein = Color(hex: 0x34d399)  // protein (dark variant)
}

// MARK: - Timeline

private struct Entry: TimelineEntry {
  let date: Date
  let face: Glance.Face
}

private struct Provider: TimelineProvider {
  /// Shown in the widget gallery and while the real entry loads. Uses plausible
  /// numbers rather than the empty state so the gallery preview sells what the
  /// widget does.
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

    // Pre-schedule the rollover. The app calls `reloadWidget` on every log, so
    // in-day freshness is push-driven; this second entry exists for the one
    // moment nothing pushes — midnight, when today's numbers must blank even
    // if the app is never opened. Without it the widget would show yesterday's
    // "1,240 left" all through the next morning.
    //
    // The locale is carried into the blank on purpose. Rebuilding it as "en"
    // would flip a Spanish widget to English at midnight and leave it there
    // until the app is next opened.
    let cal = Calendar.current
    if let midnight = cal.nextDate(
      after: now, matching: DateComponents(hour: 0, minute: 0, second: 5),
      matchingPolicy: .nextTime)
    {
      entries.append(Entry(date: midnight, face: .empty(locale: current.locale)))
    }

    // `.atEnd` asks WidgetKit for a new timeline once the last entry is passed,
    // which re-arms the next midnight.
    completion(Timeline(entries: entries, policy: .atEnd))
  }
}

// MARK: - Home Screen · systemSmall

private struct HomeView: SwiftUI.View {
  let face: Glance.Face

  var body: some SwiftUI.View {
    // Locked design (WIDGET.md §"Open decisions"): text-first, kcal over
    // protein. The ring is a deliberate fast-follow, not an omission — which is
    // why `systemSmall` still ignores `Metric.progress` even though the
    // accessory families now consume it.
    VStack(alignment: .leading, spacing: 0) {
      switch face {
      case let .empty(locale):
        Text(Glance.strings(locale ?? "en").empty)
          .font(.system(size: 13))
          .foregroundStyle(Color.igMuted)

      case let .ready(kcal, protein, snap):
        let s = Glance.strings(snap.locale)
        Text(Glance.grouped(kcal.value))
          .font(.system(size: 34, weight: .bold, design: .rounded))
          .foregroundStyle(Color.igKcal)
          .minimumScaleFactor(0.6)
          .lineLimit(1)
        Text("\(s.kcal) \(kcal.isOver ? s.over : s.left)")
          .font(.system(size: 12))
          .foregroundStyle(Color.igMuted)
        Text(Glance.proteinLine(protein, s))
          .font(.system(size: 13, weight: .semibold))
          .foregroundStyle(Color.igProtein)
          .minimumScaleFactor(0.7)
          .lineLimit(1)
          .padding(.top, 8)
      }
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
    .containerBackground(Color.igPanel, for: .widget)
  }
}

// MARK: - Lock Screen · accessory families
//
// `.primary` / `.secondary` and `.tint(.primary)` only. No brand hex, no
// `AccessoryWidgetBackground` beyond the empty circular ring, and no
// `containerBackground` — it does not apply to accessory families.
//
// Nothing here reads `@Environment(\.widgetRenderingMode)`. Its exact semantics
// are unverified (#33) and the design deliberately does not depend on them.

private struct CircularView: SwiftUI.View {
  let face: Glance.Face

  var body: some SwiftUI.View {
    // The slot never changes shape between states — same gauge, same centre
    // glyph position — which matters most at midnight, the one transition we
    // would rather not draw the eye to.
    switch face {
    case .empty:
      Gauge(value: 0.0) {
        Image(systemName: "flame")
      }
      .gaugeStyle(.accessoryCircularCapacity)

    case let .ready(kcal, _, _):
      Gauge(value: kcal.progress) {
        // Wordless. There is no room for a unit here, and with `progress`
        // clamped to 0...1 the ring alone cannot say "past target" — so the
        // over-target state is carried by a single `+` glyph, which needs no
        // es-PR translation.
        Text(kcal.isOver ? "+" : "")
      } currentValueLabel: {
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
    // The only family carrying protein — circular and inline are kcal-only by
    // necessity, and the kcal-over-protein ranking is locked.
    //
    // NOTE the one declared divergence from the watch's rectangular view: there
    // is no `as of` row here. On the phone the widget reads the App Group on
    // the SAME device and the containing app's foreground reload is free, so
    // the number is authoritative to within seconds. `as of 8:04 AM` under it
    // at 1 PM would imply a doubt that does not exist — the same words carry
    // opposite meaning on the two devices (#40 §3). The shared *spec* is
    // `asOf: Date?`, nil here; the source is written twice on purpose (#38 §2).
    VStack(alignment: .leading, spacing: 1) {
      switch face {
      case let .empty(locale):
        Label(Glance.strings(locale ?? "en").empty, systemImage: "flame")
          .font(.headline)
          .lineLimit(1)
          .minimumScaleFactor(0.7)

      case let .ready(kcal, protein, snap):
        let s = Glance.strings(snap.locale)
        Text(Glance.kcalLine(kcal, s))
          .font(.headline)
          .lineLimit(1)
          .minimumScaleFactor(0.7)
        Gauge(value: kcal.progress) { EmptyView() }
          .gaugeStyle(.accessoryLinearCapacity)
          .tint(.primary)
        Text(Glance.proteinLine(protein, s))
          .font(.caption)
          .foregroundStyle(.secondary)
          .lineLimit(1)
          .minimumScaleFactor(0.7)
      }
    }
    .frame(maxWidth: .infinity, alignment: .leading)
  }
}

private struct InlineView: SwiftUI.View {
  let face: Glance.Face

  var body: some SwiftUI.View {
    switch face {
    case let .empty(locale):
      Label(Glance.strings(locale ?? "en").emptyShort, systemImage: "flame")
    case let .ready(kcal, _, snap):
      Label(Glance.kcalLine(kcal, Glance.strings(snap.locale)), systemImage: "flame")
    }
  }
}

private struct TodayWidgetView: SwiftUI.View {
  @Environment(\.widgetFamily) private var family
  let entry: Entry

  var body: some SwiftUI.View {
    Group {
      switch family {
      case .accessoryCircular: CircularView(face: entry.face)
      case .accessoryRectangular: RectangularView(face: entry.face)
      case .accessoryInline: InlineView(face: entry.face)
      default: HomeView(face: entry.face)
      }
    }
    // Tapping opens the Today screen with the add-entry sheet already up —
    // the same `?openAdd` param the in-app FAB uses. The widget is meant to
    // drive logging, not just display it. On the Lock Screen this lands in an
    // add-entry modal after Face ID (#41 owns that landing).
    .widgetURL(URL(string: "ignia://?openAdd=1"))
  }
}

@main
struct TodayWidget: Widget {
  // Must match `Glance.widgetKind` / `WIDGET_NAME` in `src/lib/widget.ts` —
  // it's the `kind` passed to `ExtensionStorage.reloadWidget`, and a mismatch
  // means our reload requests silently address a widget that doesn't exist.
  let kind = Glance.widgetKind

  var body: some WidgetConfiguration {
    StaticConfiguration(kind: kind, provider: Provider()) { entry in
      TodayWidgetView(entry: entry)
    }
    .configurationDisplayName("Today")
    .description("Calories and protein left today.")
    // `.accessoryCorner` is deliberately absent: it is the only family with no
    // Lock Screen counterpart, so it would be the only net-new layout, using an
    // idiom (`widgetLabel`, curved gauge text) nothing else in the repo uses.
    // Cost accepted: we are absent from the corner slots of the Infograph
    // faces (#40 §0).
    .supportedFamilies([
      .systemSmall, .accessoryCircular, .accessoryRectangular, .accessoryInline,
    ])
  }
}
