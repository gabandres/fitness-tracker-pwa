const { withDangerousMod } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

/**
 * Adds `use_modular_headers!` to the iOS Podfile.
 *
 * Fixes the CocoaPods failure where a Swift pod (AppCheckCore, pulled in by
 * GoogleSignIn 9.x) depends on non-modular ObjC pods (GoogleUtilities,
 * RecaptchaInterop) and so can't be integrated as a static library:
 *   "[!] The Swift pod `AppCheckCore` depends upon `GoogleUtilities` and
 *    `RecaptchaInterop`, which do not define modules ... set
 *    `use_modular_headers!` globally in your Podfile"
 *
 * `use_modular_headers!` only makes every pod emit a module map — it does NOT
 * change linkage (unlike `use_frameworks!`), so Nitro / Reanimated / HealthKit
 * build exactly as before. Idempotent; inserted at global scope before the
 * first `target` block.
 */
module.exports = function withModularHeaders(config) {
  return withDangerousMod(config, [
    'ios',
    (cfg) => {
      const podfilePath = path.join(cfg.modRequest.platformProjectRoot, 'Podfile');
      let contents = fs.readFileSync(podfilePath, 'utf8');
      if (!contents.includes('use_modular_headers!')) {
        contents = contents.replace(/^target\b/m, 'use_modular_headers!\n\ntarget');
        fs.writeFileSync(podfilePath, contents);
      }
      return cfg;
    },
  ]);
};
