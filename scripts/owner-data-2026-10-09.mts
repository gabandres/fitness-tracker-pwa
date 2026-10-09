/**
 * One-time data changes on the owner's account, requested 2026-10-08 with
 * values the owner set — written exactly, never recomputed.
 *
 * A  Protein target 140 g as a USER OVERRIDE: `targetMode: 'custom'` +
 *    `manualProteinTarget: 140`. Calories stay automatic (no
 *    `manualCaloriesTarget`; the chain is per field). Refused before local
 *    2026-10-09, so 10/8's record keeps the 130 g that was in effect that day.
 *    Then records `dailyTargets/2026-10-09` (recordedBy: 'prompt') through core
 *    `planTargetRecord`, so the change carries its reason.
 * B  Push / Pull / Leg Day made to match the owner's written programme:
 *    order, loads, clusters (+ L/R labels), mini rest 10 s (5–10), rest before
 *    the next exercise per row — 90–120 s into the same primary muscle, 60 s on
 *    a switch — and Zone 2 20 min. Push: the main press moves to first and
 *    Seated DB Shoulder Press 1st → 3rd with a progression BASELINE marker
 *    ("position changed 10/9"; drop back to 60 only if the activation is under
 *    5). Pull: the pull-up's 50 s mini-rest override is removed (the template's
 *    10 s applies). Drop sets are kept (owner, 2026-10-08).
 * C  Catalog: Seated Machine Row's activation standard rir1 → failure (owner,
 *    2026-10-08: "unless noted" — only the Smith squat is noted).
 *
 * Every row change goes through core `carryAndStampRows` (`by: 'prompt'`); a
 * load move would go through `applyTemplateChanges` (none is needed). No row,
 * exercise or session is merged or deleted; history is untouched.
 *
 * REFUSES (exit 1, nothing written) when a value it holds or replaces is not
 * what it expects, when a template's rows are not exactly the programme's
 * exercises, or when a session is active (the device writes it back whole).
 * Writes a JSON backup of everything it touches before writing. Re-runs read
 * "nothing to do".
 *
 *   TZ=America/Puerto_Rico npx jiti scripts/owner-data-2026-10-09.mts --email gabrielandresbermudez@gmail.com [--apply]
 *
 * Auth: ADC (`gcloud auth application-default login`).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import {
  type DailyTargetRecord,
  type TemplateExercise,
  LOG_WINDOW_ROWS,
  calendarDateKey,
  carryAndStampRows,
  compareLogsOldestFirst,
  dailyTargets,
  planTargetRecord,
  targetSnapshot,
  toDailyLog,
  toDailyTargetRecord,
  toDomainProfile,
} from '../packages/core/src/index.ts';

const PROJECT_ID = 'fitness-tracker-gb-1775407101';
const AT = new Date();
const OVERRIDE_DAY = '2026-10-09';
const PROTEIN_OVERRIDE = 140;
const BASELINE = { since: '2026-10-09', reason: 'position changed 10/9', dropBackTo: 60, dropBackBelowReps: 5 };

const SAME = { restAfterSec: 90, restAfterMaxSec: 120 } as const; // next exercise: same primary muscle
const SWITCH = { restAfterSec: 60 } as const; // next exercise: a different one
const LAST = {} as const; // last lift: no next exercise to rest for

type Spec = { id: string; name: string; load: number; clusters: number; labels?: string[]; rest: { restAfterSec?: number; restAfterMaxSec?: number } };
const PROGRAMME: Record<string, { rows: Spec[]; note: string }> = {
  'Push Day': {
    rows: [
      { id: 'ud6fE363QklE3qXYxLw3', name: 'DB Flat Press', load: 25, clusters: 2, rest: SAME },
      { id: 'ngF9959fQPGTYUHXpigC', name: 'Incline Dumbbell Press', load: 20, clusters: 2, rest: SWITCH },
      { id: 'He4o7qVWRftiPneaXjiV', name: 'Seated DB Shoulder Press', load: 70, clusters: 1, rest: SWITCH },
      { id: 'Zqb1sTIfs0olSLeDFlx1', name: 'Deficit Push-up', load: 0, clusters: 1, rest: SWITCH },
      { id: 'AAHHWXTA7UtbNWZbcf7z', name: 'Overhead DB Extension', load: 30, clusters: 1, rest: SAME },
      { id: 'EyDTWnfO4WrbYDbDkxrk', name: 'Skull Crusher', load: 15, clusters: 1, rest: SWITCH },
      { id: 'BGyAEJU6i5nN6AjXRU1g', name: 'DB Lateral Raise', load: 15, clusters: 1, rest: LAST },
    ],
    note: '2026-10-09 - order: DB Flat Press 1st (the main lift), Incline 2nd, Seated DB Shoulder Press 1st -> 3rd; its next session is a new baseline (drop back to 60 only if the activation is under 5). Rest before the next exercise: 90-120 s into the same muscle, 60 s on a switch (per row); mini-sets 5-10 s; between a lift\'s own clusters unchanged.',
  },
  'Pull Day': {
    rows: [
      { id: '9x3b6rmxlxJyWWSMat3w', name: 'Seated Machine Row', load: 100, clusters: 2, rest: SAME },
      { id: 'GOGOcWJNC9q9aBmN3ENq', name: 'Neutral-grip pull-up', load: 0, clusters: 1, rest: SAME },
      { id: 'oxOuktVhb6Ghgg7hGkCk', name: 'Wide-grip lat pulldown', load: 90, clusters: 1, rest: SAME },
      { id: 'acs1BlQvTZdL97i5jXJv', name: 'Chest-supported DB row', load: 35, clusters: 1, rest: SWITCH },
      { id: 'v2uqmVt1K4fJd0d6t4De', name: 'Rear delt DB flye', load: 15, clusters: 1, rest: SWITCH },
      { id: 'MVC1wLKBkRz7XYyKp79e', name: 'Incline DB Curl 45°', load: 15, clusters: 1, rest: SAME },
      { id: 'LvVitCaOS23MmPTKodlk', name: 'DB hammer curl', load: 20, clusters: 1, rest: LAST },
    ],
    note: '2026-10-09 - Seated Machine Row activation to failure (was RIR 1). Pull-up mini-set rest back to the template\'s 10 s (was a 50 s override). Rest before the next exercise: 90-120 s into the same muscle, 60 s on a switch (per row); mini-sets 5-10 s.',
  },
  'Leg Day': {
    rows: [
      { id: 'eKW1qiIDpvfnSECIxSUn', name: 'Smith squat', load: 30, clusters: 2, rest: SWITCH },
      { id: 'vtSvqglnBZdM1f3qOJi4', name: 'DB Romanian deadlift', load: 35, clusters: 1, rest: SWITCH },
      { id: 'hXvPQM7Dv6YvScYW7h2l', name: 'Leg Extensions', load: 90, clusters: 1, rest: SWITCH },
      { id: 'jZWYnikrGcdRG1adHXJ0', name: 'Leg Curls', load: 90, clusters: 1, rest: SWITCH },
      { id: 'm5E72J63gVXltnQ0zC8f', name: 'Single-leg DB calf raise', load: 25, clusters: 2, labels: ['L', 'R'], rest: SWITCH },
      { id: 'x3G0Speg04GclIOdKHAl', name: 'Weighted Floor Crunch', load: 30, clusters: 2, rest: SAME },
      { id: '8WVjS3nPucY5nQUC6lHM', name: 'Hanging Knee Raise', load: 0, clusters: 1, rest: LAST },
    ],
    note: '2026-10-09 - rest before the next exercise: 90-120 s into the same muscle, 60 s on a switch (per row); mini-sets 5-10 s. Smith squat keeps RIR 1 (lumbar).',
  },
};
const ROW_ID = '9x3b6rmxlxJyWWSMat3w';
const SMITH_ID = 'eKW1qiIDpvfnSECIxSUn';
const PULLUP_ID = 'GOGOcWJNC9q9aBmN3ENq';
const SHOULDER_ID = 'He4o7qVWRftiPneaXjiV';

if (Intl.DateTimeFormat().resolvedOptions().timeZone !== 'America/Puerto_Rico') {
  console.error('Run with TZ=America/Puerto_Rico — the override day is local.');
  process.exit(2);
}
const argv = process.argv.slice(2);
const arg = (n: string) => { const i = argv.indexOf(`--${n}`); return i === -1 ? null : argv[i + 1]; };
const apply = argv.includes('--apply');
const email = arg('email');
if (!email) { console.error('usage: … --email <email> [--apply]'); process.exit(2); }

initializeApp({ credential: applicationDefault(), projectId: PROJECT_ID });
const db = getFirestore();
const uid = (await getAuth().getUserByEmail(email)).uid;
const user = db.collection('users').doc(uid);
console.log(`${apply ? '' : '[dry run] '}uid ${uid} · ${AT.toISOString()}\n`);

const refusals: string[] = [];
const batch = db.batch();
let writes = 0;
const say = (s: string) => console.log(`${apply ? 'SET  ' : 'WOULD'} ${s}`);
/** Admin SDK rejects `undefined`; a removed field is an absent key. */
const clean = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
/** Key-order-independent equality — Firestore does not return map keys in the
 *  order they were written, so a plain stringify called every re-run a change. */
const canon = (v: unknown): string => JSON.stringify(v, (_k, x) =>
  x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, x[k]])) : x);
const activations = (r: TemplateExercise) => r.plannedSets.filter((p) => p.kind === 'activation');
const labelsOf = (r: TemplateExercise) => {
  const out: string[] = [];
  for (const p of activations(r)) if (p.label && !out.includes(p.label)) out.push(p.label);
  return out;
};
const restText = (r: TemplateExercise, t: { restClusterSec?: number }) =>
  r.restAfterSec != null ? (r.restAfterMaxSec ? `${r.restAfterSec}-${r.restAfterMaxSec}` : `${r.restAfterSec}`) : `${t.restClusterSec ?? '-'} (template)`;

// ── Guard: no active session ────────────────────────────────────────────
const active = await user.collection('workoutSessions').where('status', '==', 'active').get();
if (!active.empty) refusals.push(`${active.size} active session(s) — the device would write the template back whole`);

// ── Backup ──────────────────────────────────────────────────────────────
const profileSnap = await user.get();
const templates = (await user.collection('workoutTemplates').get()).docs;
const rowDoc = user.collection('exercises').doc(ROW_ID);
const smithDoc = user.collection('exercises').doc(SMITH_ID);
const backup = {
  at: AT.toISOString(),
  profile: profileSnap.data(),
  templates: templates.map((d) => ({ id: d.id, ...d.data() })),
  exercises: { [ROW_ID]: (await rowDoc.get()).data(), [SMITH_ID]: (await smithDoc.get()).data() },
};
const backupDir = join(homedir(), 'ignia-backups');
mkdirSync(backupDir, { recursive: true });
const backupPath = join(backupDir, `owner-data-2026-10-09-${AT.getTime()}.json`);
writeFileSync(backupPath, JSON.stringify(backup, null, 2));
console.log(`backup → ${backupPath}\n`);

// ── B templates ─────────────────────────────────────────────────────────
for (const [name, spec] of Object.entries(PROGRAMME)) {
  const hits = templates.filter((d) => d.data().name === name);
  if (hits.length !== 1) { refusals.push(`${name}: expected one template, found ${hits.length}`); continue; }
  const doc = hits[0];
  const data = doc.data();
  const before = data.exercises as TemplateExercise[];
  const ids = new Set(before.map((r) => r.exerciseId));
  const want = new Set(spec.rows.map((r) => r.id));
  if (ids.size !== want.size || [...want].some((id) => !ids.has(id)) || before.length !== spec.rows.length) {
    refusals.push(`${name}: rows are not exactly the programme's (no merges, no deletes) — have ${[...ids].join(',')}`);
    continue;
  }
  console.log(`\n${name} — BEFORE`);
  before.forEach((r, i) => console.log(`  ${i + 1}. ${r.name} · ${r.targetLoad} · ${activations(r).length} cl${labelsOf(r).length ? ` (${labelsOf(r).join(',')})` : ''} · mini ${r.restMiniSec ?? data.restMiniSec} · next ${restText(r, data)}`));

  const reordered: TemplateExercise[] = spec.rows.map((s) => {
    const r = before.find((x) => x.exerciseId === s.id)!;
    if (r.targetLoad !== s.load) refusals.push(`${name} / ${r.name}: load ${r.targetLoad}, programme ${s.load} — no load move planned`);
    if (activations(r).length !== s.clusters) refusals.push(`${name} / ${r.name}: ${activations(r).length} clusters, programme ${s.clusters}`);
    if (s.labels && labelsOf(r).join(',') !== s.labels.join(',')) refusals.push(`${name} / ${r.name}: labels ${labelsOf(r).join(',')}, programme ${s.labels.join(',')}`);
    const { restAfterSec: _a, restAfterMaxSec: _b, ...rest } = r;
    let next: TemplateExercise = { ...rest, ...s.rest };
    if (s.id === PULLUP_ID && next.restMiniSec != null) {
      const { restMiniSec: _m, ...noOverride } = next;
      next = noOverride;
    }
    if (s.id === SHOULDER_ID) next = { ...next, baseline: BASELINE };
    return next;
  });
  if (data.restMiniSec !== 10) refusals.push(`${name}: restMiniSec ${data.restMiniSec}, programme 5–10 (10)`);
  const z2 = (data.cardioBlocks ?? []).find((b: { label?: string }) => b.label === 'Zone 2');
  if (z2?.targetDurationSec !== 1200 || (data.cardioBlocks ?? []).length !== 1) refusals.push(`${name}: Zone 2 is ${JSON.stringify(data.cardioBlocks)}, programme 20 min`);

  const after = carryAndStampRows(before, reordered, { at: AT, by: 'prompt' });
  console.log(`${name} — AFTER`);
  after.forEach((r, i) => console.log(`  ${i + 1}. ${r.name} · ${r.targetLoad} · ${activations(r).length} cl${labelsOf(r).length ? ` (${labelsOf(r).join(',')})` : ''} · mini ${r.restMiniSec ?? data.restMiniSec} · next ${restText(r, data)}${r.baseline ? ` · baseline ${r.baseline.since}` : ''}${r.lastModifiedBy === 'prompt' && r.lastModifiedAt === AT.toISOString() ? ' · stamped prompt' : ''}`));
  console.log(`  Zone 2 · ${z2?.targetDurationSec / 60} min`);

  const notes = (data.notes as string | undefined) ?? '';
  const nextNotes = notes.includes(spec.note) ? notes : `${notes}\n\n${spec.note}`;
  if (nextNotes.length > 10000) refusals.push(`${name}: notes would be ${nextNotes.length} chars (> 10,000 cap)`);
  if (canon(after) === canon(before) && nextNotes === notes) { console.log(`${name}: nothing to do`); continue; }
  say(`${name}: rows rewritten (${after.filter((r) => r.lastModifiedAt === AT.toISOString()).length} stamped prompt)${nextNotes === notes ? '' : ', notes +1 dated line'}`);
  batch.update(doc.ref, clean({ exercises: after, notes: nextNotes, updatedAt: Timestamp.fromDate(AT) }));
  writes++;
}

// ── C catalog: the row's effort standard ────────────────────────────────
{
  const row = backup.exercises[ROW_ID];
  const smith = backup.exercises[SMITH_ID];
  if (smith?.effortStandard !== 'rir1') refusals.push(`Smith squat effortStandard ${smith?.effortStandard}, expected rir1 (kept)`);
  if (row?.effortStandard === 'failure') console.log('\nSeated Machine Row: already failure');
  else if (row?.effortStandard !== 'rir1') refusals.push(`Seated Machine Row effortStandard ${row?.effortStandard}, expected rir1`);
  else {
    say(`\nSeated Machine Row: effortStandard rir1 → failure`);
    batch.update(rowDoc, { effortStandard: 'failure' });
    writes++;
  }
}

// ── A protein override + the 10/9 record ────────────────────────────────
{
  const today = calendarDateKey(AT);
  const p = profileSnap.data() ?? {};
  if (today < OVERRIDE_DAY) {
    console.log(`\nA  protein override: local date is ${today} — held until ${OVERRIDE_DAY} so ${today} keeps its target`);
  } else if (p.targetMode === 'custom' && p.manualProteinTarget === PROTEIN_OVERRIDE) {
    console.log('\nA  protein override: already 140 g (user)');
  } else if (p.targetMode !== 'auto' || p.manualProteinTarget != null || p.manualCaloriesTarget != null) {
    refusals.push(`A profile is targetMode ${p.targetMode}, manualProteinTarget ${p.manualProteinTarget}, manualCaloriesTarget ${p.manualCaloriesTarget} — expected auto / none / none`);
  } else {
    say(`\nA  profile: targetMode auto → custom, manualProteinTarget → ${PROTEIN_OVERRIDE} (calories stay automatic)`);
    batch.update(user, { targetMode: 'custom', manualProteinTarget: PROTEIN_OVERRIDE });
    writes++;

    const profile = toDomainProfile({ ...p, targetMode: 'custom', manualProteinTarget: PROTEIN_OVERRIDE });
    const logs = (await user.collection('dailyLogs').orderBy('timestamp', 'desc').limit(LOG_WINDOW_ROWS).get())
      .docs.map((d) => toDailyLog(d.id, d.data())).sort(compareLogsOldestFirst);
    const weights: Record<string, number> = {};
    (await user.collection('dailyWeights').get()).docs.forEach((d) => { weights[d.id] = d.data().weight; });
    const t = dailyTargets(profile, logs, weights, AT);
    const records = (await user.collection('dailyTargets').get()).docs
      .map((d) => toDailyTargetRecord(d.id, d.data())).filter((r): r is DailyTargetRecord => r != null);
    const plan = planTargetRecord(today, targetSnapshot(t, profile), records);
    if (!plan) console.log(`A  dailyTargets/${today}: already recorded`);
    else {
      say(`A  dailyTargets/${today}: protein ${plan.proteinTarget} (${plan.proteinSource}), kcal ${plan.kcalTarget} (${plan.kcalSource}), change ${JSON.stringify(plan.change ?? null)}`);
      batch.set(user.collection('dailyTargets').doc(today), clean({
        ...plan, recordedBy: 'prompt', recordedAt: Timestamp.fromDate(AT), updatedAt: Timestamp.fromDate(AT),
      }));
      writes++;
    }
  }
}

if (refusals.length) {
  console.error('\nREFUSED — nothing written:');
  for (const r of refusals) console.error(`  - ${r}`);
  process.exit(1);
}
if (!apply) { console.log(`\n[dry run] ${writes} write(s) planned. Re-run with --apply.`); process.exit(0); }
if (writes === 0) { console.log('\nNothing to do.'); process.exit(0); }
await batch.commit();
console.log(`\nCommitted ${writes} write(s).`);
