import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import { normalizeClusterGroups } from '@macrolog/core';
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
import { useT } from '@/i18n';
import * as haptics from '@/lib/haptics';
import { smoothLayout } from '@/lib/motion';
import { useDeferredFocus } from '@/lib/use-deferred-focus';
import { useKeyboardSheetStyle } from '@/lib/use-keyboard-sheet-style';
import { useTheme, useThemedStyles } from '@/lib/theme-context';
import { space } from '@/theme';
import { LOG_STYLES, SET_KINDS, kindLabelKey, logStyleKey, numOrUndef } from './train-shared';
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

function toDraftSet(ps: PlannedSet): DraftSet {
  return {
    ...ps,
    weightText: numText(ps.weight),
    repsText: numText(ps.reps),
    durationText: numText(ps.durationSec),
  };
}

/** Strip the buffers and parse them back onto the stored shape. Anything the
 *  editor never showed (`repsMax`) is carried through untouched — a field the
 *  editor cannot see must not be a field the next save deletes. */
function toPlannedSet(d: DraftSet): PlannedSet {
  const { weightText, repsText, durationText, ...ps } = d;
  return {
    ...ps,
    weight: numOrUndef(weightText),
    reps: numOrUndef(repsText),
    durationSec: numOrUndef(durationText),
  };
}

const newDraftSet = (kind: SetKind): DraftSet => toDraftSet({ kind });

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
  const { colors } = useTheme();
  const keyboardStyle = useKeyboardSheetStyle();
  const [name, setName] = useState('');
  const [notes, setNotes] = useState('');
  const [restMini, setRestMini] = useState('');
  const [restCluster, setRestCluster] = useState('');
  const [exercises, setExercises] = useState<DraftEx[]>([]);
  const [exName, setExName] = useState('');
  const [exStyle, setExStyle] = useState<LogStyle>('weight-reps');
  const [kindOpen, setKindOpen] = useState<string | null>(null); // `${exIdx}:${setIdx}`
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (!visible) return;
    setName(template?.name ?? '');
    setNotes(template?.notes ?? '');
    setRestMini(template?.restMiniSec != null ? String(template.restMiniSec) : '');
    setRestCluster(template?.restClusterSec != null ? String(template.restClusterSec) : '');
    setExercises(
      (template?.exercises ?? []).map((ex) => ({
        exerciseId: ex.exerciseId,
        name: ex.name,
        logStyle: ex.logStyle ?? 'weight-reps',
        targetLoad: ex.targetLoad != null ? String(ex.targetLoad) : '',
        cuesText: (ex.cues ?? []).join('\n'),
        hasProgression: !!ex.progression,
        targetReps: ex.progression ? String(ex.progression.targetReps) : '',
        holdSessions: ex.progression ? String(ex.progression.holdSessions) : '',
        incrementLb: ex.progression ? String(ex.progression.incrementLb) : '',
        sets: ex.plannedSets.length ? ex.plannedSets.map(toDraftSet) : [newDraftSet('working')],
      })),
    );
    setKindOpen(null);
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
        sets: [newDraftSet('working'), newDraftSet('working'), newDraftSet('working')],
      },
    ]);
    setExName('');
  }

  function addFromCatalog(c: Exercise) {
    haptics.tap();
    appendEx({
      exerciseId: c.id!,
      name: c.name,
      logStyle: c.logStyle ?? 'weight-reps',
      cuesText: (c.defaultCues ?? []).join('\n'),
    });
  }

  async function addFreeType() {
    if (!trimmedEx || busy) return;
    haptics.tap();
    setBusy(true);
    try {
      const id = await train.addCatalogExercise(trimmedEx, exStyle);
      appendEx({ exerciseId: id, name: trimmedEx, logStyle: exStyle });
    } finally {
      setBusy(false);
    }
  }

  function patchEx(index: number, patch: Partial<DraftEx>) {
    setExercises((prev) => prev.map((d, i) => (i === index ? { ...d, ...patch } : d)));
  }

  function removeEx(index: number) {
    setExercises((prev) => prev.filter((_, i) => i !== index));
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
    haptics.tap();
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
        exercises: exercises.map((d): TemplateExercise => {
          const cues = d.cuesText.split('\n').map((c) => c.trim()).filter(Boolean);
          return {
            exerciseId: d.exerciseId,
            name: d.name,
            logStyle: d.logStyle,
            targetLoad: numOrUndef(d.targetLoad),
            cues: cues.length ? cues : undefined,
            progression: d.hasProgression
              ? {
                  targetReps: numOrUndef(d.targetReps) ?? 12,
                  holdSessions: numOrUndef(d.holdSessions) ?? 2,
                  incrementLb: numOrUndef(d.incrementLb) ?? 5,
                }
              : undefined,
            plannedSets: normalizeClusterGroups(
              d.sets.length ? d.sets : [newDraftSet('working')],
            ).map(toPlannedSet),
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
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={styles.sheetWrap}>
        <Animated.View style={[styles.sheet, keyboardStyle]}>
          <View style={styles.handle} />
          <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
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
                <View style={styles.styleRow}>
                  {LOG_STYLES.map((ls) => {
                    const on = exStyle === ls.value;
                    return (
                      <TouchableOpacity
                        key={ls.value}
                        style={[styles.styleChip, on && styles.styleChipOn]}
                        onPress={() => setExStyle(ls.value)}
                      >
                        <Text style={[styles.styleChipText, on && styles.styleChipTextOn]}>{t(ls.labelKey)}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
                {matches.map((e) => (
                  <TouchableOpacity key={e.id} style={styles.catalogRow} onPress={() => addFromCatalog(e)}>
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
              exercises.map((d, i) => (
                <View key={`${d.exerciseId}-${i}`} style={styles.tplExCard}>
                  <View style={styles.tplExTop}>
                    <View style={styles.tplReorder}>
                      <TouchableOpacity
                        onPress={() => moveEx(i, -1)}
                        disabled={i === 0}
                        hitSlop={6}
                        style={styles.tplMoveBtn}
                        testID={`template-up-${i}`}
                        accessibilityLabel={t('train.moveUp')}
                      >
                        <Ionicons name="chevron-up" size={18} color={i === 0 ? colors.line : colors.muted} />
                      </TouchableOpacity>
                      <TouchableOpacity
                        onPress={() => moveEx(i, 1)}
                        disabled={i === exercises.length - 1}
                        hitSlop={6}
                        style={styles.tplMoveBtn}
                        testID={`template-down-${i}`}
                        accessibilityLabel={t('train.moveDown')}
                      >
                        <Ionicons name="chevron-down" size={18} color={i === exercises.length - 1 ? colors.line : colors.muted} />
                      </TouchableOpacity>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.tplExName}>{d.name}</Text>
                      <Text style={styles.tplExMeta}>{t(logStyleKey(d.logStyle))}</Text>
                    </View>
                    <TouchableOpacity
                      onPress={() => removeEx(i)}
                      hitSlop={8}
                      style={styles.tplDel}
                      testID={`template-remove-${i}`}
                      accessibilityRole="button"
                      accessibilityLabel={t('common.remove')}
                    >
                      <Ionicons name="close" size={18} color={colors.faint} />
                    </TouchableOpacity>
                  </View>
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
                        <Text style={styles.tplLoadUnit}>lb</Text>
                      </View>
                    ) : (
                      <View style={{ flex: 1 }} />
                    )}
                  </View>

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
                        <Text style={styles.tplSetsLabel}>{t('train.incrementLb')}</Text>
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
                        lb: d.incrementLb || 5,
                      })}
                    </Text>
                  ) : null}

                  {/* Sets, edited individually. A cluster is activation +
                      two minis; the C-number is derived, never typed. */}
                  <Text style={styles.fieldLabel}>{t('train.sets')}</Text>
                  {d.sets.map((ps, si) => {
                    const openKey = `${i}:${si}`;
                    return (
                      <View key={si}>
                        <View style={styles.tplSetRow}>
                          <TouchableOpacity
                            style={styles.tplSetKind}
                            onPress={() => setKindOpen(kindOpen === openKey ? null : openKey)}
                            testID={`template-set-kind-${i}-${si}`}
                          >
                            <Text style={styles.tplSetKindText}>{t(kindLabelKey(ps.kind))}</Text>
                          </TouchableOpacity>

                          {/* The prescription. A template that cannot say
                              "8 @ 135" makes the logger a blank form the
                              lifter retypes every session. Placeholders carry
                              the units so the row needs no header. */}
                          {d.logStyle === 'time' ? (
                            <TextInput
                              style={styles.tplSetInput}
                              keyboardType="numeric"
                              placeholder={t('train.secShort')}
                              placeholderTextColor={colors.faint}
                              value={ps.durationText}
                              onChangeText={(v) => patchSet(i, si, { durationText: v })}
                              accessibilityLabel={t('train.setDurationA11y', { n: si + 1 })}
                              testID={`template-set-duration-${i}-${si}`}
                            />
                          ) : (
                            <>
                              {d.logStyle !== 'bodyweight' ? (
                                <TextInput
                                  style={styles.tplSetInput}
                                  keyboardType="numeric"
                                  placeholder={t('train.lbShort')}
                                  placeholderTextColor={colors.faint}
                                  value={ps.weightText}
                                  onChangeText={(v) => patchSet(i, si, { weightText: v })}
                                  accessibilityLabel={t('train.setWeightA11y', { n: si + 1 })}
                                  testID={`template-set-weight-${i}-${si}`}
                                />
                              ) : null}
                              <TextInput
                                style={styles.tplSetInput}
                                keyboardType="numeric"
                                placeholder={t('train.repsShort')}
                                placeholderTextColor={colors.faint}
                                value={ps.repsText}
                                onChangeText={(v) => patchSet(i, si, { repsText: v })}
                                accessibilityLabel={t('train.setRepsA11y', { n: si + 1 })}
                                testID={`template-set-reps-${i}-${si}`}
                              />
                            </>
                          )}

                          <Text style={styles.tplSetGroup}>
                            {ps.group != null ? t('train.cluster', { n: ps.group }) : ''}
                          </Text>
                          <TouchableOpacity
                            onPress={() => removeSet(i, si)}
                            hitSlop={8}
                            style={styles.tplDel}
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
                </View>
              ))
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
          </ScrollView>
        </Animated.View>
      </View>
    </Modal>
  );
}