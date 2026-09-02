import { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  FadeOut,
  ReduceMotion,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BRAND_LOADER_SIZE, BRAND_LOADER_WRAP, BrandWordmark } from '@/components/BrandLoader';
import { Flame } from '@/components/Flame';
import { useT } from '@/i18n';
import { heroEnter, PressScale } from '@/lib/motion';
import { useSplashVisible } from '@/lib/splash-state';
import { useThemedStyles, type Theme } from '@/lib/theme-context';
import { font, motion, radius, space, type } from '@/theme';

/**
 * The first screen a brand-new install shows — before the sign-in form.
 *
 * ## The moment
 *
 * Native splash → `BrandLoader` (the flame, sparks, the wordmark rising) →
 * this. The seam that matters is the second one: this screen mounts UNDER the
 * loader with the same flame at the same size in the same centred column, so
 * when the overlay lifts nothing changes — and then the fire catches. The
 * flame springs up and grows into its hero size, a one-shot bloom radiates off
 * it, and the copy arrives beneath in the order it reads: what the app is,
 * then the way in. Sign-out lands here too, without a loader in front; then
 * the flame simply catches where it stands.
 *
 * ## The rules it keeps (the Callbook brief, `Z:\tracker-app\app\welcome.tsx`)
 *
 * - **Spring on ONE element.** The mark has weight; everything else is eased
 *   (`heroEnter`). One thing with weight reads as craft, four read as a toy.
 * - **~100 ms stagger**, small enough that nobody waits.
 * - **Nothing loops** but the flame's own breathe. The bloom fires once.
 * - **Reduce motion yields a complete, still screen**: the flame sits at its
 *   hero place, the copy is simply there, and `Flame` already renders a still
 *   ember.
 * - **No tour, no carousel.** One sentence, one button, one link.
 *
 * ## How it knows where the loader put the flame
 *
 * It does not assume a window height — Android's `window` dimensions have
 * lied about the nav bar before. The flame lives in an absolutely-centred
 * column built from the loader's own wrap style and size, so its resting
 * place IS the loader's; a transparent ghost of the same height sits in the
 * real layout where the hero should end up, and both are measured in window
 * coordinates. The spring travels the difference.
 *
 * ## What is deliberately not here
 *
 * No analytics counter: `usageEvents` is a closed catalogue that needs a rules
 * deploy per key, and `timeToFirstLog` (retention lever 3) already measures
 * the only thing this screen could cost. No persisted "seen" flag: a signed-out
 * returning user seeing the intro again is not a defect (Callbook does the
 * same), and a flag would be one more thing to reset in the fresh-account arc.
 */
export function WelcomeIntro({ onContinue }: { onContinue: (mode: 'signin' | 'signup') => void }) {
  const t = useT();
  const styles = useThemedStyles(createStyles);
  const insets = useSafeAreaInsets();
  const reduce = useReducedMotion();

  const splashVisible = useSplashVisible();
  // Captured once: did a loader precede us? Decides whether the flame starts
  // at the loader's spot (and travels) or simply appears at its hero place.
  const fromSplash = useRef(splashVisible).current;
  const started = !splashVisible;

  // Window-space tops of the loader-twin column and of the ghost in the layout.
  const [twinY, setTwinY] = useState<number | null>(null);
  const [ghostY, setGhostY] = useState<number | null>(null);
  const [twinH, setTwinH] = useState<number | null>(null);
  const twinRef = useRef<View>(null);
  const ghostRef = useRef<View>(null);
  const delta = twinY !== null && ghostY !== null ? ghostY - twinY : null;

  const measureTwin = useCallback(() => {
    // Guarded: react-test-renderer host refs carry no measure functions.
    twinRef.current?.measureInWindow?.((_x, y, _w, h) => {
      setTwinY(y);
      setTwinH(h);
    });
  }, []);
  const measureGhost = useCallback(() => {
    ghostRef.current?.measureInWindow?.((_x, y) => setGhostY(y));
  }, []);

  const travel = useSharedValue(0);
  const grow = useSharedValue(1);
  const bloom = useSharedValue(0);
  // A sign-out arrival has no loader to match, so hold the column invisible
  // for the frame or two before it is measured into place; a cold start shows
  // it at once because "at once" is exactly where the loader left it.
  const placed = useSharedValue(fromSplash ? 1 : 0);

  useEffect(() => {
    if (delta === null || fromSplash) return;
    travel.value = delta;
    placed.value = 1;
  }, [delta, fromSplash, travel, placed]);

  useEffect(() => {
    if (!started || delta === null) return;
    if (reduce) {
      travel.value = delta;
      grow.value = HERO_SCALE;
      return;
    }
    travel.value = withSpring(delta, motion.spring.hero);
    grow.value = withSpring(HERO_SCALE, motion.spring.hero);
    bloom.value = withTiming(1, { duration: BLOOM_MS, easing: Easing.out(Easing.cubic) });
  }, [started, delta, reduce, travel, grow, bloom]);

  const columnStyle = useAnimatedStyle(() => ({
    opacity: placed.value,
    transform: [{ translateY: travel.value }],
  }));
  const flameStyle = useAnimatedStyle(() => ({ transform: [{ scale: grow.value }] }));
  const bloomStyle = useAnimatedStyle(() => ({
    opacity: bloom.value === 0 ? 0 : (1 - bloom.value) * 0.35,
    transform: [{ scale: 0.6 + bloom.value * 1.1 }],
  }));

  return (
    <Animated.View
      style={styles.root}
      exiting={FadeOut.duration(motion.dur.fast).reduceMotion(ReduceMotion.System)}
      testID="welcome-intro"
    >
      {/* The real layout. The ghost marks where the hero column lands; the
          spacers centre the hero group over the actions with equal slack, and
          on a short window (the LG at 360×720 dp) collapse to nothing. */}
      <View style={[styles.column, { paddingTop: insets.top + space.xl, paddingBottom: insets.bottom + space.xl }]}>
        <View style={styles.spacer} />
        <View
          ref={ghostRef}
          onLayout={measureGhost}
          // The grown flame overflows its 104 box by half the growth on top;
          // the margin keeps that clear of the status bar on a short window.
          style={[styles.ghost, { height: twinH ?? 0, marginTop: OVERFLOW }]}
          accessible={false}
        />
        {started ? (
          <>
            <Animated.Text entering={heroEnter(0)} style={styles.title} accessibilityRole="header">
              {t('welcome.title')}
            </Animated.Text>
            <Animated.Text entering={heroEnter(1)} style={styles.body}>
              {t('welcome.body')}
            </Animated.Text>
          </>
        ) : null}
        <View style={styles.spacer} />
        {started ? (
          <Animated.View entering={heroEnter(2)} style={styles.actions}>
            {/* The label names the destination; no arrow — that was the
                template talking. Haptic on the way in, the same tap the rest
                of the app gives a primary CTA. */}
            <PressScale
              haptic
              style={styles.cta}
              onPress={() => onContinue('signup')}
              testID="welcome-cta"
              accessibilityRole="button"
            >
              <Text style={styles.ctaText}>{t('welcome.cta')}</Text>
            </PressScale>
            <PressScale
              scaleTo={0.97}
              style={styles.link}
              onPress={() => onContinue('signin')}
              testID="welcome-signin"
              accessibilityRole="button"
            >
              <Text style={styles.linkText}>{t('welcome.haveAccount')}</Text>
            </PressScale>
          </Animated.View>
        ) : null}
      </View>

      {/* The loader's twin: the flame and wordmark, centred exactly as
          `Splash` centres `BrandLoader`, measured before any transform. */}
      <View pointerEvents="none" style={styles.twinFill}>
        <View ref={twinRef} onLayout={measureTwin} collapsable={false}>
          <Animated.View style={[BRAND_LOADER_WRAP, columnStyle]}>
            <View style={styles.flameSlot}>
              <Animated.View style={[styles.bloom, bloomStyle]} />
              <Animated.View style={flameStyle}>
                <Flame size={BRAND_LOADER_SIZE} flicker />
              </Animated.View>
            </View>
            <BrandWordmark />
          </Animated.View>
        </View>
      </View>
    </Animated.View>
  );
}

/** Hero size over the loader's 104: the icon becomes the thing on the screen. */
const HERO_SCALE = 1.25;
const OVERFLOW = Math.ceil((BRAND_LOADER_SIZE * (HERO_SCALE - 1)) / 2);
const BLOOM_MS = 700;
const BLOOM_SIZE = BRAND_LOADER_SIZE * 1.6;

const createStyles = ({ colors }: Theme) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.paper },
    column: { flex: 1, width: '100%', maxWidth: 480, alignSelf: 'center', paddingHorizontal: space.xl },
    spacer: { flex: 1 },
    ghost: { opacity: 0 },
    title: {
      fontFamily: type.display,
      fontSize: font.h1,
      lineHeight: 36,
      color: colors.ink,
      textAlign: 'center',
      marginTop: space.xl,
    },
    body: {
      fontSize: font.body,
      lineHeight: 24,
      color: colors.muted,
      textAlign: 'center',
      marginTop: space.md,
    },
    actions: { gap: space.sm },
    cta: {
      backgroundColor: colors.ink,
      borderRadius: radius.md,
      paddingVertical: space.lg,
      alignItems: 'center',
    },
    ctaText: { color: colors.onInk, fontSize: font.h3, fontWeight: '700' },
    link: { alignSelf: 'center', paddingVertical: space.sm, paddingHorizontal: space.md },
    linkText: { color: colors.muted, fontSize: font.small, fontWeight: '600' },
    twinFill: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center' },
    flameSlot: {
      width: BRAND_LOADER_SIZE,
      height: BRAND_LOADER_SIZE,
      alignItems: 'center',
      justifyContent: 'center',
    },
    bloom: {
      position: 'absolute',
      width: BLOOM_SIZE,
      height: BLOOM_SIZE,
      borderRadius: BLOOM_SIZE / 2,
      backgroundColor: colors.ring,
    },
  });
