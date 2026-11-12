/**
 * Owner data, requested 2026-10-30 (America/Puerto_Rico): Fri 10/30 body + meals,
 * the Push fixes, and the 10/27 Leg Day corrections. Values are the owner's,
 * entered exactly. Expected 10/30: 1,216 / 134. Target stays 1,850 / 140.
 *
 * What the read found (each value checked; any drift → refuse):
 *   - Weight 10/30: 151.8 ✓. Tape: no 10/30 row → ADDED (31.25 / 14.5). Navy is
 *     derived from the tape (core `navyBodyFat`), so `bodyFatPct` is NOT stored.
 *   - The tag + photo note: a measurement allows no extra key (the rules
 *     validate the whole doc, so one would make every later client edit of it
 *     fail). They ride on `dailyWeights/2026-10-30.note` (≤ 100 chars), the same
 *     day's body row. Progress photos were removed 2026-07-05: only the note.
 *   - Meals: "Egg Scramble Lean" 470/58 (10:30, lunch) → "Lean scramble",
 *     breakfast, 09:15. "Chicken Broccoli Ole" 416/53 (13:09) → label + note,
 *     time kept. "Ole" 60/2 (16:58) → "Olé Xtreme tortilla", protein 4, 16:00.
 *     17:45 oatmeal: no row → ADDED.
 *   - Saved foods have no variants: each variant is its own saved food, the way
 *     the existing "High-fiber oatmeal" pair is.
 *   - Overhead DB Extension: baseline since 10/30 (the 10/30 sets are the first
 *     read, not a drop from 10/23), target 35 → 25 (loadLog by `prompt`, so
 *     `honourLifterLoad` holds it), catalog repRange 8–12, cue.
 *   - Weighted Floor Crunch: Push AND Pull rows 20 → 25 (one history).
 *   - Zone 2 10/30: no cardio row, nothing to write (core has no "missed" state).
 *   - 10/27 Leg Day: sets carry no timestamps, so "last set" is the start of the
 *     Zone 2 that closes the session (08:09:32) → 08:34:32 → 60 min, not 97; the
 *     flag rides on the block's `notes` (a session has no free-text field).
 *   - 10/27 walk `84B5205E…` 1,397 s, HR 121 → MERGED into the manual Zone 2
 *     (core `mergeIntoZone2`), dismissed + tombstoned, standalone row deleted.
 *
 * Dry run unless `--apply`; re-runs plan 0; everything touched is backed up to
 * ~/ignia-backups first.
 *
 *   TZ=America/Puerto_Rico npx jiti scripts/owner-data-2026-10-30.mts [--apply]
 *
 * Auth: ADC (`gcloud auth application-default login`).
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, FieldValue, Timestamp } from 'firebase-admin/firestore';
import type { TemplateExercise, WorkoutSession } from '../packages/core/src/workout.ts';
import {
  type DocCodec,
  type LogEntry,
  calculateTdee,
  contextBaseline,
  dayBoundaryOf,
  dumbbellStepLb,
  mergeDailyWeights,
  mergeIntoZone2,
  navyBodyFat,
  sessionCall,
  toDailyLog,
  toDomainProfile,
  toLogDoc,
  toWorkoutExercise,
  toWorkoutSession,
  withDefaultMealSlot,
  zone2Check,
} from '../packages/core/src/index.ts';

const PROJECT_ID = 'fitness-tracker-gb-1775407101';
const OWNER = 'gabrielandresbermudez@gmail.com';
const APPLY = process.argv.includes('--apply');
const DAY = '2026-10-30';
const at = (day: string, hhmm: string) => new Date(`${day}T${hhmm}:00-04:00`);

const WEIGHT = 151.8;
const TAPE = { waist: 31.25, neck: 14.5 };
const NAVY = 13.5;
const BODY_NOTE = 'pre-trip baseline set; back photo in long pants; next set all in boxers';

type Fix = { id: string; was: { mealLabel: string; calories: number; protein: number }; label: string; protein?: number; slot?: LogEntry['mealType']; time?: string; note: string };
const FIXES: Fix[] = [
  {
    id: 'jfbUQRBOnPfn0mAJMfQH', was: { mealLabel: 'Egg Scramble Lean', calories: 470, protein: 58 },
    label: 'Lean scramble', slot: 'breakfast', time: '09:15',
    note: '2 eggs 120/12 · 1 c liquid egg whites 125/26 · ½ c Daisy 2% cottage 90/13 · mushrooms + onion + diced veg ~150 g 40/3 · butter ~1 tsp 35/0 · Olé Xtreme tortilla 60/4.',
  },
  {
    id: 'Fr91ZFSVjTl4T4pL6rkC', was: { mealLabel: 'Chicken Broccoli Ole', calories: 416, protein: 53 },
    label: 'Chicken + broccoli + Olé ×2',
    note: 'Chicken breast 128 g cooked 211/40 · oil/seasoning ~25 · broccoli ~171 g (plate 299 − 128) 60/5 · Olé Xtreme ×2 120/8.',
  },
  {
    id: 'tji666trfC5XwyCVQMdY', was: { mealLabel: 'Ole', calories: 60, protein: 2 },
    label: 'Olé Xtreme tortilla', protein: 4, time: '16:00',
    note: 'Olé Xtreme tortilla 60/4.',
  },
];
const ROW = {
  time: '17:45', slot: 'snack' as LogEntry['mealType'], label: 'Light oatmeal + egg whites (milk)', kcal: 270, protein: 19,
  note: '⅓ c rolled oats 100/3.3 · ½ c liquid egg whites 63/13 · ½ c wild berries 40/0.5 · 2 tsp honey 42/0 · ¼ c low-fat milk 25/2 (label: 8 fl oz = 100 kcal / 8 g) · water, vanilla, cinnamon.',
};

const FOODS = [
  { name: 'Lean scramble', servingSize: 1, servingUnit: 'serving', calories: 470, protein: 58, source: 'manual' },
  { name: 'Lean scramble (1 egg, no butter, no tortilla)', servingSize: 1, servingUnit: 'serving', calories: 315, protein: 48, source: 'manual' },
  { name: 'Light oatmeal + egg whites (with ¼ c low-fat milk)', servingSize: 1, servingUnit: 'serving', calories: 270, protein: 19, source: 'manual' },
  { name: 'Low-fat milk 1% (shelf-stable carton)', servingSize: 8, servingUnit: 'oz', calories: 100, protein: 8, carbs: 12, fat: 2.5, source: 'label' },
];

const SESSION_1030 = 'icXDlqUKKYE4A9LHJAMn';
const PUSH = 'Nx1bxeRuH6bMnGgX7Trv';
const PULL = 'aliWJBD2FND6mU9foLdC';
const OHE = 'AAHHWXTA7UtbNWZbcf7z';
const CRUNCH = 'x3G0Speg04GclIOdKHAl';
const OHE_REASON = 'context changed: strict form, elbows in';
const OHE_CUE = 'Strict form: elbows close to the ears (since 10/30). 8–12 reps.';
const OHE_RANGE = { min: 8, max: 12 };
const PUSH_NOTE = `${DAY} - owner: Overhead DB Extension: baseline since ${DAY}: ${OHE_REASON} (10/30 sets 35 × 5, minis 3/2, then 30 × 3 are the first read, not a regression vs 10/23); next load 25, target 8–12. Weighted Floor Crunch: 15 reps at 20 → next load 25 (shared with Pull E3).`;
const PULL_NOTE = `${DAY} - owner: Weighted Floor Crunch (E3): 15 reps at 20 on 10/30 Push → next load 25 (one history with Push).`;

const LEG = 'q81p3BE9ZCAiVlRr2ZSB';
const WALK = '9uzZqRNlm2VaPnhdhe2R';
const WALK_SOURCE = '84B5205E-D191-4B11-B962-887A8D2CEB84';
const LEG_MIN_FROM = 97;
const LEG_MIN_TO = 60;
const FLAG = `auto-corrected: session duration ${LEG_MIN_FROM} → ${LEG_MIN_TO} min (last set ≈ this walk's 08:09 start, capped at + 25 min; the session was finished in the app at 09:11).`;

for (const n of [...FIXES, ROW]) if (n.note.length > 500) throw new Error(`note too long: ${n.label} ${n.note.length}`);
if (BODY_NOTE.length > 100) throw new Error('body note too long');

initializeApp({ credential: applicationDefault(), projectId: PROJECT_ID });
const db = getFirestore();
const uid = (await getAuth().getUserByEmail(OWNER)).uid;
const user = db.doc(`users/${uid}`);
const now = new Date();
const stamp = now.toISOString();
const report: string[] = [];
const plan: string[] = [];
const problems: string[] = [];

const dayLogs = async () => (await user.collection('dailyLogs')
  .where('timestamp', '>=', Timestamp.fromDate(at(DAY, '00:00')))
  .where('timestamp', '<', Timestamp.fromDate(at('2026-10-31', '00:00')))
  .get()).docs;

const [profile, weight, measSnap, foodSnap, logs30, ses30, pushSnap, pullSnap, oheSnap, exSnap, legSnap, walkSnap, tombSnap, sesSnap] = await Promise.all([
  user.get(),
  user.collection('dailyWeights').doc(DAY).get(),
  user.collection('measurements').orderBy('timestamp', 'desc').limit(5).get(),
  user.collection('customFoods').get(),
  dayLogs(),
  user.collection('workoutSessions').doc(SESSION_1030).get(),
  user.collection('workoutTemplates').doc(PUSH).get(),
  user.collection('workoutTemplates').doc(PULL).get(),
  user.collection('exercises').doc(OHE).get(),
  user.collection('exercises').get(),
  user.collection('workoutSessions').doc(LEG).get(),
  user.collection('workoutSessions').doc(WALK).get(),
  user.collection('healthTombstones').doc(encodeURIComponent(WALK_SOURCE)).get(),
  user.collection('workoutSessions').orderBy('timestamp', 'desc').limit(60).get(),
]);
const prof = profile.data()!;

// ── body ──
if (weight.get('weight') !== WEIGHT) problems.push(`weight 10/30 stored ${weight.get('weight')}, owner says ${WEIGHT}`);
else report.push(`weight 10/30: ${WEIGHT} ✓`);
const bodyNote = weight.get('note') === BODY_NOTE ? null : BODY_NOTE;
if (weight.get('note') != null && bodyNote) problems.push(`weight 10/30 already has a note: ${weight.get('note')}`);
if (bodyNote) plan.push(`dailyWeights/${DAY} + note "${BODY_NOTE}"`);

const navy = navyBodyFat(prof.sex, prof.heightIn, TAPE.waist, TAPE.neck);
if (navy == null || Math.abs(navy - NAVY) >= 0.05) problems.push(`Navy from the app ${navy}, owner says ${NAVY}`);
else report.push(`Navy (height ${prof.heightIn}, waist ${TAPE.waist}, neck ${TAPE.neck}): ${navy.toFixed(2)} ✓ ${NAVY}`);
const tape = measSnap.docs.find((d) => d.get('timestamp').toDate() >= at(DAY, '00:00'));
if (tape && (tape.get('waist') !== TAPE.waist || tape.get('neck') !== TAPE.neck)) problems.push(`tape on 10/30 exists: ${JSON.stringify(tape.data())}`);
if (tape) report.push('tape 10/30: already stored');
else plan.push(`measurements + ${DAY} 07:00 waist ${TAPE.waist} neck ${TAPE.neck}`);

// ── meals ──
const CODEC: DocCodec<Timestamp> = { timestamp: (d) => Timestamp.fromDate(d), remove: () => FieldValue.delete() };
const fixes: { ref: FirebaseFirestore.DocumentReference; patch: Record<string, unknown> }[] = [];
for (const f of FIXES) {
  const d = logs30.find((x) => x.id === f.id);
  if (!d) { problems.push(`log ${f.id} (${f.label}) not on 10/30`); continue; }
  const label = d.get('mealLabel');
  if (label !== f.label && (label !== f.was.mealLabel || d.get('calories') !== f.was.calories || d.get('protein') !== f.was.protein)) {
    problems.push(`log ${f.id}: ${label} ${d.get('calories')}/${d.get('protein')}, expected ${f.was.mealLabel} ${f.was.calories}/${f.was.protein}`);
    continue;
  }
  const patch: Record<string, unknown> = {};
  if (label !== f.label) patch.mealLabel = f.label;
  if (f.protein != null && d.get('protein') !== f.protein) patch.protein = f.protein;
  if (f.slot && d.get('mealType') !== f.slot) patch.mealType = f.slot;
  const time = f.time ? at(DAY, f.time) : null;
  if (time && d.get('timestamp').toDate().getTime() !== time.getTime()) patch.timestamp = Timestamp.fromDate(time);
  if (d.get('note') !== f.note) {
    if (d.get('note') != null) problems.push(`log ${f.id} has a different note: ${d.get('note')}`);
    patch.note = f.note;
  }
  if (Object.keys(patch).length) {
    fixes.push({ ref: d.ref, patch });
    plan.push(`UPDATE ${f.id} "${label}" → ${Object.keys(patch).map((k) => (k === 'timestamp' ? `time ${f.time}` : k === 'note' ? 'note' : `${k} ${patch[k]}`)).join(', ')}`);
  } else report.push(`${f.label}: already entered`);
}
const haveRow = logs30.some((d) => d.get('mealLabel') === ROW.label);
const rowTime = at(DAY, ROW.time);
const rowDoc = toLogDoc(withDefaultMealSlot({ calories: ROW.kcal, protein: ROW.protein, mealLabel: ROW.label, mealType: ROW.slot, timestamp: rowTime, note: ROW.note }, rowTime), CODEC);
if (haveRow) report.push(`${ROW.label}: already logged`);
else plan.push(`CREATE ${ROW.time} ${ROW.slot} "${ROW.label}" ${ROW.kcal}/${ROW.protein} + note`);

// ── saved foods ──
const names = new Set(foodSnap.docs.map((d) => d.get('name')));
const newFoods = FOODS.filter((f) => !names.has(f.name));
for (const f of FOODS) {
  if (names.has(f.name)) report.push(`saved food exists: ${f.name}`);
  else plan.push(`CREATE saved food "${f.name}" ${f.calories}/${f.protein}${f.carbs != null ? ` · ${f.carbs} c · ${f.fat} f · per ${f.servingSize} ${f.servingUnit}` : ''}`);
}

// ── Push / Pull ──
type Row = TemplateExercise & Record<string, unknown>;
type RawTpl = { name: string; notes?: string; exercises: Row[] } & Record<string, unknown>;
const push = pushSnap.data() as RawTpl;
const pull = pullSnap.data() as RawTpl;
const ses = ses30.data() as { templateId: string; cardio?: unknown[]; exercises: { exerciseId: string; sets: { weight: number; reps: number; kind: string }[] }[] } | undefined;
if (!ses || ses.templateId !== PUSH) throw new Error(`session ${SESSION_1030} missing or not Push Day`);
report.push(`Zone 2 10/30: ${ses.cardio?.length ? `${ses.cardio.length} cardio row(s) — CHECK` : 'none logged ✓ (left empty, no "missed" state)'}`);
const seen = (id: string) => ses.exercises.find((e) => e.exerciseId === id)!.sets.map((s) => `${s.weight}×${s.reps}`).join(' ');
if (seen(OHE) !== '35×5 35×3 35×2 30×3') problems.push(`10/30 OHE sets: ${seen(OHE)}`);
if (!seen(CRUNCH).startsWith('20×15')) problems.push(`10/30 crunch sets: ${seen(CRUNCH)}`);
report.push(`10/30 OHE sets: ${seen(OHE)} ✓`, `10/30 crunch sets: ${seen(CRUNCH)} ✓`);

const touch = (r: Row): Row => ({ ...r, lastModifiedAt: stamp, lastModifiedBy: 'prompt' });
const dbStep = dumbbellStepLb(prof.dumbbellHalfSteps as boolean | undefined);
const oheCatalog = { ...toWorkoutExercise(OHE, oheSnap.data()!), repRange: OHE_RANGE, dumbbellStepLb: dbStep };
const crunchTo25 = (r0: Row, where: string): Row => {
  if (r0.targetLoad === 25) { report.push(`${where} crunch: 25 already`); return r0; }
  if (r0.targetLoad !== 20) { problems.push(`${where} crunch target ${r0.targetLoad}, expected 20`); return r0; }
  plan.push(`${where} ${r0.name}: target 20 → 25 (loadLog +prompt)`);
  return touch({
    ...r0,
    targetLoad: 25,
    loadLog: [...(r0.loadLog ?? []), { at: stamp, from: 20, to: 25, by: 'prompt', reason: `Owner, ${DAY}: 15 reps at 20 → next load 25` }],
  });
};
const pushRows = push.exercises.map((r0) => {
  if (r0.exerciseId === CRUNCH) return crunchTo25(r0, 'Push');
  if (r0.exerciseId !== OHE) return r0;
  if (r0.targetLoad === 25 && r0.baseline?.since === DAY) { report.push('Push OHE: already 25 + baseline'); return r0; }
  if (r0.targetLoad !== 35) { problems.push(`Push OHE target ${r0.targetLoad}, expected 35`); return r0; }
  const b = contextBaseline([], { since: DAY, load: 25, catalog: oheCatalog, row: r0 });
  plan.push(`Push ${r0.name}: target 35 → 25 (loadLog +prompt), baseline ${r0.baseline?.since} "${r0.baseline?.reason}" → ${DAY} "${OHE_REASON}"${b.dropBackTo != null ? ` drop→${b.dropBackTo} <${b.dropBackBelowReps}` : ''}, + cue`);
  return touch({
    ...r0,
    targetLoad: 25,
    baseline: { ...b, reason: OHE_REASON },
    cues: [...(r0.cues ?? []), OHE_CUE],
    loadLog: [...(r0.loadLog ?? []), { at: stamp, from: 35, to: 25, by: 'prompt', reason: `Owner, ${DAY}: strict form, elbows in; next load 25, 8–12 reps` }],
  });
});
const pullRows = pull.exercises.map((r0) => (r0.exerciseId === CRUNCH ? crunchTo25(r0, 'Pull') : r0));
const pushNotes = push.notes?.includes(`${DAY} - owner:`) ? push.notes : `${push.notes ?? ''}\n${PUSH_NOTE}`.trim();
const pullNotes = pull.notes?.includes(`${DAY} - owner:`) ? pull.notes : `${pull.notes ?? ''}\n${PULL_NOTE}`.trim();
if (pushNotes.length > 10000 || pullNotes.length > 10000) throw new Error('template notes would pass 10,000 chars');
if (pushNotes !== push.notes) plan.push('Push: + dated notes line');
if (pullNotes !== pull.notes) plan.push('Pull: + dated notes line');
const pushChanged = pushNotes !== push.notes || pushRows.some((r, i) => r !== push.exercises[i]);
const pullChanged = pullNotes !== pull.notes || pullRows.some((r, i) => r !== pull.exercises[i]);
const wantRange = oheSnap.get('repRange')?.min !== OHE_RANGE.min || oheSnap.get('repRange')?.max !== OHE_RANGE.max;
if (wantRange) plan.push(`exercises/${OHE}: repRange → 8–12`);

// ── 10/27 ──
type Doc = Record<string, any>;
const leg = legSnap.data() as Doc | undefined;
if (!leg || leg.templateName !== 'Leg Day') throw new Error(`session ${LEG} missing or not Leg Day`);
const legCardio: Doc[] = leg.cardio ?? [];
const zi = legCardio.findIndex((b) => b.label === 'Zone 2' && b.source === 'manual' && !b.sourceId);
if (zi < 0) throw new Error('no manual Zone 2 on the 10/27 Leg Day');
const walk = walkSnap.data() as Doc | undefined;
let nextLegCardio = legCardio;
let nextDismissed: string[] | null = null;
if (legCardio[zi].mergedSourceIds?.includes(WALK_SOURCE)) report.push('10/27 Zone 2: already merged');
else {
  const block = (walk?.cardio ?? [])[0] as Doc | undefined;
  if (!block || block.sourceId !== WALK_SOURCE || walk!.exercises.length !== 0 || walk!.cardio.length !== 1) problems.push(`walk ${WALK} drift: ${JSON.stringify(walk)}`);
  else {
    const merged = mergeIntoZone2(legCardio[zi] as never, block as never) as unknown as Doc;
    const check = zone2Check(merged as never);
    plan.push(`Leg ${LEG}: Zone 2 ${legCardio[zi].durationSec}s + watch ${block.durationSec}s HR ${block.avgHr} → ${merged.durationSec}s HR ${merged.avgHr}/${merged.maxHr} ${merged.distanceM} m ${merged.kcal} kcal; in band ${check.inBand}`);
    nextLegCardio = legCardio.map((b, i) => (i === zi ? merged : b));
    nextDismissed = [...(leg.dismissedSourceIds ?? []), WALK_SOURCE];
  }
}
if (!legCardio[zi].notes?.startsWith('auto-corrected')) {
  if (legCardio[zi].notes != null) problems.push(`Zone 2 already has notes: ${legCardio[zi].notes}`);
  nextLegCardio = nextLegCardio.map((b, i) => (i === zi ? { ...b, notes: FLAG } : b));
  plan.push(`Leg ${LEG}: Zone 2 notes "${FLAG}"`);
}
const fixDuration = leg.durationMin === LEG_MIN_FROM;
if (fixDuration) plan.push(`Leg ${LEG}: durationMin ${LEG_MIN_FROM} → ${LEG_MIN_TO}`);
else if (leg.durationMin !== LEG_MIN_TO) problems.push(`Leg durationMin ${leg.durationMin}`);
if (walkSnap.exists) plan.push(`DELETE standalone session ${WALK} (the Watch walk row)`);
const writeTomb = !tombSnap.exists;
if (writeTomb) plan.push(`healthTombstones + ${WALK_SOURCE.slice(0, 8)}…`);

// ── what the engine and the fit will say ──
const completed = sesSnap.docs.map((d) => toWorkoutSession(d.id, d.data())).filter((s) => s.status === 'completed') as WorkoutSession[];
const catalog = new Map(exSnap.docs.map((d) => [d.id, toWorkoutExercise(d.id, d.data())]));
const call = (r: Row, c: ReturnType<typeof toWorkoutExercise> | undefined) => {
  const { rec } = sessionCall(r, completed, c ?? null);
  return `${rec.action} ${rec.load ?? ''} (${(rec.reason as { kind: string }).kind})`;
};
const pushOhe = pushRows.find((r) => r.exerciseId === OHE)!;
report.push(`engine next call — OHE: ${call(pushOhe, oheCatalog)}; crunch Push: ${call(pushRows.find((r) => r.exerciseId === CRUNCH)!, catalog.get(CRUNCH))}; crunch Pull: ${call(pullRows.find((r) => r.exerciseId === CRUNCH)!, catalog.get(CRUNCH))}`);

console.log(`${APPLY ? 'APPLY' : 'DRY RUN'} — uid ${uid} — ${stamp}\n`);
console.log(report.map((l) => `  ${l}`).join('\n'));
console.log(`\nPLAN (${plan.length}):\n${plan.map((l) => `  ${l}`).join('\n') || '  nothing'}`);
if (problems.length) { console.log(`\nREFUSING — drift:\n${problems.map((l) => `  ${l}`).join('\n')}`); process.exit(1); }

const maintenance = async (extra: { date?: string; kcal?: number; complete?: boolean } = {}) => {
  const [logsSnap, weightsSnap, loggedSnap, measured] = await Promise.all([
    user.collection('dailyLogs').orderBy('timestamp', 'desc').limit(400).get(),
    user.collection('dailyWeights').get(),
    user.collection('dailyLogged').get(),
    Promise.resolve(toDomainProfile(prof)),
  ]);
  const weights: Record<string, number> = {};
  for (const d of weightsSnap.docs) if (typeof d.get('weight') === 'number') weights[d.id] = d.get('weight');
  const complete: Record<string, boolean> = {};
  for (const d of loggedSnap.docs) if (typeof d.get('complete') === 'boolean') complete[d.id] = d.get('complete');
  if (extra.complete != null) complete[DAY] = extra.complete;
  const logs = logsSnap.docs.map((d) => toDailyLog(d.id, d.data()));
  if (extra.kcal) logs.push(toDailyLog('x', { calories: extra.kcal, protein: 0, timestamp: Timestamp.fromDate(at(DAY, '20:00')) }));
  const boundary = dayBoundaryOf(measured);
  const merged = mergeDailyWeights(logs, weights, boundary);
  return calculateTdee(merged, measured, boundary, new Date('2026-11-05T12:00:00-04:00'), weights, complete) as { source: string; trueTdee: number; ci95Tdee?: number; windowDays?: number; intakeDays?: number; travelHold?: unknown };
};
const showHold = async (label: string, extra = {}) => {
  const r = await maintenance(extra);
  console.log(`  ${label.padEnd(44)} ${r.source} ${r.trueTdee} ±${r.ci95Tdee} · ${r.windowDays} days, ${r.intakeDays} with food · ${JSON.stringify(r.travelHold)}`);
};

if (!APPLY) { console.log('\nDry run. Re-run with --apply to write.'); process.exit(0); }
if (!plan.length) {
  console.log('\nNothing to do (already applied).');
} else {
  const conv = (v: unknown): unknown => {
    if (v instanceof Timestamp) return v.toDate().toISOString();
    if (Array.isArray(v)) return v.map(conv);
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, conv(x)]));
    return v;
  };
  const dir = join(homedir(), 'ignia-backups');
  const backup = join(dir, `owner-data-2026-10-30-${stamp.replace(/[:.]/g, '-')}.json`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(backup, JSON.stringify(conv({
    uid,
    weight: weight.data() ?? null,
    logs: logs30.map((d) => ({ id: d.id, ...d.data() })),
    customFoods: foodSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
    templates: { [PUSH]: push, [PULL]: pull },
    exercise: { [OHE]: oheSnap.data() },
    sessions: { [LEG]: leg, [WALK]: walk ?? null },
  }), null, 1));
  if (!existsSync(backup)) throw new Error('backup not written — refusing to write');
  console.log(`\nbackup written: ${backup}`);

  const batch = db.batch();
  const ts = Timestamp.fromDate(now);
  if (bodyNote) batch.update(weight.ref, { note: bodyNote });
  if (!tape) batch.set(user.collection('measurements').doc(), { timestamp: Timestamp.fromDate(at(DAY, '07:00')), ...TAPE });
  for (const f of fixes) batch.update(f.ref, f.patch);
  if (!haveRow) batch.set(user.collection('dailyLogs').doc(), rowDoc);
  for (const f of newFoods) batch.set(user.collection('customFoods').doc(), { ...f, createdAt: ts });
  if (pushChanged) batch.update(pushSnap.ref, { exercises: JSON.parse(JSON.stringify(pushRows)), notes: pushNotes, updatedAt: ts });
  if (pullChanged) batch.update(pullSnap.ref, { exercises: JSON.parse(JSON.stringify(pullRows)), notes: pullNotes, updatedAt: ts });
  if (wantRange) batch.update(oheSnap.ref, { repRange: OHE_RANGE });
  if (nextLegCardio !== legCardio || fixDuration || nextDismissed) {
    batch.update(legSnap.ref, {
      cardio: nextLegCardio,
      ...(nextDismissed ? { dismissedSourceIds: nextDismissed } : {}),
      ...(fixDuration ? { durationMin: LEG_MIN_TO } : {}),
      updatedAt: ts,
    });
  }
  if (walkSnap.exists) batch.delete(walkSnap.ref);
  if (writeTomb) batch.set(tombSnap.ref, { sourceId: WALK_SOURCE, at: FieldValue.serverTimestamp(), sessionId: LEG, reason: 'owner-data-2026-10-30' });
  await batch.commit();
  console.log('written.');
}

const after = await dayLogs();
const total = after.reduce((a, x) => [a[0] + (x.get('calories') ?? 0), a[1] + (x.get('protein') ?? 0)], [0, 0]);
console.log(`\n10/30: ${after.length} rows, ${total[0]} kcal / ${total[1]} g (target 1,850 / 140)`);
console.log('\nHeld value (core calculateTdee read as of 11/05, inside the trip):');
await showHold('as logged now');
await showHold('if 10/30 reaches 1,850 tonight', { kcal: 634 });
await showHold('if 10/30 is marked not fully logged', { complete: false });
process.exit(0);
