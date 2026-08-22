import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
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
import { track } from '@/lib/analytics';
import { getConsultationQuota } from '@/lib/ledger';
import { type I18nKey, useLocale, useT } from '@/i18n';
import * as haptics from '@/lib/haptics';
import { useTheme, useThemedStyles, type Theme } from '@/lib/theme-context';
import { font, radius, space } from '@/theme';

type Status = 'idle' | 'streaming' | 'done' | 'error';

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
// app root, so this costs nothing new. Same props, so `behavior` stays
// iOS-only: Android relies on windowSoftInputMode=adjustResize and must not
// also be padded.
export default function Coach() {
  const t = useT();
  const styles = useThemedStyles(createStyles);
  const { colors } = useTheme();
  const locale = useLocale();
  const router = useRouter();
  const { user } = useAuth();
  const { logs, tdee, profile, dailyWeights } = useCoach();

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

  const ask = async (raw?: string) => {
    const q = (raw ?? question).trim();
    if (!q || streaming) return;
    haptics.tap();
    setQuestion(q);
    setStatus('streaming');
    setAnswer('');
    setErrorMsg('');
    setOverLimit(false);

    try {
      if (!user) throw Object.assign(new Error('auth'), { code: CoachErrorCode.UNAUTHENTICATED });
      const idToken = await user.getIdToken();
      const systemInstruction = buildCoachSystemInstruction({ logs, tdee, profile, dailyWeights, locale });

      let buffer = '';
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
          setAnswer(buffer);
        },
      });
      setStatus('done');
    } catch (err) {
      const code = (err as CoachError)?.code;
      if (code === CoachErrorCode.CONSULTATION_QUOTA_EXCEEDED) setOverLimit(true);
      setErrorMsg(t(errorKey(code)));
      setStatus('error');
    }
  };

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={10} testID="coach-back">
          <Ionicons name="chevron-back" size={26} color={colors.ink} />
        </TouchableOpacity>
        <Text style={styles.title}>{t('coach.title')}</Text>
        <View style={{ width: 26 }} />
      </View>

      <KeyboardAvoidingView
        style={styles.fill}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={8}
      >
        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
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

          {/* Suggested prompts */}
          <View style={styles.chips}>
            {SUGGESTIONS.map((key) => (
              <TouchableOpacity
                key={key}
                style={styles.chip}
                disabled={streaming}
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
            testID="coach-input"
          />
          <TouchableOpacity
            style={[styles.askBtn, (streaming || !question.trim()) && styles.askBtnOff]}
            onPress={() => ask()}
            disabled={streaming || !question.trim()}
            testID="coach-ask"
          >
            {streaming ? (
              <ActivityIndicator color={colors.onInk} />
            ) : (
              <Text style={styles.askText}>{t('coach.ask')}</Text>
            )}
          </TouchableOpacity>

          {/* Response */}
          {status !== 'idle' ? (
            <View style={styles.reply} testID="coach-reply">
              <Text style={styles.replyStamp}>{t('coach.replyStamp')}</Text>
              {answer ? <CoachMarkdown text={answer} /> : null}
              {streaming && !answer ? <ActivityIndicator color={colors.accent} style={{ marginTop: space.sm }} /> : null}
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
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
  },
  title: { fontSize: font.h2, fontWeight: '700', color: colors.ink },
  body: { paddingHorizontal: space.lg, paddingBottom: space.xxl },
  intro: { fontSize: font.body, color: colors.ink, lineHeight: 21 },
  counter: { fontSize: font.small, color: colors.teal, marginTop: space.xs, fontVariant: ['tabular-nums'] },
  disclaimer: { fontSize: font.tiny, color: colors.faint, marginTop: space.xs },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginTop: space.lg },
  chip: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.pill,
    paddingHorizontal: space.md,
    paddingVertical: space.xs,
    backgroundColor: colors.inputBg,
  },
  chipText: { fontSize: font.small, color: colors.ink },
  input: {
    borderWidth: 1,
    borderColor: colors.line,
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
