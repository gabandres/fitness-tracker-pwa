/**
 * Owner data, requested 2026-11-23 (America/Puerto_Rico): review of the 11/23
 * Leg Day (v2.4 re-entry), the v2.4 template fixes, and 11/23's breakfast.
 *
 * What the read found (2026-11-23, `scripts/user-state.mts` + a full read of
 * templates, sessions and the catalog):
 *
 *   Session    xjcuEXssMncY9EOLMIhA, Leg Day, completed, 53 min, re-entry
 *              `post-travel` (−10 %, RIR 2). Its `templateVersion` is `v2`
 *              and STAYS: that field is the session's program-DRAFT marker
 *              (`v1` | `v2`, core `WorkoutSession.templateVersion`; the mapper
 *              drops anything else and Finish compares it to the active
 *              draft). The program version "v2.4" lives on the TEMPLATE, where
 *              it is already stored; the session note now opens with it.
 *              Zone 2: no v2.4 template has a cardio block and the session's
 *              cardio is empty, so nothing expects or flags one (checked
 *              below). Smith 30 / leg extension 90: a re-entry session is
 *              never read by the engine, so it raises no regression (stored).
 *   Leg        leg extension 90 → 100 for Mon 11/30; cues: RDL "40 only when
 *              both sets reach 12 at RIR 2", incline "22.5 if available", leg
 *              curl "raise at ≥ 15 on both clusters". Smith 35, RDL 35,
 *              incline 20, row 40, curl 100, calf 30, leg raise 0: stored.
 *   Calf       "left leg first; match the left-leg reps on the right" on the
 *              single-leg calf raise, all three days.
 *   Pull       chest-supported row 35 → 40. The calf already sits after the
 *              seated leg curl and before the abs: the app holds 3 per
 *              superset (core `MAX_SUPERSET_SIZE`), so E4 runs as the next row
 *              at 15 s; a cue now says so.
 *   Abs        Weighted Floor Crunch → NEW Weighted Hollow-Body Extension (DB)
 *              (own catalog lift, own history), Pull 1 cluster, Push 2
 *              (superset A2 kept), RIR 1, 8–12, start 5 lb (5–10 in the cue),
 *              baseline pending. Alternatives: NEW Ab Wheel Rollout
 *              (kneeling), the home "Cable Crunches" (kneeling, its history),
 *              Weighted Floor Crunch (its history).
 *   Archived   Travel B/C/D, C+D carryover, Haven 1/2, the 11/16 short session
 *              and the Airbnb one-off are archived (stored). Travel A stays
 *              ACTIVE (owner, 2026-11-23): the 12/02 and 12/05 notes use it.
 *   Week       the `volumeOk` waiver 11/19 → 12/06 is stored; the re-entry
 *              rules (legs −10 % RIR 2; upper −5 %, normal effort) are stored;
 *              the 11/26 check-in is stored. Nothing written for those.
 *   11/23      breakfast logged 425/50 (the user's total; the parts add to
 *              423), day open. Weight 152.6 stored, note added. Pancake 167 g
 *              used: the batch note says 2 left and its Quick add goes. One
 *              new Quick add.
 *
 * No steps, no targets, no maintenance inputs (ADR-0024). Dry run unless
 * `--apply`; every touched doc is backed up first; a re-run plans nothing.
 *
 *   npx jiti scripts/owner-data-2026-11-23-leg-review.mts [--apply]
 */
import { Timestamp, type DocumentData, type DocumentReference, type DocumentSnapshot } from 'firebase-admin/firestore';
import type { Exercise, TemplateExercise, WorkoutSession } from '../packages/core/src/workout.ts';
import {
  checkInReading,
  dumbbellStepLb,
  homePlanOf,
  MIDNIGHT,
  recommendOptionsFor,
  reentryFor,
  reentryLoad,
  reentryRuleFor,
  sessionCall,
  toExerciseDoc,
  toWorkoutExercise,
  toWorkoutSession,
  toWorkoutTemplate,
  travelPeriodsOf,
  volumeBetween,
  volumeWaiver,
} from '../packages/core/src/index.ts';
import { at, CODEC, hm, open } from './lib/user-data.mts';

const OWNER = 'gabrielandresbermudez@gmail.com';
const DAY = '2026-11-23';
const s = await open('owner-data-2026-11-23-leg-review');
const owner = await s.user(OWNER);
const now = new Date();
const stamp = now.toISOString();

const LEG = 'quxwARQlCnItzpLJgcr4';
const PULL = 'aliWJBD2FND6mU9foLdC';
const PUSH = 'Nx1bxeRuH6bMnGgX7Trv';
const SESSION = 'xjcuEXssMncY9EOLMIhA';
const EX = {
  smith: 'eKW1qiIDpvfnSECIxSUn', rdl: 'vtSvqglnBZdM1f3qOJi4', incline: 'ngF9959fQPGTYUHXpigC', row: 'acs1BlQvTZdL97i5jXJv',
  legExt: 'hXvPQM7Dv6YvScYW7h2l', legCurl: 'jZWYnikrGcdRG1adHXJ0', calf: 'm5E72J63gVXltnQ0zC8f', legRaise: 'jMGQm6C9I6HNNPXPYYLM',
  crunch: 'x3G0Speg04GclIOdKHAl', cableCrunch: 'ZbqFgySCReblO9c9IJpH',
};
const HOLLOW = { id: 'home-weighted-hollow-body-ext', name: 'Weighted Hollow-Body Extension (DB)' };
const WHEEL = { id: 'home-ab-wheel-rollout-kneeling', name: 'Ab Wheel Rollout (kneeling)' };

const stable = (v: unknown): string => {
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v).filter((k) => (v as Record<string, unknown>)[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${stable((v as Record<string, unknown>)[k])}`).join(',')}}`;
  return JSON.stringify(v);
};
const json = <T,>(v: T): T => JSON.parse(JSON.stringify(v));

const [profile, exSnap, sesSnap, tplSnap] = await Promise.all([
  owner.get(), owner.collection('exercises').get(), owner.collection('workoutSessions').get(), owner.collection('workoutTemplates').get(),
]);

// ── A. the 11/23 session ──
const SESSION_NOTE =
  'Program v2.4. First v2.4 session after 3.5 weeks. No regression: RDL 35 × 10/10 @RIR 1 (was 8/8 @0), seated leg curl 100 × 12/11 (was 10/8), hanging leg raise 9 (was 7). User went to failure on most isolation sets (plan was RIR 2); accepted. Calves L 15 / R 20: left leg first from now on.';
const ses = sesSnap.docs.find((d) => d.id === SESSION);
if (!ses) s.problem(`session ${SESSION} is gone`);
else {
  const sd = ses.data();
  if (sd['templateId'] !== LEG || sd['status'] !== 'completed' || sd['durationMin'] !== 53 || sd['reentry'] !== 'post-travel' || sd['reentryRule']?.loadPct !== 10 || sd['reentryRule']?.rir !== 2) {
    s.problem(`session ${SESSION} is not the completed 53-min Leg Day re-entry (−10 %, RIR 2) that was read`);
  } else if (sd['templateVersion'] !== 'v2') s.problem(`session ${SESSION} templateVersion is ${sd['templateVersion']}, not the v2 that was read`);
  else if ((sd['cardio'] ?? []).length) s.problem(`session ${SESSION} now has cardio`);
  else if (sd['sessionNote'] !== SESSION_NOTE) {
    if (sd['sessionNote'] != null) s.problem(`session ${SESSION} already has a different note: ${sd['sessionNote']}`);
    else if (SESSION_NOTE.length > 500) s.problem(`session note is ${SESSION_NOTE.length} characters (max 500)`);
    else s.update(ses, { sessionNote: SESSION_NOTE }, `session ${SESSION} (11/23 Leg Day) + sessionNote · status, 53 min and re-entry flags unchanged`);
  }
}
s.note('session templateVersion stays "v2" (the draft marker, `v1`|`v2` only); "v2.4" is the template\'s, and the note opens with it');

// ── catalog: two new lifts ──
const catalogDocs = new Map(exSnap.docs.map((d) => [d.id, d]));
const NEW_LIFTS = [
  { ...HOLLOW, muscles: ['core'] as const, effortStandard: 'rir1' as const },
  { ...WHEEL, muscles: ['core'] as const, effortStandard: 'rir1' as const },
];
const created: Exercise[] = [];
for (const l of NEW_LIFTS) {
  const have = catalogDocs.get(l.id);
  if (have) { if (have.get('name') !== l.name) s.problem(`exercises/${l.id} exists as "${have.get('name')}"`); continue; }
  if (exSnap.docs.some((d) => String(d.get('name')).toLowerCase() === l.name.toLowerCase())) { s.problem(`another catalog lift is named "${l.name}"`); continue; }
  const doc = toExerciseDoc({ name: l.name, muscles: [...l.muscles], logStyle: 'weight-reps', effortStandard: l.effortStandard, category: 'core' }, CODEC, now);
  s.set(owner.collection('exercises').doc(l.id), doc as DocumentData, `CATALOG + "${l.name}" (${l.id}) · core · RIR 1`);
  created.push(toWorkoutExercise(l.id, json(doc) as unknown as Record<string, unknown>));
}
for (const id of [EX.crunch, EX.cableCrunch, EX.calf]) if (!catalogDocs.has(id)) s.problem(`catalog lift ${id} is gone`);

// ── B/C. the three templates ──
type Row = TemplateExercise & Record<string, unknown>;
const tplDoc = (id: string) => tplSnap.docs.find((d) => d.id === id);
const FAIL_RIR1 = 'RIR 1 — stop 1 rep short';
const CALF_SIDES = 'L then R back to back, 0–15 s between (the other leg rests).';
const CALF_LEFT = 'Left leg first; match the left-leg reps on the right.';
const CALF_E4 = 'Block E, 4th: right after the seated leg curl (15 s), before the abs — the app holds 3 per superset, so it runs as the next row.';
const RDL_CUE = 'Next: 35 lb. Go to 40 only when both sets reach 12 at RIR 2.';
const INCLINE_CUE = '20 lb; 22.5 if the rack has it.';
const CURL_CUE = 'Raise the load when the activation is ≥ 15 on both clusters.';
const HOLLOW_CUES = [
  FAIL_RIR1,
  'Tuck → reach the DB overhead while the legs extend above the floor → pull back in; lower back stays on the floor.',
  '8–12 reps. Start 5–10 lb.',
  'Baseline pending — new lift (v2.4 abs swap, 2026-11-23): the first normal session sets it.',
];
const WHY = (what: string) => `Owner, ${DAY}: ${what}`;

/** Add a cue after `after` (or at the end) if it is not there. */
const withCue = (cues: string[] | undefined, cue: string, after?: string): string[] => {
  const c = [...(cues ?? [])];
  if (c.includes(cue)) return c;
  const i = after ? c.indexOf(after) : -1;
  if (i >= 0) c.splice(i + 1, 0, cue); else c.push(cue);
  return c;
};
const withLoad = (r: Row, to: number, reason: string): Row =>
  r.targetLoad === to ? r : { ...r, targetLoad: to, loadLog: [...(r.loadLog ?? []), { at: stamp, from: r.targetLoad, to, by: 'prompt', reason }] } as Row;
const cluster = (n: number) => Array.from({ length: n }, (_, i) => [
  { kind: 'activation' as const, group: i + 1, reps: 8, repsMax: 12 },
  { kind: 'mini' as const, group: i + 1 },
  { kind: 'mini' as const, group: i + 1 },
]).flat();
/** The crunch row becomes the hollow-body row; superset place and rest are kept. */
const hollowFor = (crunch: Row, clusters: number): Row => {
  const keep = ['supersetGroup', 'pairPosition', 'transitionRestSec', 'roundRestSec', 'minClusterRestSec', 'restAfterSec', 'restAfterMaxSec', 'restClusterSec'];
  const kept = Object.fromEntries(keep.filter((k) => crunch[k] !== undefined).map((k) => [k, crunch[k]]));
  return {
    ...kept,
    exerciseId: HOLLOW.id, name: HOLLOW.name, logStyle: 'weight-reps', targetLoad: 5,
    cues: HOLLOW_CUES, plannedSets: cluster(clusters),
    progression: { targetReps: 12, holdSessions: 2, incrementLb: 5 },
    alternatives: [
      { exerciseId: WHEEL.id, name: WHEEL.name, targetLoad: 0, note: 'first alternative' },
      { exerciseId: EX.cableCrunch, name: 'Cable Crunches', note: 'kneeling, rope — its own history' },
      { exerciseId: EX.crunch, name: 'Weighted Floor Crunch', targetLoad: crunch.targetLoad, note: 'keeps its history' },
    ],
    loadLog: [{ at: stamp, to: 5, by: 'prompt', reason: WHY('v2.4 abs swap — Weighted Floor Crunch → Weighted Hollow-Body Extension (DB), start 5–10 lb') }],
  } as Row;
};

const EDITS: Record<string, { name: string; line: string; rows: (rows: Row[]) => Row[]; check: (rows: Row[]) => string | null }> = {
  [LEG]: {
    name: 'Leg Day',
    line: `${DAY} - 11/23 re-entry reviewed: no regression. Mon 11/30, normal effort: Smith 35 · RDL 35 (40 only when both sets reach 12 at RIR 2) · Incline 20 (22.5 if available) · Row 40 · Leg extension 90 → 100 · Seated leg curl 100 (raise at ≥ 15 on both clusters) · Calf 30, left leg first · Hanging leg raise bodyweight.`,
    rows: (rows) => rows.map((r) => {
      if (r.exerciseId === EX.legExt) return withLoad(r, 100, WHY('next Leg Day (11/30, normal effort) at 100; 90 on 11/23 was the planned re-entry cut'));
      if (r.exerciseId === EX.rdl) return { ...r, cues: withCue(r.cues, RDL_CUE) };
      if (r.exerciseId === EX.incline) return { ...r, cues: withCue(r.cues, INCLINE_CUE) };
      if (r.exerciseId === EX.legCurl) return { ...r, cues: withCue(r.cues, CURL_CUE) };
      if (r.exerciseId === EX.calf) return { ...r, cues: withCue(r.cues, CALF_LEFT, CALF_SIDES) };
      return r;
    }),
    check: (rows) => {
      const want: [string, number[]][] = [[EX.smith, [35]], [EX.rdl, [35]], [EX.incline, [20]], [EX.row, [40]], [EX.legExt, [90, 100]], [EX.legCurl, [100]], [EX.calf, [30]], [EX.legRaise, [0]]];
      for (const [id, loads] of want) {
        const r = rows.find((x) => x.exerciseId === id);
        if (!r) return `Leg Day has no row ${id}`;
        if (!loads.includes(r.targetLoad ?? -1)) return `Leg Day ${r.name} is ${r.targetLoad}, not ${loads.join(' or ')}`;
      }
      return null;
    },
  },
  [PULL]: {
    name: 'Pull Day',
    line: `${DAY} - Chest-supported DB row 35 → 40. Abs: Weighted Floor Crunch → Weighted Hollow-Body Extension (DB) 1 cluster, RIR 1, 8–12, start 5–10 lb, baseline pending; alts Ab Wheel Rollout (kneeling) · Cable Crunches (kneeling) · Weighted Floor Crunch (its history). E: leg ext → lateral raise → seated leg curl → calf (E4, next row, 15 s) → abs. Calf: left leg first.`,
    rows: (rows) => rows.map((r) => {
      if (r.exerciseId === EX.row) return withLoad(r, 40, WHY('Pull Day chest-supported DB row 35 → 40 (the Leg Day load)'));
      if (r.exerciseId === EX.calf) return { ...r, cues: withCue(withCue(r.cues, CALF_LEFT, CALF_SIDES), CALF_E4, CALF_LEFT) };
      if (r.exerciseId === EX.crunch) return hollowFor(r, 1);
      return r;
    }),
    check: (rows) => {
      const ids = rows.map((r) => r.exerciseId);
      const curl = ids.indexOf(EX.legCurl), calf = ids.indexOf(EX.calf), abs = ids.findIndex((x) => x === EX.crunch || x === HOLLOW.id);
      if (curl < 0 || calf < 0 || abs < 0) return 'Pull Day is missing the leg curl, the calf or the abs row';
      if (!(curl < calf && calf < abs)) return `Pull Day order is not leg curl → calf → abs (${curl}, ${calf}, ${abs})`;
      if (rows[curl].supersetGroup !== 'E') return 'the Pull Day leg curl is not in block E';
      const row = rows.find((r) => r.exerciseId === EX.row)!;
      if (![35, 40].includes(row.targetLoad ?? -1)) return `Pull Day row is ${row.targetLoad}, not 35 or 40`;
      const ab = rows[abs];
      if (ab.exerciseId === EX.crunch && (ab.plannedSets?.filter((p) => p.kind === 'activation').length ?? 0) !== 1) return 'the Pull Day crunch is not 1 cluster';
      return null;
    },
  },
  [PUSH]: {
    name: 'Push Day',
    line: `${DAY} - Abs: A2 Weighted Floor Crunch → Weighted Hollow-Body Extension (DB) 2 clusters, RIR 1, 8–12, start 5–10 lb, baseline pending; superset A with the flat press kept; alts Ab Wheel Rollout (kneeling) · Cable Crunches (kneeling) · Weighted Floor Crunch (its history). Calf: left leg first. One-arm overhead DB extension starts at 15, baseline pending.`,
    rows: (rows) => rows.map((r) => {
      if (r.exerciseId === EX.calf) return { ...r, cues: withCue(r.cues, CALF_LEFT, CALF_SIDES) };
      if (r.exerciseId === EX.crunch) return hollowFor(r, 2);
      return r;
    }),
    check: (rows) => {
      const ab = rows.find((r) => r.exerciseId === EX.crunch || r.exerciseId === HOLLOW.id);
      if (!ab) return 'Push Day has no abs row';
      if (ab.supersetGroup !== 'A' || ab.pairPosition !== 2) return 'the Push Day abs row is not A2';
      if (ab.exerciseId === EX.crunch && (ab.plannedSets?.filter((p) => p.kind === 'activation').length ?? 0) !== 2) return 'the Push Day crunch is not 2 clusters';
      const oh = rows.find((r) => r.exerciseId === 'home-one-arm-oh-db-ext');
      if (!oh || oh.targetLoad !== 15) return `Push Day one-arm overhead extension is ${oh?.targetLoad}, not 15`;
      return null;
    },
  },
};

const planned = new Map<string, Record<string, unknown>>();
for (const [id, edit] of Object.entries(EDITS)) {
  const doc = tplDoc(id);
  if (!doc) { s.problem(`${edit.name} template ${id} is gone`); continue; }
  const data = doc.data() as Record<string, unknown>;
  planned.set(id, data);
  if (data['templateVersion'] !== 'v2.4' || data['archivedAt'] != null) { s.problem(`${edit.name} is not the active v2.4 template that was read`); continue; }
  if (((data['cardioBlocks'] as unknown[]) ?? []).length) { s.problem(`${edit.name} has a cardio block (Zone 2 is not part of v2.4)`); continue; }
  const rows = json(data['exercises'] as Row[]);
  const bad = edit.check(rows);
  if (bad) { s.problem(bad); continue; }
  const next = edit.rows(rows).map((r, i) => (stable(r) === stable(rows[i]) ? rows[i] : { ...r, lastModifiedAt: stamp, lastModifiedBy: 'prompt' }));
  const notes = String(data['notes'] ?? '');
  const nextNotes = notes.includes(edit.line) ? notes : `${notes}\n\n${edit.line}`;
  if (nextNotes.length > 10_000) { s.problem(`${edit.name} notes would be ${nextNotes.length} characters (max 10,000)`); continue; }
  const changed = next.map((r, i) => (r === rows[i] ? null : rows[i].exerciseId === r.exerciseId ? r.name : `${rows[i].name} → ${r.name}`)).filter(Boolean);
  // What the app will read once written (for the guards below).
  planned.set(id, { ...data, exercises: next, notes: nextNotes });
  if (changed.length || nextNotes !== notes) {
    s.update(doc, { exercises: json(next), notes: nextNotes, updatedAt: Timestamp.fromDate(now) }, `${edit.name}: ${changed.join(' · ') || '—'}${nextNotes !== notes ? ' · + notes line' : ''}`);
  }
}

// ── archived templates (read only; Travel A stays active, owner 2026-11-23) ──
const SHOULD_BE_ARCHIVED = ['travel-b-full-body', 'travel-gym-c', 'travel-gym-d', 'travel-cd-carryover-2026-11-05', 'travel-haven-1', 'travel-haven-2', 'travel-short-2026-11-16', 'travel-airbnb-2026-11-17'];
const archiveLines: string[] = [];
for (const id of SHOULD_BE_ARCHIVED) {
  const d = tplDoc(id);
  if (!d) { s.problem(`template ${id} is gone`); continue; }
  if (d.get('archivedAt') == null) s.problem(`${d.get('name')} is not archived`);
  const n = sesSnap.docs.filter((x) => x.get('templateId') === id).length;
  archiveLines.push(`${d.get('name')} — archived ${(d.get('archivedAt') as Timestamp).toDate().toISOString().slice(0, 10)}, ${n} session(s) kept`);
}
const travelA = tplDoc('travel-a-full-body');
if (!travelA || travelA.get('archivedAt') != null) s.problem('Travel A is not the active template that was read');
for (const l of archiveLines) s.note(`archived (read only): ${l}`);
s.note('Travel A — Full Body stays ACTIVE (owner, 2026-11-23): the 12/02 and 12/05 notes point to it');

// ── D. this week: what the app will do (guards, read only) ──
const periods = travelPeriodsOf(profile.data() ?? {});
for (const d of ['2026-11-23', '2026-11-25', '2026-11-27', '2026-11-29']) if (!volumeWaiver(periods, d)) s.problem(`no volume waiver on ${d}`);
const catalog: Exercise[] = [...exSnap.docs.map((d) => toWorkoutExercise(d.id, d.data())), ...created];
const catOf = (id: string) => catalog.find((c) => c.id === id);
const dbStep = dumbbellStepLb(profile.get('dumbbellHalfSteps') as boolean | undefined);
const engineCat = (id: string) => { const c = catOf(id); return c ? { ...c, dumbbellStepLb: dbStep } : null; };
const sessions: WorkoutSession[] = sesSnap.docs.map((d) => toWorkoutSession(d.id, d.data()));
const completed = sessions.filter((x) => x.status === 'completed').sort((x, y) => y.date.getTime() - x.date.getTime());
const travelIds = new Set(tplSnap.docs.filter((d) => String(d.get('templateVersion') ?? '').startsWith('travel')).map((d) => d.id));
const bolivia = periods.find((p) => p.start === '2026-10-31') ?? null;

const seedPlan = (id: string, day: string, want: { kind: string | null; loadPct?: number; rir?: number | null }): string[] => {
  const data = planned.get(id);
  const doc = tplDoc(id);
  if (!data || !doc) return [];
  const kind = reentryFor({ templateId: id, today: day, sessions, periods, travelTemplateIds: travelIds, templateCreatedAt: (doc.get('createdAt') as Timestamp | undefined)?.toDate(), boundary: MIDNIGHT });
  const rule = kind ? reentryRuleFor(kind, id, bolivia) : null;
  const t = toWorkoutTemplate(id, data);
  if ((kind ?? null) !== want.kind || (rule && (rule.loadPct !== want.loadPct || (rule.rir ?? null) !== want.rir))) {
    s.problem(`${t.name} on ${day}: the app gives ${kind ?? 'a normal session'}${rule ? ` −${rule.loadPct}% ${rule.rir != null ? `RIR ${rule.rir}` : 'normal effort'}` : ''}, not ${want.kind ?? 'a normal session'}`);
    return [];
  }
  const out = [`${t.name} ${day} · ${rule ? `${kind} re-entry: −${rule.loadPct}% loads, ${rule.rir != null ? `RIR ${rule.rir}` : 'normal effort'}` : 'normal session'}`];
  for (const r of t.exercises) {
    const call = sessionCall(r, completed, engineCat(r.exerciseId));
    const engine = call.rec.action !== 'none' && call.rec.load != null ? call.rec.load : null;
    const seed = engine ?? r.targetLoad ?? 0;
    const { config } = recommendOptionsFor(r, engineCat(r.exerciseId));
    const step = { loadSteps: config?.loadSteps, stepLb: config?.stepLb ?? 5, loadGrid: config?.loadGrid, assisted: catOf(r.exerciseId)?.assisted === true };
    const load = rule ? reentryLoad(seed, step, 1 - rule.loadPct / 100, rule.round) : seed;
    const clusters = r.plannedSets?.filter((p) => p.kind === 'activation' || p.kind === 'working').length ?? 0;
    const engineSays = engine != null && engine !== r.targetLoad ? ` (engine ${call.rec.action} ${engine}; template ${r.targetLoad})` : '';
    out.push(`  ${r.supersetGroup ? `${r.supersetGroup}${r.pairPosition} ` : ''}${r.name}: ${clusters} × · ${seed === 0 ? 'bodyweight' : rule ? `${seed} → ${load} lb` : `${load} lb`}${engineSays}`);
  }
  return out;
};
const weekPlan = [
  ...seedPlan(PULL, '2026-11-25', { kind: 'post-travel', loadPct: 5, rir: null }),
  ...seedPlan(PUSH, '2026-11-27', { kind: 'post-travel', loadPct: 5, rir: null }),
  ...seedPlan(LEG, '2026-11-30', { kind: null }),
];
for (const l of weekPlan) s.note(`(read only) ${l}`);

// ── E. 11/23 meals, weigh-in, pancakes, Quick add ──
const dayRows = async (user: DocumentReference, day: string) => (await user.collection('dailyLogs')
  .where('timestamp', '>=', Timestamp.fromDate(at(day, '00:00')))
  .where('timestamp', '<', Timestamp.fromDate(new Date(at(day, '00:00').getTime() + 86_400_000)))
  .orderBy('timestamp').get()).docs;

const WEIGHT_NOTE = 'post-trip water clearing (154.8 → 154.0 → 152.6)';
const w = await owner.collection('dailyWeights').doc(DAY).get();
if (!w.exists || w.get('weight') !== 152.6) s.problem(`dailyWeights/${DAY} is ${w.exists ? w.get('weight') : 'absent'}, not the 152.6 that was read`);
else if (w.get('note') !== WEIGHT_NOTE) {
  if (w.get('note') != null) s.problem(`dailyWeights/${DAY} already has a different note: ${w.get('note')}`);
  else s.update(w, { note: WEIGHT_NOTE }, `dailyWeights/${DAY} 152.6 lb (already stored) + note`);
}

const BREAKFAST = {
  day: DAY, time: '09:30', slot: 'breakfast' as const, label: 'Pancake + 1 egg + Canadian bacon', kcal: 425, protein: 50,
  note: 'Build C pancake 167 g 293/34 (batch 2026-11-21, 1.754 kcal/g, 0.202 g protein/g) · 1 large egg 70/6 · Jones Canadian bacon 3 slices 60/10. No butter or syrup.',
};
const rows = await dayRows(owner, DAY);
const have = rows.find((d) => d.get('mealLabel') === BREAKFAST.label);
if (!have) s.logMeal(owner, BREAKFAST);
else if (have.get('calories') !== BREAKFAST.kcal || have.get('protein') !== BREAKFAST.protein) s.problem(`${DAY} already has "${BREAKFAST.label}" as ${have.get('calories')}/${have.get('protein')}`);
const strangers = rows.filter((d) => d.get('mealLabel') !== BREAKFAST.label);
if (strangers.length) s.problem(`${DAY} has rows that were not there when it was read: ${strangers.map((d) => `"${d.get('mealLabel')}" ${d.get('calories')}/${d.get('protein') ?? 0}`).join(', ')}`);
s.markDay(await owner.collection('dailyLogged').doc(DAY).get(), null);

const presets = (await owner.collection('presets').get()).docs;
const QUICK = { name: 'Pancake (167 g) + 1 egg + 3 Canadian bacon', calories: 425, protein: 50 };
const q = presets.find((d) => d.get('name') === QUICK.name);
if (!q) s.saveMeal(owner, 'quickAdd', QUICK);
else if (q.get('calories') !== QUICK.calories || q.get('protein') !== QUICK.protein) s.problem(`Quick add "${QUICK.name}" exists as ${q.get('calories')}/${q.get('protein')}`);
const EATEN = { name: 'Pancake 167 g (Build C, 11/21 batch)', calories: 293, protein: 34 };
const eaten = presets.filter((d) => d.get('name') === EATEN.name);
if (eaten.length > 1) s.problem(`${eaten.length} Quick adds are named "${EATEN.name}"`);
else if (eaten[0]) {
  if (eaten[0].get('calories') !== EATEN.calories || eaten[0].get('protein') !== EATEN.protein) s.problem(`Quick add "${EATEN.name}" is ${eaten[0].get('calories')}/${eaten[0].get('protein')}`);
  else s.remove(eaten[0], `REMOVE Quick add "${EATEN.name}" ${EATEN.calories}/${EATEN.protein} (eaten 11/23 breakfast)`);
}
for (const g of [196, 216]) if (!presets.some((d) => d.get('name') === `Pancake ${g} g (Build C, 11/21 batch)`)) s.problem(`the "Pancake ${g} g" Quick add is gone`);

const FRIDGE_WAS = 'Build C pancakes — 3 left, good through Wed 11/25';
const FRIDGE = {
  from: '2026-11-21', to: '2026-11-25', label: 'Build C pancakes — 2 left, good through Wed 11/25',
  note: 'Batch 11/21: 4 pancakes · 704 g cooked · 1,235 kcal / 142 g = 1.754 kcal/g · 0.202 g protein/g. Used: 125 g (11/22) · 167 g (11/23). Left: 196 g 344/40 · 216 g 379/44 (Quick add, one each).',
};
const stored = profile.get('homePlan') as Record<string, unknown> | undefined;
const plan = homePlanOf({ homePlan: stored });
if (!stored || !plan?.notes) s.problem('profile.homePlan has no notes: not the plan that was read');
else if (stable(stored) !== stable(plan)) s.problem('profile.homePlan holds something core `homePlanOf` drops: not the plan that was read');
else if (plan.weightQuietUntil !== '2026-12-10') s.problem(`weightQuietUntil is ${plan.weightQuietUntil}, not the 2026-12-10 that was read (covers "no weight alerts before 11/26")`);
else if (plan.checkIn?.date !== '2026-11-26' || plan.checkIn.baseline.weightLb !== 151.8 || plan.checkIn.baseline.waistIn !== 31.25 || plan.checkIn.baseline.neckIn !== 14.5) s.problem('the 11/26 check-in is not the one that was read');
else {
  const fridge = plan.notes.find((n) => n.from === FRIDGE.from && n.to === FRIDGE.to && (n.label === FRIDGE_WAS || n.label === FRIDGE.label));
  if (!fridge) s.problem(`home-plan note "${FRIDGE_WAS}" is gone`);
  else if (FRIDGE.note.length > 300) s.problem(`pancake note is ${FRIDGE.note.length} characters (max 300)`);
  else {
    const next = homePlanOf({ homePlan: { ...plan, notes: plan.notes.map((n) => (n === fridge ? FRIDGE : n)) } })!;
    if (!next.notes!.some((n) => n.note === FRIDGE.note)) s.problem('core `homePlanOf` dropped or cut the pancake note');
    else if (stable(next) !== stable(plan)) s.update(profile as DocumentSnapshot, { homePlan: json(next) }, `homePlan: "${FRIDGE.label}" (167 g used 11/23) — ${next.notes!.length} notes`);
  }
}
s.note('already stored, not rewritten: weightQuietUntil 2026-12-10 · the 11/26 tape + photo check-in vs 10/30 · the volume waiver 11/19 → 12/06 · the re-entry rules · steps are not read or written');

await s.run({
  report: async () => {
    const docs = await dayRows(owner, DAY);
    const kcal = docs.reduce((n, d) => n + (d.get('calories') ?? 0), 0);
    const protein = docs.reduce((n, d) => n + (d.get('protein') ?? 0), 0);
    const flag = await owner.collection('dailyLogged').doc(DAY).get();
    const wt = await owner.collection('dailyWeights').doc(DAY).get();
    console.log(`\n${DAY}: ${docs.length} row(s) = ${kcal} kcal / ${protein} g · fully logged: ${flag.exists ? flag.get('complete') : 'open'} · weigh-in: ${wt.exists ? `${wt.get('weight')} lb ("${wt.get('note') ?? ''}")` : '—'}`);
    for (const d of docs) console.log(`  ${hm((d.get('timestamp') as Timestamp).toDate()).slice(7)} ${String(d.get('mealType')).padEnd(9)} "${d.get('mealLabel')}" ${d.get('calories')}/${d.get('protein') ?? 0}`);
    const all = (await owner.collection('presets').get()).docs;
    console.log(`\nPancake Quick adds:\n  ${all.filter((d) => /Pancake/.test(String(d.get('name')))).map((d) => `"${d.get('name')}" ${d.get('calories')}/${d.get('protein')}`).join('\n  ')}`);
    const p = (await owner.get()).data() ?? {};
    const hp = homePlanOf(p);
    console.log(`\npancake note: ${hp?.notes?.find((n) => n.from === FRIDGE.from && n.to === FRIDGE.to && n.label.startsWith('Build C pancakes —'))?.label}`);
    const ws = (await owner.collection('dailyWeights').where('__name__', '>=', '2026-11-20').get()).docs;
    const weights = Object.fromEntries(ws.map((d) => [d.id, Number(d.get('weight'))]));
    const reading = hp?.checkIn ? checkInReading(hp.checkIn, DAY, weights, [], MIDNIGHT) : null;
    console.log(`check-in so far (core checkInReading, 7 days to ${DAY}): ${JSON.stringify(weights)} → avg ${reading?.avgWeightLb} over ${reading?.weighIns} weigh-ins vs 151.8 → ${reading?.weightDelta}`);
    const ss = (await owner.collection('workoutSessions').get()).docs.map((d) => toWorkoutSession(d.id, d.data()));
    const cat = (await owner.collection('exercises').get()).docs.map((d) => toWorkoutExercise(d.id, d.data()));
    const vol = volumeBetween(ss, cat, at(DAY, '00:00').getTime(), Date.now());
    console.log(`week of 11/23 so far (core volumeBetween, direct clusters): ${vol.week.filter((m) => m.direct > 0).map((m) => `${m.muscle} ${m.direct}`).join(' · ')} · waiver: ${volumeWaiver(travelPeriodsOf(p), DAY)?.label ?? 'none'}`);
    const se = (await owner.collection('workoutSessions').doc(SESSION).get()).data() ?? {};
    console.log(`\nsession ${SESSION}: ${se['templateName']} · ${se['status']} · ${se['durationMin']} min · templateVersion ${se['templateVersion']} · reentry ${se['reentry']} (${se['reentryRule']?.label}) · cardio ${(se['cardio'] ?? []).length}\n  note: ${se['sessionNote']}`);
    for (const id of [PULL, PUSH, LEG]) {
      const t = (await owner.collection('workoutTemplates').doc(id).get()).data()!;
      console.log(`\n${t['name']} (${t['templateVersion']}):`);
      for (const r of t['exercises'] as Row[]) {
        const n = r.plannedSets?.filter((x) => x.kind === 'activation' || x.kind === 'working').length ?? 0;
        const extra = r.exerciseId === HOLLOW.id ? ` · alts: ${(r.alternatives ?? []).map((a) => a.name).join(' → ')}` : '';
        const cue = r.exerciseId === EX.calf || [RDL_CUE, INCLINE_CUE, CURL_CUE].some((c) => r.cues?.includes(c)) ? ` · cues: ${(r.cues ?? []).filter((c) => [CALF_LEFT, CALF_E4, RDL_CUE, INCLINE_CUE, CURL_CUE].includes(c)).join(' | ')}` : '';
        console.log(`  ${r.supersetGroup ? `${r.supersetGroup}${r.pairPosition}` : '  '} ${r.name}: ${n} × · ${r.targetLoad ?? '—'} lb${extra}${cue}`);
      }
    }
    console.log(`\n${weekPlan.join('\n')}`);
  },
});
