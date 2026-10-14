/**
 * The owner's 2026-10-14 Pull Day order change, requested and confirmed 2026-10-14.
 *
 *   1. Pull Day (v2, `aliWJBD2FND6mU9foLdC`): Neutral-grip pull-up → position
 *      1, Seated Machine Row → position 2. Every other row stays where it is.
 *   2. Both rows get an EXCLUDED READ for 2026-10-14, reason "context changed:
 *      position 2026-10-14" (`TemplateExercise.excludedReads`). 10/14 is the
 *      only session the row actually ran before the pull-up — 9/30 and 10/7
 *      were performed pull-up first, though logged in template order — so it
 *      is the one read out of position. Not a `baseline`: a baseline cuts every
 *      read BEFORE its day, which would throw away 9/30 and 10/7 (the
 *      same-position reads) and hold the next session; or, dated 10/14, make
 *      the out-of-position read itself the baseline. Skipping the one day
 *      means pull-up 7 is not a regression and row 13/13 is not progression.
 *   3. Rest after the pull-up into the row: same muscle (back), 105 s (the
 *      90–120 s range is kept). The row into the lat pulldown is the same
 *      muscle too and is already 105.
 *   4. A dated line is appended to the template's notes.
 *
 * No session is touched — 9/30, 10/7 and 10/14 stay as logged. The v2 draft
 * doc (`templateDrafts`) is not touched either. The template is backed up first.
 *
 *   npx jiti scripts/owner-data-2026-10-14.mts --email gabrielandresbermudez@gmail.com [--apply]
 *
 * Auth: ADC (`gcloud auth application-default login`).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import {
  type ExcludedRead,
  type TemplateExercise,
  calendarDateKey,
  sessionCall,
  toWorkoutExercise,
  toWorkoutSession,
  toWorkoutTemplate,
} from '../packages/core/src/index.ts';
import { reasonText } from '../apps/mobile/src/components/train/recommendation-text.ts';
import { en } from '../apps/mobile/src/i18n/en.ts';

const PROJECT_ID = 'fitness-tracker-gb-1775407101';
const TEMPLATE_ID = 'aliWJBD2FND6mU9foLdC';
const ROW_ID = '9x3b6rmxlxJyWWSMat3w';
const PULLUP_ID = 'GOGOcWJNC9q9aBmN3ENq';
const DAY = '2026-10-14';
const EXCLUDED: ExcludedRead = { date: DAY, reason: `context changed: position ${DAY}` };
const REST_SAME_SEC = 105;
const NOTE = `${DAY} - pull-up back to 1st, Seated Machine Row 2nd (owner-confirmed). 9/30 and 10/7 were performed pull-up first, though logged row first; 10/14 is the only session the row ran first, so it is not a read for either lift ("context changed: position ${DAY}") - the engine compares same-position sessions only. Pull-up 7 on 10/14 is not a regression and row 13/13 is not progression. Rest pull-up -> row and row -> pulldown: same muscle, 105 s (90-120 s).`;

const args = process.argv.slice(2);
const email = args[args.indexOf('--email') + 1];
const APPLY = args.includes('--apply');
if (!email || email.startsWith('--')) throw new Error('--email is required');

initializeApp({ credential: applicationDefault(), projectId: PROJECT_ID });
const db = getFirestore();
const uid = (await getAuth().getUserByEmail(email)).uid;
const userRef = db.doc(`users/${uid}`);

const [sesSnap, tplSnap, exSnap] = await Promise.all([
  userRef.collection('workoutSessions').get(),
  userRef.collection('workoutTemplates').doc(TEMPLATE_ID).get(),
  userRef.collection('exercises').get(),
]);
if (!tplSnap.exists) throw new Error(`template ${TEMPLATE_ID} not found`);
const rawTpl = tplSnap.data() as { name: string; notes?: string; exercises: (Record<string, unknown> & TemplateExercise)[] };
const ids = rawTpl.exercises.map((r) => r.exerciseId);
if (ids[0] !== ROW_ID || ids[1] !== PULLUP_ID) {
  throw new Error(`expected row then pull-up at positions 1-2, found ${rawTpl.exercises.slice(0, 2).map((r) => r.name).join(', ')}`);
}

// ── backup ──
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const dir = join(homedir(), 'ignia-backups');
mkdirSync(dir, { recursive: true });
const backup = join(dir, `owner-data-2026-10-14-${stamp}.json`);
writeFileSync(backup, JSON.stringify({ uid, template: { id: TEMPLATE_ID, ...rawTpl } }, null, 1));
console.log(`backup: ${backup}`);

// ── the new body ──
const at = new Date().toISOString();
const touch = (r: Record<string, unknown> & TemplateExercise, extra: Partial<TemplateExercise> = {}) => ({
  ...r,
  ...extra,
  excludedReads: [...(r.excludedReads ?? []).filter((x) => x.date !== DAY), EXCLUDED],
  lastModifiedAt: at,
  lastModifiedBy: 'prompt' as const,
});
const [row, pullup, ...rest] = rawTpl.exercises;
const rows = [touch(pullup, { restAfterSec: REST_SAME_SEC }), touch(row), ...rest];
const notes = rawTpl.notes?.includes(`${DAY} - pull-up back to 1st`) ? rawTpl.notes : `${rawTpl.notes ?? ''}\n${NOTE}`.trim();

// ── where 10/14 sits in the record ──
const sessions = sesSnap.docs.map((d) => toWorkoutSession(d.id, d.data()));
const completed = sessions.filter((s) => s.status === 'completed').sort((a, b) => b.date.getTime() - a.date.getTime());
const pulls = completed.filter((s) => s.templateId === TEMPLATE_ID).slice(0, 3);
console.log('\nLogged order, last three Pull Days:');
for (const s of pulls) {
  const pos = (id: string) => s.exercises.findIndex((e) => e.exerciseId === id) + 1;
  console.log(`   ${calendarDateKey(s.date)}  row #${pos(ROW_ID)} · pull-up #${pos(PULLUP_ID)}${calendarDateKey(s.date) === DAY ? '  ← not read' : ''}`);
}

// ── the engine's call, before and after ──
const catalog = exSnap.docs.map((d) => toWorkoutExercise(d.id, d.data()));
const t = (key: string, params?: Record<string, string | number>) =>
  ((en as Record<string, string>)[key] ?? key).replace(/\{(\w+)\}/g, (_, k: string) => String(params?.[k] ?? ''));
const describe = (r: TemplateExercise) => {
  const { rec, basedOn } = sessionCall(r, completed, catalog.find((c) => c.id === r.exerciseId) ?? null);
  const load = rec.load == null ? '—' : rec.load === 0 && !rec.assisted ? 'BW' : String(rec.load);
  return `${load.padStart(4)}  ${rec.action.padEnd(12)} from ${basedOn ? calendarDateKey(basedOn) : '—'}  ${reasonText(rec, 'us', t as never)}`;
};
const before = toWorkoutTemplate(TEMPLATE_ID, rawTpl).exercises;
const after = toWorkoutTemplate(TEMPLATE_ID, { ...rawTpl, exercises: rows }).exercises;
console.log('\nThe next session\'s call:');
for (const id of [PULLUP_ID, ROW_ID]) {
  const b = before.find((r) => r.exerciseId === id)!;
  const a = after.find((r) => r.exerciseId === id)!;
  console.log(`   ${a.name}\n      before: ${describe(b)}\n      after:  ${describe(a)}`);
}

console.log('\nNew order:');
after.forEach((r, i) => console.log(`   ${i + 1}. ${r.name.padEnd(24)} rest after ${r.restAfterSec ?? '—'}${r.restAfterMaxSec ? `–${r.restAfterMaxSec}` : ''} s${r.excludedReads?.length ? `  not read: ${r.excludedReads.map((x) => x.date).join(', ')}` : ''}`));
console.log(`\nNotes + ${notes === rawTpl.notes ? '(already there)' : NOTE}`);

if (!APPLY) {
  console.log('\nDry run. Re-run with --apply to write.');
  process.exit(0);
}

await tplSnap.ref.update({ exercises: JSON.parse(JSON.stringify(rows)), notes, updatedAt: FieldValue.serverTimestamp() });

// ── verify ──
const written = toWorkoutTemplate(TEMPLATE_ID, (await tplSnap.ref.get()).data() as Record<string, unknown>);
console.log('\nwritten:');
console.log(`   order: ${written.exercises.map((r) => r.name).join(' → ')}`);
for (const id of [PULLUP_ID, ROW_ID]) {
  const r = written.exercises.find((x) => x.exerciseId === id)!;
  console.log(`   ${r.name}: rest after ${r.restAfterSec}, not read ${JSON.stringify(r.excludedReads)}`);
}
