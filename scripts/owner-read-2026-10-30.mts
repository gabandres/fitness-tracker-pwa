/**
 * READ-ONLY dump of the owner's account for the 2026-10-30 entry: every 10/30
 * row, the 10/27 session + walk rows the carryover items name, Push/Pull
 * templates and saved foods. Writes nothing but the --json file.
 *
 *   TZ=America/Puerto_Rico npx jiti scripts/owner-read-2026-10-30.mts --json /tmp/ignia-1030.json
 *
 * Auth: ADC (`gcloud auth application-default login`).
 */
import { writeFileSync } from 'node:fs';
import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';

const arg = (k: string) => {
  const i = process.argv.indexOf(k);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const jsonOut = arg('--json');
if (!jsonOut) throw new Error('--json required');

initializeApp({ credential: applicationDefault(), projectId: 'fitness-tracker-gb-1775407101' });
const uid = (await getAuth().getUserByEmail('gabrielandresbermudez@gmail.com')).uid;
const db = getFirestore();
const user = db.doc(`users/${uid}`);

const conv = (v: unknown): unknown => {
  if (v instanceof Timestamp) return v.toDate().toISOString();
  if (Array.isArray(v)) return v.map(conv);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, conv(x)]));
  return v;
};
const rows = (s: FirebaseFirestore.QuerySnapshot) => s.docs.map((d) => ({ id: d.id, ...(conv(d.data()) as object) }));
const at = (day: string) => Timestamp.fromDate(new Date(`${day}T00:00:00-04:00`));

const cols = await user.listCollections();
const collections = cols.map((c) => c.id).sort();
const dayDocs: Record<string, unknown> = {};
for (const c of cols) {
  for (const day of ['2026-10-27', '2026-10-30']) {
    const d = await c.doc(day).get();
    if (d.exists) dayDocs[`${c.id}/${day}`] = conv(d.data());
  }
}

const [prof, logs30, logs27, meas, sessions, templates, exercises, foods, presets, weights, cardioPlain] = await Promise.all([
  user.get(),
  user.collection('dailyLogs').where('timestamp', '>=', at('2026-10-30')).where('timestamp', '<', at('2026-10-31')).get(),
  user.collection('dailyLogs').where('timestamp', '>=', at('2026-10-27')).where('timestamp', '<', at('2026-10-28')).get(),
  user.collection('measurements').orderBy('timestamp', 'desc').limit(8).get(),
  user.collection('workoutSessions').orderBy('timestamp', 'desc').limit(12).get(),
  user.collection('workoutTemplates').get(),
  user.collection('exercises').get(),
  user.collection('customFoods').get(),
  user.collection('presets').get(),
  user.collection('dailyWeights').get(),
  user.collection('cardioSessions').get().catch(() => null),
]);

const out = {
  uid,
  collections,
  profile: conv(prof.data()),
  dayDocs,
  logs30: rows(logs30),
  logs27: rows(logs27),
  measurements: rows(meas),
  sessions: rows(sessions),
  templates: rows(templates),
  exercises: rows(exercises),
  foods: rows(foods),
  presets: rows(presets),
  weights: rows(weights),
  cardioSessions: cardioPlain ? rows(cardioPlain) : null,
};
writeFileSync(jsonOut, JSON.stringify(out, null, 1));
console.log(`wrote ${jsonOut}: collections ${collections.join(', ')}`);
process.exit(0);
