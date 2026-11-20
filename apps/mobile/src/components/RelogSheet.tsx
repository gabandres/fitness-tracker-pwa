import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import type { DailyLog } from '@macrolog/core';
import { BottomSheet } from '@/components/BottomSheet';
import { SheetHeader } from '@/components/SheetHeader';
import { Touchable } from '@/components/Touchable';
import { useLocale, useT } from '@/i18n';
import { formatNumber } from '@/lib/date-format';
import * as haptics from '@/lib/haptics';
import { useTheme, useThemedStyles, type Theme } from '@/lib/theme-context';
import { font, radius, space, TARGET } from '@/theme';

/**
 * "Log again…" on a past day (UX_AUDIT S24-16, 2026-11-19): pick several of
 * that day's entries and add them to today in one go. The app had Repeat
 * yesterday, a per-meal copy and "Copy to today" on one row behind a long
 * press — nothing for "the same breakfast and lunch as last Tuesday".
 *
 * A list of checkboxes, nothing selected to begin with, a Select all, and one
 * button that says how many it will add and what they come to. The add itself
 * is the caller's (`useDiaryActions.onSaveMany`: one receipt, one Undo).
 */

/** Stable identity for a row: its doc id, else its position. */
const keyOf = (log: DailyLog, i: number) => log.id ?? `row-${i}`;

/** The selected rows, in the day's order. Pure, so the selection logic is
 *  testable without a sheet. */
export function selectedLogs(logs: readonly DailyLog[], selected: ReadonlySet<string>): DailyLog[] {
  return logs.filter((l, i) => selected.has(keyOf(l, i)));
}

export function RelogSheet({
  visible,
  logs,
  onClose,
  onConfirm,
}: {
  visible: boolean;
  /** The day's food entries, oldest first. */
  logs: readonly DailyLog[];
  onClose: () => void;
  onConfirm: (picked: DailyLog[]) => void;
}) {
  const t = useT();
  const locale = useLocale();
  const styles = useThemedStyles(createStyles);
  const { colors } = useTheme();
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());

  // A fresh choice each time it opens.
  useEffect(() => {
    if (visible) setSelected(new Set());
  }, [visible]);

  const picked = selectedLogs(logs, selected);
  const allOn = logs.length > 0 && picked.length === logs.length;
  const kcal = picked.reduce((sum, l) => sum + l.calories, 0);

  function toggle(key: string) {
    haptics.tap();
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function toggleAll() {
    haptics.tap();
    setSelected(allOn ? new Set() : new Set(logs.map(keyOf)));
  }

  return (
    <BottomSheet native visible={visible} onClose={onClose} contentStyle={styles.body} maxHeight="80%">
      <SheetHeader
        title={t('relog.title')}
        leading={{ label: t('common.cancel'), onPress: onClose, testID: 'relog-cancel' }}
        trailing={{ label: t(allOn ? 'relog.selectNone' : 'relog.selectAll'), onPress: toggleAll, testID: 'relog-select-all' }}
      />
      <ScrollView nestedScrollEnabled showsVerticalScrollIndicator={false} contentContainerStyle={styles.list}>
        {logs.map((log, i) => {
          const key = keyOf(log, i);
          const on = selected.has(key);
          const name = log.mealLabel || t('today.entry');
          const amount = t('relog.kcal', { n: formatNumber(log.calories, locale) });
          return (
            <Touchable
              key={key}
              style={[styles.row, on && styles.rowOn]}
              onPress={() => toggle(key)}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: on }}
              accessibilityLabel={`${name}, ${amount}`}
              testID={`relog-row-${i}`}
            >
              <Ionicons name={on ? 'checkbox' : 'square-outline'} size={24} color={on ? colors.tealSolid : colors.muted} />
              <Text style={styles.name} numberOfLines={2}>{name}</Text>
              <Text style={styles.kcal}>{amount}</Text>
            </Touchable>
          );
        })}
      </ScrollView>
      <Touchable
        style={[styles.cta, picked.length === 0 && styles.ctaOff]}
        disabled={picked.length === 0}
        onPress={() => {
          haptics.tap();
          onConfirm(picked);
        }}
        accessibilityRole="button"
        accessibilityState={{ disabled: picked.length === 0 }}
        testID="relog-confirm"
      >
        <Text style={styles.ctaText}>
          {picked.length === 0
            ? t('relog.pickSome')
            : t(picked.length === 1 ? 'relog.addOne' : 'relog.addMany', {
                n: picked.length,
                kcal: formatNumber(kcal, locale),
              })}
        </Text>
      </Touchable>
    </BottomSheet>
  );
}

const createStyles = ({ colors }: Theme) =>
  StyleSheet.create({
    body: { paddingHorizontal: space.xl, paddingBottom: space.xl, gap: space.md },
    list: { gap: space.xs },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: space.md,
      minHeight: TARGET,
      paddingHorizontal: space.md,
      paddingVertical: space.sm,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.line,
      backgroundColor: colors.card,
    },
    rowOn: { borderColor: colors.tealSolid },
    name: { flex: 1, fontSize: font.body, color: colors.ink, fontWeight: '600' },
    kcal: { fontSize: font.small, color: colors.muted, fontVariant: ['tabular-nums'] },
    cta: {
      minHeight: TARGET,
      borderRadius: radius.pill,
      backgroundColor: colors.ink,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: space.lg,
    },
    ctaOff: { opacity: 0.4 },
    ctaText: { fontSize: font.body, fontWeight: '800', color: colors.onInk },
  });
