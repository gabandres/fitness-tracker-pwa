/**
 * Owner data, requested 2026-11-23 (America/Puerto_Rico): close 11/23 — the
 * afternoon bar and the PBfit dinner bowl, the day marked fully logged, the
 * weigh-in's note, PBfit in My Foods, the dinner bowl as a Quick add, and the
 * day's note on the home plan. Values are the owner's, entered exactly.
 *
 * What the read found (2026-11-23, `scripts/user-state.mts`):
 *
 *   11/23 meals   three rows, already the request's (`owner-data-2026-11-23-lunch`):
 *                 breakfast [XPaIADm0X3FPyKA5Otfx] 425/50, lunch [LuqIOQqnkwyIrSzkYs1h]
 *                 525/34, banana + coffee [2P8lV6UFB9CuoNuj7aKp] 81/1 — checked,
 *                 not rewritten. The bar and dinner are created → 1,691 / 149.
 *                 "Fully logged" is unset → true. No David bar.
 *   weigh-in      152.6 stored, no note → the note.
 *   My Foods      no PBfit. Saved by weight (16 g = 60/8, carbs 6, fat 2), so
 *                 1 tbsp (8 g) scales to 30/4. Fiber and sodium have no field.
 *   Quick add     "Pancake (167 g) + 1 egg …" 425/50, "Patty + sweet kale salad
 *                 (174 g) + mushrooms" 525/34 and "Banana (91 g)" 81/1 exist →
 *                 checked. The dinner bowl is new. The older oatmeal saved meals
 *                 stay (alternates); the app has no "default" meal to set.
 *   home plan     the pancake note already says 167 g used, 196 g + 216 g left.
 *                 The 11/23 → 11/27 re-entry note already holds Tue rest and Wed
 *                 Pull −5% activation, normal effort. weightQuietUntil 2026-12-10
 *                 already covers "no weight alerts before 11/26". + the day note.
 *
 * No steps, no step goal (the app has none), no targets, no maintenance inputs
 * (ADR-0024). Dry run unless `--apply`; a re-run plans nothing.
 *
 *   npx jiti scripts/owner-data-2026-11-23-close-day.mts [--apply]
 */
import { Timestamp, type DocumentReference } from 'firebase-admin/firestore';
import { homePlanOf, LOG_LABEL_MAX, LOG_NOTE_MAX } from '../packages/core/src/index.ts';
import { at, hm, open } from './lib/user-data.mts';

const OWNER = 'gabrielandresbermudez@gmail.com';
const DAY = '2026-11-23';
const s = await open('owner-data-2026-11-23-close-day');
const owner = await s.user(OWNER);

const dayRows = async (user: DocumentReference, day: string) => (await user.collection('dailyLogs')
  .where('timestamp', '>=', Timestamp.fromDate(at(day, '00:00')))
  .where('timestamp', '<', Timestamp.fromDate(new Date(at(day, '00:00').getTime() + 86_400_000)))
  .orderBy('timestamp').get()).docs;

// ── the weigh-in's note ──
const WEIGHT_NOTE = 'post-trip water clearing (154.8 → 154.0 → 152.6)';
const w = await owner.collection('dailyWeights').doc(DAY).get();
if (!w.exists || w.get('weight') !== 152.6) s.problem(`dailyWeights/${DAY} is ${w.exists ? w.get('weight') : 'absent'}, not the 152.6 that was read`);
else if (w.get('note') !== WEIGHT_NOTE) {
  if (w.get('note') != null) s.problem(`dailyWeights/${DAY} already has a different note: ${w.get('note')}`);
  else s.update(w, { note: WEIGHT_NOTE }, `dailyWeights/${DAY} 152.6 lb (already stored) + note`);
}

// ── the five meals: three stored, two new ──
const STORED = [
  { id: 'XPaIADm0X3FPyKA5Otfx', time: '09:30', label: 'Pancake + 1 egg + Canadian bacon', kcal: 425, protein: 50 },
  { id: 'LuqIOQqnkwyIrSzkYs1h', time: '13:10', label: 'Patty + sweet kale salad + mushrooms', kcal: 525, protein: 34 },
  { id: '2P8lV6UFB9CuoNuj7aKp', time: '13:30', label: 'Banana + black coffee', kcal: 81, protein: 1 },
];
const NEW = [
  {
    day: DAY, time: '15:30', slot: 'snack' as const, label: 'Kirkland protein bar', kcal: 190, protein: 21,
    note: 'hunger surge mid-afternoon after Leg Day to failure; lunch protein was low (34 g)',
  },
  {
    day: DAY, time: '22:00', slot: 'dinner' as const, label: 'Protein oats + banana + PBfit', kcal: 470, protein: 43,
    note: '½ c rolled oats 150/5 · ½ c liquid egg whites 63/13 · ¼ c low-fat milk 25/2 · ½ c Kirkland Greek yogurt 75/13.5 · ½ c wild berries (microwaved) 40/0.5 · banana ~60 g (estimated) 55/1 · PBfit peanut butter powder 2 tbsp (16 g) 60/8 · water. No honey, no vanilla, no cinnamon. “It was the best.”',
  },
];
const total = [...STORED, ...NEW].reduce((n, m) => [n[0] + m.kcal, n[1] + m.protein], [0, 0]);
if (total[0] !== 1691 || total[1] !== 149) s.problem(`the five meals add up to ${total.join('/')}, not 1,691 / 149`);
const rows = await dayRows(owner, DAY);
for (const m of STORED) {
  const d = rows.find((r) => r.id === m.id);
  const time = d && hm((d.get('timestamp') as Timestamp).toDate()).slice(7);
  if (!d || d.get('mealLabel') !== m.label || d.get('calories') !== m.kcal || d.get('protein') !== m.protein || time !== m.time) s.problem(`${m.id} is not ${m.time} "${m.label}" ${m.kcal}/${m.protein}`);
}
for (const m of NEW) {
  if (m.label.length > LOG_LABEL_MAX || m.note.length > LOG_NOTE_MAX) { s.problem(`label or note too long: ${m.label}`); continue; }
  const have = rows.find((d) => d.get('mealLabel') === m.label);
  if (!have) s.logMeal(owner, m);
  else if (have.get('calories') !== m.kcal || have.get('protein') !== m.protein) s.problem(`${DAY} already has "${m.label}" as ${have.get('calories')}/${have.get('protein')}`);
}
const strangers = rows.filter((d) => !STORED.some((m) => m.id === d.id) && !NEW.some((m) => m.label === d.get('mealLabel')));
if (strangers.length) s.problem(`${DAY} has rows that were not there when it was read: ${strangers.map((d) => `"${d.get('mealLabel')}" ${d.get('calories')}/${d.get('protein') ?? 0}`).join(', ')}`);
s.markDay(await owner.collection('dailyLogged').doc(DAY).get(), true);

// ── My Foods: PBfit, by weight ──
const PBFIT = { name: 'PBfit peanut butter powder', brand: 'BetterBody Foods', servingSize: 16, servingUnit: 'g' as const, calories: 60, protein: 8, carbs: 6, fat: 2 };
const foods = (await owner.collection('customFoods').get()).docs;
const pb = foods.find((d) => d.get('name') === PBFIT.name);
if (!pb) s.saveMeal(owner, 'myFoods', PBFIT);
else if (pb.get('calories') !== PBFIT.calories || pb.get('protein') !== PBFIT.protein || pb.get('servingSize') !== PBFIT.servingSize) s.problem(`My Foods "${PBFIT.name}" exists as ${pb.get('calories')}/${pb.get('protein')} per ${pb.get('servingSize')} ${pb.get('servingUnit')}`);

// ── Quick add: one new, three checked ──
const QUICK = [
  { name: 'Protein oats + banana + PBfit (standard dinner bowl)', calories: 470, protein: 43 },
  { name: 'Pancake (167 g) + 1 egg + 3 Canadian bacon', calories: 425, protein: 50 },
  { name: 'Patty + sweet kale salad (174 g) + mushrooms', calories: 525, protein: 34 },
  { name: 'Banana (91 g)', calories: 81, protein: 1 },
];
const presets = (await owner.collection('presets').get()).docs;
for (const q of QUICK) {
  const have = presets.find((d) => d.get('name') === q.name);
  if (!have) s.saveMeal(owner, 'quickAdd', q);
  else if (have.get('calories') !== q.calories || have.get('protein') !== q.protein) s.problem(`Quick add "${q.name}" exists as ${have.get('calories')}/${have.get('protein')}`);
}
for (const g of [196, 216]) if (!presets.some((d) => d.get('name') === `Pancake ${g} g (Build C, 11/21 batch)`)) s.problem(`the "Pancake ${g} g" Quick add is gone`);

// ── home plan: the day's note ──
const DAY_NOTE = {
  from: DAY, to: DAY, label: 'Mon 11/23 — afternoon hunger after Leg Day',
  note: 'Leg Day to failure + 5th day back in deficit → afternoon hunger. Lunches with 45–55 g protein hold longer than the patty lunch (34 g).',
};
const FRIDGE_LABEL = 'Build C pancakes — 2 left, good through Wed 11/25';
const profile = await owner.get();
const stored = profile.get('homePlan') as Record<string, unknown> | undefined;
const plan = homePlanOf({ homePlan: stored });
const stable = (v: unknown): string => {
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stable((v as Record<string, unknown>)[k])}`).join(',')}}`;
  return JSON.stringify(v);
};
if (!stored || !plan?.notes) s.problem('profile.homePlan has no notes: not the plan that was read');
else if (stable(stored) !== stable(plan)) s.problem('profile.homePlan holds something core `homePlanOf` drops: not the plan that was read');
else if (plan.weightQuietUntil !== '2026-12-10') s.problem(`weightQuietUntil is ${plan.weightQuietUntil}, not the 2026-12-10 that was read`);
else if (!plan.notes.some((n) => n.label === FRIDGE_LABEL && n.note.includes('167 g (11/23)'))) s.problem(`home-plan note "${FRIDGE_LABEL}" with 167 g used is gone`);
else if (!plan.notes.some((n) => n.from === '2026-11-23' && n.to === '2026-11-27' && n.note.includes('Pull and Push: −5% on activation sets, normal effort'))) s.problem('the 11/23 → 11/27 re-entry note is gone');
else if (!plan.notes.some((n) => n.from === DAY && n.label === DAY_NOTE.label)) {
  const notes = [...plan.notes, DAY_NOTE];
  const next = homePlanOf({ homePlan: { ...plan, notes } })!;
  if (next.notes!.length !== notes.length || !next.notes!.some((n) => n.note === DAY_NOTE.note)) s.problem('core `homePlanOf` dropped or cut the day note');
  else s.update(profile, { homePlan: JSON.parse(JSON.stringify(next)) }, `homePlan: + "${DAY_NOTE.label}" — ${next.notes!.length} notes`);
}
s.note('left alone: the three stored 11/23 rows, the older oatmeal saved meals (alternates), My Foods "Build C pancakes — batch 2026-11-21", the pancake and re-entry notes, trainingDays, weightQuietUntil; steps are not read or written');

await s.run({
  report: async () => {
    const docs = await dayRows(owner, DAY);
    const kcal = docs.reduce((n, d) => n + (d.get('calories') ?? 0), 0);
    const protein = docs.reduce((n, d) => n + (d.get('protein') ?? 0), 0);
    const flag = await owner.collection('dailyLogged').doc(DAY).get();
    const wt = await owner.collection('dailyWeights').doc(DAY).get();
    console.log(`\n${DAY}: ${docs.length} rows = ${kcal} kcal / ${protein} g · fully logged: ${flag.exists ? flag.get('complete') : 'open'} · weigh-in ${wt.get('weight')} "${wt.get('note') ?? ''}"`);
    for (const d of docs) console.log(`  ${hm((d.get('timestamp') as Timestamp).toDate()).slice(7)} ${String(d.get('mealType')).padEnd(9)} "${d.get('mealLabel')}" ${d.get('calories')}/${d.get('protein') ?? 0}`);
    const f = (await owner.collection('customFoods').get()).docs.filter((d) => d.get('name') === PBFIT.name);
    console.log(`\nMy Foods:\n  ${f.map((d) => `"${d.get('name')}" (${d.get('brand')}) ${d.get('calories')}/${d.get('protein')} per ${d.get('servingSize')} ${d.get('servingUnit')} · carbs ${d.get('carbs')} · fat ${d.get('fat')}`).join('\n  ')}`);
    const all = (await owner.collection('presets').get()).docs.filter((d) => QUICK.some((q) => q.name === d.get('name')) || /^Pancake \d+ g/.test(d.get('name')));
    console.log(`\nQuick add:\n  ${all.map((d) => `"${d.get('name')}" ${d.get('calories')}/${d.get('protein')}`).join('\n  ')}`);
    const hp = homePlanOf({ homePlan: (await owner.get()).get('homePlan') });
    console.log(`\nhomePlan: ${hp?.notes?.length} notes · ${hp?.notes?.filter((n) => n.from <= DAY && n.to >= DAY).map((n) => n.label).join(' | ')}`);
  },
});
