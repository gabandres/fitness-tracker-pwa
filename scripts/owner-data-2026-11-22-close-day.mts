/**
 * Owner data, requested 2026-11-22 evening (America/Puerto_Rico): log the
 * 21:15 wraps and close 11/22. Values are the owner's, entered exactly.
 *
 * What the read found (2026-11-22, `scripts/user-state.mts`): the five rows
 * written by `owner-data-2026-11-22-meals.mts`, 1,420 / 145, no "fully logged"
 * answer. The wraps are not logged → one new row → 1,655 / 171, the total the
 * request expects. Day → fully logged. Nothing else is read or written.
 *
 * Dry run unless `--apply`; a re-run plans nothing.
 *
 *   npx jiti scripts/owner-data-2026-11-22-close-day.mts [--apply]
 */
import { Timestamp } from 'firebase-admin/firestore';
import { LOG_LABEL_MAX, LOG_NOTE_MAX } from '../packages/core/src/index.ts';
import { at, hm, open } from './lib/user-data.mts';

const OWNER = 'gabrielandresbermudez@gmail.com';
const DAY = '2026-11-22';
const s = await open('owner-data-2026-11-22-close-day');
const owner = await s.user(OWNER);

const dayRows = async () => (await owner.collection('dailyLogs')
  .where('timestamp', '>=', Timestamp.fromDate(at(DAY, '00:00')))
  .where('timestamp', '<', Timestamp.fromDate(new Date(at(DAY, '00:00').getTime() + 86_400_000)))
  .orderBy('timestamp').get()).docs;

/** Read on 11/22 and counted in the day's total: left exactly as they are. */
const KEPT = [
  { id: 'ty8GoEHjclqDtTz6FboR', label: 'Pancake + 2 eggs + Canadian bacon', kcal: 420, protein: 48 },
  { id: '13mN4XvZQGhb9dR5HvmZ', label: 'White fish + sweet kale salad (no dressing)', kcal: 310, protein: 39 },
  { id: '15BnXv5iAL84tcbX8jLQ', label: 'Unreal', kcal: 90, protein: 2 },
  { id: 'C6w0UzOaW0T5vPA49b0f', label: 'Kirkland protein bar', kcal: 190, protein: 21 },
  { id: 'XL9mM3wVpGZJ6psieg4Y', label: 'Protein oats dinner bowl + banana (no honey)', kcal: 410, protein: 35 },
];
const NEW_ROW = {
  day: DAY, time: '21:15', slot: 'snack' as const, label: '2 wraps: Olé green ×2, Canadian bacon ×5, greens', kcal: 235, protein: 26,
  note: 'Chopped kale/cabbage/Brussels sprout mix 51 g total (weighed), no toppings or dressing ~15/1 · Olé green tortilla ×2 120/8 · Jones Canadian bacon 5 slices 100/17.',
};
if (NEW_ROW.label.length > LOG_LABEL_MAX || NEW_ROW.note.length > LOG_NOTE_MAX) s.problem('label or note too long');

const rows = await dayRows();
for (const k of KEPT) {
  const d = rows.find((r) => r.id === k.id);
  if (!d || d.get('mealLabel') !== k.label || d.get('calories') !== k.kcal || d.get('protein') !== k.protein) s.problem(`${DAY} log ${k.id} is not the "${k.label}" ${k.kcal}/${k.protein} row that was read`);
}
const extra = rows.filter((r) => !KEPT.some((k) => k.id === r.id));
const haveNew = extra.find((r) => r.get('mealLabel') === NEW_ROW.label && r.get('calories') === NEW_ROW.kcal && r.get('protein') === NEW_ROW.protein);
const strangers = extra.filter((r) => r !== haveNew);
const total = [...KEPT, NEW_ROW].reduce((n, m) => [n[0] + m.kcal, n[1] + m.protein], [0, 0]);
if (total[0] !== 1655 || total[1] !== 171) s.problem(`the day adds up to ${total.join('/')}, not 1,655 / 171`);
if (strangers.length) s.problem(`${DAY} has rows that were not there when it was read: ${strangers.map((r) => `"${r.get('mealLabel')}" ${r.get('calories')}/${r.get('protein') ?? 0}`).join(', ')}`);
else {
  if (!haveNew) s.logMeal(owner, NEW_ROW);
  s.markDay(await owner.collection('dailyLogged').doc(DAY).get(), true);
}

await s.run({
  report: async () => {
    const docs = await dayRows();
    const kcal = docs.reduce((n, d) => n + (d.get('calories') ?? 0), 0);
    const protein = docs.reduce((n, d) => n + (d.get('protein') ?? 0), 0);
    const flag = await owner.collection('dailyLogged').doc(DAY).get();
    console.log(`\n${DAY}: ${docs.length} rows = ${kcal} kcal / ${protein} g · fully logged: ${flag.exists ? flag.get('complete') : 'open'}`);
    for (const d of docs) console.log(`  ${hm((d.get('timestamp') as Timestamp).toDate()).slice(7)} ${String(d.get('mealType')).padEnd(9)} "${d.get('mealLabel')}" ${d.get('calories')}/${d.get('protein') ?? 0}`);
  },
});
