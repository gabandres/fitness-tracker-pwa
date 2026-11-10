/**
 * Owner data, 2026-11-10 (America/La_Paz): fix the 11/10 "Haven 1 — Legs/
 * Push/Pull (simplified)" session and set up the next Haven session.
 *
 *   SESSION   YUypGlZ4zJrW7h479ej3 (started 2026-11-10 07:02 La Paz)
 *             durationMin 178 → 60 (timer left running — the user forgot to
 *             stop it), `durationNote` "auto-corrected (user-confirmed) … done
 *             11/10 (planned 11/9)".
 *             `sessionNote` "machines busy — supersets done out of order except
 *             the final block; all blocks completed" — a note, not a deviation
 *             (nothing reads order; every block's sets are logged).
 *             + Cross-body Hammer Curl (DB): 1 straight set, 10 kg per hand ×
 *             10, RIR 0, "extra — time to spare". Appended as a straight row
 *             (no superset), `awayGym` Haven, kg. Existing sets are untouched
 *             (no `loggedAt` is back-filled).
 *   CATALOG   + `cross-body-hammer-curl-db` "Cross-body Hammer Curl (DB)" if no
 *             exercise of that name exists: biceps + forearms (core
 *             `creditsFor` → biceps 1.0 direct), failure standard, kg at Haven.
 *             NOT added to any template.
 *   HAVEN 2   (`travel-haven-2`, next on 11/11)
 *             · every compound row whose lift is `rir1` gets a non-blocking cue
 *               "Note: RIR 1 — last 3 sessions logged RIR 0 on compounds";
 *             · DB Lateral Raise starts at 7.5 kg (cleaner reps at 10–15) —
 *               `targetLoad` + `loadLog`, cue rewritten. Same on Haven 1.
 *
 * DRY RUN unless `--apply`; backs up first; re-runs plan nothing.
 *
 *   TZ=America/La_Paz npx jiti scripts/owner-data-2026-11-10-haven-1-fix.mts [--apply]
 *
 * Auth: ADC (`gcloud auth application-default login`).
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue, getFirestore, Timestamp } from 'firebase-admin/firestore';
import {
  clusterCount,
  creditsFor,
  hardSetCount,
  inferCategory,
  kgToLb,
  lbToKg,
  sessionCall,
  toWorkoutExercise,
  toWorkoutSession,
  toWorkoutTemplate,
  hardSetsBetween,
  volumeBetween,
} from '../packages/core/src/index.ts';
import type { Exercise, SessionExercise, TemplateExercise } from '../packages/core/src/workout.ts';

const PROJECT_ID = 'fitness-tracker-gb-1775407101';
const OWNER = 'gabrielandresbermudez@gmail.com';
const APPLY = process.argv.includes('--apply');
const SESSION_ID = 'YUypGlZ4zJrW7h479ej3';
const GYM = 'Haven Gym';
const H1_ID = 'travel-haven-1';
const H2_ID = 'travel-haven-2';
const LATERAL = 'haven-db-lateral-raise';
const HAMMER_ID = 'cross-body-hammer-curl-db';
const HAMMER_NAME = 'Cross-body Hammer Curl (DB)';
const NEW_MIN = 60;
const DURATION_NOTE = 'auto-corrected (user-confirmed): 178 → 60 min (timer left running; the user forgot to stop it) · done 11/10 (planned 11/9)';
const SESSION_NOTE = 'machines busy — supersets done out of order except the final block; all blocks completed';
const RIR_CUE = 'Note: RIR 1 — last 3 sessions logged RIR 0 on compounds';
const LATERAL_KG = 7.5;
const kg = (v: number) => +kgToLb(v).toFixed(2);

initializeApp({ credential: applicationDefault(), projectId: PROJECT_ID });
const db = getFirestore();
const uid = (await getAuth().getUserByEmail(OWNER)).uid;
const user = db.doc(`users/${uid}`);
const now = new Date();
const stamp = now.toISOString();
const say = console.log;
say(`${APPLY ? 'APPLY' : 'DRY RUN'} — ${now.toString()}\n`);

const [sesDoc, exSnap, h1Doc, h2Doc, recentSnap] = await Promise.all([
  user.collection('workoutSessions').doc(SESSION_ID).get(),
  user.collection('exercises').get(),
  user.collection('workoutTemplates').doc(H1_ID).get(),
  user.collection('workoutTemplates').doc(H2_ID).get(),
  user.collection('workoutSessions').orderBy('timestamp', 'desc').limit(400).get(),
]);
if (!sesDoc.exists || sesDoc.get('templateId') !== H1_ID) throw new Error(`${SESSION_ID} is not the Haven 1 session`);
if (!h1Doc.exists || !h2Doc.exists) throw new Error('Haven templates missing');
const raw = sesDoc.data()!;
const catalog: Exercise[] = exSnap.docs.map((d) => toWorkoutExercise(d.id, d.data()));
const catOf = (id: string) => catalog.find((c) => c.id === id);

// ── catalog ──
const sameName = exSnap.docs.find((d) => String(d.get('name')).trim().toLowerCase() === HAMMER_NAME.toLowerCase());
const hammerId = sameName?.id ?? HAMMER_ID;
const hammerCreate = sameName ? null : {
  name: HAMMER_NAME,
  muscles: ['biceps', 'forearms'],
  defaultCues: ['Brachialis/brachioradialis emphasis.', 'Curl across the body toward the opposite shoulder; neutral grip.'],
  logStyle: 'weight-reps',
  effortStandard: 'failure',
  unitByGym: { [GYM]: 'kg' },
  createdAt: Timestamp.fromDate(now),
};
const hammerCat: Exercise = sameName ? catOf(sameName.id)! : toWorkoutExercise(HAMMER_ID, hammerCreate!);

// ── session ──
const exercises = (raw.exercises ?? []) as SessionExercise[];
const hasHammer = exercises.some((e) => e.exerciseId === hammerId);
const hammerRow: SessionExercise = {
  exerciseId: hammerId,
  name: HAMMER_NAME,
  cues: ['Note: extra — time to spare', 'Counts as biceps direct (brachialis/brachioradialis emphasis).'],
  logStyle: 'weight-reps',
  loadUnit: 'kg',
  awayGym: GYM,
  sets: [{ kind: 'working', weight: kg(10), reps: 10, rir: 0, done: true, unit: 'kg' }],
};
const sessionPatch: Record<string, unknown> = {};
if (raw.durationMin !== NEW_MIN) sessionPatch.durationMin = NEW_MIN;
if (raw.durationNote !== DURATION_NOTE) sessionPatch.durationNote = DURATION_NOTE;
if (raw.sessionNote !== SESSION_NOTE) sessionPatch.sessionNote = SESSION_NOTE;
if (!hasHammer) sessionPatch.exercises = [...exercises, hammerRow];

// ── templates ──
type Row = TemplateExercise & Record<string, unknown>;
const isCompound = (id: string) => {
  const c = catOf(id);
  return c ? (c.category ?? inferCategory(c.name)) === 'compound' : false;
};
function editTemplate(doc: FirebaseFirestore.DocumentSnapshot, withRirCue: boolean) {
  const rows = (doc.get('exercises') as Row[]).map((r) => ({ ...r, cues: [...(r.cues ?? [])] }));
  const changes: string[] = [];
  for (const r of rows) {
    const c = catOf(r.exerciseId);
    // `rir1` is the compound-with-a-restriction standard (pull-up reads as
    // 'bodyweight' by category, but it is a compound here).
    if (withRirCue && c?.effortStandard === 'rir1' && !r.cues.includes(RIR_CUE)) {
      r.cues.unshift(RIR_CUE);
      r.lastModifiedAt = stamp;
      r.lastModifiedBy = 'prompt';
      changes.push(`${r.name}: + RIR cue`);
    }
    if (r.exerciseId === LATERAL && r.targetLoad !== kg(LATERAL_KG)) {
      const from = r.targetLoad;
      r.targetLoad = kg(LATERAL_KG);
      r.cues = r.cues.map((x) => (/^(Start |No Haven history)/.test(x)
        ? `Start ${LATERAL_KG} kg — 11/10: 10 kg × 9 on the first activation, then 7.5 kg; cleaner reps at 10–15.`
        : x));
      r.loadLog = [...((r.loadLog as unknown[]) ?? []), { at: stamp, to: kg(LATERAL_KG), ...(from != null ? { from } : {}), by: 'prompt', reason: `next start ${LATERAL_KG} kg — 11/10 activation 10 kg × 9, minis/cluster 2 at 7.5, drop 5 × 10 (owner, 2026-11-10)` }];
      r.lastModifiedAt = stamp;
      r.lastModifiedBy = 'prompt';
      changes.push(`${r.name}: targetLoad ${from != null ? `${+lbToKg(from).toFixed(1)} kg` : 'none'} → ${LATERAL_KG} kg`);
    }
  }
  return { rows, changes };
}
const h1 = editTemplate(h1Doc, false);
const h2 = editTemplate(h2Doc, true);

// ── report ──
const kgOf = (lb?: number) => (lb == null ? '—' : `${+lbToKg(lb).toFixed(1)}`);
const after = toWorkoutSession(SESSION_ID, { ...raw, ...sessionPatch });
say(`Session ${SESSION_ID} · ${after.templateName} · ${after.date.toISOString()}`);
say(`  durationMin ${raw.durationMin} → ${after.durationMin} · ${after.durationNote}`);
say(`  sessionNote: ${after.sessionNote}`);
for (const e of after.exercises) {
  const groups = new Map<string, string[]>();
  for (const s of e.sets) {
    const key = s.kind === 'drop' ? 'drop' : s.kind === 'working' ? 'straight' : `c${s.group}`;
    groups.set(key, [...(groups.get(key) ?? []), `${s.kind === 'activation' ? 'A ' : s.kind === 'mini' ? 'm ' : ''}${kgOf(s.weight)}×${s.reps}${s.rir != null ? `@${s.rir}` : ''}`]);
  }
  say(`  ${(e.supersetGroup ? `${e.supersetGroup}${e.pairPosition}` : '—').padEnd(3)} ${e.name.padEnd(36)} ${[...groups].map(([k, v]) => `${k}: ${v.join(' ')}`).join(' | ')}`);
}

say(`\nCatalog: ${sameName ? `"${HAMMER_NAME}" exists (${sameName.id})` : `create ${HAMMER_ID} "${HAMMER_NAME}"`} · credits ${creditsFor(hammerCat.name, hammerCat.muscles).map((x) => `${x.muscle} ${x.weight}`).join(', ')}`);

for (const [name, t, doc] of [['Haven 1', h1, h1Doc], ['Haven 2', h2, h2Doc]] as const) {
  say(`\n${name}: ${t.changes.length ? t.changes.join('; ') : 'no change'}`);
  if (name === 'Haven 2') {
    for (const r of t.rows) say(`  ${r.name.padEnd(36)} ${(catOf(r.exerciseId)?.effortStandard ?? 'failure').padEnd(8)} ${isCompound(r.exerciseId) ? 'compound' : ''}`);
    // What the app will open with, against history that includes 11/10.
    const sessions = recentSnap.docs.map((d) => (d.id === SESSION_ID ? after : toWorkoutSession(d.id, d.data()))).filter((s) => s.status === 'completed');
    const tpl = toWorkoutTemplate(H2_ID, { ...doc.data(), exercises: t.rows });
    const lat = tpl.exercises.find((r) => r.exerciseId === LATERAL)!;
    const { rec } = sessionCall(lat, sessions, catOf(LATERAL)!);
    say(`  lateral first call (core sessionCall): ${rec.action} ${rec.load != null ? `${kgOf(rec.load)} kg` : ''} (${(rec.reason as { kind: string }).kind})`);
  }
}

// Week of Mon 2026-11-09 (America/La_Paz), with the corrected 11/10.
{
  const sessions = recentSnap.docs.map((d) => (d.id === SESSION_ID ? after : toWorkoutSession(d.id, d.data())));
  const cat = [...catalog.filter((c) => c.id !== hammerCat.id), { ...hammerCat, id: hammerId }];
  const from = new Date('2026-11-09T00:00:00-04:00').getTime();
  const to = new Date('2026-11-16T00:00:00-04:00').getTime();
  const cl = volumeBetween(sessions, cat, from, to);
  const hs = hardSetsBetween(sessions, cat, from, to);
  const inWeek = sessions.filter((s) => s.status === 'completed' && s.exercises.length && s.date >= new Date('2026-11-09T00:00:00-04:00') && s.date < new Date('2026-11-16T00:00:00-04:00'));
  say(`\nWeek 11/9–11/15 so far: ${inWeek.map((s) => `${s.date.toISOString().slice(0, 10)} ${s.templateName}`).join(', ')}`);
  // The travel targets the Haven templates were built against (11/7 script);
  // chest / abs / calves are "travel — OK" below target.
  const TARGET: Record<string, number> = { quads: 4, hamstrings: 4, back: 5, chest: 5, sideDelt: 3, rearDelt: 2, biceps: 2, triceps: 2, abs: 4 };
  const hsBy = new Map(hs.week.map((m) => [m.muscle, m]));
  for (const m of cl.week) {
    const h = hsBy.get(m.muscle);
    const tg = TARGET[m.muscle];
    say(`  ${m.muscle.padEnd(11)} clusters ${String(m.direct).padStart(2)} direct / ${String(m.fractional).padEnd(4)} frac · straight ${h?.direct ?? 0}/${h?.fractional ?? 0} · target ${tg ?? '—'}`);
  }
  say(`  unattributed: ${cl.unattributed.join(', ') || '—'} · total clusters ${cl.total}`);
  void clusterCount; void hardSetCount;
}

const planned = Object.keys(sessionPatch).length + (hammerCreate ? 1 : 0) + h1.changes.length + h2.changes.length;
say(`\nPLAN: session ${Object.keys(sessionPatch).join(', ') || '—'}; catalog ${hammerCreate ? 'create hammer curl' : '—'}; Haven 1 ${h1.changes.length}; Haven 2 ${h2.changes.length}.`);
if (!APPLY) { say('Dry run. Re-run with --apply to write.'); process.exit(0); }
if (!planned) { say('Nothing to do (already applied).'); process.exit(0); }

const conv = (v: unknown): unknown => {
  if (v instanceof Timestamp) return v.toDate().toISOString();
  if (Array.isArray(v)) return v.map(conv);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, conv(x)]));
  return v;
};
const dir = join(homedir(), 'ignia-backups');
const backup = join(dir, `owner-data-2026-11-10-haven-1-fix-${stamp.replace(/[:.]/g, '-')}.json`);
mkdirSync(dir, { recursive: true });
writeFileSync(backup, JSON.stringify(conv({ uid, session: { id: SESSION_ID, ...raw }, templates: { [H1_ID]: h1Doc.data(), [H2_ID]: h2Doc.data() } }), null, 1));
if (!existsSync(backup)) throw new Error('backup not written — refusing to write');
say(`backup written: ${backup}`);

const batch = db.batch();
if (hammerCreate) batch.set(user.collection('exercises').doc(HAMMER_ID), hammerCreate);
if (Object.keys(sessionPatch).length) batch.update(sesDoc.ref, { ...sessionPatch, updatedAt: FieldValue.serverTimestamp() });
if (h1.changes.length) batch.update(h1Doc.ref, { exercises: JSON.parse(JSON.stringify(h1.rows)), updatedAt: FieldValue.serverTimestamp() });
if (h2.changes.length) batch.update(h2Doc.ref, { exercises: JSON.parse(JSON.stringify(h2.rows)), updatedAt: FieldValue.serverTimestamp() });
await batch.commit();

const check = (await sesDoc.ref.get()).data()!;
const before = exercises.map((e) => JSON.stringify(e.sets));
const kept = (check.exercises as SessionExercise[]).slice(0, exercises.length).every((e, i) => JSON.stringify(e.sets) === before[i]);
say(`written. durationMin ${check.durationMin}; exercises ${check.exercises.length}; existing sets unchanged: ${kept}`);
process.exit(0);
