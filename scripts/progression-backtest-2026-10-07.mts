/**
 * READ-ONLY backtest of the 2026-10-07 progression rules on the owner's log.
 *
 * For every completed template session from 2026-09-16 on (sets on or before
 * 2026-09-15 carry `legacyEffortStandard` and the engine skips them), it runs
 * `recommend()` on the history UP TO AND INCLUDING that session — the call the
 * finish sheet would have shown — and sets it beside what the template and
 * the lifter actually did next time: the next session's snapshotted
 * `targetLoad` (the template's value at start), the load performed, and the
 * old engine's frozen call on that session.
 *
 * Then the call for the NEXT Leg, Pull and Push sessions, from all history.
 *
 * Configuration is the live catalog plus `EQUIPMENT` below — load steps the
 * owner stated on 2026-10-07 that are not in the catalog yet. Nothing else is
 * assumed; a stack with no steps falls back to its template increment and the
 * output marks it `steps?`.
 *
 *   npx jiti scripts/progression-backtest-2026-10-07.mts --email gabrielandresbermudez@gmail.com [--json out.json]
 *
 * Auth: ADC (`gcloud auth application-default login`). Writes nothing.
 */
import { writeFileSync } from 'node:fs';
import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import {
  type Exercise,
  type Recommendation,
  type SessionExercise,
  type WorkoutSession,
  type WorkoutTemplate,
  exerciseHistory,
  progressionCall,
  recommend,
  recommendOptionsFor,
  toWorkoutExercise,
  toWorkoutSession,
  toWorkoutTemplate,
} from '../packages/core/src/index.ts';

const PROJECT_ID = 'fitness-tracker-gb-1775407101';
const FROM = '2026-09-16';
const TZ = 'America/Puerto_Rico';
/** Load steps the owner stated (2026-10-07), keyed by exercise name. */
const EQUIPMENT: Record<string, Partial<Exercise>> = {
  'Leg Extensions': { availableLoads: [70, 80, 90] },
  'Leg Curls': { availableLoads: [70, 80, 90] },
};

const argv = process.argv.slice(2);
const arg = (n: string) => { const i = argv.indexOf(`--${n}`); return i === -1 ? null : argv[i + 1]; };
const email = arg('email');
let uid = arg('uid');
if (!email && !uid) { console.error('usage: … (--email <email> | --uid <uid>) [--json <file>]'); process.exit(2); }

initializeApp({ credential: applicationDefault(), projectId: PROJECT_ID });
const db = getFirestore();
if (!uid) uid = (await getAuth().getUserByEmail(email!)).uid;
const user = db.collection('users').doc(uid);

const [sessSnap, tplSnap, exSnap] = await Promise.all([
  user.collection('workoutSessions').get(),
  user.collection('workoutTemplates').get(),
  user.collection('exercises').get(),
]);
const sessions: WorkoutSession[] = sessSnap.docs.map((d) => toWorkoutSession(d.id, d.data()))
  .filter((s) => s.status === 'completed')
  .sort((a, b) => b.date.getTime() - a.date.getTime()); // newest first, like the app
const templates: WorkoutTemplate[] = tplSnap.docs.map((d) => toWorkoutTemplate(d.id, d.data()));
const catalog: Exercise[] = exSnap.docs.map((d) => {
  const e = toWorkoutExercise(d.id, d.data());
  return { ...e, ...(EQUIPMENT[e.name] ?? {}) };
});

const day = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: TZ });
const fmtLoad = (n: number | undefined) => (n == null ? '–' : String(n));
const activationLoad = (ex: SessionExercise | undefined) => ex?.sets.find((s) => s.kind === 'activation' && s.reps != null)?.weight;
const acts = (ex: SessionExercise) => ex.sets
  .filter((s) => s.kind === 'activation' && s.reps != null)
  .map((s) => `${s.reps}${s.rir != null ? `@${s.rir}` : ''}`).join('/');

/** The call as one line: "Increase → 90 (~9)", "Hold 100 · ≥12", … */
function callText(rec: Recommendation): string {
  const call = progressionCall(rec);
  const load = fmtLoad(rec.load);
  const r = rec.reason;
  const target = rec.targetReps != null ? ` · ≥${rec.targetReps}` : '';
  const approx = rec.approximate ? ' ≈' : '';
  const steps = rec.config?.stepsUnknown && call === 'increase' ? ' steps?' : '';
  switch (call) {
    case 'increase': return `Increase → ${load}${rec.predictedReps != null ? ` (~${rec.predictedReps})` : ''}${approx}${steps}`;
    case 'drop': return `Drop → ${load}`;
    case 'repeat-invalid': return `Repeat ${load} (invalid: ${r.kind === 'invalid' ? r.reason : '?'})`;
    case 'stalled': return `Stalled ${load}${target} [${rec.stall?.sessions}]`;
    case 'start': return 'Start (no history)';
    case 'none': return 'none';
    case 'hold': {
      const why = r.kind === 'step-too-big' ? ` (step ${r.nextLoad} → ~${r.predictedReps})`
        : r.kind === 'at-rep-cap' ? ` (cap: ${r.techniques.join('+')})`
          : r.kind === 'no-next-step' ? ' (no heavier step)'
            : r.kind === 'bodyweight-variation' ? ' (harder variation)' : '';
      return `Hold ${load}${target}${why}${approx}`;
    }
  }
}

function recFor(history: SessionExercise[], tplRow: WorkoutTemplate['exercises'][number] | undefined, tpl: WorkoutTemplate | undefined, priorSessions: WorkoutSession[]) {
  const cat = catalog.find((e) => e.id === (tplRow?.exerciseId ?? history[0]?.exerciseId)) ?? null;
  const opts = tplRow ? recommendOptionsFor(tplRow, cat) : recommendOptionsFor(null, cat, history[0]?.sets);
  const sleeps = priorSessions.map((s) => s.sleepHours).filter((h): h is number => h != null).slice(0, 3);
  return recommend(history, {
    ...opts,
    // The owner's phase is a cut (the default): never an added cluster.
    volumeAllowsCluster: false,
    stallContext: {
      ...(sleeps.length ? { sleepHours: sleeps.reduce((a, b) => a + b, 0) / sleeps.length } : {}),
      ...(tplRow?.restMiniSec ?? tpl?.restMiniSec) != null ? { restMiniSec: tplRow?.restMiniSec ?? tpl?.restMiniSec } : {},
    },
  });
}

type Row = { date: string; template: string; exercise: string; logged: string; load: string; engine: string;
  nextTemplate: string; nextLifted: string; oldEngineNext: string };
const rows: Row[] = [];
const inRange = sessions.filter((s) => s.templateName && day(s.date) >= FROM).reverse(); // oldest first
for (const s of inRange) {
  const upTo = sessions.filter((x) => x.date.getTime() <= s.date.getTime());
  const next = sessions.filter((x) => x.templateId === s.templateId && x.date.getTime() > s.date.getTime()).at(-1);
  const tpl = templates.find((t) => t.id === s.templateId);
  for (const ex of s.exercises) {
    if (!ex.sets.some((x) => x.kind === 'activation')) continue;
    const history = exerciseHistory(upTo, ex.exerciseId);
    const rec = recFor(history, tpl?.exercises.find((r) => r.exerciseId === ex.exerciseId), tpl, upTo);
    const nextEx = next?.exercises.find((e) => e.exerciseId === ex.exerciseId);
    rows.push({
      date: day(s.date), template: s.templateName ?? '', exercise: ex.name,
      logged: acts(ex), load: fmtLoad(activationLoad(ex)),
      engine: callText(rec),
      nextTemplate: next ? fmtLoad(nextEx?.targetLoad) : '(no next yet)',
      nextLifted: next ? fmtLoad(activationLoad(nextEx)) : '',
      oldEngineNext: nextEx?.recommendation ? `${nextEx.recommendation.action} ${fmtLoad(nextEx.recommendation.load)}` : '',
    });
  }
}

const table = (rs: Record<string, string>[]) => {
  const keys = Object.keys(rs[0] ?? {});
  const w = keys.map((k) => Math.max(k.length, ...rs.map((r) => r[k].length)));
  const line = (vals: string[]) => vals.map((v, i) => v.padEnd(w[i])).join(' | ');
  return [line(keys), w.map((n) => '-'.repeat(n)).join('-|-'), ...rs.map((r) => line(keys.map((k) => r[k])))].join('\n');
};
console.log(`BACKTEST — calls after each session from ${FROM} (history up to and including it)\n`);
console.log(table(rows));

console.log('\nNEXT SESSION — engine calls from all history\n');
const nextRows: Record<string, string>[] = [];
for (const name of ['Leg Day', 'Pull Day', 'Push Day']) {
  const tpl = templates.find((t) => t.name === name);
  if (!tpl) continue;
  for (const row of tpl.exercises) {
    const history = exerciseHistory(sessions, row.exerciseId);
    const rec = recFor(history, row, tpl, sessions);
    const last = history[0];
    nextRows.push({
      template: name, exercise: row.name, templateLoad: fmtLoad(row.targetLoad),
      last: last ? `${fmtLoad(activationLoad(last))} × ${acts(last)}` : '–',
      range: rec.repRange ? `${rec.repRange.min}-${rec.repRange.max}` : '',
      engine: callText(rec),
    });
  }
}
console.log(table(nextRows));
const json = arg('json');
if (json) writeFileSync(json, JSON.stringify({ rows, nextRows }, null, 2));
