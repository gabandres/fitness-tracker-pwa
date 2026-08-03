/**
 * Watch face complication target. See the sibling
 * `targets/watch/expo-target.config.js` header for the `deploymentTarget: 10.0`
 * reasoning — it is pinned on both, explicitly, so they cannot drift.
 *
 * The App Group entitlement is declared EXPLICITLY here, and that is a finding,
 * not boilerplate. `watch-widget` is flagged `appGroupsByDefault: true` in the
 * plugin's target table, so #32 predicted it would mirror `group.fit.ignia.app`
 * from `app.json` unaided — the way `targets/widget` relies on. A first prebuild
 * run with this block omitted emitted the target with **no
 * `CODE_SIGN_ENTITLEMENTS` at all** (#45), so the complication could not have
 * opened the container the watch app writes into, and the face would have sat
 * on its empty state forever with nothing to point at. Do not "simplify" it
 * back out.
 *
 * Note the App Group here is the *watch's own* container. It shares with the
 * watch app on the watch and never with the phone — which is the entire reason
 * a transport exists at all.
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
