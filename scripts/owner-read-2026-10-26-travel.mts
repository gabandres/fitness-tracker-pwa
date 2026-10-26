/**
 * READ-ONLY snapshot of the owner's account before travel mode (Bolivia,
 * 2026-10-31 → 2026-11-18): targets, the maintenance estimate as the app
 * computes it now and as it would read on 10/30, weigh-ins, steps baseline,
 * templates and the last sessions. Writes nothing.
 *
 *   TZ=America/Puerto_Rico npx jiti scripts/owner-read-2026-10-26-travel.mts --email gabrielandresbermudez@gmail.com [--json out.json]
 *
 * Auth: ADC (`gcloud auth application-default login`).
 */
import { writeFileSync } from 'node:fs';
import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { toDailyLog, toDomainProfile } from '../packages/core/src/firestore-mappers.ts';
import { dailyTargets, mergeDailyWeights } from '../packages/core/src/targets.ts';
import { calculateTdee } from '../packages/core/src/tdee.ts';
import { dayBoundaryOf } from '../packages/core/src/day-boundary.ts';

const arg = (k: string) => {
  const i = process.argv.indexOf(k);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const email = arg('--email');
if (!email) throw new Error('--email required');
const jsonOut = arg('--json');

initializeApp({ credential: applicationDefault(), projectId: 'fitness-tracker-gb-1775407101' });
const uid = (await getAuth().getUserByEmail(email)).uid;
const db = getFirestore();
const user = db.doc(`users/${uid}`);

const [prof, logs, weights, logged, activity, templates, sessions] = await Promise.all([
  user.get(),
  user.collection('dailyLogs').orderBy('timestamp', 'desc').limit(400).get(),
  user.collection('dailyWeights').get(),
  user.collection('dailyLogged').get(),
  user.collection('dailyActivity').get(),
  user.collection('workoutTemplates').get(),
  user.collection('workoutSessions').orderBy('timestamp', 'desc').limit(12).get(),
]);

const raw = prof.data() ?? {};
const profile = toDomainProfile(raw);
const dailyLogs = logs.docs.map((d) => toDailyLog(d.id, d.data()));
const dailyWeights: Record<string, number> = {};
for (const d of weights.docs) if (typeof d.data().weight === 'number') dailyWeights[d.id] = d.data().weight;
const dayComplete: Record<string, boolean> = {};
for (const d of logged.docs) if (typeof d.data().complete === 'boolean') dayComplete[d.id] = d.data().complete;
const boundary = dayBoundaryOf(profile);

const at = (iso: string) => new Date(iso);
const now = new Date();
const t = dailyTargets(profile, dailyLogs, dailyWeights, now, dayComplete);
const merged = mergeDailyWeights(dailyLogs, dailyWeights, boundary);
const tdeeNow = calculateTdee(merged, profile, boundary, now, dailyWeights, dayComplete);
// What Today would show on 10/30 if nothing else were logged before then.
const tdee1030 = calculateTdee(merged, profile, boundary, at('2026-10-30T12:00:00-04:00'), dailyWeights, dayComplete);

const steps = activity.docs
  .filter((d) => d.id >= '2026-09-28' && d.id <= '2026-10-25' && typeof d.data().steps === 'number')
  .map((d) => d.data().steps as number);
const recentWeights = Object.keys(dailyWeights).sort().slice(-10).map((k) => `${k} ${dailyWeights[k]}`);

const pick = (r: unknown) => {
  const x = r as Record<string, unknown>;
  const keep = ['source', 'trueTdee', 'estimateState', 'reliable', 'confidence', 'windowDays', 'intakeDays', 'notEnoughCompleteDays', 'ci95Tdee'];
  return Object.fromEntries(keep.filter((k) => k in x).map((k) => [k, x[k]]));
};

const out = {
  uid,
  profile: {
    targetMode: raw.targetMode,
    manualCaloriesTarget: raw.manualCaloriesTarget,
    manualProteinTarget: raw.manualProteinTarget,
    goal: raw.goal,
    travelMode: raw.travelMode,
    travelPeriods: raw.travelPeriods,
    dayBoundary: raw.dayBoundary,
    unitSystem: raw.unitSystem,
    keys: Object.keys(raw).sort(),
  },
  targetsNow: { calorieTarget: t.calorieTarget, proteinTarget: t.proteinTarget, calorieSource: t.calorieSource, proteinSource: t.proteinSource },
  maintenanceNow: pick(tdeeNow),
  maintenanceOn1030IfNothingMoreLogged: pick(tdee1030),
  weighIns: { count: Object.keys(dailyWeights).length, last10: recentWeights },
  steps28d: { days: steps.length, mean: steps.length ? Math.round(steps.reduce((a, b) => a + b, 0) / steps.length) : null },
  logRows: dailyLogs.length,
  templates: templates.docs.map((d) => ({
    id: d.id,
    name: d.data().name,
    version: d.data().templateVersion,
    archived: !!d.data().archivedAt,
    rows: (d.data().exercises ?? []).length,
  })),
  lastSessions: sessions.docs.map((d) => ({
    id: d.id,
    date: d.data().timestamp?.toDate?.().toISOString().slice(0, 10),
    template: d.data().templateName,
    status: d.data().status,
    lifts: (d.data().exercises ?? []).length,
    deload: d.data().deload,
  })),
};
console.log(JSON.stringify(out, null, 2));
if (jsonOut) writeFileSync(jsonOut, JSON.stringify(out, null, 2));
process.exit(0);
