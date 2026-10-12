import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import {
  calendarDateKey,
  dropEmptyExercises,
  fillMissingClusterLoads,
  finishSummary,
  formatLoad,
  sessionCounts,
  type UnitSystem,
} from '@macrolog/core';
import { type Locale, type TFn, useT } from '@/i18n';
import { formatDate } from '@/lib/date-format';
import { captureAndShare } from '@/lib/shareCapture';
import { type WorkoutSession, dropEmptySets } from '@/lib/workout';
import { font, palettes, radius, space } from '@/theme';

// Deliberately NOT theme-reactive, like Today's `ShareCard`: the captured image
// keeps one fixed brand look whatever scheme the sharer's phone is in.
const colors = palettes.light.colors;

/** What the card prints — already formatted, so the card is only layout. */
export interface WorkoutShareStats {
  /** The template's name, or "Workout". */
  title: string;
  /** "Sat, Oct 4" in the sharer's locale. */
  date: string;
  /** "12,450 lb" in the sharer's unit, or null for a session with no load. */
  volume: string | null;
  sets: number;
  exercises: number;
  /** Records set in this session — 0 hides the tile. */
  prs: number;
  /** The shared file's name, no extension: "Ignia-push-a-2026-10-11" rather
   *  than a UUID (J13). Android honours it; iOS names the capture itself. */
  fileName: string;
}

/** "Pierna Día 1" → "pierna-dia-1": ASCII, lower case, dashes. */
function slug(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

/**
 * The numbers for one session's card. Records are judged against the sessions
 * BEFORE it only — a workout from March is not "a PR" because of what was
 * lifted in June. Pure apart from formatting; exported for the test.
 */
export function workoutShareStats(
  session: WorkoutSession,
  history: readonly WorkoutSession[],
  t: TFn,
  locale: Locale,
  unitSystem: UnitSystem,
): WorkoutShareStats {
  const at = session.date.getTime();
  const before = history.filter((s) => s.id !== session.id && s.date.getTime() < at);
  // What the save keeps, not the live session: the receipt's Share passes the
  // session as it stood at Complete, and "3 exercises" was shared for a
  // workout that saved one (F11). The same pruning as `ledger-ops.ts`; a
  // stored session is already pruned, so this is a no-op for history.
  const saved = {
    ...session,
    exercises: dropEmptyExercises(dropEmptySets(fillMissingClusterLoads(session.exercises))),
  };
  const summary = finishSummary(saved, before, at);
  const counts = sessionCounts(saved);
  const title = session.templateName || t('train.workout');
  return {
    title,
    date: formatDate(session.date, locale, { weekday: 'short', month: 'short', day: 'numeric' }),
    volume: summary.volume > 0 ? formatLoad(summary.volume, unitSystem, 0) : null,
    sets: counts.sets,
    exercises: counts.exercises,
    prs: summary.prs.length,
    fileName: ['Ignia', slug(title), calendarDateKey(session.date)].filter(Boolean).join('-'),
  };
}

/**
 * A finished workout as a shareable image (react-native-view-shot) — the
 * growth loop Hevy's post-workout share is (Train re-score, delight).
 *
 * Numbers only, by the same rule as Today's card (ADR-0010): the title, the
 * date, volume, sets, exercises and records. Never a body weight, never a
 * photo, never the per-set log.
 *
 * Laid out for a fixed 360-pt capture (F10/H4/J13): volume leads on a line of
 * its own (in a tile it shrank to half the other numbers), the counts share
 * one row whose labels never break mid-word, and NO text follows Dynamic
 * Type — the image is the same size whatever the sharer's text setting.
 */
export function WorkoutShareCard({ stats }: { stats: WorkoutShareStats }) {
  const t = useT();
  const tiles: { key: string; value: string; label: string }[] = [
    { key: 'sets', value: String(stats.sets), label: t('train.summarySets') },
    { key: 'exercises', value: String(stats.exercises), label: t('train.shareExercises') },
    ...(stats.prs > 0 ? [{ key: 'prs', value: String(stats.prs), label: t('train.sharePrs') }] : []),
  ];
  return (
    <View style={styles.card}>
      <View style={styles.rule} />
      <Text style={styles.wordmark}>Ignia</Text>
      <View>
        <Text style={styles.title} numberOfLines={2} allowFontScaling={false}>{stats.title}</Text>
        <Text style={styles.date} allowFontScaling={false}>{stats.date}</Text>
      </View>
      {stats.volume ? (
        <View testID="share-card-volume">
          <Text style={styles.volume} numberOfLines={1} adjustsFontSizeToFit allowFontScaling={false}>
            {stats.volume}
          </Text>
          <Text style={styles.volumeLabel} allowFontScaling={false}>{t('train.summaryVolume')}</Text>
        </View>
      ) : null}
      <View style={styles.tiles}>
        {tiles.map((tile) => (
          <View key={tile.key} style={styles.tile}>
            <Text style={styles.tileValue} numberOfLines={1} allowFontScaling={false}>{tile.value}</Text>
            <Text
              style={styles.tileLabel}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.75}
              allowFontScaling={false}
            >
              {tile.label}
            </Text>
          </View>
        ))}
      </View>
      <Text style={styles.tagline} allowFontScaling={false}>{t('train.shareTagline')}</Text>
    </View>
  );
}

/**
 * Share one workout: `share(stats)` mounts the card off-screen, captures it one
 * frame later and opens the OS share sheet; `host` is the element to render
 * somewhere always mounted (the Train screen). Mounted only while a share is in
 * flight — the same arrangement as Today's card, for the same reason: an
 * off-screen tree re-rendered on every change for a button pressed rarely.
 */
export function useWorkoutShare(): { share: (stats: WorkoutShareStats) => void; host: ReactNode } {
  const t = useT();
  const ref = useRef<View>(null);
  const [stats, setStats] = useState<WorkoutShareStats | null>(null);
  const share = useCallback((next: WorkoutShareStats) => {
    setStats((cur) => cur ?? next);
  }, []);
  useEffect(() => {
    if (!stats) return;
    const id = requestAnimationFrame(() => {
      captureAndShare(ref, t('train.shareCardTitle'), stats.fileName)
        .catch(() => {
          /* capture/share failed or the sheet was dismissed — no-op */
        })
        .then(() => setStats(null));
    });
    return () => cancelAnimationFrame(id);
  }, [stats, t]);
  const host = stats ? (
    <View style={styles.capture}>
      <View ref={ref} collapsable={false}>
        <WorkoutShareCard stats={stats} />
      </View>
    </View>
  ) : null;
  return { share, host };
}

const styles = StyleSheet.create({
  capture: { position: 'absolute', left: -10000, top: 0, opacity: 0, pointerEvents: 'none' },
  card: {
    width: 360,
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    paddingVertical: space.xxl,
    paddingHorizontal: space.xl,
    gap: space.xl,
    overflow: 'hidden',
  },
  rule: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 8, backgroundColor: colors.accent },
  wordmark: { fontSize: font.h3, fontWeight: '800', color: colors.accent, letterSpacing: 0.3 },
  title: { fontSize: font.h2, fontWeight: '800', color: colors.ink },
  date: { fontSize: font.small, color: colors.muted, fontWeight: '600', marginTop: 2 },
  volume: { fontSize: 36, fontWeight: '800', color: colors.ink, fontVariant: ['tabular-nums'] },
  volumeLabel: { fontSize: font.tiny, color: colors.muted, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
  tiles: { flexDirection: 'row', justifyContent: 'space-between', gap: space.md },
  tile: { flex: 1, alignItems: 'center', gap: 4 },
  tileValue: { fontSize: 30, fontWeight: '800', color: colors.ink, fontVariant: ['tabular-nums'] },
  tileLabel: { fontSize: font.tiny, color: colors.muted, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, textAlign: 'center' },
  tagline: { fontSize: font.small, color: colors.muted },
});
