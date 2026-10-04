/**
 * Follow-up to `backfill-food-2026-10-03.mts`, after the 2026-10-03 rules
 * deploy allowed `note` + `createdAt` on log rows: attach the owner's per-row
 * notes, and a `createdAt` in table order so the three 08:15 and the two 18:30
 * rows list in the order given (`compareLogsOldestFirst`). Touches only those
 * eight rows, matched on label + kcal + protein + time; only `note` and
 * `createdAt` are written. createdAt = the row's own Firestore createTime plus
 * N ms, N = its table position.
 *
 * Dry run unless `--apply`. REFUSES (exit 1, nothing written) when a row is
 * missing/duplicated, or already carries a DIFFERENT note. Re-runs are no-ops.
 *
 *   TZ=America/Puerto_Rico npx jiti scripts/backfill-food-notes-2026-10-03.mts --email <email> [--apply]
 */
import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { cleanLogNote } from '../packages/core/src/index.ts';

const PROJECT_ID = 'fitness-tracker-gb-1775407101';
const ROWS: Array<[time: string, label: string, kcal: number, protein: number, note: string]> = [
  ['08:15', 'Scrambled eggs in bacon fat (3 medium)', 225, 18, '1/4 of 12 eggs cooked in bacon fat; ~45 kcal fat share included'],
  ['08:15', 'Pearl Milling pancake 161 g', 330, 7, 'Weighed. ~2.05 kcal/g cooked (label: 1/4 c dry, 40 g = 140 kcal / 3 g)'],
  ['08:15', 'Pineapple + watermelon (~1/2 c each)', 65, 1, 'Estimated, logged at the larger guess'],
  ['09:00', 'Pearl Milling pancake 120 g', 246, 5, 'Weighed. Same density as #2'],
  ['13:00', 'David bar (chocolate chip cookie dough)', 150, 28, 'Label'],
  ['18:30', 'Turabo pizza, pepperoni, 2 slices', 760, 26, 'Not weighed. ~380/slice restaurant estimate, logged high'],
  ['18:30', 'Pizza crust ends x2', 240, 7, 'Not weighed. ~120 each'],
  ['19:30', 'Kirkland protein bar', 190, 21, 'Label'],
];

const argv = process.argv.slice(2);
const arg = (n: string) => { const i = argv.indexOf(`--${n}`); return i === -1 ? null : argv[i + 1]; };
const apply = argv.includes('--apply');
initializeApp({ credential: applicationDefault(), projectId: PROJECT_ID });
const db = getFirestore();
const uid = arg('uid') ?? (await getAuth().getUserByEmail(arg('email')!)).uid;
const logs = db.collection('users').doc(uid).collection('dailyLogs');
const snap = await logs
  .where('timestamp', '>=', Timestamp.fromDate(new Date('2026-10-03T00:00:00-04:00')))
  .where('timestamp', '<', Timestamp.fromDate(new Date('2026-10-04T00:00:00-04:00')))
  .get();
console.log(`${apply ? '' : '[dry run] '}uid ${uid}, ${snap.size} rows on 2026-10-03`);

const refusals: string[] = [];
const writes: Array<{ id: string; data: Record<string, unknown>; line: string }> = [];
ROWS.forEach(([time, label, kcal, protein, rawNote], i) => {
  const at = new Date(`2026-10-03T${time}:00-04:00`).getTime();
  const hits = snap.docs.filter((d) => {
    const x = d.data();
    return x.mealLabel === label && x.calories === kcal && x.protein === protein && x.timestamp.toMillis() === at;
  });
  if (hits.length !== 1) { refusals.push(`#${i + 1} "${label}": ${hits.length} matching rows`); return; }
  const d = hits[0];
  const x = d.data();
  const note = cleanLogNote(rawNote)!;
  const createdAt = Timestamp.fromMillis(d.createTime.toMillis() + i);
  if (x.note != null && x.note !== note) { refusals.push(`#${i + 1} "${label}": already has note "${x.note}"`); return; }
  const data: Record<string, unknown> = {};
  if (x.note !== note) data.note = note;
  if (x.createdAt == null) data.createdAt = createdAt;
  const line = `#${i + 1} ${d.id} ${time} "${label}"`;
  if (Object.keys(data).length === 0) { console.log(`OK    ${line}: already done`); return; }
  console.log(`${apply ? 'SET  ' : 'WOULD'} ${line}: ${Object.keys(data).join(' + ')} — "${note}"`);
  writes.push({ id: d.id, data, line });
});
for (const r of refusals) console.log(`REFUSE  ${r}`);
if (refusals.length) { console.log('Aborted: nothing written.'); process.exit(1); }
if (!writes.length) console.log('Nothing to do.');
else if (apply) {
  const batch = db.batch();
  for (const w of writes) batch.update(logs.doc(w.id), w.data);
  await batch.commit();
  console.log(`Applied ${writes.length} update(s).`);
} else console.log(`${writes.length} update(s) pending — re-run with --apply.`);
