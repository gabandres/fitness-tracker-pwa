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
 * Accessibility: this view is the container, with one element per segment
 * (the label JS gives — "3 months" for "3M" — the testID, `.selected` on the
 * current one); activating an element selects its segment. See the note at
 * `accessibilityElements` for why the control's own elements are hidden.
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
  }

  /// Select from VoiceOver / Switch Control, as a tap would.
  func select(_ index: Int) {
    guard index >= 0, index < control.numberOfSegments else { return }
    control.selectedSegmentIndex = index
    changed()
  }

  // ── Accessibility ──────────────────────────────────────────────────────
  // One element per segment, owned by this view. The control's own segments
  // are not views on iOS 26 (its subviews are plain UIViews and UIImageViews),
  // so there is nothing to hang a per-segment label or identifier on; and the
  // labels matter — "3M" was read "3 M" where the JS control said "3 months",
  // and the testIDs are what Maestro taps. The elements sit over the segments
  // (equal widths, as UISegmentedControl lays them out by default), so a tap
  // by id still lands on the real control underneath.
  public override var isAccessibilityElement: Bool {
    get { false }
    set {}
  }

  /// Kept across reads: assistive tech (and XCUITest) holds on to element
  /// identity between queries, and fresh objects on every read surfaced only
  /// the last segment. Rebuilt when the segments change; traits and frames are
  /// refreshed on each read.
  private var a11yElements: [SegmentAccessibilityElement] = []

  public override var accessibilityElements: [Any]? {
    get {
      control.accessibilityElementsHidden = true
      let n = segments.count
      if a11yElements.count != n {
        a11yElements = (0..<n).map { i in
          let element = SegmentAccessibilityElement(accessibilityContainer: self)
          element.owner = self
          element.index = i
          return element
        }
      }
      let w = n > 0 ? bounds.width / CGFloat(n) : 0
      for (i, segment) in segments.enumerated() {
        let element = a11yElements[i]
        element.accessibilityLabel = (segment.a11yLabel?.isEmpty == false ? segment.a11yLabel : nil) ?? segment.label
        element.accessibilityIdentifier = (segment.testID?.isEmpty == false) ? segment.testID : nil
        var traits: UIAccessibilityTraits = .button
        if i == control.selectedSegmentIndex { traits.insert(.selected) }
        if !control.isEnabled { traits.insert(.notEnabled) }
        element.accessibilityTraits = traits
        element.accessibilityFrameInContainerSpace = CGRect(x: w * CGFloat(i), y: 0, width: w, height: bounds.height)
      }
      return a11yElements
    }
    set {}
  }
}

final class SegmentAccessibilityElement: UIAccessibilityElement {
  weak var owner: NativeSegmentedControlView?
  var index = 0

  override func accessibilityActivate() -> Bool {
    guard let owner, owner.control.isEnabled else { return false }
    owner.select(index)
    return true
  }
}
