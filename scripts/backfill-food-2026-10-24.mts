/**
 * One-time food-log entry on the owner's account, requested 2026-10-24: Sat
 * 10/24 (America/Puerto_Rico). Values are the owner's, entered exactly.
 * Expected: 1,709 kcal / 173 g. Target stays 1,850 / 140 (not touched).
 *
 * What the read found (2026-10-24):
 *   - Weight 10/24 152.2 already stored ✓ → not touched.
 *   - Five rows logged by the app, every one at the owner's kcal/protein:
 *       "Scramble Eggs Lean" 515/72 · "Chilli" 240/18 · "Chicken Wrap" 295/37
 *       · "Chicle again" 129/21 · "Unreal" 90/2 → KEPT; ingredient notes
 *       added; the two typos renamed to the owner's labels. Logged times
 *       differ from the owner's by 5–121 min → times kept, reported.
 *   - Realgood tortilla, pastelón, salad: no rows → ADDED.
 *   - Hunger 10/24 null → left null (owner enters it).
 *
 * Everything read is backed up to ~/ignia-backups first. Dry run unless
 * `--apply`; re-runs are no-ops. Any 10/24 row not listed here, or a listed
 * row whose kcal/protein drifted → refuse.
 *
 *   TZ=America/Puerto_Rico npx jiti scripts/backfill-food-2026-10-24.mts [--apply]
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
const DAY = '2026-10-24';
const APPLY = process.argv.includes('--apply');
const at = (hhmm: string) => new Date(`${DAY}T${hhmm}:00-04:00`);

/** Rows the app already logged, by id as read 2026-10-24. */
const EXISTING: { id: string; time: string; was: string; label: string; kcal: number; protein: number; note?: string }[] = [
  { id: 'Odd7DhtaE2TjSODmOwOl', time: '07:30', was: 'Scramble Eggs Lean', label: 'Scramble Eggs Lean', kcal: 515, protein: 72,
    note: '3 eggs · 1 c egg whites · 5 Jones Canadian bacon · ~150 g vegetables · 1 Olé tortilla · cooking spray.' },
  { id: 'wiM8VLf7oeqRCTA94Ewk', time: '10:10', was: 'Chilli', label: 'Chili (lean beef + beans) ¾ c + mustard', kcal: 240, protein: 18,
    note: '¾ c chili (lean beef + beans) + mustard.' },
  { id: 'P49pJPCx1NoXxEMIzkxC', time: '13:15', was: 'Chicken Wrap', label: 'Chicken Wrap', kcal: 295, protein: 37,
    note: 'Chicken breast 94 g cooked + seasoning/oil ~20 kcal · broccoli/cauliflower ~199 g · Olé Xtreme tortilla 60/4.' },
  { id: 'QM8rMefH7j4i88ieszLz', time: '13:30', was: 'Chicle again', label: 'Chicken again', kcal: 129, protein: 21,
    note: 'Chicken breast 69 g cooked + oil.' },
  { id: 'v6Sk0QYDDo07HBUXnA3j', time: '13:39', was: 'Unreal', label: 'Unreal', kcal: 90, protein: 2 },
];
type Row = { time: string; slot: LogEntry['mealType']; label: string; kcal: number; protein: number; note: string };
const NEW: Row[] = [
  { time: '11:47', slot: 'snack', label: 'Realgood tortilla', kcal: 90, protein: 10, note: 'Hungry at 11:47. Eaten in addition to the 13:39 Unreal.' },
  { time: '19:00', slot: 'dinner', label: 'Pastelón (plantain, ground beef, cheese)', kcal: 250, protein: 11, note: '114 g.' },
  { time: '20:00', slot: 'dinner', label: 'Salad, light dressing', kcal: 100, protein: 2, note: 'Estimate: ~2 c greens/veg + ~2 tbsp light dressing.' },
];
const EXPECT = { kcal: 1709, protein: 173 };

initializeApp({ credential: applicationDefault(), projectId: PROJECT_ID });
const db = getFirestore();
const uid = (await getAuth().getUserByEmail(EMAIL)).uid;
const ref = db.doc(`users/${uid}`);

const dayLogs = async () => (await ref.collection('dailyLogs')
  .where('timestamp', '>=', Timestamp.fromDate(at('00:00')))
  .where('timestamp', '<', Timestamp.fromDate(new Date('2026-10-25T00:00:00-04:00')))
  .get()).docs;
const logs = await dayLogs();
const weight = await ref.collection('dailyWeights').doc(DAY).get();
const hunger = await ref.collection('dailyHunger').doc(DAY).get();
const targets = await ref.collection('dailyTargets').doc(DAY).get();

const dir = join(homedir(), 'ignia-backups');
mkdirSync(dir, { recursive: true });
const backup = join(dir, `backfill-food-2026-10-24-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
writeFileSync(backup, JSON.stringify({
  logs: logs.map((d) => ({ id: d.id, ...d.data() })),
  weight: weight.data() ?? null, hunger: hunger.data() ?? null, targets: targets.data() ?? null,
}, null, 2));

const isNew = (d: FirebaseFirestore.QueryDocumentSnapshot) =>
  NEW.find((r) => d.get('mealLabel') === r.label && d.get('calories') === r.kcal && d.get('protein') === r.protein);
const problems: string[] = [];
for (const d of logs) {
  const e = EXISTING.find((x) => x.id === d.id);
  if (e) {
    if (d.get('calories') !== e.kcal || d.get('protein') !== e.protein) problems.push(`${d.id} is ${d.get('calories')}/${d.get('protein')}, expected ${e.kcal}/${e.protein}`);
    if (![e.was, e.label].includes(d.get('mealLabel'))) problems.push(`${d.id} label "${d.get('mealLabel')}" changed since the read`);
  } else if (!isNew(d)) problems.push(`unknown row ${d.id} "${d.get('mealLabel')}" ${d.get('calories')}/${d.get('protein')}`);
}
for (const e of EXISTING) if (!logs.some((d) => d.id === e.id)) problems.push(`row ${e.id} "${e.was}" is gone`);
if (problems.length) {
  console.log('REFUSING — 10/24 no longer matches the read:');
  for (const p of problems) console.log(`  ✗ ${p}`);
  process.exit(1);
}

const CODEC: DocCodec<Timestamp> = { timestamp: (d) => Timestamp.fromDate(d), remove: () => FieldValue.delete() };
const hhmm = (d: Date) => d.toLocaleTimeString('en-GB', { timeZone: 'America/Puerto_Rico', hour: '2-digit', minute: '2-digit' });
const plan: string[] = [];
const writes: (() => Promise<unknown>)[] = [];
for (const e of EXISTING) {
  const d = logs.find((x) => x.id === e.id)!;
  const stored = hhmm(d.get('timestamp').toDate());
  if (stored !== e.time) console.log(`  MISMATCH "${e.label}": logged at ${stored}, owner says ${e.time} — time kept`);
  const patch: Record<string, string> = {};
  if (d.get('mealLabel') !== e.label) patch.mealLabel = e.label;
  if (e.note && d.get('note') == null) patch.note = e.note;
  else if (e.note && d.get('note') !== e.note) console.log(`  · "${e.label}" has a different note — not overwritten`);
  if (!Object.keys(patch).length) { console.log(`· ${e.label} ${e.kcal}/${e.protein} ✓`); continue; }
  plan.push(`UPDATE ${e.id} ${e.kcal}/${e.protein}${patch.mealLabel ? ` label "${d.get('mealLabel')}" → "${e.label}"` : ` "${e.label}"`}${patch.note ? ' + note' : ''}`);
  writes.push(() => d.ref.update(patch));
}
for (const r of NEW) {
  if (logs.some((d) => isNew(d) === r)) { console.log(`· ${r.label} ${r.kcal}/${r.protein} already logged`); continue; }
  const t = at(r.time);
  const doc = toLogDoc(withDefaultMealSlot({ calories: r.kcal, protein: r.protein, mealLabel: r.label, mealType: r.slot, timestamp: t, note: r.note }, t), CODEC);
  plan.push(`CREATE ${r.time} ${r.slot} "${r.label}" ${r.kcal}/${r.protein} + note`);
  writes.push(() => ref.collection('dailyLogs').add(doc));
}

async function maintenance(label: string) {
  const prof = (await ref.get()).data() as Profile;
  const rows: DailyLog[] = (await ref.collection('dailyLogs').orderBy('timestamp', 'desc').limit(LOG_WINDOW_ROWS).get()).docs.map((d) => toDailyLog(d.id, d.data()));
  const weights = Object.fromEntries((await ref.collection('dailyWeights').get()).docs.map((d) => [d.id, d.get('weight') as number]));
  const dayComplete = Object.fromEntries((await ref.collection('dailyLogged').get()).docs.map((d) => [d.id, d.get('complete') as boolean]));
  const t = dailyTargets(prof, rows, weights, new Date(), dayComplete);
  console.log(`[${label}] maintenance ${Math.round(t.tdee.trueTdee)} (${t.tdee.source}) · target ${t.calorieTarget}/${t.proteinTarget}`);
}

console.log(`backup: ${backup}`);
console.log(`weight ${DAY}: ${JSON.stringify(weight.data() ?? null)} · hunger ${DAY}: ${JSON.stringify(hunger.data() ?? null)} (not touched)`);
console.log(`targets ${DAY} (stored): ${targets.get('kcalTarget')} / ${targets.get('proteinTarget')}, maintenance ${targets.get('maintenanceEstimate')} (${targets.get('maintenanceSource')})`);
console.log(`\nPLAN (${plan.length}):`);
for (const p of plan) console.log(`  → ${p}`);
await maintenance('before');
if (!APPLY) { console.log('\nDry run — nothing written. Re-run with --apply.'); process.exit(0); }
for (const w of writes) await w();
const after = await dayLogs();
const tot = after.reduce((a, d) => [a[0] + (d.get('calories') ?? 0), a[1] + (d.get('protein') ?? 0)], [0, 0]);
console.log(`\nAPPLIED ${writes.length} write(s). 10/24 now ${after.length} rows, ${tot[0]} kcal / ${tot[1]} g (expected ${EXPECT.kcal} / ${EXPECT.protein})`);
await maintenance('after');
process.exit(0);
