#!/usr/bin/env node
// Post-build step: upload source maps to Sentry so prod stack traces are
// de-minified, then strip .map files from the dist bundle so we don't ship
// sourcemaps to end users. No-op (with a log line) when SENTRY_AUTH_TOKEN
// isn't set — keeps local prod builds and fork CI runs working.

import { execSync } from 'node:child_process';
import { existsSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

const DIST_ROOT = 'dist/fitness-tracker-pwa/browser';
const RELEASE = process.env.BUILD_TAG || process.env.GITHUB_SHA || `local-${Date.now()}`;

if (!existsSync(DIST_ROOT)) {
  console.log(`[sentry-release] ${DIST_ROOT} missing — did ng build run? Skipping.`);
  process.exit(0);
}

const haveToken = Boolean(process.env.SENTRY_AUTH_TOKEN && process.env.SENTRY_ORG && process.env.SENTRY_PROJECT);

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
  console.log('[sentry-release] SENTRY_AUTH_TOKEN / SENTRY_ORG / SENTRY_PROJECT not all set — skipping upload.');
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
