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
 * ## Access group: deliberately none
 * The intents' `perform()` runs in the **main app's** process — App Shortcuts
 * declared in the app target are performed by launching the app in the
 * background, and so is a widget `Button(intent:)`. Same process means the app's
 * default keychain access group already reaches it, so no
 * `keychain-access-groups` entitlement and no shared group are needed. This
 * narrows ADR-0020's "shared Keychain access group" to "the app's own keychain",
 * which is strictly less surface for the same result.
 */
public class QuickAddCredentialsModule: Module {
  /// Keychain service. Must equal `QuickAdd.keychainService`.
  private static let SERVICE = "fit.ignia.app.quickAdd"
  /// Keychain account. Must equal `QuickAdd.keychainAccount`.
  private static let ACCOUNT = "credentials.v1"

  public func definition() -> ModuleDefinition {
    Name("QuickAddCredentials")

    /// Store the envelope, replacing any previous one. The value is the JSON
    /// `{refreshToken, apiKey, projectId, uid}` — assembled in JS so the API key
    /// and project id stay single-sourced in `firebase.ts` rather than being
    /// copied into Swift.
    AsyncFunction("setCredentials") { (json: String) in
      let data = Data(json.utf8)
      var query: [String: Any] = [
        kSecClass as String: kSecClassGenericPassword,
        kSecAttrService as String: Self.SERVICE,
        kSecAttrAccount as String: Self.ACCOUNT,
      ]
      // Delete-then-add rather than SecItemUpdate: an update against a missing
      // item fails, and branching on that is more code than an idempotent
      // replace.
      SecItemDelete(query as CFDictionary)

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
    AsyncFunction("clearCredentials") {
      let query: [String: Any] = [
        kSecClass as String: kSecClassGenericPassword,
        kSecAttrService as String: Self.SERVICE,
        kSecAttrAccount as String: Self.ACCOUNT,
      ]
      SecItemDelete(query as CFDictionary)
    }

    /// Whether an envelope is present. For the Settings picker, so it can say
    /// "sign in again" instead of drawing buttons that will fail.
    AsyncFunction("hasCredentials") { () -> Bool in
      let query: [String: Any] = [
        kSecClass as String: kSecClassGenericPassword,
        kSecAttrService as String: Self.SERVICE,
        kSecAttrAccount as String: Self.ACCOUNT,
        kSecReturnData as String: false,
        kSecMatchLimit as String: kSecMatchLimitOne,
      ]
      return SecItemCopyMatching(query as CFDictionary, nil) == errSecSuccess
    }
  }
}

internal final class KeychainWriteException: GenericException<OSStatus> {
  override var reason: String {
    "Could not store the quick-add credential envelope (OSStatus \(param))"
  }
}
