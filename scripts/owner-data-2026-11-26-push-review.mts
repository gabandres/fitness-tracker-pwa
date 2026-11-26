/**
 * Owner data, requested 2026-11-26 (America/Puerto_Rico): annotate the 11/26
 * Push Day (done Thursday, not Friday), relabel the three v2.4 sessions, end the
 * re-entry rules, Fri 11/27 rest, the Push v2.4 loads for the next rotation,
 * the shoulder press renamed to the machine it always was, the gym equipment
 * record, and the 11/26 tape note. The other account (stph) is not opened.
 *
 * What the read found (2026-11-26, `user-state.mts` + a read of sessions,
 * templates, drafts, catalog, measurements):
 *
 *   Session 11/26 dJtZtTjgMyIlfilPuXLv Push Day, completed, 09:08, 56 min,
 *              re-entry post-travel −5 %, templateVersion `v2`, no note. Every
 *              set the request quotes is stored → + sessionNote only.
 *   v2.4       11/23 Leg xjcuEXss…, 11/25 Pull qBUEwjTE…, 11/26 Push: `v2` →
 *              templateVersion `v2.4` + programVersion `v2` (the draft marker,
 *              its own field since this change: core `sessionVersionFor`; the
 *              rules allow both from the same commit). Sets carry no version
 *              field: the export stamps each set row from its session.
 *              WHY "v2": the app wrote the Program-v2 draft marker
 *              (`templateVersionFor`: v1|v2), never the template's label.
 *   Re-entry   Bolivia's rules: legs −10 % (Leg), upper −5 % (Push only since
 *              11/25). All three done after the trip → both rules removed
 *              (`reentryFor` is already null for each; checked below). The
 *              11/23–11/26 sessions keep their own `reentry` snapshot.
 *   Home plan  "Re-entry week — Mon Leg · Wed Pull · Fri Push" (11/23–11/27) →
 *              the rotation as done, ending 11/26; + "Fri 11/27 — rest". The
 *              "Mon 11/30 — Leg Day, normal" note is stored: read only.
 *   Push v2.4  flat 25 → 30 · incline 20 → 25 · calf 30 → 35 · chest press
 *              (no load) → 70, "Trial" cue → the Paramount note, +10 lb steps,
 *              go up at 12 · shoulder press 80 activation, minis 70 by a per-set
 *              weight (`PlannedSet.weight`: the session seeds `ps.weight ??
 *              targetLoad`; progression moves only sets AT the target load, so
 *              the minis stay 70 until moved by hand — the 90/80 step is the
 *              cue) · hollow 5 (stored, Push and Pull; cue stored) · OHE 15
 *              (stored) + cue · lateral 15 (stored) + target 15 · skull 15
 *              (stored) + target 12.
 *   Rename     "Seated DB Shoulder Press" (He4o7qVW…) → "Machine Shoulder Press
 *              (Paramount)": catalog, Push row, the Program v2 draft bodies, and
 *              the row snapshot in every session that has it. The name also
 *              moves the engine's equipment from dumbbell (2.5 lb) to stack.
 *   Profile    no equipment field existed → `gymEquipment` (rules, this commit).
 *   Tape 11/26 7O82wpWk… waist 31.5 / neck 14.5, weigh-in 153.2: values read
 *              only; + `note` (rules, this commit).
 *   Archive    all nine travel templates (and none else) already archived
 *              (11/07–11/25): read only, sessions kept.
 *
 * No steps, no targets, no maintenance inputs (ADR-0024).
 * Dry run unless `--apply`; every touched doc is backed up first; a re-run plans nothing.
 *
 *   npx jiti scripts/owner-data-2026-11-26-push-review.mts [--apply]
 */
import { Timestamp } from 'firebase-admin/firestore';
import type { DocumentSnapshot } from 'firebase-admin/firestore';
import type { PlannedSet, SessionExercise, TemplateExercise, WorkoutSession } from '../packages/core/src/workout.ts';
import { MIDNIGHT, homePlanOf, reentryFor, reviewRotations, toWorkoutSession, toWorkoutTemplate, travelPeriodsOf } from '../packages/core/src/index.ts';
import { hm, open } from './lib/user-data.mts';

const OWNER = 'gabrielandresbermudez@gmail.com';
const DAY = '2026-11-26';
const s = await open('owner-data-2026-11-26-push-review');
const owner = await s.user(OWNER);
const now = new Date();
const stamp = now.toISOString();

const LEG = 'quxwARQlCnItzpLJgcr4';
const PULL = 'aliWJBD2FND6mU9foLdC';
const PUSH = 'Nx1bxeRuH6bMnGgX7Trv';
const SESSIONS = { leg: 'xjcuEXssMncY9EOLMIhA', pull: 'qBUEwjTEPy9PUERvnL5V', push: 'dJtZtTjgMyIlfilPuXLv' };
const MEASUREMENT = '7O82wpWkDZCZITa5LMZC';
const EX = {
  flat: 'ud6fE363QklE3qXYxLw3', incline: 'ngF9959fQPGTYUHXpigC', calf: 'm5E72J63gVXltnQ0zC8f', shoulder: 'He4o7qVWRftiPneaXjiV',
  chest: 'home-seated-chest-press-machine', ohe: 'home-one-arm-oh-db-ext', lateral: 'BGyAEJU6i5nN6AjXRU1g', skull: 'EyDTWnfO4WrbYDbDkxrk',
  hollow: 'home-weighted-hollow-body-ext',
};
const OLD_NAME = 'Seated DB Shoulder Press';
const NEW_NAME = 'Machine Shoulder Press (Paramount)';
const TRAVEL = ['travel-a-full-body', 'travel-airbnb-2026-11-17', 'travel-b-full-body', 'travel-cd-carryover-2026-11-05', 'travel-gym-c', 'travel-gym-d', 'travel-haven-1', 'travel-haven-2', 'travel-short-2026-11-16'];

const stable = (v: unknown): string => {
  if (v instanceof Timestamp) return JSON.stringify(v.toMillis());
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v).filter((k) => (v as Record<string, unknown>)[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${stable((v as Record<string, unknown>)[k])}`).join(',')}}`;
  return JSON.stringify(v);
};
const json = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
/** Every `{ exerciseId: shoulder, name: OLD }` anywhere in `v`, renamed. */
const renamed = (v: unknown): unknown => {
  if (Array.isArray(v)) return v.map(renamed);
  if (v instanceof Timestamp) return v;
  if (v && typeof v === 'object') {
    const o = Object.fromEntries(Object.entries(v).map(([k, x]) => [k, renamed(x)]));
    if (o['exerciseId'] === EX.shoulder && o['name'] === OLD_NAME) o['name'] = NEW_NAME;
    return o;
  }
  return v;
};

const [profile, sesSnap, tplSnap, draftSnap, shoulderEx, measurement, weight] = await Promise.all([
  owner.get(), owner.collection('workoutSessions').get(), owner.collection('workoutTemplates').get(), owner.collection('templateDrafts').get(),
  owner.collection('exercises').doc(EX.shoulder).get(), owner.collection('measurements').doc(MEASUREMENT).get(), owner.collection('dailyWeights').doc(DAY).get(),
]);
const tplDoc = (id: string) => tplSnap.docs.find((d) => d.id === id);

// ── A. sessions: the v2.4 label, the 11/26 note, the shoulder-press name ──
const SESSION_NOTE =
  'Third v2.4 session, first Push Day since 10/30. No regression. Flat press 25 × 13/13 @RIR 1. Incline 20 × 14/14 (was 11/11). Machine shoulder press 80 × 10, minis 80 × 2 then 70 × 4. Seated chest press machine first use: 70 × 10 +4 +3, good chest stretch, felt in chest. One-arm overhead extension first use: 15 × 8 each arm. Laterals 15 × 12/12 (was 11/9). Skull crusher 15 × 10. Calves 30 × 20 each leg. Hollow-body 5 lb × 8/8, hard but correct load.';
const READ: Record<string, { tpl: string; time: string; dur: number }> = {
  [SESSIONS.leg]: { tpl: LEG, time: '11/23, 08:02', dur: 53 },
  [SESSIONS.pull]: { tpl: PULL, time: '11/25, 08:32', dur: 46 },
  [SESSIONS.push]: { tpl: PUSH, time: '11/26, 09:08', dur: 56 },
};
const planned = new Map<string, WorkoutSession>();
let renamedRows = 0;
for (const d of sesSnap.docs) {
  const data = d.data();
  const patch: Record<string, unknown> = {};
  const lines: string[] = [];
  const want = READ[d.id];
  if (want) {
    if (data['templateId'] !== want.tpl || data['status'] !== 'completed' || data['durationMin'] !== want.dur || hm((data['timestamp'] as Timestamp).toDate()) !== want.time) {
      s.problem(`session ${d.id} is not the completed ${want.time} (${want.dur} min) session that was read`);
      continue;
    }
    const tv = data['templateVersion'], pv = data['programVersion'];
    if (tv === 'v2.4' && pv === 'v2') { /* done */ }
    else if (tv !== 'v2' || pv != null) s.problem(`session ${d.id} templateVersion ${tv} / programVersion ${pv}, not the v2 that was read`);
    else { patch['templateVersion'] = 'v2.4'; patch['programVersion'] = 'v2'; lines.push('templateVersion v2 → v2.4 (+ programVersion v2)'); }
  }
  if (d.id === SESSIONS.push && data['sessionNote'] !== SESSION_NOTE) {
    if (data['sessionNote'] != null) s.problem(`the 11/26 session already has a different note: ${data['sessionNote']}`);
    else if (SESSION_NOTE.length > 500) s.problem(`session note is ${SESSION_NOTE.length} characters (max 500)`);
    else { patch['sessionNote'] = SESSION_NOTE; lines.push(`+ sessionNote (${SESSION_NOTE.length} chars)`); }
  }
  const rows = data['exercises'] as SessionExercise[];
  const next = renamed(rows) as SessionExercise[];
  const n = rows.filter((r, i) => r.name !== next[i].name).length;
  if (n) { patch['exercises'] = next; renamedRows += n; lines.push(`"${OLD_NAME}" → "${NEW_NAME}"`); }
  if (Object.keys(patch).length) {
    patch['updatedAt'] = Timestamp.fromDate(now);
    s.update(d, patch, `session ${d.id} (${hm((data['timestamp'] as Timestamp).toDate())} ${data['templateName']}): ${lines.join(' · ')}`);
  }
  planned.set(d.id, toWorkoutSession(d.id, { ...data, ...patch }));
}
s.note(`shoulder-press rows renamed in history: ${renamedRows} (the Haven machine / plate-loaded presses are other lifts, left alone)`);

// ── B. the catalog and the Program v2 drafts ──
if (!shoulderEx.exists) s.problem('the shoulder-press exercise is gone');
else if (shoulderEx.get('name') === OLD_NAME) s.update(shoulderEx, { name: NEW_NAME }, `exercise ${EX.shoulder}: "${OLD_NAME}" → "${NEW_NAME}" (its default cues are left as stored)`);
else if (shoulderEx.get('name') !== NEW_NAME) s.problem(`the shoulder-press exercise is "${shoulderEx.get('name')}"`);
for (const d of draftSnap.docs) {
  const data = d.data();
  const next = renamed(data) as Record<string, unknown>;
  if (stable(next) !== stable(data)) s.update(d, { template: next['template'], ...(next['previous'] !== undefined ? { previous: next['previous'] } : {}) }, `draft ${d.id} (of ${data['draftOf']}): shoulder press renamed`);
}

// ── C. Push Day v2.4 ──
type Row = TemplateExercise & Record<string, unknown>;
const WHY = (what: string) => `Owner, ${DAY}: ${what}`;
const withLoad = (r: Row, to: number, reason: string): Row =>
  r.targetLoad === to ? r : { ...r, targetLoad: to, loadLog: [...(r.loadLog ?? []), { at: stamp, ...(r.targetLoad != null ? { from: r.targetLoad } : {}), to, by: 'prompt', reason }] } as Row;
const addCue = (cues: string[] | undefined, cue: string): string[] => ((cues ?? []).includes(cue) ? [...(cues ?? [])] : [...(cues ?? []), cue]);
const CHEST_NOTE = 'Paramount MP Series, press arm in flat (supine) position. Seat height so handles line up with mid-chest. Go to 80 lb at 12 reps.';
const SHOULDER_NOTE = 'Activation at 80. Minis at 70 by design. Go to 90/80 when the activation set reaches 12 reps.';
const OHE_CUE = 'Stay at 15 until 12 reps per arm.';
const LATERAL_CUE = 'Stay at 15 until 15 reps; then increase.';
const SKULL_CUE = 'Stay at 15 until 12 reps.';
const STACK_CUE = 'Stack moves in 10 lb steps.';
const PUSH_LINE = `${DAY} - Push 11/26: no regression, re-entry over. Next: flat 30, incline 25, calf 35, chest press 70 (kept), shoulder press = Paramount machine 80/minis 70. Cues per row.`;

const push = tplDoc(PUSH);
let pushPlanned: Record<string, unknown> | null = null;
if (!push) s.problem('Push Day is gone');
else if (push.get('templateVersion') !== 'v2.4' || push.get('archivedAt') != null) s.problem('Push Day is not the active v2.4 template that was read');
else {
  const rows = json(push.get('exercises') as Row[]);
  const want: [string, number[]][] = [[EX.flat, [25, 30]], [EX.incline, [20, 25]], [EX.calf, [30, 35]], [EX.shoulder, [80]], [EX.ohe, [15]], [EX.lateral, [15]], [EX.skull, [15]], [EX.hollow, [5]]];
  let bad = false;
  for (const [id, loads] of want) {
    const r = rows.find((x) => x.exerciseId === id);
    if (!r || !loads.includes(r.targetLoad ?? -1)) { s.problem(`Push Day ${r?.name ?? id} is ${r?.targetLoad}, not ${loads.join(' or ')}`); bad = true; }
  }
  const chest = rows.find((x) => x.exerciseId === EX.chest);
  if (!chest || (chest.targetLoad != null && chest.targetLoad !== 70)) { s.problem(`Push Day chest press is ${chest?.targetLoad}`); bad = true; }
  const hollow = rows.find((x) => x.exerciseId === EX.hollow);
  if (!hollow?.cues?.some((c) => c.includes('Go to 10 lb at 12 clean reps'))) { s.problem('Push hollow-body has no "10 lb at 12 clean reps" cue'); bad = true; }
  if (!bad) {
    const next = rows.map((r): Row => {
      switch (r.exerciseId) {
        case EX.flat: return withLoad(r, 30, WHY('flat press 25 → 30, both clusters (11/26: 25 × 13/13 @RIR 1)'));
        case EX.incline: return withLoad(r, 25, WHY('incline 20 → 25, both clusters (11/26: 20 × 14/14)'));
        case EX.calf: return withLoad(r, 35, WHY('Push Day calf 30 → 35, both legs (Pull is 35 since 11/25)'));
        case EX.chest: {
          const cues = (r.cues ?? []).filter((c) => !c.startsWith('First use Fri 11/27'))
            .flatMap((c) => (c.startsWith('Trial. ') ? [CHEST_NOTE, 'Handles set as far back as comfortable. Shoulder blades on the pad.'] : [c]));
          const withNote = cues.includes(CHEST_NOTE) ? cues : [...cues, CHEST_NOTE];
          return { ...withLoad(r, 70, WHY('chest press machine first load 70 (11/26: 70 × 10 +4 +3); permanent, not a trial')), cues: addCue(withNote, STACK_CUE), progression: { targetReps: 12, holdSessions: 1, incrementLb: 10 } };
        }
        case EX.shoulder: {
          const plannedSets: PlannedSet[] = r.plannedSets.map((p) => (p.kind === 'mini' ? { ...p, weight: 70 } : (({ weight: _w, ...rest }) => rest)(p)));
          return { ...r, name: NEW_NAME, plannedSets, cues: addCue(addCue(r.cues, SHOULDER_NOTE), STACK_CUE), progression: { targetReps: 12, holdSessions: 1, incrementLb: 10 } };
        }
        case EX.ohe: return { ...r, cues: addCue(r.cues, OHE_CUE) };
        case EX.lateral: return { ...r, cues: addCue(r.cues, LATERAL_CUE), progression: { targetReps: 15, holdSessions: 1, incrementLb: 5 } };
        case EX.skull: return { ...r, cues: addCue(r.cues, SKULL_CUE), progression: { targetReps: 12, holdSessions: 1, incrementLb: 5 } };
        default: return r;
      }
    }).map((r, i) => (stable(r) === stable(rows[i]) ? rows[i] : { ...r, lastModifiedAt: stamp, lastModifiedBy: 'prompt' }));
    const notes = String(push.get('notes') ?? '');
    const nextNotes = notes.includes(PUSH_LINE) ? notes : `${notes}\n\n${PUSH_LINE}`;
    if (nextNotes.length > 10_000) s.problem(`Push notes would be ${nextNotes.length} characters (max 10,000)`);
    else {
      const changed = next.map((r, i) => (r === rows[i] ? null : r.name)).filter(Boolean);
      pushPlanned = { ...push.data(), exercises: next, notes: nextNotes };
      if (changed.length || nextNotes !== notes) s.update(push, { exercises: json(next), notes: nextNotes, updatedAt: Timestamp.fromDate(now) }, `Push Day: ${changed.join(' · ') || '—'}${nextNotes !== notes ? ' · + notes line' : ''}`);
    }
  }
}
const pullHollow = (tplDoc(PULL)?.get('exercises') as Row[] | undefined)?.find((x) => x.exerciseId === EX.hollow);
if (pullHollow?.targetLoad !== 5 || !pullHollow.cues?.some((c) => c.includes('12 clean reps'))) s.problem('Pull hollow-body is not 5 lb with the 12-clean-reps cue');
else s.note('hollow-body 5 lb + "10 lb only at 12 clean reps" already on Push and Pull: unchanged');

// ── D. re-entry rules end; Fri 11/27 rest ──
const rawPeriods = json(profile.get('travelPeriods') as Record<string, unknown>[] | undefined) ?? [];
const bolivia = rawPeriods.find((p) => p['start'] === '2026-10-31');
let nextPeriods = rawPeriods;
if (!bolivia) s.problem('the Bolivia period is gone');
else if (bolivia['reentryRules'] != null) {
  const rules = bolivia['reentryRules'] as { templateIds: string[]; loadPct: number }[];
  const shape = rules.map((r) => `${r.loadPct}:${r.templateIds.join(',')}`).sort().join(' ');
  if (shape !== `10:${LEG} 5:${PUSH}`) s.problem(`Bolivia re-entry rules are ${shape}, not legs −10 % (Leg) + upper −5 % (Push)`);
  else {
    nextPeriods = rawPeriods.map((p) => (p === bolivia ? Object.fromEntries(Object.entries(p).filter(([k]) => k !== 'reentryRules')) : p));
    const strip = (ps: ReturnType<typeof travelPeriodsOf>) => stable(ps.map((p) => ({ ...p, reentryRules: undefined })));
    if (strip(travelPeriodsOf({ travelPeriods: rawPeriods })) !== strip(travelPeriodsOf({ travelPeriods: nextPeriods }))) s.problem('core `travelPeriodsOf` reads the periods differently after the edit');
  }
}
const plan = json(profile.get('homePlan') as Record<string, unknown>);
const notes = plan['notes'] as { from: string; to: string; label: string; note?: string }[];
const WEEK_OLD = 'Re-entry week — Mon Leg · Wed Pull · Fri Push';
const WEEK = { from: '2026-11-23', to: '2026-11-26', label: 'Re-entry rotation done — Leg 11/23 · Pull 11/25 · Push 11/26', note: 'Leg −10 % RIR 2, Pull and Push −5 % normal effort. Push was done Thu 11/26, not Fri. No regression; re-entry is over for all three templates.' };
const REST = { from: '2026-11-27', to: '2026-11-27', label: 'Fri 11/27 — rest', note: 'Rest day: the rotation week is complete (Push moved to Thu 11/26). Next session: Leg Day Mon 11/30.' };
const nextNotes = notes.map((n) => (n.label === WEEK_OLD && n.from === '2026-11-23' && n.to === '2026-11-27' ? WEEK : n));
if (!nextNotes.some((n) => n.label === WEEK.label)) s.problem(`no home-plan note "${WEEK_OLD}" (11/23–11/27) to rewrite`);
if (!nextNotes.some((n) => n.label === REST.label)) nextNotes.push(REST);
if (!notes.some((n) => n.from === '2026-11-30' && n.label.startsWith('Mon 11/30 — Leg Day'))) s.problem('no "Mon 11/30 — Leg Day" note');
const nextPlan = { ...plan, notes: nextNotes };
const sane = homePlanOf({ homePlan: nextPlan });
if ((sane?.notes?.length ?? 0) !== nextNotes.length || nextNotes.length > 20) s.problem(`homePlanOf keeps ${sane?.notes?.length} of ${nextNotes.length} notes`);

// ── E. profile: equipment; home plan; periods ──
const EQUIPMENT = 'Paramount MP Series multi-station. Upper body station: supine chest press, incline chest press, shoulder press (same press arm, adjustable start position), seated row, lat pulldown, triceps pushdown (high pulley), overhead triceps extension, ab crunch. Low pulley station: biceps curl, upright row, lateral raise, inner/outer thigh. Leg station: leg extension, seated leg curl. Stack moves in 10 lb steps.';
const profilePatch: Record<string, unknown> = {};
const profileLines: string[] = [];
if (profile.get('gymEquipment') !== EQUIPMENT) {
  if (profile.get('gymEquipment') != null) s.problem(`profile already has gymEquipment: ${profile.get('gymEquipment')}`);
  else { profilePatch['gymEquipment'] = EQUIPMENT; profileLines.push(`+ gymEquipment (${EQUIPMENT.length} chars)`); }
}
if (stable(nextPlan) !== stable(plan)) { profilePatch['homePlan'] = nextPlan; profileLines.push(`homePlan: "${WEEK_OLD}" → "${WEEK.label}" · + "${REST.label}"`); }
if (nextPeriods !== rawPeriods) { profilePatch['travelPeriods'] = nextPeriods; profileLines.push('travelPeriods (Bolivia): both re-entry rules removed (legs −10 %, upper −5 % on Push)'); }
if (Object.keys(profilePatch).length) s.update(profile, profilePatch, `profile: ${profileLines.join(' · ')}`);

// ── F. the 11/26 tape ──
const TAPE_NOTE = 'Median of 3. Taken the morning after two high-sodium restaurant meals; re-measure Mon 11/30.';
if (!measurement.exists || measurement.get('waist') !== 31.5 || measurement.get('neck') !== 14.5 || hm((measurement.get('timestamp') as Timestamp).toDate()).slice(0, 5) !== '11/26') s.problem('measurement 7O82wpWk… is not the 11/26 waist 31.5 / neck 14.5 that was read');
else if (measurement.get('note') !== TAPE_NOTE) {
  if (measurement.get('note') != null) s.problem(`the 11/26 measurement already has a note: ${measurement.get('note')}`);
  else s.update(measurement, { note: TAPE_NOTE }, 'measurement 11/26 (waist 31.5, neck 14.5): + note — values unchanged');
}
if (!weight.exists || weight.get('weight') !== 153.2) s.problem(`dailyWeights/${DAY} is ${weight.exists ? weight.get('weight') : 'absent'}, not 153.2`);

// ── G. guards: what the app will do ──
for (const id of TRAVEL) {
  const d = tplDoc(id);
  if (!d) s.problem(`travel template ${id} is gone`);
  else if (d.get('archivedAt') == null) s.problem(`${d.get('name')} is not archived (it was when read)`);
}
const active = tplSnap.docs.filter((d) => d.get('archivedAt') == null).map((d) => d.get('name')).sort();
if (stable(active) !== stable(['Leg Day', 'Pull Day', 'Push Day'])) s.problem(`active templates: ${active.join(', ')}`);
else s.note(`already archived: all ${TRAVEL.length} travel templates (sessions kept); active: ${active.join(', ')}`);

const sessions = sesSnap.docs.map((d) => planned.get(d.id) ?? toWorkoutSession(d.id, d.data()));
const completed = sessions.filter((x) => x.status === 'completed');
const periodsNow = travelPeriodsOf({ travelPeriods: nextPeriods });
const travelIds = new Set(tplSnap.docs.filter((d) => String(d.get('templateVersion') ?? '').startsWith('travel')).map((d) => d.id));
for (const [id, day] of [[LEG, '2026-11-30'], [PULL, '2026-12-07'], [PUSH, '2026-12-09']] as const) {
  const kind = reentryFor({ templateId: id, today: day, sessions: completed, periods: periodsNow, travelTemplateIds: travelIds, templateCreatedAt: (tplDoc(id)?.get('createdAt') as Timestamp | undefined)?.toDate(), boundary: MIDNIGHT });
  if (kind !== null) s.problem(`${tplDoc(id)?.get('name')} on ${day} would still be a ${kind} re-entry`);
}
s.note('(read only) Leg 11/30, Pull 12/07, Push next: normal sessions, no re-entry');
const review = homePlanOf({ homePlan: nextPlan })?.review;
if (review) s.note(`(read only) review card: ${reviewRotations(review, completed, MIDNIGHT)} of ${review.afterRotations} rotations since ${review.since}`);
if (pushPlanned) {
  const t = toWorkoutTemplate(PUSH, pushPlanned);
  s.note(`(read only) Push next session: ${t.exercises.map((r) => `${r.name} ${r.targetLoad ?? '—'}${r.plannedSets.some((p) => p.weight != null && p.kind === 'mini') ? ` (minis ${r.plannedSets.find((p) => p.kind === 'mini')!.weight})` : ''}`).join(' · ')}`);
}
s.note('left alone: every set of 11/23–11/26 · the sessions\' re-entry snapshots · Leg and Pull templates · the 11/26 weigh-in and tape values · steps (not read or written) · stph not opened');

await s.run({
  report: async () => {
    for (const id of Object.values(SESSIONS)) {
      const d = (await owner.collection('workoutSessions').doc(id).get()).data()!;
      console.log(`${hm((d['timestamp'] as Timestamp).toDate())} ${d['templateName']}: templateVersion ${d['templateVersion']} · programVersion ${d['programVersion']} · note ${d['sessionNote'] ? String(d['sessionNote']).length + ' chars' : '—'}`);
    }
    const t = (await owner.collection('workoutTemplates').doc(PUSH).get()).data()!;
    console.log(`\nPush Day: ${(t['exercises'] as Row[]).map((r) => `${r.name} ${r.targetLoad}${r.plannedSets.some((p) => p.kind === 'mini' && p.weight != null) ? `/${r.plannedSets.find((p) => p.kind === 'mini')!.weight}` : ''}`).join(' · ')}`);
    const p = (await owner.get()).data()!;
    console.log(`\nBolivia reentryRules: ${JSON.stringify(travelPeriodsOf(p).find((x) => x.start === '2026-10-31')?.reentryRules ?? null)}`);
    console.log(`gymEquipment: ${String(p['gymEquipment']).slice(0, 60)}…`);
    console.log(`homePlan notes 11/23–11/27: ${(p['homePlan'].notes as { from: string; label: string }[]).filter((n) => n.from >= '2026-11-23' && n.from <= '2026-11-27').map((n) => n.label).join(' | ')}`);
    console.log(`measurement 11/26 note: ${(await owner.collection('measurements').doc(MEASUREMENT).get()).get('note')}`);
    console.log(`exercise: ${(await owner.collection('exercises').doc(EX.shoulder).get()).get('name')}`);
  },
});
