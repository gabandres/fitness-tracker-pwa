import ExpoModulesCore
import Security

/**
 * The WRITE half of the quick-add credential envelope (ADR-0020).
 *
 * ## Why this exists at all
 * An iOS App Intent runs outside the React Native runtime, so it cannot call
 * `ledger.ts`. It writes to Firestore over REST instead, and for that it needs a
 * credential — a refresh token it can exchange for an ID token. Only JS ever has
 * that token, so JS has to hand it across a process boundary, and a plist in the
 * App Group container is the wrong place to leave a long-lived credential.
 *
 * ## Why the keychain query is hand-written rather than `expo-secure-store`
 * The read side lives in `targets/_shared/QuickAdd.swift`, which is built by
 * `@bacons/apple-targets` and **cannot see this module** — Expo Modules are
 * CocoaPods targets, not apple-targets (the same wall `modules/watch-link`
 * documents). So the two halves agree by convention on `SERVICE` and `ACCOUNT`
 * below, and the failure mode of disagreeing is a silent `nil`: every intent
 * would report "open Ignia to sign in" with nothing logged anywhere.
 *
 * Depending on `expo-secure-store` would not remove that agreement, it would
 * hide it — the Swift side would have to reproduce another package's internal
 * attribute naming, unversioned and free to change. Two constants we own beat
 * two constants we inferred.
 *
 * **If you change `SERVICE` or `ACCOUNT`, change them in `_shared/QuickAdd.swift`
 * in the same commit.**
 *
 * ## Access group: REQUIRED, and this was wrong until 2026-08-08
 *
 * This header used to claim that `perform()` always runs in the main app's
 * process — "App Shortcuts declared in the app target are performed by launching
 * the app in the background, **and so is a widget `Button(intent:)`**" — and on
 * that basis dropped ADR-0020's shared access group as unnecessary surface.
 *
 * The second half of that sentence is false. `LogQuickAddSlotIntent` lives in
 * `targets/_shared/`, so it is compiled into `Today.appex` as well as the app,
 * and WidgetKit performs the **extension's** copy in the **extension's**
 * process. Verified in build 32's `.ipa`: the appex carries its own
 * `Metadata.appintents` listing the intent, and its entitlements had
 * `application-groups` and no `keychain-access-groups`.
 *
 * So the widget button could never read this envelope. `credentials()` returned
 * `nil`, `QuickAdd.log` returned `.signedOut`, and that is the one outcome which
 * skips the optimistic snapshot bump — so the tap did **nothing at all**, on
 * every build since 27, with no error anywhere. Siri was fine throughout,
 * because App Shortcuts genuinely do launch the app.
 *
 * The envelope is now written into a shared access group that both the app and
 * the widget extension declare. `ACCESS_GROUP` must equal
 * `QuickAdd.keychainAccessGroup`, and must be listed in `keychain-access-groups`
 * on both `app.json` → `ios.entitlements` and
 * `targets/widget/expo-target.config.js`. Four things that must agree, checked
 * by `src/__tests__/quick-add-keychain-contract.test.ts`.
 */
public class QuickAddCredentialsModule: Module {
  /// Keychain service. Must equal `QuickAdd.keychainService`.
  private static let SERVICE = "fit.ignia.app.quickAdd"
  /// Keychain account. Must equal `QuickAdd.keychainAccount`.
  private static let ACCOUNT = "credentials.v1"
  /// Shared access group. Must equal `QuickAdd.keychainAccessGroup`. The team
  /// prefix is literal: `$(AppIdentifierPrefix)` is expanded by Xcode inside
  /// entitlement plists only, never in Swift.
  private static let ACCESS_GROUP = "AE6TTXW92K.fit.ignia.app.quickAdd"

  /// The base query, optionally scoped to the shared group.
  private static func query(inGroup: Bool) -> [String: Any] {
    var q: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: SERVICE,
      kSecAttrAccount as String: ACCOUNT,
    ]
    if inGroup { q[kSecAttrAccessGroup as String] = ACCESS_GROUP }
    return q
  }

  public func definition() -> ModuleDefinition {
    Name("QuickAddCredentials")

    /// Store the envelope, replacing any previous one. The value is the JSON
    /// `{refreshToken, apiKey, projectId, uid}` — assembled in JS so the API key
    /// and project id stay single-sourced in `firebase.ts` rather than being
    /// copied into Swift.
    AsyncFunction("setCredentials") { (json: String) in
      let data = Data(json.utf8)
      // Delete-then-add rather than SecItemUpdate: an update against a missing
      // item fails, and branching on that is more code than an idempotent
      // replace.
      //
      // BOTH groups are deleted. An app updating in place still holds the
      // pre-2026-08-08 envelope in the default group, and leaving it there would
      // mean two envelopes with the same service/account diverging at the next
      // token rotation — with `credentials()`'s fallback able to serve the stale
      // one to Siri.
      SecItemDelete(Self.query(inGroup: true) as CFDictionary)
      SecItemDelete(Self.query(inGroup: false) as CFDictionary)

      var query = Self.query(inGroup: true)
      query[kSecValueData as String] = data
      // `AfterFirstUnlock`, not `WhenUnlocked`: a widget button or a Siri phrase
      // can fire with the screen locked, and `WhenUnlocked` would make the
      // credential unreadable in exactly the moment the feature exists for.
      // Not `ThisDeviceOnly` — a restored backup should keep working; the token
      // is revocable server-side and the rules still scope every write.
      query[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock

      let status = SecItemAdd(query as CFDictionary, nil)
      if status != errSecSuccess {
        throw KeychainWriteException(status)
      }
    }

    /// Drop the envelope. Called on sign-out, beside the snapshot clear — a
    /// credential outliving the session is the leak that matters most here,
    /// because it is the one thing that can still write.
    /// Both groups, for the same reason `setCredentials` deletes both: a
    /// sign-out that left the pre-access-group envelope behind would leave a
    /// live write credential on the device, which is the exact leak this
    /// function exists to prevent.
    AsyncFunction("clearCredentials") {
      SecItemDelete(Self.query(inGroup: true) as CFDictionary)
      SecItemDelete(Self.query(inGroup: false) as CFDictionary)
    }

    /// Whether an envelope is present, in either group — mirroring
    /// `QuickAdd.credentials()`, so this can never report "present" for
    /// something the intents cannot read, or vice versa.
    ///
    /// Written for the Settings picker, to say "sign in again" instead of
    /// drawing buttons that will fail. **Nothing called it until 2026-08-08**,
    /// which is part of why a keychain the widget could not reach stayed
    /// invisible for five builds.
    AsyncFunction("hasCredentials") { () -> Bool in
      for inGroup in [true, false] {
        var q = Self.query(inGroup: inGroup)
        q[kSecReturnData as String] = false
        q[kSecMatchLimit as String] = kSecMatchLimitOne
        if SecItemCopyMatching(q as CFDictionary, nil) == errSecSuccess { return true }
      }
      return false
    }
  }
}

internal final class KeychainWriteException: GenericException<OSStatus> {
  override var reason: String {
    "Could not store the quick-add credential envelope (OSStatus \(param))"
  }
}
