import { memo, useCallback } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import {
  cardioSummaryCells,
  clampCardioDurationSec,
  clampDistanceM,
  clampHr,
  clampRpe,
  distanceUnit,
  formatDistance,
  parseDistanceToM,
} from '@macrolog/core';
import type { CardioBlock } from '@macrolog/core/cardio';
import { useT } from '@/i18n';
import type { I18nKey } from '@/i18n';
import { useTheme, useThemedStyles } from '@/lib/theme-context';
import { useUnitSystem } from '@/lib/use-unit-system';
import { createStyles } from './train-styles';

/**
 * One cardio block inside an active session (ADR-0025).
 *
 * Shares `exCard`'s frame with an exercise on purpose: the two are peers in one
 * session, and a distinct card treatment would make cardio read as a separate
 * feature bolted on beside Train rather than part of it.
 *
 * ## Why the fields are minutes and miles, but the block is not
 *
 * `durationSec` stores seconds and `distanceM` stores meters (ADR-0025), while
 * nobody types either. The conversion is here, at the edge, so nothing
 * downstream has to know what unit the user happens to prefer — the same seam
 * `load-units` draws for a barbell.
 *
 * ## Why kcal is rendered with a sentence attached
 *
 * `kcal` is what the ring said, and it is never spent (ADR-0024 decision 4 /
 * ADR-0026 decision 5). A bare "612 kcal" beside a duration reads as a budget,
 * and the one thing a user must not conclude is that they have earned it back.
 * The number and its explanation are one unit; do not render the number alone.
 */

const MODALITY_KEY: Record<CardioBlock['modality'], I18nKey> = {
  run: 'cardio.modality.run',
  walk: 'cardio.modality.walk',
  ride: 'cardio.modality.ride',
  swim: 'cardio.modality.swim',
  row: 'cardio.modality.row',
  elliptical: 'cardio.modality.elliptical',
  stair: 'cardio.modality.stair',
  hike: 'cardio.modality.hike',
  sport: 'cardio.modality.sport',
  other: 'cardio.modality.other',
};

const PROVIDER_KEY: Record<NonNullable<CardioBlock['provider']>, I18nKey> = {
  oura: 'cardio.provider.oura',
  'apple-watch': 'cardio.provider.apple-watch',
  garmin: 'cardio.provider.garmin',
  whoop: 'cardio.provider.whoop',
  other: 'cardio.provider.other',
};

export interface CardioBlockCardProps {
  block: CardioBlock;
  /** Position in `session.cardio`. Used only to build stable testIDs — a
   *  device flow has to address ONE card's duration field, and a shared id
   *  would silently type into whichever card rendered first. */
  index: number;
  /** Applied locally per keystroke; the caller flushes on blur, matching how
   *  set inputs already work (`dispatch(..., { defer: true })`). */
  onPatch: (patch: Partial<CardioBlock>, opts?: { defer?: boolean }) => void;
  onCommit: () => void;
  onRemove: () => void;
  /** True when another block on this day overlaps this one in time — a
   *  suggestion, never an automatic merge (ADR-0026 decision 4). */
  overlaps?: boolean;
}

function CardioBlockCardInner({ block, index, onPatch, onCommit, onRemove, overlaps }: CardioBlockCardProps) {
  const t = useT();
  const styles = useThemedStyles(createStyles);
  const { colors } = useTheme();
  const unitSystem = useUnitSystem();

  const imported = block.source === 'health';
  const cells = cardioSummaryCells(block, unitSystem);

  const patchNum = useCallback(
    (key: 'durationSec' | 'distanceM' | 'avgHr' | 'rpe', raw: string) => {
      // Blank clears the field rather than storing 0 — `numOrUndef`'s rule in
      // train-shared, and the same reason: a cleared duration means "not
      // entered", and a stored 0 would mark the block unperformed instead.
      const text = raw.trim();
      if (text === '') {
        onPatch({ [key]: undefined } as Partial<CardioBlock>, { defer: true });
        return;
      }
      if (key === 'durationSec') {
        const minutes = Number(text.replace(',', '.'));
        onPatch({ durationSec: clampCardioDurationSec(Math.round(minutes * 60)) }, { defer: true });
        return;
      }
      if (key === 'distanceM') {
        const meters = parseDistanceToM(text, unitSystem);
        onPatch({ distanceM: meters == null ? undefined : clampDistanceM(meters) }, { defer: true });
        return;
      }
      const n = Number(text);
      onPatch(
        key === 'avgHr' ? { avgHr: clampHr(n) } : { rpe: clampRpe(n) },
        { defer: true },
      );
    },
    [onPatch, unitSystem],
  );

  return (
    <View style={styles.exCard}>
      <View style={styles.cardioHead}>
        <Ionicons name="pulse-outline" size={18} color={colors.accent} />
        <Text style={styles.cardioName} numberOfLines={1}>
          {block.label ?? t(MODALITY_KEY[block.modality])}
        </Text>
      </View>

      {imported && block.provider ? (
        <View style={styles.cardioVia}>
          <Ionicons name="ellipse-outline" size={10} color={colors.muted} />
          <Text style={styles.cardioViaText}>
            {t('cardio.via', { provider: t(PROVIDER_KEY[block.provider]) })}
          </Text>
        </View>
      ) : null}

      {cells.length ? (
        <Text style={styles.cardioSummary}>{cells.join(' · ')}</Text>
      ) : (
        <Text style={styles.cardioSummary}>{t('cardio.emptyBlock')}</Text>
      )}

      {block.targetDurationSec != null ? (
        <Text style={styles.cardioTarget}>
          {t('cardio.target', {
            value: `${Math.round(block.targetDurationSec / 60)} ${t('cardio.durationUnit')}`,
          })}
        </Text>
      ) : null}
      {block.targetDistanceM != null ? (
        <Text style={styles.cardioTarget}>
          {t('cardio.target', { value: formatDistance(block.targetDistanceM, unitSystem) })}
        </Text>
      ) : null}

      <View style={styles.cardioFieldRow}>
        <View style={styles.cardioField}>
          <Text style={styles.cardioLabel}>
            {t('cardio.duration')} ({t('cardio.durationUnit')})
          </Text>
          <TextInput
            style={styles.cardioInput}
            keyboardType="numeric"
            inputMode="numeric"
            selectTextOnFocus
            returnKeyType="done"
            defaultValue={block.durationSec > 0 ? String(Math.round(block.durationSec / 60)) : ''}
            placeholder={
              block.targetDurationSec != null ? String(Math.round(block.targetDurationSec / 60)) : '0'
            }
            placeholderTextColor={colors.faint}
            accessibilityLabel={t('cardio.duration')}
            testID={`cardio-duration-${index}`}
            onChangeText={(v) => patchNum('durationSec', v)}
            onBlur={onCommit}
          />
        </View>
        <View style={styles.cardioField}>
          <Text style={styles.cardioLabel}>
            {t('cardio.distance')} ({distanceUnit(unitSystem)})
          </Text>
          <TextInput
            style={styles.cardioInput}
            keyboardType="numeric"
            inputMode="decimal"
            selectTextOnFocus
            returnKeyType="done"
            defaultValue={
              block.distanceM != null
                ? String(formatDistance(block.distanceM, unitSystem).split(' ')[0])
                : ''
            }
            placeholder="—"
            placeholderTextColor={colors.faint}
            accessibilityLabel={t('cardio.distance')}
            testID={`cardio-distance-${index}`}
            onChangeText={(v) => patchNum('distanceM', v)}
            onBlur={onCommit}
          />
        </View>
      </View>

      <View style={styles.cardioFieldRow}>
        <View style={styles.cardioField}>
          <Text style={styles.cardioLabel}>
            {t('cardio.avgHr')} ({t('cardio.hrUnit')})
          </Text>
          <TextInput
            style={styles.cardioInput}
            keyboardType="number-pad"
            inputMode="numeric"
            selectTextOnFocus
            returnKeyType="done"
            defaultValue={block.avgHr != null ? String(block.avgHr) : ''}
            placeholder="—"
            placeholderTextColor={colors.faint}
            accessibilityLabel={t('cardio.avgHr')}
            onChangeText={(v) => patchNum('avgHr', v)}
            onBlur={onCommit}
          />
        </View>
        <View style={styles.cardioField}>
          <Text style={styles.cardioLabel}>{t('cardio.rpe')}</Text>
          <TextInput
            style={styles.cardioInput}
            keyboardType="number-pad"
            inputMode="numeric"
            selectTextOnFocus
            returnKeyType="done"
            defaultValue={block.rpe != null ? String(block.rpe) : ''}
            placeholder={t('cardio.rpeHint')}
            placeholderTextColor={colors.faint}
            accessibilityLabel={t('cardio.rpe')}
            onChangeText={(v) => patchNum('rpe', v)}
            onBlur={onCommit}
          />
        </View>
      </View>

      <TextInput
        style={styles.input}
        multiline
        defaultValue={block.notes ?? ''}
        placeholder={t('cardio.notesPlaceholder')}
        placeholderTextColor={colors.faint}
        accessibilityLabel={t('cardio.notes')}
        onChangeText={(v) => onPatch({ notes: v.trim() === '' ? undefined : v }, { defer: true })}
        onBlur={onCommit}
      />

      {block.kcal != null ? (
        <View>
          <Text style={styles.cardioKcal}>{t('cardio.reportedKcal', { kcal: block.kcal })}</Text>
          <Text style={styles.cardioKcalWhy}>{t('cardio.reportedKcalWhy')}</Text>
        </View>
      ) : null}

      {overlaps ? <Text style={styles.cardioWarn}>{t('cardio.sameBody')}</Text> : null}

      <Pressable
        onPress={onRemove}
        style={styles.exRemoveRow}
        accessibilityRole="button"
        accessibilityLabel={t('cardio.remove')}
      >
        <Text style={styles.exRemove}>{t('cardio.remove')}</Text>
      </Pressable>
    </View>
  );
}

export const CardioBlockCard = memo(CardioBlockCardInner);
