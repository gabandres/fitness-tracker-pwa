import ExpoModulesCore
import UIKit

/**
 * The system's compact date/time picker (`UIDatePicker`, `.compact` style) as
 * an Expo view — the grey pill that opens the calendar / wheel popover every
 * iOS app uses for "when". JS face: `src/components/NativeDatePicker.tsx`
 * (`NativeDateField`); this file is the bridge only.
 *
 * ## What JS sends
 *
 * - `mode`: `"date"` | `"time"` | `"dateAndTime"` (the default).
 * - `value`, `minimumDate`, `maximumDate`: epoch milliseconds (`null` = none).
 * - `minuteInterval`: 1…30, must divide 60 (anything else is ignored — UIKit
 *   would silently fall back anyway, this just says so in one place).
 * - `locale`: a BCP-47 tag (`"en"`, `"es-PR"`, `"pt-BR"`) — the profile's
 *   locale, not the phone's, for the reason `Glance.strings` gives. It also
 *   decides 12- vs 24-hour.
 * - `tintColor`: the selection colour inside the popover.
 * - `pickerAccessibilityLabel` / `pickerTestID`: put on the PICKER, not the
 *   wrapper — the picker is the element VoiceOver and XCUITest land on, and a
 *   label on the wrapper would make it a leaf that hides the picker.
 *
 * Interface style is inherited from the window, which the app already pins to
 * the in-app theme (`Appearance.setColorScheme` in `theme-context.tsx`), so the
 * popover follows a user-chosen dark mode with no prop.
 *
 * ## Sizing
 *
 * The compact picker has an intrinsic size that depends on the mode, the
 * locale, the value ("May 1" is narrower than "September 30") and Dynamic
 * Type. RN cannot know it, so the view reports it to Yoga itself
 * (`setViewSize`, the hook `@expo/ui` uses) whenever any of those change. JS
 * leaves width/height unset and lays the field out like a text label.
 *
 * ## What it sends back
 *
 * `onChange { timestamp }` — epoch ms — once per user change. A `value` prop
 * that equals what the picker already shows (the echo of that change) is not
 * re-applied, so a controlled field cannot fight the wheel mid-spin.
 */
public class NativeDatePickerModule: Module {
  public func definition() -> ModuleDefinition {
    Name("NativeDatePicker")

    View(NativeDatePickerView.self) {
      Events("onChange")

      Prop("mode") { (view: NativeDatePickerView, mode: String?) in
        view.setMode(mode)
      }
      Prop("value") { (view: NativeDatePickerView, ms: Double?) in
        view.setValue(ms)
      }
      Prop("minimumDate") { (view: NativeDatePickerView, ms: Double?) in
        view.picker.minimumDate = ms.map(NativeDatePickerView.date(fromMs:))
      }
      Prop("maximumDate") { (view: NativeDatePickerView, ms: Double?) in
        view.picker.maximumDate = ms.map(NativeDatePickerView.date(fromMs:))
      }
      Prop("minuteInterval") { (view: NativeDatePickerView, interval: Int?) in
        let n = interval ?? 1
        view.picker.minuteInterval = (n >= 1 && n <= 30 && 60 % n == 0) ? n : 1
      }
      Prop("locale") { (view: NativeDatePickerView, tag: String?) in
        view.picker.locale = tag.flatMap { $0.isEmpty ? nil : Locale(identifier: $0) } ?? .current
      }
      Prop("tintColor") { (view: NativeDatePickerView, color: UIColor?) in
        view.picker.tintColor = color
      }
      Prop("enabled") { (view: NativeDatePickerView, enabled: Bool?) in
        view.picker.isEnabled = enabled ?? true
      }
      Prop("pickerAccessibilityLabel") { (view: NativeDatePickerView, label: String?) in
        view.picker.accessibilityLabel = label
      }
      Prop("pickerTestID") { (view: NativeDatePickerView, id: String?) in
        view.picker.accessibilityIdentifier = id
      }

      // Every prop above can change the picker's intrinsic width.
      OnViewDidUpdateProps { (view: NativeDatePickerView) in
        view.remeasure()
      }
    }
  }
}

public final class NativeDatePickerView: ExpoView {
  let picker = UIDatePicker()
  let onChange = EventDispatcher()
  private var reported: CGSize = .zero

  public required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    picker.preferredDatePickerStyle = .compact
    picker.datePickerMode = .dateAndTime
    picker.addTarget(self, action: #selector(changed), for: .valueChanged)
    addSubview(picker)

    // Dynamic Type resizes the pill; Yoga has to hear about it.
    if #available(iOS 17.0, *) {
      registerForTraitChanges([UITraitPreferredContentSizeCategory.self]) {
        (self: NativeDatePickerView, _: UITraitCollection) in
        self.remeasure()
      }
    }
  }

  static func date(fromMs ms: Double) -> Date {
    Date(timeIntervalSince1970: ms / 1000)
  }

  func setMode(_ mode: String?) {
    switch mode {
    case "date": picker.datePickerMode = .date
    case "time": picker.datePickerMode = .time
    default: picker.datePickerMode = .dateAndTime
    }
  }

  func setValue(_ ms: Double?) {
    guard let ms, ms.isFinite else { return }
    let next = Self.date(fromMs: ms)
    // The echo of the user's own change: already showing, leave the wheel be.
    if abs(picker.date.timeIntervalSince(next)) < 0.5 { return }
    picker.setDate(next, animated: false)
  }

  @objc private func changed() {
    onChange(["timestamp": picker.date.timeIntervalSince1970 * 1000])
    remeasure()
  }

  /// Size the picker to its intrinsic size and tell Yoga, once per change.
  func remeasure() {
    let size = picker.systemLayoutSizeFitting(UIView.layoutFittingCompressedSize)
    guard size.width > 0, size.height > 0 else { return }
    setNeedsLayout()
    if size != reported {
      reported = size
      setViewSize(size)
    }
  }

  public override func layoutSubviews() {
    super.layoutSubviews()
    let size = reported == .zero
      ? picker.systemLayoutSizeFitting(UIView.layoutFittingCompressedSize)
      : reported
    // Centred in whatever Yoga gave us: equal to `size` once the report has
    // landed, and never clipped in the frame before it.
    picker.frame = CGRect(
      x: max(0, (bounds.width - size.width) / 2),
      y: max(0, (bounds.height - size.height) / 2),
      width: size.width,
      height: size.height)
    if reported == .zero { remeasure() }
  }

  public override func traitCollectionDidChange(_ previous: UITraitCollection?) {
    super.traitCollectionDidChange(previous)
    if #available(iOS 17.0, *) { return }
    if previous?.preferredContentSizeCategory != traitCollection.preferredContentSizeCategory {
      remeasure()
    }
  }
}
