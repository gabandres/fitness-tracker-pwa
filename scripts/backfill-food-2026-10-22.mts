/**
 * One-time data entry, requested 2026-10-22 (America/Puerto_Rico): Wed 10/21
 * and Thu 10/22 for the owner, plus one correction on Stephanie's 10/21
 * breakfast. Values are the owner's, entered exactly — never recomputed.
 *
 * What the read found (each row checked by id AND value; any drift → refuse):
 *   - Owner 10/21: all six food rows already logged, totalling exactly the
 *     expected 1,713 / 174 → KEPT. The dinner row "Oatmeal (Lean)" is already
 *     369 / 21 (no 409 berries version exists).
 *   - Owner 10/22: weight 152.6 already stored → KEPT. No tape on 10/22 →
 *     ADDED (waist 31.4 = the median the owner gave, neck 14.5).
 *   - Owner height 68 in → 68.5 (owner's instruction, only if exactly 68).
 *   - Stephanie 10/21 "Shake" 446 / 60 → 449 / 60.4 (+ ½ c spinach, 3 / 0.4),
 *     with a note.
 *   - Saved foods: the oatmeal base and its two variants, added when no food
 *     of that name exists; an existing one is never overwritten.
 *
 * Deliberately NOT written (reported instead):
 *   - Steps 10/21: 7,350 stored (device), owner says 7,300 → mismatch, kept.
 *   - Hunger 10/21: level 1 stored, owner says not rated → mismatch, kept.
 *   - bodyFatPct 13.8: a stored %BF ('other') outranks the app's own Navy
 *     estimate for that day (`compositionPoints`), and a lone 'other' reading
 *     is dropped from the composition fit — it would REMOVE the 10/22 tape from
 *     the Navy series. The app derives 13.8 from the tape at height 68.5.
 *   - The three waist readings: the schema has one waist per row, and the app
 *     medians same-day rows (31.375 → 13.7 %), not the owner's 31.4 (→ 13.8 %).
 *
 * Everything read is backed up to ~/ignia-backups first. Dry run unless
 * `--apply`; re-runs are no-ops.
 *
 *   TZ=America/Puerto_Rico npx jiti scripts/backfill-food-2026-10-22.mts [--apply]
 *
 * Auth: ADC (`gcloud auth application-default login`).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import {
  type DailyLog,
  type Profile,
  LOG_WINDOW_ROWS,
  dailyTargets,
  navyBodyFatPct,
  toDailyLog,
  trendWeightSeries,
} from '../packages/core/src/index.ts';

const PROJECT_ID = 'fitness-tracker-gb-1775407101';
const OWNER = 'gabrielandresbermudez@gmail.com';
const STEPH = 'stph.ctllo@gmail.com';
const APPLY = process.argv.includes('--apply');
const at = (local: string) => Timestamp.fromDate(new Date(`${local}-04:00`));

/** Owner 10/21 rows as read 2026-10-22 — verified, never written. */
const OWNER_1021: Record<string, { label: string; kcal: number; protein: number }> = {
  zqDNTpNKEWTVjwDHuzZ3: { label: 'Shake', kcal: 589, protein: 77 },
  tqvn1DytdH9qw3e9NWPg: { label: 'Unreal', kcal: 90, protein: 2 },
  LGxqReyPuMRivBPbTXfa: { label: 'Chicken Wrap', kcal: 385, protein: 43 },
  DBV9vbNOrts37UuQ2Ae5: { label: 'Tortilla Good', kcal: 90, protein: 10 },
  WiYBbVg0GXUul6F6rIYF: { label: 'Kirkland PB', kcal: 190, protein: 21 },
  isV5tAuauTmWcnbXRu4z: { label: 'Oatmeal (Lean)', kcal: 369, protein: 21 },
};
const STEPH_BREAKFAST = { id: '2qaFBfuh69SMAGliRTqb', label: 'Shake', from: { kcal: 446, protein: 60 }, to: { kcal: 449, protein: 60.4 } };
const STEPH_NOTE = '+ ½ cup spinach (added after logging): 3 kcal / 0.4 g';
const TAPE = { day: '2026-10-22', time: '2026-10-22T07:00:00', waist: 31.4, neck: 14.5 };
const HEIGHT = { from: 68, to: 68.5 };
const FOODS = [
  { name: 'Banana chia oatmeal (egg white)', calories: 369, protein: 21 },
  { name: 'Banana chia oatmeal (egg white) + wild berries (½ cup)', calories: 409, protein: 21.5 },
  { name: 'Banana chia oatmeal (egg white) + honey (1 tsp)', calories: 390, protein: 21 },
];

initializeApp({ credential: applicationDefault(), projectId: PROJECT_ID });
const db = getFirestore();
const auth = getAuth();
const problems: string[] = [];
const plan: string[] = [];
const report: string[] = [];

const owner = await auth.getUserByEmail(OWNER);
const steph = await auth.getUserByEmail(STEPH);
const oRef = db.doc(`users/${owner.uid}`);
const sRef = db.doc(`users/${steph.uid}`);

// ── Read ─────────────────────────────────────────────────────────────
const profileSnap = await oRef.get();
const profile = profileSnap.data() as Profile & { heightIn?: number };
const range = async (ref: FirebaseFirestore.DocumentReference, from: string, to: string) =>
  (await ref.collection('dailyLogs').where('timestamp', '>=', at(from)).where('timestamp', '<', at(to)).get()).docs;
const o1021 = await range(oRef, '2026-10-21T00:00:00', '2026-10-22T00:00:00');
const o1022 = await range(oRef, '2026-10-22T00:00:00', '2026-10-23T00:00:00');
const sLog = await sRef.collection('dailyLogs').doc(STEPH_BREAKFAST.id).get();
const weight1022 = (await oRef.collection('dailyWeights').doc('2026-10-22').get()).data();
const activity1021 = (await oRef.collection('dailyActivity').doc('2026-10-21').get()).data();
const hunger1021 = (await oRef.collection('dailyHunger').doc('2026-10-21').get()).data();
const tapes = (await oRef.collection('measurements').get()).docs;
const foods = (await oRef.collection('customFoods').get()).docs;

const backupDir = join(homedir(), 'ignia-backups');
mkdirSync(backupDir, { recursive: true });
const backup = join(backupDir, `backfill-food-2026-10-22-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
writeFileSync(
  backup,
  JSON.stringify(
    {
      profile: { heightIn: profile.heightIn },
      owner1021: o1021.map((d) => ({ id: d.id, ...d.data() })),
      owner1022: o1022.map((d) => ({ id: d.id, ...d.data() })),
      stephBreakfast: sLog.exists ? { id: sLog.id, ...sLog.data() } : null,
      weight1022, activity1021, hunger1021,
      measurements: tapes.map((d) => ({ id: d.id, ...d.data() })),
      customFoods: foods.map((d) => ({ id: d.id, ...d.data() })),
    },
    null,
    2,
  ),
);

// ── Verify ───────────────────────────────────────────────────────────
const sum = (docs: FirebaseFirestore.QueryDocumentSnapshot[]) =>
  docs.reduce((a, d) => [a[0] + (d.get('calories') ?? 0), a[1] + (d.get('protein') ?? 0)], [0, 0]);
const ids1021 = new Set(o1021.map((d) => d.id));
for (const [id, want] of Object.entries(OWNER_1021)) {
  const d = o1021.find((x) => x.id === id);
  if (!d) problems.push(`owner 10/21 row ${id} (${want.label}) is gone`);
  else if (d.get('calories') !== want.kcal || d.get('protein') !== want.protein || d.get('mealLabel') !== want.label)
    problems.push(`owner 10/21 row ${id} drifted: ${d.get('mealLabel')} ${d.get('calories')}/${d.get('protein')}`);
}
for (const id of ids1021) if (!OWNER_1021[id]) problems.push(`owner 10/21 has an unexpected row ${id}`);

const s = sLog.data();
const stephDone = s?.calories === STEPH_BREAKFAST.to.kcal && s?.protein === STEPH_BREAKFAST.to.protein && s?.note === STEPH_NOTE;
if (!s) problems.push('Stephanie breakfast row is gone');
else if (!stephDone && (s.calories !== STEPH_BREAKFAST.from.kcal || s.protein !== STEPH_BREAKFAST.from.protein || s.mealLabel !== STEPH_BREAKFAST.label || s.note != null))
  problems.push(`Stephanie breakfast drifted: ${s.mealLabel} ${s.calories}/${s.protein} note=${s.note ?? '–'}`);

if (profile.heightIn !== HEIGHT.from && profile.heightIn !== HEIGHT.to)
  problems.push(`height is ${profile.heightIn}, neither ${HEIGHT.from} nor ${HEIGHT.to}`);
if (weight1022?.weight !== 152.6) problems.push(`10/22 weight is ${weight1022?.weight}, expected 152.6`);

const tapeOn1022 = tapes.filter((d) => {
  const t = (d.get('timestamp') as Timestamp).toDate();
  return t >= at('2026-10-22T00:00:00').toDate() && t < at('2026-10-23T00:00:00').toDate();
});
const tapeDone = tapeOn1022.some((d) => d.get('waist') === TAPE.waist && d.get('neck') === TAPE.neck);
if (tapeOn1022.length && !tapeDone) problems.push(`10/22 already holds a different tape: ${JSON.stringify(tapeOn1022.map((d) => d.data()))}`);

// ── Plan ─────────────────────────────────────────────────────────────
const writes: (() => Promise<unknown>)[] = [];
if (profile.heightIn === HEIGHT.from) {
  plan.push(`UPDATE profile heightIn ${HEIGHT.from} → ${HEIGHT.to}`);
  writes.push(() => oRef.update({ heightIn: HEIGHT.to }));
} else report.push(`height already ${HEIGHT.to}`);
if (!tapeDone) {
  plan.push(`CREATE measurement 10/22 07:00 waist ${TAPE.waist} neck ${TAPE.neck}`);
  writes.push(() => oRef.collection('measurements').add({ timestamp: at(TAPE.time), waist: TAPE.waist, neck: TAPE.neck }));
} else report.push('10/22 tape already stored');
const names = new Set(foods.map((d) => d.get('name')));
for (const f of FOODS) {
  if (names.has(f.name)) { report.push(`saved food exists, untouched: ${f.name}`); continue; }
  plan.push(`CREATE saved food "${f.name}" ${f.calories} / ${f.protein}`);
  writes.push(() =>
    oRef.collection('customFoods').add({ name: f.name, servingSize: 1, servingUnit: 'serving', calories: f.calories, protein: f.protein, source: 'manual', createdAt: Timestamp.now() }),
  );
}
if (s && !stephDone) {
  plan.push(`UPDATE Stephanie ${STEPH_BREAKFAST.id} ${s.calories}/${s.protein} → ${STEPH_BREAKFAST.to.kcal}/${STEPH_BREAKFAST.to.protein} + note`);
  writes.push(() => sRef.collection('dailyLogs').doc(STEPH_BREAKFAST.id).update({ calories: STEPH_BREAKFAST.to.kcal, protein: STEPH_BREAKFAST.to.protein, note: STEPH_NOTE }));
} else if (stephDone) report.push('Stephanie breakfast already updated');

report.push(`steps 10/21 stored ${activity1021?.steps} (owner: 7,300) — mismatch, NOT written; activeKcal ${activity1021?.activeKcal}`);
report.push(`hunger 10/21 stored level ${hunger1021?.level} (owner: not rated) — mismatch, NOT written`);

// ── Numbers, with the app's own functions ────────────────────────────
async function numbers(label: string) {
  const prof = (await oRef.get()).data() as Profile & { heightIn?: number };
  const logsSnap = await oRef.collection('dailyLogs').orderBy('timestamp', 'desc').limit(LOG_WINDOW_ROWS).get();
  const logs: DailyLog[] = logsSnap.docs.map((d) => toDailyLog(d.id, d.data()));
  const wSnap = await oRef.collection('dailyWeights').get();
  const weights: Record<string, number> = Object.fromEntries(wSnap.docs.map((d) => [d.id, d.get('weight') as number]));
  const t = dailyTargets(prof, logs, weights, new Date());
  const series = trendWeightSeries(Object.entries(weights).map(([dateKey, weightLb]) => ({ dateKey, weightLb })));
  const last = series.slice(-8).map((p) => `${p.dateKey.slice(5)} ${p.weightLb.toFixed(2)}`).join(', ');
  const navy = navyBodyFatPct({ sex: 'male', heightIn: prof.heightIn!, waistIn: TAPE.waist, neckIn: TAPE.neck });
  console.log(`\n[${label}] height ${prof.heightIn} · maintenance ${Math.round(t.tdee.trueTdee)} (${t.tdee.source}) · weightChangeTrend ${t.tdee.weightChangeTrend} lb · target ${t.calorieTarget}/${t.proteinTarget}`);
  console.log(`[${label}] trend weight (last 8): ${last}`);
  console.log(`[${label}] Navy %BF from 31.4/14.5 at this height: ${navy.ok ? navy.pct.toFixed(1) : 'n/a'}`);
}

console.log(`backup: ${backup}`);
console.log(`owner 10/21 total ${sum(o1021).join(' / ')} (${o1021.length} rows) · owner 10/22 total ${sum(o1022).join(' / ')} (${o1022.length} rows)`);
for (const r of report) console.log(`· ${r}`);
if (problems.length) {
  console.log('\nREFUSING — the data no longer matches the read:');
  for (const p of problems) console.log(`  ✗ ${p}`);
  process.exit(1);
}
console.log(`\nPLAN (${plan.length}):`);
for (const p of plan) console.log(`  → ${p}`);
await numbers('before');
if (!APPLY) {
  console.log('\nDry run — nothing written. Re-run with --apply.');
  process.exit(0);
}
for (const w of writes) await w();
console.log(`\nAPPLIED ${writes.length} write(s).`);
await numbers('after');
process.exit(0);
