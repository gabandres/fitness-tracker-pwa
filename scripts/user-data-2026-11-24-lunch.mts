/**
 * User data, requested 2026-11-24 (America/Puerto_Rico): 11/24 lunch and snack
 * on two accounts. Values are the owner's, entered exactly.
 *
 * What the read found (2026-11-24, `scripts/user-state.mts`):
 *
 * Owner (gabrielandresbermudez@gmail.com, targets 1,850 / 140, unchanged)
 *   11/24 meals   one row, breakfast 545/62 [zjwp3WQurCWI9EDInieT]: left. The
 *                 soup + egg (435/31) and banana + coffee (81/1) are created →
 *                 1,061 / 94. The day stays open (no "fully logged" answer).
 *   My Foods      no rice-stick or Andean-mix food: both created, by weight
 *                 (as PBfit on 11/23). Sodium 80 mg and fiber ~2 g have no
 *                 field on a My Foods entry: not stored.
 *   Quick add     no pork-rib soup: created.
 *   Home plan     the day note is a dated note for 11/24.
 *   Planned (David bar, oats bowl) is not logged: not eaten.
 *
 * Stephanie (stph.ctllo@gmail.com, targets 1,500 / 110)
 *   11/24 meals   one row, breakfast 495/64 [zrji7Kx35Wfz3shdsJ5E]: left. The
 *                 soup (365/25) is created → 860 / 89. Nothing else on her
 *                 account is touched (no day flag, no saved meal).
 *
 * No steps, no targets, no maintenance inputs (ADR-0024). Dry run unless
 * `--apply`; every touched doc is backed up to ~/ignia-backups first; a re-run
 * plans nothing.
 *
 *   npx jiti scripts/user-data-2026-11-24-lunch.mts [--apply]
 */
import { Timestamp, type DocumentReference } from 'firebase-admin/firestore';
import { homePlanOf, LOG_LABEL_MAX, LOG_NOTE_MAX } from '../packages/core/src/index.ts';
import { at, hm, open, type MealInput, type SavedMealInput } from './lib/user-data.mts';

const OWNER = 'gabrielandresbermudez@gmail.com';
const STEPH = 'stph.ctllo@gmail.com';
const DAY = '2026-11-24';
const s = await open('user-data-2026-11-24-lunch');
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

type Meal = MealInput & { note: string };
/** Log the new meals; refuse when the day holds a row other than the one that was read. */
async function meals(user: DocumentReference, who: string, known: { id: string; kcal: number; protein: number }, want: Meal[]) {
  const rows = await dayRows(user, DAY);
  const k = rows.find((d) => d.id === known.id);
  if (!k || k.get('calories') !== known.kcal || (k.get('protein') ?? 0) !== known.protein) s.problem(`${who}: breakfast ${known.id} is not the ${known.kcal}/${known.protein} that was read`);
  for (const m of want) {
    if (m.label.length > LOG_LABEL_MAX || m.note.length > LOG_NOTE_MAX) { s.problem(`${who}: "${m.label}" label or note too long (${m.label.length}/${m.note.length})`); continue; }
    const have = rows.find((d) => d.get('mealLabel') === m.label);
    if (!have) s.logMeal(user, m);
    else if (have.get('calories') !== m.kcal || have.get('protein') !== m.protein) s.problem(`${who}: ${DAY} already has "${m.label}" as ${have.get('calories')}/${have.get('protein')}`);
  }
  const strangers = rows.filter((d) => d.id !== known.id && !want.some((m) => m.label === d.get('mealLabel')));
  if (strangers.length) s.problem(`${who}: ${DAY} has rows that were not there when it was read: ${strangers.map((d) => `"${d.get('mealLabel')}" ${d.get('calories')}/${d.get('protein') ?? 0}`).join(', ')}`);
}
async function saved(user: DocumentReference, where: 'myFoods' | 'quickAdd', f: SavedMealInput) {
  const docs = (await user.collection(where === 'myFoods' ? 'customFoods' : 'presets').get()).docs;
  const have = docs.filter((d) => d.get('name') === f.name);
  if (have.length > 1) s.problem(`owner: ${have.length} entries are named "${f.name}"`);
  else if (!have[0]) s.saveMeal(user, where, f);
  else if (have[0].get('calories') !== f.calories || have[0].get('protein') !== f.protein) s.problem(`owner: "${f.name}" exists as ${have[0].get('calories')}/${have[0].get('protein')}`);
}

// ═══ Owner ═══
await meals(owner, 'owner', { id: 'zjwp3WQurCWI9EDInieT', kcal: 545, protein: 62 }, [
  {
    day: DAY, time: '13:45', slot: 'lunch', label: 'Pork rib rice-noodle soup + hard-boiled egg', kcal: 435, protein: 31,
    note: 'Estimated. Bowl 587 g total (weighed). 2 pork ribs 221 g with bone; 146 g bones, fat and cartilage left uneaten → ~75 g lean rib meat ~190/22 · Ty Ling rice sticks ~80 g cooked (≈25–30 g dry; label 55 g dry = 200 kcal, 0 g protein) ~95/0 · broth ~200 g ~50/2 · potato ~25 g ~20/0 · bok choy + mushrooms ~60 g ~12/1 · 1 hard-boiled egg 70/6.',
  },
  {
    day: DAY, time: '14:10', slot: 'snack', label: 'Banana + black coffee', kcal: 81, protein: 1,
    note: 'Banana ~91 g (usual size, not weighed) 81/1 · black coffee, no milk or sugar 0.',
  },
]);
s.markDay(await owner.collection('dailyLogged').doc(DAY).get(), null);

await saved(owner, 'myFoods', { name: 'Ty Ling rice sticks (py mai fun)', servingSize: 55, servingUnit: 'g', calories: 200, protein: 0, carbs: 50 });
await saved(owner, 'myFoods', { name: 'Andean grain mix (maca, pea, cañahua, quinoa)', servingSize: 17, servingUnit: 'g', calories: 63, protein: 3 });
await saved(owner, 'quickAdd', { name: 'Pork rib rice-noodle soup (75 g lean meat, ~80 g noodles)', calories: 365, protein: 25 });

const DAY_NOTE = {
  from: DAY, to: DAY, label: 'Tue 11/24 — high-sodium day',
  note: 'high-sodium day (broth + Canadian bacon); expect water on tomorrow\'s weigh-in',
};
const profile = await owner.get();
const stored = profile.get('homePlan') as Record<string, unknown> | undefined;
const plan = homePlanOf({ homePlan: stored });
if (!stored || !plan?.notes) s.problem('owner: profile.homePlan has no notes: not the plan that was read');
else if (stable(stored) !== stable(plan)) s.problem('owner: profile.homePlan holds something core `homePlanOf` drops: not the plan that was read');
else if (!plan.notes.some((n) => n.from === DAY && n.label === DAY_NOTE.label)) {
  const notes = [...plan.notes, DAY_NOTE];
  const next = homePlanOf({ homePlan: { ...plan, notes } })!;
  if (next.notes!.length !== notes.length || !next.notes!.some((n) => n.note === DAY_NOTE.note)) s.problem('owner: core `homePlanOf` dropped or cut the day note');
  else s.update(profile, { homePlan: JSON.parse(JSON.stringify(next)) }, `owner: homePlan + "${DAY_NOTE.label}" — ${next.notes!.length} notes`);
}
s.note('owner, left alone: the breakfast row, targets 1,850/140, the weigh-in, every other home-plan field, planned David bar + oats bowl (not eaten yet) · steps are not read or written');

// ═══ Stephanie: only the row ═══
await meals(steph, 'Stephanie', { id: 'zrji7Kx35Wfz3shdsJ5E', kcal: 495, protein: 64 }, [{
  day: DAY, time: '13:45', slot: 'lunch', label: 'Pork rib rice-noodle soup', kcal: 365, protein: 25,
  note: 'Estimated (same bowl as Gabriel\'s; her portion not weighed). ~75 g lean rib meat ~190/22 · rice sticks ~80 g cooked ~95/0 · broth ~200 g ~50/2 · potato ~20/0 · bok choy + mushrooms ~12/1. No egg, no banana, no coffee.',
}]);
s.note('Stephanie, left alone: everything else (no day flag, no weigh-in, no saved meals)');

await s.run({
  report: async () => {
    for (const [who, user] of [['owner', owner], ['Stephanie', steph]] as const) {
      const docs = await dayRows(user, DAY);
      const kcal = docs.reduce((n, d) => n + (d.get('calories') ?? 0), 0);
      const protein = docs.reduce((n, d) => n + (d.get('protein') ?? 0), 0);
      const flag = await user.collection('dailyLogged').doc(DAY).get();
      console.log(`\n${who} ${DAY}: ${docs.length} row(s) = ${kcal} kcal / ${protein} g · fully logged: ${flag.exists ? flag.get('complete') : 'open'}`);
      for (const d of docs) console.log(`  ${hm((d.get('timestamp') as Timestamp).toDate()).slice(7)} ${String(d.get('mealType')).padEnd(9)} "${d.get('mealLabel')}" ${d.get('calories')}/${d.get('protein') ?? 0}`);
    }
    const foods = (await owner.collection('customFoods').get()).docs.filter((d) => /Ty Ling|Andean/.test(String(d.get('name'))));
    console.log(`\nowner My Foods:\n  ${foods.map((d) => `"${d.get('name')}" ${d.get('servingSize')} ${d.get('servingUnit')} = ${d.get('calories')}/${d.get('protein')}${d.get('carbs') != null ? ` carbs ${d.get('carbs')}` : ''}`).join('\n  ')}`);
    const q = (await owner.collection('presets').get()).docs.filter((d) => /Pork rib/.test(String(d.get('name'))));
    console.log(`owner Quick add: ${q.map((d) => `"${d.get('name')}" ${d.get('calories')}/${d.get('protein')}`).join(', ')}`);
    const hp = homePlanOf((await owner.get()).data() ?? {});
    console.log(`homePlan ${DAY}: ${hp?.notes?.filter((n) => n.from <= DAY && n.to >= DAY).map((n) => `${n.label} — ${n.note}`).join(' | ')}`);
  },
});
