import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { buildCoachSystemInstruction } from '@macrolog/core';
import { CoachMarkdown } from '@/components/CoachMarkdown';
import { useCoach } from '@/hooks/useCoach';
import { useAuth } from '@/lib/auth';
import { CoachErrorCode, type CoachError, streamCoach } from '@/lib/coach';
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
      await streamCoach({
        systemInstruction,
        prompt: q,
        idToken,
        onMeta: (m) => {
          setLimit(m.limit);
          setRemaining(m.remaining < 0 ? null : m.remaining);
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
          {remaining !== null && limit !== null ? (
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
