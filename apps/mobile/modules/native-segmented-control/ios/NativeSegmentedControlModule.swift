import ExpoModulesCore
import UIKit

/**
 * A `UISegmentedControl` — the iOS switch between views of one card (Trends'
 * ranges and panels, Body's range, Settings' units / theme / language / day
 * start). JS: `src/components/charts/SegmentedControl.tsx`, which falls back
 * to its own control where this view does not exist.
 *
 * System colours, deliberately: the control is the one the rest of iOS draws
 * (S21 reviewers' largest remaining Platform item), so it follows light, dark
 * and Increase Contrast by itself. `forceDark` pins it dark on the hero panel,
 * which is dark in both themes. The font is the size JS computed (it already
 * applies the screen's `maxFontSizeMultiplier`), semibold like the JS control.
 *
 * Controlled: `selectedIndex` is the truth, re-applied on every props update.
 * A tap sends `onChange { index }` and keeps its selection (snapping back
 * first made the segment flicker until JS answered); a caller that cannot
 * take a change says so with `enabled: false` (Settings while offline).
 *
 * Accessibility: VoiceOver reads a segment as "1M, button, 1 of 5" with
 * "selected" on the current one. `a11yLabel` and `testID` land on the segment
 * views themselves (the public API has no per-segment label), matched by
 * x-position after layout.
 */
public class NativeSegmentedControlModule: Module {
  public func definition() -> ModuleDefinition {
    Name("NativeSegmentedControl")

    View(NativeSegmentedControlView.self) {
      Events("onChange")

      Prop("segments") { (view: NativeSegmentedControlView, segments: [SegmentRecord]?) in
        view.segments = segments ?? []
      }
      Prop("selectedIndex") { (view: NativeSegmentedControlView, index: Int?) in
        view.selectedIndex = index ?? 0
      }
      Prop("enabled") { (view: NativeSegmentedControlView, enabled: Bool?) in
        view.control.isEnabled = enabled ?? true
      }
      Prop("fontSize") { (view: NativeSegmentedControlView, size: Double?) in
        view.fontSize = CGFloat(size ?? 14)
      }
      Prop("forceDark") { (view: NativeSegmentedControlView, dark: Bool?) in
        view.control.overrideUserInterfaceStyle = (dark ?? false) ? .dark : .unspecified
      }
      // Android-only props; accepted so they are not reported as unknown.
      Prop("colors") { (_: NativeSegmentedControlView, _: [String: String]?) in }
      Prop("cornerRadius") { (_: NativeSegmentedControlView, _: Double?) in }

      OnViewDidUpdateProps { (view: NativeSegmentedControlView) in
        view.apply()
      }
    }
  }
}

struct SegmentRecord: Record {
  @Field var label: String = ""
  @Field var a11yLabel: String?
  @Field var testID: String?
}

public final class NativeSegmentedControlView: ExpoView {
  let control = UISegmentedControl()
  let onChange = EventDispatcher()

  var segments: [SegmentRecord] = []
  var selectedIndex = 0
  var fontSize: CGFloat = 14
  private var shownLabels: [String] = []

  public required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    control.addTarget(self, action: #selector(changed), for: .valueChanged)
    addSubview(control)
  }

  func apply() {
    let labels = segments.map(\.label)
    if labels != shownLabels {
      control.removeAllSegments()
      for (i, label) in labels.enumerated() {
        control.insertSegment(withTitle: label, at: i, animated: false)
      }
      shownLabels = labels
    }
    let font = UIFont.systemFont(ofSize: fontSize, weight: .semibold)
    control.setTitleTextAttributes([.font: font], for: .normal)
    control.setTitleTextAttributes([.font: UIFont.systemFont(ofSize: fontSize, weight: .bold)], for: .selected)
    if selectedIndex >= 0, selectedIndex < control.numberOfSegments {
      control.selectedSegmentIndex = selectedIndex
    }
    setNeedsLayout()
  }

  @objc private func changed() {
    let index = control.selectedSegmentIndex
    if index >= 0 { onChange(["index": index]) }
  }

  public override func layoutSubviews() {
    super.layoutSubviews()
    control.frame = bounds
    control.layoutIfNeeded()
    labelSegments()
  }

  /// The per-segment label and identifier, on the private segment views,
  /// matched left to right. Best effort: if the hierarchy ever stops having
  /// one view per segment the labels are simply the titles again.
  private func labelSegments() {
    let views = control.subviews
      .filter { String(describing: type(of: $0)).contains("Segment") && !($0 is UIImageView) }
      .sorted { $0.frame.minX < $1.frame.minX }
    guard views.count == segments.count else { return }
    for (view, segment) in zip(views, segments) {
      if let label = segment.a11yLabel, !label.isEmpty { view.accessibilityLabel = label }
      if let id = segment.testID, !id.isEmpty { view.accessibilityIdentifier = id }
    }
  }
}
