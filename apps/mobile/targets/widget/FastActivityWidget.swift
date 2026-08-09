import ActivityKit
import SwiftUI
import WidgetKit

//
//  Ignia — N3, the fasting Live Activity's faces (Lock Screen + Dynamic Island).
//
//  The model, the `@objc` bridge JS calls, the eight-hour ceiling and the reason
//  nothing is ever pushed all live in `targets/_shared/FastActivity.swift`. Read
//  that first; this file is SwiftUI and nothing else, the same split
//  `index.swift` and `Glance.swift` already use (#38 §1).
//
//  ## Every face is one `Text(timerInterval:)`
//
//  SwiftUI redraws that from the system clock on-device. The extension is not
//  woken, no timeline is scheduled, no update is pushed — which is why this
//  feature has no runtime cost at all. The range is `startedAt ... +48h` purely
//  because the initialiser demands an upper bound; the system ends the Activity
//  at 8h regardless, so the bound is never reached.
//
//  ## Why it does not live in its own extension
//
//  A Live Activity is a WidgetKit widget, and `Today.appex` is already a
//  WidgetKit extension with the App Group and the iOS 17 floor this needs. A
//  second extension would mean a second target, a second entitlement set and a
//  second thing to verify nested in the `.ipa`, to gain nothing — the two faces
//  share no code but they do share a process, and a widget bundle is exactly the
//  supported way to ship both. `index.swift`'s `@main` is therefore a
//  `WidgetBundle` as of N3.
//
//  ## Colour
//
//  Same reasoning as `index.swift`: the Lock Screen sits on the user's wallpaper
//  and cannot follow the in-app theme (ADR-0014), so it wears the one fixed
//  brand face. The values are duplicated from `index.swift` rather than shared
//  because `_shared` may not contain SwiftUI — its floor is the watch's
//  (`Glance.swift` rule 1).
//

private extension Color {
  init(hexValue: UInt32) {
    self.init(
      .sRGB,
      red: Double((hexValue >> 16) & 0xff) / 255,
      green: Double((hexValue >> 8) & 0xff) / 255,
      blue: Double(hexValue & 0xff) / 255,
      opacity: 1)
  }

  static let fastPanel = Color(hexValue: 0x161412)  // heroPanel
  static let fastMuted = Color(hexValue: 0xa39c91)  // heroMuted
  static let fastAccent = Color(hexValue: 0xff6a3d)  // ring
  static let fastText = Color(hexValue: 0xf3f1ec)  // heroText
}

/// The counting-up elapsed timer, in one place so the four faces cannot drift.
///
/// `countsDown: false` makes it count up from `startedAt`; `showsHours` is on
/// because a fast is measured in hours and a bare `47:12` at hour 15 would read
/// as minutes and seconds.
private struct FastTimer: View {
  let startedAt: Date
  let font: Font

  var body: some View {
    Text(
      timerInterval: startedAt...startedAt.addingTimeInterval(48 * 60 * 60),
      countsDown: false,
      showsHours: true
    )
    .font(font)
    .monospacedDigit()
    .foregroundStyle(Color.fastText)
    .minimumScaleFactor(0.6)
    .lineLimit(1)
  }
}

/// Lock Screen, and the banner shown on devices with no Dynamic Island.
private struct FastLockScreenView: View {
  let attributes: FastActivityAttributes

  var body: some View {
    let strings = Glance.strings(attributes.locale)

    HStack(alignment: .center, spacing: 14) {
      // The mark. `flame` is the one glyph that means "fast" without a word, and
      // it carries the brand accent on a face where the timer must stay neutral
      // to remain legible against any wallpaper.
      Image(systemName: "flame.fill")
        .font(.system(size: 26))
        .foregroundStyle(Color.fastAccent)

      VStack(alignment: .leading, spacing: 2) {
        Text(strings.fasting)
          .font(.caption)
          .textCase(.uppercase)
          .foregroundStyle(Color.fastMuted)

        FastTimer(startedAt: attributes.startedAt, font: .system(size: 34, weight: .semibold))

        Text(Glance.fastSinceLine(startedAt: attributes.startedAt, locale: attributes.locale))
          .font(.caption2)
          .foregroundStyle(Color.fastMuted)
      }

      Spacer(minLength: 0)
    }
    .padding(.horizontal, 18)
    .padding(.vertical, 14)
    // Tint the whole activity rather than painting a background: the system
    // composites this onto the Lock Screen and owns the corner radius.
    .activityBackgroundTint(Color.fastPanel)
    .activitySystemActionForegroundColor(Color.fastText)
  }
}

struct FastActivityWidget: Widget {
  var body: some WidgetConfiguration {
    ActivityConfiguration(for: FastActivityAttributes.self) { context in
      FastLockScreenView(attributes: context.attributes)
    } dynamicIsland: { context in
      let strings = Glance.strings(context.attributes.locale)

      return DynamicIsland {
        DynamicIslandExpandedRegion(.leading) {
          Label {
            Text(strings.fasting).foregroundStyle(Color.fastMuted)
          } icon: {
            Image(systemName: "flame.fill").foregroundStyle(Color.fastAccent)
          }
          .font(.caption)
          .padding(.leading, 4)
        }

        DynamicIslandExpandedRegion(.trailing) {
          FastTimer(
            startedAt: context.attributes.startedAt,
            font: .system(size: 20, weight: .semibold)
          )
          // Without a fixed width the trailing region resizes as the digit count
          // grows (9:59 → 10:00), which shunts the leading label sideways.
          .frame(width: 84, alignment: .trailing)
          .padding(.trailing, 4)
        }

        DynamicIslandExpandedRegion(.bottom) {
          Text(
            Glance.fastSinceLine(
              startedAt: context.attributes.startedAt, locale: context.attributes.locale)
          )
          .font(.caption2)
          .foregroundStyle(Color.fastMuted)
        }
      } compactLeading: {
        // Sized and padded deliberately. The compact regions sit hard against
        // the pill's rounded ends, so a glyph with no padding reads as falling
        // off the left edge — which is exactly how the first build looked on a
        // real iPhone.
        Image(systemName: "flame.fill")
          .font(.system(size: 14))
          .foregroundStyle(Color.fastAccent)
          .padding(.leading, 3)
      } compactTrailing: {
        // **No fixed width.** A 52pt frame with `.trailing` alignment was worse
        // than useless here: it reserved far more room than `0:05` needs, so the
        // system widened the whole pill and the timer floated in the middle of
        // an empty box instead of sitting near the right edge.
        //
        // Letting it size to its content is the correct behaviour — the island
        // is *supposed* to grow when the digit count does (9:59 → 10:00), and
        // `monospacedDigit` already stops the number jittering as seconds tick.
        FastTimer(
          startedAt: context.attributes.startedAt,
          font: .system(size: 14, weight: .semibold)
        )
        .padding(.trailing, 3)
      } minimal: {
        // The minimal face is a circle barely wider than a glyph — a timer will
        // not fit legibly, so it shows only that a fast is running and defers
        // the number to a tap.
        Image(systemName: "flame.fill")
          .foregroundStyle(Color.fastAccent)
      }
      .keylineTint(Color.fastAccent)
    }
  }
}
