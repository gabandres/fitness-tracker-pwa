import {
  addActionsFor,
  countToAccept,
  findSeedExercise,
  isPristineScaffold,
  normalizeSupersets,
  previousToAccept,
  scaffoldKindsFor,
  type SupersetFields,
  seedExerciseName,
  toDisplayLoad,
  type SeedTemplate,
  type UnitSystem,
} from '@macrolog/core';
import type { LogStyle, SetKind, SetStructure, WorkoutSet } from '@/lib/workout';
import type { Locale, TFn } from '@/i18n';
import { plural } from '@/i18n/grammar';
import { numOrUndef } from './train-shared';

/**
 * The template editor's pure draft rules, out of the 2,000-line component so
 * they can be tested without rendering it (train-ux review T6, T7, T9,
 * 2026-10-11) — and the starter sheet's ordering and preview (H9/T19).
 */

/** The three text buffers a draft set is edited through. */
export interface SetBuffers {
  weightText: string;
  repsText: string;
  durationText: string;
}

/** A draft row: its kind, its buffers, and — when the lift has history —
 *  what the lifter did in this row last session, shown as ghost text. */
export interface DraftRowLike extends SetBuffers {
  kind: SetKind;
  /** Last session's numbers for this row (`ghostBuffers`), shown ONLY as
   *  placeholders. Never saved, never copied into the buffers: a per-set
   *  weight or reps value saved on a planned set overrides the lift's
   *  `targetLoad` / progression forever (fix R, 2026-10-11), so nothing the
   *  lifter did not type may land in the buffers. */
  ghost?: SetBuffers;
}

const BLANK: SetBuffers = { weightText: '', repsText: '', durationText: '' };

/** The sets a ghost or a seeded load may come from: performed ones only — a
 *  row opened and never done carries no record. */
const performed = (previous: readonly WorkoutSet[]) => previous.filter((s) => s.reps != null || s.durationSec != null);

/**
 * Last session's numbers for a new card's rows, as PLACEHOLDERS (T7).
 *
 * Matched by KIND and then by order — the nth `working` row takes the nth
 * `working` set logged — not by raw position: a warm-up at the top of last
 * session must not show its 95 lb over the first working row, and a myo-reps
 * log must not show a mini-set's 4 reps over a straight set. A row with no
 * same-kind counterpart gets none.
 *
 * Weight is converted from stored pounds to the training unit, the unit the
 * buffers are in. Only the fields the log style shows are filled, so a timed
 * lift never carries a hidden weight. The caller shows these as ghost text and
 * never as values ({@link DraftRowLike.ghost}).
 */
export function ghostBuffers(
  kinds: readonly SetKind[],
  previous: readonly WorkoutSet[],
  logStyle: LogStyle,
  unitSystem: UnitSystem,
): (SetBuffers | null)[] {
  const logged = performed(previous);
  const used = new Map<SetKind, number>();
  return kinds.map((kind) => {
    const nth = used.get(kind) ?? 0;
    used.set(kind, nth + 1);
    const src = logged.filter((s) => s.kind === kind)[nth];
    if (!src) return null;
    const out: SetBuffers = {
      weightText: logStyle === 'weight-reps' && src.weight != null && src.weight > 0
        ? String(toDisplayLoad(src.weight, unitSystem)) : '',
      repsText: logStyle !== 'time' && src.reps != null ? String(src.reps) : '',
      durationText: logStyle === 'time' && src.durationSec != null ? String(src.durationSec) : '',
    };
    return out.weightText || out.repsText || out.durationText ? out : null;
  });
}

/**
 * The load a new card's `targetLoad` field starts at: the first performed
 * working (or cluster activation) set of last session, in the training unit;
 * '' with no such set or for a lift with no weight box. The lift's load lives
 * in `targetLoad` because that is what progression moves (core
 * `applyTemplateChanges`); a per-set weight would pin it.
 */
export function seedTargetLoad(
  previous: readonly WorkoutSet[],
  logStyle: LogStyle,
  unitSystem: UnitSystem,
): string {
  if (logStyle !== 'weight-reps') return '';
  const src = performed(previous).find((s) => (s.kind === 'working' || s.kind === 'activation') && s.weight != null && s.weight > 0);
  return src?.weight != null ? String(toDisplayLoad(src.weight, unitSystem)) : '';
}

/** True when a row carries nothing the USER typed. A ghost is not a value,
 *  so only the buffers decide. */
export function rowUntouched(row: SetBuffers): boolean {
  return isPristineScaffold([{
    reps: numOrUndef(row.repsText),
    weight: numOrUndef(row.weightText),
    durationSec: numOrUndef(row.durationText),
  }]);
}

/** {@link isPristineScaffold} over draft rows: a row showing only last
 *  session's ghost numbers is untouched, so it never blocks a structure's
 *  scaffold the way typed rows do. */
export function rowsUntouched(rows: readonly SetBuffers[]): boolean {
  return rows.every(rowUntouched);
}

/**
 * {@link rowsUntouched} for a card REOPENED after S23-11: a new card saves the
 * grey reps it showed ({@link repsToSave}), so on the next edit those rows
 * read as typed and a later structure declaration kept them, saying "your
 * typed rows were kept" about numbers nobody typed (review R2 P2-4). A row
 * counts as seeded when nothing but reps is filled and the reps are exactly
 * what history offers in its position. Conservative by construction: if the
 * history moved since the save (another workout logged), the rows read as
 * typed again — the pre-fix behaviour, never a lost number.
 */
export function rowsSeededFromHistory(
  rows: readonly DraftRowLike[],
  previous: readonly Pick<WorkoutSet, 'kind' | 'reps' | 'durationSec'>[],
  logStyle: LogStyle,
): boolean {
  return rows.every((row, i) => {
    if (rowUntouched(row)) return true;
    if (row.weightText.trim() || row.durationText.trim()) return false;
    const offered = offeredCount({ ...row, repsText: '', ghost: undefined }, previous[i], logStyle, undefined);
    return offered !== '' && offered === row.repsText.trim();
  });
}

/**
 * The count a row will OFFER in the live session, as text — what the
 * editor's reps (or seconds) placeholder shows and what the collapsed card's
 * summary reads (train-ux E-N1). The session's own order, core
 * `countToAccept`: the typed prescription, else last time's SAME-KIND row
 * (`previousToAccept`), else — on a working row only — the lift's
 * progression target. A new card's ghost IS its "last time" (kind-matched,
 * `ghostBuffers`); an existing card reads last session's row in its position,
 * as the session does. `''` = nothing offered; the session asks.
 *
 * Display only, never saved (fix R): a stored per-set count would stop the
 * progression target from ever moving it.
 */
export function offeredCount(
  row: DraftRowLike,
  previous: Pick<WorkoutSet, 'kind' | 'reps' | 'durationSec'> | undefined,
  logStyle: LogStyle,
  exerciseTargetReps: number | undefined,
): string {
  const typed = (logStyle === 'time' ? row.durationText : row.repsText).trim();
  if (typed) return typed;
  const last = row.ghost
    ? { reps: numOrUndef(row.ghost.repsText), durationSec: numOrUndef(row.ghost.durationText) }
    : previousToAccept(previous as WorkoutSet | undefined, { kind: row.kind });
  const n = countToAccept({ kind: row.kind }, last, logStyle, exerciseTargetReps);
  return n != null ? String(n) : '';
}

/**
 * How many SETS and how many CLUSTERS a set list holds (train-ux E-N2). A
 * cluster is one numbered set with lettered rows (core `setRowLabels`): the
 * rows of one `group`, plus — for rest-pause and cluster sets, whose
 * continuations are not grouped (`normalizeClusterGroups`) — the
 * continuations straight after it. A myo-reps lift with rows 1a/1b/1c read
 * "3 sets" before this, on the card and to VoiceOver.
 */
export function clusterParts(rows: readonly { kind: SetKind; group?: number }[]): { sets: number; clusters: number } {
  let sets = 0;
  let clusters = 0;
  let open: number | undefined;
  let inBlock = false;
  for (const r of rows) {
    if (r.group != null) {
      if (!inBlock || r.group !== open) clusters += 1;
      open = r.group;
      inBlock = true;
    } else if (r.kind === 'continuation' && inBlock) {
      // Part of the block it continues.
    } else {
      sets += 1;
      inBlock = false;
      open = undefined;
    }
  }
  return { sets, clusters };
}

/** {@link clusterParts} in words: "3 sets", "1 cluster", "1 set + 2 clusters". */
export function setCountText(t: TFn, locale: Locale, rows: readonly { kind: SetKind; group?: number }[]): string {
  const { sets, clusters } = clusterParts(rows);
  const setsText = sets === 1 ? t('train.setCountOne') : t('train.setCount', { n: sets });
  if (clusters === 0) return setsText;
  const clustersText = plural(t, locale, 'train.clusterCount', clusters);
  return sets === 0 ? clustersText : `${setsText} + ${clustersText}`;
}

/**
 * The one line a collapsed card shows — "3 × 8 · 20 lb". It answers the
 * question the old card made you expand it to answer, and it degrades
 * honestly: counts or loads that differ across rows collapse to a set count
 * rather than picking one row's number and implying it holds for all.
 *
 * `counts` is each row's {@link offeredCount} — typed, else what the session
 * will offer — so a card the session will run as 3 × 8 says so even though
 * nothing per-set is stored (E-N1). A card with a cluster is never "n × reps":
 * its rows are not n equal sets (E-N2).
 */
export function cardSummary(
  card: { logStyle: LogStyle; targetLoad: string; sets: readonly (DraftRowLike & { group?: number })[] },
  counts: readonly string[],
  t: TFn,
  locale: Locale,
  unit: string,
): string {
  const n = card.sets.length;
  const phrase = setCountText(t, locale, card.sets);
  const clustered = clusterParts(card.sets).clusters > 0;
  /** The value every row shares, or null if they differ — or if ANY row
   *  leaves it blank, because "3 × 8" must not describe a template where only
   *  the first row says 8. */
  const one = (vals: readonly string[]): string | null => {
    const filled = vals.map((v) => v.trim()).filter(Boolean);
    if (filled.length !== vals.length || filled.length === 0) return null;
    return new Set(filled).size === 1 ? filled[0] : null;
  };
  const shared = clustered ? null : one(counts);

  if (card.logStyle === 'time') return shared ? `${n} × ${shared}s` : phrase;

  const head = shared ? `${n} × ${shared}` : phrase;
  if (card.logStyle === 'bodyweight') return head;

  // Per-set weight wins; the exercise-level default is the fallback it always was.
  const load = one(card.sets.map((x) => x.weightText)) ?? card.targetLoad.trim();
  return load ? `${head} · ${load} ${unit}` : head;
}

/**
 * The set-kind picker's rows for a card's DECLARED structure (train-ux E-N6):
 * the kinds the structure is built from first, the rest after them marked
 * `fits: false` — never hidden, ADR-0041 keeps a lifter free to write any
 * row. On a myo-reps card "Continuation" sat in the list as an equal and
 * silently contradicted the declaration above it. A warm-up fits everything;
 * an undeclared card keeps the usual order with nothing marked.
 */
export function kindsForPicker<T extends { value: SetKind }>(
  kinds: readonly T[],
  structure: SetStructure | undefined,
): { kind: T; fits: boolean }[] {
  if (structure === undefined) return kinds.map((kind) => ({ kind, fits: true }));
  const own = new Set<SetKind>(['warmup', ...scaffoldKindsFor(structure)]);
  const all = kinds.map((kind) => ({ kind, fits: own.has(kind.value) }));
  return [...all.filter((k) => k.fits), ...all.filter((k) => !k.fits)];
}

/**
 * Which add-buttons a card offers (T9, S23-5). A declared structure decides
 * (core `addActionsFor`). An undeclared card offers "+ Add set" and, beyond
 * it, only the buttons its rows ALREADY use: "+ Add cluster" where it has a
 * myo-rep cluster (activation/mini rows), "+ Add continuation" where it has
 * continuations. ADR-0041 used to keep all three on every undeclared legacy
 * card, which put "Add cluster" and "Add continuation" under a plain 3 × 8
 * Bench Press (final score F8) — an offer to break the lift. A lifter who
 * wants clusters on a straight-set lift declares the structure first, which
 * is one tap on the line above (ADR-0041 amendment, 2026-10-12). A card
 * added in this session is undeclared with working rows, so it gets "+ Add
 * set" alone, as before.
 */
export function addActionsForDraft(
  structure: SetStructure | undefined,
  isNew: boolean | undefined,
  kinds: readonly SetKind[],
): { set: boolean; cluster: boolean; block: boolean } {
  if (structure !== undefined) return addActionsFor(structure);
  if (isNew) return { set: true, cluster: false, block: false };
  return {
    set: true,
    cluster: kinds.some((k) => k === 'mini') || (kinds.includes('activation') && !kinds.includes('continuation')),
    block: kinds.some((k) => k === 'continuation'),
  };
}

/**
 * The reps a row SAVES as its target (`PlannedSet.reps`) — train-ux S23-11,
 * owner decision 2026-10-12: "the editor saves the grey reps it shows". A
 * template built in the editor used to store no reps at all, because the grey
 * numbers were placeholders only (fix R).
 *
 * - Typed reps are saved as typed, on any card.
 * - On a card added in THIS editing session, a blank row saves the grey count
 *   it shows from history: its ghost (last session's same-kind row), else last
 *   time's row in its position when that row was the same kind — the
 *   {@link offeredCount} order WITHOUT its last step.
 * - NOT the progression target (the last step): that grey number follows the
 *   lift's "Target reps" live, and a stored copy would stop following it.
 * - NOT on an existing card: an unrelated save (a rename) must not restate
 *   every row of every lift from whatever was logged last.
 * - Reps only. Grey per-set WEIGHTS are never saved: the session seeds
 *   `ps.weight ?? ex.targetLoad` and progression moves only `targetLoad`, so a
 *   stored per-set weight would freeze the lift's load for good (fix R). Grey
 *   seconds on a timed lift stay placeholders too (the decision was reps).
 */
export function repsToSave(
  row: DraftRowLike,
  previous: Pick<WorkoutSet, 'kind' | 'reps' | 'durationSec'> | undefined,
  logStyle: LogStyle,
  isNew: boolean | undefined,
): number | undefined {
  const typed = numOrUndef(row.repsText);
  if (typed != null || !isNew || logStyle === 'time') return typed;
  return numOrUndef(offeredCount(row, previous, logStyle, undefined));
}

/**
 * The row "+ Add set" appends (T7): a copy of the last `working` row's TYPED
 * numbers, so set 4 of a 3 × 8 @ 135 the lifter typed is not a blank form.
 * Only a working row is copied — a mini-set's 4 reps are not a working set's
 * target. Ghosts are not copied: set 4 had no counterpart last session.
 */
export function nextSetRow<T extends DraftRowLike>(rows: readonly T[]): DraftRowLike {
  const last = [...rows].reverse().find((r) => r.kind === 'working');
  if (!last) return { kind: 'working', ...BLANK };
  return { kind: 'working', weightText: last.weightText, repsText: last.repsText, durationText: last.durationText };
}

/** Rows "Copy set 1 to all sets" would fill: blank rows of row 1's kind.
 *  Offered only when there are at least two (T7). */
export function copyFirstTargets(rows: readonly DraftRowLike[]): number[] {
  const first = rows[0];
  if (!first || (!first.weightText.trim() && !first.repsText.trim() && !first.durationText.trim())) return [];
  const blank = (r: SetBuffers) => !r.weightText.trim() && !r.repsText.trim() && !r.durationText.trim();
  const out: number[] = [];
  rows.forEach((r, i) => {
    if (i > 0 && r.kind === first.kind && blank(r)) out.push(i);
  });
  return out.length >= 2 ? out : [];
}

/**
 * Undo of a removal: put `item` back into the list AS IT IS NOW, at its old
 * position clamped to the current length (fix R). The editor used to restore
 * a whole pre-removal snapshot, which threw away every edit made while the
 * toast was up. Already present (a second Undo) → unchanged.
 */
export function reinsertAt<T>(current: readonly T[], item: T, index: number): T[] {
  if (current.includes(item)) return [...current];
  const at = Math.max(0, Math.min(index, current.length));
  return [...current.slice(0, at), item, ...current.slice(at)];
}

/**
 * {@link reinsertAt} for an exercise card, which may have taken a superset
 * with it: the card goes back at its old position, and the partners it had
 * (by card key, from the list as it was before the removal) rejoin it —
 * unless a partner has been paired with something else since, which is a
 * newer choice and wins. The result is normalized, so letters stay A, B, ….
 */
export function reinsertCard<T extends SupersetFields & { uid: string }>(
  current: readonly T[],
  removed: T,
  index: number,
  before: readonly T[],
): T[] {
  if (current.some((x) => x.uid === removed.uid)) return [...current];
  const oldGroup = removed.supersetGroup;
  const partners = new Map(
    oldGroup ? before.filter((x) => x.uid !== removed.uid && x.supersetGroup === oldGroup).map((x) => [x.uid, x]) : [],
  );
  // A key no current row uses, so the restored group cannot merge with one;
  // normalizing renames it to a letter.
  const tag = oldGroup ? `${oldGroup}~undo` : undefined;
  const free = (x: T) =>
    !x.supersetGroup || current.filter((y) => y.supersetGroup === x.supersetGroup).every((y) => partners.has(y.uid));
  const restoredPartners = current.map((x) => {
    const was = partners.get(x.uid);
    if (!tag || !was || !free(x)) return x;
    return { ...x, supersetGroup: tag, pairPosition: was.pairPosition, transitionRestSec: was.transitionRestSec, roundRestSec: was.roundRestSec };
  });
  const back = tag ? { ...removed, supersetGroup: tag } : removed;
  return normalizeSupersets(reinsertAt(restoredPartners, back, index));
}

/** A starter built on myo-rep clusters — the advanced protocol. */
export function isClusterSeed(seed: SeedTemplate): boolean {
  return seed.exercises.some((ex) => ex.plannedSets.some((ps) => ps.kind === 'activation'));
}

/**
 * The starters in the order a newcomer should meet them: the cluster split —
 * the owner's own protocol, shipped first in `STARTER_TEMPLATES` — goes LAST
 * (train-ux review H9/J4/T19). A stable sort, so the rest keep core's order.
 */
export function orderStarters(seeds: readonly SeedTemplate[]): SeedTemplate[] {
  return [...seeds].sort((a, b) => Number(isClusterSeed(a)) - Number(isClusterSeed(b)));
}

/** The second line of a starter row: what is IN it — the first three
 *  movements by name, then "+n" — rather than a bare "6 exercises". */
export function starterPreview(seed: SeedTemplate, locale: string): string {
  const { head, more } = starterPreviewParts(seed, locale);
  return more > 0 ? `${head} +${more}` : head;
}

/** {@link starterPreview} in two parts, so the row can truncate the names
 *  and keep "+n" whole beside them — Push Day's long names used to cut the
 *  "+3" off with the ellipsis (Train UX v2 QA). */
export function starterPreviewParts(seed: SeedTemplate, locale: string): { head: string; more: number } {
  const names = seed.exercises
    .map((ex) => findSeedExercise(ex.key))
    .filter((s): s is NonNullable<typeof s> => s != null)
    .map((s) => seedExerciseName(s, locale));
  return { head: names.slice(0, 3).join(', '), more: seed.exercises.length - Math.min(3, names.length) };
}
