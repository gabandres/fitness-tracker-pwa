import Ionicons from '@expo/vector-icons/Ionicons';
import type { ReactNode } from 'react';
import { Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useT } from '@/i18n';
import { openStoreListing } from '@/lib/app-update';
import * as haptics from '@/lib/haptics';
import { useTheme, useThemedStyles, type Theme } from '@/lib/theme-context';
import { useUpdateRequired } from '@/lib/update-required';
import { font, radius, space, TARGET, type } from '@/theme';

/** Store names are proper nouns and stay untranslated in every locale. */
const STORE_NAME = Platform.OS === 'android' ? 'Google Play' : 'App Store';

/**
 * Full-screen "Update required". Deliberately has NO dismiss, NO close and NO
 * way past it: it is shown only when the server says this binary is below the
 * supported minimum (`update-required.ts`), and the one thing that resolves
 * that is a newer binary from the store. Data is safe in the account — the
 * copy says so, because "you can't use the app" otherwise reads as "your data
 * is gone".
 */
export function UpdateRequiredScreen() {
  const t = useT();
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const insets = useSafeAreaInsets();

  return (
    <View
      style={[styles.root, { paddingTop: insets.top + space.xl, paddingBottom: insets.bottom + space.xl, paddingLeft: insets.left + space.xl, paddingRight: insets.right + space.xl }]}
      // Everything behind this is hidden from VoiceOver (`accessibilityViewIsModal`)
      // and TalkBack (the gate marks its siblings `no-hide-descendants`).
      accessibilityViewIsModal
      testID="update-required"
    >
      <View style={styles.body}>
        <Ionicons name="arrow-up-circle" size={56} color={colors.accent} importantForAccessibility="no" accessibilityElementsHidden />
        <Text style={styles.title} accessibilityRole="header">
          {t('update.required.title')}
        </Text>
        <Text style={styles.text}>{t('update.required.body', { store: STORE_NAME })}</Text>
      </View>
      <TouchableOpacity
        style={styles.button}
        onPress={() => {
          haptics.tap();
          void openStoreListing();
        }}
        accessibilityRole="button"
        accessibilityLabel={t('update.required.a11y', { store: STORE_NAME })}
        testID="update-required-open-store"
      >
        <Text style={styles.buttonText}>{t('update.required.action')}</Text>
      </TouchableOpacity>
    </View>
  );
}

/**
 * Mount ONCE at the root, around everything — sign-in included. When the
 * binary is below the minimum the app underneath stays mounted (the router
 * must keep its navigator) but is covered, untouchable and hidden from
 * screen readers.
 */
export function UpdateRequiredGate({ children }: { children: ReactNode }) {
  const required = useUpdateRequired();
  return (
    <>
      <View
        style={gateStyles.fill}
        importantForAccessibility={required ? 'no-hide-descendants' : 'auto'}
        accessibilityElementsHidden={required}
        pointerEvents={required ? 'none' : 'auto'}
      >
        {children}
      </View>
      {required ? <UpdateRequiredScreen /> : null}
    </>
  );
}

const gateStyles = StyleSheet.create({ fill: { flex: 1 } });

const createStyles = ({ colors }: Theme) =>
  StyleSheet.create({
    root: {
      ...StyleSheet.absoluteFill,
      backgroundColor: colors.paper,
      paddingHorizontal: space.xl,
      justifyContent: 'space-between',
      // Above the root splash (zIndex 100) and the raised Log button.
      zIndex: 1000,
      elevation: 1000,
    },
    body: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.lg },
    // Manrope carries its own weight — no `fontWeight` (ADR-0014).
    title: { fontFamily: type.heading, fontSize: font.h2, color: colors.ink, textAlign: 'center' },
    text: { fontSize: font.body, color: colors.muted, textAlign: 'center', lineHeight: 24 },
    button: {
      minHeight: Math.max(TARGET, 52),
      borderRadius: radius.pill,
      backgroundColor: colors.accent,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: space.xl,
    },
    // `onFill`, never white: on the dark palette the accent fill is light and
    // white text on it fails AA (`theme-contrast.test.ts`).
    buttonText: { fontFamily: type.heading, fontSize: font.body, color: colors.onFill },
  });
