// Learn more: https://docs.expo.dev/guides/monorepos/
// `getSentryExpoConfig` is a drop-in for `getDefaultConfig` from
// `expo/metro-config` — same config object, plus the Sentry serializer that
// stamps Debug IDs into the bundle so uploaded source maps actually match it.
// Without it, mobile stack traces arrive minified and useless.
const { getSentryExpoConfig } = require('@sentry/react-native/metro');

// getDefaultConfig already handles this npm-workspaces monorepo (workspace-root
// watchFolders + both node_modules trees) — don't override watchFolders, or
// expo-doctor flags dropped defaults.
//
// Replay and the feedback widget are off: neither is used (`lib/sentry.ts`
// sends errors and sampled traces only), and with them on Metro bundled
// `@sentry/replay`, `replay-canvas` and `feedback` into the NATIVE bundle —
// ~370 KB of source loaded at every launch for nothing (measured 2026-10-21
// against the Sentry 8.31 upgrade). Only effective because the custom
// resolver below delegates to Sentry's; see `sentryResolveRequest`.
const config = getSentryExpoConfig(__dirname, {
  includeWebReplay: false,
  includeWebFeedback: false,
});

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
// Sentry's resolver chain — the replay/feedback exclusions requested above and
// its own server-only-module exclusion for `@sentry/core`. Assigning
// `resolveRequest` below REPLACES it, and until 2026-10-21 that silently
// bundled all three into the native app; the fallthrough now hands every
// ordinary module to it instead of straight to Metro.
const sentryResolveRequest = config.resolver.resolveRequest;

// Two of Sentry's exclusions test the ORIGIN path for "@sentry/core" /
// "@sentry/browser", which Windows writes with backslashes, so on the PC they
// never fire: its bundle carried 67 server-only @sentry/core modules (AI
// tracing, MCP, Node integrations) and @sentry/browser's feedback wrappers that
// the Mac leaves out (measured 2026-11-12). The same tests on the forward-slash
// path, Windows only, make a PC export the Mac's module for module; on macOS
// this is off. Not a patch-package patch: `node_modules/@sentry/react-native`
// is hashed WHOLE into the fingerprint, so editing it moves every runtime.
// Copied from @sentry/react-native 8.31 `metroconfig.js`; after a Sentry
// upgrade, diff a PC export against a Mac one (`docs/COMMANDS.md`).
const ON_WINDOWS = path.sep === '\\';
const SENTRY_SERVER_ONLY =
  /\/(mcp-server|integrations\/(http|express|postgresjs|requestdata|consola|spanStreaming)|tracing\/(vercel-ai|openai|anthropic-ai|google-genai|langchain|langgraph)|utils\/ai)(\/|\.js|$)/;
const SENTRY_FEEDBACK_WRAPPER = /\/feedback(Sync|Async)/;
const sentryExcludedOnWindows = (context, moduleName, platform) => {
  const origin = (context.originModulePath ?? '').replace(/\\/g, '/');
  if (origin.includes('@sentry/browser') && SENTRY_FEEDBACK_WRAPPER.test(moduleName)) return true;
  return (
    (platform === 'ios' || platform === 'android') &&
    origin.includes('@sentry/core') &&
    SENTRY_SERVER_ONLY.test(moduleName)
  );
};

config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (ON_WINDOWS && sentryExcludedOnWindows(context, moduleName, platform)) {
    return { type: 'empty' };
  }

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
  return sentryResolveRequest
    ? sentryResolveRequest(context, moduleName, platform)
    : context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
