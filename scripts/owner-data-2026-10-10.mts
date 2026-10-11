/**
 * One-time data changes on the owner's account, requested 2026-10-10 with
 * values the owner confirmed — written exactly, never recomputed.
 *
 * 1  Saturday 2026-10-10 (America/Puerto_Rico) food rows. Expected day total
 *    1,745 kcal / 177 g. Two of the nine are already on the day, logged by
 *    hand, and are SKIPPED as duplicates (never updated — their kcal/protein
 *    agree):
 *      - #1 Protein pancake 335/36 + #2 2 medium eggs 120/12 (9:45 AM) are the
 *        single row "Pancake + Eggs" 455/48 at 9:41 AM — the same two foods,
 *        same sum, 4 min apart. Not split: splitting rewrites a row the owner
 *        made, and the total is the same either way.
 *      - #3 Casein bowl 325/32 (11:50 AM) is "Casein Full" 325/32, logged as
 *        lunch at 1:09 PM — 79 min off, OUTSIDE the ±30 min rule. Skipped
 *        anyway: same food, same values, and the expected 1,745 counts it
 *        once; adding it would make the day 2,070.
 *    The other six are created through core `toLogDoc` (the bytes `addLog`
 *    writes), with the owner's note, and `createdAt` in table order so the
 *    four 7:00 PM rows list in the order given. The pancakes not eaten today
 *    (235 g, 195 g) are not logged.
 * 2  Weight 10/10: 152.8. A 153.4 (the pre-bathroom read) would be replaced;
 *    152.8 already there → nothing to do.
 * 3  Templates (from the 10/9 export review):
 *    A  Drop sets off both curls (Incline DB Curl 45°, DB hammer curl): the
 *       `drop` planned set and its "DROP SET …" cue go; the lateral raise keeps
 *       its drop at 10.
 *    B  Rest. Before the next exercise: 90–120 s into the same muscle group,
 *       60 s on a switch, as the owner grouped them. The LAST lift's gap is
 *       into Zone 2 — a switch — so 60, replacing the 150 it inherited from
 *       the template. Between a lift's own two clusters (the template's
 *       `restClusterSec`) 150 → 90: the field holds ONE number and the timer
 *       runs the low end, the same convention as `restAfterSec`/`restAfterMaxSec`;
 *       the 120 is in the template notes.
 *
 * Every row change goes through core `carryAndStampRows` (`by: 'prompt'`). No
 * load, order, cluster, exercise or session changes; history is untouched.
 *
 * REFUSES (exit 1, nothing written) when a value it holds or replaces is not
 * what it expects, when a food row on the day is unexplained, or when a session
 * is active (the device writes it back whole). Writes a JSON backup first.
 * Re-runs read "nothing to do".
 *
 *   TZ=America/Puerto_Rico npx jiti scripts/owner-data-2026-10-10.mts --email gabrielandresbermudez@gmail.com [--apply]
 *
 * Auth: ADC (`gcloud auth application-default login`).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, Timestamp, FieldValue } from 'firebase-admin/firestore';
import {
  type DocCodec,
  type LogEntry,
  type TemplateExercise,
  carryAndStampRows,
  dayRange,
  sanitizeDayBoundary,
  toLogDoc,
  withDefaultMealSlot,
} from '../packages/core/src/index.ts';

const PROJECT_ID = 'fitness-tracker-gb-1775407101';
const AT = new Date();
const DAY = '2026-10-10';
const OFFSET = '-04:00'; // America/Puerto_Rico, no DST
const EXPECT = { kcal: 1745, protein: 177 };

// ── 1 food ──────────────────────────────────────────────────────────────
type Row = { n: number; time: string; slot: NonNullable<LogEntry['mealType']>; label: string; kcal: number; protein: number; note?: string };
const ROWS: Row[] = [
  { n: 1, time: '09:45', slot: 'breakfast', label: 'Protein pancake (183 g)', kcal: 335, protein: 36, note: 'Weighed hot. Batch 10/10: 3 pancakes 235/195/183 g = 613 g; ~1,119 kcal / 120 g batch → 1.83 kcal/g, 0.196 g/g. Banana 69 g.' },
  { n: 2, time: '09:45', slot: 'breakfast', label: '2 medium eggs', kcal: 120, protein: 12, note: 'Medium, 60/6 each' },
  { n: 3, time: '11:50', slot: 'snack', label: 'Casein bowl, full (with PB)', kcal: 325, protein: 32, note: '½ c Daisy 2% + ½ c Kirkland Greek + ½ c blueberries + 1 tbsp PB' },
  { n: 4, time: '15:30', slot: 'snack', label: 'David protein bar', kcal: 150, protein: 28, note: 'Label' },
  { n: 5, time: '15:45', slot: 'lunch', label: "Church's Pechu Grill, ¾ sandwich", kcal: 330, protein: 32, note: 'Minimal mayo; whole ≈440 without most of the mayo (510 listed)' },
  { n: 6, time: '19:00', slot: 'dinner', label: 'Grilled chicken, 3–4 oz, with sauce', kcal: 240, protein: 32, note: 'Wedding; sauce unknown, over-logged +50' },
  { n: 7, time: '19:00', slot: 'dinner', label: 'Ensalada de coditos, ½ cup', kcal: 200, protein: 4, note: 'Mayo-based macaroni salad' },
  { n: 8, time: '19:00', slot: 'dinner', label: 'Lettuce', kcal: 10, protein: 1 },
  { n: 9, time: '19:00', slot: 'dinner', label: 'Grapes, ~10', kcal: 35, protein: 0 },
];
/** Rows already on the day that ARE planned rows (decided by hand, see header). */
const COVERED: Array<{ id: string; label: string; kcal: number; protein: number; covers: number[] }> = [
  { id: 'BO3x96lSahLcccUsFcix', label: 'Pancake + Eggs', kcal: 455, protein: 48, covers: [1, 2] },
  { id: 'wYkFboftpoBMsezJWyKO', label: 'Casein Full', kcal: 325, protein: 32, covers: [3] },
];

// ── 2 weight ────────────────────────────────────────────────────────────
const WEIGHT = 152.8;
const WEIGHT_REPLACES = 153.4;

// ── 3 templates ─────────────────────────────────────────────────────────
type Rest = { restAfterSec: number; restAfterMaxSec?: number };
const SAME: Rest = { restAfterSec: 90, restAfterMaxSec: 120 }; // next exercise: same muscle group
const SWITCH: Rest = { restAfterSec: 60 }; // next exercise (or Zone 2): a different one
const CLUSTER = { from: 150, to: 90 }; // between a lift's own clusters; 120 lives in the notes
const DROP_CUE = 'DROP SET on the final mini-set only: 20 -> 15, rest <=10s.';
const NO_DROP_CUE = 'NO drop set during the cut (2026-10-10).';

type Spec = { id: string; name: string; rest: Rest; dropOff?: true; keepDropAt?: number };
const PROGRAMME: Record<string, { rows: Spec[]; note: string }> = {
  'Push Day': {
    rows: [
      { id: 'ud6fE363QklE3qXYxLw3', name: 'DB Flat Press', rest: SAME },
      { id: 'ngF9959fQPGTYUHXpigC', name: 'Incline Dumbbell Press', rest: SAME },
      { id: 'He4o7qVWRftiPneaXjiV', name: 'Seated DB Shoulder Press', rest: SAME },
      { id: 'Zqb1sTIfs0olSLeDFlx1', name: 'Deficit Push-up', rest: SWITCH },
      { id: 'AAHHWXTA7UtbNWZbcf7z', name: 'Overhead DB Extension', rest: SAME },
      { id: 'EyDTWnfO4WrbYDbDkxrk', name: 'Skull Crusher', rest: SWITCH },
      { id: 'BGyAEJU6i5nN6AjXRU1g', name: 'DB Lateral Raise', rest: SWITCH, keepDropAt: 10 },
    ],
    note: '2026-10-10 - rest before the next exercise, by muscle group: flat -> incline -> shoulder press -> push-up is one group (90-120 s), overhead extension -> skull crusher another (90-120 s), 60 s on every switch; the lateral raise into Zone 2 is 60 s (was the template\'s 150). Between a lift\'s own two clusters 150 -> 90-120 s (the field holds one number: 90). Drop set kept on the lateral raise only (15 -> 10).',
  },
  'Pull Day': {
    rows: [
      { id: '9x3b6rmxlxJyWWSMat3w', name: 'Seated Machine Row', rest: SAME },
      { id: 'GOGOcWJNC9q9aBmN3ENq', name: 'Neutral-grip pull-up', rest: SAME },
      { id: 'oxOuktVhb6Ghgg7hGkCk', name: 'Wide-grip lat pulldown', rest: SAME },
      { id: 'acs1BlQvTZdL97i5jXJv', name: 'Chest-supported DB row', rest: SWITCH },
      { id: 'v2uqmVt1K4fJd0d6t4De', name: 'Rear delt DB flye', rest: SWITCH },
      { id: 'MVC1wLKBkRz7XYyKp79e', name: 'Incline DB Curl 45°', rest: SAME, dropOff: true },
      { id: 'LvVitCaOS23MmPTKodlk', name: 'DB hammer curl', rest: SWITCH, dropOff: true },
    ],
    note: '2026-10-10 - drop sets OFF both curls for the cut (the incline curl\'s drop at 15 equalled its working load). Rest before the next exercise, by muscle group: row -> pull-up -> pulldown -> chest-supported row is one group (90-120 s), incline curl -> hammer curl another (90-120 s), 60 s on every switch; the hammer curl into Zone 2 is 60 s (was the template\'s 150). Between a lift\'s own two clusters 150 -> 90-120 s (the field holds one number: 90).',
  },
  'Leg Day': {
    rows: [
      { id: 'eKW1qiIDpvfnSECIxSUn', name: 'Smith squat', rest: SAME },
      { id: 'vtSvqglnBZdM1f3qOJi4', name: 'DB Romanian deadlift', rest: SWITCH },
      { id: 'hXvPQM7Dv6YvScYW7h2l', name: 'Leg Extensions', rest: SAME },
      { id: 'jZWYnikrGcdRG1adHXJ0', name: 'Leg Curls', rest: SWITCH },
      { id: 'm5E72J63gVXltnQ0zC8f', name: 'Single-leg DB calf raise', rest: SWITCH },
      { id: 'x3G0Speg04GclIOdKHAl', name: 'Weighted Floor Crunch', rest: SAME },
      { id: '8WVjS3nPucY5nQUC6lHM', name: 'Hanging Knee Raise', rest: SWITCH },
    ],
    note: '2026-10-10 - rest before the next exercise, by muscle group: Smith squat -> RDL, leg extension -> leg curl and crunch -> knee raise are pairs (90-120 s), 60 s on every switch; the knee raise into Zone 2 is 60 s (was the template\'s 150). Between a lift\'s own two clusters 150 -> 90-120 s (the field holds one number: 90).',
  },
};

if (Intl.DateTimeFormat().resolvedOptions().timeZone !== 'America/Puerto_Rico') {
  console.error('Run with TZ=America/Puerto_Rico — the day boundary math is local-time.');
  process.exit(2);
}
const argv = process.argv.slice(2);
const arg = (n: string) => { const i = argv.indexOf(`--${n}`); return i === -1 ? null : argv[i + 1]; };
const apply = argv.includes('--apply');
const email = arg('email');
if (!email) { console.error('usage: … --email <email> [--apply]'); process.exit(2); }

const sum = ROWS.reduce((a, r) => ({ kcal: a.kcal + r.kcal, protein: a.protein + r.protein }), { kcal: 0, protein: 0 });
if (sum.kcal !== EXPECT.kcal || sum.protein !== EXPECT.protein) {
  console.error(`Table sums to ${sum.kcal} kcal / ${sum.protein} g, expected ${EXPECT.kcal} / ${EXPECT.protein}. Aborting.`);
  process.exit(1);
}

initializeApp({ credential: applicationDefault(), projectId: PROJECT_ID });
const db = getFirestore();
const uid = (await getAuth().getUserByEmail(email)).uid;
const user = db.collection('users').doc(uid);
console.log(`${apply ? '' : '[dry run] '}uid ${uid} · ${AT.toISOString()}\n`);

const refusals: string[] = [];
const batch = db.batch();
let writes = 0;
const say = (s: string) => console.log(`${apply ? 'SET  ' : 'WOULD'} ${s}`);
const clean = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
const canon = (v: unknown): string => JSON.stringify(v, (_k, x) =>
  x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, x[k]])) : x);
const hhmm = (d: Date) => d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
const restText = (r: { restAfterSec?: number; restAfterMaxSec?: number }, cluster: number | undefined) =>
  r.restAfterSec != null ? (r.restAfterMaxSec ? `${r.restAfterSec}–${r.restAfterMaxSec}` : `${r.restAfterSec}`) : `${cluster ?? '-'} (template)`;
const drops = (r: TemplateExercise) => r.plannedSets.filter((p) => p.kind === 'drop');

// ── Guard + backup ──────────────────────────────────────────────────────
const active = await user.collection('workoutSessions').where('status', '==', 'active').get();
if (!active.empty) refusals.push(`${active.size} active session(s) — the device would write the template back whole`);

const profile = (await user.get()).data() ?? {};
const { start, end } = dayRange(DAY, sanitizeDayBoundary(profile['dayBoundary']));
const dayLogs = (await user.collection('dailyLogs')
  .where('timestamp', '>=', Timestamp.fromDate(start)).where('timestamp', '<', Timestamp.fromDate(end)).get()).docs;
const weightRef = user.collection('dailyWeights').doc(DAY);
const weightSnap = await weightRef.get();
const templates = (await user.collection('workoutTemplates').get()).docs;
const backupDir = join(homedir(), 'ignia-backups');
mkdirSync(backupDir, { recursive: true });
const backupPath = join(backupDir, `owner-data-2026-10-10-${AT.getTime()}.json`);
writeFileSync(backupPath, JSON.stringify({
  at: AT.toISOString(),
  dailyLogs: dayLogs.map((d) => ({ id: d.id, ...d.data() })),
  dailyWeight: weightSnap.exists ? weightSnap.data() : null,
  templates: templates.map((d) => ({ id: d.id, ...d.data() })),
}, null, 2));
console.log(`backup → ${backupPath}\n`);

// ── 1 food ──────────────────────────────────────────────────────────────
const existing = dayLogs.map((d) => ({ id: d.id, ...d.data() })) as Array<Record<string, any>>;
console.log(`1  Existing rows on ${DAY}: ${existing.length}`);
for (const e of existing) {
  console.log(`   ${e.id}  ${hhmm(e.timestamp.toDate())}  ${e.mealType ?? '-'}  "${e.mealLabel ?? ''}"  ${e.calories} kcal / ${e.protein ?? '-'} g${e.note ? `  note "${e.note}"` : ''}`);
}
console.log('');
const CODEC: DocCodec<Timestamp> = { timestamp: (d) => Timestamp.fromDate(d), remove: () => FieldValue.delete() };
const claimed = new Set<string>();
const covered = new Map<number, string>();
for (const c of COVERED) {
  const e = existing.find((x) => x.id === c.id);
  if (!e) { refusals.push(`expected row ${c.id} "${c.label}" is gone — re-decide #${c.covers.join('+')}`); continue; }
  const planned = ROWS.filter((r) => c.covers.includes(r.n));
  const want = planned.reduce((a, r) => ({ kcal: a.kcal + r.kcal, protein: a.protein + r.protein }), { kcal: 0, protein: 0 });
  if (e.mealLabel !== c.label || e.calories !== c.kcal || e.protein !== c.protein || want.kcal !== c.kcal || want.protein !== c.protein) {
    refusals.push(`${c.id} is "${e.mealLabel}" ${e.calories}/${e.protein}, expected "${c.label}" ${c.kcal}/${c.protein} = #${c.covers.join('+')} ${want.kcal}/${want.protein}`);
    continue;
  }
  claimed.add(c.id);
  for (const n of c.covers) covered.set(n, c.id);
}
const planned: Array<{ row: Row; doc: Record<string, unknown> }> = [];
ROWS.forEach((r, i) => {
  const line = `#${r.n}  ${r.time}  ${r.slot}  "${r.label}"  ${r.kcal} kcal / ${r.protein} g`;
  const by = covered.get(r.n);
  if (by) {
    const e = existing.find((x) => x.id === by)!;
    console.log(`SKIP  ${line}\n      duplicate of ${by} "${e.mealLabel}" ${e.calories}/${e.protein} at ${hhmm(e.timestamp.toDate())} (${e.mealType}) — kcal/protein agree, not updated`);
    return;
  }
  const at = new Date(`${DAY}T${r.time}:00${OFFSET}`);
  const twin = existing.find((e) => !claimed.has(e.id) && e.mealLabel === r.label);
  if (twin) {
    claimed.add(twin.id);
    if (twin.calories === r.kcal && twin.protein === r.protein && Math.abs(twin.timestamp.toMillis() - at.getTime()) <= 30 * 60_000) {
      console.log(`SKIP  ${line}\n      already logged as ${twin.id}`);
    } else refusals.push(`#${r.n} "${r.label}" is already ${twin.id} at ${twin.calories}/${twin.protein} ${hhmm(twin.timestamp.toDate())} — decide by hand`);
    return;
  }
  const entry: LogEntry = { calories: r.kcal, protein: r.protein, mealLabel: r.label, mealType: r.slot, timestamp: at, createdAt: new Date(AT.getTime() + i), ...(r.note ? { note: r.note } : {}) };
  const doc = toLogDoc(withDefaultMealSlot(entry, at), CODEC) as Record<string, unknown>;
  if (doc.mealLabel !== r.label || doc.mealType !== r.slot || (r.note ?? undefined) !== doc.note || 'carbs' in doc || 'fat' in doc) {
    refusals.push(`#${r.n}: serialized doc is off (${JSON.stringify(doc)})`);
  }
  console.log(`${apply ? 'ADD  ' : 'WOULD'} ${line}${r.note ? `  note "${r.note}"` : ''}`);
  planned.push({ row: r, doc });
});
for (const e of existing) {
  if (claimed.has(e.id)) continue;
  if (e.exerciseCompleted || e.liftCompleted || e.cardioCompleted) continue;
  refusals.push(`unexplained food row ${e.id} "${e.mealLabel ?? ''}" ${e.calories}/${e.protein ?? '-'} at ${hhmm(e.timestamp.toDate())} — decide by hand`);
}
for (const p of planned) { batch.set(user.collection('dailyLogs').doc(), p.doc); writes++; }

// ── 2 weight ────────────────────────────────────────────────────────────
{
  const w = weightSnap.data()?.weight;
  if (w === WEIGHT) console.log(`\n2  dailyWeights/${DAY}: already ${WEIGHT} — nothing to do (no ${WEIGHT_REPLACES} to replace)`);
  else if (!weightSnap.exists || w === WEIGHT_REPLACES) {
    say(`\n2  dailyWeights/${DAY}: ${w ?? '(none)'} → ${WEIGHT}`);
    batch.set(weightRef, { weight: WEIGHT });
    writes++;
  } else refusals.push(`2 dailyWeights/${DAY} is ${w}, expected ${WEIGHT_REPLACES} or ${WEIGHT}`);
}

// ── 3 templates ─────────────────────────────────────────────────────────
for (const [name, spec] of Object.entries(PROGRAMME)) {
  const hits = templates.filter((d) => d.data().name === name);
  if (hits.length !== 1) { refusals.push(`${name}: expected one template, found ${hits.length}`); continue; }
  const doc = hits[0];
  const data = doc.data();
  const before = data.exercises as TemplateExercise[];
  if (before.length !== spec.rows.length || spec.rows.some((s, i) => before[i]?.exerciseId !== s.id)) {
    refusals.push(`${name}: rows are not the programme's, in order — have ${before.map((r) => r.name).join(' → ')}`);
    continue;
  }
  const clusterOk = data.restClusterSec === CLUSTER.from || data.restClusterSec === CLUSTER.to;
  if (!clusterOk) refusals.push(`${name}: restClusterSec ${data.restClusterSec}, expected ${CLUSTER.from} or ${CLUSTER.to}`);

  const rows: TemplateExercise[] = spec.rows.map((s, i) => {
    const r = before[i];
    const { restAfterSec: _a, restAfterMaxSec: _b, ...rest } = r;
    let next: TemplateExercise = { ...rest, ...s.rest };
    if (s.dropOff) {
      const d = drops(r);
      if (d.length > 1 || (d.length === 1 && d[0].weight !== 15)) refusals.push(`${name} / ${r.name}: drops ${JSON.stringify(d)}, expected one at 15`);
      const cues = r.cues ?? [];
      if (d.length === 1 && !cues.includes(DROP_CUE)) refusals.push(`${name} / ${r.name}: drop cue not found verbatim — ${JSON.stringify(cues)}`);
      next = {
        ...next,
        plannedSets: r.plannedSets.filter((p) => p.kind !== 'drop'),
        ...(r.cues ? { cues: r.cues.map((c) => (c === DROP_CUE ? NO_DROP_CUE : c)) } : {}),
      };
    } else if (s.keepDropAt != null) {
      const d = drops(r);
      if (d.length !== 1 || d[0].weight !== s.keepDropAt) refusals.push(`${name} / ${r.name}: drops ${JSON.stringify(d)}, expected one at ${s.keepDropAt} (kept)`);
    } else if (drops(r).length) refusals.push(`${name} / ${r.name}: has a drop set nobody asked about — ${JSON.stringify(drops(r))}`);
    return next;
  });
  const after = carryAndStampRows(before, rows, { at: AT, by: 'prompt' });
  after.forEach((r, i) => {
    const w = spec.rows[i].rest;
    if (r.restAfterSec !== w.restAfterSec || r.restAfterMaxSec !== w.restAfterMaxSec) refusals.push(`${name} / ${r.name}: rest came out ${restText(r, undefined)}`);
  });

  console.log(`\n${name} — rest before the next exercise (s) / drop sets`);
  console.log(`   ${'exercise'.padEnd(26)} ${'before'.padEnd(16)} after`);
  before.forEach((r, i) => {
    const a = after[i];
    const dropB = drops(r).map((p) => ` +drop@${p.weight}`).join('');
    const dropA = drops(a).map((p) => ` +drop@${p.weight}`).join('');
    console.log(`   ${r.name.padEnd(26)} ${(restText(r, data.restClusterSec) + dropB).padEnd(16)} ${restText(a, CLUSTER.to)}${dropA}${canon(a) === canon(r) ? '  (unchanged)' : ''}`);
  });
  console.log(`   between clusters (template) ${data.restClusterSec} → ${CLUSTER.to} (90–120)`);

  const notes = (data.notes as string | undefined) ?? '';
  const nextNotes = notes.includes(spec.note) ? notes : `${notes}\n\n${spec.note}`;
  if (nextNotes.length > 10000) refusals.push(`${name}: notes would be ${nextNotes.length} chars (> 10,000 cap)`);
  if (canon(after) === canon(before) && nextNotes === notes && data.restClusterSec === CLUSTER.to) { console.log(`${name}: nothing to do`); continue; }
  say(`${name}: rows rewritten (${after.filter((r) => r.lastModifiedAt === AT.toISOString()).length} stamped prompt), restClusterSec ${data.restClusterSec} → ${CLUSTER.to}${nextNotes === notes ? '' : ', notes +1 dated line'}`);
  batch.update(doc.ref, clean({ exercises: after, restClusterSec: CLUSTER.to, notes: nextNotes, updatedAt: Timestamp.fromDate(AT) }));
  writes++;
}

if (refusals.length) {
  console.error('\nREFUSED — nothing written:');
  for (const r of refusals) console.error(`  - ${r}`);
  process.exit(1);
}
if (!apply) {
  const total = [...existing, ...planned.map((p) => ({ calories: p.row.kcal, protein: p.row.protein }))]
    .reduce((a, e: any) => ({ kcal: a.kcal + (e.calories ?? 0), protein: a.protein + (e.protein ?? 0) }), { kcal: 0, protein: 0 });
  console.log(`\nDay total after apply: ${total.kcal} kcal / ${total.protein} g`);
  console.log(`[dry run] ${writes} write(s) planned. Re-run with --apply.`);
  process.exit(0);
}
if (writes === 0) console.log('\nNothing to do.');
else { await batch.commit(); console.log(`\nCommitted ${writes} write(s).`); }

const now = (await user.collection('dailyLogs')
  .where('timestamp', '>=', Timestamp.fromDate(start)).where('timestamp', '<', Timestamp.fromDate(end)).get()).docs
  .map((d) => ({ id: d.id, ...d.data() }) as Record<string, any>)
  .sort((a, b) => a.timestamp.toMillis() - b.timestamp.toMillis() || (a.createdAt?.toMillis() ?? 0) - (b.createdAt?.toMillis() ?? 0));
console.log(`\n${DAY} as stored now (${now.length} rows):`);
for (const e of now) console.log(`   ${hhmm(e.timestamp.toDate())}  ${e.mealType}  "${e.mealLabel}"  ${e.calories} / ${e.protein}`);
const total = now.reduce((a, e) => ({ kcal: a.kcal + (e.calories ?? 0), protein: a.protein + (e.protein ?? 0) }), { kcal: 0, protein: 0 });
console.log(`Day total now: ${total.kcal} kcal / ${total.protein} g protein`);
