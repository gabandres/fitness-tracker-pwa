import { useEffect, useState } from 'react';
import { StyleSheet, Switch, Text, View } from 'react-native';
import {
  KG_PER_LB,
  COMP_MIN_LOGGED_DAYS,
  COMP_MIN_POINTS,
  COMP_MIN_SPAN_DAYS,
  RECOMP_MIN_TAPES,
  RECOMP_WAIST_DAYS,
  defaultTapeReminder,
  type CompositionMaintenance,
  type RecompSignal,
  type TapeReminderSetting,
  type UnitSystem,
} from '@macrolog/core';
import { useLocale, useT, type I18nKey } from '@/i18n';
import { formatDate, formatNumber, formatTime } from '@/lib/date-format';
import { getTapeReminder, setTapeReminder } from '@/lib/reminders';
import { useTheme, useThemedStyles, type Theme } from '@/lib/theme-context';
import { font, radius, space } from '@/theme';

/**
 * ADR-0043 surfaces. Copy rules, from the brief and enforced here:
 * - "lean mass (includes water)", never "muscle";
 * - no direction claim (fat down / lean up) while confidence is Low;
 * - the composition number sits UNDER the existing maintenance, never instead
 *   of it, and nothing here reaches the calorie target.
 */

const CM_PER_IN = 2.54;
const round10 = (n: number) => Math.round(n / 10) * 10;

/** `+0.12` / `−0.24` — a real minus sign, locale digits. */
function signed(v: number, digits: number, locale: ReturnType<typeof useLocale>): string {
  const abs = formatNumber(Math.abs(v), locale, { minimumFractionDigits: digits, maximumFractionDigits: digits });
  return `${v < 0 ? '−' : '+'}${abs}`;
}

/** The line under the maintenance number on Trends. */
/** Classes whose call rests on the waist MOVING — the ones a within-noise
 *  change cannot back up. "Waist flat" classes stay as they are: noise does
 *  not contradict flat. */
const NOISE_HEDGED: ReadonlySet<string> = new Set(['recomp', 'fat_loss', 'gaining_fat']);

/** The headline. When the waist change is inside tape noise the fine print
 *  says so, and a headline claiming "Recomposition signal" contradicted it. */
export function recompHeadlineKey(cls: string, withinNoise: boolean): I18nKey {
  return (withinNoise && NOISE_HEDGED.has(cls) ? `recomp.clsPossible.${cls}` : `recomp.cls.${cls}`) as I18nKey;
}

export function CompositionLine({
  result,
  unitSystem,
  female = false,
}: {
  result: CompositionMaintenance;
  unitSystem: UnitSystem;
  /** Women's Navy set includes the hip. */
  female?: boolean;
}) {
  const t = useT();
  const locale = useLocale();
  const styles = useThemedStyles(createStyles);

  if (result.status !== 'ok') {
    const text =
      result.status === 'insufficient_tapes'
        ? result.profileMissing
          ? t('comp.needProfile')
          : t(female ? 'comp.needTapesHip' : 'comp.needTapes', { n: COMP_MIN_POINTS, weeks: COMP_MIN_SPAN_DAYS / 7 })
        : result.status === 'insufficient_logging'
          ? t('comp.needLogging', { n: COMP_MIN_LOGGED_DAYS, have: result.loggedDays })
          : t('comp.needWeight');
    return <Text style={styles.compLine} testID="comp-line">{text}</Text>;
  }

  const what =
    result.mode === 'dxa_anchored'
      ? t('comp.whatDxa')
      : result.sources.navy === result.points
        ? t('comp.whatTapes')
        : t('comp.whatReadings');
  const metric = unitSystem === 'metric';
  const mass = (kg: number) => `${signed(metric ? kg : kg / KG_PER_LB, 1, locale)} ${metric ? 'kg' : 'lb'}`;
  return (
    <View style={styles.compWrap}>
      <Text style={styles.compLine} testID="comp-line">
        {t('comp.line', {
          kcal: formatNumber(round10(result.median), locale),
          lo: formatNumber(round10(result.p10), locale),
          hi: formatNumber(round10(result.p90), locale),
          conf: t(`comp.conf.${result.confidence}` as I18nKey),
          n: result.points,
          what,
          days: result.spanDays,
        })}
      </Text>
      {/* No direction claims inside Low confidence. */}
      {result.confidence !== 'low' ? (
        <Text style={styles.compDetail} testID="comp-detail">
          {t('comp.detail', { fm: mass(result.deltaFmKg), ffm: mass(result.deltaFfmKg) })}
        </Text>
      ) : null}
    </View>
  );
}

/** The recomp signal card: two slopes, a class, and the weekly tape reminder. */
export function RecompCard({
  signal,
  unitSystem,
  lastTapeAt,
  female = false,
}: {
  signal: RecompSignal;
  unitSystem: UnitSystem;
  lastTapeAt: Date | null;
  female?: boolean;
}) {
  const t = useT();
  const locale = useLocale();
  const styles = useThemedStyles(createStyles);
  const { colors } = useTheme();
  const [reminder, setReminder] = useState<TapeReminderSetting | null>(null);
  const [problem, setProblem] = useState<'denied' | 'failed' | null>(null);

  useEffect(() => {
    let live = true;
    void getTapeReminder().then((r) => live && setReminder(r));
    return () => {
      live = false;
    };
  }, []);

  async function toggle(on: boolean) {
    const next = on ? defaultTapeReminder(lastTapeAt, new Date(), female) : null;
    const res = await setTapeReminder(next, t);
    setProblem(res === 'ok' ? null : res);
    if (res === 'ok') setReminder(next);
  }

  const metric = unitSystem === 'metric';
  let body: React.ReactNode;
  if (signal.status !== 'ok') {
    body = (
      <Text style={styles.recompBody} testID="recomp-insufficient">
        {signal.reason === 'tapes'
          ? t('recomp.needTapes', { need: RECOMP_MIN_TAPES, weeks: RECOMP_WAIST_DAYS / 7, n: signal.tapes })
          : t('recomp.needWeight')}
      </Text>
    );
  } else {
    const w = metric ? signal.weightLbPerWeek * KG_PER_LB : signal.weightLbPerWeek;
    const waist = metric ? signal.waistInPer4Wk * CM_PER_IN : signal.waistInPer4Wk;
    const se = metric ? signal.waistSeInPer4Wk * CM_PER_IN : signal.waistSeInPer4Wk;
    body = (
      <>
        <Text style={styles.recompClass} testID="recomp-class">{t(recompHeadlineKey(signal.cls, signal.waistWithinNoise))}</Text>
        <Text style={styles.recompBody} testID="recomp-slopes">
          {t('recomp.slopes', {
            w: signed(w, 2, locale),
            wu: metric ? 'kg' : 'lb',
            waist: signed(waist, 2, locale),
            se: formatNumber(se, locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
            lu: metric ? 'cm' : 'in',
            n: signal.tapes,
            // Says which window: the maintenance card above counts every tape
            // since the first, this one only the recent ones, and "5 tapes"
            // beside "3 tapes" read as a bug.
            days: RECOMP_WAIST_DAYS,
          })}
        </Text>
        {signal.waistWithinNoise ? (
          <Text style={styles.recompNote} testID="recomp-noise">{t('recomp.noise')}</Text>
        ) : null}
      </>
    );
  }

  // 2026-02-01 is a Sunday, so day `weekday` of that month is the weekday.
  const reminderAt = reminder ? new Date(2026, 1, reminder.weekday, reminder.hour, reminder.minute) : null;

  return (
    <View style={styles.recompCard} testID="recomp-card">
      {/* A header, so the rotor's Headings jump lands on it like every other
          card title on Trends. */}
      <Text style={styles.recompTitle} accessibilityRole="header">{t('recomp.title')}</Text>
      {body}
      <View style={styles.remindRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.remindLabel}>{t('recomp.remind')}</Text>
          {reminderAt ? (
            <Text style={styles.recompNote}>
              {t('recomp.remindOn', {
                day: formatDate(reminderAt, locale, { weekday: 'long' }),
                time: formatTime(reminderAt, locale),
              })}
            </Text>
          ) : null}
        </View>
        <Switch
          value={reminder != null}
          onValueChange={(v) => void toggle(v)}
          trackColor={{ true: colors.accent, false: colors.lineStrong }}
          accessibilityLabel={t('recomp.remind')}
          testID="recomp-remind"
        />
      </View>
      {problem ? (
        <Text style={styles.recompNote}>{t(problem === 'denied' ? 'recomp.remindDenied' : 'recomp.remindFailed')}</Text>
      ) : null}
      <Text style={styles.recompHow}>{t(female ? 'recomp.howHip' : 'recomp.how')}</Text>
    </View>
  );
}

const createStyles = ({ colors }: Theme) =>
  StyleSheet.create({
    compWrap: { gap: 2, marginTop: space.xs },
    compLine: { textAlign: 'center', color: colors.heroMuted, fontSize: font.tiny },
    compDetail: { textAlign: 'center', color: colors.heroMuted, fontSize: font.tiny, opacity: 0.8 },
    recompCard: {
      marginTop: space.md,
      backgroundColor: colors.card,
      borderWidth: 1,
      borderColor: colors.line,
      borderRadius: radius.lg,
      padding: space.lg,
      gap: space.xs,
    },
    recompTitle: { fontSize: font.small, fontWeight: '700', color: colors.muted, textTransform: 'uppercase', letterSpacing: 0.5 },
    recompClass: { fontSize: font.body, fontWeight: '700', color: colors.ink },
    recompBody: { fontSize: font.small, color: colors.muted },
    recompNote: { fontSize: font.tiny, color: colors.muted },
    remindRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, marginTop: space.sm },
    remindLabel: { fontSize: font.small, fontWeight: '600', color: colors.ink },
    recompHow: { fontSize: font.tiny, color: colors.faint, marginTop: space.xs },
  });
