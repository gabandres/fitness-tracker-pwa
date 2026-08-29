import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import {
  MAX_FAST_MS,
  type Fast,
  fastHoursParts,
  isStorableFast,
  overlappingFasts,
} from '@macrolog/core';
import { BottomSheet } from '@/components/BottomSheet';
import { useLocale, useT } from '@/i18n';
import { formatDate, formatNumber, formatTime } from '@/lib/date-format';
import * as haptics from '@/lib/haptics';
import { PressScale } from '@/lib/motion';
import { useThemedStyles, type Theme } from '@/lib/theme-context';
import { font, radius, space } from '@/theme';

const MIN_MS = 60 * 1000;
const HOUR_MS = 60 * MIN_MS;
const DAY_MS = 24 * HOUR_MS;

/**
 * The adjust row (ADR-0032 decision 3).
 *
 * ## Why nudges and not a date picker
 *
 * There is no date picker in this app, and adding one is not free:
 * `@react-native-community/datetimepicker` is a NATIVE module, so it moves the
 * Expo fingerprint and no fix to this screen could ever reach anyone by OTA —
 * a correction to a feature people are already using would wait on two store
 * binaries. A pure-JS wheel is the other option, and it is a gesture surface
 * with momentum, snapping and initial-offset bugs, shipped straight to
 * production on a control nobody here can test on both platforms first.
 *
 * Nudges have neither problem, and they suit the actual task better than either
 * one. Corrections to a fast are relative and small — "I started an hour
 * earlier", "I broke it at noon, not one" — so the common edit is one or two
 * taps where a picker is open-scroll-confirm. The day steps are what keep the
 * uncommon case (logging a fast from last Tuesday) from being twenty taps.
 *
 * ## Six, in one row, in this order
 *
 * Symmetric around the middle so the two most-used steps sit under the thumb,
 * and small-to-large outwards so the row reads as a scale rather than a menu.
 * Fifteen minutes is the finest step on purpose: a fast is not a stopwatch, and
 * a minute-level nudge would make the common correction take four taps to do
 * what one should.
 */
const STEPS: readonly { id: string; label: string; ms: number }[] = [
  { id: 'minus-1d', label: '−1d', ms: -DAY_MS },
  { id: 'minus-1h', label: '−1h', ms: -HOUR_MS },
  { id: 'minus-15m', label: '−15m', ms: -15 * MIN_MS },
  { id: 'plus-15m', label: '+15m', ms: 15 * MIN_MS },
  { id: 'plus-1h', label: '+1h', ms: HOUR_MS },
  { id: 'plus-1d', label: '+1d', ms: DAY_MS },
];

export type FastSheetMode =
  /** A fast that is over — correct its interval, or delete it. */
  | 'edit'
  /** A fast nobody timed. The retroactive "I fasted yesterday and forgot". */
  | 'add'
  /** The fast running RIGHT NOW: only its start exists to be corrected, and
   *  the end is the moving present rather than a value anyone can set. */
  | 'running';

interface Props {
  visible: boolean;
  mode: FastSheetMode;
  /** The stored fast being corrected. Required by `edit`, and by `running` —
   *  where it carries only a start — and ignored by `add`. */
  editing?: Fast | null;
  /**
   * Neighbouring fasts to check the proposed interval against. Deliberately
   * NOT the fasts of one day: the fast you are about to collide with is
   * usually the one that ended the day before (see `useDayFasts`).
   */
  fasts?: readonly Fast[];
  /** Where `add` mode anchors its prefill — the day the user is looking at. */
  anchorEnd?: Date;
  /** In `running` mode the caller re-starts the fast at `startedAt` and the
   *  end is meaningless; in the other two it writes the whole interval. */
  onSave: (startedAt: Date, endedAt: Date) => Promise<void> | void;
  /** Present only in `edit` mode. The caller owns the confirmation prompt. */
  onDelete?: () => void;
  onClose: () => void;
}

/**
 * A fast's default length when there is nothing to copy from.
 *
 * Sixteen hours because it is the most common fast there is, and it is a
 * PREFILL rather than a target: ADR-0032 refuses to ship a goal, a protocol or
 * a streak, and nothing here is stored, scored or compared against it. It
 * exists so the usual case is "check it and save" instead of twelve taps up
 * from a zero-length interval, and every part of it is adjustable first.
 */
const PREFILL_MS = 16 * HOUR_MS;

/**
 * Floor to a 15-minute boundary so the nudges land on clean times.
 *
 * Applied to a PREFILL only, never to a stored fast: rounding a fast the timer
 * measured would quietly rewrite a real measurement the moment somebody opened
 * it to look at it.
 */
function floorTo15(d: Date): Date {
  return new Date(Math.floor(d.getTime() / (15 * MIN_MS)) * 15 * MIN_MS);
}

/**
 * Correct, log or delete one fast.
 *
 * The three modes are one component because they are one interaction — pick a
 * field, nudge it, watch the duration — and splitting them would give the same
 * gesture three implementations to drift apart. What differs between them is
 * only which rows exist and what Save means, and that is one line each.
 */
export function FastSheet({
  visible,
  mode,
  editing = null,
  fasts = [],
  anchorEnd,
  onSave,
  onDelete,
  onClose,
}: Props) {
  const t = useT();
  const locale = useLocale();
  const styles = useThemedStyles(createStyles);
  const [start, setStart] = useState(() => new Date());
  const [end, setEnd] = useState(() => new Date());
  const [field, setField] = useState<'start' | 'end'>('start');
  const [saving, setSaving] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  // A running fast's end is the present, so it moves while the sheet is open.
  // Same 30s cadence as the Today row this was opened from — matching it means
  // the two numbers never disagree on screen, and a second-level tick would
  // spend battery animating a digit nobody is watching.
  useEffect(() => {
    if (!visible || mode !== 'running') return;
    const id = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(id);
  }, [visible, mode]);

  useEffect(() => {
    if (!visible) return;
    setSaving(false);
    setNow(Date.now());
    // Start is the field a correction almost always lands on — a forgotten
    // fast is "I started at eight", and a running one has nothing else to
    // edit — so it opens selected and the common case needs no aiming tap.
    setField('start');
    if (editing && (mode === 'edit' || mode === 'running')) {
      setStart(editing.startedAt);
      if (mode === 'edit') setEnd(editing.endedAt);
      return;
    }
    const anchor = floorTo15(anchorEnd ?? new Date());
    setEnd(anchor);
    setStart(new Date(anchor.getTime() - PREFILL_MS));
  }, [visible, mode, editing, anchorEnd]);

  const effectiveEnd = mode === 'running' ? new Date(now) : end;
  const storable = isStorableFast(start, effectiveEnd);
  const conflicts = storable ? overlappingFasts(fasts, start, effectiveEnd, editing?.id) : [];
  const valid = storable && conflicts.length === 0 && !saving;
  const parts = fastHoursParts(
    Math.max(0, effectiveEnd.getTime() - start.getTime()) / HOUR_MS,
  );

  function bump(deltaMs: number) {
    haptics.tap();
    if (mode === 'running' || field === 'start') {
      setStart((s) => new Date(s.getTime() + deltaMs));
    } else {
      setEnd((e) => new Date(e.getTime() + deltaMs));
    }
  }

  function stamp(d: Date): string {
    const day = formatDate(d, locale, { weekday: 'short', month: 'short', day: 'numeric' });
    return `${day} · ${formatTime(d, locale)}`;
  }

  /**
   * The warning line, in priority order: an impossible interval first, because
   * a user who has pushed the start past the end needs to be told THAT rather
   * than which other fast it now happens to touch.
   */
  function warning(): string | null {
    if (effectiveEnd.getTime() <= start.getTime()) {
      return mode === 'running' ? t('fast.errFuture') : t('fast.errOrder');
    }
    if (effectiveEnd.getTime() - start.getTime() > MAX_FAST_MS) {
      return t('fast.errTooLong', { n: formatNumber(MAX_FAST_MS / DAY_MS, locale) });
    }
    if (conflicts.length === 1) {
      const c = conflicts[0];
      const day = formatDate(c.endedAt, locale, { month: 'short', day: 'numeric' });
      const from = formatTime(c.startedAt, locale);
      const to = formatTime(c.endedAt, locale);
      return t('fast.errOverlap', { when: `${day} · ${from}–${to}` });
    }
    if (conflicts.length > 1) {
      return t('fast.errOverlapMany', { n: formatNumber(conflicts.length, locale) });
    }
    return null;
  }

  async function save() {
    if (!valid) return;
    setSaving(true);
    try {
      await onSave(start, effectiveEnd);
      haptics.success();
      onClose();
    } catch {
      // The write failed — rules rejected it, or the device is offline past
      // the SDK's own queue. Staying open with the values intact is the only
      // useful outcome: closing would discard what the user set and show them
      // a list that does not contain it, which reads as silent data loss.
      setSaving(false);
    }
  }

  const note = warning();

  return (
    <BottomSheet visible={visible} onClose={onClose}>
      <Text style={styles.title}>
        {t(
          mode === 'edit'
            ? 'fast.editTitle'
            : mode === 'running'
              ? 'fast.runningTitle'
              : 'fast.addTitle',
        )}
      </Text>

      {/* The duration is the number the user came here for — every other
          control on this sheet exists to move it — so it is the biggest thing
          on the panel and it updates on every nudge. */}
      <Text style={styles.duration} testID="fast-duration">
        {t(mode === 'running' ? 'fast.runningFor' : 'fast.length', {
          h: formatNumber(parts.hours, locale),
          m: formatNumber(parts.minutes, locale),
        })}
      </Text>

      <View style={styles.rows}>
        <FieldRow
          label={t('fast.started')}
          value={stamp(start)}
          selected={mode === 'running' || field === 'start'}
          // A single-field sheet has nothing to select BETWEEN, so the row is
          // inert rather than a button that looks tappable and does nothing.
          onPress={mode === 'running' ? undefined : () => { haptics.tap(); setField('start'); }}
          testID="fast-start-row"
        />
        {mode === 'running' ? (
          <Text style={styles.runningNote}>{t('fast.runningNote')}</Text>
        ) : (
          <FieldRow
            label={t('fast.ended')}
            value={stamp(end)}
            selected={field === 'end'}
            onPress={() => { haptics.tap(); setField('end'); }}
            testID="fast-end-row"
          />
        )}
      </View>

      <Text style={styles.adjustLabel}>
        {t(mode === 'running' || field === 'start' ? 'fast.adjustStart' : 'fast.adjustEnd')}
      </Text>
      <View style={styles.steps}>
        {STEPS.map((s) => (
          <PressScale
            key={s.id}
            scaleTo={0.88}
            style={styles.step}
            onPress={() => bump(s.ms)}
            accessibilityRole="button"
            testID={`fast-step-${s.id}`}
          >
            <Text style={styles.stepText}>{s.label}</Text>
          </PressScale>
        ))}
      </View>

      {note ? (
        <Text style={styles.warn} testID="fast-warning">
          {note}
        </Text>
      ) : null}

      <PressScale
        scaleTo={0.98}
        style={[styles.save, !valid && styles.saveDisabled]}
        onPress={save}
        disabled={!valid}
        accessibilityRole="button"
        testID="fast-save"
      >
        <Text style={styles.saveText}>{t('common.save')}</Text>
      </PressScale>

      {mode === 'edit' && onDelete ? (
        <PressScale
          scaleTo={0.96}
          style={styles.delete}
          onPress={() => { haptics.tap(); onDelete(); }}
          accessibilityRole="button"
          testID="fast-delete"
        >
          <Text style={styles.deleteText}>{t('fast.delete')}</Text>
        </PressScale>
      ) : null}
    </BottomSheet>
  );
}

function FieldRow({
  label,
  value,
  selected,
  onPress,
  testID,
}: {
  label: string;
  value: string;
  selected: boolean;
  onPress?: () => void;
  testID: string;
}) {
  const styles = useThemedStyles(createStyles);
  return (
    <PressScale
      scaleTo={onPress ? 0.98 : 1}
      style={[styles.row, selected && styles.rowSelected]}
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityState={onPress ? { selected } : undefined}
      accessibilityLabel={`${label}: ${value}`}
      testID={testID}
    >
      <Text style={[styles.rowLabel, selected && styles.rowLabelSelected]}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
    </PressScale>
  );
}

const createStyles = ({ colors }: Theme) => StyleSheet.create({
  title: { fontSize: font.h2, fontWeight: '800', color: colors.ink },
  duration: {
    fontSize: font.h1,
    fontWeight: '800',
    color: colors.ink,
    textAlign: 'center',
    marginTop: space.md,
  },
  rows: { gap: space.sm, marginTop: space.lg },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.inputBg,
    borderRadius: radius.md,
    borderWidth: 1,
    // The unselected border is the hairline every other field in the app uses;
    // selection thickens and inks it rather than tinting the fill, so both rows
    // keep the same weight and only one of them reads as armed.
    borderColor: colors.line,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
  },
  rowSelected: { borderColor: colors.ink },
  rowLabel: {
    fontSize: font.tiny,
    color: colors.muted,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  rowLabelSelected: { color: colors.ink },
  rowValue: { fontSize: font.body, color: colors.ink, fontWeight: '700' },
  runningNote: { fontSize: font.small, color: colors.muted, paddingHorizontal: space.xs },
  adjustLabel: {
    fontSize: font.tiny,
    color: colors.muted,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: space.lg,
    marginBottom: space.xs,
  },
  steps: { flexDirection: 'row', justifyContent: 'space-between', gap: space.xs },
  step: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: space.sm,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.inputBg,
  },
  stepText: { fontSize: font.small, color: colors.ink, fontWeight: '700' },
  warn: { fontSize: font.small, color: colors.danger, marginTop: space.md, textAlign: 'center' },
  save: {
    backgroundColor: colors.ink,
    borderRadius: radius.md,
    paddingVertical: space.lg,
    alignItems: 'center',
    marginTop: space.lg,
  },
  saveDisabled: { opacity: 0.4 },
  saveText: { color: colors.onInk, fontWeight: '700', fontSize: font.h3 },
  delete: { alignItems: 'center', paddingVertical: space.md, marginTop: space.xs },
  deleteText: { color: colors.danger, fontWeight: '700', fontSize: font.small },
});
