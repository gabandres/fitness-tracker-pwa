/**
 * One-time food-log entry on the owner's account, requested 2026-10-25: Sun
 * 10/25 (America/Puerto_Rico). Values are the owner's, entered exactly.
 * Expected: 1,602 kcal / 131 g (dinner corrected later that evening:
 * + 1 tbsp chia, 19:10, 258/8 → 316/10; the row is updated, not duplicated). Target stays 1,850 / 140 (not touched).
 *
 * What the read found (2026-10-25):
 *   - Weight 10/25 152.0 already stored ✓ → not touched.
 *   - No 10/25 food rows → all five ADDED.
 *   - Hunger 10/25 null → left null (owner enters it).
 *   - Hunger checkpoint: stored 10/20=7, 10/21=1, 10/22=3, 10/23=6 (the owner
 *     said 10/21 and 10/23 were unrated). Avg < 7 either way → no change.
 *     The reason text has no field to live in: `dailyTargets` is `hasOnly`
 *     in firestore.rules and `change` exists only on a day the target moved,
 *     so a free-text field would make every client save of that record fail.
 *
 * Everything read is backed up to ~/ignia-backups first. Dry run unless
 * `--apply`; re-runs are no-ops. Any 10/25 row not listed here → refuse.
 *
 *   TZ=America/Puerto_Rico npx jiti scripts/backfill-food-2026-10-25.mts [--apply]
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, Timestamp, FieldValue } from 'firebase-admin/firestore';
import {
  type DailyLog, type DocCodec, type LogEntry, type Profile,
  LOG_WINDOW_ROWS, dailyTargets, toDailyLog, toLogDoc, withDefaultMealSlot,
} from '../packages/core/src/index.ts';

const PROJECT_ID = 'fitness-tracker-gb-1775407101';
const EMAIL = 'gabrielandresbermudez@gmail.com';
const DAY = '2026-10-25';
const APPLY = process.argv.includes('--apply');
const at = (hhmm: string) => new Date(`${DAY}T${hhmm}:00-04:00`);

type Row = { time: string; slot: LogEntry['mealType']; label: string; kcal: number; protein: number; note?: string };
const NEW: Row[] = [
  { time: '10:00', slot: 'breakfast', label: 'Pea shake v3 (no cottage)', kcal: 499, protein: 64,
    note: '3 scoops SOLO pea 210/45 · ½ c Kirkland Greek 75/13.5 · ¼ c rolled oats 75/2.5 · 1 tbsp chia 58/2 · banana 91 g 81/1 · 2 c water, cinnamon, vanilla, salt.' },
  { time: '13:25', slot: 'lunch', label: 'Ground beef + veg + Olé tortilla', kcal: 507, protein: 34,
    note: 'Ground beef 112 g cooked incl. rendered fat (as Kirkland grass-fed patty) 380/26 · steamed broccoli/cauliflower/carrots ~222 g (plate 334 − beef 112) 67/4 · Olé Xtreme tortilla 60/4.' },
  { time: '13:45', slot: 'snack', label: 'Unreal', kcal: 90, protein: 2 },
  { time: '15:15', slot: 'snack', label: 'Kirkland protein bar', kcal: 190, protein: 21 },
  { time: '19:10', slot: 'dinner', label: 'Banana chia oatmeal (milk)', kcal: 316, protein: 10,
    note: '½ c rolled oats 150/5 · banana 88 g 78/1 · splash milk ~¼ c 30/2 · 1 tbsp chia 58/2 · water. No berries, PB, vanilla or cinnamon.' },
];
/** The first run's dinner (19:00, 258/8), corrected in place to the row above. */
const SUPERSEDED = { label: 'Banana oatmeal (milk)', kcal: 258, protein: 8 };
const EXPECT = { kcal: 1602, protein: 131 };

initializeApp({ credential: applicationDefault(), projectId: PROJECT_ID });
const db = getFirestore();
const uid = (await getAuth().getUserByEmail(EMAIL)).uid;
const ref = db.doc(`users/${uid}`);

const dayLogs = async () => (await ref.collection('dailyLogs')
  .where('timestamp', '>=', Timestamp.fromDate(at('00:00')))
  .where('timestamp', '<', Timestamp.fromDate(new Date('2026-10-26T00:00:00-04:00')))
  .get()).docs;
const logs = await dayLogs();
const weight = await ref.collection('dailyWeights').doc(DAY).get();
const hunger = await ref.collection('dailyHunger').doc(DAY).get();
const targets = await ref.collection('dailyTargets').doc(DAY).get();
const hungerWindow = (await ref.collection('dailyHunger').where('__name__', '>=', '2026-10-19').get()).docs
  .filter((d) => d.id <= DAY).map((d) => [d.id, d.get('level') as number] as const);

const dir = join(homedir(), 'ignia-backups');
mkdirSync(dir, { recursive: true });
const backup = join(dir, `backfill-food-2026-10-25-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
writeFileSync(backup, JSON.stringify({
  logs: logs.map((d) => ({ id: d.id, ...d.data() })),
  weight: weight.data() ?? null, hunger: hunger.data() ?? null, targets: targets.data() ?? null,
}, null, 2));

const isNew = (d: FirebaseFirestore.QueryDocumentSnapshot) =>
  NEW.find((r) => d.get('mealLabel') === r.label && d.get('calories') === r.kcal && d.get('protein') === r.protein);
const isOld = (d: FirebaseFirestore.QueryDocumentSnapshot) =>
  d.get('mealLabel') === SUPERSEDED.label && d.get('calories') === SUPERSEDED.kcal && d.get('protein') === SUPERSEDED.protein;
const problems = logs.filter((d) => !isNew(d) && !isOld(d)).map((d) => `unknown row ${d.id} "${d.get('mealLabel')}" ${d.get('calories')}/${d.get('protein')}`);
if (problems.length) {
  console.log('REFUSING — 10/25 no longer matches the read:');
  for (const p of problems) console.log(`  ✗ ${p}`);
  process.exit(1);
}

const CODEC: DocCodec<Timestamp> = { timestamp: (d) => Timestamp.fromDate(d), remove: () => FieldValue.delete() };
const plan: string[] = [];
const writes: (() => Promise<unknown>)[] = [];
for (const r of NEW) {
  const old = logs.find(isOld);
  if (r.slot === 'dinner' && old) {
    const t = at(r.time);
    plan.push(`UPDATE ${old.id} "${SUPERSEDED.label}" ${SUPERSEDED.kcal}/${SUPERSEDED.protein} → ${r.time} "${r.label}" ${r.kcal}/${r.protein} + note`);
    writes.push(() => old.ref.update({ mealLabel: r.label, calories: r.kcal, protein: r.protein, note: r.note, timestamp: Timestamp.fromDate(t) }));
    continue;
  }
  if (logs.some((d) => isNew(d) === r)) { console.log(`· ${r.label} ${r.kcal}/${r.protein} already logged`); continue; }
  const t = at(r.time);
  const doc = toLogDoc(withDefaultMealSlot({ calories: r.kcal, protein: r.protein, mealLabel: r.label, mealType: r.slot, timestamp: t, ...(r.note ? { note: r.note } : {}) }, t), CODEC);
  plan.push(`CREATE ${r.time} ${r.slot} "${r.label}" ${r.kcal}/${r.protein}${r.note ? ' + note' : ''}`);
  writes.push(() => ref.collection('dailyLogs').add(doc));
}

async function maintenance(label: string) {
  const prof = (await ref.get()).data() as Profile;
  const rows: DailyLog[] = (await ref.collection('dailyLogs').orderBy('timestamp', 'desc').limit(LOG_WINDOW_ROWS).get()).docs.map((d) => toDailyLog(d.id, d.data()));
  const weights = Object.fromEntries((await ref.collection('dailyWeights').get()).docs.map((d) => [d.id, d.get('weight') as number]));
  const dayComplete = Object.fromEntries((await ref.collection('dailyLogged').get()).docs.map((d) => [d.id, d.get('complete') as boolean]));
  const t = dailyTargets(prof, rows, weights, new Date(), dayComplete);
  const week = Object.entries(weights).filter(([k]) => k > '2026-10-18' && k <= DAY);
  const avg = week.reduce((a, [, w]) => a + w, 0) / week.length;
  console.log(`[${label}] maintenance ${Math.round(t.tdee.trueTdee)} (${t.tdee.source}) · target ${t.calorieTarget}/${t.proteinTarget} · 7-day weight avg ${avg.toFixed(2)} (n=${week.length})`);
}

const hAvg = hungerWindow.reduce((a, [, l]) => a + l, 0) / hungerWindow.length;
console.log(`backup: ${backup}`);
console.log(`weight ${DAY}: ${JSON.stringify(weight.data() ?? null)} · hunger ${DAY}: ${JSON.stringify(hunger.data() ?? null)} (not touched)`);
console.log(`hunger 10/19–10/25 stored: ${hungerWindow.map(([d, l]) => `${d.slice(5)}=${l}`).join(' ')} → avg ${hAvg.toFixed(2)} (n=${hungerWindow.length}) ${hAvg >= 7 ? '≥ 7 — CHECK' : '< 7 → no change'}`);
console.log(`targets ${DAY} (stored): ${targets.get('kcalTarget')} / ${targets.get('proteinTarget')}, maintenance ${targets.get('maintenanceEstimate')} (${targets.get('maintenanceSource')})`);
console.log(`\nPLAN (${plan.length}):`);
for (const p of plan) console.log(`  → ${p}`);
await maintenance('before');
if (!APPLY) { console.log('\nDry run — nothing written. Re-run with --apply.'); process.exit(0); }
for (const w of writes) await w();
const after = await dayLogs();
const tot = after.reduce((a, d) => [a[0] + (d.get('calories') ?? 0), a[1] + (d.get('protein') ?? 0)], [0, 0]);
console.log(`\nAPPLIED ${writes.length} write(s). 10/25 now ${after.length} rows, ${tot[0]} kcal / ${tot[1]} g (expected ${EXPECT.kcal} / ${EXPECT.protein})`);
await maintenance('after');
process.exit(0);
