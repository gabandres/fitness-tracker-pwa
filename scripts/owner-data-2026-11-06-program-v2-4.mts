/**
 * The owner's Home Program v2.4 (requested 2026-11-06, EFFECTIVE 2026-11-20 —
 * moved from 11/23 on 2026-11-11). Applied on top of v2.3 (read first: the ab
 * focus of 10/23, the 10/30 crunch load). v2.3 is RETIRED as of 2026-11-19
 * (history unchanged; its 11/19 re-entry session is cancelled): no home
 * session runs between the trip and 11/20, so the script refuses only when a
 * home session has been logged since the trip began (2026-10-31) — the loads
 * it reads would then have moved. The FIRST v2.4 rotation (Leg, Pull, Push
 * from 11/20) is the app's post-travel re-entry (core `reentry.ts`: −10 % of
 * the call, RIR 2, never read by the engine) — nothing here touches it; the
 * new rows carry a "baseline pending" cue for it. Weekly targets apply from
 * the week of 11/23, the first full week. Travel A/B/C/D and the one-off are
 * read only. DRY RUN unless `--apply`; re-runs are no-ops; backed up first.
 * Modelled on `owner-data-2026-10-23-program-v2-3.mts`.
 *
 * Why (stored on each template's notes): "v2.4 — 2×/week for chest, back,
 * hamstrings; calves raised; stretch-biased setup. Evidence: Pelland 2024,
 * Remmert 2025, Maeo 2021, Larsen 2025, Kassiano 2023."
 *
 *   LEG   Smith squat ×2 · RDL 2 × 8–12 straight (both unchanged)
 *         F  NEW superset: F1 Incline Dumbbell Press ×1 (the Push B1 load)
 *            ↔ F2 Chest-supported DB row ×1 (the Pull row-4 load), RIR 1
 *         D  D1 Leg Extensions ×2 (was 1; recline) → D2 Seated Leg Curl ×2
 *            (renamed from "Leg Curls", same id; alt Lying Leg Curl) → D3
 *            NEW Single-leg DB calf raise 1/leg (the Push calf load) → D4
 *            Hanging Leg Raise ×1. The app's superset cap is 3
 *            (`MAX_SUPERSET_SIZE`), so D4 runs as the next row at 30 s — the
 *            Travel C precedent (11/02).
 *         Zone 2 removed (done separately).
 *   PULL  1–4 and tri-set D unchanged. E is a 4-exercise circuit: E1 Leg
 *         Extensions ×1 (recline) → E2 DB Lateral Raise ×1 → E3 NEW Seated
 *         Leg Curl ×1 (the Leg load) → E4 Weighted Floor Crunch ×1 as the
 *         next row at 15 s (same cap). Zone 2 removed.
 *   PUSH  A, B1, shoulder press, deficit push-up, C2, C3 unchanged. B2 calf
 *         2 clusters per leg (L R L R, was 1/leg). C1 Overhead DB Extension
 *         → NEW One-arm Overhead DB Extension (seated), 1 cluster per arm
 *         (L R) at 15 lb (12–15 asked; the dumbbell step is 5), its own
 *         history — the two-hand lift stays in the catalog (Travel C/D still
 *         offer it). Zone 2 removed.
 *
 * Sides in one round (owner's decisions, 2026-11-06; core `sideSwitchSec`,
 * which ships with this program): Push B rounds run Incline → Calf L → Calf R
 * (10 s between sides), Push C round 1 runs OH L → OH R (no rest) → lateral →
 * skull and round 2 the lateral + drop, Leg D round 1 runs ext → curl → calf
 * L → calf R and round 2 ext → curl. An app without the field runs one side
 * per round, as before — nothing breaks, only the order differs.
 *
 * Shared histories (the engine reads by exerciseId across templates, core
 * `engineHistory`): Incline press Push B1 + Leg F1; CS row Pull 4 + Leg F2;
 * Leg Extensions Leg D1 + Pull E1; Seated Leg Curl Leg D2 + Pull E3; calf
 * Push B2 + Leg D3. Rows the spec changes get `{ since: 2026-11-20, reason:
 * "context changed: v2.4" }` (the export prints "baseline since 2026-11-20:
 * context changed: v2.4"); rows the spec calls unchanged keep theirs, Push B1
 * and Pull row 4 included — they will read the Leg F sessions from 11/20 on.
 * No `clusterCountChange` on Leg Extensions or the calf: the owner asked for
 * a baseline, and the two are alternatives (`superset-context.ts` `plan`).
 *
 * Weekly targets (direct clusters, v2.4): stored on the notes; the app has no
 * per-muscle target field, so the "under" flag and the "≈ sets" line are
 * printed here (section 4), not shown in the app.
 *
 *   TZ=America/Puerto_Rico npx jiti scripts/owner-data-2026-11-06-program-v2-4.mts --email gabrielandresbermudez@gmail.com [--apply]
 *
 * Auth: ADC (`gcloud auth application-default login`). No rules change: the
 * row fields used (alternatives, labels, cues) are in use already, and the
 * two catalog docs have the shape `owner-data-2026-11-05-carryover` wrote.
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue, getFirestore, Timestamp } from 'firebase-admin/firestore';
import type { Exercise, PlannedSet, TemplateExercise, WorkoutTemplate } from '../packages/core/src/workout.ts';
import type { RowAlternative } from '../packages/core/src/row-options.ts';
import {
  buildCsv,
  calendarDateKey,
  clusterCount,
  contextBaseline,
  dumbbellStepLb,
  estimateTemplateDuration,
  normalizeSupersets,
  plannedVolume,
  restAfterSetInFlow,
  sessionCall,
  supersetFlow,
  templateRestFor,
  toWorkoutExercise,
  toWorkoutSession,
  toWorkoutTemplate,
} from '../packages/core/src/index.ts';

const PROJECT_ID = 'fitness-tracker-gb-1775407101';
const ASKED = '2026-11-06';
const SINCE = '2026-11-20';
const TRIP_START = '2026-10-31';
const TARGETS_FROM = '2026-11-23';
const VERSION = 'v2.4';
const FROM_VERSION = 'v2.3';
const REASON = 'context changed: v2.4';
const LOAD_REASON = `Program v2.4 (owner, asked ${ASKED}, from ${SINCE})`;
const RETIRE = `v2.3 retired 2026-11-19 (history unchanged; the planned v2.3 re-entry session is cancelled). The first rotation from ${SINCE} (Leg, Pull, Push) is post-travel re-entry: −10% of the last home working load, RIR 2 on every exercise, no failure, no drop set; normal v2.4 effort (RIR 1 compounds, failure isolations, drop set on the last lateral cluster) from the second rotation. New rows are baseline pending through the re-entry rotation.`;
const WHY = 'v2.4 — 2×/week for chest, back, hamstrings; calves raised; stretch-biased setup. Evidence: Pelland 2024, Remmert 2025, Maeo 2021, Larsen 2025, Kassiano 2023.';
const FAIL = 'RIR 0 — to failure';

const PUSH = 'Nx1bxeRuH6bMnGgX7Trv';
const PULL = 'aliWJBD2FND6mU9foLdC';
const LEG = 'quxwARQlCnItzpLJgcr4';
const TPL_IDS = [LEG, PULL, PUSH];

const SQUAT = 'eKW1qiIDpvfnSECIxSUn';
const RDL = 'vtSvqglnBZdM1f3qOJi4';
const EXT = 'hXvPQM7Dv6YvScYW7h2l';
const CURL = 'jZWYnikrGcdRG1adHXJ0';
const LEG_RAISE = 'jMGQm6C9I6HNNPXPYYLM';
const INCLINE = 'ngF9959fQPGTYUHXpigC';
const CS_ROW = 'acs1BlQvTZdL97i5jXJv';
const CALF = 'm5E72J63gVXltnQ0zC8f';
const LATERAL = 'BGyAEJU6i5nN6AjXRU1g';
const CRUNCH = 'x3G0Speg04GclIOdKHAl';
const OH_TWO = 'AAHHWXTA7UtbNWZbcf7z';
const OH_ONE = 'home-one-arm-oh-db-ext';
const LYING = 'home-lying-leg-curl';
const HAVEN_CURL = 'haven-seated-leg-curl';

const CURL_NAME = 'Seated Leg Curl';
const OH_ONE_NAME = 'One-arm Overhead DB Extension (seated)';
const NEW_CATALOG: Record<string, { name: string; muscles: string[]; category: string; effortStandard: 'failure' }> = {
  [OH_ONE]: { name: OH_ONE_NAME, muscles: ['triceps'], category: 'isolation', effortStandard: 'failure' },
  [LYING]: { name: 'Lying Leg Curl', muscles: ['hamstrings'], category: 'isolation', effortStandard: 'failure' },
};
const OH_ONE_START = 15;
/** Rest between the L and R side of one round, seconds (`sideSwitchSec`, owner
 *  2026-11-06): calves 0–15 s (the timer runs 10), the overhead extension none. */
const SIDE_SWITCH = { calf: 10, oh: 0 } as const;

const CUE = {
  recline: 'Lean back / recline the seat (~40° hip flexion) — same lift, new baseline from 11/20.',
  pending: 'Baseline pending — the re-entry session (first v2.4 rotation, from 11/20) is not read; the baseline is the session after.',
  seated: 'Seated preferred (Maeo 2021).',
  hamsSecond: 'Second weekly exposure — hamstrings.',
  chestBack: 'Second weekly exposure — chest/back.',
  calfLeg: '1–2 s pause in deep stretch; minis = bottom-half partials.',
  calfPush: 'Deep stretch pause; minis = bottom-half partials.',
  ohOne: 'Free hand supports the elbow; deep stretch, 2–3 s lowering.',
  ohOneSides: 'L then R back to back, no rest (the other arm rests). L + R = 1 triceps cluster.',
  calfSides: 'L then R back to back, 0–15 s between (the other leg rests).',
};

/** Weekly direct clusters (v2.4). An L/R pair counts once. */
const TARGETS: Record<string, number> = {
  chest: 6, back: 6, quads: 5, hamstrings: 5, calves: 3, sideDelt: 3, rearDelt: 2, biceps: 2, triceps: 2, abs: 4,
};
const TARGET_LINE = 'Weekly targets v2.4 (direct clusters, from the week of 2026-11-23 — the first full week; replaces v2.3): chest 6 · back 6 · quads 5 · hamstrings 5 (2 RDL straight sets + 3 curl clusters) · calves 3 per leg · sideDelt 3 · rearDelt 2 · biceps 2 · triceps 2 (one-arm L+R = 1) · abs 4. ≈ sets (est.) = clusters × 1.5; straight sets × 1. From the week of 2026-11-23, a muscle below target is "under" (non-blocking); the week of 11/16 is travel + re-entry — no flags.';

const NOTES: Record<string, string> = {
  [LEG]: `${SINCE} - Program v2.4 (owner, asked ${ASKED}; effective date moved 11/23 → 11/20 on 2026-11-11). ${RETIRE} ${WHY} Smith squat ×2 · RDL 2 × 8–12 (RIR 2) · NEW superset F: F1 Incline Dumbbell Press ×1 ↔ F2 Chest-supported DB row ×1, RIR 1 (second weekly exposure — chest/back) · D: D1 Leg Extensions ×2 (was 1; recline ~40°) → D2 Seated Leg Curl ×2 (was "Leg Curls", same history; alt Lying Leg Curl) → D3 NEW Single-leg DB calf raise 1/leg (deep-stretch pause, bottom-half minis) → D4 Hanging Leg Raise ×1 (next row, 30 s — the app's superset holds 3). Zone 2 removed (done separately). Baseline "${REASON}" on F1, F2, D1, D2, D3. ${TARGET_LINE}`,
  [PULL]: `${SINCE} - Program v2.4 (owner, asked ${ASKED}; effective date moved 11/23 → 11/20 on 2026-11-11). ${RETIRE} ${WHY} Rows 1–4 and tri-set D unchanged. E is a 4-exercise circuit: E1 Leg Extensions ×1 (recline) → E2 DB Lateral Raise ×1 → E3 NEW Seated Leg Curl ×1 (second weekly exposure — hamstrings; one history with Leg D2) → E4 Weighted Floor Crunch ×1 (next row, 15 s). Zone 2 removed. Baseline "${REASON}" on E1, E3. ${TARGET_LINE}`,
  [PUSH]: `${SINCE} - Program v2.4 (owner, asked ${ASKED}; effective date moved 11/23 → 11/20 on 2026-11-11). ${RETIRE} ${WHY} A and B1 unchanged · B2 Single-leg DB calf raise 2 clusters per leg (L R L R, was 1/leg) · shoulder press, deficit push-up unchanged · C1 Overhead DB Extension → NEW One-arm Overhead DB Extension (seated) 1 cluster per arm (L R), ${OH_ONE_START} lb, own history (the two-hand history stays separate) · C2, C3 unchanged. Zone 2 removed. Baseline "${REASON}" on B2, C1. ${TARGET_LINE}`,
};

const args = process.argv.slice(2);
const email = args[args.indexOf('--email') + 1];
const APPLY = args.includes('--apply');
if (!email || email.startsWith('--')) throw new Error('--email is required');
if (process.env.TZ !== 'America/Puerto_Rico') throw new Error('run with TZ=America/Puerto_Rico (the owner\'s timezone from 11/19)');

initializeApp({ credential: applicationDefault(), projectId: PROJECT_ID });
const db = getFirestore();
const uid = (await getAuth().getUserByEmail(email)).uid;
const user = db.doc(`users/${uid}`);
const now = new Date();
const stamp = now.toISOString();
const todayKey = calendarDateKey(now);

const [profileSnap, exSnap, sesSnap, draftSnap, allTplSnap] = await Promise.all([
  user.get(),
  user.collection('exercises').get(),
  user.collection('workoutSessions').get(),
  user.collection('templateDrafts').get(),
  user.collection('workoutTemplates').get(),
]);
const tplSnaps = TPL_IDS.map((id) => allTplSnap.docs.find((d) => d.id === id));
for (const [k, s] of tplSnaps.entries()) if (!s) throw new Error(`template ${TPL_IDS[k]} not found`);

type Row = TemplateExercise & Record<string, unknown>;
type RawTpl = { name: string; notes?: string; templateVersion?: string; exercises: Row[]; cardioBlocks?: unknown[] } & Record<string, unknown>;
const raw = new Map(tplSnaps.map((s) => [s!.id, s!.data() as RawTpl]));
const exDocs = new Map(exSnap.docs.map((d) => [d.id, d]));
const catalog: Exercise[] = exSnap.docs.map((d) => toWorkoutExercise(d.id, d.data()));
const catOf = (id: string) => catalog.find((c) => c.id === id);
const dbStep = dumbbellStepLb(profileSnap.get('dumbbellHalfSteps') as boolean | undefined);
const sessions = sesSnap.docs.map((d) => toWorkoutSession(d.id, d.data()));
const completed = sessions.filter((s) => s.status === 'completed').sort((a, b) => b.date.getTime() - a.date.getTime());
const liveBefore: WorkoutTemplate[] = TPL_IDS.map((id) => toWorkoutTemplate(id, raw.get(id)!));
const otherTplBefore = allTplSnap.docs.filter((d) => !TPL_IDS.includes(d.id)).map((d) => [d.id, JSON.stringify(d.data())] as const);

const out: string[] = [];
const say = (s = '') => out.push(s);
say(`${APPLY ? 'APPLY' : 'DRY RUN'} — uid ${uid} — ${stamp} (today ${todayKey}, ${process.env.TZ})`);
say(`dumbbell step: ${dbStep} lb`);

// ── refuse on anything the spec does not expect ──
const homeSinceTrip = completed.filter((s) => calendarDateKey(s.date) >= TRIP_START && s.exercises.length > 0 && TPL_IDS.includes(s.templateId ?? ''));
if (APPLY && homeSinceTrip.length && !raw.get(LEG)!.notes?.includes(`${SINCE} - Program v2.4`)) throw new Error(`${homeSinceTrip.length} home session(s) since ${TRIP_START} — the starting loads have moved; re-read before applying`);
for (const id of [SQUAT, RDL, EXT, CURL, LEG_RAISE, INCLINE, CS_ROW, CALF, LATERAL, CRUNCH, OH_TWO, HAVEN_CURL]) if (!catOf(id)) throw new Error(`catalog exercise ${id} missing`);
const versions = TPL_IDS.map((id) => raw.get(id)!.templateVersion);
if (versions.some((v) => v !== FROM_VERSION && v !== VERSION)) throw new Error(`templates are not on ${FROM_VERSION}: ${versions.join(', ')}`);
const homeAfter = completed.filter((s) => calendarDateKey(s.date) >= SINCE && s.exercises.length > 0 && TPL_IDS.includes(s.templateId ?? ''));
if (homeAfter.length && versions.some((v) => v !== VERSION)) throw new Error(`${homeAfter.length} home session(s) on/after ${SINCE} ran before v2.4 was written — the baseline date needs a decision first`);
for (const [id, c] of Object.entries(NEW_CATALOG)) {
  const have = catOf(id);
  if (have && have.name !== c.name) throw new Error(`catalog ${id} exists as "${have.name}"`);
}
const sameName = catalog.filter((c) => c.id !== CURL && c.name.toLowerCase() === CURL_NAME.toLowerCase()).map((c) => c.id);

// ── helpers ──
const clusters = (n: number): PlannedSet[] => Array.from({ length: n }, (_, i) => [
  { kind: 'activation' as const, group: i + 1 }, { kind: 'mini' as const, group: i + 1 }, { kind: 'mini' as const, group: i + 1 },
]).flat();
/** One cluster per side label, each its own group, the label on every set
 *  (the shape Push's calf row already has). */
const sided = (labels: ('L' | 'R')[]): PlannedSet[] => labels.flatMap((label, i) => [
  { kind: 'activation' as const, group: i + 1, label }, { kind: 'mini' as const, group: i + 1, label }, { kind: 'mini' as const, group: i + 1, label },
]);
const stable = (v: unknown): string => {
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v).filter((k) => (v as Record<string, unknown>)[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${stable((v as Record<string, unknown>)[k])}`).join(',')}}`;
  return JSON.stringify(v);
};
const strip = (r: Row) => { const { lastModifiedAt: _a, lastModifiedBy: _b, ...x } = r; return stable(x); };
const blockOf = (r: TemplateExercise) => (r.supersetGroup ? `${r.supersetGroup}${r.pairPosition}` : '—');
const fmtBase = (b?: TemplateExercise['baseline']) => (b ? `${b.since} "${b.reason}"${b.dropBackTo != null ? ` drop→${b.dropBackTo} <${b.dropBackBelowReps}` : ''}` : '—');
const labelsOf = (r: TemplateExercise) => r.plannedSets.filter((s) => s.kind === 'activation').map((s) => s.label ?? '').join('');
const shape = (r: TemplateExercise) => {
  const straight = r.plannedSets.filter((s) => s.kind === 'working').length;
  if (straight) return `${straight} straight`;
  const l = labelsOf(r);
  return l ? `${l.split('').join(' ')} (${clusterCount(r.plannedSets, false)}/side)` : `×${clusterCount(r.plannedSets, false)}${r.plannedSets.some((s) => s.kind === 'drop') ? ' +drop' : ''}`;
};
const effortOf = (r: TemplateExercise) => {
  const c = (r.cues ?? [])[0] ?? '';
  const m = /^RIR (\d)/.exec(c);
  return m ? (m[1] === '0' ? 'failure' : `RIR ${m[1]}`) : (catOf(r.exerciseId)?.effortStandard ?? '?');
};
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
const loadEntry = (to: number, reason: string) => ({ at: stamp, to, by: 'prompt' as const, reason });
const rowOf = (tpl: string, ex: string) => {
  const r = raw.get(tpl)!.exercises.find((e) => e.exerciseId === ex);
  if (!r) throw new Error(`${raw.get(tpl)!.name} has no ${ex}`);
  return r;
};
const plain = (r: Row): Row => {
  const { baseline: _b, excludedReads: _x, loadLog: _l, clusterCountChange: _c, sideLoads: _s, supersetGroup: _g, pairPosition: _p,
    transitionRestSec: _t, roundRestSec: _r, restAfterSec: _a, restClusterSec: _rc, minClusterRestSec: _m, lastModifiedAt: _la, lastModifiedBy: _lb, alternatives: _alt, ...keep } = r;
  return structuredClone(keep) as Row;
};
const withCue = (cues: readonly string[] | undefined, add: string[], drop: string[] = []) =>
  [...(cues ?? []).filter((c) => !drop.includes(c) && !add.includes(c)), ...add];
const unpair = (r: Row): Row => { const { supersetGroup: _g, pairPosition: _p, transitionRestSec: _t, roundRestSec: _r, ...x } = r; return x as Row; };

// The catalog as it will be after the write.
const catalogAfter: Exercise[] = [
  ...catalog.map((c) => (c.id === CURL ? { ...c, name: CURL_NAME } : c)),
  ...Object.entries(NEW_CATALOG).filter(([id]) => !catOf(id)).map(([id, c]) => ({ id, name: c.name, muscles: c.muscles, defaultCues: [], logStyle: 'weight-reps', effortStandard: c.effortStandard } as unknown as Exercise)),
];
const catAfterOf = (id: string) => catalogAfter.find((c) => c.id === id);
const musclesOf = (id: string) => catAfterOf(id)?.muscles;
const engineCat = (id: string) => { const c = catAfterOf(id); return c ? { ...c, dumbbellStepLb: dbStep } : null; };

// ── source rows (v2.3) and their working loads ──
const already = versions.every((v) => v === VERSION);
const src = {
  incline: rowOf(PUSH, INCLINE),
  csRow: rowOf(PULL, CS_ROW),
  calf: rowOf(PUSH, CALF),
  curl: rowOf(LEG, CURL),
};
const lastLogged = (ex: string) => {
  for (const s of completed) {
    if (s.reentry != null || s.deload || s.notComparable || !TPL_IDS.includes(s.templateId ?? '')) continue;
    const e = s.exercises.find((x) => x.exerciseId === ex);
    const w = e?.sets.find((x) => x.kind === 'activation' && x.reps != null)?.weight;
    if (w != null) return `${w} on ${calendarDateKey(s.date)} (${raw.get(s.templateId ?? '')?.name})`;
  }
  return '—';
};
say('\n0. Starting loads (template targetLoad = the working load; re-entry sessions are not working loads)');
// The starting load is the source row's WORKING load: the app's next call on
// it (what the card would pre-fill), falling back to the template's target.
// They differ when the template lags the log — the CS row read 35 in the
// template on 11/06 while the 10/29 session ran, and the engine holds, 40.
const kindOf = (rec: { reason?: unknown }) => (rec.reason && typeof rec.reason === 'object' && 'kind' in rec.reason ? (rec.reason as { kind: string }).kind : '?');
const start: Record<keyof typeof src, number> = { incline: 0, csRow: 0, calf: 0, curl: 0 };
for (const [k, r] of Object.entries(src) as [keyof typeof src, Row][]) {
  const call = sessionCall(r, completed, engineCat(r.exerciseId));
  // An L/R lift has a call per side; the lower one starts the new row.
  const calls = call.sides ? Object.entries(call.sides).map(([sd, c]) => ({ sd, ...c! })) : [{ sd: '', ...call }];
  const loads = calls.map((c) => c.rec.load).filter((l): l is number => l != null && l > 0);
  start[k] = loads.length ? Math.min(...loads) : r.targetLoad!;
  const txt = calls.map(({ sd, rec, basedOn }) => `${sd ? `${sd} ` : ''}${rec.action} ${rec.load ?? '—'} (${kindOf(rec)}${basedOn ? ` from ${calendarDateKey(basedOn)}` : ''})`).join(' / ');
  say(`   ${k.padEnd(7)} ${r.name.padEnd(26)} target ${r.targetLoad} · last logged activation ${lastLogged(r.exerciseId)} · app's next call ${txt} → START ${start[k]}`);
}
say(`   one-arm OH ext: ${OH_ONE_START} lb (12–15 asked, dumbbell step ${dbStep})`);
if (sameName.length) say(`   NOTE: "${CURL_NAME}" is also the name of ${sameName.join(', ')} (Haven Gym, its own history) — two catalog entries will read the same; the Haven row is untouched`);

const lyingAlt: RowAlternative = { exerciseId: LYING, name: 'Lying Leg Curl', cues: [FAIL, 'If no seated machine. Its own history.'], note: 'if no seated machine' };

// ── 1. build each template ──
const next = new Map<string, RawTpl>();
const changedIds = new Set<string>();
const rebase = new Map<string, Set<string>>([[LEG, new Set([INCLINE, CS_ROW, EXT, CURL, CALF])], [PULL, new Set([EXT, CURL])], [PUSH, new Set([CALF, OH_ONE])]]);
let rowCount = 0;
for (const id of TPL_IDS) {
  const cur = raw.get(id)!;
  const old = (ex: string) => cur.exercises.find((e) => e.exerciseId === ex);
  let rows: Row[];
  if (already) rows = cur.exercises.map((r) => structuredClone(r) as Row);
  else if (id === LEG) {
    const order = cur.exercises.map((r) => r.exerciseId).join();
    if (order !== [SQUAT, RDL, EXT, CURL, LEG_RAISE].join()) throw new Error(`Leg Day is not v2.3's squat, RDL, ext, curl, leg raise: ${order}`);
    if (clusterCount(old(EXT)!.plannedSets, false) !== 1 || clusterCount(old(CURL)!.plannedSets, false) !== 2) throw new Error('Leg D1/D2 are not ×1/×2');
    const ext = structuredClone(old(EXT)!) as Row;
    const curl = structuredClone(old(CURL)!) as Row;
    rows = [
      structuredClone(old(SQUAT)!) as Row,
      structuredClone(old(RDL)!) as Row,
      { ...plain(src.incline), targetLoad: start.incline, plannedSets: clusters(1), cues: withCue(src.incline.cues, [CUE.chestBack, CUE.pending]), supersetGroup: 'F', pairPosition: 1, transitionRestSec: 30, roundRestSec: 30,
        loadLog: [loadEntry(start.incline, `${LOAD_REASON}: F1 on Leg at the Push B1 load (one history)`)] } as Row,
      { ...plain(src.csRow), targetLoad: start.csRow, plannedSets: clusters(1), cues: withCue(src.csRow.cues, [CUE.chestBack, CUE.pending]), supersetGroup: 'F', pairPosition: 2, restAfterSec: 60,
        loadLog: [loadEntry(start.csRow, `${LOAD_REASON}: F2 on Leg at the Pull row's working load (one history)`)] } as Row,
      { ...ext, plannedSets: clusters(2), cues: withCue(ext.cues, [CUE.recline]), transitionRestSec: 30, roundRestSec: 30 },
      // Round 2 (ext → curl) ends the block, so the curl's rest-after is the
      // 30 s into D4.
      { ...curl, name: CURL_NAME, cues: withCue(curl.cues, [CUE.seated], ['Seated machine preferred — Maeo 2021']), alternatives: [lyingAlt], restAfterSec: 30 },
      { ...plain(src.calf), targetLoad: start.calf, plannedSets: sided(['L', 'R']), cues: [FAIL, CUE.calfLeg, CUE.calfSides, CUE.pending], supersetGroup: 'D', pairPosition: 3, restAfterSec: 30, sideSwitchSec: SIDE_SWITCH.calf,
        loadLog: [loadEntry(start.calf, `${LOAD_REASON}: D3 on Leg at the Push calf load (one history)`)] } as Row,
      { ...unpair(structuredClone(old(LEG_RAISE)!) as Row), restAfterSec: 60 },
    ];
  } else if (id === PULL) {
    const e = cur.exercises.filter((r) => r.supersetGroup === 'E').map((r) => r.exerciseId).join();
    if (e !== [EXT, LATERAL, CRUNCH].join() || cur.exercises.at(-1)!.exerciseId !== CRUNCH) throw new Error(`Pull E is not v2.3's ext → lateral → crunch: ${e}`);
    const head = cur.exercises.filter((r) => r.supersetGroup !== 'E').map((r) => structuredClone(r) as Row);
    const ext = structuredClone(old(EXT)!) as Row;
    rows = [
      ...head,
      { ...ext, cues: withCue(ext.cues, [CUE.recline]) },
      structuredClone(old(LATERAL)!) as Row,
      { ...plain(src.curl), targetLoad: start.curl, name: CURL_NAME, plannedSets: clusters(1), cues: withCue(src.curl.cues, [CUE.seated, CUE.hamsSecond, CUE.pending], ['Seated machine preferred — Maeo 2021']),
        alternatives: [lyingAlt], supersetGroup: 'E', pairPosition: 3, restAfterSec: 15,
        loadLog: [loadEntry(start.curl, `${LOAD_REASON}: E3 on Pull at the Leg curl load (one history)`)] } as Row,
      { ...unpair(structuredClone(old(CRUNCH)!) as Row), restAfterSec: 60 },
    ];
  } else {
    const order = cur.exercises.map((r) => r.exerciseId);
    const c1 = order.indexOf(OH_TWO);
    if (c1 < 0 || blockOf(cur.exercises[c1]) !== 'C1') throw new Error('Push C1 is not Overhead DB Extension');
    if (labelsOf(src.calf) !== 'LR') throw new Error(`Push calf is not 1 cluster per leg: ${labelsOf(src.calf)}`);
    const ohOld = cur.exercises[c1];
    rows = cur.exercises.map((r) => {
      const x = structuredClone(r) as Row;
      // Each B round: Incline → Calf L → Calf R (owner 2026-11-06).
      if (r.exerciseId === CALF) return { ...x, plannedSets: sided(['L', 'R', 'L', 'R']), cues: [FAIL, CUE.calfPush, CUE.calfSides, CUE.pending], sideSwitchSec: SIDE_SWITCH.calf };
      if (r.exerciseId === OH_TWO) {
        return {
          exerciseId: OH_ONE, name: OH_ONE_NAME, targetLoad: OH_ONE_START, logStyle: 'weight-reps', plannedSets: sided(['L', 'R']),
          cues: [FAIL, CUE.ohOne, CUE.ohOneSides, CUE.pending], progression: { targetReps: 12, incrementLb: dbStep, holdSessions: 2 },
          // Round 1: OH L → OH R → lateral → skull; both arms before the skull crushers.
          supersetGroup: 'C', pairPosition: 1, transitionRestSec: ohOld.transitionRestSec ?? 30, roundRestSec: ohOld.roundRestSec ?? 30, sideSwitchSec: SIDE_SWITCH.oh,
          loadLog: [loadEntry(OH_ONE_START, `${LOAD_REASON}: C1 one-arm, new lift (two-hand history kept separate)`)],
        } as Row;
      }
      return x;
    });
  }
  rows = normalizeSupersets(rows, { keepLetters: true }) as Row[];

  // Baselines: the rows the spec changes or adds. Every other row keeps its own.
  rows = rows.map((r) => {
    if (!rebase.get(id)!.has(r.exerciseId) || r.baseline?.reason === REASON) return r;
    const b = contextBaseline(['superset'], { since: SINCE, load: r.targetLoad, catalog: engineCat(r.exerciseId), row: r });
    return { ...r, baseline: { ...b, reason: REASON } };
  });
  rows = rows.map((r) => {
    const o = old(r.exerciseId);
    return o && strip(r) === strip(o) ? o : ({ ...r, lastModifiedAt: stamp, lastModifiedBy: 'prompt' } as Row);
  });
  rowCount += rows.filter((r) => r !== old(r.exerciseId)).length;
  const notes = cur.notes?.includes(`${SINCE} - Program v2.4`) ? cur.notes : `${cur.notes ?? ''}\n${NOTES[id]}`.trim();
  if (notes.length > 10000) throw new Error(`${cur.name}: notes would be ${notes.length} chars, over the rules' 10,000`);
  const order = (xs: readonly Row[]) => xs.map((r) => r.exerciseId).join();
  const rowsChanged = order(rows) !== order(cur.exercises) || rows.some((r) => r !== old(r.exerciseId));
  const { cardioBlocks: _cb, ...curNoCardio } = cur;
  if (rowsChanged || notes !== cur.notes || cur.templateVersion !== VERSION || cur.cardioBlocks !== undefined) changedIds.add(id);
  next.set(id, { ...curNoCardio, exercises: rows, notes, templateVersion: VERSION });

  // ── report ──
  say(`\n1. ${cur.name} (${id}) — ${rowsChanged ? 'CHANGES' : 'rows unchanged'} · templateVersion ${cur.templateVersion} → ${VERSION} · cardio ${cur.cardioBlocks ? `${JSON.stringify((cur.cardioBlocks as { label?: string }[]).map((b) => b.label))} → removed` : 'none'}${notes !== cur.notes ? ' · + dated notes line' : ''} (notes ${notes.length} chars)`);
  say('   BEFORE');
  cur.exercises.forEach((r, i) => say(`   ${i + 1}. ${blockOf(r).padEnd(3)} ${r.name.padEnd(40)} ${shape(r).padEnd(20)} ${String(r.targetLoad ?? '—').padStart(5)}  base ${fmtBase(r.baseline)}`));
  say('   AFTER   pos block exercise                                   clusters/labels      effort   load   baseline');
  rows.forEach((r, i) => {
    const o = old(r.exerciseId);
    const d: string[] = [];
    if (!o) d.push('NEW');
    else {
      if (o.name !== r.name) d.push(`renamed "${o.name}"`);
      if (cur.exercises.indexOf(o) !== i) d.push(`pos ${cur.exercises.indexOf(o) + 1}→${i + 1}`);
      if (blockOf(o) !== blockOf(r)) d.push(`block ${blockOf(o)}→${blockOf(r)}`);
      if (shape(o) !== shape(r)) d.push(`${shape(o)}→${shape(r)}`);
      if (o.targetLoad !== r.targetLoad) d.push(`load ${o.targetLoad}→${r.targetLoad}`);
      if (stable(o.cues) !== stable(r.cues)) d.push('cues');
      if (stable(o.alternatives) !== stable(r.alternatives)) d.push('alternatives');
      if (o.transitionRestSec !== r.transitionRestSec || o.roundRestSec !== r.roundRestSec || o.restAfterSec !== r.restAfterSec) d.push(`rests ${o.transitionRestSec}/${o.roundRestSec}/${o.restAfterSec}→${r.transitionRestSec}/${r.roundRestSec}/${r.restAfterSec}`);
      if (stable(o.baseline) !== stable(r.baseline)) d.push('BASELINE');
    }
    say(`   ${String(i + 1).padStart(5)}. ${blockOf(r).padEnd(3)} ${r.name.padEnd(40)} ${shape(r).padEnd(20)} ${effortOf(r).padEnd(8)} ${String(r.targetLoad ?? '—').padStart(5)}  ${fmtBase(r.baseline)}${d.length ? `   ← ${d.join('; ')}` : ''}`);
    if (!o || stable(o.cues) !== stable(r.cues)) say(`            cues: ${JSON.stringify(r.cues ?? [])}`);
    if (r.alternatives) say(`            alternatives: ${JSON.stringify((r.alternatives as RowAlternative[]).map((a) => `${a.name} (${a.exerciseId})`))}`);
  });
  const removed = cur.exercises.filter((o) => !rows.some((r) => r.exerciseId === o.exerciseId));
  if (removed.length) say(`   removed from this template: ${removed.map((r) => `${r.name} (${r.exerciseId}) — stays in the catalog with its history`).join('; ')}`);
}

// ── 1c. catalog ──
say('\n1c. Catalog');
const catalogWrites: { id: string; create?: boolean; patch: Record<string, unknown> }[] = [];
if (catOf(CURL)!.name !== CURL_NAME) catalogWrites.push({ id: CURL, patch: { name: CURL_NAME } });
say(`   ${CURL}: "${catOf(CURL)!.name}" → "${CURL_NAME}" (same id: every logged "Leg Curls" session stays this lift's history)`);
for (const [id, c] of Object.entries(NEW_CATALOG)) {
  if (!catOf(id)) catalogWrites.push({ id, create: true, patch: { name: c.name, muscles: c.muscles, defaultCues: [], logStyle: 'weight-reps', category: c.category, effortStandard: c.effortStandard, createdAt: Timestamp.fromDate(now) } });
  say(`   ${id}: ${catOf(id) ? 'exists' : `NEW "${c.name}" [${c.muscles}] ${c.effortStandard}`} — no history`);
}
say(`   ${OH_TWO} "${catOf(OH_TWO)!.name}": unchanged, out of Push; Travel C/D still offer it as an alternative`);

// ── 2. superset flows ──
const after = TPL_IDS.map((id) => toWorkoutTemplate(id, next.get(id)!));
say('\n2. Performed sequence (core supersetFlow) with the rest after each step');
for (const t of after) {
  const flowRows = t.exercises.map((e) => ({ ...e, sets: e.plannedSets }));
  const restFor = templateRestFor(t);
  const flow = supersetFlow(flowRows);
  say(`   ${t.name}:`);
  flow.forEach((s, k) => {
    const r = restAfterSetInFlow(flowRows, s.exerciseIndex, s.setIndices[s.setIndices.length - 1], restFor);
    const ex = t.exercises[s.exerciseIndex];
    const side = ex.plannedSets[s.setIndices[0]]?.label;
    const nextName = flow[k + 1] ? t.exercises[flow[k + 1].exerciseIndex].name : 'end';
    say(`      ${(s.label ?? '').padEnd(3)} ${ex.name} ${side ? `${side} ` : ''}c${s.unit + 1}   → ${r.kind} ${r.seconds} s → ${nextName}`);
  });
}

// ── 3. estimates ──
say('\n3. Session estimates (core estimateTemplateDuration — what the app shows)');
for (const [i, t] of after.entries()) {
  const eb = estimateTemplateDuration(liveBefore[i], musclesOf);
  const ea = estimateTemplateDuration(t, musclesOf);
  const liftB = eb.minutes - Math.round(eb.cardioSec / 60);
  say(`   ${t.name.padEnd(9)} shown ${eb.minutes} → ${ea.minutes} min · lifting only ${liftB} → ${ea.minutes} (${ea.minutes - liftB >= 0 ? '+' : ''}${ea.minutes - liftB}) · work ${mmss(eb.clustersSec)} → ${mmss(ea.clustersSec)} · rest ${mmss(eb.restSec)} → ${mmss(ea.restSec)} · Zone 2 ${mmss(eb.cardioSec)} → ${mmss(ea.cardioSec)}`);
}

// ── 4. volume vs targets ──
say('\n4. Planned per rotation (core plannedVolume; an L/R pair is one cluster) vs the v2.4 targets');
const vb = new Map(plannedVolume(liveBefore, catalog).map((m) => [m.muscle, m]));
const va = new Map(plannedVolume(after, catalogAfter).map((m) => [m.muscle, m]));
say(`   ${'muscle'.padEnd(11)} ${'direct'.padStart(13)} ${'fractional'.padStart(14)}  target  ≈ sets (est.)  flag`);
for (const m of ['chest', 'back', 'quads', 'hamstrings', 'calves', 'sideDelt', 'rearDelt', 'biceps', 'triceps', 'abs', 'frontDelt', 'glutes'] as const) {
  const b = vb.get(m)!; const a = va.get(m)!;
  const tgt = TARGETS[m];
  // RDL is the only straight-set lift: its sets count ×1, clusters ×1.5.
  const straight = after.flatMap((t) => t.exercises).filter((r) => r.plannedSets.some((s) => s.kind === 'working') && (musclesOf(r.exerciseId)?.[0] === m)).reduce((n, r) => n + r.plannedSets.filter((s) => s.kind === 'working').length, 0);
  const est = (a.direct - straight) * 1.5 + straight;
  const flag = tgt == null ? '' : a.direct < tgt ? 'UNDER' : a.direct === tgt ? 'on target' : `+${a.direct - tgt}`;
  say(`   ${m.padEnd(11)} ${`${b.direct}→${a.direct}`.padStart(13)} ${`${b.fractional}→${a.fractional}`.padStart(14)}  ${String(tgt ?? '—').padStart(6)}  ${String(est).padStart(13)}  ${flag}`);
}

// ── 5. engine ──
say('\n5. Engine — next call on each new/changed row (core sessionCall, v2.4 catalog + baselines)');
for (const t of after) for (const r of t.exercises) {
  if (!rebase.get(t.id!)!.has(r.exerciseId)) continue;
  const call = sessionCall(r, completed, engineCat(r.exerciseId));
  const calls = call.sides ? Object.entries(call.sides).map(([sd, c]) => ({ sd, ...c! })) : [{ sd: '', ...call }];
  for (const { sd, rec, basedOn } of calls) say(`   ${t.name.padEnd(9)} ${r.name.padEnd(40)}${sd ? ` ${sd}` : '  '} ${rec.action} ${rec.load ?? '—'} (${kindOf(rec)})${basedOn ? ` from ${calendarDateKey(basedOn)}` : ''}`);
}

// ── 6. sample export ──
say('\n6. Sample export — the new/changed rows (core buildCsv)');
const effortStandards = Object.fromEntries(catalogAfter.map((c) => [c.id!, c.effortStandard]));
const csv = buildCsv({ logs: [], measurements: [], dailyWeights: {}, dailyWater: {}, dailySleep: {}, templates: after, effortStandards });
const [head, ...lines] = csv.split(/\r?\n/);
const cols = head.split(',');
const want = ['template', 'exercise', 'load', 'clusters', 'side', 'effortStandard', 'supersetBlock', 'supersetOrder', 'templateVersion', 'notes'];
const cells = (l: string) => (l.match(/("([^"]|"")*"|[^,]*)(,|$)/g) ?? []).map((c) => c.replace(/,$/, '').replace(/^"|"$/g, '').replace(/""/g, '"'));
say(`   ${want.join(',')}`);
const names = new Set(after.flatMap((t) => t.exercises.filter((r) => rebase.get(t.id!)!.has(r.exerciseId)).map((r) => r.name)));
for (const l of lines.filter((x) => x.startsWith('template,'))) {
  const c = cells(l);
  if (!names.has(c[cols.indexOf('exercise')] ?? '')) continue;
  say(`   ${want.map((w) => { const v = c[cols.indexOf(w)] ?? ''; return v.includes(',') ? `"${v}"` : v; }).join(',')}`);
}

// ── 7. untouched ──
say('\n7. Read only — not touched');
for (const [id] of otherTplBefore) say(`   template ${id} "${allTplSnap.docs.find((d) => d.id === id)!.get('name')}"`);
for (const d of draftSnap.docs) say(`   draft ${d.id} "${d.get('label')}" status=${d.get('status')} draftOf=${d.get('draftOf')}`);

// ── backup + write ──
const dir = join(homedir(), 'ignia-backups');
const backup = join(dir, `owner-data-2026-11-06-program-v2-4-${stamp.replace(/[:.]/g, '-')}.json`);
say(`\n8. Backup: ${APPLY ? '' : '(would write) '}${backup}`);
say(`\nSUMMARY: ${rowCount} template row(s) changed in ${changedIds.size} template(s) [${[...changedIds].map((id) => raw.get(id)!.name).join(', ') || 'none'}] + ${catalogWrites.length} catalog write(s); 0 drafts, 0 sessions, 0 travel templates.`);
console.log(out.join('\n'));

if (!APPLY) { console.log(`\nDry run. --apply to write (effective ${SINCE}; targets from the week of ${TARGETS_FROM}).`); process.exit(0); }
if (changedIds.size === 0 && catalogWrites.length === 0) { console.log('\nNothing to do (already applied).'); process.exit(0); }

const conv = (v: unknown): unknown => {
  if (v instanceof Timestamp) return v.toDate().toISOString();
  if (Array.isArray(v)) return v.map(conv);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, conv(x)]));
  return v;
};
mkdirSync(dir, { recursive: true });
writeFileSync(backup, JSON.stringify(conv({
  uid,
  templates: Object.fromEntries(TPL_IDS.map((id) => [id, raw.get(id)])),
  exercises: Object.fromEntries(catalogWrites.filter((w) => !w.create).map((w) => [w.id, exDocs.get(w.id)!.data()])),
}), null, 1));
if (!existsSync(backup)) throw new Error(`backup ${backup} not written — refusing to write`);
console.log(`backup written: ${backup}`);

const batch = db.batch();
for (const id of changedIds) {
  const t = next.get(id)!;
  batch.update(user.collection('workoutTemplates').doc(id), {
    exercises: JSON.parse(JSON.stringify(t.exercises)), notes: t.notes, templateVersion: VERSION, cardioBlocks: FieldValue.delete(), updatedAt: Timestamp.fromDate(now),
  });
}
for (const w of catalogWrites) {
  if (w.create) batch.set(user.collection('exercises').doc(w.id), w.patch);
  else batch.update(user.collection('exercises').doc(w.id), w.patch);
}
await batch.commit();

const check = await user.collection('workoutTemplates').get();
for (const [id, before] of otherTplBefore) {
  if (JSON.stringify(check.docs.find((d) => d.id === id)?.data()) !== before) throw new Error(`template ${id} changed — it must not`);
}
for (const id of changedIds) {
  const t = toWorkoutTemplate(id, check.docs.find((d) => d.id === id)!.data());
  console.log(`written ${t.name} [${t.templateVersion}]: ${t.exercises.map((r) => `${blockOf(r)} ${r.name} ${shape(r)}@${r.targetLoad}`).join(' · ')} — ${estimateTemplateDuration(t, musclesOf).minutes} min`);
}
console.log(`written ${catalogWrites.length} catalog write(s); travel templates unchanged`);
