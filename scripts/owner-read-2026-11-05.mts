/**
 * READ-ONLY dump of both accounts for the 2026-11-05 entry (kg support, Travel
 * C+D carryover, Stephanie's Day 2B): profile, catalog, templates, the last 60
 * sessions. Writes nothing but the --json file.
 *
 *   npx jiti scripts/owner-read-2026-11-05.mts --json <file>
 *
 * Auth: ADC (`gcloud auth application-default login`).
 */
import { writeFileSync } from 'node:fs';
import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';

const i = process.argv.indexOf('--json');
const jsonOut = i > 0 ? process.argv[i + 1] : undefined;
if (!jsonOut) throw new Error('--json required');

initializeApp({ credential: applicationDefault(), projectId: 'fitness-tracker-gb-1775407101' });
const db = getFirestore();
const conv = (v: unknown): unknown => {
  if (v instanceof Timestamp) return v.toDate().toISOString();
  if (Array.isArray(v)) return v.map(conv);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, conv(x)]));
  return v;
};
const rows = (s: FirebaseFirestore.QuerySnapshot) => s.docs.map((d) => ({ id: d.id, ...(conv(d.data()) as object) }));
const out: Record<string, unknown> = {};
for (const [who, email] of [['gabriel', 'gabrielandresbermudez@gmail.com'], ['stephanie', 'stph.ctllo@gmail.com']] as const) {
  const uid = (await getAuth().getUserByEmail(email)).uid;
  const user = db.doc(`users/${uid}`);
  const [p, ex, tpl, ses] = await Promise.all([
    user.get(),
    user.collection('exercises').get(),
    user.collection('workoutTemplates').get(),
    user.collection('workoutSessions').orderBy('timestamp', 'desc').limit(60).get(),
  ]);
  out[who] = { uid, profile: conv(p.data()), exercises: rows(ex), templates: rows(tpl), sessions: rows(ses), collections: (await user.listCollections()).map((c) => c.id) };
}
writeFileSync(jsonOut, JSON.stringify(out, null, 1));
console.log('wrote', jsonOut);
