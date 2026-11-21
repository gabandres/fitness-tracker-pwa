/**
 * OWNER DATA — 2026-11-20. Remove the second "Unreal" row of 2026-11-19.
 *
 * The meals script of this date (`user-data-2026-11-20-meals.mts`) left one
 * row alone because the request did not list it: "Unreal" 90 kcal / 2 g,
 * logged in the app at 22:24. The owner has now said to remove it, which
 * makes the day the 1,518 kcal / 145 g of the request.
 *
 * Nothing else on the day is touched: the five listed rows stay, and the day
 * stays marked fully logged.
 *
 *   npx jiti scripts/owner-data-2026-11-20-remove-extra-unreal.mts [--apply]
 */
import { Timestamp } from 'firebase-admin/firestore';
import { open, at, hm } from './lib/user-data.mts';

const OWNER = 'gabrielandresbermudez@gmail.com';
const DAY = '2026-11-19';
const EXTRA = { id: 'tqkUPko9wYpsEWnY71hZ', label: 'Unreal', kcal: 90, protein: 2, time: '22:24' };
const WANT = { rows: 5, kcal: 1518, protein: 145 };

const s = await open('owner-data-2026-11-20-remove-extra-unreal');
const owner = await s.user(OWNER);

const dayRows = async () =>
  (await owner.collection('dailyLogs')
    .where('timestamp', '>=', Timestamp.fromDate(at(DAY, '00:00')))
    .where('timestamp', '<', Timestamp.fromDate(at('2026-11-20', '00:00')))
    .orderBy('timestamp').get()).docs;

const row = await owner.collection('dailyLogs').doc(EXTRA.id).get();
if (row.exists) {
  const when = hm((row.get('timestamp') as Timestamp).toDate());
  const same = row.get('mealLabel') === EXTRA.label && row.get('calories') === EXTRA.kcal && row.get('protein') === EXTRA.protein && when.endsWith(EXTRA.time);
  if (!same) s.problem(`row ${EXTRA.id} is not the "${EXTRA.label}" ${EXTRA.kcal}/${EXTRA.protein} at ${EXTRA.time} that was read: "${row.get('mealLabel')}" ${row.get('calories')}/${row.get('protein')} at ${when}`);
  else s.remove(row, `DELETE 11-19 ${EXTRA.time} "${EXTRA.label}" ${EXTRA.kcal}/${EXTRA.protein}`);

  // Guard: without it the day must be exactly the request's.
  const rest = (await dayRows()).filter((d) => d.id !== EXTRA.id);
  const kcal = rest.reduce((n, d) => n + (d.get('calories') ?? 0), 0);
  const protein = rest.reduce((n, d) => n + (d.get('protein') ?? 0), 0);
  if (rest.length !== WANT.rows || kcal !== WANT.kcal || protein !== WANT.protein) {
    s.problem(`the day without it would be ${rest.length} rows = ${kcal}/${protein}, not ${WANT.rows} rows = ${WANT.kcal}/${WANT.protein}`);
  }
}
s.note('left alone: the five listed rows of 11/19, and the day stays marked fully logged');

await s.run({
  report: async () => {
    const rows = await dayRows();
    const kcal = rows.reduce((n, d) => n + (d.get('calories') ?? 0), 0);
    const protein = rows.reduce((n, d) => n + (d.get('protein') ?? 0), 0);
    console.log(`  ${DAY}: ${rows.length} rows = ${kcal} kcal / ${protein} g`);
    for (const d of rows) console.log(`    ${hm((d.get('timestamp') as Timestamp).toDate()).slice(7)} "${d.get('mealLabel')}" ${d.get('calories')}/${d.get('protein') ?? '-'}`);
    const flag = await owner.collection('dailyLogged').doc(DAY).get();
    console.log(`  fully logged: ${flag.exists ? flag.get('complete') : 'unset'}`);
  },
});
