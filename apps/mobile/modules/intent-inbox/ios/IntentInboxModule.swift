import ExpoModulesCore

/**
 * The JS side of the intent inbox: read-and-clear the App Group list that App
 * Intents write (`targets/_shared/IntentInbox.swift`), and tell JS the moment it
 * changes.
 *
 * ## Why a module of its own
 *
 * The writer is in `_shared` (it must compile into the app AND `Today.appex`,
 * where the Live Activity buttons are drawn). This reader is a CocoaPods target
 * and cannot see `_shared`, so the three constants below are duplicated by
 * contract rather than shared — `src/__tests__/intent-inbox-contract.test.ts`
 * greps both files. A drifted key is a silent "the button did nothing in the
 * app".
 *
 * It reads `UserDefaults(suiteName:)` directly rather than through
 * `ExtensionStorage`: `take` has to read, filter and write back as one step on
 * the native side, so two JS consumers (Today drains `fast*`/`weight`, Train
 * drains `rest`) cannot clobber each other's entries.
 *
 * ## The doorbell
 *
 * Writers post a Darwin notification after every append. While JS is listening
 * (`OnStartObserving`), this forwards it as `onChange`, so an intent performed
 * in the running app's process — a `LiveActivityIntent` always is — is applied
 * at once instead of on the next foreground. Darwin notifications carry no
 * payload and are coalesced while the app is suspended; that is fine, because
 * the App Group list is the source of truth and JS also drains on foreground.
 */
public class IntentInboxModule: Module {
  /// **Must equal `Glance.appGroup`** (and the entitlement in app.json).
  private static let APP_GROUP = "group.fit.ignia.app"
  /// **Must equal `IntentInbox.key`.**
  private static let KEY = "ignia.intentInbox.v1"
  /// **Must equal `IntentInbox.darwinName`.**
  private static let DARWIN_NAME = "fit.ignia.intentInbox.changed"

  private var observing = false

  public func definition() -> ModuleDefinition {
    Name("IntentInbox")

    Events("onChange")

    OnStartObserving {
      self.startDoorbell()
    }

    OnStopObserving {
      self.stopDoorbell()
    }

    OnDestroy {
      self.stopDoorbell()
    }

    /// Remove and return every entry whose `kind` is in `kinds`, as a JSON array
    /// string (`"[]"` when there are none). Entries of other kinds stay put for
    /// their own consumer.
    AsyncFunction("take") { (kinds: [String]) -> String in
      Self.transact(kinds: Set(kinds), remove: true)
    }

    /// The same, without removing anything — for a reader that must know an
    /// action is pending before it is ready to act on it (the fast reconciler
    /// must not re-arm a Live Activity the user just ended).
    AsyncFunction("peek") { (kinds: [String]) -> String in
      Self.transact(kinds: Set(kinds), remove: false)
    }
  }

  private static func transact(kinds: Set<String>, remove: Bool) -> String {
    guard let defaults = UserDefaults(suiteName: APP_GROUP),
          let json = defaults.string(forKey: KEY),
          let list = try? JSONSerialization.jsonObject(with: Data(json.utf8)) as? [[String: Any]]
    else { return "[]" }

    let matching = list.filter { kinds.contains(($0["kind"] as? String) ?? "") }
    if remove && !matching.isEmpty {
      let rest = list.filter { !kinds.contains(($0["kind"] as? String) ?? "") }
      if rest.isEmpty {
        defaults.removeObject(forKey: KEY)
      } else if let data = try? JSONSerialization.data(withJSONObject: rest),
                let out = String(data: data, encoding: .utf8) {
        defaults.set(out, forKey: KEY)
      }
    }
    guard let data = try? JSONSerialization.data(withJSONObject: matching),
          let out = String(data: data, encoding: .utf8)
    else { return "[]" }
    return out
  }

  private func startDoorbell() {
    guard !observing else { return }
    observing = true
    // The callback is a C function pointer and may not capture, so `self`
    // travels as the observer pointer. Unretained: `stopDoorbell` removes the
    // observer before this module can go away (`OnDestroy`).
    CFNotificationCenterAddObserver(
      CFNotificationCenterGetDarwinNotifyCenter(),
      Unmanaged.passUnretained(self).toOpaque(),
      { _, observer, _, _, _ in
        guard let observer else { return }
        let module = Unmanaged<IntentInboxModule>.fromOpaque(observer).takeUnretainedValue()
        module.sendEvent("onChange", [:])
      },
      Self.DARWIN_NAME as CFString,
      nil,
      .deliverImmediately)
  }

  private func stopDoorbell() {
    guard observing else { return }
    observing = false
    CFNotificationCenterRemoveObserver(
      CFNotificationCenterGetDarwinNotifyCenter(),
      Unmanaged.passUnretained(self).toOpaque(),
      CFNotificationName(Self.DARWIN_NAME as CFString),
      nil)
  }
}
