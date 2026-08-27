// Clear or restore the QA account's fasts so the stub state can be seen.
import { initializeApp } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
initializeApp({ projectId: 'fitness-tracker-gb-1775407101' });
const db = getFirestore();
const UID = '3TncAb3zJxbz4utKY8gYwFm06A32';
const col = db.collection(`users/${UID}/fasts`);

const snap = await col.get();
for (const d of snap.docs) await d.ref.delete();
console.log('cleared', snap.size);

if (process.argv[2] === 'restore') {
  const PLAN = [[13,20,15,12,30],[12,19,45,12,0],[11,21,0,13,15],[9,20,30,12,45],[8,20,0,11,30],
                [7,19,30,13,0],[6,20,45,12,15],[5,21,30,14,0],[3,20,0,12,0],[2,19,50,11,45],
                [1,20,20,12,30],[0,20,10,12,20]];
  const now = new Date();
  for (const [ago, sh, sm, eh, em] of PLAN) {
    const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() - ago, eh, em, 0, 0);
    const start = new Date(end.getFullYear(), end.getMonth(), end.getDate() - 1, sh, sm, 0, 0);
    await col.add({ startedAt: Timestamp.fromDate(start), endedAt: Timestamp.fromDate(end), source: 'timer' });
  }
  console.log('restored', PLAN.length);
}
process.exit(0);
