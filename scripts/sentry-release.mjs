#!/usr/bin/env node
// Post-build step: upload source maps to Sentry so prod stack traces are
// de-minified, then strip .map files from the dist bundle so we don't ship
// sourcemaps to end users. No-op (with a log line) when SENTRY_AUTH_TOKEN
// isn't set — keeps local prod builds and fork CI runs working.
//
// NOTE: this script does NOT inject `__MACROLOG_RELEASE__`, despite what
// src/app/components/settings-sheet/settings-about-section.component.ts:122
// claims. Nothing does. Until that is wired, the app reports its release as
// 'dev' at runtime while maps upload under the commit SHA, so uploaded maps
// cannot resolve. The stamp cannot simply be written into dist/index.html
// here: index.html is in ngsw.json's hashTable, and rewriting it post-build
// desynchronises the service worker (the same reason prerender-seo.mjs
// refuses to touch it). The fix belongs at build time — a generated
// src/build-info.ts, or angular.json's `define` — not in this file.

import { execSync } from 'node:child_process';
import { existsSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

const DIST_ROOT = 'dist/fitness-tracker-pwa/browser';

// Credentials reach this script two different ways, and only one of them was
// ever wired. CI injects all three as env vars (.github/workflows/ci.yml), but
// CI deliberately never deploys — releases are pushed by hand from a
// workstation, where they live in the git-ignored .env.local. Without this
// load, the only path that deploys was the only path that could not upload,
// and every hand-pushed release silently skipped source maps.
// `loadEnvFile` throws when the file is absent (CI, fork clones); that is the
// normal case there, not an error.
// Resolved against this file, not the cwd, and named explicitly: bare
// loadEnvFile() reads `.env`, which this repo does not use.
try {
  process.loadEnvFile(new URL('../.env.local', import.meta.url));
} catch {
  // Absent or unreadable — env vars may still be exported by the shell (CI).
}

// Neither of these is a secret (both are stated in STATUS.md), so default them
// rather than making a release depend on three values staying in sync across
// three stores. An explicit env value still wins, so CI can override — note
// the web project was renamed `macrolog` → `ignia-web`, so a stale CI secret
// would override this with a dead name.
process.env.SENTRY_ORG ||= 'gabriel-bermudez';
process.env.SENTRY_PROJECT ||= 'ignia-web';

/**
 * The release id the maps are filed under. Must equal what the running app
 * reports as its release, or Sentry cannot match a stack trace to a map.
 * `local-${Date.now()}` was unmatchable by construction: no browser could ever
 * report it. The commit SHA is stable, reproducible, and is what the About
 * screen is already written to display (it truncates to 8 chars).
 */
function releaseId() {
  if (process.env.BUILD_TAG) return process.env.BUILD_TAG;
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA;
  try {
    return execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim();
  } catch {
    return 'dev';
  }
}
const RELEASE = releaseId();

if (!existsSync(DIST_ROOT)) {
  console.log(`[sentry-release] ${DIST_ROOT} missing — did ng build run? Skipping.`);
  process.exit(0);
}

const haveToken = Boolean(process.env.SENTRY_AUTH_TOKEN);

if (haveToken) {
  console.log(`[sentry-release] Uploading sourcemaps to Sentry (release=${RELEASE})...`);
  try {
    execSync(
      `npx --yes @sentry/cli sourcemaps inject ${DIST_ROOT}`,
      { stdio: 'inherit' },
    );
    execSync(
      `npx --yes @sentry/cli sourcemaps upload --release "${RELEASE}" ${DIST_ROOT}`,
      { stdio: 'inherit' },
    );
    console.log('[sentry-release] Upload complete.');
  } catch (err) {
    // Never block a deploy on Sentry upload flakiness — log loudly and continue.
    console.error('[sentry-release] Upload failed:', err.message);
  }
} else {
  console.log(
    '[sentry-release] SENTRY_AUTH_TOKEN not set (checked the environment and .env.local) — skipping upload.',
  );
}

// Regardless of upload outcome: strip .map files so we don't serve them publicly.
function stripMaps(dir) {
  let count = 0;
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      count += stripMaps(full);
    } else if (entry.endsWith('.map')) {
      unlinkSync(full);
      count += 1;
    }
  }
  return count;
}

const removed = stripMaps(DIST_ROOT);
console.log(`[sentry-release] Removed ${removed} .map file(s) from ${DIST_ROOT}.`);

// Rebuild the service-worker manifest LAST, because everything above mutates
// dist after `ng build` already hashed it:
//   - `sourcemaps inject` rewrites every minified .js to embed a debug ID,
//   - stripMaps deletes files ngsw.json may reference.
// ngsw.json pins a SHA1 per file, so shipping a stale one gives every returning
// user a service worker whose hashes do not match what the server serves. That
// is a sticky, client-side failure — exactly the class of bug the deploy notes
// warn about. Regenerating is idempotent and cheap, so it runs unconditionally.
try {
  execSync(`npx --yes ngsw-config ${DIST_ROOT} ngsw-config.json`, { stdio: 'inherit' });
  console.log('[sentry-release] Regenerated ngsw.json against the final dist.');
} catch (err) {
  // Fatal only when we actually mutated the bundles — otherwise ng build's own
  // manifest is still accurate and the build can proceed.
  console.error('[sentry-release] ngsw.json regeneration failed:', err.message);
  if (haveToken) {
    console.error('[sentry-release] Bundles were debug-ID injected, so the existing ngsw.json is STALE. Refusing to leave a poisoned dist.');
    process.exit(1);
  }
}
