/**
 * Owner data, 2026-11-10 (America/La_Paz): set up Wed 11/11 "Haven 2 —
 * Hinge/Pull/Arms (simplified)", the back-to-back day after Haven 1 (11/10
 * 07:02 La Paz → 11/11 ~07:00–13:00 is the 24–30 h window).
 *
 *   EFFORT    template defaults: failure on isolations; `rir1` compounds keep
 *             their RIR 1 target with RIR 0 accepted. The 11/10 cue "Note: RIR
 *             1 — last 3 sessions logged RIR 0 on compounds" is REMOVED (owner
 *             accepts the fatigue; failure does not impair hypertrophy —
 *             Robinson 2024). DB RDL stays `rir2` (form / low-back safety).
 *   NOTE      A1 (first row) gets the cue "Note: back-to-back day; user chose
 *             failure — 3 rest days follow"; the plan entry carries it too. A
 *             session's `sessionNote` exists only once the session does.
 *   LOADS     RDL 12 kg (no increase), DB Lateral Raise 7.5 kg, every other
 *             row = its last logged Haven load (checked, not assumed); a "Start
 *             X kg — last Haven load (date)" cue is re-dated to that session.
 *   BLOCK     Arm Curl Machine ↔ Triceps Extension Machine (template group E)
 *             stays a required pair — checked, never made optional.
 *   PLAN      11/11 Haven 2 note; + rest 11/12–11/13 "Off — travel"; Travel A
 *             Sat 11/14 checked present. Every other entry is kept.
 *
 * DRY RUN unless `--apply`; backs up first; re-runs plan nothing.
 *
 *   TZ=America/La_Paz npx jiti scripts/owner-data-2026-11-11-haven-2.mts [--apply]
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
  type TravelPlanEntry,
  dayBoundaryOf,
  kgToLb,
  lbToKg,
  sessionCall,
  toWorkoutExercise,
  toWorkoutSession,
  toWorkoutTemplate,
  travelWeek,
} from '../packages/core/src/index.ts';
import type { Exercise, TemplateExercise } from '../packages/core/src/workout.ts';

const PROJECT_ID = 'fitness-tracker-gb-1775407101';
const OWNER = 'gabrielandresbermudez@gmail.com';
const APPLY = process.argv.includes('--apply');
const GYM = 'Haven Gym';
const H2_ID = 'travel-haven-2';
const RDL = 'vtSvqglnBZdM1f3qOJi4';
const LATERAL = 'haven-db-lateral-raise';
const ARM_CURL = 'haven-arm-curl-machine';
const TRI = 'haven-triceps-extension-machine';
const FIXED_KG: Record<string, number> = { [RDL]: 12, [LATERAL]: 7.5 };
const OLD_RIR_CUE = 'Note: RIR 1 — last 3 sessions logged RIR 0 on compounds';
const SESSION_NOTE = 'back-to-back day; user chose failure — 3 rest days follow';
const NOTE_CUE = `Note: ${SESSION_NOTE}`;
const PLAN_NOTE = `simplified, machines only, ~40 min; last Haven session · ~24–30 h after Haven 1 (11/10 07:02) · ${SESSION_NOTE}`;
const OFF: TravelPlanEntry = { from: '2026-11-12', to: '2026-11-13', kind: 'rest', label: 'Off — travel', note: 'Thu/Fri off (travel to Buena Vista / Santa Cruz)' };
const kg = (v: number) => +kgToLb(v).toFixed(2);
const kgOf = (lb?: number) => (lb == null ? '—' : `${+lbToKg(lb).toFixed(1)}`);

initializeApp({ credential: applicationDefault(), projectId: PROJECT_ID });
const db = getFirestore();
const uid = (await getAuth().getUserByEmail(OWNER)).uid;
const user = db.doc(`users/${uid}`);
const now = new Date();
const stamp = now.toISOString();
const say = console.log;
say(`${APPLY ? 'APPLY' : 'DRY RUN'} — ${now.toString()}\n`);

const [profileSnap, exSnap, h2Doc, sesSnap] = await Promise.all([
  user.get(), user.collection('exercises').get(), user.collection('workoutTemplates').doc(H2_ID).get(),
  user.collection('workoutSessions').orderBy('timestamp', 'desc').limit(400).get(),
]);
if (!h2Doc.exists || h2Doc.get('archivedAt') != null) throw new Error('Haven 2 missing or archived');
const catalog: Exercise[] = exSnap.docs.map((d) => toWorkoutExercise(d.id, d.data()));
const catOf = (id: string) => catalog.find((c) => c.id === id);
const completed = sessionsOf().filter((s) => s.status === 'completed');
function sessionsOf() { return sesSnap.docs.map((d) => toWorkoutSession(d.id, d.data())); }

/** Newest completed Haven session's heaviest activation / working load, kg. */
function lastHaven(id: string): { kg: number; on: string } | null {
  for (const s of completed) {
    const e = s.exercises.find((x) => x.exerciseId === id && x.awayGym === GYM);
    const w = e?.sets.filter((x) => x.reps != null && x.weight != null && x.kind !== 'drop').map((x) => x.weight!) ?? [];
    if (w.length) return { kg: +lbToKg(Math.max(...w)).toFixed(1), on: s.date.toLocaleDateString('en-CA', { timeZone: 'America/La_Paz' }) };
  }
  return null;
}

// ── template ──
type Row = TemplateExercise & Record<string, unknown>;
const rows = (h2Doc.get('exercises') as Row[]).map((r) => ({ ...r, cues: [...(r.cues ?? [])] }));
const changes: string[] = [];
const touch = (r: Row, what: string) => { r.lastModifiedAt = stamp; r.lastModifiedBy = 'prompt'; changes.push(`${r.supersetGroup}${r.pairPosition} ${r.name}: ${what}`); };
rows.forEach((r, i) => {
  if (r.cues.includes(OLD_RIR_CUE)) { r.cues = r.cues.filter((c) => c !== OLD_RIR_CUE); touch(r, '− RIR 0 warning cue'); }
  if (i === 0 && !r.cues.includes(NOTE_CUE)) { r.cues.unshift(NOTE_CUE); touch(r, '+ session note cue'); }
  if (r.targetLoad === 0) return; // bodyweight
  const h = lastHaven(r.exerciseId);
  const want = FIXED_KG[r.exerciseId] ?? h?.kg;
  if (want == null) throw new Error(`${r.name}: no Haven load to start from`);
  if (r.targetLoad == null || Math.abs(lbToKg(r.targetLoad) - want) > 0.05) {
    const from = r.targetLoad;
    r.targetLoad = kg(want);
    r.loadLog = [...((r.loadLog as unknown[]) ?? []), { at: stamp, to: r.targetLoad, ...(from != null ? { from } : {}), by: 'prompt', reason: `Haven 2 start ${want} kg (owner, 2026-11-10)` }];
    touch(r, `targetLoad ${kgOf(from)} → ${want} kg`);
  }
  if (h && !FIXED_KG[r.exerciseId]) {
    const cue = `Start ${h.kg} kg — last Haven load (${h.on}).`;
    const at = r.cues.findIndex((c) => /^Start .* — last Haven load \(/.test(c));
    if (at >= 0 && r.cues[at] !== cue) { r.cues[at] = cue; touch(r, `cue → "${cue}"`); }
  }
  if (r.exerciseId === RDL) {
    const cue = 'Start 12 kg — no increase (last Haven 2026-11-04: 12 × 8, 12 × 8 @ RIR 1).';
    const at = r.cues.findIndex((c) => /^Start /.test(c));
    if (at >= 0 && r.cues[at] !== cue) { r.cues[at] = cue; touch(r, 'cue → no increase'); }
  }
});
// Checks: RDL is rir2; the arm pair is present, paired, not optional.
if (catOf(RDL)?.effortStandard !== 'rir2') throw new Error('DB RDL is not rir2 in the catalog');
const curl = rows.find((r) => r.exerciseId === ARM_CURL);
const tri = rows.find((r) => r.exerciseId === TRI);
if (!curl || !tri || curl.supersetGroup !== tri.supersetGroup || curl.optional || tri.optional) throw new Error('arm pair is not a required pair');

// ── plan ──
const prof = profileSnap.data()!;
const rawPeriods = (prof.travelPeriods ?? []) as Record<string, unknown>[];
const iTrip = rawPeriods.findIndex((p) => p.start === '2026-10-31' && p.end === '2026-11-18');
if (iTrip < 0) throw new Error('the Bolivia trip is not on the profile');
const oldPlan = (rawPeriods[iTrip].plan ?? []) as TravelPlanEntry[];
let plan = oldPlan.map((e) => (e.templateId === H2_ID && e.from === '2026-11-11' ? { ...e, note: PLAN_NOTE } : e));
if (!plan.some((e) => e.kind === 'rest' && e.from === OFF.from)) plan = [...plan, OFF];
plan.sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0));
if (!plan.some((e) => e.from === '2026-11-14' && e.templateId === 'travel-a-full-body')) throw new Error('Travel A 11/14 missing');
if (!plan.some((e) => e.from === '2026-11-11' && e.templateId === H2_ID)) throw new Error('Haven 2 11/11 entry missing');
const planWrite = JSON.stringify(plan) !== JSON.stringify(oldPlan);
const periodsAfter = rawPeriods.map((p, i) => (i === iTrip ? { ...p, plan } : p));

// ── report ──
const tpl = toWorkoutTemplate(H2_ID, { ...h2Doc.data(), exercises: rows });
say(`${tpl.name}: ${changes.length ? '' : 'no change'}`);
for (const c of changes) say(`  · ${c}`);
say('\nPlan as the app will open it (core sessionCall):');
for (const r of tpl.exercises) {
  const c = catOf(r.exerciseId);
  const { rec } = sessionCall(r, completed, c!);
  const sets = r.plannedSets.some((s) => s.kind === 'working') ? `${r.plannedSets.length} straight` : `${r.plannedSets.filter((s) => s.kind === 'activation').length} cl${r.plannedSets.some((s) => s.kind === 'drop') ? '+drop' : ''}`;
  say(`  ${(r.supersetGroup! + r.pairPosition).padEnd(3)} ${r.name.padEnd(40)} ${sets.padEnd(10)} ${(c?.effortStandard ?? 'failure').padEnd(8)} ${r.targetLoad === 0 ? 'BW' : `${kgOf(r.targetLoad)} kg`}`.padEnd(80) + ` | app: ${rec.action}${rec.load != null ? ` ${kgOf(rec.load)} kg` : ''} (${(rec.reason as { kind: string }).kind})${rec.warnings?.length ? ` warn ${rec.warnings.join(',')}` : ''}`);
  for (const cue of r.cues ?? []) say(`        ${cue}`);
}
say('\nTravel plan after');
for (const e of plan) if (e.from >= '2026-11-09') say(`  ${e.from}${e.to !== e.from ? ` → ${e.to}` : ''} ${e.kind.padEnd(7)} ${e.label}${e.note ? ` · ${e.note}` : ''}`);
const wk = travelWeek(plan, '2026-11-11', completed, dayBoundaryOf(prof));
say(`  travelWeek(11/11) next: ${wk.next ? `${wk.next.label} ${wk.next.from}` : '—'}`);

say(`\nPLAN: template ${changes.length} change(s); travel plan ${planWrite ? 'WRITE' : 'unchanged'}.`);
if (!APPLY) { say('Dry run. Re-run with --apply to write.'); process.exit(0); }
if (!changes.length && !planWrite) { say('Nothing to do (already applied).'); process.exit(0); }

const conv = (v: unknown): unknown => {
  if (v instanceof Timestamp) return v.toDate().toISOString();
  if (Array.isArray(v)) return v.map(conv);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, conv(x)]));
  return v;
};
const dir = join(homedir(), 'ignia-backups');
const backup = join(dir, `owner-data-2026-11-11-haven-2-${stamp.replace(/[:.]/g, '-')}.json`);
mkdirSync(dir, { recursive: true });
writeFileSync(backup, JSON.stringify(conv({ uid, travelPeriods: prof.travelPeriods, template: { [H2_ID]: h2Doc.data() } }), null, 1));
if (!existsSync(backup)) throw new Error('backup not written — refusing to write');
say(`backup written: ${backup}`);

const batch = db.batch();
if (changes.length) batch.update(h2Doc.ref, { exercises: JSON.parse(JSON.stringify(rows)), updatedAt: FieldValue.serverTimestamp() });
if (planWrite) batch.update(user, { travelPeriods: periodsAfter });
await batch.commit();
const check = (await h2Doc.ref.get()).get('exercises') as Row[];
say(`written. RIR cue left: ${check.some((r) => r.cues?.includes(OLD_RIR_CUE))}; note cue on A1: ${check[0].cues?.includes(NOTE_CUE)}`);
process.exit(0);
