/**
 * Owner data, requested 2026-11-23 (America/Puerto_Rico): log 11/23's lunch and
 * afternoon snack, two Quick adds, day left open. Values are the owner's,
 * entered exactly.
 *
 * What the read found (2026-11-23, `scripts/user-state.mts`):
 *
 *   11/23 meals   one row: 09:30 breakfast "Pancake + 1 egg + Canadian bacon"
 *                 425/50 [XPaIADm0X3FPyKA5Otfx] — checked, not touched. Lunch
 *                 and snack are created → 1,031 / 85. "Fully logged" is unset
 *                 and stays unset: a David bar (~17:00, 150/28) and protein
 *                 oats + banana (~20:30, 410/35) are still planned, not logged.
 *   Quick add     `presets`, where the sibling "Sweet kale salad, no dressing
 *                 (1 cup)" 90/3 lives. Both new names are absent. Left alone:
 *                 that kale salad, "Bunless patty plate …" 465/33 and My Foods
 *                 "Banana, raw" 89/1.1 and the Kirkland patty 380/26.
 *
 * No steps, no targets, no maintenance inputs (ADR-0024). Dry run unless
 * `--apply`; a re-run plans nothing.
 *
 *   npx jiti scripts/owner-data-2026-11-23-lunch.mts [--apply]
 */
import { Timestamp, type DocumentReference } from 'firebase-admin/firestore';
import { LOG_LABEL_MAX, LOG_NOTE_MAX } from '../packages/core/src/index.ts';
import { at, hm, open } from './lib/user-data.mts';

const OWNER = 'gabrielandresbermudez@gmail.com';
const DAY = '2026-11-23';
const s = await open('owner-data-2026-11-23-lunch');
const owner = await s.user(OWNER);

const dayRows = async (user: DocumentReference, day: string) => (await user.collection('dailyLogs')
  .where('timestamp', '>=', Timestamp.fromDate(at(day, '00:00')))
  .where('timestamp', '<', Timestamp.fromDate(new Date(at(day, '00:00').getTime() + 86_400_000)))
  .orderBy('timestamp').get()).docs;

const BREAKFAST = { id: 'XPaIADm0X3FPyKA5Otfx', label: 'Pancake + 1 egg + Canadian bacon', kcal: 425, protein: 50 };
const MEALS = [
  {
    day: DAY, time: '13:10', slot: 'lunch' as const, label: 'Patty + sweet kale salad + mushrooms', kcal: 525, protein: 34,
    note: 'Kirkland grass-fed patty ×1 (151 g raw) 380/26 · sweet kale chopped salad 174 g total (weighed, includes dried cranberries and pumpkin seeds; no dressing) ~120/6 · mushrooms cooked with the patty, no added oil ~25/2. No tortillas, no cheese.',
  },
  {
    day: DAY, time: '13:30', slot: 'snack' as const, label: 'Banana + black coffee', kcal: 81, protein: 1,
    note: 'Banana ~91 g (usual size, not weighed) 81/1 · black coffee, no milk or sugar 0. No UNREAL today.',
  },
];

const rows = await dayRows(owner, DAY);
const bf = rows.find((d) => d.id === BREAKFAST.id);
if (!bf || bf.get('mealLabel') !== BREAKFAST.label || bf.get('calories') !== BREAKFAST.kcal || bf.get('protein') !== BREAKFAST.protein) s.problem(`breakfast ${BREAKFAST.id} is not "${BREAKFAST.label}" ${BREAKFAST.kcal}/${BREAKFAST.protein}`);
for (const m of MEALS) {
  if (m.label.length > LOG_LABEL_MAX || m.note.length > LOG_NOTE_MAX) { s.problem(`label or note too long: ${m.label}`); continue; }
  const have = rows.find((d) => d.get('mealLabel') === m.label);
  if (!have) s.logMeal(owner, m);
  else if (have.get('calories') !== m.kcal || have.get('protein') !== m.protein) s.problem(`${DAY} already has "${m.label}" as ${have.get('calories')}/${have.get('protein')}`);
}
const strangers = rows.filter((d) => d.id !== BREAKFAST.id && !MEALS.some((m) => m.label === d.get('mealLabel')));
if (strangers.length) s.problem(`${DAY} has rows that were not there when it was read: ${strangers.map((d) => `"${d.get('mealLabel')}" ${d.get('calories')}/${d.get('protein') ?? 0}`).join(', ')}`);
// Open: the David bar and the dinner oats are planned, not eaten.
s.markDay(await owner.collection('dailyLogged').doc(DAY).get(), null);

const QUICK = [
  { name: 'Patty + sweet kale salad (174 g) + mushrooms', calories: 525, protein: 34 },
  { name: 'Banana (91 g)', calories: 81, protein: 1 },
];
const presets = (await owner.collection('presets').get()).docs;
for (const q of QUICK) {
  const have = presets.find((d) => d.get('name') === q.name);
  if (!have) s.saveMeal(owner, 'quickAdd', q);
  else if (have.get('calories') !== q.calories || have.get('protein') !== q.protein) s.problem(`Quick add "${q.name}" exists as ${have.get('calories')}/${have.get('protein')}`);
}
s.note('left alone: breakfast row, Quick add "Sweet kale salad, no dressing (1 cup)" 90/3, "Protein oats dinner bowl + banana, no honey" 410/35 (tonight\'s plan), steps (not read or written)');

await s.run({
  report: async () => {
    const docs = await dayRows(owner, DAY);
    const kcal = docs.reduce((n, d) => n + (d.get('calories') ?? 0), 0);
    const protein = docs.reduce((n, d) => n + (d.get('protein') ?? 0), 0);
    const flag = await owner.collection('dailyLogged').doc(DAY).get();
    console.log(`\n${DAY}: ${docs.length} rows = ${kcal} kcal / ${protein} g · fully logged: ${flag.exists ? flag.get('complete') : 'open'}`);
    for (const d of docs) console.log(`  ${hm((d.get('timestamp') as Timestamp).toDate()).slice(7)} ${String(d.get('mealType')).padEnd(9)} "${d.get('mealLabel')}" ${d.get('calories')}/${d.get('protein') ?? 0}`);
    const all = (await owner.collection('presets').get()).docs.filter((d) => QUICK.some((q) => q.name === d.get('name')));
    console.log(`\nQuick add:\n  ${all.map((d) => `"${d.get('name')}" ${d.get('calories')}/${d.get('protein')}`).join('\n  ')}`);
  },
});
