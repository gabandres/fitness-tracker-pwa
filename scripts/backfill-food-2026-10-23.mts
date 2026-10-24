/**
 * One-time food-log entry on the owner's account, requested 2026-10-23: Fri
 * 10/23 (America/Puerto_Rico). Values are the owner's, entered exactly.
 * Expected: 1,653 kcal / 131 g. Target stays 1,850 / 140 (not touched).
 *
 * What the read found (2026-10-23):
 *   - Breakfast "Pea shake v3 (no cottage)" 505/64 already logged by the app
 *     at 09:28 (owner says 09:20) → KEPT as stored, ingredient note added.
 *   - Lunch, snack, dinner: no rows → ADDED.
 *   - Fiber is not a field anywhere (logs, saved foods, presets) → not stored;
 *     the ingredient notes carry the owner's numbers.
 *   - Saved foods have no "default" flag and no notes field. "Realgood" is not
 *     a saved food — it is the "Tortilla Good" 90/10 label logged from Recents
 *     — so there is nothing to demote or keep; the Olé tortilla is ADDED as a
 *     saved food. The oatmeal method rides on the snack row's note.
 *   - Weight 10/23 152.4 ✓, hunger 10/22 = 3 ✓, no 10/23 hunger ✓, no 10/23
 *     cardio ✓ (the two walks are 10/21 and 10/22 evenings) → not touched.
 *   - The 10/23 Push Day fixes are applied (that script's dry run plans 0).
 *
 * Everything read is backed up to ~/ignia-backups first. Dry run unless
 * `--apply`; re-runs are no-ops (rows matched by label + values). Any 10/23
 * food row that is not one of these four → refuse.
 *
 *   TZ=America/Puerto_Rico npx jiti scripts/backfill-food-2026-10-23.mts [--apply]
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
const DAY = '2026-10-23';
const APPLY = process.argv.includes('--apply');
const at = (hhmm: string) => new Date(`${DAY}T${hhmm}:00-04:00`);

const OATMEAL_METHOD =
  'Method: 1 c water + oats + chia + salt → medium until bubbling → medium-low until thick (spoon trail stays) → low 2–3, stream in egg whites stirring fast until opaque → berries 1 min → off heat vanilla/cinnamon → cover 3–5 min → honey on top.';

type Row = { time: string; slot: LogEntry['mealType']; label: string; kcal: number; protein: number; note: string };
const ROWS: Row[] = [
  {
    time: '09:20', slot: 'breakfast', label: 'Pea shake v3 (no cottage)', kcal: 505, protein: 64,
    note: '3 scoops SOLO pea 210/45 · ½ c Kirkland Greek 75/13.5 · ¼ c rolled oats 75/2.5 · 1 tbsp chia 58/2 · banana 98 g 87/1 · 2 c water, cinnamon, vanilla, salt. Fiber ~8 g.',
  },
  {
    time: '13:20', slot: 'lunch', label: 'Cheeseburger (home)', kcal: 730, protein: 39,
    note: 'Kirkland grass-fed patty 1 (151 g raw) 380/26 · cheddar slice 80/5 · sesame brioche-style bun (estimate, brand unknown) 220/7 · sautéed onions incl. fat (estimate) 50/1. Fiber ~2 g.',
  },
  {
    time: '17:40', slot: 'snack', label: 'High-fiber oatmeal (no banana)', kcal: 282, protein: 19,
    note: `⅓ c rolled oats 100/3.3 · 1 tbsp chia 58/2 · ½ c frozen wild berries 40/0.5 · ½ c liquid egg whites 63/13 · 1 tsp honey 21/0 · water, salt, vanilla, cinnamon. Fiber ~10 g. ${OATMEAL_METHOD}`,
  },
  {
    time: '17:45', slot: 'dinner', label: 'Patty ⅕ + Olé tortilla', kcal: 136, protein: 9,
    note: 'Kirkland grass-fed patty ⅕ (beef only, no cheese/onion; separate from the lunch patty) 76/5 · Olé Xtreme Wellness tortilla 1 (45 g) 60/4. Fiber ~12 g.',
  },
];
const EXPECT = { kcal: 1653, protein: 131 };

type Food = { name: string; calories: number; protein: number; brand?: string; servingSize: number; servingUnit: 'g' | 'serving'; carbs?: number; fat?: number };
const FOODS: Food[] = [
  // Label: 1 tortilla 45 g — 60 kcal · fat 1.5 (sat 0) · carbs 16 · fiber 12 · sugars 0 · protein 4 · sodium 310 mg.
  // Fiber, sat fat, sugars and sodium have no field.
  { name: 'Olé Xtreme Wellness High Fiber tortilla', brand: 'Olé', servingSize: 45, servingUnit: 'g', calories: 60, protein: 4, carbs: 16, fat: 1.5 },
  { name: 'High-fiber oatmeal (no banana)', servingSize: 1, servingUnit: 'serving', calories: 282, protein: 19 },
  { name: 'High-fiber oatmeal (no banana) + 2 tsp honey', servingSize: 1, servingUnit: 'serving', calories: 303, protein: 19 },
];

initializeApp({ credential: applicationDefault(), projectId: PROJECT_ID });
const db = getFirestore();
const uid = (await getAuth().getUserByEmail(EMAIL)).uid;
const ref = db.doc(`users/${uid}`);

const dayLogs = async () => (await ref.collection('dailyLogs')
  .where('timestamp', '>=', Timestamp.fromDate(at('00:00')))
  .where('timestamp', '<', Timestamp.fromDate(new Date(`2026-10-24T00:00:00-04:00`)))
  .get()).docs;
const logs = await dayLogs();
const foods = (await ref.collection('customFoods').get()).docs;
const weight = await ref.collection('dailyWeights').doc(DAY).get();
const hunger = await ref.collection('dailyHunger').doc(DAY).get();
const hungerPrev = await ref.collection('dailyHunger').doc('2026-10-22').get();
const targets = await ref.collection('dailyTargets').doc(DAY).get();

const dir = join(homedir(), 'ignia-backups');
mkdirSync(dir, { recursive: true });
const backup = join(dir, `backfill-food-2026-10-23-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
writeFileSync(backup, JSON.stringify({
  logs: logs.map((d) => ({ id: d.id, ...d.data() })),
  customFoods: foods.map((d) => ({ id: d.id, ...d.data() })),
  weight: weight.data() ?? null, hunger: hunger.data() ?? null, hungerPrev: hungerPrev.data() ?? null, targets: targets.data() ?? null,
}, null, 2));

const matches = (d: FirebaseFirestore.QueryDocumentSnapshot, r: Row) =>
  d.get('mealLabel') === r.label && d.get('calories') === r.kcal && d.get('protein') === r.protein;
const unknown = logs.filter((d) => !ROWS.some((r) => matches(d, r)));
if (unknown.length) {
  console.log(`REFUSING — 10/23 holds food rows this script does not know:`);
  for (const d of unknown) console.log(`  ${d.id} ${d.get('mealLabel')} ${d.get('calories')}/${d.get('protein')}`);
  process.exit(1);
}

const CODEC: DocCodec<Timestamp> = { timestamp: (d) => Timestamp.fromDate(d), remove: () => FieldValue.delete() };
const hhmm = (d: Date) => d.toLocaleTimeString('en-GB', { timeZone: 'America/Puerto_Rico', hour: '2-digit', minute: '2-digit' });
const plan: string[] = [];
const writes: (() => Promise<unknown>)[] = [];
for (const r of ROWS) {
  const have = logs.find((d) => matches(d, r));
  if (have) {
    const stored = hhmm(have.get('timestamp').toDate());
    if (stored !== r.time) console.log(`  MISMATCH ${r.label}: logged at ${stored}, owner says ${r.time} — time kept`);
    if (have.get('note') === r.note) { console.log(`· ${r.label} ${r.kcal}/${r.protein} already logged with its note`); continue; }
    if (have.get('note') != null) { console.log(`· ${r.label}: has a different note — not overwritten`); continue; }
    plan.push(`UPDATE ${have.id} "${r.label}" — add ingredient note`);
    writes.push(() => have.ref.update({ note: r.note }));
    continue;
  }
  const t = at(r.time);
  const doc = toLogDoc(withDefaultMealSlot({ calories: r.kcal, protein: r.protein, mealLabel: r.label, mealType: r.slot, timestamp: t, note: r.note }, t), CODEC);
  plan.push(`CREATE ${r.time} ${r.slot} "${r.label}" ${r.kcal}/${r.protein} + note`);
  writes.push(() => ref.collection('dailyLogs').add(doc));
}
const names = new Set(foods.map((d) => d.get('name')));
for (const f of FOODS) {
  if (names.has(f.name)) { console.log(`· saved food exists, untouched: ${f.name}`); continue; }
  plan.push(`CREATE saved food "${f.name}" ${f.calories}/${f.protein}${f.carbs != null ? ` (C ${f.carbs} F ${f.fat}, ${f.servingSize} ${f.servingUnit})` : ''}`);
  writes.push(() => ref.collection('customFoods').add({ ...f, source: 'manual', createdAt: Timestamp.now() }));
}
const shake = foods.find((d) => d.get('name') === 'Pea shake v3 (no cottage)');
if (shake && shake.get('calories') !== 505) console.log(`  MISMATCH saved "Pea shake v3 (no cottage)": ${shake.get('calories')}/${shake.get('protein')} (banana 91 g) vs today's 505/64 (98 g) — kept`);

console.log(`backup: ${backup}`);
console.log(`weight ${DAY}: ${weight.exists ? JSON.stringify(weight.data()) : 'none'} (not touched)`);
console.log(`hunger 10/22: ${JSON.stringify(hungerPrev.data() ?? null)} · hunger ${DAY}: ${JSON.stringify(hunger.data() ?? null)} (not touched)`);
console.log(`targets ${DAY}: ${targets.get('kcalTarget')} / ${targets.get('proteinTarget')}, maintenance ${targets.get('maintenanceEstimate')} (${targets.get('maintenanceSource')}) (not touched)`);
console.log(`\nPLAN (${plan.length}):`);
for (const p of plan) console.log(`  → ${p}`);
if (!APPLY) { console.log('\nDry run — nothing written. Re-run with --apply.'); process.exit(0); }
for (const w of writes) await w();
const after = await dayLogs();
const tot = after.reduce((a, d) => [a[0] + (d.get('calories') ?? 0), a[1] + (d.get('protein') ?? 0)], [0, 0]);
console.log(`\nAPPLIED ${writes.length} write(s). 10/23 now ${after.length} rows, ${tot[0]} kcal / ${tot[1]} g (expected ${EXPECT.kcal} / ${EXPECT.protein})`);
process.exit(0);
