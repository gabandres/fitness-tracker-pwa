/**
 * One-time food-log entry on the owner's account, requested 2026-10-22: Thu
 * 10/22 so far (America/Puerto_Rico). Values are the owner's, entered exactly.
 * Expected: 1,177 kcal / 104 g.
 *
 * What the read found (2026-10-22): no 10/22 food rows → all three ADDED.
 * Weight 152.6, tape 31.4 / 14.5 and height 68.5 already stored this morning
 * (`backfill-food-2026-10-22.mts`) → not touched; the app derives 13.8 % from
 * the tape (a stored %BF would outrank it — see that script). Water: none
 * stored → 24 fl oz ("24 f" in the request, read as fluid ounces).
 *
 * Saved foods (`customFoods`), added when no food of that name exists:
 *   "Pea shake v3 (no cottage)"                         499 / 64 (banana 91 g)
 *   "Pea shake v3 + ½ c Daisy 2% cottage"               589 / 77
 * The schema has no "default" flag and no notes on a saved food, so the
 * owner's 10/22 note rides on the breakfast row instead.
 *
 * Everything read is backed up to ~/ignia-backups first. Dry run unless
 * `--apply`; re-runs are no-ops (rows matched by label + values). Any 10/22
 * food row that is not one of these three → refuse.
 *
 *   TZ=America/Puerto_Rico npx jiti scripts/backfill-food-2026-10-22-meals.mts [--apply]
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, Timestamp, FieldValue } from 'firebase-admin/firestore';
import { type DocCodec, type LogEntry, toLogDoc, withDefaultMealSlot } from '../packages/core/src/index.ts';

const PROJECT_ID = 'fitness-tracker-gb-1775407101';
const EMAIL = 'gabrielandresbermudez@gmail.com';
const DAY = '2026-10-22';
const APPLY = process.argv.includes('--apply');
const at = (hhmm: string) => new Date(`${DAY}T${hhmm}:00-04:00`);

type Row = { time: string; slot: LogEntry['mealType']; label: string; kcal: number; protein: number; note?: string };
const ROWS: Row[] = [
  {
    time: '09:00', slot: 'breakfast', label: 'Pea shake v3 (no cottage)', kcal: 505, protein: 64,
    note: '3 scoops SOLO pea 210/45 · ½ c Kirkland Greek 75/13.5 · ¼ c rolled oats 75/2.5 · 1 tbsp chia 58/2 · banana 98 g 87/1 · 2 c water, cinnamon, vanilla, pinch salt. 10/22 test: no cottage held 4+ h with no hunger, vs ~3.5 h with cottage.',
  },
  {
    time: '13:00', slot: 'lunch', label: 'Patty + Havarti + veg', kcal: 582, protein: 38,
    note: 'Kirkland grass-fed beef patty 1 (151 g raw) 380/26 · Castello Havarti 1 slice (28 g) 110/6 · steamed broccoli/cauliflower/carrots ~310 g 92/6 · no tortilla, no oil',
  },
  { time: '13:20', slot: 'snack', label: 'Unreal', kcal: 90, protein: 2 },
];
const EXPECT = { kcal: 1177, protein: 104 };
const WATER_FLOZ = 24;
const FOODS = [
  { name: 'Pea shake v3 (no cottage)', calories: 499, protein: 64 },
  { name: 'Pea shake v3 + ½ c Daisy 2% cottage', calories: 589, protein: 77 },
];

initializeApp({ credential: applicationDefault(), projectId: PROJECT_ID });
const db = getFirestore();
const uid = (await getAuth().getUserByEmail(EMAIL)).uid;
const ref = db.doc(`users/${uid}`);

const logs = (await ref.collection('dailyLogs')
  .where('timestamp', '>=', Timestamp.fromDate(at('00:00')))
  .where('timestamp', '<', Timestamp.fromDate(new Date(`2026-10-23T00:00:00-04:00`)))
  .get()).docs;
const water = await ref.collection('dailyWater').doc(DAY).get();
const weight = await ref.collection('dailyWeights').doc(DAY).get();
const foods = (await ref.collection('customFoods').get()).docs;

const dir = join(homedir(), 'ignia-backups');
mkdirSync(dir, { recursive: true });
const backup = join(dir, `backfill-food-2026-10-22-meals-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
writeFileSync(backup, JSON.stringify({ logs: logs.map((d) => ({ id: d.id, ...d.data() })), water: water.data() ?? null, weight: weight.data() ?? null }, null, 2));

const matches = (d: FirebaseFirestore.QueryDocumentSnapshot, r: Row) =>
  d.get('mealLabel') === r.label && d.get('calories') === r.kcal && d.get('protein') === r.protein;
const unknown = logs.filter((d) => !ROWS.some((r) => matches(d, r)));
if (unknown.length) {
  console.log(`REFUSING — 10/22 holds food rows this script does not know:`);
  for (const d of unknown) console.log(`  ${d.id} ${d.get('mealLabel')} ${d.get('calories')}/${d.get('protein')}`);
  process.exit(1);
}

const CODEC: DocCodec<Timestamp> = { timestamp: (d) => Timestamp.fromDate(d), remove: () => FieldValue.delete() };
const plan: string[] = [];
const writes: (() => Promise<unknown>)[] = [];
for (const r of ROWS) {
  if (logs.some((d) => matches(d, r))) { console.log(`· ${r.time} ${r.label} ${r.kcal}/${r.protein} already logged`); continue; }
  const t = at(r.time);
  const doc = toLogDoc(withDefaultMealSlot({ calories: r.kcal, protein: r.protein, mealLabel: r.label, mealType: r.slot, timestamp: t, ...(r.note ? { note: r.note } : {}) }, t), CODEC);
  plan.push(`CREATE ${r.time} ${r.slot} "${r.label}" ${r.kcal}/${r.protein}${r.note ? ' + note' : ''}`);
  writes.push(() => ref.collection('dailyLogs').add(doc));
}
if (!water.exists) {
  plan.push(`CREATE water ${DAY} ${WATER_FLOZ} fl oz`);
  writes.push(() => ref.collection('dailyWater').doc(DAY).set({ flOz: WATER_FLOZ }));
} else console.log(`· water ${DAY} already ${JSON.stringify(water.data())} — not touched`);
const names = new Set(foods.map((d) => d.get('name')));
for (const f of FOODS) {
  if (names.has(f.name)) { console.log(`· saved food exists, untouched: ${f.name}`); continue; }
  plan.push(`CREATE saved food "${f.name}" ${f.calories}/${f.protein}`);
  writes.push(() => ref.collection('customFoods').add({ name: f.name, servingSize: 1, servingUnit: 'serving', calories: f.calories, protein: f.protein, source: 'manual', createdAt: Timestamp.now() }));
}
console.log(`backup: ${backup}`);
console.log(`weight ${DAY}: ${weight.exists ? JSON.stringify(weight.data()) : 'none'} (not touched)`);
console.log(`\nPLAN (${plan.length}):`);
for (const p of plan) console.log(`  → ${p}`);
if (!APPLY) { console.log('\nDry run — nothing written. Re-run with --apply.'); process.exit(0); }
for (const w of writes) await w();
const after = (await ref.collection('dailyLogs')
  .where('timestamp', '>=', Timestamp.fromDate(at('00:00')))
  .where('timestamp', '<', Timestamp.fromDate(new Date(`2026-10-23T00:00:00-04:00`)))
  .get()).docs;
const tot = after.reduce((a, d) => [a[0] + (d.get('calories') ?? 0), a[1] + (d.get('protein') ?? 0)], [0, 0]);
console.log(`\nAPPLIED ${writes.length} write(s). 10/22 now ${after.length} rows, ${tot[0]} kcal / ${tot[1]} g (expected ${EXPECT.kcal} / ${EXPECT.protein})`);
process.exit(0);
