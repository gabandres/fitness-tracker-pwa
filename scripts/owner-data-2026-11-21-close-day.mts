/**
 * Owner data, requested 2026-11-21 evening (America/Puerto_Rico): close 11/21,
 * correct the 11/20 QDOBA bowl, record the 11/21 pancake batch, more Quick
 * adds. Values are the owner's, entered exactly.
 *
 * What the read found (2026-11-21, `scripts/user-state.mts`):
 *
 *   11/21 rows    five rows, 1,655 / 149. The owner had already logged the
 *                 dinner in the app as "Oatmeal + Egg Whites" 375/34 (17:52) and
 *                 the two tortillas as two "Olé Xtreme green tortilla" 60/4 rows
 *                 (21:02, 21:03). Those ARE requests 1 and 2: the oats row gets
 *                 the requested name and note and keeps its real time, the two
 *                 tortilla rows are left as they are. Only "Olé green + 3
 *                 Canadian bacon" 120/14 (21:05) is new → 1,775 / 163, the total
 *                 the request expects. Day → fully logged.
 *   11/20 QDOBA   the row 575/41 → 530/49 with the new breakdown → 2,050 / 174.
 *                 The home-plan day note "at maintenance, no compensation" stays.
 *   QDOBA saved   both are My Foods (`customFoods`), not Quick add: 575/41 →
 *                 530/49 and 485/41 → 440/49. No stored text anywhere says older
 *                 QDOBA entries overestimated protein: nothing to remove.
 *   Pancakes      the app has no batch or stock record. As for the 10/25 batch:
 *                 a My Foods entry per 100 g at the batch's own density
 *                 (1,235 ÷ 704 = 1.754 kcal/g → 175/20 per 100 g), four Quick
 *                 adds for the four weighed pancakes, and a home-plan note
 *                 11/21 → 11/25 that shows on Today with what is in the fridge.
 *                 Nothing stops a Quick add being used twice and nothing counts
 *                 down: the note and the Quick adds are edited when a pancake is
 *                 reported eaten. The ingredients are a note dated 11/21 only (a
 *                 record). The 10/25 batch (1.95 kcal/g) is not touched.
 *   Rules         weigh-ins daily from 11/21 and Mon 11/23 Leg Day (−10%, RIR 2)
 *                 are already in the home plan. `weightQuietUntil` is 2026-12-10,
 *                 later than the 11/26 asked for, so it is left: moving it up
 *                 would switch alerts on for the 11/28 → 12/06 trips. Steps are
 *                 not read or written.
 *
 * Dry run unless `--apply`; every touched doc is backed up to ~/ignia-backups
 * first; a re-run plans nothing.
 *
 *   npx jiti scripts/owner-data-2026-11-21-close-day.mts [--apply]
 */
import { Timestamp, type DocumentReference } from 'firebase-admin/firestore';
import { homePlanOf, LOG_LABEL_MAX, LOG_NOTE_MAX, toCustomFoodDoc } from '../packages/core/src/index.ts';
import { at, CODEC, hm, open } from './lib/user-data.mts';

const OWNER = 'gabrielandresbermudez@gmail.com';
const s = await open('owner-data-2026-11-21-close-day');
const owner = await s.user(OWNER);

const dayRows = async (user: DocumentReference, day: string) => (await user.collection('dailyLogs')
  .where('timestamp', '>=', Timestamp.fromDate(at(day, '00:00')))
  .where('timestamp', '<', Timestamp.fromDate(new Date(at(day, '00:00').getTime() + 86_400_000)))
  .orderBy('timestamp').get()).docs;

// ── rows that exist and change: guarded on what was read ──
interface RowFix {
  id: string;
  was: { label: string; kcal: number; protein: number; note?: string };
  now: { label: string; kcal: number; protein: number; note: string };
}
const QDOBA_WAS_NOTE = 'Estimated (restaurant). Grilled adobo chicken ×2 ~380/38 · romaine base 15/1 · pico de gallo + salsa roja ~20/0 · fajita vegetables ~35/1 · pickled red onions ~10/0 · chile crema drizzle ~90/0 (estimate) · cotija light sprinkle ~25/1. No guac, rice, beans, shredded cheese or dressing.';
const ROW_FIXES: RowFix[] = [
  {
    id: 'Nov6lMpnxweK5pkCeNrR',
    was: { label: 'QDOBA salad bowl, double chicken', kcal: 575, protein: 41, note: QDOBA_WAS_NOTE },
    now: {
      label: 'QDOBA salad bowl, double chicken', kcal: 530, protein: 49,
      note: 'QDOBA’s official guide: adobo chicken 170 kcal / 23 g per scoop. Adobo chicken ×2 340/46 · romaine 15/1 · pico 5 · salsa roja 5 · fajita vegetables 40/1 · pickled red onion 10 · chile crema drizzle ~90 (estimate) · cotija sprinkle ~25/1.',
    },
  },
  {
    id: 'P9eNhdBW9k5911S5JJCj',
    was: { label: 'Oatmeal + Egg Whites', kcal: 375, protein: 34 },
    now: {
      label: 'Protein oats dinner bowl', kcal: 375, protein: 34,
      note: '½ c rolled oats 150/5 · ½ c liquid egg whites 63/13 · ¼ c low-fat milk 25/2 (label: 8 fl oz = 100 kcal / 8 g) · ½ c Kirkland Greek yogurt 75/13.5 · ½ c wild berries (microwaved) 40/0.5 · 1 tsp honey 21/0 · water, salt, cinnamon, vanilla. Method: oats on medium → egg whites stirred in hard → cold bowl + cold milk → warm berries, cold yogurt, honey. “Delicious; yogurt a little acidic. Keep this.” Held ~3.5 h.',
    },
  },
];
for (const f of ROW_FIXES) {
  if (f.now.note.length > LOG_NOTE_MAX) { s.problem(`note over ${LOG_NOTE_MAX} characters (${f.now.note.length}): ${f.now.label}`); continue; }
  const d = await owner.collection('dailyLogs').doc(f.id).get();
  if (!d.exists) { s.problem(`log ${f.id} ("${f.was.label}") is gone`); continue; }
  const is = (v: RowFix['was']) => d.get('mealLabel') === v.label && d.get('calories') === v.kcal && (d.get('protein') ?? 0) === v.protein && (d.get('note') ?? undefined) === v.note;
  if (is(f.now)) continue;
  if (!is(f.was)) { s.problem(`log ${f.id} is now "${d.get('mealLabel')}" ${d.get('calories')}/${d.get('protein')}, not the "${f.was.label}" ${f.was.kcal}/${f.was.protein} row that was read`); continue; }
  s.update(d, { mealLabel: f.now.label, calories: f.now.kcal, protein: f.now.protein, note: f.now.note },
    `${hm((d.get('timestamp') as Timestamp).toDate())} "${f.was.label}" ${f.was.kcal}/${f.was.protein} → "${f.now.label}" ${f.now.kcal}/${f.now.protein} + note`);
}

// ── 11/21: the one row that is missing, then the day is closed ──
const NEW_ROW = {
  day: '2026-11-21', time: '21:05', slot: 'dinner' as const, label: 'Olé green + 3 Canadian bacon', kcal: 120, protein: 14,
  note: 'Olé green 60/4 · Jones Canadian bacon 3 slices 60/10.',
};
/** Read on 11/21 and counted in the day's total: left exactly as they are. */
const KEPT_21 = [
  { id: '1OwEy3WTRrQZ0mbKqBns', label: 'Egg scramble + Canadian bacon + Olé', kcal: 470, protein: 60 },
  { id: 'YOP7bZm8G0CJwPF5R64w', label: 'Gathering lunch: chicken, salad, chips + hummus', kcal: 690, protein: 47 },
  { id: 'T1YFiuIAJAaey2ZhpiDt', label: 'Olé Xtreme green tortilla (Spinach & Herbs)', kcal: 60, protein: 4 },
  { id: 'k8kUKi13aB64CxaIAumN', label: 'Olé Xtreme green tortilla (Spinach & Herbs)', kcal: 60, protein: 4 },
];
const rows21 = await dayRows(owner, '2026-11-21');
for (const k of KEPT_21) {
  const d = rows21.find((r) => r.id === k.id);
  if (!d || d.get('mealLabel') !== k.label || d.get('calories') !== k.kcal || d.get('protein') !== k.protein) s.problem(`11/21 log ${k.id} is not the "${k.label}" ${k.kcal}/${k.protein} row that was read`);
}
const known21 = new Set([...KEPT_21.map((k) => k.id), 'P9eNhdBW9k5911S5JJCj']);
const extra21 = rows21.filter((r) => !known21.has(r.id));
const haveNew = extra21.find((r) => r.get('mealLabel') === NEW_ROW.label && r.get('calories') === NEW_ROW.kcal && r.get('protein') === NEW_ROW.protein);
const strangers21 = extra21.filter((r) => r !== haveNew);
if (strangers21.length) s.problem(`11/21 has rows that were not there when it was read: ${strangers21.map((r) => `"${r.get('mealLabel')}" ${r.get('calories')}/${r.get('protein') ?? 0}`).join(', ')}`);
else {
  if (!haveNew) s.logMeal(owner, NEW_ROW);
  s.markDay(await owner.collection('dailyLogged').doc('2026-11-21').get(), true);
}
s.note('11/21 "Olé green ×2" is the two "Olé Xtreme green tortilla (Spinach & Herbs)" 60/4 rows the owner logged at 21:02 and 21:03: not logged again');
s.note('11/21 "Protein oats dinner bowl" keeps the time it was logged at (17:52), not 17:30');

// ── My Foods: the two QDOBA bowls, and the batch at its own density ──
const customFoods = (await owner.collection('customFoods').get()).docs;
const FOOD_FIXES = [
  { id: '4vN3MEW6ZCbb3eRvCAOs', name: 'QDOBA salad bowl, double chicken (with chile crema)', was: [575, 41], now: [530, 49] },
  { id: 'tTA6LfmgAPE7K3abirUU', name: 'QDOBA salad bowl, double chicken (no crema)', was: [485, 41], now: [440, 49] },
];
for (const f of FOOD_FIXES) {
  const d = customFoods.find((c) => c.id === f.id);
  const have = d ? [d.get('calories'), d.get('protein')] : null;
  if (!d || d.get('name') !== f.name) { s.problem(`My Foods ${f.id} is not "${f.name}"`); continue; }
  if (have![0] === f.now[0] && have![1] === f.now[1]) continue;
  if (have![0] !== f.was[0] || have![1] !== f.was[1]) { s.problem(`My Foods "${f.name}" is ${have!.join('/')}, not the ${f.was.join('/')} that was read`); continue; }
  s.update(d, { calories: f.now[0], protein: f.now[1] }, `My Foods "${f.name}" ${f.was.join('/')} → ${f.now.join('/')}`);
}

const BATCH = { name: 'Build C pancakes — batch 2026-11-21', grams: 704, kcal: 1235, protein: 142 };
const PER_100 = { calories: Math.round((BATCH.kcal / BATCH.grams) * 100), protein: Math.round((BATCH.protein / BATCH.grams) * 100) }; // 175 / 20
const haveBatch = customFoods.find((c) => c.get('name') === BATCH.name);
if (BATCH.name.length > LOG_LABEL_MAX) s.problem('batch name too long');
else if (!haveBatch) {
  s.set(
    owner.collection('customFoods').doc(),
    toCustomFoodDoc({ name: BATCH.name, servingSize: 100, servingUnit: 'g', calories: PER_100.calories, protein: PER_100.protein, source: 'manual', createdAt: new Date() }, CODEC),
    `SAVE "${BATCH.name}" ${PER_100.calories}/${PER_100.protein} per 100 g (My Foods; 1,235 kcal / 142 g over 704 g cooked = 1.754 kcal/g, 0.202 g protein/g)`,
  );
} else if (haveBatch.get('calories') !== PER_100.calories || haveBatch.get('protein') !== PER_100.protein || haveBatch.get('servingSize') !== 100) {
  s.problem(`My Foods "${BATCH.name}" exists as ${haveBatch.get('calories')}/${haveBatch.get('protein')} per ${haveBatch.get('servingSize')} ${haveBatch.get('servingUnit')}`);
}
s.note('left alone: My Foods "Build C pancake — 2026-10-25 batch (used up 10/29)" 195/22 per 100 g and every row logged from it');

// ── Quick add: the four weighed pancakes, and the four meals ──
const PANCAKES = [
  { g: 125, calories: 219, protein: 25 },
  { g: 167, calories: 293, protein: 34 },
  { g: 196, calories: 344, protein: 40 },
  { g: 216, calories: 379, protein: 44 },
];
if (PANCAKES.reduce((n, p) => n + p.g, 0) !== BATCH.grams || PANCAKES.reduce((n, p) => n + p.calories, 0) !== BATCH.kcal) s.problem('the four portions do not add up to the batch');
const QUICK = [
  ...PANCAKES.map((p) => ({ name: `Pancake ${p.g} g (Build C, 11/21 batch)`, calories: p.calories, protein: p.protein })),
  { name: 'Protein oats dinner bowl', calories: 375, protein: 34 },
  { name: 'Protein oats, lighter (⅓ c oats)', calories: 325, protein: 32 },
  { name: 'Olé green + 3 Canadian bacon', calories: 120, protein: 14 },
  { name: 'Bunless patty plate (patty, onion, yogurt sauce, broccolini)', calories: 465, protein: 33 },
];
const presets = (await owner.collection('presets').get()).docs;
for (const q of QUICK) {
  const have = presets.find((d) => d.get('name') === q.name);
  if (!have) s.saveMeal(owner, 'quickAdd', q);
  else if (have.get('calories') !== q.calories || have.get('protein') !== q.protein) s.problem(`Quick add "${q.name}" exists as ${have.get('calories')}/${have.get('protein')}`);
}

// ── home plan: what is in the fridge (shows on Today through 11/25), and the recipe ──
const FRIDGE = {
  from: '2026-11-21', to: '2026-11-25', label: 'Build C pancakes — 4 left, good through Wed 11/25',
  note: 'Batch 11/21: 4 pancakes · 704 g cooked · 1,235 kcal / 142 g = 1.754 kcal/g · 0.202 g protein/g. Left: 125 g 219/25 · 167 g 293/34 · 196 g 344/40 · 216 g 379/44 (Quick add, one each). Future batches: density = batch kcal ÷ cooked batch weight.',
};
const RECIPE = {
  from: '2026-11-21', to: '2026-11-21', label: 'Build C pancakes — batch 2026-11-21, ingredients',
  note: '199 g Kodiak Power Cakes · 1 c liquid egg whites · 1 c Kirkland Greek yogurt · ½ c Daisy low fat cottage cheese · 79 g banana · 1 scoop Nutricost whey · vanilla, cinnamon. No whole eggs, no milk.',
};
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
else if (!plan.notes.some((n) => n.from === '2026-11-20' && n.to === '2026-11-20' && /no compensation/.test(n.label))) s.problem('the 11/20 "at maintenance, no compensation" note is gone');
else if (plan.weightQuietUntil !== '2026-12-10') s.problem(`weightQuietUntil is ${plan.weightQuietUntil}, not the 2026-12-10 that was read`);
else {
  const notes = [...plan.notes];
  for (const add of [FRIDGE, RECIPE]) {
    if (add.label.length > 80 || add.note.length > 300) { s.problem(`home-plan note too long: ${add.label} (${add.label.length}/${add.note.length})`); continue; }
    const have = notes.find((n) => n.from === add.from && n.to === add.to && /^Build C pancakes/.test(n.label) && (add === RECIPE) === /ingredients$/.test(n.label));
    if (!have) notes.push(add);
  }
  const next = homePlanOf({ homePlan: { ...plan, notes } })!;
  if (next.notes!.length !== notes.length) s.problem('core `homePlanOf` dropped a note');
  else if (stable(next) !== stable(plan)) s.update(profile, { homePlan: JSON.parse(JSON.stringify(next)) }, `homePlan: + "${FRIDGE.label}" (11/21 → 11/25, shows on Today) · + the batch's ingredients (11/21) — ${next.notes!.length} notes`);
}
s.note('already in the home plan, not rewritten: weigh-ins daily from Sat 11/21 · Mon 11/23 Leg Day at −10%, RIR 2 · the 11/20 "at maintenance, no compensation" note');
s.note('weightQuietUntil stays 2026-12-10 (covers the 11/26 asked for; moving it up would switch alerts on during the 11/28 → 12/06 trips) · steps and targets are not read or written');

await s.run({
  report: async () => {
    for (const day of ['2026-11-20', '2026-11-21']) {
      const docs = await dayRows(owner, day);
      const kcal = docs.reduce((n, d) => n + (d.get('calories') ?? 0), 0);
      const protein = docs.reduce((n, d) => n + (d.get('protein') ?? 0), 0);
      const flag = await owner.collection('dailyLogged').doc(day).get();
      console.log(`\n${day}: ${docs.length} rows = ${kcal} kcal / ${protein} g · fully logged: ${flag.exists ? flag.get('complete') : 'open'}`);
      for (const d of docs) console.log(`  ${hm((d.get('timestamp') as Timestamp).toDate()).slice(7)} ${String(d.get('mealType')).padEnd(9)} "${d.get('mealLabel')}" ${d.get('calories')}/${d.get('protein') ?? 0}${d.get('note') ? ' · note' : ''}`);
    }
    const foods = (await owner.collection('customFoods').get()).docs.filter((d) => /qdoba|pancake/i.test(String(d.get('name'))));
    console.log(`\nMy Foods:\n  ${foods.map((d) => `"${d.get('name')}" ${d.get('calories')}/${d.get('protein')} per ${d.get('servingSize')} ${d.get('servingUnit')}`).join('\n  ')}`);
    const names = new Set(QUICK.map((q) => q.name));
    const saved = (await owner.collection('presets').get()).docs.filter((d) => names.has(String(d.get('name'))));
    console.log(`\nQuick add (${saved.length} of ${QUICK.length}):\n  ${saved.map((d) => `"${d.get('name')}" ${d.get('calories')}/${d.get('protein')}`).join('\n  ') || 'none yet'}`);
    const now = homePlanOf({ homePlan: (await owner.get()).get('homePlan') });
    console.log(`\nhome-plan notes touching 11/20–11/25:\n  ${(now?.notes ?? []).filter((n) => n.from <= '2026-11-25' && n.to >= '2026-11-20').map((n) => `[${n.from}→${n.to}] ${n.label}: ${n.note}`).join('\n  ')}`);
  },
});
