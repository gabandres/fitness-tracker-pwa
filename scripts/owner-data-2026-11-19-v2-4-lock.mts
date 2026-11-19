/**
 * Owner data, 2026-11-19 (America/Puerto_Rico, home from the trip 11/18):
 * template cleanup + lock in Home Program v2.4 (adjusted).
 *
 *   ARCHIVE   every travel template (Travel A/B, C/D, the 11/16 short one,
 *             the C+D carryover, Haven 1/2, the 11/17 Airbnb one-off):
 *             `archivedAt`, a dated notes line, and tags — "travel kit" on
 *             A/B/C/D (the Archived list restores a tag in one tap), "Bolivia
 *             2026" on all. Nothing deleted; sessions keep their templateId.
 *             The home v2.3 templates are the SAME docs as v2.4 (edited in
 *             place on 11/06), so there is no v2.3 doc to archive: its 3
 *             sessions (10/27, 10/29, 10/30) stay its history.
 *   SESSIONS  every logged gym session of the trip (10/31–11/18) is marked
 *             `notComparable`: out of the home engine, e1RM charts and PRs.
 *   CATALOG   Haven / Airbnb lifts: `pickerHidden` + `context` (out of the
 *             default picker; a name search still finds them). A `home: kg`
 *             unit memory is cleared (home = lb). Pull-up: `loadable`.
 *   v2.4      Pull E gains the calf (1 cluster per leg, L → R, 30 lb); Push B
 *             calf 2 → 1 cluster per leg; the calf cue is the same on all
 *             three days; Leg's rest-day note; the pull-up's +5 lb rule; the
 *             home pulldown's "no thigh pad" cue; `expectedMin` 60 / 62 / 60.
 *   TRIP      label "Bolivia — travel, no weigh-ins"; plan entries after
 *             11/18 removed (their content moves to the home plan), the
 *             "travel + re-entry — OK" week ends 11/18; `reentryRules`: Leg
 *             −10 % RIR 2, Pull/Push −5 % normal effort (core `reentry-rule.ts`).
 *   PROFILE   `homePlan` (core `home-plan.ts`): Mon/Wed/Fri, dated notes, the
 *             review after 2 normal rotations, deload at 3 lifts down by ≥ 1
 *             rep twice running, no weight alerts before 11/26, the 11/26
 *             check-in vs 10/30, lunch as an estimate 11/28 → 12/06.
 *
 * Needs the 2026-11-19 rules (tags / expectedMin / pickerHidden / context /
 * homePlan / reentryRule) deployed BEFORE `--apply`, or every client save of
 * these docs fails. DRY RUN unless `--apply`; backed up first; re-runs are
 * no-ops. Touches `users/{owner}` only.
 *
 *   TZ=America/Puerto_Rico npx jiti scripts/owner-data-2026-11-19-v2-4-lock.mts [--apply]
 *
 * Auth: ADC (`gcloud auth application-default login`).
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue, getFirestore, Timestamp } from 'firebase-admin/firestore';
import type { Exercise, PlannedSet, TemplateExercise, WorkoutSession, WorkoutTemplate } from '../packages/core/src/workout.ts';
import {
  calendarDateKey,
  clusterCount,
  contextBaseline,
  dumbbellStepLb,
  estimateTemplateDuration,
  homePlanOf,
  normalizeSupersets,
  plannedVolume,
  recommendOptionsFor,
  reentryLoad,
  reentryRuleFor,
  sessionCall,
  supersetFlow,
  toWorkoutExercise,
  toWorkoutSession,
  toWorkoutTemplate,
  travelPeriodsOf,
  type HomePlan,
  type ReentryRuleEntry,
} from '../packages/core/src/index.ts';

const PROJECT_ID = 'fitness-tracker-gb-1775407101';
const OWNER = 'gabrielandresbermudez@gmail.com';
const APPLY = process.argv.includes('--apply');
if (process.env.TZ !== 'America/Puerto_Rico') throw new Error('run with TZ=America/Puerto_Rico');

const DAY = '2026-11-19';
const TRIP_START = '2026-10-31';
const TRIP_END = '2026-11-18';
const TRIP_LABEL = 'Bolivia — travel, no weigh-ins';
const FAIL = 'RIR 0 — to failure';
const CALF_CUE = 'Deep stretch pause 1–2 s; minis = bottom-half partials.';
const CALF_SIDES = 'L then R back to back, 0–15 s between (the other leg rests).';
const PENDING = 'Baseline pending — the re-entry session (first v2.4 rotation) is not read; the baseline is the session after.';
const OLD_CALF_CUES = ['1–2 s pause in deep stretch; minis = bottom-half partials.', 'Deep stretch pause; minis = bottom-half partials.'];
const LEG_REST_NOTE = 'Extra chest/back/hamstring clusters land best with a rest day before Pull Day.';
const PULLUP_CUE = 'Last home activation 12 @ bodyweight. Activation ≥ 12 at RIR 1 → add 5 lb (DB between the feet or a loaded backpack).';
const LAT_CUE = 'Home machine, no thigh pad: home baseline only (Haven\'s pulldown is its own lift).';

const LEG = 'quxwARQlCnItzpLJgcr4';
const PULL = 'aliWJBD2FND6mU9foLdC';
const PUSH = 'Nx1bxeRuH6bMnGgX7Trv';
const HOME = [LEG, PULL, PUSH];
const CALF = 'm5E72J63gVXltnQ0zC8f';
const CURL = 'jZWYnikrGcdRG1adHXJ0';
const CRUNCH = 'x3G0Speg04GclIOdKHAl';
const PULLUP = 'GOGOcWJNC9q9aBmN3ENq';
const LAT = 'oxOuktVhb6Ghgg7hGkCk';
const EXPECTED_MIN: Record<string, number> = { [LEG]: 60, [PULL]: 62, [PUSH]: 60 };

/** Every travel template: tags and archive. */
const TRAVEL: Record<string, string[]> = {
  'travel-a-full-body': ['travel kit', 'Bolivia 2026'],
  'travel-b-full-body': ['travel kit', 'Bolivia 2026'],
  'travel-gym-c': ['travel kit', 'Bolivia 2026'],
  'travel-gym-d': ['travel kit', 'Bolivia 2026'],
  'travel-short-2026-11-16': ['Bolivia 2026'],
  'travel-cd-carryover-2026-11-05': ['Bolivia 2026'],
  'travel-haven-1': ['Haven', 'Bolivia 2026'],
  'travel-haven-2': ['Haven', 'Bolivia 2026'],
  'travel-airbnb-2026-11-17': ['Airbnb', 'Bolivia 2026'],
};
const ARCHIVE_NOTE = `${DAY} - Archived: trip over (Bolivia 2026-10-31 → 2026-11-18); Home v2.4 is the only active program. History, sets and notes kept; restore from Train → Archived.`;
const V23_NOTE = `${DAY} - Home v2.3 retired ${DAY}, replaced by v2.4 (the same template, edited in place; v2.3's sessions keep their history). Rotation Leg → Pull → Push. Cluster = activation + 2 minis, 10 s mini-rest. No Zone 2 rows.`;

const REENTRY_RULES: ReentryRuleEntry[] = [
  { templateIds: [LEG], loadPct: 10, rir: 2, label: 'Re-entry — legs: −10%, RIR 2' },
  // `nearest`: a −5 % cut on a 5-lb dumbbell jump keeps the load rather than
  // dropping a full step (20 → 15 would be −25 %).
  { templateIds: [PULL, PUSH], loadPct: 5, label: 'Re-entry — upper: −5%, normal effort', round: 'nearest' },
];

const HOME_PLAN: HomePlan = {
  label: 'Home v2.4 — Leg → Pull → Push',
  trainingDays: [1, 3, 5],
  notes: [
    { from: '2026-11-19', to: '2026-11-19', label: 'Thu 11/19 — rest', note: 'Targets 1,850 kcal / 140 g protein from today. Steps are activity only; no compensation days.' },
    { from: '2026-11-20', to: '2026-12-06', label: 'Re-entry rotation', note: 'First Leg: −10% of the last home load, RIR 2, no failure. First Pull and first Push: −5% load, normal effort. Whenever they are logged — skipping 11/20 is fine; no regression flags this rotation.' },
    { from: '2026-11-28', to: '2026-12-06', label: 'Evening sessions', note: 'Evening training expected 11/28 → 12/06. Consecutive days are fine.' },
  ],
  review: {
    title: 'v2.4 review — recovery OK?',
    body: 'Consider +1 cluster for chest, back, side delts. Nothing is changed automatically.',
    templateIds: HOME,
    since: '2026-11-20',
    afterRotations: 2,
  },
  deloadTriggerLifts: 3,
  deloadRepsDown: 1,
  weightQuietUntil: '2026-11-26',
  checkIn: {
    date: '2026-11-26',
    title: 'Tape + photo check',
    note: 'Weigh in, tape waist + neck, take photos. 7-day average vs 10/30 (151.8 lb · waist 31.25 in · neck 14.5 in) — the numbers are on Body.',
    baseline: { date: '2026-10-30', weightLb: 151.8, waistIn: 31.25, neckIn: 14.5 },
  },
  estimatedMeals: [
    { from: '2026-11-28', to: '2026-12-06', slot: 'Lunch', note: 'Lunch can\'t be weighed 11/28 → 12/06: log it as an estimate (photo or description). Breakfast and dinner as usual.' },
  ],
};

initializeApp({ credential: applicationDefault(), projectId: PROJECT_ID });
const db = getFirestore();
const uid = (await getAuth().getUserByEmail(OWNER)).uid;
const user = db.doc(`users/${uid}`);
const now = new Date();
const stamp = now.toISOString();
const todayKey = calendarDateKey(now);

const [profileSnap, exSnap, sesSnap, tplSnap] = await Promise.all([
  user.get(), user.collection('exercises').get(), user.collection('workoutSessions').get(), user.collection('workoutTemplates').get(),
]);
const profile = profileSnap.data() ?? {};
type Row = TemplateExercise & Record<string, unknown>;
type RawTpl = { name: string; notes?: string; templateVersion?: string; exercises: Row[]; tags?: string[]; expectedMin?: number; archivedAt?: unknown } & Record<string, unknown>;
const raw = new Map(tplSnap.docs.map((d) => [d.id, d.data() as RawTpl]));
for (const id of [...HOME, ...Object.keys(TRAVEL)]) if (!raw.has(id)) throw new Error(`template ${id} missing`);
for (const id of HOME) if (raw.get(id)!.templateVersion !== 'v2.4') throw new Error(`${raw.get(id)!.name} is not v2.4`);
const catalog: Exercise[] = exSnap.docs.map((d) => toWorkoutExercise(d.id, d.data()));
const catOf = (id: string) => catalog.find((c) => c.id === id);
const dbStep = dumbbellStepLb(profile['dumbbellHalfSteps'] as boolean | undefined);
const engineCat = (id: string) => { const c = catOf(id); return c ? { ...c, dumbbellStepLb: dbStep } : null; };
const sessions = sesSnap.docs.map((d) => toWorkoutSession(d.id, d.data()));
const keyOf = (s: WorkoutSession) => calendarDateKey(s.date);

const out: string[] = [];
const say = (s = '') => out.push(s);
say(`${APPLY ? 'APPLY' : 'DRY RUN'} — uid ${uid} — ${stamp} (today ${todayKey}, ${process.env.TZ})`);

// Refuse once v2.4 has been trained: the re-entry and starting loads below
// assume no home session since the trip.
const homeSince = sessions.filter((s) => s.status === 'completed' && HOME.includes(s.templateId ?? '') && keyOf(s) >= TRIP_START);
if (homeSince.length && !(raw.get(LEG)!.notes ?? '').includes(V23_NOTE.slice(0, 40))) {
  throw new Error(`${homeSince.length} home session(s) since ${TRIP_START} — re-read before applying`);
}

const sided = (labels: ('L' | 'R')[]): PlannedSet[] => labels.flatMap((label, i) => [
  { kind: 'activation' as const, group: i + 1, label }, { kind: 'mini' as const, group: i + 1, label }, { kind: 'mini' as const, group: i + 1, label },
]);
const stable = (v: unknown): string => {
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v).filter((k) => (v as Record<string, unknown>)[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${stable((v as Record<string, unknown>)[k])}`).join(',')}}`;
  return JSON.stringify(v);
};
const strip = (r: Row) => { const { lastModifiedAt: _a, lastModifiedBy: _b, ...x } = r; return stable(x); };
const withCue = (cues: readonly string[] | undefined, add: string[], drop: string[] = []) =>
  [...(cues ?? []).filter((c) => !drop.includes(c) && !add.includes(c)), ...add];
const blockOf = (r: TemplateExercise) => (r.supersetGroup ? `${r.supersetGroup}${r.pairPosition}` : '—');
const labelsOf = (r: TemplateExercise) => r.plannedSets.filter((s) => s.kind === 'activation').map((s) => s.label ?? '').join('');
const shape = (r: TemplateExercise) => {
  const straight = r.plannedSets.filter((s) => s.kind === 'working').length;
  if (straight) return `${straight} straight`;
  const l = labelsOf(r);
  return l ? `${l.split('').join('→')} (1/side)`.replace('(1/side)', `(${clusterCount(r.plannedSets, false)}/side)`) : `${clusterCount(r.plannedSets, false)} cl${r.plannedSets.some((s) => s.kind === 'drop') ? ' +drop' : ''}`;
};
const effortOf = (r: TemplateExercise) => {
  const m = /^RIR (\d)/.exec((r.cues ?? [])[0] ?? '');
  return m ? (m[1] === '0' ? 'failure' : `RIR ${m[1]}`) : (catOf(r.exerciseId)?.effortStandard ?? '?');
};
const musclesOf = (id: string) => catOf(id)?.muscles;
/** The newest activation (or straight-set) load of a lift in a HOME session before the trip. */
const lastHome = (ex: string): number | undefined => {
  const home = sessions.filter((s) => s.status === 'completed' && HOME.includes(s.templateId ?? '') && keyOf(s) < TRIP_START && !s.notComparable && !s.deload && !s.reentry)
    .sort((a, b) => b.date.getTime() - a.date.getTime());
  for (const s of home) {
    const w = s.exercises.find((e) => e.exerciseId === ex)?.sets.find((x) => (x.kind === 'activation' || x.kind === 'working') && x.reps != null && x.weight != null)?.weight;
    if (w != null) return w;
  }
  return undefined;
};

// ── 1. v2.4 templates ──
const next = new Map<string, RawTpl>();
const changed = new Set<string>();
const fixes: Record<string, string[]> = { [LEG]: [], [PULL]: [], [PUSH]: [] };
for (const id of HOME) {
  const cur = raw.get(id)!;
  const old = (ex: string) => cur.exercises.find((e) => e.exerciseId === ex);
  let rows = cur.exercises.map((r) => structuredClone(r) as Row);
  // The calf cue, one wording on all three days.
  rows = rows.map((r) => (r.exerciseId === CALF ? { ...r, cues: withCue(r.cues, [], OLD_CALF_CUES).map((c) => c) } : r));
  rows = rows.map((r) => (r.exerciseId === CALF ? { ...r, cues: [FAIL, CALF_CUE, CALF_SIDES, ...(r.cues ?? []).filter((c) => c !== FAIL && c !== CALF_CUE && c !== CALF_SIDES)] } : r));
  if (id === PUSH) {
    rows = rows.map((r) => {
      if (r.exerciseId !== CALF || labelsOf(r) === 'LR') return r;
      fixes[PUSH].push(`B2 calf ${labelsOf(r).split('').join(' ')} (2 per leg) → L R (1 per leg)`);
      return { ...r, plannedSets: sided(['L', 'R']) };
    });
  }
  if (id === PULL && !rows.some((r) => r.exerciseId === CALF)) {
    const calfSrc = raw.get(LEG)!.exercises.find((e) => e.exerciseId === CALF)!;
    const at = rows.findIndex((r) => r.exerciseId === CRUNCH);
    const { supersetGroup: _g, pairPosition: _p, transitionRestSec: _t, roundRestSec: _r, sideSwitchSec: _s, loadLog: _l, baseline: _b, lastModifiedAt: _la, lastModifiedBy: _lb, ...base } = calfSrc as Row;
    const calf: Row = {
      ...(structuredClone(base) as Row), targetLoad: 30, plannedSets: sided(['L', 'R']), cues: [FAIL, CALF_CUE, CALF_SIDES, PENDING],
      restClusterSec: 10, restAfterSec: 15,
      loadLog: [{ at: stamp, to: 30, by: 'prompt', reason: `Program v2.4 adjusted (owner, ${DAY}): Pull E calf, 1 cluster per leg at the calf load` }],
    } as Row;
    rows.splice(at, 0, calf);
    fixes[PULL].push('E: + Single-leg DB calf raise 1 cluster per leg (L → R back to back, 10 s), 30 lb — after the seated leg curl, before the crunch (the app holds 3 per superset, so E4/E5 run as the next rows at 15 s)');
  }
  if (id === PULL) {
    rows = rows.map((r) => {
      if (r.exerciseId === PULLUP) {
        const prog = { ...(r.progression ?? {}), incrementLb: 5, targetReps: 12 } as TemplateExercise['progression'];
        if (r.progression?.incrementLb !== 5) fixes[PULL].push(`pull-up increment ${r.progression?.incrementLb} → 5 lb`);
        return { ...r, progression: prog, cues: withCue(r.cues, [PULLUP_CUE]) };
      }
      if (r.exerciseId === LAT) return { ...r, cues: withCue(r.cues, [LAT_CUE]) };
      if (r.exerciseId === CURL && r.restAfterSec !== 15) return { ...r, restAfterSec: 15 };
      return r;
    });
  }
  // A baseline-pending row starts from its last HOME load (the engine reads
  // nothing before the baseline, so the template's load is the seed): Leg
  // Extensions read 100 in the template, the last home sets were 90.
  rows = rows.map((r) => {
    if (!r.baseline || r.baseline.since < '2026-11-20') return r;
    const last = lastHome(r.exerciseId);
    if (last == null || last === r.targetLoad) return r;
    fixes[id].push(`${r.name} load ${r.targetLoad} → ${last} (last home load)`);
    return { ...r, targetLoad: last, loadLog: [...((r.loadLog as unknown[]) ?? []), { at: stamp, from: r.targetLoad, to: last, by: 'prompt', reason: `Program v2.4 adjusted (owner, ${DAY}): the last home load before the trip` }] } as Row;
  });
  rows = normalizeSupersets(rows, { keepLetters: true }) as Row[];
  // Baseline pending on the new / reshaped calf rows.
  rows = rows.map((r) => {
    if (r.exerciseId !== CALF || r.baseline?.reason === 'context changed: v2.4') return r;
    const b = contextBaseline(['superset'], { since: '2026-11-20', load: r.targetLoad, catalog: engineCat(r.exerciseId), row: r });
    return { ...r, baseline: { ...b, reason: 'context changed: v2.4' } };
  });
  rows = rows.map((r) => {
    const o = old(r.exerciseId);
    return o && strip(r) === strip(o) ? o : ({ ...r, lastModifiedAt: stamp, lastModifiedBy: 'prompt' } as Row);
  });
  let notes = cur.notes ?? '';
  if (!notes.includes(V23_NOTE.slice(0, 40))) notes = `${notes}\n${V23_NOTE}${id === LEG ? ` ${LEG_REST_NOTE}` : ''}`.trim();
  if (notes.length > 10000) throw new Error(`${cur.name}: notes ${notes.length} chars`);
  const t: RawTpl = { ...cur, exercises: rows, notes, expectedMin: EXPECTED_MIN[id] };
  if (stable(t) !== stable(cur)) changed.add(id);
  next.set(id, t);
}

// ── 2. travel templates ──
const archiveWrites: { id: string; patch: Record<string, unknown> }[] = [];
for (const [id, tags] of Object.entries(TRAVEL)) {
  const cur = raw.get(id)!;
  const patch: Record<string, unknown> = {};
  if (cur.archivedAt == null) patch['archivedAt'] = Timestamp.fromDate(now);
  if (stable(cur.tags ?? []) !== stable(tags)) patch['tags'] = tags;
  if (!(cur.notes ?? '').includes(ARCHIVE_NOTE.slice(0, 30))) patch['notes'] = `${cur.notes ?? ''}\n${ARCHIVE_NOTE}`.trim();
  if (Object.keys(patch).length) archiveWrites.push({ id, patch });
}

// ── 3. sessions of the trip ──
const tripSessions = sessions.filter((s) => s.status === 'completed' && s.exercises.length > 0 && keyOf(s) >= TRIP_START && keyOf(s) <= TRIP_END && !HOME.includes(s.templateId ?? ''));
const ncWrites = tripSessions.filter((s) => !s.notComparable);

// ── 4. catalog ──
const catWrites: { id: string; patch: Record<string, unknown> }[] = [];
for (const c of catalog) {
  const patch: Record<string, unknown> = {};
  const ctx = c.id!.startsWith('haven-') ? 'Haven' : c.id!.startsWith('airbnb-') ? 'Airbnb' : null;
  if (ctx && (!c.pickerHidden || c.context !== ctx)) { patch['pickerHidden'] = true; patch['context'] = ctx; }
  if (c.unitByGym?.['home'] === 'kg') patch['unitByGym.home'] = FieldValue.delete();
  if (c.id === PULLUP && c.loadable !== true) patch['loadable'] = true;
  if (Object.keys(patch).length) catWrites.push({ id: c.id!, patch });
}

// ── 5. trip + profile ──
const rawPeriods = (profile['travelPeriods'] ?? []) as Record<string, unknown>[];
const bolivia = rawPeriods.find((p) => p['start'] === TRIP_START && p['end'] === TRIP_END);
if (!bolivia) throw new Error('Bolivia trip not found');
const plan = (bolivia['plan'] ?? []) as Record<string, unknown>[];
const nextPlan = plan.filter((e) => (e['from'] as string) <= TRIP_END).map((e) => ((e['to'] as string) > TRIP_END ? { ...e, to: TRIP_END } : e));
const droppedPlan = plan.filter((e) => (e['from'] as string) > TRIP_END);
const clamped = plan.filter((e) => (e['from'] as string) <= TRIP_END && (e['to'] as string) > TRIP_END);
const nextPeriods = rawPeriods.map((p) => (p === bolivia ? { ...p, label: TRIP_LABEL, plan: nextPlan, reentryRules: REENTRY_RULES } : p));
const periodsChanged = stable(nextPeriods) !== stable(rawPeriods);
const planChanged = stable(profile['homePlan'] ?? null) !== stable(HOME_PLAN);
if (!homePlanOf({ homePlan: HOME_PLAN })) throw new Error('home plan does not survive its sanitizer');
const sanePeriods = travelPeriodsOf({ travelPeriods: nextPeriods });
if (sanePeriods.find((p) => p.start === TRIP_START)?.reentryRules?.length !== 2) throw new Error('reentryRules do not survive the sanitizer');

// ── REPORT ──
say('\nA. ARCHIVE (archivedAt, tags, notes line) — sessions kept');
const sesCount = (id: string) => sessions.filter((s) => s.templateId === id && s.status === 'completed').length;
for (const [id, tags] of Object.entries(TRAVEL)) {
  const cur = raw.get(id)!;
  say(`   ${cur.name.padEnd(48)} ${cur.templateVersion?.padEnd(14)} ${cur.archivedAt != null ? 'already archived' : 'ARCHIVE'} · tags ${tags.join(', ')} · sessions kept ${sesCount(id)}`);
}
say(`   home v2.3: no separate doc (Leg/Pull/Push were edited in place to v2.4 on 11/06) — v2.3 ran 10/24–10/30: ${sessions.filter((s) => HOME.includes(s.templateId ?? '') && keyOf(s) >= '2026-10-24' && keyOf(s) < TRIP_START).length} sessions, kept`);
say(`   Program v1 (Settings → Program version): the 3 v2 drafts stay; the switch-to-v1 confirm says "This will replace your v2.4 templates with Program v1"`);
say(`\n   sessions → notComparable (${ncWrites.length} of ${tripSessions.length}):`);
for (const s of tripSessions) say(`      ${keyOf(s)} ${s.templateName} ${s.notComparable ? '(already)' : '→ notComparable'}`);
say(`\n   catalog writes (${catWrites.length}):`);
for (const w of catWrites) say(`      ${w.id.padEnd(36)} ${catOf(w.id)!.name.padEnd(42)} ${Object.keys(w.patch).join(', ')}`);

say('\nB. v2.4 TEMPLATES (after)');
const after: WorkoutTemplate[] = HOME.map((id) => toWorkoutTemplate(id, next.get(id)!));
const catAfter = catalog.map((c) => (c.id === PULLUP ? { ...c, loadable: true } : c));
for (const t of after) {
  const est = estimateTemplateDuration(t, musclesOf);
  say(`\n   ${t.name} — expected ${t.expectedMin} min (app estimate of work + rest: ${est.minutes} min) · ${fixes[t.id!].length ? `FIXED: ${fixes[t.id!].join('; ')}` : 'matched'}`);
  say('   pos block exercise                                   clusters           effort    load  baseline');
  t.exercises.forEach((r, i) => say(`   ${String(i + 1).padStart(3)} ${blockOf(r).padEnd(5)} ${r.name.padEnd(40)} ${shape(r).padEnd(18)} ${effortOf(r).padEnd(9)} ${String(r.targetLoad ?? '—').padStart(4)}  ${r.baseline ? `${r.baseline.since} ${r.baseline.reason}` : '—'}`));
  const flowRows = t.exercises.map((e) => ({ ...e, sets: e.plannedSets }));
  const flow = supersetFlow(flowRows);
  say(`   flow: ${flow.map((s) => `${t.exercises[s.exerciseIndex].name.split(' ').slice(0, 2).join(' ')}${t.exercises[s.exerciseIndex].plannedSets[s.setIndices[0]]?.label ? ` ${t.exercises[s.exerciseIndex].plannedSets[s.setIndices[0]]!.label}` : ''}`).join(' → ')}`);
}
say('\n   weekly direct clusters (core plannedVolume; L/R pair = 1) vs targets');
const TARGETS: Record<string, number> = { chest: 6, back: 6, quads: 5, hamstrings: 5, calves: 3, sideDelt: 3, rearDelt: 2, biceps: 2, triceps: 2, abs: 4 };
const vol = new Map(plannedVolume(after, catAfter).map((m) => [m.muscle, m]));
for (const [m, tgt] of Object.entries(TARGETS)) {
  const d = vol.get(m as never)?.direct ?? 0;
  say(`      ${m.padEnd(11)} ${String(d).padStart(3)} / ${tgt} ${d === tgt ? 'on target' : d < tgt ? 'UNDER' : `+${d - tgt}`}`);
}

say('\nC. RE-ENTRY — first session of each template (engine call from HOME history only, trip sessions not comparable)');
const completedAfter = sessions.map((s) => (tripSessions.includes(s) ? { ...s, notComparable: true } : s)).filter((s) => s.status === 'completed').sort((a, b) => b.date.getTime() - a.date.getTime());
const period = sanePeriods.find((p) => p.start === TRIP_START)!;
for (const t of after) {
  const rule = reentryRuleFor('post-travel', t.id, period);
  say(`\n   ${t.name}: "${rule.label}" — −${rule.loadPct}%, ${rule.rir != null ? `RIR ${rule.rir} on every set` : 'normal effort'}`);
  for (const r of t.exercises) {
    const call = sessionCall(r, completedAfter, engineCat(r.exerciseId));
    const seed = call.rec.action !== 'none' && call.rec.load != null ? call.rec.load : (r.targetLoad ?? 0);
    const { config } = recommendOptionsFor(r, engineCat(r.exerciseId));
    const step = { loadSteps: config?.loadSteps, stepLb: config?.stepLb ?? 5, loadGrid: config?.loadGrid, assisted: catOf(r.exerciseId)?.assisted === true };
    const load = reentryLoad(seed, step, 1 - rule.loadPct / 100, rule.round);
    const pending = r.baseline && r.baseline.since >= '2026-11-20' ? ' (baseline pending)' : '';
    say(`      ${r.name.padEnd(40)} ${String(seed).padStart(5)} → ${String(load).padStart(5)} lb${seed === 0 ? ' (bodyweight)' : load === seed ? ' (no smaller step within 5%)' : ''}${pending} · last home ${lastHome(r.exerciseId) ?? '—'}`);
  }
}

say('\nD. TRIP + PROFILE');
say(`   trip label "${bolivia['label']}" → "${TRIP_LABEL}"`);
say(`   plan entries removed (after ${TRIP_END}): ${droppedPlan.map((e) => `${e['from']} "${e['label']}"`).join('; ') || 'none'}`);
say(`   plan entries ending ${TRIP_END} now: ${clamped.map((e) => `"${e['label']}" (was to ${e['to']})`).join('; ') || 'none'}`);
say(`   reentryRules: ${REENTRY_RULES.map((r) => `${r.templateIds.map((i) => raw.get(i)!.name).join('+')} −${r.loadPct}% ${r.rir != null ? `RIR ${r.rir}` : 'normal'}`).join(' · ')}`);
say(`   targets: ${profile['manualCaloriesTarget']} kcal / ${profile['manualProteinTarget']} g (${profile['targetMode']}) — unchanged; unitSystem ${profile['unitSystem']}`);
say(`   homePlan: ${planChanged ? 'WRITE' : 'unchanged'} — ${JSON.stringify(HOME_PLAN).length} chars`);

const dir = join(homedir(), 'ignia-backups');
const backup = join(dir, `owner-data-2026-11-19-v2-4-lock-${stamp.replace(/[:.]/g, '-')}.json`);
say(`\nBackup: ${APPLY ? '' : '(would write) '}${backup}`);
say(`SUMMARY: ${changed.size} home template(s) [${[...changed].map((i) => raw.get(i)!.name).join(', ')}] · ${archiveWrites.length} travel template write(s) · ${ncWrites.length} session(s) · ${catWrites.length} catalog write(s) · profile: travelPeriods ${periodsChanged ? 'WRITE' : '—'}, homePlan ${planChanged ? 'WRITE' : '—'}. users/${uid} only.`);
console.log(out.join('\n'));

if (!APPLY) { console.log('\nDry run. --apply to write (deploy the 2026-11-19 firestore.rules first).'); process.exit(0); }
const total = changed.size + archiveWrites.length + ncWrites.length + catWrites.length + (periodsChanged || planChanged ? 1 : 0);
if (total === 0) { console.log('\nNothing to do (already applied).'); process.exit(0); }

const conv = (v: unknown): unknown => {
  if (v instanceof Timestamp) return v.toDate().toISOString();
  if (Array.isArray(v)) return v.map(conv);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, conv(x)]));
  return v;
};
mkdirSync(dir, { recursive: true });
writeFileSync(backup, JSON.stringify(conv({
  uid,
  templates: Object.fromEntries([...changed, ...archiveWrites.map((w) => w.id)].map((id) => [id, raw.get(id)])),
  sessions: Object.fromEntries(ncWrites.map((s) => [s.id, sesSnap.docs.find((d) => d.id === s.id)!.data()])),
  exercises: Object.fromEntries(catWrites.map((w) => [w.id, exSnap.docs.find((d) => d.id === w.id)!.data()])),
  profile: { travelPeriods: profile['travelPeriods'] ?? null, homePlan: profile['homePlan'] ?? null },
}), null, 1));
if (!existsSync(backup)) throw new Error('backup not written — refusing to write');
console.log(`backup written: ${backup}`);

const batch = db.batch();
const ts = Timestamp.fromDate(now);
for (const id of changed) {
  const t = next.get(id)!;
  batch.update(user.collection('workoutTemplates').doc(id), { exercises: JSON.parse(JSON.stringify(t.exercises)), notes: t.notes, expectedMin: t.expectedMin, updatedAt: ts });
}
for (const w of archiveWrites) batch.update(user.collection('workoutTemplates').doc(w.id), { ...w.patch, updatedAt: ts });
for (const s of ncWrites) batch.update(user.collection('workoutSessions').doc(s.id!), { notComparable: true, updatedAt: ts });
for (const w of catWrites) batch.update(user.collection('exercises').doc(w.id), w.patch);
const profilePatch: Record<string, unknown> = {};
if (periodsChanged) profilePatch['travelPeriods'] = JSON.parse(JSON.stringify(nextPeriods));
if (planChanged) profilePatch['homePlan'] = JSON.parse(JSON.stringify(HOME_PLAN));
if (Object.keys(profilePatch).length) batch.update(user, profilePatch);
await batch.commit();
console.log(`written: ${total} doc(s), all under users/${uid}`);
