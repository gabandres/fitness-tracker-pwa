/**
 * One-time food-log entry on the owner's account, requested 2026-10-20:
 * Monday 2026-10-19 (final) and Tuesday 2026-10-20 so far (America/Puerto_Rico),
 * values confirmed with the owner — entered exactly, never recomputed.
 * Expected: 10/19 1,860 kcal / 161 g; 10/20 1,425 kcal / 155 g.
 *
 * What the read found (each hand entry checked by id AND value; any drift or
 * any other food row → refuse):
 *   - 10/19: all six rows already logged by hand with the listed values
 *     ("Egg Scramble", "Chicken Noodle Soup", "Unreal", "Pattie",
 *     "Tortilla Good", "Oatmeal") → KEPT as they are. A row whose kcal and
 *     protein already match is the owner's own record of that meal; rewriting
 *     it only to change its label and minute would be churn.
 *   - 10/20: "Shake Banana Pea" 561/77, "Chicken Veggies" 460/58 and
 *     "Grapes" 40/– match three rows → KEPT. The 17:30 banana oatmeal is
 *     missing → ADDED. "Unreal" 90/2 at 13:32 (logged live that day) is on no
 *     list → KEPT and reported, so the day reads 90 / 2 above the expected.
 *
 * Weight: 10/20 152.8 lb — written if absent, kept if equal, refused if a
 * different value is stored. 10/19 already holds 152.8 (written 10/19 07:46),
 * read and reported only.
 *
 * Also adds saved foods (`customFoods`) when no food of that name exists; an
 * existing one is never overwritten. `servingUnit` has no cup/tbsp in the
 * rules, so those portions are one `serving` named after the portion, as
 * "Arroz blanco … (¼ cup)" already is.
 *
 * Everything read is backed up to ~/ignia-backups first. Dry run unless
 * `--apply`; re-runs are no-ops (added rows are matched by label + values).
 *
 *   TZ=America/Puerto_Rico npx jiti scripts/backfill-food-2026-10-20.mts --email gabrielandresbermudez@gmail.com [--apply]
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
const OFFSET = '-04:00'; // America/Puerto_Rico, no DST

type Row = { time: string; slot: LogEntry['mealType']; label: string; kcal: number; protein: number; note: string };
type Hand = { label: string; kcal: number; protein: number | undefined };
interface Day {
  day: string;
  expect: { kcal: number; protein: number };
  /** Rows to add unless already present (matched by label + values). */
  add: Row[];
  /** Hand entries that already ARE a listed row (same kcal + protein): kept. */
  match: Record<string, Hand & { is: string }>;
  /** Hand entries on no list: kept untouched and reported. */
  keep: Record<string, Hand>;
  /** Rows the expected total counts that are already logged (by `match`). */
  matchedTotal: { kcal: number; protein: number };
  weight?: number;
}
const DAYS: Day[] = [
  {
    day: '2026-10-19',
    expect: { kcal: 1860, protein: 161 },
    add: [],
    match: {
      plrNkTva1RdafxbQjkZi: { label: 'Egg Scramble', kcal: 485, protein: 60, is: '09:15 egg scramble' },
      lptDzYHwIjQvIphEFLdp: { label: 'Chicken Noodle Soup', kcal: 360, protein: 38, is: '13:10 chicken rice-noodle soup' },
      LBurvC3RHsIhbMzP2MCE: { label: 'Unreal', kcal: 90, protein: 2, is: '13:30 Unreal' },
      wAdJcDO2T289sELRRxvM: { label: 'Pattie', kcal: 550, protein: 41, is: '17:40 Kirkland patty + cheddar + Realgood tortilla' },
      qvHptyDBLeBNeUVrNjGw: { label: 'Tortilla Good', kcal: 90, protein: 10, is: '18:35 Realgood tortilla' },
      evVd9azqJQ7EmW0wdUsT: { label: 'Oatmeal', kcal: 285, protein: 10, is: '21:30 oatmeal + ½ tbsp PB' },
    },
    keep: {},
    matchedTotal: { kcal: 1860, protein: 161 },
  },
  {
    day: '2026-10-20',
    expect: { kcal: 1425, protein: 155 },
    add: [
      { time: '17:30', slot: 'dinner', label: 'Banana oatmeal + egg whites', kcal: 364, protein: 20, note: '½ c rolled oats + banana 92 g + ½ tbsp chia + ½ c wild berries, water; ½ c egg whites' },
    ],
    match: {
      BXlYFRUaUBSFsG2yIhg0: { label: 'Shake Banana Pea', kcal: 561, protein: 77, is: '09:40 pea shake + oats/chia + banana' },
      iKQ5m1eBSbaq67kdz2QR: { label: 'Chicken Veggies', kcal: 460, protein: 58, is: '13:15 chicken breast + vegetables + cheddar' },
      oGjEyTSsLtbBrEAOh1Ny: { label: 'Grapes', kcal: 40, protein: undefined, is: '13:25 grapes ×9 (large)' },
    },
    keep: {
      d0h9ehtFrI7QkvmdxXEH: { label: 'Unreal', kcal: 90, protein: 2 },
    },
    matchedTotal: { kcal: 1061, protein: 135 },
    weight: 152.8,
  },
];
const FOODS = [
  { name: 'Pea shake + oats/chia + banana', servingSize: 1, servingUnit: 'serving', calories: 561, protein: 77 },
  { name: 'Pea shake (no oats)', servingSize: 1, servingUnit: 'serving', calories: 545, protein: 77 },
  { name: 'Banana oatmeal + egg whites', servingSize: 1, servingUnit: 'serving', calories: 364, protein: 20 },
  { name: 'Banana oatmeal (no egg whites)', servingSize: 1, servingUnit: 'serving', calories: 265, protein: 7 },
  { name: 'Liquid egg whites (1 cup)', servingSize: 1, servingUnit: 'serving', calories: 125, protein: 26 },
  { name: 'Chicken breast, cooked', servingSize: 100, servingUnit: 'g', calories: 165, protein: 31 },
  { name: 'Mixed steamed vegetables', servingSize: 100, servingUnit: 'g', calories: 30, protein: 2 },
  { name: 'Grapes, large', servingSize: 1, servingUnit: 'piece', calories: 4.5, protein: 0 },
  { name: 'SOLO pea protein (1 scoop)', servingSize: 17.5, servingUnit: 'g', calories: 70, protein: 15 },
  { name: 'Chia seeds (1 tbsp)', servingSize: 1, servingUnit: 'serving', calories: 58, protein: 2 },
  { name: 'Wild blueberries (½ cup)', servingSize: 1, servingUnit: 'serving', calories: 40, protein: 0.5 },
] as const;
// Same food under an existing name: kept, never duplicated (checked by values).
const FOOD_ALIASES: Record<string, string> = {
  'Mixed steamed vegetables': 'Mixed steamed vegetables (broccoli/cauliflower/carrot)',
};

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
for (const d of DAYS) {
  const s = sum([d.matchedTotal, ...d.add]);
  const m = sum(Object.values(d.match).map((h) => ({ kcal: h.kcal, protein: h.protein ?? 0 })));
  if (s.kcal !== d.expect.kcal || s.protein !== d.expect.protein || m.kcal !== d.matchedTotal.kcal || m.protein !== d.matchedTotal.protein) {
    console.error(`${d.day}: table sums to ${s.kcal} / ${s.protein} (matched ${m.kcal} / ${m.protein}), expected ${d.expect.kcal} / ${d.expect.protein}. Aborting.`);
    process.exit(1);
  }
}

initializeApp({ credential: applicationDefault(), projectId: PROJECT_ID });
const db = getFirestore();
const uid = (await getAuth().getUserByEmail(email)).uid;
const user = db.collection('users').doc(uid);
console.log(`${apply ? '' : '[dry run] '}uid ${uid}`);

const boundary = sanitizeDayBoundary((await user.get()).data()?.['dayBoundary']);
const readDay = async (day: string) => {
  const { start, end } = dayRange(day, boundary);
  return (await user.collection('dailyLogs')
    .where('timestamp', '>=', Timestamp.fromDate(start)).where('timestamp', '<', Timestamp.fromDate(end)).get())
    .docs.map((d) => ({ id: d.id, ref: d.ref, ...d.data() })) as Array<Record<string, any>>;
};
const read = await Promise.all(DAYS.map(async (d) => ({
  d,
  logs: await readDay(d.day),
  weight: await user.collection('dailyWeights').doc(d.day).get(),
  sleep: await user.collection('dailySleep').doc(d.day).get(),
  water: await user.collection('dailyWater').doc(d.day).get(),
})));
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
const backup = join(dir, `backfill-food-2026-10-20-${stamp}.json`);
writeFileSync(backup, JSON.stringify(conv({
  uid,
  days: read.map((r) => ({
    day: r.d.day,
    dailyLogs: r.logs.map(({ ref, ...x }) => x),
    dailyWeight: r.weight.exists ? r.weight.data() : null,
    dailySleep: r.sleep.exists ? r.sleep.data() : null,
    dailyWater: r.water.exists ? r.water.data() : null,
  })),
  customFoods: foodsSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
}), null, 1));
console.log(`backup: ${backup}`);

const norm = (x: unknown) => String(x ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
const fmt = (d: Date) => d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
const line = (e: Record<string, any>) => `${e.id}  ${fmt(e.timestamp.toDate())}  ${e.mealType ?? '-'}  "${e.mealLabel ?? ''}"  ${e.calories} / ${e.protein ?? '-'}`
  + `${e.carbs != null ? ` c${e.carbs}` : ''}${e.fat != null ? ` f${e.fat}` : ''}${e.grams != null ? ` ${e.grams} g` : ''}`;
const isMarker = (e: Record<string, any>) => e.exerciseCompleted || e.liftCompleted || e.cardioCompleted || (e.weight != null && !e.mealLabel && e.calories === 0);
const same = (e: Record<string, any>, h: Hand) => e.mealLabel === h.label && e.calories === h.kcal && e.protein === h.protein;

const refusals: string[] = [];
const writes: Array<Record<string, unknown>> = [];
const weightWrites: Array<{ day: string; lb: number }> = [];
const projected: Record<string, { kcal: number; protein: number }[]> = {};
const CODEC: DocCodec<Timestamp> = { timestamp: (d) => Timestamp.fromDate(d), remove: () => FieldValue.delete() };

for (const { d, logs, weight, sleep, water } of read) {
  console.log(`\n── ${d.day}: ${logs.length} rows`);
  for (const e of logs.sort((a, b) => a.timestamp.toMillis() - b.timestamp.toMillis())) console.log(`  ${line(e)}${isMarker(e) ? '  [marker]' : ''}`);
  console.log(`  weight ${weight.exists ? JSON.stringify(weight.data()) : 'none'} · sleep ${sleep.exists ? JSON.stringify(sleep.data()) : 'none'} · water ${water.exists ? JSON.stringify(water.data()) : 'none'}`);

  const claimed = new Set<string>();
  for (const e of logs) {
    if (isMarker(e)) continue;
    const m = d.match[e.id];
    if (m) {
      if (!same(e, m)) refusals.push(`${d.day} ${e.id} changed since the read: ${line(e)}`);
      else console.log(`  MATCH  ${line(e)} — is the ${m.is} row; kept`);
      continue;
    }
    const k = d.keep[e.id];
    if (k) {
      if (!same(e, k)) refusals.push(`${d.day} ${e.id} changed since the read: ${line(e)}`);
      else console.log(`  KEEP   ${line(e)} — on no list, left for the owner`);
      continue;
    }
    const mine = d.add.find((x) => norm(x.label) === norm(e.mealLabel) && x.kcal === e.calories && x.protein === e.protein);
    if (mine) { claimed.add(mine.label); continue; }
    refusals.push(`${d.day} unexplained food row ${line(e)} — decide by hand`);
  }
  for (const id of Object.keys(d.match)) if (!logs.some((e) => e.id === id)) refusals.push(`${d.day} matched row ${id} is gone — re-read`);

  const added: { kcal: number; protein: number }[] = [];
  for (const r of d.add) {
    const at = new Date(`${d.day}T${r.time}:00${OFFSET}`);
    const doc = toLogDoc(withDefaultMealSlot({ calories: r.kcal, protein: r.protein, mealLabel: r.label, mealType: r.slot, timestamp: at, ...(r.note ? { note: r.note } : {}) }, at), CODEC) as Record<string, unknown>;
    const bad = Object.keys(doc).filter((k) => !ALLOWED.has(k));
    if (bad.length || 'carbs' in doc || 'fat' in doc || doc.mealType !== r.slot) refusals.push(`${d.day} "${r.label}": serialized doc is off (${JSON.stringify(doc)})`);
    const tag = `${r.time}  ${r.slot}  "${r.label}"  ${r.kcal} / ${r.protein}${r.note ? `  — note: ${r.note}` : ''}`;
    if (claimed.has(r.label)) { console.log(`  SKIP   ${tag} (already logged)`); continue; }
    console.log(`  ${apply ? 'ADD' : 'WOULD ADD'}  ${tag}`);
    writes.push(doc);
    added.push({ kcal: r.kcal, protein: r.protein });
  }
  projected[d.day] = [...logs.filter((e) => !isMarker(e)).map((e) => ({ kcal: e.calories ?? 0, protein: e.protein ?? 0 })), ...added];

  if (d.weight != null) {
    if (!isStorableWeight(d.weight)) refusals.push(`weight ${d.weight} fails isStorableWeight`);
    if (weight.exists) {
      const w = readWeightLb(weight.data());
      if (w === d.weight) console.log(`  KEEP   weight ${d.weight} lb — already logged`);
      else refusals.push(`weight ${d.day} already logged as ${JSON.stringify(weight.data())} (planned ${d.weight}) — not overwriting`);
    } else {
      weightWrites.push({ day: d.day, lb: d.weight });
      console.log(`  ${apply ? 'ADD' : 'WOULD ADD'}  weight dailyWeights/${d.day} = { weight: ${d.weight} }`);
    }
  }
}

const foodWrites: Array<Record<string, unknown>> = [];
console.log(`\nSaved foods (${foodsSnap.size} existing):`);
for (const f of FOODS) {
  const names = [f.name, FOOD_ALIASES[f.name]].filter(Boolean).map(norm);
  const have = foodsSnap.docs.find((x) => names.includes(norm(x.get('name'))));
  if (have) {
    const per = (have.get('calories') / have.get('servingSize'));
    const note = Math.abs(per - f.calories / f.servingSize) < 1e-9 && have.get('protein') / have.get('servingSize') === f.protein / f.servingSize ? 'same values' : 'DIFFERENT values — left as the owner has them';
    console.log(`  KEEP  "${f.name}" — exists as ${have.id} "${have.get('name')}" (${have.get('calories')} / ${have.get('protein')} per ${have.get('servingSize')} ${have.get('servingUnit')}; ${note})`);
    continue;
  }
  console.log(`  ${apply ? 'ADD' : 'WOULD ADD'}  "${f.name}" ${f.calories} kcal / ${f.protein} g per ${f.servingSize} ${f.servingUnit}`);
  foodWrites.push({ ...f, source: 'manual', createdAt: FieldValue.serverTimestamp() });
}

console.log('');
for (const r of refusals) console.log(`REFUSE  ${r}`);
if (refusals.length) { console.log('\nAborted: nothing written.'); process.exit(1); }

if (!apply) {
  for (const d of DAYS) {
    const t = sum(projected[d.day]);
    console.log(`${d.day} total after apply: ${t.kcal} / ${t.protein} (expected ${d.expect.kcal} / ${d.expect.protein}; difference ${t.kcal - d.expect.kcal} / ${t.protein - d.expect.protein})`);
  }
  console.log(`${writes.length} log write(s), ${weightWrites.length} weight(s), ${foodWrites.length} food(s) — dry run, re-run with --apply.`);
  process.exit(0);
}

const batch = db.batch();
for (const w of writes) batch.set(user.collection('dailyLogs').doc(), w);
for (const f of foodWrites) batch.set(user.collection('customFoods').doc(), f);
for (const w of weightWrites) batch.create(user.collection('dailyWeights').doc(w.day), { weight: w.lb });
await batch.commit();
console.log(`Applied: ${writes.length} log row(s), ${weightWrites.length} weight(s), ${foodWrites.length} saved food(s).`);

// Each day as the app totals it: every non-marker row in the range.
for (const d of DAYS) {
  const after = (await readDay(d.day)).sort((a, b) => a.timestamp.toMillis() - b.timestamp.toMillis());
  console.log(`\n${d.day} now:`);
  for (const e of after) console.log(`  ${line(e)}${isMarker(e) ? '  [marker]' : ''}`);
  const t = sum(after.filter((e) => !isMarker(e)).map((e) => ({ kcal: e.calories ?? 0, protein: e.protein ?? 0 })));
  console.log(`  total ${t.kcal} / ${t.protein} (expected ${d.expect.kcal} / ${d.expect.protein}; difference ${t.kcal - d.expect.kcal} / ${t.protein - d.expect.protein})`);
  if (d.weight != null) console.log(`  weight now: ${JSON.stringify((await user.collection('dailyWeights').doc(d.day).get()).data())}`);
}
