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
const HK = '@kingstinct/react-native-healthkit';
config.resolver.resolveRequest = (context, moduleName, platform) => {
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
