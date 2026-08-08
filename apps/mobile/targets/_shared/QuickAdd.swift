import Foundation
import Security

// Guarded rather than imported outright: this file is globbed into EVERY target,
// including the main app and both watch targets, and `Glance.swift` keeps itself
// to Foundation for exactly that reason. `canImport` is true wherever WidgetKit
// exists (iOS 14+, watchOS 9+) and quietly false where it does not, so a redraw
// request can never be the thing that fails a target's compile.
#if canImport(WidgetKit)
  import WidgetKit
#endif

/**
 * Quick-add, iOS side (ADR-0020): how a Siri phrase or a widget button writes to
 * Firestore from a process that has no React Native runtime and no Firebase SDK.
 *
 * ## The shape of the trick
 * The JS SDK exposes `user.refreshToken`. Google's `securetoken` endpoint
 * exchanges that for an ID token. The Firestore **REST** API accepts that ID
 * token as a bearer credential. So a write is two `URLSession` calls and no
 * native Firebase at all — which matters because this repo's one hard
 * architectural rule is a single Firebase SDK copy, and a second one in an
 * extension broke production sign-in once.
 *
 * A REST write is an ordinary write: `firestore.rules` validates it exactly as it
 * validates the SDK's, so nothing here is a privileged path. The payload below is
 * built against `isValidLog` — `calories` + `timestamp` required, macros
 * optional-when-absent, `mealLabel` ≤ 100 chars.
 *
 * ## Why this file lives in `_shared`
 * `@bacons/apple-targets` globs every file in `_shared` into **every** target,
 * including the main app. That is what makes an `AppShortcutsProvider` possible
 * without a config plugin: App Shortcuts are only discovered from the app's own
 * metadata, and this is already compiled into the app target. Everything here
 * must therefore compile against the app's iOS floor (16.4, `app.json`), which
 * App Intents clears — it is iOS 16+.
 *
 * ## What it deliberately does NOT do
 * No UI, no confirmation, no formatting of user-facing text beyond what the
 * intents need. And no recomputation of the day's totals: the widget's optimistic
 * update is `Glance`'s job and the truth arrives on the app's next `syncWidget`.
 */
public enum QuickAdd {

  // MARK: - Credential envelope

  /// Keychain service. **Must equal `SERVICE` in
  /// `modules/quick-add-credentials/ios/QuickAddCredentialsModule.swift`.**
  /// Expo Modules are CocoaPods targets and cannot be seen from an apple-target,
  /// so the two halves agree by convention; disagreeing is a silent `nil`.
  static let keychainService = "fit.ignia.app.quickAdd"
  /// Keychain account. **Must equal `ACCOUNT` in that same module.**
  static let keychainAccount = "credentials.v1"

  /// Written by JS on every auth-state change, cleared on sign-out. The API key
  /// and project id ride along rather than being hardcoded here, so `firebase.ts`
  /// stays the single source of both.
  public struct Credentials: Decodable {
    public let refreshToken: String
    public let apiKey: String
    public let projectId: String
    public let uid: String
  }

  /// `nil` means signed out, or a keychain the process cannot reach. Both resolve
  /// the same way for the caller: do not write, and say so.
  public static func credentials() -> Credentials? {
    let query: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: keychainService,
      kSecAttrAccount as String: keychainAccount,
      kSecReturnData as String: true,
      kSecMatchLimit as String: kSecMatchLimitOne,
    ]
    var item: CFTypeRef?
    guard SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess,
          let data = item as? Data
    else { return nil }
    return try? JSONDecoder().decode(Credentials.self, from: data)
  }

  // MARK: - Slots

  /**
   * The user's quick-add slots, read from the App Group blob the app writes.
   *
   * Deliberately **not** day-gated, unlike `Glance.view`: which presets are
   * quick-addable is not a property of today. A stale blob still names the right
   * presets, and a Siri phrase must keep working on a day the app has not been
   * opened — that is precisely the day it is most useful.
   */
  public static func slots() -> [Glance.QuickAddSlot] {
    guard let defaults = UserDefaults(suiteName: Glance.appGroup),
          let json = defaults.string(forKey: Glance.snapshotKey),
          let snap = try? JSONDecoder().decode(Glance.Snapshot.self, from: Data(json.utf8))
    else { return [] }
    return snap.quickAdd ?? []
  }

  // MARK: - Ledger ids

  private static let idAlphabet = Array("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789")

  /**
   * Mint a Firestore-shaped doc id, exactly as `newLedgerId` does in
   * `packages/core/src/quick-add.ts` — same alphabet, same 20 characters, so a
   * row written here is indistinguishable from one the app wrote.
   *
   * Minting it **before** the attempt is the load-bearing decision of the whole
   * design: a `PATCH` to a known id is an idempotent upsert, so a request that
   * landed and lost its ack is replayed as an overwrite of identical bytes rather
   * than becoming a second meal on the user's day.
   */
  public static func newLedgerId() -> String {
    String((0..<20).map { _ in idAlphabet[Int.random(in: 0..<idAlphabet.count)] })
  }

  // MARK: - The write

  public enum Outcome {
    /// In the ledger.
    case logged
    /// Parked in the App Group; the app lands it on next foreground.
    case queued
    /// No credential. Nothing was written and nothing was parked — a row with no
    /// uid could land on whoever signs in next, which is worse than a lost tap.
    case signedOut
  }

  /// One row to write. Mirrors `LogEntry`'s quick-add subset.
  public struct Row {
    public let calories: Int
    public let protein: Double?
    public let carbs: Double?
    public let fat: Double?
    public let mealLabel: String?
    public let at: Date

    public init(
      calories: Int, protein: Double? = nil, carbs: Double? = nil, fat: Double? = nil,
      mealLabel: String? = nil, at: Date = Date()
    ) {
      self.calories = calories
      self.protein = protein
      self.carbs = carbs
      self.fat = fat
      self.mealLabel = mealLabel
      self.at = at
    }
  }

  public static func row(from slot: Glance.QuickAddSlot, at: Date = Date()) -> Row {
    Row(
      calories: slot.calories, protein: slot.protein, carbs: slot.carbs, fat: slot.fat,
      mealLabel: slot.name, at: at)
  }

  /**
   * Write one row, parking it on any failure.
   *
   * Never throws. Every caller is an App Intent whose thrown error becomes a
   * user-facing Siri failure, and "couldn't log that" is the wrong answer when
   * the row is safely queued.
   */
  public static func log(_ row: Row) async -> Outcome {
    guard let creds = credentials() else { return .signedOut }
    let id = newLedgerId()

    do {
      let token = try await idToken(creds)
      try await patch(row: row, id: id, token: token, creds: creds)
      // The widget's numbers are the receipt, and nothing else will move them —
      // the app is not running. Optimistic and local, replaced by the truth on
      // the app's next sync.
      applyOptimistically(row)
      return .logged
    } catch {
      park(row: row, id: id, uid: creds.uid)
      applyOptimistically(row)
      return .queued
    }
  }

  /// Exchange the long-lived refresh token for a one-hour ID token. Not cached:
  /// an intent runs once and dies, and a cache would be a second place for a
  /// credential to go stale.
  private static func idToken(_ creds: Credentials) async throws -> String {
    var req = URLRequest(
      url: URL(string: "https://securetoken.googleapis.com/v1/token?key=\(creds.apiKey)")!)
    req.httpMethod = "POST"
    req.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
    req.timeoutInterval = 15
    let escaped =
      creds.refreshToken.addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? creds
      .refreshToken
    req.httpBody = Data("grant_type=refresh_token&refresh_token=\(escaped)".utf8)

    let (data, response) = try await URLSession.shared.data(for: req)
    guard let http = response as? HTTPURLResponse else { throw QuickAddError.transport }
    if http.statusCode == 400 {
      // The token was revoked — password change, account deletion, sign-out
      // elsewhere. Drop the envelope AND the queue: rows held against a dead
      // credential can never land, and holding them is worse than losing them.
      clearAllOnRevocation()
      throw QuickAddError.revoked
    }
    guard http.statusCode == 200,
          let body = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
          let token = body["id_token"] as? String
    else { throw QuickAddError.transport }
    return token
  }

  /// `PATCH`, not `POST`, and that is the idempotency: PATCH to a document path
  /// upserts, so the same id written twice is one row. `POST ?documentId=` would
  /// fail the second time with ALREADY_EXISTS — the exact error the ledger's
  /// client-minted ids were introduced to stop reporting.
  private static func patch(row: Row, id: String, token: String, creds: Credentials) async throws {
    let url = URL(
      string:
        "https://firestore.googleapis.com/v1/projects/\(creds.projectId)/databases/(default)/documents/users/\(creds.uid)/dailyLogs/\(id)"
    )!
    var req = URLRequest(url: url)
    req.httpMethod = "PATCH"
    req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
    req.setValue("application/json", forHTTPHeaderField: "Content-Type")
    req.timeoutInterval = 15
    req.httpBody = try JSONSerialization.data(withJSONObject: ["fields": fields(row)])

    let (_, response) = try await URLSession.shared.data(for: req)
    guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {
      throw QuickAddError.transport
    }
  }

  /// Firestore REST's typed-value JSON. Built against `isValidLog` in
  /// `firestore.rules`: `calories` and `timestamp` required, macros validated
  /// only when present — so an absent macro must be **omitted**, never sent as 0,
  /// which would be stored as a real zero.
  ///
  /// `integerValue` is a *string* in this wire format. Sending a bare number is
  /// the classic REST-API mistake here and produces a 400 that reads like an
  /// auth problem.
  private static func fields(_ row: Row) -> [String: Any] {
    var out: [String: Any] = [
      "calories": ["integerValue": String(row.calories)],
      "timestamp": ["timestampValue": iso8601.string(from: row.at)],
    ]
    if let p = row.protein { out["protein"] = ["doubleValue": p] }
    if let c = row.carbs { out["carbs"] = ["doubleValue": c] }
    if let f = row.fat { out["fat"] = ["doubleValue": f] }
    if let label = row.mealLabel, !label.isEmpty {
      out["mealLabel"] = ["stringValue": String(label.prefix(100))]
    }
    return out
  }

  private static let iso8601: ISO8601DateFormatter = {
    let f = ISO8601DateFormatter()
    f.formatOptions = [.withInternetDateTime]
    f.timeZone = TimeZone(identifier: "UTC")
    return f
  }()

  enum QuickAddError: Error {
    case transport
    case revoked
  }

  // MARK: - The pending queue

  /// **Must equal `PENDING_LOGS_KEY` in `packages/core/src/quick-add.ts`.** On
  /// iOS the queue lives in the App Group rather than `AsyncStorage`, because the
  /// App Group is the only store both this process and the app can see; the JS
  /// side reads the same key from the same container.
  static let pendingKey = "ignia.pendingLogs.v1"
  /// Mirrors `PENDING_LOGS_MAX`.
  static let pendingMax = 25

  /// Park a row under the id the failed attempt used, so the app's flush is a
  /// replay rather than a second write. The wire shape mirrors `PendingLog`
  /// exactly — flat, primitive-only, no nested objects and no `Date`.
  private static func park(row: Row, id: String, uid: String) {
    guard let defaults = UserDefaults(suiteName: Glance.appGroup) else { return }
    var list: [[String: Any]] = []
    if let json = defaults.string(forKey: pendingKey),
       let parsed = try? JSONSerialization.jsonObject(with: Data(json.utf8)) as? [[String: Any]] {
      list = parsed
    }

    var entry: [String: Any] = [
      "v": 1,
      "id": id,
      "uid": uid,
      "calories": row.calories,
      "atMs": (row.at.timeIntervalSince1970 * 1000).rounded(),
    ]
    if let p = row.protein { entry["protein"] = p }
    if let c = row.carbs { entry["carbs"] = c }
    if let f = row.fat { entry["fat"] = f }
    if let label = row.mealLabel, !label.isEmpty { entry["mealLabel"] = label }

    // Dedupe by id and cap, matching `mergePendingLog`.
    list.removeAll { ($0["id"] as? String) == id }
    list.append(entry)
    if list.count > pendingMax { list.removeFirst(list.count - pendingMax) }

    if let data = try? JSONSerialization.data(withJSONObject: list),
       let json = String(data: data, encoding: .utf8) {
      defaults.set(json, forKey: pendingKey)
    }
  }

  /// A revoked credential invalidates the envelope and everything parked against
  /// it. See `idToken`.
  private static func clearAllOnRevocation() {
    let query: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: keychainService,
      kSecAttrAccount as String: keychainAccount,
    ]
    SecItemDelete(query as CFDictionary)
    UserDefaults(suiteName: Glance.appGroup)?.removeObject(forKey: pendingKey)
  }

  // MARK: - The receipt

  /**
   * Fold the row into the snapshot on disk and ask WidgetKit to redraw.
   *
   * Mirrors `applyQuickAddToSnapshot`: an optimistic local edit, not a
   * recomputation — this process has one day's totals and no log list. It is
   * close, not authoritative, and the app's next `syncWidget` replaces it.
   *
   * Returns silently when there is no snapshot: a tap before the app has ever
   * written one has nothing to increment, and inventing a blob would put a
   * fabricated calorie target on the user's home screen.
   */
  private static func applyOptimistically(_ row: Row) {
    guard let defaults = UserDefaults(suiteName: Glance.appGroup),
          let json = defaults.string(forKey: Glance.snapshotKey),
          let snap = try? JSONDecoder().decode(Glance.Snapshot.self, from: Data(json.utf8))
    else { return }

    let next = Glance.Snapshot(
      v: snap.v,
      dateKey: snap.dateKey,
      kcalConsumed: max(0, snap.kcalConsumed + row.calories),
      kcalTarget: snap.kcalTarget,
      proteinConsumed: max(0, snap.proteinConsumed + Int((row.protein ?? 0).rounded())),
      proteinTarget: snap.proteinTarget,
      updatedMs: Date().timeIntervalSince1970 * 1000,
      locale: snap.locale,
      quickAdd: snap.quickAdd)

    guard let data = try? JSONEncoder().encode(next),
          let encoded = String(data: data, encoding: .utf8)
    else { return }
    defaults.set(encoded, forKey: Glance.snapshotKey)

    #if canImport(WidgetKit)
      WidgetCenter.shared.reloadTimelines(ofKind: Glance.widgetKind)
    #endif
  }
}
