// Create (or preview) the Play PRODUCTION release with country targeting pinned
// to exactly the territories iOS already ships to.
//
// ─────────────────────────────────────────────────────────────────────────────
// WHY THIS SCRIPT EXISTS
//
// Promoting to production is cheap — vc 37 keeps runtime `ae526937…`, so the
// same binary moves tracks and production users immediately receive every OTA
// already published. The expensive part is one field.
//
// **`countryTargeting` is `null` on the live alpha release**, verified against
// the androidpublisher API on 2026-08-26. Null means "inherit the track", and
// the track is all 177 Play countries — including the EU 27. An app distributed
// in the EU without a Digital Services Act trader declaration is **removed from
// all 27 EU territories**.
//
// iOS made the opposite choice deliberately: 145 of 175 territories, with the
// EU 27 plus GBR, ISL and NOR held back, because the DSA trader declaration
// publishes the trader's name, postal address, phone number and email on every
// EU product page — a disclosure the owner makes personally, not one to stumble
// into by ticking a box.
//
// So Play must match iOS, and it must match it EXPLICITLY. Creating the release
// with the field unset is the failure this script exists to make impossible.
//
// `includeRestOfWorld: false` is the other half and is just as load-bearing:
// without it, every country Google ADDS to Play later is opted in silently, and
// the carve-out quietly defeats itself.
//
// ─────────────────────────────────────────────────────────────────────────────
// WHAT PLAY ACTUALLY ENFORCES — measured 2026-08-29, not assumed
//
// This script was written to create a `completed` (100%) release carrying
// `countryTargeting`. **Play rejects that combination outright:**
//
//   400 INVALID_ARGUMENT: Country targeting is only supported for staged releases.
//
// So a country-pinned release MUST be `inProgress` with a `userFraction`. That
// is not a caution anyone chose; it is the only door the API opens. The two
// facts that follow from it:
//
// A staged release was then tried, and Play refused that too:
//
//   400 INVALID_ARGUMENT: The first release on a track cannot be staged.
//
// **Those two errors together close the loop, and the conclusion is not
// negotiable by any argument to this script:**
//
//   first production release MUST be `completed`
//     -> `completed` MUST NOT carry `countryTargeting`
//       -> so it inherits the PRODUCTION TRACK's country availability
//         -> and `edits.countryavailability` is READ-ONLY (`get`, nothing else)
//
// **Therefore the 145 territories have to be set by hand in Play Console ->
// Production -> Countries/regions BEFORE the first release exists.** No flag
// here can substitute for that, and the header of this file claimed otherwise
// until 2026-08-29. `STATUS.md` said "the release is ONE command"; it was two
// commands and a Console page.
//
// What this script still owns, and it is the load-bearing half: `--complete`
// REFUSES to publish until it has re-read `countryAvailability/production` and
// seen exactly this table with `restOfWorld: false`. Completing against an
// unchecked track is what ships the app into the EU 27.
//
// Once a first release exists, later releases MAY be staged, and then
// `countryTargeting` is available again — that is what `--fraction` is for.
//
// Verified in an uncommitted edit before any of this shipped: Play accepts all
// 145 codes, `XK` included, and echoes them back on a staged release. So the
// table is expressible; only the ORDER of operations was wrong.
//
// ─────────────────────────────────────────────────────────────────────────────
// USAGE
//
//   node scripts/play-production-release.mjs --availability   # START HERE: read the track
//   node scripts/play-production-release.mjs                  # preview, changes nothing
//   node scripts/play-production-release.mjs --complete --commit   # 100%, gated on the read
//   node scripts/play-production-release.mjs --commit         # staged; NOT legal as a first release
//   node scripts/play-production-release.mjs --commit --fraction 0.5
//   node scripts/play-production-release.mjs --complete --commit --vc 40
//
// FIRST-EVER production release, in order:
//   1. `--availability`  -> expect 0 countries. That is "available nowhere".
//   2. Play Console -> Production -> Countries/regions -> add exactly the 145.
//   3. `--availability`  -> must now report 145, restOfWorld=false, no diff.
//   4. `--complete --commit`.
//
// ─────────────────────────────────────────────────────────────────────────────
// DRIVING STEP 2 BY HAND — and why "select all, then remove the EU" is WRONG
//
// It is the obvious shortcut and it ships the app to four places Apple
// deliberately refuses and one the DSA covers. Three lists, against the 176
// Play enumerated on the alpha track:
//
// (a) REMOVE — EU/EEA/UK, the DSA-critical 30. These are the ones whose absence
//     the whole `countryTargeting` apparatus exists to guarantee:
//       AT BE BG HR CY CZ DK EE FI FR DE GR HU IS IE IT LV LT LU MT
//       NL NO PL PT RO SK SI ES SE GB
//
// (b) REMOVE — 18 more that Play offers and the iOS mirror does not. Skipping
//     this list is the actual trap, because two of them defeat (a):
//       AW BD KM CU DJ ER GI GN HT IR LI MC WS SM SO SD TG VA
//     - **LI (Liechtenstein) is EEA, so the DSA applies to it** and it is NOT
//       in list (a). "Select all minus the EU 27" leaves it in.
//     - **GI (Gibraltar)** is UK-adjacent and equally not in (a).
//     - **CU, IR, SD, SO** are US-sanctioned. Apple does not offer them; a
//       Wyoming LLC distributing there is an OFAC question nobody has asked.
//
// (c) ADD — 17 that ARE in the mirror but were absent from the alpha snapshot,
//     so a "start from the alpha list" approach silently drops them. Play's API
//     accepted all 17 on 2026-08-29, `XK` included, so they exist:
//       AF AI BB BT BN SZ GY XK MG MW MR ME MS NR PW ST VC
//
// 176 - 30 - 18 = 128. The +17 is NOT available (see `NOT_OFFERED_BY_PLAY`).
// Do not trust that arithmetic over `--availability`, which reads the answer
// back from Play and names every discrepancy.
//
// ─────────────────────────────────────────────────────────────────────────────
// STEP 2 WAS DONE ON 2026-08-29. What worked, for whoever repeats it:
//
// - The picker renders ALL 177 rows in the DOM (176 countries + "Rest of
//   World"). It LOOKS virtualised because `read_page` defaults to depth 15 and
//   the rows sit deeper; pass depth 40 and every row has a ref.
// - **"Rest of World" is a ROW IN THE TABLE, not a separate toggle.** Select-all
//   ticks it. Leaving it ticked is exactly the `includeRestOfWorld: true` this
//   whole script exists to prevent. Untick it explicitly.
// - **Scripted `.click()` does nothing.** Angular Material ignores untrusted
//   events: 49 JS clicks reported success and changed zero checkboxes. Only
//   real extension clicks register. Verify with `aria-checked`, never with the
//   click call's own return.
// - **Do not map country NAMES to codes by scanning all AA-ZZ pairs.**
//   `Intl.DisplayNames` resolves DEPRECATED codes too, and they overwrite the
//   live ones: DY->Benin, HV->Burkina Faso, SU->Russia, YU->Serbia, FX->France.
//   That mapping would have unticked Benin, Burkina Faso, Russia and Serbia.
//   Map FORWARD only (code -> name, from the keep list outward).
// - Seven page labels differ from CLDR and need aliasing: Congo - Kinshasa,
//   Congo - Brazzaville, Cape Verde, Macao, Hong Kong, South Korea,
//   Myanmar (Burma).
// - Save puts the change in **Publishing overview** as "not yet submitted for
//   review". It carries an "Affects other tracks" badge; expanded, the only
//   affected track was **Open testing** (alpha, which holds the 15 testers, was
//   NOT affected). The availability applied and `--availability` read 128 back
//   without waiting for a review to clear.
// - The Console renderer wedges hard on this page — 30s CDP screenshot timeouts
//   and "script injection timed out" that a wait does not always clear. Verify
//   from the API, never from the page.
//
// Defaults to whatever versionCode is live on `alpha`, because promoting the
// binary testers have been running is the whole point.
import { JWT } from 'file:///Z:/macro-app/node_modules/google-auth-library/build/src/index.js';
import { readFileSync } from 'node:fs';

const PKG = 'fit.ignia.app';
const KEY_PATH = 'Z:/macro-app/apps/mobile/credentials/play-service-account.json';

/**
 * The 145 territories iOS ships to, as ISO 3166-1 **alpha-2** — the form Play
 * wants. ASC reports alpha-3, so this is the translation.
 *
 * **Do not hand-edit this list to change WHERE the app ships.** It is a mirror
 * of App Store Connect, and the two drifting apart is the bug it prevents.
 * `--check-source` re-reads ASC and diffs against it.
 *
 * `XK` is Kosovo. ISO has never assigned it a code; Apple calls it `XKS` and
 * Play calls it `XK`, so it is the one row that cannot be derived and the one
 * `Intl.DisplayNames` will not validate.
 */
const ASC_ALPHA3_TO_PLAY_ALPHA2 = {
  AFG: 'AF', AGO: 'AO', AIA: 'AI', ALB: 'AL', ARE: 'AE', ARG: 'AR', ARM: 'AM',
  ATG: 'AG', AUS: 'AU', AZE: 'AZ', BEN: 'BJ', BFA: 'BF', BHR: 'BH', BHS: 'BS',
  BIH: 'BA', BLR: 'BY', BLZ: 'BZ', BMU: 'BM', BOL: 'BO', BRA: 'BR', BRB: 'BB',
  BRN: 'BN', BTN: 'BT', BWA: 'BW', CAN: 'CA', CHE: 'CH', CHL: 'CL', CHN: 'CN',
  CIV: 'CI', CMR: 'CM', COD: 'CD', COG: 'CG', COL: 'CO', CPV: 'CV', CRI: 'CR',
  CYM: 'KY', DMA: 'DM', DOM: 'DO', DZA: 'DZ', ECU: 'EC', EGY: 'EG', FJI: 'FJ',
  FSM: 'FM', GAB: 'GA', GEO: 'GE', GHA: 'GH', GMB: 'GM', GNB: 'GW', GRD: 'GD',
  GTM: 'GT', GUY: 'GY', HKG: 'HK', HND: 'HN', IDN: 'ID', IND: 'IN', IRQ: 'IQ',
  ISR: 'IL', JAM: 'JM', JOR: 'JO', JPN: 'JP', KAZ: 'KZ', KEN: 'KE', KGZ: 'KG',
  KHM: 'KH', KNA: 'KN', KOR: 'KR', KWT: 'KW', LAO: 'LA', LBN: 'LB', LBR: 'LR',
  LBY: 'LY', LCA: 'LC', LKA: 'LK', MAC: 'MO', MAR: 'MA', MDA: 'MD', MDG: 'MG',
  MDV: 'MV', MEX: 'MX', MKD: 'MK', MLI: 'ML', MMR: 'MM', MNE: 'ME', MNG: 'MN',
  MOZ: 'MZ', MRT: 'MR', MSR: 'MS', MUS: 'MU', MWI: 'MW', MYS: 'MY', NAM: 'NA',
  NER: 'NE', NGA: 'NG', NIC: 'NI', NPL: 'NP', NRU: 'NR', NZL: 'NZ', OMN: 'OM',
  PAK: 'PK', PAN: 'PA', PER: 'PE', PHL: 'PH', PLW: 'PW', PNG: 'PG', PRY: 'PY',
  QAT: 'QA', RUS: 'RU', RWA: 'RW', SAU: 'SA', SEN: 'SN', SGP: 'SG', SLB: 'SB',
  SLE: 'SL', SLV: 'SV', SRB: 'RS', STP: 'ST', SUR: 'SR', SWZ: 'SZ', SYC: 'SC',
  TCA: 'TC', TCD: 'TD', THA: 'TH', TJK: 'TJ', TKM: 'TM', TON: 'TO', TTO: 'TT',
  TUN: 'TN', TUR: 'TR', TWN: 'TW', TZA: 'TZ', UGA: 'UG', UKR: 'UA', URY: 'UY',
  USA: 'US', UZB: 'UZ', VCT: 'VC', VEN: 'VE', VGB: 'VG', VNM: 'VN', VUT: 'VU',
  XKS: 'XK', YEM: 'YE', ZAF: 'ZA', ZMB: 'ZM', ZWE: 'ZW',
};

/** Held back on purpose. Listed so the exclusion is auditable rather than
 *  implied by absence — and so anyone flipping DSA trader status later knows
 *  exactly which rows to move. */
const DELIBERATELY_EXCLUDED_NOTE =
  "EU 27 + GBR, ISL, NOR — pending a PLAY-SIDE DSA trader declaration (Apple does not carry over)";

/**
 * The 30 territories iOS opened on 2026-08-28 and Play deliberately has NOT.
 *
 * ## Why this list exists, and why syncing it away would be the bug
 *
 * The table above is a MIRROR of App Store Connect, and until 2026-08-28 the
 * two agreed at 145. That day the DSA trader declaration was filed on the
 * Bermudez Systems LLC entity in ASC and all 30 held-back territories were
 * opened, so iOS now ships to 175 of 175.
 *
 * **Apple's declaration does nothing for Google.** Play has its own DSA trader
 * declaration, in Play Console, and it had not been filed when this was
 * written. Expanding the table to 175 on the strength of the ASC read would
 * ship the first-ever Android production release into the EU 27 with no
 * Google-side trader declaration — which removes the app from all 27.
 *
 * So `--check-source` no longer treats these 30 as drift. It still fails on
 * any OTHER divergence, which is the mirror's actual job.
 *
 * **To retire this list:** file the Play Console DSA trader declaration, then
 * move these rows into `ASC_ALPHA3_TO_PLAY_ALPHA2` and delete the set. Do not
 * do it in the other order.
 */
const EU_PENDING_PLAY_DSA = new Set([
  'AUT', 'BEL', 'BGR', 'HRV', 'CYP', 'CZE', 'DNK', 'EST', 'FIN', 'FRA',
  'DEU', 'GRC', 'HUN', 'IRL', 'ITA', 'LVA', 'LTU', 'LUX', 'MLT', 'NLD',
  'POL', 'PRT', 'ROU', 'SVK', 'SVN', 'ESP', 'SWE', 'GBR', 'ISL', 'NOR',
]);

/**
 * The 17 territories that are in the ASC mirror but that PLAY DOES NOT OFFER.
 *
 * ## This is a platform limit, not drift, and not a mistake to fix
 *
 * Read off the live Console picker on 2026-08-29: Play's production
 * Countries/regions list contains exactly **176** territories, and these 17 are
 * not among them. There is no checkbox to tick.
 *
 * The confusing part, and the reason this needs writing down: the
 * androidpublisher API **accepts all 17** in a release's `countryTargeting` and
 * echoes them back. Accepting a code is not the same as offering a storefront.
 * So an API-only check says the mirror is reproducible on Play and the Console
 * says it is not — the Console is right.
 *
 * Consequence: Android's achievable maximum is **128**, not 145 (145 - 17). iOS
 * stays at 175. That gap is permanent until Google adds these storefronts, and
 * it is NOT the EU hold-back, which is a deliberate choice and lives in
 * `EU_PENDING_PLAY_DSA` above.
 */
const NOT_OFFERED_BY_PLAY = new Set([
  'AF', 'AI', 'BB', 'BN', 'BT', 'GY', 'ME', 'MG', 'MR', 'MS',
  'MW', 'NR', 'PW', 'ST', 'SZ', 'VC', 'XK',
]);

const countries = Object.values(ASC_ALPHA3_TO_PLAY_ALPHA2);

/** What Play can actually be set to: the mirror minus what Play does not sell in. */
const attainable = countries.filter((c) => !NOT_OFFERED_BY_PLAY.has(c));

/**
 * Validate the table before it can reach Play.
 *
 * A wrong two-letter code does not fail loudly — Play may accept it and simply
 * not ship somewhere, which is invisible until someone in that country cannot
 * find the app. So every code is checked against ICU's own region data, which
 * is the closest thing to an authority available offline.
 */
function validate() {
  const problems = [];
  if (countries.length !== 145) problems.push(`expected 145 countries, got ${countries.length}`);
  const dupes = countries.filter((c, i) => countries.indexOf(c) !== i);
  if (dupes.length) problems.push(`duplicate codes: ${[...new Set(dupes)].join(', ')}`);

  const names = new Intl.DisplayNames(['en'], { type: 'region' });
  for (const [a3, a2] of Object.entries(ASC_ALPHA3_TO_PLAY_ALPHA2)) {
    if (!/^[A-Z]{2}$/.test(a2)) {
      problems.push(`${a3} -> ${a2} is not a two-letter code`);
      continue;
    }
    // Kosovo has no ISO code and ICU does not resolve it; it is the documented
    // exception rather than a typo.
    if (a2 === 'XK') continue;
    let label;
    try {
      label = names.of(a2);
    } catch {
      label = undefined;
    }
    if (!label || label === a2) problems.push(`${a3} -> ${a2} does not resolve to a country`);
  }
  return problems;
}

/**
 * Re-read App Store Connect and diff it against the table above.
 *
 * The table is a MIRROR, and a mirror that nobody checks is just a second
 * source of truth. Run this whenever iOS territories change — the two drifting
 * apart is the failure mode, and it is silent in both directions: a territory
 * added on iOS and missing here never gets the Android app, and one removed on
 * iOS but left here keeps getting it.
 */
async function checkSource() {
  const { api, APP_ID } = await import('./asc-client.mjs');
  const res = await api(
    'GET',
    `/v2/appAvailabilities/${APP_ID}/territoryAvailabilities?limit=200&include=territory&fields[territoryAvailabilities]=available,territory`,
  );
  const live = (res.data ?? [])
    .filter((d) => d.attributes?.available)
    .map((d) => d.relationships?.territory?.data?.id)
    .filter(Boolean)
    .sort();
  const mine = Object.keys(ASC_ALPHA3_TO_PLAY_ALPHA2).sort();
  const missingAll = live.filter((t) => !mine.includes(t));
  const expected = missingAll.filter((t) => EU_PENDING_PLAY_DSA.has(t));
  const missing = missingAll.filter((t) => !EU_PENDING_PLAY_DSA.has(t));
  const extra = mine.filter((t) => !live.includes(t));
  console.log(`ASC available: ${live.length} · table: ${mine.length}`);
  if (expected.length) {
    console.log(
      `held back on Play ON PURPOSE (${expected.length}): ${expected.join(' ')}`,
    );
    console.log("  reason: Play needs its OWN DSA trader declaration; the Apple one does not carry over.");
    console.log('  opening these without it removes the app from all 27 EU territories.');
  }
  if (!missing.length && !extra.length) {
    console.log('IN SYNC — the table matches iOS apart from the deliberate hold-back above.');
    return true;
  }
  if (missing.length) console.error('DRIFT — on iOS but NOT in the table:', missing.join(' '));
  if (extra.length) console.error('DRIFT — in the table but NOT on iOS:', extra.join(' '));
  return false;
}

/**
 * Read the PRODUCTION track's own country availability and compare it to the
 * table. This is the gate on `--complete`.
 *
 * `edits.countryavailability` is read-only, so this is the only way to know
 * what a `completed` release with no targeting would inherit — and inheriting
 * the wrong thing is a 27-country removal, not a cosmetic error.
 */
async function readAvailability(client, base, editId) {
  const r = (await client.request({ url: `${base}/edits/${editId}/countryAvailability/production` })).data;
  const live = (r.countries ?? []).map((c) => c.countryCode).sort();
  const want = [...attainable].sort();
  // `missing` is only ever a REAL gap. A territory Play does not offer cannot be
  // set and must not read as drift, or the gate below never opens.
  const missing = want.filter((c) => !live.includes(c));
  const extra = live.filter((c) => !want.includes(c));
  const unobtainable = countries.filter((c) => NOT_OFFERED_BY_PLAY.has(c) && !live.includes(c));
  return { live, restOfWorld: r.restOfWorld === true, missing, extra, unobtainable };
}

async function main() {
  const args = process.argv.slice(2);
  const commit = args.includes('--commit');
  const complete = args.includes('--complete');
  const vcArg = args.includes('--vc') ? args[args.indexOf('--vc') + 1] : null;
  const fraction = args.includes('--fraction')
    ? Number(args[args.indexOf('--fraction') + 1])
    : 0.99;

  if (!(fraction > 0 && fraction < 1)) {
    console.error(`--fraction must be strictly between 0 and 1 (got ${fraction}).`);
    console.error('Play has no "inProgress at 100%"; 100% is --complete, a separate gated step.');
    process.exit(1);
  }

  if (args.includes('--check-source')) {
    process.exit((await checkSource()) ? 0 : 1);
  }

  const problems = validate();
  if (problems.length) {
    console.error('COUNTRY TABLE IS INVALID — refusing to touch Play:');
    for (const p of problems) console.error('  -', p);
    process.exit(1);
  }
  console.log(`country table OK: ${countries.length} territories, all resolve`);
  console.log(`excluded on purpose: ${DELIBERATELY_EXCLUDED_NOTE}`);

  const key = JSON.parse(readFileSync(KEY_PATH, 'utf8'));
  const client = new JWT({
    email: key.client_email,
    key: key.private_key,
    scopes: ['https://www.googleapis.com/auth/androidpublisher'],
  });
  const base = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${PKG}`;

  const edit = (await client.request({ url: `${base}/edits`, method: 'POST', data: {} })).data;
  if (args.includes('--availability')) {
    const a = await readAvailability(client, base, edit.id);
    console.log(`\nproduction track availability: ${a.live.length} countries, restOfWorld=${a.restOfWorld}`);
    console.log(`target: ${attainable.length} attainable of ${countries.length} in the mirror`);
    if (a.unobtainable.length) console.log(`not offered by Play, expected absent (${a.unobtainable.length}): ${a.unobtainable.join(' ')}`);
    if (a.missing.length) console.log(`MISSING and settable (${a.missing.length}): ${a.missing.join(' ')}`);
    if (a.extra.length) console.log(`EXTRA, not in the mirror (${a.extra.length}): ${a.extra.join(' ')}`);
    if (!a.missing.length && !a.extra.length && !a.restOfWorld) console.log('track MATCHES the attainable target.');
    await client.request({ url: `${base}/edits/${edit.id}`, method: 'DELETE' }).catch(() => {});
    return;
  }
  try {
    const tracks = (await client.request({ url: `${base}/edits/${edit.id}/tracks` })).data;
    const alpha = (tracks.tracks ?? []).find((t) => t.track === 'alpha');
    const liveAlphaVc = alpha?.releases?.[0]?.versionCodes?.[0];
    const versionCode = vcArg ?? liveAlphaVc;
    if (!versionCode) throw new Error('no versionCode on alpha and none given with --vc');

    // --complete is 100%, and it may NOT carry countryTargeting (Play rejects
    // that combination). So it inherits the TRACK, and the only safe version of
    // this step is one that refuses to run until the track has been read.
    const avail = await readAvailability(client, base, edit.id);
    if (complete) {
      console.log(`\nproduction track availability: ${avail.live.length} countries, restOfWorld=${avail.restOfWorld}`);
      console.log(`target is ${attainable.length} (the ${countries.length}-territory mirror minus ${NOT_OFFERED_BY_PLAY.size} Play does not offer)`);
      const blockers = [];
      if (avail.missing.length) blockers.push(`track is MISSING ${avail.missing.length}: ${avail.missing.join(' ')}`);
      if (avail.extra.length) blockers.push(`track carries ${avail.extra.length} NOT in the table: ${avail.extra.join(' ')}`);
      if (avail.restOfWorld) blockers.push('restOfWorld is TRUE — every country Play adds later is opted in silently');
      if (blockers.length) {
        console.error('\nREFUSING to complete the rollout. A completed release inherits the TRACK,');
        console.error('and the track does not match the table:');
        for (const b of blockers) console.error('  -', b);
        console.error('\nFix it in Play Console -> Production -> Countries/regions (the API is read-only),');
        console.error('then re-run. Completing on this state is what removes the app from the EU 27.');
        process.exit(1);
      }
      console.log('track matches the table — safe to complete.');
    }

    const name = alpha?.releases?.[0]?.name ?? String(versionCode);
    const release = complete
      ? { name, versionCodes: [String(versionCode)], status: 'completed' }
      : {
          name,
          versionCodes: [String(versionCode)],
          status: 'inProgress',
          userFraction: fraction,
          countryTargeting: { countries, includeRestOfWorld: false },
        };

    console.log(`\nversionCode: ${versionCode}${vcArg ? ' (from --vc)' : ' (live on alpha)'}`);
    console.log('release status:', release.status, complete ? '(100%)' : `(userFraction ${fraction})`);
    if (release.countryTargeting) {
      console.log('countryTargeting.includeRestOfWorld:', release.countryTargeting.includeRestOfWorld);
      console.log('countries:', countries.length);
    } else {
      console.log('countryTargeting: none — INHERITS the track, which was checked above');
    }
    if (!complete) {
      console.log(`track availability right now: ${avail.live.length} countries, restOfWorld=${avail.restOfWorld}`);
    }

    if (!commit) {
      console.log('\nDRY RUN — nothing was changed. Re-run with --commit to release.');
      return;
    }

    await client.request({
      url: `${base}/edits/${edit.id}/tracks/production`,
      method: 'PUT',
      data: { track: 'production', releases: [release] },
    });
    await client.request({ url: `${base}/edits/${edit.id}:commit`, method: 'POST' });
    console.log('\nCOMMITTED to production.');

    // Re-read from a FRESH edit. An in-edit read reflects committed state only,
    // so this is the first honest answer to "did the track learn the countries".
    const e2 = (await client.request({ url: `${base}/edits`, method: 'POST', data: {} })).data;
    const after = await readAvailability(client, base, e2.id);
    await client.request({ url: `${base}/edits/${e2.id}`, method: 'DELETE' }).catch(() => {});
    console.log(`\nproduction track availability now: ${after.live.length} countries, restOfWorld=${after.restOfWorld}`);
    if (after.missing.length) console.log(`  missing vs table (${after.missing.length}): ${after.missing.join(' ')}`);
    if (after.extra.length) console.log(`  extra vs table (${after.extra.length}): ${after.extra.join(' ')}`);
    if (!after.missing.length && !after.extra.length && !after.restOfWorld) {
      console.log('  MATCHES the table — `--complete --commit` is now safe.');
    } else {
      console.log('  does NOT match the table — set it in Play Console -> Production -> Countries/regions');
      console.log('  before running --complete. Do not complete on this state.');
    }
  } finally {
    if (!commit) {
      await client.request({ url: `${base}/edits/${edit.id}`, method: 'DELETE' }).catch(() => {});
    }
  }
}

await main();
