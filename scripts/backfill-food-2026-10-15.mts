/**
 * One-time food-log entry on the owner's account, requested 2026-10-15: the
 * three breakfast rows of Thursday 2026-10-15 at 08:45 (America/Puerto_Rico),
 * values confirmed with the owner — entered exactly, never recomputed.
 * Expected breakfast total: 513 kcal / 60 g protein.
 *
 * Same machinery as `backfill-food-2026-10-03.mts`: each row is built by the
 * code `addLog` runs (`withDefaultMealSlot` then `toLogDoc`), checked against
 * the `isValidLog` allow-list, carbs/fat left ABSENT. Unlike 10/03 the notes
 * ARE stored — `note` has been a `dailyLogs` field since then.
 *
 * Dry run unless `--apply`. Duplicate check against the existing rows of the
 * owner's 2026-10-15: same label + kcal + protein → SKIP; same label with other
 * values → REFUSE; any other food row on the day → REFUSE (decide by hand).
 * No other row is read for writing. Re-runs are no-ops.
 *
 *   TZ=America/Puerto_Rico npx jiti scripts/backfill-food-2026-10-15.mts --email gabrielandresbermudez@gmail.com [--apply]
 *
 * Auth: ADC (`gcloud auth application-default login`).
 */
import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, Timestamp, FieldValue } from 'firebase-admin/firestore';
import {
  type DocCodec,
  type LogEntry,
  dayRange,
  sanitizeDayBoundary,
  toLogDoc,
  withDefaultMealSlot,
} from '../packages/core/src/index.ts';

const PROJECT_ID = 'fitness-tracker-gb-1775407101';
const DAY = '2026-10-15';
const OFFSET = '-04:00'; // America/Puerto_Rico, no DST
const EXPECT = { kcal: 513, protein: 60 };

type Row = { time: string; slot: LogEntry['mealType']; label: string; kcal: number; protein: number; note: string };
const ROWS: Row[] = [
  { time: '08:45', slot: 'breakfast', label: 'Canadian bacon (Jones), 3 slices', kcal: 60, protein: 10, note: 'Label: 3 slices = 51 g = 60 kcal / 10 g' },
  { time: '08:45', slot: 'breakfast', label: 'Eggs, 2 medium', kcal: 120, protein: 12, note: '' },
  { time: '08:45', slot: 'breakfast', label: 'Pancake Build C, 171 g', kcal: 333, protein: 38, note: '1.95 kcal/g, 0.224 g/g' },
];

// firestore.rules `isValidLog` allow-list, mirrored.
const ALLOWED = new Set(['weight', 'calories', 'timestamp', 'protein', 'carbs', 'fat', 'exerciseCompleted', 'liftCompleted', 'cardioCompleted', 'mealLabel', 'mealType', 'source', 'note', 'grams', 'createdAt']);

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

// Sanity: the table must sum to the confirmed total before anything else.
const sum = ROWS.reduce((a, r) => ({ kcal: a.kcal + r.kcal, protein: a.protein + r.protein }), { kcal: 0, protein: 0 });
if (sum.kcal !== EXPECT.kcal || sum.protein !== EXPECT.protein) {
  console.error(`Table sums to ${sum.kcal} kcal / ${sum.protein} g, expected ${EXPECT.kcal} / ${EXPECT.protein}. Aborting.`);
  process.exit(1);
}

initializeApp({ credential: applicationDefault(), projectId: PROJECT_ID });
const db = getFirestore();
if (!uid) uid = (await getAuth().getUserByEmail(email!)).uid;
const user = db.collection('users').doc(uid);
console.log(`${apply ? '' : '[dry run] '}uid ${uid}`);

const profile = await user.get();
if (!profile.exists) { console.error('No profile doc.'); process.exit(1); }
const boundary = sanitizeDayBoundary(profile.data()?.['dayBoundary']);
const { start, end } = dayRange(DAY, boundary);
console.log(`day ${DAY}: ${start.toISOString()} → ${end.toISOString()} (boundary ${JSON.stringify(boundary)})`);

const CODEC: DocCodec<Timestamp> = { timestamp: (d) => Timestamp.fromDate(d), remove: () => FieldValue.delete() };

const existingSnap = await user.collection('dailyLogs')
  .where('timestamp', '>=', Timestamp.fromDate(start))
  .where('timestamp', '<', Timestamp.fromDate(end))
  .get();
const existing = existingSnap.docs.map((d) => ({ id: d.id, ...d.data() })) as Array<Record<string, any>>;
const norm = (s: unknown) => String(s ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
const fmt = (d: Date) => d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });

console.log(`\nExisting rows on ${DAY}: ${existing.length}`);
for (const e of existing) {
  console.log(`  ${e.id}  ${fmt(e.timestamp.toDate())}  ${e.mealType ?? '-'}  "${e.mealLabel ?? ''}"  ${e.calories} kcal / ${e.protein ?? '-'} g`
    + `${e.carbs != null ? ` c${e.carbs}` : ''}${e.fat != null ? ` f${e.fat}` : ''}${e.weight != null ? ` weight ${e.weight}` : ''}${e.exerciseCompleted ? ' [exercise marker]' : ''}`);
}

const refusals: string[] = [];
const writes: Array<{ row: Row; doc: Record<string, unknown> }> = [];
const claimed = new Set<string>();

console.log('\nPlanned rows:');
ROWS.forEach((r, i) => {
  const at = new Date(`${DAY}T${r.time}:00${OFFSET}`);
  const doc = toLogDoc(withDefaultMealSlot({ calories: r.kcal, protein: r.protein, mealLabel: r.label, mealType: r.slot, timestamp: at, ...(r.note ? { note: r.note } : {}) }, at), CODEC) as Record<string, unknown>;
  const bad = Object.keys(doc).filter((k) => !ALLOWED.has(k));
  if (bad.length || 'carbs' in doc || 'fat' in doc || doc.mealType !== r.slot) refusals.push(`#${i + 1}: serialized doc is off (${JSON.stringify(doc)})`);
  const line = `#${i + 1}  ${DAY} ${r.time}  ${r.slot}  "${r.label}"  ${r.kcal} kcal / ${r.protein} g  ${r.note ? ` — note: ${r.note}` : ''}`;

  const sameLabel = existing.filter((e) => !claimed.has(e.id) && norm(e.mealLabel) === norm(r.label));
  const exact = sameLabel.find((e) => e.calories === r.kcal && (e.protein ?? null) === r.protein);
  if (exact) {
    claimed.add(exact.id);
    console.log(`SKIP  ${line}\n      already logged as ${exact.id} at ${fmt(exact.timestamp.toDate())} (${exact.mealType ?? '-'})`);
    return;
  }
  if (sameLabel.length) {
    for (const e of sameLabel) refusals.push(`#${i + 1} "${r.label}": already there as ${e.id} with ${e.calories} kcal / ${e.protein ?? '-'} g (planned ${r.kcal} / ${r.protein}) — not overwriting`);
    return;
  }
  console.log(`${apply ? 'ADD  ' : 'WOULD'} ${line}`);
  writes.push({ row: r, doc });
});

// Food rows on the day that match none of the three: maybe one of them, logged
// by hand under another name. The confirmed total would be wrong either way.
for (const e of existing) {
  if (claimed.has(e.id)) continue;
  const marker = e.exerciseCompleted || e.liftCompleted || e.cardioCompleted || (e.weight != null && !e.mealLabel && e.calories === 0);
  if (marker) continue;
  refusals.push(`unexplained food row ${e.id} "${e.mealLabel ?? ''}" ${e.calories} kcal / ${e.protein ?? '-'} g at ${fmt(e.timestamp.toDate())} — decide by hand`);
}

console.log('');
for (const r of refusals) console.log(`REFUSE  ${r}`);
if (refusals.length) { console.log('\nAborted: nothing written (refusals above).'); process.exit(1); }

if (writes.length === 0) {
  console.log('Nothing to do.');
} else if (apply) {
  const batch = db.batch();
  for (const w of writes) batch.set(user.collection('dailyLogs').doc(), w.doc);
  await batch.commit();
  console.log(`Applied ${writes.length} write(s).`);
} else {
  console.log(`${writes.length} write(s) pending — dry run, re-run with --apply.`);
}

// The day as the app will total it: every non-marker row in the range.
const after = apply
  ? (await user.collection('dailyLogs').where('timestamp', '>=', Timestamp.fromDate(start)).where('timestamp', '<', Timestamp.fromDate(end)).get()).docs.map((d) => d.data())
  : [...existing, ...writes.map((w) => ({ calories: w.row.kcal, protein: w.row.protein }))];
const total = after.reduce((a, e: any) => ({ kcal: a.kcal + (e.calories ?? 0), protein: a.protein + (e.protein ?? 0) }), { kcal: 0, protein: 0 });
console.log(`${apply ? 'Day total now' : 'Day total after apply'}: ${total.kcal} kcal / ${total.protein} g protein (${after.length} rows)`);
