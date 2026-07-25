/**
 * STUB — watchOS app target, existence probe only.
 *
 * This carries no Swift. It exists so `npx expo prebuild -p ios` can be asked
 * the one question #45 opens: does `@bacons/apple-targets@5.0.0` actually emit
 * the targets, embed phases and entitlements that #32 read that it does?
 *
 * `deploymentTarget` is the `10.0` pin from #37 — NOT the plugin's 9.4 default,
 * which sits below the Smart Stack line and forces `#available` branches around
 * `containerBackground`.
 *
 * The bundle id is a leading-dot override, so it is appended to the main app's
 * id (`fit.ignia.app.watchkitapp`). Apple requires a companion watch app's id to
 * be the phone app's id plus a dot; the plugin's own default derivation would
 * also satisfy that, but naming it here keeps it off the sanitizer.
 *
 * @type {import('@bacons/apple-targets/app.plugin').ConfigFunction}
 */
module.exports = (config) => ({
  type: 'watch',
  name: 'IgniaWatch',
  bundleIdentifier: '.watchkitapp',
  deploymentTarget: '10.0',
  frameworks: ['SwiftUI', 'WatchConnectivity'],
  entitlements: {
    'com.apple.security.application-groups':
      config.ios.entitlements['com.apple.security.application-groups'],
  },
});
