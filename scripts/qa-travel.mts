/**
 * Travel-mode QA on the synthetic QA account (never a real one): put a trip
 * covering today on the profile so every travel surface renders, report the
 * account's training history (re-entry needs a gym session ≥ 7 days back),
 * and take it all off again.
 *
 *   TZ=America/Puerto_Rico npx jiti scripts/qa-travel.mts set   --email qa-test@ignia.fit
 *   TZ=America/Puerto_Rico npx jiti scripts/qa-travel.mts clear --email qa-test@ignia.fit
 *   TZ=America/Puerto_Rico npx jiti scripts/qa-travel.mts sessions --email qa-test@ignia.fit
 *
 * `set` keeps the previous `travelPeriods` in a backup and refuses if the
 * account already has one it did not write. Auth: ADC.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

const [cmd] = process.argv.slice(2);
const i = process.argv.indexOf('--email');
const email = i > 0 ? process.argv[i + 1] : undefined;
if (!email || !/demo|test|review|appstore/.test(email)) throw new Error('--email must be a QA account (demo|test|review|appstore)');
if (email.includes('gabrielandresbermudez')) throw new Error('never the owner');

initializeApp({ credential: applicationDefault(), projectId: 'fitness-tracker-gb-1775407101' });
const db = getFirestore();
const uid = (await getAuth().getUserByEmail(email)).uid;
const ref = db.doc(`users/${uid}`);
const key = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: 'America/Puerto_Rico' });
const today = new Date();
const QA_TRIP = {
  start: key(new Date(today.getTime() - 2 * 86_400_000)),
  end: key(new Date(today.getTime() + 3 * 86_400_000)),
  label: 'QA trip',
  usualSteps: 6000,
  altitude: { place: 'Cochabamba', meters: 2577, arrival: key(today) },
};

const prof = (await ref.get()).data() ?? {};
if (cmd === 'set') {
  const existing = (prof.travelPeriods ?? []) as { label?: string }[];
  if (existing.some((p) => p.label !== 'QA trip')) throw new Error(`refusing: account has a trip this script did not write: ${JSON.stringify(existing)}`);
  const dir = join(homedir(), 'ignia-backups');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `qa-travel-${Date.now()}.json`), JSON.stringify({ email, travelPeriods: prof.travelPeriods ?? null }));
  await ref.update({ travelPeriods: [QA_TRIP] });
  console.log(`set ${email}: ${JSON.stringify(QA_TRIP)}`);
} else if (cmd === 'clear') {
  await ref.update({ travelPeriods: FieldValue.delete() });
  console.log(`cleared travelPeriods on ${email}`);
} else if (cmd === 'sessions') {
  const s = (await ref.collection('workoutSessions').orderBy('timestamp', 'desc').limit(8).get()).docs;
  const t = (await ref.collection('workoutTemplates').get()).docs;
  console.log(`templates: ${t.map((d) => `${d.get('name')}${d.get('archivedAt') ? ' (archived)' : ''}`).join(' · ')}`);
  for (const d of s) console.log(`  ${key(d.get('timestamp').toDate())} ${d.get('templateName') ?? '(no template)'} ${d.get('status')} lifts=${(d.get('exercises') ?? []).length}${d.get('reentry') ? ` reentry=${d.get('reentry')}` : ''}${d.get('notComparable') ? ' notComparable' : ''}`);
  console.log(`travelPeriods: ${JSON.stringify(prof.travelPeriods ?? null)}`);
} else throw new Error('set | clear | sessions');
process.exit(0);
