import Ionicons from '@expo/vector-icons/Ionicons';
import { InputAccessoryView, Keyboard, Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useT } from '@/i18n';
import * as haptics from '@/lib/haptics';
import { useTheme, useThemedStyles, type Theme } from '@/lib/theme-context';
import { font, space } from '@/theme';

/*
 * iOS number pads have no Return key (`keyboardType="numeric"` is
 * UIKeyboardTypeDecimalPad). Two things in React Native 0.86 (Fabric) decide
 * how this file handles that — both read from its source, neither visible to
 * tsc or jest:
 *
 * 1. RN ALREADY draws a one-button UIToolbar above a number pad whenever the
 *    input sets `returnKeyType`; the button fires `onSubmitEditing` and is
 *    titled from the return key type — in hardcoded ENGLISH ("Next", "Done")
 *    unless `inputAccessoryViewButtonLabel` is passed. So es-PR and pt-BR users
 *    saw "Next"/"Done" on every number field. `useDoneKeyProps` localizes it.
 *
 * 2. `<InputAccessoryView nativeID>` links to ONE input: at its own
 *    `didMoveToWindow` it searches the window for the first TextInput whose
 *    `inputAccessoryViewID` matches, attaches, and never looks again. Sharing
 *    one id across several inputs (what the RN docs suggest) leaves every input
 *    but the first with NO bar — and an input carrying an id also loses the
 *    built-in toolbar from (1). So each input gets its OWN bar, rendered right
 *    AFTER it in the same parent, mounted and unmounted with it: the input is
 *    already in the window when the bar looks for it. An input that
 *    `autoFocus`es would take the keyboard before its bar attached, so those
 *    stay on (1) instead.
 */

/**
 * ‹ › Done above one iOS number pad — the form's kcal → protein → carbs → fat
 * chain, where "previous field" matters as much as "next". Renders nothing on
 * Android, whose numeric keypad has a Return key (`returnKeyType` next/done).
 * Place it immediately after the TextInput it serves (see note 2 above).
 *
 * The keyboard frame the sheet pads for includes the bar, so
 * `useKeyboardSheetPadding` lifts the pinned Save above it with no arithmetic.
 * Done only dismisses the keyboard; it never saves — Save stays the explicit
 * act, as Return does on every iOS form.
 */
export function KeyboardBar({
  nativeID,
  onPrev,
  onNext,
}: {
  nativeID: string;
  /** Focus the previous / next field; undefined greys the arrow out. */
  onPrev?: () => void;
  onNext?: () => void;
}) {
  const t = useT();
  const styles = useThemedStyles(createStyles);
  const { colors } = useTheme();
  if (Platform.OS !== 'ios') return null;
  const arrow = (dir: 'prev' | 'next', run: (() => void) | undefined) => (
    <TouchableOpacity
      style={styles.btn}
      onPress={() => {
        if (!run) return;
        haptics.tap();
        run();
      }}
      disabled={!run}
      accessibilityRole="button"
      accessibilityLabel={t(dir === 'prev' ? 'entry.kbPrev' : 'entry.kbNext')}
      accessibilityState={{ disabled: !run }}
      testID={`${nativeID}-${dir}`}
    >
      <Ionicons
        name={dir === 'prev' ? 'chevron-back' : 'chevron-forward'}
        size={22}
        color={run ? colors.ink : colors.faint}
      />
    </TouchableOpacity>
  );
  return (
    <InputAccessoryView nativeID={nativeID} backgroundColor={colors.card}>
      <View style={styles.bar}>
        {arrow('prev', onPrev)}
        {arrow('next', onNext)}
        <View style={styles.fill} />
        <TouchableOpacity
          style={[styles.btn, styles.done]}
          onPress={() => Keyboard.dismiss()}
          accessibilityRole="button"
          accessibilityLabel={t('common.done')}
          testID={`${nativeID}-done`}
        >
          <Text style={styles.doneText} maxFontSizeMultiplier={1.4}>{t('common.done')}</Text>
        </TouchableOpacity>
      </View>
    </InputAccessoryView>
  );
}

/**
 * The props a TextInput needs to show its `KeyboardBar`: the accessory id, and
 * a keyboard drawn in the app's own scheme so the bar (painted from the
 * palette) and the keys under it never disagree — the app has its own
 * light/dark setting, and the system keyboard otherwise follows the OS one.
 * Empty off iOS.
 */
export function useKeyboardBarProps(nativeID: string) {
  const { scheme } = useTheme();
  return Platform.OS === 'ios'
    ? { inputAccessoryViewID: nativeID, keyboardAppearance: scheme }
    : {};
}

/**
 * A lone number field's way off the keyboard: RN's own toolbar (note 1), with
 * its button in the user's language. Also right for a field that autoFocuses,
 * which a `KeyboardBar` cannot serve. Android gets a Done return key.
 */
export function useDoneKeyProps() {
  const t = useT();
  return {
    returnKeyType: 'done' as const,
    ...(Platform.OS === 'ios' ? { inputAccessoryViewButtonLabel: t('common.done') } : {}),
  };
}

const createStyles = ({ colors }: Theme) => StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 44,
    paddingHorizontal: space.xs,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.lineStrong,
    backgroundColor: colors.card,
  },
  fill: { flex: 1 },
  btn: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  done: { paddingHorizontal: space.md },
  doneText: { fontSize: font.body, fontWeight: '700', color: colors.teal },
});
