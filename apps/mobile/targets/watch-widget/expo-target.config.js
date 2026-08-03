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
  // NOT `.watchkitapp.complication`, and this is a measured Apple constraint,
  // not a style choice. Apple's Developer Portal **refuses any App ID whose
  // final segment is `complication`** — verified 2026-08-03 against the App
  // Store Connect API, three times, under two different parents:
  //
  //   fit.ignia.app.watchkitapp                    → OK
  //   fit.ignia.app.watchkitapp.watchkitextension  → OK
  //   fit.ignia.app.watchkitapp.face               → OK
  //   fit.ignia.app.glance                         → OK
  //   fit.ignia.app.watchkitapp.complication       → 409 "not available"
  //   fit.ignia.app.watch.complication             → 409 "not available"
  //   fit.ignia.app.complication                   → 409 "not available"
  //
  // The error is `An App ID with Identifier '…' is not available. Please enter
  // a different string.` — which reads exactly like "someone already took it"
  // and is not that: nothing under `fit.ignia.*` existed beyond the app and the
  // widget. Registering the parent first does not help either. It surfaces
  // during `eas credentials` / a build, *after* the target list is resolved.
  //
  // `watchkitextension` is Apple's own canonical suffix and registers cleanly.
  // The name is legacy-flavoured — this is a modern WidgetKit extension, not a
  // WatchKit 1 extension — but a bundle id is an identifier, not a description,
  // and the only hard requirement is that it is prefixed by the watch app's id.
  bundleIdentifier: '.watchkitapp.watchkitextension',
  deploymentTarget: '10.0',
  frameworks: ['WidgetKit', 'SwiftUI'],
  entitlements: {
    'com.apple.security.application-groups':
      config.ios.entitlements['com.apple.security.application-groups'],
  },
});
