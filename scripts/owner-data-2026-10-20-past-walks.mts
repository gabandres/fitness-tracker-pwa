/**
 * Owner data, 2026-10-20 (follow-up: "past walks too"). A scan of all 54
 * sessions under the new routing rule (core `inSessionWindow`, with lifting
 * sessions that have no `durationMin` counted as 90 min) found ONE more Watch
 * workout on a session it does not belong to:
 *
 *   10/09 Push Day `cddJU3gBx0MjJQ404OnU` (lifts from 06:56) holds an
 *   "Outdoor Walk" that started at 19:16 local, 1,474 s → moved to its own
 *   completed session, no template, like the 10/15 20:33 walk.
 *
 * No Zone 2 duplicates remain. Heart rate for past walks is not written here:
 * only the phone can read HealthKit, and the app's one-time backfill does it.
 * DRY RUN unless `--apply`; idempotent; everything read is backed up first.
 *
 *   TZ=America/Puerto_Rico npx jiti scripts/owner-data-2026-10-20-past-walks.mts --email gabrielandresbermudez@gmail.com [--apply]
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, Timestamp, FieldValue } from 'firebase-admin/firestore';
import { type DocCodec, inSessionWindow, toSessionDoc } from '../packages/core/src/index.ts';

const PUSH = 'cddJU3gBx0MjJQ404OnU';
const argv = process.argv.slice(2);
const email = argv[argv.indexOf('--email') + 1];
const apply = argv.includes('--apply');
if (!email || email.startsWith('--')) { console.error('--email is required'); process.exit(2); }
initializeApp({ credential: applicationDefault(), projectId: 'fitness-tracker-gb-1775407101' });
const db = getFirestore();
const uid = (await getAuth().getUserByEmail(email)).uid;
const user = db.collection('users').doc(uid);
type Doc = Record<string, any>;

const snap = await user.collection('workoutSessions').doc(PUSH).get();
const s = snap.data() as Doc;
const walk = (s.cardio ?? []).find((b: Doc) => b.sourceId && b.durationSec === 1474);
const sid: string | undefined = walk?.sourceId;
const already = sid
  ? []
  : (await user.collection('workoutSessions').where('timestamp', '>=', Timestamp.fromDate(new Date('2026-10-09T23:00:00Z')))
      .where('timestamp', '<', Timestamp.fromDate(new Date('2026-10-10T00:00:00Z'))).get()).docs
      .filter((d) => (d.get('cardio') ?? []).some((b: Doc) => b.durationSec === 1474));

const conv = (v: unknown): unknown => v instanceof Timestamp ? v.toDate().toISOString() : Array.isArray(v) ? v.map(conv)
  : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, conv(x)])) : v;
const dir = join(homedir(), 'ignia-backups');
mkdirSync(dir, { recursive: true });
const backup = join(dir, `owner-data-2026-10-20-past-walks-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
writeFileSync(backup, JSON.stringify(conv({ uid, [PUSH]: s, standalone: already.map((d) => ({ id: d.id, ...d.data() })) }), null, 1));
console.log(`${apply ? '' : '[dry run] '}backup: ${backup}`);

if (!walk) {
  console.log(already.length === 1 ? `already moved → ${already[0].id}` : `REFUSE: walk not found on Push Day and not standalone (${already.length})`);
  process.exit(already.length === 1 ? 0 : 1);
}
const startedAt: Date = walk.startedAt.toDate();
const sess = { date: s.timestamp.toDate(), durationMin: s.durationMin, exercises: s.exercises, cardio: [] };
if (inSessionWindow(sess, { startedAt, durationSec: walk.durationSec })) { console.log('REFUSE: walk is inside the session window'); process.exit(1); }
const block = { ...walk, startedAt };
const CODEC: DocCodec<Timestamp> = { timestamp: (x) => Timestamp.fromDate(x), remove: () => FieldValue.delete() };
const prune = (v: unknown): unknown => Array.isArray(v) ? v.map(prune)
  : v && typeof v === 'object' && !(v instanceof Timestamp) ? Object.fromEntries(Object.entries(v).filter(([, x]) => x !== undefined).map(([k, x]) => [k, prune(x)])) : v;
const doc = prune(toSessionDoc({ status: 'completed', date: startedAt, exercises: [], cardio: [block as never] }, CODEC)) as Doc;
const ref = user.collection('workoutSessions').doc();
console.log(`Push Day ${PUSH} (${sess.date.toISOString()}): remove "${walk.label ?? walk.modality}" ${walk.durationSec}s @ ${startedAt.toISOString()} [${sid!.slice(0, 8)}] → new session ${ref.id}, no template`);
if (!apply) { console.log('dry run — re-run with --apply'); process.exit(0); }
const batch = db.batch();
batch.update(snap.ref, { cardio: (s.cardio as Doc[]).filter((b) => b !== walk), updatedAt: Timestamp.now() });
batch.set(ref, doc);
await batch.commit();
console.log('Applied.');
