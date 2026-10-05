import Ionicons from '@expo/vector-icons/Ionicons';
import { memo, useMemo, useState } from 'react';
import { FlatList, Pressable, ScrollView, Text, TouchableOpacity, View } from 'react-native';
import Animated from 'react-native-reanimated';
import {
  formatLoad,
  nextTemplateUp,
  sessionVolume,
  templateLastPerformed,
  trainHeroStats,
  weeklyClusterAudit,
} from '@macrolog/core';
import { CONTEXT_MENUS, ContextMenu } from '@/components/ContextMenu';
import { BottomSheet, NATIVE_SHEETS } from '@/components/BottomSheet';
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
import { type I18nKey, useLocale, useT } from '@/i18n';
import { formatDate } from '@/lib/date-format';
import * as haptics from '@/lib/haptics';
import { CountUpText, enterUp, type usePulse } from '@/lib/motion';
import { showToast } from '@/components/Toast';
import { captureError } from '@/lib/sentry';
import { useTheme, useThemedStyles } from '@/lib/theme-context';
import { useUnitSystem } from '@/lib/use-unit-system';
import type { Exercise, WorkoutSession, WorkoutTemplate } from '@/lib/workout';
import { ExerciseDetailSheet } from './ExerciseDetailSheet';
import { toMenuButtonActions } from './exercise-menu-native';
import { SessionDetailSheet } from './SessionDetailSheet';
import { StarterTemplatesSheet } from './StarterTemplatesSheet';
import { logStyleKey } from './train-shared';
import {
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

// ─── Idle: hero summary + start button + templates + history ────
export function StartView({
  train,
  heroPulse,
  onRetry,
  onShare,
}: {
  train: TrainState;
  heroPulse: ReturnType<typeof usePulse>[0];
  onRetry: () => void;
  /** Share one logged workout as an image (the screen owns the capture). */
  onShare: (s: WorkoutSession) => void;
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

  function confirmDeleteSession(id: string, label: string) {
    // Long-press used to delete a logged workout outright — undiscoverable
    // AND unconfirmed, on the one surface where the data cannot be recovered.
    confirm({
      title: t('train.deleteSessionTitle'),
      body: t('train.deleteSessionBody', { name: label }),
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

  const sessionLabel = (s: WorkoutSession) => formatDate(s.date, locale, { month: 'short', day: 'numeric' });

  return (
    <ScrollView contentContainerStyle={styles.body}>
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
          <TouchableOpacity
            onPress={train.errorKind === 'save' ? train.clearError : onRetry}
            style={styles.errorBtn}
            accessibilityRole="button"
            testID="retry"
          >
            <Text style={styles.discardText}>
              {train.errorKind === 'save' ? t('common.dismiss') : t('common.retry')}
            </Text>
          </TouchableOpacity>
        </View>
      ) : null}

      {/* A state readout, same slot it has on Today (UX_AUDIT S18-12). */}
      <OfflineBanner />

      {/* Hero panel — the Today skeleton (ADR-0014 §7): workouts this week is
          the one big number; volume + top set live inside as chips. */}
      <Animated.View entering={enterUp(0)}>
        <Animated.View style={[styles.heroPanel, heroPulse]} testID="train-hero">
          <Text style={styles.heroCaption} accessibilityRole="header">{t('train.thisWeek')}</Text>
          <View style={styles.hero}>
            <CountUpText
              value={stats.count}
              style={styles.heroValue}
              accessibilityLabel={`${stats.count} ${stats.count === 1 ? t('train.workoutUnit') : t('train.workoutsUnit')}`}
              testID="week-workouts"
            />
            <Text style={styles.heroUnit}>
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
              {stats.topSet > 0 ? (
                <Text style={styles.trendChip}>
                  {t('train.topSet')}  <Text style={styles.trendChipValue}>{formatLoad(stats.topSet, unitSystem, 0)}</Text>
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
          onStart={() => train.startFromTemplate(nextUp.template)}
          onEdit={() => setEditing(nextUp.template)}
        />
      ) : (
        // The ONE "no templates yet" on the screen: the Templates section
        // below printed the same sentence a second time (Train review item 10).
        <View style={styles.nextCard} testID="next-up-empty">
          <Text style={styles.nextCaption} accessibilityRole="header">{t('train.nextUp')}</Text>
          <Text style={styles.nextMeta}>{t('train.noTemplates')}</Text>
          <TouchableOpacity
            style={styles.startBtn}
            onPress={() => setStartersOpen(true)}
            accessibilityRole="button"
            testID="next-up-starters"
          >
            <Text style={styles.startBtnText}>{t('train.starters')}</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Demoted, not removed. An empty session and a bare run are both real
          things to want; neither is what you came to the tab to do. "Log a
          run" is the cardio-only start the hook had and nothing called
          (Train review item 8, ADR-0025). */}
      <View style={styles.secondaryRow}>
        <TouchableOpacity
          style={styles.secondaryBtn}
          onPress={() => {
            haptics.tap();
            void train.startWorkout();
          }}
          accessibilityRole="button"
          testID="start-workout"
        >
          <Text style={styles.secondaryLink}>{t('train.startEmpty')}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.secondaryBtn}
          onPress={() => {
            haptics.tap();
            void train.startCardioWorkout('run');
          }}
          accessibilityRole="button"
          testID="start-run"
        >
          <Text style={styles.secondaryLink}>{t('train.logRun')}</Text>
        </TouchableOpacity>
      </View>

      {audit.clusters > 0 ? (
        <View style={styles.auditWrap} testID="cluster-audit">
          <TouchableOpacity
            style={styles.auditLine}
            onPress={() => setAuditOpen((o) => !o)}
            accessibilityRole="button"
            accessibilityState={{ expanded: auditOpen }}
            testID="cluster-audit-toggle"
          >
            <Text style={styles.auditTitle}>{t('train.audit.title')}</Text>
            <Text style={styles.auditLineText} numberOfLines={1}>
              {'  '}
              {t('train.audit.summary', {
                n: audit.clusters,
                inRange: audit.muscles.filter((m) => m.status === 'in-range').length,
                total: audit.muscles.length,
              })}
            </Text>
            <Ionicons name={auditOpen ? 'chevron-up' : 'chevron-down'} size={16} color={colors.faint} />
          </TouchableOpacity>
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
            </>
          ) : null}
        </View>
      ) : null}

      <View style={styles.sectionHead}>
        <Text style={styles.sectionTitle} accessibilityRole="header">{t('train.templates')}</Text>
        <View style={styles.sectionActions}>
          <TouchableOpacity
            style={styles.textAction}
            onPress={() => setStartersOpen(true)}
            accessibilityRole="button"
            testID="browse-starters"
          >
            <Text style={styles.sectionAction}>{t('train.starters')}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.textAction}
            onPress={() => setEditing({})}
            accessibilityRole="button"
            accessibilityLabel={t('train.newTemplateTitle')}
            testID="new-template"
          >
            <Ionicons name="add" size={18} color={colors.teal} />
            <Text style={styles.sectionAction}>{t('train.newTemplate')}</Text>
          </TouchableOpacity>
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
              onDelete={(id) => confirmDeleteSession(id, sessionLabel(s))}
            />
          ))}
          {train.recentSessions.length > HISTORY_INLINE ? (
            <TouchableOpacity
              style={styles.showAllBtn}
              onPress={() => setHistoryOpen(true)}
              accessibilityRole="button"
              testID="history-show-all"
            >
              <Text style={styles.sectionAction}>{t('train.showAll', { n: train.recentSessions.length })}</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      )}

      {/* The catalog: a few rows inline, the rest in the library sheet (Train
          review item 32). The inline rows are also the fallback if the
          revived sheet misbehaves on a device — see `ExerciseLibrarySheet`. */}
      {train.catalog.length ? (
        <>
          <View style={styles.sectionHead}>
            <Text style={styles.sectionTitle} accessibilityRole="header">{t('train.exercises')}</Text>
            {train.catalog.length > CATALOG_INLINE ? (
              <TouchableOpacity
                style={styles.textAction}
                onPress={() => setLibraryOpen(true)}
                accessibilityRole="button"
                testID="browse-exercises"
              >
                <Text style={styles.sectionAction}>{t('train.browseExercises', { n: train.catalog.length })}</Text>
              </TouchableOpacity>
            ) : null}
          </View>
          <View style={styles.list}>
            {train.catalog.slice(0, CATALOG_INLINE).map((e) => (
              <Pressable
                key={e.id}
                style={styles.exLibRow}
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
          afterSheet(() => confirmDeleteSession(id, sessionLabel(s)));
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
          afterSheet(() => confirmDeleteSession(id, sessionLabel(s)));
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
      title: t('train.deleteTemplateTitle'),
      body: t('train.deleteTemplateBody'),
      confirmText: t('train.delete'),
      destructive: true,
      onConfirm: () => {
        train.deleteTemplate(id).catch((e) => {
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
    { key: 'duplicate', icon: 'copy-outline', labelKey: 'train.duplicate', onPress: duplicate },
    { key: 'delete', icon: 'trash-outline', labelKey: 'train.delete', destructive: true, onPress: askDelete },
  ];
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
        { key: 'duplicate', title: t('train.duplicate'), icon: 'plus.square.on.square', onPress: duplicate },
        { key: 'delete', title: t('train.delete'), icon: 'trash', destructive: true, onPress: askDelete },
      ]}
    >
    <View style={styles.tplCard} testID={`template-${tpl.id}`}>
      <View style={styles.tplCardTop}>
        <Pressable
          style={styles.tplMain}
          onPress={() => onEdit(tpl)}
          accessibilityRole="button"
          accessibilityLabel={t('train.nextEditA11y', { name: tpl.name })}
          accessibilityHint={[names, sub].filter(Boolean).join('. ')}
          testID={`edit-template-${tpl.id}`}
        >
          <Text style={styles.histDate}>{tpl.name}</Text>
          {names ? <Text style={styles.tplExNames} numberOfLines={1}>{names}</Text> : null}
          <Text style={styles.histSub}>{sub}</Text>
        </Pressable>
        {CONTEXT_MENUS ? null : (
          <MenuButton
            style={styles.headerIconBtn}
            title={tpl.name}
            actions={toMenuButtonActions(menuActions, t)}
            accessibilityLabel={t('train.templateMenuA11y', { name: tpl.name })}
            testID={`template-menu-${tpl.id}`}
            iconColor={colors.muted}
            onFallbackPress={() => setMenuOpen(true)}
          />
        )}
        <TouchableOpacity
          style={styles.tplStart}
          onPress={start}
          accessibilityRole="button"
          accessibilityLabel={t('train.startNamed', { name: tpl.name })}
          testID={`start-template-${tpl.id}`}
        >
          <Text style={styles.tplStartText}>{t('train.startTpl')}</Text>
        </TouchableOpacity>
      </View>
      {/* The engine's calls for this template, BEFORE the session starts —
          the spec's layer 6 surface. Collapsed by default so the list stays a
          list; one tap opens it. */}
      {tpl.id ? (
        <TouchableOpacity
          style={styles.tplNextToggleBtn}
          onPress={() => onToggleNext(tpl.id as string)}
          accessibilityRole="button"
          accessibilityState={{ expanded: open }}
          testID={`next-session-${tpl.id}`}
        >
          <Text style={styles.tplNextToggle}>{open ? t('train.rec.hide') : t('train.rec.nextSession')}</Text>
        </TouchableOpacity>
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
            {`${e.plannedSets?.length ?? 0} ${(e.plannedSets?.length ?? 0) === 1 ? t('train.setOne') : t('train.setMany')}`}
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
          <Text style={styles.previewName} numberOfLines={1}>{e.name}</Text>
          <Text style={styles.previewMeta} numberOfLines={1}>
            {setLine(e, e.logStyle ?? 'weight-reps', unitSystem) || t('train.detailNoSets')}
          </Text>
        </View>
      ))}
      {more > 0 ? <Text style={styles.histSub}>{t('train.tplMore', { n: more })}</Text> : null}
    </View>
  );
}

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
  const styles = useThemedStyles(createStyles);
  // Keyed on the DATA it reads. It was `[train, template]`, and the hook
  // returned a new object every render, so this never cached once (Train
  // review bug 12).
  const rows = useMemo(
    () =>
      template.exercises
        .map((row) => ({ row, rec: recommendationFor({ recentSessions, catalog }, row.exerciseId, row) }))
        .filter((r) => r.rec.action !== 'none'),
    [recentSessions, catalog, template],
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
            testID={`rec-${template.id}-${row.exerciseId}`}
            onSettings={catalog.some((e) => e.id === row.exerciseId) ? () => setSettingsFor(row.exerciseId) : undefined}
          />
        </View>
      ))}
      <LiftSettingsSheet
        visible={openEx != null}
        exercise={openEx}
        rec={open?.rec ?? null}
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
  const unitSystem = useUnitSystem();
  const volume = sessionVolume(s);
  const date = formatDate(s.date, locale, { weekday: 'short', month: 'short', day: 'numeric' });
  const summary = sessionSummary(s, t);
  const vol = volume > 0 ? formatLoad(volume, unitSystem, 0) : null;
  const row = (
    <Pressable
      style={styles.histRow}
      testID={`session-${s.id}`}
      onPress={() => onOpen(s)}
      // iOS: the system context menu takes the long-press (below).
      onLongPress={CONTEXT_MENUS ? undefined : () => s.id && onDelete(s.id)}
      accessibilityRole="button"
      accessibilityLabel={[date, s.templateName, summary, vol].filter(Boolean).join(', ')}
      accessibilityHint={t('train.sessionRowHint')}
      accessibilityActions={[
        { name: 'activate' },
        { name: 'edit', label: t('common.edit') },
        { name: 'delete', label: t('train.delete') },
      ]}
      onAccessibilityAction={(e) => {
        if (e.nativeEvent.actionName === 'activate') onOpen(s);
        if (e.nativeEvent.actionName === 'edit') onEdit(s);
        if (e.nativeEvent.actionName === 'delete' && s.id) onDelete(s.id);
      }}
    >
      <View style={styles.histMain}>
        <Text style={styles.histDate}>{date}</Text>
        <Text style={styles.histSub}>{summary}</Text>
      </View>
      {vol ? <Text style={styles.histVol}>{vol}</Text> : null}
    </Pressable>
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
      {row}
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
        <Text style={styles.sheetTitle} accessibilityRole="header">{t('train.historyTitle')}</Text>
        <FlatList
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
