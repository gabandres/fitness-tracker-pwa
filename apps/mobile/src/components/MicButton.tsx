import Ionicons from '@expo/vector-icons/Ionicons';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Linking, Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
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
import { announce, isScreenReaderOn } from '@/lib/a11y';
import { useTheme, useThemedStyles, type Theme } from '@/lib/theme-context';
import { font, radius, space } from '@/theme';

/**
 * Apple's 44pt / Material's 48dp. This was a 24pt glyph plus `hitSlop={8}` —
 * 40 on paper, and less on Android, which drops slop that reaches past the
 * parent's bounds (the row hugs the button). A real box is the only version of
 * the target that holds on both platforms.
 */
const TARGET = Platform.OS === 'android' ? 48 : 44;

/**
 * Say "Listening" and, under a screen reader, let it finish before the mic
 * opens. The announcement comes out of the same speaker the recogniser is
 * about to listen to, so opening it at once can transcribe the app's own word
 * and search for "listening". iOS reports when an announcement ends; Android
 * does not, and the cap bounds the wait on both.
 */
function announceBeforeListening(message: string): Promise<void> {
  if (!isScreenReaderOn()) return Promise.resolve();
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      sub?.remove();
      clearTimeout(cap);
      resolve();
    };
    const sub =
      Platform.OS === 'ios'
        ? AccessibilityInfo.addEventListener('announcementFinished', finish)
        : undefined;
    const cap = setTimeout(finish, 1500);
    announce(message);
  });
}

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
  onFailedChange,
}: {
  /** A bare food name — put it in the search box. */
  onSearch: (text: string) => void;
  /** A quantified utterance — hand it to the meal-text draft. */
  onMeal: (text: string) => void;
  /**
   * Raised when the recognizer refuses, so the PARENT can render the message
   * full-width below the search row.
   *
   * It used to render inline, as a sibling of the search field, capped at
   * `maxWidth: 104` with `numberOfLines={2}`. Two comments here asserted the
   * cap made that safe — "the exact regression this suite was built to catch".
   * It did not. Measured 2026-09-22 off `14-mic-after-tap.png` vs
   * `14-search-row.png`: the field still collapsed **309dp -> 203dp (-34%)**,
   * and the string truncated at "Couldn't start / listening — type…", so the
   * half that tells the user what to do instead never rendered. A cap bounds
   * the damage; it does not prevent it.
   */
  onFailedChange?: (failed: boolean) => void;
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
      end = mod.ExpoSpeechRecognitionModule.addListener?.('end', () => {
        // The recogniser ends on its own after a pause. Said aloud only if we
        // were still listening, so the user's own Stop tap (which flips state
        // first and announces itself) is not read twice.
        if (listeningRef.current) announce(t('voice.stopped'));
        // Flipped here as well as by the render: a second `end` (or the Stop
        // tap's own) can arrive before React re-renders, and read it twice.
        listeningRef.current = false;
        setListening(false);
      });
      err = mod.ExpoSpeechRecognitionModule.addListener?.('error', () => {
        setListening(false);
        setFailed(true);
        // The parent draws the message (see `onFailedChange`) with no live
        // region, so it is spoken from here, where the failure is known.
        announce(t('voice.failed'));
      });
    } catch {
      /* no module in this binary — the button is not rendered anyway */
    }
    return () => {
      sub?.remove();
      end?.remove();
      err?.remove();
    };
    // `t` is stable per locale; listed so a language switch mid-session still
    // announces in the right one.
  }, [onMeal, onSearch, t]);

  // Closing the sheet mid-dictation used to leave the recognizer — and the
  // microphone — running with nobody listening for the result. Unmount-only,
  // through a ref: the listener effect above re-runs whenever the parent's
  // inline callbacks change identity, and stopping there would cut a
  // dictation short on every re-render.
  const listeningRef = useRef(listening);
  listeningRef.current = listening;
  /** Cleared by a Stop tap or unmount — read after the "Listening" wait below,
   *  where `listeningRef` still holds the pre-render value. */
  const wantMic = useRef(false);
  useEffect(
    () => () => {
      wantMic.current = false;
      if (listeningRef.current) stopListening();
    },
    [],
  );

  const toggle = useCallback(async () => {
    haptics.tap();
    setFailed(false);
    if (listening) {
      wantMic.current = false;
      // Before `stopListening`: its `end` event can fire synchronously, ahead
      // of the re-render, and would announce "Stopped" a second time.
      listeningRef.current = false;
      stopListening();
      setListening(false);
      announce(t('voice.stopped'));
      return;
    }
    const perm = await requestSpeechPermission();
    if (perm !== 'granted') {
      setDenied(perm === 'denied');
      return;
    }
    const { lang, onDevice } = await speechConfigFor(locale);
    setListening(true);
    wantMic.current = true;
    // The icon swap is the only other cue that the mic is live.
    await announceBeforeListening(t('voice.listening'));
    // Stopped (or unmounted) during that wait: do not open a mic nobody wants.
    if (!wantMic.current) return;
    track('voice_log');
    startListening(lang, onDevice);
  }, [listening, locale, t]);

  useEffect(() => {
    onFailedChange?.(failed);
  }, [failed, onFailedChange]);

  if (!isSpeechAvailable()) return null;

  if (denied) {
    return (
      <TouchableOpacity
        onPress={() => Linking.openSettings()}
        style={styles.target}
        accessibilityRole="button"
        testID="mic-denied"
      >
        <Text style={styles.deniedText}>{t('voice.enable')}</Text>
      </TouchableOpacity>
    );
  }

  return (
    <View style={styles.row}>
      <TouchableOpacity
        onPress={toggle}
        style={styles.target}
        accessibilityRole="button"
        // The label already flips between "Say what you ate" and "Stop
        // listening"; `selected` is the state behind it. It was `busy`, which
        // VoiceOver reads as "busy" — i.e. not ready, the opposite of a live mic.
        accessibilityLabel={t(listening ? 'voice.stop' : 'voice.start')}
        accessibilityState={{ selected: listening }}
        testID="mic-toggle"
      >
        <Ionicons
          name={listening ? 'stop-circle' : 'mic-outline'}
          size={24}
          color={listening ? colors.accent : colors.ink}
        />
      </TouchableOpacity>
      {/* The failure message is NOT rendered here — it goes up through
          `onFailedChange` and is drawn full-width below the search row. An
          absolute overlay was tried first and does not work: Android does not
          draw a child outside its parent's bounds, so it rendered on nothing.
          A capped inline sibling was tried second and is what this replaces. */}
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
    target: { minWidth: TARGET, minHeight: TARGET, alignItems: 'center', justifyContent: 'center' },
  });
