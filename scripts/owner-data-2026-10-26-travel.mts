/**
 * The owner's travel mode (2026-10-26): Bolivia 2026-10-31 → 2026-11-18 —
 * Santa Cruz (VVI), then Cochabamba (2,577 m) from 2026-11-01. No scale, food
 * eyeballed, maybe a gym. Cut targets stay 1,850 kcal / 140 g.
 *
 * Writes, each only if absent / different (re-runs are no-ops):
 *
 *   PROFILE   `travelPeriods: [Bolivia]` — ONLY with `--travel`, and only
 *             after `firestore.rules` with `travelPeriods` is deployed: the
 *             rules validate the whole profile doc, so an unknown key would
 *             make every client profile save fail.
 *   CATALOG   14 no-equipment lifts (`travel-*` ids), `effortStandard:
 *             'rir1'`, straight sets, `loadable` (backpack / band load is
 *             optional and logged in lb).
 *   TEMPLATES "Travel A — Full Body" and "Travel B — Full Body",
 *             `templateVersion: 'travel-v1'` (core `isTravelTemplate`: never
 *             re-entry, never "the gym"). Straight sets, 75 s between sets
 *             (the 60–90 s window), RIR 1, ~25 min, 2×/week alternating A/B.
 *             Every row carries the ladder (core `ladderCall`): at ≥ 20 reps
 *             (≥ 15 per leg on single-leg rows) the next session gets harder —
 *             3 s lowering + 1 s pause, then backpack load, then the listed
 *             harder variation. Band Curl / Band Pull-apart close both days as
 *             optional rows (an unstarted row is not a "removed" lift).
 *
 * DRY RUN unless `--apply`; every document it would touch is backed up first.
 * Modelled on `user-data-2026-10-24-stephanie-s-v2.mts`.
 *
 *   TZ=America/Puerto_Rico npx jiti scripts/owner-data-2026-10-26-travel.mts --email gabrielandresbermudez@gmail.com [--apply] [--travel]
 *
 * Auth: ADC (`gcloud auth application-default login`).
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import type { Exercise, PlannedSet, TemplateExercise, WorkoutTemplate } from '../packages/core/src/workout.ts';
import {
  buildCsv,
  calculateTdee,
  creditsFor,
  dayBoundaryOf,
  estimateTemplateDuration,
  hardSetCount,
  mergeDailyWeights,
  plannedHardSets,
  sessionCall,
  toDailyLog,
  toDomainProfile,
  toWorkoutExercise,
  toWorkoutSession,
  toWorkoutTemplate,
  travelPeriodsOf,
  TRAVEL_TEMPLATE_VERSION,
  type TravelPeriod,
} from '../packages/core/src/index.ts';

const PROJECT_ID = 'fitness-tracker-gb-1775407101';
const args = process.argv.slice(2);
const arg = (k: string) => {
  const i = args.indexOf(k);
  return i >= 0 ? args[i + 1] : undefined;
};
const EMAIL = arg('--email');
if (!EMAIL) throw new Error('--email required');
const APPLY = args.includes('--apply');
const TRAVEL = args.includes('--travel');

const BOLIVIA: TravelPeriod = {
  start: '2026-10-31',
  end: '2026-11-18',
  label: 'Bolivia',
  // His 28-day mean to 10/25 was 6,221 (read 2026-10-26); "~6k" in the brief.
  usualSteps: 6200,
  altitude: { place: 'Cochabamba', meters: 2577, arrival: '2026-11-01' },
};

// ── the spec ──
const REST = 60; // between sets: the low end of the 60–90 s window (keeps it near 25 min)
const RIR_CUE = 'RIR 1 — stop 1 rep before failure. Log reps + RIR on the last set.';
const LOAD_CUE = 'Backpack / band optional: log the added load in lb (an estimate is fine). No load = 0.';
const LADDER_CUE = (cap: number, perLeg: boolean, harder?: string) =>
  `At ${cap}+ reps${perLeg ? ' per leg' : ''} on a set → next time harder: (1) 3 s lowering + 1 s pause, (2) add backpack load, (3) ${harder ?? 'a harder variation'}.`;

interface Spec {
  id: string;
  name: string;
  muscles: string[];
  sets: number;
  /** Rep range; absent = "to RIR 1" (no range). */
  min?: number;
  max?: number;
  perLeg?: boolean;
  harder?: string;
  cues?: string[];
  optional?: boolean;
}
const CAP = (s: Spec) => (s.perLeg ? 15 : 20);

const BAND_ADDONS: Spec[] = [
  { id: 'travel-band-curl', name: 'Band Curl', muscles: ['biceps'], sets: 2, min: 15, max: 20, optional: true },
  { id: 'travel-band-pull-apart', name: 'Band Pull-apart', muscles: ['shoulders'], sets: 2, min: 20, max: 20, optional: true },
];

const DAYS: { id: string; name: string; rows: Spec[] }[] = [
  {
    id: 'travel-a-full-body', name: 'Travel A — Full Body', rows: [
      { id: 'travel-deficit-push-up', name: 'Deficit Push-up', muscles: ['chest', 'triceps', 'shoulders'], sets: 3, harder: 'feet elevated (feet on a chair)', cues: ['Hands on books or two chairs; chest below hand level at the bottom.'] },
      { id: 'travel-bulgarian-split-squat', name: 'Bulgarian Split Squat', muscles: ['quads', 'glutes'], sets: 3, min: 8, max: 15, perLeg: true, cues: ['Rear foot on the bed or a chair; backpack optional.', 'Reps are PER LEG — log one leg\'s count.'] },
      { id: 'travel-backpack-row', name: 'Backpack Row / Towel Door Row', muscles: ['back', 'biceps', 'shoulders'], sets: 3, min: 8, max: 15, cues: ['Backpack: bent over, two hands, row to the belly.', 'Towel door row: towel around a solid door handle, door closed, feet near the door, lean back, row chest to door.'] },
      { id: 'travel-pike-push-up', name: 'Pike Push-up', muscles: ['shoulders', 'triceps'], sets: 2, harder: 'feet on a chair', cues: ['Hips high, head travels forward of the hands.'] },
      { id: 'travel-single-leg-glute-bridge', name: 'Single-leg Glute Bridge', muscles: ['glutes'], sets: 2, min: 10, max: 20, perLeg: true, harder: 'shoulders on the couch (single-leg hip thrust)', cues: ['Reps are PER LEG — log one leg\'s count. 1 s squeeze at the top.'] },
      { id: 'travel-weighted-crunch', name: 'Weighted Crunch (backpack)', muscles: ['core'], sets: 2, cues: ['Backpack on the chest. Abs focus: to RIR 0–1.', 'Counts toward abs volume with the gym crunches; its own load history.'] },
      ...BAND_ADDONS,
    ],
  },
  {
    id: 'travel-b-full-body', name: 'Travel B — Full Body', rows: [
      { id: 'travel-feet-elevated-push-up', name: 'Feet-Elevated Push-up', muscles: ['chest', 'triceps', 'shoulders'], sets: 3, harder: 'deficit + feet elevated', cues: ['Feet on a chair or the bed.'] },
      { id: 'travel-reverse-lunge', name: 'Reverse Lunge', muscles: ['quads', 'glutes'], sets: 3, min: 10, max: 15, perLeg: true, cues: ['Backpack optional.', 'Reps are PER LEG — log one leg\'s count.'] },
      { id: 'travel-single-leg-rdl', name: 'Single-leg RDL', muscles: ['hamstrings', 'glutes'], sets: 2, min: 10, max: 15, perLeg: true, cues: ['Backpack in the OPPOSITE hand; slow; a hand on the wall for balance is fine.', 'Low back rule as the gym RDL: neutral spine, stop where the back would round.', 'Reps are PER LEG — log one leg\'s count.'] },
      { id: 'travel-band-row', name: 'Band Row / Towel Door Row', muscles: ['back', 'biceps', 'shoulders'], sets: 3, min: 10, max: 15, cues: ['Band anchored at chest height, or the towel door row (towel around a solid handle, door closed, lean back, row chest to door).'] },
      { id: 'travel-lateral-raise', name: 'Band / Backpack Lateral Raise', muscles: ['shoulders'], sets: 2, min: 15, max: 20, cues: ['Band under the feet, or the backpack in one hand per side.'] },
      { id: 'travel-lying-leg-raise', name: 'Lying Leg Raise', muscles: ['core'], sets: 2, cues: ['Posterior tilt at the top (lift the hips a little). Abs focus: to RIR 0–1.'] },
      ...BAND_ADDONS,
    ],
  },
];

const NOTES = `2026-10-26 — Travel (Bolivia 10/31–11/18). No equipment; optional backpack + light band.
FORMAT: straight sets, ${REST} s between sets (60–90 s), RIR 1 = stop 1 rep before failure. ~25 min. 2×/week (e.g. Tue + Fri), alternate A / B.
LOG reps + RIR on the last set; backpack / band load optional (lb, estimate) — no load = 0.
PROGRESSION: when a set reaches 20+ reps (15+ per leg on single-leg moves), next time make it harder in this order: (1) 3 s lowering + 1 s pause, (2) add backpack load, (3) the harder variation on the row. The app says which.
OPTIONAL: Band Curl 2×15–20 and Band Pull-apart 2×20 close each day — only if the band is packed; skip them otherwise.
These templates are never a re-entry session and do not count as "the gym".`;

initializeApp({ credential: applicationDefault(), projectId: PROJECT_ID });
const db = getFirestore();
const uid = (await getAuth().getUserByEmail(EMAIL)).uid;
const user = db.doc(`users/${uid}`);
const now = new Date();
const stamp = now.toISOString();

const [profileSnap, exSnap, sesSnap, logsSnap, weightsSnap, loggedSnap, ...tplSnaps] = await Promise.all([
  user.get(),
  user.collection('exercises').get(),
  user.collection('workoutSessions').get(),
  user.collection('dailyLogs').orderBy('timestamp', 'desc').limit(400).get(),
  user.collection('dailyWeights').get(),
  user.collection('dailyLogged').get(),
  ...DAYS.map((d) => user.collection('workoutTemplates').doc(d.id).get()),
]);
const out: string[] = [];
const say = (s = '') => out.push(s);
say(`${APPLY ? 'APPLY' : 'DRY RUN'}${TRAVEL ? ' +travel' : ''} — ${EMAIL} uid ${uid} — ${stamp}`);

// ── refuse on drift ──
tplSnaps.forEach((s, i) => {
  if (s.exists && s.get('templateVersion') !== TRAVEL_TEMPLATE_VERSION) throw new Error(`${DAYS[i].id} exists and is not ${TRAVEL_TEMPLATE_VERSION}`);
});
const exDocs = new Map(exSnap.docs.map((d) => [d.id, d]));
const specs = new Map<string, Spec>();
for (const d of DAYS) for (const r of d.rows) specs.set(r.id, r);
for (const [id, s] of specs) {
  if (exDocs.has(id) && exDocs.get(id)!.get('name') !== s.name) throw new Error(`catalog ${id} exists as "${exDocs.get(id)!.get('name')}"`);
}

// ── catalog ──
const catCreates = [...specs.values()]
  .filter((s) => !exDocs.has(s.id))
  .map((s) => ({
    id: s.id,
    doc: {
      name: s.name, muscles: s.muscles, defaultCues: [], logStyle: 'weight-reps', effortStandard: 'rir1',
      setStructure: 'straight', loadable: true, createdAt: Timestamp.fromDate(now),
    },
  }));
const catalogAfter: Exercise[] = [
  ...exSnap.docs.map((d) => toWorkoutExercise(d.id, d.data())),
  ...catCreates.map((c) => toWorkoutExercise(c.id, c.doc)),
];
const musclesOf = (id: string) => catalogAfter.find((c) => c.id === id)?.muscles;

// ── templates ──
type Row = TemplateExercise & Record<string, unknown>;
const working = (s: Spec): PlannedSet[] => Array.from({ length: s.sets }, () => (
  s.min != null ? { kind: 'working', reps: s.min, ...(s.max != null && s.max !== s.min ? { repsMax: s.max } : {}) } : { kind: 'working' }
) as PlannedSet);
function buildRow(s: Spec): Row {
  const cap = CAP(s);
  return {
    exerciseId: s.id,
    name: s.name,
    targetLoad: 0,
    logStyle: 'weight-reps',
    setStructure: 'straight',
    plannedSets: working(s),
    progression: { targetReps: cap, holdSessions: 1, incrementLb: 5 },
    ladder: { capReps: cap, ...(s.harder ? { harder: s.harder } : {}) },
    cues: [
      ...(s.optional ? ['OPTIONAL — only if the band is packed; skip otherwise.'] : []),
      RIR_CUE,
      ...(s.cues ?? []),
      LOAD_CUE,
      LADDER_CUE(cap, s.perLeg === true, s.harder),
    ],
    restMiniSec: REST,
    restAfterSec: REST,
    lastModifiedAt: stamp,
    lastModifiedBy: 'prompt',
  } as Row;
}
const newDocs = DAYS.map((d) => ({
  id: d.id,
  body: { name: d.name, notes: NOTES, templateVersion: TRAVEL_TEMPLATE_VERSION, restMiniSec: REST, exercises: d.rows.map(buildRow) },
}));
const toCreate = newDocs.filter((_, i) => !tplSnaps[i].exists);

// ── profile ──
const prof = profileSnap.data()!;
const existing = travelPeriodsOf(prof);
const hasBolivia = existing.some((p) => p.start === BOLIVIA.start && p.end === BOLIVIA.end);
const travelAfter = hasBolivia ? existing : [...existing, BOLIVIA].sort((a, b) => (a.start < b.start ? -1 : 1));
const writeTravel = TRAVEL && !hasBolivia;

// ── report ──
say('\nPROFILE (before → after)');
say(`   targets: ${prof.targetMode} ${prof.manualCaloriesTarget} kcal / ${prof.manualProteinTarget} g — unchanged`);
say(`   travelPeriods: ${JSON.stringify(prof.travelPeriods ?? null)} → ${JSON.stringify(TRAVEL ? travelAfter : prof.travelPeriods ?? null)}${!TRAVEL ? '   (not this run: --travel, after the rules deploy)' : ''}`);

say('\nTEMPLATES (before)');
for (const s of (await user.collection('workoutTemplates').get()).docs) {
  say(`   ${s.get('name')} [${s.id}] ${s.get('templateVersion') ?? ''}${s.get('archivedAt') ? ' (archived)' : ''}`);
}
say('\nTEMPLATES (after: + these)');
const fmtSets = (r: TemplateExercise) => {
  const w = r.plannedSets.filter((s) => s.kind === 'working');
  const s0 = w[0];
  return `${w.length}×${s0.reps != null ? `${s0.reps}${s0.repsMax != null ? `–${s0.repsMax}` : ''}` : 'RIR1'}`;
};
const after: WorkoutTemplate[] = newDocs.map((d) => toWorkoutTemplate(d.id, d.body));
for (const t of after) {
  say(`  ${t.name} [${t.id}] · ${estimateTemplateDuration(t, musclesOf).minutes} min est. (all rows; ~${estimateTemplateDuration({ ...t, exercises: t.exercises.filter((r) => !r.cues?.[0]?.startsWith('OPTIONAL')) }, musclesOf).minutes} min without the band add-ons)`);
  for (const r of t.exercises) {
    const l = (r as Row).ladder as { capReps: number; harder?: string };
    say(`     ${r.name.padEnd(32)} ${fmtSets(r).padEnd(8)} load 0 (optional)  ladder ≥${l.capReps}${l.harder ? ` → ${l.harder}` : ''}${exDocs.has(r.exerciseId) ? '' : '  NEW LIFT'}`);
  }
}

say('\nCatalog creates');
for (const c of catCreates) say(`   ${c.id}: ${JSON.stringify({ ...c.doc, createdAt: undefined })}`);

const sessions = sesSnap.docs.map((d) => toWorkoutSession(d.id, d.data()));
const completed = sessions.filter((s) => s.status === 'completed').sort((a, b) => b.date.getTime() - a.date.getTime());
say('\nEngine — first call per row (core sessionCall)');
for (const t of after) for (const r of t.exercises) {
  const { rec } = sessionCall(r, completed, catalogAfter.find((c) => c.id === r.exerciseId) ?? null);
  say(`   ${t.name.slice(0, 8)} ${r.name.padEnd(32)} ${rec.action} (${(rec.reason as { kind: string }).kind})`);
}

say('\nVolume per session (hard sets, fractional; core plannedHardSets / creditsFor)');
for (const t of after) {
  const v = plannedHardSets([t], catalogAfter).filter((m) => m.fractional > 0);
  say(`   ${t.name}: ${v.map((m) => `${m.muscle} ${m.fractional}`).join(' · ')}`);
}
say('   credits per lift:');
for (const t of after) for (const r of t.exercises) say(`      ${r.name.padEnd(32)} ×${hardSetCount(r.plannedSets, 'weight-reps', false)} → ${creditsFor(r.name, musclesOf(r.exerciseId)).map((x) => `${x.muscle} ${x.weight}`).join(', ')}`);

say('\nMaintenance under travel mode (core calculateTdee, his data as of now)');
{
  const profile = toDomainProfile({ ...prof, travelPeriods: travelAfter });
  const plain = toDomainProfile({ ...prof, travelPeriods: [] });
  const logs = logsSnap.docs.map((d) => toDailyLog(d.id, d.data()));
  const weights: Record<string, number> = {};
  for (const d of weightsSnap.docs) if (typeof d.get('weight') === 'number') weights[d.id] = d.get('weight');
  const complete: Record<string, boolean> = {};
  for (const d of loggedSnap.docs) if (typeof d.get('complete') === 'boolean') complete[d.id] = d.get('complete');
  const boundary = dayBoundaryOf(profile);
  const merged = mergeDailyWeights(logs, weights, boundary);
  const at = (iso: string) => new Date(iso);
  const show = (label: string, p: typeof profile, iso: string) => {
    const r = calculateTdee(merged, p, boundary, iso === 'now' ? now : at(iso), weights, complete);
    say(`   ${label.padEnd(34)} ${r.source} ${r.trueTdee}${r.travelHold ? `  hold=${JSON.stringify(r.travelHold)}` : ''}`);
  };
  show('today, no trip', plain, 'now');
  show('today, trip on file (not started)', profile, 'now');
  show('11/05 in the trip (frozen)', profile, '2026-11-05T12:00:00-04:00');
  show('11/25 home (rebuilding)', profile, '2026-11-25T12:00:00-04:00');
  say('   (the frozen value is the estimate as of 10/31 00:00 — it will move with whatever is logged 10/27–10/30)');
}

say('\nSample export — Travel A template rows (core buildCsv)');
{
  const effortStandards = Object.fromEntries(catalogAfter.map((c) => [c.id!, c.effortStandard]));
  const csv = buildCsv({ logs: [], measurements: [], dailyWeights: {}, dailyWater: {}, dailySleep: {}, templates: [after[0]], effortStandards, travelPeriods: travelAfter });
  for (const l of csv.split(/\r?\n/).filter((l, i) => i === 0 || l.startsWith('template,') || l.startsWith('travel,'))) say(`   ${l}`);
}

say(`\nSUMMARY: ${toCreate.length} template(s) to create, ${catCreates.length} catalog create(s), travelPeriods ${writeTravel ? 'WRITE' : hasBolivia ? 'already set' : 'not this run'}; 0 sessions, 0 deletes.`);
console.log(out.join('\n'));

if (!APPLY) { console.log('\nDry run. Re-run with --apply (and --travel once the rules are deployed) to write.'); process.exit(0); }
if (!toCreate.length && !catCreates.length && !writeTravel) { console.log('\nNothing to do (already applied).'); process.exit(0); }

const conv = (v: unknown): unknown => {
  if (v instanceof Timestamp) return v.toDate().toISOString();
  if (Array.isArray(v)) return v.map(conv);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, conv(x)]));
  return v;
};
const dir = join(homedir(), 'ignia-backups');
const backup = join(dir, `owner-data-2026-10-26-travel-${stamp.replace(/[:.]/g, '-')}.json`);
mkdirSync(dir, { recursive: true });
writeFileSync(backup, JSON.stringify(conv({
  uid,
  profile: { travelPeriods: prof.travelPeriods ?? null },
  templates: Object.fromEntries(tplSnaps.map((s) => [s.id, s.exists ? s.data() : null])),
  exercises: Object.fromEntries([...specs.keys()].map((id) => [id, exDocs.get(id)?.data() ?? null])),
}), null, 1));
if (!existsSync(backup)) throw new Error('backup not written — refusing to write');
console.log(`\nbackup written: ${backup}`);

const batch = db.batch();
for (const c of catCreates) batch.set(user.collection('exercises').doc(c.id), c.doc);
for (const d of toCreate) batch.set(user.collection('workoutTemplates').doc(d.id), { ...JSON.parse(JSON.stringify(d.body)), createdAt: Timestamp.fromDate(now), updatedAt: Timestamp.fromDate(now) });
if (writeTravel) batch.update(user, { travelPeriods: travelAfter.map((p) => JSON.parse(JSON.stringify(p))) });
await batch.commit();
console.log(`written: ${toCreate.map((d) => d.body.name).join(', ') || 'no templates'}; ${catCreates.length} catalog; travelPeriods ${writeTravel ? 'set' : '—'}`);
process.exit(0);
