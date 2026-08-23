import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
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
import { FEEDBACK_MAX_LENGTH, type FeedbackCategory, sendFeedback } from '@/lib/feedback';
import { type I18nKey, useT } from '@/i18n';
import { useAuth } from '@/lib/auth';
import * as haptics from '@/lib/haptics';
import { useTheme, useThemedStyles, type Theme } from '@/lib/theme-context';
import { font, radius, space } from '@/theme';

/**
 * In-app feedback.
 *
 * ## Why it exists, in the reporter's own words
 *
 * *"por qué no le haces una parte de feedback in-app para que por shy te
 * escriban sugerencias"* (UX_AUDIT, Abdiel Medina, 2026-08-21). The barrier he
 * names is social, not technical — people who would not message the owner
 * directly will leave a note inside the app. That is why this is a composer
 * and not a `mailto:` or a link out to `ignia.fit/support`: both of those hand
 * the reporter's name and address to the person they were too shy to message,
 * and both are a context switch that a hesitant person abandons. The report
 * arrived by private chat, which is itself the evidence.
 *
 * ## Choices that are load-bearing
 *
 * The category chips are OPTIONAL and default to unset. A required chooser in
 * front of a text box turns "tell me what you think" into a form.
 *
 * The write is create-only in the rules and the reporter cannot read it back.
 * There is no in-app inbox, and a readable copy would imply one — the honest
 * shape is "this was sent", not "this is a thread".
 *
 * Text only. Attachments would mean Storage rules, a size budget and a PII
 * surface, for an alpha whose reports so far have been one sentence long.
 */
const CATEGORIES: { key: FeedbackCategory; labelKey: I18nKey; icon: keyof typeof Ionicons.glyphMap }[] = [
  { key: 'bug', labelKey: 'feedback.catBug', icon: 'bug-outline' },
  { key: 'idea', labelKey: 'feedback.catIdea', icon: 'bulb-outline' },
  { key: 'confusing', labelKey: 'feedback.catConfusing', icon: 'help-circle-outline' },
  { key: 'other', labelKey: 'feedback.catOther', icon: 'chatbubble-outline' },
];

// `KeyboardAvoidingView` comes from react-native-keyboard-controller, NOT from
// react-native. RN's own version was built for iOS and reads the keyboard frame
// straight from the system notification, which iOS 26 reports inconsistently
// (Apple forums 800310 / 814154) — that is the "spacing is much larger" the
// input screens were showing. The library normalises the frame across both
// platforms and is already a dependency, with <KeyboardProvider> mounted at the
// app root, so this costs nothing new. Same props, so `behavior` stays
// iOS-only: Android relies on windowSoftInputMode=adjustResize and must not
// also be padded.
export default function FeedbackScreen() {
  const t = useT();
  const styles = useThemedStyles(createStyles);
  const { colors } = useTheme();
  const { user } = useAuth();
  const router = useRouter();

  const [message, setMessage] = useState('');
  const [category, setCategory] = useState<FeedbackCategory | null>(null);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const over = message.length - FEEDBACK_MAX_LENGTH;
  const canSend = message.trim().length > 0 && over <= 0 && !busy;

  async function onSend() {
    if (!canSend || !user) return;
    setError(null);
    setBusy(true);
    try {
      await sendFeedback(user.uid, { message: message.trim(), category });
      haptics.success();
      setSent(true);
    } catch {
      setError(t('feedback.err'));
    } finally {
      // Same reason as the targets editor: clearing this only on the error
      // path leaves the button permanently disabled in any case where the
      // screen stays mounted.
      setBusy(false);
    }
  }

  // The confirmation replaces the composer rather than sitting under it. A
  // form still on screen after a successful send invites a second copy of the
  // same report.
  if (sent) {
    return (
      <SafeAreaView style={styles.screen} edges={['top']}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} hitSlop={10} testID="feedback-back">
            <Ionicons name="chevron-back" size={26} color={colors.ink} />
          </TouchableOpacity>
          <Text style={styles.title}>{t('feedback.title')}</Text>
          <View style={{ width: 26 }} />
        </View>
        <View style={styles.doneWrap} testID="feedback-sent">
          <Ionicons name="checkmark-circle" size={56} color={colors.ring} />
          <Text style={styles.doneTitle}>{t('feedback.sent')}</Text>
          <Text style={styles.doneBody}>{t('feedback.sentBody')}</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={10} testID="feedback-back">
          <Ionicons name="chevron-back" size={26} color={colors.ink} />
        </TouchableOpacity>
        <Text style={styles.title}>{t('feedback.title')}</Text>
        <View style={{ width: 26 }} />
      </View>

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.fill}>
        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          <Text style={styles.intro}>{t('feedback.intro')}</Text>

          <View style={styles.chips}>
            {CATEGORIES.map((c) => {
              const on = category === c.key;
              return (
                <TouchableOpacity
                  key={c.key}
                  style={[styles.chip, on && styles.chipOn]}
                  // Tapping the active chip clears it — the chooser is
                  // optional, so it has to be un-choosable.
                  onPress={() => { haptics.tap(); setCategory(on ? null : c.key); }}
                  accessibilityRole="button"
                  accessibilityState={{ selected: on }}
                  testID={`feedback-cat-${c.key}`}
                >
                  <Ionicons name={c.icon} size={16} color={on ? colors.onInk : colors.muted} />
                  <Text style={[styles.chipText, on && styles.chipTextOn]}>{t(c.labelKey)}</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <TextInput
            style={styles.input}
            value={message}
            onChangeText={setMessage}
            placeholder={t('feedback.placeholder')}
            placeholderTextColor={colors.faint}
            multiline
            textAlignVertical="top"
            accessibilityLabel={t('feedback.placeholder')}
            testID="feedback-message"
          />
          {over > 0 ? (
            <Text style={[styles.note, styles.noteBad]} testID="feedback-too-long">
              {t('feedback.tooLong', { n: over })}
            </Text>
          ) : null}

          <Text style={styles.note}>{t('feedback.privacy')}</Text>
          {error ? <Text style={styles.error}>{error}</Text> : null}
        </ScrollView>

        <View style={styles.footer}>
          <TouchableOpacity
            style={[styles.send, !canSend && styles.sendDisabled]}
            disabled={!canSend}
            onPress={onSend}
            testID="feedback-send"
          >
            {busy ? (
              <ActivityIndicator color={colors.onInk} />
            ) : (
              <Text style={styles.sendText}>{t('feedback.send')}</Text>
            )}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const createStyles = ({ colors }: Theme) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.paper },
    fill: { flex: 1 },
    header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.lg, paddingVertical: space.md },
    title: { flex: 1, textAlign: 'center', fontSize: font.h2, fontWeight: '800', color: colors.ink },
    body: { paddingHorizontal: space.xl, paddingBottom: space.xl, gap: space.md },
    intro: { fontSize: font.body, color: colors.muted },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
    chip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: space.xs,
      borderWidth: 1,
      borderColor: colors.line,
      borderRadius: radius.pill,
      paddingVertical: space.sm,
      paddingHorizontal: space.md,
      backgroundColor: colors.inputBg,
    },
    chipOn: { backgroundColor: colors.ink, borderColor: colors.ink },
    chipText: { fontSize: font.small, color: colors.muted, fontWeight: '600' },
    chipTextOn: { color: colors.onInk },
    input: {
      backgroundColor: colors.inputBg,
      borderWidth: 1,
      borderColor: colors.line,
      borderRadius: radius.md,
      paddingHorizontal: space.lg,
      paddingVertical: space.md,
      fontSize: font.body,
      color: colors.ink,
      minHeight: 160,
    },
    note: { fontSize: font.small, color: colors.muted },
    noteBad: { color: colors.danger },
    error: { color: colors.danger, fontSize: font.small },
    footer: {
      paddingHorizontal: space.xl,
      paddingTop: space.md,
      paddingBottom: space.lg,
      borderTopWidth: 1,
      borderTopColor: colors.line,
    },
    send: { backgroundColor: colors.ink, borderRadius: radius.md, paddingVertical: space.lg, alignItems: 'center' },
    sendDisabled: { opacity: 0.4 },
    sendText: { color: colors.onInk, fontWeight: '700', fontSize: font.h3 },
    doneWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.sm, paddingHorizontal: space.xl },
    doneTitle: { fontSize: font.h2, fontWeight: '800', color: colors.ink, textAlign: 'center' },
    doneBody: { fontSize: font.body, color: colors.muted, textAlign: 'center' },
  });
