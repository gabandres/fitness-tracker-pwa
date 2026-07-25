/**
 * STUB — watch face complication target, existence probe only. See the sibling
 * `targets/watch/expo-target.config.js` header for why these exist.
 *
 * The App Group entitlement is declared EXPLICITLY here, and that is the finding.
 * `watch-widget` is flagged `appGroupsByDefault: true` in the plugin's target
 * table, so #32 predicted it would mirror `group.fit.ignia.app` from `app.json`
 * unaided — the way `targets/widget` relies on. A first prebuild run with this
 * block omitted emitted the target with **no `CODE_SIGN_ENTITLEMENTS` at all**,
 * so the complication could not have opened the watch app's shared container.
 * Declaring it is the workaround; do not "simplify" it back out.
 *
 * @type {import('@bacons/apple-targets/app.plugin').ConfigFunction}
 */
module.exports = (config) => ({
  type: 'watch-widget',
  name: 'IgniaWatchComplication',
  bundleIdentifier: '.watchkitapp.complication',
  deploymentTarget: '10.0',
  frameworks: ['WidgetKit', 'SwiftUI'],
  entitlements: {
    'com.apple.security.application-groups':
      config.ios.entitlements['com.apple.security.application-groups'],
  },
});
