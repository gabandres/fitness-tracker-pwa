/**
 * Owner data, requested 2026-11-22 (America/Puerto_Rico): note the 11/22
 * weigh-in, log 11/22's five meals (day left open), mark the 125 g pancake
 * eaten, four Quick adds, a lunch-satiety note for the day, and print Mon
 * 11/23's Leg Day re-entry plan. Values are the owner's, entered exactly.
 *
 * What the read found (2026-11-22, `scripts/user-state.mts`):
 *
 *   11/22 weight  154.0 lb is ALREADY stored: only the note is added.
 *                 `weightQuietUntil` is 2026-12-10, which already covers "no
 *                 weight alerts before 11/26": left.
 *   11/22 meals   no rows yet: five are created → 1,420 / 145. "UNREAL" is
 *                 logged as "Unreal", the name of the 11/20 row and of the
 *                 stored Quick add (one food, one name in Recents); the black
 *                 coffee (0) goes in its note. Lunch is "estimated" in its note
 *                 (a row has no flag). The day carries no "fully logged" flag.
 *   Pancakes      the batch record is the home-plan note 11/21 → 11/25 and one
 *                 Quick add per pancake (as written by
 *                 `owner-data-2026-11-21-close-day.mts`): the note now says 3
 *                 left, 125 g used 11/22, and the "Pancake 125 g" Quick add is
 *                 removed (backed up) so it cannot be logged twice.
 *   Quick add     `presets`. The older "Protein oats dinner bowl" 375/34 (with
 *                 honey) stays beside the new no-honey one.
 *   Day note      a home-plan note dated 11/22 only, as for 11/20.
 *   Leg Day       nothing is written: the trip (10/31 → 11/18) and the 11/23 →
 *                 11/27 re-entry note are already stored. The report runs core
 *                 `reentryFor` / `reentryRuleFor` / `sessionCall` /
 *                 `reentryLoad` to show what the app will seed, and refuses
 *                 when 11/23 is not a −10 %, RIR 2 re-entry session.
 *
 * No steps, no targets, no maintenance inputs (ADR-0024). Dry run unless
 * `--apply`; every touched doc is backed up to ~/ignia-backups first; a re-run
 * plans nothing.
 *
 *   npx jiti scripts/owner-data-2026-11-22-meals.mts [--apply]
 */
import { Timestamp, type DocumentReference } from 'firebase-admin/firestore';
import type { Exercise, WorkoutSession } from '../packages/core/src/workout.ts';
import {
  dumbbellStepLb,
  homePlanOf,
  LOG_LABEL_MAX,
  LOG_NOTE_MAX,
  MIDNIGHT,
  recommendOptionsFor,
  reentryFor,
  reentryLoad,
  reentryRuleFor,
  sessionCall,
  toWorkoutExercise,
  toWorkoutSession,
  toWorkoutTemplate,
  travelPeriodsOf,
} from '../packages/core/src/index.ts';
import { at, hm, open } from './lib/user-data.mts';

const OWNER = 'gabrielandresbermudez@gmail.com';
const DAY = '2026-11-22';
const s = await open('owner-data-2026-11-22-meals');
const owner = await s.user(OWNER);

const dayRows = async (user: DocumentReference, day: string) => (await user.collection('dailyLogs')
  .where('timestamp', '>=', Timestamp.fromDate(at(day, '00:00')))
  .where('timestamp', '<', Timestamp.fromDate(new Date(at(day, '00:00').getTime() + 86_400_000)))
  .orderBy('timestamp').get()).docs;

// ── 11/22: the weigh-in's note ──
const WEIGHT_NOTE = 'post-trip water clearing (154.8 → 154.0)';
const w = await owner.collection('dailyWeights').doc(DAY).get();
if (!w.exists || w.get('weight') !== 154) s.problem(`dailyWeights/${DAY} is ${w.exists ? w.get('weight') : 'absent'}, not the 154.0 that was read`);
else if (w.get('note') !== WEIGHT_NOTE) {
  if (w.get('note') != null) s.problem(`dailyWeights/${DAY} already has a different note: ${w.get('note')}`);
  else s.update(w, { note: WEIGHT_NOTE }, `dailyWeights/${DAY} 154.0 lb (already stored) + note`);
}

// ── 11/22: the five meals ──
const MEALS = [
  {
    day: DAY, time: '09:00', slot: 'breakfast' as const, label: 'Pancake + 2 eggs + Canadian bacon', kcal: 420, protein: 48,
    note: 'Build C pancake 125 g 219/25 (batch 2026-11-21, 1.754 kcal/g, 0.202 g protein/g) · 2 large eggs 140/12.5 · Jones Canadian bacon 3 slices 60/10. No butter or syrup.',
  },
  {
    day: DAY, time: '13:20', slot: 'lunch' as const, label: 'White fish + sweet kale salad (no dressing)', kcal: 310, protein: 39,
    note: 'Estimated. Pan-seared white fish 145 g cooked (weighed) ~180/36 · cooking fat absorbed ~1 tsp ~40/0 · sweet kale chopped salad ~1 cup with dried cranberries and pumpkin seeds, NO dressing ~90/3. Fish type not yet confirmed (assumed lean white fish such as tilapia).',
  },
  { day: DAY, time: '14:30', slot: 'snack' as const, label: 'Unreal', kcal: 90, protein: 2, note: 'With black coffee, no milk or sugar (0).' },
  { day: DAY, time: '14:55', slot: 'snack' as const, label: 'Kirkland protein bar', kcal: 190, protein: 21, note: 'hungry ~90 min after a 310 kcal lunch' },
  {
    day: DAY, time: '18:30', slot: 'dinner' as const, label: 'Protein oats dinner bowl + banana (no honey)', kcal: 410, protein: 35,
    note: '½ c rolled oats 150/5 · ½ c liquid egg whites 63/13 · ¼ c low-fat milk 25/2 · ½ c Kirkland Greek yogurt 75/13.5 · ½ c wild berries (microwaved) 40/0.5 · banana 62 g (weighed) 55/1 · water, pinch of salt. No honey, no vanilla, no cinnamon. “Fine without them.”',
  },
];
const total = MEALS.reduce((n, m) => [n[0] + m.kcal, n[1] + m.protein], [0, 0]);
if (total[0] !== 1420 || total[1] !== 145) s.problem(`the five meals add up to ${total.join('/')}, not 1,420 / 145`);
const rows = await dayRows(owner, DAY);
for (const m of MEALS) {
  if (m.label.length > LOG_LABEL_MAX || m.note.length > LOG_NOTE_MAX) { s.problem(`label or note too long: ${m.label}`); continue; }
  const have = rows.find((d) => d.get('mealLabel') === m.label);
  if (!have) s.logMeal(owner, m);
  else if (have.get('calories') !== m.kcal || have.get('protein') !== m.protein) s.problem(`${DAY} already has "${m.label}" as ${have.get('calories')}/${have.get('protein')}`);
}
const strangers = rows.filter((d) => !MEALS.some((m) => m.label === d.get('mealLabel')));
if (strangers.length) s.problem(`${DAY} has rows that were not there when it was read: ${strangers.map((d) => `"${d.get('mealLabel')}" ${d.get('calories')}/${d.get('protein') ?? 0}`).join(', ')}`);
// Open for an evening snack: no "fully logged" answer.
s.markDay(await owner.collection('dailyLogged').doc(DAY).get(), null);

// ── Quick add: four new, and the eaten pancake's goes ──
const QUICK = [
  { name: 'Protein oats dinner bowl + banana, no honey', calories: 410, protein: 35 },
  { name: 'Pancake (125 g) + 2 eggs + 3 Canadian bacon', calories: 420, protein: 48 },
  { name: 'White fish 145 g, pan-seared', calories: 220, protein: 36 },
  { name: 'Sweet kale salad, no dressing (1 cup)', calories: 90, protein: 3 },
];
const presets = (await owner.collection('presets').get()).docs;
for (const q of QUICK) {
  const have = presets.find((d) => d.get('name') === q.name);
  if (!have) s.saveMeal(owner, 'quickAdd', q);
  else if (have.get('calories') !== q.calories || have.get('protein') !== q.protein) s.problem(`Quick add "${q.name}" exists as ${have.get('calories')}/${have.get('protein')}`);
}
const EATEN = { id: 'MBvYMEDlbny1Vwo3TDUy', name: 'Pancake 125 g (Build C, 11/21 batch)', calories: 219, protein: 25 };
const eaten = presets.find((d) => d.id === EATEN.id);
if (eaten) {
  if (eaten.get('name') !== EATEN.name || eaten.get('calories') !== EATEN.calories || eaten.get('protein') !== EATEN.protein) s.problem(`Quick add ${EATEN.id} is not "${EATEN.name}" ${EATEN.calories}/${EATEN.protein}`);
  else s.remove(eaten, `REMOVE Quick add "${EATEN.name}" ${EATEN.calories}/${EATEN.protein} (eaten 11/22 breakfast)`);
}
for (const g of [167, 196, 216]) if (!presets.some((d) => d.get('name') === `Pancake ${g} g (Build C, 11/21 batch)`)) s.problem(`the "Pancake ${g} g" Quick add is gone`);
s.note('left alone: Quick add "Protein oats dinner bowl" 375/34 (the honey version) and "Unreal" 90/2');

// ── home plan: the batch note, and the day's lunch note ──
const FRIDGE_WAS = 'Build C pancakes — 4 left, good through Wed 11/25';
const FRIDGE = {
  from: '2026-11-21', to: '2026-11-25', label: 'Build C pancakes — 3 left, good through Wed 11/25',
  note: 'Batch 11/21: 4 pancakes · 704 g cooked · 1,235 kcal / 142 g = 1.754 kcal/g · 0.202 g protein/g. Used: 125 g (11/22 breakfast). Left: 167 g 293/34 · 196 g 344/40 · 216 g 379/44 (Quick add, one each).',
};
const LUNCH = {
  from: DAY, to: DAY, label: 'Sun 11/22 — light lunch held ~90 min',
  note: 'lean fish + salad (310 kcal) held only ~90 min; lunches of 450–500 kcal with starch or 2 Olé tortillas hold 3.5–4 h',
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
else if (plan.weightQuietUntil !== '2026-12-10') s.problem(`weightQuietUntil is ${plan.weightQuietUntil}, not the 2026-12-10 that was read`);
else {
  const fridge = plan.notes.find((n) => n.from === FRIDGE.from && n.to === FRIDGE.to && (n.label === FRIDGE_WAS || n.label === FRIDGE.label));
  if (!fridge) s.problem(`home-plan note "${FRIDGE_WAS}" is gone`);
  else {
    for (const n of [FRIDGE, LUNCH]) if (n.label.length > 80 || n.note.length > 300) s.problem(`home-plan note too long: ${n.label} (${n.label.length}/${n.note.length})`);
    const notes = plan.notes.map((n) => (n === fridge ? FRIDGE : n));
    if (!notes.some((n) => n.from === LUNCH.from && n.label === LUNCH.label)) notes.push(LUNCH);
    const next = homePlanOf({ homePlan: { ...plan, notes } })!;
    if (next.notes!.length !== notes.length || !next.notes!.some((n) => n.note === FRIDGE.note) || !next.notes!.some((n) => n.note === LUNCH.note)) s.problem('core `homePlanOf` dropped or cut a note');
    else if (stable(next) !== stable(plan)) s.update(profile, { homePlan: JSON.parse(JSON.stringify(next)) }, `homePlan: "${FRIDGE.label}" (125 g used) · + "${LUNCH.label}" (11/22) — ${next.notes!.length} notes`);
  }
}
s.note('already stored, not rewritten: weightQuietUntil 2026-12-10 · "No training 11/20 → 11/22" · the 11/23 → 11/27 re-entry note · steps are not read or written');

// ── Mon 11/23 Leg Day: what the app will seed (read only) ──
const LEG = 'quxwARQlCnItzpLJgcr4';
const TOMORROW = '2026-11-23';
const [exSnap, sesSnap, tplSnap] = await Promise.all([owner.collection('exercises').get(), owner.collection('workoutSessions').get(), owner.collection('workoutTemplates').get()]);
const catalog: Exercise[] = exSnap.docs.map((d) => toWorkoutExercise(d.id, d.data()));
const catOf = (id: string) => catalog.find((c) => c.id === id);
const dbStep = dumbbellStepLb(profile.get('dumbbellHalfSteps') as boolean | undefined);
const engineCat = (id: string) => { const c = catOf(id); return c ? { ...c, dumbbellStepLb: dbStep } : null; };
const sessions: WorkoutSession[] = sesSnap.docs.map((d) => toWorkoutSession(d.id, d.data()));
const periods = travelPeriodsOf(profile.data() ?? {});
const travelIds = new Set(tplSnap.docs.filter((d) => String(d.get('templateVersion') ?? '').startsWith('travel')).map((d) => d.id));
const legDoc = tplSnap.docs.find((d) => d.id === LEG);
const legPlan: string[] = [];
if (!legDoc) s.problem(`Leg Day template ${LEG} is gone`);
else {
  const kind = reentryFor({ templateId: LEG, today: TOMORROW, sessions, periods, travelTemplateIds: travelIds, templateCreatedAt: (legDoc.get('createdAt') as Timestamp | undefined)?.toDate(), boundary: MIDNIGHT });
  const period = periods.find((p) => p.end < TOMORROW && p.start === '2026-10-31') ?? null;
  const rule = kind ? reentryRuleFor(kind, LEG, period) : null;
  if (!rule || rule.loadPct !== 10 || rule.rir !== 2) s.problem(`the app does not make ${TOMORROW} Leg Day a −10 %, RIR 2 re-entry (got ${kind ?? 'none'}${rule ? `, −${rule.loadPct}%, RIR ${rule.rir}` : ''})`);
  else {
    const t = toWorkoutTemplate(LEG, legDoc.data());
    const completed = sessions.filter((x) => x.status === 'completed').sort((x, y) => y.date.getTime() - x.date.getTime());
    legPlan.push(`${t.name} · ${kind} re-entry: −${rule.loadPct}% loads, RIR ${rule.rir} on every set, no failure`);
    for (const r of t.exercises) {
      const call = sessionCall(r, completed, engineCat(r.exerciseId));
      const seed = call.rec.action !== 'none' && call.rec.load != null ? call.rec.load : (r.targetLoad ?? 0);
      const { config } = recommendOptionsFor(r, engineCat(r.exerciseId));
      const step = { loadSteps: config?.loadSteps, stepLb: config?.stepLb ?? 5, loadGrid: config?.loadGrid, assisted: catOf(r.exerciseId)?.assisted === true };
      const load = reentryLoad(seed, step, 1 - rule.loadPct / 100, rule.round);
      const sets = r.plannedSets?.length ?? 0;
      const reps = r.plannedSets?.map((p) => p.reps).filter((x) => x != null).join('/') ?? '';
      legPlan.push(`${r.name}: ${sets} sets${reps ? ` × ${reps}` : ''} · ${seed === 0 ? 'bodyweight' : `${seed} → ${load} lb${step.assisted ? ' (assistance)' : ''}`}`);
    }
  }
}
for (const l of legPlan) s.note(`Leg Day ${TOMORROW} (read only): ${l}`);

await s.run({
  report: async () => {
    const docs = await dayRows(owner, DAY);
    const kcal = docs.reduce((n, d) => n + (d.get('calories') ?? 0), 0);
    const protein = docs.reduce((n, d) => n + (d.get('protein') ?? 0), 0);
    const flag = await owner.collection('dailyLogged').doc(DAY).get();
    const wt = await owner.collection('dailyWeights').doc(DAY).get();
    console.log(`\n${DAY}: ${docs.length} rows = ${kcal} kcal / ${protein} g · fully logged: ${flag.exists ? flag.get('complete') : 'open'} · weigh-in: ${wt.exists ? `${wt.get('weight')} lb${wt.get('note') ? ` ("${wt.get('note')}")` : ''}` : '—'}`);
    for (const d of docs) console.log(`  ${hm((d.get('timestamp') as Timestamp).toDate()).slice(7)} ${String(d.get('mealType')).padEnd(9)} "${d.get('mealLabel')}" ${d.get('calories')}/${d.get('protein') ?? 0}${d.get('note') ? ' · note' : ''}`);
    const all = (await owner.collection('presets').get()).docs;
    const mine = all.filter((d) => QUICK.some((q) => q.name === d.get('name')) || /^Pancake \d+ g \(Build C, 11\/21/.test(String(d.get('name'))));
    console.log(`\nQuick add:\n  ${mine.map((d) => `"${d.get('name')}" ${d.get('calories')}/${d.get('protein')}`).join('\n  ')}`);
    const now = homePlanOf({ homePlan: (await owner.get()).get('homePlan') });
    console.log(`\nhome-plan notes touching 11/22–11/23:\n  ${(now?.notes ?? []).filter((n) => n.from <= '2026-11-23' && n.to >= DAY).map((n) => `[${n.from}→${n.to}] ${n.label}: ${n.note}`).join('\n  ')}`);
    console.log(`\nMon ${TOMORROW}:\n  ${legPlan.join('\n  ')}`);
  },
});
