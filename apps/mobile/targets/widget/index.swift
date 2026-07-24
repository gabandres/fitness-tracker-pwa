import SwiftUI
import WidgetKit

//
//  Ignia — "Today" home-screen widget (iOS).
//
//  This file is the Swift mirror of `packages/core/src/widget-snapshot.ts`.
//  A WidgetKit extension is a separate process that cannot run our JS, so the
//  decode + staleness + remaining rules are reimplemented here by hand. That
//  TS module is the spec and its vitest suite is the reference for the
//  behaviour below — when one side changes, change both.
//
//  Data flow: the RN app writes a JSON string into the App Group's
//  UserDefaults (`src/lib/widget.ts`) and asks WidgetKit to reload. This
//  provider reads that string back. No network, no auth, no Firestore — a
//  widget process has none of them.
//

// MARK: - Shared contract (mirrors widget-snapshot.ts)

/// Must equal `WIDGET_SNAPSHOT_KEY` in `packages/core/src/widget-snapshot.ts`.
private let snapshotKey = "ignia.widget.snapshot.v1"

/// Must equal `APP_GROUP` in `src/lib/widget.ts` and the entitlement in app.json.
private let appGroup = "group.fit.ignia.app"

/// Must equal `WIDGET_SNAPSHOT_VERSION`. A blob written by a newer app is
/// rejected rather than partially decoded — during an app update the widget
/// extension keeps running old code until the OS reloads it.
private let snapshotVersion = 1

private struct Snapshot: Codable {
  let v: Int
  let dateKey: String
  let kcalConsumed: Int
  let kcalTarget: Int
  let proteinConsumed: Int
  let proteinTarget: Int
  let updatedMs: Double
  let locale: String
}

/// Mirrors `WidgetMetric`: distance from target plus which side of it.
private struct Metric {
  let value: Int
  let isOver: Bool

  init(consumed: Int, target: Int) {
    isOver = consumed > target
    value = abs(target - consumed)
  }
}

/// Mirrors `WidgetView`. The empty reasons are collapsed into one case because
/// iOS renders all three identically; the TS side keeps them apart only so its
/// tests can distinguish them.
private enum View_ {
  case empty
  case ready(kcal: Metric, protein: Metric, locale: String)
}

/// Mirrors `parseWidgetSnapshot` + `widgetView`. Anything unreadable, foreign
/// versioned, from another day, or without a calorie target collapses to
/// `.empty` — never a thrown error, which would show the OS's "unable to load"
/// placeholder and read as a crashed app.
private func loadView(now: Date) -> View_ {
  guard
    let defaults = UserDefaults(suiteName: appGroup),
    let raw = defaults.string(forKey: snapshotKey),
    let data = raw.data(using: .utf8),
    let snap = try? JSONDecoder().decode(Snapshot.self, from: data),
    snap.v == snapshotVersion
  else { return .empty }

  guard snap.dateKey == localDateKey(now) else { return .empty }
  guard snap.kcalTarget > 0 else { return .empty }

  return .ready(
    kcal: Metric(consumed: snap.kcalConsumed, target: snap.kcalTarget),
    protein: Metric(consumed: snap.proteinConsumed, target: snap.proteinTarget),
    locale: snap.locale
  )
}

/// Mirrors `localDateKey` from `packages/core/src/date.ts`: `YYYY-MM-DD` in the
/// device's *local* zone. Must not be UTC — the whole point of the date key is
/// that it flips at the user's midnight, not at Greenwich's.
private func localDateKey(_ date: Date) -> String {
  let f = DateFormatter()
  f.calendar = Calendar(identifier: .gregorian)
  f.locale = Locale(identifier: "en_US_POSIX")
  f.dateFormat = "yyyy-MM-dd"
  return f.string(from: date)
}

// MARK: - Strings (mirrors src/widgets/strings.ts)

private struct Strings {
  let kcal: String
  let left: String
  let over: String
  let protein: String
  let empty: String
}

/// Keyed by the locale carried in the snapshot — our locale is a *profile*
/// preference stored in Firestore, so the device locale would be wrong for
/// anyone whose app language differs from their phone's.
private func strings(_ locale: String) -> Strings {
  switch locale {
  case "es-PR":
    return Strings(
      kcal: "kcal", left: "restantes", over: "de más",
      protein: "proteína", empty: "Abre Ignia para empezar")
  default:
    return Strings(
      kcal: "kcal", left: "left", over: "over",
      protein: "protein", empty: "Open Ignia to start")
  }
}

private func grouped(_ n: Int) -> String {
  let f = NumberFormatter()
  f.numberStyle = .decimal
  f.groupingSeparator = ","
  return f.string(from: NSNumber(value: n)) ?? String(n)
}

// MARK: - Palette (mirrors src/theme.ts heroPanel family)

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
  let view: View_
}

private struct Provider: TimelineProvider {
  /// Shown in the widget gallery and while the real entry loads. Uses plausible
  /// numbers rather than the empty state so the gallery preview sells what the
  /// widget does.
  func placeholder(in context: Context) -> Entry {
    Entry(
      date: Date(),
      view: .ready(
        kcal: Metric(consumed: 760, target: 2000),
        protein: Metric(consumed: 92, target: 160),
        locale: "en"))
  }

  func getSnapshot(in context: Context, completion: @escaping (Entry) -> Void) {
    completion(Entry(date: Date(), view: loadView(now: Date())))
  }

  func getTimeline(in context: Context, completion: @escaping (Timeline<Entry>) -> Void) {
    let now = Date()
    var entries = [Entry(date: now, view: loadView(now: now))]

    // Pre-schedule the rollover. The app calls `reloadWidget` on every log, so
    // in-day freshness is push-driven; this second entry exists for the one
    // moment nothing pushes — midnight, when today's numbers must blank even
    // if the app is never opened. Without it the widget would show yesterday's
    // "1,240 left" all through the next morning.
    let cal = Calendar.current
    if let midnight = cal.nextDate(
      after: now, matching: DateComponents(hour: 0, minute: 0, second: 5),
      matchingPolicy: .nextTime)
    {
      entries.append(Entry(date: midnight, view: .empty))
    }

    // `.atEnd` asks WidgetKit for a new timeline once the last entry is passed,
    // which re-arms the next midnight.
    completion(Timeline(entries: entries, policy: .atEnd))
  }
}

// MARK: - UI

private struct TodayWidgetView: SwiftUI.View {
  let entry: Entry

  var body: some SwiftUI.View {
    // Locked design (WIDGET_PLAN.md §"Open decisions"): text-first, kcal over
    // protein. The ring is a deliberate fast-follow, not an omission.
    VStack(alignment: .leading, spacing: 0) {
      switch entry.view {
      case .empty:
        Text(strings("en").empty)
          .font(.system(size: 13))
          .foregroundStyle(Color.igMuted)

      case let .ready(kcal, protein, locale):
        let s = strings(locale)
        Text(grouped(kcal.value))
          .font(.system(size: 34, weight: .bold, design: .rounded))
          .foregroundStyle(Color.igKcal)
          .minimumScaleFactor(0.6)
          .lineLimit(1)
        Text("\(s.kcal) \(kcal.isOver ? s.over : s.left)")
          .font(.system(size: 12))
          .foregroundStyle(Color.igMuted)
        Text("\(grouped(protein.value))g \(s.protein) \(protein.isOver ? s.over : s.left)")
          .font(.system(size: 13, weight: .semibold))
          .foregroundStyle(Color.igProtein)
          .minimumScaleFactor(0.7)
          .lineLimit(1)
          .padding(.top, 8)
      }
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
    // Tapping opens the Today screen with the add-entry sheet already up —
    // the same `?openAdd` param the in-app FAB uses. The widget is meant to
    // drive logging, not just display it.
    .widgetURL(URL(string: "ignia://?openAdd=1"))
    .containerBackground(Color.igPanel, for: .widget)
  }
}

@main
struct TodayWidget: Widget {
  // Must match `WIDGET_NAME` in `src/lib/widget.ts` — it's the `kind` passed to
  // `ExtensionStorage.reloadWidget`, and a mismatch means our reload requests
  // silently address a widget that doesn't exist.
  let kind = "Today"

  var body: some WidgetConfiguration {
    StaticConfiguration(kind: kind, provider: Provider()) { entry in
      TodayWidgetView(entry: entry)
    }
    .configurationDisplayName("Today")
    .description("Calories and protein left today.")
    // Small only for v1, per the locked decisions. Medium is cheap to add
    // later once this face is verified on a device.
    .supportedFamilies([.systemSmall])
  }
}
