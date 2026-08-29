import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';

const UID = process.argv[2] || '3TncAb3zJxbz4utKY8gYwFm06A32';
initializeApp({ credential: applicationDefault(), projectId: 'fitness-tracker-gb-1775407101' });
const db = getFirestore();

const u = await getAuth().getUser(UID).catch(() => null);
console.log('account:', u?.email, '· lastSignIn', u?.metadata.lastSignInTime);

const prof = await db.collection('users').doc(UID).get();
const d = prof.data() || {};
console.log('fastStartedAt:', d.fastStartedAt ? d.fastStartedAt.toDate().toString() : null);

const fasts = await db.collection('users').doc(UID).collection('fasts')
  .orderBy('endedAt', 'desc').limit(12).get();
console.log(`stored fasts: ${fasts.size}`);
for (const f of fasts.docs) {
  const x = f.data();
  const mins = Math.round((x.endedAt.toDate() - x.startedAt.toDate()) / 60000);
  console.log(` ${f.id}  ${x.startedAt.toDate().toLocaleString()}  ->  ${x.endedAt.toDate().toLocaleString()}  [${Math.floor(mins/60)}h ${mins%60}m]  source=${x.source ?? '(none)'}`);
}
