import ActivityKit
import AppIntents
import SwiftUI
import WidgetKit

//
//  Ignia — the rest-timer Live Activity's faces (Lock Screen + Dynamic Island),
//  Train review item 20.
//
//  The model, the `@objc` bridge JS calls and the auto-end-at-the-deadline
//  design live in `targets/_shared/RestActivity.swift`; the two buttons'
//  intents in `targets/_shared/LiveActivityIntents.swift`. This file is SwiftUI
//  and nothing else — the same split `FastActivityWidget.swift` uses.
//
//  ## Every countdown is one `Text(timerInterval:countsDown:)`
//
//  Drawn by the system from the clock, so it keeps counting while the JS
//  runtime is suspended — a lifter locks the phone between sets, which is the
//  whole reason this exists. The only things that ever change it are the app
//  (a new set, ±30 s in Train) and the two buttons below, all local updates.
//
//  ## "Rest over"
//
//  The Activity is requested with `staleDate` = the deadline, so at zero the
//  system marks it stale and these faces swap the frozen `0:00` for the words
//  "Rest over". Nothing of ours has to be running at that instant, which is the
//  point — see `RestActivity.swift` for why ActivityKit cannot end it then.
//
//  ## Colour
//
//  The fixed brand face, same values and same reasoning as
//  `FastActivityWidget.swift` (the Lock Screen sits on the user's wallpaper and
//  cannot follow the in-app theme, ADR-0014): `heroPanel`, `heroMuted`,
//  `heroText` and the `ring` coral from `src/theme.ts`. Duplicated rather than
//  shared because those are `private` there and `_shared` may not hold SwiftUI.
//

private extension Color {
  init(restHex: UInt32) {
    self.init(
      .sRGB,
      red: Double((restHex >> 16) & 0xff) / 255,
      green: Double((restHex >> 8) & 0xff) / 255,
      blue: Double(restHex & 0xff) / 255,
      opacity: 1)
  }

  static let restPanel = Color(restHex: 0x161412)  // heroPanel
  static let restMuted = Color(restHex: 0xa39c91)  // heroMuted
  static let restAccent = Color(restHex: 0xff6a3d)  // ring — the coral
  static let restText = Color(restHex: 0xf3f1ec)  // heroText
  static let restButton = Color(restHex: 0x2b2825)  // igButton in index.swift
}

/// Copy for the Live Activity faces, keyed by the profile locale the Activity
/// was armed with (never the phone's — `Glance.strings` explains why).
///
/// Its own table rather than more fields on `Glance.Strings`: these words are
/// drawn only here, `Glance.Strings` is shared with the watch, and it has no
/// pt-BR column. Mirrors `train.rest*` / `metrics.endFast*` in `src/i18n/`.
enum ActivityCopy {
  struct Words {
    /// Label above the countdown. A noun — the face states, it does not instruct.
    let rest: String
    /// Shown once the deadline has passed (the Activity is stale).
    let restOver: String
    /// Visible caption of the +30 s button.
    let addThirty: String
    /// What VoiceOver says for it — "+30 s" read aloud is "plus thirty s".
    let addThirtyA11y: String
    let skip: String
    let skipA11y: String
    /// The fast's End button.
    let endFast: String
    let endFastA11y: String
  }

  static func words(_ locale: String) -> Words {
    switch locale {
    case "es-PR":
      return Words(
        rest: "Descanso", restOver: "Descanso terminado",
        addThirty: "+30 s", addThirtyA11y: "Añadir 30 segundos al descanso",
        skip: "Saltar", skipA11y: "Saltar el descanso",
        endFast: "Terminar", endFastA11y: "Terminar el ayuno")
    case "pt-BR":
      return Words(
        rest: "Descanso", restOver: "Descanso encerrado",
        addThirty: "+30 s", addThirtyA11y: "Adicionar 30 segundos ao descanso",
        skip: "Pular", skipA11y: "Pular o descanso",
        endFast: "Encerrar", endFastA11y: "Encerrar o jejum")
    default:
      return Words(
        rest: "Rest", restOver: "Rest over",
        addThirty: "+30 s", addThirtyA11y: "Add 30 seconds to rest",
        skip: "Skip", skipA11y: "Skip rest",
        endFast: "End", endFastA11y: "End fast")
    }
  }
}

/// A pill-shaped Live Activity button. One definition so the rest and fast
/// faces cannot drift into two button styles.
struct ActivityPillLabel: View {
  let text: String
  var prominent: Bool = false

  var body: some View {
    Text(text)
      .font(.system(size: 15, weight: .semibold))
      .monospacedDigit()
      .foregroundStyle(prominent ? Color.restPanel : Color.restText)
      .lineLimit(1)
      .minimumScaleFactor(0.8)
      .padding(.horizontal, 14)
      .frame(minHeight: 36)
      .background(Capsule().fill(prominent ? Color.restAccent : Color.restButton))
  }
}

/// The countdown, in one place so the faces cannot drift.
///
/// The lower bound is clamped so a deadline moved EARLIER than the rest's start
/// (−30 s at the very beginning) can never build an inverted range, which
/// `Text(timerInterval:)` traps on.
private struct RestCountdown: View {
  let state: RestActivityAttributes.ContentState
  let font: Font

  var body: some View {
    Text(
      timerInterval: min(state.startedAt, state.endsAt)...state.endsAt,
      countsDown: true,
      showsHours: false
    )
    .font(font)
    .monospacedDigit()
    .foregroundStyle(Color.restText)
    .lineLimit(1)
    .minimumScaleFactor(0.6)
  }
}

/// The two Lock Screen / expanded-island buttons.
private struct RestButtons: View {
  let words: ActivityCopy.Words

  var body: some View {
    HStack(spacing: 8) {
      Button(intent: RestAddTimeIntent()) {
        ActivityPillLabel(text: words.addThirty)
      }
      .buttonStyle(.plain)
      .accessibilityLabel(words.addThirtyA11y)

      Button(intent: RestSkipIntent()) {
        ActivityPillLabel(text: words.skip, prominent: true)
      }
      .buttonStyle(.plain)
      .accessibilityLabel(words.skipA11y)
    }
  }
}

/// Lock Screen, and the banner on devices with no Dynamic Island.
private struct RestLockScreenView: View {
  let context: ActivityViewContext<RestActivityAttributes>

  var body: some View {
    let words = ActivityCopy.words(context.attributes.locale)
    let state = context.state

    VStack(alignment: .leading, spacing: 10) {
      HStack(alignment: .center, spacing: 12) {
        Image(systemName: "timer")
          .font(.system(size: 24, weight: .semibold))
          .foregroundStyle(Color.restAccent)

        VStack(alignment: .leading, spacing: 1) {
          Text(words.rest)
            .font(.caption)
            .textCase(.uppercase)
            .foregroundStyle(Color.restMuted)
          if !state.exerciseName.isEmpty {
            Text(state.exerciseName)
              .font(.subheadline.weight(.semibold))
              .foregroundStyle(Color.restText)
              .lineLimit(1)
          }
        }

        Spacer(minLength: 8)

        if context.isStale {
          Text(words.restOver)
            .font(.system(size: 20, weight: .semibold))
            .foregroundStyle(Color.restAccent)
            .lineLimit(1)
            .minimumScaleFactor(0.7)
        } else {
          RestCountdown(state: state, font: .system(size: 36, weight: .semibold))
            .multilineTextAlignment(.trailing)
            .frame(maxWidth: 120, alignment: .trailing)
        }
      }

      if !context.isStale {
        // The bar empties as the rest runs down — drawn by the system from the
        // same two dates, so it needs no update either.
        ProgressView(
          timerInterval: min(state.startedAt, state.endsAt)...state.endsAt,
          countsDown: true,
          label: { EmptyView() },
          currentValueLabel: { EmptyView() }
        )
        .tint(Color.restAccent)
      }

      HStack {
        Spacer(minLength: 0)
        RestButtons(words: words)
      }
    }
    .padding(.horizontal, 18)
    .padding(.vertical, 14)
    .activityBackgroundTint(Color.restPanel)
    .activitySystemActionForegroundColor(Color.restText)
    // A tap outside the two buttons lands back in the workout (the Train tab
    // shows the active session). `ignia://train` resolves through Expo Router
    // like the widget's `ignia://?openAdd=1`.
    .widgetURL(URL(string: "ignia://train"))
  }
}

/// The compact-trailing countdown, sized by a hidden template exactly as
/// `CompactFastTimer` is — `Text(timerInterval:)` is greedy and will otherwise
/// stretch the pill over the status-bar clock (`FastActivityWidget.swift`
/// records the user report that taught this). A rest is minutes, never hours,
/// so `00:00` always covers it.
private struct CompactRestCountdown: View {
  let state: RestActivityAttributes.ContentState

  private static let font = Font.system(size: 14, weight: .semibold)

  var body: some View {
    let long = state.endsAt.timeIntervalSince(state.startedAt) >= 10 * 60
    Text(long ? "00:00" : "0:00")
      .font(Self.font)
      .monospacedDigit()
      .lineLimit(1)
      .hidden()
      .overlay(alignment: .trailing) {
        RestCountdown(state: state, font: Self.font)
          .multilineTextAlignment(.trailing)
      }
  }
}

struct RestActivityWidget: Widget {
  var body: some WidgetConfiguration {
    ActivityConfiguration(for: RestActivityAttributes.self) { context in
      RestLockScreenView(context: context)
    } dynamicIsland: { context in
      let words = ActivityCopy.words(context.attributes.locale)
      let state = context.state

      return DynamicIsland {
        DynamicIslandExpandedRegion(.leading) {
          Label {
            Text(words.rest).foregroundStyle(Color.restMuted)
          } icon: {
            Image(systemName: "timer").foregroundStyle(Color.restAccent)
          }
          .font(.caption)
          .padding(.leading, 4)
        }

        DynamicIslandExpandedRegion(.trailing) {
          Group {
            if context.isStale {
              Text(words.restOver)
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(Color.restAccent)
                .lineLimit(1)
                .minimumScaleFactor(0.7)
            } else {
              RestCountdown(state: state, font: .system(size: 22, weight: .semibold))
                .multilineTextAlignment(.trailing)
            }
          }
          // Fixed so the leading label does not shuffle as digits tick.
          .frame(width: 96, alignment: .trailing)
          .padding(.trailing, 4)
        }

        DynamicIslandExpandedRegion(.bottom) {
          HStack(spacing: 8) {
            Text(state.exerciseName)
              .font(.caption)
              .foregroundStyle(Color.restMuted)
              .lineLimit(1)
            Spacer(minLength: 4)
            RestButtons(words: words)
          }
          .padding(.horizontal, 4)
        }
      } compactLeading: {
        Image(systemName: "timer")
          .font(.system(size: 14, weight: .semibold))
          .foregroundStyle(Color.restAccent)
          .padding(.leading, 3)
      } compactTrailing: {
        if context.isStale {
          Image(systemName: "checkmark")
            .font(.system(size: 13, weight: .bold))
            .foregroundStyle(Color.restAccent)
            .padding(.trailing, 3)
        } else {
          CompactRestCountdown(state: state)
            .padding(.trailing, 3)
        }
      } minimal: {
        // A circle barely wider than a glyph: a ring that empties with the rest
        // says "resting, this much left" without digits that would not fit.
        ProgressView(
          timerInterval: min(state.startedAt, state.endsAt)...state.endsAt,
          countsDown: true,
          label: { EmptyView() },
          currentValueLabel: {
            Image(systemName: "timer").font(.system(size: 9, weight: .bold))
          }
        )
        .progressViewStyle(.circular)
        .tint(Color.restAccent)
      }
      .keylineTint(Color.restAccent)
      .widgetURL(URL(string: "ignia://train"))
    }
  }
}
