#!/usr/bin/env node
/**
 * Submits Custom Product Pages for App Review.
 *
 * This is the step that makes a `?ppid=` URL resolve to the custom artwork
 * instead of quietly falling back to the default listing.
 *
 * **The dangerous part is what else rides along.** A review submission is a
 * basket: items are added to it, and `submitted: true` sends the whole basket.
 * Adding a CPP to a submission that already holds an app version would submit
 * the BINARY for review too. So this script refuses to reuse an open
 * submission, always opens its own, and prints every item before sending.
 *
 * Usage:
 *   node scripts/asc-submit-cpp.mjs --dry-run
 *   node scripts/asc-submit-cpp.mjs "EN · Lifters" "EN · Switchers"
 *
 * Named pages only — there is no "submit everything" mode on purpose.
 */
import { api, APP_ID } from './asc-client.mjs';

const argv = process.argv.slice(2);
const dryRun = argv.includes('--dry-run');
const names = argv.filter((a) => !a.startsWith('--'));

if (!names.length) {
  console.error('Usage: node scripts/asc-submit-cpp.mjs [--dry-run] "<page name>" ["<page name>" …]');
  process.exit(1);
}

/** States that mean a submission is still open and would take our items. */
const OPEN = ['READY_FOR_REVIEW', 'WAITING_FOR_REVIEW', 'IN_REVIEW', 'UNRESOLVED_ISSUES'];

async function main() {
  const pages = await api('GET', `/v1/apps/${APP_ID}/appCustomProductPages?limit=70`);

  const targets = [];
  for (const name of names) {
    const page = pages.data.find((p) => p.attributes.name === name);
    if (!page) {
      console.error(`✗ no custom product page named "${name}"`);
      process.exit(1);
    }
    const versions = await api(
      'GET',
      `/v1/appCustomProductPages/${page.id}/appCustomProductPageVersions?limit=1`,
    );
    const version = versions.data[0];
    console.log(`${name}: version ${version.id} — state ${version.attributes.state}`);
    if (version.attributes.state !== 'PREPARE_FOR_SUBMISSION') {
      console.log('  already submitted or live — skipping');
      continue;
    }
    targets.push({ name, versionId: version.id });
  }

  if (!targets.length) {
    console.log('\nNothing to submit.');
    return;
  }

  const existing = await api('GET', `/v1/apps/${APP_ID}/reviewSubmissions?limit=20`);
  const open = existing.data.filter((s) => OPEN.includes(s.attributes.state));
  if (open.length) {
    // Refusing rather than reusing: an open submission may already hold the
    // app version, and submitting it would send the binary for review.
    console.error(
      `\n✗ ${open.length} open review submission(s): ${open.map((s) => `${s.id} (${s.attributes.state})`).join(', ')}\n` +
        '  Resolve or cancel them in App Store Connect first — adding to one risks\n' +
        '  submitting whatever else it already contains, including the app binary.',
    );
    process.exit(1);
  }

  console.log(`\nWill submit ${targets.length} page(s), and nothing else:`);
  for (const t of targets) console.log(`  · ${t.name}`);

  if (dryRun) {
    console.log('\n(dry run) nothing was submitted.');
    return;
  }

  const submission = await api('POST', '/v1/reviewSubmissions', {
    data: {
      type: 'reviewSubmissions',
      attributes: { platform: 'IOS' },
      relationships: { app: { data: { type: 'apps', id: APP_ID } } },
    },
  });
  const submissionId = submission.data.id;

  for (const t of targets) {
    await api('POST', '/v1/reviewSubmissionItems', {
      data: {
        type: 'reviewSubmissionItems',
        relationships: {
          reviewSubmission: { data: { type: 'reviewSubmissions', id: submissionId } },
          appCustomProductPageVersion: {
            data: { type: 'appCustomProductPageVersions', id: t.versionId },
          },
        },
      },
    });
    console.log(`  added ${t.name}`);
  }

  // Last chance to catch anything unexpected in the basket before it is sent.
  const items = await api('GET', `/v1/reviewSubmissions/${submissionId}/items?limit=20`);
  if (items.data.length !== targets.length) {
    console.error(
      `\n✗ submission holds ${items.data.length} item(s) but ${targets.length} were added — NOT submitting.`,
    );
    process.exit(1);
  }

  await api('PATCH', `/v1/reviewSubmissions/${submissionId}`, {
    data: { type: 'reviewSubmissions', id: submissionId, attributes: { submitted: true } },
  });

  const after = await api('GET', `/v1/reviewSubmissions/${submissionId}`);
  console.log(`\n✓ submitted — submission ${submissionId}, state ${after.data.attributes.state}`);
}

main().catch((e) => {
  console.error(String(e.message ?? e));
  process.exit(1);
});
