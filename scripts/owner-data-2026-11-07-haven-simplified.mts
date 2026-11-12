/**
 * Owner data, 2026-11-07 (America/La_Paz): two simplified Haven templates
 * replace Travel C / D for the last two Cochabamba sessions (Mon 11/9, Wed
 * 11/11). Machines only — no lat pulldown / rope / cable stations.
 *
 *   TEMPLATES + `travel-haven-1` "Haven 1 — Legs/Push/Pull (simplified)"
 *             + `travel-haven-2` "Haven 2 — Hinge/Pull/Arms (simplified)"
 *             `templateVersion: travel-gym-v4` — a travel template
 *             (`isTravelTemplate`), so the 11/19 home re-entry still reads
 *             the last HOME session as "the gym". Every row `awayGym: Haven
 *             Gym`, kg, baseline since 11/3 (the Haven baseline C/D used), so
 *             the engine reads the C/D/11-6 Haven sets of the same lift.
 *             Starting load = the lift's last logged Haven load; a lift with
 *             none gets no load and the engine says "baseline pending".
 *   ARCHIVE   `travel-gym-c`, `travel-gym-d`: `archivedAt` only — every other
 *             field and every session is untouched (checked after the write).
 *             Archived = out of Start's list and the next-up picker; after the
 *             trip the picker skips travel templates anyway (`nextTemplateUp`).
 *   PLAN      `travelPeriods[Bolivia].plan`: 11/9 → Haven 1, 11/11 → Haven 2,
 *             11/13–11/18 Buena Vista then Santa Cruz: Travel A Sat 11/14,
 *             Travel B Mon 11/16, optional Travel A Tue 11/17 or Wed 11/18.
 *             Entries before 11/9 and the 11/19 note are kept.
 *
 * DRY RUN unless `--apply`; backs up first; re-runs plan nothing.
 *
 *   TZ=America/La_Paz npx jiti scripts/owner-data-2026-11-07-haven-simplified.mts [--apply]
 *
 * Auth: ADC (`gcloud auth application-default login`).
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue, getFirestore, Timestamp } from 'firebase-admin/firestore';
import type { Exercise, PlannedSet, TemplateExercise, WorkoutTemplate } from '../packages/core/src/workout.ts';
import {
  type RowAlternative,
  type TravelPlanEntry,
  creditsFor,
  dayBoundaryOf,
  estimateTemplateDuration,
  isTravelTemplate,
  kgToLb,
  lbToKg,
  nextTemplateUp,
  plannedVolume,
  reentryFor,
  restAfterSetInFlow,
  sessionCall,
  supersetFlow,
  templateRestFor,
  toWorkoutExercise,
  toWorkoutSession,
  toWorkoutTemplate,
  travelPeriodsOf,
  travelWeek,
} from '../packages/core/src/index.ts';

const PROJECT_ID = 'fitness-tracker-gb-1775407101';
const OWNER = 'gabrielandresbermudez@gmail.com';
const APPLY = process.argv.includes('--apply');
const VERSION = 'travel-gym-v4';
const GYM = 'Haven Gym';
const SINCE = '2026-11-03';
const H1_ID = 'travel-haven-1';
const H2_ID = 'travel-haven-2';
const C_ID = 'travel-gym-c';
const D_ID = 'travel-gym-d';
const KG_STEP_LB = +kgToLb(2.5).toFixed(2);
const kg = (v: number) => +kgToLb(v).toFixed(2);
const NOTES = 'Simplified for Haven — machines only, no lat pulldown / rope / cable stations. Evidence: Haugen 2023 (machines ≈ free weights for hypertrophy), Bickel 2011 (reduced volume maintains muscle).';

const ID = {
  legPress: 'haven-45-leg-press', bulgarian: 'fJJ3hd3N0GEIQf64L4Z8', lateral: 'haven-db-lateral-raise',
  flat: 'ud6fE363QklE3qXYxLw3', cableRow: 'haven-seated-cable-row', csRow: 'acs1BlQvTZdL97i5jXJv',
  legCurl: 'haven-seated-leg-curl', lyingCurl: 'haven-lying-db-leg-curl', crunch: 'x3G0Speg04GclIOdKHAl',
  triMachine: 'haven-triceps-extension-machine', skull: 'EyDTWnfO4WrbYDbDkxrk',
  armCurl: 'haven-arm-curl-machine', inclineCurl: 'MVC1wLKBkRz7XYyKp79e',
  rdl: 'vtSvqglnBZdM1f3qOJi4', pullUp: 'GOGOcWJNC9q9aBmN3ENq', oneArmRow: 'haven-one-arm-db-row',
  shoulderMachine: 'haven-shoulder-press-machine', legExt: 'haven-leg-extension', legRaise: 'jMGQm6C9I6HNNPXPYYLM',
  pecDeck: 'haven-pec-deck', incline30: 'haven-30-incline-db-press', rearMachine: 'haven-rear-delt-machine',
};
/** Ids outside the `haven-*` set share their lift record with home: Haven
 *  sets on them must stay out of the home engine (`linkedHome`). */
const linked = (id: string) => !id.startsWith('haven-');
const BODYWEIGHT = new Set([ID.pullUp, ID.legRaise]);

// ── rows ──
const cluster = (group: number): PlannedSet[] => (['activation', 'mini', 'mini'] as const).map((kind) => ({ kind, group }));
const clusters = (n: number) => Array.from({ length: n }, (_, i) => cluster(i + 1)).flat();

interface RowSpec {
  id: string;
  name?: string;
  sets: PlannedSet[];
  group: string;
  pos: 1 | 2;
  alt?: string;
  note?: string;
  straight?: boolean;
  /** Rest between this lift's own clusters (C/D used 105 for the big compounds). */
  ownRest?: number;
}
const H1: RowSpec[] = [
  { id: ID.legPress, group: 'A', pos: 1, sets: clusters(2), ownRest: 105, alt: ID.bulgarian, note: 'load = plates only (sled excluded)' },
  { id: ID.lateral, group: 'A', pos: 2, sets: [...cluster(1), ...cluster(2), { kind: 'drop', group: 2 }], note: "paired early so they aren't skipped — side delts got 0 direct last week" },
  { id: ID.flat, name: 'DB Flat Press', group: 'B', pos: 1, sets: clusters(2) },
  { id: ID.cableRow, group: 'B', pos: 2, sets: clusters(2), ownRest: 105, alt: ID.csRow },
  { id: ID.legCurl, group: 'C', pos: 1, sets: clusters(2), alt: ID.lyingCurl },
  { id: ID.crunch, name: 'Weighted Floor Crunch (plate)', group: 'C', pos: 2, sets: clusters(2) },
  { id: ID.triMachine, group: 'D', pos: 1, sets: clusters(1), alt: ID.skull },
  { id: ID.armCurl, group: 'D', pos: 2, sets: clusters(1), alt: ID.inclineCurl },
];
const H2: RowSpec[] = [
  { id: ID.rdl, name: 'DB Romanian Deadlift', group: 'A', pos: 1, straight: true, sets: [{ kind: 'working', reps: 8, repsMax: 12 }, { kind: 'working', reps: 8, repsMax: 12 }] },
  { id: ID.lateral, group: 'A', pos: 2, sets: clusters(1), note: 'done during RDL rest' },
  { id: ID.pullUp, name: 'Pull-up (neutral / overhand)', group: 'B', pos: 1, sets: clusters(2), ownRest: 105, alt: ID.oneArmRow },
  { id: ID.shoulderMachine, group: 'B', pos: 2, sets: clusters(1) },
  { id: ID.legExt, group: 'C', pos: 1, sets: clusters(2) },
  { id: ID.legRaise, name: 'Hanging Leg Raise', group: 'C', pos: 2, sets: clusters(1) },
  { id: ID.pecDeck, group: 'D', pos: 1, sets: clusters(2), alt: ID.incline30 },
  { id: ID.rearMachine, group: 'D', pos: 2, sets: clusters(2), note: 'if same machine as pec deck, switch handles' },
  { id: ID.armCurl, group: 'E', pos: 1, sets: clusters(1) },
  { id: ID.triMachine, group: 'E', pos: 2, sets: clusters(1) },
];

const PLAN_FROM = '2026-11-09';
const NEW_PLAN_TAIL: TravelPlanEntry[] = [
  { from: '2026-11-09', to: '2026-11-09', kind: 'session', label: 'Haven 1', templateId: H1_ID, note: 'simplified, machines only, ~40 min' },
  { from: '2026-11-11', to: '2026-11-11', kind: 'session', label: 'Haven 2', templateId: H2_ID, note: 'simplified, machines only, ~40 min; last Haven session' },
  { from: '2026-11-13', to: '2026-11-13', kind: 'note', label: 'Buena Vista, then Santa Cruz', note: '~400 m, no gym through 11/18: Travel A / B only; skipped is not missed' },
  { from: '2026-11-14', to: '2026-11-14', kind: 'session', label: 'Travel A', templateId: 'travel-a-full-body', note: 'bodyweight' },
  { from: '2026-11-16', to: '2026-11-16', kind: 'session', label: 'Travel B', templateId: 'travel-b-full-body', note: 'bodyweight' },
  { from: '2026-11-17', to: '2026-11-18', kind: 'session', label: 'Travel A (optional)', templateId: 'travel-a-full-body', note: 'optional — Tue or Wed' },
];

// ── read ──
initializeApp({ credential: applicationDefault(), projectId: PROJECT_ID });
const db = getFirestore();
const uid = (await getAuth().getUserByEmail(OWNER)).uid;
const user = db.doc(`users/${uid}`);
const now = new Date();
const stamp = now.toISOString();
const [profileSnap, exSnap, tplSnap, sesSnap] = await Promise.all([
  user.get(), user.collection('exercises').get(), user.collection('workoutTemplates').get(),
  user.collection('workoutSessions').orderBy('timestamp', 'desc').limit(400).get(),
]);
const say = console.log;
say(`${APPLY ? 'APPLY' : 'DRY RUN'} — ${now.toString()}\n`);

const exById = new Map(exSnap.docs.map((d) => [d.id, d]));
for (const [k, id] of Object.entries(ID)) if (!exById.has(id)) throw new Error(`catalog is missing ${k} ${id}`);
const catalog: Exercise[] = exSnap.docs.map((d) => toWorkoutExercise(d.id, d.data()));
const catOf = (id: string) => catalog.find((c) => c.id === id)!;
const sessions = sesSnap.docs.map((d) => toWorkoutSession(d.id, d.data()));
const completed = sessions.filter((s) => s.status === 'completed');

/** The last logged Haven load of a lift, kg: the newest completed Haven
 *  session's heaviest logged activation / working set (drops excluded). */
function lastHaven(id: string): { kg: number; on: string } | null {
  for (const s of completed) {
    const e = s.exercises.find((x) => x.exerciseId === id && x.awayGym === GYM);
    const w = e?.sets.filter((x) => x.reps != null && x.weight != null && x.kind !== 'drop').map((x) => x.weight!) ?? [];
    if (w.length) return { kg: +lbToKg(Math.max(...w)).toFixed(1), on: s.date.toISOString().slice(0, 10) };
  }
  return null;
}
const effortOf = (id: string) => catOf(id).effortStandard ?? 'failure';
const effortCue = (id: string, straight?: boolean) => {
  const e = effortOf(id);
  return e === 'failure' ? 'RIR 0 — to failure' : e === 'rir2' ? 'RIR 2 on every set' : straight ? 'RIR 1 on every set' : 'RIR 1 — stop 1 rep before failure; minis RIR 0–1';
};
const loadOf = (id: string): number | undefined => {
  if (BODYWEIGHT.has(id)) return 0;
  const h = lastHaven(id);
  return h ? kg(h.kg) : undefined;
};
function altOf(id: string): RowAlternative {
  const c = catOf(id);
  const load = loadOf(id);
  const h = lastHaven(id);
  return {
    exerciseId: id,
    name: c.name,
    ...(load != null ? { targetLoad: load } : {}),
    cues: [h ? `Last Haven load ${h.kg} kg (${h.on}).` : 'No Haven history — baseline pending.'],
    ...(linked(id) ? { linkedHome: true } : {}),
    note: 'alternative',
  };
}
function row(s: RowSpec): TemplateExercise & Record<string, unknown> {
  const top = effortOf(s.id) === 'failure' ? 15 : 12;
  const load = loadOf(s.id);
  const h = lastHaven(s.id);
  const loadCue = BODYWEIGHT.has(s.id) ? 'Bodyweight.' : h ? `Start ${h.kg} kg — last Haven load (${h.on}).` : 'No Haven history yet — baseline pending: pick a load you can take to target, the engine starts from this session.';
  return {
    exerciseId: s.id,
    name: s.name ?? catOf(s.id).name,
    ...(load != null ? { targetLoad: load } : {}),
    logStyle: 'weight-reps',
    ...(s.straight ? { setStructure: 'straight', restMiniSec: 120 } : {}),
    plannedSets: s.sets,
    progression: { targetReps: top, holdSessions: 1, incrementLb: KG_STEP_LB },
    cues: [
      ...(s.note ? [`Note: ${s.note}`] : []),
      effortCue(s.id, s.straight),
      ...(s.straight ? ['Straight 2 × 8–12, 120 s rest, no minis.', 'low-back rule: sharp pain or >3/10 → stop'] : []),
      loadCue,
      `Progression: ${s.straight ? 'both sets at 12' : `activation ≥ ${top}`} at target effort → increase load next session.`,
    ],
    baseline: { since: SINCE, reason: 'Haven Gym — new baseline' },
    loadUnit: 'kg',
    awayGym: GYM,
    ...(linked(s.id) ? { linkedHome: true } : {}),
    supersetGroup: s.group,
    pairPosition: s.pos,
    transitionRestSec: 30,
    roundRestSec: 90,
    ...(s.ownRest != null ? { restClusterSec: s.ownRest, minClusterRestSec: s.ownRest } : {}),
    ...(s.alt ? { alternatives: [altOf(s.alt)] } : {}),
    ...(load ? { loadLog: [{ at: stamp, to: load, by: 'prompt', reason: `Haven simplified start ${h?.kg} kg = last Haven load ${h?.on} (owner, 2026-11-07)` }] } : {}),
    lastModifiedAt: stamp,
    lastModifiedBy: 'prompt',
  } as TemplateExercise & Record<string, unknown>;
}
const body = (name: string, rows: RowSpec[]) => ({
  name,
  notes: NOTES,
  templateVersion: VERSION,
  restMiniSec: 10,
  restClusterSec: 90,
  exercises: rows.map((s) => JSON.parse(JSON.stringify(row(s)))),
});
const docs = [
  { id: H1_ID, body: body('Haven 1 — Legs/Push/Pull (simplified)', H1) },
  { id: H2_ID, body: body('Haven 2 — Hinge/Pull/Arms (simplified)', H2) },
];

// Idempotence: compare without the stamps that change every run.
const stable = (v: unknown): string => {
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v).filter((k) => !['lastModifiedAt', 'at', 'loadLog'].includes(k) && (v as Record<string, unknown>)[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${stable((v as Record<string, unknown>)[k])}`).join(',')}}`;
  return JSON.stringify(v);
};
const tplDoc = new Map(tplSnap.docs.map((d) => [d.id, d]));
const tplWrites = docs.filter((d) => {
  const cur = tplDoc.get(d.id)?.data();
  if (!cur) return true;
  const { createdAt: _c, updatedAt: _u, ...keep } = cur;
  return stable(keep) !== stable(d.body);
});
const clash = tplSnap.docs.filter((d) => /^Haven [12]\b/.test(String(d.get('name'))) && d.id !== H1_ID && d.id !== H2_ID);
if (clash.length) throw new Error(`a "Haven 1/2" template already exists under ${clash.map((d) => d.id).join(', ')}`);
for (const id of [C_ID, D_ID]) if (!tplDoc.has(id)) throw new Error(`${id} missing`);
const toArchive = [C_ID, D_ID].filter((id) => tplDoc.get(id)!.get('archivedAt') == null);

const prof = profileSnap.data()!;
const rawPeriods = (prof.travelPeriods ?? []) as Record<string, unknown>[];
const iTrip = rawPeriods.findIndex((p) => p.start === '2026-10-31' && p.end === '2026-11-18');
if (iTrip < 0) throw new Error('the Bolivia trip (10/31 → 11/18) is not on the profile');
const oldPlan = (rawPeriods[iTrip].plan ?? []) as TravelPlanEntry[];
const keepBefore = oldPlan.filter((e) => e.to < PLAN_FROM);
const keepAfter = oldPlan.filter((e) => e.from > '2026-11-18');
const plan: TravelPlanEntry[] = [...keepBefore, ...NEW_PLAN_TAIL, ...keepAfter];
const planWrite = stable(oldPlan) !== stable(plan);
const periodsAfter = rawPeriods.map((p, i) => (i === iTrip ? { ...p, plan } : p));

// ── report ──
const after: WorkoutTemplate[] = docs.map((d) => toWorkoutTemplate(d.id, d.body));
const musclesOf = (id: string) => catOf(id)?.muscles;
const shape = (r: TemplateExercise) => {
  const a = r.plannedSets.filter((s) => s.kind === 'activation').length;
  const w = r.plannedSets.filter((s) => s.kind === 'working');
  return w.length ? `straight ${w.length}×${w[0].reps}–${w[0].repsMax}` : `${a} cl${r.plannedSets.some((s) => s.kind === 'drop') ? ' + drop' : ''}`;
};
const loadText = (r: TemplateExercise) => (r.targetLoad == null ? 'baseline pending' : r.targetLoad === 0 ? 'BW' : `${+lbToKg(r.targetLoad).toFixed(1)} kg`);
for (const t of after) {
  say(`\n${t.name} [${t.id}] ${t.templateVersion} · travel template ${isTravelTemplate(t)} · ${estimateTemplateDuration(t, musclesOf).minutes} min est.`);
  t.exercises.forEach((r) => {
    const alt = r.alternatives?.[0];
    say(`  ${(r.supersetGroup! + r.pairPosition).padEnd(3)} ${r.name.padEnd(40)} ${shape(r).padEnd(16)} ${effortOf(r.exerciseId).padEnd(8)} ${loadText(r).padEnd(17)} ${alt ? `alt ${alt.name} (${alt.targetLoad != null ? `${+lbToKg(alt.targetLoad).toFixed(1)} kg` : 'pending'})` : ''}`);
  });
  const rows = t.exercises.map((e) => ({ ...e, sets: e.plannedSets }));
  const restFor = templateRestFor(t);
  say(`  flow: ${supersetFlow(rows).map((s) => {
    const r = restAfterSetInFlow(rows, s.exerciseIndex, s.setIndices[s.setIndices.length - 1], restFor);
    return `${s.label ?? '—'} ${t.exercises[s.exerciseIndex].name.split(' ').slice(0, 2).join(' ')} [${r.seconds}s]`;
  }).join(' → ')}`);
  say('  first call (core sessionCall):');
  for (const r of t.exercises) {
    const { rec, history } = sessionCall(r, completed, catOf(r.exerciseId));
    say(`    ${r.name.padEnd(40)} ${rec.action.padEnd(9)} ${(rec.reason as { kind: string }).kind.padEnd(18)} reads ${history.length}`);
  }
}

say('\nCredits per lift (core creditsFor)');
for (const id of new Set([...H1, ...H2].map((s) => s.id))) {
  const c = catOf(id);
  say(`  ${c.name.padEnd(40)} ${creditsFor(c.name, c.muscles).map((x) => `${x.muscle} ${x.weight}`).join(', ')}`);
}

const TARGET: Record<string, number> = { quads: 4, hamstrings: 4, back: 5, chest: 5, sideDelt: 3, rearDelt: 2, biceps: 2, triceps: 2, abs: 4 };
const TRAVEL_OK = new Set(['chest', 'abs', 'calves']);
const vol = new Map(plannedVolume(after, catalog).map((m) => [m.muscle, m]));
const travelAB = tplSnap.docs.filter((d) => d.id === 'travel-a-full-body').map((d) => toWorkoutTemplate(d.id, d.data()));
const volA = new Map(plannedVolume(travelAB, catalog).map((m) => [m.muscle, m]));
say('\nWeek 11/9–11/15 planned clusters, Haven 1 + Haven 2 (core plannedVolume): direct / fractional · target · flag · (+ Travel A 11/14 direct/fractional)');
for (const m of [...new Set([...Object.keys(TARGET), 'calves', 'frontDelt', ...vol.keys()])]) {
  const v = vol.get(m);
  const d = v?.direct ?? 0;
  const f = v?.fractional ?? 0;
  const t = TARGET[m];
  const flag = t == null ? (m === 'calves' ? 'travel — OK' : '') : f >= t ? 'met' : TRAVEL_OK.has(m) ? 'travel — OK' : `short ${+(t - f).toFixed(1)}`;
  say(`  ${m.padEnd(11)} ${String(d).padStart(2)} / ${String(f).padEnd(5)} · ${String(t ?? '—').padEnd(2)} · ${flag.padEnd(12)} (+A ${volA.get(m)?.direct ?? 0}/${volA.get(m)?.fractional ?? 0})`);
}

say('\nTravel plan after');
for (const e of plan) say(`  ${e.from}${e.to !== e.from ? ` → ${e.to}` : ''} ${e.kind.padEnd(7)} ${e.label}${e.templateId ? ` [${e.templateId}]` : ''}${e.note ? ` · ${e.note}` : ''}`);

say('\nNext-up picker (core nextTemplateUp) with C/D archived');
{
  const boundary = dayBoundaryOf(prof);
  const periods = travelPeriodsOf({ travelPeriods: periodsAfter });
  const all = [
    ...tplSnap.docs.filter((d) => d.id !== H1_ID && d.id !== H2_ID).map((d) => toWorkoutTemplate(d.id, { ...d.data(), ...([C_ID, D_ID].includes(d.id) ? { archivedAt: Timestamp.fromDate(now) } : {}) })),
    ...after.map((t) => ({ ...t, createdAt: now, updatedAt: now })),
  ];
  // Simulate the sessions the plan expects, so each day reads as it will then.
  const fake = (templateId: string, day: string) => ({ id: `sim-${day}`, templateId, status: 'completed' as const, date: new Date(`${day}T12:00:00-04:00`), exercises: [] });
  const sim = [...completed];
  for (const [day, add] of [['2026-11-09', null], ['2026-11-10', [H1_ID, '2026-11-09']], ['2026-11-11', null], ['2026-11-12', [H2_ID, '2026-11-11']], ['2026-11-14', null], ['2026-11-15', ['travel-a-full-body', '2026-11-14']], ['2026-11-16', null], ['2026-11-17', ['travel-b-full-body', '2026-11-16']], ['2026-11-18', null], ['2026-11-19', ['travel-a-full-body', '2026-11-17']]] as const) {
    if (add) sim.unshift(fake(add[0], add[1]) as never);
    const ms = new Date(`${day}T08:00:00-04:00`).getTime();
    const n = nextTemplateUp(all, sim, ms, { today: day, periods, boundary });
    const week = travelWeek(plan, day, sim, boundary);
    say(`  ${day}: next-up ${n?.template.name ?? '—'}${[C_ID, D_ID].includes(n?.template.id ?? '') ? '  ← C/D LEAK' : ''} · plan next ${week.next ? `${week.next.label} ${week.next.from}` : '—'}`);
  }
  const travelIds = new Set(all.flatMap((t) => (t.id && isTravelTemplate(t) ? [t.id] : [])));
  const home = all.filter((t) => /^(Leg|Pull|Push) Day/.test(t.name));
  for (const t of home) say(`  ${t.name} on 2026-11-19: re-entry ${reentryFor({ templateId: t.id, today: '2026-11-19', sessions: sim, periods, travelTemplateIds: travelIds, templateCreatedAt: t.createdAt, boundary })}`);
}

say(`\nPLAN: ${tplWrites.length} template write(s) [${tplWrites.map((d) => d.id).join(', ')}], archive [${toArchive.join(', ') || '—'}], plan ${planWrite ? 'WRITE' : 'unchanged'}.`);
if (!APPLY) { say('Dry run. Re-run with --apply to write.'); process.exit(0); }
if (!tplWrites.length && !toArchive.length && !planWrite) { say('Nothing to do (already applied).'); process.exit(0); }

const conv = (v: unknown): unknown => {
  if (v instanceof Timestamp) return v.toDate().toISOString();
  if (Array.isArray(v)) return v.map(conv);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, conv(x)]));
  return v;
};
const dir = join(homedir(), 'ignia-backups');
const backup = join(dir, `owner-data-2026-11-07-haven-simplified-${stamp.replace(/[:.]/g, '-')}.json`);
mkdirSync(dir, { recursive: true });
writeFileSync(backup, JSON.stringify(conv({ uid, travelPeriods: prof.travelPeriods, templates: Object.fromEntries(tplSnap.docs.map((d) => [d.id, d.data()])) }), null, 1));
if (!existsSync(backup)) throw new Error('backup not written — refusing to write');
say(`backup written: ${backup}`);

const strip = (d: Record<string, unknown>) => { const { archivedAt: _a, updatedAt: _u, ...k } = d; return stable(conv(k)); };
const cdBefore = [C_ID, D_ID].map((id) => strip(tplDoc.get(id)!.data()));
const cdSessionsBefore = sesSnap.docs.filter((d) => [C_ID, D_ID].includes(d.get('templateId'))).map((d) => d.id).sort();
const batch = db.batch();
for (const d of tplWrites) batch.set(user.collection('workoutTemplates').doc(d.id), { ...d.body, createdAt: tplDoc.get(d.id)?.get('createdAt') ?? Timestamp.fromDate(now), updatedAt: FieldValue.serverTimestamp() });
for (const id of toArchive) batch.update(user.collection('workoutTemplates').doc(id), { archivedAt: Timestamp.fromDate(now), updatedAt: FieldValue.serverTimestamp() });
if (planWrite) batch.update(user, { travelPeriods: periodsAfter });
await batch.commit();

const cdAfter = await Promise.all([C_ID, D_ID].map((id) => user.collection('workoutTemplates').doc(id).get()));
const cdSessionsAfter = (await user.collection('workoutSessions').where('templateId', 'in', [C_ID, D_ID]).get()).docs.map((d) => d.id).sort();
say(`Travel C/D archived: ${cdAfter.map((d) => `${d.id} ${d.get('archivedAt') ? 'yes' : 'NO'}`).join(', ')}; content otherwise unchanged: ${cdAfter.every((d, i) => strip(d.data()!) === cdBefore[i])}; their sessions still present: ${JSON.stringify(cdSessionsAfter)} (before ${JSON.stringify(cdSessionsBefore)})`);
say('written.');
process.exit(0);
