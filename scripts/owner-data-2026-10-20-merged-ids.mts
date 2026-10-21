/**
 * Owner data, 2026-10-20: the two Zone 2 blocks merged by
 * `owner-data-2026-10-20-export-fixes.mts` (10/14 ← `24D8F0AB…`, 10/20 ←
 * `4245078C…`) gain `mergedSourceIds`, the record `mergeIntoZone2` now writes,
 * so the app's one-time HR backfill can add the Watch's max HR to them (their
 * logged avg HR stays). DRY RUN unless `--apply`; idempotent; backed up first.
 *
 *   npx jiti scripts/owner-data-2026-10-20-merged-ids.mts --email gabrielandresbermudez@gmail.com [--apply]
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';

const PAIRS = [['Vw0iaQ5ClAVHx7Dymxo8', '24D8F0AB-583D-46D3-8E78-C735547D0358'], ['hvf1Vbiaz2LddS66PbZV', '4245078C-E1A0-4313-803C-490BC4CE181F']] as const;
const argv = process.argv.slice(2);
const email = argv[argv.indexOf('--email') + 1];
const apply = argv.includes('--apply');
initializeApp({ credential: applicationDefault(), projectId: 'fitness-tracker-gb-1775407101' });
const db = getFirestore();
const uid = (await getAuth().getUserByEmail(email)).uid;
const snaps = await Promise.all(PAIRS.map(([id]) => db.doc(`users/${uid}/workoutSessions/${id}`).get()));
const conv = (v: unknown): unknown => v instanceof Timestamp ? v.toDate().toISOString() : Array.isArray(v) ? v.map(conv)
  : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, conv(x)])) : v;
const dir = join(homedir(), 'ignia-backups');
mkdirSync(dir, { recursive: true });
const backup = join(dir, `owner-data-2026-10-20-merged-ids-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
writeFileSync(backup, JSON.stringify(conv({ uid, sessions: Object.fromEntries(snaps.map((s) => [s.id, s.data()])) }), null, 1));
console.log(`${apply ? '' : '[dry run] '}backup: ${backup}`);
const batch = db.batch();
let n = 0;
for (const [i, [id, sid]] of PAIRS.entries()) {
  const cardio = (snaps[i].get('cardio') ?? []) as Record<string, any>[];
  const at = cardio.findIndex((b) => b.label === 'Zone 2' && b.source === 'manual' && !b.sourceId);
  if (at < 0 || !(snaps[i].get('dismissedSourceIds') ?? []).includes(sid)) { console.log(`REFUSE ${id}: no merged Zone 2`); process.exit(1); }
  if ((cardio[at].mergedSourceIds ?? []).includes(sid)) { console.log(`${id}: already has mergedSourceIds`); continue; }
  const next = cardio.map((b, j) => (j === at ? { ...b, mergedSourceIds: [...(b.mergedSourceIds ?? []), sid] } : b));
  console.log(`${id}: Zone 2 ${cardio[at].durationSec}s HR ${cardio[at].avgHr} ← mergedSourceIds [${sid.slice(0, 8)}]`);
  batch.update(snaps[i].ref, { cardio: next });
  n++;
}
if (apply && n) { await batch.commit(); console.log(`Applied ${n}.`); } else if (!apply) console.log(`${n} write(s) — dry run`);
