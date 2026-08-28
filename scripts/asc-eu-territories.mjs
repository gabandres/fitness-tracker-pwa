#!/usr/bin/env node
// Open (or preview) iOS availability in the 30 territories currently held back:
// the EU 27 plus GBR, ISL and NOR.
//
// ─────────────────────────────────────────────────────────────────────────────
// WHY THIS SCRIPT REFUSES TO RUN BY DEFAULT
//
// EU distribution triggers Apple's **Digital Services Act trader declaration**,
// which PUBLISHES the trader's name, postal address, phone number and email on
// every EU product page. `play-production-release.mjs` states the project's
// position on that in its own header, and this script holds the same line:
// it is "a disclosure the owner makes personally, not one to stumble into by
// ticking a box".
//
// So the declaration is NOT automated here, and the ordering is the whole
// hazard. Flip these 30 while the LLC entity still declares *"I'm not a trader
// under the DSA"* and the app is **removed from all 27 EU territories** — a
// worse position than the one it is in now, and one that costs a re-review to
// leave. `--commit` therefore also requires `--trader-status-is-live`, which is
// the owner asserting they have set it. There is no API that reports it.
//
// Set it first at: App Store Connect → Business → Trader Status, on the
// **Bermudez Systems LLC** entity (id 94754902), using the Sheridan address,
// +1 307 201 8420 and gabriel@bermudezsystems.com — never the personal number.
//
// ─────────────────────────────────────────────────────────────────────────────
// THE API SHAPE, WHICH COST TWO FAILED ATTEMPTS BEFORE IT WAS WRITTEN DOWN
//
// `POST /v2/appAvailabilities` is a CREATE and 409s once an availability record
// exists — it always does, post-launch. The mutation path is
// `PATCH /v1/territoryAvailabilities/{id}`, ONE TERRITORY AT A TIME, using the
// opaque ids from `GET /v2/appAvailabilities/{app}/territoryAvailabilities`.
// Those ids are not country codes and must be read, never constructed.
//
// `availableInNewTerritories` is deliberately FALSE on the app and this script
// never touches it: a territory Apple adds later must not be opted in silently,
// which is how the carve-out would otherwise defeat itself.
//
// ─────────────────────────────────────────────────────────────────────────────
// USAGE
//
//   node scripts/asc-eu-territories.mjs                  # preview, changes nothing
//   node scripts/asc-eu-territories.mjs --commit --trader-status-is-live
import { api, APP_ID } from './asc-client.mjs';

/** The EU 27, as ISO 3166-1 alpha-3 — the form ASC reports. */
const EU_27 = [
  'AUT', 'BEL', 'BGR', 'HRV', 'CYP', 'CZE', 'DNK', 'EST', 'FIN', 'FRA',
  'DEU', 'GRC', 'HUN', 'IRL', 'ITA', 'LVA', 'LTU', 'LUX', 'MLT', 'NLD',
  'POL', 'PRT', 'ROU', 'SVK', 'SVN', 'ESP', 'SWE',
];

/** Not EU members, but held back for the same reason: the UK, Iceland and
 *  Norway carry equivalent trader-disclosure regimes. */
const EEA_ADJACENT = ['GBR', 'ISL', 'NOR'];

const TARGET = [...EU_27, ...EEA_ADJACENT];

const args = process.argv.slice(2);
const commit = args.includes('--commit');
const traderOk = args.includes('--trader-status-is-live');

const res = await api(
  'GET',
  `/v2/appAvailabilities/${APP_ID}/territoryAvailabilities?limit=200&include=territory`,
);
const rows = res.data ?? [];
const codeOf = (r) => r.relationships?.territory?.data?.id;

const available = rows.filter((r) => r.attributes?.available);
const blocked = rows.filter((r) => !r.attributes?.available);
const blockedCodes = blocked.map(codeOf).sort();

console.log(`territories: ${rows.length} · available ${available.length} · blocked ${blocked.length}`);
console.log(`blocked: ${blockedCodes.join(' ')}`);

const unexpected = blockedCodes.filter((c) => !TARGET.includes(c));
const alreadyOpen = TARGET.filter((c) => !blockedCodes.includes(c));
if (unexpected.length) {
  console.log(`\nNOT in the target list but blocked — left alone: ${unexpected.join(' ')}`);
}
if (alreadyOpen.length) {
  console.log(`already open, nothing to do: ${alreadyOpen.join(' ')}`);
}

const toOpen = blocked.filter((r) => TARGET.includes(codeOf(r)));
if (!toOpen.length) {
  console.log('\nNothing to open. Exiting.');
  process.exit(0);
}

if (!commit) {
  console.log(`\nWOULD OPEN ${toOpen.length}: ${toOpen.map(codeOf).sort().join(' ')}`);
  console.log('Preview only. Re-run with --commit --trader-status-is-live to apply.');
  process.exit(0);
}

if (!traderOk) {
  console.error(
    '\nREFUSING. --commit requires --trader-status-is-live.\n' +
      'Opening the EU 27 without a DSA trader declaration gets the app REMOVED\n' +
      'from all 27 EU territories. Set it at App Store Connect -> Business ->\n' +
      'Trader Status on the Bermudez Systems LLC entity first, then re-run.',
  );
  process.exit(1);
}

let ok = 0;
for (const row of toOpen) {
  const code = codeOf(row);
  try {
    await api('PATCH', `/v1/territoryAvailabilities/${row.id}`, {
      data: {
        type: 'territoryAvailabilities',
        id: row.id,
        attributes: { available: true },
      },
    });
    ok += 1;
    console.log(`  opened ${code}`);
  } catch (e) {
    console.error(`  FAILED ${code}: ${e.message}`);
  }
}
console.log(`\n${ok}/${toOpen.length} opened.`);
console.log(
  'Re-read with: node scripts/asc-eu-territories.mjs  (expect 175 available, 0 blocked)',
);
