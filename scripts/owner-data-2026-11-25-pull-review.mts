/**
 * Owner data, requested 2026-11-25 (America/Puerto_Rico): fix and annotate the
 * 11/25 Pull Day (v2.4 re-entry), the Pull/Push v2.4 loads for the next
 * rotation, the end of Pull's re-entry rule, and Travel A archived.
 *
 * What the read found (2026-11-25, a full read of sessions, templates, profile):
 *
 *   Session    qBUEwjTEPy9PUERvnL5V, Pull Day, completed, 08:32, 46 min,
 *              re-entry `post-travel` (−5 %, normal effort), templateVersion
 *              `v2`. The calf row holds the L cluster only (30 × 15/5/5) → the
 *              R cluster (group 2, label R) is added. The session has NO seated
 *              leg curl row → one is added after the lateral raise with no sets
 *              and `skipped` (core `SessionExercise.skipped`: counts for
 *              nothing, not missed, status stays `completed`). + sessionNote.
 *   v2.4 tag   session `templateVersion` stays `v2` on 11/25 and 11/23 (owner,
 *              2026-11-25): it is the draft marker (`v1`|`v2` in the rules and
 *              the mapper); sets carry no version. "v2.4" is the templates' own
 *              field (all three already v2.4); the notes say it.
 *   Pull       pull-up bodyweight, +5 lb at 15 (progression 12 → 15, cue) ·
 *              machine row 110 (stored) · pulldown 80 → 90 · chest-supported
 *              row 40 (stored) + "stay until 12" · calf 30 → 35 · hollow-body
 *              5 (stored) + the 11/25 arching cue. Others unchanged.
 *   Push       hollow-body 5 (stored) + the same cue.
 *   Re-entry   Bolivia's rule "upper −5 %" lists Pull and Push → Push only.
 *              (The app already ends re-entry once a template is done after the
 *              trip — `reentryFor` — checked both ways below.)
 *   Archived   Haven 1/2, Airbnb, Travel B/C/D, C+D carryover: already archived
 *              (read only). Travel A → archived (owner, 2026-11-25, knowing the
 *              12/02 and 12/05 notes point to it; restore from Archived).
 *   Weight     11/25 151.8 stored: read only.
 *
 * No steps, no targets, no maintenance inputs (ADR-0024). stph not opened.
 * Dry run unless `--apply`; every touched doc is backed up first; a re-run plans nothing.
 *
 *   npx jiti scripts/owner-data-2026-11-25-pull-review.mts [--apply]
 */
import { Timestamp } from 'firebase-admin/firestore';
import type { Exercise, SessionExercise, TemplateExercise, WorkoutSession, WorkoutSet } from '../packages/core/src/workout.ts';
import {
  dumbbellStepLb,
  MIDNIGHT,
  reentryFor,
  reentryRuleFor,
  sessionCall,
  toWorkoutExercise,
  toWorkoutSession,
  toWorkoutTemplate,
  travelPeriodsOf,
  volumeBetween,
} from '../packages/core/src/index.ts';
import { at, hm, open } from './lib/user-data.mts';

const OWNER = 'gabrielandresbermudez@gmail.com';
const DAY = '2026-11-25';
const s = await open('owner-data-2026-11-25-pull-review');
const owner = await s.user(OWNER);
const now = new Date();
const stamp = now.toISOString();

const LEG = 'quxwARQlCnItzpLJgcr4';
const PULL = 'aliWJBD2FND6mU9foLdC';
const PUSH = 'Nx1bxeRuH6bMnGgX7Trv';
const PULL_SESSION = 'qBUEwjTEPy9PUERvnL5V';
const LEG_SESSION = 'xjcuEXssMncY9EOLMIhA';
const EX = {
  pullUp: 'GOGOcWJNC9q9aBmN3ENq', machineRow: '9x3b6rmxlxJyWWSMat3w', pulldown: 'oxOuktVhb6Ghgg7hGkCk', chestRow: 'acs1BlQvTZdL97i5jXJv',
  lateral: 'BGyAEJU6i5nN6AjXRU1g', legCurl: 'jZWYnikrGcdRG1adHXJ0', calf: 'm5E72J63gVXltnQ0zC8f', hollow: 'home-weighted-hollow-body-ext',
};

const stable = (v: unknown): string => {
  if (v instanceof Timestamp) return JSON.stringify(v.toMillis());
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v).filter((k) => (v as Record<string, unknown>)[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${stable((v as Record<string, unknown>)[k])}`).join(',')}}`;
  return JSON.stringify(v);
};
const json = <T,>(v: T): T => JSON.parse(JSON.stringify(v));

const [profile, exSnap, sesSnap, tplSnap, weight] = await Promise.all([
  owner.get(), owner.collection('exercises').get(), owner.collection('workoutSessions').get(), owner.collection('workoutTemplates').get(),
  owner.collection('dailyWeights').doc(DAY).get(),
]);
const tplDoc = (id: string) => tplSnap.docs.find((d) => d.id === id);

// ── A. the 11/25 session ──
const SKIP_REASON = 'hamstring soreness from 11/23 Leg Day';
const SESSION_NOTE =
  'Second v2.4 session, first Pull Day since 10/29. No regression. Pull-up 13 +3 +2 (best). Machine row 110 × 12, then 105 × 11. Pulldown 85 × 11. Chest-supported row 40 × 11. Rear delt 20 × 11/11. Hollow-body extension first time: 10 lb × 8 +3 +2. Leg extension 90 × 10 limited by soreness. Seated leg curl skipped.';
const R_SETS: WorkoutSet[] = [
  { kind: 'activation', group: 2, label: 'R', weight: 30, unit: 'lb', reps: 15, rir: 0, done: true },
  { kind: 'mini', group: 2, label: 'R', weight: 30, unit: 'lb', reps: 5, rir: 0, done: true },
  { kind: 'mini', group: 2, label: 'R', weight: 30, unit: 'lb', reps: 5, rir: 0, done: true },
];
const setKey = (x: WorkoutSet) => `${x.kind}|${x.group}|${x.label}|${x.weight}|${x.reps}|${x.rir}`;
let plannedPull: WorkoutSession | null = null;
const ses = sesSnap.docs.find((d) => d.id === PULL_SESSION);
if (!ses) s.problem(`session ${PULL_SESSION} is gone`);
else {
  const sd = ses.data();
  const time = hm((sd['timestamp'] as Timestamp).toDate());
  if (sd['templateId'] !== PULL || sd['status'] !== 'completed' || sd['durationMin'] !== 46 || time !== '11/25, 08:32' || sd['reentry'] !== 'post-travel' || sd['templateVersion'] !== 'v2') {
    s.problem(`session ${PULL_SESSION} is not the completed 46-min 08:32 Pull Day re-entry (v2) that was read`);
  } else {
    const rows = json(sd['exercises'] as SessionExercise[]);
    let next = rows.map((r) => ({ ...r, sets: [...r.sets] }));
    const lines: string[] = [];
    // calf: L stored, R added
    const calf = next.find((r) => r.exerciseId === EX.calf);
    const left = calf?.sets.filter((x) => x.label === 'L') ?? [];
    const right = calf?.sets.filter((x) => x.label === 'R') ?? [];
    if (!calf || left.length !== 3 || left.map((x) => `${x.weight}×${x.reps}`).join(' ') !== '30×15 30×5 30×5') s.problem('the 11/25 calf row is not the L 30 × 15/5/5 that was read');
    else if (right.length === 0) { calf.sets = [...calf.sets, ...R_SETS]; lines.push('calf + R 30 × 15/5/5 RIR 0'); }
    else if (right.map(setKey).join() !== R_SETS.map(setKey).join()) s.problem(`the 11/25 calf row already has different R sets: ${right.map((x) => `${x.weight}×${x.reps}`).join(' ')}`);
    // seated leg curl: a skipped row, no sets
    const curl = next.find((r) => r.exerciseId === EX.legCurl);
    if (curl) { if (curl.skipped !== SKIP_REASON || curl.sets.length) s.problem(`the 11/25 session already has a leg curl row: ${curl.sets.length} sets, skipped "${curl.skipped ?? ''}"`); }
    else {
      const tplCurl = (tplDoc(PULL)?.get('exercises') as TemplateExercise[] | undefined)?.find((r) => r.exerciseId === EX.legCurl);
      const i = next.findIndex((r) => r.exerciseId === EX.lateral);
      if (!tplCurl || i < 0) s.problem('no Pull Day leg curl row or no lateral raise in the session');
      else {
        const row: SessionExercise = { exerciseId: EX.legCurl, name: tplCurl.name, targetLoad: tplCurl.targetLoad, cues: tplCurl.cues ?? [], loadUnit: 'lb', sets: [], skipped: SKIP_REASON };
        next = [...next.slice(0, i + 1), row, ...next.slice(i + 1)];
        lines.push(`+ "${tplCurl.name}" skipped (${SKIP_REASON}), no sets`);
      }
    }
    const patch: Record<string, unknown> = {};
    if (stable(next) !== stable(rows)) patch['exercises'] = next;
    if (sd['sessionNote'] !== SESSION_NOTE) {
      if (sd['sessionNote'] != null) s.problem(`session ${PULL_SESSION} already has a different note: ${sd['sessionNote']}`);
      else if (SESSION_NOTE.length > 500) s.problem(`session note is ${SESSION_NOTE.length} characters (max 500)`);
      else { patch['sessionNote'] = SESSION_NOTE; lines.push('+ sessionNote'); }
    }
    // left untouched: every other row and set
    const others = (x: SessionExercise[]) => stable(x.filter((r) => r.exerciseId !== EX.calf && r.exerciseId !== EX.legCurl));
    if (others(next) !== others(rows)) s.problem('a row other than the calf and the leg curl would change');
    if (Object.keys(patch).length) {
      patch['updatedAt'] = Timestamp.fromDate(now);
      s.update(ses, patch, `session ${PULL_SESSION} (11/25 Pull Day): ${lines.join(' · ')} · templateVersion v2, status, 46 min, re-entry unchanged`);
    }
    plannedPull = toWorkoutSession(ses.id, { ...sd, exercises: next });
  }
}
const legSes = sesSnap.docs.find((d) => d.id === LEG_SESSION);
if (!legSes || legSes.get('templateVersion') !== 'v2' || !String(legSes.get('sessionNote') ?? '').startsWith('Program v2.4.')) s.problem('the 11/23 Leg Day is not the v2 session with the "Program v2.4." note that was read');
s.note('templateVersion stays "v2" on 11/23 and 11/25 (owner, 2026-11-25): the draft marker; "v2.4" is on the templates and in both notes');

// ── B. Pull and Push templates ──
type Row = TemplateExercise & Record<string, unknown>;
const WHY = (what: string) => `Owner, ${DAY}: ${what}`;
const withLoad = (r: Row, to: number, reason: string): Row =>
  r.targetLoad === to ? r : { ...r, targetLoad: to, loadLog: [...(r.loadLog ?? []), { at: stamp, from: r.targetLoad, to, by: 'prompt', reason }] } as Row;
const swapCue = (cues: string[] | undefined, match: (c: string) => boolean, cue: string): string[] => {
  const c = [...(cues ?? [])];
  if (c.includes(cue)) return c;
  const i = c.findIndex(match);
  if (i >= 0) c[i] = cue; else c.push(cue);
  return c;
};
const PULLUP_CUE = 'Bodyweight. 11/25: 13 +3 +2 (best). Add 5 lb once the activation reaches 15 (DB between the feet or a loaded backpack).';
const CHEST_CUE = 'Stay at 40 until the activation reaches 12.';
const CALF_CUE = '35 lb both legs from 12/07 (11/25: 30 × 15 +5 +5 each leg).';
const HOLLOW_CUE = '8–12 reps at 5 lb. 10 lb arched the lower back on 11/25: go to 10 lb only at 12 clean reps.';
const hollowEdit = (r: Row): Row => ({ ...r, cues: swapCue(r.cues, (c) => c.startsWith('8–12 reps.'), HOLLOW_CUE) });

const EDITS: Record<string, { name: string; line: string; rows: (rows: Row[]) => Row[]; check: (rows: Row[]) => string | null }> = {
  [PULL]: {
    name: 'Pull Day',
    line: `${DAY} - 11/25 re-entry reviewed: no regression; re-entry done for Pull. Mon 12/07: pull-up bodyweight (+5 lb at 15) · machine row 110 both clusters · pulldown 90 · chest-supported row 40 (stay until 12) · calf 35 both legs · hollow-body 5 (10 lb arched the lower back; 10 only at 12 clean reps). Others unchanged.`,
    rows: (rows) => rows.map((r) => {
      if (r.exerciseId === EX.pullUp) return { ...r, cues: swapCue(r.cues, (c) => c.startsWith('Last home activation'), PULLUP_CUE), progression: { ...r.progression!, targetReps: 15 } };
      if (r.exerciseId === EX.pulldown) return withLoad(r, 90, WHY('next Pull Day (12/07) at 90; 85 × 11 on 11/25'));
      if (r.exerciseId === EX.chestRow) return { ...r, cues: swapCue(r.cues, () => false, CHEST_CUE) };
      if (r.exerciseId === EX.calf) return { ...withLoad(r, 35, WHY('Pull Day calf 30 → 35, both legs (11/25: 30 × 15/5/5 each leg)')), cues: swapCue(r.cues, () => false, CALF_CUE) };
      if (r.exerciseId === EX.hollow) return hollowEdit(r);
      return r;
    }),
    check: (rows) => {
      const want: [string, number[]][] = [[EX.pullUp, [0]], [EX.machineRow, [110]], [EX.pulldown, [80, 90]], [EX.chestRow, [40]], [EX.calf, [30, 35]], [EX.hollow, [5]]];
      for (const [id, loads] of want) {
        const r = rows.find((x) => x.exerciseId === id);
        if (!r) return `Pull Day has no row ${id}`;
        if (!loads.includes(r.targetLoad ?? -1)) return `Pull Day ${r.name} is ${r.targetLoad}, not ${loads.join(' or ')}`;
      }
      const pu = rows.find((x) => x.exerciseId === EX.pullUp)!;
      if (![12, 15].includes(pu.progression?.targetReps ?? -1)) return `pull-up progression targetReps is ${pu.progression?.targetReps}`;
      return null;
    },
  },
  [PUSH]: {
    name: 'Push Day',
    line: `${DAY} - Hollow-body extension stays 5 lb: 10 lb arched the lower back on 11/25 (Pull); go to 10 only at 12 clean reps.`,
    rows: (rows) => rows.map((r) => (r.exerciseId === EX.hollow ? hollowEdit(r) : r)),
    check: (rows) => {
      const h = rows.find((x) => x.exerciseId === EX.hollow);
      return !h ? 'Push Day has no hollow-body row' : h.targetLoad !== 5 ? `Push Day hollow-body is ${h.targetLoad}, not 5` : null;
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
  const rows = json(data['exercises'] as Row[]);
  const bad = edit.check(rows);
  if (bad) { s.problem(bad); continue; }
  const next = edit.rows(rows).map((r, i) => (stable(r) === stable(rows[i]) ? rows[i] : { ...r, lastModifiedAt: stamp, lastModifiedBy: 'prompt' }));
  const notes = String(data['notes'] ?? '');
  const nextNotes = notes.includes(edit.line) ? notes : `${notes}\n\n${edit.line}`;
  if (nextNotes.length > 10_000) { s.problem(`${edit.name} notes would be ${nextNotes.length} characters (max 10,000)`); continue; }
  const changed = next.map((r, i) => (r === rows[i] ? null : r.name)).filter(Boolean);
  planned.set(id, { ...data, exercises: next, notes: nextNotes });
  if (changed.length || nextNotes !== notes) s.update(doc, { exercises: json(next), notes: nextNotes, updatedAt: Timestamp.fromDate(now) }, `${edit.name}: ${changed.join(' · ') || '—'}${nextNotes !== notes ? ' · + notes line' : ''}`);
}

// ── C. Pull's re-entry rule ends ──
const rawPeriods = json(profile.get('travelPeriods') as Record<string, unknown>[] | undefined) ?? [];
const bolivia = rawPeriods.find((p) => p['start'] === '2026-10-31');
const upper = (bolivia?.['reentryRules'] as { templateIds: string[]; loadPct: number }[] | undefined)?.find((r) => r.loadPct === 5);
let nextPeriods = rawPeriods;
if (!bolivia || !upper) s.problem('the Bolivia period or its upper −5 % rule is gone');
else if (stable(upper.templateIds) === stable([PUSH])) { /* already done */ }
else if (stable(upper.templateIds) !== stable([PULL, PUSH])) s.problem(`the upper −5 % rule lists ${upper.templateIds.join(', ')}`);
else {
  nextPeriods = json(rawPeriods);
  const nb = nextPeriods.find((p) => p['start'] === '2026-10-31')!;
  (nb['reentryRules'] as { templateIds: string[]; loadPct: number }[]).find((r) => r.loadPct === 5)!.templateIds = [PUSH];
  const before = travelPeriodsOf({ travelPeriods: rawPeriods }), after = travelPeriodsOf({ travelPeriods: nextPeriods });
  const strip = (ps: typeof before) => stable(ps.map((p) => ({ ...p, reentryRules: undefined })));
  if (strip(before) !== strip(after) || after.length !== rawPeriods.length) s.problem('core `travelPeriodsOf` reads the periods differently after the edit');
  else s.update(profile, { travelPeriods: nextPeriods }, 'travelPeriods (Bolivia): re-entry "upper −5 %, normal effort" → Push only (Pull re-entry done 11/25)');
}

// ── D. travel templates archived ──
const ARCHIVE_NOTE = `${DAY} - archived (owner): travel kit not in use; restore from Archived (tag "travel kit") for the 12/02 and 12/05 optional sessions.`;
const ALREADY = ['travel-haven-1', 'travel-haven-2', 'travel-airbnb-2026-11-17', 'travel-b-full-body', 'travel-gym-c', 'travel-gym-d', 'travel-cd-carryover-2026-11-05'];
for (const id of ALREADY) {
  const d = tplDoc(id);
  if (!d) s.problem(`template ${id} is gone`);
  else if (d.get('archivedAt') == null) s.problem(`${d.get('name')} is not archived (it was when read)`);
  else s.note(`already archived: ${d.get('name')} — ${sesSnap.docs.filter((x) => x.get('templateId') === id).length} session(s) kept`);
}
const travelA = tplDoc('travel-a-full-body');
if (!travelA) s.problem('Travel A is gone');
else if (travelA.get('archivedAt') == null) {
  const notes = String(travelA.get('notes') ?? '');
  s.update(travelA, { archivedAt: Timestamp.fromDate(now), notes: notes.includes(ARCHIVE_NOTE) ? notes : `${notes}\n${ARCHIVE_NOTE}`.trim(), updatedAt: Timestamp.fromDate(now) },
    `ARCHIVE "${travelA.get('name')}" (tags kept: ${(travelA.get('tags') ?? []).join(', ')}) · ${sesSnap.docs.filter((x) => x.get('templateId') === 'travel-a-full-body').length} session(s)`);
}

// ── E. guards: what the app will do ──
if (!weight.exists || weight.get('weight') !== 151.8) s.problem(`dailyWeights/${DAY} is ${weight.exists ? weight.get('weight') : 'absent'}, not the 151.8 that was read`);
const sessions: WorkoutSession[] = sesSnap.docs.map((d) => (d.id === PULL_SESSION && plannedPull ? plannedPull : toWorkoutSession(d.id, d.data())));
const catalog: Exercise[] = exSnap.docs.map((d) => toWorkoutExercise(d.id, d.data()));
const vol = volumeBetween(sessions, catalog, at('2026-11-23', '00:00').getTime(), at('2026-11-30', '00:00').getTime());
const mv = (m: string) => vol.week.find((x) => x.muscle === m);
s.note(`(read only) week of Mon 11/23 so far: hamstrings ${mv('hamstrings')?.direct} direct / ${mv('hamstrings')?.fractional} fractional · calves ${mv('calves')?.direct} · back ${mv('back')?.direct}`);

const periodsNow = travelPeriodsOf({ travelPeriods: nextPeriods });
const travelIds = new Set(tplSnap.docs.filter((d) => String(d.get('templateVersion') ?? '').startsWith('travel')).map((d) => d.id));
const kindOn = (id: string, day: string) => reentryFor({ templateId: id, today: day, sessions, periods: periodsNow, travelTemplateIds: travelIds, templateCreatedAt: (tplDoc(id)?.get('createdAt') as Timestamp | undefined)?.toDate(), boundary: MIDNIGHT });
if (kindOn(PULL, '2026-12-07') !== null) s.problem('Pull Day on 12/07 would still be a re-entry session');
const pushKind = kindOn(PUSH, '2026-11-27');
const pushRule = pushKind ? reentryRuleFor(pushKind, PUSH, periodsNow.find((p) => p.start === '2026-10-31') ?? null) : null;
if (pushKind !== 'post-travel' || pushRule?.loadPct !== 5 || pushRule.rir != null) s.problem(`Push Day 11/27 would be ${pushKind ?? 'normal'} ${pushRule ? `−${pushRule.loadPct}%` : ''}, not the −5 % normal-effort re-entry`);
else s.note('(read only) Push Day 11/27 stays a re-entry: −5 %, normal effort');

const completed = sessions.filter((x) => x.status === 'completed').sort((x, y) => y.date.getTime() - x.date.getTime());
const dbStep = dumbbellStepLb(profile.get('dumbbellHalfSteps') as boolean | undefined);
const pullPlan = planned.get(PULL);
if (pullPlan) {
  const t = toWorkoutTemplate(PULL, pullPlan);
  const out: string[] = [];
  for (const r of t.exercises) {
    const c = catalog.find((x) => x.id === r.exerciseId);
    const call = sessionCall(r, completed, c ? { ...c, dumbbellStepLb: dbStep } : null);
    const engine = call.rec.action !== 'none' && call.rec.load != null ? call.rec.load : null;
    out.push(`${r.name} ${r.targetLoad === 0 ? 'BW' : r.targetLoad}${engine != null && engine !== r.targetLoad ? ` (engine: ${call.rec.action} ${engine})` : ''}`);
  }
  s.note(`(read only) Pull Day 12/07, normal session: ${out.join(' · ')}`);
}
s.note('left alone: the 11/25 L calf sets and every other 11/25 set · the 11/23 session · Leg Day · the weigh-in · steps are not read or written · stph not opened');

await s.run({
  report: async () => {
    const d = (await owner.collection('workoutSessions').doc(PULL_SESSION).get()).data()!;
    console.log(`\n11/25 Pull Day: ${d['status']} · ${d['durationMin']} min · templateVersion ${d['templateVersion']} · note ${String(d['sessionNote']).length} chars`);
    for (const e of d['exercises'] as SessionExercise[]) console.log(`  ${e.name}${e.skipped ? ` — SKIPPED (${e.skipped})` : ''}: ${e.sets.map((x) => `${x.label ?? ''}${x.weight}×${x.reps}`).join(' ')}`);
    for (const id of [PULL, PUSH]) {
      const t = (await owner.collection('workoutTemplates').doc(id).get()).data()!;
      console.log(`\n${t['name']}: ${(t['exercises'] as Row[]).map((r) => `${r.name} ${r.targetLoad}`).join(' · ')}`);
    }
    const p = travelPeriodsOf((await owner.get()).data() ?? {}).find((x) => x.start === '2026-10-31');
    console.log(`\nBolivia re-entry rules: ${p?.reentryRules?.map((r) => `${r.label} → ${r.templateIds.join(',')}`).join(' | ')}`);
    const a = await owner.collection('workoutTemplates').doc('travel-a-full-body').get();
    console.log(`Travel A archivedAt: ${(a.get('archivedAt') as Timestamp | undefined)?.toDate().toISOString()}`);
  },
});
