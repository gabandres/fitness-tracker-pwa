import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { QUICK_ADD_MAX, type MealPreset } from '@macrolog/core';
import { type I18nKey, useT } from '@/i18n';
import { useAuth } from '@/lib/auth';
import * as haptics from '@/lib/haptics';
import { subscribePresets } from '@/lib/ledger';
import { getQuickAddSlots, readQuickAddOutcome, toggleQuickAddSlot } from '@/lib/quick-add';
import { trackSubs } from '@/lib/sub-debug';
import { useTheme, useThemedStyles, type Theme } from '@/lib/theme-context';
import { font, radius, space } from '@/theme';

/**
 * Settings → which presets are quick-addable from outside the app (ADR-0020).
 *
 * One list feeds three surfaces: the home-screen widget's buttons, the Quick
 * Settings tile (slot 1 only — it is a single blind tap, so it takes the first
 * one), and on iOS the Siri shortcuts. Presenting it as one ordered choice is
 * the point: three separate pickers for the same idea is how a settings screen
 * becomes unlearnable.
 *
 * **The list is device-local**, not a profile field. A tile and a home screen
 * belong to *this* phone, the same way the reminder and Health-connection
 * preferences do — and keeping it local means this feature needed no new
 * Firestore field and therefore no `firestore.rules` deploy.
 *
 * It subscribes presets itself rather than receiving them. Settings does not
 * hold them, and an independent per-screen `onSnapshot` is the documented model
 * here (ADR-0016), focus-gated so it does not hold a channel open behind other
 * tabs.
 */
export function QuickAddCard() {
  const t = useT();
  const styles = useThemedStyles(createStyles);
  const { colors } = useTheme();
  const { user } = useAuth();
  const uid = user?.uid;
  const [presets, setPresets] = useState<MealPreset[]>([]);
  const [slots, setSlots] = useState<string[]>([]);

  useEffect(() => {
    let alive = true;
    void getQuickAddSlots().then((s) => {
      if (alive) setSlots(s);
    });
    return () => {
      alive = false;
    };
  }, []);

  useFocusEffect(
    useCallback(() => {
      if (!uid) return;
      return trackSubs('QuickAdd', [subscribePresets(uid, setPresets)]);
    }, [uid]),
  );

  // What the last widget/tile tap actually did, re-read on every focus.
  //
  // This is the app's only window into a surface that cannot answer back. A
  // widget button has no dialog and no toast, and the two failure paths that
  // matter deliberately leave its numbers untouched — so a refused tap looks
  // exactly like a successful one, and like a button that was never wired up. An
  // unreachable keychain made every widget quick-add a no-op from build 27 to
  // build 32 with nothing anywhere recording it.
  //
  // Only failures are shown. "It worked" is already answered by the numbers.
  const [problem, setProblem] = useState<I18nKey | null>(null);
  useFocusEffect(
    useCallback(() => {
      let alive = true;
      void readQuickAddOutcome().then((o) => {
        if (!alive) return;
        if (o?.outcome === 'signedOut') setProblem('settings.quickAddSignedOut');
        else if (o?.outcome === 'noSlot') setProblem('settings.quickAddNoSlot');
        else setProblem(null);
      });
      return () => {
        alive = false;
      };
    }, []),
  );

  async function toggle(presetId: string) {
    haptics.tap();
    setSlots(await toggleQuickAddSlot(presetId));
  }

  return (
    <View style={styles.card}>
      <Text style={styles.rowLabel}>{t('settings.quickAdd')}</Text>
      <Text style={styles.rowValue}>{t('settings.quickAddSub')}</Text>

      {presets.length === 0 ? (
        // Not an error state: presets are created from the add sheet, and a user
        // who has none has nothing to designate. Say where they come from rather
        // than showing an empty box.
        <Text style={styles.empty} testID="quick-add-no-presets">
          {t('settings.quickAddNoPresets')}
        </Text>
      ) : (
        presets.map((preset) => {
          const slot = preset.id ? slots.indexOf(preset.id) : -1;
          const on = slot >= 0;
          return (
            <TouchableOpacity
              key={preset.id}
              style={styles.row}
              onPress={() => preset.id && toggle(preset.id)}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: on }}
              testID={`quick-add-${preset.id}`}
            >
              <View style={styles.rowText}>
                <Text style={styles.name} numberOfLines={1}>
                  {preset.name}
                </Text>
                <Text style={styles.macros}>
                  {t('settings.quickAddMacros', {
                    kcal: String(Math.round(preset.calories)),
                    protein: String(Math.round(preset.protein ?? 0)),
                  })}
                </Text>
              </View>
              {/* The slot NUMBER, not a generic tick: slot 1 is the one the
                  Quick Settings tile fires, so which position a preset holds is
                  load-bearing information and not decoration. */}
              {on ? (
                <View style={styles.badge}>
                  <Text style={styles.badgeText}>{slot + 1}</Text>
                </View>
              ) : (
                <Ionicons name="ellipse-outline" size={22} color={colors.line} />
              )}
            </TouchableOpacity>
          );
        })
      )}

      {slots.length >= QUICK_ADD_MAX ? (
        <Text style={styles.hint}>{t('settings.quickAddFull', { n: String(QUICK_ADD_MAX) })}</Text>
      ) : null}
      {slots.length > 0 ? <Text style={styles.hint}>{t('settings.quickAddWidgetHint')}</Text> : null}

      {/* The only place a refused tap can ever surface. See `readQuickAddOutcome`. */}
      {problem ? <Text style={styles.problem}>{t(problem)}</Text> : null}
    </View>
  );
}

const createStyles = ({ colors }: Theme) =>
  StyleSheet.create({
    card: {
      backgroundColor: colors.card,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: colors.line,
      padding: space.lg,
      gap: space.xs,
    },
    rowLabel: { fontSize: font.body, fontWeight: '600', color: colors.ink },
    rowValue: { fontSize: font.body, color: colors.muted, marginTop: 2 },
    empty: { fontSize: font.small, color: colors.muted, marginTop: space.sm },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingVertical: space.sm,
      gap: space.sm,
    },
    rowText: { flex: 1 },
    name: { fontSize: font.body, color: colors.ink },
    macros: { fontSize: font.tiny, color: colors.muted },
    badge: {
      width: 22,
      height: 22,
      borderRadius: radius.pill,
      backgroundColor: colors.ink,
      alignItems: 'center',
      justifyContent: 'center',
    },
    badgeText: { fontSize: font.tiny, fontWeight: '700', color: colors.onInk },
    problem: { fontSize: font.small, color: colors.warn, marginTop: space.sm },
    hint: { fontSize: font.tiny, color: colors.muted, marginTop: space.xs },
  });
