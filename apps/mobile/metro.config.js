// Learn more: https://docs.expo.dev/guides/monorepos/
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

// This app is an npm-workspaces package; most deps (incl. the health native
// modules) hoist to the monorepo-root node_modules. Watch the whole workspace
// and resolve from both node_modules trees.
config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];

// @kingstinct/react-native-healthkit ships an `exports` map that trips Metro's
// SDK 54 package-exports resolver on the package's OWN internal files (it routes
// the entry to lib/module, then fails to resolve ./hooks/useHealthkitAuthorization).
// Disable package-exports ONLY for that package and any import originating from
// inside it, so it falls back to classic resolution (its `react-native`/`source`
// field → src). Everything else (Firebase, etc.) keeps package exports on.
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
