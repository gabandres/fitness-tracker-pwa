/**
 * Stephanie (stph.ctllo@gmail.com), requested by the owner 2026-11-04 evening
 * (America/La_Paz), for Thu 11/5:
 *
 *   SESSION   11/4 "S-v2 Day 3" (`rrVKiWEGnXhbQ9v1rQaV`) → `partial`. Done:
 *             Chest-Supported DB Row 3, Leg Curl 2, Bicep Curl 2, Tricep Ext 2.
 *             Skipped: Hip Thrust, DB Flat Press, Lateral Raise.
 *             Duration 901 min (left running) → last set + 10 min. Sets carry
 *             no time of their own, so the last set is ESTIMATED from her own
 *             pace on 10/27 (the same template: 74 min for its logged sets),
 *             and `durationNote` says so ("auto-corrected: …").
 *   UNITS     profile `unitAsk`: on her next session the app asks once
 *             "Haven dumbbells — kg or lb?", remembers the answer for each of
 *             her dumbbell lifts at Haven Gym, and re-labels the 11/4 loads
 *             (core `relabelRows`: kg → the typed 10 becomes 10 kg).
 *   CATALOG   + 45° Leg Press, Kneeling Cable Crunch, Weighted Floor Crunch,
 *             Hip Thrust Machine, Side Plank (all effort rir2, straight).
 *   TEMPLATE  NEW `stph-sv2-day-2b` "S-v2 Day 2B — Legs + Core (Haven)":
 *             straight sets, RIR 2, supersets 60 s switch / 75 s round, kg,
 *             Haven Gym (first session = calibration: set 1 ≥ 3 over the top
 *             of the range → raise now), ~45 min. D and E optional.
 *   TRAVEL    the Bolivia trip 2026-10-31 → 2026-11-18 (travel mode ends
 *             11/19), Cochabamba 2,577 m from 11/1; plan: 11/5 Day 2B, then
 *             Day 1, then Day 3 (Haven until 11/12); Santa Cruz from 11/13 (no
 *             gym, optional, skipped ≠ missed); 11/19 the next S-v2 day back
 *             at −10 %, RIR 2, post-travel re-entry (core `reentry.ts` does it).
 *             Maintenance freezes at its 10/30 value on its own (`travel.ts`).
 *
 * DRY RUN unless `--apply`; everything it touches is backed up first; re-runs
 * plan nothing.
 *
 *   TZ=America/La_Paz npx jiti scripts/user-data-2026-11-05-stephanie-travel.mts [--apply]
 *
 * Auth: ADC (`gcloud auth application-default login`).
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue, getFirestore, Timestamp } from 'firebase-admin/firestore';
import { isLoggedSet, type PlannedSet, type TemplateExercise } from '../packages/core/src/workout.ts';
import {
  type RowAlternative,
  type TravelPlanEntry,
  type UnitAsk,
  activeTravel,
  dayBoundaryOf,
  gymLoadHint,
  kgOf,
  toDomainProfile,
  toWorkoutSession,
  travelPeriodsOf,
  travelWeek,
} from '../packages/core/src/index.ts';

const PROJECT_ID = 'fitness-tracker-gb-1775407101';
const USER = 'stph.ctllo@gmail.com';
const APPLY = process.argv.includes('--apply');
const SESSION_ID = 'rrVKiWEGnXhbQ9v1rQaV';
const PACE_SESSION_ID = '5MRjRNlqOaAI7nn8Vr7Y'; // 10/27, same template, 74 min
const DAY_2B = 'stph-sv2-day-2b';
const GYM = 'Haven Gym';

const NEW_CATALOG: Record<string, { name: string; muscles: string[]; logStyle?: string; category: string }> = {
  'stph-45-leg-press': { name: '45° Leg Press', muscles: ['quads', 'glutes'], category: 'compound' },
  'stph-kneeling-cable-crunch': { name: 'Kneeling Cable Crunch', muscles: ['core'], category: 'core' },
  'stph-weighted-floor-crunch': { name: 'Weighted Floor Crunch', muscles: ['core'], category: 'core' },
  'stph-hip-thrust-machine': { name: 'Hip Thrust Machine', muscles: ['glutes', 'hamstrings'], category: 'compound' },
  'stph-side-plank': { name: 'Side Plank', muscles: ['core'], logStyle: 'time', category: 'core' },
};
/** Her dumbbell lifts — what "Haven dumbbells — kg or lb?" answers for. */
const DB_LIFTS = [
  'stph-supported-db-row', 'stph-seated-bicep-curl', 'stph-single-db-tricep-ext', 'stph-db-flat-press', 'stph-incline-db-press',
  'stph-db-rdl', 'stph-db-reverse-lunge', 'stph-db-lateral-raise', 'stph-seated-db-ohp', 'stph-goblet-squat', 'stph-db-hip-thrust',
];
const UNIT_ASK: UnitAsk = { gym: GYM, question: 'Haven dumbbells — kg or lb?', exerciseIds: DB_LIFTS, relabelSessionId: SESSION_ID };

// ── read ──
initializeApp({ credential: applicationDefault(), projectId: PROJECT_ID });
const db = getFirestore();
const uid = (await getAuth().getUserByEmail(USER)).uid;
const user = db.doc(`users/${uid}`);
const now = new Date();
const stamp = now.toISOString();
const [profileSnap, exSnap, tplSnap, sesSnap] = await Promise.all([
  user.get(), user.collection('exercises').get(), user.collection('workoutTemplates').get(),
  user.collection('workoutSessions').orderBy('timestamp', 'desc').limit(200).get(),
]);
const say = console.log;
say(`${APPLY ? 'APPLY' : 'DRY RUN'} — ${now.toString()}\n`);
const prof = profileSnap.data()!;
const exIds = new Set(exSnap.docs.map((d) => d.id));
const catalog = new Map(exSnap.docs.map((d) => [d.id, d.data()]));

// ── 1. the 11/4 session ──
const sesDoc = sesSnap.docs.find((d) => d.id === SESSION_ID);
const paceDoc = sesSnap.docs.find((d) => d.id === PACE_SESSION_ID);
if (!sesDoc || !paceDoc) throw new Error('11/4 or 10/27 session missing');
const raw = sesDoc.data();
const session = toWorkoutSession(SESSION_ID, raw);
const pace = toWorkoutSession(PACE_SESSION_ID, paceDoc.data());
if (session.templateId !== 'stph-sv2-day-3' || session.status !== 'completed') throw new Error(`11/4 is ${session.templateId} ${session.status}`);
const loggedSets = (s: typeof session) => s.exercises.reduce((n, e) => n + e.sets.filter((x) => isLoggedSet(x, e.logStyle)).length, 0);
const done = Object.fromEntries(session.exercises.map((e) => [e.exerciseId, e.sets.filter((x) => isLoggedSet(x, e.logStyle)).length]));
const WANT_DONE = { 'stph-supported-db-row': 3, 'stph-leg-curl': 2, 'stph-seated-bicep-curl': 2, 'stph-single-db-tricep-ext': 2 };
for (const [id, n] of Object.entries(WANT_DONE)) if (done[id] !== n) throw new Error(`${id}: ${done[id]} sets, expected ${n}`);
const minPerSet = (pace.durationMin ?? 0) / loggedSets(pace);
const lastSetMin = Math.round(minPerSet * loggedSets(session));
const correctedMin = lastSetMin + 10;
const alreadyFixed = session.partial != null && session.durationMin !== 901;
if (!alreadyFixed && session.durationMin !== 901) throw new Error(`11/4 duration is ${session.durationMin}, not 901`);
const skipped = ['Hip Thrust', 'DB Flat Press', 'Lateral Raise'];
const durationNote = `auto-corrected: 901 → ${correctedMin} min (timer left running; last set ≈ ${lastSetMin} min in, estimated from the 10/27 pace of ${minPerSet.toFixed(1)} min/set, + 10 min)`;

// ── 2. catalog + template ──
const catWrites = Object.entries(NEW_CATALOG).filter(([id]) => !exIds.has(id));
const straight = (sets: number, min: number, max: number): PlannedSet[] => Array.from({ length: sets }, () => ({ kind: 'working' as const, reps: min, repsMax: max }));
const timed = (sets: number, sec: number): PlannedSet[] => Array.from({ length: sets }, () => ({ kind: 'working' as const, durationSec: sec }));
const RIR2 = 'RIR 2 — stop 2 reps short. Log RIR on the last set.';
const CALIB = 'First Haven session = calibration: if set 1 beats the top of the range by 3+, raise the load now.';
const BASELINE = { since: '2026-11-05', reason: 'context changed: Haven Gym (travel)' };
type Row = TemplateExercise & Record<string, unknown>;
const r = (id: string, o: {
  name?: string; sets: PlannedSet[]; max?: number; cues: string[]; ss?: [string, 1 | 2]; inc?: number; logStyle?: 'weight-reps' | 'bodyweight' | 'time';
  linkedHome?: boolean; alternatives?: RowAlternative[]; optional?: boolean;
}): Row => ({
  exerciseId: id,
  name: o.name ?? (catalog.get(id)?.name as string | undefined) ?? NEW_CATALOG[id]?.name ?? id,
  logStyle: o.logStyle ?? 'weight-reps',
  setStructure: 'straight',
  plannedSets: o.sets,
  ...(o.max != null && o.logStyle !== 'time' ? { progression: { targetReps: o.max, holdSessions: 1, incrementLb: o.inc ?? 4.41 } } : {}),
  cues: o.cues,
  ...(o.ss ? { supersetGroup: o.ss[0], pairPosition: o.ss[1] } : {}),
  ...(o.ss?.[1] === 1 ? { transitionRestSec: 60, roundRestSec: 75 } : {}),
  loadUnit: 'kg',
  awayGym: GYM,
  ...(o.linkedHome ? { linkedHome: true } : {}),
  ...(o.alternatives ? { alternatives: o.alternatives } : {}),
  ...(o.optional ? { optional: true } : {}),
  baseline: BASELINE,
  lastModifiedAt: stamp,
  lastModifiedBy: 'prompt',
});
const rows: Row[] = [
  r('stph-db-rdl', { name: 'DB Romanian Deadlift', sets: straight(3, 8, 12), max: 12, cues: ['Hips back, DBs on thighs, neutral back, stop at mid-shin.', 'Load is per hand.', RIR2, CALIB], ss: ['A', 1], linkedHome: true }),
  r('stph-pallof-press', { name: 'Cable Pallof Press', sets: straight(2, 10, 10), cues: ['10 per side. Log reps per side.', RIR2], ss: ['A', 2], linkedHome: true,
    alternatives: [{ exerciseId: 'stph-dead-bug', name: 'Dead Bug', logStyle: 'bodyweight', plannedSets: straight(2, 8, 8), linkedHome: true, cues: ['8 per side. Lower back flat.'], note: 'no free cable' }] }),
  r('stph-45-leg-press', { sets: straight(3, 10, 12), max: 12, inc: 11.02, cues: ['Feet high and wide on the platform.', RIR2, CALIB], ss: ['B', 1] }),
  r('stph-kneeling-cable-crunch', { sets: straight(2, 12, 15), max: 15, cues: [RIR2], ss: ['B', 2],
    alternatives: [{ exerciseId: 'stph-weighted-floor-crunch', name: 'Weighted Floor Crunch', plannedSets: straight(2, 12, 15), cues: ['Plate or DB on the chest.'], note: 'no free cable' }] }),
  r('stph-hip-thrust-machine', { sets: straight(3, 8, 12), max: 12, inc: 11.02, cues: [RIR2, CALIB], ss: ['C', 1],
    alternatives: [{ exerciseId: 'stph-db-hip-thrust', name: 'DB Hip Thrust (bench)', plannedSets: straight(3, 8, 12), cues: ['Shoulders on a bench, DB on the hips.'], note: 'no machine' }] }),
  r('stph-leg-extension', { sets: straight(2, 12, 15), max: 15, inc: 4.41, cues: [RIR2, CALIB], ss: ['C', 2], linkedHome: true }),
  r('stph-db-reverse-lunge', { sets: straight(2, 10, 10), max: 10, cues: ['OPTIONAL. 10 per leg. Load is per hand. Log the reps per leg.', RIR2], linkedHome: true, optional: true }),
  r('stph-side-plank', { sets: timed(2, 20), logStyle: 'time', cues: ['OPTIONAL. 20–30 s per side. Log the time; no RIR.'], optional: true }),
];
const DAY_2B_NOTES = [
  '2026-11-05 — S-v2 Day 2B — Legs + Core (Haven Gym, Cochabamba, 2,577 m). Travel version of the hinge / legs day. Loads in kg.',
  'Straight sets at RIR 2. Supersets: 60–75 s from one lift to the other, 75 s after the round. Target ~45 min.',
  'First session here = calibration: set 1 three or more reps over the top of the range → raise the load now.',
  'D (reverse lunge) and E (side plank) are OPTIONAL — leaving them out is not a skip.',
].join('\n');
const tpl = {
  name: 'S-v2 Day 2B — Legs + Core (Haven)',
  notes: DAY_2B_NOTES,
  templateVersion: 'S-v2',
  exercises: rows,
};
const tplExists = tplSnap.docs.some((d) => d.id === DAY_2B);

// ── 3. travel period ──
const PLAN: TravelPlanEntry[] = [
  { from: '2026-11-04', to: '2026-11-04', kind: 'session', label: 'S-v2 Day 3', templateId: 'stph-sv2-day-3', note: 'partial' },
  { from: '2026-11-05', to: '2026-11-05', kind: 'session', label: 'Day 2B — Legs + Core', templateId: DAY_2B },
  { from: '2026-11-06', to: '2026-11-09', kind: 'session', label: 'Day 1 — Squat + Glutes', templateId: 'stph-sv2-day-1', note: 'next in order, any day' },
  { from: '2026-11-09', to: '2026-11-12', kind: 'session', label: 'Day 3 — Glutes + Upper + Arms', templateId: 'stph-sv2-day-3', note: 'after Day 1; Haven until 11/12' },
  { from: '2026-11-13', to: '2026-11-13', kind: 'note', label: 'Santa Cruz', note: '~400 m, no gym: sessions optional; skipped is not missed' },
  { from: '2026-11-19', to: '2026-11-19', kind: 'note', label: 'Travel mode ends', note: 'next S-v2 day in rotation at −10% load, RIR 2, post-travel re-entry' },
];
const TRIP = {
  start: '2026-10-31', end: '2026-11-18', label: 'Bolivia',
  altitude: { place: 'Cochabamba', meters: 2577, arrival: '2026-11-01' },
  plan: PLAN,
};
const periodsBefore = (prof.travelPeriods ?? []) as Record<string, unknown>[];
const iTrip = periodsBefore.findIndex((p) => p.start === TRIP.start);
const periodsAfter = iTrip >= 0 ? periodsBefore.map((p, i) => (i === iTrip ? TRIP : p)) : [...periodsBefore, TRIP];
const travelWrite = JSON.stringify(periodsAfter) !== JSON.stringify(periodsBefore);
// Answered already (the app deletes the question and remembers the unit per
// lift at the gym): never ask again.
const answered = DB_LIFTS.some((id) => (catalog.get(id)?.unitByGym as Record<string, string> | undefined)?.[GYM]);
const askWrite = !answered && JSON.stringify(prof.unitAsk ?? null) !== JSON.stringify(UNIT_ASK);

// ── report ──
say(`11/4 ${session.templateName}: ${session.durationMin} → ${correctedMin} min, partial${alreadyFixed ? ' (already)' : ''}`);
say(`  ${durationNote}`);
say(`  done: ${Object.entries(done).map(([id, n]) => `${id} ${n}`).join(' · ')}`);
say(`  skipped: ${skipped.join(' · ')}`);
say(`  loads as stored (lb; unit unknown until she answers): ${session.exercises.map((e) => `${e.name} ${e.sets[0]?.weight}`).join(' · ')}`);
say(`\nUnit ask ${askWrite ? 'WRITE' : 'unchanged'}: "${UNIT_ASK.question}" → ${DB_LIFTS.filter((id) => exIds.has(id)).length}/${DB_LIFTS.length} lifts in her catalog`);
say(`Catalog: ${Object.entries(NEW_CATALOG).map(([id, c]) => `${exIds.has(id) ? '=' : '+'} ${c.name}`).join(' · ')}`);
say(`\nTemplate ${DAY_2B} ${tplExists ? 'OVERWRITE' : 'CREATE'}: "${tpl.name}"`);
const completed = sesSnap.docs.map((d) => toWorkoutSession(d.id, d.data())).filter((s) => s.status === 'completed');
for (const x of rows) {
  const ps = x.plannedSets[0];
  const hint = gymLoadHint(completed, { exerciseId: x.exerciseId, name: x.name, awayGym: GYM });
  say(`  ${(x.supersetGroup ? `${x.supersetGroup}${x.pairPosition}` : x.optional ? 'opt' : '—').padEnd(3)} ${x.name.padEnd(28)} ${x.plannedSets.length} × ${ps.durationSec ? `${ps.durationSec} s` : `${ps.reps}${ps.repsMax && ps.repsMax !== ps.reps ? `–${ps.repsMax}` : ''}`}${x.alternatives ? `  alt: ${x.alternatives.map((a) => a.name).join(', ')}` : ''}${hint ? `  hint ${hint.kg} kg (${hint.source}${hint.source === 'home' ? `, from ${hint.fromLb} lb = ${kgOf(hint.fromLb)} kg` : ''})` : ''}`);
}
say(`\nTravel ${travelWrite ? 'WRITE' : 'unchanged'}: ${TRIP.start} → ${TRIP.end} ${TRIP.label}, ${TRIP.altitude.place} ${TRIP.altitude.meters} m from ${TRIP.altitude.arrival}`);
const boundary = dayBoundaryOf(toDomainProfile(prof));
const periods = travelPeriodsOf({ travelPeriods: periodsAfter });
const closed = completed.map((s) => (s.id === SESSION_ID ? { ...s, partial: { closedAt: now, skipped } } : s));
for (const day of ['2026-11-05', '2026-11-06']) {
  const wk = travelWeek(activeTravel(day, periods)?.plan ?? [], day, closed, boundary);
  say(`  Today ${day}: ${wk.rows.filter((x) => x.kind === 'session').map((x) => `${x.label} [${x.status}]`).join(' · ')} · next up: ${wk.next?.label ?? '—'}`);
}

say(`\nPLAN: session ${alreadyFixed ? '—' : 'WRITE'}, unit ask ${askWrite ? 'WRITE' : '—'}, catalog +${catWrites.length}, template ${tplExists ? 'overwrite' : 'create'}, travel ${travelWrite ? 'WRITE' : '—'}.`);
if (!APPLY) { say('Dry run. Re-run with --apply to write.'); process.exit(0); }

const conv = (v: unknown): unknown => {
  if (v instanceof Timestamp) return v.toDate().toISOString();
  if (Array.isArray(v)) return v.map(conv);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, conv(x)]));
  return v;
};
const dir = join(homedir(), 'ignia-backups');
const backup = join(dir, `user-data-2026-11-05-stephanie-${stamp.replace(/[:.]/g, '-')}.json`);
mkdirSync(dir, { recursive: true });
writeFileSync(backup, JSON.stringify(conv({ uid, session: { id: SESSION_ID, ...raw }, travelPeriods: prof.travelPeriods ?? null, unitAsk: prof.unitAsk ?? null, template: tplSnap.docs.find((d) => d.id === DAY_2B)?.data() ?? null }), null, 1));
if (!existsSync(backup)) throw new Error('backup not written — refusing to write');
say(`backup written: ${backup}`);

const prune = (v: unknown): unknown => JSON.parse(JSON.stringify(v));
const batch = db.batch();
if (!alreadyFixed) {
  batch.update(sesDoc.ref, {
    durationMin: correctedMin,
    durationNote,
    partial: { closedAt: Timestamp.fromDate(now), skipped },
    updatedAt: FieldValue.serverTimestamp(),
  });
}
for (const [id, c] of catWrites) {
  batch.set(user.collection('exercises').doc(id), {
    name: c.name, muscles: c.muscles, defaultCues: [], logStyle: c.logStyle ?? 'weight-reps', category: c.category,
    effortStandard: 'rir2', setStructure: 'straight', createdAt: Timestamp.fromDate(now),
  });
}
batch.set(user.collection('workoutTemplates').doc(DAY_2B), {
  ...(prune(tpl) as object),
  createdAt: tplExists ? tplSnap.docs.find((d) => d.id === DAY_2B)!.data().createdAt : Timestamp.fromDate(now),
  updatedAt: FieldValue.serverTimestamp(),
});
const profPatch: Record<string, unknown> = {};
if (travelWrite) profPatch.travelPeriods = periodsAfter;
if (askWrite) profPatch.unitAsk = UNIT_ASK;
if (Object.keys(profPatch).length) batch.update(user, profPatch);
await batch.commit();
say('written.');
process.exit(0);
