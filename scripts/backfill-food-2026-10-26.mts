/**
 * One-time food-log entry on the owner's account, requested 2026-10-26: Mon
 * 10/26 (America/Puerto_Rico), rest day. Values are the owner's, entered
 * exactly. Expected: 1,908 kcal / 158.5 g. Target stays 1,850 / 140 (not
 * touched — the owner considered maintenance and chose to stay lean).
 *
 * What the read found (2026-10-26):
 *   - One 10/26 row: "Stack + Eggs + Bacons" 10:35 498/54 — same numbers as
 *     the owner's breakfast, different label and time → UPDATED in place to
 *     08:50 "Pancake + eggs + Canadian bacon" + the parts as its note.
 *   - Weight 10/26 none → 152.0 CREATED.
 *   - Hunger 10/26 null → left null (owner enters it). `dailyHunger` holds
 *     only `level`, so the "starving ~15:40" note rides on the 15:45 snack row.
 *   - "Day fully logged" already true.
 *   - Saved foods: no pancake food, no "Lean pea shake (evening)" → both
 *     CREATED. `customFoods` has no notes field, so the recipe's note and the
 *     batch's remaining pieces are reported, not stored. There is no shopping
 *     list in the app.
 *
 * Everything read is backed up to ~/ignia-backups first. Dry run unless
 * `--apply`; re-runs are no-ops. Any 10/26 row not listed here → refuse.
 *
 *   TZ=America/Puerto_Rico npx jiti scripts/backfill-food-2026-10-26.mts [--apply]
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, Timestamp, FieldValue } from 'firebase-admin/firestore';
import {
  type DailyLog, type DocCodec, type LogEntry, type Profile,
  LOG_WINDOW_ROWS, dailyTargets, mergeDailyWeights, dayBoundaryOf, toDailyLog, toLogDoc, withDefaultMealSlot,
} from '../packages/core/src/index.ts';

const PROJECT_ID = 'fitness-tracker-gb-1775407101';
const EMAIL = 'gabrielandresbermudez@gmail.com';
const DAY = '2026-10-26';
const APPLY = process.argv.includes('--apply');
const at = (hhmm: string) => new Date(`${DAY}T${hhmm}:00-04:00`);
const WEIGHT = 152.0;

type Row = { time: string; slot: LogEntry['mealType']; label: string; kcal: number; protein: number; note?: string; grams?: number };
const ROWS: Row[] = [
  { time: '08:50', slot: 'breakfast', label: 'Pancake + eggs + Canadian bacon', kcal: 498, protein: 54,
    note: 'Build C pancake 145 g 283/32 (10/25 batch, 1.95 kcal / 0.22 g protein per g) · 2 eggs 120/12 · Jones Canadian bacon 3 slices 60/10 · butter ~1 tsp 35/0.' },
  { time: '11:15', slot: 'snack', label: 'Kirkland protein bar', kcal: 190, protein: 21 },
  { time: '12:20', slot: 'lunch', label: 'Quesabirria tacos ×2', kcal: 760, protein: 36, grams: 290,
    note: 'Tared 185 g + 105 g = 290 g. Est. 2.6 kcal/g (range 2.2–2.7); no consommé dip; user chose to keep the high estimate.' },
  { time: '15:45', slot: 'snack', label: 'Fresh mango ½ c', kcal: 50, protein: 0.5,
    note: 'Shared with wife. Hunger: starving ~15:40, ~3½ h after the tacos (fatty, low-fiber meal held poorly).' },
  { time: '17:40', slot: 'dinner', label: 'Lean pea shake + banana', kcal: 410, protein: 47,
    note: '2 scoops SOLO pea 140/30 · ¼ c rolled oats 75/2.5 · ½ c Kirkland Greek 75/13.5 · ½ c wild berries 40/0.5 · banana ~90 g 80/1 · 1½ c water, cinnamon, vanilla, salt. No chia (out of stock).' },
];
/** The row already on 10/26 (logged by the owner at 10:35), corrected in place to ROWS[0]. */
const EXISTING = { label: 'Stack + Eggs + Bacons', kcal: 498, protein: 54 };
const EXPECT = { kcal: 1908, protein: 158.5 };

const FOODS = [
  // Per 100 g so the remaining pieces (248 / 160 / 157 g) log by weight.
  { name: 'Build C pancake — 2026-10-25 batch', servingSize: 100, servingUnit: 'g', calories: 195, protein: 22 },
  { name: 'Lean pea shake (evening)', servingSize: 1, servingUnit: 'serving', calories: 410, protein: 47 },
];

initializeApp({ credential: applicationDefault(), projectId: PROJECT_ID });
const db = getFirestore();
const uid = (await getAuth().getUserByEmail(EMAIL)).uid;
const ref = db.doc(`users/${uid}`);

const dayLogs = async () => (await ref.collection('dailyLogs')
  .where('timestamp', '>=', Timestamp.fromDate(at('00:00')))
  .where('timestamp', '<', Timestamp.fromDate(new Date('2026-10-27T00:00:00-04:00')))
  .get()).docs;
const logs = await dayLogs();
const weight = await ref.collection('dailyWeights').doc(DAY).get();
const hunger = await ref.collection('dailyHunger').doc(DAY).get();
const targets = await ref.collection('dailyTargets').doc(DAY).get();
const foods = (await ref.collection('customFoods').get()).docs;

const dir = join(homedir(), 'ignia-backups');
mkdirSync(dir, { recursive: true });
const backup = join(dir, `backfill-food-2026-10-26-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
writeFileSync(backup, JSON.stringify({
  logs: logs.map((d) => ({ id: d.id, ...d.data() })),
  weight: weight.data() ?? null, hunger: hunger.data() ?? null, targets: targets.data() ?? null,
  customFoods: foods.map((d) => ({ id: d.id, ...d.data() })),
}, null, 2));

const isRow = (d: FirebaseFirestore.QueryDocumentSnapshot) =>
  ROWS.find((r) => d.get('mealLabel') === r.label && d.get('calories') === r.kcal && d.get('protein') === r.protein);
const isExisting = (d: FirebaseFirestore.QueryDocumentSnapshot) =>
  d.get('mealLabel') === EXISTING.label && d.get('calories') === EXISTING.kcal && d.get('protein') === EXISTING.protein;
const problems = logs.filter((d) => !isRow(d) && !isExisting(d)).map((d) => `unknown row ${d.id} "${d.get('mealLabel')}" ${d.get('calories')}/${d.get('protein')}`);
if (problems.length) {
  console.log('REFUSING — 10/26 no longer matches the read:');
  for (const p of problems) console.log(`  ✗ ${p}`);
  process.exit(1);
}
if (weight.exists && weight.get('weight') !== WEIGHT) {
  console.log(`REFUSING — weight ${DAY} is ${weight.get('weight')}, not ${WEIGHT}`);
  process.exit(1);
}

const CODEC: DocCodec<Timestamp> = { timestamp: (d) => Timestamp.fromDate(d), remove: () => FieldValue.delete() };
const plan: string[] = [];
const writes: (() => Promise<unknown>)[] = [];
for (const r of ROWS) {
  const old = logs.find(isExisting);
  if (r.slot === 'breakfast' && old) {
    plan.push(`UPDATE ${old.id} "${EXISTING.label}" 10:35 ${EXISTING.kcal}/${EXISTING.protein} → ${r.time} "${r.label}" ${r.kcal}/${r.protein} + note`);
    writes.push(() => old.ref.update({ mealLabel: r.label, note: r.note, timestamp: Timestamp.fromDate(at(r.time)), mealType: r.slot }));
    continue;
  }
  if (logs.some((d) => isRow(d) === r)) { console.log(`· ${r.label} ${r.kcal}/${r.protein} already logged`); continue; }
  const t = at(r.time);
  const doc = toLogDoc(withDefaultMealSlot({
    calories: r.kcal, protein: r.protein, mealLabel: r.label, mealType: r.slot, timestamp: t,
    ...(r.note ? { note: r.note } : {}), ...(r.grams ? { grams: r.grams } : {}),
  }, t), CODEC);
  plan.push(`CREATE ${r.time} ${r.slot} "${r.label}" ${r.kcal}/${r.protein}${r.grams ? ` ${r.grams} g` : ''}${r.note ? ' + note' : ''}`);
  writes.push(() => ref.collection('dailyLogs').add(doc));
}
if (!weight.exists) {
  plan.push(`CREATE weight ${DAY} ${WEIGHT}`);
  writes.push(() => ref.collection('dailyWeights').doc(DAY).set({ weight: WEIGHT }));
}
for (const f of FOODS) {
  if (foods.some((d) => d.get('name') === f.name)) { console.log(`· saved food "${f.name}" already exists`); continue; }
  plan.push(`CREATE saved food "${f.name}" ${f.servingSize} ${f.servingUnit} ${f.calories}/${f.protein}`);
  writes.push(() => ref.collection('customFoods').add({ ...f, source: 'manual', createdAt: FieldValue.serverTimestamp() }));
}

async function report(label: string) {
  const prof = (await ref.get()).data() as Profile;
  const rows: DailyLog[] = (await ref.collection('dailyLogs').orderBy('timestamp', 'desc').limit(LOG_WINDOW_ROWS).get()).docs.map((d) => toDailyLog(d.id, d.data()));
  const weights = Object.fromEntries((await ref.collection('dailyWeights').get()).docs.map((d) => [d.id, d.get('weight') as number]));
  const dayComplete = Object.fromEntries((await ref.collection('dailyLogged').get()).docs.map((d) => [d.id, d.get('complete') as boolean]));
  const t = dailyTargets(prof, mergeDailyWeights(rows, weights, dayBoundaryOf(prof)), weights, new Date(), dayComplete);
  const week = Object.entries(weights).filter(([k]) => k > '2026-10-19' && k <= DAY);
  const avg = week.reduce((a, [, w]) => a + w, 0) / week.length;
  console.log(`[${label}] maintenance ${Math.round(t.tdee.trueTdee)} (${t.tdee.source}) · target ${t.calorieTarget}/${t.proteinTarget} · 7-day weight avg ${avg.toFixed(2)} (n=${week.length}: ${week.map(([k, w]) => `${k.slice(5)} ${w}`).join(', ')})`);
}

console.log(`backup: ${backup}`);
console.log(`weight ${DAY}: ${JSON.stringify(weight.data() ?? null)} · hunger ${DAY}: ${JSON.stringify(hunger.data() ?? null)} (left null)`);
console.log(`targets ${DAY} (stored): ${targets.get('kcalTarget')} / ${targets.get('proteinTarget')}, maintenance ${targets.get('maintenanceEstimate')} (${targets.get('maintenanceSource')})`);
console.log(`\nPLAN (${plan.length}):`);
for (const p of plan) console.log(`  → ${p}`);
await report('before');
if (!APPLY) { console.log('\nDry run — nothing written. Re-run with --apply.'); process.exit(0); }
for (const w of writes) await w();
const after = await dayLogs();
const tot = after.reduce((a, d) => [a[0] + (d.get('calories') ?? 0), a[1] + (d.get('protein') ?? 0)], [0, 0]);
console.log(`\nAPPLIED ${writes.length} write(s). 10/26 now ${after.length} rows, ${tot[0]} kcal / ${tot[1]} g (expected ${EXPECT.kcal} / ${EXPECT.protein})`);
await report('after');
process.exit(0);
