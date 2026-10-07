import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Keyboard,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { buildCoachSystemInstruction } from '@macrolog/core';
import { CoachMarkdown } from '@/components/CoachMarkdown';
import { useCoach } from '@/hooks/useCoach';
import { useAuth } from '@/lib/auth';
import { CoachErrorCode, type CoachError, streamCoach } from '@/lib/coach';
import { isOffline, useIsOffline } from '@/lib/connectivity';
import { announce } from '@/lib/a11y';
import { useA11yFocus } from '@/lib/use-a11y-focus';
import { track } from '@/lib/analytics';
import { getConsultationQuota } from '@/lib/ledger';
import { type I18nKey, useLocale, useT } from '@/i18n';
import * as haptics from '@/lib/haptics';
import { useTheme, useThemedStyles, type Theme } from '@/lib/theme-context';
import { font, radius, space, TARGET } from '@/theme';
import { Touchable } from '@/components/Touchable';

type Status = 'idle' | 'streaming' | 'done' | 'error';

/**
 * How often a streaming answer is pushed into React, at most.
 *
 * Every chunk used to be a `setAnswer`, and every `setAnswer` re-parses the
 * whole answer through `CoachMarkdown` — a re-render per network packet, many
 * per second, each a little longer than the last. 50 ms is under a frame pair
 * at 60 Hz and well under reading speed: the text still visibly streams, at a
 * fraction of the renders.
 */
const ANSWER_FLUSH_MS = 50;

const SUGGESTIONS: I18nKey[] = ['coach.suggestOnTrack', 'coach.suggestAdjust', 'coach.suggestProtein'];

function errorKey(code: string | undefined): I18nKey {
  switch (code) {
    case CoachErrorCode.CONSULTATION_QUOTA_EXCEEDED:
      return 'coach.errQuota';
    case CoachErrorCode.CONSULTATION_RATE_LIMITED:
    case CoachErrorCode.RATE_LIMITED:
      return 'coach.errRate';
    case CoachErrorCode.UNAUTHENTICATED:
      return 'coach.errAuth';
    default:
      return 'coach.errGeneric';
  }
}

// `KeyboardAvoidingView` comes from react-native-keyboard-controller, NOT from
// react-native. RN's own version was built for iOS and reads the keyboard frame
// straight from the system notification, which iOS 26 reports inconsistently
// (Apple forums 800310 / 814154) — that is the "spacing is much larger" the
// input screens were showing. The library normalises the frame across both
// platforms and is already a dependency, with <KeyboardProvider> mounted at the
// app root, so this costs nothing new. `behavior="padding"` on BOTH
// platforms: under <KeyboardProvider> Android does not resize the window for
// the IME, so adjustResize alone left fields and footers behind the keyboard
// (emulator, 2026-10-06).
//
// This is a ROOT route pushed over the tabs on the native stack (UX_AUDIT
// S18-14, `lib/root-stack.ts`), not a tab: no tab bar, no raised + over the
// composer, swipe-back on iOS and hardware back on Android come from the
// navigator. It was `(app)/coach.tsx` until 2026-09-28. Its header — title,
// back button, swipe-back — is the shared native one from the root layout
// (S21-9), which also gives a cold `ignia://coach` its way back to Today.
export default function Coach() {
  const t = useT();
  const styles = useThemedStyles(createStyles);
  const { colors } = useTheme();
  const locale = useLocale();
  const { user } = useAuth();
  const { logs, tdee, profile, dailyWeights } = useCoach();
  // Every ask is a network call; offline it can only fail. Say so up front and
  // keep Ask off, rather than letting the generic "Something went wrong" stand
  // in for a missing connection.
  const offline = useIsOffline();

  const [question, setQuestion] = useState('');
  const [status, setStatus] = useState<Status>('idle');
  const [answer, setAnswer] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [remaining, setRemaining] = useState<number | null>(null);
  const [limit, setLimit] = useState<number | null>(null);
  const [overLimit, setOverLimit] = useState(false);
  // Admin and comped callers bypass the daily quota entirely (`caller.unlimited`
  // in functions/src/caller-access.ts), so the server never reserves a slot and
  // reports `remaining: -1`. Without this flag the screen had no way to say so:
  // it blanked the chip, and the doc read below then restored a full "3 / 3"
  // that could never move, no matter how many consultations were spent.
  const [unlimited, setUnlimited] = useState(false);

  // Show the day's allowance BEFORE one is spent. Until this, `remaining` was
  // set only from a consultation's own response metadata, so the chip could
  // not exist on a freshly-opened screen and a user had no way to see how
  // many they had left without using one. One document read, server-owned
  // counter, no new Cloud Function. A failure here is silent on purpose: the
  // count is a courtesy, and the server remains the authority that refuses
  // the ask.
  useEffect(() => {
    if (!user || unlimited) return;
    let alive = true;
    getConsultationQuota(user.uid)
      .then((q) => {
        if (!alive) return;
        // Never overwrite a live count that a consultation just returned.
        setRemaining((prev) => (prev == null ? q.remaining : prev));
        setLimit((prev) => (prev == null ? q.limit : prev));
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [user, unlimited]);

  const streaming = status === 'streaming';
  // The answer streams BELOW the composer, which is below the fold on most
  // phones once the keyboard is up — it used to arrive out of sight. Follow it
  // while it streams, and move a screen reader to it when it lands.
  const scrollRef = useRef<ScrollView>(null);
  const replyRef = useA11yFocus(status === 'done' ? answer.length : 0, status === 'done');
  // Synchronous re-entry guard. `streaming` is state, so two taps in the same
  // frame both read it false and both spend a consultation (UX_AUDIT S18-14);
  // a ref flips before React gets to render.
  const asking = useRef(false);

  const ask = async (raw?: string) => {
    const q = (raw ?? question).trim();
    if (!q || streaming || asking.current || offline) return;
    asking.current = true;
    haptics.tap();
    // The keyboard covers the reply that is about to stream in.
    Keyboard.dismiss();
    setQuestion(q);
    setStatus('streaming');
    setAnswer('');
    setErrorMsg('');
    setOverLimit(false);

    // Hoisted out of the `try` so the `catch` can tell "failed before a word
    // arrived" from "dropped mid-answer", and keep what did arrive.
    let streamed = false;
    let buffer = '';

    try {
      if (!user) throw Object.assign(new Error('auth'), { code: CoachErrorCode.UNAUTHENTICATED });
      const idToken = await user.getIdToken();
      const systemInstruction = buildCoachSystemInstruction({ logs, tdee, profile, dailyWeights, locale });

      // Throttled flush — see ANSWER_FLUSH_MS. A trailing flush after the
      // stream ends makes sure the last chunk is never stranded in `buffer`.
      let lastFlush = 0;
      const flush = () => {
        lastFlush = Date.now();
        setAnswer(buffer);
      };
      track('coach_ask');
      await streamCoach({
        systemInstruction,
        prompt: q,
        idToken,
        onMeta: (m) => {
          setLimit(m.limit);
          // < 0 means "not counted", not "unknown" — say so rather than
          // falling back to a number the server is not keeping.
          if (m.remaining < 0) {
            setUnlimited(true);
            setRemaining(null);
          } else {
            setRemaining(m.remaining);
          }
        },
        onChunk: (chunk) => {
          buffer += chunk;
          streamed = true;
          if (Date.now() - lastFlush >= ANSWER_FLUSH_MS) flush();
        },
      });
      flush();
      setStatus('done');
      announce(t('coach.replied'));
    } catch (err) {
      const code = (err as CoachError)?.code;
      if (code === CoachErrorCode.CONSULTATION_QUOTA_EXCEEDED) setOverLimit(true);
      // Whatever arrived before the failure stays on screen.
      if (streamed) setAnswer(buffer);
      // A lost connection is the one failure whose cause we can name — but
      // the `offline` above was captured when the ask STARTED, and the guard at
      // the top already returned if it was true, so this branch never ran.
      // Read the live verdict instead (`connectivity.ts` — NetInfo is
      // deliberately not a dependency: native code moves the fingerprint), and
      // treat a code-less failure AFTER chunks arrived as the stream dropping:
      // the server reports its own failures as a typed `error` frame, so an
      // untyped one mid-answer is the transport.
      const msg = isOffline()
        ? t('coach.offline')
        : code == null && streamed
          ? t('coach.lostMidStream')
          : t(errorKey(code));
      setErrorMsg(msg);
      setStatus('error');
      announce(msg);
    } finally {
      asking.current = false;
    }
  };

  return (
    <SafeAreaView style={styles.screen} edges={['bottom']}>
      {/* `automaticOffset`: under the native header this view no longer
          starts at the top of the screen; the library measures where it is,
          and the 8 stays as the extra breathing room it always was. */}
      <KeyboardAvoidingView
        style={styles.fill}
        behavior="padding"
        automaticOffset
        keyboardVerticalOffset={8}
      >
        <ScrollView
          ref={scrollRef}
          contentContainerStyle={styles.body}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
          // Follow the answer while it streams; leave the scroll alone otherwise
          // so reading an earlier part of a finished answer is not yanked away.
          onContentSizeChange={() => {
            if (streaming) scrollRef.current?.scrollToEnd({ animated: false });
          }}
        >
          <Text style={styles.intro}>{t('coach.intro')}</Text>
          {unlimited ? (
            <Text style={styles.counter} testID="coach-remaining">
              {t('coach.unlimited')}
            </Text>
          ) : remaining !== null && limit !== null ? (
            <Text style={styles.counter} testID="coach-remaining">
              {t('coach.remaining', { n: remaining, limit })}
            </Text>
          ) : null}
          <Text style={styles.disclaimer}>{t('coach.notMedical')}</Text>
          {offline ? (
            <Text style={styles.offline} accessibilityRole="alert" accessibilityLiveRegion="polite" testID="coach-offline">
              {t('coach.offline')}
            </Text>
          ) : null}

          {/* Suggested prompts */}
          <View style={styles.chips}>
            {SUGGESTIONS.map((key) => (
              <TouchableOpacity
                key={key}
                style={[styles.chip, offline && styles.chipOff]}
                disabled={streaming || offline}
                accessibilityRole="button"
                accessibilityState={{ disabled: streaming || offline }}
                onPress={() => ask(t(key))}
                testID={`coach-suggest-${key}`}
              >
                <Text style={styles.chipText}>{t(key)}</Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* Composer */}
          <TextInput
            style={styles.input}
            value={question}
            onChangeText={setQuestion}
            editable={!streaming}
            placeholder={t('coach.placeholder')}
            placeholderTextColor={colors.faint}
            multiline
            accessibilityLabel={t('coach.composerLabel')}
            accessibilityHint={t('coach.placeholder')}
            testID="coach-input"
          />
          <Touchable
            style={[styles.askBtn, (streaming || offline || !question.trim()) && styles.askBtnOff]}
            onPress={() => ask()}
            disabled={streaming || offline || !question.trim()}
            accessibilityRole="button"
            // Named in every state: while streaming the label Text is swapped
            // for a spinner, and VoiceOver read "button, busy" with no name.
            accessibilityLabel={t('coach.ask')}
            accessibilityState={{ disabled: streaming || offline || !question.trim(), busy: streaming }}
            testID="coach-ask"
          >
            {streaming ? (
              <ActivityIndicator color={colors.onInk} />
            ) : (
              <Text style={styles.askText}>{t('coach.ask')}</Text>
            )}
          </Touchable>

          {/* Response */}
          {status !== 'idle' ? (
            <View style={styles.reply} testID="coach-reply">
              <Text style={styles.replyStamp} ref={replyRef} accessibilityRole="header">{t('coach.replyStamp')}</Text>
              {answer ? <CoachMarkdown text={answer} /> : null}
              {streaming && !answer ? (
                <ActivityIndicator color={colors.accent} style={{ marginTop: space.sm }} accessibilityLabel={t('coach.replyStamp')} />
              ) : null}
              {status === 'error' ? (
                <View style={styles.errBox}>
                  <Text style={styles.errText}>{errorMsg}</Text>
                  {overLimit ? <Text style={styles.errHint}>{t('coach.upgradeHint')}</Text> : null}
                </View>
              ) : null}
            </View>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const createStyles = ({ colors }: Theme) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.paper },
  fill: { flex: 1 },
  // `space.xl`, not `FAB_BAND`: nothing floats over this screen any more —
  // it is a root stack route, not a tab (UX_AUDIT S18-14). Sides `space.xl`,
  // the gutter every other screen uses (it was 16 dp against 24, S22).
  body: { paddingHorizontal: space.xl, paddingTop: space.md, paddingBottom: space.xl },
  intro: { fontSize: font.body, color: colors.ink, lineHeight: 21 },
  counter: { fontSize: font.small, color: colors.teal, marginTop: space.xs, fontVariant: ['tabular-nums'] },
  disclaimer: { fontSize: font.tiny, color: colors.faint, marginTop: space.xs },
  offline: { fontSize: font.small, color: colors.muted, marginTop: space.md, lineHeight: 20 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginTop: space.lg },
  chipOff: { opacity: 0.4 },
  // 44pt tall — they were ~26 (WCAG 2.5.5 / Apple HIG).
  chip: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.pill,
    paddingHorizontal: space.md,
    minHeight: TARGET,
    justifyContent: 'center',
    backgroundColor: colors.inputBg,
  },
  chipText: { fontSize: font.small, color: colors.ink },
  input: {
    borderWidth: 1,
    // A field's edge is a control boundary (WCAG 1.4.11, 3:1).
    borderColor: colors.lineStrong,
    borderRadius: radius.md,
    padding: space.md,
    marginTop: space.lg,
    fontSize: font.body,
    color: colors.ink,
    backgroundColor: colors.inputBg,
    minHeight: 88,
    textAlignVertical: 'top',
  },
  askBtn: {
    marginTop: space.md,
    backgroundColor: colors.ink,
    borderRadius: radius.md,
    paddingVertical: space.md,
    alignItems: 'center',
  },
  askBtnOff: { opacity: 0.4 },
  askText: { color: colors.onInk, fontSize: font.body, fontWeight: '700' },
  reply: { marginTop: space.xl },
  replyStamp: {
    fontSize: font.tiny,
    color: colors.accent,
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginBottom: space.sm,
  },
  errBox: {
    marginTop: space.md,
    borderWidth: 1,
    borderColor: colors.accent,
    borderRadius: radius.md,
    padding: space.md,
    backgroundColor: colors.accentSoft,
  },
  errText: { fontSize: font.small, color: colors.ink },
  errHint: { fontSize: font.tiny, color: colors.faint, marginTop: space.xs },
});
