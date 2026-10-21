/**
 * Owner data, 2026-10-20 (23:03 export leftovers): Pull Day's Incline DB Curl
 * 45° template load 17.5 → 20 — the owner did 20 × 10 on 10/20 and has no
 * 17.5 dumbbells. A `loadLog` entry by `prompt`, so `honourLifterLoad` holds
 * it. DRY RUN unless `--apply`; idempotent; the template is backed up first.
 *
 *   npx jiti scripts/owner-data-2026-10-20-incline-curl.mts --email gabrielandresbermudez@gmail.com [--apply]
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';

const PULL = 'aliWJBD2FND6mU9foLdC';
const CURL = 'MVC1wLKBkRz7XYyKp79e';
const FROM = 17.5, TO = 20;
const argv = process.argv.slice(2);
const email = argv[argv.indexOf('--email') + 1];
const apply = argv.includes('--apply');
initializeApp({ credential: applicationDefault(), projectId: 'fitness-tracker-gb-1775407101' });
const db = getFirestore();
const uid = (await getAuth().getUserByEmail(email)).uid;
const ref = db.doc(`users/${uid}/workoutTemplates/${PULL}`);
const snap = await ref.get();
const t = snap.data()!;
const conv = (v: unknown): unknown => v instanceof Timestamp ? v.toDate().toISOString() : Array.isArray(v) ? v.map(conv)
  : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, conv(x)])) : v;
const dir = join(homedir(), 'ignia-backups');
mkdirSync(dir, { recursive: true });
const backup = join(dir, `owner-data-2026-10-20-incline-curl-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
writeFileSync(backup, JSON.stringify(conv({ uid, template: { id: PULL, ...t } }), null, 1));
console.log(`${apply ? '' : '[dry run] '}backup: ${backup}`);
const row = (t.exercises as Record<string, any>[]).find((r) => r.exerciseId === CURL);
if (!row) { console.log('REFUSE: curl row not on Pull Day'); process.exit(1); }
if (row.targetLoad === TO) { console.log(`already ${TO}`); process.exit(0); }
if (row.targetLoad !== FROM) { console.log(`REFUSE: load is ${row.targetLoad}, expected ${FROM}`); process.exit(1); }
const now = new Date();
const rows = (t.exercises as Record<string, any>[]).map((r) => r !== row ? r : {
  ...r, targetLoad: TO, lastModifiedAt: now.toISOString(), lastModifiedBy: 'prompt',
  loadLog: [...(r.loadLog ?? []), { at: now.toISOString(), from: FROM, to: TO, by: 'prompt', reason: 'Did 20 × 10 on 10/20; no 17.5 dumbbells (owner, 2026-10-20)' }],
});
console.log(`${row.name}: ${FROM} → ${TO} (superset ${row.supersetGroup ?? '—'})`);
if (!apply) { console.log('dry run — re-run with --apply'); process.exit(0); }
await ref.update({ exercises: rows, updatedAt: Timestamp.fromDate(now) });
console.log('Applied.');
