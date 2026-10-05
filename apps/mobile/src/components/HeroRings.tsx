import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useRef, useState } from 'react';
import {
  Animated as RNAnimated,
  Easing as RNEasing,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import Animated, {
  Easing,
  useAnimatedProps,
  useReducedMotion,
  useSharedValue,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import type { MaintenanceView, MeasurementProgress } from '@macrolog/core';
import { useLocale, useT } from '@/i18n';
import { plural } from '@/i18n/grammar';
import { formatNumber } from '@/lib/date-format';
import * as haptics from '@/lib/haptics';
import { CountUpText, PressScale } from '@/lib/motion';
import { useTheme, useThemedStyles, type Theme } from '@/lib/theme-context';
import { font, motion, radius, space, type } from '@/theme';

const AnimatedCircle = Animated.createAnimatedComponent(Circle);
const RNAnimatedCircle = RNAnimated.createAnimatedComponent(Circle);

const SIZE = 236;
const OUTER_STROKE = 15;
const INNER_STROKE = 12;
const OUTER_R = (SIZE - OUTER_STROKE) / 2;
const INNER_R = OUTER_R - OUTER_STROKE - 7;
/**
 * How wide the centre text may be and still sit INSIDE the inner ring.
 *
 * The inner track's inside edge is a circle of radius `INNER_R - INNER_STROKE/2`
 * (82.5dp, a 165dp hole). A text block ~70dp tall fits a chord of
 * 2·√(82.5² − 35²) ≈ 149dp at its top and bottom edges, so 148 keeps every
 * corner of the block off the track. Before this the centre was the whole
 * 236dp square, and at large text sizes "kcal left" ran across the ring
 * (UX_AUDIT Today review #5).
 */
const CENTER_MAX_W = 148;
/** Text scale from which the legend stacks — the two entries no longer fit
 *  side by side in the panel at 360dp. */
const STACK_AT_FONT_SCALE = 1.35;

/** `#rrggbb` → `rgba(…, a)`. The ring tracks are each ring's own hue, faint. */
function withAlpha(hex: string, a: number): string {
  const n = parseInt(hex.replace('#', '').slice(0, 6), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

/**
 * Track alpha. A shared `heroTrack` grey sat at 1.29:1 against the panel and
 * the empty ring all but vanished; a 22% wash of each ring's own colour reads
 * as "the rest of this ring" rather than as a separate grey circle, and keeps
 * the two rings distinguishable before either has any fill (review V2).
 */
const TRACK_ALPHA = 0.22;

/**
 * A ring change smaller than this (a fraction of the whole ring) jumps instead
 * of sweeping. The sweep is core Animated on the JS thread (see `Ring`), two
 * rings for ~600 ms after every add, and it ran while the add sheet was still
 * dismissing — for a 30 kcal coffee that moved the arc by a hair nobody could
 * see (Today re-score, Performance). A change you can see still sweeps.
 */
export const SWEEP_MIN_DELTA = 0.02;

/** Whether moving a ring from `prev` to `next` is worth a sweep. The first
 *  value (mount, `prev` null) always sweeps — that is the hero's entrance.
 *  Exported for test. */
export function sweeps(prev: number | null, next: number): boolean {
  return prev === null || Math.abs(next - prev) >= SWEEP_MIN_DELTA;
}

/** How close to the calorie target counts as "landed": ±5%. */
export const CALORIE_BAND = 0.05;

/**
 * Whether the calorie ring just came INTO the band around its target — the
 * outer ring's flare (Today re-score, Delight). Only the crossing: a day that
 * mounts already inside the band does not flare, and neither does a step
 * that stays inside it. From either side, deliberately — a correction down
 * into the band is the same landing as an add up into it, so the flare marks
 * arriving, not eating (UX_AUDIT "Adherence-neutral colors"). No target, no
 * band. Exported for test.
 */
export function enteredCalorieBand(prev: number | null, next: number, target: number): boolean {
  if (prev === null || !(target > 0)) return false;
  const inBand = (kcal: number) => Math.abs(kcal / target - 1) <= CALORIE_BAND;
  return !inBand(prev) && inBand(next);
}

interface RingProps {
  r: number;
  stroke: number;
  trackColor: string;
  color: string;
  /** 0..1 (clamped). */
  progress: number;
  delay: number;
}

/** One hero ring: sweeps to `progress` on mount and eases to each new value.
 *  Jumps under reduce motion. */
function Ring({ r, stroke, trackColor, color, progress, delay }: RingProps) {
  const c = 2 * Math.PI * r;
  const p = Math.max(0, Math.min(1, Number.isFinite(progress) ? progress : 0));
  const reduce = useReducedMotion();
  // Core Animated, NOT Reanimated. Reanimated animated-PROP updates never reach
  // react-native-svg on iOS under Fabric (measured on builds 58 and 60,
  // 2026-08-19): the first computed value lands and every update after it is
  // dropped, so strokeDashoffset stayed at `c` — a full-circumference dash
  // offset, the stroke entirely dashed away — and the ring read as EMPTY. The
  // first fix here traded the sweep away and drew a static arc; this keeps the
  // sweep AND renders, on both platforms, with no platform fork.
  //
  // Do not "fix" the original by seeding the shared value with `p`: that value
  // still has to travel the same broken update path.
  //
  // CountUpText stays on Reanimated on purpose — its target is
  // AnimatedTextInput, a core RN component, and it animates correctly there.
  // That contrast is what located the fault in react-native-svg rather than in
  // Reanimated.
  //
  // A lazy `useState`, not `useRef(...).current`: reading a ref during render
  // made the React Compiler skip this component and, with it, the hero.
  const [anim] = useState(() => new RNAnimated.Value(0));
  // The last value this ring settled toward, for `sweeps`. Read and written in
  // the effect only — never during render (React Compiler).
  const last = useRef<number | null>(null);
  useEffect(() => {
    const sweep = sweeps(last.current, p);
    last.current = p;
    if (reduce || !sweep) {
      anim.setValue(p);
      return;
    }
    const run = RNAnimated.timing(anim, {
      toValue: p,
      duration: motion.dur.slow * 2,
      delay,
      easing: RNEasing.out(RNEasing.cubic),
      // MUST stay false. The native driver only handles transform and opacity;
      // strokeDashoffset is neither, and `true` silently animates nothing.
      useNativeDriver: false,
    });
    run.start();
    return () => run.stop();
  }, [p, delay, reduce, anim]);
  const dashoffset = anim.interpolate({ inputRange: [0, 1], outputRange: [c, 0] });
  return (
    <>
      <Circle cx={SIZE / 2} cy={SIZE / 2} r={r} stroke={trackColor} strokeWidth={stroke} fill="none" />
      <RNAnimatedCircle
        cx={SIZE / 2}
        cy={SIZE / 2}
        r={r}
        stroke={color}
        strokeWidth={stroke}
        fill="none"
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={dashoffset}
        transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}
      />
    </>
  );
}

interface Props {
  calConsumed: number;
  calTarget: number;
  protConsumed: number;
  protTarget: number;
  carbs: number;
  fat: number;
  /** Today's intake against MEASURED burn, or null when there is nothing
   *  honest to show. Rendered as a footer inside this panel. */
  maintenance: MaintenanceView | null;
  /** How far a NOT-yet-measured account is from its first measured burn, or
   *  null once measured mode is open. Takes the same footer slot as
   *  `maintenance`; the two are never both non-null (core guarantees it). */
  progress?: MeasurementProgress | null;
  /** A tap on the rings — Today opens the numbers glossary. */
  onPress?: () => void;
  /** Share this progress; draws the share button in the panel's corner. */
  onShare?: () => void;
  /** A share is being captured — the button is busy. */
  sharing?: boolean;
}

/**
 * The Today hero (ADR-0014): the app icon come to life. One concentric
 * dual-ring element — calories outer, protein inner — on the shared dark
 * hero panel, remaining-kcal count-up in the center. The choreography is the
 * icon's sweep: outer first, inner ~180ms behind. Carbs/fat have no targets
 * in the domain, so they render as value chips, never progress.
 */
export function HeroRings({
  calConsumed,
  calTarget,
  protConsumed,
  protTarget,
  carbs,
  fat,
  maintenance,
  progress = null,
  onPress,
  onShare,
  sharing = false,
}: Props) {
  const t = useT();
  const locale = useLocale();
  const styles = useThemedStyles(createStyles);
  const { colors } = useTheme();
  const reduce = useReducedMotion();
  const { fontScale } = useWindowDimensions();
  const stackLegend = fontScale >= STACK_AT_FONT_SCALE;
  const calRemaining = calTarget - calConsumed;
  const over = calRemaining < 0;
  const g = (n: number) => t('unit.grams', { n: formatNumber(n, locale) });

  // Celebration: hitting the protein target flares the inner ring once —
  // a glow halo swells and fades. Fires only on the crossing (null-first ref
  // so a day that ALREADY met the target doesn't flare on mount). Reduce
  // motion skips the glow and keeps the haptic.
  //
  // The haptic is `celebrateIfQuiet`, not its own beat: the crossing is
  // almost always caused by a save, and Today plays the save's haptic as the
  // celebration when it can see the crossing coming. This one only fires for
  // a crossing nobody here caused (an edit, a widget add) — one log, one
  // haptic (review #7).
  const flare = useSharedValue(0);
  const prevProt = useRef<number | null>(null);
  useEffect(() => {
    const p = protTarget ? protConsumed / protTarget : 0;
    if (prevProt.current !== null && prevProt.current < 1 && p >= 1) {
      haptics.celebrateIfQuiet();
      if (!reduce) {
        flare.set(
          withSequence(
            withTiming(1, { duration: motion.dur.base, easing: Easing.out(Easing.cubic) }),
            withTiming(0, { duration: motion.dur.slow * 2, easing: Easing.out(Easing.cubic) }),
          ),
        );
      }
    }
    prevProt.current = p;
  }, [protConsumed, protTarget, reduce, flare]);
  const flareProps = useAnimatedProps(() => ({ opacity: flare.value * 0.35 }));

  // The calorie ring's own, softer flare: on coming into ±5% of the target
  // (`enteredCalorieBand`). It used to be only the protein ring that marked
  // anything. No haptic of its own — the save that caused it already played
  // one, and "landed near the number" is not a moment worth a second buzz.
  const calFlare = useSharedValue(0);
  const prevCal = useRef<number | null>(null);
  useEffect(() => {
    if (enteredCalorieBand(prevCal.current, calConsumed, calTarget) && !reduce) {
      calFlare.set(
        withSequence(
          withTiming(1, { duration: motion.dur.base, easing: Easing.out(Easing.cubic) }),
          withTiming(0, { duration: motion.dur.slow * 2, easing: Easing.out(Easing.cubic) }),
        ),
      );
    }
    prevCal.current = calConsumed;
  }, [calConsumed, calTarget, reduce, calFlare]);
  const calFlareProps = useAnimatedProps(() => ({ opacity: calFlare.value * 0.25 }));

  const sentence = [
    t(over ? 'a11y.heroOver' : 'a11y.heroLeft', {
      kcal: formatNumber(calConsumed, locale),
      kcalTarget: formatNumber(calTarget, locale),
      n: formatNumber(Math.abs(calRemaining), locale),
      protein: formatNumber(protConsumed, locale),
      proteinTarget: formatNumber(protTarget, locale),
    }),
    t('a11y.heroMacros', { carbs: formatNumber(carbs, locale), fat: formatNumber(fat, locale) }),
  ].join(', ');

  return (
    <View style={styles.panel} testID="hero-rings">
      {/* One announcement for the whole ring element (S18-5). `CountUpText` is
          a TextInput under the hood and VoiceOver reads it as an edit box; the
          SVG arcs say nothing at all. So the wrap is the accessible node with
          the sentence, and everything inside it is hidden from the tree. */}
      {/* The remaining/over figure is the ring's headline — the big number in
          its centre — so the spoken sentence carries it too. It used to read
          only "1,200 of 2,000 kcal" and leave the subtraction to the listener.
          Carbs and fat ride on the end, so the legend and the chips below can
          be hidden: they said the same numbers again, one swipe at a time. */}
      {/* A button when Today gives it somewhere to go: tapping the rings
          explains them (Today re-score — on Apple Fitness the rings drill in;
          here they did nothing). Same node, same sentence, plus a hint. */}
      <PressScale
        style={styles.ringWrap}
        scaleTo={0.98}
        ripple={false}
        onPress={onPress}
        accessible
        accessibilityRole={onPress ? 'button' : undefined}
        accessibilityLabel={sentence}
        accessibilityHint={onPress ? t('today.heroHint') : undefined}
        importantForAccessibility="no-hide-descendants"
        testID="hero-rings-open"
      >
        <Svg width={SIZE} height={SIZE}>
          {/* The ring keeps its colour past the target. Red there was a verdict
              (UX_AUDIT "Adherence-neutral colors"): eating over a number is
              information, not a failure, and the "kcal over" caption in the
              centre already states the fact without grading it. */}
          <AnimatedCircle
            cx={SIZE / 2}
            cy={SIZE / 2}
            r={OUTER_R}
            stroke={colors.ring}
            strokeWidth={OUTER_STROKE + 10}
            fill="none"
            animatedProps={calFlareProps}
          />
          <Ring
            r={OUTER_R}
            stroke={OUTER_STROKE}
            trackColor={withAlpha(colors.ring, TRACK_ALPHA)}
            color={colors.ring}
            progress={calTarget ? calConsumed / calTarget : 0}
            delay={100}
          />
          <AnimatedCircle
            cx={SIZE / 2}
            cy={SIZE / 2}
            r={INNER_R}
            stroke={colors.protein}
            strokeWidth={INNER_STROKE + 10}
            fill="none"
            animatedProps={flareProps}
          />
          <Ring
            r={INNER_R}
            stroke={INNER_STROKE}
            trackColor={withAlpha(colors.protein, TRACK_ALPHA)}
            color={colors.protein}
            progress={protTarget ? protConsumed / protTarget : 0}
            delay={280}
          />
        </Svg>
        {/* Clamped to the inner ring's clear width (`CENTER_MAX_W`), and both
            lines capped below the app's 1.4 default: at the largest text
            sizes the number and its caption ran out over the ring. The
            caption shrinks to fit as the last resort rather than wrapping
            into the track. */}
        <View style={[styles.center, { pointerEvents: 'none' }]}>
          <View style={styles.centerInner}>
            <CountUpText
              value={Math.abs(calRemaining)}
              style={styles.centerValue}
              testID="hero-kcal"
              maxFontSizeMultiplier={1.2}
            />
            <Text
              style={styles.centerCaption}
              maxFontSizeMultiplier={1.3}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.7}
            >
              {t('today.kcal')} {over ? t('today.over') : t('today.left')}
            </Text>
          </View>
        </View>
      </PressScale>

      {/* Share sits on the thing it shares (Today re-score): it was a third
          header icon, which held all three to 38dp. The panel's corner is
          clear of the outer ring at every width — the ring is a 236dp circle
          centred in the panel, and even on a 320dp phone its arc (flare included)
          stays ~5dp clear of this button's nearest corner. */}
      {onShare ? (
        <TouchableOpacity
          onPress={onShare}
          disabled={sharing}
          style={styles.shareBtn}
          testID="share-progress"
          accessibilityRole="button"
          accessibilityLabel={t('today.shareA11y')}
          accessibilityState={{ busy: sharing }}
          accessibilityShowsLargeContentViewer
          accessibilityLargeContentTitle={t('today.shareA11y')}
        >
          <Ionicons name="share-outline" size={20} color={colors.heroMuted} />
        </TouchableOpacity>
      ) : null}

      {/* Hidden from the reader — the ring's sentence above already says all
          of it (review A5). Wraps rather than overflowing the panel, and
          stacks from 1.35× text (review #6). */}
      <View
        style={[styles.legendRow, stackLegend && styles.legendStacked]}
        importantForAccessibility="no-hide-descendants"
        accessibilityElementsHidden
        testID="hero-legend"
      >
        <View style={styles.legendItem}>
          <View style={[styles.dot, { backgroundColor: colors.ring }]} />
          <Text style={styles.legendText}>
            {formatNumber(calConsumed, locale)} / {formatNumber(calTarget, locale)} {t('today.kcal')}
          </Text>
        </View>
        <View style={styles.legendItem}>
          <View style={[styles.dot, { backgroundColor: colors.protein }]} />
          <Text style={styles.legendText}>
            {formatNumber(protConsumed, locale)} / {g(protTarget)} {t('today.protein').toLowerCase()}
          </Text>
        </View>
      </View>

      {/* Hidden for the same reason as the legend: carbs and fat are the last
          clause of the ring's sentence. "40 g", spaced, like every other
          gram figure in the app (review V3). */}
      <View
        style={styles.macroRow}
        importantForAccessibility="no-hide-descendants"
        accessibilityElementsHidden
      >
        <Text style={styles.macroChip}>
          <Text style={{ color: colors.carbs }}>●</Text> {t('today.carbs')} {g(carbs)}
        </Text>
        <Text style={styles.macroChip}>
          <Text style={{ color: colors.fat }}>●</Text> {t('today.fat')} {g(fat)}
        </Text>
      </View>

      {/* Before measured mode opens there is no maintenance line, and until
          2026-09-10 the footer was simply absent — so a day-0 user saw a ring
          and a formula target with nothing saying that logging 14 days is what
          turns the formula into THEIR number. This is that sentence, in the
          slot the maintenance line will take over: a state readout (asks for
          nothing, cannot be dismissed), never a Nudge. `progress` and
          `maintenance` are mutually exclusive by construction in core. */}
      {progress && !maintenance ? (
        <View style={styles.maintenanceFooter} testID="measure-progress">
          <Text style={styles.maintenanceLabel}>
            {t('today.measureProgress', { n: progress.loggedDays, needed: progress.neededDays })}
          </Text>
          {/* Announced as a progress bar WITH its value; a bare role reads as
              an empty, unnamed control. The sentence above carries the count. */}
          <View
            style={styles.progressTrack}
            accessible
            accessibilityRole="progressbar"
            accessibilityLabel={t('a11y.measureBar')}
            accessibilityValue={{ min: 0, max: progress.neededDays, now: progress.loggedDays }}
          >
            <View style={[styles.progressFill, { width: `${Math.round(progress.fraction * 100)}%` }]} />
          </View>
          <Text style={styles.maintenanceCaveat} testID="measure-progress-next">
            {progress.daysToGo > 0
              ? t('today.measureNext', { n: progress.daysToGo })
              : plural(t, locale, 'today.measureWeighIns', progress.weighInsToGo)}
          </Text>
        </View>
      ) : null}

      {/* Maintenance sits INSIDE the panel, under a hairline — it is a second
          reading of the same day, not a separate concern. As its own pale card
          below the hero it read as something bolted on. */}
      {maintenance ? (
        <View style={styles.maintenanceFooter} testID="maintenance-line">
          <Text style={styles.maintenanceLabel}>
            {t('today.maintenance')}{' '}
            <Text style={styles.maintenanceValue}>
              {formatNumber(maintenance.maintenance, locale)}
            </Text>
            {maintenance.delta == null ? null : (
              <Text style={styles.maintenanceDelta}>
                {'   ·   '}
                {maintenance.delta < 0
                  ? t('today.underMaintenance', {
                      n: formatNumber(Math.abs(maintenance.delta), locale),
                    })
                  : t('today.overMaintenance', { n: formatNumber(maintenance.delta, locale) })}
              </Text>
            )}
          </Text>
          {/* Only when we can name the cause. A caveat that just says "rough"
              tells the user nothing they can act on. */}
          {/* `holding` first, and it REPLACES the two lines below rather than
              stacking with them. All three describe the same worry at different
              strengths, and three caveats under one number reads as an app that
              does not trust itself. Holding is the strongest: it says the answer
              is too wide to act on, which is true whether or not the record is
              patchy — an account can log every day and still land here if the
              scale is noisy. */}
          {maintenance.holding ? (
            <Text style={styles.maintenanceCaveat} testID="maintenance-holding">
              {t('today.maintenanceHolding')}
            </Text>
          ) : maintenance.reliable ||
            maintenance.loggedDays == null ||
            maintenance.spanDays == null ? null : (
            <Text style={styles.maintenanceCaveat} testID="maintenance-rough">
              {/* Two strings, not one with an optional clause: the food count
                  is only worth saying when it DIFFERS from the row count, and
                  "42 of 63 days logged (42 with food)" is noise. A row is
                  written by a weigh-in or a finished workout too — a workout
                  writes `WORKOUT_MARKER_KCAL = 0` — so the plain count read as
                  more intake evidence than the estimate actually had. */}
              {maintenance.intakeDays != null && maintenance.intakeDays < maintenance.loggedDays
                ? t('today.maintenanceRoughFood', {
                    logged: maintenance.loggedDays,
                    span: maintenance.spanDays,
                    food: maintenance.intakeDays,
                  })
                : t('today.maintenanceRough', {
                    logged: maintenance.loggedDays,
                    span: maintenance.spanDays,
                  })}
            </Text>
          )}
          {/* Says what the app DID about a patchy record, not just that it
              noticed one. The caveat above has always said the number is
              rough; until 2026-08-19 the rough number was still shipped as the
              day's target at full strength. This line is the other half.

              Reworded 2026-09-04, and the reason is the line's neighbours. It
              read "Your target is held steady while the record fills in",
              which (a) said "steady" while `today.maintenanceHolding` directly
              above owns that word for a different condition, and (b) started
              appearing next to "Your target just recalibrated" the moment
              `tdee-recalibration.ts` stopped gating on `reliable` — so one
              account could be told its target was frozen and had just moved,
              in the same card. Seen on a real device the hour it shipped.

              `provisional` itself did not change meaning: it is still
              `confidence < 1`, still "part of this is the formula anchor
              rather than your own measurement". Only the copy was wrong, and
              only about stasis — so the new string states the blend and the
              direction it moves, and claims nothing about the target holding
              still. */}
          {maintenance.provisional && !maintenance.holding ? (
            <Text style={styles.maintenanceCaveat} testID="maintenance-provisional">
              {t('today.maintenanceProvisional')}
            </Text>
          ) : null}
          {/* NOT gated on `reliable`: a two-week break with a real weight
              change makes the guard drop every post-break weigh-in while the
              estimate still calls itself reliable, so this is the only
              warning that fires for that case. */}
          {maintenance.weighInsDropped ? (
            <Text style={styles.maintenanceCaveat} testID="maintenance-outliers">
              {maintenance.weighInsDropped === 1
                ? t('today.maintenanceOutlier')
                : t('today.maintenanceOutliers', { n: String(maintenance.weighInsDropped) })}
            </Text>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

/**
 * The hero's shape with nothing in it — two empty tracks on the panel — for a
 * cold start with no cache. Not `HeroRings` at zero: that would print
 * "0 kcal left" for a target nobody has loaded yet, which is a wrong number,
 * not a placeholder.
 */
export function HeroRingsSkeleton() {
  const t = useT();
  const styles = useThemedStyles(createStyles);
  const { colors } = useTheme();
  // The same tinted tracks as the live hero, so the first real frame fills
  // these rings rather than recolouring them.
  return (
    <View
      style={styles.panel}
      testID="hero-skeleton"
      accessible
      accessibilityLabel={t('a11y.loadingToday')}
      accessibilityState={{ busy: true }}
    >
      <Svg width={SIZE} height={SIZE}>
        <Circle cx={SIZE / 2} cy={SIZE / 2} r={OUTER_R} stroke={withAlpha(colors.ring, TRACK_ALPHA)} strokeWidth={OUTER_STROKE} fill="none" />
        <Circle cx={SIZE / 2} cy={SIZE / 2} r={INNER_R} stroke={withAlpha(colors.protein, TRACK_ALPHA)} strokeWidth={INNER_STROKE} fill="none" />
      </Svg>
    </View>
  );
}

function createStyles({ colors, shadow, scheme }: Theme) {
  return StyleSheet.create({
    maintenanceFooter: {
      alignSelf: 'stretch',
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.heroTrack,
      paddingTop: space.md,
      alignItems: 'center',
      gap: 2,
    },
    maintenanceLabel: { fontSize: font.small, color: colors.heroMuted, textAlign: 'center' },
    maintenanceValue: { color: colors.heroText, fontWeight: '800' },
    maintenanceDelta: { color: colors.heroText, fontWeight: '700' },
    maintenanceCaveat: { fontSize: font.tiny, color: colors.heroMuted, textAlign: 'center' },
    // The measured-burn progress track: the ring's own track colour under a
    // fill in the hero's text colour, so it reads as part of the panel rather
    // than as a control. Width, not a percentage label — the label above
    // already carries the count.
    progressTrack: {
      alignSelf: 'stretch',
      height: 4,
      borderRadius: 2,
      backgroundColor: colors.heroTrack,
      marginVertical: space.xs,
      overflow: 'hidden',
    },
    progressFill: { height: '100%', borderRadius: 2, backgroundColor: colors.heroText },
    panel: {
      backgroundColor: colors.heroPanel,
      borderRadius: radius.xl,
      paddingVertical: space.xl,
      paddingHorizontal: space.lg,
      alignItems: 'center',
      gap: space.lg,
      ...shadow.e2,
      // The panel is the same near-black in both themes, which on the dark
      // canvas measured 1.02:1 — the hero had no edge at all, and the shadow
      // that defines it in light mode is invisible on near-black. A hairline
      // of 6% white is the edge iOS draws on dark grouped cells (review V1).
      ...(scheme === 'dark' ? { borderWidth: 1, borderColor: 'rgba(255, 255, 255, 0.06)' } : null),
    },
    ringWrap: { width: SIZE, height: SIZE },
    // 44pt square in the panel's top-right corner, over the hero's own
    // padding — see the render for why the ring never reaches it.
    shareBtn: {
      position: 'absolute',
      top: space.xs,
      right: space.xs,
      width: 44,
      height: 44,
      alignItems: 'center',
      justifyContent: 'center',
    },
    center: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      alignItems: 'center',
      justifyContent: 'center',
    },
    centerInner: { maxWidth: CENTER_MAX_W, alignItems: 'center' },
    centerValue: { fontFamily: type.display, fontSize: font.hero, color: colors.heroText },
    centerCaption: { fontSize: font.small, color: colors.heroMuted, marginTop: 2, textAlign: 'center' },
    legendRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      justifyContent: 'center',
      alignItems: 'center',
      columnGap: space.xl,
      rowGap: space.xs,
    },
    legendStacked: { flexDirection: 'column', alignItems: 'flex-start' },
    legendItem: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
    dot: { width: 8, height: 8, borderRadius: 4 },
    legendText: { fontSize: font.small, color: colors.heroText, fontFamily: type.heading },
    macroRow: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', columnGap: space.lg, rowGap: space.xs },
    macroChip: { fontSize: font.tiny, color: colors.heroMuted },
  });
}
