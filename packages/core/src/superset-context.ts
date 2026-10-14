/**
 * When a lift's CONTEXT changes, its next read is a new baseline (2026-10-11).
 *
 * A lift performed second in a superset, on another day, or later in the
 * session is performed more (or less) fatigued than every read before it. Its
 * next activation is not a test of the old progression — reading it as one
 * would call a drop that the context caused a failed load. So the change sets
 * the row's {@link ProgressionBaseline} (the 10/9 marker the engine already
 * honours): history before it stops being evidence, the first read after it
 * HOLDS, and the load drops only when the activation lands two or more reps
 * under the bottom of the lift's range.
 *
 * The four context changes:
 *  - added to a superset, or paired with a different partner;
 *  - removed from one;
 *  - moved to a different day (template);
 *  - its position in the template's exercise list changed.
 *
 * Also here: superset DRAFTS. A draft is a whole template body kept out of the
 * live `workoutTemplates` collection (old binaries list every doc there), and
 * activating one swaps it INTO the live template's document — same id, so
 * `templateId` history, "next up" and carried notes stay continuous — while
 * the straight-set body it replaced is kept for a one-tap revert.
 *
 * Pure; no I/O.
 */
import type {
  MuscleGroup,
  ProgressionBaseline,
  SessionExercise,
  SetStructure,
  Side,
  TemplateExercise,
  WorkoutSession,
  WorkoutTemplate,
} from './workout';
import {
  honourLifterLoad,
  nextLoad,
  recommend,
  recommendOptionsFor,
  resolveEngineConfig,
  type EngineCatalogFields,
  type Recommendation,
} from './progression-engine';
import { engineHistory, engineSessions, exerciseHistory } from './train-view';
import { stampChangedRows } from './progression-apply';
import { normalizeSupersets, pendingLoadTest, supersetGroups } from './superset';
import { calendarDateKey } from './date';
import { readableHistory, sideLoad, sidesOf } from './side-tracks';
import { isZone2 } from './cardio';

export type ContextChange = 'superset' | 'day' | 'position';
const CHANGE_ORDER: readonly ContextChange[] = ['superset', 'day', 'position'];

/** The template shape this module needs: an id and its rows. */
export interface TemplateRows {
  id?: string;
  name?: string;
  exercises: readonly TemplateExercise[];
}

/** The ids a row is paired with, sorted — empty when it runs straight. */
function partnersOf(rows: readonly TemplateExercise[], index: number): string[] {
  const g = rows[index].supersetGroup;
  const members = g ? supersetGroups(rows).get(g) : undefined;
  if (!members) return [];
  return members.filter((m) => m.index !== index).map((m) => rows[m.index].exerciseId).sort();
}

/**
 * The context changes of every row in `next` (the new body of the template
 * whose id is `next.id`), judged against where each exercise sits in the
 * CURRENTLY ACTIVE templates. A row whose exercise is in no active template
 * is new and has no history to protect, so it gets none.
 */
export function contextChanges(
  active: readonly TemplateRows[],
  next: TemplateRows,
  /** Bodies no longer live but recently were — the straight-set versions an
   *  active draft replaced. A lift that left its day with ANOTHER draft's
   *  activation (Leg switched first, so the crunch is in no live template when
   *  Push switches) is judged against where it last lived, not treated as new. */
  retired: readonly TemplateRows[] = [],
): Map<string, ContextChange[]> {
  const out = new Map<string, ContextChange[]>();
  next.exercises.forEach((row, i) => {
    const has = (t: TemplateRows) => t.exercises.some((e) => e.exerciseId === row.exerciseId);
    const home = active.find((t) => t.id === next.id && has(t)) ?? active.find(has) ?? retired.find(has);
    if (!home) return;
    const j = home.exercises.findIndex((e) => e.exerciseId === row.exerciseId);
    const changes: ContextChange[] = [];
    if (partnersOf(home.exercises, j).join('|') !== partnersOf(next.exercises, i).join('|')) changes.push('superset');
    if (home.id !== next.id) changes.push('day');
    else if (i !== j) changes.push('position');
    if (changes.length) out.set(row.exerciseId, changes);
  });
  return out;
}

/** "context changed: superset/position" — the record shown with the call. */
export function contextChangeReason(changes: readonly ContextChange[]): string {
  return `context changed: ${CHANGE_ORDER.filter((c) => changes.includes(c)).join('/')}`;
}

/** How far under the bottom of the range the baseline read must land before
 *  the load drops (owner, 2026-10-11): two reps. */
export const CONTEXT_DROP_REPS_UNDER_MIN = 2;

/**
 * The baseline marker for a context change. `dropBackBelowReps` is set so the
 * engine drops only at `min − 2` effective reps or fewer (`eff < min − 1`);
 * `dropBackTo` is one equipment step down — less load, or MORE assistance on
 * an assisted lift. A lift with no load to drop (bodyweight at 0) gets no
 * floor at all: its first read simply holds.
 */
export function contextBaseline(
  changes: readonly ContextChange[],
  opts: {
    since: string;
    load?: number;
    catalog?: EngineCatalogFields | null;
    row?: Pick<TemplateExercise, 'name' | 'progression'> | null;
  },
): ProgressionBaseline {
  const config = resolveEngineConfig(opts.catalog ?? null, opts.row ?? null);
  const base: ProgressionBaseline = { since: opts.since, reason: contextChangeReason(changes) };
  const load = opts.load;
  if (load == null || (load <= 0 && !config.assisted)) return base;
  // `nextLoad` walks toward progress; walking the other way is a drop.
  const down = nextLoad(load, {
    availableLoads: config.loadSteps,
    incrementLb: config.stepLb,
    assisted: !config.assisted,
  }).load;
  if (Math.abs(down - load) < 0.01) return base;
  return {
    ...base,
    dropBackTo: Math.max(0, down),
    dropBackBelowReps: Math.max(1, config.repRange.min - (CONTEXT_DROP_REPS_UNDER_MIN - 1)),
  };
}

/**
 * The day a context baseline starts. Normally `today`; the NEXT day when the
 * exercise was already logged today, so the session done before the change
 * is not mistaken for the first read after it (`engineHistory` reads by
 * calendar day).
 */
export function baselineSince(
  exerciseId: string,
  sessions: readonly Pick<WorkoutSession, 'status' | 'date' | 'exercises'>[],
  now: Date,
): string {
  const today = calendarDateKey(now);
  const loggedToday = sessions.some((s) => s.status === 'completed'
    && calendarDateKey(s.date) === today
    && s.exercises.some((e) => e.exerciseId === exerciseId));
  if (!loggedToday) return today;
  const t = new Date(now);
  t.setDate(t.getDate() + 1);
  return calendarDateKey(t);
}

/** Stamp a context baseline on every row whose context changed. A row that
 *  already carries a baseline from the same day keeps its reason too. */
export function applyContextBaselines(
  rows: readonly TemplateExercise[],
  changes: ReadonlyMap<string, readonly ContextChange[]>,
  opts: {
    since: (exerciseId: string) => string;
    catalog: (exerciseId: string) => EngineCatalogFields | null | undefined;
  },
): TemplateExercise[] {
  return rows.map((row) => {
    const c = changes.get(row.exerciseId);
    if (!c || c.length === 0) return row;
    const since = opts.since(row.exerciseId);
    const marker = contextBaseline(c, { since, load: row.targetLoad, catalog: opts.catalog(row.exerciseId), row });
    const prior = row.baseline?.since === since ? row.baseline.reason : undefined;
    return { ...row, baseline: prior && prior !== marker.reason ? { ...marker, reason: `${prior}; ${marker.reason}` } : marker };
  });
}

// ─── Drafts ─────────────────────────────────────────────────────

/** A template's body — everything a draft carries and an activation writes. */
export interface TemplateBody {
  name: string;
  notes?: string;
  restMiniSec?: number;
  restClusterSec?: number;
  exercises: TemplateExercise[];
  cardioBlocks?: WorkoutTemplate['cardioBlocks'];
  seedKey?: string;
}

export type TemplateDraftStatus = 'draft' | 'active';

/**
 * `users/{uid}/templateDrafts/{id}`. `template` is the superset version;
 * `previous` is the straight-set body an activation replaced, present only
 * while the draft is active.
 */
export interface TemplateDraftDoc {
  id?: string;
  /** The live `workoutTemplates` doc this draft replaces when activated. */
  draftOf: string;
  /** Shown in the drafts list ("Push Day — superset draft"). */
  label: string;
  status: TemplateDraftStatus;
  template: TemplateBody;
  previous?: TemplateBody;
  activatedAt?: string;
  revertedAt?: string;
  /** A versioned program draft (Program v2, 2026-10-11): `program.ts`. */
  program?: 'v2';
  /** The change's reason, logged on the template's notes when it switches. */
  reason?: string;
  /** Rows whose existing baseline the switch must NOT replace with a
   *  context-change one (exercise ids) — the shoulder press keeps its
   *  "baseline since 2026-10-09". */
  keepBaselines?: string[];
  /** Switch on by itself once, after a completed session of this template
   *  that started after `after` (ISO) — `programAutoActivation`. */
  autoActivate?: { afterTemplateId: string; after: string };
  /** When the automatic switch ran. Set once; it never runs again. */
  autoActivatedAt?: string;
  createdAt: Date;
  updatedAt: Date;
}

/** The body of a live template, without its id and stamps. */
export function bodyOf(t: WorkoutTemplate | TemplateBody): TemplateBody {
  const { id: _i, createdAt: _c, updatedAt: _u, ...rest } = t as WorkoutTemplate;
  const body: TemplateBody = { name: rest.name, exercises: rest.exercises.map((e) => ({ ...e })) };
  if (rest.notes !== undefined) body.notes = rest.notes;
  if (rest.restMiniSec !== undefined) body.restMiniSec = rest.restMiniSec;
  if (rest.restClusterSec !== undefined) body.restClusterSec = rest.restClusterSec;
  if (rest.cardioBlocks !== undefined) body.cardioBlocks = rest.cardioBlocks;
  if (rest.seedKey !== undefined) body.seedKey = rest.seedKey;
  return body;
}

/**
 * What a row takes from the LIVE row of the same exercise when a draft is
 * activated or reverted: what PROGRESS moves. The draft decides structure —
 * order, pairing, the group's rests, the rest after the row — and the live
 * template decides how heavy. Without this a draft made on Sunday and
 * activated on Thursday would undo four days of load changes, and a revert
 * after three superset weeks would undo three weeks of them.
 */
const PROGRESS_FIELDS = ['targetLoad', 'loadLog'] as const satisfies readonly (keyof TemplateExercise)[];
/** On ACTIVATION the live row's configuration comes along too, so the draft
 *  runs today's progression rule, cues and pending baseline. A revert keeps
 *  the straight-set body's own, which is the configuration being restored. */
const ACTIVATION_FIELDS = [
  ...PROGRESS_FIELDS, 'progression', 'cues', 'logStyle', 'setStructure', 'restMiniSec', 'baseline',
  'lastModifiedAt', 'lastModifiedBy',
] as const satisfies readonly (keyof TemplateExercise)[];

/**
 * Take current values from wherever each exercise lives in the live templates
 * (its own template first). Planned sets come from the live row too when they
 * are the same SHAPE (kind sequence) — per-set prescribed weights move with
 * progress — and stay the incoming body's when it re-shaped them.
 */
export function refreshFromLive(
  rows: readonly TemplateExercise[],
  live: readonly TemplateRows[],
  ownId?: string,
  fields: readonly (keyof TemplateExercise)[] = ACTIVATION_FIELDS,
  /** Fallback sources — see `contextChanges`. */
  retired: readonly TemplateRows[] = [],
): TemplateExercise[] {
  return rows.map((row) => {
    const src = (live.find((t) => t.id === ownId)?.exercises.find((e) => e.exerciseId === row.exerciseId))
      ?? live.flatMap((t) => t.exercises).find((e) => e.exerciseId === row.exerciseId)
      ?? retired.flatMap((t) => t.exercises).find((e) => e.exerciseId === row.exerciseId);
    if (!src) return row;
    const next = { ...row } as Record<string, unknown>;
    for (const k of fields) {
      if (src[k] !== undefined) next[k] = src[k];
      else delete next[k];
    }
    const shape = (ps: readonly { kind: string }[]) => ps.map((p) => p.kind).join(',');
    if (shape(src.plannedSets) === shape(row.plannedSets)) next['plannedSets'] = src.plannedSets.map((p) => ({ ...p }));
    return next as unknown as TemplateExercise;
  });
}

/**
 * What a swap does to the WEEK: exercises it newly puts in two live templates
 * at once (they move in from a day that still has them), and exercises it
 * takes out of every template, if `nextBody` replaced the template `id`.
 *
 * Only the CHANGE counts. A lift already programmed on two days before the
 * swap is the lifter's own choice, not something this swap does — warning
 * "it moves here from …" about it is false (found on a QA account whose two
 * templates share three lifts).
 */
export function weekOverlap(
  live: readonly TemplateRows[],
  id: string,
  nextBody: Pick<TemplateBody, 'exercises'>,
): { doubled: { exerciseId: string; name: string; alsoIn: string }[]; dropped: { exerciseId: string; name: string }[] } {
  const others = live.filter((t) => t.id !== id);
  const current = live.find((t) => t.id === id)?.exercises ?? [];
  const had = new Set(current.map((e) => e.exerciseId));
  const doubled = nextBody.exercises.flatMap((e) => {
    if (had.has(e.exerciseId)) return [];
    const other = others.find((t) => t.exercises.some((x) => x.exerciseId === e.exerciseId));
    return other ? [{ exerciseId: e.exerciseId, name: e.name, alsoIn: other.name ?? other.id ?? '' }] : [];
  });
  const after = new Set([...others.flatMap((t) => t.exercises), ...nextBody.exercises].map((e) => e.exerciseId));
  const dropped = current.filter((e) => !after.has(e.exerciseId)).map((e) => ({ exerciseId: e.exerciseId, name: e.name }));
  return { doubled, dropped };
}

export interface SwapPlan {
  /** The body to write into `workoutTemplates/{draftOf}`. */
  body: TemplateBody;
  /** The body it replaces — kept on the draft for the way back. */
  replaced: TemplateBody;
  changes: Map<string, ContextChange[]>;
  overlap: ReturnType<typeof weekOverlap>;
}

interface SwapContext {
  /** The live templates, with ids. */
  live: readonly WorkoutTemplate[];
  catalog: (exerciseId: string) => EngineCatalogFields | null | undefined;
  sessions: readonly Pick<WorkoutSession, 'status' | 'date' | 'exercises'>[];
  now: Date;
  /** The straight-set bodies OTHER active drafts replaced (id = their live
   *  template's) — where a lift moved by one of them last lived. */
  retired?: readonly TemplateRows[];
}

function plan(
  id: string,
  incoming: TemplateBody,
  ctx: SwapContext,
  mode: 'activate' | 'revert',
  stampBaselines: boolean,
  program?: Pick<TemplateDraftDoc, 'program' | 'reason' | 'keepBaselines'>,
): SwapPlan {
  const current = ctx.live.find((t) => t.id === id);
  if (!current) throw new Error(`template ${id} is not live`);
  // A program version states its own cues (the calf raise's pause), so they
  // are not taken from the live row like a superset draft's are.
  const fields = mode === 'activate'
    ? (program?.program ? ACTIVATION_FIELDS.filter((f) => f !== 'cues') : ACTIVATION_FIELDS)
    : PROGRESS_FIELDS;
  const retired = (ctx.retired ?? []).filter((t) => t.id !== id);
  let rows = normalizeSupersets(refreshFromLive(incoming.exercises, ctx.live, id, fields, retired));
  const changes = contextChanges(ctx.live, { id, exercises: rows }, retired);
  // Program v2: a row whose cluster count changed is judged on its first
  // clusters against its whole history (`side-tracks.ts`), so a context
  // baseline — which would cut that history off — is not stamped on it, and
  // a row the program says keeps its baseline keeps it.
  const keep = new Set(program?.keepBaselines ?? []);
  for (const r of rows) if (r.clusterCountChange || keep.has(r.exerciseId)) changes.delete(r.exerciseId);
  if (stampBaselines) {
    rows = applyContextBaselines(rows, changes, {
      since: (eid) => baselineSince(eid, ctx.sessions, ctx.now),
      catalog: ctx.catalog,
    });
  }
  // The cluster-count change is dated the day it takes effect.
  if (mode === 'activate') {
    rows = rows.map((r) => (r.clusterCountChange && !r.clusterCountChange.since
      ? { ...r, clusterCountChange: { ...r.clusterCountChange, since: baselineSince(r.exerciseId, ctx.sessions, ctx.now) } }
      : r));
  }
  // An activation is the lifter's change to every row it moves. A revert
  // restores rows with their own old stamps — only a row that gets a new
  // baseline is changed by it.
  if (mode === 'activate') rows = stampChangedRows(current.exercises, rows, { at: ctx.now, by: 'user' });
  else if (stampBaselines) {
    const stamped = new Set(changes.keys());
    rows = rows.map((r) => (stamped.has(r.exerciseId) ? { ...r, lastModifiedAt: ctx.now.toISOString(), lastModifiedBy: 'user' as const } : r));
  }
  // The live template's identity fields stay: its name ("Push Day") is what
  // history and "next up" know it by, its notes carry the programme's dated
  // record, and its cardio is not part of the superset decision.
  const replaced = bodyOf(current);
  const body: TemplateBody = { ...replaced, exercises: rows };
  // A program switch is logged on the template's dated record (its notes),
  // the way every programme change has been since 2026-10-09; and the
  // program's cardio prescription (the Zone 2 HR band) comes with it.
  if (program?.program) {
    const line = `${calendarDateKey(ctx.now)}: ${mode === 'activate' ? (program.reason ?? 'program switched') : `back to v1 (${program.reason ?? 'program'})`}`;
    body.notes = replaced.notes ? `${replaced.notes}\n${line}` : line;
    if (incoming.cardioBlocks !== undefined) body.cardioBlocks = incoming.cardioBlocks;
  }
  return { body, replaced, changes, overlap: weekOverlap(ctx.live, id, body) };
}

/**
 * Activate a draft: the superset body goes into the live template (loads
 * refreshed from the live rows, context baselines stamped on every moved or
 * re-paired row), and the straight-set body it replaces is returned for the
 * draft to keep.
 */
export function planActivation(
  draft: Pick<TemplateDraftDoc, 'draftOf' | 'template'> & Partial<Pick<TemplateDraftDoc, 'program' | 'reason' | 'keepBaselines'>>,
  ctx: SwapContext,
): SwapPlan {
  return plan(draft.draftOf, draft.template, ctx, 'activate', true, draft);
}

/**
 * Revert to the straight-set body the activation replaced.
 *
 * Structure comes back exactly; loads do NOT roll back — they are refreshed
 * from the live rows, so progress made during the superset weeks is kept. With
 * nothing logged since activation the result equals the original template
 * (the round trip is lossless). Once a session has been logged on the superset
 * version, coming out of a superset is itself a context change, so the rows
 * that change get a baseline again.
 */
export function planRevert(
  draft: Pick<TemplateDraftDoc, 'draftOf' | 'previous' | 'activatedAt'> & Partial<Pick<TemplateDraftDoc, 'program' | 'reason' | 'keepBaselines'>>,
  ctx: SwapContext,
): SwapPlan {
  if (!draft.previous) throw new Error('draft has no straight-set body to restore');
  const since = draft.activatedAt ? Date.parse(draft.activatedAt) : NaN;
  const loggedOnSuperset = ctx.sessions.some((s) => s.status === 'completed'
    && (Number.isNaN(since) || s.date.getTime() >= since)
    && s.exercises.some((e) => e.supersetGroup != null));
  return plan(draft.draftOf, draft.previous, ctx, 'revert', loggedOnSuperset, draft);
}

/**
 * Several swaps as ONE change — "switch Push and Leg together" (or back).
 *
 * Each plan is made against the templates as the previous ones leave them, so
 * a lift moving from Leg to Push is judged from Leg (where it lives until the
 * Leg swap) and the week is consistent once all are written. The caller writes
 * every plan in one batch. Overlap is judged against the FINAL week.
 */
export function planSwaps(
  items: readonly ({ mode: 'activate'; draft: Parameters<typeof planActivation>[0] }
    | { mode: 'revert'; draft: Parameters<typeof planRevert>[0] })[],
  ctx: SwapContext,
): SwapPlan[] {
  // Order does not matter: a body an earlier item replaced becomes `retired`,
  // which is where a lift it moved is judged from.
  let live = [...ctx.live];
  let retired = [...(ctx.retired ?? [])];
  const plans: { id: string; plan: SwapPlan }[] = [];
  for (const item of items) {
    const step = { ...ctx, live, retired };
    const p = item.mode === 'activate' ? planActivation(item.draft, step) : planRevert(item.draft, step);
    plans.push({ id: item.draft.draftOf, plan: p });
    live = live.map((t) => (t.id === item.draft.draftOf ? { ...t, ...p.body } : t));
    retired = item.mode === 'activate'
      ? [...retired.filter((t) => t.id !== item.draft.draftOf), { id: item.draft.draftOf, ...p.replaced }]
      : retired.filter((t) => t.id !== item.draft.draftOf);
  }
  return plans.map(({ id, plan }) => ({ ...plan, overlap: weekOverlap(live, id, plan.body) }));
}

// ─── Weekly volume parity ───────────────────────────────────────

/**
 * Clusters per PRIMARY muscle (`muscles[0]`, as `weeklyClusterAudit` counts)
 * that a set of templates prescribes for one week, each template performed
 * once. A superset changes nothing here by construction — a cluster is a
 * cluster — which is what lets a draft be checked against the version it
 * replaces.
 */
export function templateClustersByMuscle(
  templates: readonly TemplateRows[],
  musclesOf: (exerciseId: string) => readonly MuscleGroup[] | undefined,
): { byMuscle: Partial<Record<MuscleGroup, number>>; unattributed: string[] } {
  const byMuscle: Partial<Record<MuscleGroup, number>> = {};
  const unattributed: string[] = [];
  for (const t of templates) {
    for (const row of t.exercises) {
      const n = row.plannedSets.filter((p) => p.kind === 'activation').length;
      if (n === 0) continue;
      const m = musclesOf(row.exerciseId)?.[0];
      if (!m) {
        unattributed.push(row.name);
        continue;
      }
      byMuscle[m] = (byMuscle[m] ?? 0) + n;
    }
  }
  return { byMuscle, unattributed };
}

// ─── Building a draft from a layout ─────────────────────────────

/** One row of a draft, named by its exercise as the lifter wrote it. */
export interface DraftLayoutRow {
  /** The exercise's name exactly as it appears in the live template. */
  exercise: string;
  /** The live template it is taken from, when it moves from another day. */
  from?: string;
  group?: string;
  pairPosition?: 1 | 2 | 3;
  /** Overrides for the rest after this row (the last-performed member's
   *  rest-after is the rest after a whole superset). */
  restAfterSec?: number;
  restAfterMaxSec?: number;
  /** A new cluster count (Program v2: the lateral raise 1 → 2). The planned
   *  sets are rebuilt as that many copies of cluster 1, a drop set stays on
   *  the LAST cluster only, and the row is marked `clusterCountChange`. */
  clusters?: number;
  /** See `TemplateExercise.restClusterSec` / `minClusterRestSec`. */
  restClusterSec?: number;
  minClusterRestSec?: number;
  /** The switch must not replace this row's existing baseline. */
  keepBaseline?: boolean;
  /** A cue the version adds — unless an existing cue already says it
   *  (`cueAlreadyIf`, else the exact text). */
  addCue?: string;
  cueAlreadyIf?: RegExp;
}

/** Rest defaults for STRAIGHT rows (Program v2): the rest after a row is
 *  `same` when the next row's primary muscle is this row's, else `switch`;
 *  between a row's own clusters it is always `same`. */
export interface StraightRestRule {
  sameSec: number;
  sameMaxSec?: number;
  switchSec: number;
  /** The rest after a whole superset block. */
  afterBlockSec?: number;
}

export interface DraftLayout {
  /** The live template's name this draft replaces. */
  draftOf: string;
  label: string;
  rows: DraftLayoutRow[];
  /** Group rests, seconds; absent → the defaults. */
  transitionRestSec?: number;
  roundRestSec?: number;
  /** Computed rests for every row a row-level value does not set. */
  straightRest?: StraightRestRule;
  /** The cardio prescription the version carries (absent → the live one). */
  cardioBlocks?: WorkoutTemplate['cardioBlocks'];
  /** Copy the live cardio and prescribe this HR band on its Zone 2 blocks. */
  zone2Band?: { min: number; max: number };
}

/** A cluster count change: `n` copies of cluster 1's activation and minis,
 *  with any drop set placed once, after the LAST cluster (and numbered as
 *  it). Explicit per-set weights equal to the row's load are dropped so the
 *  row's load — refreshed at every switch — is the one the sets use. */
export function withClusterCount(row: TemplateExercise, n: number): TemplateExercise {
  const first = Math.min(...row.plannedSets.filter((p) => p.kind === 'activation').map((p) => p.group ?? 1));
  const cluster = row.plannedSets.filter((p) => (p.kind === 'activation' || p.kind === 'mini') && (p.group ?? 1) === first);
  const drops = row.plannedSets.filter((p) => p.kind === 'drop');
  const plain = (p: (typeof cluster)[number]) => {
    const { weight, ...rest } = p;
    return weight != null && row.targetLoad != null && Math.abs(weight - row.targetLoad) < 0.01 ? rest : p;
  };
  const sets = Array.from({ length: n }, (_, k) => cluster.map((p) => ({ ...plain(p), group: k + 1 }))).flat();
  const from = new Set(row.plannedSets.filter((p) => p.kind === 'activation').map((p) => p.group ?? 1)).size;
  return {
    ...row,
    plannedSets: [...sets, ...drops.map((d) => ({ ...d, group: n }))],
    ...(from !== n ? { clusterCountChange: { from, to: n, since: '' } } : {}),
  };
}

/**
 * The draft body a layout describes, built from COPIES of the live rows — so a
 * draft starts with today's loads, clusters, labels and drop sets, and only
 * order, pairing and the named rests differ. Throws on a name that is not in
 * the live templates: a draft that silently drops a lift is the failure mode
 * the weekly parity check exists for, and it should not get that far.
 */
export function buildDraftBody(
  live: readonly WorkoutTemplate[],
  layout: DraftLayout,
  /** The primary muscle of a row, for `layout.straightRest`. */
  primaryOf?: (row: TemplateExercise) => string | undefined,
): { draftOf: string; body: TemplateBody; keepBaselines: string[] } {
  const home = live.find((t) => t.name === layout.draftOf);
  if (!home?.id) throw new Error(`no live template named "${layout.draftOf}"`);
  const keepBaselines: string[] = [];
  const rows = layout.rows.map((r): TemplateExercise => {
    const src = live.find((t) => t.name === (r.from ?? layout.draftOf));
    const row = src?.exercises.find((e) => e.name === r.exercise);
    if (!row) throw new Error(`"${r.exercise}" is not in "${r.from ?? layout.draftOf}"`);
    const { supersetGroup: _g, pairPosition: _p, transitionRestSec: _t, roundRestSec: _r, ...plain } = row;
    let copy: TemplateExercise = JSON.parse(JSON.stringify(plain));
    if (r.clusters != null) copy = withClusterCount(copy, r.clusters);
    if (r.keepBaseline) keepBaselines.push(copy.exerciseId);
    const said = (c: string) => (r.cueAlreadyIf ? r.cueAlreadyIf.test(c) : c.trim().toLowerCase() === r.addCue!.trim().toLowerCase());
    if (r.addCue && !(copy.cues ?? []).some(said)) {
      copy.cues = [...(copy.cues ?? []), r.addCue];
    }
    if (r.restClusterSec !== undefined) copy.restClusterSec = r.restClusterSec;
    if (r.minClusterRestSec !== undefined) copy.minClusterRestSec = r.minClusterRestSec;
    if (r.restAfterSec !== undefined) copy.restAfterSec = r.restAfterSec;
    if (r.restAfterMaxSec !== undefined) copy.restAfterMaxSec = r.restAfterMaxSec;
    if (r.group) {
      copy.supersetGroup = r.group;
      copy.pairPosition = r.pairPosition ?? 1;
      if ((r.pairPosition ?? 1) === 1) {
        if (layout.transitionRestSec !== undefined) copy.transitionRestSec = layout.transitionRestSec;
        if (layout.roundRestSec !== undefined) copy.roundRestSec = layout.roundRestSec;
      }
    }
    return copy;
  });
  const rule = layout.straightRest;
  if (rule) applyStraightRest(rows, layout, rule, primaryOf);
  const body: TemplateBody = { ...bodyOf(home), exercises: normalizeSupersets(rows) };
  if (layout.cardioBlocks !== undefined) body.cardioBlocks = layout.cardioBlocks;
  else if (layout.zone2Band && body.cardioBlocks) {
    const band = layout.zone2Band;
    body.cardioBlocks = body.cardioBlocks.map((b) => (isZone2(b) ? { ...b, targetHrMin: band.min, targetHrMax: band.max } : b));
  }
  return { draftOf: home.id, body, keepBaselines };
}

/**
 * Fill the rests a layout row does not set (Program v2): between a straight
 * row's own clusters `sameSec`; after a row, `sameSec`–`sameMaxSec` into the
 * same primary muscle, `switchSec` on a switch; after a superset block,
 * `afterBlockSec` on its last member. In place.
 */
function applyStraightRest(
  rows: TemplateExercise[],
  layout: DraftLayout,
  rule: StraightRestRule,
  primaryOf: ((row: TemplateExercise) => string | undefined) | undefined,
): void {
  rows.forEach((row, i) => {
    const lr = layout.rows[i];
    const clusters = new Set(row.plannedSets.filter((p) => p.kind === 'activation').map((p) => p.group ?? 1)).size;
    if (!row.supersetGroup && clusters > 1 && lr.restClusterSec === undefined) row.restClusterSec = rule.sameSec;
    if (lr.restAfterSec !== undefined) return;
    const next = rows[i + 1];
    const endsBlock = row.supersetGroup != null && next?.supersetGroup !== row.supersetGroup;
    const inBlock = row.supersetGroup != null && !endsBlock;
    if (inBlock) {
      delete row.restAfterSec;
      delete row.restAfterMaxSec;
      return;
    }
    if (endsBlock && rule.afterBlockSec != null) {
      row.restAfterSec = rule.afterBlockSec;
      delete row.restAfterMaxSec;
      return;
    }
    const same = next != null && primaryOf != null && primaryOf(row) != null && primaryOf(row) === primaryOf(next);
    row.restAfterSec = same ? rule.sameSec : rule.switchSec;
    if (same && rule.sameMaxSec != null) row.restAfterMaxSec = rule.sameMaxSec;
    else delete row.restAfterMaxSec;
  });
}

// ─── The call a session starts with ─────────────────────────────

/**
 * The engine's call for one template row, exactly as starting a session
 * computes it: history cut at the row's baseline marker, the lifter's own
 * load winning over the read (`honourLifterLoad`). One function so the
 * pending-load-test warning and the session's seeded load cannot disagree.
 */
export function sessionCall(
  row: TemplateExercise,
  completed: readonly WorkoutSession[],
  catalogExercise: (EngineCatalogFields & { setStructure?: SetStructure }) | null | undefined,
): {
  rec: Recommendation;
  basedOn?: Date;
  history: SessionExercise[];
  /** An L/R lift: each side's own call (`side-tracks.ts`). */
  sides?: Partial<Record<Side, { rec: Recommendation; basedOn?: Date }>>;
} {
  const history = engineHistory(completed, row.exerciseId, row);
  // The session the newest READ came from: the first (newest) session the
  // engine may read (`engineSessions`) whose sets survive the read rules.
  const readable = engineSessions(completed, row);
  const readFrom = (side?: Side): Date | undefined => {
    for (const s of readable) {
      const e = s.exercises.find((x) => x.exerciseId === row.exerciseId);
      if (e && readableHistory([e], row, side).length > 0) return s.date;
    }
    return undefined;
  };
  const basedOn = readFrom();
  const opts = recommendOptionsFor(row, catalogExercise ?? null);
  const rec = honourLifterLoad(recommend(history, opts), row, basedOn);
  const sideList = sidesOf(row);
  if (sideList.length < 2) return { rec, ...(basedOn ? { basedOn } : {}), history };
  const sides: Partial<Record<Side, { rec: Recommendation; basedOn?: Date }>> = {};
  for (const side of sideList) {
    const h = engineHistory(completed, row.exerciseId, row, side);
    const at = readFrom(side);
    const sideRow = { targetLoad: sideLoad(row, side), loadLog: row.loadLog?.filter((c) => !c.side || c.side === side) };
    sides[side] = { rec: honourLifterLoad(recommend(h, opts), sideRow, at), ...(at ? { basedOn: at } : {}) };
  }
  return { rec, ...(basedOn ? { basedOn } : {}), history, sides };
}

/** The pending load test for a row, judged on the load the session will
 *  actually seed — the call's, else the template's. */
export function rowPendingLoadTest(
  row: TemplateExercise,
  completed: readonly WorkoutSession[],
  catalogExercise: (EngineCatalogFields & { setStructure?: SetStructure }) | null | undefined,
): { from: number; to: number } | null {
  const { rec } = sessionCall(row, completed, catalogExercise);
  const planned = rec.action !== 'none' && rec.load != null ? rec.load : row.targetLoad;
  // Every session, not only post-baseline ones: "the last time it was lifted".
  return pendingLoadTest(planned, exerciseHistory(completed, row.exerciseId), catalogExercise?.assisted === true);
}
