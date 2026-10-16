/**
 * Owner data, 2026-10-15 (code review of Program v2.1): Seated Machine Row's
 * v2.1 baseline is a pure HOLD — "hold the row until the first Pull in the
 * new order" — so it carries no drop-back floor. The v2.1 script gave it one
 * from a 5-lb guess (100 → 95) on a machine whose stack is not on file; the
 * baseline it replaced had none. Removes `dropBackTo` / `dropBackBelowReps`
 * from that one row and nothing else.
 *
 *   npx jiti scripts/owner-data-2026-10-15-row-hold.mts --email <owner> [--apply]
 *
 * Dry run by default. With --apply, the template is backed up to
 * ~/ignia-backups first. Re-running is a no-op.
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';

const PROJECT_ID = 'fitness-tracker-gb-1775407101';
const args = process.argv.slice(2);
const email = args[args.indexOf('--email') + 1];
const apply = args.includes('--apply');
if (!email || args.indexOf('--email') < 0) throw new Error('--email required');

initializeApp({ credential: applicationDefault(), projectId: PROJECT_ID });
const db = getFirestore();
const uid = (await getAuth().getUserByEmail(email)).uid;
const user = db.doc(`users/${uid}`);

const tpls = await user.collection('workoutTemplates').get();
const pull = tpls.docs.find((d) => d.get('name') === 'Pull Day');
if (!pull) throw new Error('Pull Day not found');
const rows = pull.get('exercises') as Record<string, unknown>[];
const i = rows.findIndex((r) => r['name'] === 'Seated Machine Row');
if (i < 0) throw new Error('Seated Machine Row not in Pull Day');
const baseline = rows[i]['baseline'] as Record<string, unknown> | undefined;
console.log('before:', JSON.stringify(baseline));
if (!baseline || (baseline['dropBackTo'] == null && baseline['dropBackBelowReps'] == null)) {
  console.log('nothing to change');
  process.exit(0);
}
const { dropBackTo: _a, dropBackBelowReps: _b, ...hold } = baseline;
const next = rows.map((r, j) => (j === i ? { ...r, baseline: hold } : r));
console.log('after: ', JSON.stringify(hold));
if (!apply) {
  console.log('DRY RUN — pass --apply to write');
  process.exit(0);
}
const dir = join(homedir(), 'ignia-backups');
if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
const backup = join(dir, `owner-data-2026-10-15-row-hold-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
writeFileSync(backup, JSON.stringify({ uid, templateId: pull.id, exercises: rows }, null, 2));
if (!existsSync(backup)) throw new Error('backup not written');
console.log('backup written:', backup);
await pull.ref.update({ exercises: next, updatedAt: Timestamp.fromDate(new Date()) });
console.log('written');
