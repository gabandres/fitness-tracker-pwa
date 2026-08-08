/**
 * iOS WidgetKit extension target, generated into the Xcode project by
 * `@bacons/apple-targets` during prebuild. Nothing here is checked into
 * `ios/` — that directory stays generated (the app is managed/CNG).
 *
 * The App Group is read from the main app's entitlements rather than written
 * out again, so `app.json` stays the single source of truth for the id. It has
 * to match `APP_GROUP` in `src/lib/widget.ts`; if the two drift, the app writes
 * a blob into a container the widget cannot see and the widget just shows its
 * empty state forever — a silent failure, hence the shared source.
 *
 * @type {import('@bacons/apple-targets/app.plugin').ConfigFunction}
 */
module.exports = (config) => ({
  type: 'widget',
  name: 'Today',
  // WidgetKit's `containerBackground` (required for widgets since iOS 17)
  // and the Swift used here need a modern floor. The app itself targets
  // lower; only this extension is pinned up.
  deploymentTarget: '17.0',
  frameworks: ['WidgetKit', 'SwiftUI'],
  entitlements: {
    'com.apple.security.application-groups':
      config.ios.entitlements['com.apple.security.application-groups'],
    // The quick-add credential envelope (ADR-0020, amended 2026-08-08).
    //
    // This target NEEDS it, which was the bug. `LogQuickAddSlotIntent` lives in
    // `targets/_shared/` and is therefore compiled into this extension as well
    // as the app, and WidgetKit performs THIS copy, in THIS process — verified
    // in build 32's `.ipa`, where `Today.appex` carries its own
    // `Metadata.appintents` listing the intent. Without a shared access group
    // the extension cannot read the app's keychain, so every widget quick-add
    // tap silently did nothing from build 27 to build 32.
    //
    // Read from the app's entitlements for the same reason the App Group is:
    // `app.json` stays the single source, and a drifted value is a silent nil,
    // not an error.
    'keychain-access-groups': config.ios.entitlements['keychain-access-groups'],
  },
});
