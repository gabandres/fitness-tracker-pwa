/**
 * Owner data, 2026-10-20 — fixes from the 10/20 18:03 export. DRY RUN unless
 * `--apply`; re-runs are no-ops; everything it reads is backed up to
 * ~/ignia-backups first. Every write is checked against the value read
 * (drift → refuse).
 *
 *  1. Apple Watch copies of Zone 2 → MERGED into the logged block (core
 *     `mergeIntoZone2`: the Watch's duration; HR / distance / kcal / start only
 *     where the manual block has none; the user's label, band, RPE and notes
 *     kept) and their `sourceId` recorded in `dismissedSourceIds`:
 *       10/14 Pull Day `Vw0iaQ5ClAVHx7Dymxo8` — 1,048 s walk `24D8F0AB…`
 *         (deleted on 10/15 and re-added 15:34Z by an older build);
 *       10/20 Pull Day `hvf1Vbiaz2LddS66PbZV` — 1,215 s walk `4245078C…`.
 *  2. Account tombstones (`healthTombstones`) for every Watch workout already
 *     deleted or merged — `24D8F0AB…`, `4FF99EBD…` (10/19), `4245078C…` — so
 *     the server keeps them out from any build (`enforceHealthTombstones`).
 *  3. 10/15 Watch walk `7465A221…` (2026-10-16T00:33:53Z, 2,036 s = 20:33
 *     local) → out of Push Day `4DEYM7NxuDVqMnrMFr8t` into its own completed
 *     session, no template, labelled "Outdoor Walk". No HR: the import read
 *     none for it.
 *  4. dailyWeights/2026-10-18 = { weight: 152.8 } (absent; the doc holds no
 *     time or source — rules allow `weight` only).
 *  5. 10/20 "Grapes" `oGjEyTSsLtbBrEAOh1Ny` protein → 0.
 *  6. Pull Day / Leg Day superset block "A" → "D" (label only).
 *  9. Pull Day loads from 10/20: Seated Machine Row 100 → 110, Wide-grip lat
 *     pulldown 90 → 80, Rear delt DB flye 17.5 → 20 (the owner has 15 and 20
 *     dumbbells, no 17.5) — each a `loadLog` entry by `prompt`, so
 *     `honourLifterLoad` holds the owner's load. Logged RIRs are not touched.
 *
 *   TZ=America/Puerto_Rico npx jiti scripts/owner-data-2026-10-20-export-fixes.mts --email gabrielandresbermudez@gmail.com [--apply]
 *
 * Auth: ADC (`gcloud auth application-default login`).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, Timestamp, FieldValue } from 'firebase-admin/firestore';
import { type DocCodec, mergeIntoZone2, toSessionDoc, zone2Check } from '../packages/core/src/index.ts';

const PROJECT_ID = 'fitness-tracker-gb-1775407101';
const PULL = 'aliWJBD2FND6mU9foLdC';
const LEG = 'quxwARQlCnItzpLJgcr4';
const S1014 = 'Vw0iaQ5ClAVHx7Dymxo8';
const S1015 = '4DEYM7NxuDVqMnrMFr8t';
const S1020 = 'hvf1Vbiaz2LddS66PbZV';
const W1014 = '24D8F0AB-583D-46D3-8E78-C735547D0358';
const W1015 = '7465A221-7E99-45EF-B56F-0B3A7F5AF147';
const W1019 = '4FF99EBD-483E-49DB-9DD2-3F526E3A36B0';
const W1020 = '4245078C-E1A0-4313-803C-490BC4CE181F';
const GRAPES = 'oGjEyTSsLtbBrEAOh1Ny';
const WEIGHT_DAY = '2026-10-18';
const WEIGHT_LB = 152.8;
const LOADS: Record<string, { from: number; to: number }> = {
  '9x3b6rmxlxJyWWSMat3w': { from: 100, to: 110 }, // Seated Machine Row — 14 > 12 at 100
  oxOuktVhb6Ghgg7hGkCk: { from: 90, to: 80 }, // Wide-grip lat pulldown — 8 at 90
  v2uqmVt1K4fJd0d6t4De: { from: 17.5, to: 20 }, // Rear delt DB flye — no 17.5 dumbbells
};
const LOAD_REASON = 'From the 10/20 Pull Day (owner, 2026-10-20)';

if (Intl.DateTimeFormat().resolvedOptions().timeZone !== 'America/Puerto_Rico') {
  console.error('Run with TZ=America/Puerto_Rico.');
  process.exit(2);
}
const argv = process.argv.slice(2);
const email = argv[argv.indexOf('--email') + 1];
const apply = argv.includes('--apply');
if (!email || email.startsWith('--')) { console.error('--email is required'); process.exit(2); }

initializeApp({ credential: applicationDefault(), projectId: PROJECT_ID });
const db = getFirestore();
const uid = (await getAuth().getUserByEmail(email)).uid;
const user = db.collection('users').doc(uid);
console.log(`${apply ? '' : '[dry run] '}uid ${uid}`);

type Doc = Record<string, any>;
const sessRef = (id: string) => user.collection('workoutSessions').doc(id);
const [s14, s15, s20, pull, leg, weight, grapes, tombs] = await Promise.all([
  sessRef(S1014).get(), sessRef(S1015).get(), sessRef(S1020).get(),
  user.collection('workoutTemplates').doc(PULL).get(), user.collection('workoutTemplates').doc(LEG).get(),
  user.collection('dailyWeights').doc(WEIGHT_DAY).get(), user.collection('dailyLogs').doc(GRAPES).get(),
  user.collection('healthTombstones').get(),
]);
// Sessions already holding the 10/15 walk on their own (a re-run).
const standalone = (await user.collection('workoutSessions')
  .where('timestamp', '>=', Timestamp.fromDate(new Date('2026-10-16T00:33:53Z')))
  .where('timestamp', '<', Timestamp.fromDate(new Date('2026-10-16T00:33:54Z'))).get()).docs
  .filter((d) => (d.get('cardio') ?? []).some((b: Doc) => b.sourceId === W1015));

const conv = (v: unknown): unknown => {
  if (v instanceof Timestamp) return v.toDate().toISOString();
  if (Array.isArray(v)) return v.map(conv);
  if (v && typeof v === 'object' && !('firestore' in (v as object))) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, conv(x)]));
  return v;
};
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const dir = join(homedir(), 'ignia-backups');
mkdirSync(dir, { recursive: true });
const backup = join(dir, `owner-data-2026-10-20-export-fixes-${stamp}.json`);
writeFileSync(backup, JSON.stringify(conv({
  uid,
  sessions: { [S1014]: s14.data() ?? null, [S1015]: s15.data() ?? null, [S1020]: s20.data() ?? null },
  standalone1015: standalone.map((d) => ({ id: d.id, ...d.data() })),
  templates: { [PULL]: pull.data() ?? null, [LEG]: leg.data() ?? null },
  dailyWeight1018: weight.exists ? weight.data() : null,
  grapes: grapes.data() ?? null,
  healthTombstones: tombs.docs.map((d) => ({ id: d.id, ...d.data() })),
}), null, 1));
console.log(`backup: ${backup}`);

const refusals: string[] = [];
const plan: string[] = [];
const batch = db.batch();
let writes = 0;
const now = new Date();
const toDate = (v: unknown) => (v instanceof Timestamp ? v.toDate() : v instanceof Date ? v : undefined);
const fmt = (b: Doc) => `${b.label ?? b.modality} ${b.durationSec}s HR ${b.avgHr ?? '–'} RPE ${b.rpe ?? '–'}${b.sourceId ? ` [${String(b.sourceId).slice(0, 8)}]` : ''}`;

// ── 1. Merge the Watch copy into Zone 2 ──
for (const [snap, walkId, expectDur] of [[s14, W1014, 1048], [s20, W1020, 1215]] as const) {
  const d = snap.data() as Doc | undefined;
  if (!d) { refusals.push(`${snap.id} missing`); continue; }
  const cardio: Doc[] = d.cardio ?? [];
  const walk = cardio.find((b) => b.sourceId === walkId);
  const zi = cardio.findIndex((b) => b.label === 'Zone 2' && b.source === 'manual' && !b.sourceId);
  const dismissed: string[] = d.dismissedSourceIds ?? [];
  if (!walk) {
    if (zi >= 0 && cardio[zi].durationSec === expectDur && dismissed.includes(walkId)) { plan.push(`1. ${snap.id}: already merged (${fmt(cardio[zi])})`); continue; }
    refusals.push(`${snap.id}: watch walk ${walkId} not found and not merged`); continue;
  }
  if (walk.durationSec !== expectDur || zi < 0) { refusals.push(`${snap.id}: unexpected cardio ${cardio.map(fmt).join(' | ')}`); continue; }
  const manual = cardio[zi];
  if (Math.abs(walk.durationSec - manual.durationSec) > 0.25 * manual.durationSec) { refusals.push(`${snap.id}: outside ±25 %`); continue; }
  const merged = mergeIntoZone2(manual as never, walk as never) as Doc;
  const next = cardio.filter((b) => b !== walk).map((b) => (b === manual ? merged : b));
  plan.push(`1. ${snap.id}: ${fmt(manual)} + ${fmt(walk)} → ${fmt(merged)}; in band ${zone2Check({ ...merged } as never).inBand}`);
  batch.update(snap.ref, {
    cardio: next,
    dismissedSourceIds: dismissed.includes(walkId) ? dismissed : [...dismissed, walkId],
    updatedAt: Timestamp.fromDate(now),
  });
  writes++;
}

// ── 2. Account tombstones ──
const have = new Set(tombs.docs.map((d) => d.get('sourceId') ?? decodeURIComponent(d.id)));
for (const [sid, sessionId] of [[W1014, S1014], [W1019, 'VCDFNBcanHZAQihSSic5'], [W1020, S1020]] as const) {
  if (have.has(sid)) { plan.push(`2. tombstone ${sid.slice(0, 8)} exists`); continue; }
  plan.push(`2. tombstone ${sid.slice(0, 8)} (session ${sessionId})`);
  batch.set(user.collection('healthTombstones').doc(encodeURIComponent(sid)), {
    sourceId: sid, at: FieldValue.serverTimestamp(), sessionId, reason: 'owner-data-2026-10-20',
  });
  writes++;
}

// ── 3. The 10/15 evening walk → its own session ──
{
  const d = s15.data() as Doc | undefined;
  const cardio: Doc[] = d?.cardio ?? [];
  const walk = cardio.find((b) => b.sourceId === W1015);
  if (!d) refusals.push(`${S1015} missing`);
  else if (!walk) {
    if (standalone.length === 1) plan.push(`3. already moved → session ${standalone[0].id}`);
    else refusals.push(`3. 10/15 walk neither on Push Day nor standalone (${standalone.length})`);
  } else if (standalone.length) refusals.push('3. walk is on Push Day AND standalone — decide by hand');
  else if (walk.durationSec !== 2036) refusals.push(`3. unexpected walk ${fmt(walk)}`);
  else {
    const block = { ...walk, startedAt: toDate(walk.startedAt), label: 'Outdoor Walk' };
    const CODEC: DocCodec<Timestamp> = { timestamp: (x) => Timestamp.fromDate(x), remove: () => FieldValue.delete() };
    const doc = toSessionDoc({ status: 'completed', date: block.startedAt!, exercises: [], cardio: [block as never] }, CODEC, now) as Doc;
    const ref = user.collection('workoutSessions').doc();
    plan.push(`3. ${S1015} Push Day: remove ${fmt(walk)}; new session ${ref.id} @ ${block.startedAt!.toISOString()} "${block.label}", no template`);
    batch.update(s15.ref, { cardio: cardio.filter((b) => b !== walk), updatedAt: Timestamp.fromDate(now) });
    const prune = (v: unknown): unknown => Array.isArray(v) ? v.map(prune)
      : v && typeof v === 'object' && !(v instanceof Timestamp) && !('isEqual' in (v as object))
        ? Object.fromEntries(Object.entries(v).filter(([, x]) => x !== undefined).map(([k, x]) => [k, prune(x)]))
        : v;
    batch.set(ref, prune(doc) as Doc);
    writes += 2;
  }
}

// ── 4. 10/18 weight ──
if (weight.exists) {
  if (weight.get('weight') === WEIGHT_LB) plan.push(`4. weight ${WEIGHT_DAY} already ${WEIGHT_LB}`);
  else refusals.push(`4. weight ${WEIGHT_DAY} already ${JSON.stringify(weight.data())} — not overwriting`);
} else {
  plan.push(`4. weight ${WEIGHT_DAY} = ${WEIGHT_LB}`);
  batch.create(weight.ref, { weight: WEIGHT_LB });
  writes++;
}

// ── 5. Grapes protein ──
{
  const g = grapes.data() as Doc | undefined;
  if (!g || g.mealLabel !== 'Grapes' || g.calories !== 40) refusals.push(`5. Grapes row changed: ${JSON.stringify(g)}`);
  else if (g.protein === 0) plan.push('5. Grapes protein already 0');
  else if (g.protein != null) refusals.push(`5. Grapes protein is ${g.protein}, not blank`);
  else { plan.push('5. Grapes protein — → 0'); batch.update(grapes.ref, { protein: 0 }); writes++; }
}

// ── 6 + 9. Templates: superset A → D; Pull Day loads ──
for (const [snap, name] of [[pull, 'Pull Day'], [leg, 'Leg Day']] as const) {
  const t = snap.data() as Doc | undefined;
  if (!t || t.name !== name) { refusals.push(`${snap.id} is not ${name}`); continue; }
  const groups = new Set((t.exercises as Doc[]).map((r) => r.supersetGroup).filter(Boolean));
  if (groups.size > 1 || [...groups].some((g) => g !== 'A' && g !== 'D')) { refusals.push(`${name}: superset groups ${[...groups].join(',')} — expected one block A`); continue; }
  const changes: string[] = [];
  const rows = (t.exercises as Doc[]).map((r) => {
    let row = r;
    if (r.supersetGroup === 'A') { row = { ...row, supersetGroup: 'D' }; changes.push(`${r.name} A→D`); }
    const l = LOADS[r.exerciseId];
    if (l && r.targetLoad !== l.to) {
      if (r.targetLoad !== l.from) { refusals.push(`${name} ${r.name}: load ${r.targetLoad}, expected ${l.from}`); return r; }
      row = {
        ...row,
        targetLoad: l.to,
        loadLog: [...(r.loadLog ?? []), { at: now.toISOString(), from: l.from, to: l.to, by: 'prompt', reason: LOAD_REASON }],
      };
      changes.push(`${r.name} ${l.from}→${l.to}`);
    }
    return row === r ? r : { ...row, lastModifiedAt: now.toISOString(), lastModifiedBy: 'prompt' };
  });
  if (!changes.length) { plan.push(`6/9. ${name}: unchanged`); continue; }
  plan.push(`6/9. ${name}: ${changes.join('; ')}`);
  batch.update(snap.ref, { exercises: rows, updatedAt: Timestamp.fromDate(now) });
  writes++;
}

console.log('\nPlan:');
for (const p of plan) console.log(`  ${p}`);
for (const r of refusals) console.log(`REFUSE  ${r}`);
if (refusals.length) { console.log('\nAborted: nothing written.'); process.exit(1); }
if (!apply) { console.log(`\n${writes} write(s) — dry run, re-run with --apply.`); process.exit(0); }
if (writes) await batch.commit();
console.log(`\nApplied ${writes} write(s).`);
