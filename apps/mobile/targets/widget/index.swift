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
  static let igText = Color(hex: 0xf3f1ec)  // heroText — quick-add button label
  // Quick-add button fill: a lifted panel tone, not the coral. The button is a
  // secondary affordance on a face whose point is the number, and an
  // accent-filled pill reads as the primary thing on it. Matches COLORS.button
  // in src/widgets/TodayWidget.tsx.
  static let igButton = Color(hex: 0x2b2825)
}

// MARK: - Timeline

private struct Entry: TimelineEntry {
  let date: Date
  let face: Glance.Face
}

private struct Provider: TimelineProvider {
  func placeholder(in context: Context) -> Entry {
    Entry(date: Date(), face: Glance.preview())
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

    // NOT `.atEnd`. That asks for a new timeline only once the LAST entry is
    // passed, and the last entry is midnight — so a single render against an
    // empty container sticks for the rest of the day, no matter how many times
    // the app pushes. The watch complication hit exactly that on device
    // (2026-08-03, build 16): stale face, correct data one tap away.
    //
    // This surface has NOT failed that way — `ExtensionStorage.reloadWidget`
    // runs on the same device with no cross-device delivery to miss, and the
    // face is device-verified. This is a net under a working trapeze.
    //
    // 4 hours, not the watch's 1, and the difference is deliberate: the phone's
    // push path is reliable, so the net only has to bound the rare miss, and
    // ~6 baseline reloads a day leaves the 40-75/day budget almost entirely
    // available to real pushes on a heavy logging day. Tightening this to
    // hourly would spend headroom that logging should get.
    let nextAsk = now.addingTimeInterval(4 * 60 * 60)
    completion(Timeline(entries: entries, policy: .after(nextAsk)))
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

        // Quick-add button — slot 1 only (ADR-0020), matching the Android 2x2
        // face. A `systemSmall` cell has room for one button under two numbers;
        // the three-button row is the deferred `systemMedium` face.
        //
        // Only on `.ready`: an empty face is declining to describe the day, and a
        // button on it would be logging into a day it will not show.
        if let slot = snap.quickAdd?.first {
          QuickAddButton(slot: slot, index: 0, verb: s.quickAddVerb)
        }
      }
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
    .containerBackground(Color.igPanel, for: .widget)
  }
}

// MARK: - Home Screen · systemMedium

/**
 * The wide face. Same numbers as `systemSmall`, plus the quick-add row that a
 * small cell has never had room for — the one `HomeView` calls "the deferred
 * `systemMedium` face".
 *
 * Layout is a deliberate split rather than a stretched `HomeView`: numbers left,
 * actions right, so the widget reads as "here is your day, here is how to add to
 * it" at a glance. A `systemMedium` cell is roughly 2:1, and simply letting the
 * small layout expand would leave a column of whitespace where the value is.
 *
 * Up to three slots, because that is what `snap.quickAdd` carries and what the
 * row fits at this width without truncating names to initials. Fewer is fine —
 * a user with one preset gets one button, not three with two empty.
 */
/**
 * A macro's progress as a bar, not a number.
 *
 * `Metric.progress` is computed for every face and clamped to `0...1`, and the
 * home faces have never drawn it — `systemSmall` skips it for want of room, so
 * it reached only the Lock Screen gauges. It is the one piece of information
 * the wide face can add that costs no reading: Apple's guidance is that a
 * widget must be understood "in a fraction of a second", which rules out more
 * text and argues for exactly this.
 *
 * The clamp is load-bearing: at 140% of target the fill looks identical to
 * 100%, which is why being over is carried by the *text* colour and wording
 * rather than by an overflowing bar.
 */
private struct MacroBar: SwiftUI.View {
  let progress: Double
  let tint: Color

  var body: some SwiftUI.View {
    GeometryReader { geo in
      ZStack(alignment: .leading) {
        Capsule().fill(tint.opacity(0.20))
        Capsule()
          .fill(tint)
          // A floor of 3pt so "barely started" still reads as a bar rather than
          // as an empty track someone might mistake for broken.
          .frame(width: max(3, geo.size.width * progress))
      }
    }
    .frame(height: 5)
  }
}

private struct HomeWideView: SwiftUI.View {
  let face: Glance.Face

  /// Resolved outside the view hierarchy on purpose.
  ///
  /// This was a multi-clause `if case let … , let … , !isEmpty` evaluated inside
  /// a `ViewBuilder`. That compiles, but it puts pattern matching, optional
  /// binding and a predicate into the one place whose failures surface as "the
  /// widget did not render" with no diagnosable error — an extension has no
  /// crash reporting (Sentry does not support widgets: getsentry/sentry-cocoa
  /// #3695, and #3513 has Sentry itself crashing them). Plain Swift here, views
  /// below.
  private var slots: [Glance.QuickAddSlot] {
    guard case let .ready(_, _, snap) = face else { return [] }
    return Array((snap.quickAdd ?? []).prefix(3))
  }

  private var strings: Glance.Strings {
    switch face {
    case let .empty(locale): return Glance.strings(locale ?? "en")
    case let .ready(_, _, snap): return Glance.strings(snap.locale)
    }
  }

  var body: some SwiftUI.View {
    HStack(alignment: .top, spacing: 14) {
      VStack(alignment: .leading, spacing: 0) {
        switch face {
        case let .empty(locale):
          Text(Glance.strings(locale ?? "en").empty)
            .font(.system(size: 13))
            .foregroundStyle(Color.igMuted)

        case let .ready(kcal, protein, snap):
          let s = Glance.strings(snap.locale)
          // One element draws the eye. The kcal figure is it; everything below
          // is support, which is why only this line gets display weight.
          Text(Glance.grouped(kcal.value))
            .font(.system(size: 40, weight: .bold, design: .rounded))
            .foregroundStyle(Color.igKcal)
            .minimumScaleFactor(0.6)
            .lineLimit(1)
          Text("\(s.kcal) \(kcal.isOver ? s.over : s.left)")
            .font(.system(size: 12))
            .foregroundStyle(Color.igMuted)
          MacroBar(progress: kcal.progress, tint: Color.igKcal)
            .padding(.top, 7)

          Text(Glance.proteinLine(protein, s))
            .font(.system(size: 14, weight: .semibold))
            .foregroundStyle(Color.igProtein)
            .minimumScaleFactor(0.7)
            .lineLimit(1)
            .padding(.top, 12)
          MacroBar(progress: protein.progress, tint: Color.igProtein)
            .padding(.top, 5)
        }
      }
      .frame(maxWidth: .infinity, alignment: .leading)

      // Actions only on `.ready`, for the same reason `HomeView` does it: an
      // empty face is declining to describe the day, and a button on it would
      // log into a day the widget will not show.
      // Explicit, not `ForEach`. `QuickAddSlot.id` is `presetId`, so two slots
      // bound to the same preset produce duplicate identities, and a `ForEach`
      // over duplicate ids is undefined behaviour in SwiftUI — which in an
      // extension presents as the whole widget failing to render rather than as
      // a diagnosable error. There are at most three slots (`QUICK_ADD_MAX`),
      // so a dynamic list buys nothing and costs the one hazard the small face
      // never had.
      if !slots.isEmpty {
        // No `maxWidth: .infinity` here. That forced a 50/50 split, so the
        // chips were squeezed into half the widget regardless of how long a
        // preset name was — which is why "Overnight Oats + …" truncated while
        // the two shorter names had room to spare. Sized to content now, with a
        // ceiling so one very long name cannot crowd out the number that is the
        // whole point of the widget.
        VStack(alignment: .trailing, spacing: 6) {
          if slots.count > 0 {
            QuickAddButton(slot: slots[0], index: 0, verb: strings.quickAddVerb)
          }
          if slots.count > 1 {
            QuickAddButton(slot: slots[1], index: 1, verb: strings.quickAddVerb)
          }
          if slots.count > 2 {
            QuickAddButton(slot: slots[2], index: 2, verb: strings.quickAddVerb)
          }
        }
        .frame(maxWidth: 175, alignment: .trailing)
      }
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
    .containerBackground(Color.igPanel, for: .widget)
  }
}

/**
 * The one interactive control in this widget (iOS 17+).
 *
 * `Button(intent:)` is the whole mechanism: WidgetKit performs the intent by
 * launching the app in the background, which is why the write can read the app's
 * own keychain and needs no entitlement of its own. There is no confirmation
 * state — the numbers moving is the receipt (see `QuickAdd`).
 *
 * The availability guard is belt-and-braces: this target is pinned to
 * `deploymentTarget: "17.0"` in `expo-target.config.js`, but the pin lives in a
 * config file and the API floor should not depend on someone not lowering it.
 */
private struct QuickAddButton: SwiftUI.View {
  /// Home Screen tint/clear modes render the widget `.accented`: the system
  /// flattens every colour into one tint. A filled capsule and its label then
  /// resolve to the *same* colour, so the text disappears into its own
  /// background — verified on device 2026-08-13, where all three chips drew as
  /// solid blobs with no readable name in both Tinted and Clear.
  ///
  /// `index.swift` used to say these semantics were unverified and that the
  /// design deliberately did not depend on them. That was the right call while
  /// nothing needed them; a filled control with a label inside is the case that
  /// needs them.
  ///
  /// Fix is an outline instead of a fill whenever rendering is not full colour.
  /// Opacity survives the flattening even though hue does not, so a stroked
  /// capsule stays visible as a shape while the label keeps full contrast
  /// against the widget background rather than against a capsule. Branching on
  /// `!= .fullColor` rather than `== .accented` covers `.vibrant` too, without
  /// depending on which mode each surface picks.
  @Environment(\.widgetRenderingMode) private var renderingMode

  let slot: Glance.QuickAddSlot
  /// Index into `snap.quickAdd`, and the value the intent writes.
  ///
  /// This used to be a hardcoded `0` in the intent below while the view took a
  /// `slot` it only ever read the *name* from. That was invisible while
  /// `systemSmall` rendered exactly one button — index 0 was the only correct
  /// answer — and it would have silently logged slot 1's food for every button
  /// in the `systemMedium` row. The bug and the feature that exposes it arrive
  /// in the same commit; it was never wrong on a shipped face.
  let index: Int
  let verb: String

  var body: some SwiftUI.View {
    if #available(iOS 17.0, *) {
      Button(intent: LogQuickAddSlotIntent(slot: index)) {
        Text("+ \(slot.name)")
          .font(.system(size: 12, weight: .semibold))
          .lineLimit(1)
          .truncationMode(.tail)
      }
      .buttonStyle(.plain)
      .foregroundStyle(Color.igText)
      .padding(.horizontal, 10)
      .padding(.vertical, 5)
      .background {
        if renderingMode == .fullColor {
          Capsule().fill(Color.igButton)
        } else {
          Capsule().strokeBorder(Color.igText.opacity(0.55), lineWidth: 1)
        }
      }
      .padding(.top, 10)
      .accessibilityLabel("\(verb) \(slot.name)")
    }
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
      // Wordless — no unit, no label, only the centred number. There is no room
      // for a word here, and with `progress` clamped to 0...1 the ring alone
      // cannot say "past target", so the over-target state is carried by a
      // single `+` glyph on the value itself. It needs no es-PR translation.
      Gauge(value: kcal.progress) {
        EmptyView()
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
      case .systemMedium: HomeWideView(face: entry.face)
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

/// Everything `Today.appex` vends.
///
/// It became a bundle in N3, when the fasting Live Activity joined it. A Live
/// Activity is a WidgetKit widget, so it belongs in the WidgetKit extension that
/// already exists rather than in a second one — see `FastActivityWidget.swift`
/// for why. Adding a widget here means adding a line here; there is no other
/// registration step.
@main
struct IgniaWidgets: WidgetBundle {
  var body: some Widget {
    TodayWidget()
    FastActivityWidget()
  }
}

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
    // `.systemMedium` added 2026-08-13 — the wide face WIDGET.md §Sizes called
    // "still additive later". Adding a family is additive for existing users:
    // installed `systemSmall` instances keep their layout, and the medium size
    // simply becomes offerable in the gallery.
    .supportedFamilies([
      .systemSmall, .systemMedium,
      .accessoryCircular, .accessoryRectangular, .accessoryInline,
    ])
  }
}
