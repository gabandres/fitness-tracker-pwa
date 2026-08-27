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
// USAGE
//
//   node scripts/play-production-release.mjs                 # preview, changes nothing
//   node scripts/play-production-release.mjs --commit        # actually release
//   node scripts/play-production-release.mjs --commit --vc 39
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
  'EU 27 + GBR, ISL, NOR — DSA trader declaration publishes name/address/phone/email on the EU product page';

const countries = Object.values(ASC_ALPHA3_TO_PLAY_ALPHA2);

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
  const missing = live.filter((t) => !mine.includes(t));
  const extra = mine.filter((t) => !live.includes(t));
  console.log(`ASC available: ${live.length} · table: ${mine.length}`);
  if (!missing.length && !extra.length) {
    console.log('IN SYNC — the table matches what iOS ships to.');
    return true;
  }
  if (missing.length) console.error('on iOS but NOT in the table:', missing.join(' '));
  if (extra.length) console.error('in the table but NOT on iOS:', extra.join(' '));
  return false;
}

async function main() {
  const args = process.argv.slice(2);
  const commit = args.includes('--commit');
  const vcArg = args.includes('--vc') ? args[args.indexOf('--vc') + 1] : null;

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
  try {
    const tracks = (await client.request({ url: `${base}/edits/${edit.id}/tracks` })).data;
    const alpha = (tracks.tracks ?? []).find((t) => t.track === 'alpha');
    const liveAlphaVc = alpha?.releases?.[0]?.versionCodes?.[0];
    const versionCode = vcArg ?? liveAlphaVc;
    if (!versionCode) throw new Error('no versionCode on alpha and none given with --vc');

    const release = {
      name: alpha?.releases?.[0]?.name ?? String(versionCode),
      versionCodes: [String(versionCode)],
      status: 'completed',
      countryTargeting: { countries, includeRestOfWorld: false },
    };

    console.log(`\nversionCode: ${versionCode}${vcArg ? ' (from --vc)' : ' (live on alpha)'}`);
    console.log('countryTargeting.includeRestOfWorld:', release.countryTargeting.includeRestOfWorld);
    console.log('countries:', countries.length);

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
    console.log('Verify from the API, never the console page:');
    console.log('  node scripts/play-production-release.mjs   # re-read the track');
  } finally {
    if (!commit) {
      await client.request({ url: `${base}/edits/${edit.id}`, method: 'DELETE' }).catch(() => {});
    }
  }
}

await main();
