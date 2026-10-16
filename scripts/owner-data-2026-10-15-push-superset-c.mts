/**
 * The owner's 2026-10-15 Push v2 change, requested and confirmed that day:
 * Superset C becomes three members, as the owner ran it on 10/15.
 *
 *   1. Push Day (v2, `Nx1bxeRuH6bMnGgX7Trv`): Skull Crusher — the standalone
 *      row right after the lateral raise — joins Superset C as C3. The flow is
 *      then C1 Overhead DB Extension (1 cluster) → C2 DB Lateral Raise cluster
 *      1 → C3 Skull Crusher (1 cluster) → C2 cluster 2 + its drop. Switch and
 *      round rests stay 30 / 30 on the leader. One Skull Crusher row, not two.
 *   2. Skull Crusher's baseline: "context changed: position 2026-10-15", since
 *      2026-10-15 (its drop-back fields kept) — 10/15 (15 × 10/4/3) is the
 *      first read in the new position and 10/9, which came straight after the
 *      extension, is never compared.
 *   3. A dated line in the template's notes records the 10/15 order (a
 *      session has no notes field; `nextNotes` would carry it into the next
 *      workout).
 *   4. The 10/15 Push session: its Skull Crusher is tagged C / 3 with the
 *      group's rests, so history and the export (`supersetBlock`,
 *      `supersetOrder`) show what was performed.
 *
 * Both documents are backed up first. Dry run unless `--apply`; re-runs are no-ops.
 *
 *   npx jiti scripts/owner-data-2026-10-15-push-superset-c.mts --email gabrielandresbermudez@gmail.com [--apply]
 *
 * Auth: ADC (`gcloud auth application-default login`).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import {
  type TemplateExercise,
  calendarDateKey,
  estimateTemplateDuration,
  normalizeSupersets,
  restAfterSetInFlow,
  sameMuscleVerdict,
  sessionCall,
  supersetFlow,
  supersetWarnings,
  templateRestFor,
  toWorkoutExercise,
  toWorkoutSession,
  toWorkoutTemplate,
} from '../packages/core/src/index.ts';

const PROJECT_ID = 'fitness-tracker-gb-1775407101';
const TEMPLATE_ID = 'Nx1bxeRuH6bMnGgX7Trv';
const SESSION_ID = '4DEYM7NxuDVqMnrMFr8t'; // 2026-10-15 Push Day
const OHE = 'AAHHWXTA7UtbNWZbcf7z';
const LAT = 'BGyAEJU6i5nN6AjXRU1g';
const SKULL = 'EyDTWnfO4WrbYDbDkxrk';
const DAY = '2026-10-15';
const REASON = `context changed: position ${DAY}`;
const NOTE = `${DAY} - Superset C is three members (owner-confirmed): Skull Crusher joins as C3. Order: OHE → LAT c1 → SKULL → LAT c2 (+ drop on the last cluster). Switch 30 s, round 30 s. C1 and C3 share triceps but are never back-to-back (a lateral cluster between them). Skull Crusher baseline ${DAY} (15 × 10/4/3); 10/9, straight after the extension, is not compared.`;

const args = process.argv.slice(2);
const email = args[args.indexOf('--email') + 1];
const APPLY = args.includes('--apply');
if (!email || email.startsWith('--')) throw new Error('--email is required');

initializeApp({ credential: applicationDefault(), projectId: PROJECT_ID });
const db = getFirestore();
const uid = (await getAuth().getUserByEmail(email)).uid;
const user = db.doc(`users/${uid}`);

const [tplSnap, sesSnap, exSnap, allSessions] = await Promise.all([
  user.collection('workoutTemplates').doc(TEMPLATE_ID).get(),
  user.collection('workoutSessions').doc(SESSION_ID).get(),
  user.collection('exercises').get(),
  user.collection('workoutSessions').get(),
]);
if (!tplSnap.exists || !sesSnap.exists) throw new Error('template or session not found');
type RawRow = Record<string, unknown> & TemplateExercise;
const rawTpl = tplSnap.data() as { name: string; notes?: string; exercises: RawRow[] } & Record<string, unknown>;
const rawSes = sesSnap.data()!;

// ── backup ──
const conv = (v: unknown): unknown => {
  if (v instanceof Timestamp) return v.toDate().toISOString();
  if (Array.isArray(v)) return v.map(conv);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, conv(x)]));
  return v;
};
const stamp = new Date().toISOString();
const dir = join(homedir(), 'ignia-backups');
mkdirSync(dir, { recursive: true });
const backup = join(dir, `owner-data-2026-10-15-push-superset-c-${stamp.replace(/[:.]/g, '-')}.json`);
writeFileSync(backup, JSON.stringify(conv({ uid, template: { id: TEMPLATE_ID, ...rawTpl }, session: { id: SESSION_ID, ...rawSes } }), null, 1));
console.log(`backup: ${backup}`);

// ── 1-3: the template ──
const rows = rawTpl.exercises;
const at = (id: string) => rows.findIndex((r) => r.exerciseId === id);
const [iO, iL, iS] = [at(OHE), at(LAT), at(SKULL)];
if (iO < 0 || iL !== iO + 1 || iS !== iL + 1) throw new Error(`expected OHE, lateral, skull in a row; found at ${iO}, ${iL}, ${iS}`);
if (rows.filter((r) => r.exerciseId === SKULL).length !== 1) throw new Error('more than one Skull Crusher row');
const o = rows[iO];
if (o.supersetGroup !== 'C' || o.pairPosition !== 1 || o.transitionRestSec !== 30 || o.roundRestSec !== 30) throw new Error(`C1 is not OHE with 30/30: ${JSON.stringify({ g: o.supersetGroup, p: o.pairPosition, t: o.transitionRestSec, r: o.roundRestSec })}`);
if (rows[iL].supersetGroup !== 'C' || rows[iL].pairPosition !== 2) throw new Error('C2 is not the lateral raise');
const sk = rows[iS];
if (sk.supersetGroup != null && !(sk.supersetGroup === 'C' && sk.pairPosition === 3)) throw new Error(`Skull Crusher already in ${sk.supersetGroup}${sk.pairPosition}`);
if (sk.baseline && sk.baseline.since !== DAY) throw new Error(`Skull Crusher baseline is ${JSON.stringify(sk.baseline)} — refusing`);

const tplDone = sk.supersetGroup === 'C' && sk.baseline?.reason === REASON;
const nextRows = rows.map((r, i): RawRow => i !== iS || tplDone ? r : ({
  ...r,
  supersetGroup: 'C',
  pairPosition: 3,
  baseline: { ...(r.baseline ?? {}), since: DAY, reason: REASON },
  lastModifiedAt: stamp,
  lastModifiedBy: 'prompt',
}));
const canonical = normalizeSupersets(nextRows);
if (canonical.some((r, i) => r !== nextRows[i])) throw new Error('the new rows are not canonical — refusing');
const notes = rawTpl.notes?.includes(`${DAY} - Superset C is three members`) ? rawTpl.notes : `${rawTpl.notes ?? ''}\n${NOTE}`.trim();

// ── 4: the 10/15 session ──
const sesEx = structuredClone(rawSes.exercises) as (Record<string, unknown> & { exerciseId: string; name: string; supersetGroup?: string; pairPosition?: number })[];
const sO = sesEx.find((e) => e.exerciseId === OHE);
const sL = sesEx.find((e) => e.exerciseId === LAT);
const sS = sesEx.find((e) => e.exerciseId === SKULL);
if (!sO || !sL || !sS || sO.supersetGroup !== 'C' || sO.pairPosition !== 1 || sL.supersetGroup !== 'C' || sL.pairPosition !== 2) throw new Error('10/15 session C1/C2 not as expected');
const sesDone = sS.supersetGroup === 'C' && sS.pairPosition === 3;
if (sS.supersetGroup != null && !sesDone) throw new Error(`10/15 Skull Crusher already in ${sS.supersetGroup}`);
Object.assign(sS, { supersetGroup: 'C', pairPosition: 3, transitionRestSec: 30, roundRestSec: 30 });

// ── report ──
const catalog = exSnap.docs.map((d) => toWorkoutExercise(d.id, d.data()));
const musclesOf = (id: string) => catalog.find((c) => c.id === id)?.muscles;
const before = toWorkoutTemplate(TEMPLATE_ID, rawTpl);
const after = toWorkoutTemplate(TEMPLATE_ID, { ...rawTpl, exercises: nextRows, notes });
const flowRows = after.exercises.map((e) => ({ ...e, sets: e.plannedSets }));
const restFor = templateRestFor(after);
const cSteps = supersetFlow(flowRows).filter((s) => s.group === 'C');
console.log('\nSuperset C, as performed:');
cSteps.forEach((s, k) => {
  const r = restAfterSetInFlow(flowRows, s.exerciseIndex, s.setIndices[s.setIndices.length - 1], restFor);
  const drop = s.setIndices.some((i) => flowRows[s.exerciseIndex].sets[i].kind === 'drop') ? ' + drop' : '';
  console.log(`   R${s.unit + 1}  ${s.label} ${after.exercises[s.exerciseIndex].name} cluster ${s.unit + 1}${drop}${k < cSteps.length - 1 ? `   → ${r.kind} ${r.seconds} s` : ''}`);
});
for (const w of supersetWarnings(flowRows, (id) => musclesOf(id) ?? [], undefined, restFor).filter((x) => x.group === 'C')) {
  for (const p of w.pairs) {
    const sp = p.spacing;
    const v = p.judgement.kind === 'same-muscle' ? ` → ${sameMuscleVerdict(sp)}` : '';
    console.log(`   ${after.exercises[p.a].name} + ${after.exercises[p.b].name}: ${p.judgement.kind}${p.judgement.muscle ? ` (${p.judgement.muscle})` : ''}${sp && !sp.adjacent ? ` — separated by ${sp.between.map((x) => after.exercises[x].name).join(', ')}, ~${sp.gapSec} s` : ''}${v}`);
  }
}
const eb = estimateTemplateDuration(before, musclesOf);
const ea = estimateTemplateDuration(after, musclesOf);
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
console.log(`\nPush estimate: ${eb.minutes} → ${ea.minutes} min`);
console.log(`   clusters ${mmss(eb.clustersSec)} → ${mmss(ea.clustersSec)} · rest ${mmss(eb.restSec)} → ${mmss(ea.restSec)} · warm-up ${mmss(eb.warmupSec)} · cardio ${mmss(eb.cardioSec)}`);
console.log(`   total ${mmss(eb.clustersSec + eb.restSec + eb.warmupSec + eb.cardioSec)} → ${mmss(ea.clustersSec + ea.restSec + ea.warmupSec + ea.cardioSec)}`);

const sessions = allSessions.docs.map((d) => toWorkoutSession(d.id, d.id === SESSION_ID ? { ...d.data(), exercises: sesEx } : d.data()));
const completed = sessions.filter((s) => s.status === 'completed').sort((a, b) => b.date.getTime() - a.date.getTime());
const call = (r: TemplateExercise) => {
  const { rec, basedOn } = sessionCall(r, completed, catalog.find((c) => c.id === r.exerciseId) ?? null);
  return `${rec.load ?? '—'} ${rec.action} from ${basedOn ? calendarDateKey(basedOn) : '—'}`;
};
console.log(`\nSkull Crusher next call: before ${call(before.exercises[iS])} · after ${call(after.exercises[iS])}`);
console.log(`   baseline: ${JSON.stringify(after.exercises[iS].baseline)}`);
console.log(`\nTemplate: ${tplDone ? 'already done (skip)' : 'Skull Crusher → C3, baseline reason dated'}; notes ${notes === rawTpl.notes ? 'already there' : '+ dated line'}`);
console.log(`Session 10/15: ${sesDone ? 'Skull Crusher already C3 (skip)' : 'Skull Crusher → C / 3, rests 30 / 30'}`);

if (!APPLY) { console.log('\nDry run. Re-run with --apply to write.'); process.exit(0); }

const batch = db.batch();
if (!tplDone || notes !== rawTpl.notes) batch.update(tplSnap.ref, { exercises: JSON.parse(JSON.stringify(nextRows)), notes, updatedAt: Timestamp.now() });
if (!sesDone) batch.update(sesSnap.ref, { exercises: sesEx, updatedAt: Timestamp.now() });
await batch.commit();

// ── verify ──
const wt = toWorkoutTemplate(TEMPLATE_ID, (await tplSnap.ref.get()).data()!);
const ws = (await sesSnap.ref.get()).data()!;
const c = wt.exercises.filter((r) => r.supersetGroup === 'C').map((r) => `${r.supersetGroup}${r.pairPosition} ${r.name}`);
console.log(`\nwritten: template C = ${c.join(', ')}; ${wt.exercises.length} rows, ${wt.exercises.filter((r) => r.exerciseId === SKULL).length} Skull Crusher`);
console.log(`         session Skull Crusher = ${JSON.stringify((ws.exercises as Record<string, unknown>[]).filter((e) => e.exerciseId === SKULL).map((e) => ({ g: e.supersetGroup, p: e.pairPosition, t: e.transitionRestSec, r: e.roundRestSec })))}`);
console.log(`         estimate ${estimateTemplateDuration(wt, musclesOf).minutes} min`);
