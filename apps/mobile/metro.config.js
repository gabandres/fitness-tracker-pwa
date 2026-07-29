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

const HK = '@kingstinct/react-native-healthkit';
config.resolver.resolveRequest = (context, moduleName, platform) => {
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
