import AppIntents
import Foundation

/**
 * Siri phrases and widget-button actions for quick-add (ADR-0020).
 *
 * ## Why this compiles into the main app
 * App Shortcuts — the phrases Siri knows without the user creating a shortcut —
 * are discovered only from the **app's** App Intents metadata. Extensions get
 * their own, and Siri does not read those. `@bacons/apple-targets` globs every
 * file in `_shared` into every target including the main app, so this file lands
 * in the app binary with no config plugin and no `withXcodeProject` surgery.
 * That is the single fact that made the iOS half cheap.
 *
 * Everything here therefore compiles against the app's floor of 16.4 (`app.json`),
 * which App Intents clears — it is iOS 16+. The widget's `Button(intent:)` is
 * iOS 17+, but that lives in the widget target, which is pinned to 17.0.
 *
 * ## Where `perform()` runs
 * In the **app's** process, launched in the background — for both a Siri phrase
 * and a widget button. That is why `QuickAdd` can read the app's own keychain
 * with no access group, and why none of this needs an entitlement change.
 *
 * ## No confirmation, by design
 * `requestConfirmation()` is deliberately not called. The feature exists to make
 * logging a ~2s act; a confirmation step is a second interaction and would undo
 * the only reason to build it. The **dialog is the receipt** instead, and it
 * states what happened — including when a write was queued rather than landed,
 * because "logged" would then be a lie.
 */

// MARK: - The preset entity

/// One of the user's quick-add slots, as something Siri can name and disambiguate.
///
/// Backed by the App Group snapshot, not Firestore: this resolves inside an intent
/// with no auth and no network, and it must keep working on a day the app has not
/// been opened.
@available(iOS 16.0, *)
struct QuickAddPresetEntity: AppEntity, Identifiable {
  let id: String
  let name: String

  static var typeDisplayRepresentation: TypeDisplayRepresentation {
    TypeDisplayRepresentation(name: "Preset")
  }

  var displayRepresentation: DisplayRepresentation {
    DisplayRepresentation(title: "\(name)")
  }

  static var defaultQuery = QuickAddPresetQuery()
}

@available(iOS 16.0, *)
struct QuickAddPresetQuery: EntityQuery {
  func entities(for identifiers: [String]) async throws -> [QuickAddPresetEntity] {
    QuickAdd.slots()
      .filter { identifiers.contains($0.presetId) }
      .map { QuickAddPresetEntity(id: $0.presetId, name: $0.name) }
  }

  /// What Siri offers when it asks "which one?", and what the Shortcuts app lists.
  func suggestedEntities() async throws -> [QuickAddPresetEntity] {
    QuickAdd.slots().map { QuickAddPresetEntity(id: $0.presetId, name: $0.name) }
  }
}

// MARK: - Log a named preset

/// "Hey Siri, log my protein shake."
@available(iOS 16.0, *)
struct LogPresetIntent: AppIntent {
  static var title: LocalizedStringResource = "Log a preset"
  static var description = IntentDescription("Logs one of your quick-add presets to today.")

  /// The whole point of the feature: no app, no UI, no foreground.
  static var openAppWhenRun: Bool = false

  @Parameter(title: "Preset")
  var preset: QuickAddPresetEntity

  static var parameterSummary: some ParameterSummary {
    Summary("Log \(\.$preset)")
  }

  @MainActor
  func perform() async throws -> some IntentResult & ProvidesDialog {
    // Re-resolved from the snapshot rather than trusted from the entity: the
    // entity carries only an id and a name, and the macros may have changed since
    // Siri cached the suggestion.
    guard let slot = QuickAdd.slots().first(where: { $0.presetId == preset.id }) else {
      return .result(dialog: "That preset isn't set up for quick add any more.")
    }

    switch await QuickAdd.log(QuickAdd.row(from: slot)) {
    case .logged:
      return .result(dialog: "Logged \(slot.name).")
    case .queued:
      // Never "logged" for a queued write — the row is real but it is not in the
      // ledger yet, and saying otherwise is the one lie this design must not tell.
      return .result(dialog: "Saved \(slot.name). It'll sync next time you open Ignia.")
    case .signedOut:
      return .result(dialog: "Open Ignia and sign in first.")
    }
  }
}

// MARK: - Log loose macros

/**
 * "Hey Siri, log 300 calories and 40 grams of protein."
 *
 * `calories` is **required**, and that is a correction to what the backlog
 * promised. `LogEntry.calories` is non-optional in the domain, so a protein-only
 * phrase has no legal value to write: 0 would corrupt the day's headline number
 * and 4 kcal/g would be a fabrication. App Intents prompts for a missing required
 * parameter, so the shorter phrase still works — it just asks one question first,
 * which is honest rather than silently inventing a number.
 */
@available(iOS 16.0, *)
struct LogMacrosIntent: AppIntent {
  static var title: LocalizedStringResource = "Log calories"
  static var description = IntentDescription("Logs calories, and optionally protein, to today.")
  static var openAppWhenRun: Bool = false

  @Parameter(title: "Calories", inclusiveRange: (0, 19999))
  var calories: Int

  @Parameter(title: "Protein (g)", inclusiveRange: (0, 999))
  var protein: Int?

  static var parameterSummary: some ParameterSummary {
    Summary("Log \(\.$calories) calories") {
      \.$protein
    }
  }

  @MainActor
  func perform() async throws -> some IntentResult & ProvidesDialog {
    let row = QuickAdd.Row(
      calories: calories,
      protein: protein.map(Double.init),
      // Labelled so the row is identifiable in History as something Siri wrote,
      // rather than appearing as an unnamed entry the user cannot place.
      mealLabel: "Quick add")

    switch await QuickAdd.log(row) {
    case .logged:
      return .result(dialog: "Logged \(calories) calories.")
    case .queued:
      return .result(dialog: "Saved it. It'll sync next time you open Ignia.")
    case .signedOut:
      return .result(dialog: "Open Ignia and sign in first.")
    }
  }
}

// MARK: - The widget button's intent

/**
 * What an interactive widget button runs (iOS 17+).
 *
 * Separate from `LogPresetIntent` because it takes a **slot index**, not an
 * entity: a widget button is bound at render time to a position on the face, and
 * the face is drawn from the same snapshot array. Reusing the entity intent would
 * mean the widget resolving an `AppEntity` just to hand back something it already
 * had.
 *
 * Not surfaced to Siri — it is absent from `AppShortcutsProvider` below, and
 * `isDiscoverable` keeps it out of the Shortcuts app, where "Log quick-add slot 2"
 * is meaningless to a human.
 */
@available(iOS 17.0, *)
struct LogQuickAddSlotIntent: AppIntent {
  static var title: LocalizedStringResource = "Log a quick-add slot"
  static var isDiscoverable: Bool = false
  static var openAppWhenRun: Bool = false

  @Parameter(title: "Slot")
  var slot: Int

  init() {}

  init(slot: Int) {
    self.slot = slot
  }

  @MainActor
  func perform() async throws -> some IntentResult {
    let slots = QuickAdd.slots()
    // A slot whose preset vanished between the last snapshot write and the tap.
    // The redraw that follows drops the button, so it stops being tappable.
    guard slot >= 0, slot < slots.count else { return .result() }
    _ = await QuickAdd.log(QuickAdd.row(from: slots[slot]))
    return .result()
  }
}

// MARK: - The phrases

/**
 * The phrases Siri knows without the user building anything.
 *
 * `.applicationName` is required in every phrase — Apple rejects a provider whose
 * phrases omit it, and it is also what stops "log my shake" from colliding with
 * every other tracker on the device.
 *
 * Only the two user-meaningful intents appear here. `LogQuickAddSlotIntent` is
 * for the widget and would read as gibberish spoken aloud.
 */
@available(iOS 16.0, *)
struct IgniaShortcuts: AppShortcutsProvider {
  static var appShortcuts: [AppShortcut] {
    AppShortcut(
      intent: LogPresetIntent(),
      phrases: [
        "Log a preset in \(.applicationName)",
        "Log my preset in \(.applicationName)",
        "Quick add in \(.applicationName)",
      ],
      shortTitle: "Log a preset",
      systemImageName: "plus.circle.fill")

    AppShortcut(
      intent: LogMacrosIntent(),
      phrases: [
        "Log calories in \(.applicationName)",
        "Add calories to \(.applicationName)",
      ],
      shortTitle: "Log calories",
      systemImageName: "flame.fill")
  }
}
