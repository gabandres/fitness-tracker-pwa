/**
 * The owner's Program v2.1 (2026-10-15): Push, Pull and Leg Day move to the
 * v2.1 spec the owner wrote that day. DRY RUN unless `--apply`; re-runs are
 * no-ops; every document it would touch is backed up first (on `--apply`).
 *
 *   PUSH  A: DB Flat Press ×2 (25) ↔ Weighted Floor Crunch ×2 (30)
 *         B: Incline DB Press ×2 (20) ↔ Single-leg DB calf raise ×2 L/R (30)
 *         Seated DB Shoulder Press (80) · Deficit Push-up
 *         C: Overhead DB Extension ×1 (35) → DB Lateral Raise ×2 (15, drop 10
 *            on the last cluster) → Skull Crusher ×1 (15) — already live from
 *            `owner-data-2026-10-15-push-superset-c.mts`; structure untouched,
 *            Skull Crusher's 10/15 baseline untouched.
 *   PULL  Neutral-grip pull-up · Seated Machine Row ×2 (100, HELD: pending
 *         v2.1 baseline) · Wide-grip lat pulldown (90) · Chest-supported DB row (35)
 *         superset: Incline DB Curl 45° ×1 (17.5) → Rear delt DB flye ×2 (17.5)
 *                   → DB hammer curl ×1 (20, "3 s lowering")
 *   LEG   Smith squat ×2 (35) · DB Romanian deadlift ×2 (40)
 *         superset: Leg Extensions ×1 (90) → Leg Curls ×2 (100, "seated machine
 *                   preferred — Maeo 2021") → Hanging Knee Raise ×1 (BW)
 *   All:  Zone 2 unchanged; switch 30 s / round 30 s on every block leader.
 *
 * Baselines: a row whose CONTEXT changes (core `contextChanges`: superset /
 * position), whose cluster count grows, or that the owner named (the machine
 * row) gets `{ since: 2026-10-16, reason: "context changed: v2.1" }` — PENDING
 * (load-flags reads `since > today` as pending) until the template's first
 * v2.1 session, which is on or after 10/16 because 10/15's Push is done. The
 * drop-back floor is core `contextBaseline`'s. A load change (calf 25→30,
 * shoulder press 70→80, overhead extension 30→35) ALSO gets it — the owner's
 * "each changed lift" (2026-10-15) — and a `loadLog` entry by `prompt`, so
 * `honourLifterLoad` holds the owner's load.
 *
 * Catalog: `effortStandard` per the owner's list (rir1 for the nine
 * compounds, failure for every other lift in the three templates), and each
 * row's FIRST cue states it ("RIR 1 — stop 1 rep short" / "RIR 0 — to
 * failure"); an older cue that states an effort target is removed (its
 * non-effort part kept as its own cue where the owner asked), and cues v2.1
 * makes false are removed (`FALSE_CUES`).
 *
 * Template drafts (`templateDrafts`) are read and reported, never written.
 *
 *   npx jiti scripts/owner-data-2026-10-15-program-v2-1.mts --email gabrielandresbermudez@gmail.com [--apply]
 *
 * Auth: ADC (`gcloud auth application-default login`).
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import type { Exercise, PlannedSet, TemplateExercise, WorkoutTemplate } from '../packages/core/src/workout.ts';
import {
  calendarDateKey,
  clusterCount,
  contextBaseline,
  contextChanges,
  creditsFor,
  dumbbellStepLb,
  estimateTemplateDuration,
  nextLoad,
  normalizeSupersets,
  plannedVolume,
  resolveEngineConfig,
  restAfterSetInFlow,
  rotationVolume,
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
const DAY = '2026-10-15';
const SINCE = '2026-10-16';
const REASON = 'context changed: v2.1';
const LOAD_REASON = `Program v2.1 (owner, ${DAY})`;
const RIR1_CUE = 'RIR 1 — stop 1 rep short';
const FAIL_CUE = 'RIR 0 — to failure';
const EFFORT_CUES = new Set([RIR1_CUE, FAIL_CUE]);
/** "States an effort target": mentions RIR or failure … */
const EFFORT_RE = /\bRIR\b|failure/i;
/** … except these, which mention it without prescribing one (a logging
 *  instruction; a dated history of a collapsed cluster). Kept. */
const NOT_A_TARGET = [
  'LOG RIR ON THE ACTIVATION.',
  'ONE cluster. Cluster 2 at 50 collapsed to 6 @ RIR 0',
];
/** A removed effort-target cue whose OTHER content stays, as its own cue
 *  (owner, 2026-10-15). A removed cue not listed here goes entirely. */
const KEEP_PART: Record<string, string> = {
  "SPLIT-CLUSTER RULE: both activations must earn it before adding load. The band is derived per lift now - wait for the app's call, not a fixed 11-12. RIR 1 stays here (lumbar).":
    "SPLIT-CLUSTER RULE: both activations must earn it before adding load. The band is derived per lift now - wait for the app's call, not a fixed 11-12.",
  'Take it to failure (RIR 0). The 9/2 set at RIR 5 is an unreadable progression input. NO drop set here - the lift only just returned, keep the read clean.':
    'NO drop set.',
  'NEW 9/15. START LIGHT - the first session is calibration, not a progression read. Target 10-12 reps @ RIR 1-2 on the activation. NO drop set.':
    'NO drop set.',
};
/** Cues v2.1 makes FALSE (owner, 2026-10-15): the superset is a real field
 *  now, and RDL / Leg Curls / Rear Delt / the Push supersets have 2 clusters. */
const FALSE_CUES = new Set([
  'SUPERSET with leg curl - alternate. The app has no superset field, so pair them by hand.',
  'SUPERSET with leg extension - alternate. The app has no superset field, so pair them by hand.',
  'Main compound - the only 2-cluster lift on legs.',
  'Main compound - the only 2-cluster lift on pull.',
  'Main compound - the only 2-cluster lift on push.',
]);

const PUSH = 'Nx1bxeRuH6bMnGgX7Trv';
const PULL = 'aliWJBD2FND6mU9foLdC';
const LEG = 'quxwARQlCnItzpLJgcr4';

type Effort = 'rir1' | 'failure';
interface Spec {
  /** The owner's name for the lift. */
  spec: string;
  id: string;
  clusters: number;
  load: number;
  /** A local block key; the app re-letters blocks A, B, C… per template. */
  block?: string;
  effort: Effort;
  /** Cues appended after the kept ones (the owner's row notes). */
  note?: string;
  /** The owner named this row for a pending v2.1 baseline. */
  hold?: true;
}
const S = (spec: string, id: string, clusters: number, load: number, effort: Effort, more: Partial<Spec> = {}): Spec =>
  ({ spec, id, clusters, load, effort, ...more });

const SPEC: Record<string, { name: string; note: string; rows: Spec[] }> = {
  [PUSH]: {
    name: 'Push Day',
    note: `${DAY} - Program v2.1 (owner): A Flat DB Press ×2 (25) ↔ Weighted Floor Crunch ×2 (30); B Incline DB Press ×2 (20) ↔ Single-leg calf raise ×2 L/R (30); Seated DB Shoulder Press 80; Deficit Push-up; C OHE ×1 (35) → Lateral ×2 (15, drop 10 last cluster) → Skull Crusher ×1 (15); Zone 2. Loads changed (calf 25→30, shoulder press 70→80, OHE 30→35): baseline "${REASON}" from the first v2.1 Push (on/after ${SINCE}); C structure and Skull Crusher's 10/15 baseline unchanged. Effort: presses rir1, the rest RIR 0.`,
    rows: [
      S('Flat DB Press', 'ud6fE363QklE3qXYxLw3', 2, 25, 'rir1', { block: 'A' }),
      S('Weighted Floor Crunch', 'x3G0Speg04GclIOdKHAl', 2, 30, 'failure', { block: 'A' }),
      S('Incline DB Press', 'ngF9959fQPGTYUHXpigC', 2, 20, 'rir1', { block: 'B' }),
      S('Single-leg DB Calf Raise', 'm5E72J63gVXltnQ0zC8f', 2, 30, 'failure', { block: 'B' }),
      S('Seated DB Shoulder Press', 'He4o7qVWRftiPneaXjiV', 1, 80, 'rir1'),
      S('Deficit Push-up', 'Zqb1sTIfs0olSLeDFlx1', 1, 0, 'failure'),
      S('Overhead DB Extension', 'AAHHWXTA7UtbNWZbcf7z', 1, 35, 'failure', { block: 'C' }),
      S('DB Lateral Raise', 'BGyAEJU6i5nN6AjXRU1g', 2, 15, 'failure', { block: 'C' }),
      S('Skull Crusher', 'EyDTWnfO4WrbYDbDkxrk', 1, 15, 'failure', { block: 'C' }),
    ],
  },
  [PULL]: {
    name: 'Pull Day',
    note: `${DAY} - Program v2.1 (owner): pull-up · Seated Machine Row ×2 (100, held - pending v2.1 baseline) · lat pulldown 90 · chest-supported row 35 · superset Incline DB Curl 45° ×1 (17.5) → Rear Delt DB Flye ×2 (17.5) → DB Hammer Curl ×1 (20, 3 s lowering): INC → RD c1 → HAMMER → RD c2, switch 30 / round 30; Zone 2. Baseline "${REASON}" from the first v2.1 Pull (on/after ${SINCE}). Effort: pulls rir1, curls and flye RIR 0.`,
    rows: [
      S('Neutral-grip Pull-up', 'GOGOcWJNC9q9aBmN3ENq', 1, 0, 'rir1'),
      S('Seated Machine Row', '9x3b6rmxlxJyWWSMat3w', 2, 100, 'rir1', { hold: true }),
      S('Wide-grip Lat Pulldown', 'oxOuktVhb6Ghgg7hGkCk', 1, 90, 'rir1'),
      S('Chest-supported DB Row', 'acs1BlQvTZdL97i5jXJv', 1, 35, 'rir1'),
      S('Incline DB Curl 45°', 'MVC1wLKBkRz7XYyKp79e', 1, 17.5, 'failure', { block: 'D' }),
      S('Rear Delt DB Flye', 'v2uqmVt1K4fJd0d6t4De', 2, 17.5, 'failure', { block: 'D' }),
      S('DB Hammer Curl', 'LvVitCaOS23MmPTKodlk', 1, 20, 'failure', { block: 'D', note: '3 s lowering' }),
    ],
  },
  [LEG]: {
    name: 'Leg Day',
    note: `${DAY} - Program v2.1 (owner): Smith squat ×2 (35) · DB RDL ×2 (40, was 1) · superset Leg Extension ×1 (90) → Leg Curl ×2 (100, was 1; seated machine preferred - Maeo 2021) → Hanging Knee Raise ×1 (BW): EXT → CURL c1 → KNEE RAISE → CURL c2, switch 30 / round 30; Zone 2. Baseline "${REASON}" from the first v2.1 Leg (on/after ${SINCE}). Effort: squat and RDL rir1, the rest RIR 0.`,
    rows: [
      S('Smith Squat', 'eKW1qiIDpvfnSECIxSUn', 2, 35, 'rir1'),
      S('DB Romanian Deadlift', 'vtSvqglnBZdM1f3qOJi4', 2, 40, 'rir1'),
      S('Leg Extension', 'hXvPQM7Dv6YvScYW7h2l', 1, 90, 'failure', { block: 'D' }),
      S('Leg Curl', 'jZWYnikrGcdRG1adHXJ0', 2, 100, 'failure', { block: 'D', note: 'Seated machine preferred — Maeo 2021' }),
      S('Hanging Knee Raise', '8WVjS3nPucY5nQUC6lHM', 1, 0, 'failure', { block: 'D' }),
    ],
  },
};
const TPL_IDS = [PUSH, PULL, LEG];

const args = process.argv.slice(2);
const email = args[args.indexOf('--email') + 1];
const APPLY = args.includes('--apply');
if (!email || email.startsWith('--')) throw new Error('--email is required');

initializeApp({ credential: applicationDefault(), projectId: PROJECT_ID });
const db = getFirestore();
const uid = (await getAuth().getUserByEmail(email)).uid;
const user = db.doc(`users/${uid}`);
const now = new Date();
const stamp = now.toISOString();

const [profileSnap, exSnap, sesSnap, draftSnap, ...tplSnaps] = await Promise.all([
  user.get(),
  user.collection('exercises').get(),
  user.collection('workoutSessions').get(),
  user.collection('templateDrafts').get(),
  ...TPL_IDS.map((id) => user.collection('workoutTemplates').doc(id).get()),
]);
for (const s of tplSnaps) if (!s.exists) throw new Error(`template ${s.id} not found`);

type Row = TemplateExercise & Record<string, unknown>;
type RawTpl = { name: string; notes?: string; exercises: Row[] } & Record<string, unknown>;
const raw = new Map(tplSnaps.map((s) => [s.id, s.data() as RawTpl]));
const exDocs = new Map(exSnap.docs.map((d) => [d.id, d]));
const catalog: Exercise[] = exSnap.docs.map((d) => toWorkoutExercise(d.id, d.data()));
const catOf = (id: string) => catalog.find((c) => c.id === id);
const musclesOf = (id: string) => catOf(id)?.muscles;
const dbStep = dumbbellStepLb(profileSnap.get('dumbbellHalfSteps') as boolean | undefined);
const engineCat = (id: string) => { const c = catOf(id); return c ? { ...c, dumbbellStepLb: dbStep } : null; };
const sessions = sesSnap.docs.map((d) => toWorkoutSession(d.id, d.data()));
const completed = sessions.filter((s) => s.status === 'completed').sort((a, b) => b.date.getTime() - a.date.getTime());
const liveBefore: WorkoutTemplate[] = TPL_IDS.map((id) => toWorkoutTemplate(id, raw.get(id)!));

const out: string[] = [];
const say = (s = '') => out.push(s);
const unmapped: string[] = [];

// ── 0. the owner's names → catalog ──
say(`${APPLY ? 'APPLY' : 'DRY RUN'} — uid ${uid} — ${stamp}`);
say(`dumbbell step: ${dbStep} lb (profile dumbbellHalfSteps = ${JSON.stringify(profileSnap.get('dumbbellHalfSteps'))})`);
say('\n0. Owner name → catalog exercise');
for (const id of TPL_IDS) {
  for (const sp of SPEC[id].rows) {
    const c = catOf(sp.id);
    if (!c) { unmapped.push(`${sp.spec}: catalog id ${sp.id} missing`); continue; }
    if (!raw.get(id)!.exercises.some((r) => r.exerciseId === sp.id)) unmapped.push(`${sp.spec}: not in live ${SPEC[id].name}`);
    say(`   ${sp.spec.padEnd(26)} → ${c.name} (${sp.id}) [${c.muscles.join(', ')}]${c.availableLoads ? ` stack ${c.availableLoads.join('/')}` : ''}`);
  }
}
if (unmapped.length) { say(`\nUNMAPPED — refusing:\n   ${unmapped.join('\n   ')}`); console.log(out.join('\n')); process.exit(1); }

// ── helpers ──
const activationGroups = (sets: readonly PlannedSet[]) =>
  [...new Set(sets.filter((s) => s.kind === 'activation').map((s) => s.group ?? 0))];
/** Grow to `n` clusters by repeating cluster 1's shape (activation + its
 *  minis). A drop stays on the LAST cluster. Never shrinks. */
function withClusters(sets: readonly PlannedSet[], n: number): PlannedSet[] {
  const groups = activationGroups(sets);
  if (groups.length > n) throw new Error(`would shrink clusters ${groups.length} → ${n}`);
  if (groups.length === n) return sets as PlannedSet[];
  const first = sets.filter((s) => s.group === groups[0] && s.kind !== 'drop').map((s) => ({ ...s }));
  const drops = sets.filter((s) => s.kind === 'drop');
  const body = sets.filter((s) => s.kind !== 'drop').map((s) => ({ ...s }));
  for (let g = groups.length + 1; g <= n; g++) body.push(...first.map((s) => ({ ...s, group: g })));
  return [...body, ...drops.map((d) => ({ ...d, group: n }))];
}
const isEffortCue = (c: string) => EFFORT_RE.test(c) && !NOT_A_TARGET.some((p) => c.startsWith(p));
function cuesFor(row: Row, sp: Spec): { cues: string[]; removed: string[]; rewritten: string[]; falseRemoved: string[]; keptMention: string[] } {
  const base = row.cues ?? catOf(sp.id)?.defaultCues ?? [];
  const want = sp.effort === 'rir1' ? RIR1_CUE : FAIL_CUE;
  const removed = base.filter((c) => !EFFORT_CUES.has(c) && isEffortCue(c));
  const rewritten = removed.filter((c) => KEEP_PART[c]).map((c) => KEEP_PART[c]);
  const falseRemoved = base.filter((c) => FALSE_CUES.has(c));
  const keptMention = base.filter((c) => !EFFORT_CUES.has(c) && EFFORT_RE.test(c) && !isEffortCue(c));
  const rest: string[] = [];
  for (const c of base) {
    if (EFFORT_CUES.has(c) || FALSE_CUES.has(c)) continue;
    const keep = isEffortCue(c) ? KEEP_PART[c] : c; // the kept part, in place
    if (keep && !rest.includes(keep)) rest.push(keep);
  }
  if (sp.note && !rest.includes(sp.note)) rest.push(sp.note);
  return { cues: [want, ...rest], removed, rewritten, falseRemoved, keptMention };
}
/** Key-order-independent JSON, so a rebuilt row that equals the live one is
 *  recognised as unchanged (that is what makes a re-run a no-op). */
const stable = (v: unknown): string => {
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v).filter((k) => (v as Record<string, unknown>)[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${stable((v as Record<string, unknown>)[k])}`).join(',')}}`;
  return JSON.stringify(v);
};
const strip = (r: Row) => { const { lastModifiedAt: _a, lastModifiedBy: _b, ...x } = r; return stable(x); };
const blockOf = (r: TemplateExercise) => (r.supersetGroup ? `${r.supersetGroup}${r.pairPosition}` : '—');
const fmtBase = (b?: TemplateExercise['baseline']) => (b ? `${b.since} "${b.reason}"${b.dropBackTo != null ? ` drop→${b.dropBackTo} <${b.dropBackBelowReps}` : ''}` : '—');
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

// ── 1. build each template ──
const next = new Map<string, RawTpl>();
const changedIds = new Set<string>();
const cueReport: string[] = [];
const whyById = new Map<string, string>();
let rowCount = 0;
for (const id of TPL_IDS) {
  const cur = raw.get(id)!;
  const spec = SPEC[id];
  // Rows the spec does not name would be DROPPED — refuse instead.
  const extra = cur.exercises.filter((r) => !spec.rows.some((sp) => sp.id === r.exerciseId));
  if (extra.length) throw new Error(`${spec.name}: live rows not in the spec: ${extra.map((r) => r.name).join(', ')}`);
  const leaders = new Set<string>();
  let rows: Row[] = spec.rows.map((sp) => {
    const r = structuredClone(cur.exercises.find((e) => e.exerciseId === sp.id)!) as Row;
    r.plannedSets = withClusters(r.plannedSets, sp.clusters);
    if (sp.block) {
      r.supersetGroup = sp.block;
      const lead = !leaders.has(sp.block);
      leaders.add(sp.block);
      r.pairPosition = undefined as never;
      if (lead) { r.transitionRestSec = 30; r.roundRestSec = 30; }
    } else {
      delete r.supersetGroup; delete r.pairPosition; delete r.transitionRestSec; delete r.roundRestSec;
    }
    if (r.targetLoad !== sp.load) {
      r.loadLog = [...(r.loadLog ?? []), { at: stamp, ...(r.targetLoad != null ? { from: r.targetLoad } : {}), to: sp.load, by: 'prompt', reason: LOAD_REASON }];
      r.targetLoad = sp.load;
    }
    const cu = cuesFor(r, sp);
    if (JSON.stringify(cu.cues) !== JSON.stringify(r.cues ?? null)) {
      cueReport.push(`   ${spec.name} · ${r.name}\n      before: ${JSON.stringify(r.cues ?? `(none — catalog default ${JSON.stringify(catOf(sp.id)?.defaultCues ?? [])})`)}\n      after:  ${JSON.stringify(cu.cues)}${cu.removed.length ? `\n      removed (effort target): ${JSON.stringify(cu.removed)}` : ''}${cu.rewritten.length ? `\n      kept part, as its own cue: ${JSON.stringify(cu.rewritten)}` : ''}${cu.falseRemoved.length ? `\n      removed (false under v2.1): ${JSON.stringify(cu.falseRemoved)}` : ''}${cu.keptMention.length ? `\n      kept (mentions RIR/failure, not a target): ${JSON.stringify(cu.keptMention)}` : ''}`);
    }
    r.cues = cu.cues;
    return r;
  });
  // Pair positions in spec order; then the canonical form every writer saves.
  const pos = new Map<string, number>();
  rows = rows.map((r) => {
    if (!r.supersetGroup) return r;
    const p = (pos.get(r.supersetGroup) ?? 0) + 1;
    pos.set(r.supersetGroup, p);
    return { ...r, pairPosition: p as 1 | 2 | 3 };
  });
  rows = normalizeSupersets(rows);
  // Baselines: core's context changes, a grown cluster count, a load change
  // (owner: "each changed lift"), the owner's hold.
  const ctx = contextChanges(liveBefore, { id, exercises: rows });
  rows = rows.map((r) => {
    const sp = spec.rows.find((x) => x.id === r.exerciseId)!;
    const old = cur.exercises.find((e) => e.exerciseId === r.exerciseId)!;
    const grew = clusterCount(r.plannedSets, false) > clusterCount(old.plannedSets, false);
    const loadMoved = r.targetLoad !== old.targetLoad;
    const why = [...(ctx.get(r.exerciseId) ?? []), ...(grew ? ['clusters'] : []), ...(loadMoved ? ['load'] : []), ...(sp.hold ? ['owner: hold'] : [])];
    if (why.length === 0 || r.baseline?.reason === REASON) return r;
    const b = contextBaseline(['superset'], { since: SINCE, load: r.targetLoad, catalog: engineCat(r.exerciseId), row: r });
    whyById.set(r.exerciseId, why.join('+'));
    return { ...r, baseline: { ...b, reason: REASON } };
  });
  rows = rows.map((r) => {
    const old = cur.exercises.find((e) => e.exerciseId === r.exerciseId)!;
    return strip(r) === strip(old) ? old : ({ ...r, lastModifiedAt: stamp, lastModifiedBy: 'prompt' } as Row);
  });
  rowCount += rows.filter((r) => r !== cur.exercises.find((e) => e.exerciseId === r.exerciseId)).length;
  const notes = cur.notes?.includes(`${DAY} - Program v2.1`) ? cur.notes : `${cur.notes ?? ''}\n${spec.note}`.trim();
  const order = (xs: Row[]) => xs.map((r) => r.exerciseId).join();
  const rowsChanged = order(rows) !== order(cur.exercises) || rows.some((r, i) => r !== cur.exercises.find((e) => e.exerciseId === r.exerciseId) || false);
  if (rowsChanged || notes !== cur.notes) changedIds.add(id);
  next.set(id, { ...cur, exercises: rows, notes });

  // ── report: before → after ──
  say(`\n1. ${spec.name} (${id}) — ${rowsChanged ? 'CHANGES' : 'rows unchanged'}${notes !== cur.notes ? ' + dated notes line' : ''}`);
  say('   BEFORE');
  cur.exercises.forEach((r, i) => say(`   ${i + 1}. ${blockOf(r).padEnd(3)} ${r.name.padEnd(26)} ×${clusterCount(r.plannedSets, false)}  ${String(r.targetLoad ?? '—').padStart(5)}  base ${fmtBase(r.baseline)}`));
  say('   AFTER');
  rows.forEach((r, i) => {
    const old = cur.exercises.find((e) => e.exerciseId === r.exerciseId)!;
    const d: string[] = [];
    if (cur.exercises.indexOf(old) !== i) d.push(`pos ${cur.exercises.indexOf(old) + 1}→${i + 1}`);
    if (blockOf(old) !== blockOf(r)) d.push(`block ${blockOf(old)}→${blockOf(r)}`);
    const [co, cn] = [clusterCount(old.plannedSets, false), clusterCount(r.plannedSets, false)];
    if (co !== cn) d.push(`clusters ${co}→${cn}`);
    if (old.targetLoad !== r.targetLoad) d.push(`load ${old.targetLoad}→${r.targetLoad} (loadLog +prompt)`);
    if (JSON.stringify(old.baseline) !== JSON.stringify(r.baseline)) d.push(`BASELINE (${whyById.get(r.exerciseId) ?? '?'})`);
    if (JSON.stringify(old.cues) !== JSON.stringify(r.cues)) d.push('cues');
    if (r.transitionRestSec != null && (old.transitionRestSec !== r.transitionRestSec || old.roundRestSec !== r.roundRestSec)) d.push(`switch ${r.transitionRestSec}/round ${r.roundRestSec}`);
    say(`   ${i + 1}. ${blockOf(r).padEnd(3)} ${r.name.padEnd(26)} ×${cn}  ${String(r.targetLoad ?? '—').padStart(5)}  base ${fmtBase(r.baseline)}${d.length ? `   ← ${d.join('; ')}` : ''}`);
    const labels = r.plannedSets.filter((s) => s.kind === 'activation' && s.label).map((s) => s.label);
    const drops = r.plannedSets.filter((s) => s.kind === 'drop').map((s) => `drop ${s.weight} on cluster ${s.group}`);
    if (labels.length || drops.length) say(`         ${[labels.length ? `clusters ${labels.join('/')}` : '', ...drops].filter(Boolean).join(' · ')}`);
  });
  const ctxLine = [...ctx].map(([eid, c]) => `${rows.find((r) => r.exerciseId === eid)?.name}: ${c.join('/')}`);
  say(`   core contextChanges: ${ctxLine.length ? ctxLine.join('; ') : 'none'}`);
}

// ── 1b. cues ──
say('\n1b. Cues (effort cue first; older effort-target cues removed; owner notes appended)');
cueReport.forEach((l) => say(l));

// ── 1c. catalog effortStandard ──
say('\n1c. Catalog effortStandard');
const effortWrites: { id: string; to: Effort }[] = [];
for (const id of TPL_IDS) for (const sp of SPEC[id].rows) {
  const c = catOf(sp.id)!;
  const was = c.effortStandard;
  if (was === sp.effort) say(`   ${c.name.padEnd(26)} ${sp.effort} (already)`);
  else { effortWrites.push({ id: sp.id, to: sp.effort }); say(`   ${c.name.padEnd(26)} ${was ?? '(absent → reads failure)'} → ${sp.effort}`); }
}

// ── 2. superset sequences + guardrails ──
const after = TPL_IDS.map((id) => toWorkoutTemplate(id, next.get(id)!));
say('\n2. Superset blocks — performed sequence (core supersetFlow) and guardrails (core supersetWarnings)');
for (const t of after) {
  const flowRows = t.exercises.map((e) => ({ ...e, sets: e.plannedSets }));
  const restFor = templateRestFor(t);
  const flow = supersetFlow(flowRows);
  const groups = [...new Set(flow.filter((s) => s.group).map((s) => s.group!))];
  for (const g of groups) {
    say(`   ${t.name} block ${g}:`);
    const steps = flow.map((s, k) => ({ s, k })).filter((x) => x.s.group === g);
    for (const { s, k } of steps) {
      const r = restAfterSetInFlow(flowRows, s.exerciseIndex, s.setIndices[s.setIndices.length - 1], restFor);
      const drop = s.setIndices.some((i) => flowRows[s.exerciseIndex].sets[i].kind === 'drop') ? ' + drop' : '';
      const nextName = flow[k + 1] ? t.exercises[flow[k + 1].exerciseIndex].name : 'Zone 2 / end';
      say(`      ${s.label} ${t.exercises[s.exerciseIndex].name} cluster ${s.unit + 1}${drop}   → ${r.kind} ${r.seconds} s → ${nextName}`);
    }
    const w = supersetWarnings(flowRows, (id) => musclesOf(id) ?? [], undefined, restFor).find((x) => x.group === g)!;
    for (const p of w.pairs) {
      const sp = p.spacing;
      const v = p.judgement.kind === 'same-muscle' ? ` → ${sameMuscleVerdict(sp)}` : '';
      say(`      guardrail ${t.exercises[p.a].name} + ${t.exercises[p.b].name}: ${p.judgement.kind}${p.judgement.muscle ? ` (${p.judgement.muscle})` : ''}${sp ? (sp.adjacent ? ' — adjacent' : ` — separated by ${sp.between.map((x) => t.exercises[x].name).join(', ')}, ~${sp.gapSec} s`) : ''}${v}`);
    }
    for (const n of w.neighbours ?? []) say(`      neighbour: ${t.exercises[n.neighbour].name} next to ${t.exercises[n.member].name} — same ${n.muscle}`);
    if (!(w.neighbours ?? []).length) say('      neighbours: no same-primary straight lift right before/after the block');
  }
}

// ── 3. estimates ──
say('\n3. Session estimates (core estimateTemplateDuration)');
for (const [i, t] of after.entries()) {
  const eb = estimateTemplateDuration(liveBefore[i], musclesOf);
  const ea = estimateTemplateDuration(t, musclesOf);
  say(`   ${t.name.padEnd(9)} ${eb.minutes} → ${ea.minutes} min   (clusters ${mmss(eb.clustersSec)} → ${mmss(ea.clustersSec)} · rest ${mmss(eb.restSec)} → ${mmss(ea.restSec)} · warm-up ${mmss(ea.warmupSec)} · Zone 2 ${mmss(ea.cardioSec)})`);
}

// ── 4. volume ──
say('\n4. Planned fractional clusters per muscle per rotation (core plannedVolume — the sheet\'s "planned" column)');
const vb = new Map(plannedVolume(liveBefore, catalog).map((m) => [m.muscle, m]));
const va = new Map(plannedVolume(after, catalog).map((m) => [m.muscle, m]));
const rot = new Map(rotationVolume(sessions, catalog, TPL_IDS).week.map((m) => [m.muscle, m]));
say(`   ${'muscle'.padEnd(11)} ${'before'.padStart(7)} ${'after'.padStart(7)}   (direct b→a)   last rotation logged`);
for (const m of ['chest', 'frontDelt', 'sideDelt', 'rearDelt', 'triceps', 'back', 'biceps', 'quads', 'hamstrings', 'glutes', 'calves', 'abs'] as const) {
  const b = vb.get(m)!; const a = va.get(m)!;
  say(`   ${m.padEnd(11)} ${String(b.fractional).padStart(7)} ${String(a.fractional).padStart(7)}${a.fractional !== b.fractional ? ' *' : '  '}  (${b.direct}→${a.direct})          ${rot.get(m)?.fractional ?? 0}`);
}
say('   credits used:');
for (const id of [...new Set(after.flatMap((t) => t.exercises.map((e) => e.exerciseId)))]) {
  const c = catOf(id)!;
  say(`      ${c.name.padEnd(26)} [${c.muscles.join(',')}] → ${creditsFor(c.name, c.muscles).map((x) => `${x.muscle} ${x.weight}`).join(', ')}`);
}

// ── 5. engine checks ──
say('\n5. Engine reads');
const lc = resolveEngineConfig(engineCat('jZWYnikrGcdRG1adHXJ0'), after[2].exercises.find((e) => e.exerciseId === 'jZWYnikrGcdRG1adHXJ0'));
const nl = nextLoad(100, { availableLoads: lc.loadSteps, incrementLb: lc.stepLb });
say(`   Leg Curls: stack ${JSON.stringify(lc.loadSteps)}, equipment ${lc.equipment}. Template 100 is NOT snapped (nothing rounds a current load to the stack); the next increase from 100 is ${nl.load}${nl.beyondSteps ? ' (beyondSteps: assumed at the stack\'s 10-lb spacing)' : ''}.`);
for (const [i, t] of after.entries()) {
  for (const r of t.exercises) {
    const old = liveBefore[i].exercises.find((e) => e.exerciseId === r.exerciseId)!;
    if (old.targetLoad === r.targetLoad && JSON.stringify(old.baseline) === JSON.stringify(r.baseline)) continue;
    const call = (row: TemplateExercise) => {
      const { rec, basedOn } = sessionCall(row, completed, engineCat(row.exerciseId));
      return `${rec.action} ${rec.load ?? '—'}${rec.reason && typeof rec.reason === 'object' && 'kind' in rec.reason ? ` (${(rec.reason as { kind: string }).kind})` : ''}${basedOn ? ` from ${calendarDateKey(basedOn)}` : ''}`;
    };
    say(`   ${t.name} · ${r.name}: next call ${call(old)}  →  ${call(r)}`);
  }
}

// ── 6. drafts ──
say('\n6. Template drafts (read only — not touched)');
for (const d of draftSnap.docs) {
  const x = d.data();
  const rowsOf = (b?: { exercises: Row[] }) => (b?.exercises ?? []).map((r) => `${r.supersetGroup ? `${r.supersetGroup}${r.pairPosition} ` : ''}${r.name}×${clusterCount(r.plannedSets, false)}@${r.targetLoad ?? '—'}`).join(', ');
  say(`   ${d.id} "${x.label}" status=${x.status} program=${x.program ?? '—'} draftOf=${x.draftOf} activatedAt=${x.activatedAt ?? '—'} keepBaselines=${JSON.stringify(x.keepBaselines ?? [])} autoActivate=${JSON.stringify(x.autoActivate ?? null)}`);
  say(`      template (v2 as of activation): ${rowsOf(x.template)}`);
  say(`      previous (v1, what "back to v1" restores): ${rowsOf(x.previous)}`);
}

// ── backup + write ──
const dir = join(homedir(), 'ignia-backups');
const backup = join(dir, `owner-data-2026-10-15-program-v2-1-${stamp.replace(/[:.]/g, '-')}.json`);
say(`\n7. Backup: ${APPLY ? '' : '(would write) '}${backup}`);
say(`   writes: ${changedIds.size} template(s) [${[...changedIds].map((id) => SPEC[id].name).join(', ') || 'none'}], ${effortWrites.length} catalog exercise(s); drafts and sessions untouched`);
say(`\nSUMMARY: would change ${rowCount} template row(s) in ${changedIds.size} template(s) + ${effortWrites.length} catalog exercise doc(s); 0 drafts, 0 sessions.`);
console.log(out.join('\n'));

if (!APPLY) { console.log('\nDry run. Re-run with --apply to write.'); process.exit(0); }
if (changedIds.size === 0 && effortWrites.length === 0) { console.log('\nNothing to do (already applied).'); process.exit(0); }

// The backup is written and checked BEFORE the first write; a failed backup stops the run.
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
  exercises: Object.fromEntries(effortWrites.map((w) => [w.id, exDocs.get(w.id)!.data()])),
  templateDrafts: draftSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
}), null, 1));
if (!existsSync(backup)) throw new Error(`backup ${backup} not written — refusing to write`);
console.log(`backup written: ${backup}`);

const batch = db.batch();
for (const id of changedIds) {
  const t = next.get(id)!;
  batch.update(user.collection('workoutTemplates').doc(id), { exercises: JSON.parse(JSON.stringify(t.exercises)), notes: t.notes, updatedAt: Timestamp.fromDate(now) });
}
for (const w of effortWrites) batch.update(user.collection('exercises').doc(w.id), { effortStandard: w.to });
await batch.commit();

// ── verify ──
for (const id of changedIds) {
  const t = toWorkoutTemplate(id, (await user.collection('workoutTemplates').doc(id).get()).data()!);
  console.log(`written ${t.name}: ${t.exercises.map((r) => `${blockOf(r)} ${r.name}×${clusterCount(r.plannedSets, false)}@${r.targetLoad}`).join(' · ')} — ${estimateTemplateDuration(t, musclesOf).minutes} min`);
}
console.log(`written effortStandard on ${effortWrites.length} exercise(s)`);
