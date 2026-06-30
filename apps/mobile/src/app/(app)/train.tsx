import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTrain } from '@/hooks/useTrain';
import type {
  Exercise,
  LogStyle,
  TemplateDraft,
  WorkoutSession,
  WorkoutSet,
  WorkoutTemplate,
} from '@/lib/workout';
import { DEFAULT_LOG_STYLE, isLoggedSet, sessionVolume } from '@/lib/workout';
import { type I18nKey, type TFn, useT } from '@/i18n';
import * as haptics from '@/lib/haptics';
import { colors, font, radius, space } from '@/theme';

const LOG_STYLES: { value: LogStyle; labelKey: I18nKey }[] = [
  { value: 'weight-reps', labelKey: 'logStyle.weightReps' },
  { value: 'bodyweight', labelKey: 'logStyle.bodyweight' },
  { value: 'time', labelKey: 'logStyle.time' },
];

export default function Train() {
  const t = useT();
  const train = useTrain();

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <Text style={styles.title}>{t('nav.train')}</Text>
      {train.loading ? (
        <View style={styles.fill}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : train.active ? (
        <ActiveSession train={train} />
      ) : (
        <StartView train={train} />
      )}
    </SafeAreaView>
  );
}

// ─── Idle: start button + templates + history ───────────────────
function StartView({ train }: { train: ReturnType<typeof useTrain> }) {
  const t = useT();
  // null = closed; a template = edit it; {} = create new.
  const [editing, setEditing] = useState<WorkoutTemplate | Record<string, never> | null>(null);

  return (
    <ScrollView contentContainerStyle={styles.body}>
      {train.error ? <Text style={styles.error}>{t('train.loadErr')}</Text> : null}

      <TouchableOpacity
        style={styles.startBtn}
        onPress={() => {
          haptics.tap();
          train.startWorkout();
        }}
        testID="start-workout"
      >
        <Text style={styles.startBtnText}>{t('train.start')}</Text>
      </TouchableOpacity>

      <View style={styles.sectionHead}>
        <Text style={styles.sectionTitle}>{t('train.templates')}</Text>
        <TouchableOpacity onPress={() => setEditing({})} hitSlop={8} testID="new-template">
          <Text style={styles.sectionAction}>{t('train.newTemplate')}</Text>
        </TouchableOpacity>
      </View>
      {train.templates.length === 0 ? (
        <Text style={styles.empty}>{t('train.noTemplates')}</Text>
      ) : (
        <View style={styles.list}>
          {train.templates.map((tpl) => (
            <View key={tpl.id} style={styles.tplRow} testID={`template-${tpl.id}`}>
              <Pressable style={styles.tplMain} onPress={() => setEditing(tpl)} testID={`edit-template-${tpl.id}`}>
                <Text style={styles.histDate}>{tpl.name}</Text>
                <Text style={styles.histSub}>{templateSummary(tpl, t)}</Text>
              </Pressable>
              <TouchableOpacity
                style={styles.tplStart}
                onPress={() => {
                  haptics.tap();
                  train.startFromTemplate(tpl);
                }}
                testID={`start-template-${tpl.id}`}
              >
                <Text style={styles.tplStartText}>{t('train.startTpl')}</Text>
              </TouchableOpacity>
            </View>
          ))}
        </View>
      )}

      <Text style={styles.sectionTitle}>{t('train.history')}</Text>
      {train.recentSessions.length === 0 ? (
        <Text style={styles.empty}>{t('train.noWorkouts')}</Text>
      ) : (
        <View style={styles.list}>
          {train.recentSessions.map((s) => (
            <Pressable
              key={s.id}
              style={styles.histRow}
              testID={`session-${s.id}`}
              onLongPress={() => s.id && train.deleteSession(s.id)}
            >
              <View style={styles.histMain}>
                <Text style={styles.histDate}>
                  {s.date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}
                </Text>
                <Text style={styles.histSub}>{sessionSummary(s, t)}</Text>
              </View>
              {sessionVolume(s) > 0 ? <Text style={styles.histVol}>{sessionVolume(s).toLocaleString()} lb</Text> : null}
            </Pressable>
          ))}
        </View>
      )}

      <TemplateEditorModal
        visible={editing !== null}
        train={train}
        template={editing && 'id' in editing ? (editing as WorkoutTemplate) : null}
        onClose={() => setEditing(null)}
      />
    </ScrollView>
  );
}

function sessionSummary(s: WorkoutSession, t: TFn): string {
  const exCount = s.exercises.length;
  const setCount = s.exercises.reduce(
    (n, ex) => n + ex.sets.filter((set) => isLoggedSet(set, ex.logStyle ?? DEFAULT_LOG_STYLE)).length,
    0,
  );
  const ex = `${exCount} ${exCount === 1 ? t('train.exerciseOne') : t('train.exerciseMany')}`;
  const sets = `${setCount} ${setCount === 1 ? t('train.setOne') : t('train.setMany')}`;
  return `${ex} · ${sets}`;
}

function templateSummary(tpl: WorkoutTemplate, t: TFn): string {
  const exCount = tpl.exercises.length;
  const setCount = tpl.exercises.reduce((n, ex) => n + ex.plannedSets.length, 0);
  const ex = `${exCount} ${exCount === 1 ? t('train.exerciseOne') : t('train.exerciseMany')}`;
  const sets = `${setCount} ${setCount === 1 ? t('train.setOne') : t('train.setMany')}`;
  return `${ex} · ${sets}`;
}

// ─── Active session logger ──────────────────────────────────────
function ActiveSession({ train }: { train: ReturnType<typeof useTrain> }) {
  const t = useT();
  const session = train.active!;
  const [addOpen, setAddOpen] = useState(false);
  const [finishOpen, setFinishOpen] = useState(false);

  return (
    <>
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <View style={styles.activeBanner}>
          <Text style={styles.activeText}>{t('train.inProgress')}</Text>
          {train.saving ? <Text style={styles.savingText}>{t('common.saving')}</Text> : null}
        </View>

        {session.exercises.length === 0 ? (
          <Text style={styles.empty}>{t('train.addFirst')}</Text>
        ) : (
          session.exercises.map((ex, exIdx) => (
            <ExerciseCard key={`${ex.exerciseId}-${exIdx}`} train={train} exerciseIndex={exIdx} />
          ))
        )}

        <TouchableOpacity style={styles.addExBtn} onPress={() => setAddOpen(true)} testID="add-exercise">
          <Text style={styles.addExText}>{t('train.addExercise')}</Text>
        </TouchableOpacity>

        <View style={styles.footerBtns}>
          <TouchableOpacity style={styles.discardBtn} onPress={() => train.discardWorkout()} testID="discard-workout">
            <Text style={styles.discardText}>{t('train.discard')}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.finishBtn}
            onPress={async () => {
              await train.commitActive();
              setFinishOpen(true);
            }}
            testID="finish-workout"
          >
            <Text style={styles.finishText}>{t('train.finish')}</Text>
          </TouchableOpacity>
        </View>
        <View style={{ height: 40 }} />
      </ScrollView>

      <AddExerciseModal
        visible={addOpen}
        train={train}
        onClose={() => setAddOpen(false)}
      />
      <FinishModal
        visible={finishOpen}
        onClose={() => setFinishOpen(false)}
        onFinish={async (extras) => {
          await train.finishWorkout(extras);
          setFinishOpen(false);
        }}
      />
    </>
  );
}

function ExerciseCard({ train, exerciseIndex }: { train: ReturnType<typeof useTrain>; exerciseIndex: number }) {
  const t = useT();
  const ex = train.active!.exercises[exerciseIndex];
  const style = ex.logStyle ?? DEFAULT_LOG_STYLE;

  return (
    <View style={styles.exCard}>
      <View style={styles.exHead}>
        <Text style={styles.exName}>{ex.name}</Text>
        <TouchableOpacity onPress={() => train.removeExercise(exerciseIndex)} hitSlop={8}>
          <Text style={styles.exRemove}>{t('common.remove')}</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.setHeadRow}>
        <Text style={[styles.setHeadCell, styles.setNumCell]}>#</Text>
        {style === 'weight-reps' ? <Text style={[styles.setHeadCell, styles.setInputCell]}>{t('train.lb')}</Text> : null}
        {style === 'time' ? (
          <Text style={[styles.setHeadCell, styles.setInputCell]}>{t('train.sec')}</Text>
        ) : (
          <Text style={[styles.setHeadCell, styles.setInputCell]}>{t('train.reps')}</Text>
        )}
        <View style={styles.setDoneCell} />
      </View>

      {ex.sets.map((set, setIdx) => (
        <SetRow
          key={setIdx}
          train={train}
          exerciseIndex={exerciseIndex}
          setIndex={setIdx}
          set={set}
          logStyle={style}
          number={setIdx + 1}
        />
      ))}

      <TouchableOpacity style={styles.addSetBtn} onPress={() => train.addSet(exerciseIndex)} testID={`add-set-${exerciseIndex}`}>
        <Text style={styles.addSetText}>{t('train.addSet')}</Text>
      </TouchableOpacity>
    </View>
  );
}

function logStyleKey(style: LogStyle | undefined): I18nKey {
  return style === 'bodyweight' ? 'logStyle.bodyweight' : style === 'time' ? 'logStyle.time' : 'logStyle.weightReps';
}

function numOrUndef(s: string): number | undefined {
  const t = s.trim();
  if (t === '') return undefined;
  const n = Number(t);
  return Number.isFinite(n) ? n : undefined;
}

function SetRow({
  train,
  exerciseIndex,
  setIndex,
  set,
  logStyle,
  number,
}: {
  train: ReturnType<typeof useTrain>;
  exerciseIndex: number;
  setIndex: number;
  set: WorkoutSet;
  logStyle: LogStyle;
  number: number;
}) {
  // Local string buffers so partial decimal input binds cleanly; the parsed
  // value is pushed into the session state via editSet, persisted on blur.
  const [weight, setWeight] = useState(set.weight != null ? String(set.weight) : '');
  const [count, setCount] = useState(
    logStyle === 'time'
      ? set.durationSec != null ? String(set.durationSec) : ''
      : set.reps != null ? String(set.reps) : '',
  );

  const commit = () => train.commitActive();

  return (
    <View style={styles.setRow}>
      <Text style={[styles.setNumCell, styles.setNum]}>{number}</Text>

      {logStyle === 'weight-reps' ? (
        <TextInput
          style={[styles.setInput, styles.setInputCell]}
          placeholder="0"
          placeholderTextColor={colors.faint}
          keyboardType="numeric"
          value={weight}
          onChangeText={(t) => {
            setWeight(t);
            train.editSet(exerciseIndex, setIndex, { weight: numOrUndef(t) });
          }}
          onEndEditing={commit}
          testID={`set-weight-${exerciseIndex}-${setIndex}`}
        />
      ) : null}

      <TextInput
        style={[styles.setInput, styles.setInputCell]}
        placeholder="0"
        placeholderTextColor={colors.faint}
        keyboardType="numeric"
        value={count}
        onChangeText={(t) => {
          setCount(t);
          const v = numOrUndef(t);
          train.editSet(exerciseIndex, setIndex, logStyle === 'time' ? { durationSec: v } : { reps: v });
        }}
        onEndEditing={commit}
        testID={`set-count-${exerciseIndex}-${setIndex}`}
      />

      <TouchableOpacity
        style={[styles.setDoneCell, styles.doneBox, set.done && styles.doneBoxOn]}
        onPress={() => {
          haptics.tap();
          train.editSet(exerciseIndex, setIndex, { done: !set.done });
          train.commitActive();
        }}
        testID={`set-done-${exerciseIndex}-${setIndex}`}
      >
        <Text style={[styles.doneCheck, set.done && styles.doneCheckOn]}>✓</Text>
      </TouchableOpacity>

      <TouchableOpacity onPress={() => train.removeSet(exerciseIndex, setIndex)} hitSlop={6} style={styles.setDel}>
        <Text style={styles.setDelText}>✕</Text>
      </TouchableOpacity>
    </View>
  );
}

// ─── Add-exercise modal ─────────────────────────────────────────
function AddExerciseModal({
  visible,
  train,
  onClose,
}: {
  visible: boolean;
  train: ReturnType<typeof useTrain>;
  onClose: () => void;
}) {
  const t = useT();
  const [name, setName] = useState('');
  const [logStyle, setLogStyle] = useState<LogStyle>('weight-reps');

  useEffect(() => {
    if (visible) {
      setName('');
      setLogStyle('weight-reps');
    }
  }, [visible]);

  const trimmed = name.trim();
  const matches = trimmed
    ? train.catalog.filter((e) => e.name.toLowerCase().includes(trimmed.toLowerCase())).slice(0, 6)
    : train.catalog.slice(0, 8);

  async function add(exName: string, exLogStyle: LogStyle, exerciseId?: string) {
    haptics.tap();
    await train.addExerciseToActive(exName, exLogStyle, exerciseId);
    onClose();
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.sheetWrap}>
        <View style={styles.sheet}>
          <View style={styles.handle} />
          <Text style={styles.sheetTitle}>{t('train.addExerciseTitle')}</Text>

          <TextInput
            style={styles.input}
            placeholder={t('train.exerciseName')}
            placeholderTextColor={colors.faint}
            value={name}
            onChangeText={setName}
            autoFocus
            testID="exercise-name"
          />

          <View style={styles.styleRow}>
            {LOG_STYLES.map((ls) => {
              const on = logStyle === ls.value;
              return (
                <TouchableOpacity
                  key={ls.value}
                  style={[styles.styleChip, on && styles.styleChipOn]}
                  onPress={() => setLogStyle(ls.value)}
                  testID={`logstyle-${ls.value}`}
                >
                  <Text style={[styles.styleChipText, on && styles.styleChipTextOn]}>{t(ls.labelKey)}</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {trimmed ? (
            <TouchableOpacity style={styles.createRow} onPress={() => add(trimmed, logStyle)} testID="create-exercise">
              <Text style={styles.createText}>{t('train.addNamed', { name: trimmed })}</Text>
            </TouchableOpacity>
          ) : null}

          <ScrollView style={styles.catalogList} keyboardShouldPersistTaps="handled">
            {matches.map((e) => (
              <TouchableOpacity
                key={e.id}
                style={styles.catalogRow}
                onPress={() => add(e.name, e.logStyle ?? 'weight-reps', e.id)}
              >
                <Text style={styles.catalogName}>{e.name}</Text>
                <Text style={styles.catalogStyle}>{t(logStyleKey(e.logStyle))}</Text>
              </TouchableOpacity>
            ))}
            {matches.length === 0 ? (
              <Text style={styles.empty}>{t('train.noSaved')}</Text>
            ) : null}
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ─── Finish modal ───────────────────────────────────────────────
function FinishModal({
  visible,
  onFinish,
  onClose,
}: {
  visible: boolean;
  onFinish: (extras: { bodyweight?: number; sleepHours?: number }) => Promise<void> | void;
  onClose: () => void;
}) {
  const t = useT();
  const [bodyweight, setBodyweight] = useState('');
  const [sleep, setSleep] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (visible) {
      setBodyweight('');
      setSleep('');
      setBusy(false);
    }
  }, [visible]);

  async function finish() {
    if (busy) return;
    setBusy(true);
    try {
      await onFinish({ bodyweight: numOrUndef(bodyweight), sleepHours: numOrUndef(sleep) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.sheetWrap}>
        <View style={styles.sheet}>
          <View style={styles.handle} />
          <Text style={styles.sheetTitle}>{t('train.finishTitle')}</Text>
          <Text style={styles.sheetHint}>{t('train.finishHint')}</Text>

          <View style={styles.finishRow}>
            <View style={styles.finishField}>
              <Text style={styles.fieldLabel}>{t('train.bodyweight')}</Text>
              <TextInput
                style={styles.input}
                placeholder="—"
                placeholderTextColor={colors.faint}
                keyboardType="numeric"
                value={bodyweight}
                onChangeText={setBodyweight}
                testID="finish-bodyweight"
              />
            </View>
            <View style={styles.finishField}>
              <Text style={styles.fieldLabel}>{t('train.sleepH')}</Text>
              <TextInput
                style={styles.input}
                placeholder="—"
                placeholderTextColor={colors.faint}
                keyboardType="numeric"
                value={sleep}
                onChangeText={setSleep}
                testID="finish-sleep"
              />
            </View>
          </View>

          <TouchableOpacity style={styles.finishBtn} onPress={finish} disabled={busy} testID="finish-confirm">
            <Text style={styles.finishText}>{busy ? t('common.saving') : t('train.complete')}</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ─── Template editor ────────────────────────────────────────────
interface DraftEx {
  exerciseId: string;
  name: string;
  logStyle: LogStyle;
  targetLoad: string; // string buffer; parsed on save
  setCount: number;
}

function TemplateEditorModal({
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
  const [name, setName] = useState('');
  const [notes, setNotes] = useState('');
  const [exercises, setExercises] = useState<DraftEx[]>([]);
  const [exName, setExName] = useState('');
  const [exStyle, setExStyle] = useState<LogStyle>('weight-reps');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setName(template?.name ?? '');
    setNotes(template?.notes ?? '');
    setExercises(
      (template?.exercises ?? []).map((ex) => ({
        exerciseId: ex.exerciseId,
        name: ex.name,
        logStyle: ex.logStyle ?? 'weight-reps',
        targetLoad: ex.targetLoad != null ? String(ex.targetLoad) : '',
        setCount: Math.max(1, ex.plannedSets.length),
      })),
    );
    setExName('');
    setExStyle('weight-reps');
    setBusy(false);
  }, [visible, template]);

  const trimmedEx = exName.trim();
  const matches = trimmedEx
    ? train.catalog.filter((e) => e.name.toLowerCase().includes(trimmedEx.toLowerCase())).slice(0, 5)
    : [];

  function appendEx(exercise: Pick<DraftEx, 'exerciseId' | 'name' | 'logStyle'>) {
    setExercises((prev) => [...prev, { ...exercise, targetLoad: '', setCount: 3 }]);
    setExName('');
  }

  function addFromCatalog(c: Exercise) {
    haptics.tap();
    appendEx({ exerciseId: c.id!, name: c.name, logStyle: c.logStyle ?? 'weight-reps' });
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

  const canSave = name.trim().length > 0 && !busy;

  async function save() {
    if (!canSave) return;
    setBusy(true);
    try {
      const draft: TemplateDraft = {
        name: name.trim(),
        notes: notes.trim() || undefined,
        exercises: exercises.map((d) => ({
          exerciseId: d.exerciseId,
          name: d.name,
          logStyle: d.logStyle,
          targetLoad: numOrUndef(d.targetLoad),
          plannedSets: Array.from({ length: Math.max(1, d.setCount) }, () => ({ kind: 'working' as const })),
        })),
      };
      await train.saveTemplate(draft, template?.id);
      onClose();
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
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.sheetWrap}>
        <View style={styles.sheet}>
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

            <Text style={[styles.fieldLabel, { marginTop: space.md }]}>{t('train.templateExercises')}</Text>
            {exercises.length === 0 ? (
              <Text style={styles.empty}>{t('train.templateNoEx')}</Text>
            ) : (
              exercises.map((d, i) => (
                <View key={`${d.exerciseId}-${i}`} style={styles.tplExRow}>
                  <View style={styles.tplExMain}>
                    <Text style={styles.tplExName}>{d.name}</Text>
                    <Text style={styles.tplExMeta}>{t(logStyleKey(d.logStyle))}</Text>
                  </View>
                  {d.logStyle !== 'bodyweight' ? (
                    <TextInput
                      style={styles.tplLoadInput}
                      placeholder={t('train.target')}
                      placeholderTextColor={colors.faint}
                      keyboardType="numeric"
                      value={d.targetLoad}
                      onChangeText={(v) => patchEx(i, { targetLoad: v })}
                      testID={`template-load-${i}`}
                    />
                  ) : null}
                  <View style={styles.stepper}>
                    <TouchableOpacity
                      style={styles.stepBtn}
                      onPress={() => patchEx(i, { setCount: Math.max(1, d.setCount - 1) })}
                      testID={`template-set-minus-${i}`}
                    >
                      <Text style={styles.stepBtnText}>−</Text>
                    </TouchableOpacity>
                    <Text style={styles.stepCount}>{d.setCount}</Text>
                    <TouchableOpacity
                      style={styles.stepBtn}
                      onPress={() => patchEx(i, { setCount: Math.min(20, d.setCount + 1) })}
                      testID={`template-set-plus-${i}`}
                    >
                      <Text style={styles.stepBtnText}>+</Text>
                    </TouchableOpacity>
                  </View>
                  <TouchableOpacity onPress={() => removeEx(i)} hitSlop={6} style={styles.setDel}>
                    <Text style={styles.setDelText}>✕</Text>
                  </TouchableOpacity>
                </View>
              ))
            )}

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
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.paper },
  title: { fontSize: font.h1, fontWeight: '800', color: colors.ink, paddingHorizontal: space.xl, paddingTop: space.md },
  fill: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  body: { padding: space.xl, gap: space.md },
  error: { color: colors.danger, fontSize: font.small },
  empty: { fontSize: font.small, color: colors.muted },
  sectionTitle: { fontSize: font.h3, fontWeight: '700', color: colors.ink, marginTop: space.sm },
  startBtn: { backgroundColor: colors.ink, borderRadius: radius.md, paddingVertical: space.lg, alignItems: 'center' },
  startBtnText: { color: colors.white, fontWeight: '700', fontSize: font.h3 },
  list: { gap: space.sm },
  histRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.card,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.line,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
  },
  histMain: { gap: 2 },
  histDate: { fontSize: font.body, fontWeight: '700', color: colors.ink },
  histSub: { fontSize: font.small, color: colors.muted },
  histVol: { fontSize: font.small, fontWeight: '700', color: colors.ink },
  // active
  activeBanner: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  activeText: { fontSize: font.small, color: colors.accent, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
  savingText: { fontSize: font.tiny, color: colors.faint },
  exCard: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.line,
    padding: space.lg,
    gap: space.xs,
  },
  exHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: space.xs },
  exName: { fontSize: font.body, fontWeight: '700', color: colors.ink, flex: 1 },
  exRemove: { fontSize: font.tiny, color: colors.danger, fontWeight: '700', textTransform: 'uppercase' },
  setHeadRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  setHeadCell: { fontSize: font.tiny, color: colors.muted, fontWeight: '600', textTransform: 'uppercase' },
  setRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  setNumCell: { width: 20 },
  setNum: { fontSize: font.small, color: colors.muted, fontWeight: '600' },
  setInputCell: { width: 70, textAlign: 'center' },
  setInput: {
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.sm,
    paddingVertical: space.sm,
    fontSize: font.body,
    color: colors.ink,
  },
  setDoneCell: { width: 32, alignItems: 'center' },
  doneBox: {
    width: 30,
    height: 30,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.line,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.white,
  },
  doneBoxOn: { backgroundColor: colors.ink, borderColor: colors.ink },
  doneCheck: { color: colors.line, fontWeight: '800' },
  doneCheckOn: { color: colors.white },
  setDel: { paddingHorizontal: space.xs },
  setDelText: { color: colors.danger, fontSize: font.small, fontWeight: '700' },
  addSetBtn: { paddingVertical: space.sm },
  addSetText: { fontSize: font.small, color: colors.accent, fontWeight: '700' },
  addExBtn: {
    borderWidth: 1,
    borderColor: colors.line,
    borderStyle: 'dashed',
    borderRadius: radius.md,
    paddingVertical: space.md,
    alignItems: 'center',
    backgroundColor: colors.white,
  },
  addExText: { fontSize: font.small, color: colors.muted, fontWeight: '600' },
  footerBtns: { flexDirection: 'row', gap: space.md, marginTop: space.sm },
  discardBtn: {
    paddingHorizontal: space.lg,
    paddingVertical: space.lg,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.danger,
    alignItems: 'center',
  },
  discardText: { color: colors.danger, fontWeight: '700', fontSize: font.body },
  finishBtn: { flex: 1, backgroundColor: colors.ink, borderRadius: radius.md, paddingVertical: space.lg, alignItems: 'center' },
  finishText: { color: colors.white, fontWeight: '700', fontSize: font.h3 },
  // modal
  backdrop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.35)' },
  sheetWrap: { flex: 1, justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.paper,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    paddingHorizontal: space.xl,
    paddingTop: space.md,
    paddingBottom: space.xxl,
    gap: space.sm,
    maxHeight: '80%',
  },
  handle: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: colors.line, marginBottom: space.sm },
  sheetTitle: { fontSize: font.h2, fontWeight: '800', color: colors.ink },
  sheetHint: { fontSize: font.small, color: colors.muted },
  input: {
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    paddingVertical: space.md,
    fontSize: font.body,
    color: colors.ink,
  },
  styleRow: { flexDirection: 'row', gap: space.sm },
  styleChip: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    paddingVertical: space.sm,
    alignItems: 'center',
    backgroundColor: colors.white,
  },
  styleChipOn: { backgroundColor: colors.ink, borderColor: colors.ink },
  styleChipText: { fontSize: font.tiny, color: colors.muted, fontWeight: '600' },
  styleChipTextOn: { color: colors.white },
  createRow: { paddingVertical: space.sm },
  createText: { fontSize: font.body, color: colors.accent, fontWeight: '700' },
  catalogList: { maxHeight: 220 },
  catalogRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: space.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  catalogName: { fontSize: font.body, color: colors.ink, fontWeight: '600' },
  catalogStyle: { fontSize: font.tiny, color: colors.muted },
  finishRow: { flexDirection: 'row', gap: space.md },
  finishField: { flex: 1, gap: space.xs },
  fieldLabel: { fontSize: font.small, color: colors.muted, fontWeight: '600' },
  // templates
  sectionHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: space.sm,
  },
  sectionAction: { fontSize: font.small, color: colors.accent, fontWeight: '700' },
  tplRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    backgroundColor: colors.card,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.line,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
  },
  tplMain: { flex: 1, gap: 2 },
  tplStart: {
    backgroundColor: colors.ink,
    borderRadius: radius.sm,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
  },
  tplStartText: { color: colors.white, fontWeight: '700', fontSize: font.small },
  // template editor
  notesInput: { minHeight: 56, textAlignVertical: 'top' },
  tplExRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingVertical: space.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  tplExMain: { flex: 1, gap: 2 },
  tplExName: { fontSize: font.body, color: colors.ink, fontWeight: '600' },
  tplExMeta: { fontSize: font.tiny, color: colors.muted },
  tplLoadInput: {
    width: 56,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.sm,
    paddingVertical: space.xs,
    textAlign: 'center',
    fontSize: font.small,
    color: colors.ink,
  },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  stepBtn: {
    width: 28,
    height: 28,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.line,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.white,
  },
  stepBtnText: { fontSize: font.body, color: colors.ink, fontWeight: '700' },
  stepCount: { width: 20, textAlign: 'center', fontSize: font.small, color: colors.ink, fontWeight: '700' },
  editorBtns: { flexDirection: 'row', gap: space.md, marginTop: space.lg },
  btnDisabled: { opacity: 0.4 },
});
