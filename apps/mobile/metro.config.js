// Learn more: https://docs.expo.dev/guides/monorepos/
const { getDefaultConfig } = require('expo/metro-config');

// getDefaultConfig already handles this npm-workspaces monorepo (workspace-root
// watchFolders + both node_modules trees) — don't override watchFolders, or
// expo-doctor flags dropped defaults.
const config = getDefaultConfig(__dirname);

// @kingstinct/react-native-healthkit ships an `exports` map that trips Metro's
// SDK 54 package-exports resolver on the package's OWN internal files (it routes
// the entry to lib/module, then fails to resolve ./hooks/useHealthkitAuthorization).
// Disable package-exports ONLY for that package and any import originating inside
// it, so it falls back to classic resolution (its `react-native`/`source` field
// → src). Everything else (Firebase, etc.) keeps package exports on.
// The `@/…` aliases come from tsconfig `paths`, which Metro reads from
// whatever it treats as the project root. In this monorepo the Android
// RELEASE bundle runs rooted at the WORKSPACE — where tsconfig.json is the
// Angular app's and has no such mapping — so the alias silently vanishes and
// only that one build fails, with "Unable to resolve module @/lib/widget".
// Declaring them here makes resolution independent of which tsconfig gets
// discovered. Order matters: `@/assets` must be tested before the broader `@`.
const path = require('path');
const ALIASES = [
  ['@/assets', path.resolve(__dirname, 'assets')],
  ['@', path.resolve(__dirname, 'src')],
];

// Same workspace-root trap, one layer up — this one kills the ANDROID RELEASE
// BUILD outright. Gradle bundles by running Expo CLI from `apps/mobile` with a
// RELATIVE `--entry-file index.js` (the RN Gradle plugin relativizes the
// absolute path `expo/scripts/resolveAppEntry` hands it against `react.root`).
// Expo then resolves that against Metro's SERVER root — the workspace — so it
// looks for `Z:\macro-app\index.js` and dies with "Unable to resolve module
// ./index.js". Debug and Expo Go never hit it; only the release bundle does,
// which is why a QR-code smoke test on a device proves nothing here.
// `main` is a custom `index.js` on purpose (it registers the Android widget
// task handler before React mounts — see AGENTS.md / WIDGET.md), so the entry
// cannot be moved to `expo-router/entry` to dodge this.
// Do NOT "fix" this by setting `react.root` to the workspace in build.gradle:
// that moves Expo's project root too, THIS config stops loading, and the
// `@/…` aliases above vanish (build fails on `@/lib/widget` instead).
// Matching only an origin of exactly the workspace root keeps the ordinary
// `require('./index.js')` inside hoisted node_modules packages untouched.
const WORKSPACE_ROOT = path.resolve(__dirname, '../..');
const APP_ENTRY = path.resolve(__dirname, 'index.js');

const HK = '@kingstinct/react-native-healthkit';
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (
    moduleName === './index.js' &&
    typeof context.originModulePath === 'string' &&
    path.resolve(context.originModulePath) === WORKSPACE_ROOT
  ) {
    return context.resolveRequest(context, APP_ENTRY, platform);
  }

  for (const [prefix, target] of ALIASES) {
    if (moduleName === prefix || moduleName.startsWith(`${prefix}/`)) {
      const rest = moduleName.slice(prefix.length).replace(/^\//, '');
      return context.resolveRequest(context, rest ? path.join(target, rest) : target, platform);
    }
  }

  const fromHealthkit =
    typeof context.originModulePath === 'string' && context.originModulePath.includes(HK);
  if (moduleName === HK || moduleName.startsWith(`${HK}/`) || fromHealthkit) {
    return context.resolveRequest(
      { ...context, unstable_enablePackageExports: false },
      moduleName,
      platform,
    );
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
