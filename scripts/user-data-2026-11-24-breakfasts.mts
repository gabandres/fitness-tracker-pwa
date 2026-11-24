/**
 * User data, requested 2026-11-24 (America/Puerto_Rico): 11/24 breakfasts on
 * two accounts. Values are the owner's, entered exactly.
 *
 * What the read found (2026-11-24, `scripts/user-state.mts`):
 *
 * Owner (gabrielandresbermudez@gmail.com, targets 1,850 / 140, unchanged)
 *   11/24 weight  152.2 lb is ALREADY stored: only the note is added.
 *                 `weightQuietUntil` is 2026-12-10, which already covers "no
 *                 weight alerts before 11/26": left.
 *   11/24 meals   no rows yet: the breakfast is created → 545 / 62. The day
 *                 stays open (no "fully logged" answer).
 *   Pancakes      the batch record is the home-plan note 11/21 → 11/25 and one
 *                 Quick add per pancake left: the note now says 1 left (216 g,
 *                 for Wed 11/25), and "Pancake 196 g" is removed (backed up) so
 *                 it cannot be logged twice, as on 11/22 and 11/23.
 *   Quick add     "Pancake (196 g) + 2 eggs + 3 Canadian bacon" 545/62 is new,
 *                 beside the 125 g and 167 g siblings.
 *   Planned meals (ramen/pho, David bar, oats bowl) are not logged: not eaten.
 *
 * Stephanie (stph.ctllo@gmail.com, targets 1,500 / 110)
 *   11/24 meals   no rows: the breakfast is created → 495 / 64.
 *   Quick add     no "Protein yogurt bowl + banana": created. Her My Foods
 *                 "Yogurt bowl" 229/19 (×2) and Quick adds "Granola bowl",
 *                 "Bowl yogurt 1/4" are other meals: left. Nothing else on her
 *                 account is read for writing or touched (no day flag).
 *
 * No steps, no targets, no maintenance inputs (ADR-0024). Dry run unless
 * `--apply`; every touched doc is backed up to ~/ignia-backups first; a re-run
 * plans nothing.
 *
 *   npx jiti scripts/user-data-2026-11-24-breakfasts.mts [--apply]
 */
import { Timestamp, type DocumentReference } from 'firebase-admin/firestore';
import { homePlanOf, LOG_LABEL_MAX, LOG_NOTE_MAX } from '../packages/core/src/index.ts';
import { at, hm, open, type MealInput } from './lib/user-data.mts';

const OWNER = 'gabrielandresbermudez@gmail.com';
const STEPH = 'stph.ctllo@gmail.com';
const DAY = '2026-11-24';
const s = await open('user-data-2026-11-24-breakfasts');
const owner = await s.user(OWNER);
const steph = await s.user(STEPH);

const dayRows = async (user: DocumentReference, day: string) => (await user.collection('dailyLogs')
  .where('timestamp', '>=', Timestamp.fromDate(at(day, '00:00')))
  .where('timestamp', '<', Timestamp.fromDate(new Date(at(day, '00:00').getTime() + 86_400_000)))
  .orderBy('timestamp').get()).docs;
const stable = (v: unknown): string => {
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stable((v as Record<string, unknown>)[k])}`).join(',')}}`;
  return JSON.stringify(v);
};

/** Log the one breakfast; refuse when the day holds anything else. */
async function breakfast(user: DocumentReference, who: string, meal: MealInput & { note: string }) {
  if (meal.label.length > LOG_LABEL_MAX || meal.note.length > LOG_NOTE_MAX) { s.problem(`${who}: label or note too long`); return; }
  const rows = await dayRows(user, DAY);
  const have = rows.find((d) => d.get('mealLabel') === meal.label);
  if (!have) s.logMeal(user, meal);
  else if (have.get('calories') !== meal.kcal || have.get('protein') !== meal.protein) s.problem(`${who}: ${DAY} already has "${meal.label}" as ${have.get('calories')}/${have.get('protein')}`);
  const strangers = rows.filter((d) => d.get('mealLabel') !== meal.label);
  if (strangers.length) s.problem(`${who}: ${DAY} has rows that were not there when it was read: ${strangers.map((d) => `"${d.get('mealLabel')}" ${d.get('calories')}/${d.get('protein') ?? 0}`).join(', ')}`);
}
async function quickAdd(user: DocumentReference, who: string, q: { name: string; calories: number; protein: number }) {
  const presets = (await user.collection('presets').get()).docs;
  const have = presets.filter((d) => d.get('name') === q.name);
  if (have.length > 1) s.problem(`${who}: ${have.length} Quick adds are named "${q.name}"`);
  else if (!have[0]) s.saveMeal(user, 'quickAdd', q);
  else if (have[0].get('calories') !== q.calories || have[0].get('protein') !== q.protein) s.problem(`${who}: Quick add "${q.name}" exists as ${have[0].get('calories')}/${have[0].get('protein')}`);
  return presets;
}

// ═══ Owner ═══
const WEIGHT_NOTE = 'post-trip water clearing (154.8 → 154.0 → 152.6 → 152.2); 0.4 lb above the 10/30 baseline of 151.8';
const w = await owner.collection('dailyWeights').doc(DAY).get();
if (!w.exists || w.get('weight') !== 152.2) s.problem(`owner: dailyWeights/${DAY} is ${w.exists ? w.get('weight') : 'absent'}, not the 152.2 that was read`);
else if (w.get('note') !== WEIGHT_NOTE) {
  if (w.get('note') != null) s.problem(`owner: dailyWeights/${DAY} already has a different note: ${w.get('note')}`);
  else s.update(w, { note: WEIGHT_NOTE }, `owner: dailyWeights/${DAY} 152.2 lb (already stored) + note`);
}

const OWNER_BREAKFAST = {
  day: DAY, time: '09:15', slot: 'breakfast' as const, label: 'Pancake + 2 eggs + Canadian bacon', kcal: 545, protein: 62,
  note: 'Build C pancake 196 g 344/40 (batch 2026-11-21, 1.754 kcal/g, 0.202 g protein/g) · 2 large eggs 140/12.5 · Jones Canadian bacon 3 slices 60/10. No butter or syrup.',
};
await breakfast(owner, 'owner', OWNER_BREAKFAST);
s.markDay(await owner.collection('dailyLogged').doc(DAY).get(), null);

const ownerPresets = await quickAdd(owner, 'owner', { name: 'Pancake (196 g) + 2 eggs + 3 Canadian bacon', calories: 545, protein: 62 });
const EATEN = { name: 'Pancake 196 g (Build C, 11/21 batch)', calories: 344, protein: 40 };
const eaten = ownerPresets.filter((d) => d.get('name') === EATEN.name);
if (eaten.length > 1) s.problem(`owner: ${eaten.length} Quick adds are named "${EATEN.name}"`);
else if (eaten[0]) {
  if (eaten[0].get('calories') !== EATEN.calories || eaten[0].get('protein') !== EATEN.protein) s.problem(`owner: Quick add "${EATEN.name}" is ${eaten[0].get('calories')}/${eaten[0].get('protein')}`);
  else s.remove(eaten[0], `owner: REMOVE Quick add "${EATEN.name}" ${EATEN.calories}/${EATEN.protein} (eaten 11/24 breakfast)`);
}
if (!ownerPresets.some((d) => d.get('name') === 'Pancake 216 g (Build C, 11/21 batch)')) s.problem('owner: the "Pancake 216 g" Quick add is gone');

const FRIDGE_WAS = 'Build C pancakes — 2 left, good through Wed 11/25';
const FRIDGE = {
  from: '2026-11-21', to: '2026-11-25', label: 'Build C pancakes — 1 left, for Wed 11/25',
  note: 'Batch 11/21: 4 pancakes · 704 g cooked · 1,235 kcal / 142 g = 1.754 kcal/g · 0.202 g protein/g. Used: 125 g (11/22) · 167 g (11/23) · 196 g (11/24). Left: 216 g 379/44 (Quick add) for Wed 11/25.',
};
const profile = await owner.get();
const stored = profile.get('homePlan') as Record<string, unknown> | undefined;
const plan = homePlanOf({ homePlan: stored });
if (!stored || !plan?.notes) s.problem('owner: profile.homePlan has no notes: not the plan that was read');
else if (stable(stored) !== stable(plan)) s.problem('owner: profile.homePlan holds something core `homePlanOf` drops: not the plan that was read');
else if (plan.weightQuietUntil !== '2026-12-10') s.problem(`owner: weightQuietUntil is ${plan.weightQuietUntil}, not the 2026-12-10 that was read (covers "no weight alerts before 11/26")`);
else {
  const fridge = plan.notes.find((n) => n.from === FRIDGE.from && n.to === FRIDGE.to && (n.label === FRIDGE_WAS || n.label === FRIDGE.label));
  if (!fridge) s.problem(`owner: home-plan note "${FRIDGE_WAS}" is gone`);
  else if (FRIDGE.note.length > 300 || FRIDGE.label.length > 80) s.problem(`owner: pancake note too long (${FRIDGE.label.length}/${FRIDGE.note.length})`);
  else {
    const next = homePlanOf({ homePlan: { ...plan, notes: plan.notes.map((n) => (n === fridge ? FRIDGE : n)) } })!;
    if (!next.notes!.some((n) => n.note === FRIDGE.note)) s.problem('owner: core `homePlanOf` dropped or cut the pancake note');
    else if (stable(next) !== stable(plan)) s.update(profile, { homePlan: JSON.parse(JSON.stringify(next)) }, `owner: homePlan "${FRIDGE.label}" (196 g used 11/24) — ${next.notes!.length} notes`);
  }
}
s.note('owner, left alone: targets 1,850/140 · weightQuietUntil 2026-12-10 · trainingDays · the 11/26 check-in · My Foods "Build C pancakes — batch 2026-11-21" · the other pancake Quick adds · planned ramen/pho, David bar, oats bowl (not eaten yet) · steps are not read or written');

// ═══ Stephanie: only the row and the Quick add ═══
await breakfast(steph, 'Stephanie', {
  day: DAY, time: '09:15', slot: 'breakfast' as const, label: 'Protein yogurt bowl + banana', kcal: 495, protein: 64,
  note: 'SOLO pea protein 2 scoops 140/30 · Kirkland Greek yogurt ½ c 75/13.5 · Daisy low fat cottage cheese ½ c 90/13 · Lifeway mango kefir ½ c ~70/5.5 · mixed berries ½ c 40/0.5 · banana ~91 g 81/1.',
});
await quickAdd(steph, 'Stephanie', { name: 'Protein yogurt bowl + banana', calories: 495, protein: 64 });
s.note('Stephanie, left alone: everything else (no day flag, no weigh-in, her other saved meals)');

await s.run({
  report: async () => {
    for (const [who, user] of [['owner', owner], ['Stephanie', steph]] as const) {
      const docs = await dayRows(user, DAY);
      const kcal = docs.reduce((n, d) => n + (d.get('calories') ?? 0), 0);
      const protein = docs.reduce((n, d) => n + (d.get('protein') ?? 0), 0);
      const flag = await user.collection('dailyLogged').doc(DAY).get();
      const wt = await user.collection('dailyWeights').doc(DAY).get();
      console.log(`\n${who} ${DAY}: ${docs.length} row(s) = ${kcal} kcal / ${protein} g · fully logged: ${flag.exists ? flag.get('complete') : 'open'} · weigh-in: ${wt.exists ? `${wt.get('weight')} ("${wt.get('note') ?? ''}")` : '—'}`);
      for (const d of docs) console.log(`  ${hm((d.get('timestamp') as Timestamp).toDate()).slice(7)} ${String(d.get('mealType')).padEnd(9)} "${d.get('mealLabel')}" ${d.get('calories')}/${d.get('protein') ?? 0}`);
    }
    const all = (await owner.collection('presets').get()).docs;
    console.log(`\nowner pancake Quick adds:\n  ${all.filter((d) => /Pancake/.test(String(d.get('name')))).map((d) => `"${d.get('name')}" ${d.get('calories')}/${d.get('protein')}`).join('\n  ')}`);
    const hp = homePlanOf((await owner.get()).data() ?? {});
    const n = hp?.notes?.find((x) => x.from === FRIDGE.from && x.to === FRIDGE.to && x.label.startsWith('Build C pancakes —'));
    console.log(`pancake note: ${n?.label} — ${n?.note}`);
    const sq = (await steph.collection('presets').get()).docs.filter((d) => d.get('name') === 'Protein yogurt bowl + banana');
    console.log(`Stephanie Quick add: ${sq.map((d) => `"${d.get('name')}" ${d.get('calories')}/${d.get('protein')}`).join(', ')}`);
  },
});
