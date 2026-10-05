import ExpoModulesCore
import UIKit

/**
 * A pull-down menu button: `UIButton` with `menu` and
 * `showsMenuAsPrimaryAction = true` — one tap opens the system menu anchored
 * to the button (Liquid Glass on iOS 26), the control Files, Mail and every
 * toolbar "⋯" use. JS face: `src/components/MenuButton.tsx`.
 *
 * ## The face is React Native
 *
 * The button is transparent and laid over the view's RN children, which stay
 * the visible content (an icon, a chip, a label). With no children JS sets
 * `showsIcon` and the button draws an SF Symbol (`ellipsis` by default).
 *
 * Touches: `hitTest` hands every touch inside the bounds to the button, so an
 * RN child can never swallow the tap that should open the menu. RN's own touch
 * handler still sees the touch (it is a recogniser on the root view) but finds
 * no JS responder here, so nothing double-fires.
 *
 * Accessibility: the button is the ONE element (`accessibilityElements`), with
 * the label JS passes as `buttonAccessibilityLabel` — so VoiceOver reads
 * "More options for Bench press, button, pop-up menu" instead of descending
 * into an icon glyph. `buttonTestID` lands on the button too, where XCUITest
 * (Maestro) looks.
 *
 * ## Actions
 *
 * `[{ key, title, subtitle?, sfSymbol?, destructive?, disabled? }]`, in order.
 * Destructive rows are grouped after a separator, the convention every system
 * menu follows (Delete is never between Rename and Share). A pick sends
 * `onAction { key }` once the menu has closed.
 */
public class NativeMenuButtonModule: Module {
  public func definition() -> ModuleDefinition {
    Name("NativeMenuButton")

    View(NativeMenuButtonView.self) {
      Events("onAction")

      Prop("actions") { (view: NativeMenuButtonView, actions: [MenuActionRecord]?) in
        view.actions = actions ?? []
      }
      Prop("title") { (view: NativeMenuButtonView, title: String?) in
        view.menuTitle = title ?? ""
      }
      Prop("showsIcon") { (view: NativeMenuButtonView, shows: Bool?) in
        view.showsIcon = shows ?? false
      }
      Prop("iconName") { (view: NativeMenuButtonView, name: String?) in
        view.iconName = (name?.isEmpty == false ? name : nil) ?? "ellipsis"
      }
      Prop("iconSize") { (view: NativeMenuButtonView, size: Double?) in
        view.iconSize = CGFloat(size ?? 20)
      }
      Prop("iconColor") { (view: NativeMenuButtonView, color: UIColor?) in
        view.button.tintColor = color
      }
      Prop("enabled") { (view: NativeMenuButtonView, enabled: Bool?) in
        view.button.isEnabled = enabled ?? true
      }
      Prop("buttonAccessibilityLabel") { (view: NativeMenuButtonView, label: String?) in
        view.button.accessibilityLabel = label
      }
      Prop("buttonAccessibilityHint") { (view: NativeMenuButtonView, hint: String?) in
        view.button.accessibilityHint = hint
      }
      Prop("buttonTestID") { (view: NativeMenuButtonView, id: String?) in
        view.button.accessibilityIdentifier = id
      }

      OnViewDidUpdateProps { (view: NativeMenuButtonView) in
        view.rebuild()
      }
    }
  }
}

struct MenuActionRecord: Record {
  @Field var key: String = ""
  @Field var title: String = ""
  @Field var subtitle: String?
  @Field var sfSymbol: String?
  @Field var destructive: Bool = false
  @Field var disabled: Bool = false
}

/// Reports its highlight so the RN face can dim with it — a transparent
/// button's own highlight is invisible.
final class MenuHostButton: UIButton {
  var onHighlight: ((Bool) -> Void)?

  override var isHighlighted: Bool {
    didSet {
      if oldValue != isHighlighted { onHighlight?(isHighlighted) }
    }
  }
}

public final class NativeMenuButtonView: ExpoView {
  let button = MenuHostButton(type: .system)
  let onAction = EventDispatcher()

  var actions: [MenuActionRecord] = []
  var menuTitle = ""
  var showsIcon = false
  var iconName = "ellipsis"
  var iconSize: CGFloat = 20

  public required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    button.showsMenuAsPrimaryAction = true
    // Rows stay in the order JS gave, even when the menu opens upward.
    button.preferredMenuElementOrder = .fixed
    button.accessibilityTraits.insert(.button)
    button.onHighlight = { [weak self] on in self?.dimFace(on) }
    addSubview(button)
  }

  func rebuild() {
    if showsIcon {
      let config = UIImage.SymbolConfiguration(pointSize: iconSize, weight: .semibold)
      button.setImage(UIImage(systemName: iconName, withConfiguration: config), for: .normal)
    } else {
      button.setImage(nil, for: .normal)
    }

    let make: (MenuActionRecord) -> UIAction = { [weak self] record in
      var attributes: UIMenuElement.Attributes = []
      if record.destructive { attributes.insert(.destructive) }
      if record.disabled { attributes.insert(.disabled) }
      let action = UIAction(
        title: record.title,
        image: record.sfSymbol.flatMap { UIImage(systemName: $0) },
        attributes: attributes
      ) { _ in
        self?.onAction(["key": record.key])
      }
      if let subtitle = record.subtitle, !subtitle.isEmpty { action.subtitle = subtitle }
      return action
    }
    let plain = actions.filter { !$0.destructive }.map(make)
    let destructive = actions.filter(\.destructive).map(make)
    var children: [UIMenuElement] = plain
    if !destructive.isEmpty {
      // An inline submenu draws the separator above the destructive group.
      children.append(UIMenu(title: "", options: .displayInline, children: destructive))
    }
    button.menu = children.isEmpty ? nil : UIMenu(title: menuTitle, children: children)
  }

  private func dimFace(_ on: Bool) {
    UIView.animate(withDuration: on ? 0.05 : 0.2) {
      for view in self.subviews where view !== self.button {
        view.alpha = on ? 0.45 : 1
      }
    }
  }

  public override func didAddSubview(_ subview: UIView) {
    super.didAddSubview(subview)
    // RN mounts children after init; the button stays on top of all of them.
    if subview !== button { bringSubviewToFront(button) }
  }

  public override func layoutSubviews() {
    super.layoutSubviews()
    button.frame = bounds
  }

  public override func hitTest(_ point: CGPoint, with event: UIEvent?) -> UIView? {
    guard isUserInteractionEnabled, !isHidden, alpha > 0.01, self.point(inside: point, with: event)
    else { return nil }
    return button
  }

  public override var accessibilityElements: [Any]? {
    get { [button] }
    set {}
  }
}
