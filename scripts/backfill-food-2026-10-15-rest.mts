/**
 * One-time food-log fix on the owner's account, requested 2026-10-15: the rest
 * of Thursday 2026-10-15 after breakfast (lunch 12:45, snack 15:30, dinner
 * 19:55), values confirmed with the owner — entered exactly, never recomputed.
 * Breakfast (3 rows, 513 / 60, `backfill-food-2026-10-15.mts`) is not touched.
 *
 * Two hand-entered rows already covered part of the day and are REPLACED, so
 * nothing is double-counted (each is checked by id AND value; any drift →
 * refuse):
 *   - "Beef Pattie" 586 / 35 at 12:56 — the whole lunch as one row → the four
 *     itemized lunch rows;
 *   - "Chocolate Chip Cookie Dough Flavored Bar" 150 / 28 at 18:10 — the David
 *     bar → the 15:30 snack row.
 * The owner's replace rules (a Kirkland ×2 patty row 760/52 or 760/56, a
 * banana 110/1, any 21:00 placeholder) are checked too: none should exist, and
 * one appearing between the read and the write refuses the run.
 * Any OTHER food row after breakfast is kept and reported (the "Unreal" 90 / 2
 * at 13:30 is on no list — the owner decides).
 *
 * Also adds three saved foods (`customFoods`) when no food of that name exists;
 * an existing one is never overwritten. Kcal/protein only, like the log rows.
 *
 * Everything touched is backed up to ~/ignia-backups first. Dry run unless
 * `--apply`; re-runs are no-ops (added rows are matched by label + values).
 *
 *   TZ=America/Puerto_Rico npx jiti scripts/backfill-food-2026-10-15-rest.mts --email gabrielandresbermudez@gmail.com [--apply]
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
const DAY = '2026-10-15';
const OFFSET = '-04:00'; // America/Puerto_Rico, no DST
const EXPECT_REST = { kcal: 1336, protein: 107 }; // lunch 586/35 + snack 150/28 + dinner 600/44
const EXPECT_DAY = { kcal: 1849, protein: 167 };

type Row = { time: string; slot: LogEntry['mealType']; label: string; kcal: number; protein: number; note: string };
const PATTY = 'Kirkland 100% grass-fed beef patty ×1 (151 g raw)';
const ROWS: Row[] = [
  { time: '12:45', slot: 'lunch', label: PATTY, kcal: 380, protein: 26, note: 'Label: 1/3 lb patty = 151 g raw = 380 kcal / 26 g' },
  { time: '12:45', slot: 'lunch', label: 'Costco cheddar slice', kcal: 80, protein: 5, note: '' },
  { time: '12:45', slot: 'lunch', label: 'Banana, 91 g', kcal: 81, protein: 1, note: 'USDA raw: 0.89 kcal/g, 0.011 g/g' },
  { time: '12:45', slot: 'lunch', label: 'Romaine + broccoli + cauliflower (unweighed)', kcal: 45, protein: 3, note: '' },
  { time: '15:30', slot: 'snack', label: 'David protein bar', kcal: 150, protein: 28, note: '' },
  { time: '19:55', slot: 'dinner', label: `${PATTY}, leftover`, kcal: 380, protein: 26, note: 'Label: 1/3 lb patty = 151 g raw = 380 kcal / 26 g' },
  { time: '19:55', slot: 'dinner', label: 'Costco cheddar slice, melted on the patty', kcal: 80, protein: 5, note: '' },
  { time: '19:55', slot: 'dinner', label: 'Broccoli + cauliflower + carrots, 163 g', kcal: 50, protein: 3, note: '0.30 kcal/g, 0.02 g/g' },
  { time: '19:55', slot: 'dinner', label: 'Realgood tortilla', kcal: 90, protein: 10, note: '' },
];
const REPLACE: Record<string, { label: string; kcal: number; protein: number; why: string }> = {
  ZJPs9jzwZ1TaId8Vp3qT: { label: 'Beef Pattie', kcal: 586, protein: 35, why: 'the whole lunch as one row → the four lunch rows' },
  '6FeTVYyinq252kRBXRxs': { label: 'Chocolate Chip Cookie Dough Flavored Bar', kcal: 150, protein: 28, why: 'the David bar at 18:10 → the 15:30 snack row' },
};
const FOODS = [
  { name: 'Kirkland 100% grass-fed beef patty, 1/3 lb', brand: 'Kirkland', servingSize: 151, servingUnit: 'g', calories: 380, protein: 26 },
  { name: 'Banana, raw', servingSize: 100, servingUnit: 'g', calories: 89, protein: 1.1 },
  { name: 'Mixed steamed vegetables (broccoli/cauliflower/carrot)', servingSize: 100, servingUnit: 'g', calories: 30, protein: 2 },
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
if (s.kcal !== EXPECT_REST.kcal || s.protein !== EXPECT_REST.protein) {
  console.error(`Table sums to ${s.kcal} / ${s.protein}, expected ${EXPECT_REST.kcal} / ${EXPECT_REST.protein}. Aborting.`);
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
const backup = join(dir, `backfill-food-2026-10-15-rest-${stamp}.json`);
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
const isBreakfast = (e: Record<string, any>) => e.mealType === 'breakfast' && fmt(e.timestamp.toDate()) === '08:45';

console.log(`\nRows on ${DAY}: ${existing.length}`);
for (const e of existing) console.log(`  ${line(e)}`);

const refusals: string[] = [];
const deletes: Array<Record<string, any>> = [];
const kept: Array<Record<string, any>> = [];
const claimed = new Set<string>();

// The owner's replace rules. None exist on the read; if one does, stop.
for (const e of existing) {
  const l = norm(e.mealLabel);
  if (/kirkland/.test(l) && /(×|x)\s*2/.test(l) && e.calories === 760) refusals.push(`Kirkland ×2 row present: ${line(e)}`);
  if (/banana/.test(l) && e.calories === 110 && e.protein === 1) refusals.push(`banana 110/1 present: ${line(e)}`);
  if (fmt(e.timestamp.toDate()) === '21:00') refusals.push(`21:00 placeholder present: ${line(e)}`);
}

console.log('\nPlan:');
for (const e of existing) {
  if (isMarker(e) || isBreakfast(e)) continue;
  const r = REPLACE[e.id];
  if (r) {
    if (e.mealLabel !== r.label || e.calories !== r.kcal || e.protein !== r.protein) refusals.push(`${e.id} changed since the read: ${line(e)}`);
    else { deletes.push(e); console.log(`${apply ? 'DELETE' : 'WOULD DELETE'}  ${line(e)} — ${r.why}`); }
    continue;
  }
  const mine = ROWS.find((x) => norm(x.label) === norm(e.mealLabel) && x.kcal === e.calories && x.protein === e.protein);
  if (mine) { claimed.add(mine.label); continue; }
  kept.push(e);
  console.log(`KEEP  ${line(e)} — on no list, not touched`);
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
