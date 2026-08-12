import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useState } from 'react';
import { Linking, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { routeTranscript, parseMealUtterance } from '@macrolog/core';
import { useLocale, useT } from '@/i18n';
import * as haptics from '@/lib/haptics';
import {
  isSpeechAvailable,
  requestSpeechPermission,
  speechConfigFor,
  startListening,
  stopListening,
} from '@/lib/speech';
import { track } from '@/lib/analytics';
import { useTheme, useThemedStyles, type Theme } from '@/lib/theme-context';
import { font, radius, space } from '@/theme';

/**
 * Dictate a meal instead of typing it.
 *
 * ## What this is and is not
 *
 * It is a **microphone on the search field** — a peer of the keyboard, not a
 * sixth way to log. The transcript feeds the SAME deterministic parser and USDA
 * resolution the typed path already uses (`parseMealUtterance` →
 * `resolveMealItem`), so dictation costs **no AI at all**: transcription is the
 * OS's own recogniser and the macros come from the bundled database.
 *
 * It is not a new logging mode. Nothing here fabricates a number.
 *
 * ## Where a transcript goes
 *
 * "chicken" is a search; "a cup of oats and 100 g chicken" is a meal. Routing on
 * whether the parser found a quantity is `routeTranscript`'s job — pure, tested,
 * and deliberately conservative, because sending a search to the meal draft
 * opens a screen the user did not ask for.
 *
 * ## Permission
 *
 * Asked on the FIRST TAP, never on mount: iOS grants exactly one prompt for the
 * life of the install, and spending it before the user has shown intent is how
 * an app gets denied permanently. On denial the button steps aside quietly and
 * points at Settings only from here — typing is untouched, and there is no
 * modal. Same discipline as the Live Activity honouring its off switch in
 * silence.
 *
 * Absent entirely when the native module is not in the binary (Expo Go, web, or
 * a build from before this shipped), so an older binary shows no dead button.
 */
export function MicButton({
  onSearch,
  onMeal,
}: {
  /** A bare food name — put it in the search box. */
  onSearch: (text: string) => void;
  /** A quantified utterance — hand it to the meal-text draft. */
  onMeal: (text: string) => void;
}) {
  const t = useT();
  const locale = useLocale();
  const styles = useThemedStyles(createStyles);
  const { colors } = useTheme();
  const [listening, setListening] = useState(false);
  const [denied, setDenied] = useState(false);
  // A recognizer that refuses to start used to revert the icon and say
  // NOTHING, which is indistinguishable from a dead button — found by the
  // Maestro suite on an emulator, where no recognizer exists at all. On
  // hardware the same path is reached when the language model is missing or
  // the service is busy.
  const [failed, setFailed] = useState(false);

  // Subscribed lazily so the module's absence cannot throw at import time.
  useEffect(() => {
    if (!isSpeechAvailable()) return;
    let sub: { remove(): void } | undefined;
    let end: { remove(): void } | undefined;
    let err: { remove(): void } | undefined;
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const mod = require('expo-speech-recognition');
      sub = mod.ExpoSpeechRecognitionModule.addListener?.('result', (ev: {
        results?: { transcript?: string }[];
        isFinal?: boolean;
      }) => {
        if (!ev.isFinal) return;
        const text = ev.results?.[0]?.transcript ?? '';
        if (!text.trim()) return;
        const routed = routeTranscript(text, parseMealUtterance);
        haptics.success();
        if (routed.to === 'meal') onMeal(routed.text);
        else onSearch(routed.text);
      });
      end = mod.ExpoSpeechRecognitionModule.addListener?.('end', () => setListening(false));
      err = mod.ExpoSpeechRecognitionModule.addListener?.('error', () => {
        setListening(false);
        setFailed(true);
      });
    } catch {
      /* no module in this binary — the button is not rendered anyway */
    }
    return () => {
      sub?.remove();
      end?.remove();
      err?.remove();
    };
  }, [onMeal, onSearch]);

  const toggle = useCallback(async () => {
    haptics.tap();
    setFailed(false);
    if (listening) {
      stopListening();
      setListening(false);
      return;
    }
    const perm = await requestSpeechPermission();
    if (perm !== 'granted') {
      setDenied(perm === 'denied');
      return;
    }
    const { lang, onDevice } = await speechConfigFor(locale);
    setListening(true);
    track('voice_log');
    startListening(lang, onDevice);
  }, [listening, locale]);

  if (!isSpeechAvailable()) return null;

  if (denied) {
    return (
      <TouchableOpacity onPress={() => Linking.openSettings()} hitSlop={8} testID="mic-denied">
        <Text style={styles.deniedText}>{t('voice.enable')}</Text>
      </TouchableOpacity>
    );
  }

  return (
    <View style={styles.row}>
      <TouchableOpacity
        onPress={toggle}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel={t(listening ? 'voice.stop' : 'voice.start')}
        accessibilityState={{ busy: listening }}
        testID="mic-toggle"
      >
        <Ionicons
          name={listening ? 'stop-circle' : 'mic-outline'}
          size={24}
          color={listening ? colors.accent : colors.ink}
        />
      </TouchableOpacity>
      {/* Say so when the recognizer refuses. Silence here reads as a broken
          button, and it points at typing rather than at Settings, because
          this failure is not a permission problem — that path is `denied`.

          INLINE, not absolutely positioned: Android does not draw a child
          that falls outside its parent's bounds, so an overlay hung below
          this button rendered on nothing (measured on the emulator — the
          state was set and the text never appeared). Width is capped so a
          transient message cannot squeeze the search field, which is the
          exact regression this suite was built to catch. */}
      {failed ? (
        <Text style={styles.failedText} numberOfLines={2} testID="mic-failed">
          {t('voice.failed')}
        </Text>
      ) : null}
    </View>
  );
}

const createStyles = ({ colors }: Theme) =>
  StyleSheet.create({
    deniedText: {
      fontSize: font.tiny,
      color: colors.muted,
      maxWidth: 96,
      paddingVertical: space.xs,
      paddingHorizontal: space.sm,
      borderRadius: radius.sm,
    },
    row: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
    failedText: {
      // Capped: this sits beside the search field, and an unbounded string
      // here would collapse it — the 2026-08-08 bug this suite exists for.
      maxWidth: 104,
      fontSize: font.tiny,
      color: colors.muted,
    },
  });
