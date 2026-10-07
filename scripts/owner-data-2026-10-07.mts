/**
 * One-time data changes on the owner's account, requested 2026-10-07 with
 * values the owner confirmed — written exactly, never recomputed.
 *
 * 1A  Delete `dailyWeights/2026-10-06` (154.4 lb): the owner did not weigh in
 *     that day; the value is 10/5's. The day is left blank, nothing imputed.
 * 1B  10/7 breakfast "Egg scramble + Real Good tortilla + banana" (637 kcal /
 *     73 g, 8:45 AM) — ONLY if no breakfast row exists on 10/7. One does
 *     ("Scramble Eggs + Tortilla + Banana + Cheddar", 640 / 73, 9:30 AM), so
 *     the script SKIPS it and prints the existing row.
 * 1C  Leg Day: Smith squat → 30, DB Romanian deadlift → 35, Leg Extensions →
 *     90, Leg Curls → 90; the single-leg calf raise's two clusters get the
 *     labels "L" / "R". Held, verified, not written: calf 25 × 2 clusters,
 *     Weighted Floor Crunch 30 × 2, Hanging Knee Raise 0 × 1, Zone 2 20 min.
 *     Catalog: Leg Extensions and Leg Curls stack steps [70, 80, 90].
 * 1D  Pull Day: Wide-grip lat pulldown → 90; Incline DB Curl 45° → 15 (the
 *     owner's "hold 15" — the row still read 20 from 09-16). Held, verified,
 *     not written: Seated Machine Row 100 × 2, pull-up 0, chest-supported row
 *     35, rear delt 15, hammer curl 20.
 * 1E  The 10/7 cardio row is NOT touched.
 *
 * Every load move is applied through core `applyTemplateChanges`, so it lands
 * in the row's `loadLog` as `by: 'user'` with the date and the reason, like a
 * hand edit in the template editor.
 *
 * REFUSES (exit 1, nothing written) when a value it replaces or holds is not
 * what it expects, or when a session is still active (the device writes it
 * back whole). Re-runs read "Nothing to do".
 *
 *   TZ=America/Puerto_Rico npx jiti scripts/owner-data-2026-10-07.mts --email gabrielandresbermudez@gmail.com [--apply]
 *
 * Auth: ADC (`gcloud auth application-default login`).
 */
import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import {
  type TemplateExercise,
  type TemplateLoadChange,
  applyTemplateChanges,
  dayRange,
  sanitizeDayBoundary,
} from '../packages/core/src/index.ts';

const PROJECT_ID = 'fitness-tracker-gb-1775407101';
const REASON = 'Owner-confirmed load for the next session (2026-10-07)';
const AT = new Date();

const WEIGHT_DAY = '2026-10-06';
const WEIGHT_EXPECTED = 154.4;
const FOOD_DAY = '2026-10-07';

const ID = {
  smith: 'eKW1qiIDpvfnSECIxSUn',
  rdl: 'vtSvqglnBZdM1f3qOJi4',
  legExt: 'hXvPQM7Dv6YvScYW7h2l',
  legCurl: 'jZWYnikrGcdRG1adHXJ0',
  calf: 'm5E72J63gVXltnQ0zC8f',
  crunch: 'x3G0Speg04GclIOdKHAl',
  kneeRaise: '8WVjS3nPucY5nQUC6lHM',
  row: '9x3b6rmxlxJyWWSMat3w',
  pullup: 'GOGOcWJNC9q9aBmN3ENq',
  pulldown: 'oxOuktVhb6Ghgg7hGkCk',
  csRow: 'acs1BlQvTZdL97i5jXJv',
  rearDelt: 'v2uqmVt1K4fJd0d6t4De',
  inclineCurl: 'MVC1wLKBkRz7XYyKp79e',
  hammer: 'LvVitCaOS23MmPTKodlk',
};

/** [exerciseId, expected current load, new load] */
const LEG_MOVES: Array<[string, number, number]> = [
  [ID.smith, 15, 30], [ID.rdl, 20, 35], [ID.legExt, 80, 90], [ID.legCurl, 80, 90],
];
/** [exerciseId, load, activation clusters] — verified, never written. */
const LEG_HOLDS: Array<[string, number, number]> = [
  [ID.smith, 30, 2], [ID.calf, 25, 2], [ID.crunch, 30, 2], [ID.kneeRaise, 0, 1],
];
const PULL_MOVES: Array<[string, number, number]> = [[ID.pulldown, 80, 90], [ID.inclineCurl, 20, 15]];
const PULL_HOLDS: Array<[string, number, number]> = [
  [ID.row, 100, 2], [ID.pullup, 0, 1], [ID.csRow, 35, 1], [ID.rearDelt, 15, 1], [ID.hammer, 20, 1],
];
const CALF_LABELS: Record<number, string> = { 1: 'L', 2: 'R' };
const STACK_STEPS = [70, 80, 90];

if (Intl.DateTimeFormat().resolvedOptions().timeZone !== 'America/Puerto_Rico') {
  console.error('Run with TZ=America/Puerto_Rico — the day boundary math is local-time.');
  process.exit(2);
}
const argv = process.argv.slice(2);
const arg = (n: string) => { const i = argv.indexOf(`--${n}`); return i === -1 ? null : argv[i + 1]; };
const apply = argv.includes('--apply');
const email = arg('email');
let uid = arg('uid');
if (!email && !uid) { console.error('usage: … (--email <email> | --uid <uid>) [--apply]'); process.exit(2); }

initializeApp({ credential: applicationDefault(), projectId: PROJECT_ID });
const db = getFirestore();
if (!uid) uid = (await getAuth().getUserByEmail(email!)).uid;
const user = db.collection('users').doc(uid);
console.log(`${apply ? '' : '[dry run] '}uid ${uid}\n`);

const refusals: string[] = [];
const batch = db.batch();
let writes = 0;
const say = (s: string) => console.log(`${apply ? 'SET  ' : 'WOULD'} ${s}`);
const clusters = (r: TemplateExercise) => r.plannedSets.filter((p) => p.kind === 'activation').length;

// ── 1A weight ───────────────────────────────────────────────────────────
{
  const ref = user.collection('dailyWeights').doc(WEIGHT_DAY);
  const snap = await ref.get();
  if (!snap.exists) console.log(`1A  dailyWeights/${WEIGHT_DAY}: already gone — nothing to do`);
  else if (snap.data()?.weight !== WEIGHT_EXPECTED || Object.keys(snap.data() ?? {}).length !== 1) {
    refusals.push(`1A dailyWeights/${WEIGHT_DAY} is ${JSON.stringify(snap.data())}, expected { weight: ${WEIGHT_EXPECTED} }`);
  } else {
    say(`1A  DELETE dailyWeights/${WEIGHT_DAY} ${JSON.stringify(snap.data())} (created ${snap.createTime?.toDate().toISOString()})`);
    batch.delete(ref);
    writes++;
  }
}

// ── 1B breakfast ────────────────────────────────────────────────────────
{
  const profile = (await user.get()).data() ?? {};
  const { start, end } = dayRange(FOOD_DAY, sanitizeDayBoundary(profile['dayBoundary']));
  const rows = (await user.collection('dailyLogs')
    .where('timestamp', '>=', Timestamp.fromDate(start)).where('timestamp', '<', Timestamp.fromDate(end)).get())
    .docs.map((d) => ({ id: d.id, ...d.data() })) as Array<Record<string, any>>;
  const breakfasts = rows.filter((r) => r.mealType === 'breakfast');
  if (breakfasts.length) {
    for (const b of breakfasts) {
      const t = (b.timestamp as Timestamp).toDate().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
      console.log(`1B  SKIP — breakfast already on ${FOOD_DAY}: ${b.id} "${b.mealLabel}" ${b.calories} kcal / ${b.protein} g at ${t}`);
    }
  } else {
    // Not reached on the 2026-10-07 data. Kept out on purpose: the condition
    // was "only if none exists", and adding it is a decision to take again.
    refusals.push(`1B no breakfast on ${FOOD_DAY} — this script does not add it; re-confirm with the owner`);
  }
}

// ── 1C / 1D templates ───────────────────────────────────────────────────
const templates = (await user.collection('workoutTemplates').get()).docs;
function editTemplate(name: string, moves: Array<[string, number, number]>, holds: Array<[string, number, number]>, extra?: (rows: TemplateExercise[]) => TemplateExercise[]) {
  const hits = templates.filter((d) => d.data().name === name);
  if (hits.length !== 1) { refusals.push(`${name}: expected one template, found ${hits.length}`); return; }
  const doc = hits[0];
  const before = doc.data().exercises as TemplateExercise[];
  const changes: TemplateLoadChange[] = [];
  for (const [id, from, to] of moves) {
    const r = before.find((x) => x.exerciseId === id);
    if (!r) { refusals.push(`${name}: no row ${id}`); continue; }
    if (r.targetLoad === to) { console.log(`${name} / ${r.name}: already ${to}`); continue; }
    if (r.targetLoad !== from) { refusals.push(`${name} / ${r.name}: targetLoad ${r.targetLoad}, expected ${from}`); continue; }
    changes.push({ exerciseId: id, name: r.name, from, to, call: 'hold', reason: REASON });
    say(`${name} / ${r.name}: targetLoad ${from} → ${to} (loadLog by: user)`);
  }
  for (const [id, load, n] of holds) {
    const r = before.find((x) => x.exerciseId === id);
    const after = moves.find((m) => m[0] === id)?.[2];
    if (!r) { refusals.push(`${name}: no row ${id}`); continue; }
    const effective = after ?? r.targetLoad;
    if (effective !== load || clusters(r) !== n) refusals.push(`${name} / ${r.name}: ${effective} × ${clusters(r)} clusters, expected ${load} × ${n}`);
    else console.log(`${name} / ${r.name}: verified ${load} × ${n} cluster${n === 1 ? '' : 's'} — not written`);
  }
  let after = applyTemplateChanges(before, changes, { at: AT, by: 'user' });
  if (extra) after = extra(after);
  if (JSON.stringify(before) === JSON.stringify(after)) { console.log(`${name}: nothing to do`); return; }
  batch.update(doc.ref, { exercises: after, updatedAt: Timestamp.fromDate(AT) });
  writes++;
}

editTemplate('Leg Day', LEG_MOVES, LEG_HOLDS, (rows) => rows.map((r) => {
  if (r.exerciseId !== ID.calf) return r;
  const plannedSets = r.plannedSets.map((p) => (p.group != null && CALF_LABELS[p.group] ? { ...p, label: CALF_LABELS[p.group] } : p));
  if (JSON.stringify(plannedSets) !== JSON.stringify(r.plannedSets)) say(`Leg Day / ${r.name}: cluster labels 1 → "L", 2 → "R"`);
  return { ...r, plannedSets };
}));
editTemplate('Pull Day', PULL_MOVES, PULL_HOLDS);

// Zone 2 on Leg Day: verified only.
{
  const leg = templates.find((d) => d.data().name === 'Leg Day')?.data();
  const z2 = (leg?.cardioBlocks ?? []).find((b: any) => b.label === 'Zone 2');
  if (z2?.targetDurationSec === 1200) console.log('Leg Day / Zone 2: verified 20 min — not written');
  else refusals.push(`Leg Day / Zone 2: ${JSON.stringify(z2)}, expected 1200 s`);
}

// ── Catalog: stack steps ────────────────────────────────────────────────
for (const id of [ID.legExt, ID.legCurl]) {
  const ref = user.collection('exercises').doc(id);
  const ex = (await ref.get()).data();
  if (!ex) { refusals.push(`exercise ${id} missing`); continue; }
  if (JSON.stringify(ex.availableLoads) === JSON.stringify(STACK_STEPS)) { console.log(`${ex.name}: steps already ${STACK_STEPS}`); continue; }
  if (ex.availableLoads != null) { refusals.push(`${ex.name}: availableLoads is ${JSON.stringify(ex.availableLoads)} — not overwriting`); continue; }
  say(`exercises/${id} (${ex.name}): availableLoads ${JSON.stringify(STACK_STEPS)}`);
  batch.update(ref, { availableLoads: STACK_STEPS });
  writes++;
}

const active = (await user.collection('workoutSessions').where('status', '==', 'active').get()).docs;
if (active.length) refusals.push(`an active session is open (${active.map((d) => d.id).join(', ')}) — finish it first`);

console.log('\n1E  10/7 cardio row (Zone 2 run, avg HR 135, RPE 10): not touched.');
console.log('');
for (const r of refusals) console.log(`REFUSE  ${r}`);
if (refusals.length) { console.log('\nAborted: nothing written (refusals above).'); process.exit(1); }
if (writes === 0) console.log('Nothing to do.');
else if (apply) { await batch.commit(); console.log(`Applied ${writes} write(s).`); }
else console.log(`${writes} write(s) pending — dry run, re-run with --apply.`);
