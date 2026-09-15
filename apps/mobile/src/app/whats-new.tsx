import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInDown, FadeInUp, ReduceMotion } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import { BrandMark } from '@/components/BrandMark';
import { useT } from '@/i18n';
import * as haptics from '@/lib/haptics';
import { PressScale } from '@/lib/motion';
import { useTheme, useThemedStyles, type Theme } from '@/lib/theme-context';
import { WHATS_NEW_ITEMS, markWhatsNewSeen } from '@/lib/whatsNew';
import { font, motion, radius, space, type } from '@/theme';

/**
 * What changed, once per release — a screen, not a card.
 *
 * ## Why it stopped being a banner
 *
 * The banner on Today was a 14-pt paragraph in a card competing with the
 * rings for the one Nudge slot. Release notes are the one message a person
 * reads with attention exactly once, and a paragraph at caption size under a
 * dismiss cross is the shape of something to swipe past. This is built like
 * the tour: a root route so it takes the whole screen, the mark at the top,
 * one list of what changed with an icon well per item, and one button at
 * the bottom. No pages, no dots — it is three sentences.
 *
 * ## When it opens
 *
 * `shouldAutoOpenWhatsNew` in `lib/whatsNew.ts` decides — once per
 * `WHATS_NEW_VERSION`, only from the tab root, never over onboarding or the
 * tour, and never on a fresh install (everything is new to someone who just
 * arrived; that is what the tour is for). `useWhatsNewOnce` in the tab
 * layout performs the navigation.
 *
 * ## The one thing it keeps from the banner
 *
 * The feedback line. A release is the moment someone notices what is
 * missing, and the banner's "tell me" link was the standing invitation; it
 * moves here rather than disappearing.
 */

/** The icon well beside each item. Fixed: nothing on the row derives from
 *  it, it only has to hold one symbol at a size that reads at arm's length. */
const WELL = 44;

export default function WhatsNew() {
  const t = useT();
  const styles = useThemedStyles(createStyles);
  const { colors } = useTheme();
  const router = useRouter();

  /** `replace`, like the tour's exit: hardware back must not land back on a
   *  screen the person just finished reading. */
  function leave() {
    haptics.tap();
    void markWhatsNewSeen();
    router.replace('/(app)');
  }

  const rowEnter = (i: number) =>
    FadeInUp.duration(motion.dur.slow).delay(180 + i * (motion.stagger + 15)).reduceMotion(ReduceMotion.System);

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom']} testID="whats-new">
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <Animated.View
          entering={FadeInDown.duration(motion.dur.slow).reduceMotion(ReduceMotion.System)}
          style={styles.head}
        >
          <BrandMark size={72} />
          <Text style={styles.title}>{t('whatsNew.title')}</Text>
          <Text style={styles.subtitle}>{t('whatsNew.subtitle')}</Text>
        </Animated.View>

        <View style={styles.card}>
          {WHATS_NEW_ITEMS.map((item, i) => (
            <Animated.View
              key={item.titleKey}
              entering={rowEnter(i)}
              style={[styles.row, i > 0 && styles.rowDivider]}
              testID={`whats-new-item-${i}`}
            >
              <View style={styles.well}>
                <Ionicons name={item.icon} size={22} color={colors.accent} />
              </View>
              <View style={styles.rowText}>
                <Text style={styles.rowTitle}>{t(item.titleKey)}</Text>
                <Text style={styles.rowBody}>{t(item.bodyKey)}</Text>
              </View>
            </Animated.View>
          ))}
        </View>
      </ScrollView>

      <Animated.View
        entering={FadeInUp.duration(motion.dur.slow).delay(420).reduceMotion(ReduceMotion.System)}
        style={styles.footer}
      >
        <PressScale
          style={styles.cta}
          scaleTo={0.98}
          onPress={leave}
          accessibilityRole="button"
          testID="whats-new-continue"
        >
          <Text style={styles.ctaText}>{t('whatsNew.continue')}</Text>
        </PressScale>
        <PressScale
          style={styles.feedback}
          scaleTo={0.96}
          onPress={() => {
            haptics.tap();
            void markWhatsNewSeen();
            router.replace('/feedback');
          }}
          accessibilityRole="button"
          testID="whats-new-feedback"
        >
          <Text style={styles.feedbackText}>{t('feedback.whatsNewPrompt')}</Text>
        </PressScale>
      </Animated.View>
    </SafeAreaView>
  );
}

const createStyles = ({ colors, shadow }: Theme) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.paper },
    scroll: {
      flexGrow: 1,
      justifyContent: 'center',
      paddingHorizontal: space.xl,
      paddingTop: space.xxl,
      paddingBottom: space.xl,
      gap: space.xl,
      width: '100%',
      maxWidth: 480,
      alignSelf: 'center',
    },
    head: { alignItems: 'center', gap: space.sm },
    title: { fontFamily: type.display, fontSize: 28, lineHeight: 34, color: colors.ink, marginTop: space.sm, textAlign: 'center' },
    subtitle: { fontSize: font.body, lineHeight: font.body * 1.4, color: colors.muted, textAlign: 'center' },
    card: {
      backgroundColor: colors.card,
      borderRadius: radius.xl,
      borderWidth: 1,
      borderColor: colors.line,
      paddingHorizontal: space.lg,
    },
    row: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.lg },
    rowDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line },
    well: {
      width: WELL,
      height: WELL,
      borderRadius: WELL / 2,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.accentSoft,
    },
    rowText: { flex: 1, gap: 2 },
    rowTitle: { fontFamily: type.heading, fontSize: font.body, color: colors.ink },
    // `body`, not `small` — this is the sentence the screen exists for.
    rowBody: { fontSize: font.body - 1, lineHeight: (font.body - 1) * 1.4, color: colors.muted },
    footer: {
      paddingHorizontal: space.xl,
      paddingTop: space.md,
      paddingBottom: space.md,
      gap: space.sm,
      width: '100%',
      maxWidth: 480,
      alignSelf: 'center',
    },
    cta: {
      backgroundColor: colors.ink,
      borderRadius: radius.md,
      paddingVertical: space.lg,
      alignItems: 'center',
      ...shadow.e2,
    },
    ctaText: { color: colors.onInk, fontSize: font.body, fontWeight: '700' },
    feedback: { alignItems: 'center', paddingVertical: space.sm },
    feedbackText: { fontSize: font.small, color: colors.teal, fontWeight: '700' },
  });
