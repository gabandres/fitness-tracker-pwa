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
#if canImport(WatchConnectivity) && os(iOS)
  import WatchConnectivity
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

  /// Shared Keychain access group. **Must equal `ACCESS_GROUP` in that same
  /// module**, and must be listed in `keychain-access-groups` on BOTH the app
  /// (`app.json` → `ios.entitlements`) and the widget extension
  /// (`targets/widget/expo-target.config.js`).
  ///
  /// ## Why this exists — the bug it fixes
  ///
  /// ADR-0020 specified a shared access group and the implementation narrowed it
  /// to "the app's own keychain", on the stated premise that *"App Shortcuts
  /// declared in the app target are performed by launching the app in the
  /// background, and so is a widget `Button(intent:)`."* **The second half of
  /// that sentence is false.**
  ///
  /// `LogQuickAddSlotIntent` lives in `_shared`, so it is compiled into the
  /// widget extension as well as the app, and WidgetKit performs the
  /// extension's copy **in the extension's process**. Verified in build 32's
  /// `.ipa`: `Today.appex` carries its own `Metadata.appintents` listing the
  /// intent, and its entitlements contain `application-groups` and no
  /// `keychain-access-groups` at all.
  ///
  /// A process cannot reach another's default keychain group, so
  /// `SecItemCopyMatching` returned `errSecItemNotFound`, `credentials()`
  /// returned `nil`, and `log` returned `.signedOut` — the one outcome that
  /// skips the optimistic snapshot bump. The result: **tapping the widget
  /// button did nothing at all, on every build since 27** — no row, no error,
  /// no moved number, and nothing in Sentry, because a Swift extension has no
  /// Sentry in it.
  ///
  /// Siri was unaffected and provably worked, which is what made this look like
  /// a session problem rather than a process one: App Shortcuts really do launch
  /// the app, so `LogPresetIntent` really does run where the credential is.
  ///
  /// The team prefix is written out rather than `$(AppIdentifierPrefix)`, which
  /// Xcode expands only inside entitlement plists, never in Swift.
  static let keychainAccessGroup = "AE6TTXW92K.fit.ignia.app.quickAdd"

  /// Written by JS on every auth-state change, cleared on sign-out. The API key
  /// and project id ride along rather than being hardcoded here, so `firebase.ts`
  /// stays the single source of both.
  public struct Credentials: Decodable, Sendable {
    public let refreshToken: String
    public let apiKey: String
    public let projectId: String
    public let uid: String
  }

  /// `nil` means signed out, or a keychain the process cannot reach. Both resolve
  /// the same way for the caller: do not write, and say so.
  ///
  /// Queried in the shared access group first, then without one. The fallback is
  /// not defensive padding — it is the **upgrade path**. Every envelope written
  /// before the access group existed lives in the app's default group, and an
  /// app updating in place keeps it until JS next writes. Without the second
  /// query, Siri would break for exactly as long as it took the user to reopen
  /// the app, which would be trading one silent failure for another.
  public static func credentials() -> Credentials? {
    if let creds = credentials(inAccessGroup: keychainAccessGroup) { return creds }
    return credentials(inAccessGroup: nil)
  }

  private static func credentials(inAccessGroup group: String?) -> Credentials? {
    var query: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: keychainService,
      kSecAttrAccount as String: keychainAccount,
      kSecReturnData as String: true,
      kSecMatchLimit as String: kSecMatchLimitOne,
    ]
    if let group { query[kSecAttrAccessGroup as String] = group }
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
  public struct Row: Sendable {
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

  /// Everything a staged row needs to be committed later.
  public struct Staged: Sendable {
    let id: String
    let creds: Credentials
    /// The bumped snapshot JSON, for the watch push. `nil` when there was no
    /// snapshot on disk to bump.
    let encoded: String?
  }

  /**
   * The LOCAL half of a quick-add: move the numbers, and make the row durable.
   *
   * Synchronous, and touches nothing that can block — no network, no
   * `WCSession`, no waiting. Two App Group writes and a `reloadTimelines`.
   *
   * ## Why this is split out, and why the ordering is the whole point
   *
   * Until 2026-08-14 the snapshot bump ran **after** both network round trips,
   * inside a function called `applyOptimistically` and documented as "an
   * optimistic local edit". It was not optimistic; it was applied post-hoc. So
   * the widget's numbers could not move until a token exchange and a Firestore
   * `PATCH` had both come back — and, after build 50, until `assertToWatch` had
   * finished waiting up to 3 seconds for `WCSession` to activate. **That last
   * one was a regression this file introduced**, and on a cold launch it was
   * probably the largest single term in the delay the owner reported.
   *
   * It matters more than "the numbers appear sooner", because of how WidgetKit
   * actually reloads an interactive widget: a `reloadTimelines` call made from
   * inside `perform()` is **deferred** and documented by developers as
   * sometimes taking minutes (FB11522170), while the reload the system performs
   * when `perform()` **returns** is the reliable one. So the widget could not
   * redraw until `perform()` returned, and `perform()` was waiting on the
   * network. Returning fast is the mechanism; this function is what makes
   * returning fast safe.
   *
   * ## The park is a write-ahead log, not a failure path
   *
   * Parking BEFORE the attempt — rather than in the `catch` — is what lets the
   * widget path return without awaiting the write at all. If the process is
   * suspended mid-`PATCH` the row is already on disk and `flushPendingLogs`
   * replays it on the app's next foreground. Replay is an idempotent overwrite
   * because the id is minted here and reused, which is exactly what
   * `newLedgerId` was built for.
   *
   * Returns `nil` for a signed-out caller: nothing is written and nothing is
   * parked, because a row with no uid could land on whoever signs in next.
   */
  static func stage(_ row: Row) -> Staged? {
    guard let creds = credentials() else {
      record(outcome: "signedOut")
      return nil
    }
    let id = newLedgerId()
    let encoded = applyLocally(row)
    park(row: row, id: id, uid: creds.uid)
    return Staged(id: id, creds: creds, encoded: encoded)
  }

  /**
   * The REMOTE half: land the row, drop the parked copy, push to the watch.
   *
   * Safe to run after `perform()` has returned. Nothing here is required for
   * the user to see the right numbers — that already happened in `stage` — and
   * nothing here can lose the row, because the parked copy is only removed
   * once the write is confirmed.
   */
  static func commit(_ staged: Staged, row: Row) async -> Outcome {
    var outcome: Outcome
    do {
      let token = try await idToken(staged.creds)
      try await patch(row: row, id: staged.id, token: token, creds: staged.creds)
      unpark(id: staged.id)
      outcome = .logged
    } catch {
      // The row stays parked. `flushPendingLogs` replays it, as the same id, so
      // a request that landed and lost its ack becomes an overwrite of
      // identical bytes rather than a second meal.
      outcome = .queued
    }
    record(outcome: outcome == .logged ? "logged" : "queued")

    // Last, deliberately. The wrist is a seconds-to-minutes surface by
    // construction and this can wait up to 3s for session activation; putting
    // it ahead of anything here would spend that budget where it is visible.
    if let encoded = staged.encoded { await assertToWatch(encoded) }
    return outcome
  }

  /**
   * Write one row and wait for the answer.
   *
   * For the **spoken** intents, which must tell the truth in their dialog:
   * "Logged X" and "Saved it, it'll sync" are different sentences and the
   * difference is only knowable once the write has been attempted. A widget
   * button has no dialog and should not pay for one — see `logDeferred`.
   *
   * Never throws. Every caller is an App Intent whose thrown error becomes a
   * user-facing Siri failure, and "couldn't log that" is the wrong answer when
   * the row is safely queued.
   */
  public static func log(_ row: Row) async -> Outcome {
    guard let staged = stage(row) else { return .signedOut }
    return await commit(staged, row: row)
  }

  /**
   * Move the numbers now; land the row in the background.
   *
   * For the **widget button**, whose entire receipt is the face redrawing. It
   * returns as soon as the snapshot is bumped and the row is durable, so
   * `perform()` returns in milliseconds and the reload WidgetKit performs on
   * return finds the new numbers already on disk.
   *
   * The commit is an unawaited `Task` on purpose, and it is safe because of the
   * write-ahead park, not because the task is guaranteed to finish. If iOS
   * suspends this process first, the row is on disk and the app lands it on
   * next foreground. The failure mode is *later*, never *lost*.
   *
   * A background-task assertion would make the task likelier to complete and is
   * deliberately NOT used: `UIApplication.shared` is unavailable in app
   * extensions, this file compiles into `Today.appex`, and reaching it through
   * `NSClassFromString` + KVC is a pattern App Review has flagged. The park
   * already gives the guarantee the assertion would only make faster.
   */
  public static func logDeferred(_ row: Row) -> Outcome {
    guard let staged = stage(row) else { return .signedOut }
    Task { _ = await commit(staged, row: row) }
    // Honest as far as it goes: the row is durable and the numbers have moved.
    // Whether it reached the ledger is not yet knowable, and no caller of this
    // says anything to the user about it.
    return .queued
  }

  /**
   * Leave a note in the App Group saying what the last quick-add did.
   *
   * A widget button has no way to answer back — see `Glance.quickAddOutcomeKey`
   * for what that cost. This is the note the app reads on next foreground so a
   * silently-refused tap becomes something a user can see and report.
   *
   * Best-effort and never throws: a tap that logged must not be reported as a
   * failure because a diagnostic write failed. Overwrites, deliberately — the
   * question is "did the last one work", not "how many were there".
   *
   * `source` is free-form; today only the widget/tile path writes it.
   */
  public static func record(outcome: String, at: Date = Date()) {
    guard let defaults = UserDefaults(suiteName: Glance.appGroup) else { return }
    let payload = ["outcome": outcome, "atMs": String(Int(at.timeIntervalSince1970 * 1000))]
    guard let data = try? JSONSerialization.data(withJSONObject: payload),
          let json = String(data: data, encoding: .utf8)
    else { return }
    defaults.set(json, forKey: Glance.quickAddOutcomeKey)
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

  /**
   * Drop a parked row once its write is confirmed.
   *
   * The other half of the write-ahead park in `stage`. Parking first is what
   * makes it safe for the widget path to return before the network finishes;
   * this is what stops the parked copy from being replayed afterwards.
   *
   * A replay would not corrupt anything — `flushPendingLogs` re-`PATCH`es the
   * same id, which overwrites identical bytes — so a missed unpark costs one
   * redundant request, not a duplicate meal. That is the whole reason the id is
   * minted before the attempt.
   */
  private static func unpark(id: String) {
    guard let defaults = UserDefaults(suiteName: Glance.appGroup),
          let json = defaults.string(forKey: pendingKey),
          var list = try? JSONSerialization.jsonObject(with: Data(json.utf8)) as? [[String: Any]]
    else { return }
    list.removeAll { ($0["id"] as? String) == id }
    if let data = try? JSONSerialization.data(withJSONObject: list),
       let out = String(data: data, encoding: .utf8) {
      defaults.set(out, forKey: pendingKey)
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
  @discardableResult
  private static func applyLocally(_ row: Row) -> String? {
    guard let defaults = UserDefaults(suiteName: Glance.appGroup),
          let json = defaults.string(forKey: Glance.snapshotKey),
          let snap = try? JSONDecoder().decode(Glance.Snapshot.self, from: Data(json.utf8))
    else { return nil }

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
    else { return nil }
    defaults.set(encoded, forKey: Glance.snapshotKey)

    // Requested here as well as relied on at return. This call is the
    // DEFERRED one — a reload asked for from inside `perform()` is documented
    // to land late, sometimes minutes late (FB11522170) — while the reload the
    // system performs when `perform()` returns is the reliable one. It is kept
    // because it costs nothing, sometimes wins, and is the only reload at all
    // on the paths that are not a widget button (Siri, the Quick Settings tile).
    #if canImport(WidgetKit)
      WidgetCenter.shared.reloadTimelines(ofKind: Glance.widgetKind)
    #endif

    return encoded
  }

  /**
   * Push the freshly-bumped snapshot to the Apple Watch — from any process, and
   * without ever dropping it on the floor.
   *
   * ## The rule this replaces, and why it was wrong
   *
   * Until 2026-08-14 this bailed on `activationState != .activated` and that
   * was the bug: **it conflated "cannot" with "not yet".**
   *
   * `WCSession` genuinely does not exist in an app extension — Apple's
   * limitation, documented, not negotiable — so a widget-button tap performed
   * inside `Today.appex` really cannot reach the wrist from its own process.
   * That is a *cannot*.
   *
   * But `WatchLinkModule` activates `WCSession.default` **asynchronously** at
   * app launch, and activation completes on a delegate callback a moment later.
   * An intent performed on a cold or background launch runs inside that window.
   * That is a *not yet*, and it is by far the more common case: it is every
   * Siri phrase spoken while the app is closed, which is precisely what Siri
   * quick-add is for. The old guard returned silently, skipping the complication
   * transfer **and** the application context, so nothing at all reached the
   * watch and the numbers only caught up on the app's next foreground.
   *
   * ## What it does now — park, wait, send, clear
   *
   * 1. **Park first.** The envelope goes into the App Group under
   *    `Glance.watchPendingKey` before anything is attempted, so a session that
   *    activates at any point during the wait finds it — `WatchLinkModule`
   *    drains that key on `activationDidCompleteWith`. Parking first rather than
   *    on failure closes the race between "we gave up" and "it activated".
   * 2. **Wait, bounded.** Up to `activationBudget` for the state to flip. No
   *    cost at all in the warm case, where it is already `.activated`.
   * 3. **Send** over both queues, exactly as `WatchLinkModule.assert` does.
   * 4. **Clear** the park, because it landed.
   *
   * A duplicate delivery is harmless by construction: the payload is
   * latest-wins and `WatchLinkModule` dedupes against the live application
   * context, so the park draining after a successful send is a no-op, not a
   * second meal.
   *
   * ## It still never activates, and still never sets a delegate
   *
   * `WatchLinkModule` owns `WCSession.default` in the app process. A second
   * delegate here would silently displace it and break the re-assert that keeps
   * a newly-paired watch in step, so this only ever *waits* for the owner to
   * finish — it never calls `activate()` and never assigns `delegate`. That is
   * also why the wait gives up early when there is no delegate at all: nobody
   * is going to activate the session, so waiting the full budget would just
   * stall the intent's spoken reply for nothing.
   */
  private static func assertToWatch(_ json: String) async {
    #if canImport(WatchConnectivity) && os(iOS)
      let envelope: [String: Any] = [Glance.contextKey: json]

      // A widget-button tap performed in the extension. `WCSession` does not
      // exist here at all — park it and let the app deliver it the moment it
      // next activates a session. `LogQuickAddSlotIntent` now conforms to
      // `LiveActivityIntent` specifically so this branch stops being the normal
      // path (see `QuickAddIntents.swift`); it remains because a fallback that
      // silently loses the push is what the last three builds shipped.
      guard Bundle.main.bundleURL.pathExtension != "appex" else {
        parkForWatch(envelope)
        record(watchAssert: "parked:appex")
        return
      }

      // iPad and anything else with no WatchConnectivity. Nothing to park for —
      // no process on this device will ever drain it.
      guard WCSession.isSupported() else {
        record(watchAssert: "skipped:unsupported")
        return
      }

      let session = WCSession.default
      let wasActivated = session.activationState == .activated

      // (1) Park before waiting, so an activation that lands mid-wait still
      //     finds the envelope.
      if !wasActivated { parkForWatch(envelope) }

      // (2) Wait for the owner to finish activating.
      if !wasActivated, !(await waitForActivation(session)) {
        record(watchAssert: "parked:not-activated")
        return
      }

      // (3) The waking queue first, budget permitting — same pair, same order
      //     and same reasoning as `WatchLinkModule.assert`.
      if session.isComplicationEnabled, session.remainingComplicationUserInfoTransfers > 0 {
        _ = session.transferCurrentComplicationUserInfo(envelope)
      }
      try? session.updateApplicationContext(envelope)

      // (4) It landed; the park would only be a stale duplicate now.
      if !wasActivated { clearWatchPark() }
      record(watchAssert: wasActivated ? "sent" : "sent:after-wait")
    #else
      _ = json
    #endif
  }

  #if canImport(WatchConnectivity) && os(iOS)
    /// How long an intent will hold its reply waiting for `WCSession` to finish
    /// activating.
    ///
    /// Generous against the measurement it is bounding — activation normally
    /// completes in well under a second — and small against the budget it is
    /// spending, which is a Siri intent's several seconds before the reply
    /// looks slow. Only a cold launch ever pays any of it.
    private static let activationBudget: TimeInterval = 3.0

    /// Poll `activationState` until it flips, the budget runs out, or it becomes
    /// clear nobody is going to activate it.
    ///
    /// Polling rather than a delegate callback is not a shortcut, it is the
    /// constraint: this file may not take the delegate slot (see above), and a
    /// 50ms poll on an already-launching process is cheaper than the session
    /// handshake it is waiting for.
    private static func waitForActivation(_ session: WCSession) async -> Bool {
      let step = UInt64(50_000_000)  // 50ms
      let deadline = Date().addingTimeInterval(activationBudget)
      // If `WatchLinkModule` has not even claimed the delegate after this long,
      // React Native is not starting in this process and the wait is pointless.
      let delegateGrace = Date().addingTimeInterval(0.5)

      while Date() < deadline {
        if session.activationState == .activated { return true }
        if session.delegate == nil, Date() > delegateGrace { return false }
        try? await Task.sleep(nanoseconds: step)
      }
      return session.activationState == .activated
    }

    /// Leave the envelope where an activated session will find it. Overwrites:
    /// latest-wins, exactly like the application context it mirrors.
    private static func parkForWatch(_ envelope: [String: Any]) {
      guard let defaults = UserDefaults(suiteName: Glance.appGroup),
            let data = try? JSONSerialization.data(withJSONObject: envelope),
            let json = String(data: data, encoding: .utf8)
      else { return }
      defaults.set(json, forKey: Glance.watchPendingKey)
    }

    private static func clearWatchPark() {
      UserDefaults(suiteName: Glance.appGroup)?.removeObject(forKey: Glance.watchPendingKey)
    }
  #endif

  /**
   * Name which guard the last watch push hit.
   *
   * The sibling of `record(outcome:)` one device further out, and it exists for
   * the same reason: from the wrist, "skipped in the extension", "skipped
   * because the session had not activated yet" and "sent and lost in transit"
   * are one symptom — a number that did not move. Two speculative fixes were
   * shipped to this surface on 2026-08-13 with no way to tell which guard was
   * firing. `WatchDiagnosticsCard` surfaces this.
   *
   * The process is recorded alongside because the single most consequential
   * fact about a quick-add is *where it ran*, and that is not otherwise
   * knowable from the app: an extension has no Sentry, no log destination and
   * no way to answer back.
   */
  static func record(watchAssert outcome: String, at: Date = Date()) {
    guard let defaults = UserDefaults(suiteName: Glance.appGroup) else { return }
    let payload: [String: String] = [
      "outcome": outcome,
      "atMs": String(Int(at.timeIntervalSince1970 * 1000)),
      "process": Bundle.main.bundleURL.pathExtension == "appex" ? "appex" : "app",
    ]
    guard let data = try? JSONSerialization.data(withJSONObject: payload),
          let json = String(data: data, encoding: .utf8)
    else { return }
    defaults.set(json, forKey: Glance.watchAssertKey)
  }
}
