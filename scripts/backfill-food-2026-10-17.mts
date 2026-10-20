/**
 * One-time food-log entry on the owner's account, requested 2026-10-17 (state
 * as of 17:54): Saturday 2026-10-17 (America/Puerto_Rico) so far, values
 * confirmed with the owner — entered exactly, never recomputed. Expected so
 * far: 1,356 kcal / 129 g. Dinner may be added later by hand; it is not here.
 *
 * Three hand-entered rows were found on the day (each checked by id AND value;
 * any drift → refuse):
 *   - "Stacks" 505 / 50 at 11:45 → REPLACED by the 07:45 pancakes row;
 *   - "Chicken Sándwich" 560 / 42 at 12:55 → REPLACED by the 12:00 Church's
 *     row (light mayo);
 *   - "donut krispy kream" 92 / 1 at 11:46 is on no list → KEPT and reported,
 *     so the day reads 92 / 1 above the 1,356 / 129 expected.
 * Any OTHER food row refuses the run (decide by hand).
 *
 * Weight: `dailyWeights/2026-10-17 = { weight: 153.2 }` — kept if already
 * there, written if absent, refused if a different value is stored. The doc
 * holds no time of day, so 07:30 is not stored.
 *
 * Not touched: sleep, water, workouts (rest day). They are read and reported
 * (sleep 8 h and water 24 fl oz were already logged by hand at the read).
 *
 * Also adds three saved foods (`customFoods`) when no food of that name exists;
 * an existing one is never overwritten. Kcal/protein only, like the log rows.
 *
 * Everything read is backed up to ~/ignia-backups first. Dry run unless
 * `--apply`; re-runs are no-ops (added rows are matched by label + values).
 *
 *   TZ=America/Puerto_Rico npx jiti scripts/backfill-food-2026-10-17.mts --email gabrielandresbermudez@gmail.com [--apply]
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
  dayRange,
  isStorableWeight,
  readWeightLb,
  sanitizeDayBoundary,
  toLogDoc,
  withDefaultMealSlot,
} from '../packages/core/src/index.ts';

const PROJECT_ID = 'fitness-tracker-gb-1775407101';
const DAY = '2026-10-17';
const OFFSET = '-04:00'; // America/Puerto_Rico, no DST
const EXPECT_DAY = { kcal: 1356, protein: 129 };
const WEIGHT_LB = 153.2;

type Row = { time: string; slot: LogEntry['mealType']; label: string; kcal: number; protein: number; note: string };
const ROWS: Row[] = [
  { time: '07:45', slot: 'breakfast', label: 'Build C pancakes 259 g', kcal: 505, protein: 58, note: 'Density 1.95 kcal/g, 0.224 g/g' },
  { time: '12:00', slot: 'lunch', label: "Church's Pechu Grill sandwich (light mayo)", kcal: 510, protein: 42, note: '' },
  { time: '17:30', slot: 'snack', label: 'Grapes ×7', kcal: 25, protein: 0, note: '3.5 kcal each' },
  { time: '17:30', slot: 'snack', label: 'Casein bowl + banana (no PB)', kcal: 316, protein: 29, note: '½ c Daisy 2% + ½ c Kirkland Greek + ½ c blueberries + banana 91 g' },
];
const REPLACE: Record<string, { label: string; kcal: number; protein: number; why: string }> = {
  pjHjx0Ds8appDKoj5rTb: { label: 'Stacks', kcal: 505, protein: 50, why: 'hand entry 11:45 → the 07:45 pancakes row (protein 50 → 58)' },
  A3XosEnS7ZV4koTKcj1v: { label: 'Chicken Sándwich', kcal: 560, protein: 42, why: "hand entry 12:55 → the 12:00 Church's row (light mayo, 560 → 510)" },
};
// Hand entries on no list: kept untouched and reported (the owner decides).
const KEEP: Record<string, { label: string; kcal: number; protein: number }> = {
  NdC6Ar2WoBOsiXAiIHVh: { label: 'donut krispy kream', kcal: 92, protein: 1 },
};
const FOODS = [
  { name: 'Casein bowl + banana (no PB)', servingSize: 1, servingUnit: 'serving', calories: 316, protein: 29 },
  { name: 'Grapes', servingSize: 1, servingUnit: 'piece', calories: 3.5, protein: 0 },
  { name: "Church's Pechu Grill sandwich (light mayo)", servingSize: 1, servingUnit: 'serving', calories: 510, protein: 42 },
] as const;

// firestore.rules `isValidLog` allow-list, mirrored.
const ALLOWED = new Set(['weight', 'calories', 'timestamp', 'protein', 'carbs', 'fat', 'exerciseCompleted', 'liftCompleted', 'cardioCompleted', 'mealLabel', 'mealType', 'source', 'note', 'grams', 'createdAt']);

if (Intl.DateTimeFormat().resolvedOptions().timeZone !== 'America/Puerto_Rico') {
  console.error('Run with TZ=America/Puerto_Rico — the day boundary math is local-time.');
  process.exit(2);
}
const argv = process.argv.slice(2);
const email = argv[argv.indexOf('--email') + 1];
const apply = argv.includes('--apply');
if (!email || email.startsWith('--')) { console.error('--email is required'); process.exit(2); }

const sum = (xs: { kcal: number; protein: number }[]) => xs.reduce((a, r) => ({ kcal: a.kcal + r.kcal, protein: a.protein + r.protein }), { kcal: 0, protein: 0 });
const s = sum(ROWS);
if (s.kcal !== EXPECT_DAY.kcal || s.protein !== EXPECT_DAY.protein) {
  console.error(`Table sums to ${s.kcal} / ${s.protein}, expected ${EXPECT_DAY.kcal} / ${EXPECT_DAY.protein}. Aborting.`);
  process.exit(1);
}

initializeApp({ credential: applicationDefault(), projectId: PROJECT_ID });
const db = getFirestore();
const uid = (await getAuth().getUserByEmail(email)).uid;
const user = db.collection('users').doc(uid);
console.log(`${apply ? '' : '[dry run] '}uid ${uid}`);

const boundary = sanitizeDayBoundary((await user.get()).data()?.['dayBoundary']);
const { start, end } = dayRange(DAY, boundary);
const readDay = async () => (await user.collection('dailyLogs')
  .where('timestamp', '>=', Timestamp.fromDate(start)).where('timestamp', '<', Timestamp.fromDate(end)).get())
  .docs.map((d) => ({ id: d.id, ref: d.ref, ...d.data() })) as Array<Record<string, any>>;
const existing = await readDay();
const foodsSnap = await user.collection('customFoods').get();
const weightRef = user.collection('dailyWeights').doc(DAY);
const weightSnap = await weightRef.get();
const sleepSnap = await user.collection('dailySleep').doc(DAY).get();
const waterSnap = await user.collection('dailyWater').doc(DAY).get();
const sessions = (await user.collection('workoutSessions')
  .where('timestamp', '>=', Timestamp.fromDate(start)).where('timestamp', '<', Timestamp.fromDate(end)).get())
  .docs.map((d) => ({ id: d.id, status: d.get('status'), name: d.get('name') ?? d.get('templateName'), timestamp: d.get('timestamp') }));
// The two days before, read only: their totals are reported, never written.
const priorTotals: string[] = [];
for (const [day, kcal, protein] of [['2026-10-15', 1939, 169], ['2026-10-16', 2120, 192]] as const) {
  const r = dayRange(day, boundary);
  const rows = (await user.collection('dailyLogs').where('timestamp', '>=', Timestamp.fromDate(r.start)).where('timestamp', '<', Timestamp.fromDate(r.end)).get()).docs.map((d) => d.data());
  const food = rows.filter((e) => !(e.exerciseCompleted || e.liftCompleted || e.cardioCompleted || (e.weight != null && !e.mealLabel && e.calories === 0)));
  const k = food.reduce((a, e) => a + (e.calories ?? 0), 0), pr = food.reduce((a, e) => a + (e.protein ?? 0), 0);
  priorTotals.push(`${day}: ${food.length} food rows, ${k} / ${pr} (expected ${kcal} / ${protein})${k === kcal && pr === protein ? ' ✓' : ' ✗'}`);
}

const conv = (v: unknown): unknown => {
  if (v instanceof Timestamp) return v.toDate().toISOString();
  if (Array.isArray(v)) return v.map(conv);
  if (v && typeof v === 'object' && !('firestore' in (v as object))) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, conv(x)]));
  return v;
};
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const dir = join(homedir(), 'ignia-backups');
mkdirSync(dir, { recursive: true });
const backup = join(dir, `backfill-food-2026-10-17-${stamp}.json`);
writeFileSync(backup, JSON.stringify(conv({
  uid, day: DAY,
  dailyLogs: existing.map(({ ref, ...x }) => x),
  customFoods: foodsSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
  dailyWeight: weightSnap.exists ? weightSnap.data() : null,
  dailySleep: sleepSnap.exists ? sleepSnap.data() : null,
  dailyWater: waterSnap.exists ? waterSnap.data() : null,
  workoutSessions: sessions,
}), null, 1));
console.log(`backup: ${backup}`);

const norm = (x: unknown) => String(x ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
const fmt = (d: Date) => d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
const line = (e: Record<string, any>) => `${e.id}  ${fmt(e.timestamp.toDate())}  ${e.mealType ?? '-'}  "${e.mealLabel ?? ''}"  ${e.calories} / ${e.protein ?? '-'}`
  + `${e.carbs != null ? ` c${e.carbs}` : ''}${e.fat != null ? ` f${e.fat}` : ''}${e.grams != null ? ` ${e.grams} g` : ''}`;
const isMarker = (e: Record<string, any>) => e.exerciseCompleted || e.liftCompleted || e.cardioCompleted || (e.weight != null && !e.mealLabel && e.calories === 0);

console.log('\nEarlier days (read only):');
for (const t of priorTotals) console.log(`  ${t}`);
console.log(`\nRows on ${DAY}: ${existing.length}`);
for (const e of existing) console.log(`  ${line(e)}${isMarker(e) ? '  [marker]' : ''}`);
console.log(`Weight ${DAY}: ${weightSnap.exists ? JSON.stringify(weightSnap.data()) : 'none'}`);
console.log(`Sleep ${DAY}: ${sleepSnap.exists ? JSON.stringify(sleepSnap.data()) : 'none'} · Water: ${waterSnap.exists ? JSON.stringify(waterSnap.data()) : 'none'}`);
console.log(`Workout sessions ${DAY}: ${sessions.length ? sessions.map((x) => `${x.id} ${x.status} "${x.name ?? ''}"`).join(', ') : 'none'}`);

const refusals: string[] = [];
const deletes: Array<Record<string, any>> = [];
const claimed = new Set<string>();

console.log('\nPlan:');
for (const e of existing) {
  if (isMarker(e)) continue;
  const r = REPLACE[e.id];
  if (r) {
    if (e.mealLabel !== r.label || e.calories !== r.kcal || e.protein !== r.protein) refusals.push(`${e.id} changed since the read: ${line(e)}`);
    else { deletes.push(e); console.log(`${apply ? 'DELETE' : 'WOULD DELETE'}  ${line(e)} — ${r.why}`); }
    continue;
  }
  const k = KEEP[e.id];
  if (k) {
    if (e.mealLabel !== k.label || e.calories !== k.kcal || e.protein !== k.protein) refusals.push(`${e.id} changed since the read: ${line(e)}`);
    else console.log(`KEEP  ${line(e)} — on no list, left for the owner`);
    continue;
  }
  const mine = ROWS.find((x) => norm(x.label) === norm(e.mealLabel) && x.kcal === e.calories && x.protein === e.protein);
  if (mine) { claimed.add(mine.label); continue; }
  refusals.push(`unexplained food row ${line(e)} — decide by hand`);
}
const missing = Object.keys(REPLACE).filter((id) => !existing.some((e) => e.id === id));
for (const id of missing) console.log(`  (${id} already gone)`);

const CODEC: DocCodec<Timestamp> = { timestamp: (d) => Timestamp.fromDate(d), remove: () => FieldValue.delete() };
const writes: Array<Record<string, unknown>> = [];
ROWS.forEach((r, i) => {
  const at = new Date(`${DAY}T${r.time}:00${OFFSET}`);
  const doc = toLogDoc(withDefaultMealSlot({ calories: r.kcal, protein: r.protein, mealLabel: r.label, mealType: r.slot, timestamp: at, ...(r.note ? { note: r.note } : {}) }, at), CODEC) as Record<string, unknown>;
  const bad = Object.keys(doc).filter((k) => !ALLOWED.has(k));
  if (bad.length || 'carbs' in doc || 'fat' in doc || doc.mealType !== r.slot) refusals.push(`#${i + 1}: serialized doc is off (${JSON.stringify(doc)})`);
  const tag = `${r.time}  ${r.slot}  "${r.label}"  ${r.kcal} / ${r.protein}${r.note ? `  — note: ${r.note}` : ''}`;
  if (claimed.has(r.label)) { console.log(`SKIP  ${tag} (already logged)`); return; }
  console.log(`${apply ? 'ADD' : 'WOULD ADD'}  ${tag}`);
  writes.push(doc);
});

let writeWeight = false;
if (!isStorableWeight(WEIGHT_LB)) refusals.push(`weight ${WEIGHT_LB} fails isStorableWeight`);
if (weightSnap.exists) {
  const w = readWeightLb(weightSnap.data());
  if (w === WEIGHT_LB) console.log(`KEEP  weight ${DAY} ${WEIGHT_LB} lb — already logged`);
  else refusals.push(`weight ${DAY} already logged as ${JSON.stringify(weightSnap.data())} (planned ${WEIGHT_LB}) — not overwriting`);
} else {
  writeWeight = true;
  console.log(`${apply ? 'ADD' : 'WOULD ADD'}  weight dailyWeights/${DAY} = { weight: ${WEIGHT_LB} }`);
}

const foodWrites: Array<Record<string, unknown>> = [];
console.log(`\nSaved foods (${foodsSnap.size} existing):`);
for (const f of FOODS) {
  const have = foodsSnap.docs.find((d) => norm(d.get('name')) === norm(f.name));
  if (have) { console.log(`  KEEP  "${f.name}" — exists as ${have.id} (${have.get('calories')} / ${have.get('protein')} per ${have.get('servingSize')} ${have.get('servingUnit')})`); continue; }
  console.log(`  ${apply ? 'ADD' : 'WOULD ADD'}  "${f.name}" ${f.calories} kcal / ${f.protein} g per ${f.servingSize} ${f.servingUnit}`);
  foodWrites.push({ ...f, source: 'manual', createdAt: FieldValue.serverTimestamp() });
}

console.log('');
for (const r of refusals) console.log(`REFUSE  ${r}`);
if (refusals.length) { console.log('\nAborted: nothing written.'); process.exit(1); }

const projected = [...existing.filter((e) => !isMarker(e) && !deletes.some((d) => d.id === e.id)).map((e) => ({ kcal: e.calories ?? 0, protein: e.protein ?? 0 })), ...writes.map((w) => ({ kcal: w.calories as number, protein: w.protein as number }))];
if (!apply) {
  const t = sum(projected);
  console.log(`Day total after apply: ${t.kcal} / ${t.protein} (expected ${EXPECT_DAY.kcal} / ${EXPECT_DAY.protein})`);
  console.log(`${deletes.length} delete(s), ${writes.length} log write(s), ${writeWeight ? 1 : 0} weight, ${foodWrites.length} food(s) — dry run, re-run with --apply.`);
  process.exit(0);
}

const batch = db.batch();
for (const d of deletes) batch.delete(d.ref);
for (const w of writes) batch.set(user.collection('dailyLogs').doc(), w);
for (const f of foodWrites) batch.set(user.collection('customFoods').doc(), f);
if (writeWeight) batch.create(weightRef, { weight: WEIGHT_LB });
await batch.commit();
console.log(`Applied: ${deletes.length} delete(s), ${writes.length} log row(s), ${writeWeight ? 1 : 0} weight, ${foodWrites.length} saved food(s).`);
console.log(`Weight ${DAY} now: ${JSON.stringify((await weightRef.get()).data())}`);

// The day as the app totals it: every non-marker row in the range.
const after = (await readDay()).sort((a, b) => a.timestamp.toMillis() - b.timestamp.toMillis());
console.log(`\n${DAY} now:`);
for (const e of after) console.log(`  ${line(e)}${isMarker(e) ? '  [marker]' : ''}`);
const t = sum(after.filter((e) => !isMarker(e)).map((e) => ({ kcal: e.calories ?? 0, protein: e.protein ?? 0 })));
console.log(`Day total: ${t.kcal} / ${t.protein} (expected ${EXPECT_DAY.kcal} / ${EXPECT_DAY.protein}; difference ${t.kcal - EXPECT_DAY.kcal} / ${t.protein - EXPECT_DAY.protein})`);
