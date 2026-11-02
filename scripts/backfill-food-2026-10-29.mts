/**
 * One-time food-log entry on the owner's account, requested 2026-10-29: Thu
 * 10/29 (America/Puerto_Rico), plus checks on 10/27 and 10/28. Values are the
 * owner's, entered exactly. Expected 10/29: 1,881 / 174; 10/28: 1,762 / 203.
 * Target stays 1,850 / 140 (not touched).
 *
 * What the read found (2026-10-29 ~22:00):
 *   - 10/29 breakfast "Shake no chia" 516/65 (09:43), lunch "Beef brócoli Olé"
 *     580/40 (12:27) and "Unreal" 90/2 (14:04, owner says ~12:45) were already
 *     logged by the app → KEPT, ingredient notes added where missing.
 *   - 10/29 17:00 snack and 21:30 dinner: no rows → ADDED.
 *   - 10/28 pancake meal is already logged as "Stack and egg" 414/48 at 22:26
 *     (owner says ~20:40) → KEPT, note added. 10/28 already totals 1,762 / 203.
 *   - 10/27 "Xtreme x2" stored with 0 g protein → 8.
 *   - The batch saved food has no closed flag and no notes field → renamed
 *     "(used up 10/29)"; the fridge-loss note rides on the 10/29 dinner row.
 *   - The "+1 tbsp chia" variant (303/19) is the same food as the saved
 *     "High-fiber oatmeal (no banana) + 2 tsp honey" 303/19 → not duplicated.
 *   - Weight / tape / workouts are not touched.
 *
 * Backup first. Dry run unless `--apply`; re-runs plan 0.
 *
 *   TZ=America/Puerto_Rico npx jiti scripts/backfill-food-2026-10-29.mts [--apply]
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, Timestamp, FieldValue } from 'firebase-admin/firestore';
import { type DocCodec, type LogEntry, toLogDoc, withDefaultMealSlot } from '../packages/core/src/index.ts';

const PROJECT_ID = 'fitness-tracker-gb-1775407101';
const EMAIL = 'gabrielandresbermudez@gmail.com';
const APPLY = process.argv.includes('--apply');
const at = (day: string, hhmm: string) => new Date(`${day}T${hhmm}:00-04:00`);

type Note = { day: string; label: string; kcal: number; protein: number; note: string };
const NOTES: Note[] = [
  {
    day: '2026-10-28', label: 'Stack and egg', kcal: 414, protein: 48,
    note: 'Pancake + egg + Canadian bacon (~20:40): Build C pancake 156 g 304/34 (10/25 batch) · 1 medium egg 60/6 · Jones Canadian bacon 2.5 slices 50/8.',
  },
  {
    day: '2026-10-29', label: 'Shake no chia', kcal: 516, protein: 65,
    note: 'Pea shake (½ c oats, no chia): 3 scoops SOLO pea 210/45 · ½ c rolled oats 150/5 · ½ c Kirkland Greek 75/13.5 · banana ~91 g 81/1 · 2 c water, cinnamon, vanilla, salt.',
  },
  {
    day: '2026-10-29', label: 'Beef brócoli Olé', kcal: 580, protein: 40,
    note: 'Ground beef + broccoli + Olé ×2: ground beef 110 g cooked incl. rendered fat (as Kirkland grass-fed patty) 380/26 · steamed broccoli ~231 g (plate 341 − beef 110) 80/6 · Olé Xtreme tortilla ×2 120/8. Fiber 24 g from the tortillas.',
  },
];

type Row = { day: string; time: string; slot: LogEntry['mealType']; label: string; kcal: number; protein: number; note: string };
const ROWS: Row[] = [
  {
    day: '2026-10-29', time: '17:00', slot: 'snack', label: 'Light oatmeal + egg whites', kcal: 245, protein: 17,
    note: '⅓ c rolled oats 100/3.3 · ½ c liquid egg whites 63/13 · ½ c wild berries 40/0.5 · 2 tsp honey 42/0 · water, salt, vanilla, cinnamon. No chia.',
  },
  {
    day: '2026-10-29', time: '21:30', slot: 'dinner', label: 'Pancake + egg + Realgood', kcal: 450, protein: 50,
    note: 'Build C pancake 154 g 300/34 (1.95 kcal / 0.22 g per g) · 1 medium egg 60/6 · Realgood tortilla 90/10. Last of the 10/25 batch (145 + 249 + 156 + 154 g = 704 g); pancakes lost ~3–6 g each in the fridge (160 → 154 g).',
  },
];

const FIXES = [{ day: '2026-10-27', label: 'Xtreme x2', kcal: 120, field: 'protein', from: 0, to: 8 }];

const BATCH_OLD = 'Build C pancake — 2026-10-25 batch';
const BATCH_NEW = 'Build C pancake — 2026-10-25 batch (used up 10/29)';
const FOODS = [{ name: 'Light oatmeal + egg whites (no chia)', servingSize: 1, servingUnit: 'serving' as const, calories: 245, protein: 17 }];
const SAME_AS_VARIANT = 'High-fiber oatmeal (no banana) + 2 tsp honey';

for (const n of [...NOTES, ...ROWS]) if (n.note.length > 500) throw new Error(`note too long: ${n.label} ${n.note.length}`);

initializeApp({ credential: applicationDefault(), projectId: PROJECT_ID });
const db = getFirestore();
const uid = (await getAuth().getUserByEmail(EMAIL)).uid;
const ref = db.doc(`users/${uid}`);

const DAYS = ['2026-10-27', '2026-10-28', '2026-10-29'];
const next = (day: string) => new Date(at(day, '00:00').getTime() + 86400000);
const dayLogs = async (day: string) => (await ref.collection('dailyLogs')
  .where('timestamp', '>=', Timestamp.fromDate(at(day, '00:00')))
  .where('timestamp', '<', Timestamp.fromDate(next(day)))
  .get()).docs;
const logs = Object.fromEntries(await Promise.all(DAYS.map(async (d) => [d, await dayLogs(d)] as const)));
const foods = (await ref.collection('customFoods').get()).docs;

const dir = join(homedir(), 'ignia-backups');
mkdirSync(dir, { recursive: true });
const backup = join(dir, `backfill-food-2026-10-29-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
writeFileSync(backup, JSON.stringify({
  logs: Object.fromEntries(DAYS.map((d) => [d, logs[d].map((x) => ({ id: x.id, ...x.data() }))])),
  customFoods: foods.map((d) => ({ id: d.id, ...d.data() })),
}, null, 2));

const find = (day: string, label: string, kcal: number) =>
  logs[day].filter((d) => d.get('mealLabel') === label && d.get('calories') === kcal);
const CODEC: DocCodec<Timestamp> = { timestamp: (d) => Timestamp.fromDate(d), remove: () => FieldValue.delete() };
const plan: string[] = [];
const writes: (() => Promise<unknown>)[] = [];

for (const f of FIXES) {
  const hit = find(f.day, f.label, f.kcal);
  if (hit.length !== 1) { console.log(`REFUSING — ${f.day} "${f.label}": ${hit.length} matches`); process.exit(1); }
  const cur = hit[0].get(f.field);
  if (cur === f.to) { console.log(`· ${f.day} ${f.label} ${f.field} already ${f.to}`); continue; }
  if (cur !== f.from) { console.log(`  MISMATCH ${f.day} ${f.label} ${f.field}=${cur}, expected ${f.from} — not touched`); continue; }
  plan.push(`UPDATE ${hit[0].id} ${f.day} "${f.label}" ${f.field} ${f.from} → ${f.to}`);
  writes.push(() => hit[0].ref.update({ [f.field]: f.to }));
}
for (const n of NOTES) {
  const hit = find(n.day, n.label, n.kcal).filter((d) => d.get('protein') === n.protein);
  if (hit.length !== 1) { console.log(`REFUSING — ${n.day} "${n.label}" ${n.kcal}/${n.protein}: ${hit.length} matches`); process.exit(1); }
  const have = hit[0].get('note');
  if (have === n.note) { console.log(`· ${n.day} ${n.label} already has its note`); continue; }
  if (have != null) { console.log(`· ${n.day} ${n.label}: has a different note — not overwritten`); continue; }
  plan.push(`UPDATE ${hit[0].id} ${n.day} "${n.label}" — add ingredient note`);
  writes.push(() => hit[0].ref.update({ note: n.note }));
}
for (const r of ROWS) {
  const hit = find(r.day, r.label, r.kcal);
  if (hit.length) { console.log(`· ${r.day} ${r.label} ${r.kcal}/${r.protein} already logged`); continue; }
  const t = at(r.day, r.time);
  const doc = toLogDoc(withDefaultMealSlot({ calories: r.kcal, protein: r.protein, mealLabel: r.label, mealType: r.slot, timestamp: t, note: r.note }, t), CODEC);
  plan.push(`CREATE ${r.day} ${r.time} ${r.slot} "${r.label}" ${r.kcal}/${r.protein} + note`);
  writes.push(() => ref.collection('dailyLogs').add(doc));
}

const batch = foods.find((d) => d.get('name') === BATCH_OLD);
if (batch) {
  plan.push(`UPDATE saved food ${batch.id} rename → "${BATCH_NEW}"`);
  writes.push(() => batch.ref.update({ name: BATCH_NEW }));
} else if (!foods.some((d) => d.get('name') === BATCH_NEW)) console.log(`  MISMATCH no saved food named "${BATCH_OLD}"`);
else console.log(`· batch already marked used up`);
const names = new Set(foods.map((d) => d.get('name')));
for (const f of FOODS) {
  if (names.has(f.name)) { console.log(`· saved food exists: ${f.name}`); continue; }
  plan.push(`CREATE saved food "${f.name}" ${f.calories}/${f.protein}`);
  writes.push(() => ref.collection('customFoods').add({ ...f, source: 'manual', createdAt: Timestamp.now() }));
}
const same = foods.find((d) => d.get('name') === SAME_AS_VARIANT);
console.log(`variant +1 tbsp chia 303/19: existing "${SAME_AS_VARIANT}" ${same?.get('calories')}/${same?.get('protein')} — not duplicated`);

console.log(`backup: ${backup}`);
console.log(`\nPLAN (${plan.length}):`);
for (const p of plan) console.log(`  → ${p}`);
if (!APPLY) { console.log('\nDry run — nothing written. Re-run with --apply.'); process.exit(0); }
for (const w of writes) await w();
for (const d of DAYS) {
  const after = await dayLogs(d);
  const tot = after.reduce((a, x) => [a[0] + (x.get('calories') ?? 0), a[1] + (x.get('protein') ?? 0)], [0, 0]);
  console.log(`${d}: ${after.length} rows, ${tot[0]} kcal / ${tot[1]} g`);
}
console.log(`APPLIED ${writes.length} write(s).`);
process.exit(0);
