/**
 * Two Program v2.1 signals on Train's home screen (2026-10-15), both pure
 * reads of core over the rotation's templates:
 *
 * - **Deload** (core `deload.ts`): "Consider a deload week" when two or more
 *   lifts are down at the same load for two sessions running; once accepted,
 *   which templates still owe their deload session. Deloads are on a trigger,
 *   never a schedule — so the card is the only way one starts.
 * - **Load overdue** (core `load-flags.ts`): a lift that went past the top of
 *   its range at the template's own load, with the load still where it was.
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useMemo, useState } from 'react';
import { Text, View } from 'react-native';
import {
  activeHomeNotes,
  dayBoundaryOf,
  dayKeyAt,
  deloadSignal,
  formatLoad,
  homePlanOf,
  overdueLoads,
  reviewDue,
  reviewRotations,
  type DeloadSignal,
} from '@macrolog/core';
import { formatDate } from '@/lib/date-format';
import type { TrainState } from '@/hooks/useTrain';
import type { WorkoutTemplate } from '@/lib/workout';
import { useLocale, useT } from '@/i18n';
import { useAuth } from '@/lib/auth';
import { captureError } from '@/lib/sentry';
import * as haptics from '@/lib/haptics';
import { useTheme, useThemedStyles } from '@/lib/theme-context';
import { useUnitSystem } from '@/lib/use-unit-system';
import { space } from '@/theme';
import { Touchable } from './Touchable';
import { createStyles } from './train-styles';

/** The signal's identity: a "Not now" holds until a DIFFERENT set of reads
 *  trips it — a new session's numbers are a new question. */
function signalKey(signal: DeloadSignal): string {
  return signal.lifts.map((l) => `${l.exerciseId}:${l.load}:${l.reps.join('/')}`).join('|');
}
const dismissKey = (uid: string) => `ignia.deloadDismissed.${uid}`;
const reviewKey = (uid: string) => `ignia.reviewDismissed.${uid}`;

/** "Mon / Wed / Fri" in the user's locale (ISO weekdays; 2024-01-01 is a Monday). */
function weekdays(days: readonly number[], locale: Parameters<typeof formatDate>[1]): string {
  return days.map((d) => formatDate(new Date(2024, 0, d), locale, { weekday: 'short' })).join(' / ');
}

export function ProgramSignals({
  train,
  plannedTemplates,
  now,
}: {
  train: Pick<TrainState, 'recentSessions' | 'catalog' | 'engineCatalog' | 'deload' | 'setDeloadStartedAt'>;
  plannedTemplates: readonly WorkoutTemplate[];
  now: number;
}) {
  const t = useT();
  const styles = useThemedStyles(createStyles);
  const { colors } = useTheme();
  const unitSystem = useUnitSystem();
  const { user, profile } = useAuth();
  const uid = user?.uid;
  const startedAt = profile?.deloadStartedAt ?? undefined;
  const deload = train.deload;

  const locale = useLocale();
  // The home plan (core `home-plan.ts`, 2026-11-18): the deload trigger, the
  // review checkpoint, the default week and dated notes. Absent → as before.
  const plan = useMemo(() => homePlanOf(profile as { homePlan?: unknown } | null), [profile]);
  const boundary = dayBoundaryOf(profile);
  const today = dayKeyAt(new Date(now), boundary);
  const notes = activeHomeNotes(plan, today);
  const review = useMemo(() => reviewDue(plan, train.recentSessions, boundary), [plan, train.recentSessions, boundary]);
  const reviewId = review ? `${review.since}:${review.title}` : null;
  const [reviewDismissed, setReviewDismissed] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    if (!uid) return;
    let cancelled = false;
    void AsyncStorage.getItem(reviewKey(uid)).then((v) => {
      if (!cancelled) setReviewDismissed(v ?? null);
    }).catch(() => {
      if (!cancelled) setReviewDismissed(null);
    });
    return () => {
      cancelled = true;
    };
  }, [uid]);
  const showReview = review != null && reviewDismissed !== undefined && reviewDismissed !== reviewId;

  const signal = useMemo(
    () => deloadSignal({
      templates: plannedTemplates, sessions: train.recentSessions, since: startedAt,
      triggerLifts: plan?.deloadTriggerLifts, repsDown: plan?.deloadRepsDown,
    }),
    [plannedTemplates, train.recentSessions, startedAt, plan],
  );
  // `undefined` until storage answers, so a dismissed card never flashes.
  const [dismissed, setDismissed] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    if (!uid) return;
    let cancelled = false;
    void AsyncStorage.getItem(dismissKey(uid)).then((v) => {
      if (!cancelled) setDismissed(v ?? null);
    }).catch(() => {
      if (!cancelled) setDismissed(null);
    });
    return () => {
      cancelled = true;
    };
  }, [uid]);

  const catalog = train.engineCatalog ?? train.catalog;
  const overdue = useMemo(
    () => overdueLoads({
      templates: plannedTemplates,
      sessions: train.recentSessions,
      catalogOf: (id) => catalog.find((e) => e.id === id),
      now: new Date(now),
    }),
    [plannedTemplates, train.recentSessions, catalog, now],
  );

  const nameOf = (id: string) => plannedTemplates.find((tp) => tp.id === id)?.name ?? id;

  function save(at: Date | null, where: string) {
    const write = train.setDeloadStartedAt;
    if (!write) return;
    haptics.tap();
    write(at).catch((e: unknown) => {
      haptics.warning();
      captureError(e, { where });
    });
  }

  const showSignal = !deload?.active && signal.triggered && dismissed !== undefined && dismissed !== signalKey(signal);

  return (
    <>
      {plan?.trainingDays?.length || notes.length ? (
        <View style={[styles.nextCard, { gap: space.xs }]} testID="home-plan">
          {plan?.label ? <Text style={styles.nextCaption} accessibilityRole="header">{plan.label}</Text> : null}
          {plan?.trainingDays?.length ? (
            <Text style={styles.volumeLine} testID="home-plan-week">
              {t('train.homePlan.week', { days: weekdays(plan.trainingDays, locale) })}
            </Text>
          ) : null}
          {notes.map((n) => (
            <Text key={`${n.from}-${n.label}`} style={styles.volumeNote} testID={`home-plan-note-${n.from}`}>
              {n.note ? `${n.label} — ${n.note}` : n.label}
            </Text>
          ))}
        </View>
      ) : null}

      {showReview && review ? (
        <View style={styles.nextCard} testID="program-review">
          <Text style={styles.nextCaption} accessibilityRole="header">{review.title}</Text>
          <Text style={styles.volumeLine}>{review.body}</Text>
          <Text style={styles.volumeNote}>
            {t('train.homePlan.reviewWhy', { n: reviewRotations(review, train.recentSessions, boundary) })}
          </Text>
          <View style={styles.secondaryRow}>
            <Touchable
              style={styles.secondaryBtn}
              onPress={() => {
                if (!uid || !reviewId) return;
                haptics.tap();
                setReviewDismissed(reviewId);
                void AsyncStorage.setItem(reviewKey(uid), reviewId).catch(() => undefined);
              }}
              accessibilityRole="button"
              testID="program-review-dismiss"
            >
              <Text style={styles.secondaryLink}>{t('train.homePlan.reviewDone')}</Text>
            </Touchable>
          </View>
        </View>
      ) : null}

      {deload?.active ? (
        <View style={styles.nextCard} testID="deload-active">
          <Text style={styles.nextCaption} accessibilityRole="header">{t('train.deload.activeTitle')}</Text>
          <Text style={styles.volumeLine} testID="deload-remaining">
            {t('train.deload.remaining', { templates: deload.remaining.map(nameOf).join(', ') })}
          </Text>
          <Text style={styles.volumeNote}>{t('train.deload.spec')}</Text>
          <View style={styles.secondaryRow}>
            <Touchable
              style={styles.secondaryBtn}
              onPress={() => save(null, 'train.deload.end')}
              accessibilityRole="button"
              testID="deload-end"
            >
              <Text style={styles.secondaryLink}>{t('train.deload.end')}</Text>
            </Touchable>
          </View>
        </View>
      ) : null}

      {showSignal ? (
        <View style={styles.nextCard} testID="deload-signal">
          <Text style={styles.nextCaption} accessibilityRole="header">{t('train.deload.signalTitle')}</Text>
          <Text style={styles.volumeNote}>{t('train.deload.signalWhy')}</Text>
          {signal.lifts.map((l) => (
            <Text key={l.exerciseId} style={styles.volumeLine} testID={`deload-lift-${l.exerciseId}`}>
              {t('train.deload.liftLine', { name: l.name, load: formatLoad(l.load, unitSystem), reps: l.reps.join(' → ') })}
            </Text>
          ))}
          <Text style={styles.volumeNote}>{t('train.deload.spec')}</Text>
          <Touchable
            style={styles.startBtn}
            onPress={() => save(new Date(), 'train.deload.accept')}
            accessibilityRole="button"
            testID="deload-accept"
          >
            <Text style={styles.startBtnText}>{t('train.deload.accept')}</Text>
          </Touchable>
          <View style={styles.secondaryRow}>
            <Touchable
              style={styles.secondaryBtn}
              onPress={() => {
                if (!uid) return;
                haptics.tap();
                const key = signalKey(signal);
                setDismissed(key);
                void AsyncStorage.setItem(dismissKey(uid), key).catch(() => undefined);
              }}
              accessibilityRole="button"
              testID="deload-dismiss"
            >
              <Text style={styles.secondaryLink}>{t('train.deload.notNow')}</Text>
            </Touchable>
          </View>
        </View>
      ) : null}

      {/* Not during a deload: the week holds every load on purpose. */}
      {overdue.length > 0 && !deload?.active ? (
        <View style={[styles.nextCard, { gap: space.sm }]} testID="load-overdue">
          <Text style={styles.nextCaption} accessibilityRole="header">{t('train.overdue.title')}</Text>
          {overdue.map((o) => (
            <View key={`${o.templateId ?? o.templateName}-${o.exerciseId}`} style={{ flexDirection: 'row', gap: space.xs }} testID={`overdue-${o.exerciseId}`}>
              <Ionicons name={o.held ? 'pause-circle-outline' : 'arrow-up-circle-outline'} size={16} color={o.held ? colors.muted : colors.warn} />
              <Text style={[styles.volumeLine, { flex: 1 }]}>
                {t(o.held ? 'train.overdue.held' : 'train.overdue.raise', {
                  name: o.name,
                  template: o.templateName,
                  load: formatLoad(o.load, unitSystem),
                  reps: o.reps.join('/'),
                  max: o.max,
                })}
              </Text>
            </View>
          ))}
        </View>
      ) : null}
    </>
  );
}
