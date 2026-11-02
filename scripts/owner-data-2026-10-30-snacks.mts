/**
 * Owner data, requested 2026-10-30 (America/Puerto_Rico): the 10/30 evening
 * snacks, on top of `owner-data-2026-10-30.mts`. Values are the owner's, entered
 * exactly. Expected day: 1,766 / 161. Target stays 1,850 / 140.
 *
 * What the read found (2026-10-30 23:24): "Kirkland PB" 190/21 (21:40) and two
 * "Unreal" rows 90/2 (22:50), which are the owner's "Unreal ×2" 180/4 → KEPT.
 * The donuts: no row → ADDED. A snack already logged (same kcal + protein, or
 * rows matching `like` that add up to it) is never duplicated; matching rows
 * that do not add up refuse. The owner gave no time, so a new row takes `TIME`.
 *
 * Dry run unless `--apply`; re-runs plan 0; the day's rows are backed up to
 * ~/ignia-backups first.
 *
 *   TZ=America/Puerto_Rico npx jiti scripts/owner-data-2026-10-30-snacks.mts [--apply]
 *
 * Auth: ADC (`gcloud auth application-default login`).
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, FieldValue, Timestamp } from 'firebase-admin/firestore';
import {
  type DocCodec,
  calculateTdee,
  dayBoundaryOf,
  mergeDailyWeights,
  toDailyLog,
  toDomainProfile,
  toLogDoc,
  withDefaultMealSlot,
} from '../packages/core/src/index.ts';

const PROJECT_ID = 'fitness-tracker-gb-1775407101';
const OWNER = 'gabrielandresbermudez@gmail.com';
const APPLY = process.argv.includes('--apply');
const DAY = '2026-10-30';
const TIME = '20:30';
const at = (day: string, hhmm: string) => new Date(`${day}T${hhmm}:00-04:00`);

const SNACKS = [
  { label: 'Powdered sugar donuts, small ×2', kcal: 180, protein: 2, like: /donut|dona/i, note: 'Estimate, brand unknown.' },
  { label: 'Kirkland protein bar', kcal: 190, protein: 21, like: /kirkland|protein bar/i },
  { label: 'Unreal ×2', kcal: 180, protein: 4, like: /unreal/i },
];
const EXPECT = { kcal: 1766, protein: 161 };

initializeApp({ credential: applicationDefault(), projectId: PROJECT_ID });
const db = getFirestore();
const uid = (await getAuth().getUserByEmail(OWNER)).uid;
const user = db.doc(`users/${uid}`);
const CODEC: DocCodec<Timestamp> = { timestamp: (d) => Timestamp.fromDate(d), remove: () => FieldValue.delete() };

const dayLogs = async () => (await user.collection('dailyLogs')
  .where('timestamp', '>=', Timestamp.fromDate(at(DAY, '00:00')))
  .where('timestamp', '<', Timestamp.fromDate(at('2026-10-31', '00:00')))
  .orderBy('timestamp')
  .get()).docs;
const total = (docs: FirebaseFirestore.QueryDocumentSnapshot[]) =>
  docs.reduce((a, x) => [a[0] + (x.get('calories') ?? 0), a[1] + (x.get('protein') ?? 0)], [0, 0]);

const logs = await dayLogs();
console.log(`${APPLY ? 'APPLY' : 'DRY RUN'} — now ${new Date().toString()}\n\n10/30 as stored:`);
for (const d of logs) console.log(`  ${d.get('timestamp').toDate().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })} ${d.get('mealType')} "${d.get('mealLabel')}" ${d.get('calories')}/${d.get('protein')} [${d.id}]`);
console.log(`  = ${total(logs).join(' / ')}`);

const plan: (typeof SNACKS)[number][] = [];
const conflicts: string[] = [];
for (const s of SNACKS) {
  const same = logs.filter((d) => d.get('calories') === s.kcal && d.get('protein') === s.protein);
  const near = logs.filter((d) => s.like.test(String(d.get('mealLabel') ?? '')));
  const [nearKcal, nearProtein] = total(near);
  if (same.length) console.log(`· ${s.label} ${s.kcal}/${s.protein}: already logged as "${same[0].get('mealLabel')}"`);
  else if (near.length && nearKcal === s.kcal && nearProtein === s.protein) console.log(`· ${s.label} ${s.kcal}/${s.protein}: already logged as ${near.length} "${near[0].get('mealLabel')}" rows that add up to it`);
  else if (near.length) conflicts.push(`${s.label} ${s.kcal}/${s.protein}: stored as ${near.map((d) => `"${d.get('mealLabel')}" ${d.get('calories')}/${d.get('protein')} [${d.id}]`).join(', ')}`);
  else plan.push(s);
}
console.log(`\nPLAN (${plan.length}):`);
for (const s of plan) console.log(`  → CREATE ${TIME} snack "${s.label}" ${s.kcal}/${s.protein}${s.note ? ` + note "${s.note}"` : ''}`);
if (conflicts.length) { console.log(`\nREFUSING — same food, different numbers:\n${conflicts.map((c) => `  ${c}`).join('\n')}`); process.exit(1); }

const hold = async (label: string) => {
  const [p, logsSnap, weightsSnap, loggedSnap] = await Promise.all([
    user.get(),
    user.collection('dailyLogs').orderBy('timestamp', 'desc').limit(400).get(),
    user.collection('dailyWeights').get(),
    user.collection('dailyLogged').get(),
  ]);
  const profile = toDomainProfile(p.data()!);
  const weights: Record<string, number> = {};
  for (const d of weightsSnap.docs) if (typeof d.get('weight') === 'number') weights[d.id] = d.get('weight');
  const complete: Record<string, boolean> = {};
  for (const d of loggedSnap.docs) if (typeof d.get('complete') === 'boolean') complete[d.id] = d.get('complete');
  const boundary = dayBoundaryOf(profile);
  const merged = mergeDailyWeights(logsSnap.docs.map((d) => toDailyLog(d.id, d.data())), weights, boundary);
  const r = calculateTdee(merged, profile, boundary, new Date('2026-11-05T12:00:00-04:00'), weights, complete) as { source: string; trueTdee: number; ci95Tdee?: number; travelHold?: { state: string; frozenAsOf: string } };
  console.log(`held value ${label}: ${r.source} ${r.trueTdee} ±${r.ci95Tdee} (${r.travelHold?.state} as of ${r.travelHold?.frozenAsOf}); 10/30 complete flag: ${complete[DAY] ?? 'unset'}`);
};

if (!APPLY) { await hold('now'); console.log('\nDry run. Re-run with --apply to write.'); process.exit(0); }
if (plan.length) {
  const dir = join(homedir(), 'ignia-backups');
  const backup = join(dir, `owner-data-2026-10-30-snacks-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(backup, JSON.stringify(logs.map((d) => ({ id: d.id, ...d.data() })), null, 1));
  if (!existsSync(backup)) throw new Error('backup not written — refusing to write');
  console.log(`\nbackup written: ${backup}`);
  const t = at(DAY, TIME);
  const batch = db.batch();
  for (const s of plan) {
    batch.set(user.collection('dailyLogs').doc(), toLogDoc(withDefaultMealSlot({ calories: s.kcal, protein: s.protein, mealLabel: s.label, mealType: 'snack', timestamp: t, ...(s.note ? { note: s.note } : {}) }, t), CODEC));
  }
  await batch.commit();
  console.log(`written: ${plan.length} row(s).`);
} else console.log('\nNothing to do (already applied).');

const after = await dayLogs();
const [kcal, protein] = total(after);
console.log(`\n10/30: ${after.length} rows, ${kcal} kcal / ${protein} g (owner ≈ ${EXPECT.kcal} / ${EXPECT.protein}; target 1,850 / 140)`);
await hold('after');
process.exit(0);
