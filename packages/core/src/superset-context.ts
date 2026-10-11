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
import { engineHistory, exerciseHistory } from './train-view';
import { stampChangedRows } from './progression-apply';
import { normalizeSupersets, pendingLoadTest, supersetGroups } from './superset';
import { calendarDateKey } from './date';

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
): Map<string, ContextChange[]> {
  const out = new Map<string, ContextChange[]>();
  next.exercises.forEach((row, i) => {
    const home = active.find((t) => t.id === next.id && t.exercises.some((e) => e.exerciseId === row.exerciseId))
      ?? active.find((t) => t.exercises.some((e) => e.exerciseId === row.exerciseId));
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
): TemplateExercise[] {
  return rows.map((row) => {
    const src = (live.find((t) => t.id === ownId)?.exercises.find((e) => e.exerciseId === row.exerciseId))
      ?? live.flatMap((t) => t.exercises).find((e) => e.exerciseId === row.exerciseId);
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

/** Exercises that would be programmed in two live templates at once, and
 *  exercises that would vanish from the week, if `nextBody` replaced the
 *  template `id`. */
export function weekOverlap(
  live: readonly TemplateRows[],
  id: string,
  nextBody: Pick<TemplateBody, 'exercises'>,
): { doubled: { exerciseId: string; name: string; alsoIn: string }[]; dropped: { exerciseId: string; name: string }[] } {
  const others = live.filter((t) => t.id !== id);
  const doubled = nextBody.exercises.flatMap((e) => {
    const other = others.find((t) => t.exercises.some((x) => x.exerciseId === e.exerciseId));
    return other ? [{ exerciseId: e.exerciseId, name: e.name, alsoIn: other.name ?? other.id ?? '' }] : [];
  });
  const current = live.find((t) => t.id === id)?.exercises ?? [];
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
}

function plan(id: string, incoming: TemplateBody, ctx: SwapContext, mode: 'activate' | 'revert', stampBaselines: boolean): SwapPlan {
  const current = ctx.live.find((t) => t.id === id);
  if (!current) throw new Error(`template ${id} is not live`);
  const fields = mode === 'activate' ? ACTIVATION_FIELDS : PROGRESS_FIELDS;
  let rows = normalizeSupersets(refreshFromLive(incoming.exercises, ctx.live, id, fields));
  const changes = contextChanges(ctx.live, { id, exercises: rows });
  if (stampBaselines) {
    rows = applyContextBaselines(rows, changes, {
      since: (eid) => baselineSince(eid, ctx.sessions, ctx.now),
      catalog: ctx.catalog,
    });
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
  return { body, replaced, changes, overlap: weekOverlap(ctx.live, id, body) };
}

/**
 * Activate a draft: the superset body goes into the live template (loads
 * refreshed from the live rows, context baselines stamped on every moved or
 * re-paired row), and the straight-set body it replaces is returned for the
 * draft to keep.
 */
export function planActivation(draft: Pick<TemplateDraftDoc, 'draftOf' | 'template'>, ctx: SwapContext): SwapPlan {
  return plan(draft.draftOf, draft.template, ctx, 'activate', true);
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
  draft: Pick<TemplateDraftDoc, 'draftOf' | 'previous' | 'activatedAt'>,
  ctx: SwapContext,
): SwapPlan {
  if (!draft.previous) throw new Error('draft has no straight-set body to restore');
  const since = draft.activatedAt ? Date.parse(draft.activatedAt) : NaN;
  const loggedOnSuperset = ctx.sessions.some((s) => s.status === 'completed'
    && (Number.isNaN(since) || s.date.getTime() >= since)
    && s.exercises.some((e) => e.supersetGroup != null));
  return plan(draft.draftOf, draft.previous, ctx, 'revert', loggedOnSuperset);
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
}

export interface DraftLayout {
  /** The live template's name this draft replaces. */
  draftOf: string;
  label: string;
  rows: DraftLayoutRow[];
  /** Group rests, seconds; absent → the defaults. */
  transitionRestSec?: number;
  roundRestSec?: number;
}

/**
 * The draft body a layout describes, built from COPIES of the live rows — so a
 * draft starts with today's loads, clusters, labels and drop sets, and only
 * order, pairing and the named rests differ. Throws on a name that is not in
 * the live templates: a draft that silently drops a lift is the failure mode
 * the weekly parity check exists for, and it should not get that far.
 */
export function buildDraftBody(live: readonly WorkoutTemplate[], layout: DraftLayout): { draftOf: string; body: TemplateBody } {
  const home = live.find((t) => t.name === layout.draftOf);
  if (!home?.id) throw new Error(`no live template named "${layout.draftOf}"`);
  const rows = layout.rows.map((r): TemplateExercise => {
    const src = live.find((t) => t.name === (r.from ?? layout.draftOf));
    const row = src?.exercises.find((e) => e.name === r.exercise);
    if (!row) throw new Error(`"${r.exercise}" is not in "${r.from ?? layout.draftOf}"`);
    const { supersetGroup: _g, pairPosition: _p, transitionRestSec: _t, roundRestSec: _r, ...plain } = row;
    const copy: TemplateExercise = JSON.parse(JSON.stringify(plain));
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
  return { draftOf: home.id, body: { ...bodyOf(home), exercises: normalizeSupersets(rows) } };
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
): { rec: Recommendation; basedOn?: Date; history: SessionExercise[] } {
  const history = engineHistory(completed, row.exerciseId, row);
  const basedOn = completed.find((s) => s.exercises.includes(history[0]))?.date;
  const rec = honourLifterLoad(recommend(history, recommendOptionsFor(row, catalogExercise ?? null)), row, basedOn);
  return { rec, ...(basedOn ? { basedOn } : {}), history };
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
