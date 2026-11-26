/**
 * Owner data, requested 2026-11-25 (America/Puerto_Rico): log and close 11/25
 * (five meals, the day note), the QDOBA bowl and the Denny's skillet saved, the
 * 11/21 pancake batch finished, the 11/25 Pull Day note's final wording, the
 * hollow-body cue, and Push Day's deficit push-up → Seated Chest Press Machine.
 * The other account (stph) is not opened.
 *
 * What the read found (2026-11-25, `user-state.mts` + a read of sessions,
 * templates, drafts and the catalog):
 *
 *   11/25 meals    none stored; no oats row to remove. Five created → 1,954 / 188.
 *                  "Fully logged" unset → true. Weigh-in 151.8 stored: read only.
 *   Day note       none for 11/25 → a home-plan note (the 11/24 precedent).
 *   Batch 11/21    My Foods "Build C pancakes — batch 2026-11-21" → "(used up
 *                  11/25)" (the 10/25 batch precedent); the home-plan note
 *                  "1 left, for Wed 11/25" → "used up 11/25". The Quick add
 *                  "Pancake 216 g (Build C, 11/21 batch)" stays.
 *   QDOBA          there is NO QDOBA Quick add: the saved bowls are My Foods
 *                  (11/21 close-day). The 530/49 one ("with chile crema") is the
 *                  bowl to replace → "QDOBA bowl (standard build)" 525/47. 575/41
 *                  and 750/72 exist nowhere. The 440/49 "no crema" variant stays.
 *   Denny's        no saved skillet → My Foods 881/65. My Foods has no sugar or
 *                  sodium field (rules `isValidCustomFood`, core `toCustomFoodDoc`):
 *                  35 g / 1,900 mg are not stored anywhere.
 *   Session        11/25 Pull Day: R calf sets and the skipped leg curl are stored
 *                  (pull-review, 96c8cff). sessionNote → the request's wording
 *                  (adds "lower back arched, load too heavy").
 *   templateVersion NOT changed. On a session it is the Program draft marker:
 *                  rules allow only 'v1' | 'v2' (`firestore.rules` workoutSessions),
 *                  core types it `'v1' | 'v2'` and the mapper drops anything else,
 *                  so "v2.4" would make the app's next save of either session fail
 *                  the rules. Sets carry no version. New sessions inheriting
 *                  "v2.4" is a code change (rules + core + app), not data.
 *   Pull 12/07     pull-up BW (+5 at 15), machine row 110 ×2, pulldown 90, chest
 *                  row 40, calf 35 both legs, hollow 5: all stored (pull-review).
 *                  The "re-entry −5 %" was the Bolivia period rule, already Push
 *                  only; the template has no flag of its own. Checked.
 *   Hollow cue     Pull + Push: the 11/25 cue → the request's exercise note.
 *   Push Day       Deficit Push-up row (6th, 1 cluster) → Seated Chest Press
 *                  Machine, a new catalog lift tagged like the push-up (chest,
 *                  triceps, shoulders → chest 1, triceps ½, front delt ½); no
 *                  target load; Deficit Push-up kept as the row's alternative and
 *                  in the catalog with its 6 sessions.
 *   Travel         all eight archived (pull-review): checked only.
 *
 * No steps, no targets, no maintenance inputs (ADR-0024).
 * Dry run unless `--apply`; a re-run plans nothing.
 *
 *   npx jiti scripts/owner-data-2026-11-25-close-day.mts [--apply]
 */
import { Timestamp, type DocumentData, type DocumentReference } from 'firebase-admin/firestore';
import type { TemplateExercise } from '../packages/core/src/workout.ts';
import { homePlanOf, plannedVolume, toExerciseDoc, toWorkoutExercise, toWorkoutTemplate, travelPeriodsOf } from '../packages/core/src/index.ts';
import { at, CODEC, hm, open } from './lib/user-data.mts';

const OWNER = 'gabrielandresbermudez@gmail.com';
const DAY = '2026-11-25';
const s = await open('owner-data-2026-11-25-close-day');
const owner = await s.user(OWNER);
const now = new Date();
const stamp = now.toISOString();

const LEG = 'quxwARQlCnItzpLJgcr4';
const PULL = 'aliWJBD2FND6mU9foLdC';
const PUSH = 'Nx1bxeRuH6bMnGgX7Trv';
const PULL_SESSION = 'qBUEwjTEPy9PUERvnL5V';
const LEG_SESSION = 'xjcuEXssMncY9EOLMIhA';
const EX = { machineRow: '9x3b6rmxlxJyWWSMat3w', pulldown: 'oxOuktVhb6Ghgg7hGkCk', chestRow: 'acs1BlQvTZdL97i5jXJv', calf: 'm5E72J63gVXltnQ0zC8f', pullUp: 'GOGOcWJNC9q9aBmN3ENq', hollow: 'home-weighted-hollow-body-ext', deficit: 'Zqb1sTIfs0olSLeDFlx1' };
const PRESS = { id: 'home-seated-chest-press-machine', name: 'Seated Chest Press Machine' };

const stable = (v: unknown): string => {
  if (v instanceof Timestamp) return JSON.stringify(v.toMillis());
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v).filter((k) => (v as Record<string, unknown>)[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${stable((v as Record<string, unknown>)[k])}`).join(',')}}`;
  return JSON.stringify(v);
};
const json = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
const dayRows = async (user: DocumentReference, day: string) => (await user.collection('dailyLogs')
  .where('timestamp', '>=', Timestamp.fromDate(at(day, '00:00')))
  .where('timestamp', '<', Timestamp.fromDate(new Date(at(day, '00:00').getTime() + 86_400_000)))
  .orderBy('timestamp').get()).docs;

const [profile, foods, presets, exSnap, sesSnap, tplSnap, weight, rows] = await Promise.all([
  owner.get(), owner.collection('customFoods').get(), owner.collection('presets').get(), owner.collection('exercises').get(),
  owner.collection('workoutSessions').get(), owner.collection('workoutTemplates').get(), owner.collection('dailyWeights').doc(DAY).get(), dayRows(owner, DAY),
]);

// ── A. the five meals ──
const MEALS = [
  { day: DAY, time: '09:40', slot: 'breakfast' as const, label: 'Pancake + 2 eggs + Canadian bacon', kcal: 569, protein: 64,
    note: 'Build C pancake 216 g (batch 11/21, 1.754 kcal/g) 379/44 · 2 eggs 140/12 · 2.5 slices Jones Canadian bacon 50/8. Last pancake of the 11/21 batch.' },
  { day: DAY, time: '12:30', slot: 'lunch' as const, label: 'QDOBA bowl (standard build)', kcal: 525, protein: 47,
    note: 'Estimated. Lettuce base, chicken, black beans, pico, pickled red onions, chile crema, salsa roja, tomato salsa. No cheese, no guac.' },
  { day: DAY, time: '15:30', slot: 'snack' as const, label: 'Kirkland protein bar', kcal: 190, protein: 21 },
  { day: DAY, time: '18:30', slot: 'snack' as const, label: 'Kirkland protein bar', kcal: 190, protein: 21 },
  { day: DAY, time: '21:30', slot: 'dinner' as const, label: 'Denny\'s Bourbon Chicken Sizzlin\' Skillet (partial)', kcal: 480, protein: 35,
    note: 'Estimated. Listed 881/65 for the full skillet. Left about one chicken breast and most of the potatoes (~400 kcal / 30 g uneaten). No toast or tortillas, no fries. Water to drink. Replaced the planned protein oats (power outage in Bayamón).' },
];
const total = MEALS.reduce((n, m) => [n[0] + m.kcal, n[1] + m.protein], [0, 0]);
if (total[0] !== 1954 || total[1] !== 188) s.problem(`the five meals add up to ${total.join('/')}, not 1,954 / 188`);
const key = (d: { time: string; label: string; kcal: number; protein: number }) => `${d.time}|${d.label}|${d.kcal}|${d.protein}`;
const storedKeys = rows.map((d) => key({ time: hm((d.get('timestamp') as Timestamp).toDate()).slice(7), label: String(d.get('mealLabel')), kcal: d.get('calories'), protein: d.get('protein') ?? 0 }));
const wanted = MEALS.map(key);
const strangers = rows.filter((_, i) => !wanted.includes(storedKeys[i]!));
if (strangers.length) s.problem(`${DAY} has rows not in the request: ${strangers.map((d) => `"${d.get('mealLabel')}" ${d.get('calories')}/${d.get('protein') ?? 0}`).join(', ')}`);
else for (const m of MEALS) if (!storedKeys.includes(key(m))) s.logMeal(owner, m);
s.markDay(await owner.collection('dailyLogged').doc(DAY).get(), true);
if (!weight.exists || weight.get('weight') !== 151.8) s.problem(`dailyWeights/${DAY} is ${weight.exists ? weight.get('weight') : 'absent'}, not 151.8`);

// ── B. saved meals ──
const BATCH = { id: 'zPqX5WB69F1a7JjW363U', was: 'Build C pancakes — batch 2026-11-21', now: 'Build C pancakes — batch 2026-11-21 (used up 11/25)' };
const QDOBA = { id: '4vN3MEW6ZCbb3eRvCAOs', was: ['QDOBA salad bowl, double chicken (with chile crema)', 530, 49] as const, now: ['QDOBA bowl (standard build)', 525, 47] as const };
const DENNYS = { name: 'Denny\'s Bourbon Chicken Sizzlin\' Skillet (full)', calories: 881, protein: 65 };
const food = (id: string) => foods.docs.find((d) => d.id === id);
const b = food(BATCH.id);
if (!b) s.problem('the 11/21 batch My Food is gone');
else if (b.get('name') !== BATCH.now) {
  if (b.get('name') !== BATCH.was) s.problem(`the batch My Food is "${b.get('name')}"`);
  else s.update(b, { name: BATCH.now }, `My Foods "${BATCH.was}" → "${BATCH.now}" (${b.get('calories')}/${b.get('protein')} kept)`);
}
const q = food(QDOBA.id);
const qNow = q && [q.get('name'), q.get('calories'), q.get('protein')];
if (!q) s.problem('the QDOBA My Food is gone');
else if (stable(qNow) !== stable(QDOBA.now)) {
  if (stable(qNow) !== stable(QDOBA.was)) s.problem(`the QDOBA My Food is ${qNow!.join(' ')}`);
  else s.update(q, { name: QDOBA.now[0], calories: QDOBA.now[1], protein: QDOBA.now[2] }, `My Foods "${QDOBA.was[0]}" ${QDOBA.was[1]}/${QDOBA.was[2]} → "${QDOBA.now[0]}" ${QDOBA.now[1]}/${QDOBA.now[2]}`);
}
if (presets.docs.some((d) => /qdoba/i.test(String(d.get('name'))))) s.problem('a QDOBA Quick add exists now: it was not there when read');
const dn = foods.docs.filter((d) => /denny/i.test(String(d.get('name'))));
if (!dn.length) s.saveMeal(owner, 'myFoods', DENNYS);
else if (dn.length > 1 || dn[0]!.get('name') !== DENNYS.name || dn[0]!.get('calories') !== DENNYS.calories || dn[0]!.get('protein') !== DENNYS.protein) s.problem(`Denny's My Foods: ${dn.map((d) => `"${d.get('name')}" ${d.get('calories')}/${d.get('protein')}`).join(', ')}`);

// ── C. home plan: the day note + the batch note ──
const DAY_NOTE = { from: DAY, to: DAY, label: 'Wed 11/25 — 104 over, two restaurant meals', note: '104 kcal over target on a training day. Two restaurant meals (QDOBA, Denny\'s); high sodium, expect a higher scale reading on 11/26.' };
const BATCH_LABEL_WAS = 'Build C pancakes — 1 left, for Wed 11/25';
const BATCH_NOTE = { from: '2026-11-21', to: '2026-11-25', label: 'Build C pancakes — batch 11/21 used up 11/25', note: 'Batch 11/21: 4 pancakes · 704 g cooked · 1,235 kcal / 142 g = 1.754 kcal/g · 0.202 g protein/g. Used: 125 g (11/22) · 167 g (11/23) · 196 g (11/24) · 216 g (11/25). Finished.' };
const storedPlan = profile.get('homePlan') as Record<string, unknown> | undefined;
const plan = homePlanOf({ homePlan: storedPlan });
if (!plan?.notes || stable(storedPlan) !== stable(plan)) s.problem('profile.homePlan is not the plan that was read');
else {
  let notes = [...plan.notes];
  const lines: string[] = [];
  const bi = notes.findIndex((n) => n.from === BATCH_NOTE.from && (n.label === BATCH_LABEL_WAS || n.label === BATCH_NOTE.label));
  if (bi < 0) s.problem('the batch home-plan note is gone');
  else if (stable(notes[bi]) !== stable(BATCH_NOTE)) { notes[bi] = BATCH_NOTE; lines.push(`"${BATCH_LABEL_WAS}" → "${BATCH_NOTE.label}"`); }
  const di = notes.filter((n) => n.from === DAY && n.to === DAY);
  if (!di.some((n) => n.label === DAY_NOTE.label)) {
    if (di.length) s.problem(`11/25 already has a home-plan note: ${di.map((n) => n.label).join(', ')}`);
    else { notes = [...notes, DAY_NOTE]; lines.push(`+ "${DAY_NOTE.label}"`); }
  } else if (stable(di.find((n) => n.label === DAY_NOTE.label)) !== stable(DAY_NOTE)) s.problem('the 11/25 day note has different wording');
  if (lines.length) {
    const next = homePlanOf({ homePlan: { ...plan, notes } })!;
    if (next.notes!.length !== notes.length || !next.notes!.some((n) => stable(n) === stable(DAY_NOTE)) || !next.notes!.some((n) => stable(n) === stable(BATCH_NOTE))) s.problem('core `homePlanOf` dropped or cut a note');
    else s.update(profile, { homePlan: json(next) }, `homePlan: ${lines.join(' · ')}`);
  }
}

// ── D. the 11/25 session note ──
const SESSION_NOTE_WAS =
  'Second v2.4 session, first Pull Day since 10/29. No regression. Pull-up 13 +3 +2 (best). Machine row 110 × 12, then 105 × 11. Pulldown 85 × 11. Chest-supported row 40 × 11. Rear delt 20 × 11/11. Hollow-body extension first time: 10 lb × 8 +3 +2. Leg extension 90 × 10 limited by soreness. Seated leg curl skipped.';
const SESSION_NOTE =
  'Second v2.4 session, first Pull Day since 10/29. No regression. Pull-up 13 +3 +2 (best). Machine row 110 × 12, then 105 × 11. Pulldown 85 × 11. Chest-supported row 40 × 11. Rear delt 20 × 11/11. Hollow-body extension first time: 10 lb × 8 +3 +2, lower back arched, load too heavy. Leg extension 90 × 10 limited by soreness. Seated leg curl skipped.';
const ses = sesSnap.docs.find((d) => d.id === PULL_SESSION);
const sesRows = (ses?.get('exercises') ?? []) as { exerciseId: string; skipped?: string; sets: { label?: string }[] }[];
if (!ses || ses.get('templateVersion') !== 'v2' || sesRows.find((r) => r.exerciseId === EX.calf)?.sets.filter((x) => x.label === 'R').length !== 3 || !sesRows.find((r) => r.exerciseId === 'jZWYnikrGcdRG1adHXJ0')?.skipped) {
  s.problem('the 11/25 Pull Day is not the v2 session with R calf sets and a skipped leg curl that was read');
} else if (ses.get('sessionNote') !== SESSION_NOTE) {
  if (ses.get('sessionNote') !== SESSION_NOTE_WAS) s.problem(`the 11/25 session note is not the one that was read: ${ses.get('sessionNote')}`);
  else s.update(ses, { sessionNote: SESSION_NOTE, updatedAt: Timestamp.fromDate(now) }, 'session 11/25 Pull Day: sessionNote + "lower back arched, load too heavy" (sets, status, templateVersion v2 unchanged)');
}
const legSes = sesSnap.docs.find((d) => d.id === LEG_SESSION);
if (legSes?.get('templateVersion') !== 'v2') s.problem('the 11/23 Leg Day session is not v2');
s.note('templateVersion stays "v2" on 11/23 and 11/25: rules allow only v1|v2 on a session (the Program draft marker); "v2.4" lives on the templates');

// ── E. templates ──
type Row = TemplateExercise & Record<string, unknown>;
const tplDoc = (id: string) => tplSnap.docs.find((d) => d.id === id);
const HOLLOW_CUE_WAS = '8–12 reps at 5 lb. 10 lb arched the lower back on 11/25: go to 10 lb only at 12 clean reps.';
const HOLLOW_CUE = 'Lower back stays flat on the floor. The set ends when the back lifts. Go to 10 lb at 12 clean reps.';
const hollowRow = (r: Row): Row => {
  const cues = [...(r.cues ?? [])];
  if (cues.includes(HOLLOW_CUE)) return r;
  const i = cues.indexOf(HOLLOW_CUE_WAS);
  if (i < 0) { s.problem(`the hollow-body row has no "${HOLLOW_CUE_WAS}" cue`); return r; }
  cues[i] = HOLLOW_CUE;
  return { ...r, cues };
};
const PRESS_CUE = 'Trial. Seat height so handles line up with mid-chest. Handles set as far back as comfortable. Shoulder blades on the pad.';
const pressRow = (pu: Row): Row => {
  const keep = ['restAfterSec', 'restAfterMaxSec', 'supersetGroup', 'pairPosition', 'transitionRestSec', 'roundRestSec'];
  return {
    ...Object.fromEntries(keep.filter((k) => pu[k] !== undefined).map((k) => [k, pu[k]])),
    exerciseId: PRESS.id, name: PRESS.name, logStyle: 'weight-reps', loadUnit: 'lb',
    cues: ['RIR 0 — to failure', PRESS_CUE, 'First use Fri 11/27: no load set; enter the weight you use.'],
    plannedSets: [{ kind: 'activation', group: 1 }, { kind: 'mini', group: 1 }, { kind: 'mini', group: 1 }],
    progression: { targetReps: 12, holdSessions: 2, incrementLb: 5 },
    alternatives: [{ exerciseId: EX.deficit, name: 'Deficit Push-up', targetLoad: 0, note: 'keeps its history' }],
    lastModifiedAt: stamp, lastModifiedBy: 'prompt',
  } as Row;
};
const plannedTpl = new Map<string, Record<string, unknown>>();
const PULL_WANT: [string, number][] = [[EX.pullUp, 0], [EX.machineRow, 110], [EX.pulldown, 90], [EX.chestRow, 40], [EX.calf, 35], [EX.hollow, 5]];
for (const id of [PULL, PUSH]) {
  const d = tplDoc(id);
  if (!d || d.get('templateVersion') !== 'v2.4' || d.get('archivedAt') != null) { s.problem(`template ${id} is not the active v2.4 template that was read`); continue; }
  const data = d.data();
  const rows = json(data['exercises'] as Row[]);
  let next = rows.map((r) => (r.exerciseId === EX.hollow ? hollowRow(r) : r));
  const lines: string[] = [];
  if (stable(next) !== stable(rows)) lines.push('hollow-body cue → exercise note');
  if (id === PULL) {
    for (const [ex, load] of PULL_WANT) {
      const r = rows.find((x) => x.exerciseId === ex);
      if (r?.targetLoad !== load) s.problem(`Pull Day ${r?.name ?? ex} is ${r?.targetLoad}, not ${load}`);
    }
    if (rows.find((x) => x.exerciseId === EX.machineRow)?.plannedSets?.filter((x) => x.kind === 'activation').length !== 2) s.problem('Pull Day machine row is not two clusters');
    if (data['tags'] != null) s.note(`Pull Day tags (read only): ${(data['tags'] as string[]).join(', ')}`);
  }
  if (id === PUSH) {
    const i = next.findIndex((r) => r.exerciseId === EX.deficit);
    const has = next.findIndex((r) => r.exerciseId === PRESS.id);
    if (i >= 0 && has < 0) {
      const pu = next[i]!;
      if (pu.plannedSets?.length !== 3 || next.indexOf(pu) !== 5) s.problem('Push Day deficit push-up is not the 6th row, 1 cluster');
      else { next = [...next.slice(0, i), pressRow(pu), ...next.slice(i + 1)]; lines.push(`row 6 "Deficit Push-up" → "${PRESS.name}" (1 cluster, RIR 0, no load, lb; push-up as alternative)`); }
    } else if (i >= 0 || has < 0) s.problem(`Push Day has deficit push-up at ${i} and chest press at ${has}`);
  }
  const notes = String(data['notes'] ?? '');
  const line = id === PULL
    ? `${DAY} - Hollow-body note: lower back stays flat; the set ends when the back lifts; 10 lb at 12 clean reps.`
    : `${DAY} - Deficit push-up → Seated Chest Press Machine (trial from Fri 11/27): 1 cluster, RIR 0, load entered on first use; same place, chest 1 · triceps ½ · front delt ½ as the push-up; the push-up keeps its history and is the row's alternative. Hollow-body note: lower back stays flat; the set ends when the back lifts; 10 lb at 12 clean reps.`;
  const nextNotes = lines.length && !notes.includes(line) ? `${notes}\n\n${line}` : notes;
  if (nextNotes.length > 10_000) { s.problem(`${data['name']} notes would be too long`); continue; }
  plannedTpl.set(id, { ...data, exercises: next });
  if (lines.length) s.update(d, { exercises: json(next), notes: nextNotes, updatedAt: Timestamp.fromDate(now) }, `${data['name']}: ${lines.join(' · ')} · + notes line`);
}
// catalog: the new lift; the push-up stays
const exDoc = exSnap.docs.find((d) => d.id === PRESS.id);
const pressDoc = toExerciseDoc({ name: PRESS.name, muscles: ['chest', 'triceps', 'shoulders'], logStyle: 'weight-reps', effortStandard: 'failure', category: 'compound', loadable: true }, CODEC, now);
if (!exDoc) {
  if (exSnap.docs.some((d) => String(d.get('name')).toLowerCase() === PRESS.name.toLowerCase())) s.problem(`another catalog lift is named "${PRESS.name}"`);
  else s.set(owner.collection('exercises').doc(PRESS.id), pressDoc as DocumentData, `CATALOG + "${PRESS.name}" (${PRESS.id}) · chest, triceps, shoulders · failure`);
} else if (exDoc.get('name') !== PRESS.name) s.problem(`exercises/${PRESS.id} is "${exDoc.get('name')}"`);
if (!exSnap.docs.some((d) => d.id === EX.deficit)) s.problem('Deficit Push-up is gone from the catalog');

// ── F. guards ──
const catalog = [...exSnap.docs.map((d) => toWorkoutExercise(d.id, d.data())), ...(exDoc ? [] : [toWorkoutExercise(PRESS.id, json(pressDoc) as unknown as Record<string, unknown>)])];
const tplOf = (planned: boolean) => [LEG, PULL, PUSH].map((id) => toWorkoutTemplate(id, (planned ? plannedTpl.get(id) : undefined) ?? tplDoc(id)!.data()));
const beforeVol = plannedVolume(tplOf(false), catalog), afterVol = plannedVolume(tplOf(true), catalog);
const vol = (v: typeof beforeVol, m: string) => v.find((x) => x.muscle === m);
for (const m of ['chest', 'triceps', 'frontDelt']) {
  if (stable(vol(beforeVol, m)) !== stable(vol(afterVol, m))) s.problem(`planned ${m} volume moves: ${JSON.stringify(vol(beforeVol, m))} → ${JSON.stringify(vol(afterVol, m))}`);
}
s.note(`(read only) planned weekly chest after the swap: ${JSON.stringify(vol(afterVol, 'chest'))}`);
const bolivia = travelPeriodsOf(profile.data() ?? {}).find((p) => p.start === '2026-10-31');
const upper = bolivia?.reentryRules?.find((r) => r.loadPct === 5);
if (stable(upper?.templateIds) !== stable([PUSH])) s.problem(`the −5 % re-entry rule lists ${upper?.templateIds?.join(', ')}, not Push only`);
const TRAVEL = ['travel-haven-1', 'travel-haven-2', 'travel-airbnb-2026-11-17', 'travel-a-full-body', 'travel-b-full-body', 'travel-gym-c', 'travel-gym-d', 'travel-cd-carryover-2026-11-05'];
for (const id of TRAVEL) if (tplDoc(id)?.get('archivedAt') == null) s.problem(`travel template ${id} is not archived`);
s.note('left alone: 11/25 weigh-in · Quick add "Pancake 216 g (Build C, 11/21 batch)" · My Foods QDOBA "no crema" 440/49 · every 11/25 set · Leg Day template · Push calf 30 · steps not read or written · stph not opened');

await s.run({
  report: async () => {
    const docs = await dayRows(owner, DAY);
    const kcal = docs.reduce((n, d) => n + (d.get('calories') ?? 0), 0);
    const protein = docs.reduce((n, d) => n + (d.get('protein') ?? 0), 0);
    const flag = await owner.collection('dailyLogged').doc(DAY).get();
    console.log(`\n${DAY}: ${docs.length} rows = ${kcal} kcal / ${protein} g · fully logged: ${flag.exists ? flag.get('complete') : 'open'}`);
    for (const d of docs) console.log(`  ${hm((d.get('timestamp') as Timestamp).toDate()).slice(7)} ${String(d.get('mealType')).padEnd(9)} "${d.get('mealLabel')}" ${d.get('calories')}/${d.get('protein') ?? 0}`);
    const push = (await owner.collection('workoutTemplates').doc(PUSH).get()).data()!;
    console.log(`\nPush Day: ${(push['exercises'] as Row[]).map((r) => `${r.name} ${r.targetLoad ?? '—'}`).join(' · ')}`);
    console.log(`11/25 session note: ${(await owner.collection('workoutSessions').doc(PULL_SESSION).get()).get('sessionNote')}`);
  },
});
