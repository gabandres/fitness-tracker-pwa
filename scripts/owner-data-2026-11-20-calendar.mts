/**
 * Owner data, 2026-11-20 (America/Puerto_Rico): the calendar for late November
 * and early December.
 *
 *   HOME PLAN  dated notes replaced: no training 11/20 → 11/22; the re-entry
 *              week (Mon Leg −10 % RIR 2 · Wed Pull · Fri Push −5 %, normal
 *              effort); "local trip — no gym" 11/28 → 11/29 and 12/01 → 12/06;
 *              Mon 11/30 Leg at normal loads (second rotation); Travel A
 *              optional 12/02 and 12/05; Mon 12/07 Pull, no reduction.
 *              Review: counts from 11/30 (the first NORMAL rotation), still 2
 *              rotations — so not before mid-December. No weight alerts before
 *              12/10. Check-in stays Thu 11/26 vs 10/30. Any meal may be an
 *              estimate 11/28 → 12/06. `nutrition`: protein first (140 g,
 *              floor 120) and calories as a range (1,850–2,150) for those days
 *              (core `home-plan.ts` `nutritionWindowToday`; an app without
 *              that reader ignores the field).
 *   WAIVER     a `volumeOk` note 11/19 → 12/06 on the Bolivia trip's plan (the
 *              only place core `volumeWaiver` reads): no under-target volume
 *              warning for the weeks of 11/23 and 11/30, nor for the rest of
 *              this one.
 *   TRAVEL A   restored from the archive as an optional ≈20-min bodyweight
 *              session: push-up 3, backpack / towel row 3, split squat 2 per
 *              leg, hollow-body extension 2 — near failure. Its eight-row
 *              shape is in the backup and in a notes line. One new catalog
 *              lift (Hollow-body Extension).
 *
 * The two local trips are NOT travel periods on purpose: a travel period
 * freezes the maintenance estimate, drops its weigh-ins from the average and
 * makes the next session of every template a re-entry session — and 12/07 is
 * to run at normal loads.
 *
 * DRY RUN unless `--apply`; backed up first; a re-run is a no-op. Touches
 * `users/{owner}` only.
 *
 *   TZ=America/Puerto_Rico npx jiti scripts/owner-data-2026-11-20-calendar.mts [--apply]
 *
 * Auth: ADC (`gcloud auth application-default login`).
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue, getFirestore, Timestamp } from 'firebase-admin/firestore';
import type { Exercise, TemplateExercise, WorkoutSession, WorkoutTemplate } from '../packages/core/src/workout.ts';
import {
  addDays,
  calendarDateKey,
  dumbbellStepLb,
  estimateTemplateDuration,
  homePlanOf,
  MIDNIGHT,
  parseYmd,
  recommendOptionsFor,
  reentryFor,
  reentryLoad,
  reentryRuleFor,
  reviewRotations,
  sessionCall,
  toWorkoutExercise,
  toWorkoutSession,
  toWorkoutTemplate,
  travelPeriodsOf,
  volumeWaiver,
  weightAlertsQuiet,
  type HomePlan,
} from '../packages/core/src/index.ts';

const PROJECT_ID = 'fitness-tracker-gb-1775407101';
const OWNER = 'gabrielandresbermudez@gmail.com';
const APPLY = process.argv.includes('--apply');
if (process.env.TZ !== 'America/Puerto_Rico') throw new Error('run with TZ=America/Puerto_Rico');

const DAY = '2026-11-20';
const TRIP_START = '2026-10-31';
const TRIP_END = '2026-11-18';
const LEG = 'quxwARQlCnItzpLJgcr4';
const PULL = 'aliWJBD2FND6mU9foLdC';
const PUSH = 'Nx1bxeRuH6bMnGgX7Trv';
const HOME = [LEG, PULL, PUSH];
const TRAVEL_A = 'travel-a-full-body';
const HOLLOW = 'travel-hollow-body-extension';
const AWAY = 'local trip — no gym';
const NEAR = 'Near failure — stop at RIR 0–1. Log reps + RIR on the last set.';
const OLD_EFFORT = 'RIR 1 — stop 1 rep before failure. Log reps + RIR on the last set.';
const A_NOTE = `${DAY} - Restored from the archive as an OPTIONAL ≈20-min bodyweight session for 12/02 and 12/05 (local trip, no gym): push-up 3 · backpack / towel row 3 · split squat 2 per leg · hollow-body extension 2, all near failure. Not logging it is fine. Before this it had 8 rows (push-up 3, split squat 3, row 3, pike push-up 2, glute bridge 2, crunch 2, band curl 2, band pull-apart 2).`;

/** The schedule this plan describes — used for the report and to check the
 *  engine agrees (which sessions are re-entry), never written as-is. */
const SCHEDULE: { date: string; templateId: string; what: string }[] = [
  { date: '2026-11-23', templateId: LEG, what: 'Leg Day' },
  { date: '2026-11-25', templateId: PULL, what: 'Pull Day' },
  { date: '2026-11-27', templateId: PUSH, what: 'Push Day' },
  { date: '2026-11-30', templateId: LEG, what: 'Leg Day' },
  { date: '2026-12-07', templateId: PULL, what: 'Pull Day' },
];
const OPTIONAL = ['2026-12-02', '2026-12-05'];
const AWAY_SPANS = [{ from: '2026-11-28', to: '2026-11-29' }, { from: '2026-12-01', to: '2026-12-06' }];
const A_LINE = '≈20 min, bodyweight: push-up 3 · backpack or towel row 3 · split squat 2 per leg · hollow-body extension 2 — all near failure. Train → Templates → Travel A. Not logging it is fine.';

const WAIVER = {
  from: '2026-11-19', to: '2026-12-06', kind: 'note', volumeOk: true,
  label: 'Re-entry + local trip — OK',
  note: 'No volume targets through 12/06: rest 11/20–11/22, the re-entry rotation, then away 11/28–11/29 and 12/01–12/06.',
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
type RawTpl = { name: string; notes?: string; templateVersion?: string; exercises: Row[]; tags?: string[]; expectedMin?: number; archivedAt?: unknown; createdAt?: Timestamp } & Record<string, unknown>;
const raw = new Map(tplSnap.docs.map((d) => [d.id, d.data() as RawTpl]));
for (const id of [...HOME, TRAVEL_A]) if (!raw.has(id)) throw new Error(`template ${id} missing`);
const catalog: Exercise[] = exSnap.docs.map((d) => toWorkoutExercise(d.id, d.data()));
const catOf = (id: string) => catalog.find((c) => c.id === id);
const dbStep = dumbbellStepLb(profile['dumbbellHalfSteps'] as boolean | undefined);
const engineCat = (id: string) => { const c = catOf(id); return c ? { ...c, dumbbellStepLb: dbStep } : null; };
const sessions = sesSnap.docs.map((d) => toWorkoutSession(d.id, d.data()));
const keyOf = (s: WorkoutSession) => calendarDateKey(s.date);

const out: string[] = [];
const say = (s = '') => out.push(s);
say(`${APPLY ? 'APPLY' : 'DRY RUN'} — uid ${uid} — ${stamp} (today ${todayKey}, ${process.env.TZ})`);

// The plan assumes nothing has been trained at home since the trip.
const homeSince = sessions.filter((s) => s.status === 'completed' && HOME.includes(s.templateId ?? '') && keyOf(s) > TRIP_END);
const alreadyApplied = (raw.get(TRAVEL_A)!.notes ?? '').includes(A_NOTE.slice(0, 40));
if (homeSince.length && !alreadyApplied) throw new Error(`${homeSince.length} home session(s) since ${TRIP_END} — re-read before applying`);

const stable = (v: unknown): string => {
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v).filter((k) => (v as Record<string, unknown>)[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${stable((v as Record<string, unknown>)[k])}`).join(',')}}`;
  return JSON.stringify(v);
};

// ── 1. home plan ──
const prevPlan = (profile['homePlan'] ?? {}) as Record<string, unknown>;
const prevReview = (prevPlan['review'] ?? {}) as Record<string, unknown>;
const HOME_PLAN: HomePlan & { nutrition: Record<string, unknown>[] } = {
  label: 'Home v2.4 — Leg → Pull → Push',
  trainingDays: [1, 3, 5],
  notes: [
    { from: '2026-11-20', to: '2026-11-22', label: 'No training 11/20 → 11/22', note: 'Rest. Nothing is scheduled and nothing is flagged. Weigh-ins start Mon 11/23.' },
    { from: '2026-11-23', to: '2026-11-27', label: 'Re-entry week — Mon Leg · Wed Pull · Fri Push', note: 'Leg: −10% of the last home load, RIR 2 on every set, no failure. Pull and Push: −5% on activation sets, normal effort. Whenever they are logged; no regression flags this rotation.' },
    { from: '2026-11-28', to: '2026-11-29', label: AWAY, note: 'Away 11/28 → 11/29. No session expected; nothing is flagged.' },
    { from: '2026-11-30', to: '2026-11-30', label: 'Mon 11/30 — Leg Day, normal', note: 'Normal loads and effort. The second rotation starts here.' },
    { from: '2026-12-01', to: '2026-12-06', label: AWAY, note: 'Away 12/01 → 12/06. No session expected; nothing is flagged. Travel A is optional on Wed 12/02 and Sat 12/05.' },
    { from: '2026-12-02', to: '2026-12-02', label: 'Wed 12/02 — Travel A (optional)', note: A_LINE },
    { from: '2026-12-05', to: '2026-12-05', label: 'Sat 12/05 — Travel A (optional)', note: A_LINE },
    { from: '2026-12-07', to: '2026-12-08', label: 'Mon 12/07 — Pull Day, v2.4 resumes', note: 'Continuing the rotation (then Push, then Leg). Normal effort, same loads as the last home session of each lift — no reduction.' },
  ],
  review: {
    title: 'v2.4 review — recovery OK?',
    body: 'Two full normal rotations at home are done. Consider +1 cluster for chest, back, side delts. Nothing is changed automatically.',
    templateIds: HOME,
    // The re-entry rotation (11/23–11/27) never counts; 11/30 opens the first
    // normal one. Two of them cannot finish before mid-December.
    since: '2026-11-30',
    afterRotations: 2,
    ...(typeof prevReview['dismissedAt'] === 'string' ? { dismissedAt: prevReview['dismissedAt'] as string } : {}),
  },
  deloadTriggerLifts: 3,
  deloadRepsDown: 1,
  weightQuietUntil: '2026-12-10',
  checkIn: {
    date: '2026-11-26',
    title: 'Tape + photo check',
    note: 'Weigh in, tape waist + neck, take photos. Average of the weigh-ins since Mon 11/23 vs 10/30 (151.8 lb · waist 31.25 in · neck 14.5 in) — the numbers are on Body.',
    baseline: { date: '2026-10-30', weightLb: 151.8, waistIn: 31.25, neckIn: 14.5 },
  },
  estimatedMeals: [
    { from: '2026-11-28', to: '2026-12-06', slot: 'Meal', note: 'Away 11/28 → 12/06: any meal can be logged as an estimate (photo or description). Protein first — 140 g, floor 120. Calories 1,850–2,150.' },
  ],
  nutrition: [
    { from: '2026-11-28', to: '2026-12-06', proteinTarget: 140, proteinFloor: 120, kcalMin: 1850, kcalMax: 2150, note: 'Protein first while away. Calories are a range; nothing is flagged.' },
  ],
};
const sanePlan = homePlanOf({ homePlan: HOME_PLAN });
if (!sanePlan || sanePlan.notes?.length !== HOME_PLAN.notes!.length || !sanePlan.review || !sanePlan.checkIn || !sanePlan.estimatedMeals) throw new Error('home plan does not survive its sanitizer');
if (Object.keys(HOME_PLAN).length > 12) throw new Error('homePlan has more than 12 keys (rules cap)');
const planChanged = stable(profile['homePlan'] ?? null) !== stable(HOME_PLAN);

// ── 2. the volume waiver, on the Bolivia trip's plan ──
const rawPeriods = (profile['travelPeriods'] ?? []) as Record<string, unknown>[];
const bolivia = rawPeriods.find((p) => p['start'] === TRIP_START && p['end'] === TRIP_END);
if (!bolivia) throw new Error('Bolivia trip not found');
const plan = (bolivia['plan'] ?? []) as Record<string, unknown>[];
const hasWaiver = plan.some((e) => e['label'] === WAIVER.label && e['from'] === WAIVER.from && e['to'] === WAIVER.to && e['volumeOk'] === true);
const nextPeriods = rawPeriods.map((p) => (p === bolivia && !hasWaiver ? { ...p, plan: [...plan, WAIVER] } : p));
const periodsChanged = !hasWaiver;
const sanePeriods = travelPeriodsOf({ travelPeriods: nextPeriods });
for (const d of ['2026-11-20', '2026-11-23', '2026-11-30', '2026-12-06']) {
  if (!volumeWaiver(sanePeriods, d)) throw new Error(`no volume waiver on ${d}`);
}
if (volumeWaiver(sanePeriods, '2026-12-07')) throw new Error('the waiver runs past 12/06');
if (sanePeriods.length !== travelPeriodsOf({ travelPeriods: rawPeriods }).length) throw new Error('a travel period was lost');

// ── 3. Travel A ──
const a = raw.get(TRAVEL_A)!;
const rowOf = (id: string) => { const r = a.exercises.find((e) => e.exerciseId === id); if (!r) throw new Error(`Travel A has no ${id}`); return structuredClone(r) as Row; };
const nearFailure = (r: Row): Row => ({ ...r, cues: [NEAR, ...(r.cues ?? []).filter((c) => c !== OLD_EFFORT && c !== NEAR)] });
const keepOrStamp = (r: Row): Row => {
  const old = a.exercises.find((e) => e.exerciseId === r.exerciseId);
  const strip = (x: Row) => { const { lastModifiedAt: _a, lastModifiedBy: _b, ...rest } = x; return stable(rest); };
  return old && strip(old as Row) === strip(r) ? (old as Row) : ({ ...r, lastModifiedAt: stamp, lastModifiedBy: 'prompt' } as Row);
};
const existingHollow = a.exercises.find((e) => e.exerciseId === HOLLOW) as Row | undefined;
const split = rowOf('travel-bulgarian-split-squat');
const aRows: Row[] = [
  nearFailure(rowOf('travel-deficit-push-up')),
  nearFailure(rowOf('travel-backpack-row')),
  nearFailure({ ...split, plannedSets: split.plannedSets.slice(0, 2), cues: (split.cues ?? []).map((c) => (c.startsWith('Rear foot on the bed') ? 'Rear foot on the bed or a chair, or both feet on the floor; backpack optional.' : c)) }),
  existingHollow ? structuredClone(existingHollow) : ({
    exerciseId: HOLLOW, name: 'Hollow-body Extension', targetLoad: 0, logStyle: 'weight-reps', setStructure: 'straight',
    plannedSets: [{ kind: 'working' }, { kind: 'working' }],
    progression: { targetReps: 15, holdSessions: 1, incrementLb: 5 },
    ladder: { capReps: 15 },
    cues: [NEAR, 'On your back: ribs down, lower back pressed to the floor. Reach arms overhead and legs long, as low as you can hold the hollow, then back in. One rep = out and back.', 'Bodyweight: load 0.', 'At 15+ reps on a set → next time harder: 3 s out, 1 s pause at full reach.'],
    restMiniSec: 60, restAfterSec: 60,
  } as unknown as Row),
].map(keepOrStamp);
const aNotes = (a.notes ?? '').includes(A_NOTE.slice(0, 40)) ? (a.notes ?? '') : `${a.notes ?? ''}\n${A_NOTE}`.trim();
if (aNotes.length > 10000) throw new Error(`Travel A notes ${aNotes.length} chars`);
const aNext: RawTpl = { ...a, exercises: aRows, notes: aNotes, expectedMin: 20 };
delete aNext.archivedAt;
const aChanged = stable(aNext) !== stable(a) || a.archivedAt != null;
const hollowMissing = !catOf(HOLLOW);
const HOLLOW_DOC = { name: 'Hollow-body Extension', muscles: ['core'], defaultCues: [], logStyle: 'weight-reps', effortStandard: 'rir1', setStructure: 'straight' };

// ── REPORT ──
say('\nA. HOME PLAN');
say(`   ${planChanged ? 'WRITE' : 'unchanged'} — ${Object.keys(HOME_PLAN).length} keys, ${JSON.stringify(HOME_PLAN).length} chars`);
for (const n of HOME_PLAN.notes!) say(`   ${n.from} → ${n.to}  ${n.label}`);
say(`   review: since ${HOME_PLAN.review!.since}, after ${HOME_PLAN.review!.afterRotations} normal rotations (was since ${prevReview['since'] ?? '—'})`);
say(`   weight alerts quiet until ${HOME_PLAN.weightQuietUntil} (was ${prevPlan['weightQuietUntil'] ?? '—'}) · check-in ${HOME_PLAN.checkIn!.date} vs ${HOME_PLAN.checkIn!.baseline.date}`);
say(`   estimated meals ${HOME_PLAN.estimatedMeals![0].from} → ${HOME_PLAN.estimatedMeals![0].to} (any meal) · nutrition window ${JSON.stringify(HOME_PLAN.nutrition[0])}`);
say(`   targets on the profile (unchanged): ${profile['manualCaloriesTarget']} kcal / ${profile['manualProteinTarget']} g (${profile['targetMode']})`);

say('\nB. VOLUME WAIVER');
say(`   ${periodsChanged ? 'WRITE' : 'already there'} — "${WAIVER.label}" ${WAIVER.from} → ${WAIVER.to} on the "${bolivia['label']}" plan (${plan.length} → ${plan.length + (periodsChanged ? 1 : 0)} entries)`);

say('\nC. TRAVEL A');
const aTpl: WorkoutTemplate = toWorkoutTemplate(TRAVEL_A, aNext);
const est = estimateTemplateDuration(aTpl, (id) => (id === HOLLOW ? ['core'] as never : catOf(id)?.muscles));
say(`   ${a.archivedAt != null ? 'RESTORE (archivedAt removed)' : 'already active'} · rows ${a.exercises.length} → ${aRows.length} · expected ${aNext.expectedMin} min (app estimate of work + rest: ${est.minutes} min) · tags ${JSON.stringify(a.tags ?? [])}`);
for (const r of aRows) say(`      ${r.name.padEnd(30)} ${r.plannedSets.length} sets · ${(r.cues ?? [])[0]}`);
say(`   catalog: ${hollowMissing ? `CREATE ${HOLLOW} (Hollow-body Extension, core)` : 'Hollow-body Extension already there'}`);
say(`   removed rows (kept in the backup, in the catalog and in every past session): ${a.exercises.filter((e) => !aRows.some((r) => r.exerciseId === e.exerciseId)).map((e) => e.name).join(', ') || 'none'}`);

say('\nD. WHAT THE ENGINE WILL DO (each scheduled session, the earlier ones assumed done)');
const period = sanePeriods.find((p) => p.start === TRIP_START)!;
const travelIds = new Set([...raw.entries()].filter(([, t]) => typeof t.templateVersion === 'string' && t.templateVersion.startsWith('travel')).map(([id]) => id));
const completed = sessions.filter((s) => s.status === 'completed').sort((x, y) => y.date.getTime() - x.date.getTime());
const simulated: WorkoutSession[] = [...sessions];
const verdict = new Map<string, string>();
for (const s of SCHEDULE) {
  const kind = reentryFor({ templateId: s.templateId, today: s.date, sessions: simulated, periods: sanePeriods, travelTemplateIds: travelIds, templateCreatedAt: raw.get(s.templateId)!.createdAt?.toDate(), boundary: MIDNIGHT });
  const rule = kind ? reentryRuleFor(kind, s.templateId, period) : null;
  const text = rule ? `re-entry: −${rule.loadPct}%, ${rule.rir != null ? `RIR ${rule.rir}` : 'normal effort'}` : 'normal loads and effort';
  verdict.set(s.date, text);
  say(`   ${s.date} ${s.what.padEnd(9)} → ${text}`);
  if (rule) {
    const t = toWorkoutTemplate(s.templateId, raw.get(s.templateId)!);
    const lines = t.exercises.map((r) => {
      const call = sessionCall(r, completed, engineCat(r.exerciseId));
      const seed = call.rec.action !== 'none' && call.rec.load != null ? call.rec.load : (r.targetLoad ?? 0);
      const { config } = recommendOptionsFor(r, engineCat(r.exerciseId));
      const step = { loadSteps: config?.loadSteps, stepLb: config?.stepLb ?? 5, loadGrid: config?.loadGrid, assisted: catOf(r.exerciseId)?.assisted === true };
      const load = reentryLoad(seed, step, 1 - rule.loadPct / 100, rule.round);
      return seed === 0 ? `${r.name} bodyweight` : `${r.name} ${seed}→${load}`;
    });
    say(`      ${lines.join(' · ')}`);
  }
  simulated.push({ id: `sim-${s.date}`, status: 'completed', date: new Date(`${s.date}T18:00:00`), templateId: s.templateId, templateName: s.what, exercises: [{ exerciseId: 'x', name: 'x', cues: [], sets: [] }], ...(kind ? { reentry: kind } : {}) } as unknown as WorkoutSession);
}
const rot = reviewRotations(HOME_PLAN.review!, simulated, MIDNIGHT);
say(`   review after this schedule (through 12/07): ${rot} of ${HOME_PLAN.review!.afterRotations} normal rotations → ${rot >= HOME_PLAN.review!.afterRotations ? 'WOULD SHOW' : 'not shown'}`);
if (rot >= HOME_PLAN.review!.afterRotations) throw new Error('the review would show before mid-December');
if (verdict.get('2026-11-30') !== 'normal loads and effort' || verdict.get('2026-12-07') !== 'normal loads and effort') throw new Error('11/30 or 12/07 would be a re-entry session');
if (!verdict.get('2026-11-23')?.includes('−10%') || !verdict.get('2026-11-25')?.includes('−5%') || !verdict.get('2026-11-27')?.includes('−5%')) throw new Error('the re-entry week does not match');

say('\nE. CALENDAR 2026-11-20 → 2026-12-08');
const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
for (let d = parseYmd('2026-11-20'); calendarDateKey(d) <= '2026-12-08'; d = addDays(d, 1)) {
  const k = calendarDateKey(d);
  const ses = SCHEDULE.find((s) => s.date === k);
  const away = AWAY_SPANS.some((s) => k >= s.from && k <= s.to);
  const train = ses ? `${ses.what} — ${verdict.get(k)}` : OPTIONAL.includes(k) ? `${AWAY} · Travel A optional (≈20 min)` : away ? AWAY : k <= '2026-11-22' ? 'no training' : 'rest';
  const nut = HOME_PLAN.nutrition.some((n) => k >= (n['from'] as string) && k <= (n['to'] as string)) ? 'protein 140 g (floor 120) · 1,850–2,150 kcal · estimates OK' : `${profile['manualCaloriesTarget']} kcal · ${profile['manualProteinTarget']} g`;
  const body = [k >= '2026-11-23' ? 'weigh-in' : null, k === '2026-11-26' ? 'TAPE + PHOTO vs 10/30' : null, weightAlertsQuiet(sanePlan, k) ? 'no weight alerts' : null].filter(Boolean).join(' · ');
  say(`   ${WD[d.getDay()]} ${k.slice(5)} | ${train.padEnd(58)} | ${nut.padEnd(58)} | ${body}${volumeWaiver(sanePeriods, k) ? ' · volume waived' : ''}`);
}

const dir = join(homedir(), 'ignia-backups');
const backup = join(dir, `owner-data-2026-11-20-calendar-${stamp.replace(/[:.]/g, '-')}.json`);
say(`\nBackup: ${APPLY ? '' : '(would write) '}${backup}`);
say(`SUMMARY: profile: homePlan ${planChanged ? 'WRITE' : '—'}, travelPeriods ${periodsChanged ? 'WRITE' : '—'} · Travel A ${aChanged ? 'WRITE' : '—'} · catalog ${hollowMissing ? '1 create' : '—'}. users/${uid} only.`);
console.log(out.join('\n'));

if (!APPLY) { console.log('\nDry run. --apply to write.'); process.exit(0); }
const total = (planChanged || periodsChanged ? 1 : 0) + (aChanged ? 1 : 0) + (hollowMissing ? 1 : 0);
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
  templates: { [TRAVEL_A]: a },
  profile: { travelPeriods: profile['travelPeriods'] ?? null, homePlan: profile['homePlan'] ?? null },
}), null, 1));
if (!existsSync(backup)) throw new Error('backup not written — refusing to write');
console.log(`backup written: ${backup}`);

const batch = db.batch();
const ts = Timestamp.fromDate(now);
if (hollowMissing) batch.set(user.collection('exercises').doc(HOLLOW), { ...HOLLOW_DOC, createdAt: ts });
if (aChanged) batch.update(user.collection('workoutTemplates').doc(TRAVEL_A), { exercises: JSON.parse(JSON.stringify(aRows)), notes: aNotes, expectedMin: 20, archivedAt: FieldValue.delete(), updatedAt: ts });
const profilePatch: Record<string, unknown> = {};
if (periodsChanged) profilePatch['travelPeriods'] = JSON.parse(JSON.stringify(nextPeriods));
if (planChanged) profilePatch['homePlan'] = JSON.parse(JSON.stringify(HOME_PLAN));
if (Object.keys(profilePatch).length) batch.update(user, profilePatch);
await batch.commit();
console.log(`written: ${total} doc(s), all under users/${uid}`);
