import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { router, useLocalSearchParams, useScrollToTop } from 'expo-router';
import { Platform, RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import Animated from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  type Measurement,
  type UnitSystem,
  bodyWeightUnit,
  extremeSince,
  measureUnit,
  parseYmd,
  toDisplayMeasure,
  toDisplayWeight,
  trendMilestoneCrossed,
  trendStepLb,
} from '@macrolog/core';
import { BodyFatCard, fieldList } from '@/components/body/BodyFatCard';
import { BodyGlossary } from '@/components/body/BodyGlossary';
import { Glyph } from '@/components/charts/Glyph';
import { BodyIcon } from '@/components/body/BodyIcon';
import { BodySkeleton } from '@/components/body/BodySkeleton';
import { HealthFooter } from '@/components/body/HealthFooter';
import { HistoryRow } from '@/components/body/HistoryRow';
import { type HistorySection, HistorySheet } from '@/components/body/HistorySheet';
import { MEASURE_FIELDS, type MeasureKey, MeasurementSheet, measureLine } from '@/components/body/MeasurementSheet';
import { MeasurementSiteSheet } from '@/components/body/MeasurementSiteSheet';
import { MeasurementTrends } from '@/components/body/MeasurementTrends';
import { ROW_PREVIEW_WIDTH, RowPreview, rowPreviewHeight } from '@/components/body/RowPreview';
import { WeightChart } from '@/components/body/WeightChart';
import { WeightSheet } from '@/components/body/WeightSheet';
import { GoalMilestonePrompt } from '@/components/GoalMilestonePrompt';
import { MaintenanceSwitchCard } from '@/components/MaintenanceSwitchCard';
import { HeaderAvatar } from '@/components/HeaderAvatar';
import { OfflineBanner } from '@/components/OfflineBanner';
import { showToast } from '@/components/Toast';
import { type WeighIn, useBody } from '@/hooks/useBody';
import { useMilestoneRecord } from '@/hooks/useMilestones';
import { useAuth } from '@/lib/auth';
import { FEATURES, isFeatureOn } from '@/lib/features';
import { recordMilestone, switchToMaintenance } from '@/lib/ledger';
import { type I18nKey, type Locale, type TFn, useLocale, useT } from '@/i18n';
import { isMaintaining } from '@macrolog/core';
import * as haptics from '@/lib/haptics';
import { captureError } from '@/lib/sentry';
import { isAnySheetActive, onSheetsIdle } from '@/lib/sheet-portal';
import { announce } from '@/lib/a11y';
import { track } from '@/lib/analytics';
import { useUnitSystem } from '@/lib/use-unit-system';
import { CountUpText, enterUp, usePulse } from '@/lib/motion';
import { useTheme, useThemedStyles, type Theme } from '@/lib/theme-context';
import { font, radius, space, TARGET, type } from '@/theme';
import { formatDate, formatNumber, localeTag } from '@/lib/date-format';
import { TAB_SCROLL_BAND } from '@/lib/glass';
import { useLargeTitle } from '@/lib/font-scale';
import { Touchable } from '@/components/Touchable';

/**
 * Formatters cached per locale (Body review, Pf2). `toLocaleDateString` builds
 * an `Intl.DateTimeFormat` on every call, and the history renders one per row
 * per render.
 */
const DAY_FORMATS = new Map<Locale, Intl.DateTimeFormat>();
function dayLabel(dateKey: string, locale: Locale): string {
  let f = DAY_FORMATS.get(locale);
  if (!f) {
    try {
      f = new Intl.DateTimeFormat(localeTag(locale), {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
      });
      DAY_FORMATS.set(locale, f);
    } catch {
      return formatDate(parseYmd(dateKey), locale, { weekday: 'short', month: 'short', day: 'numeric' });
    }
  }
  return f.format(parseYmd(dateKey));
}

/** One decimal in the user's locale — "180.4", "81,8" (bug 13 / C2). Every
 *  number on this screen goes through here or `formatNumber`; the rows, the
 *  goal rail, the trend chip and the sheet preview used `toFixed` or the raw
 *  number and wrote a point where Brazil writes a comma. */
function wt(lb: number, unitSystem: UnitSystem, locale: Locale): string {
  return formatNumber(toDisplayWeight(lb, unitSystem), locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

/** "−0.8 lb/wk" / "+0.3 lb/sem" / "Holding steady" near zero. The rate unit is
 *  translated (`refine.paceUnit` — the same key Refine targets uses, so all
 *  three surfaces agree); it was hardcoded English until the Maestro suite's
 *  first es-PR pass rendered "lb/wk" beside Spanish copy. */
function trendLabel(slopeLbPerWeek: number, unitSystem: UnitSystem, t: TFn, locale: Locale): string {
  // The threshold stays in POUNDS: "holding steady" is a statement about the
  // measurement, not about how it is displayed, and converting it would make
  // the same weekly change read as steady in one unit and moving in the other.
  if (Math.abs(slopeLbPerWeek) < 0.1) return t('body.holdingSteady');
  const sign = slopeLbPerWeek < 0 ? '−' : '+';
  return `${sign}${wt(Math.abs(slopeLbPerWeek), unitSystem, locale)} ${bodyWeightUnit(unitSystem)}/${t('body.perWeek')}`;
}

/** The spoken direction of a series, for a chart's text alternative. The
 *  0.1 lb deadband is the same one `trendLabel` uses for "holding steady". */
export function trendKey(series: readonly (number | null | undefined)[]): I18nKey {
  const nums = series.filter((v): v is number => typeof v === 'number');
  if (nums.length < 2) return 'a11y.trend.flat';
  const d = nums[nums.length - 1] - nums[0];
  return d < -0.1 ? 'a11y.trend.down' : d > 0.1 ? 'a11y.trend.up' : 'a11y.trend.flat';
}

/** "Goal ~Jul 6" from a projected date key. */
function goalEtaLabel(dateKey: string, locale: Locale): string {
  return `~${formatDate(parseYmd(dateKey), locale, { month: 'short', day: 'numeric' })}`;
}

/** "September 2026" — the history sheet's month headers. */
function monthLabel(dateKey: string, locale: Locale): string {
  return formatDate(parseYmd(dateKey), locale, { month: 'long', year: 'numeric' });
}

function groupByMonth<T>(items: readonly T[], keyOf: (item: T) => string, locale: Locale): HistorySection<T>[] {
  const out: HistorySection<T>[] = [];
  let current: { ym: string; section: HistorySection<T> } | null = null;
  for (const item of items) {
    const key = keyOf(item);
    const ym = key.slice(0, 7);
    if (!current || current.ym !== ym) {
      current = { ym, section: { title: monthLabel(key, locale), data: [] } };
      out.push(current.section);
    }
    current.section.data.push(item);
  }
  return out;
}

/** Wait at most `ms` for a best-effort fact; the receipt must not hang on it. */
function within<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([p, new Promise<T>((r) => setTimeout(() => r(fallback), ms))]);
}

/** A stable stand-in for a missing `loadAllHistory` (stale mocks, partial
 *  cached state), so the chart's memo is not defeated by a fresh closure. */
const NO_OP = () => {};

/** The longest a history-sheet → editor hand-off waits for the first sheet to
 *  finish dismissing before opening anyway (see `fromSheet`). */
const SHEET_HANDOFF_MAX_MS = 1200;

/** Rows shown before "Show all". */
const MEASURE_PREVIEW = 4;
const WEIGH_PREVIEW = 8;

/** Remount boundary for Retry — see Today for why a `key` bump is the
 *  mechanism (the feed hooks expose no reload; UX_AUDIT S18-7). */
export default function Body() {
  const [attempt, setAttempt] = useState(0);
  return <BodyScreen key={attempt} onRetry={() => setAttempt((a) => a + 1)} />;
}

function BodyScreen({ onRetry }: { onRetry: () => void }) {
  const body = useBody();
  const {
    loading,
    error,
    currentWeight,
    todayWeight,
    setWeight,
    measurements,
    bodyFat,
    bodyFatGap,
    bodyFatMissing,
    bodyFatShown: bodyFatShownAny,
    addMeasurement,
    updateMeasurement,
    deleteMeasurement,
    projection,
    goalProgress,
    goalCrossed,
  } = body;
  // Defaults for every field added by the 2026-10-04 review, so a stale mock or
  // a partial cached state renders the old screen rather than throwing.
  const weighIns = body.weighIns ?? [];
  const weights = body.weights ?? {};
  const weightPoints = body.weightPoints ?? [];
  const trendPoints = body.trendPoints ?? [];
  const trendWeight = body.trendWeight ?? null;
  const consistency = body.consistency ?? null;
  const todayKey = body.todayKey ?? weighIns[0]?.dateKey ?? '';
  const latestKey = body.currentWeightDateKey ?? weighIns[0]?.dateKey ?? null;
  const weekAverage = body.weekAverage ?? null;
  // The chart is memoized; an inline `() => body.loadAllHistory?.()` was a new
  // prop every render and rebuilt its labels and audio graph each time a sheet
  // opened (Body re-score, bug 5).
  const loadAllHistory = body.loadAllHistory ?? NO_OP;

  const { user, profile, isAdmin } = useAuth();
  // ADR-0043: the measured body-fat field ships with composition maintenance.
  const showBodyFat = isFeatureOn(FEATURES.compositionMaintenance, { isAdmin });
  // Flag off → the card is what it was before ADR-0043: the Navy estimate
  // only, even when a measured value is stored on a row.
  const bodyFatShown = showBodyFat
    ? bodyFatShownAny
    : bodyFat != null
      ? ({ source: 'navy', pct: bodyFat } as const)
      : null;
  const milestones = useMilestoneRecord(user?.uid);
  const t = useT();
  const locale = useLocale();
  const styles = useThemedStyles(createStyles);
  const { colors } = useTheme();
  // Header wraps at accessibility sizes (`lib/font-scale.ts`, S21).
  const largeTitle = useLargeTitle();
  const unitSystem = useUnitSystem();
  const unit = bodyWeightUnit(unitSystem);
  const store = t(Platform.OS === 'ios' ? 'health.storeIos' : 'health.storeAndroid');

  // The weigh-in sheet: which day it opens on. A tapped row's day, or today.
  const [weightOpen, setWeightOpen] = useState(false);
  const [weightDay, setWeightDay] = useState<string>(todayKey);
  /** Text typed into the sheet on open — only Siri's "Log weight" sets it. */
  const [weighPrefill, setWeighPrefill] = useState<string | null>(null);
  const [measureOpen, setMeasureOpen] = useState(false);
  // Which saved row the sheet is editing; null = adding a new one. The sheet
  // reads its initial values from this, so add and edit stay one component.
  const [editing, setEditing] = useState<Measurement | null>(null);
  const [howOpen, setHowOpen] = useState(false);
  /** The tape site whose chart is open (`MeasurementSiteSheet`); null = none. */
  const [site, setSite] = useState<MeasureKey | null>(null);
  const { fontScale } = useWindowDimensions();
  const [allWeighIns, setAllWeighIns] = useState(false);
  const [allMeasures, setAllMeasures] = useState(false);
  const [glossaryOpen, setGlossaryOpen] = useState(false);

  // Re-tapping the focused Body tab scrolls back to the top, as Today and
  // Trends do (review 2026-10-06).
  const scrollRef = useRef<ScrollView>(null);
  useScrollToTop(scrollRef);
  // Pull-to-refresh: the listeners are live, so this re-runs only what is not
  // — the parked queue, a Health import, the goal's start line — and the
  // spinner holds until those settle.
  const [pulling, setPulling] = useState(false);
  const bodyRefresh = body.refresh;
  const onPullRefresh = useCallback(() => {
    setPulling(true);
    void (bodyRefresh ? bodyRefresh() : Promise.resolve())
      .catch(() => {})
      .finally(() => {
        setPulling(false);
        // A screen reader heard nothing when the spinner went away.
        announce(t('body.refreshed'));
      });
  }, [bodyRefresh, t]);

  function openMeasure(m: Measurement | null) {
    haptics.tap();
    setEditing(m);
    setMeasureOpen(true);
  }

  function openWeighIn(dateKey: string | null) {
    haptics.tap();
    setWeighPrefill(null);
    setWeightDay(dateKey ?? todayKey);
    setWeightOpen(true);
  }

  // Siri / Shortcuts "Log weight" (`targets/_shared/AppActionIntents.swift`,
  // routed here by Today's `useIntentInbox`): open today's weigh-in sheet,
  // prefilled with the spoken number when there was one. `weigh` is a nonce;
  // both params are cleared once handled so a later visit does not reopen it.
  // The number is in the unit Body displays, the same unit the field is in.
  const { weigh: weighParam, weighValue: weighValueParam } = useLocalSearchParams<{
    weigh?: string;
    weighValue?: string;
  }>();
  // Held until the first paint (re-score, bug 10): on a Siri cold start the
  // profile has not landed, and `todayKey` under the default boundary is
  // tomorrow's-yesterday between midnight and a 3 AM day start.
  useEffect(() => {
    if (!weighParam || loading) return;
    const n = Number(weighValueParam);
    // In the user's decimal mark, like every other prefill on this screen.
    // The number is already in the display unit, so it is not converted.
    setWeighPrefill(
      weighValueParam && Number.isFinite(n) && n > 0
        ? formatNumber(n, locale, { useGrouping: false, maximumFractionDigits: 1 })
        : null,
    );
    setWeightDay(todayKey);
    setWeightOpen(true);
    router.setParams({ weigh: undefined, weighValue: undefined });
  }, [weighParam, weighValueParam, todayKey, loading, locale]);

  /**
   * From inside a history sheet: close it first, then open the editor, so two
   * native sheets never race to present. It waited a fixed 350 ms, and a slow
   * dismissal (ProMotion off, a context menu still closing) let the push land
   * mid-transition, where iOS drops it — `weightOpen` true and no sheet
   * (re-score, bug 6). Now it opens when the portal says the last sheet has
   * actually gone, with a ceiling so a stuck dismissal cannot swallow the tap.
   * The JS sheet (Android) never registers with the portal; it keeps the delay.
   */
  function fromSheet(close: () => void, open: () => void) {
    close();
    if (!isAnySheetActive()) {
      setTimeout(open, 350);
      return;
    }
    let done = false;
    const once = () => {
      if (done) return;
      done = true;
      off();
      clearTimeout(timer);
      open();
    };
    const off = onSheetsIdle(once);
    const timer = setTimeout(once, SHEET_HANDOFF_MAX_MS);
  }

  // Celebration (ADR-0014): crossing the goal weight bounces the hero panel
  // once with a success haptic. Crossing-only (null-first ref, seeded once the
  // screen has data), so an already-reached goal doesn't celebrate every
  // visit. On the TREND crossing (`goalCrossed`), the same fact the milestone
  // prompt asks about — it fired on one light scale reading, and the next
  // morning said "0.6 lb to go" (re-score 3, bug 3).
  const [goalPulse, triggerGoalPulse] = usePulse(1.05);
  const prevCrossed = useRef<boolean | null>(null);
  useEffect(() => {
    if (loading) return;
    if (prevCrossed.current === false && goalCrossed) {
      haptics.success();
      triggerGoalPulse();
    }
    prevCrossed.current = goalCrossed;
  }, [loading, goalCrossed, triggerGoalPulse]);

  /** "Saved · trend −0.2 lb", the milestone it crossed (D2 + D3), or "lowest
   *  since Mar 4" (re-score 3, Delight) — in that order. */
  function weighInReceipt(
    before: number | null,
    after: number | null,
    extreme: { sinceKey: string | null } | null = null,
  ): string {
    if (before != null && after != null) {
      // The start goal progress measures from (bug 4) — it was the oldest
      // reading in a window that slides a day at a time.
      const start = body.startLb ?? trendPoints[0]?.weightLb ?? null;
      const dir = profile?.goalDirection === 'lose' || profile?.goalDirection === 'gain' ? profile.goalDirection : null;
      const step = trendStepLb(unitSystem);
      const crossed = start != null ? trendMilestoneCrossed(start, before, after, step, dir) : null;
      if (crossed != null) {
        // The pulse, not a second success haptic: the save already gave one
        // when the sheet closed, and two in a row read as a stutter (re-score
        // 3, Delight).
        triggerGoalPulse();
        const down = start != null && after < start;
        return t(down ? 'body.trendMilestoneDown' : 'body.trendMilestoneUp', {
          n: formatNumber(Math.round(toDisplayWeight(crossed * step, unitSystem)), locale),
          unit,
        });
      }
      if (extreme) {
        const gain = profile?.goalDirection === 'gain';
        if (extreme.sinceKey == null) return t(gain ? 'body.newHigh' : 'body.newLow');
        const date = formatDate(parseYmd(extreme.sinceKey), locale, { month: 'short', day: 'numeric' });
        return t(gain ? 'body.highestSince' : 'body.lowestSince', { date });
      }
      const d = toDisplayWeight(after, unitSystem) - toDisplayWeight(before, unitSystem);
      if (Math.abs(d) >= 0.05) {
        const sign = d < 0 ? '−' : '+';
        return t('body.savedTrend', {
          delta: `${sign}${formatNumber(Math.abs(d), locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}`,
          unit,
        });
      }
      return t('body.savedTrendFlat');
    }
    return t('body.weightSaved');
  }

  /**
   * `restore` is the Undo of a delete: the value goes back without a "lowest
   * since" claim, and `health` says whether to mirror it to Health — false
   * when the deleted value was a scale's, whose own sample never left Health
   * (re-score 3, bug 6; `setWeight`).
   */
  async function saveWeight(lb: number, dateKey: string, opts: { restore?: boolean; health?: boolean } = {}) {
    // A new low is judged against the map BEFORE this write, and only claimed
    // when the map is the whole history (an unloaded older year might hold a
    // lower reading).
    const dir = profile?.goalDirection === 'lose' || profile?.goalDirection === 'gain' ? profile.goalDirection : null;
    const found = opts.restore ? null : extremeSince(weights, dateKey, lb, dir);
    const extreme = found && (found.sinceKey != null || !body.hasOlderHistory) ? found : null;
    // Resolves once the weigh-in is parked on disk (bug 2); a throw here means
    // nothing was recorded and the sheet keeps the value.
    const receipt = opts.health === false ? await setWeight(lb, dateKey, { health: false }) : await setWeight(lb, dateKey);
    haptics.success();
    setWeightOpen(false);
    const landed = receipt?.landed ?? Promise.resolve('saved' as const);
    void landed.then((outcome) => {
      if (outcome === 'rejected') {
        haptics.warning();
        showToast(t('body.saveRejected'), { testID: 'body-toast' });
      } else if (outcome === 'queued') {
        showToast(t('offline.queued'), { testID: 'body-toast' });
      } else {
        showToast(weighInReceipt(receipt?.trend?.beforeLb ?? null, receipt?.trend?.afterLb ?? null, extreme), {
          testID: 'body-toast',
        });
      }
    });
  }

  /**
   * Delete, then offer Undo (U5) — no confirm in front of it. A weigh-in is
   * one number; the receipt says what was removed and from where (C4:
   * "Removed · also from Apple Health"), and Undo puts the same value back on
   * the same day.
   */
  async function removeWeighIn(w: WeighIn) {
    haptics.tap();
    try {
      const r = await body.deleteWeighIn(w.dateKey);
      const fromHealth = await within(r.fromHealth, 800, false);
      showToast(fromHealth ? t('body.weighInDeletedHealth', { store }) : t('body.weighInDeleted'), {
        action: {
          label: t('common.undo'),
          onPress: () => {
            // Back into Health only if it came out of Health: when the delete
            // removed no Ignia sample, the value was a scale's and its own
            // sample is still there — re-exporting would duplicate it.
            void r.fromHealth
              .catch(() => false)
              .then((removed) => saveWeight(w.weight, w.dateKey, { restore: true, health: removed }))
              .catch((e) => captureError(e, { where: 'body.undoDeleteWeighIn' }));
          },
        },
        testID: 'body-toast',
      });
      void r.landed.then((o) => {
        if (o === 'rejected') {
          haptics.warning();
          showToast(t('body.deleteFailed'), { testID: 'body-toast' });
        }
      });
    } catch (e) {
      // Bug 10: this failed silently.
      haptics.warning();
      showToast(t('body.deleteFailed'), { testID: 'body-toast' });
      captureError(e, { where: 'body.deleteWeighIn' });
    }
  }

  async function removeMeasurement(m: Measurement) {
    if (!m.id) return;
    haptics.tap();
    try {
      const r = await deleteMeasurement(m.id);
      showToast(t('body.measurementDeleted'), {
        action: {
          label: t('common.undo'),
          onPress: () => {
            void body.restoreMeasurement?.(m).catch((e) => captureError(e, { where: 'body.undoDeleteMeasurement' }));
          },
        },
        testID: 'body-toast',
      });
      void r?.landed?.then((o) => {
        if (o === 'rejected') {
          haptics.warning();
          showToast(t('body.deleteFailed'), { testID: 'body-toast' });
        }
      });
    } catch (e) {
      haptics.warning();
      showToast(t('body.deleteFailed'), { testID: 'body-toast' });
      captureError(e, { where: 'body.deleteMeasurement' });
    }
  }

  // ── Derived copy ──
  const heroCaption =
    currentWeight == null
      ? t('body.noWeightYet')
      : todayWeight != null
        ? t('body.todayWeighIn')
        : latestKey
          ? t('body.recentWeightOn', { date: formatDate(parseYmd(latestKey), locale, { month: 'short', day: 'numeric' }) })
          : t('body.recentWeight');

  const weighInSections = useMemo(
    () => (allWeighIns ? groupByMonth(weighIns, (w) => w.dateKey, locale) : []),
    [allWeighIns, weighIns, locale],
  );
  const measureSections = useMemo(
    () =>
      allMeasures
        ? groupByMonth(measurements, (m) => `${m.date.getFullYear()}-${String(m.date.getMonth() + 1).padStart(2, '0')}-01`, locale)
        : [],
    [allMeasures, measurements, locale],
  );

  function deltaText(d: number | null | undefined): { short: string; spoken: string } | null {
    if (d == null) return null;
    const shown = toDisplayWeight(Math.abs(d), unitSystem);
    if (shown < 0.05) return { short: '±0', spoken: t('body.deltaSame') };
    const n = formatNumber(shown, locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
    return d < 0
      ? { short: `−${n}`, spoken: t('body.deltaDown', { n, unit }) }
      : { short: `+${n}`, spoken: t('body.deltaUp', { n, unit }) };
  }

  function weighInRow(w: WeighIn, inSheet: boolean) {
    const delta = deltaText(w.deltaLb);
    // One fixed decimal, like the hero and the deltas: "181 lb" over
    // "180.4 lb" was a ragged column (re-score).
    const weight = `${wt(w.weight, unitSystem, locale)} ${unit}`;
    const previewLines = delta ? [t('body.previewDelta', { delta: delta.short, unit })] : [];
    return (
      <HistoryRow
        key={w.dateKey}
        label={t('body.weighInRowA11y', { date: dayLabel(w.dateKey, locale) })}
        value={delta ? `${weight}, ${delta.spoken}` : weight}
        preview={<RowPreview caption={dayLabel(w.dateKey, locale)} value={wt(w.weight, unitSystem, locale)} unit={unit} lines={previewLines} />}
        previewSize={{ width: ROW_PREVIEW_WIDTH, height: rowPreviewHeight(true, previewLines.length, fontScale) }}
        onEdit={() => (inSheet ? fromSheet(() => setAllWeighIns(false), () => openWeighIn(w.dateKey)) : openWeighIn(w.dateKey))}
        onDelete={() => void removeWeighIn(w)}
        testID={`weighin-${w.dateKey}`}
        deleteTestID={`weighin-delete-${w.dateKey}`}
      >
        <Text style={styles.rowDate}>{dayLabel(w.dateKey, locale)}</Text>
        <View style={styles.rowRight}>
          {/* Neutral, not green-for-down: whether a drop is good depends on
              the goal, and a colour that praises the wrong direction is worse
              than none. */}
          {delta ? <Text style={styles.rowDelta}>{delta.short}</Text> : null}
          <Text style={styles.rowWeight}>{weight}</Text>
        </View>
      </HistoryRow>
    );
  }

  /** One line per site on a tape row — the preview's body. */
  function measurePreviewLines(m: Measurement): string[] {
    const lines = MEASURE_FIELDS.flatMap((f) => {
      const v = m[f.key];
      return v == null ? [] : [`${t(f.labelKey)}  ${formatNumber(toDisplayMeasure(v, unitSystem), locale)} ${measureUnit(unitSystem)}`];
    });
    if (showBodyFat && m.bodyFatPct != null) lines.push(`${t('measure.bodyFat')}  ${formatNumber(m.bodyFatPct, locale)}%`);
    return lines.length ? lines : ['—'];
  }

  function measurementRow(m: Measurement, inSheet: boolean) {
    const date = formatDate(m.date, locale, { month: 'short', day: 'numeric' });
    const line = measureLine(m, t, unitSystem, showBodyFat, locale);
    const previewLines = measurePreviewLines(m);
    return (
      <HistoryRow
        key={m.id}
        label={t('body.measurementRowA11y', { date })}
        value={line}
        preview={<RowPreview caption={formatDate(m.date, locale, { weekday: 'short', month: 'short', day: 'numeric' })} lines={previewLines} />}
        previewSize={{ width: ROW_PREVIEW_WIDTH, height: rowPreviewHeight(false, previewLines.length, fontScale) }}
        onEdit={() => (inSheet ? fromSheet(() => setAllMeasures(false), () => openMeasure(m)) : openMeasure(m))}
        onDelete={() => void removeMeasurement(m)}
        testID={`measurement-${m.id}`}
        deleteTestID={`measurement-delete-${m.id}`}
      >
        <Text style={styles.rowDate}>{date}</Text>
        <Text style={styles.rowMeasure}>{line}</Text>
      </HistoryRow>
    );
  }

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={[styles.headerRow, largeTitle.rowStyle]}>
        {/* Capped like Today's title (A11): the display face at `font.h1`
            clips rather than wraps past this scale — until the accessibility
            sizes, where the title takes the row and shrinks to fit. */}
        <Text style={[styles.title, largeTitle.titleStyle]} accessibilityRole="header" {...largeTitle.titleProps}>
          {t('nav.body')}
        </Text>
        {/* The "?" Today, Trends and Train carry — same icon, same place —
            defining "Trend" and why it is not the latest weigh-in. */}
        <TouchableOpacity
          onPress={() => {
            haptics.tap();
            setGlossaryOpen(true);
          }}
          accessibilityRole="button"
          accessibilityLabel={t('body.glossaryOpen')}
          style={styles.headerHelp}
          testID="body-glossary-open"
        >
          <Glyph ios="questionmark.circle" android="help-circle-outline" size={24} color={colors.muted} />
        </TouchableOpacity>
        <HeaderAvatar />
      </View>
      <BodyGlossary visible={glossaryOpen} onClose={() => setGlossaryOpen(false)} />
      {loading ? (
        <BodySkeleton />
      ) : (
        <ScrollView
          ref={scrollRef}
          testID="body-scroll"
          contentContainerStyle={styles.body}
          refreshControl={<RefreshControl refreshing={pulling} onRefresh={onPullRefresh} tintColor={colors.muted} colors={[colors.accent]} />}
        >
          {error ? (
            <View style={styles.errorRow} accessibilityRole="alert" accessibilityLiveRegion="polite">
              <Text style={styles.error}>{t('body.loadErr')}</Text>
              <Touchable
                onPress={onRetry}
                style={styles.retryBtn}
                accessibilityRole="button"
                accessibilityLabel={t('common.retry')}
                testID="retry"
              >
                <Text style={styles.retryText}>{t('common.retry')}</Text>
              </Touchable>
            </View>
          ) : null}

          {/* A state readout, same slot it has on Today (UX_AUDIT S18-12). */}
          <OfflineBanner />

          <Animated.View entering={enterUp(0)}>
            <Animated.View style={[styles.heroPanel, goalPulse]} testID="body-hero">
              {/* The number is the thing people try to tap (2026-09-11), so it
                  opens the same sheet the button does; the counter says how
                  often that route is taken. */}
              <Touchable
                style={styles.hero}
                onPress={() => {
                  track('body_hero_tap');
                  openWeighIn(null);
                }}
                accessibilityRole="button"
                accessibilityLabel={todayWeight != null ? t('body.updateWeight') : t('body.logWeight')}
                // `CountUpText` is a TextInput under the hood, which VoiceOver
                // reads as an edit box; the value on the button is what a reader
                // actually gets (UX_AUDIT S18-5).
                accessibilityValue={{
                  text:
                    currentWeight != null
                      ? `${wt(currentWeight, unitSystem, locale)} ${unit}`
                      : t('body.noWeightYet'),
                }}
                testID="body-hero-tap"
              >
                {currentWeight != null ? (
                  <CountUpText
                    value={toDisplayWeight(currentWeight, unitSystem)}
                    decimals={1}
                    style={styles.heroValue}
                    testID="current-weight"
                  />
                ) : (
                  // Same style AND the same font-scale cap as `CountUpText`
                  // (A11), so the dash sits where the number will.
                  <Text style={styles.heroValue} maxFontSizeMultiplier={1.4} testID="current-weight">
                    —
                  </Text>
                )}
                <Text style={styles.heroUnit} maxFontSizeMultiplier={1.4}>{unit}</Text>
              </Touchable>
              <Text style={styles.heroCaption} testID="hero-caption">
                {heroCaption}
              </Text>

              {/* The trend weight beside the scale weight (U3): the scale says
                  what the water did overnight, the trend says what the body
                  did. Needs two readings before it says anything new. */}
              {/* When the two print the same number, the second one says so in
                  words instead of repeating it ("177.5" over "Trend 177.5 lb",
                  review 2026-10-06). */}
              {trendWeight != null && weightPoints.length >= 2 ? (
                currentWeight != null && wt(trendWeight, unitSystem, locale) === wt(currentWeight, unitSystem, locale) ? (
                  <Text style={styles.trendHeadline} testID="trend-weight">
                    {t('body.trendSame')}
                  </Text>
                ) : (
                  <Text
                    style={styles.trendHeadline}
                    accessibilityLabel={t('body.trendWeightA11y', { n: wt(trendWeight, unitSystem, locale), unit })}
                    testID="trend-weight"
                  >
                    {t('body.trend')} <Text style={styles.trendHeadlineValue}>{wt(trendWeight, unitSystem, locale)} {unit}</Text>
                  </Text>
                )
              ) : null}

              {weightPoints.length >= 2 ? (
                <View style={styles.chartWrap} testID="weight-chart">
                  <WeightChart
                    points={weightPoints}
                    trend={trendPoints}
                    todayKey={todayKey}
                    goalLb={body.goalWeight ?? null}
                    slopeLbPerWeek={projection?.slopeLbPerWeek ?? null}
                    unitSystem={unitSystem}
                    hasOlderHistory={body.hasOlderHistory ?? false}
                    onNeedAll={loadAllHistory}
                    testID="weight-chart-plot"
                  />
                  {/* The caption explaining the dash lives in the chart now,
                      which knows when the dash is drawn (re-score 3, bug 4). */}
                </View>
              ) : null}

              {projection || weekAverage ? (
                <View style={styles.trendChips} testID="trend-card">
                  {/* The week's plain average (re-score): the number people
                      check a week against, which the lagging trend is not. */}
                  {weekAverage ? (
                    <Text style={styles.trendChip} testID="week-average">
                      {t('body.weekAvg')}  <Text style={styles.trendChipValue}>{wt(weekAverage.avgLb, unitSystem, locale)} {unit}</Text>
                    </Text>
                  ) : null}
                  {projection ? (
                    <Text style={styles.trendChip}>
                      {t('body.pace')}  <Text style={styles.trendChipValue}>{trendLabel(projection.slopeLbPerWeek, unitSystem, t, locale)}</Text>
                    </Text>
                  ) : null}
                  {projection?.goalDateKey ? (
                    <Text style={styles.trendChip}>
                      {t('body.goalPace')}  <Text style={styles.trendChipValue}>{goalEtaLabel(projection.goalDateKey, locale)}</Text>
                    </Text>
                  ) : null}
                </View>
              ) : null}

              {/* D1: a count, never a streak — a streak punishes one missed
                  morning, which is the person a trend line forgives. */}
              {consistency && consistency.logged > 0 ? (
                <Text style={styles.consistency} testID="weigh-in-consistency">
                  {t('body.consistency', {
                    n: formatNumber(consistency.logged, locale),
                    days: formatNumber(consistency.days, locale),
                  })}
                </Text>
              ) : null}

              {goalProgress ? (
                <View style={styles.goalWrap} testID="goal-card">
                  <View style={styles.goalHead}>
                    <Text style={styles.goalStart}>{wt(goalProgress.startWeight, unitSystem, locale)} {unit}</Text>
                    <Text style={styles.goalPct}>{formatNumber(goalProgress.pct, locale)}%</Text>
                    <Text style={styles.goalEnd}>{wt(goalProgress.goalWeight, unitSystem, locale)} {unit}</Text>
                  </View>
                  {/* A real progress bar to assistive tech (A10), not two
                      unlabelled boxes. */}
                  <View
                    style={styles.goalTrack}
                    accessible
                    accessibilityRole="progressbar"
                    accessibilityLabel={t('body.goalProgressA11y')}
                    accessibilityValue={{ min: 0, max: 100, now: goalProgress.pct, text: `${formatNumber(goalProgress.pct, locale)}%` }}
                    testID="goal-progress"
                  >
                    <View style={[styles.goalFill, { width: `${goalProgress.pct}%` }]} />
                  </View>
                  <Text style={styles.goalRemaining}>
                    {goalProgress.remaining > 0
                      ? t('body.goalRemaining', { n: wt(goalProgress.remaining, unitSystem, locale), unit })
                      : t('body.goalReached')}
                  </Text>
                </View>
              ) : null}
            </Animated.View>
          </Animated.View>

          {/* The `goal-reached` milestone needs a human, because the schema
              cannot supply one: `dailyWeights` carries no `source` (#110). */}
          <GoalMilestonePrompt
            visible={goalCrossed && !milestones.earned['goal-reached']}
            onConfirm={() => {
              if (user?.uid) void recordMilestone(user.uid, 'goal-reached');
            }}
          />

          {/* Only once the milestone is on record — see `maintenance-mode.ts`. */}
          <MaintenanceSwitchCard
            visible={goalCrossed && !!milestones.earned['goal-reached'] && !isMaintaining(profile) && goalProgress != null}
            onSwitch={async () => {
              if (!user?.uid || !profile || !goalProgress) return;
              await switchToMaintenance(user.uid, profile, goalProgress.currentWeight);
            }}
          />

          <Animated.View entering={enterUp(1)}>
            <Touchable
              style={styles.logBtn}
              onPress={() => openWeighIn(null)}
              accessibilityRole="button"
              testID="log-weight"
            >
              <Text style={styles.logBtnText}>{todayWeight != null ? t('body.updateWeight') : t('body.logWeight')}</Text>
            </Touchable>
          </Animated.View>

          <BodyFatCard shown={bodyFatShown} navyPct={bodyFat} gap={bodyFatGap} missing={bodyFatMissing ?? []} />

          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle} accessibilityRole="header">{t('body.measurements')}</Text>
            {/* A real bordered button with a 44 pt target (V3 / A7), not a
                teal word with an 8 pt slop. */}
            <Touchable
              onPress={() => openMeasure(null)}
              style={styles.addBtn}
              accessibilityRole="button"
              accessibilityLabel={t('body.addMeasurement')}
              testID="add-measurement"
            >
              <BodyIcon sf="plus" ion="add" size={16} color={colors.ink} />
              <Text style={styles.addBtnText}>{t('body.add')}</Text>
            </Touchable>
          </View>
          {/* Per-site trends once a site has two readings (re-score). */}
          <MeasurementTrends
            measurements={measurements}
            unitSystem={unitSystem}
            onOpen={(k) => {
              haptics.tap();
              setSite(k);
            }}
          />
          {/* Says what a tape measurement is FOR before asking for one. */}
          <Text style={styles.sectionHint}>{t('body.measureIntro')}</Text>
          <TouchableOpacity
            onPress={() => setHowOpen((v) => !v)}
            style={styles.disclosure}
            accessibilityRole="button"
            accessibilityState={{ expanded: howOpen }}
            testID="measure-how-toggle"
          >
            <Text style={styles.link}>{howOpen ? t('body.howToMeasureHide') : t('body.howToMeasure')}</Text>
            <BodyIcon sf={howOpen ? 'chevron.up' : 'chevron.down'} ion={howOpen ? 'chevron-up' : 'chevron-down'} size={14} color={colors.teal} />
          </TouchableOpacity>
          {howOpen ? (
            <View style={styles.howBox} testID="measure-how">
              <Text style={styles.howLine}>{t('body.howWaist')}</Text>
              <Text style={styles.howLine}>{t('body.howNeck')}</Text>
              <Text style={styles.howLine}>{t('body.howHip')}</Text>
              <Text style={styles.howLine}>{t('body.howChest')}</Text>
              <Text style={styles.howLine}>{t('body.howBicep')}</Text>
              <Text style={styles.howFoot}>{t('body.howConsistency')}</Text>
            </View>
          ) : null}
          {measurements.length === 0 ? (
            <Text style={styles.empty} testID="no-measurements">
              {t('body.noMeasurements', {
                unit: t(unitSystem === 'metric' ? 'body.unitCmLong' : 'body.unitInLong'),
                // Bug 8: named from the formula's real inputs for THIS user —
                // a woman's estimate also needs hip.
                fields: fieldList(bodyFatMissing?.length ? bodyFatMissing : ['waist', 'neck'], t),
              })}
            </Text>
          ) : (
            <View style={styles.list}>
              {measurements.slice(0, MEASURE_PREVIEW).map((m) => measurementRow(m, false))}
              {measurements.length > MEASURE_PREVIEW ? (
                <TouchableOpacity
                  onPress={() => setAllMeasures(true)}
                  style={styles.showMore}
                  accessibilityRole="button"
                  testID="measurements-show-all"
                >
                  <Text style={styles.link}>{t('body.showAllCount', { n: formatNumber(measurements.length, locale) })}</Text>
                </TouchableOpacity>
              ) : null}
            </View>
          )}

          <Text style={styles.sectionTitle} accessibilityRole="header">{t('body.history')}</Text>
          {weighIns.length === 0 ? (
            <Text style={styles.empty}>{t('body.noWeighIns')}</Text>
          ) : (
            <View style={styles.list}>
              {weighIns.slice(0, WEIGH_PREVIEW).map((w) => weighInRow(w, false))}
              {weighIns.length > WEIGH_PREVIEW ? (
                <TouchableOpacity
                  onPress={() => setAllWeighIns(true)}
                  style={styles.showMore}
                  accessibilityRole="button"
                  testID="weighins-show-all"
                >
                  <Text style={styles.link}>{t('body.showAllCount', { n: formatNumber(weighIns.length, locale) })}</Text>
                </TouchableOpacity>
              ) : null}
            </View>
          )}

          <HealthFooter />
        </ScrollView>
      )}

      <WeightSheet
        visible={weightOpen}
        initialDateKey={weightDay || todayKey}
        todayKey={todayKey}
        weights={weights}
        unitSystem={unitSystem}
        initialText={weighPrefill}
        onClose={() => setWeightOpen(false)}
        onSave={(lb, key) => saveWeight(lb, key)}
        onDelete={(key) => {
          const lb = weights[key];
          setWeightOpen(false);
          if (lb != null) void removeWeighIn({ dateKey: key, weight: lb });
        }}
      />

      <MeasurementSheet
        visible={measureOpen}
        unitSystem={unitSystem}
        showBodyFat={showBodyFat}
        initial={editing}
        latest={measurements}
        todayKey={todayKey}
        onClose={() => setMeasureOpen(false)}
        onDelete={(m) => {
          setMeasureOpen(false);
          void removeMeasurement(m);
        }}
        onSave={async (entry, date) => {
          // `date` only when the stepper moved the row: an edit that did not
          // must not restate the row's timestamp.
          const r = editing?.id
            ? date
              ? await updateMeasurement(editing.id, entry, date)
              : await updateMeasurement(editing.id, entry)
            : await addMeasurement(entry, date);
          haptics.success();
          setMeasureOpen(false);
          void r?.landed?.then((o) => {
            if (o === 'rejected') {
              haptics.warning();
              showToast(t('body.saveRejected'), { testID: 'body-toast' });
            } else {
              showToast(o === 'queued' ? t('offline.queued') : t('body.measurementSaved'), { testID: 'body-toast' });
            }
          });
        }}
      />

      <MeasurementSiteSheet site={site} measurements={measurements} unitSystem={unitSystem} onClose={() => setSite(null)} />

      <HistorySheet
        visible={allWeighIns}
        onClose={() => setAllWeighIns(false)}
        title={t('body.historyTitle')}
        sections={weighInSections}
        keyOf={(w) => w.dateKey}
        renderItem={(w) => weighInRow(w, true)}
        testID="weighins-all"
      />
      <HistorySheet
        visible={allMeasures}
        onClose={() => setAllMeasures(false)}
        title={t('body.measurementsTitle')}
        sections={measureSections}
        keyOf={(m) => m.id ?? String(m.date.getTime())}
        renderItem={(m) => measurementRow(m, true)}
        testID="measurements-all"
      />
    </SafeAreaView>
  );
}

const createStyles = ({ colors, shadow }: Theme) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.paper },
  title: { fontFamily: type.display, fontSize: font.h1, color: colors.ink, paddingHorizontal: space.xl, paddingTop: space.md },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingRight: space.xl },
  // Pushed against the avatar, as on Trends; a real 44/48 target rather than
  // a 24 pt glyph with slop.
  headerHelp: { marginLeft: 'auto', marginRight: space.xs, minWidth: TARGET, minHeight: TARGET, alignItems: 'center', justifyContent: 'center' },
  showMore: { minHeight: TARGET, alignItems: 'center', justifyContent: 'center' },
  // See FAB_BAND — the + button overhangs every tab's scroll area.
  body: { padding: space.xl, paddingBottom: TAB_SCROLL_BAND, gap: space.md },
  error: { color: colors.danger, fontSize: font.small, flex: 1 },
  errorRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  retryBtn: { borderWidth: 1, borderColor: colors.ink, borderRadius: radius.pill, paddingHorizontal: space.md, minHeight: TARGET, justifyContent: 'center' },
  retryText: { fontSize: font.small, fontWeight: '700', color: colors.ink },
  // Hero panel — the Today skeleton (ADR-0014 §7): shared dark canvas so the
  // coral trend line glows identically in both themes.
  heroPanel: {
    backgroundColor: colors.heroPanel,
    borderRadius: radius.xl,
    paddingVertical: space.xl,
    paddingHorizontal: space.lg,
    alignItems: 'center',
    gap: space.sm,
    ...shadow.e2,
  },
  hero: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'center', gap: space.xs },
  heroValue: { fontFamily: type.display, fontSize: 56, color: colors.heroText, lineHeight: 60 },
  heroUnit: { fontSize: font.h2, color: colors.heroMuted, marginBottom: space.sm },
  heroCaption: { textAlign: 'center', color: colors.heroMuted, fontSize: font.small },
  trendHeadline: { textAlign: 'center', color: colors.heroMuted, fontSize: font.body },
  trendHeadlineValue: { color: colors.heroText, fontFamily: type.heading },
  chartWrap: { alignSelf: 'stretch', marginTop: space.xs },
  consistency: { textAlign: 'center', color: colors.heroMuted, fontSize: font.small },
  trendChips: { flexDirection: 'row', gap: space.sm, flexWrap: 'wrap', justifyContent: 'center' },
  trendChip: {
    fontSize: font.small,
    color: colors.heroMuted,
    backgroundColor: colors.heroTrack,
    borderRadius: radius.pill,
    paddingHorizontal: space.md,
    paddingVertical: space.xs,
    overflow: 'hidden',
  },
  trendChipValue: { color: colors.heroText, fontFamily: type.heading },
  goalWrap: { alignSelf: 'stretch', gap: space.sm, marginTop: space.xs },
  logBtn: {
    backgroundColor: colors.ink,
    borderRadius: radius.md,
    paddingVertical: space.lg,
    alignItems: 'center',
    marginTop: space.md,
  },
  logBtnText: { color: colors.onInk, fontWeight: '700', fontSize: font.h3 },
  goalHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  goalStart: { fontSize: font.small, color: colors.heroMuted },
  goalPct: { fontSize: font.body, color: colors.heroText, fontFamily: type.heading },
  goalEnd: { fontSize: font.small, color: colors.heroMuted },
  goalTrack: { height: 8, borderRadius: radius.pill, backgroundColor: colors.heroTrack, overflow: 'hidden' },
  goalFill: { height: '100%', borderRadius: radius.pill, backgroundColor: colors.ring },
  goalRemaining: { fontSize: font.small, color: colors.heroMuted, textAlign: 'center' },
  sectionTitle: { fontFamily: type.heading, fontSize: font.h3, color: colors.ink, marginTop: space.md },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: space.md },
  addBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    minHeight: TARGET,
    paddingHorizontal: space.md,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.lineStrong,
    marginTop: space.md,
  },
  addBtnText: { fontSize: font.small, color: colors.ink, fontWeight: '700' },
  empty: { fontSize: font.small, color: colors.muted },
  link: { fontSize: font.small, color: colors.teal, fontWeight: '700' },
  disclosure: { flexDirection: 'row', alignItems: 'center', gap: space.xs, minHeight: TARGET, alignSelf: 'flex-start' },
  sectionHint: { fontSize: font.small, color: colors.muted, lineHeight: font.small * 1.5 },
  howBox: {
    backgroundColor: colors.card,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.line,
    padding: space.md,
    gap: space.xs,
  },
  howLine: { fontSize: font.small, color: colors.ink, lineHeight: font.small * 1.5 },
  howFoot: { fontSize: font.tiny, color: colors.muted, lineHeight: font.tiny * 1.5, marginTop: space.xs },
  list: { gap: space.sm },
  rowDate: { fontSize: font.body, color: colors.muted },
  rowRight: { flexDirection: 'row', alignItems: 'baseline', gap: space.sm, flexShrink: 1 },
  rowWeight: { fontSize: font.body, fontWeight: '700', color: colors.ink },
  rowDelta: { fontSize: font.small, color: colors.muted, fontWeight: '600' },
  rowMeasure: { fontSize: font.small, fontWeight: '600', color: colors.ink, flexShrink: 1, textAlign: 'right' },
});
