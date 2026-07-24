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
  },
});
