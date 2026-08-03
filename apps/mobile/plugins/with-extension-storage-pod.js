const { withPodfile } = require('expo/config-plugins');
const path = require('path');

/**
 * Force-links `@bacons/apple-targets`' ExtensionStorage pod into the app target.
 *
 * Why this exists: on EAS the pod is silently absent. Verified against the build
 * logs for `de8fabd0` and `f897f42f` — `ExtensionStorage` appears ZERO times in
 * the whole INSTALL_PODS phase while all ~34 other Expo module pods install. The
 * consequence is not a build failure: `@bacons/apple-targets` swaps in silent JS
 * stubs when its native module is missing, so `set()` and `reloadWidget()` become
 * no-ops and the widget can never update. Two builds were spent before the
 * `__DEV__` probe in `src/lib/widget.ts` named it.
 *
 * Ruled out first, so nobody re-checks them: the package ships a valid podspec
 * and Swift module (`Name("ExtensionStorage")`, matching the probe's lookup);
 * `ios.appleTeamId` and the App Group entitlement are both set; there is no
 * `pods.rb` excluding modules; SDK 54's autolinking still honours the package's
 * legacy `"ios"` config key (`rawConfig.apple ?? rawConfig.ios`); the pod cache
 * was empty; expo 54.0.35 and 54.0.36 both fail; 5.0.0 is the latest release.
 * `expo-modules-autolinking resolve -p apple` on Windows DOES resolve it, so the
 * fault is specific to how the package is reached on the build worker.
 *
 * The pod path is resolved through Node rather than hardcoded, so it is correct
 * whether npm hoists the package to the monorepo root or keeps it under
 * `apps/mobile/node_modules` — and the log line below records WHICH, which is the
 * one piece of evidence the build logs never gave us.
 *
 * Self-removing by design: if autolinking already added the pod, this is a no-op.
 * Delete the plugin once a build proves ExtensionStorage links on its own.
 */
const withExtensionStoragePod = (config) =>
  withPodfile(config, (cfg) => {
    if (cfg.modResults.contents.includes('ExtensionStorage')) {
      console.log('[with-extension-storage-pod] already linked by autolinking — skipping');
      return cfg;
    }

    // `iosDir` is <project>/ios; the podspec sits in the package's own ios/ dir.
    const podspecDir = path.dirname(require.resolve('@bacons/apple-targets/ios/ExtensionStorage.podspec'));
    const relative = path.relative(cfg.modRequest.platformProjectRoot, podspecDir).split(path.sep).join('/');

    console.log(`[with-extension-storage-pod] linking ExtensionStorage from ${podspecDir}`);

    // Anchor on `use_expo_modules!` so the pod lands inside the app target block
    // rather than at file scope, where CocoaPods would reject it.
    const anchor = 'use_expo_modules!';
    if (!cfg.modResults.contents.includes(anchor)) {
      throw new Error(
        '[with-extension-storage-pod] no `use_expo_modules!` in the Podfile — the ' +
          'template changed and this plugin needs a new anchor.',
      );
    }

    cfg.modResults.contents = cfg.modResults.contents.replace(
      anchor,
      `${anchor}\n  pod 'ExtensionStorage', :path => '${relative}'`,
    );

    return cfg;
  });

module.exports = withExtensionStoragePod;
