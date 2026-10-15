import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Keyboard,
  Platform,
  Text,
  type TextInput,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from 'react-native';
import { SheetHeader } from '@/components/SheetHeader';
import { MenuButton } from '@/components/MenuButton';
import { SheetTextInput } from '@/components/SheetTextInput';
import { useDoneKeyProps } from '@/components/KeyboardBar';
import Animated, { useAnimatedRef, useReducedMotion } from 'react-native-reanimated';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import Sortable from 'react-native-sortables';
import {
  type SeedExercise,
  type UnitSystem,
  MOBILITY_SEED_KEYS,
  defaultIncrement as defaultIncrementLb,
  exerciseHistory,
  loadUnit,
  previousSets,
  carryAndStampRows,
  stampChangedRows,
  logUserLoadEdits,
  normalizeClusterGroups,
  parseLoadToLb,
  scaffoldKindsFor,
  seedExerciseCues,
  setRowLabels,
  toDisplayLoad,
  CARDIO_MODALITIES,
  distanceUnit,
  parseDistanceToM,
  toDisplayDistance,
  normalizeSupersets,
  applyContextBaselines,
  baselineSince,
  canPairWithNext,
  ANTAGONIST_PAIRS,
  moveBlockAware,
  orderBlocks,
  contextChanges,
  formatLoad,
  groupRest,
  pairWithNext,
  reorderWithSupersets,
  supersetGroups,
  supersetTags,
  supersetWarnings,
  unpair,
  SUPERSET_REST_RANGE_SEC,
  type PairJudgement,
} from '@macrolog/core';
import { announce } from '@/lib/a11y';
import type { CardioModality, PlannedCardioBlock } from '@macrolog/core/cardio';
import type {
  Exercise,
  LoadChange,
  LogStyle,
  PlannedSet,
  SetKind,
  SetStructure,
  TemplateDraft,
  TemplateExercise,
  WorkoutTemplate,
} from '@/lib/workout';
import type { useTrain } from '@/hooks/useTrain';
import { confirm } from '@/components/ConfirmSheet';
import { hideToast, showToast } from '@/components/Toast';
import { type TFn, useLocale, useT, type I18nKey} from '@/i18n';
import { capitalizeFirst, plural } from '@/i18n/grammar';
import * as haptics from '@/lib/haptics';
import { smoothLayout } from '@/lib/motion';
import { useTheme, useThemedStyles } from '@/lib/theme-context';
import { useRevealFocusedInput } from '@/lib/use-reveal-focused-input';
import { font, space, TARGET } from '@/theme';
import {
  PRIMARY_STRUCTURES, SET_KINDS, SET_STRUCTURES, type CreationStyle,
  kindLabelKey, logStyleFor, numOrUndef, setKindFor,
} from './train-shared';
import { ExerciseSearchList, catalogPickKey, seedPickKey } from './ExerciseSearchList';
import {
  type SetBuffers,
  addActionsForDraft,
  cardSummary,
  copyFirstTargets,
  kindsForPicker,
  nextSetRow,
  ghostBuffers,
  offeredCount,
  reinsertAt,
  reinsertCard,
  repsToSave,
  rowsSeededFromHistory,
  rowsUntouched,
  seedTargetLoad,
  setCountText,
} from './template-draft';
import { DEFAULT_REST_CLUSTER_SEC, DEFAULT_REST_MINI_SEC } from './train-summary';
import { LiftSettingsForm, useLiftSettingsDraft } from './LiftSettingsSheet';
import { mobilityDoseWarnings } from '@macrolog/core';
import { BottomSheet, type SheetCloseVia } from '@/components/BottomSheet';
import { useUnitSystem } from '@/lib/use-unit-system';
import { createStyles } from './train-styles';

/**
 * The workout-template editor sheet — the largest single surface in Train, and
 * the first thing extracted when `app/(app)/train.tsx` passed 2,300 lines.
 *
 * It is a good seam: the route hands it four props and gets a callback back,
 * it owns its own draft state, and nothing else reads that state. Styles and
 * the shared label maps come from siblings so the modal and the screen cannot
 * drift apart visually.
 */
/**
 * A planned set plus the raw text its numeric fields are edited through.
 *
 * Numbers alone cannot hold a half-typed value: `numOrUndef('2.')` is `2`, so
 * a controlled input parsed on every keystroke eats the decimal point the
 * moment it is typed, and a cleared field is indistinguishable from a zero.
 * The text is authoritative while the sheet is open and is parsed back onto
 * the {@link PlannedSet} in `save()`. The buffers ride ON the set object
 * rather than in a parallel array because add/remove/reorder/cluster
 * normalization all reshuffle these, and two arrays would drift.
 */
interface DraftSet extends PlannedSet {
  weightText: string;
  repsText: string;
  durationText: string;
  /** Last session's numbers for this row (`template-draft.ts`
   *  `ghostBuffers`), shown as placeholders only. Never saved and never put in
   *  the buffers: a per-set value would override `targetLoad` for good. */
  ghost?: SetBuffers;
}

const numText = (n: number | undefined): string => (n != null ? String(n) : '');

/** Modality → i18n key for the editor's picker. A third copy of this map, and
 *  deliberately so: the alternative is a shared module that every Train surface
 *  imports for ten strings, which is the coupling `train-shared` exists to
 *  keep small. */
const TPL_MODALITY_KEY: Record<CardioModality, I18nKey> = {
  run: 'cardio.modality.run',
  walk: 'cardio.modality.walk',
  ride: 'cardio.modality.ride',
  swim: 'cardio.modality.swim',
  row: 'cardio.modality.row',
  elliptical: 'cardio.modality.elliptical',
  stair: 'cardio.modality.stair',
  hike: 'cardio.modality.hike',
  sport: 'cardio.modality.sport',
  other: 'cardio.modality.other',
};

/** One prescribed cardio block while it is being edited. Text buffers, in the
 *  units the user reads — converted to seconds/meters on save. */
interface DraftCardio {
  modality: CardioModality;
  label: string;
  minutes: string;
  distance: string;
}

function toDraftSet(ps: PlannedSet, unitSystem: UnitSystem = 'us'): DraftSet {
  return {
    ...ps,
    // Stored pounds out, training unit in. The default keeps the one call
    // site that has no profile (`newDraftSet`, an empty row) on pounds, which
    // is inert because the buffer it produces is empty anyway.
    weightText: ps.weight != null ? String(toDisplayLoad(ps.weight, unitSystem)) : '',
    repsText: numText(ps.reps),
    durationText: numText(ps.durationSec),
  };
}

/** Strip the buffers and parse them back onto the stored shape. Anything the
 *  editor never showed (`repsMax`) is carried through untouched — a field the
 *  editor cannot see must not be a field the next save deletes. */
function toPlannedSet(d: DraftSet, unitSystem: UnitSystem): PlannedSet {
  const { weightText, repsText, durationText, ghost: _ghost, ...ps } = d;
  return {
    ...ps,
    // The draft buffer is in the TRAINING unit; the stored set is pounds
    // (UX_AUDIT F3). One conversion, here, at the one boundary.
    weight: parseLoadToLb(weightText, unitSystem) ?? undefined,
    reps: numOrUndef(repsText),
    durationSec: numOrUndef(durationText),
  };
}

const newDraftSet = (kind: SetKind): DraftSet => toDraftSet({ kind });

/** The set kind a shipped library movement is added with. Out here, not
 *  inline in `addFromLibrary`'s `try`: React Compiler cannot lower a
 *  conditional inside a try block and would skip the whole editor. */
const seedSetKind = (seed: SeedExercise, logStyle: LogStyle): SetKind =>
  logStyle === 'time' && MOBILITY_SEED_KEYS.has(seed.key) ? 'mobility' : 'working';

/** A cluster's label ("L" / "R") lives on EVERY planned set of the cluster,
 *  so a reader of any one row — the logger snapshots per set — sees it. The
 *  field sits under the cluster's first row, so that row's label is the
 *  cluster's; this copies it across the group after any reshuffle (a mini
 *  added later, a kind change that regrouped the rows). Ungrouped rows keep
 *  whatever they carry. */
function spreadClusterLabels<T extends PlannedSet>(sets: readonly T[]): T[] {
  const first = new Map<number, string | undefined>();
  for (const ps of sets) if (ps.group != null && !first.has(ps.group)) first.set(ps.group, ps.label);
  return sets.map((ps) => {
    if (ps.group == null) return ps;
    const label = first.get(ps.group);
    if (label === ps.label) return ps;
    const { label: _drop, ...rest } = ps;
    return (label ? { ...rest, label } : rest) as T;
  });
}

/** Everything the editor can change, as one comparable string — the
 *  "unsaved changes?" test. Text buffers, so a field typed and cleared again
 *  reads as unchanged. */
function draftKey(
  name: string,
  notes: string,
  restMini: string,
  restCluster: string,
  exercises: readonly DraftEx[],
  cardio: readonly DraftCardio[],
): string {
  // The card key is not a change: strip it, so new uids never read as edits.
  // Same for the editor-only `isNew` and per-row `ghost` markers.
  return JSON.stringify([
    name, notes, restMini, restCluster,
    exercises.map(({ uid: _uid, isNew: _new, ...e }) => ({
      ...e,
      sets: e.sets.map(({ ghost: _ghost, ...s }) => s),
    })),
    cardio,
  ]);
}

// carries EVERY field the stored TemplateExercise has, because the editor
// writes `exercises` as a full overwrite. A field the editor cannot see is a
// field the next save deletes — which is how mobile edits used to flatten
// clusters and wipe cues/progression written on the web.
interface DraftEx {
  /** A key for this card that survives reorders — never saved. Keyed by
   *  index, every one-step move remounted the moved cards and dropped
   *  VoiceOver's focus off the handle. */
  uid: string;
  /** Added in THIS editing session — never saved. A new card with no
   *  declared structure gets only "+ Add set" (ADR-0041's all-three rule is
   *  for legacy templates), and opens with the full structure picker. */
  isNew?: true;
  exerciseId: string;
  name: string;
  logStyle: LogStyle;
  targetLoad: string; // string buffer; parsed on save
  cuesText: string; // newline-separated; split on save
  hasProgression: boolean;
  targetReps: string;
  holdSessions: string;
  incrementLb: string;
  /** Exercise-level mini-set rest override, seconds; '' = use the template's. */
  restMiniSec: string;
  /** The two per-lift rests (2026-10-15, owner bug D): between this lift's
   *  own clusters (`TemplateExercise.restClusterSec`, '' = the template's) and
   *  before the NEXT exercise (`restAfterSec`, '' = the cluster rest). Both
   *  lived only in data until now — set by scripts, invisible here. */
  restClusterSec: string;
  restAfterSec: string;
  /** `restAfterSec` as opened, and the range top it carried (105–120 s). The
   *  top is kept only while the field is untouched: a new number replaces the
   *  range, it does not slide under an old ceiling. */
  restAfterOpened: string;
  restAfterMaxSec?: number;
  /** What this lift is PROGRAMMED as (ADR-0040). `undefined` keeps a template
   *  written before the field existed undeclared, so the engine keeps
   *  inferring for it and nothing is silently restated on an unrelated save. */
  setStructure?: SetStructure;
  /** The real planned sets, not a count — a count cannot represent a cluster
   *  (activation/mini/mini) and rewriting one as N working sets destroys it. */
  sets: DraftSet[];
  /** Every logged move of `targetLoad` (core `LoadChange`). Not editable here,
   *  only carried: the save is a full overwrite, and dropping it would erase
   *  the lift's load history on any edit. */
  loadLog?: LoadChange[];
  /** Superset group, position and (on the leader) the group's rests — the
   *  core `SupersetFields`, edited here and written back whole, so they are
   *  shown AND saved rather than carried. */
  supersetGroup?: string;
  pairPosition?: 1 | 2 | 3;
  transitionRestSec?: number;
  roundRestSec?: number;
  /** The stored load and the text it was shown as. Saved back VERBATIM while
   *  the text is untouched: a metric user's 100 lb shows as 45.4 kg and would
   *  otherwise come back as 100.09 lb — a "hand edit" nobody made, logged. */
  loadAsOpened?: { text: string; lb: number };
}

/**
 * A saved row with the editor's two per-lift rests applied exactly as shown:
 * a number is written, a blank removes the field. The range top
 * (`restAfterMaxSec`, "105–120 s") survives only an untouched rest-to-next.
 * Exported for `template-rest-fields.test.ts`.
 */
export function withShownRests(
  row: TemplateExercise,
  d: Pick<DraftEx, 'restClusterSec' | 'restAfterSec' | 'restAfterOpened' | 'restAfterMaxSec'>,
): TemplateExercise {
  const out: TemplateExercise = { ...row };
  delete out.restClusterSec;
  delete out.restAfterSec;
  delete out.restAfterMaxSec;
  const cluster = numOrUndef(d.restClusterSec);
  const after = numOrUndef(d.restAfterSec);
  if (cluster != null) out.restClusterSec = cluster;
  if (after != null) {
    out.restAfterSec = after;
    if (d.restAfterSec === d.restAfterOpened && d.restAfterMaxSec != null) out.restAfterMaxSec = d.restAfterMaxSec;
  }
  return out;
}

/** One ticked row in the editor's adder (T18). */
type AdderPick =
  | { kind: 'catalog'; exercise: Exercise }
  | { kind: 'seed'; seed: SeedExercise };

/** The testID every editor Undo toast carries, so closing the editor can
 *  dismiss its own toast and nobody else's (`hideToast`). */
const EDITOR_UNDO_TOAST = 'template-undo-toast';

/** "Edit rests": after the confirm sheet's dismiss animation. */
const EDIT_RESTS_FOCUS_DELAY_MS = 400;
/** After a pick: the result list folds and the card list re-lays out (the
 *  Sortable animates it) before the new card is measured and scrolled to. */
const REVEAL_DELAY_MS = 350;

let uidSeq = 0;
/** A card key that survives reorders (`DraftEx.uid`). */
const nextUid = () => `ex-${++uidSeq}`;

/** A muscle's name mid-sentence: lower-cased in the reader's language. */
function muscleWord(m: string | undefined, t: TFn): string {
  return m ? t(`train.muscle.${m}` as I18nKey).toLocaleLowerCase() : '';
}

/** The pair-type line under a superset (core `classifyPair`). */
function pairText(j: PairJudgement, t: TFn, names: { untagged: string }): string {
  switch (j.kind) {
    case 'same-muscle': {
      // Name the muscle to pair with instead, when the taxonomy has one.
      const pair = ANTAGONIST_PAIRS.find(([x, y]) => x === j.muscle || y === j.muscle);
      const opposite = pair ? (pair[0] === j.muscle ? pair[1] : pair[0]) : undefined;
      return opposite
        ? t('train.superset.sameMuscleOpposite', { muscle: muscleWord(j.muscle, t), opposite: muscleWord(opposite, t) })
        : t('train.superset.sameMuscle', { muscle: muscleWord(j.muscle, t) });
    }
    case 'agonist-antagonist': return t('train.superset.agonist');
    case 'overlapping': return t('train.superset.overlap', { muscle: muscleWord(j.muscle, t) });
    case 'non-competing': return t('train.superset.nonCompeting');
    default: return t('train.superset.unknown', { name: names.untagged });
  }
}

/** A group rest typed into the editor: whole seconds, 0–600, blank = default. */
function clampRest(v: string): number | undefined {
  const n = numOrUndef(v);
  return n == null ? undefined : Math.max(0, Math.min(600, Math.round(n)));
}

export function TemplateEditorModal({
  visible,
  train,
  template,
  onClose,
}: {
  visible: boolean;
  train: ReturnType<typeof useTrain>;
  template: WorkoutTemplate | null;
  onClose: () => void;
}) {
  const t = useT();
  const locale = useLocale();
  const styles = useThemedStyles(createStyles);
  const unitSystem = useUnitSystem();
  const { colors } = useTheme();
  // Every number field here is a lone pad with no Return key on iOS and a
  // bare one on Android: this gives both a Done, in the user's language
  // (UX_AUDIT S20 — the editor had no way off the pad but tapping away).
  const doneKey = useDoneKeyProps();
  // Sheets GROW for the keyboard, they do not move: `sheetWrap` is flex-end,
  // so extra bottom padding keeps the background on the screen edge and
  // pushes content up. Translating instead exposes whatever the keyboard
  // frame does not paint — on iOS 26 that is the transparent band holding
  // the system's floating "Done" pill, and it showed the page through it.
  const [name, setName] = useState('');
  const [notes, setNotes] = useState('');
  const [restMini, setRestMini] = useState('');
  const [restCluster, setRestCluster] = useState('');
  const [exercises, setExercises] = useState<DraftEx[]>([]);
  /**
   * Prescribed cardio (ADR-0025), as text buffers like every other field here.
   *
   * Minutes and display-unit distance, converted on save — the template stores
   * seconds and meters, and nobody types either. Same seam `targetLoad` already
   * draws for a barbell.
   */
  const [cardioBlocks, setCardioBlocks] = useState<DraftCardio[]>([]);
  const [cardioPick, setCardioPick] = useState(false);
  const [exName, setExName] = useState('');
  const [exStyle, setExStyle] = useState<CreationStyle>('weight-reps');
  const [kindOpen, setKindOpen] = useState<string | null>(null); // `${exIdx}:${setIdx}`
  /** Accordion: at most ONE exercise expanded, so the sheet stays a list you
   *  can scan. A freshly added exercise opens itself — you added it to edit it. */
  const [openEx, setOpenEx] = useState<number | null>(null);
  /**
   * ADR-0028's dose guardrail, over the LIVE draft rather than the saved
   * template — the number it is about is the one being typed.
   *
   * It warns and never caps: this app does not silently overrule a person who
   * typed a number, and the note is a citation rather than a verdict about
   * this particular movement (the dose figures are about static stretching,
   * and the model has no static/dynamic distinction to read — amendment 1A).
   * A mobility-only template has no `pre` position at all and produces
   * nothing, which is why this is not gated on there being any lift.
   */
  // Supersets (2026-10-11): the pair type of every pairing, and which members
  // have a load test pending — advisory, shown under each group, never a
  // block on saving. Muscles come from the catalog (`muscles[0]` is primary).
  // Depends on the two members it reads, not the whole `train` object, which
  // is a new identity on every hook render — this ran a load-test read per
  // superset member on every keystroke anywhere in the sheet (review T25).
  const { catalog: trainCatalog, pendingLoadTestFor } = train;
  const pairWarnings = useMemo(() => {
    const muscles = (id: string) => trainCatalog.find((e) => e.id === id)?.muscles ?? [];
    /** The load test a row would face next session, judged on the load the
     *  session will seed (the editor's typed load, else the stored row's). */
    const pendingOf = (i: number) => {
      const d = exercises[i];
      const stored = template?.exercises.find((x) => x.exerciseId === d.exerciseId);
      const load = d.loadAsOpened && d.targetLoad === d.loadAsOpened.text ? d.loadAsOpened.lb : parseLoadToLb(d.targetLoad, unitSystem) ?? undefined;
      return pendingLoadTestFor({ ...(stored ?? { exerciseId: d.exerciseId, name: d.name, plannedSets: [] }), targetLoad: load });
    };
    const byLast = new Map<number, {
      group: string;
      judgements: { a: number; b: number; judgement: PairJudgement }[];
      pending: { index: number; from: number; to: number }[];
      size: number;
    }>();
    for (const w of supersetWarnings(exercises, muscles)) {
      const members = [...new Set(w.pairs.flatMap((p) => [p.a, p.b]))];
      const pending = members.flatMap((m) => {
        const p = pendingOf(m);
        return p ? [{ index: m, ...p }] : [];
      });
      byLast.set(Math.max(...members), { group: w.group, judgements: w.pairs, pending, size: members.length });
    }
    return byLast;
  }, [exercises, trainCatalog, pendingLoadTestFor, template, unitSystem]);
  /** Tags from the REAL groups (a lone member is untagged). */
  const tags = useMemo(() => supersetTags(exercises), [exercises]);
  const groups = useMemo(() => supersetGroups(exercises), [exercises]);
  /** Positions in UNITS — a superset is one place, the way a move moves it. */
  const blocks = useMemo(() => orderBlocks(exercises), [exercises]);

  /** Pair row `i` with the next, or add the next to `i`'s superset. */
  function pairNext(i: number) {
    const a = exercises[i];
    const b = exercises[i + 1];
    if (!a || !b) return;
    haptics.tap();
    const before = exercises;
    const next = pairWithNext(exercises, i);
    setExercises(next);
    const group = next[i + 1]?.supersetGroup ?? '';
    // The fast path says what the More-options path shows: both lifts start a
    // fresh baseline. With an Undo, like unpairing.
    const msg = t('train.superset.pairedToast', { a: a.name, b: b.name, group });
    // The toast speaks it (with its Undo) — announcing too said it twice.
    showToast(msg, undoAction(() => setExercises(before)));
  }
  /** Take row `i` out of its superset — with an Undo, because a pair's custom
   *  rests go with it. */
  function unpairRow(i: number) {
    const before = exercises;
    const d = exercises[i];
    const group = d?.supersetGroup ?? '';
    haptics.tap();
    setExercises(unpair(exercises, i));
    const msg = t('train.superset.leftGroup', { name: d?.name ?? '', group });
    showToast(msg, undoAction(() => setExercises(before)));
  }
  /** Open the group leader's rest fields and focus the first one. */
  function editRests(i: number) {
    const d = exercises[i];
    if (!d?.supersetGroup) return;
    const leader = (groups.get(d.supersetGroup) ?? [])[0]?.index ?? i;
    setOpenEx(leader);
    setMoreEx(leader);
    // The rest fields sit at the bottom of the leader's options, far below
    // its header: focus the first one once any menu/sheet is gone and the
    // card has rendered — the keyboard rises, `useRevealFocusedInput`
    // scrolls it into view (both platforms since T3) and VoiceOver lands on it.
    const uid = exercises[leader]?.uid;
    // The map only holds MOUNTED inputs, so an editor closed meanwhile
    // focuses nothing; the frame waits for the card's layout.
    setTimeout(() => requestAnimationFrame(() => {
      if (uid) restInputs.current.get(uid)?.focus();
    }), EDIT_RESTS_FOCUS_DELAY_MS);
  }
  /** The superset's two actions — the native menu's rows (J7), and the
   *  fallback sheet's two buttons where there is no native menu. */
  function supersetActions(i: number) {
    const d = exercises[i];
    return [
      { key: 'edit-rests', title: t('train.superset.editRests'), sfSymbol: 'timer', onPress: () => editRests(i) },
      { key: 'unpair', title: t('train.superset.unpairName', { name: d?.name ?? '' }), destructive: true, onPress: () => unpairRow(i) },
    ];
  }
  /** The paired card's link control, where there is no native menu (Expo Go,
   *  an older binary): the same two choices in a sheet. */
  function askSuperset(i: number) {
    const d = exercises[i];
    if (!d?.supersetGroup) return;
    const group = d.supersetGroup;
    const members = (groups.get(group) ?? []).map((m) => exercises[m.index]);
    const rests = groupRest(exercises, group);
    // What is in the superset, said; the default is the harmless "Edit rests",
    // and breaking the pair is the outlined second choice (it has an Undo).
    confirm({
      title: t('train.superset.manageTitle', { group }),
      body: `${members.map((m) => m.name).join(' + ')} · ${t('train.superset.restDescInline', { switch: `${rests.transitionRestSec} s`, round: `${rests.roundRestSec} s` })}`,
      confirmText: t('train.superset.editRests'),
      onConfirm: () => editRests(i),
      secondaryText: t('train.superset.unpairName', { name: d.name }),
      onSecondary: () => unpairRow(i),
      native: Platform.OS === 'ios',
    });
  }


  const doseWarnings = useMemo(
    () => new Set(mobilityDoseWarnings(
      exercises.map((d) => ({
        exerciseId: d.exerciseId,
        name: d.name,
        plannedSets: d.sets.map((x) => ({ kind: x.kind, durationSec: numOrUndef(x.durationText) })),
      })),
    ).map((w) => w.exerciseIndex)),
    [exercises],
  );
  const [moreEx, setMoreEx] = useState<number | null>(null);
  /** The card whose catalog lift the settings PAGE is open for. An exercise
   *  id, not an index: the list can be reordered under an open page. */
  const [liftFor, setLiftFor] = useState<string | null>(null);
  /** The editor's scroll offset when the settings page opened, restored on
   *  the way back so the lifter lands on the card they left (X6). */
  const editorScrollY = useRef(0);
  const liftReturnY = useRef<number | null>(null);
  /** Which card is showing the declared-but-unread structures (`drop`,
   *  `superset`). Null = every card shows the readable six. */
  const [structuresOpen, setStructuresOpen] = useState<number | null>(null);
  /** Which card just kept its typed rows through a structure change, so the
   *  card can SAY it did rather than look like the choice did nothing. */
  const [structureKept, setStructureKept] = useState<number | null>(null);
  /** Cards (by uid) whose cluster-name fields were asked for (E-N7). A card
   *  that already names a cluster shows them anyway. */
  const [clusterNamesFor, setClusterNamesFor] = useState<ReadonlySet<string>>(new Set());
  /** Notes, rest defaults and prescribed cardio, behind one row. A new
   *  template's first four fields used to be Name, Notes, "Rest (mini)" and
   *  "Rest (cluster)" — two of the four being myo-reps vocabulary, asked
   *  before a single exercise existed. */
  const [optionsOpen, setOptionsOpen] = useState(false);
  /** The card (by uid) whose full structure picker was opened from its
   *  compact "Set structure: … · Change" row (T6). */
  const [structurePick, setStructurePick] = useState<string | null>(null);
  /** Save pressed with no name: said under the field, not by a grey button
   *  that gives no reason (T10). */
  const [nameErr, setNameErr] = useState(false);
  const nameRef = useRef<TextInput>(null);
  /** The adder's multi-pick, in the order ticked (T18) — the order added. */
  const [picked, setPicked] = useState<ReadonlyMap<string, AdderPick>>(new Map());
  /** The adder is focused: an empty query then browses the catalog (T18). */
  const [adderFocused, setAdderFocused] = useState(false);
  /** The adder's y in the scroll content, so focusing it can lift it to the
   *  top and leave the results room above the keyboard (T1). */
  const adderY = useRef(0);
  /** The adder's box and each card's, for scrolling a just-added card into
   *  view (both measured in the window, the offset is the difference). */
  const adderRef = useRef<View>(null);
  const cardRefs = useRef(new Map<string, View>());
  /** The card to bring into view once the adder has folded away. */
  const [revealUid, setRevealUid] = useState<string | null>(null);
  const reduceMotion = useReducedMotion();
  /** Handed to Sortable so a drag near the sheet's edge scrolls it. It must be
   *  a Reanimated AnimatedRef on an Animated.ScrollView — a plain ref is
   *  accepted by the types and simply never auto-scrolls. */
  const scrollRef = useAnimatedRef<Animated.ScrollView>();
  /** The leaders' switch-rest inputs by card key — "Edit rests" focuses one. */
  const restInputs = useRef(new Map<string, TextInput>());
  /** The focused field, lifted above the keyboard once it is up — Android
   *  (UX_AUDIT S22) and, since T3, iOS. */
  const { onScroll: onEditorScroll, contentTopRef } = useRevealFocusedInput(scrollRef);
  /** Exercise cards need an explicit PIXEL width. They are children of
   *  `Sortable.Flex`, which wraps each one in a container it measures from the
   *  child — so there is no definite parent width for `100%` to resolve
   *  against, and neither `width: '100%'` nor `alignItems="stretch"` fills the
   *  row (both were tried on device; the cards stayed as wide as their exercise
   *  names, and a template read as a ragged staircase). The sheet pads
   *  `space.xl` each side. */
  const { width: windowWidth, fontScale } = useWindowDimensions();
  const cardWidth = windowWidth - space.xl * 2;
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  /**
   * The draft as it was opened, serialized — what "has anything been typed"
   * is measured against. A swipe, a backdrop tap or Android back used to
   * close the editor and throw a whole template's typing away with no
   * question (Train review bug 8); with changes, they now ask first.
   */
  const [pristine, setPristine] = useState('');

  /**
   * The editing session an Undo belongs to (fix R). Bumped on every open,
   * close and template switch: an Undo toast still on screen after the editor
   * closed used to write template A's list into template B when B opened.
   * Closing also dismisses the editor's own toast.
   */
  const editorSession = useRef(0);
  useEffect(() => {
    editorSession.current += 1;
    if (!visible) hideToast(EDITOR_UNDO_TOAST);
  }, [visible, template]);
  /** The list as last rendered — what a removal's Undo re-inserts into. */
  const exercisesNow = useRef(exercises);
  useEffect(() => {
    exercisesNow.current = exercises;
  });
  /** An Undo for a toast raised now: runs `fn` only in this editing session. */
  function undoAction(fn: () => void) {
    const session = editorSession.current;
    return {
      testID: EDITOR_UNDO_TOAST,
      action: {
        label: t('common.undo'),
        onPress: () => {
          if (editorSession.current === session) fn();
        },
      },
    };
  }

  useEffect(() => {
    if (!visible) return;
    const initialName = template?.name ?? '';
    const initialNotes = template?.notes ?? '';
    const initialRestMini = template?.restMiniSec != null ? String(template.restMiniSec) : '';
    const initialRestCluster = template?.restClusterSec != null ? String(template.restClusterSec) : '';
    const initialCardio: DraftCardio[] = (template?.cardioBlocks ?? []).map((b) => ({
      modality: b.modality,
      label: b.label ?? '',
      minutes: b.targetDurationSec != null ? String(Math.round(b.targetDurationSec / 60)) : '',
      distance:
        b.targetDistanceM != null
          ? String(toDisplayDistance(b.targetDistanceM, unitSystem))
          : '',
    }));
    const initialExercises: DraftEx[] = (template?.exercises ?? []).map((ex) => ({
        uid: nextUid(),
        exerciseId: ex.exerciseId,
        name: ex.name,
        logStyle: ex.logStyle ?? 'weight-reps',
        targetLoad: ex.targetLoad != null ? String(toDisplayLoad(ex.targetLoad, unitSystem)) : '',
        cuesText: (ex.cues ?? []).join('\n'),
        hasProgression: !!ex.progression,
        targetReps: ex.progression ? String(ex.progression.targetReps) : '',
        holdSessions: ex.progression ? String(ex.progression.holdSessions) : '',
        incrementLb: ex.progression ? String(toDisplayLoad(ex.progression.incrementLb, unitSystem)) : '',
        restMiniSec: ex.restMiniSec != null ? String(ex.restMiniSec) : '',
        restClusterSec: ex.restClusterSec != null ? String(ex.restClusterSec) : '',
        restAfterSec: ex.restAfterSec != null ? String(ex.restAfterSec) : '',
        restAfterOpened: ex.restAfterSec != null ? String(ex.restAfterSec) : '',
        ...(ex.restAfterMaxSec != null ? { restAfterMaxSec: ex.restAfterMaxSec } : {}),
        setStructure: ex.setStructure,
        sets: ex.plannedSets.length
          ? ex.plannedSets.map((ps) => toDraftSet(ps, unitSystem))
          : [newDraftSet('working')],
        ...(ex.loadLog ? { loadLog: ex.loadLog } : {}),
        ...(ex.supersetGroup ? { supersetGroup: ex.supersetGroup } : {}),
        ...(ex.pairPosition ? { pairPosition: ex.pairPosition } : {}),
        ...(ex.transitionRestSec != null ? { transitionRestSec: ex.transitionRestSec } : {}),
        ...(ex.roundRestSec != null ? { roundRestSec: ex.roundRestSec } : {}),
        ...(ex.targetLoad != null
          ? { loadAsOpened: { text: String(toDisplayLoad(ex.targetLoad, unitSystem)), lb: ex.targetLoad } }
          : {}),
      }));
    setName(initialName);
    setNotes(initialNotes);
    setRestMini(initialRestMini);
    setRestCluster(initialRestCluster);
    setCardioBlocks(initialCardio);
    setExercises(initialExercises);
    setPristine(draftKey(initialName, initialNotes, initialRestMini, initialRestCluster, initialExercises, initialCardio));
    setKindOpen(null);
    setOpenEx(null);
    setMoreEx(null);
    setLiftFor(null);
    setStructuresOpen(null);
    setStructureKept(null);
    setClusterNamesFor(new Set());
    // Opened by DEFAULT when the template already uses any of it — an existing
    // template's notes and rests must not become invisible on the next edit.
    setOptionsOpen(
      !!template && (
        !!template.notes || template.restMiniSec != null
        || template.restClusterSec != null || (template.cardioBlocks?.length ?? 0) > 0
      ),
    );
    setErr('');
    setExName('');
    setExStyle('weight-reps');
    setBusy(false);
    setStructurePick(null);
    setNameErr(false);
    setPicked(new Map());
    setAdderFocused(false);
  }, [visible, template]);

  const trimmedEx = exName.trim();

  // After the list folds and the keyboard starts down (a frame is not enough
  // for the Sortable's layout pass), scroll the added card to just under the
  // top of the sheet. Measured against the adder, whose content offset is known.
  useEffect(() => {
    if (!revealUid) return;
    const timer = setTimeout(() => {
      setRevealUid(null);
      const card = cardRefs.current.get(revealUid);
      const adder = adderRef.current;
      if (!card || !adder) return;
      adder.measureInWindow((_ax, ay) => {
        card.measureInWindow((_cx, cy) => {
          if (!Number.isFinite(ay) || !Number.isFinite(cy)) return;
          scrollRef.current?.scrollTo({ y: Math.max(0, adderY.current + (cy - ay) - space.sm), animated: !reduceMotion });
        });
      });
    }, REVEAL_DELAY_MS);
    return () => clearTimeout(timer);
  }, [revealUid, reduceMotion, scrollRef]);

  /** The lift's sets from its last session — what a new card's ghosts and
   *  starting load come from (T7). */
  const lastSets = (exerciseId: string) => previousSets(exerciseHistory(train.recentSessions, exerciseId));

  /** Blank rows for `kinds`, each showing what the lifter did in it last time
   *  as ghost text (T7, `ghostBuffers`). Nothing is put in the buffers, so an
   *  untouched card saves no per-set weight or reps (fix R): those would
   *  override the lift's `targetLoad` and stall progression for good. */
  function seededRows(exerciseId: string, logStyle: LogStyle, kinds: readonly SetKind[]): DraftSet[] {
    const prev = lastSets(exerciseId);
    const ghosts = prev.length ? ghostBuffers(kinds, prev, logStyle, unitSystem) : [];
    return normalizeClusterGroups(kinds.map((k, i) => {
      const ghost = ghosts[i];
      return ghost ? { ...newDraftSet(k), ghost } : newDraftSet(k);
    }));
  }

  function buildEx(
    exercise: Pick<DraftEx, 'exerciseId' | 'name' | 'logStyle'> & { cuesText?: string },
    kind: SetKind,
  ): DraftEx {
    return {
      uid: nextUid(),
      isNew: true,
      ...exercise,
      // The lift's load starts at last session's working load, in the field
      // progression moves — not copied onto each row (fix R).
      targetLoad: seedTargetLoad(lastSets(exercise.exerciseId), exercise.logStyle, unitSystem),
      cuesText: exercise.cuesText ?? '',
      hasProgression: false,
      targetReps: '',
      holdSessions: '',
      incrementLb: '',
      restMiniSec: '',
      restClusterSec: '',
      restAfterSec: '',
      restAfterOpened: '',
      sets: seededRows(exercise.exerciseId, exercise.logStyle, [kind, kind, kind]),
    };
  }

  function appendEx(
    exercise: Pick<DraftEx, 'exerciseId' | 'name' | 'logStyle'> & { cuesText?: string },
    // The scaffolded sets' kind. Defaulted rather than required so the catalog
    // and cardio paths read unchanged; only mobility ever passes anything.
    kind: SetKind = 'working',
  ) {
    appendMany([buildEx(exercise, kind)]);
  }

  /** Append built cards; the first one opens (you added it to edit it). */
  function appendMany(added: DraftEx[]) {
    if (!added.length) return;
    setExercises((prev) => [...prev, ...added]);
    setOpenEx(exercises.length); // the index the first new card lands on
    setMoreEx(null);
    setExName('');
    setPicked(new Map());
    // The pick is made: the keyboard and the result list go, and the new card
    // is brought into view — it used to sit under both, so the next tap
    // landed on a key (Train UX v2 QA; regression 18 needed a return press).
    Keyboard.dismiss();
    setAdderFocused(false);
    setRevealUid(added[0].uid);
    // Structure first (ADR-0041 §5): the new card opens on the full picker.
    setStructurePick(added[0].uid);
    // Said, because the card lands below the adder, out of a screen reader's
    // current position (T13).
    announce(added.length === 1
      ? t('train.exAddedA11y', { name: added[0].name, count: setCountText(t, locale, added[0].sets) })
      : added.map((d) => d.name).join(', '));
  }

  function addFromCatalog(c: Exercise) {
    haptics.tap();
    // A seeded mobility movement stays mobility when re-added from the catalog,
    // whatever the chip above happens to be showing — otherwise typing "couch"
    // to get Couch Stretch back quietly produces `working` sets, which is the
    // same defect the chip exists to fix, one door over. MOBILITY_SEED_KEYS
    // classifies SEEDED movements only; a user-created stretch is classified by
    // the chip they picked and never by a guess about its name.
    const mobility = exStyle === 'mobility'
      || (c.seedKey != null && MOBILITY_SEED_KEYS.has(c.seedKey));
    appendEx({
      exerciseId: c.id!,
      name: c.name,
      logStyle: c.logStyle ?? 'weight-reps',
      cuesText: (c.defaultCues ?? []).join('\n'),
    }, mobility ? 'mobility' : 'working');
  }

  /** A shipped library movement: ensure the catalog entry (with its muscles
   *  and localized cues) exists, then append it like any other. */
  async function addFromLibrary(seed: SeedExercise) {
    if (busy) return;
    haptics.tap();
    setBusy(true);
    try {
      const { id, name: canonical, logStyle } = await train.addLibraryExercise(seed);
      appendEx(
        {
          exerciseId: id,
          name: canonical,
          logStyle,
          cuesText: seedExerciseCues(seed, locale).join('\n'),
        },
        seedSetKind(seed, logStyle),
      );
    } catch (e) {
      // A catch that resets and rethrows, then the same reset after it: the
      // `finally` this was cannot be lowered by React Compiler, which skips
      // the whole component. Same effect — reset on both paths, the error
      // still propagates to the caller.
      setBusy(false);
      throw e;
    }
    setBusy(false);
  }

  async function addFreeType() {
    if (!trimmedEx || busy) return;
    haptics.tap();
    setBusy(true);
    try {
      const style = logStyleFor(exStyle);
      const id = await train.addCatalogExercise(trimmedEx, style);
      appendEx({ exerciseId: id, name: trimmedEx, logStyle: style }, setKindFor(exStyle));
    } catch (e) {
      // Reset and rethrow, then reset after: see `addFromLibrary`.
      setBusy(false);
      throw e;
    }
    setBusy(false);
  }

  /** Tick or untick one adder row (T18) — the in-session sheet's pick. */
  function togglePick(key: string, pick: AdderPick) {
    haptics.selection();
    setPicked((cur) => {
      const next = new Map(cur);
      if (next.has(key)) next.delete(key);
      else next.set(key, pick);
      return next;
    });
  }

  /** "Add (n)": every ticked row, in the order ticked. Library rows mint
   *  their catalog entry first, as a single pick does. */
  async function addPicked() {
    if (busy || picked.size === 0) return;
    haptics.tap();
    setBusy(true);
    const picks = [...picked.values()];
    // Built by a nested function and only CALLED inside the try: React
    // Compiler cannot lower the conditionals below inside a try block.
    const resolve = async (p: AdderPick): Promise<DraftEx> => {
      if (p.kind === 'catalog') {
        const c = p.exercise;
        const mobility = exStyle === 'mobility' || (c.seedKey != null && MOBILITY_SEED_KEYS.has(c.seedKey));
        return buildEx(
          { exerciseId: c.id!, name: c.name, logStyle: c.logStyle ?? 'weight-reps', cuesText: (c.defaultCues ?? []).join('\n') },
          mobility ? 'mobility' : 'working',
        );
      }
      const { id, name: canonical, logStyle } = await train.addLibraryExercise(p.seed);
      return buildEx(
        { exerciseId: id, name: canonical, logStyle, cuesText: seedExerciseCues(p.seed, locale).join('\n') },
        seedSetKind(p.seed, logStyle),
      );
    };
    const run = async () => {
      const built: DraftEx[] = [];
      for (const p of picks) built.push(await resolve(p));
      return built;
    };
    try {
      appendMany(await run());
    } catch (e) {
      // Reset and rethrow, then reset after: see `addFromLibrary`.
      setBusy(false);
      throw e;
    }
    setBusy(false);
  }

  function addCardio(modality: CardioModality) {
    setCardioBlocks((cur) => [...cur, { modality, label: '', minutes: '', distance: '' }]);
  }

  function patchCardio(index: number, patch: Partial<DraftCardio>) {
    setCardioBlocks((cur) => cur.map((b, i) => (i === index ? { ...b, ...patch } : b)));
  }

  /** With an Undo, like every removal here (T5). */
  function removeCardio(index: number) {
    const b = cardioBlocks[index];
    if (!b) return;
    haptics.tap();
    setCardioBlocks(cardioBlocks.filter((_, i) => i !== index));
    // Undo puts back THIS block into the list as it is then — not a snapshot
    // that would undo every edit made while the toast was up (fix R).
    showToast(
      t('train.exRemovedToast', { name: b.label.trim() || t(TPL_MODALITY_KEY[b.modality]) }),
      undoAction(() => setCardioBlocks((cur) => reinsertAt(cur, b, index))),
    );
  }

  function patchEx(index: number, patch: Partial<DraftEx>) {
    setExercises((prev) => prev.map((d, i) => (i === index ? { ...d, ...patch } : d)));
  }

  function removeEx(index: number) {
    const before = exercises;
    const d = exercises[index];
    if (!d) return;
    haptics.tap();
    // A partner left alone runs straight: normalize, so its tag goes too.
    setExercises(normalizeSupersets(exercises.filter((_, i) => i !== index)));
    // The flags are INDICES into a list that just shifted; stale ones would
    // expand whichever exercise slid into the removed slot.
    setOpenEx(null);
    setMoreEx(null);
    // A whole card's sets, cues and progression went with that one tap, so it
    // comes back with one (T5). Undo re-inserts THIS card into the list as it
    // is then, with the superset it broke (`reinsertCard`) — not the list as
    // it was, which dropped every edit made while the toast was up (fix R).
    showToast(t('train.exRemovedToast', { name: d.name }), undoAction(() => {
      const next = reinsertCard(exercisesNow.current, d, index, before);
      setExercises(next);
      const at = next.findIndex((x) => x.uid === d.uid);
      setOpenEx(at >= 0 ? at : null);
      setMoreEx(null);
    }));
  }

  // Reorder by one position (array order IS the saved template order). Robust
  // ▲▼ controls; true drag-to-reorder is a follow-up (needs on-device tuning).
  function moveEx(from: number, dir: -1 | 1, announceMove = true) {
    // One step treats a superset as a unit: a lift hops over a whole block,
    // and moving a member moves the block. Leaving a pair is "Unpair".
    const r = moveBlockAware(exercises, from, dir);
    if (r.newIndex === from) return;
    setExercises(r.rows);
    // Where it landed, said — a screen-reader user moving twice in a row
    // needs to hear the new position, not silence.
    // Counted in units — a superset is ONE place in the order, as it moves.
    const moved = exercises[from];
    const units = orderBlocks(r.rows);
    const unitAt = units.findIndex((u) => u.includes(r.newIndex)) + 1;
    if (announceMove) {
      announce(moved?.supersetGroup && tags[from]
        ? t('train.superset.blockMovedA11y', { group: moved.supersetGroup, n: unitAt, total: units.length })
        : t('train.movedToA11y', { name: moved?.name ?? '', n: unitAt, total: units.length }));
    }
    const openRow = openEx != null ? exercises[openEx] : undefined;
    setOpenEx(openRow ? r.rows.indexOf(openRow) : null);
    setMoreEx(null);
    haptics.tap();
  }

  /** Drag reorder. A MOVE, not the swap `moveEx` does: dragging card 1 to
   *  position 3 must slide 2 and 3 up, where a swap would leave 2 where it is
   *  and put 1 where 3 was. Both write the same array order, which IS the
   *  saved template order. */
  function onExDragEnd({ fromIndex, toIndex }: { fromIndex: number; toIndex: number }) {
    if (fromIndex === toIndex) return;
    haptics.tap();
    applyReorder(fromIndex, toIndex);
    // Same reason removeEx resets these: they are INDICES into a list that
    // just shifted, and a stale one expands whichever card slid into the slot.
    setOpenEx(null);
    setMoreEx(null);
  }

  /** A reorder that keeps supersets honest (core `reorderWithSupersets`): a
   *  member moved away from its partner leaves the superset, and is told so. */
  function applyReorder(from: number, to: number) {
    const r = reorderWithSupersets(exercises, from, to);
    setExercises(r.rows);
    if (r.left) {
      const msg = t('train.superset.leftGroup', { name: r.left.row.name, group: r.left.group });
      showToast(msg, undoAction(() => setExercises(exercises)));
    }
  }

  /** Every set mutation re-derives cluster groups, so numbering stays
   *  sequential and contiguous after kind changes, inserts and deletes —
   *  same invariant the PWA editor holds (`mutateSets`). */
  function mutateSets(index: number, fn: (sets: DraftSet[]) => DraftSet[]) {
    setExercises((prev) =>
      prev.map((d, i) => (i === index ? { ...d, sets: normalizeClusterGroups(fn(d.sets)) } : d)),
    );
  }

  /** A new row copies the last working row's numbers (T7): set 4 of a
   *  3 × 8 @ 135 is not a blank form. */
  function addSet(index: number) {
    haptics.tap();
    mutateSets(index, (sets) => [...sets, { ...newDraftSet('working'), ...nextSetRow(sets) }]);
  }

  /** "Copy set 1 to all sets": row 1's numbers into the blank rows of its
   *  kind (T7). Rows with numbers already are left alone. */
  function copyFirstToAll(index: number) {
    haptics.tap();
    mutateSets(index, (sets) => {
      const targets = new Set(copyFirstTargets(sets));
      const { weightText, repsText, durationText } = sets[0];
      return sets.map((s, i) => (targets.has(i) ? { ...s, weightText, repsText, durationText } : s));
    });
  }

  function addCluster(index: number) {
    haptics.tap();
    mutateSets(index, (sets) => [...sets, newDraftSet('activation'), newDraftSet('mini'), newDraftSet('mini')]);
  }

  /** ADR-0040: rest-pause and cluster sets are an activation plus PRESCRIBED
   *  continuations. One button, because the two differ in what the engine
   *  reads (total reps vs completion), not in how they are scaffolded. */
  function addBlock(index: number) {
    haptics.tap();
    mutateSets(index, (sets) =>
      sets.some((x) => x.kind === 'activation')
        ? [...sets, newDraftSet('continuation')]
        : [...sets, newDraftSet('activation'), newDraftSet('continuation')],
    );
  }

  /** With an Undo (T5, rubric R42): the ✕ sits beside the reps field. */
  function removeSet(index: number, setIdx: number, label: string) {
    const d = exercises[index];
    const removed = d?.sets[setIdx];
    if (!d || !removed) return;
    const uid = d.uid;
    haptics.tap();
    mutateSets(index, (sets) => sets.filter((_, i) => i !== setIdx));
    showToast(t('train.setRemovedToast', { n: label }), undoAction(() =>
      // By card key, not index: the list may have been reordered since. Only
      // the removed row goes back, so the card's other edits stay (fix R).
      setExercises((prev) => prev.map((x) => (
        x.uid === uid ? { ...x, sets: normalizeClusterGroups(reinsertAt(x.sets, removed, setIdx)) } : x
      ))),
    ));
  }

  /** Edit one set's target buffers. No haptic — this fires per keystroke. */
  function patchSet(index: number, setIdx: number, patch: Partial<DraftSet>) {
    mutateSets(index, (sets) => sets.map((s, i) => (i === setIdx ? { ...s, ...patch } : s)));
  }

  /** Name one cluster ("L" / "R"), on every set of its group. Empty clears it. */
  function setClusterLabel(index: number, group: number, text: string) {
    const label = text.trim();
    mutateSets(index, (sets) =>
      sets.map((s) => {
        if (s.group !== group) return s;
        const { label: _old, ...rest } = s;
        return label ? { ...rest, label } : rest;
      }),
    );
  }

  /**
   * Declare what this lift is programmed as — and, when the rows are still
   * placeholders, rewrite them to match (ADR-0040 + `scaffoldKindsFor`).
   *
   * The editor used to ask for the structure UNDERNEATH the sets table, after
   * three buttons (`+ Add set`, `+ Add cluster`, `+ Add block`) had already
   * made the user hand-build a set list that implies a structure. That is
   * backwards: the structure is the decision, the rows are its consequence.
   *
   * The scaffold is gated on {@link isPristineScaffold}. Rows the user has
   * typed numbers into are KEPT and only the declaration changes, with a line
   * saying so — this repo does not silently overrule a person who typed a
   * number, and a template's numbers are the ones that took real effort.
   */
  function setStructure(index: number, value: SetStructure | undefined) {
    haptics.tap();
    const current = exercises[index];
    if (!current) return;
    const kinds = scaffoldKindsFor(value);
    // `isPristineScaffold`, with rows the editor SEEDED from history counting
    // as placeholders: a number nobody typed must not block the scaffold.
    // Reps a new card saved from its grey numbers (S23-11) are seeded too,
    // when they still match what history offers (review R2 P2-4).
    const pristine =
      rowsUntouched(current.sets) || rowsSeededFromHistory(current.sets, lastSets(current.exerciseId), current.logStyle);
    // Both decisions are made HERE, out of the updater. Calling `setState`
    // from inside another `setState`'s updater makes the updater impure, and
    // React is free to run it twice or discard the result — which it did: the
    // scaffold silently never applied.
    const rescaffold = kinds.length > 0 && pristine;
    // Only a notice when there was a scaffold to apply and it was withheld.
    // "Auto" declares nothing and rewrites nothing, by design.
    setStructureKept(kinds.length > 0 && !pristine ? index : null);
    // A choice made: the picker folds back to its one-line summary (T6).
    setStructurePick(null);
    setExercises((prev) =>
      prev.map((d, i) =>
        i === index
          ? {
              ...d,
              setStructure: value,
              // The new rows get ghosts again, by kind: last session's
              // working sets show over working rows, never a myo-rep's minis.
              ...(rescaffold
                ? { sets: seededRows(d.exerciseId, d.logStyle, kinds) }
                : {}),
            }
          : d,
      ),
    );
  }

  function setSetKind(index: number, setIdx: number, kind: SetKind) {
    haptics.tap();
    // A row's ghost belongs to its old kind's counterpart: dropped with it.
    mutateSets(index, (sets) => sets.map((s, i) => {
      if (i !== setIdx) return s;
      const { ghost: _ghost, ...rest } = s;
      return { ...rest, kind };
    }));
    setKindOpen(null);
  }

  // Enabled unless a write is in flight: a nameless Save is answered with a
  // reason under the Name field, not a grey button that gives none (T10).
  const canSave = !busy;
  const dirty = useMemo(
    () => visible && draftKey(name, notes, restMini, restCluster, exercises, cardioBlocks) !== pristine,
    [visible, name, notes, restMini, restCluster, exercises, cardioBlocks, pristine],
  );

  /** A dismissal the user did not aim at a button. Clean → close. Dirty →
   *  ask, and stay open unless they choose to discard. */
  function requestClose(): boolean {
    if (!dirty) {
      onClose();
      return true;
    }
    // Named (T16): which template, and what happens to the saved version.
    // A new template has no saved version, and says so.
    const savedName = template?.name.trim();
    confirm({
      title: template
        ? t('train.discardTplTitle', { name: savedName || t('train.editTemplate') })
        : t('train.discardNewTplTitle'),
      body: template ? t('train.discardTplBody') : t('train.discardNewTplBody'),
      confirmText: t('train.discard'),
      destructive: true,
      onConfirm: onClose,
      // Over the editor's native sheet, iOS asks with the system action
      // sheet, not a sheet on a sheet (R30/R31, F2). Android keeps the branded
      // confirm: its dragged-away editor is re-presented and asks on arrival
      // (native-sheet-android-dismiss), a flow the system Alert is untested in.
      native: Platform.OS === 'ios',
    });
    return false;
  }

  async function save() {
    if (!canSave) return;
    if (!name.trim()) {
      setNameErr(true);
      haptics.warning();
      announce(t('train.templateNameRequired'));
      // The Name field sits above the scroll's top once the user is deep in
      // the cards: bring it back, then put the cursor in it.
      scrollRef.current?.scrollTo({ y: 0, animated: true });
      nameRef.current?.focus();
      return;
    }
    setBusy(true);
    setErr('');
    // Built by a nested function and only CALLED inside the try: React
    // Compiler cannot lower the conditionals and `?.` below inside a try
    // block and would skip the whole editor. A throw while building still
    // lands in the catch, as before.
    const buildDraft = (): TemplateDraft => {
      const draft: TemplateDraft = {
        name: name.trim(),
        notes: notes.trim() || undefined,
        restMiniSec: numOrUndef(restMini),
        restClusterSec: numOrUndef(restCluster),
        // Carry the seed slug through: the starter chooser hides an already
        // cloned starter by seedKey, and dropping it on the first edit would
        // make the starter reappear as if it had never been added.
        seedKey: template?.seedKey,
        // `undefined`, not `[]`, when there is no cardio: the writers omit an
        // absent key entirely, so a template that never prescribed cardio does
        // not gain an empty array on its next save.
        cardioBlocks: cardioBlocks.length
          ? cardioBlocks.map((b): PlannedCardioBlock => {
              const minutes = numOrUndef(b.minutes);
              const meters = b.distance.trim() ? parseDistanceToM(b.distance, unitSystem) : null;
              return {
                modality: b.modality,
                label: b.label.trim() || undefined,
                targetDurationSec: minutes != null ? Math.round(minutes * 60) : undefined,
                targetDistanceM: meters ?? undefined,
              };
            })
          : undefined,
        exercises: exercises.map((d): TemplateExercise => {
          const cues = d.cuesText.split('\n').map((c) => c.trim()).filter(Boolean);
          return {
            exerciseId: d.exerciseId,
            name: d.name,
            logStyle: d.logStyle,
            targetLoad: d.loadAsOpened && d.targetLoad === d.loadAsOpened.text
              ? d.loadAsOpened.lb
              : parseLoadToLb(d.targetLoad, unitSystem) ?? undefined,
            cues: cues.length ? cues : undefined,
            progression: d.hasProgression
              ? {
                  targetReps: numOrUndef(d.targetReps) ?? 12,
                  holdSessions: numOrUndef(d.holdSessions) ?? 2,
                  incrementLb:
                    parseLoadToLb(d.incrementLb, unitSystem) ?? defaultIncrementLb(unitSystem),
                }
              : undefined,
            restMiniSec: numOrUndef(d.restMiniSec),
            setStructure: d.setStructure,
            // A new card's rows save the grey REPS they show (S23-11,
            // `repsToSave`); a grey per-set weight never is (fix R).
            plannedSets: spreadClusterLabels(normalizeClusterGroups(
              d.sets.length
                ? d.sets.map((s, si) => ({ ...s, repsText: numText(repsToSave(s, lastSets(d.exerciseId)[si], d.logStyle, d.isNew)) }))
                : [newDraftSet('working')],
            ).map((d) => toPlannedSet(d, unitSystem))),
            loadLog: d.loadLog,
            supersetGroup: d.supersetGroup,
            pairPosition: d.pairPosition,
            transitionRestSec: d.transitionRestSec,
            roundRestSec: d.roundRestSec,
          };
        }),
      };
      // Canonical superset form: members together, lettered A/B/C, the rests
      // on each group's leader, a member left alone running straight.
      draft.exercises = normalizeSupersets(draft.exercises);
      // A load changed by hand is a move of the lift's load like any applied
      // call, and is logged as the lifter's (`by: 'user'`) so the history can
      // tell the two apart.
      const at = new Date();
      draft.exercises = logUserLoadEdits(template?.exercises ?? [], draft.exercises, {
        at,
        reason: t('train.loadLog.userEdit'),
      });
      // Carry what this editor does not show (rest before the next exercise, a
      // baseline marker) and stamp the rows the lifter actually changed — a
      // save of an untouched row keeps its old stamp.
      draft.exercises = carryAndStampRows(template?.exercises ?? [], draft.exercises, { at, by: 'user' });
      // The two per-lift rests ARE shown here now, so what the fields say is
      // the answer — including a cleared field, which the carry above would
      // otherwise put back. Re-stamped, so a row changed only in its rests is
      // still marked as the lifter's edit.
      const shown = new Map(exercises.map((d) => [d.exerciseId, d]));
      draft.exercises = stampChangedRows(
        template?.exercises ?? [],
        draft.exercises.map((row) => {
          const d = shown.get(row.exerciseId);
          return d ? withShownRests(row, d) : row;
        }),
        { at, by: 'user' },
      );
      // A lift added to or taken out of a superset, moved here from another
      // day, or moved in the order starts a new baseline: its next read is
      // not judged as a failed test (core `superset-context.ts`). Judged
      // against every live template, so a move between days is seen.
      const changes = contextChanges(train.templates, { id: template?.id, exercises: draft.exercises });
      draft.exercises = applyContextBaselines(draft.exercises, changes, {
        since: (id) => baselineSince(id, train.recentSessions, at),
        catalog: (id) => train.catalog.find((e) => e.id === id) ?? null,
      });
      return draft;
    };
    const templateId = template?.id;
    try {
      await train.saveTemplate(buildDraft(), templateId);
      onClose();
    } catch {
      // Without this the sheet just sat there on a rejected write and the
      // save looked like a no-op — the failure mode that hid this bug. Felt
      // and spoken too, and shown under the header the Save was pressed in:
      // at the end of the content it sat under every card (E-N3).
      setErr(t('train.saveErr'));
      haptics.warning();
      announce(t('train.saveErr'));
    }
    // After the try/catch, not in a `finally`: React Compiler cannot lower a
    // `finally` and skips the whole component. Nothing above can throw past
    // the catch, so this still runs on both paths.
    setBusy(false);
  }

  /** Delete, after asking — it was one tap, unconfirmed, with no catch
   *  (Train review bug 6). */
  function remove() {
    if (!template?.id || busy) return;
    const id = template.id;
    confirm({
      // `{name}`: the key reads "Delete {name}?" (review H10/T16, key owned by
      // the home-screen pass); a key still without the slot ignores it.
      title: t('train.deleteTemplateTitle', { name: template.name }),
      body: t('train.deleteTemplateBody'),
      confirmText: t('train.delete'),
      destructive: true,
      native: Platform.OS === 'ios',
      onConfirm: () => {
        void (async () => {
          setBusy(true);
          try {
            await train.deleteTemplate(id);
            onClose();
          } catch {
            haptics.warning();
            showToast(t('train.templateDeleteErr'));
          }
          // After the try/catch, not in a `finally`: React Compiler cannot
          // lower one and skips the whole component.
          setBusy(false);
        })();
      },
    });
  }

  const liftEx = liftFor ? train.catalog.find((c) => c.id === liftFor) ?? null : null;
  const liftRow = liftFor ? exercises.find((d) => d.exerciseId === liftFor) : undefined;
  /**
   * Lift settings, as a PAGE of this sheet rather than a second sheet stacked
   * on it (train-ux X6/T26/J7, R30/R34) — the in-sheet mode ExerciseDetail
   * uses. The editor's draft is this component's state, untouched while the
   * page shows, so Back returns to it exactly as left. The stack fallback step
   * reads the row's increment as typed.
   */
  const liftOpen = visible && liftEx != null;
  const lift = useLiftSettingsDraft({
    active: liftOpen,
    exercise: liftEx,
    templateRow: liftRow ? {
      name: liftRow.name,
      progression: liftRow.hasProgression
        ? { incrementLb: parseLoadToLb(liftRow.incrementLb, unitSystem) ?? defaultIncrementLb(unitSystem) }
        : undefined,
      // As drafted, so the cluster-credit line follows the card (J-N1).
      setStructure: liftRow.setStructure,
      plannedSets: liftRow.sets,
    } : null,
    onClose: () => setLiftFor(null),
    onSave: (patch) => (liftEx?.id ? train.editCatalogExercise(liftEx.id, patch) : Promise.resolve()),
  });
  const backName = name.trim() || (template ? t('train.editTemplate') : t('train.newTemplateTitle'));

  // Into the page: from its top. Back out: where the lifter was. The frame
  // lets the swapped content lay out before the offset is applied.
  useEffect(() => {
    if (liftOpen) {
      if (liftReturnY.current == null) liftReturnY.current = editorScrollY.current;
      scrollRef.current?.scrollTo({ y: 0, animated: false });
    } else if (liftReturnY.current != null) {
      const y = liftReturnY.current;
      liftReturnY.current = null;
      requestAnimationFrame(() => scrollRef.current?.scrollTo({ y, animated: false }));
    }
  }, [liftOpen, scrollRef]);

  /** Every dismissal while the page shows. Android back steps out of the page
   *  (`backSteps`), asking first over unsaved settings; a swipe or backdrop
   *  with unsaved settings asks about THOSE before the editor can close. */
  function requestDismiss(via: SheetCloseVia): boolean {
    if (liftOpen && (via === 'back' || lift.dirty)) {
      lift.requestClose();
      return false;
    }
    return requestClose();
  }

  return (
    <BottomSheet
      // Full height, native, and GUARDED while there are changes: a swipe
      // then asks instead of discarding (Train review items 8, 21).
      native
      detents={[1]}
      guarded={dirty || (liftOpen && lift.dirty)}
      // Android back leaves the Lift settings page before the editor (X6).
      backSteps={liftOpen}
      onRequestClose={requestDismiss}
      backdropTestID="template-backdrop"
      // Its Cancel / Save live in the header; a top toast (Undo, "paired")
      // covered them for 4–5 s (Train UX v2 QA). Bottom here only.
      toastAt="bottom"
      visible={visible}
      onClose={onClose}
      contentStyle={styles.sheetBody}
      maxHeight="80%"
    >
      {/* Gestures inside a `Modal` need their own root: RNGH attaches to the
          nearest GestureHandlerRootView, and the app's lives outside this
          modal's native view on Android, where the drag would otherwise never
          start. Harmless on iOS. It sits INSIDE `<BottomSheet>` rather than
          wrapping it for exactly that reason — the root has to be within the
          modal's native view, and the modal now belongs to the sheet.
          KEPT on 2026-10-04 although the iOS sheet is now native (a root
          route, under the app's own root): Android still presents this as
          the JS sheet — an RN Modal — and the drag there needs it. A nested
          root inside the native sheet is the harmless case above. */}
      <GestureHandlerRootView style={styles.ghRoot}>
          {/* Cancel and Save in the header, OUTSIDE the scroll (T2): Save was
              the last thing on a long page, under every card, and the only
              way out without saving was a swipe. Cancel runs the same
              dirty-check a swipe does. */}
          {liftOpen ? (
            // The page's header: its own Save, and no Cancel — the Back row
            // under it is the way out, named after where it goes. The
            // template's Save is not offered from inside another form. The
            // title is the lift; "Lift settings" is the form's first line
            // (H-N15), and the form drops its own foot (E-N4).
            <SheetHeader
              title={lift.name || t('train.lift.title')}
              trailing={{ label: t('common.save'), onPress: () => void lift.save(), disabled: !lift.canSave, testID: 'lift-save-header' }}
            />
          ) : (
            <SheetHeader
              title={template ? t('train.editTemplate') : t('train.newTemplateTitle')}
              leading={{ label: t('common.cancel'), onPress: () => void requestClose(), testID: 'template-cancel' }}
              trailing={{
                label: busy ? t('common.saving') : t('common.save'),
                onPress: () => void save(),
                disabled: !canSave,
                testID: 'save-template',
              }}
            />
          )}
          {err && !liftOpen ? (
            <Text style={[styles.error, { marginBottom: space.sm }]} accessibilityLiveRegion="polite" testID="template-save-error">
              {err}
            </Text>
          ) : null}
          <Animated.ScrollView
            // Android: the native formSheet is a Material BottomSheetBehavior,
            // which lets a child scroll first ONLY if it has nested scrolling
            // on (off by default in RN). Without it every downward drag went
            // to the sheet — the editor could not scroll back up and a slow
            // drag dismissed it (Maestro 18's "overshoot", round 2). Every
            // scroller inside a native sheet carries it;
            // `native-sheet-nested-scroll.test.ts` holds that.
            nestedScrollEnabled
            ref={scrollRef}
            onScroll={(e) => {
              if (!liftOpen) editorScrollY.current = e.nativeEvent.contentOffset.y;
              onEditorScroll(e);
            }}
            scrollEventThrottle={32}
            // NOT `automaticallyAdjustKeyboardInsets` (regression 18, iOS 26,
            // 2026-10-12). The sheet route already pads for the keyboard on
            // both platforms, which shrinks this ScrollView so every field
            // stays reachable, and `useRevealFocusedInput` places the focused
            // one. With the prop on, focusing set row 1 scrolled it 282pt —
            // under the Cancel / Save header — against ~220 without it.
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            /* Bottom slack is REQUIRED, not cosmetic. The exercise cards live in
               a Sortable.Flex, which positions its children absolutely and
               reports a container height that does not grow when a card is
               expanded. So the ScrollView's contentSize under-counts the open
               card, scrolling stops short of the end, and everything past it is
               unreachable — measured on a 360x720dp Android screen 2026-08-19,
               where opening "More options" put the unit selector, the cues box
               and auto-progression permanently off-screen with no way to scroll
               to them. Padding adds real contentSize, which is what restores
               the scroll range. */
            contentContainerStyle={{ paddingBottom: liftOpen ? space.xl : 360 }}
          >
            {/* Content y = 0, measured beside the focused field so the reveal
                reads the offset off the same layout (regression 18). */}
            <View ref={contentTopRef} collapsable={false} style={{ height: 0 }} />
            {liftOpen ? (
              <View>
                <TouchableOpacity
                  style={styles.liftBackRow}
                  onPress={() => void lift.requestClose()}
                  accessibilityRole="button"
                  accessibilityLabel={t('train.lift.backTo', { name: backName })}
                  testID="lift-back"
                >
                  <Ionicons name="chevron-back" size={20} color={colors.teal} />
                  <Text style={styles.liftBackText} numberOfLines={1}>{backName}</Text>
                </TouchableOpacity>
                <LiftSettingsForm draft={lift} mode="page" />
              </View>
            ) : (
            <>
            <Text style={[styles.fieldLabel, { marginTop: space.sm }]}>{t('train.templateName')}</Text>
            <SheetTextInput
              ref={nameRef}
              style={[styles.input, nameErr && { borderColor: colors.danger }]}
              placeholder={t('train.templateNamePh')}
              placeholderTextColor={colors.faint}
              value={name}
              onChangeText={(v) => {
                setName(v);
                if (nameErr && v.trim()) setNameErr(false);
              }}
              accessibilityLabel={t('train.templateName')}
              accessibilityHint={nameErr ? t('train.templateNameRequired') : undefined}
              testID="template-name"
            />
            {nameErr ? (
              <Text style={[styles.error, { marginTop: space.xs }]} testID="template-name-error">
                {t('train.templateNameRequired')}
              </Text>
            ) : null}

            {/* Notes, rest defaults and prescribed cardio, behind one row.
                A new template's first four fields were Name, Notes, "Rest
                (mini)" and "Rest (cluster)" — two of the four myo-reps
                vocabulary, asked before a single exercise existed, of someone
                who may never program a cluster. Name and exercises is the
                whole form now; the rest is one tap away and opens itself for
                any template that already uses it. */}
            <TouchableOpacity
              style={styles.tplOptionsRow}
              onPress={() => {
                haptics.tap();
                setOptionsOpen((o) => !o);
              }}
              accessibilityRole="button"
              accessibilityState={{ expanded: optionsOpen }}
              testID="template-options"
            >
              <Text style={[styles.tplOptionsText, { flex: 1, flexShrink: 1 }]}>{t('train.templateOptions')}</Text>
              <Ionicons
                name={optionsOpen ? 'chevron-up' : 'chevron-down'}
                size={16}
                color={colors.muted}
              />
            </TouchableOpacity>

            {optionsOpen ? (
            <>
            <Text style={[styles.fieldLabel, { marginTop: space.sm }]}>{t('train.templateNotes')}</Text>
            <SheetTextInput
              style={[styles.input, styles.notesInput]}
              placeholder={t('train.templateNotesPh')}
              placeholderTextColor={colors.faint}
              value={notes}
              onChangeText={setNotes}
              multiline
              accessibilityLabel={t('train.templateNotes')}
              testID="template-notes"
            />

            {/* One heading, two short labels (F11): "Rest between exercises
                (s)" wrapped beside its one-line twin and the pair read out
                of line. */}
            <Text style={[styles.fieldLabel, { marginTop: space.md }]} testID="template-rest-heading">{t('train.restHeading')}</Text>
            <View style={styles.restRow}>
              <View style={styles.restCell}>
                <Text style={[styles.tplSetsLabel, { marginTop: space.xs }]}>{t('train.restMini')}</Text>
                <SheetTextInput
                  style={styles.input}
                  keyboardType="number-pad"
                  // The rest the session uses while this is blank (E-N8).
                  placeholder={String(DEFAULT_REST_MINI_SEC)}
                  placeholderTextColor={colors.faint}
                  value={restMini}
                  onChangeText={setRestMini}
                  {...doneKey}
                  accessibilityLabel={t('train.restMiniA11y')}
                  testID="template-rest-mini"
                />
              </View>
              <View style={styles.restCell}>
                <Text style={[styles.tplSetsLabel, { marginTop: space.xs }]}>{t('train.restCluster')}</Text>
                <SheetTextInput
                  style={styles.input}
                  keyboardType="number-pad"
                  placeholder={String(DEFAULT_REST_CLUSTER_SEC)}
                  placeholderTextColor={colors.faint}
                  value={restCluster}
                  onChangeText={setRestCluster}
                  {...doneKey}
                  accessibilityLabel={t('train.restClusterA11y')}
                  testID="template-rest-cluster"
                />
              </View>
            </View>
            {/* "Rest between exercises" is also the rest between clusters —
                said only where a cluster exists to be rested between (T14). */}
            {exercises.some((d) => d.sets.some((x) => x.kind === 'activation')) ? (
              <Text style={styles.tplDoseNote} testID="template-rest-cluster-hint">{t('train.restClusterHint')}</Text>
            ) : null}

            {/* ── Prescribed cardio (ADR-0025) ──
                Above the exercise list rather than below it: a cardio-only
                template (a running plan) is a legitimate template, and burying
                the only section it uses under an empty exercise list would make
                it read as an afterthought. */}
            <Text style={[styles.fieldLabel, { marginTop: space.md }]}>
              {t('cardio.templateSection')}
            </Text>

            {cardioBlocks.map((b, i) => (
              <View key={`tpl-cardio-${i}`} style={[styles.exCard, { marginTop: space.sm }]}>
                <View style={styles.cardioHead}>
                  <Text style={styles.cardioName}>{t(TPL_MODALITY_KEY[b.modality])}</Text>
                </View>
                <SheetTextInput
                  style={styles.input}
                  placeholder={t('cardio.labelPlaceholder')}
                  placeholderTextColor={colors.faint}
                  value={b.label}
                  onChangeText={(v) => patchCardio(i, { label: v })}
                  accessibilityLabel={`${t('cardio.blockNameA11y')}, ${t(TPL_MODALITY_KEY[b.modality])}`}
                  testID={`template-cardio-label-${i}`}
                />
                <View style={styles.cardioFieldRow}>
                  <View style={styles.cardioField}>
                    <Text style={styles.cardioLabel}>{t('cardio.targetDuration')}</Text>
                    <SheetTextInput
                      style={styles.cardioInput}
                      keyboardType="number-pad"
                      inputMode="numeric"
                      placeholder="—"
                      placeholderTextColor={colors.faint}
                      value={b.minutes}
                      onChangeText={(v) => patchCardio(i, { minutes: v })}
                      {...doneKey}
                      accessibilityLabel={`${t('cardio.targetDuration')}, ${t(TPL_MODALITY_KEY[b.modality])}`}
                      testID={`template-cardio-minutes-${i}`}
                    />
                  </View>
                  <View style={styles.cardioField}>
                    <Text style={styles.cardioLabel}>
                      {t('cardio.targetDistance')} ({distanceUnit(unitSystem)})
                    </Text>
                    <SheetTextInput
                      style={styles.cardioInput}
                      keyboardType="numeric"
                      inputMode="decimal"
                      placeholder="—"
                      placeholderTextColor={colors.faint}
                      value={b.distance}
                      onChangeText={(v) => patchCardio(i, { distance: v })}
                      {...doneKey}
                      accessibilityLabel={`${t('cardio.targetDistance')} (${distanceUnit(unitSystem)}), ${t(TPL_MODALITY_KEY[b.modality])}`}
                      testID={`template-cardio-distance-${i}`}
                    />
                  </View>
                </View>
                <TouchableOpacity
                  onPress={() => removeCardio(i)}
                  style={styles.exRemoveRow}
                  accessibilityRole="button"
                  // The object, not just the verb: every block's button read "Remove" (T13).
                  accessibilityLabel={`${t('cardio.remove')}, ${b.label.trim() || t(TPL_MODALITY_KEY[b.modality])}`}
                  testID={`template-cardio-remove-${i}`}
                >
                  <Text style={styles.exRemove}>{t('cardio.remove')}</Text>
                </TouchableOpacity>
              </View>
            ))}

            {cardioPick ? (
              <View style={[styles.modalityChips, { marginTop: space.sm }]}>
                {CARDIO_MODALITIES.map((m) => (
                  <TouchableOpacity
                    key={m}
                    style={styles.kindChip}
                    accessibilityRole="button"
                    testID={`template-cardio-modality-${m}`}
                    onPress={() => {
                      addCardio(m);
                      setCardioPick(false);
                    }}
                  >
                    <Text style={styles.kindChipText}>{t(TPL_MODALITY_KEY[m])}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            ) : (
              <TouchableOpacity
                style={[styles.addExBtn, { marginTop: space.sm }]}
                onPress={() => setCardioPick(true)}
                accessibilityRole="button"
                testID="template-add-cardio"
              >
                <View style={styles.addExRow}>
                  <Ionicons name="add" size={18} color={colors.muted} />
                  <Text style={styles.addExText}>{t('cardio.templateAdd')}</Text>
                </View>
              </TouchableOpacity>
            )}
            </>
            ) : null}

            <Text style={[styles.fieldLabel, { marginTop: space.md }]}>{t('train.templateExercises')}</Text>

            {/* Adder at the TOP so it's reachable without scrolling past every
                exercise. Type → pick a catalog match, or create a new one.
                Focusing it lifts it to the top of the sheet, so the results
                under it have the room above the keyboard (T1). */}
            <View ref={adderRef} onLayout={(e) => { adderY.current = e.nativeEvent.layout.y; }}>
              <SheetTextInput
                style={[styles.input, { marginTop: space.sm }]}
                placeholder={t('train.addExercisePh')}
                placeholderTextColor={colors.faint}
                value={exName}
                onChangeText={setExName}
                onFocus={() => {
                  setAdderFocused(true);
                  scrollRef.current?.scrollTo({ y: Math.max(0, adderY.current - space.sm), animated: true });
                }}
                onBlur={() => setAdderFocused(false)}
                returnKeyType="done"
                accessibilityLabel={t('train.addExerciseA11y')}
                testID="template-add-exercise"
              />
            </View>
            {trimmedEx || adderFocused || picked.size > 0 ? (
              <>
                {/* Catalog AND shipped library. The library half is what
                    stops a typed name minting a movement with `muscles: []`
                    that no screen could then edit. An empty query browses
                    (T18): the catalog first, the library filling to eight —
                    a new account's catalog is empty, and a novice who does
                    not know what to type needs something to pick from. */}
                <ExerciseSearchList
                  query={exName}
                  catalog={train.catalog}
                  testIDPrefix="template-match"
                  catalogLimit={trimmedEx ? 6 : 8}
                  libraryLimit={trimmedEx ? 6 : Math.max(0, 8 - Math.min(train.catalog.length, 8))}
                  // Several at once, like the in-session sheet (T18): the tick
                  // starts a pick, and once anything is ticked a row tap ticks too.
                  onPickCatalog={(c) => (picked.size > 0 ? togglePick(catalogPickKey(c), { kind: 'catalog', exercise: c }) : addFromCatalog(c))}
                  onPickSeed={(seed) => (picked.size > 0 ? togglePick(seedPickKey(seed), { kind: 'seed', seed }) : void addFromLibrary(seed))}
                  selected={new Set(picked.keys())}
                  // Lifts already on a card say so; still pickable (E-N5).
                  inTemplate={new Set(exercises.map((d) => d.exerciseId))}
                  onToggleCatalog={(c) => togglePick(catalogPickKey(c), { kind: 'catalog', exercise: c })}
                  onToggleSeed={(seed) => togglePick(seedPickKey(seed), { kind: 'seed', seed })}
                  create={trimmedEx ? {
                    name: trimmedEx,
                    style: exStyle,
                    onStyleChange: setExStyle,
                    onCreate: () => void addFreeType(),
                    testID: 'template-create-exercise',
                    styleTestIDPrefix: 'template-logstyle',
                  } : undefined}
                />
                {picked.size > 0 ? (
                  <TouchableOpacity
                    style={[styles.finishBtn, styles.addPickedBtn, { marginTop: space.sm }, busy && styles.btnDisabled]}
                    onPress={() => void addPicked()}
                    disabled={busy}
                    accessibilityRole="button"
                    accessibilityState={{ disabled: busy, busy }}
                    testID="template-add-picked"
                  >
                    <Text style={styles.finishText}>{t('train.addSelected', { n: picked.size })}</Text>
                  </TouchableOpacity>
                ) : null}
              </>
            ) : null}

            {exercises.length === 0 ? (
              <Text style={[styles.empty, { marginTop: space.md }]}>{t('train.templateNoEx')}</Text>
            ) : (
              /* Drag to reorder. `Sortable.Flex` rather than a sortable GRID
                 because these cards are variable height — a collapsed card is
                 one line and an open one is a whole form, and a grid assumes
                 uniform cells. `customHandle` confines the gesture to the grip:
                 the card header is already a tap target (expand/collapse), and
                 a whole-card long-press would fight it. `scrollableRef` is what
                 makes a drag near the sheet's edge scroll the sheet. */
              /* Gap between the "Add exercise…" field and the first card.
                 It belongs on a wrapper, not on the input's marginBottom:
                 `styleRow` below the input already carries marginTop space.md,
                 so spacing the input would double to 24 once a name is typed. */
              <View style={{ marginTop: space.md }}>
              <Sortable.Flex
                customHandle
                scrollableRef={scrollRef}
                // `flexDirection` DEFAULTS TO ROW — the library is built for
                // chips, and without this the cards laid out as a wrapping row
                // and each shrank to fit its own name, so a template read as a
                // ragged staircase instead of a list. The cards also carry an
                // explicit width (see tplExCard): `alignItems` here documents
                // no `stretch` value, so the cross-axis size is the child's
                // job, not the container's.
                flexDirection="column"
                gap={0}
                onDragEnd={onExDragEnd}
              >
              {exercises.map((d, i) => {
                // One label per row, derived from the whole sequence: a
                // cluster takes one set number with lettered sub-sets.
                const setLabels = setRowLabels(d.sets);
                const open = openEx === i;
                const more = moreEx === i;
                // Undeclared keeps every affordance a legacy template was
                // written with; a declared structure gets only its own.
                // A card added in this session gets only its own: no legacy
                // "Add cluster" on a lift nobody has declared anything for (T9).
                const canAdd = addActionsForDraft(d.setStructure, d.isNew, d.sets.map((x) => x.kind));
                /** At large text the name needs the card's full width (T11). */
                const big = fontScale > 1.3;
                /** The structure picker in full: a card just added, or opened
                 *  while still new, undeclared and untouched (structure is
                 *  asked FIRST, ADR-0041 §5), or one whose compact row was
                 *  tapped. Otherwise one line (T6). Decided when the card
                 *  opens, not per keystroke: typing the first number must not
                 *  fold the picker away from under the user. */
                const structureFull = structurePick === d.uid;
                /** The structure as the picker knows it — a stored one it does
                 *  not offer (`superset`) reads as Auto, as the engine reads it. */
                const declared = SET_STRUCTURES.find((st) => st.value === d.setStructure && st.value !== undefined);
                const structureName = capitalizeFirst(t((declared ?? SET_STRUCTURES[0]).labelKey), locale);
                const copyTargets = copyFirstTargets(d.sets);
                /** "L" / "R" fields under each cluster: chrome most lifters
                 *  never use, so behind one text action until asked for or
                 *  already used (E-N7). */
                const hasClusters = d.sets.some((x) => x.group != null);
                const clusterNamesShown = clusterNamesFor.has(d.uid) || d.sets.some((x) => x.group != null && !!x.label?.trim());
                // What each row will offer in the session — typed, else last
                // time's same-kind row, else the progression's target reps on
                // a working row (core `countToAccept`, E-N1). The reps
                // placeholder and the summary both read it; nothing is saved.
                const prevSets = lastSets(d.exerciseId);
                const exTargetReps = d.hasProgression ? numOrUndef(d.targetReps) ?? 12 : undefined;
                const counts = d.sets.map((ps, si) => offeredCount(ps, prevSets[si], d.logStyle, exTargetReps));
                const summary = cardSummary(d, counts, t, locale, loadUnit(unitSystem));
                /* One tap to pair, from the collapsed list — it used to be
                   three taps and a scroll deep, under More options. On a
                   paired card the glyph is the STATE (linked, filled teal)
                   and a tap opens the superset's menu (native where the
                   binary has it — J7 — the sheet otherwise), so one stray
                   tap beside the chevron cannot break a pair. */
                const linkCtl = tags[i] ? (
                  <MenuButton
                    actions={supersetActions(i)}
                    title={t('train.superset.manageTitle', { group: d.supersetGroup ?? '' })}
                    style={styles.supersetLinkBtn}
                    accessibilityLabel={t('train.superset.manageA11y', { group: d.supersetGroup ?? '', name: d.name })}
                    onFallbackPress={() => askSuperset(i)}
                    testID={`template-unlink-${i}`}
                  >
                    <Ionicons name="link" size={20} color={colors.teal} />
                  </MenuButton>
                ) : canPairWithNext(exercises, i) ? (
                  <TouchableOpacity
                    style={styles.supersetLinkBtn}
                    onPress={() => pairNext(i)}
                    accessibilityRole="button"
                    accessibilityLabel={t('train.superset.pairA11y', { a: d.name, b: exercises[i + 1].name })}
                    testID={`template-link-${i}`}
                  >
                    <Ionicons name="link-outline" size={20} color={colors.muted} />
                  </TouchableOpacity>
                ) : null;
                /* Move up / move down, visible (S23-1, R24 AA): the drag
                   grip was the only way a sighted lifter could reorder, with
                   the moves an accessibility action only. The same `moveEx`
                   as those actions — a superset moves as one block, and the
                   new position is announced. Arrows, not chevrons: a chevron
                   on this card already means expand. Disabled at the ends;
                   not drawn when there is only one place to be. */
                const moveBtn = (dir: -1 | 1) => {
                  const can = moveBlockAware(exercises, i, dir).newIndex !== i;
                  return (
                    <TouchableOpacity
                      key={dir}
                      style={styles.supersetLinkBtn}
                      onPress={() => moveEx(i, dir)}
                      disabled={!can}
                      accessibilityRole="button"
                      accessibilityLabel={t(dir < 0 ? 'train.moveExUpA11y' : 'train.moveExDownA11y', { name: d.name })}
                      accessibilityState={{ disabled: !can }}
                      testID={`template-move-${dir < 0 ? 'up' : 'down'}-${i}`}
                    >
                      <Ionicons name={dir < 0 ? 'arrow-up' : 'arrow-down'} size={20} color={can ? colors.muted : colors.line} />
                    </TouchableOpacity>
                  );
                };
                return (
                <Animated.View
                  key={d.uid}
                  ref={(v: View | null) => {
                    if (v) cardRefs.current.set(d.uid, v);
                    else cardRefs.current.delete(d.uid);
                  }}
                  style={[
                    styles.tplExCard,
                    { width: cardWidth },
                    tags[i] ? styles.supersetRail : null,
                    // Inside a group the cards sit 2pt apart, so A1+A2 read as
                    // one block and B1 visibly starts a new one.
                    tags[i] && tags[i + 1] && exercises[i + 1]?.supersetGroup === d.supersetGroup
                      ? { marginBottom: 2, borderBottomLeftRadius: 0, borderBottomRightRadius: 0 } : null,
                    // …and squared where they meet, so the rail reads as one bar.
                    tags[i] && tags[i - 1] && exercises[i - 1]?.supersetGroup === d.supersetGroup
                      ? { borderTopLeftRadius: 0, borderTopRightRadius: 0 } : null,
                  ]}
                  layout={smoothLayout}
                >
                  <View style={styles.tplExTop}>
                    {/* The drag grip. Dragging is invisible to VoiceOver, so
                        the handle carries move-up / move-down accessibility
                        ACTIONS running the same `moveEx` as the visible ↑ ↓
                        at the card's end (S23-1). */}
                    <View
                      // TARGET wide (was 32): the grip is a gesture's only handle (T4).
                      style={[styles.tplDragHandle, { width: TARGET, marginLeft: -space.sm }]}
                      // `adjustable` is a promise of increment/decrement — a
                      // swipe up/down in VoiceOver — and it carried neither,
                      // so the swipe did nothing (Train review bug 14). Up the
                      // list is "increment", the direction of the swipe; the
                      // position is the value it adjusts.
                      accessible
                      accessibilityRole="adjustable"
                      accessibilityLabel={t('train.reorderA11y', { name: d.name })}
                      // `text`, or iOS reads min/max/now as a percent ("25 percent").
                      accessibilityValue={{
                        min: 1,
                        max: blocks.length,
                        now: blocks.findIndex((b) => b.includes(i)) + 1,
                        text: t('train.positionOf', { n: blocks.findIndex((b) => b.includes(i)) + 1, total: blocks.length }),
                      }}
                      accessibilityActions={[
                        { name: 'increment', label: t('train.moveUp') },
                        { name: 'decrement', label: t('train.moveDown') },
                        { name: 'moveUp', label: t('train.moveUp') },
                        { name: 'moveDown', label: t('train.moveDown') },
                        // Order INSIDE a superset — a one-step move moves the
                        // whole block, so without these only a drag could swap
                        // A1 and A2.
                        ...(tags[i] && exercises[i - 1]?.supersetGroup === d.supersetGroup ? [{ name: 'earlier', label: t('train.superset.moveEarlier') }] : []),
                        ...(tags[i] && exercises[i + 1]?.supersetGroup === d.supersetGroup ? [{ name: 'later', label: t('train.superset.moveLater') }] : []),
                        // From the list, without opening the card (E-N10).
                        { name: 'remove', label: `${t('train.removeExercise')}, ${d.name}` },
                      ]}
                      onAccessibilityAction={(e) => {
                        const action = e.nativeEvent.actionName;
                        // A swipe on an adjustable reads its new value by
                        // itself — announcing too said the position twice.
                        if (action === 'moveUp' || action === 'increment') moveEx(i, -1, action === 'moveUp');
                        if (action === 'moveDown' || action === 'decrement') moveEx(i, 1, action === 'moveDown');
                        if (action === 'remove') removeEx(i);
                        if (action === 'earlier' || action === 'later') {
                          const to = action === 'earlier' ? i - 1 : i + 1;
                          const next = reorderWithSupersets(exercises, i, to).rows;
                          // The open card stays with its lift, not its slot.
                          const openRow = openEx != null ? exercises[openEx] : undefined;
                          setExercises(next);
                          setOpenEx(openRow ? next.indexOf(openRow) : null);
                          setMoreEx(null);
                          announce(t('train.superset.positionA11y', { name: d.name, label: `${d.supersetGroup}${action === 'earlier' ? (d.pairPosition ?? 2) - 1 : (d.pairPosition ?? 1) + 1}` }));
                        }
                      }}
                      testID={`template-drag-${i}`}
                    >
                      <Sortable.Handle>
                        <Ionicons name="reorder-two-outline" size={22} color={colors.faint} />
                      </Sortable.Handle>
                    </View>
                    {/* The whole row — name, summary AND chevron — is one tap
                        target. The chevron used to sit OUTSIDE this touchable,
                        so the one element that looks most like the control did
                        nothing when tapped, which is worse than having no
                        affordance at all. Everything except the drag grip
                        toggles; the grip stays separate because it belongs to
                        the gesture. One open exercise at a time, so a
                        six-exercise template is six readable lines. */}
                    <TouchableOpacity
                      style={[styles.tplExTapRow, big && { flexDirection: 'column', alignItems: 'stretch' }]}
                      onPress={() => {
                        haptics.tap();
                        setOpenEx(open ? null : i);
                        if (!open && d.isNew && d.setStructure === undefined && rowsUntouched(d.sets)) {
                          setStructurePick(d.uid);
                        }
                      }}
                      accessibilityRole="button"
                      accessibilityState={{ expanded: open }}
                      accessibilityLabel={[
                        tags[i] ? t('train.superset.tagA11y', {
                          label: tags[i]!,
                          partners: (groups.get(d.supersetGroup ?? '') ?? []).filter((m) => m.index !== i).map((m) => exercises[m.index].name).join(', '),
                        }) : null,
                        // The group's rests right after the tag: the group's
                        // facts together, then the lift's.
                        tags[i] && d.pairPosition === 1 && d.supersetGroup ? t('train.superset.restDesc', {
                          switch: `${groupRest(exercises, d.supersetGroup).transitionRestSec} s`,
                          round: `${groupRest(exercises, d.supersetGroup).roundRestSec} s`,
                        }) : null,
                        d.name,
                        summary,
                        doseWarnings.has(i) ? t('train.mobilityDoseNote') : null,
                      ].filter(Boolean).join('. ')}
                      testID={`template-ex-toggle-${i}`}
                    >
                      <View style={big ? undefined : { flex: 1 }}>
                        {tags[i] && d.pairPosition === 1 && d.supersetGroup ? (
                          <Text style={styles.supersetHeader} numberOfLines={fontScale > 1.3 ? undefined : 2} testID={`template-superset-header-${i}`}>
                            {t('train.superset.groupHeaderShort', {
                              group: d.supersetGroup,
                              switch: `${groupRest(exercises, d.supersetGroup).transitionRestSec} s`,
                              round: `${groupRest(exercises, d.supersetGroup).roundRestSec} s`,
                            })}
                          </Text>
                        ) : null}
                        {tags[i] ? (
                          <Text style={styles.supersetTag} testID={`template-superset-tag-${i}`}>
                            {t('train.superset.tag', { label: tags[i]! })}
                          </Text>
                        ) : null}
                        <Text style={styles.tplExName}>{d.name}</Text>
                        <Text style={styles.tplExMeta}>{summary}</Text>
                        {doseWarnings.has(i) ? (
                          <Text style={styles.tplDoseNote} testID={`template-dose-note-${i}`}>
                            {t('train.mobilityDoseNote')}
                          </Text>
                        ) : null}
                      </View>
                      <Ionicons
                        name={open ? 'chevron-up' : 'chevron-down'}
                        size={18}
                        color={colors.muted}
                        style={big ? { alignSelf: 'flex-end' } : undefined}
                      />
                    </TouchableOpacity>
                    {/* An empty slot the link button's width when there is no
                        link control, so every card's chevron sits in one
                        column (T20). */}
                    {big ? null : linkCtl ?? <View style={{ width: TARGET }} />}
                    {/* One TARGET column, up over down: side by side they
                        took 88pt from the name at 360dp. */}
                    {big || blocks.length < 2 ? null : <View>{moveBtn(-1)}{moveBtn(1)}</View>}
                  </View>
                  {/* Large text: the name has the card's width, and the
                      controls share a row under it. */}
                  {big && (linkCtl || blocks.length > 1) ? (
                    <View style={{ flexDirection: 'row', justifyContent: 'flex-end' }}>
                      {blocks.length < 2 ? null : <>{moveBtn(-1)}{moveBtn(1)}</>}{linkCtl}
                    </View>
                  ) : null}
                  {/* The group's guardrails, under its LAST member and outside
                      the card's tap target. Each line is one screen-reader stop
                      whose "Fix muscles" is an accessibility ACTION as well as a
                      visible button — a button inside an accessible row cannot
                      be focused on its own. */}
                  {pairWarnings.get(i) ? (
                    <View testID={`template-superset-warnings-${i}`} style={{ paddingHorizontal: space.lg, paddingBottom: space.sm }}>
                      {pairWarnings.get(i)!.judgements.map(({ a, b, judgement }) => {
                        const attention = judgement.kind === 'same-muscle' || judgement.kind === 'unknown';
                        const muscles = (x?: DraftEx) => train.catalog.find((c) => c.id === x?.exerciseId)?.muscles ?? [];
                        const fixable = (judgement.kind === 'unknown'
                          ? [exercises[a], exercises[b]].filter((x) => muscles(x).length === 0)
                          : judgement.kind === 'same-muscle' || judgement.kind === 'overlapping'
                            ? [exercises[a], exercises[b]]
                            : []).filter((x): x is DraftEx => x != null && train.catalog.some((c) => c.id === x.exerciseId));
                        const text = pairText(judgement, t, {
                          untagged: judgement.kind === 'unknown' ? (fixable[0]?.name ?? '') : '',
                        });
                        const line = pairWarnings.get(i)!.size > 2
                          ? t('train.superset.pairPrefix', { a: exercises[a]?.name ?? '', b: exercises[b]?.name ?? '', text })
                          : text;
                        return (
                          <View key={`${a}-${b}`} style={{ gap: 2 }}>
                            <View
                              style={styles.supersetWarnRow}
                              accessible
                              accessibilityLabel={line}
                              accessibilityActions={fixable.map((x) => ({ name: `fix-${x.exerciseId}`, label: t('train.superset.fixMusclesOf', { name: x.name }) }))}
                              onAccessibilityAction={(e) => {
                                const id = e.nativeEvent.actionName.replace(/^fix-/, '');
                                if (fixable.some((x) => x.exerciseId === id)) setLiftFor(id);
                              }}
                              testID={`template-pair-${judgement.kind}-${i}`}
                            >
                              <Ionicons
                                name={attention ? 'alert-circle-outline' : judgement.kind === 'agonist-antagonist' ? 'checkmark-circle-outline' : 'information-circle-outline'}
                                size={16}
                                color={attention ? colors.warn : colors.muted}
                              />
                              <Text style={attention ? styles.supersetWarn : [styles.tplDoseNote, { marginTop: 0, flexShrink: 1 }]}>{line}</Text>
                            </View>
                            {fixable.length ? (
                              <View style={{ flexDirection: 'row', flexWrap: 'wrap', columnGap: space.md, paddingLeft: 22 }} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
                                {fixable.map((x) => (
                                  <TouchableOpacity
                                    key={x.exerciseId}
                                    onPress={() => setLiftFor(x.exerciseId)}
                                    style={{ minHeight: TARGET, justifyContent: 'center' }}
                                    accessibilityRole="button"
                                    testID={`template-fix-muscles-${x.exerciseId}`}
                                  >
                                    <Text style={styles.sectionAction}>{t('train.superset.fixMusclesOf', { name: x.name })}</Text>
                                  </TouchableOpacity>
                                ))}
                              </View>
                            ) : null}
                          </View>
                        );
                      })}
                      {pairWarnings.get(i)!.pending.map((p) => {
                        const ex = exercises[p.index];
                        const assisted = train.catalog.find((c) => c.id === ex?.exerciseId)?.assisted === true;
                        const head = t(assisted ? 'train.superset.loadTestHeadAssisted' : 'train.superset.loadTestHead', {
                          name: ex?.name ?? '', from: formatLoad(p.from, unitSystem), to: formatLoad(p.to, unitSystem),
                        });
                        const how = t('train.superset.loadTestHow');
                        return (
                          <View key={`lt-${p.index}`} style={styles.supersetWarnRow} accessible accessibilityLabel={`${head} ${how}`} testID={`template-load-test-${p.index}`}>
                            <Ionicons name="alert-circle-outline" size={16} color={colors.warn} />
                            <View style={{ flexShrink: 1, gap: 2 }}>
                              <Text style={styles.supersetWarn}>{head}</Text>
                              <Text style={[styles.tplDoseNote, { marginTop: 0 }]}>{how}</Text>
                            </View>
                          </View>
                        );
                      })}
                    </View>
                  ) : null}
                  {open ? (
                  <>
                  {/* ADR-0040, and it is the FIRST thing the card asks now.
                      The structure is DECLARED rather than inferred — myo-reps,
                      rest-pause and cluster sets are all "activation +
                      continuations" in shape and cannot be told apart by
                      inspection — and it decides how the engine reads every
                      future session of this lift. It used to sit UNDER the
                      sets table, after three buttons had made the user
                      hand-build a list that implies a structure, which is the
                      decision and its consequence in the wrong order.
                      Choosing one scaffolds the rows (`scaffoldKindsFor`),
                      unless they already carry typed numbers. */}
                  {structureFull ? (
                  <>
                  <Text style={styles.tplStructureLabel}>{t('train.structureLabel')}</Text>
                  <View style={styles.tplStructureRow} accessibilityRole="radiogroup" accessibilityLabel={t('train.structureLabel')}>
                    {(structuresOpen === i ? SET_STRUCTURES : SET_STRUCTURES.slice(0, PRIMARY_STRUCTURES))
                      .map((st) => {
                        const on = d.setStructure === st.value;
                        return (
                          <TouchableOpacity
                            key={st.value ?? 'auto'}
                            style={[styles.tplStructureChip, on && styles.tplStructureChipOn]}
                            onPress={() => setStructure(i, st.value)}
                            accessibilityRole="radio"
                            accessibilityState={{ selected: on, checked: on }}
                            testID={`template-structure-${i}-${st.value ?? 'auto'}`}
                          >
                            {/* Capitalised for display, so "Auto" does not
                                sit beside lowercase "straight sets" (T20); the
                                keys stay lowercase for mid-sentence use. */}
                            <Text style={[styles.tplStructureText, on && styles.tplStructureTextOn]}>
                              {capitalizeFirst(t(st.labelKey), locale)}
                            </Text>
                            {/* Named, not hidden: a user may legitimately want
                                to program drop sets today and should be told
                                the engine will not read them, not quietly
                                given a number computed by another
                                structure's rule. */}
                            {!st.readable ? (
                              <Text style={[styles.tplStructureNote, on && styles.tplStructureTextOn]}>{t('train.structureUnread')}</Text>
                            ) : null}
                          </TouchableOpacity>
                        );
                      })}
                  </View>
                  {/* The chosen structure, in a sentence. Eight bare chips of
                      gym jargon asked the user to already know the vocabulary
                      the tab keeps a glossary for. */}
                  <Text style={styles.tplStructureDesc}>
                    {t((SET_STRUCTURES.find((st) => st.value === d.setStructure) ?? SET_STRUCTURES[0]).descKey)}
                  </Text>
                  <TouchableOpacity
                    style={styles.tplStructureMore}
                    onPress={() => setStructuresOpen(structuresOpen === i ? null : i)}
                    accessibilityRole="button"
                    testID={`template-structure-more-${i}`}
                  >
                    <Text style={styles.tplStructureMoreText}>
                      {structuresOpen === i ? t('train.structureFewer') : t('train.structureMore')}
                    </Text>
                  </TouchableOpacity>
                  </>
                  ) : (
                    /* Still FIRST and still the declaration (ADR-0041 §5),
                       folded to one line once it is made or the rows carry
                       numbers: the picker in full put ~450pt between the
                       card's name and its sets on every expand (T6, J5). */
                    <TouchableOpacity
                      style={styles.tplStructureCompact}
                      onPress={() => {
                        haptics.tap();
                        setStructurePick(d.uid);
                      }}
                      accessibilityRole="button"
                      accessibilityState={{ expanded: false }}
                      accessibilityLabel={`${t('train.structureLabel')}: ${structureName}`}
                      accessibilityHint={t('train.structureChange')}
                      testID={`template-structure-compact-${i}`}
                    >
                      <Text style={styles.tplStructureCompactText}>
                        {`${t('train.structureLabel')}: ${structureName}`}
                      </Text>
                      <Text style={styles.sectionAction}>{t('train.structureChange')}</Text>
                    </TouchableOpacity>
                  )}
                  {structureKept === i ? (
                    <Text style={[styles.tplStructureKept, { fontSize: font.small }]} testID={`template-structure-kept-${i}`}>
                      {t('train.structureKept')}
                    </Text>
                  ) : null}
                  {/* The catalog lift's own configuration — category, rep
                      range, load steps, Smith bar, effort — editable from
                      here because the template is where a lift is planned.
                      Saved straight to the catalog, not with this template. */}
                  {train.catalog.some((c) => c.id === d.exerciseId) ? (
                    <TouchableOpacity
                      // Under the one-line structure row, the card's gap on top
                      // of two 44pt rows' own centring read as a ~40pt hole
                      // (v3 QA item 5): the rows' heights are the spacing.
                      style={[styles.tplLiftBtn, !structureFull && structureKept !== i && { marginTop: -space.md }]}
                      onPress={() => {
                        haptics.tap();
                        setLiftFor(d.exerciseId);
                      }}
                      accessibilityRole="button"
                      accessibilityLabel={t('train.lift.openA11y', { name: d.name })}
                      testID={`template-lift-settings-${i}`}
                    >
                      <Ionicons name="options-outline" size={16} color={colors.teal} />
                      <Text style={styles.sectionAction}>{t('train.lift.title')}</Text>
                    </TouchableOpacity>
                  ) : null}

                  {/* Sets are a small TABLE: a row says what to do, and the
                      headers say what the numbers mean, so neither needs a
                      legend. The set number doubles as the type control —
                      tapping it opens the kind picker — which removes a
                      full-width button from every row without hiding
                      anything, because a non-working kind still prints its
                      name under the number. */}
                  {/* The lift's load, on the card (S23-6/F10, R52): the most
                      used setting sat a disclosure deeper, under More
                      options, while every row's grey weight came from it.
                      It is what progression moves (`targetLoad`). A visible
                      label (v3 QA item 7): the unit Text is visual only. */}
                  {d.logStyle !== 'bodyweight' ? (
                    <View style={[styles.tplLoadWrap, { flexWrap: 'wrap' }]}>
                      <Text style={[styles.fieldLabel, { flexShrink: 1 }]}>{t('train.targetLoadLabel')}</Text>
                      <View style={styles.tplLoadWrap}>
                        <SheetTextInput
                          style={styles.tplLoadInput}
                          keyboardType="numeric"
                          value={d.targetLoad}
                          onChangeText={(v) => patchEx(i, { targetLoad: v })}
                          {...doneKey}
                          accessibilityLabel={`${t('train.targetLoadA11y', { unit: loadUnit(unitSystem) })}, ${d.name}`}
                          testID={`template-load-${i}`}
                        />
                        <Text style={styles.tplLoadUnit} accessibilityElementsHidden importantForAccessibility="no">
                          {loadUnit(unitSystem)}
                        </Text>
                      </View>
                    </View>
                  ) : null}
                  <Text style={styles.fieldLabel}>{t('train.sets')}</Text>
                  <View style={styles.tplSetHead}>
                    {/* "#", as the live session's table: "SET" broke to "SE T"
                        at large text (J9). Read as the word. */}
                    <Text style={[styles.tplSetHeadCell, styles.tplSetNumCell, { minHeight: 0 }]} maxFontSizeMultiplier={1.6} accessibilityLabel={t('train.setShort')}>#</Text>
                    {d.logStyle === 'weight-reps' ? (
                      <Text style={[styles.tplSetHeadCell, styles.tplSetCell]}>{loadUnit(unitSystem)}</Text>
                    ) : null}
                    <Text style={[styles.tplSetHeadCell, styles.tplSetCell]}>
                      {d.logStyle === 'time' ? t('train.secShort') : t('train.repsShort')}
                    </Text>
                    <View style={[styles.tplSetDelCell, { minHeight: 0 }]} />
                  </View>
                  {d.sets.map((ps, si) => {
                    const openKey = `${i}:${si}`;
                    // At the largest text the row cannot hold a number, a kind
                    // name, two fields and a ✕ on one line: it stacks (T11).
                    const stack = fontScale > 1.6;
                    const delCell = (
                      <TouchableOpacity
                        onPress={() => removeSet(i, si, setLabels[si])}
                        // A TARGET-square cell, no slop: slop reached into
                        // the reps field beside it (T4).
                        style={styles.tplSetDelCell}
                        accessibilityRole="button"
                        // Which set — every row's ✕ read "Remove set" (T13).
                        accessibilityLabel={t('train.removeSetA11y', { n: setLabels[si] })}
                        testID={`template-set-remove-${i}-${si}`}
                      >
                        <Ionicons name="close" size={16} color={colors.faint} />
                      </TouchableOpacity>
                    );
                    return (
                      <View key={si}>
                        <View style={[styles.tplSetRow, stack && { flexWrap: 'wrap' }]}>
                          <TouchableOpacity
                            style={[styles.tplSetNumCell, stack && { flex: 1, alignItems: 'flex-start' }]}
                            onPress={() => setKindOpen(kindOpen === openKey ? null : openKey)}
                            accessibilityRole="button"
                            accessibilityState={{ expanded: kindOpen === openKey }}
                            accessibilityLabel={t('train.setTypeA11y', {
                              n: setLabels[si],
                              kind: t(kindLabelKey(ps.kind)),
                            })}
                            testID={`template-set-kind-${i}-${si}`}
                          >
                            <Text style={styles.tplSetNum}>{setLabels[si]}</Text>
                            {/* Whole, not "Activ…" (T11): the cell is 76 wide
                                and the tag may wrap rather than truncate. */}
                            {/* Plain words on the default row (S23-5/F8): an
                                activation row is the cluster's own set, "1a",
                                so it carries no tag; its engine name stays in
                                the label read out and in the kind picker. */}
                            {ps.kind !== 'working' && ps.kind !== 'activation' ? (
                              <Text style={[styles.tplSetKindTag, { textAlign: 'center' }]}>
                                {t(kindLabelKey(ps.kind))}
                              </Text>
                            ) : null}
                          </TouchableOpacity>

                          {stack ? delCell : null}
                          {/* The prescription. A template that cannot say
                              "8 @ 135" makes the logger a blank form the
                              lifter retypes every session.
                              No UNIT placeholders on these cells: the column
                              headers above already say lb / reps / sec, and
                              three rows of an exercise showed the word "reps"
                              four times. The only ghost text is a NUMBER:
                              the lift's load, else what this row was last
                              session (`ghost`, T7 / fix R) — shown, never
                              saved. Wrapped so a stacked row (largest
                              text) puts both fields on their own line; the
                              wrapper's flex is its cell count, so the columns
                              still sit under their headers. */}
                          <View style={stack
                            ? { flexBasis: '100%', flexDirection: 'row', gap: space.sm }
                            : { flex: d.logStyle === 'weight-reps' ? 2 : 1, flexDirection: 'row', gap: space.sm }}
                          >
                          {d.logStyle === 'time' ? (
                            <SheetTextInput
                              style={[styles.tplSetInput, styles.tplSetCell]}
                              // Whole seconds: the number pad, not the decimal pad (T22).
                              keyboardType="number-pad"
                              placeholder={counts[si] || undefined}
                              placeholderTextColor={colors.faint}
                              value={ps.durationText}
                              onChangeText={(v) => patchSet(i, si, { durationText: v })}
                              {...doneKey}
                              // The label the row SHOWS ("2a"), not its index:
                              // the fourth row of a cluster is set 2b, and
                              // VoiceOver said "set 4" (UX_AUDIT S20).
                              accessibilityLabel={t('train.setDurationA11y', { n: setLabels[si] })}
                              testID={`template-set-duration-${i}-${si}`}
                            />
                          ) : (
                            <>
                              {d.logStyle !== 'bodyweight' ? (
                                <SheetTextInput
                                  style={[styles.tplSetInput, styles.tplSetCell]}
                                  keyboardType="numeric"
                                  // The lift's inherited load, shown where the
                                  // number would go: "3 sets · 170 lb" with
                                  // every cell empty hid where 170 lives (T8).
                                  // The load wins over last session's row: it
                                  // is what the session will pre-fill.
                                  placeholder={d.targetLoad.trim() || ps.ghost?.weightText || undefined}
                                  placeholderTextColor={colors.faint}
                                  value={ps.weightText}
                                  onChangeText={(v) => patchSet(i, si, { weightText: v })}
                                  {...doneKey}
                                  accessibilityLabel={t('train.setWeightA11y', { n: setLabels[si] })}
                                  testID={`template-set-weight-${i}-${si}`}
                                />
                              ) : null}
                              <SheetTextInput
                                style={[styles.tplSetInput, styles.tplSetCell]}
                                keyboardType="number-pad"
                                // What the session will offer here (E-N1): last
                                // time's same-kind row, else — on a working
                                // row — the lift's target reps.
                                placeholder={counts[si] || undefined}
                                placeholderTextColor={colors.faint}
                                value={ps.repsText}
                                onChangeText={(v) => patchSet(i, si, { repsText: v })}
                                {...doneKey}
                                accessibilityLabel={t('train.setRepsA11y', { n: setLabels[si] })}
                                testID={`template-set-reps-${i}-${si}`}
                              />
                            </>
                          )}
                          </View>

                          {stack ? null : delCell}
                        </View>
                        {/* A cluster's name ("L" / "R" on a single-leg lift),
                            under its FIRST row only and written to every row
                            of the group — the logger shows it in place of
                            the cluster's number. */}
                        {clusterNamesShown && ps.group != null && (si === 0 || d.sets[si - 1]?.group !== ps.group) ? (
                          <View style={styles.tplClusterLabelRow}>
                            <Text style={styles.tplSetsLabel}>{t('train.lift.clusterLabel')}</Text>
                            <SheetTextInput
                              style={[styles.tplSetInput, styles.tplClusterLabelInput]}
                              placeholder={t('train.lift.clusterLabelPh')}
                              placeholderTextColor={colors.faint}
                              value={ps.label ?? ''}
                              onChangeText={(v) => {
                                // Pinned open, so clearing the last label does
                                // not fold the field away mid-edit.
                                setClusterNamesFor((cur) => (cur.has(d.uid) ? cur : new Set(cur).add(d.uid)));
                                setClusterLabel(i, ps.group as number, v);
                              }}
                              maxLength={8}
                              autoCapitalize="characters"
                              accessibilityLabel={t('train.lift.clusterLabelA11y', { n: setLabels[si] })}
                              testID={`template-cluster-label-${i}-${ps.group}`}
                            />
                          </View>
                        ) : null}
                        {kindOpen === openKey ? (
                          <View accessibilityRole="radiogroup">
                            {/* The declared structure's own kinds first; the
                                rest stay pickable, marked (E-N6, ADR-0041). */}
                            {kindsForPicker(SET_KINDS, declared?.value).map(({ kind: k, fits }) => {
                              const on = ps.kind === k.value;
                              return (
                                <TouchableOpacity
                                  key={k.value}
                                  style={[styles.kindRow, on && styles.kindRowOn]}
                                  onPress={() => setSetKind(i, si, k.value)}
                                  accessibilityRole="radio"
                                  accessibilityState={{ selected: on, checked: on }}
                                  testID={`template-set-kind-${i}-${si}-${k.value}`}
                                >
                                  <Text style={[styles.kindRowName, on && styles.kindRowNameOn]}>
                                    {t(k.labelKey)}
                                  </Text>
                                  <Text style={[styles.kindRowDesc, { fontSize: font.small }]}>{t(k.descKey)}</Text>
                                  {!fits && declared ? (
                                    <Text style={[styles.kindRowDesc, { fontSize: font.small }]} testID={`template-set-kind-off-${i}-${si}-${k.value}`}>
                                      {t('train.kindOffStructure', { structure: t(declared.labelKey) })}
                                    </Text>
                                  ) : null}
                                </TouchableOpacity>
                              );
                            })}
                          </View>
                        ) : null}
                      </View>
                    );
                  })}
                  {hasClusters && !clusterNamesShown ? (
                    <TouchableOpacity
                      onPress={() => {
                        haptics.tap();
                        setClusterNamesFor((cur) => new Set(cur).add(d.uid));
                      }}
                      style={styles.textAction}
                      accessibilityRole="button"
                      testID={`template-name-clusters-${i}`}
                    >
                      <Ionicons name="pricetag-outline" size={16} color={colors.teal} />
                      <Text style={styles.sectionAction}>{t('train.lift.nameClusters')}</Text>
                    </TouchableOpacity>
                  ) : null}
                  {/* Only the buttons this structure can use. The three-button
                      row was the union of every structure's needs, on every
                      card - "+ Add cluster" under a straight-set lift is an
                      offer to break the declaration directly above it. */}
                  {/* Row 1 typed, two or more rows of its kind still blank:
                      one tap fills them rather than four fields each (T7). */}
                  {copyTargets.length > 0 ? (
                    <TouchableOpacity
                      onPress={() => copyFirstToAll(i)}
                      style={styles.textAction}
                      accessibilityRole="button"
                      testID={`template-copy-first-${i}`}
                    >
                      <Ionicons name="copy-outline" size={16} color={colors.teal} />
                      <Text style={styles.sectionAction}>{t('train.copyToAllSets')}</Text>
                    </TouchableOpacity>
                  ) : null}
                  <View style={styles.tplSetBtns}>
                    {canAdd.set ? (
                      <TouchableOpacity onPress={() => addSet(i)} style={[styles.addSetBtn, styles.textAction]} accessibilityRole="button" accessibilityLabel={t('train.addSet')} testID={`template-add-set-${i}`}>
                        <Ionicons name="add" size={18} color={colors.teal} />
                        <Text style={styles.sectionAction}>{t('train.addSet')}</Text>
                      </TouchableOpacity>
                    ) : null}
                    {canAdd.cluster ? (
                      <TouchableOpacity onPress={() => addCluster(i)} style={[styles.addSetBtn, styles.textAction]} accessibilityRole="button" testID={`template-add-cluster-${i}`}>
                        <Ionicons name="add" size={18} color={colors.teal} />
                        <Text style={styles.sectionAction}>{t('train.addCluster')}</Text>
                      </TouchableOpacity>
                    ) : null}
                    {canAdd.block ? (
                      <TouchableOpacity onPress={() => addBlock(i)} style={[styles.addSetBtn, styles.textAction]} accessibilityRole="button" testID={`template-add-block-${i}`}>
                        <Ionicons name="add" size={18} color={colors.teal} />
                        <Text style={styles.sectionAction}>{t('train.addBlock')}</Text>
                      </TouchableOpacity>
                    ) : null}
                  </View>

                  {/* Everything below is optional, and none of it is what a
                      beginner came here to do. Cues, the progression rule and
                      the exercise-level default load used to sit above the
                      sets, which is how a card reached eight controls. */}
                  <TouchableOpacity
                    style={styles.moreRow}
                    onPress={() => {
                      haptics.tap();
                      setMoreEx(more ? null : i);
                    }}
                    accessibilityRole="button"
                    accessibilityState={{ expanded: more }}
                    testID={`template-more-${i}`}
                  >
                    <Text style={styles.moreText}>{t('train.moreOptions')}</Text>
                    <Ionicons
                      name={more ? 'chevron-up' : 'chevron-down'}
                      size={16}
                      color={colors.muted}
                    />
                  </TouchableOpacity>

                  {more ? (
                    <View style={styles.moreBody}>
                      {/* Superset (2026-10-11): pair with the next row, or
                          unpair. Order and rest only — this row keeps its own
                          load, clusters and history. The leader holds the
                          group's two rests. */}
                      {tags[i] && d.supersetGroup ? (
                        <>
                          {d.pairPosition === 1 ? (
                            <>
                              <View style={fontScale > 1.3 ? { gap: space.sm } : { flexDirection: 'row', gap: space.md }}>
                                <View style={{ flex: fontScale > 1.3 ? undefined : 1, justifyContent: 'flex-end' }}>
                                  <Text style={styles.fieldLabel}>{t('train.superset.transitionRest')}</Text>
                                  <SheetTextInput
                                    style={styles.tplLoadInput}
                                    keyboardType="number-pad"
                                    placeholder={String(SUPERSET_REST_RANGE_SEC.min)}
                                    placeholderTextColor={colors.faint}
                                    value={d.transitionRestSec != null ? String(d.transitionRestSec) : ''}
                                    onChangeText={(v) => patchEx(i, { transitionRestSec: clampRest(v) })}
                                    {...doneKey}
                                    accessibilityLabel={`${t('train.superset.transitionRest')}, ${d.name}`}
                                    ref={(el) => {
                                      if (el) restInputs.current.set(d.uid, el);
                                      else restInputs.current.delete(d.uid);
                                    }}
                                    testID={`template-transition-rest-${i}`}
                                  />
                                </View>
                                <View style={{ flex: fontScale > 1.3 ? undefined : 1, justifyContent: 'flex-end' }}>
                                  <Text style={styles.fieldLabel}>{t('train.superset.roundRest')}</Text>
                                  <SheetTextInput
                                    style={styles.tplLoadInput}
                                    keyboardType="number-pad"
                                    placeholder={String(SUPERSET_REST_RANGE_SEC.min)}
                                    placeholderTextColor={colors.faint}
                                    value={d.roundRestSec != null ? String(d.roundRestSec) : ''}
                                    onChangeText={(v) => patchEx(i, { roundRestSec: clampRest(v) })}
                                    {...doneKey}
                                    accessibilityLabel={`${t('train.superset.roundRest')}, ${d.name}`}
                                    testID={`template-round-rest-${i}`}
                                  />
                                </View>
                              </View>
                              {/* The mini-set sentence only where a member has
                                  mini-sets to rest between (T14). */}
                              <Text style={styles.tplDoseNote}>
                                {(groups.get(d.supersetGroup) ?? []).some((m) => exercises[m.index]?.sets.some((x) => x.kind === 'mini'))
                                  ? t('train.superset.restHint')
                                  : t('train.superset.restHintPlain')}
                              </Text>
                              {(d.transitionRestSec ?? 0) > 120 || (d.roundRestSec ?? 0) > 120 ? (
                                <Text style={styles.supersetWarn}>{t('train.superset.restLong')}</Text>
                              ) : null}
                            </>
                          ) : (
                            <Text style={styles.tplDoseNote}>
                              {t('train.superset.restsOnLeader', {
                                group: d.supersetGroup,
                                name: exercises[(groups.get(d.supersetGroup) ?? [])[0]?.index ?? i]?.name ?? '',
                              })}
                            </Text>
                          )}
                          {canPairWithNext(exercises, i) ? (
                            <TouchableOpacity
                              style={styles.progToggle}
                              onPress={() => pairNext(i)}
                              accessibilityRole="button"
                              testID={`template-add-to-group-${i}`}
                            >
                              <Ionicons name="add-circle-outline" size={16} color={colors.muted} />
                              <Text style={styles.progToggleText}>
                                {t('train.superset.addTo', { name: exercises[i + 1].name, group: d.supersetGroup })}
                              </Text>
                            </TouchableOpacity>
                          ) : null}
                          <TouchableOpacity
                            style={styles.progToggle}
                            onPress={() => unpairRow(i)}
                            accessibilityRole="button"
                            accessibilityLabel={`${t('train.superset.unpair')}, ${d.name}`}
                            testID={`template-unpair-${i}`}
                          >
                            <Ionicons name="unlink-outline" size={16} color={colors.muted} />
                            <Text style={styles.progToggleText}>{t('train.superset.unpair')}</Text>
                          </TouchableOpacity>
                        </>
                      ) : canPairWithNext(exercises, i) ? (
                        <>
                          <TouchableOpacity
                            style={styles.progToggle}
                            onPress={() => pairNext(i)}
                            accessibilityRole="button"
                            testID={`template-pair-next-${i}`}
                          >
                            <Ionicons name="link-outline" size={16} color={colors.muted} />
                            <Text style={styles.progToggleText}>{t('train.superset.pairWith', { name: exercises[i + 1].name })}</Text>
                          </TouchableOpacity>
                          <Text style={styles.tplDoseNote}>{t('train.superset.baselineNote')}</Text>
                        </>
                      ) : null}

                      {/* Per-exercise mini-set rest. Blank means the template's
                          value applies; the placeholder shows which. */}
                      <Text style={styles.fieldLabel}>{t('train.exRestMini')}</Text>
                      <SheetTextInput
                        style={styles.tplLoadInput}
                        keyboardType="number-pad"
                        placeholder={restMini || String(DEFAULT_REST_MINI_SEC)}
                        placeholderTextColor={colors.faint}
                        value={d.restMiniSec}
                        onChangeText={(v) => patchEx(i, { restMiniSec: v })}
                        {...doneKey}
                        accessibilityLabel={`${t('train.exRestMini')}, ${d.name}`}
                        testID={`template-rest-mini-${i}`}
                      />

                      <Text style={styles.fieldLabel}>{t('train.exRestCluster')}</Text>
                      <SheetTextInput
                        style={styles.tplLoadInput}
                        keyboardType="number-pad"
                        placeholder={restCluster || String(DEFAULT_REST_CLUSTER_SEC)}
                        placeholderTextColor={colors.faint}
                        value={d.restClusterSec}
                        onChangeText={(v) => patchEx(i, { restClusterSec: v })}
                        {...doneKey}
                        accessibilityLabel={`${t('train.exRestCluster')}, ${d.name}`}
                        testID={`template-rest-cluster-${i}`}
                      />
                      <Text style={styles.fieldLabel}>{t('train.exRestNext')}</Text>
                      <SheetTextInput
                        style={styles.tplLoadInput}
                        keyboardType="number-pad"
                        // Blank falls back to this lift's cluster rest, as the
                        // live timer does (`ActiveSession` restsFor).
                        placeholder={d.restClusterSec || restCluster || String(DEFAULT_REST_CLUSTER_SEC)}
                        placeholderTextColor={colors.faint}
                        value={d.restAfterSec}
                        onChangeText={(v) => patchEx(i, { restAfterSec: v })}
                        {...doneKey}
                        accessibilityLabel={`${t('train.exRestNext')}, ${d.name}`}
                        testID={`template-rest-next-${i}`}
                      />

                      <Text style={styles.fieldLabel}>{t('train.cues')}</Text>
                      <SheetTextInput
                        style={[styles.input, styles.notesInput]}
                        placeholderTextColor={colors.faint}
                        value={d.cuesText}
                        onChangeText={(v) => patchEx(i, { cuesText: v })}
                        multiline
                        accessibilityLabel={`${t('train.cues')}, ${d.name}`}
                        testID={`template-cues-${i}`}
                      />

                      <TouchableOpacity
                        style={styles.progToggle}
                        onPress={() => {
                          haptics.tap();
                          patchEx(i, { hasProgression: !d.hasProgression });
                        }}
                        accessibilityRole="checkbox"
                        accessibilityState={{ checked: !!d.hasProgression }}
                        testID={`template-progression-${i}`}
                      >
                        <Ionicons
                          name={d.hasProgression ? 'checkbox' : 'square-outline'}
                          size={18}
                          color={d.hasProgression ? colors.ink : colors.faint}
                        />
                        <Text style={styles.progToggleText}>{t('train.progression')}</Text>
                      </TouchableOpacity>
                      {d.hasProgression ? (
                        <View style={fontScale > 1.3 ? { gap: space.sm } : styles.progRow}>
                          <View style={styles.progCell}>
                            <Text style={styles.tplSetsLabel}>{t('train.targetReps')}</Text>
                            <SheetTextInput
                              style={styles.tplLoadInput}
                              keyboardType="number-pad"
                              placeholder="12"
                              placeholderTextColor={colors.faint}
                              value={d.targetReps}
                              onChangeText={(v) => patchEx(i, { targetReps: v })}
                              {...doneKey}
                              accessibilityLabel={`${t('train.targetReps')}, ${d.name}`}
                              testID={`template-target-reps-${i}`}
                            />
                          </View>
                          <View style={styles.progCell}>
                            <Text style={styles.tplSetsLabel}>{t('train.holdSessions')}</Text>
                            <SheetTextInput
                              style={styles.tplLoadInput}
                              keyboardType="number-pad"
                              placeholder="2"
                              placeholderTextColor={colors.faint}
                              value={d.holdSessions}
                              onChangeText={(v) => patchEx(i, { holdSessions: v })}
                              {...doneKey}
                              accessibilityLabel={`${t('train.holdSessions')}, ${d.name}`}
                              testID={`template-hold-sessions-${i}`}
                            />
                          </View>
                          <View style={styles.progCell}>
                            <Text style={styles.tplSetsLabel}>
                              {t('train.incrementLb', { unit: loadUnit(unitSystem) })}
                            </Text>
                            <SheetTextInput
                              style={styles.tplLoadInput}
                              keyboardType="numeric"
                              placeholder="5"
                              placeholderTextColor={colors.faint}
                              value={d.incrementLb}
                              onChangeText={(v) => patchEx(i, { incrementLb: v })}
                              {...doneKey}
                              accessibilityLabel={`${t('train.incrementLb', { unit: loadUnit(unitSystem) })}, ${d.name}`}
                              testID={`template-increment-${i}`}
                            />
                          </View>
                        </View>
                      ) : null}
                      {d.hasProgression ? (
                        /* The three numbers ARE the rule, but nobody reads them as
                           one. Echoing them back as a sentence is the explanation. */
                        <Text style={styles.progRule}>
                          {/* A real plural, not "workout(s)" (T23). */}
                          {plural(t, locale, 'train.progressionRule', numOrUndef(d.holdSessions) ?? 2, {
                            reps: d.targetReps || 12,
                            lb: `${d.incrementLb || defaultIncrementLb(unitSystem)} ${loadUnit(unitSystem)}`,
                          })}
                        </Text>
                      ) : null}
                    </View>
                  ) : null}
                  {/* The card's last row, outside More options: open the card,
                      Remove — two taps, not three levels and a scroll (E-N10).
                      With an Undo (T5). */}
                  <TouchableOpacity
                    onPress={() => removeEx(i)}
                    style={styles.moreRemove}
                    testID={`template-remove-${i}`}
                    accessibilityRole="button"
                    // The visible text AND the object (T13): it read "Remove".
                    accessibilityLabel={`${t('train.removeExercise')}, ${d.name}`}
                  >
                    <Ionicons name="trash-outline" size={16} color={colors.danger} />
                    <Text style={styles.moreRemoveText}>{t('train.removeExercise')}</Text>
                  </TouchableOpacity>
                  </>
                  ) : null}
                </Animated.View>
                );
              })}
              </Sortable.Flex>
              </View>
            )}

            {/* Save lives in the header now (T2). Delete stays at the END
                of the content, alone on its row and never beside Save — the
                one destructive action, for a saved template only (J6). */}
            {template ? (
              <TouchableOpacity
                style={[styles.moreRemove, { marginTop: space.xl }]}
                onPress={remove}
                disabled={busy}
                accessibilityRole="button"
                accessibilityLabel={`${t('train.delete')}, ${template.name}`}
                testID="delete-template"
              >
                <Ionicons name="trash-outline" size={16} color={colors.danger} />
                <Text style={styles.moreRemoveText}>{t('train.delete')}</Text>
              </TouchableOpacity>
            ) : null}
            <View style={{ height: 24 }} />
            </>
            )}
          </Animated.ScrollView>
      </GestureHandlerRootView>
    </BottomSheet>
  );
}