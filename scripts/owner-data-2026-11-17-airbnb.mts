/**
 * Owner data, 2026-11-16 (America/La_Paz): a one-off, throwaway template for
 * Tue 2026-11-17 — "Santa Cruz Airbnb — Full Body (one-off)" on a home
 * multi-gym with unknown stack ratios.
 *
 *   CATALOG   `airbnb-*` lifts, fresh ids: no history is shared with Haven
 *             (`haven-*`) or the home program, so nothing read here reaches
 *             them and nothing of theirs is read here (core `readableRow`
 *             matches on `exerciseId`). Muscle tags are ordered so core
 *             `creditsFor` gives the requested direct / fractional split.
 *   TEMPLATE  `travel-airbnb-2026-11-17`, `templateVersion: 'travel-oneoff'`:
 *             a travel template (core `isTravelTemplate`), so never a re-entry
 *             session and not "the gym" for the 11/20 re-entry rotation. Not
 *             in any rotation (rotation = Leg / Pull / Push). Rows carry no
 *             `awayGym` on purpose: an away-gym row with no history starts as
 *             calibration ("activation at RIR 2"), which contradicts the
 *             owner's RIR 1 / failure. No `targetLoad`, no `progression`.
 *             App support shipped the same night (OTA 2026-11-17):
 *             `oneOff.archiveOn` (the app archives it once its session is
 *             logged, or on that day; never in a rotation; the session starts
 *             not comparable), `gymBusy` (the any-order list starts on), and
 *             `stackPositions` on every row (a "plate #" switch: the set stores
 *             `plate`, no weight). Rules allow both template fields — deploy
 *             `firestore:rules` before `--apply`.
 *   PLAN      Bolivia trip plan: + session 11/17 (morning); the 11/16 week
 *             note runs 11/16 → 11/22 with `volumeOk` (no under-target
 *             warning on Train or Trends that week), says the session counts
 *             and the week is "travel + re-entry — OK". Nothing else changes.
 *
 *   --close   Fallback for the app's own archive: archivedAt once the 11/17
 *             session is logged, or on 2026-11-19 regardless; and mark the
 *             logged session `notComparable`. Idempotent.
 *
 * DRY RUN unless `--apply`; backs up first; re-runs plan nothing.
 *
 *   TZ=America/La_Paz npx jiti scripts/owner-data-2026-11-17-airbnb.mts [--apply] [--close]
 *
 * Auth: ADC (`gcloud auth application-default login`).
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue, getFirestore, Timestamp } from 'firebase-admin/firestore';
import type { Exercise, MuscleGroup, PlannedSet, TemplateExercise } from '../packages/core/src/workout.ts';
import {
  type RowAlternative,
  type TravelPlanEntry,
  calendarDateKey,
  dayBoundaryOf,
  dayKeyAt,
  isTravelTemplate,
  plannedVolume,
  reentryFor,
  supersetFlow,
  toWorkoutExercise,
  toWorkoutSession,
  toWorkoutTemplate,
  travelPeriodsOf,
  travelWeek,
  volumeWaiver,
  rotationTemplates,
  oneOffsToArchive,
} from '../packages/core/src/index.ts';

const PROJECT_ID = 'fitness-tracker-gb-1775407101';
const OWNER = 'gabrielandresbermudez@gmail.com';
const APPLY = process.argv.includes('--apply');
const CLOSE = process.argv.includes('--close');
const TPL_ID = 'travel-airbnb-2026-11-17';
const TPL_NAME = 'Santa Cruz Airbnb — Full Body (one-off)';
const VERSION = 'travel-oneoff';
const DAY = '2026-11-17';
const ARCHIVE_ON = '2026-11-19';
const CONTEXT = 'Airbnb multi-gym — loads not comparable';
const LOAD_CUE = 'Baseline pending — no load set. Log kg if the stack is marked in kg; if it shows plate numbers only, tap "plate #" on the card and type the plate number.';
const HOME = ['quxwARQlCnItzpLJgcr4', 'aliWJBD2FND6mU9foLdC', 'Nx1bxeRuH6bMnGgX7Trv'];

type Effort = 'rir1' | 'rir2' | 'failure';
interface Lift { id: string; name: string; muscles: MuscleGroup[]; effort: Effort; category: 'compound' | 'isolation' | 'core' }
const LIFTS: Lift[] = [
  { id: 'airbnb-bulgarian-split-squat-db', name: 'Bulgarian Split Squat (DB)', muscles: ['quads', 'glutes'], effort: 'rir1', category: 'compound' },
  { id: 'airbnb-pull-up', name: 'Pull-up (neutral / overhand)', muscles: ['back', 'biceps'], effort: 'rir1', category: 'compound' },
  { id: 'airbnb-lat-pulldown', name: 'Lat Pulldown (multi-gym high pulley)', muscles: ['back', 'biceps'], effort: 'rir1', category: 'compound' },
  { id: 'airbnb-machine-chest-press', name: 'Machine Chest Press (multi-gym)', muscles: ['chest', 'triceps', 'shoulders'], effort: 'rir1', category: 'compound' },
  { id: 'airbnb-deficit-push-up', name: 'Push-up (deficit)', muscles: ['chest', 'triceps', 'shoulders'], effort: 'rir1', category: 'compound' },
  { id: 'airbnb-db-rdl', name: 'DB Romanian Deadlift', muscles: ['hamstrings', 'glutes'], effort: 'rir2', category: 'compound' },
  { id: 'airbnb-single-leg-db-rdl', name: 'Single-leg DB RDL', muscles: ['hamstrings', 'glutes'], effort: 'rir2', category: 'compound' },
  { id: 'airbnb-db-lateral-raise', name: 'DB Lateral Raise (Airbnb)', muscles: ['shoulders'], effort: 'failure', category: 'isolation' },
  { id: 'airbnb-leg-extension', name: 'Leg Extension (multi-gym)', muscles: ['quads'], effort: 'failure', category: 'isolation' },
  { id: 'airbnb-captains-chair-leg-raise', name: "Captain's Chair Leg Raise (power tower)", muscles: ['core'], effort: 'failure', category: 'core' },
  { id: 'airbnb-hanging-leg-raise', name: 'Hanging Leg Raise (power tower)', muscles: ['core'], effort: 'failure', category: 'core' },
  { id: 'airbnb-seated-low-pulley-row', name: 'Seated Low-Pulley Row (multi-gym)', muscles: ['back', 'biceps'], effort: 'rir1', category: 'compound' },
  { id: 'airbnb-one-arm-db-row', name: 'One-arm DB Row (Airbnb)', muscles: ['back', 'biceps'], effort: 'rir1', category: 'compound' },
  // The owner: "chest + triceps fractional". Core `creditsFor` always makes the
  // first tag 1.0, so this reads chest 1 · triceps ½ (reported).
  { id: 'airbnb-dips', name: 'Dips (power tower)', muscles: ['chest', 'triceps'], effort: 'rir1', category: 'compound' },
  { id: 'airbnb-seated-db-shoulder-press', name: 'Seated DB Shoulder Press (Airbnb)', muscles: ['shoulders'], effort: 'rir1', category: 'compound' },
  { id: 'airbnb-db-curl', name: 'DB Curl (Airbnb)', muscles: ['biceps'], effort: 'failure', category: 'isolation' },
  { id: 'airbnb-one-arm-cable-oh-triceps-ext', name: 'One-arm Cable Overhead Triceps Extension', muscles: ['triceps'], effort: 'failure', category: 'isolation' },
  { id: 'airbnb-cable-pushdown', name: 'Cable Pushdown (Airbnb)', muscles: ['triceps'], effort: 'failure', category: 'isolation' },
];
const lift = (id: string) => LIFTS.find((l) => l.id === id)!;
const EFFORT_CUE: Record<Effort, string> = {
  rir1: 'RIR 1 — stop 1 rep before failure; minis RIR 0–1',
  rir2: 'RIR 2 on every set',
  failure: 'RIR 0 — to failure',
};

const cluster = (group: number, label?: string): PlannedSet[] => (['activation', 'mini', 'mini'] as const).map((kind) => ({ kind, group, ...(label ? { label } : {}) }));
const clusters = (n: number, labels?: string[]) => Array.from({ length: n }, (_, i) => cluster(i + 1, labels?.[i])).flat();
const straight = (n: number, labels?: string[]): PlannedSet[] => (labels ?? [undefined]).flatMap((label) => Array.from({ length: n }, () => ({ kind: 'working' as const, reps: 8, repsMax: 12, ...(label ? { label } : {}) })));
const PER_SIDE = ['L', 'R'];

interface RowSpec { id: string; sets: PlannedSet[]; group?: string; pos?: 1 | 2; alt?: { id: string; sets?: PlannedSet[]; note: string }; note?: string; straight?: boolean; perSideOnce?: boolean; after?: number }
const ROWS: RowSpec[] = [
  { id: 'airbnb-bulgarian-split-squat-db', sets: clusters(2, PER_SIDE), after: 90, note: '1 cluster per leg (L, R) — counts as one cluster.' },
  { id: 'airbnb-pull-up', sets: clusters(2), group: 'A', pos: 1, alt: { id: 'airbnb-lat-pulldown', note: 'if no pull-up bar / too hard' } },
  { id: 'airbnb-machine-chest-press', sets: clusters(2), group: 'A', pos: 2, alt: { id: 'airbnb-deficit-push-up', note: 'if the press arm does not fit' } },
  { id: 'airbnb-db-rdl', sets: straight(2), group: 'B', pos: 1, straight: true, alt: { id: 'airbnb-single-leg-db-rdl', sets: straight(2, PER_SIDE), note: 'if the DBs are light' } },
  { id: 'airbnb-db-lateral-raise', sets: clusters(2), group: 'B', pos: 2 },
  { id: 'airbnb-leg-extension', sets: clusters(2), group: 'C', pos: 1, note: 'If stack is light: 3 s lowering, 1–2 s pause.' },
  { id: 'airbnb-captains-chair-leg-raise', sets: clusters(1), group: 'C', pos: 2, alt: { id: 'airbnb-hanging-leg-raise', note: 'if no captain\'s chair pads' } },
  { id: 'airbnb-seated-low-pulley-row', sets: clusters(2), group: 'D', pos: 1, alt: { id: 'airbnb-one-arm-db-row', sets: clusters(2, PER_SIDE), note: 'if the low pulley is out' } },
  { id: 'airbnb-dips', sets: clusters(1), group: 'D', pos: 2, alt: { id: 'airbnb-seated-db-shoulder-press', note: 'if dips hurt / no dip station' } },
  { id: 'airbnb-db-curl', sets: clusters(1), group: 'E', pos: 1 },
  { id: 'airbnb-one-arm-cable-oh-triceps-ext', sets: clusters(2, PER_SIDE), group: 'E', pos: 2, note: '1 cluster per arm (L, R) — counts as one cluster.', alt: { id: 'airbnb-cable-pushdown', sets: clusters(1), note: 'if the cable cannot go overhead' } },
];

function rowOf(s: RowSpec, stamp: string): TemplateExercise & Record<string, unknown> {
  const l = lift(s.id);
  const alt: RowAlternative | undefined = s.alt ? {
    exerciseId: s.alt.id,
    name: lift(s.alt.id).name,
    ...(s.alt.sets ? { plannedSets: s.alt.sets } : {}),
    cues: [EFFORT_CUE[lift(s.alt.id).effort], CONTEXT, LOAD_CUE],
    note: s.alt.note,
  } : undefined;
  return {
    exerciseId: s.id,
    name: l.name,
    logStyle: 'weight-reps',
    ...(s.straight ? { setStructure: 'straight', restMiniSec: 120 } : {}),
    plannedSets: s.sets,
    cues: [
      CONTEXT,
      s.straight ? 'Straight 2 × 8–12, RIR 2, 120 s rest, no minis. Low-back rule: sharp pain or >3/10 → stop.' : EFFORT_CUE[l.effort],
      ...(s.note ? [s.note] : []),
      LOAD_CUE,
    ],
    loadUnit: 'kg',
    stackPositions: true,
    ...(s.group ? { supersetGroup: s.group, pairPosition: s.pos } : {}),
    ...(s.pos === 1 ? { transitionRestSec: 30, roundRestSec: 90 } : {}),
    ...(s.after != null ? { restAfterSec: s.after } : {}),
    ...(alt ? { alternatives: [alt] } : {}),
    lastModifiedAt: stamp,
    lastModifiedBy: 'prompt',
  } as TemplateExercise & Record<string, unknown>;
}

const NOTES = `2026-11-16 — ONE-OFF, TEMPORARY (owner). Santa Cruz Airbnb home multi-gym, Tue ${DAY} morning. Not part of any rotation. Archived after the session is logged, or on ${ARCHIVE_ON}, whichever comes first (scripts/owner-data-2026-11-17-airbnb.mts --close); history kept.
CONTEXT: ${CONTEXT}. Unknown stack ratios: no regression flags, no PRs, no next-load suggestions; nothing carries to Haven or home lifts (own exercise ids).
FORMAT: activation → 10 s → mini → 10 s → mini. Supersets: 30 s between lifts, 90 s between rounds. Loads start empty (baseline pending), kg or plate # ("plate #" switch on each card).
GYM BUSY: private gym — any order is fine; the "Gym busy" list starts on.
ORDER: 1 split squat (L, R) · A1/A2 · B1/B2 · C1/C2 · D1/D2 · E1/E2 (E2 L, R).`;

const PLAN_ADD: TravelPlanEntry = { from: DAY, to: DAY, kind: 'session', label: 'Santa Cruz Airbnb — Full Body (one-off)', templateId: TPL_ID, note: 'Morning. Home multi-gym, loads not comparable. Travel A/B stay optional.' };
const WEEK_NOTE = 'No volume targets this week — travel + re-entry, OK. The 11/17 Airbnb session counts toward the week.';

// ── read ──
initializeApp({ credential: applicationDefault(), projectId: PROJECT_ID });
const db = getFirestore();
const uid = (await getAuth().getUserByEmail(OWNER)).uid;
const user = db.doc(`users/${uid}`);
const now = new Date();
const stamp = now.toISOString();
const say = console.log;
say(`${APPLY ? 'APPLY' : 'DRY RUN'}${CLOSE ? ' --close' : ''} — ${now.toString()}\n`);
const [profileSnap, exSnap, tplSnap, sesSnap] = await Promise.all([
  user.get(), user.collection('exercises').get(), user.collection('workoutTemplates').get(),
  user.collection('workoutSessions').orderBy('timestamp', 'desc').limit(400).get(),
]);
const prof = profileSnap.data()!;
const boundary = dayBoundaryOf(prof);
const sessions = sesSnap.docs.map((d) => toWorkoutSession(d.id, d.data()));
const completed = sessions.filter((s) => s.status === 'completed');
const conv = (v: unknown): unknown => {
  if (v instanceof Timestamp) return v.toDate().toISOString();
  if (Array.isArray(v)) return v.map(conv);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, conv(x)]));
  return v;
};
function backup(tag: string, data: unknown) {
  const dir = join(homedir(), 'ignia-backups');
  const file = join(dir, `owner-data-2026-11-17-airbnb-${tag}-${stamp.replace(/[:.]/g, '-')}.json`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(file, JSON.stringify(conv(data), null, 1));
  if (!existsSync(file)) throw new Error('backup not written — refusing to write');
  say(`backup written: ${file}`);
}

// ── --close: archive + not comparable ──
if (CLOSE) {
  const tpl = tplSnap.docs.find((d) => d.id === TPL_ID);
  if (!tpl) throw new Error(`${TPL_ID} does not exist`);
  const logged = sesSnap.docs.filter((d) => d.get('templateId') === TPL_ID && d.get('status') === 'completed');
  const today = dayKeyAt(now, boundary);
  const archived = tpl.get('archivedAt') != null;
  const due = logged.length > 0 || today >= ARCHIVE_ON;
  const toFlag = logged.filter((d) => d.get('notComparable') !== true);
  say(`today ${today} · logged sessions ${logged.length} · archived ${archived} · due ${due} · sessions to mark not comparable ${toFlag.length}`);
  if (!due && !toFlag.length) { say(`Not due: no logged session and today < ${ARCHIVE_ON}. Nothing to do.`); process.exit(0); }
  if ((archived || !due) && !toFlag.length) { say('Nothing to do (already closed).'); process.exit(0); }
  if (!APPLY) { say('Dry run. Re-run with --apply to write.'); process.exit(0); }
  backup('close', { uid, template: tpl.data(), sessions: Object.fromEntries(logged.map((d) => [d.id, { notComparable: d.get('notComparable') ?? null }])) });
  const batch = db.batch();
  if (due && !archived) batch.update(tpl.ref, { archivedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
  for (const d of toFlag) batch.update(d.ref, { notComparable: true, updatedAt: FieldValue.serverTimestamp() });
  await batch.commit();
  say('written.');
  process.exit(0);
}

// ── build ──
const exById = new Map(exSnap.docs.map((d) => [d.id, d]));
for (const l of LIFTS) if (exById.has(l.id) && exById.get(l.id)!.get('name') !== l.name) throw new Error(`catalog ${l.id} exists as "${exById.get(l.id)!.get('name')}"`);
const catCreates = LIFTS.filter((l) => !exById.has(l.id)).map((l) => ({
  id: l.id,
  doc: { name: l.name, muscles: l.muscles, defaultCues: [], logStyle: 'weight-reps', effortStandard: l.effort, category: l.category, createdAt: Timestamp.fromDate(now) },
}));
const catalog: Exercise[] = [...exSnap.docs.map((d) => toWorkoutExercise(d.id, d.data())), ...catCreates.map((c) => toWorkoutExercise(c.id, c.doc))];

const body = { name: TPL_NAME, notes: NOTES, templateVersion: VERSION, gymBusy: true, oneOff: { archiveOn: ARCHIVE_ON }, restMiniSec: 10, restClusterSec: 90, exercises: ROWS.map((s) => JSON.parse(JSON.stringify(rowOf(s, stamp)))) };
const stable = (v: unknown): string => {
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v).filter((k) => k !== 'lastModifiedAt' && (v as Record<string, unknown>)[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${stable((v as Record<string, unknown>)[k])}`).join(',')}}`;
  return JSON.stringify(v);
};
const cur = tplSnap.docs.find((d) => d.id === TPL_ID)?.data();
const tplWrite = !cur || (() => { const { createdAt: _c, updatedAt: _u, archivedAt: _a, ...keep } = cur; return stable(keep) !== stable(body); })();
const clash = tplSnap.docs.filter((d) => d.id !== TPL_ID && d.get('name') === TPL_NAME);
if (clash.length) throw new Error(`another template is named "${TPL_NAME}": ${clash.map((d) => d.id).join(', ')}`);

const rawPeriods = (prof.travelPeriods ?? []) as Record<string, unknown>[];
const iTrip = rawPeriods.findIndex((p) => p.start === '2026-10-31' && p.end === '2026-11-18');
if (iTrip < 0) throw new Error('the Bolivia trip (10/31 → 11/18) is not on the profile');
const oldPlan = (rawPeriods[iTrip].plan ?? []) as TravelPlanEntry[];
const weekIdx = oldPlan.findIndex((e) => e.kind === 'note' && e.from === '2026-11-16' && /^Week of 11\/16/.test(e.label));
if (weekIdx < 0) throw new Error('no "Week of 11/16" note in the plan — run the rest-block script first');
const plan = oldPlan.map((e, i) => (i === weekIdx ? { ...e, to: '2026-11-22', label: 'Week of 11/16 — travel + re-entry — OK', note: WEEK_NOTE, volumeOk: true } : e)).filter((e) => !(e.kind === 'session' && e.templateId === TPL_ID));
plan.push(PLAN_ADD);
plan.sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : a.kind === 'session' && b.kind !== 'session' ? -1 : b.kind === 'session' && a.kind !== 'session' ? 1 : 0));
const planWrite = stable(plan) !== stable(oldPlan);
const periodsAfter = rawPeriods.map((p, i) => (i === iTrip ? { ...p, plan } : p));

// ── report ──
const t = toWorkoutTemplate(TPL_ID, body);
const shape = (r: TemplateExercise | RowAlternative, base?: TemplateExercise) => {
  const sets = r.plannedSets ?? base?.plannedSets ?? [];
  const w = sets.filter((s) => s.kind === 'working');
  const sides = [...new Set(sets.map((s) => s.label).filter(Boolean))];
  if (w.length) return `straight ${w.length / Math.max(1, sides.length)} × ${w[0].reps}–${w[0].repsMax}${sides.length ? ' per side' : ''}`;
  const a = sets.filter((s) => s.kind === 'activation').length;
  return sides.length ? `${a / sides.length} cl per side (${sides.join(', ')})` : `${a} cl`;
};
say(`TEMPLATE ${TPL_NAME} [${TPL_ID}] ${VERSION} · travel template: ${isTravelTemplate(t)} · gymBusy ${t.gymBusy} · oneOff ${JSON.stringify(t.oneOff)} · stack positions on ${t.exercises.filter((r) => r.stackPositions).length}/${t.exercises.length} rows`);
say('  block  exercise                                   clusters                effort   alt');
for (const r of t.exercises) {
  const tag = r.supersetGroup ? `${r.supersetGroup}${r.pairPosition}` : '1';
  const alt = r.alternatives?.[0];
  say(`  ${tag.padEnd(5)}  ${r.name.padEnd(42)} ${shape(r).padEnd(23)} ${lift(r.exerciseId).effort.padEnd(8)} ${alt ? `${alt.name} — ${shape(alt, r)}, ${lift(alt.exerciseId).effort}` : '—'}`);
}
const rows = t.exercises.map((e) => ({ ...e, sets: e.plannedSets }));
say(`  flow: ${supersetFlow(rows).map((s) => s.label ?? t.exercises[s.exerciseIndex].name.split(' ')[0]).join(' → ')}`);
say('\nVolume, core plannedVolume (clusters; L/R pair = 1): muscle direct / fractional');
for (const m of plannedVolume([t], catalog)) if (m.direct || m.fractional) say(`  ${m.muscle.padEnd(11)} ${m.direct} / ${m.fractional}`);
say('  alternatives:');
for (const l of LIFTS.filter((x) => ROWS.some((r) => r.alt?.id === x.id))) {
  const v = plannedVolume([toWorkoutTemplate('x', { name: 'x', exercises: [{ exerciseId: l.id, name: l.name, plannedSets: clusters(1) }] })], catalog).filter((m) => m.direct || m.fractional);
  say(`    ${l.name.padEnd(40)} ${v.map((m) => `${m.muscle} ${m.direct ? 'direct' : 'fract'}`).join(', ')}`);
}

const periods = travelPeriodsOf({ travelPeriods: periodsAfter });
const travelIds = new Set([...tplSnap.docs.map((d) => toWorkoutTemplate(d.id, d.data())), t].flatMap((x) => (x.id && isTravelTemplate(x) ? [x.id] : [])));
say(`\nRe-entry on 11/17 for this template: ${reentryFor({ templateId: TPL_ID, today: DAY, sessions: completed, periods, travelTemplateIds: travelIds, boundary }) ?? 'none (travel template)'}`);
for (const id of HOME) {
  const h = tplSnap.docs.find((d) => d.id === id);
  if (!h) continue;
  const ht = toWorkoutTemplate(id, h.data());
  say(`  ${ht.name} [${ht.templateVersion}] on 11/20: ${reentryFor({ templateId: id, today: '2026-11-20', sessions: completed, periods, travelTemplateIds: travelIds, templateCreatedAt: ht.createdAt, boundary }) ?? 'NOT re-entry'}`);
}
const ab = ['travel-a-full-body', 'travel-b-full-body'].map((id) => tplSnap.docs.find((d) => d.id === id));
say(`  Travel A/B: present ${ab.every(Boolean)}, archived ${ab.map((d) => d?.get('archivedAt') != null).join('/')} — not touched`);

say('\nPlan 11/16 → 11/23');
for (const e of plan) if (e.to >= '2026-11-16' && e.from <= '2026-11-23') say(`  ${e.from}${e.to !== e.from ? ` → ${e.to}` : ''}  ${e.kind.padEnd(7)} ${e.label}${e.note ? ` · ${e.note}` : ''}`);
const wk = travelWeek(plan, DAY, completed, boundary);
say(`  travelWeek(${DAY}): ${wk.rows.filter((r) => r.kind === 'session').map((r) => `${r.from} ${r.label} [${r.status}]`).join(', ')} · next ${wk.next ? `${wk.next.label} ${wk.next.from}` : '—'}`);
say(`  today key: ${calendarDateKey(now)}`);
for (const d of ['2026-11-15', '2026-11-17', '2026-11-22', '2026-11-23']) say(`  volume waiver ${d}: ${volumeWaiver(travelPeriodsOf({ travelPeriods: periodsAfter }), d)?.label ?? '—'}`);
say(`  one-off: in rotation ${rotationTemplates([t], new Set(), [], now.getTime()).length > 0} · archive due 11/17 (no session) ${oneOffsToArchive([t], [], '2026-11-17').length > 0} · after a logged session ${oneOffsToArchive([t], [{ status: 'completed', templateId: TPL_ID }], '2026-11-17').length > 0} · on 11/19 ${oneOffsToArchive([t], [], '2026-11-19').length > 0}`);

say(`\nPLAN: ${catCreates.length} catalog create(s); template ${tplWrite ? (cur ? 'UPDATE' : 'CREATE') : 'unchanged'}; travel plan ${planWrite ? 'WRITE' : 'unchanged'}.`);
if (!APPLY) { say('Dry run. Re-run with --apply to write.'); process.exit(0); }
if (!catCreates.length && !tplWrite && !planWrite) { say('Nothing to do (already applied).'); process.exit(0); }

backup('create', { uid, travelPeriods: prof.travelPeriods, template: cur ?? null });
const untouched = tplSnap.docs.filter((d) => d.id !== TPL_ID);
const hashBefore = stable(untouched.map((d) => [d.id, conv(d.data())]));
const batch = db.batch();
for (const c of catCreates) batch.set(user.collection('exercises').doc(c.id), c.doc);
if (tplWrite) batch.set(user.collection('workoutTemplates').doc(TPL_ID), { ...body, createdAt: cur?.createdAt ?? Timestamp.fromDate(now), updatedAt: FieldValue.serverTimestamp() });
if (planWrite) batch.update(user, { travelPeriods: periodsAfter });
await batch.commit();
const check = (await user.collection('workoutTemplates').get()).docs.filter((d) => d.id !== TPL_ID);
say(`Every other template unchanged (home v2.4, Haven, Travel A/B…): ${stable(check.map((d) => [d.id, conv(d.data())])) === hashBefore}`);
say('written.');
process.exit(0);
