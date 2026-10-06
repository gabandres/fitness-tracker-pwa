/**
 * One-time entry on the owner's account, requested 2026-10-05: the five
 * remaining food rows of Monday 2026-10-05 (America/Puerto_Rico) plus that
 * morning's weigh-in and tape, values confirmed with the owner — entered
 * exactly, never recomputed. Expected day total when all five food rows are
 * created: 1,644 kcal / 160 g protein.
 *
 * Writers are the app's own:
 * - food: `withDefaultMealSlot` + `toLogDoc` (what `addLog` runs), checked
 *   against the `isValidLog` allow-list. Carbs/fat ABSENT, never 0.
 * - weight: `dailyWeights/{dateKey} = { weight }` in lb (`setDailyWeight`),
 *   gated by `isStorableWeight` like every app weight write.
 * - tape: `toMeasurementDoc` (what `addMeasurement` runs), checked against
 *   `isValidMeasurement`'s allow-list.
 * The Admin SDK bypasses rules, hence the mirrored checks.
 *
 * Food notes ARE stored (`note`, allowed since the 2026-10-03 rules deploy),
 * with `createdAt` in table order so the four 17:45 rows list as given
 * (`compareLogsOldestFirst`). The tape note is printed, NOT stored:
 * `measurements` has no note field (`isValidMeasurement` is `hasOnly`).
 *
 * Duplicate policy on 2026-10-05 only:
 * - the four rows already logged that day (Baguel, grilled chicken, Unreal,
 *   Snack) are expected and never touched;
 * - a planned row with the same label + kcal → SKIP; same label, other values
 *   → REFUSE (exit 1, nothing written); any other unexplained food row →
 *   REFUSE (decide by hand);
 * - weight / tape already there with the same values → SKIP; different →
 *   REFUSE, never overwrite.
 *
 * After the writes it recomputes Trends' composition-adjusted maintenance and
 * recomp signal exactly as `useCompositionTrends` does (400-row log cache, all
 * daily weights, 183 days of measurements), before and after.
 *
 *   TZ=America/Puerto_Rico npx jiti scripts/backfill-2026-10-05.mts --email gabrielandresbermudez@gmail.com [--apply]
 *
 * Auth: ADC (`gcloud auth application-default login`).
 */
import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, Timestamp, FieldValue } from 'firebase-admin/firestore';
import {
  type DocCodec,
  type LogEntry,
  type Measurement,
  COMP_DXA_WINDOW_MAX_DAYS,
  LOG_WINDOW_ROWS,
  compositionMaintenance,
  dayBoundaryOf,
  dayRange,
  isStorableWeight,
  logsCompleteFrom,
  readWeightLb,
  recompSignal,
  sanitizeDayBoundary,
  toDailyLog,
  toDomainProfile,
  toLogDoc,
  toMeasurement,
  toMeasurementDoc,
  withDefaultMealSlot,
} from '../packages/core/src/index.ts';

const PROJECT_ID = 'fitness-tracker-gb-1775407101';
const DAY = '2026-10-05';
const OFFSET = '-04:00'; // America/Puerto_Rico, no DST
const EXPECT_NEW = { kcal: 761, protein: 72 };
const EXPECT_DAY = { kcal: 1644, protein: 160 };

type Row = { time: string; slot: LogEntry['mealType']; label: string; kcal: number; protein: number; note: string };
const ROWS: Row[] = [
  { time: '17:45', slot: 'dinner', label: 'Ham, thin sliced, 91 g', kcal: 114, protein: 15, note: 'Weighed. 70 kcal / 9 g per 56 g' },
  { time: '17:45', slot: 'dinner', label: 'Pea-chickpea bagel (150 g)', kcal: 345, protein: 31, note: 'Not weighed; logged as the largest remaining (2.30 kcal/g, 0.21 g/g, batch of 10/4)' },
  { time: '17:45', slot: 'dinner', label: 'Banana, 36 g', kcal: 32, protein: 0, note: 'Weighed' },
  { time: '17:45', slot: 'dinner', label: 'Cheddar slice (Costco)', kcal: 80, protein: 5, note: 'Label' },
  { time: '20:45', slot: 'snack', label: 'Kirkland protein bar', kcal: 190, protein: 21, note: 'Label' },
];
/** Already on the day; expected, never touched. */
const KNOWN: Array<{ label: string; kcal: number; protein: number }> = [
  { label: 'Baguel', kcal: 383, protein: 37 },
  { label: 'grilled chicken breast + romaine salad with carrots', kcal: 330, protein: 48 },
  { label: 'Unreal', kcal: 80, protein: 1 },
  { label: 'Snack', kcal: 90, protein: 2 },
];
const WEIGHT_LB = 154.4;
/** Morning, fasted. The exact minute was not given; 07:00 local. */
const TAPE_TIME = '07:00';
const TAPE = { waist: 31.5, neck: 14.25 };
const TAPE_NOTE = 'waist at navel, median of 3 readings; possibly low reading — confirm 10/12';

// firestore.rules allow-lists, mirrored.
const LOG_ALLOWED = new Set(['weight', 'calories', 'timestamp', 'protein', 'carbs', 'fat', 'exerciseCompleted', 'liftCompleted', 'cardioCompleted', 'mealLabel', 'mealType', 'source', 'note', 'createdAt']);
const MEAS_ALLOWED = new Set(['timestamp', 'waist', 'chest', 'bicep', 'hip', 'neck', 'bodyFatPct', 'bodyFatMethod']);

if (Intl.DateTimeFormat().resolvedOptions().timeZone !== 'America/Puerto_Rico') {
  console.error('Run with TZ=America/Puerto_Rico — the day boundary math is local-time.');
  process.exit(2);
}
const argv = process.argv.slice(2);
const arg = (n: string) => { const i = argv.indexOf(`--${n}`); return i === -1 ? null : argv[i + 1]; };
const apply = argv.includes('--apply');
const email = arg('email');
let uid = arg('uid');
if (!email && !uid) {
  console.error('usage: … (--email <email> | --uid <uid>) [--apply]');
  process.exit(2);
}

const sum = ROWS.reduce((a, r) => ({ kcal: a.kcal + r.kcal, protein: a.protein + r.protein }), { kcal: 0, protein: 0 });
const known = KNOWN.reduce((a, r) => ({ kcal: a.kcal + r.kcal, protein: a.protein + r.protein }), { kcal: 0, protein: 0 });
if (sum.kcal !== EXPECT_NEW.kcal || sum.protein !== EXPECT_NEW.protein
  || sum.kcal + known.kcal !== EXPECT_DAY.kcal || sum.protein + known.protein !== EXPECT_DAY.protein) {
  console.error(`Table sums disagree: new ${sum.kcal}/${sum.protein}, day ${sum.kcal + known.kcal}/${sum.protein + known.protein}. Aborting.`);
  process.exit(1);
}

initializeApp({ credential: applicationDefault(), projectId: PROJECT_ID });
const db = getFirestore();
if (!uid) uid = (await getAuth().getUserByEmail(email!)).uid;
const user = db.collection('users').doc(uid);
console.log(`${apply ? '' : '[dry run] '}uid ${uid}`);

const profileSnap = await user.get();
if (!profileSnap.exists) { console.error('No profile doc.'); process.exit(1); }
const boundary = sanitizeDayBoundary(profileSnap.data()?.['dayBoundary']);
const { start, end } = dayRange(DAY, boundary);
console.log(`day ${DAY}: ${start.toISOString()} → ${end.toISOString()} (boundary ${JSON.stringify(boundary)})`);

const CODEC: DocCodec<Timestamp> = { timestamp: (d) => Timestamp.fromDate(d), remove: () => FieldValue.delete() };
const norm = (s: unknown) => String(s ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
const fmt = (d: Date) => d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
const isMarker = (e: Record<string, any>) => e.exerciseCompleted || e.liftCompleted || e.cardioCompleted || (e.weight != null && !e.mealLabel && e.calories === 0);

const dayLogs = async () => (await user.collection('dailyLogs')
  .where('timestamp', '>=', Timestamp.fromDate(start))
  .where('timestamp', '<', Timestamp.fromDate(end))
  .get()).docs.map((d) => ({ id: d.id, ...d.data() })) as Array<Record<string, any>>;
const existing = await dayLogs();

console.log(`\nExisting rows on ${DAY}: ${existing.length}`);
for (const e of existing) {
  console.log(`  ${e.id}  ${fmt(e.timestamp.toDate())}  ${e.mealType ?? '-'}  "${e.mealLabel ?? ''}"  ${e.calories} kcal / ${e.protein ?? '-'} g`
    + `${e.carbs != null ? ` c${e.carbs}` : ''}${e.fat != null ? ` f${e.fat}` : ''}${e.weight != null ? ` weight ${e.weight}` : ''}${isMarker(e) ? ' [marker]' : ''}`);
}

const refusals: string[] = [];
const claimed = new Set<string>();

// The four known rows must be there, as described — they are the other 883 kcal.
for (const k of KNOWN) {
  const hit = existing.find((e) => !claimed.has(e.id) && norm(e.mealLabel) === norm(k.label) && e.calories === k.kcal && (e.protein ?? null) === k.protein);
  if (hit) claimed.add(hit.id);
  else refusals.push(`expected existing row "${k.label}" ${k.kcal} / ${k.protein} not found as described`);
}

const logWrites: Array<{ row: Row; doc: Record<string, unknown> }> = [];
const createdBase = Date.now();
console.log('\nPlanned food rows:');
ROWS.forEach((r, i) => {
  const at = new Date(`${DAY}T${r.time}:00${OFFSET}`);
  const doc = toLogDoc(withDefaultMealSlot({ calories: r.kcal, protein: r.protein, mealLabel: r.label, mealType: r.slot, timestamp: at, note: r.note, createdAt: new Date(createdBase + i) }, at), CODEC) as Record<string, unknown>;
  const bad = Object.keys(doc).filter((k) => !LOG_ALLOWED.has(k));
  if (bad.length || 'carbs' in doc || 'fat' in doc || doc.mealType !== r.slot || doc.protein !== r.protein || doc.note !== r.note) refusals.push(`#${i + 1}: serialized doc is off (${JSON.stringify(doc)})`);
  const line = `#${i + 1}  ${DAY} ${r.time}  ${r.slot}  "${r.label}"  ${r.kcal} kcal / ${r.protein} g  — note: ${r.note}`;

  const sameLabel = existing.filter((e) => !claimed.has(e.id) && norm(e.mealLabel) === norm(r.label));
  const exact = sameLabel.find((e) => e.calories === r.kcal);
  if (exact) {
    claimed.add(exact.id);
    if ((exact.protein ?? null) !== r.protein) refusals.push(`#${i + 1} "${r.label}": there as ${exact.id} with ${exact.calories} kcal / ${exact.protein ?? '-'} g (planned ${r.kcal} / ${r.protein})`);
    else console.log(`SKIP  ${line}\n      already logged as ${exact.id} at ${fmt(exact.timestamp.toDate())} (${exact.mealType ?? '-'})`);
    return;
  }
  if (sameLabel.length) {
    for (const e of sameLabel) refusals.push(`#${i + 1} "${r.label}": already there as ${e.id} with ${e.calories} kcal / ${e.protein ?? '-'} g (planned ${r.kcal} / ${r.protein}) — not overwriting`);
    return;
  }
  console.log(`${apply ? 'ADD  ' : 'WOULD'} ${line}`);
  logWrites.push({ row: r, doc });
});
for (const e of existing) {
  if (claimed.has(e.id) || isMarker(e)) continue;
  refusals.push(`unexplained food row ${e.id} "${e.mealLabel ?? ''}" ${e.calories} kcal / ${e.protein ?? '-'} g at ${fmt(e.timestamp.toDate())} — decide by hand`);
}

// ─── Body data ───────────────────────────────────────────────
console.log('\nBody data:');
const weightRef = user.collection('dailyWeights').doc(DAY);
const weightSnap = await weightRef.get();
let writeWeight = false;
if (!isStorableWeight(WEIGHT_LB)) refusals.push(`weight ${WEIGHT_LB} fails isStorableWeight`);
if (weightSnap.exists) {
  const w = readWeightLb(weightSnap.data());
  if (w === WEIGHT_LB) console.log(`SKIP  weight ${DAY} ${WEIGHT_LB} lb — already logged`);
  else refusals.push(`weight ${DAY} already logged as ${JSON.stringify(weightSnap.data())} (planned ${WEIGHT_LB}) — not overwriting`);
} else {
  writeWeight = true;
  console.log(`${apply ? 'ADD  ' : 'WOULD'} weight dailyWeights/${DAY} = { weight: ${WEIGHT_LB} }`);
}

const tapeAt = new Date(`${DAY}T${TAPE_TIME}:00${OFFSET}`);
const measDay = (await user.collection('measurements')
  .where('timestamp', '>=', Timestamp.fromDate(start))
  .where('timestamp', '<', Timestamp.fromDate(end))
  .get()).docs.map((d) => toMeasurement(d.id, d.data()));
const tapeDoc = toMeasurementDoc(TAPE, CODEC, tapeAt) as Record<string, unknown>;
const badMeas = Object.keys(tapeDoc).filter((k) => !MEAS_ALLOWED.has(k));
if (badMeas.length) refusals.push(`tape doc is off (${JSON.stringify(tapeDoc)})`);
let writeTape = false;
for (const m of measDay) console.log(`  existing measurement ${m.id} ${fmt(m.date)} ${JSON.stringify({ ...m, id: undefined, date: undefined })}`);
const withTape = measDay.filter((m) => m.waist != null || m.neck != null);
if (withTape.length === 0) {
  writeTape = true;
  console.log(`${apply ? 'ADD  ' : 'WOULD'} tape ${DAY} ${TAPE_TIME}  waist ${TAPE.waist} in · neck ${TAPE.neck} in — note (not stored): ${TAPE_NOTE}`);
} else if (withTape.some((m) => m.waist === TAPE.waist && m.neck === TAPE.neck)) {
  console.log(`SKIP  tape ${DAY} waist ${TAPE.waist} / neck ${TAPE.neck} — already logged`);
} else {
  for (const m of withTape) refusals.push(`tape on ${DAY} already logged as ${m.id}: waist ${m.waist ?? '-'} / neck ${m.neck ?? '-'} (planned ${TAPE.waist} / ${TAPE.neck}) — not overwriting`);
}

// ─── Composition, as Trends computes it ──────────────────────
async function trends(label: string) {
  const [logsSnap, weightsSnap, measSnap, prof] = await Promise.all([
    user.collection('dailyLogs').orderBy('timestamp', 'desc').limit(LOG_WINDOW_ROWS).get(),
    user.collection('dailyWeights').get(),
    user.collection('measurements')
      .where('timestamp', '>=', Timestamp.fromDate(new Date(Date.now() - (COMP_DXA_WINDOW_MAX_DAYS + 1) * 86_400_000)))
      .orderBy('timestamp', 'desc').get(),
    user.get(),
  ]);
  const logs = logsSnap.docs.map((d) => toDailyLog(d.id, d.data()));
  const weights: Record<string, number> = {};
  for (const d of weightsSnap.docs) { const w = readWeightLb(d.data()); if (w != null) weights[d.id] = w; }
  const measurements: Measurement[] = measSnap.docs.map((d) => toMeasurement(d.id, d.data()));
  const profile = toDomainProfile(prof.data() ?? {});
  const b = dayBoundaryOf(profile);
  const now = new Date();
  const comp = compositionMaintenance({
    logs, dailyWeights: weights, measurements,
    profile: { sex: profile?.sex ?? null, heightIn: profile?.heightIn ?? null },
    boundary: b, now, logsCompleteFromKey: logsCompleteFrom(logs, LOG_WINDOW_ROWS, b),
  });
  const recomp = recompSignal({ dailyWeights: weights, measurements, boundary: b, now });
  console.log(`\n── ${label} ──`);
  console.log('composition:', JSON.stringify(comp));
  console.log('recomp:', JSON.stringify(recomp));
}

console.log('');
for (const r of refusals) console.log(`REFUSE  ${r}`);
if (refusals.length) { console.log('\nAborted: nothing written (refusals above).'); process.exit(1); }

const total = logWrites.length + (writeWeight ? 1 : 0) + (writeTape ? 1 : 0);
if (!apply) await trends('Trends now (before)');
if (total === 0) {
  console.log('Nothing to do.');
} else if (apply) {
  const batch = db.batch();
  for (const w of logWrites) batch.set(user.collection('dailyLogs').doc(), w.doc);
  if (writeWeight) batch.set(weightRef, { weight: WEIGHT_LB });
  if (writeTape) batch.set(user.collection('measurements').doc(), tapeDoc);
  await batch.commit();
  console.log(`Applied ${total} write(s): ${logWrites.length} food, ${writeWeight ? 1 : 0} weight, ${writeTape ? 1 : 0} tape.`);
} else {
  console.log(`${total} write(s) pending — dry run, re-run with --apply.`);
}

const after = apply ? await dayLogs() : [...existing, ...logWrites.map((w) => ({ calories: w.row.kcal, protein: w.row.protein }))];
const day = after.reduce((a, e: any) => ({ kcal: a.kcal + (e.calories ?? 0), protein: a.protein + (e.protein ?? 0) }), { kcal: 0, protein: 0 });
console.log(`${apply ? 'Day total now' : 'Day total after apply'}: ${day.kcal} kcal / ${day.protein} g protein (${after.length} rows)`);
if (apply) await trends('Trends after');
