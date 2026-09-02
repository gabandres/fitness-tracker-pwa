import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useMemo, useState } from 'react';
import {
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from 'react-native';
import Animated, { FadeIn, FadeOut, useAnimatedRef } from 'react-native-reanimated';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import Sortable from 'react-native-sortables';
import {
  type UnitSystem,
  MOBILITY_SEED_KEYS,
  defaultIncrement as defaultIncrementLb,
  loadUnit,
  normalizeClusterGroups,
  parseLoadToLb,
  setRowLabels,
  toDisplayLoad,
  CARDIO_MODALITIES,
  distanceUnit,
  parseDistanceToM,
  toDisplayDistance,
} from '@macrolog/core';
import type { CardioModality, PlannedCardioBlock } from '@macrolog/core/cardio';
import type {
  Exercise,
  LogStyle,
  PlannedSet,
  SetKind,
  TemplateDraft,
  TemplateExercise,
  WorkoutTemplate,
} from '@/lib/workout';
import { DEFAULT_LOG_STYLE } from '@/lib/workout';
import type { useTrain } from '@/hooks/useTrain';
import { type TFn, useT, type I18nKey} from '@/i18n';
import * as haptics from '@/lib/haptics';
import { smoothLayout } from '@/lib/motion';
import { useDeferredFocus } from '@/lib/use-deferred-focus';
import { useTheme, useThemedStyles } from '@/lib/theme-context';
import { space } from '@/theme';
import {
  CREATION_STYLES, SET_KINDS, type CreationStyle,
  kindLabelKey, logStyleFor, logStyleKey, numOrUndef, setKindFor,
} from './train-shared';
import { mobilityDoseWarnings } from '@macrolog/core';
import { BottomSheet } from '@/components/BottomSheet';
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
  const { weightText, repsText, durationText, ...ps } = d;
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

/** The one line a collapsed card shows — "3 × 8 · 20 lb". It answers the
 *  question the old card made you expand it to answer, and it degrades
 *  honestly: reps or load that differ across sets collapse to a set count
 *  rather than picking one row's number and implying it holds for all. */
function exSummary(d: DraftEx, t: TFn, unit: string): string {
  const n = d.sets.length;
  const sets = n === 1 ? t('train.setCountOne') : t('train.setCount', { n });
  /** The value every set shares, or null if they differ — or if ANY set
   *  leaves it blank, because "3 × 8" must not describe a template where only
   *  the first row says 8. Compare the FILLED count to the set count: an
   *  earlier version compared the deduped Set's `size` to it, which is 1 for
   *  any uniform run and so could only ever be true for a single set. */
  const one = (vals: string[]): string | null => {
    const filled = vals.map((v) => v.trim()).filter(Boolean);
    if (filled.length !== vals.length) return null;
    return new Set(filled).size === 1 ? filled[0] : null;
  };

  if (d.logStyle === 'time') {
    const secs = one(d.sets.map((x) => x.durationText));
    return secs ? `${n} × ${secs}s` : sets;
  }

  const reps = one(d.sets.map((x) => x.repsText));
  const head = reps ? `${n} × ${reps}` : sets;
  if (d.logStyle === 'bodyweight') return head;

  // Per-set weight wins; the exercise-level default is the fallback it always was.
  const load = one(d.sets.map((x) => x.weightText)) ?? d.targetLoad.trim();
  // `unit` is passed in rather than read here: this is a pure formatter and
  // the draft buffers are already in the training unit.
  return load ? `${head} · ${load} ${unit}` : head;
}

// carries EVERY field the stored TemplateExercise has, because the editor
// writes `exercises` as a full overwrite. A field the editor cannot see is a
// field the next save deletes — which is how mobile edits used to flatten
// clusters and wipe cues/progression written on the web.
interface DraftEx {
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
  /** The real planned sets, not a count — a count cannot represent a cluster
   *  (activation/mini/mini) and rewriting one as N working sets destroys it. */
  sets: DraftSet[];
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
  const styles = useThemedStyles(createStyles);
  const unitSystem = useUnitSystem();
  const { colors } = useTheme();
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
  /** Handed to Sortable so a drag near the sheet's edge scrolls it. It must be
   *  a Reanimated AnimatedRef on an Animated.ScrollView — a plain ref is
   *  accepted by the types and simply never auto-scrolls. */
  const scrollRef = useAnimatedRef<Animated.ScrollView>();
  /** Exercise cards need an explicit PIXEL width. They are children of
   *  `Sortable.Flex`, which wraps each one in a container it measures from the
   *  child — so there is no definite parent width for `100%` to resolve
   *  against, and neither `width: '100%'` nor `alignItems="stretch"` fills the
   *  row (both were tried on device; the cards stayed as wide as their exercise
   *  names, and a template read as a ragged staircase). The sheet pads
   *  `space.xl` each side. */
  const { width: windowWidth } = useWindowDimensions();
  const cardWidth = windowWidth - space.xl * 2;
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (!visible) return;
    setName(template?.name ?? '');
    setNotes(template?.notes ?? '');
    setRestMini(template?.restMiniSec != null ? String(template.restMiniSec) : '');
    setRestCluster(template?.restClusterSec != null ? String(template.restClusterSec) : '');
    setCardioBlocks(
      (template?.cardioBlocks ?? []).map((b) => ({
        modality: b.modality,
        label: b.label ?? '',
        minutes: b.targetDurationSec != null ? String(Math.round(b.targetDurationSec / 60)) : '',
        distance:
          b.targetDistanceM != null
            ? String(toDisplayDistance(b.targetDistanceM, unitSystem))
            : '',
      })),
    );
    setExercises(
      (template?.exercises ?? []).map((ex) => ({
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
        sets: ex.plannedSets.length
          ? ex.plannedSets.map((ps) => toDraftSet(ps, unitSystem))
          : [newDraftSet('working')],
      })),
    );
    setKindOpen(null);
    setOpenEx(null);
    setMoreEx(null);
    setErr('');
    setExName('');
    setExStyle('weight-reps');
    setBusy(false);
  }, [visible, template]);

  const trimmedEx = exName.trim();
  const matches = trimmedEx
    ? train.catalog.filter((e) => e.name.toLowerCase().includes(trimmedEx.toLowerCase())).slice(0, 5)
    : [];

  function appendEx(
    exercise: Pick<DraftEx, 'exerciseId' | 'name' | 'logStyle'> & { cuesText?: string },
    // The scaffolded sets' kind. Defaulted rather than required so the catalog
    // and cardio paths read unchanged; only mobility ever passes anything.
    kind: SetKind = 'working',
  ) {
    setExercises((prev) => [
      ...prev,
      {
        ...exercise,
        targetLoad: '',
        cuesText: exercise.cuesText ?? '',
        hasProgression: false,
        targetReps: '',
        holdSessions: '',
        incrementLb: '',
        restMiniSec: '',
        sets: [newDraftSet(kind), newDraftSet(kind), newDraftSet(kind)],
      },
    ]);
    setOpenEx(exercises.length); // the index the new card lands on
    setMoreEx(null);
    setExName('');
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

  async function addFreeType() {
    if (!trimmedEx || busy) return;
    haptics.tap();
    setBusy(true);
    try {
      const style = logStyleFor(exStyle);
      const id = await train.addCatalogExercise(trimmedEx, style);
      appendEx({ exerciseId: id, name: trimmedEx, logStyle: style }, setKindFor(exStyle));
    } finally {
      setBusy(false);
    }
  }

  function addCardio(modality: CardioModality) {
    setCardioBlocks((cur) => [...cur, { modality, label: '', minutes: '', distance: '' }]);
  }

  function patchCardio(index: number, patch: Partial<DraftCardio>) {
    setCardioBlocks((cur) => cur.map((b, i) => (i === index ? { ...b, ...patch } : b)));
  }

  function removeCardio(index: number) {
    setCardioBlocks((cur) => cur.filter((_, i) => i !== index));
  }

  function patchEx(index: number, patch: Partial<DraftEx>) {
    setExercises((prev) => prev.map((d, i) => (i === index ? { ...d, ...patch } : d)));
  }

  function removeEx(index: number) {
    setExercises((prev) => prev.filter((_, i) => i !== index));
    // The flags are INDICES into a list that just shifted; stale ones would
    // expand whichever exercise slid into the removed slot.
    setOpenEx(null);
    setMoreEx(null);
  }

  // Reorder by one position (array order IS the saved template order). Robust
  // ▲▼ controls; true drag-to-reorder is a follow-up (needs on-device tuning).
  function moveEx(from: number, dir: -1 | 1) {
    const to = from + dir;
    setExercises((prev) => {
      if (to < 0 || to >= prev.length) return prev;
      const next = [...prev];
      [next[from], next[to]] = [next[to], next[from]];
      return next;
    });
    setOpenEx((o) => (o === from ? to : o === to ? from : o));
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
    setExercises((prev) => {
      const next = [...prev];
      const [moved] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moved);
      return next;
    });
    // Same reason removeEx resets these: they are INDICES into a list that
    // just shifted, and a stale one expands whichever card slid into the slot.
    setOpenEx(null);
    setMoreEx(null);
  }

  /** Every set mutation re-derives cluster groups, so numbering stays
   *  sequential and contiguous after kind changes, inserts and deletes —
   *  same invariant the PWA editor holds (`mutateSets`). */
  function mutateSets(index: number, fn: (sets: DraftSet[]) => DraftSet[]) {
    setExercises((prev) =>
      prev.map((d, i) => (i === index ? { ...d, sets: normalizeClusterGroups(fn(d.sets)) } : d)),
    );
  }

  function addSet(index: number) {
    haptics.tap();
    mutateSets(index, (sets) => [...sets, newDraftSet('working')]);
  }

  function addCluster(index: number) {
    haptics.tap();
    mutateSets(index, (sets) => [...sets, newDraftSet('activation'), newDraftSet('mini'), newDraftSet('mini')]);
  }

  function removeSet(index: number, setIdx: number) {
    mutateSets(index, (sets) => sets.filter((_, i) => i !== setIdx));
  }

  /** Edit one set's target buffers. No haptic — this fires per keystroke. */
  function patchSet(index: number, setIdx: number, patch: Partial<DraftSet>) {
    mutateSets(index, (sets) => sets.map((s, i) => (i === setIdx ? { ...s, ...patch } : s)));
  }

  function setSetKind(index: number, setIdx: number, kind: SetKind) {
    haptics.tap();
    mutateSets(index, (sets) => sets.map((s, i) => (i === setIdx ? { ...s, kind } : s)));
    setKindOpen(null);
  }

  const canSave = name.trim().length > 0 && !busy;

  async function save() {
    if (!canSave) return;
    setBusy(true);
    setErr('');
    try {
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
            targetLoad: parseLoadToLb(d.targetLoad, unitSystem) ?? undefined,
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
            plannedSets: normalizeClusterGroups(
              d.sets.length ? d.sets : [newDraftSet('working')],
            ).map((d) => toPlannedSet(d, unitSystem)),
          };
        }),
      };
      await train.saveTemplate(draft, template?.id);
      onClose();
    } catch {
      // Without this the sheet just sat there on a rejected write and the
      // save looked like a no-op — the failure mode that hid this bug.
      setErr(t('train.saveErr'));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!template?.id || busy) return;
    setBusy(true);
    try {
      await train.deleteTemplate(template.id);
      onClose();
    } finally {
      setBusy(false);
    }
  }

  return (
    <BottomSheet visible={visible} onClose={onClose} contentStyle={styles.sheetBody} maxHeight="80%">
      {/* Gestures inside a `Modal` need their own root: RNGH attaches to the
          nearest GestureHandlerRootView, and the app's lives outside this
          modal's native view on Android, where the drag would otherwise never
          start. Harmless on iOS. It sits INSIDE `<BottomSheet>` rather than
          wrapping it for exactly that reason — the root has to be within the
          modal's native view, and the modal now belongs to the sheet. */}
      <GestureHandlerRootView style={styles.ghRoot}>
          <Animated.ScrollView
            ref={scrollRef}
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
            contentContainerStyle={{ paddingBottom: 360 }}
          >
            <Text style={styles.sheetTitle}>{template ? t('train.editTemplate') : t('train.newTemplateTitle')}</Text>

            <Text style={styles.fieldLabel}>{t('train.templateName')}</Text>
            <TextInput
              style={styles.input}
              placeholder={t('train.templateNamePh')}
              placeholderTextColor={colors.faint}
              value={name}
              onChangeText={setName}
              testID="template-name"
            />

            <Text style={[styles.fieldLabel, { marginTop: space.sm }]}>{t('train.templateNotes')}</Text>
            <TextInput
              style={[styles.input, styles.notesInput]}
              placeholder={t('train.templateNotesPh')}
              placeholderTextColor={colors.faint}
              value={notes}
              onChangeText={setNotes}
              multiline
              testID="template-notes"
            />

            <View style={styles.restRow}>
              <View style={styles.restCell}>
                <Text style={[styles.fieldLabel, { marginTop: space.sm }]}>{t('train.restMini')}</Text>
                <TextInput
                  style={styles.input}
                  keyboardType="numeric"
                  placeholderTextColor={colors.faint}
                  value={restMini}
                  onChangeText={setRestMini}
                  testID="template-rest-mini"
                />
              </View>
              <View style={styles.restCell}>
                <Text style={[styles.fieldLabel, { marginTop: space.sm }]}>{t('train.restCluster')}</Text>
                <TextInput
                  style={styles.input}
                  keyboardType="numeric"
                  placeholderTextColor={colors.faint}
                  value={restCluster}
                  onChangeText={setRestCluster}
                  testID="template-rest-cluster"
                />
              </View>
            </View>

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
                <TextInput
                  style={styles.input}
                  placeholder={t('cardio.labelPlaceholder')}
                  placeholderTextColor={colors.faint}
                  value={b.label}
                  onChangeText={(v) => patchCardio(i, { label: v })}
                  testID={`template-cardio-label-${i}`}
                />
                <View style={styles.cardioFieldRow}>
                  <View style={styles.cardioField}>
                    <Text style={styles.cardioLabel}>{t('cardio.targetDuration')}</Text>
                    <TextInput
                      style={styles.cardioInput}
                      keyboardType="number-pad"
                      inputMode="numeric"
                      placeholder="—"
                      placeholderTextColor={colors.faint}
                      value={b.minutes}
                      onChangeText={(v) => patchCardio(i, { minutes: v })}
                      testID={`template-cardio-minutes-${i}`}
                    />
                  </View>
                  <View style={styles.cardioField}>
                    <Text style={styles.cardioLabel}>
                      {t('cardio.targetDistance')} ({distanceUnit(unitSystem)})
                    </Text>
                    <TextInput
                      style={styles.cardioInput}
                      keyboardType="numeric"
                      inputMode="decimal"
                      placeholder="—"
                      placeholderTextColor={colors.faint}
                      value={b.distance}
                      onChangeText={(v) => patchCardio(i, { distance: v })}
                      testID={`template-cardio-distance-${i}`}
                    />
                  </View>
                </View>
                <TouchableOpacity onPress={() => removeCardio(i)} style={styles.exRemoveRow}>
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
                testID="template-add-cardio"
              >
                <Text style={styles.addExText}>{t('cardio.templateAdd')}</Text>
              </TouchableOpacity>
            )}

            <Text style={[styles.fieldLabel, { marginTop: space.md }]}>{t('train.templateExercises')}</Text>

            {/* Adder at the TOP so it's reachable without scrolling past every
                exercise. Type → pick a catalog match, or create a new one. */}
            <TextInput
              style={[styles.input, { marginTop: space.sm }]}
              placeholder={t('train.addExercisePh')}
              placeholderTextColor={colors.faint}
              value={exName}
              onChangeText={setExName}
              testID="template-add-exercise"
            />
            {trimmedEx ? (
              <>
                <View style={[styles.styleRow, styles.styleRowWrap]}>
                  {CREATION_STYLES.map((ls) => {
                    const on = exStyle === ls.value;
                    return (
                      <TouchableOpacity
                        key={ls.value}
                        style={[styles.styleChip, styles.styleChipHalf, on && styles.styleChipOn]}
                        onPress={() => setExStyle(ls.value)}
                      >
                        <Text style={[styles.styleChipText, on && styles.styleChipTextOn]}>{t(ls.labelKey)}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
                {matches.map((e, mi) => (
                  <TouchableOpacity
                    key={e.id}
                    style={styles.catalogRow}
                    onPress={() => addFromCatalog(e)}
                    // Indexed, not keyed by doc id: a UI test can know "the
                    // first match" but never a Firestore id it did not create.
                    testID={`template-match-${mi}`}
                  >
                    <Text style={styles.catalogName}>{e.name}</Text>
                    <Text style={styles.catalogStyle}>{t(logStyleKey(e.logStyle))}</Text>
                  </TouchableOpacity>
                ))}
                <TouchableOpacity style={styles.createRow} onPress={addFreeType} testID="template-create-exercise">
                  <Text style={styles.createText}>{t('train.addNamed', { name: trimmedEx })}</Text>
                </TouchableOpacity>
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
                return (
                <Animated.View
                  key={`${d.exerciseId}-${i}`}
                  style={[styles.tplExCard, { width: cardWidth }]}
                  layout={smoothLayout}
                >
                  <View style={styles.tplExTop}>
                    {/* One grip in place of the old ▲▼ pair. Dragging is
                        invisible to VoiceOver, so the handle carries explicit
                        move-up / move-down accessibility ACTIONS that run the
                        same `moveEx` the chevrons used to — the reorder logic
                        is unchanged, only its sighted affordance is. */}
                    <View
                      style={styles.tplDragHandle}
                      accessibilityRole="adjustable"
                      accessibilityLabel={t('train.reorderA11y', { name: d.name })}
                      accessibilityActions={[
                        { name: 'moveUp', label: t('train.moveUp') },
                        { name: 'moveDown', label: t('train.moveDown') },
                      ]}
                      onAccessibilityAction={(e) => {
                        if (e.nativeEvent.actionName === 'moveUp') moveEx(i, -1);
                        if (e.nativeEvent.actionName === 'moveDown') moveEx(i, 1);
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
                      style={styles.tplExTapRow}
                      onPress={() => {
                        haptics.tap();
                        setOpenEx(open ? null : i);
                      }}
                      accessibilityRole="button"
                      accessibilityState={{ expanded: open }}
                      accessibilityLabel={`${d.name}. ${exSummary(d, t, loadUnit(unitSystem))}`}
                      testID={`template-ex-toggle-${i}`}
                    >
                      <View style={{ flex: 1 }}>
                        <Text style={styles.tplExName}>{d.name}</Text>
                        <Text style={styles.tplExMeta}>{exSummary(d, t, loadUnit(unitSystem))}</Text>
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
                      />
                    </TouchableOpacity>
                  </View>
                  {open ? (
                  <>
                  {/* Sets are a small TABLE: a row says what to do, and the
                      headers say what the numbers mean, so neither needs a
                      legend. The set number doubles as the type control —
                      tapping it opens the kind picker — which removes a
                      full-width button from every row without hiding
                      anything, because a non-working kind still prints its
                      name under the number. */}
                  <Text style={styles.fieldLabel}>{t('train.sets')}</Text>
                  <View style={styles.tplSetHead}>
                    <Text style={[styles.tplSetHeadCell, styles.tplSetNumCell]}>{t('train.setShort')}</Text>
                    {d.logStyle === 'weight-reps' ? (
                      <Text style={[styles.tplSetHeadCell, styles.tplSetCell]}>{loadUnit(unitSystem)}</Text>
                    ) : null}
                    <Text style={[styles.tplSetHeadCell, styles.tplSetCell]}>
                      {d.logStyle === 'time' ? t('train.secShort') : t('train.repsShort')}
                    </Text>
                    <View style={styles.tplSetDelCell} />
                  </View>
                  {d.sets.map((ps, si) => {
                    const openKey = `${i}:${si}`;
                    return (
                      <View key={si}>
                        <View style={styles.tplSetRow}>
                          <TouchableOpacity
                            style={styles.tplSetNumCell}
                            onPress={() => setKindOpen(kindOpen === openKey ? null : openKey)}
                            accessibilityLabel={t('train.setTypeA11y', {
                              n: setLabels[si],
                              kind: t(kindLabelKey(ps.kind)),
                            })}
                            testID={`template-set-kind-${i}-${si}`}
                          >
                            <Text style={styles.tplSetNum}>{setLabels[si]}</Text>
                            {ps.kind !== 'working' ? (
                              <Text style={styles.tplSetKindTag} numberOfLines={1}>
                                {t(kindLabelKey(ps.kind))}
                              </Text>
                            ) : null}
                          </TouchableOpacity>

                          {/* The prescription. A template that cannot say
                              "8 @ 135" makes the logger a blank form the
                              lifter retypes every session.
                              NO placeholders on these cells: the column
                              headers above already say lb / reps / sec, and
                              repeating the unit inside every empty box was
                              just noise — three rows of an exercise showed the
                              word "reps" four times. The header labels the
                              column; the cell stays empty until it has a
                              number. */}
                          {d.logStyle === 'time' ? (
                            <TextInput
                              style={[styles.tplSetInput, styles.tplSetCell]}
                              keyboardType="numeric"
                              value={ps.durationText}
                              onChangeText={(v) => patchSet(i, si, { durationText: v })}
                              accessibilityLabel={t('train.setDurationA11y', { n: si + 1 })}
                              testID={`template-set-duration-${i}-${si}`}
                            />
                          ) : (
                            <>
                              {d.logStyle !== 'bodyweight' ? (
                                <TextInput
                                  style={[styles.tplSetInput, styles.tplSetCell]}
                                  keyboardType="numeric"
                                  value={ps.weightText}
                                  onChangeText={(v) => patchSet(i, si, { weightText: v })}
                                  accessibilityLabel={t('train.setWeightA11y', { n: si + 1 })}
                                  testID={`template-set-weight-${i}-${si}`}
                                />
                              ) : null}
                              <TextInput
                                style={[styles.tplSetInput, styles.tplSetCell]}
                                keyboardType="numeric"
                                value={ps.repsText}
                                onChangeText={(v) => patchSet(i, si, { repsText: v })}
                                accessibilityLabel={t('train.setRepsA11y', { n: si + 1 })}
                                testID={`template-set-reps-${i}-${si}`}
                              />
                            </>
                          )}

                          <TouchableOpacity
                            onPress={() => removeSet(i, si)}
                            hitSlop={8}
                            style={styles.tplSetDelCell}
                            accessibilityLabel={t('train.removeSet')}
                            testID={`template-set-remove-${i}-${si}`}
                          >
                            <Ionicons name="close" size={16} color={colors.faint} />
                          </TouchableOpacity>
                        </View>
                        {kindOpen === openKey ? (
                          <View>
                            {SET_KINDS.map((k) => {
                              const on = ps.kind === k.value;
                              return (
                                <TouchableOpacity
                                  key={k.value}
                                  style={[styles.kindRow, on && styles.kindRowOn]}
                                  onPress={() => setSetKind(i, si, k.value)}
                                  testID={`template-set-kind-${i}-${si}-${k.value}`}
                                >
                                  <Text style={[styles.kindRowName, on && styles.kindRowNameOn]}>
                                    {t(k.labelKey)}
                                  </Text>
                                  <Text style={styles.kindRowDesc}>{t(k.descKey)}</Text>
                                </TouchableOpacity>
                              );
                            })}
                          </View>
                        ) : null}
                      </View>
                    );
                  })}
                  <View style={styles.tplSetBtns}>
                    <TouchableOpacity onPress={() => addSet(i)} testID={`template-add-set-${i}`}>
                      <Text style={styles.sectionAction}>{t('train.addSet')}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => addCluster(i)} testID={`template-add-cluster-${i}`}>
                      <Text style={styles.sectionAction}>{t('train.addCluster')}</Text>
                    </TouchableOpacity>
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
                      <View style={styles.tplExControls}>
                        {d.logStyle !== 'bodyweight' ? (
                          <View style={styles.tplLoadWrap}>
                            <TextInput
                              style={styles.tplLoadInput}
                              placeholder={t('train.target')}
                              placeholderTextColor={colors.faint}
                              keyboardType="numeric"
                              value={d.targetLoad}
                              onChangeText={(v) => patchEx(i, { targetLoad: v })}
                              testID={`template-load-${i}`}
                            />
                            <Text style={styles.tplLoadUnit}>{loadUnit(unitSystem)}</Text>
                          </View>
                        ) : (
                          <View style={{ flex: 1 }} />
                        )}
                      </View>

                      {/* Per-exercise mini-set rest. Blank means the template's
                          value applies; the placeholder shows which. */}
                      <Text style={styles.fieldLabel}>{t('train.exRestMini')}</Text>
                      <TextInput
                        style={styles.tplLoadInput}
                        keyboardType="numeric"
                        placeholder={restMini || '—'}
                        placeholderTextColor={colors.faint}
                        value={d.restMiniSec}
                        onChangeText={(v) => patchEx(i, { restMiniSec: v })}
                        accessibilityLabel={t('train.exRestMini')}
                        testID={`template-rest-mini-${i}`}
                      />

                      <Text style={styles.fieldLabel}>{t('train.cues')}</Text>
                      <TextInput
                        style={[styles.input, styles.notesInput]}
                        placeholderTextColor={colors.faint}
                        value={d.cuesText}
                        onChangeText={(v) => patchEx(i, { cuesText: v })}
                        multiline
                        testID={`template-cues-${i}`}
                      />

                      <TouchableOpacity
                        style={styles.progToggle}
                        onPress={() => {
                          haptics.tap();
                          patchEx(i, { hasProgression: !d.hasProgression });
                        }}
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
                        <View style={styles.progRow}>
                          <View style={styles.progCell}>
                            <Text style={styles.tplSetsLabel}>{t('train.targetReps')}</Text>
                            <TextInput
                              style={styles.tplLoadInput}
                              keyboardType="numeric"
                              placeholder="12"
                              placeholderTextColor={colors.faint}
                              value={d.targetReps}
                              onChangeText={(v) => patchEx(i, { targetReps: v })}
                              testID={`template-target-reps-${i}`}
                            />
                          </View>
                          <View style={styles.progCell}>
                            <Text style={styles.tplSetsLabel}>{t('train.holdSessions')}</Text>
                            <TextInput
                              style={styles.tplLoadInput}
                              keyboardType="numeric"
                              placeholder="2"
                              placeholderTextColor={colors.faint}
                              value={d.holdSessions}
                              onChangeText={(v) => patchEx(i, { holdSessions: v })}
                              testID={`template-hold-sessions-${i}`}
                            />
                          </View>
                          <View style={styles.progCell}>
                            <Text style={styles.tplSetsLabel}>
                              {t('train.incrementLb', { unit: loadUnit(unitSystem) })}
                            </Text>
                            <TextInput
                              style={styles.tplLoadInput}
                              keyboardType="numeric"
                              placeholder="5"
                              placeholderTextColor={colors.faint}
                              value={d.incrementLb}
                              onChangeText={(v) => patchEx(i, { incrementLb: v })}
                              testID={`template-increment-${i}`}
                            />
                          </View>
                        </View>
                      ) : null}
                      {d.hasProgression ? (
                        /* The three numbers ARE the rule, but nobody reads them as
                           one. Echoing them back as a sentence is the explanation. */
                        <Text style={styles.progRule}>
                          {t('train.progressionRule', {
                            reps: d.targetReps || 12,
                            sessions: d.holdSessions || 2,
                            lb: `${d.incrementLb || defaultIncrementLb(unitSystem)} ${loadUnit(unitSystem)}`,
                          })}
                        </Text>
                      ) : null}
                      <TouchableOpacity
                        onPress={() => removeEx(i)}
                        style={styles.moreRemove}
                        testID={`template-remove-${i}`}
                        accessibilityRole="button"
                        accessibilityLabel={t('common.remove')}
                      >
                        <Ionicons name="trash-outline" size={16} color={colors.danger} />
                        <Text style={styles.moreRemoveText}>{t('train.removeExercise')}</Text>
                      </TouchableOpacity>
                    </View>
                  ) : null}
                  </>
                  ) : null}
                </Animated.View>
                );
              })}
              </Sortable.Flex>
              </View>
            )}

            {err ? <Text style={[styles.error, { marginTop: space.sm }]}>{err}</Text> : null}

            <View style={styles.editorBtns}>
              {template ? (
                <TouchableOpacity style={styles.discardBtn} onPress={remove} disabled={busy} testID="delete-template">
                  <Text style={styles.discardText}>{t('common.remove')}</Text>
                </TouchableOpacity>
              ) : null}
              <TouchableOpacity
                style={[styles.finishBtn, !canSave && styles.btnDisabled]}
                onPress={save}
                disabled={!canSave}
                testID="save-template"
              >
                <Text style={styles.finishText}>{busy ? t('common.saving') : t('common.save')}</Text>
              </TouchableOpacity>
            </View>
            <View style={{ height: 24 }} />
          </Animated.ScrollView>
      </GestureHandlerRootView>
    </BottomSheet>
  );
}