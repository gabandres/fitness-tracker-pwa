import Ionicons from '@expo/vector-icons/Ionicons';
import { memo, type ReactNode, useEffect, useMemo, useState } from 'react';
import { FlatList, Pressable, ScrollView, Text, View, useWindowDimensions } from 'react-native';
import { TRAIN_RIPPLE, Touchable } from './Touchable';
import Animated from 'react-native-reanimated';
import {
  dayBoundaryOf,
  formatBodyWeight,
  formatLoad,
  muscleSignals,
  nextTemplateUp,
  sessionCounts,
  sessionVolume,
  templateLastPerformed,
  trailingAverageLb,
  type TemplateDraftDoc,
  trainHeroStats,
  type VolumeCall,
  volumeCalls,
  volumeGateMet,
  weeklyClusterAudit,
} from '@macrolog/core';
import { DEFAULT_TRAINING_PHASE } from '@macrolog/core/workout';
import { CONTEXT_MENUS, ContextMenu } from '@/components/ContextMenu';
import { BottomSheet, NATIVE_SHEETS } from '@/components/BottomSheet';
import { SheetHeader } from '@/components/SheetHeader';
import { confirm } from '@/components/ConfirmSheet';
import { OfflineBanner } from '@/components/OfflineBanner';
import { ExerciseLibrarySheet } from '@/components/train/ExerciseLibrarySheet';
import { ExerciseMenuSheet, type ExerciseMenuAction } from '@/components/train/ExerciseMenuSheet';
import { MenuButton } from '@/components/MenuButton';
import { LiftSettingsSheet } from '@/components/train/LiftSettingsSheet';
import { NextUpCard } from '@/components/train/NextUpCard';
import { RecommendationNote } from '@/components/train/RecommendationNote';
import { TemplateEditorModal } from '@/components/train/TemplateEditorModal';
import type { TrainState } from '@/hooks/useTrain';
import { type I18nKey, type Locale, type TFn, useLocale, useT } from '@/i18n';
import { useAuth } from '@/lib/auth';
import { readCache } from '@/lib/offline-cache';
import { formatDate } from '@/lib/date-format';
import * as haptics from '@/lib/haptics';
import { CountUpText, enterUp, rippleClip, type usePulse } from '@/lib/motion';
import { showToast } from '@/components/Toast';
import { captureError } from '@/lib/sentry';
import { useTheme, useThemedStyles } from '@/lib/theme-context';
import { useUnitSystem } from '@/lib/use-unit-system';
import type { Exercise, TrainingPhase, WorkoutSession, WorkoutTemplate } from '@/lib/workout';
import { space } from '@/theme';
import { recommendationText } from './recommendation-text';
import { WeeklyVolumeSheet } from './WeeklyVolumeSheet';
import { DraftsSection, useDraftActions } from './DraftsSection';
import { ExerciseDetailSheet } from './ExerciseDetailSheet';
import { toMenuButtonActions } from './exercise-menu-native';
import { SessionDetailSheet } from './SessionDetailSheet';
import { setCountText } from './template-draft';
import { StarterTemplatesSheet } from './StarterTemplatesSheet';
import { logStyleKey } from './train-shared';
import {
  countsLine,
  recommendationFor,
  sessionSummary,
  setLine,
  templateExerciseNames,
  templateSummary,
} from './train-summary';
import { createStyles } from './train-styles';

/** History rows shown inline before "Show all" (Train review item 32): the
 *  list rendered every one of the 50 loaded sessions, every visit. */
const HISTORY_INLINE = 10;
/** Catalog rows shown inline before "Browse all" — the rest live in the
 *  library sheet. */
const CATALOG_INLINE = 5;

/** A sheet closing hands off to the screen after it has gone — a native
 *  sheet must be dismissed by an owner that is still mounted, and reopening a
 *  workout unmounts this screen. */
const afterSheet = (run: () => void) => {
  if (NATIVE_SHEETS) setTimeout(run, 350);
  else run();
};

/** From this font scale a template card stacks: its exercise names wrap in
 *  full and Start takes its own row under them — the same step at which
 *  `SheetHeader` stacks (train-ux H-N10). */
const CARD_STACK_FONT_SCALE = 1.6;

/**
 * The one tag a template wears, on its card AND on Next up. They used two
 * rules — Next up any superset row, the card only an active superset draft —
 * so one template read SUPERSETS in the hero and nothing on its own card
 * (train-ux H-N7). A superset draft names when it went on; a Program v2 draft
 * says so; a template built with supersets says that.
 */
function templateTag(
  tpl: WorkoutTemplate,
  drafts: readonly TemplateDraftDoc[],
  t: TFn,
  locale: Locale,
): { kind: 'supersets' | 'program'; text: string } | null {
  const active = drafts.filter((d) => d.status === 'active' && d.draftOf === tpl.id);
  const superset = active.find((d) => !d.program);
  const day = (at: string) => formatDate(new Date(at), locale, { month: 'short', day: 'numeric' });
  if (superset) {
    return { kind: 'supersets', text: superset.activatedAt ? t('train.drafts.activeSince', { date: day(superset.activatedAt) }) : t('train.drafts.activeTag') };
  }
  const program = active.find((d) => d.program === 'v2');
  if (program) {
    return { kind: 'program', text: program.activatedAt ? t('train.program.since', { date: day(program.activatedAt) }) : t('train.program.tag') };
  }
  if (tpl.exercises.some((e) => e.supersetGroup != null)) return { kind: 'supersets', text: t('train.drafts.activeTag') };
  return null;
}

// ─── Idle: hero summary + start button + templates + history ────
export function StartView({
  train,
  heroPulse,
  onRetry,
  onShare,
  header,
}: {
  train: TrainState;
  heroPulse: ReturnType<typeof usePulse>[0];
  onRetry: () => void;
  /** Share one logged workout as an image (the screen owns the capture). */
  onShare: (s: WorkoutSession) => void;
  /** The screen's title row, when it should scroll away with the content
   *  rather than stay pinned — accessibility text sizes (train-ux H-N11). */
  header?: ReactNode;
}) {
  const t = useT();
  const locale = useLocale();
  const styles = useThemedStyles(createStyles);
  const { colors } = useTheme();
  const unitSystem = useUnitSystem();
  // null = closed; a template = edit it; {} = create new.
  const [editing, setEditing] = useState<WorkoutTemplate | Record<string, never> | null>(null);
  const [detailEx, setDetailEx] = useState<Exercise | null>(null);
  const [startersOpen, setStartersOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false);
  // The read-only detail of one logged workout. The session is KEPT after the
  // sheet closes so its content does not blank mid-animation.
  const [detail, setDetail] = useState<WorkoutSession | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const openDetail = (s: WorkoutSession) => {
    setDetail(s);
    setDetailOpen(true);
  };
  // The cluster audit is a six-chip block that used to sit ABOVE the primary
  // action. Collapsed to its one-line verdict, with the chips one tap away.
  const [auditOpen, setAuditOpen] = useState(false);
  const [volumeOpen, setVolumeOpen] = useState(false);
  /**
   * ONE render clock for the three windows below.
   *
   * `trainHeroStats`, `weeklyClusterAudit` and `nextTemplateUp` all take `now`
   * as a parameter so their windows are testable — core's rule, not a choice
   * here. Pinned to a LAZY `useState` initializer so it is read once per mount:
   * a day window does not need to move while the user scrolls, and re-reading
   * it would invalidate every memo on every render.
   */
  const [now] = useState(() => Date.now());
  const stats = useMemo(
    () => trainHeroStats(train.recentSessions, now),
    [train.recentSessions, now],
  );
  // Weekly volume in CLUSTERS (progression engine layer 5) — the rest-pause
  // range is 2-6 per muscle per week, and a cluster counts once, never as
  // the three sets it replaces.
  const audit = useMemo(
    () => weeklyClusterAudit(train.recentSessions, train.catalog, now),
    [train.recentSessions, train.catalog, now],
  );
  // Whether to add a cluster, per muscle — never in a cut (recovery first),
  // otherwise at most one, on a stalled main lift or an all-progressing
  // fortnight (`volumeCalls`). The app says so; it never adds one itself.
  const { user, profile } = useAuth();
  const phase = profile?.trainingPhase ?? DEFAULT_TRAINING_PHASE;
  const calls = useMemo(
    () => volumeCalls(audit, phase, muscleSignals(train.recentSessions, train.catalog, now)),
    [audit, phase, train.recentSessions, train.catalog, now],
  );
  const gateLb = profile?.volumeGateLb;
  // What the week PLANS: the program's templates when there is one (each
  // done once a week), else every template.
  const plannedTemplates = useMemo(() => {
    const ids = new Set(train.drafts.filter((d) => d.program === 'v2').map((d) => d.draftOf));
    return ids.size ? train.templates.filter((tp) => tp.id && ids.has(tp.id)) : train.templates;
  }, [train.drafts, train.templates]);
  // Whether the week PLANS anything the by-muscle sheet counts — a myo-rep
  // cluster or a working set. The link shows only when there is something to
  // count, logged or planned: it was once a home-screen link to twelve rows
  // of zeros, forever (train-ux H1/X2/J3). Since S23-13 the sheet counts hard
  // sets too, so a straight-set lifter gets it as well.
  const plansVolume = useMemo(
    () => plannedTemplates.some((tp) => tp.exercises.some((e) => e.plannedSets?.some((x) => x.kind === 'activation' || x.kind === 'working'))),
    [plannedTemplates],
  );
  // The 7-day average for the volume gate, from the weigh-ins Today already
  // keeps on disk — ONE cache read when a gate is set, never a listener
  // (ADR-0016: Train does not subscribe to weights for one line of text).
  // Null when the cache holds fewer than two readings in the week; the line
  // then omits the average and reads "not yet".
  const [sevenDayAvgLb, setSevenDayAvgLb] = useState<number | null>(null);
  const uid = user?.uid;
  // Keyed on the profile's own `dayBoundary` and derived from it in the
  // effect. It used a per-render `dayBoundaryOf(profile)` under an
  // eslint-disable (the object is rebuilt every render; the hour is what
  // matters), and the disable alone made React Compiler skip the whole view.
  const dayBoundary = profile?.dayBoundary;
  useEffect(() => {
    if (!uid || gateLb == null) return;
    let cancelled = false;
    void readCache<Record<string, number>>(uid, 'weights').then((weights) => {
      if (cancelled || !weights) return;
      setSevenDayAvgLb(trailingAverageLb(weights, 7, new Date(now), dayBoundaryOf({ dayBoundary }))?.avgLb ?? null);
    });
    return () => {
      cancelled = true;
    };
  }, [uid, gateLb, now, dayBoundary]);
  const [nextOpen, setNextOpen] = useState<string | null>(null);
  // Which template to offer, and when each was last completed. Both are pure
  // and live in core (`train-plan.ts`); this screen only renders them.
  const nextUp = useMemo(
    () => nextTemplateUp(train.templates, train.recentSessions, now),
    [train.templates, train.recentSessions, now],
  );
  const lastByTemplate = useMemo(
    () => templateLastPerformed(train.recentSessions),
    [train.recentSessions],
  );

  function confirmDeleteSession(id: string, s: WorkoutSession) {
    // Long-press used to delete a logged workout outright — undiscoverable
    // AND unconfirmed, on the one surface where the data cannot be recovered.
    // The body names the workout and what goes with it — "Upper A · Fri, Aug
    // 7 (3 exercises · 12 sets)" — not just a date (train-ux H10, R43).
    confirm({
      title: t('train.deleteSessionTitle'),
      body: t('train.deleteSessionBody', { name: sessionLabel(s), sets: countsLine(sessionCounts(s), t) }),
      confirmText: t('train.delete'),
      destructive: true,
      onConfirm: () => {
        // `deleteSession` does not catch: an unhandled rejection here reached
        // Sentry as a crash and told the user nothing.
        train.deleteSession(id).catch((e) => {
          haptics.warning();
          captureError(e, { where: 'train.deleteSession' });
        });
      },
    });
  }

  const sessionLabel = (s: WorkoutSession) =>
    [s.templateName || t('train.workout'), formatDate(s.date, locale, { weekday: 'short', month: 'short', day: 'numeric' })].join(' · ');

  return (
    <ScrollView contentContainerStyle={styles.body} testID="train-start-scroll">
      {/* Outside the body's padding, so the row sits where the pinned one did. */}
      {header ? <View style={{ marginHorizontal: -space.xl, marginTop: -space.xl }}>{header}</View> : null}
      {train.error ? (
        <View style={styles.errorRow} accessibilityRole="alert" accessibilityLiveRegion="polite">
          {/* A failed write is not a failed load: the tab still has its data
              and "Retry" means something different for each. */}
          <Text style={[styles.error, { flex: 1 }]}>
            {train.errorKind === 'save' ? t('train.workoutSaveErr') : t('train.loadErr')}
          </Text>
          {/* A save error here has nothing to retry — no workout is open, and
              the write that failed (a template, a delete) is not replayable
              from this screen — so it says Dismiss, which is what it does
              (Train re-score bug 7). A load error really is retried. */}
          <Touchable
            onPress={train.errorKind === 'save' ? train.clearError : onRetry}
            style={styles.errorBtn}
            accessibilityRole="button"
            testID="retry"
          >
            <Text style={styles.discardText}>
              {train.errorKind === 'save' ? t('common.dismiss') : t('common.retry')}
            </Text>
          </Touchable>
        </View>
      ) : null}

      {/* A state readout, same slot it has on Today (UX_AUDIT S18-12). */}
      <OfflineBanner />

      {/* Hero panel — the Today skeleton (ADR-0014 §7): workouts this week is
          the one big number; volume + top set live inside as chips. */}
      <Animated.View entering={enterUp(0)}>
        <Animated.View style={[styles.heroPanel, heroPulse]} testID="train-hero">
          {/* A rolling window, named as one: it said "This week" over
              `now - 7 days` (train-ux H-N5), as Trends did until it changed. */}
          <Text style={styles.heroCaption} accessibilityRole="header">{t('train.last7Days')}</Text>
          <View style={styles.hero}>
            <CountUpText
              value={stats.count}
              style={styles.heroValue}
              accessibilityLabel={`${stats.count} ${stats.count === 1 ? t('train.workoutUnit') : t('train.workoutsUnit')}`}
              testID="week-workouts"
            />
            {/* Capped like the number beside it (CountUpText, 1.4×): at AX5 the
                uncapped word reached ~62 pt in a row that does not wrap
                (train-ux H11). Trends caps the same element. */}
            <Text style={styles.heroUnit} maxFontSizeMultiplier={1.4} numberOfLines={1}>
              {stats.count === 1 ? t('train.workoutUnit') : t('train.workoutsUnit')}
            </Text>
          </View>
          {stats.count === 0 ? (
            <Text style={styles.heroHint}>{t('train.weekEmpty')}</Text>
          ) : (
            <View style={styles.heroChips}>
              {stats.volume > 0 ? (
                <Text style={styles.trendChip}>
                  {t('train.weekVolume')}  <Text style={styles.trendChipValue}>{formatLoad(stats.volume, unitSystem, 0)}</Text>
                </Text>
              ) : null}
              {/* The week's heaviest working set AND whose it was: a bare
                  "Top set 235 lb" did not say which lift, and it was the
                  all-time number inside a 7-day panel (train-ux H-N4). */}
              {stats.topSet ? (
                <Text style={styles.trendChip} testID="hero-top-set">
                  {t('train.topSet')} · {stats.topSet.name}  <Text style={styles.trendChipValue}>{formatLoad(stats.topSet.weight, unitSystem, 0)}</Text>
                </Text>
              ) : null}
            </View>
          )}
        </Animated.View>
      </Animated.View>

      {/* The one question a training home screen exists to answer. The
          full-width primary here used to be "Start workout", which starts an
          EMPTY session — the rarest path anyone takes, given the most
          prominent control on the tab. */}
      {nextUp ? (
        <NextUpCard
          next={nextUp}
          tag={templateTag(nextUp.template, train.drafts, t, locale)?.text}
          onStart={() => train.startFromTemplate(nextUp.template)}
          onEdit={() => setEditing(nextUp.template)}
        />
      ) : (
        // The ONE "no templates yet" on the screen: the Templates section
        // below printed the same sentence a second time (Train review item 10).
        <View style={styles.nextCard} testID="next-up-empty">
          <Text style={styles.nextCaption} accessibilityRole="header">{t('train.nextUp')}</Text>
          <Text style={styles.nextMeta}>{t('train.noTemplates')}</Text>
          <Touchable
            style={styles.startBtn}
            onPress={() => setStartersOpen(true)}
            accessibilityRole="button"
            testID="next-up-starters"
          >
            <Text style={styles.startBtnText}>{t('train.starters')}</Text>
          </Touchable>
          {/* The other way in, beside the starters (J4): someone who already
              has a plan should not have to clone one to delete it. */}
          <Touchable
            style={[styles.textAction, { alignSelf: 'center' }]}
            onPress={() => setEditing({})}
            accessibilityRole="button"
            testID="next-up-build-own"
          >
            <Text style={styles.sectionAction}>{t('train.buildOwn')}</Text>
          </Touchable>
        </View>
      )}

      {/* Demoted, not removed. An empty session and a bare run are both real
          things to want; neither is what you came to the tab to do. "Log a
          run" is the cardio-only start the hook had and nothing called
          (Train review item 8, ADR-0025). */}
      <View style={styles.secondaryRow}>
        <Touchable
          style={styles.secondaryBtn}
          onPress={() => {
            haptics.tap();
            void train.startWorkout();
          }}
          accessibilityRole="button"
          testID="start-workout"
        >
          <Text style={styles.secondaryLink}>{t('train.startEmpty')}</Text>
        </Touchable>
        <Touchable
          style={styles.secondaryBtn}
          onPress={() => {
            haptics.tap();
            void train.startCardioWorkout('run');
          }}
          accessibilityRole="button"
          testID="start-run"
        >
          <Text style={styles.secondaryLink}>{t('train.logRun')}</Text>
        </Touchable>
      </View>

      {audit.clusters > 0 ? (
        <View style={styles.auditWrap} testID="cluster-audit">
          <Touchable
            style={styles.auditLine}
            onPress={() => setAuditOpen((o) => !o)}
            accessibilityRole="button"
            accessibilityState={{ expanded: auditOpen }}
            testID="cluster-audit-toggle"
          >
            <Text style={styles.auditTitle}>{t('train.audit.title')}</Text>
            <Text style={styles.auditLineText}>
              {'  '}
              {t('train.audit.summary', {
                n: audit.clusters,
                inRange: audit.muscles.filter((m) => m.status === 'in-range').length,
                total: audit.muscles.length,
              })}
            </Text>
            <Ionicons name={auditOpen ? 'chevron-up' : 'chevron-down'} size={16} color={colors.faint} />
          </Touchable>
          {auditOpen ? (
            <>
              <View style={styles.auditRow}>
                {audit.muscles.map((m) => (
                  <View
                    key={m.muscle}
                    style={[styles.auditChip, m.status !== 'in-range' && styles.auditChipOff]}
                    testID={`cluster-audit-${m.muscle}`}
                  >
                    <Text style={styles.auditMuscle}>{t(`train.muscle.${m.muscle}` as I18nKey)}</Text>
                    <Text style={styles.auditCount}>
                      {m.clusters} · {t(m.status === 'below' ? 'train.audit.below' : m.status === 'above' ? 'train.audit.above' : 'train.audit.inRange')}
                    </Text>
                  </View>
                ))}
              </View>
              <Text style={styles.auditHint}>
                {audit.unattributed.length > 0
                  ? t('train.audit.unattributed', { names: audit.unattributed.join(', ') })
                  : t('train.audit.hint')}
              </Text>
              <VolumeCalls
                phase={phase}
                calls={calls}
                gateLb={gateLb}
                sevenDayAvgLb={sevenDayAvgLb}
              />
            </>
          ) : null}
        </View>
      ) : null}
      {/* This week by muscle — hard sets or myo-rep clusters (primary 1.0,
          secondary 0.5) beside the plan, and each session's totals; reachable
          on an empty week too when the plan has work, where it says so. */}
      {audit.clusters > 0 || audit.straightSets > 0 || plansVolume ? (
        <Touchable
          style={styles.textAction}
          onPress={() => setVolumeOpen(true)}
          accessibilityRole="button"
          testID="weekly-volume-open"
        >
          <Ionicons name="stats-chart-outline" size={16} color={colors.teal} />
          <Text style={styles.sectionAction}>{t('train.volume.open')}</Text>
        </Touchable>
      ) : null}
      <WeeklyVolumeSheet
        visible={volumeOpen}
        onClose={() => setVolumeOpen(false)}
        sessions={train.recentSessions}
        catalog={train.catalog}
        templates={plannedTemplates}
        now={now}
      />

      <View style={styles.sectionHead}>
        <Text style={styles.sectionTitle} accessibilityRole="header">{t('train.templates')}</Text>
        <View style={styles.sectionActions}>
          <Touchable
            style={styles.textAction}
            onPress={() => setStartersOpen(true)}
            accessibilityRole="button"
            testID="browse-starters"
          >
            <Text style={styles.sectionAction}>{t('train.starters')}</Text>
          </Touchable>
          <Touchable
            style={styles.textAction}
            onPress={() => setEditing({})}
            accessibilityRole="button"
            accessibilityLabel={t('train.newTemplateTitle')}
            testID="new-template"
          >
            <Ionicons name="add" size={18} color={colors.teal} />
            <Text style={styles.sectionAction}>{t('train.newTemplate')}</Text>
          </Touchable>
        </View>
      </View>
      {train.templates.length > 0 ? (
        <View style={styles.list}>
          {train.templates.map((tpl) => (
            <TemplateCard
              key={tpl.id}
              tpl={tpl}
              last={tpl.id ? lastByTemplate[tpl.id] : undefined}
              open={nextOpen === tpl.id}
              train={train}
              onEdit={setEditing}
              onToggleNext={(id) => setNextOpen((cur) => (cur === id ? null : id))}
            />
          ))}
        </View>
      ) : null}

      <DraftsSection train={train} />

      {/* The catalog: a few rows inline, the rest in the library sheet (Train
          review item 32). Above History, not under it: each lift's records and
          e1RM trend are the progress view, and ten history rows buried them
          at the very bottom of the tab (train-ux J16). The inline rows are also the fallback if the
          revived sheet misbehaves on a device — see `ExerciseLibrarySheet`. */}
      {train.catalog.length ? (
        <>
          <View style={styles.sectionHead}>
            <Text style={styles.sectionTitle} accessibilityRole="header">{t('train.exercises')}</Text>
            {train.catalog.length > CATALOG_INLINE ? (
              <Touchable
                style={styles.textAction}
                onPress={() => setLibraryOpen(true)}
                accessibilityRole="button"
                testID="browse-exercises"
              >
                <Text style={styles.sectionAction}>{t('train.browseExercises', { n: train.catalog.length })}</Text>
              </Touchable>
            ) : null}
          </View>
          <View style={styles.list}>
            {train.catalog.slice(0, CATALOG_INLINE).map((e) => (
              <Pressable
                key={e.id}
                style={[styles.exLibRow, rippleClip(styles.exLibRow)]}
                android_ripple={TRAIN_RIPPLE}
                onPress={() => setDetailEx(e)}
                accessibilityRole="button"
                testID={`exercise-${e.id}`}
              >
                <Text style={styles.histDate}>{e.name}</Text>
                <Text style={styles.histSub}>{t(logStyleKey(e.logStyle))}</Text>
              </Pressable>
            ))}
          </View>
        </>
      ) : null}

      <Text style={styles.sectionTitle} accessibilityRole="header">{t('train.history')}</Text>
      {train.recentSessions.length === 0 ? (
        <Text style={styles.empty}>{t('train.noWorkouts')}</Text>
      ) : (
        <View style={styles.list}>
          <Text style={styles.histHint} importantForAccessibility="no" accessibilityElementsHidden>
            {t('train.editHint')}
          </Text>
          {train.recentSessions.slice(0, HISTORY_INLINE).map((s) => (
            <SessionRow
              key={s.id}
              session={s}
              onOpen={openDetail}
              onEdit={train.reopenSession}
              onShare={onShare}
              onDelete={(id) => confirmDeleteSession(id, s)}
            />
          ))}
          {train.recentSessions.length > HISTORY_INLINE ? (
            <Touchable
              style={styles.showAllBtn}
              onPress={() => setHistoryOpen(true)}
              accessibilityRole="button"
              testID="history-show-all"
            >
              <Text style={styles.sectionAction}>{t('train.showAll', { n: train.recentSessions.length })}</Text>
            </Touchable>
          ) : null}
        </View>
      )}

      <TemplateEditorModal
        visible={editing !== null}
        train={train}
        template={editing && 'id' in editing ? (editing as WorkoutTemplate) : null}
        onClose={() => setEditing(null)}
      />
      <ExerciseDetailSheet
        visible={detailEx !== null}
        exercise={detailEx}
        train={train}
        onClose={() => setDetailEx(null)}
      />
      <StarterTemplatesSheet
        visible={startersOpen}
        train={train}
        onClose={() => setStartersOpen(false)}
        // The toast's "Edit" opens the clone straight in the editor (H9/T19).
        onEditTemplate={(tpl) => setEditing(tpl)}
      />
      <ExerciseLibrarySheet
        visible={libraryOpen}
        catalog={train.catalog}
        onClose={() => setLibraryOpen(false)}
        onOpenExercise={(e) => {
          setLibraryOpen(false);
          afterSheet(() => setDetailEx(e));
        }}
        onAddSeed={async (seed) => {
          await train.addLibraryExercise(seed);
        }}
      />
      <SessionDetailSheet
        visible={detailOpen}
        session={detail}
        history={train.recentSessions}
        onClose={() => setDetailOpen(false)}
        onEdit={(s) => {
          setDetailOpen(false);
          afterSheet(() => train.reopenSession(s));
        }}
        onShare={(s) => {
          setDetailOpen(false);
          afterSheet(() => onShare(s));
        }}
        onDelete={(s) => {
          if (!s.id) return;
          const id = s.id;
          setDetailOpen(false);
          afterSheet(() => confirmDeleteSession(id, s));
        }}
      />
      <HistorySheet
        visible={historyOpen}
        sessions={train.recentSessions}
        onClose={() => setHistoryOpen(false)}
        onOpen={(s) => {
          setHistoryOpen(false);
          // One sheet at a time: the list goes first (see `afterSheet`).
          afterSheet(() => openDetail(s));
        }}
        onEdit={(s) => {
          setHistoryOpen(false);
          // Reopening swaps this screen for the live session; the sheet goes
          // first (see `afterSheet`).
          afterSheet(() => train.reopenSession(s));
        }}
        onShare={onShare}
        onDelete={(s) => {
          if (!s.id) return;
          const id = s.id;
          setHistoryOpen(false);
          afterSheet(() => confirmDeleteSession(id, s));
        }}
      />
    </ScrollView>
  );
}

/**
 * One template on the home screen: an edit button (its name, its first
 * exercises, when it was last done), a Start, and the engine's calls for its
 * next session.
 *
 * "Next session" is a SIBLING of the edit button. It was nested inside the
 * Pressable, and VoiceOver focused the outer control and never reached the
 * inner one (Train review bug 9); the edit button had no role or label
 * either.
 */
const TemplateCard = memo(function TemplateCard({
  tpl,
  last,
  open,
  train,
  onEdit,
  onToggleNext,
}: {
  tpl: WorkoutTemplate;
  last: Date | undefined;
  open: boolean;
  train: TrainState;
  onEdit: (tpl: WorkoutTemplate) => void;
  onToggleNext: (id: string) => void;
}) {
  const t = useT();
  const locale = useLocale();
  const styles = useThemedStyles(createStyles);
  const { colors } = useTheme();
  // The ⋯ fallback sheet, where neither the context menu nor the native
  // pull-down exists (an older Android binary).
  const [menuOpen, setMenuOpen] = useState(false);
  const names = templateExerciseNames(tpl, t);
  // A superset draft running on this template (2026-10-11): said on the card,
  // with the way back in its menu — not only in a Drafts list further down.
  // A superset draft switched on here — not a Program v2 one: a program's
  // templates switch together, from Settings, never one card at a time.
  const activeDraft = train.drafts.find((d) => d.status === 'active' && d.draftOf === tpl.id && !d.program);
  const tag = templateTag(tpl, train.drafts, t, locale);
  const draftActions = useDraftActions(train);
  const stacked = useWindowDimensions().fontScale >= CARD_STACK_FONT_SCALE;
  // "3 exercises · 12 sets · last Tue". The counts alone could not tell you
  // which of four templates you are due for, which is the question the list
  // is actually being scanned for.
  const sub = `${templateSummary(tpl, t)} · ${
    last ? t('train.tplLast', { day: formatDate(last, locale, { month: 'short', day: 'numeric' }) }) : t('train.nextNever')
  }`;
  const start = () => {
    haptics.tap();
    void train.startFromTemplate(tpl);
  };
  // Duplicate and Delete were reachable only from inside the editor; the
  // system menu puts them, Start and Edit on the card itself (Train re-score,
  // platform). VoiceOver reaches Start and Edit as the card's own buttons.
  function duplicate() {
    const { id: _id, createdAt: _c, updatedAt: _u, ...draft } = tpl;
    train
      .saveTemplate({ ...draft, name: t('train.copyName', { name: tpl.name }).slice(0, 100) })
      .then(() => showToast(t('train.templateDuplicated'), { testID: 'train-toast' }))
      .catch((e) => {
        haptics.warning();
        showToast(t('train.exerciseSaveErr'), { testID: 'train-toast' });
        captureError(e, { where: 'train.duplicateTemplate' });
      });
  }
  function askDelete() {
    if (!tpl.id) return;
    const id = tpl.id;
    confirm({
      // Named (train-ux H10): "Delete Upper A?", not "Delete this template?".
      title: t('train.deleteTemplateTitle', { name: tpl.name }),
      body: [t('train.deleteTemplateBody'), ...(activeDraft ? [t('train.drafts.deleteActiveWarn', { name: tpl.name })] : [])].join('\n\n'),
      confirmText: t('train.delete'),
      destructive: true,
      onConfirm: () => {
        // Its active draft goes too, in the SAME batch — otherwise it lives on,
        // invisible, or (if the template delete failed) the way back is gone.
        train.deleteTemplate(id, activeDraft?.id).catch((e) => {
          haptics.warning();
          showToast(t('train.templateDeleteErr'), { testID: 'train-toast' });
          captureError(e, { where: 'train.deleteTemplate' });
        });
      },
    });
  }
  // Off iOS the context menu renders only its child, so Duplicate and Delete
  // were buried in the editor again on Android (Train re-score 3). There they
  // ride on a ⋯ beside Start — the system PopupMenu, or the menu sheet on a
  // binary without it. Start and Edit are already the card's own buttons.
  const menuActions: ExerciseMenuAction[] = [
    ...(activeDraft ? [{ key: 'revert-supersets', icon: 'arrow-undo-outline' as const, labelKey: 'train.drafts.revert' as const, onPress: () => draftActions.revert(activeDraft) }] : []),
    { key: 'duplicate', icon: 'copy-outline', labelKey: 'train.duplicate', onPress: duplicate },
    { key: 'delete', icon: 'trash-outline', labelKey: 'train.delete', destructive: true, onPress: askDelete },
  ];
  const menuBtn = CONTEXT_MENUS ? null : (
    <MenuButton
      style={styles.headerIconBtn}
      title={tpl.name}
      actions={toMenuButtonActions(menuActions, t)}
      accessibilityLabel={t('train.templateMenuA11y', { name: tpl.name })}
      testID={`template-menu-${tpl.id}`}
      iconColor={colors.muted}
      onFallbackPress={() => setMenuOpen(true)}
    />
  );
  const startBtn = (
    <Touchable
      style={styles.tplStart}
      onPress={start}
      accessibilityRole="button"
      accessibilityLabel={t('train.startNamed', { name: tpl.name })}
      testID={`start-template-${tpl.id}`}
    >
      <Text style={styles.tplStartText}>{t('train.startTpl')}</Text>
    </Touchable>
  );
  // The whole card is the menu's target, as a row is in every other list
  // here: wrapping only the name button put a native view with no flex between
  // it and the row, and the Start button lost its place at the edge.
  return (
    <ContextMenu
      title={tpl.name}
      preview={<TemplatePreview tpl={tpl} sub={sub} />}
      previewSize={{ width: PREVIEW_WIDTH, height: templatePreviewHeight(tpl) }}
      onPreviewPress={() => onEdit(tpl)}
      actions={[
        { key: 'start', title: t('train.startTpl'), icon: 'play', onPress: start },
        { key: 'edit', title: t('common.edit'), icon: 'pencil', onPress: () => onEdit(tpl) },
        ...(activeDraft ? [{ key: 'revert-supersets', title: t('train.drafts.revert'), icon: 'arrow.uturn.backward', onPress: () => draftActions.revert(activeDraft) }] : []),
        { key: 'duplicate', title: t('train.duplicate'), icon: 'plus.square.on.square', onPress: duplicate },
        { key: 'delete', title: t('train.delete'), icon: 'trash', destructive: true, onPress: askDelete },
      ]}
    >
    <View style={styles.tplCard} testID={`template-${tpl.id}`}>
      <View style={styles.tplCardTop}>
        <Pressable
          style={styles.tplMain}
          android_ripple={TRAIN_RIPPLE}
          onPress={() => onEdit(tpl)}
          accessibilityRole="button"
          // State AND content belong in the label; a hint only says what the
          // action does. The counts, exercises and last date sat in the hint,
          // so anyone with hints off never heard them (train-ux H8).
          accessibilityLabel={[t('train.nextEditA11y', { name: tpl.name }), tag?.text, sub, names]
            .filter(Boolean)
            .join(', ')}
          accessibilityHint={t('train.tplEditHint')}
          accessibilityActions={activeDraft ? [{ name: 'revert', label: t('train.drafts.revertA11y', { name: tpl.name }) }] : undefined}
          onAccessibilityAction={(e) => {
            if (e.nativeEvent.actionName === 'revert' && activeDraft) draftActions.revert(activeDraft);
          }}
          testID={`edit-template-${tpl.id}`}
        >
          <Text style={styles.histDate}>{tpl.name}</Text>
          {tag ? (
            <Text style={styles.supersetTag} testID={`template-${tag.kind}-${tpl.id}`}>{tag.text}</Text>
          ) : null}
          {/* One line beside Start; in full once Start has its own row. */}
          {names ? <Text style={styles.tplExNames} numberOfLines={stacked ? undefined : 1} testID={`template-names-${tpl.id}`}>{names}</Text> : null}
          <Text style={styles.histSub}>{sub}</Text>
        </Pressable>
        {stacked ? null : menuBtn}
        {stacked ? null : startBtn}
      </View>
      {/* Accessibility sizes: Start (and the ⋯) under the text, not beside
          it — beside a fixed button "Romanian De…" was all that fit
          (train-ux H-N10, R12). */}
      {stacked ? (
        <View style={[styles.tplCardTop, { marginTop: space.sm }]} testID={`template-actions-row-${tpl.id}`}>
          {startBtn}
          <View style={{ flex: 1 }} />
          {menuBtn}
        </View>
      ) : null}
      {/* The way back from supersets, visible on every platform — on iOS the
          card's menu is a long-press nobody finds. */}
      {activeDraft ? (
        <Touchable
          style={styles.tplNextToggleBtn}
          onPress={() => draftActions.revert(activeDraft)}
          accessibilityRole="button"
          accessibilityLabel={t('train.drafts.revertA11y', { name: tpl.name })}
          testID={`template-switch-back-${tpl.id}`}
        >
          <Text style={styles.tplNextToggle}>{t('train.drafts.revert')}</Text>
        </Touchable>
      ) : null}
      {/* The engine's calls for this template, BEFORE the session starts —
          the spec's layer 6 surface. Collapsed by default so the list stays a
          list; one tap opens it. */}
      {tpl.id ? (
        <Touchable
          style={styles.tplNextToggleBtn}
          onPress={() => onToggleNext(tpl.id as string)}
          accessibilityRole="button"
          // Named: every card's toggle read "Next weights, button, collapsed"
          // — the X16 problem on a new control (train-ux H-N9).
          accessibilityLabel={`${t('train.rec.nextSession')}, ${tpl.name}`}
          accessibilityState={{ expanded: open }}
          testID={`next-session-${tpl.id}`}
        >
          <Text style={styles.tplNextToggle}>{open ? t('train.rec.hide') : t('train.rec.nextSession')}</Text>
        </Touchable>
      ) : null}
      {open ? (
        <TemplateNextSession recentSessions={train.recentSessions} catalog={train.catalog} train={train} template={tpl} />
      ) : null}
      {CONTEXT_MENUS ? null : (
        <ExerciseMenuSheet
          visible={menuOpen}
          name={tpl.name}
          actions={menuActions}
          onClose={() => setMenuOpen(false)}
          testIDPrefix={`template-menu-${tpl.id}`}
        />
      )}
    </View>
    </ContextMenu>
  );
});

/** The context-menu previews' width, as Today's entry preview. */
const PREVIEW_WIDTH = 320;
/** Exercise lines a preview lists before "+N more". */
const PREVIEW_LINES = 6;
const templatePreviewHeight = (tpl: WorkoutTemplate) =>
  96 + 26 * Math.min(tpl.exercises.length, PREVIEW_LINES) + (tpl.exercises.length > PREVIEW_LINES ? 26 : 0);
const sessionPreviewHeight = (s: WorkoutSession) =>
  108 + 40 * Math.min(s.exercises.length, PREVIEW_LINES) + (s.exercises.length > PREVIEW_LINES ? 26 : 0);

/** A template, opened up: every exercise with its planned set count. */
function TemplatePreview({ tpl, sub }: { tpl: WorkoutTemplate; sub: string }) {
  const t = useT();
  const locale = useLocale();
  const styles = useThemedStyles(createStyles);
  const shown = tpl.exercises.slice(0, PREVIEW_LINES);
  const more = tpl.exercises.length - shown.length;
  return (
    <View style={styles.preview}>
      <Text style={styles.previewTitle} numberOfLines={1}>{tpl.name}</Text>
      <Text style={styles.histSub}>{sub}</Text>
      {shown.map((e, i) => (
        <View key={`${e.exerciseId}-${i}`} style={styles.previewRow}>
          <Text style={styles.previewName} numberOfLines={1}>{e.name}</Text>
          <Text style={styles.previewMeta}>
            {/* Counted the way the editor's card counts them: a myo-reps
                block is one cluster, not three sets (train-ux E-N2). */}
            {setCountText(t, locale, e.plannedSets ?? [])}
          </Text>
        </View>
      ))}
      {more > 0 ? <Text style={styles.histSub}>{t('train.tplMore', { n: more })}</Text> : null}
    </View>
  );
}

/** A logged workout, opened up: each exercise with its working sets. */
function SessionPreview({ session: s, date, vol }: { session: WorkoutSession; date: string; vol: string | null }) {
  const t = useT();
  const styles = useThemedStyles(createStyles);
  const unitSystem = useUnitSystem();
  const shown = s.exercises.slice(0, PREVIEW_LINES);
  const more = s.exercises.length - shown.length;
  return (
    <View style={styles.preview}>
      <Text style={styles.previewTitle} numberOfLines={1}>{s.templateName || t('train.workout')}</Text>
      <Text style={styles.histSub}>{[date, vol].filter(Boolean).join(' · ')}</Text>
      {shown.map((e, i) => (
        <View key={`${e.exerciseId}-${i}`} style={styles.previewBlock}>
          {/* Not `previewName` alone: its `flex: 1` is for the template
              preview's ROW; in this column it sized every name to 0 and the
              menu preview listed numbers with no lifts (train-ux H-N1). */}
          <Text style={[styles.previewName, styles.previewBlockName]} numberOfLines={1} testID={`session-preview-name-${i}`}>{e.name}</Text>
          <Text style={styles.previewMeta} numberOfLines={1}>
            {setLine(e, e.logStyle ?? 'weight-reps', unitSystem) || t('train.detailNoSets')}
          </Text>
        </View>
      ))}
      {more > 0 ? <Text style={styles.histSub}>{t('train.tplMore', { n: more })}</Text> : null}
    </View>
  );
}

/**
 * The volume panel's verdict lines, under the cluster chips: the training
 * phase, then what the week's volume should do — held in a cut, otherwise a
 * +1 cluster per muscle that earned one, with why — and, when the lifter has
 * set a volume gate, the gate and whether it is met.
 */
function VolumeCalls({
  phase,
  calls,
  gateLb,
  sevenDayAvgLb,
}: {
  phase: TrainingPhase;
  calls: readonly VolumeCall[];
  gateLb: number | undefined;
  sevenDayAvgLb: number | null;
}) {
  const t = useT();
  const styles = useThemedStyles(createStyles);
  const unitSystem = useUnitSystem();
  const adds = calls.filter((c) => c.add === 1);
  return (
    <View testID="volume-calls">
      <Text style={styles.volumeLine} testID="volume-phase">
        {t('train.volume.phase', { phase: t(PHASE_KEY[phase]) })}
      </Text>
      {phase === 'cut' ? (
        <Text style={styles.volumeNote} testID="volume-cut-hold">{t('train.volume.cutHold')}</Text>
      ) : adds.length > 0 ? (
        adds.map((c) => (
          <Text key={c.muscle} style={styles.volumeLine} testID={`volume-add-${c.muscle}`}>
            {t('train.volume.add', {
              muscle: t(`train.muscle.${c.muscle}` as I18nKey),
              reason: t(c.reason === 'main-lift-stalled' ? 'train.volume.reason.stalled' : 'train.volume.reason.progressing'),
            })}
          </Text>
        ))
      ) : (
        <Text style={styles.volumeNote} testID="volume-no-add">{t('train.volume.noAdd')}</Text>
      )}
      {gateLb != null ? (
        <Text style={styles.volumeNote} testID="volume-gate">
          {t('train.volume.gate', { lb: formatBodyWeight(gateLb, unitSystem) })}
          {'. '}
          {sevenDayAvgLb != null
            ? `${t('train.volume.gateAvg', { avg: formatBodyWeight(sevenDayAvgLb, unitSystem) })} · `
            : ''}
          {t(volumeGateMet(gateLb, sevenDayAvgLb, phase) ? 'train.volume.gateMet' : 'train.volume.gateNotMet')}
        </Text>
      ) : null}
    </View>
  );
}

const PHASE_KEY: Record<TrainingPhase, I18nKey> = {
  cut: 'train.phase.cut',
  maintenance: 'train.phase.maintenance',
  bulk: 'train.phase.bulk',
};

/** Every exercise of a template with its recommendation, one line each. */
function TemplateNextSession({
  recentSessions,
  catalog,
  train,
  template,
}: {
  recentSessions: TrainState['recentSessions'];
  catalog: TrainState['catalog'];
  train: Pick<TrainState, 'editCatalogExercise'>;
  template: WorkoutTemplate;
}) {
  const t = useT();
  const unitSystem = useUnitSystem();
  const styles = useThemedStyles(createStyles);
  // Keyed on the DATA it reads. It was `[train, template]`, and the hook
  // returned a new object every render, so this never cached once (Train
  // review bug 12).
  //
  // Kept: every row the note itself would render. The filter was
  // `action !== 'none'`, which dropped the refusals ADR-0040 makes speak — a
  // straight-set Row and Overhead Press said nothing under "Next weights"
  // while Bench said INCREASE (train-ux H-N2). The note's own null (a
  // myo-reps `none` with nothing to say) is the one row left out.
  const rows = useMemo(
    () =>
      template.exercises
        .map((row) => ({ row, rec: recommendationFor({ recentSessions, catalog }, row.exerciseId, row) }))
        .filter((r) => recommendationText(r.rec, unitSystem, t) != null),
    [recentSessions, catalog, template, unitSystem, t],
  );
  // One lift-settings sheet for the list, keyed on the exercise it is open
  // for — the effort standard and the band override are catalog properties,
  // and this list is where a "calibrating" line invites the question.
  const [settingsFor, setSettingsFor] = useState<string | null>(null);
  const open = rows.find((r) => r.row.exerciseId === settingsFor);
  const openEx = open ? catalog.find((e) => e.id === open.row.exerciseId) ?? null : null;
  // The sheet is rendered even with no rows: a native sheet must be closed by
  // a mounted owner, so it never sits behind a conditional return.
  return (
    <View style={rows.length ? styles.tplNext : undefined} testID={rows.length ? `next-session-list-${template.id}` : undefined}>
      {rows.map(({ row, rec }) => (
        <View key={row.exerciseId} style={styles.tplNextRow}>
          <Text style={styles.tplNextName}>{row.name}</Text>
          <RecommendationNote
            rec={rec}
            compact
            name={row.name}
            testID={`rec-${template.id}-${row.exerciseId}`}
            onSettings={catalog.some((e) => e.id === row.exerciseId) ? () => setSettingsFor(row.exerciseId) : undefined}
          />
        </View>
      ))}
      <LiftSettingsSheet
        visible={openEx != null}
        exercise={openEx}
        templateRow={open?.row ?? null}
        onClose={() => setSettingsFor(null)}
        onSave={(patch) => (openEx?.id ? train.editCatalogExercise(openEx.id, patch) : Promise.resolve())}
      />
    </View>
  );
}

/**
 * One logged workout. A button that says what it opens, with Delete as an
 * accessibility action — the long-press that deletes is invisible to a
 * screen reader (Train review item 14).
 *
 * A tap opens the read-only detail (`SessionDetailSheet`), not the editor —
 * Edit is one step further in, as in Strong and Hevy (Train re-score). The
 * system menu on iOS previews the sets and offers Edit, Share and Delete
 * without opening anything.
 */
const SessionRow = memo(function SessionRow({
  session: s,
  onOpen,
  onEdit,
  onShare,
  onDelete,
}: {
  session: WorkoutSession;
  /** The read-only detail. */
  onOpen: (s: WorkoutSession) => void;
  /** Straight into the editor (the menu's Edit). */
  onEdit: (s: WorkoutSession) => void;
  onShare: (s: WorkoutSession) => void;
  onDelete: (id: string) => void;
}) {
  const t = useT();
  const locale = useLocale();
  const styles = useThemedStyles(createStyles);
  const { colors } = useTheme();
  const unitSystem = useUnitSystem();
  // The Android ⋯ fallback sheet, where the system pull-down is missing.
  const [menuOpen, setMenuOpen] = useState(false);
  const volume = sessionVolume(s);
  const date = formatDate(s.date, locale, { weekday: 'short', month: 'short', day: 'numeric' });
  const summary = sessionSummary(s, t);
  const vol = volume > 0 ? formatLoad(volume, unitSystem, 0) : null;
  // The workout's NAME leads, the date goes under it: "Fri, Aug 7 / 3
  // exercises" could not say which of four templates it was (train-ux H2).
  const title = s.templateName || date;
  const sub = [s.templateName ? date : null, summary].filter(Boolean).join(' · ');
  // Off iOS there is no context menu, so the row carries a ⋯ with the same
  // three actions — the template cards already did — and a long-press opens
  // it, so "hold for more" is true on both platforms. It used to open Delete
  // (train-ux H6).
  const menuActions: ExerciseMenuAction[] = [
    { key: 'edit', icon: 'pencil-outline', labelKey: 'common.edit', onPress: () => onEdit(s) },
    { key: 'share', icon: 'share-outline', labelKey: 'train.share', onPress: () => onShare(s) },
    { key: 'delete', icon: 'trash-outline', labelKey: 'train.delete', destructive: true, onPress: () => s.id && onDelete(s.id) },
  ];
  const row = (
    <Pressable
      style={[styles.histRow, rippleClip(styles.histRow)]}
      android_ripple={TRAIN_RIPPLE}
      testID={`session-${s.id}`}
      onPress={() => onOpen(s)}
      // iOS: the system context menu takes the long-press (below).
      onLongPress={CONTEXT_MENUS ? undefined : () => setMenuOpen(true)}
      accessibilityRole="button"
      accessibilityLabel={[s.templateName, date, summary, vol].filter(Boolean).join(', ')}
      accessibilityHint={t('train.sessionRowHint')}
      accessibilityActions={[
        { name: 'activate' },
        { name: 'edit', label: t('common.edit') },
        // The context menu offers Share; the actions now do too (train-ux H8).
        { name: 'share', label: t('train.share') },
        { name: 'delete', label: t('train.delete') },
      ]}
      onAccessibilityAction={(e) => {
        if (e.nativeEvent.actionName === 'activate') onOpen(s);
        if (e.nativeEvent.actionName === 'edit') onEdit(s);
        if (e.nativeEvent.actionName === 'share') onShare(s);
        if (e.nativeEvent.actionName === 'delete' && s.id) onDelete(s.id);
      }}
    >
      <View style={styles.histMain}>
        <Text style={styles.histDate}>{title}</Text>
        <Text style={styles.histSub}>{sub}</Text>
      </View>
      {vol ? <Text style={styles.histVol}>{vol}</Text> : null}
    </Pressable>
  );
  // Wrapped in the context menu either way, as the template card is: off iOS
  // it renders only its child.
  const name = [s.templateName || t('train.workout'), date].join(' · ');
  const content = CONTEXT_MENUS ? row : (
    <View style={styles.histRowWrap}>
      <View style={{ flex: 1 }}>{row}</View>
      <MenuButton
        style={styles.headerIconBtn}
        title={name}
        actions={toMenuButtonActions(menuActions, t)}
        accessibilityLabel={t('train.templateMenuA11y', { name })}
        testID={`session-menu-${s.id}`}
        iconColor={colors.muted}
        onFallbackPress={() => setMenuOpen(true)}
      />
      <ExerciseMenuSheet
        visible={menuOpen}
        name={name}
        actions={menuActions}
        onClose={() => setMenuOpen(false)}
        testIDPrefix={`session-menu-${s.id}`}
      />
    </View>
  );
  return (
    <ContextMenu
      title={[date, s.templateName].filter(Boolean).join(' · ')}
      preview={<SessionPreview session={s} date={date} vol={vol} />}
      previewSize={{ width: PREVIEW_WIDTH, height: sessionPreviewHeight(s) }}
      onPreviewPress={() => onOpen(s)}
      actions={[
        { key: 'edit', title: t('common.edit'), icon: 'pencil', onPress: () => onEdit(s) },
        { key: 'share', title: t('train.share'), icon: 'square.and.arrow.up', onPress: () => onShare(s) },
        { key: 'delete', title: t('train.delete'), icon: 'trash', destructive: true, onPress: () => s.id && onDelete(s.id) },
      ]}
    >
      {content}
    </ContextMenu>
  );
});

/** Every loaded workout, in a virtualized list — "Show all" (item 32). */
function HistorySheet({
  visible,
  sessions,
  onClose,
  onOpen,
  onEdit,
  onShare,
  onDelete,
}: {
  visible: boolean;
  sessions: readonly WorkoutSession[];
  onClose: () => void;
  onOpen: (s: WorkoutSession) => void;
  onEdit: (s: WorkoutSession) => void;
  onShare: (s: WorkoutSession) => void;
  onDelete: (s: WorkoutSession) => void;
}) {
  const t = useT();
  const styles = useThemedStyles(createStyles);
  return (
    <BottomSheet native detents={[0.6, 1]} visible={visible} onClose={onClose} contentStyle={styles.sheetBody} maxHeight="80%">
      <View style={styles.sheetStack}>
        <SheetHeader
          title={t('train.historyTitle')}
          trailing={{ label: t('common.done'), onPress: onClose, testID: 'history-done' }}
        />
        <FlatList
          nestedScrollEnabled
          data={sessions as WorkoutSession[]}
          keyExtractor={(s, i) => s.id ?? String(i)}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => (
            <SessionRow
              session={item}
              onOpen={onOpen}
              onEdit={onEdit}
              onShare={onShare}
              onDelete={() => onDelete(item)}
            />
          )}
          ListFooterComponent={<View style={styles.setSheetTail} />}
          testID="history-list"
        />
      </View>
    </BottomSheet>
  );
}
