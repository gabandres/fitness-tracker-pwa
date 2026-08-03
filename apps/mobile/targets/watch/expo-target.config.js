/**
 * watchOS app target, generated into the Xcode project by
 * `@bacons/apple-targets` during prebuild. Nothing here is checked into
 * `ios/` — that directory stays generated (the app is managed/CNG). Ejecting a
 * live App Store app was never on the table (#32).
 *
 * This target is **link 2 of the transport**, not decoration: WatchConnectivity
 * delivers to the watch app, never to a complication directly, so it owns the
 * `WCSession` delegate, the background task, the App Group write and the
 * `reloadTimelines` (#37, #39).
 *
 * `deploymentTarget` is the `10.0` pin from #37 — NOT the plugin's 9.4 default,
 * and pinned explicitly on BOTH watch targets so the two can never drift and
 * neither silently inherits a default that moves on a dependency bump.
 * 9.4 looks free and is not: it forces `if #available(watchOS 10, *)` branches
 * and sits below the line where the **Smart Stack** exists, which is where an
 * Apple Watch widget is actually discovered today. 11.0 was declined — it buys
 * Smart Stack *ranking* at the cost of Series 4/5/SE-1, and presence is what a
 * first watch surface needs.
 *
 * The bundle id is a leading-dot override, so it is appended to the main app's
 * id (`fit.ignia.app.watchkitapp`). Apple requires a companion watch app's id
 * to be the phone app's id plus a dot.
 *
 * @type {import('@bacons/apple-targets/app.plugin').ConfigFunction}
 */
module.exports = (config) => ({
  type: 'watch',
  name: 'IgniaWatch',
  bundleIdentifier: '.watchkitapp',
  deploymentTarget: '10.0',
  // WidgetKit is here for `WidgetCenter.shared.reloadAllTimelines()` — the
  // watch app is what asks the complication to redraw after a delivery.
  frameworks: ['SwiftUI', 'WatchConnectivity', 'WidgetKit'],
  entitlements: {
    'com.apple.security.application-groups':
      config.ios.entitlements['com.apple.security.application-groups'],
  },
});
