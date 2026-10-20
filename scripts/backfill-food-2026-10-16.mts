/**
 * One-time food-log entry on the owner's account, requested 2026-10-16: the
 * whole of Friday 2026-10-16 (America/Puerto_Rico), values confirmed with the
 * owner — entered exactly, never recomputed. Expected day: 2,120 kcal / 192 g.
 *
 * Two hand-entered rows already covered part of the day and are REPLACED, so
 * nothing is double-counted (each is checked by id AND value; any drift →
 * refuse):
 *   - "Overnight Oats" 450 / 59 at 07:27 → the 07:20 breakfast row;
 *   - "Chicken Sandwich" 700 / 58 at 10:25, slotted breakfast → the 10:45 lunch
 *     row (Nany's Cake).
 * Any OTHER food row on the day refuses the run (decide by hand).
 *
 * Not touched: the 155.6 lb weigh-in (already there — `dailyWeights` holds no
 * time of day, so 07:15 is not stored), sleep, water, workouts.
 *
 * Also adds four saved foods (`customFoods`) when no food of that name exists;
 * an existing one is never overwritten. Kcal/protein only, like the log rows.
 *
 * Everything read is backed up to ~/ignia-backups first. Dry run unless
 * `--apply`; re-runs are no-ops (added rows are matched by label + values).
 *
 *   TZ=America/Puerto_Rico npx jiti scripts/backfill-food-2026-10-16.mts --email gabrielandresbermudez@gmail.com [--apply]
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
  sanitizeDayBoundary,
  toLogDoc,
  withDefaultMealSlot,
} from '../packages/core/src/index.ts';

const PROJECT_ID = 'fitness-tracker-gb-1775407101';
const DAY = '2026-10-16';
const OFFSET = '-04:00'; // America/Puerto_Rico, no DST
const EXPECT_DAY = { kcal: 2120, protein: 192 };

type Row = { time: string; slot: LogEntry['mealType']; label: string; kcal: number; protein: number; note: string };
const ROWS: Row[] = [
  { time: '07:20', slot: 'breakfast', label: 'Overnight oats + pea protein scoop + ½ c berries (no PB)', kcal: 450, protein: 59, note: '' },
  { time: '10:45', slot: 'lunch', label: 'Sándwich de pechuga al grill, pan de masa madre, sin aioli, sin mantequilla', kcal: 700, protein: 58, note: "Nany's Cake, Naguabo" },
  { time: '14:00', slot: 'snack', label: 'Eggs, 2', kcal: 140, protein: 12, note: '' },
  { time: '15:30', slot: 'snack', label: 'Kirkland protein bar', kcal: 190, protein: 21, note: '' },
  { time: '17:30', slot: 'dinner', label: 'Amarillos ×2 (~120 g)', kcal: 285, protein: 2, note: 'El Terruño, Luquillo. USDA 168200 restaurant-fried: 2.36 kcal/g, 0.014 g/g' },
  { time: '17:30', slot: 'dinner', label: 'Pechuga a la plancha (~4 oz / 113 g cooked)', kcal: 225, protein: 35, note: 'El Terruño, Luquillo. Restaurant grilled, incl. oil: 1.99 kcal/g, 0.31 g/g' },
  { time: '17:30', slot: 'dinner', label: 'Habichuelas guisadas ¼ c', kcal: 70, protein: 4, note: 'El Terruño, Luquillo' },
  { time: '17:30', slot: 'dinner', label: 'Arroz blanco ¼ c', kcal: 60, protein: 1, note: 'El Terruño, Luquillo. PR-style, with oil' },
];
const REPLACE: Record<string, { label: string; kcal: number; protein: number; why: string }> = {
  mevLA9AkTQgUqGJW53cT: { label: 'Overnight Oats', kcal: 450, protein: 59, why: 'hand entry → the 07:20 breakfast row' },
  edngfqCJqN0pc3SAxo0e: { label: 'Chicken Sandwich', kcal: 700, protein: 58, why: 'hand entry, slotted breakfast → the 10:45 lunch row' },
};
const FOODS = [
  { name: 'Amarillos (restaurant-fried ripe plantain)', servingSize: 100, servingUnit: 'g', calories: 236, protein: 1.4 },
  { name: 'Chicken breast, grilled, restaurant (incl. oil)', servingSize: 100, servingUnit: 'g', calories: 199, protein: 31 },
  { name: 'Habichuelas guisadas (¼ cup)', servingSize: 1, servingUnit: 'serving', calories: 70, protein: 4 },
  { name: 'Arroz blanco, PR-style with oil (¼ cup)', servingSize: 1, servingUnit: 'serving', calories: 60, protein: 1 },
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

const conv = (v: unknown): unknown => {
  if (v instanceof Timestamp) return v.toDate().toISOString();
  if (Array.isArray(v)) return v.map(conv);
  if (v && typeof v === 'object' && !('firestore' in (v as object))) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, conv(x)]));
  return v;
};
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const dir = join(homedir(), 'ignia-backups');
mkdirSync(dir, { recursive: true });
const backup = join(dir, `backfill-food-2026-10-16-${stamp}.json`);
writeFileSync(backup, JSON.stringify(conv({
  uid, day: DAY,
  dailyLogs: existing.map(({ ref, ...x }) => x),
  customFoods: foodsSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
}), null, 1));
console.log(`backup: ${backup}`);

const norm = (x: unknown) => String(x ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
const fmt = (d: Date) => d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
const line = (e: Record<string, any>) => `${e.id}  ${fmt(e.timestamp.toDate())}  ${e.mealType ?? '-'}  "${e.mealLabel ?? ''}"  ${e.calories} / ${e.protein ?? '-'}`
  + `${e.carbs != null ? ` c${e.carbs}` : ''}${e.fat != null ? ` f${e.fat}` : ''}${e.grams != null ? ` ${e.grams} g` : ''}`;
const isMarker = (e: Record<string, any>) => e.exerciseCompleted || e.liftCompleted || e.cardioCompleted || (e.weight != null && !e.mealLabel && e.calories === 0);

console.log(`\nRows on ${DAY}: ${existing.length}`);
for (const e of existing) console.log(`  ${line(e)}`);

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
  console.log(`${deletes.length} delete(s), ${writes.length} log write(s), ${foodWrites.length} food(s) — dry run, re-run with --apply.`);
  process.exit(0);
}

const batch = db.batch();
for (const d of deletes) batch.delete(d.ref);
for (const w of writes) batch.set(user.collection('dailyLogs').doc(), w);
for (const f of foodWrites) batch.set(user.collection('customFoods').doc(), f);
await batch.commit();
console.log(`Applied: ${deletes.length} delete(s), ${writes.length} log row(s), ${foodWrites.length} saved food(s).`);

// The day as the app totals it: every non-marker row in the range.
const after = (await readDay()).sort((a, b) => a.timestamp.toMillis() - b.timestamp.toMillis());
console.log(`\n${DAY} now:`);
for (const e of after) console.log(`  ${line(e)}${isMarker(e) ? '  [marker]' : ''}`);
const t = sum(after.filter((e) => !isMarker(e)).map((e) => ({ kcal: e.calories ?? 0, protein: e.protein ?? 0 })));
console.log(`Day total: ${t.kcal} / ${t.protein} (expected ${EXPECT_DAY.kcal} / ${EXPECT_DAY.protein}; difference ${t.kcal - EXPECT_DAY.kcal} / ${t.protein - EXPECT_DAY.protein})`);
