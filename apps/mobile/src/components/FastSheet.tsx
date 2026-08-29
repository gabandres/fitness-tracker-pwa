import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useRef, useState } from 'react';
import { Alert, StyleSheet, Text, TextInput, View } from 'react-native';
import {
  MAX_FAST_MS,
  type Fast,
  fastHoursParts,
  isStorableFast,
  overlappingFasts,
} from '@macrolog/core';
import { BottomSheet } from '@/components/BottomSheet';
import { type Locale, useLocale, useT } from '@/i18n';
import { formatDate, formatNumber, formatTime, localeTag } from '@/lib/date-format';
import * as haptics from '@/lib/haptics';
import { PressScale } from '@/lib/motion';
import { useThemedStyles, useTheme, type Theme } from '@/lib/theme-context';
import { font, radius, space } from '@/theme';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

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
 * exists so the usual case is "check it and save" instead of typing a whole
 * interval from scratch, and every part of it is editable first.
 */
const PREFILL_MS = 16 * HOUR_MS;

/** Round a PREFILL to a clean five minutes. Never applied to a stored fast —
 *  rounding a fast the timer measured would quietly rewrite a real
 *  measurement the moment somebody opened it to look at it. */
function floorTo5(d: Date): Date {
  const out = new Date(d);
  out.setMinutes(Math.floor(out.getMinutes() / 5) * 5, 0, 0);
  return out;
}

/** Same calendar day as `base`, at this hour and minute. Seconds are dropped:
 *  a time somebody typed is asserted to the minute, and carrying a stray 41
 *  seconds forward would make the duration disagree with what they entered. */
function withTime(base: Date, hours: number, minutes: number): Date {
  const d = new Date(base);
  d.setHours(hours, minutes, 0, 0);
  return d;
}

/** `setDate` rather than ±86,400,000 ms: across a DST boundary a day is not
 *  24 hours, and adding the constant would shift the CLOCK time by an hour —
 *  the user would step from 4:00 PM Saturday to 3:00 PM Sunday. */
function addDays(base: Date, delta: number): Date {
  const d = new Date(base);
  d.setDate(d.getDate() + delta);
  return d;
}

/**
 * Does this locale write clock times on a 12-hour dial?
 *
 * Probed by formatting 13:00 rather than read from
 * `resolvedOptions().hour12`, which Hermes has not always populated: a
 * 12-hour locale renders "1 PM" and a 24-hour one contains "13". en and es-PR
 * are 12-hour, pt-BR is 24-hour, and the AM/PM control must not appear in the
 * third — a Brazilian user typing 20 into an hour field beside a PM toggle has
 * been handed two ways to say the same thing and no way to know which wins.
 */
export function localeUses12Hour(tag: string): boolean {
  try {
    return !new Date(2020, 0, 1, 13).toLocaleTimeString(tag, { hour: 'numeric' }).includes('13');
  } catch {
    return true;
  }
}

/** The locale's own word for the half of the day — "AM"/"PM" in en, "a. m."
 *  in es-PR. Hardcoding the English pair would put it on a Spanish screen. */
function dayPeriodLabel(tag: string, hour: number): string {
  try {
    const parts = new Intl.DateTimeFormat(tag, { hour: 'numeric', hour12: true }).formatToParts(
      new Date(2020, 0, 1, hour),
    );
    const found = parts.find((p) => p.type === 'dayPeriod')?.value;
    if (found) return found;
  } catch {
    /* fall through to the literal below */
  }
  return hour < 12 ? 'AM' : 'PM';
}

/**
 * Correct, log or delete one fast.
 *
 * ## You type the time. You do not nudge it.
 *
 * The first build of this sheet adjusted a time with ±15m / ±1h / ±1d buttons,
 * and it was wrong in a way that only showed up on a real fast. Nudges are
 * RELATIVE, so they preserve whatever odd minute the timer happened to record:
 * a fast started at 4:01 PM can be moved to 4:16 or 3:01 or 5:01, and **never
 * to 4:00**. "I actually started at four" — the single most likely correction
 * anybody makes — was unreachable, and no amount of tapping got there.
 *
 * Reported from a device the day it shipped, with a screenshot: *"If a user
 * was fasting at 6:00pm but mistakenly meant 4:00pm, I can't do that."*
 * Followed by the design verdict, which is the part worth keeping: *"It's
 * weird and I don't want to subtract or add."*
 *
 * So the time is entered directly — hour, minute, and the day it fell on. That
 * is also what people already expect, because it is what every clock and alarm
 * on the phone does.
 *
 * ## Still no native date picker, and the reason has not changed
 *
 * `@react-native-community/datetimepicker` is a NATIVE module: adopting one
 * moves the Expo fingerprint, so no later fix to this screen could reach a user
 * over the air — a correction to a feature people are already using would wait
 * on two store binaries. A pure-JS wheel is the other option and it is a
 * gesture surface with momentum, snapping and initial-offset bugs, shipped to
 * production on a control nobody here can test on both platforms first.
 *
 * Two number fields and a day stepper need neither. They are ordinary
 * `TextInput`s, which is what every other entry sheet in this app already uses
 * — water, sleep and the weigh-in are all a typed number — so this is the
 * interaction the user has already learned, not a new one.
 *
 * ## The three modes are one component
 *
 * They are one interaction — set a time, watch the duration — and splitting
 * them would give the same editor three implementations to drift apart. What
 * differs is only which fields exist and what Save means.
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

  /**
   * **The seed effect depends on INSTANTS, never on the props' identity, and
   * that is the whole reason this feature reached a user broken.**
   *
   * It used to list `editing` and `anchorEnd` — a `Date` and an object — in its
   * dependencies. Both call sites build those inline (`editing={fastStartedAt
   * ? { startedAt, endedAt } : null}`, `anchorEnd={noonOfDay()}`), so every
   * parent render produced a NEW reference, the effect re-ran, and it reset
   * `start` and `end` to the stored values — **silently discarding whatever the
   * user had just typed.**
   *
   * That is not a rare race. Today's own `useDayFasts` subscribes when this
   * sheet opens, so its first snapshot lands a beat later and re-renders the
   * parent while the sheet is on screen: the user types a time, the listener
   * answers, the field snaps back, Save writes the value that was already
   * there. Reported as *"it didn't save"*, which is exactly what it looks like
   * from outside — the write succeeded, of the wrong number.
   *
   * Comparing milliseconds makes identity irrelevant, so a parent that
   * re-renders a hundred times cannot touch the fields. The reset still fires
   * when the underlying instant genuinely changes, which is the only time it
   * should.
   */
  const startedMs = editing?.startedAt instanceof Date ? editing.startedAt.getTime() : null;
  const endedMs = editing?.endedAt instanceof Date ? editing.endedAt.getTime() : null;
  const anchorMs = anchorEnd instanceof Date ? anchorEnd.getTime() : null;

  useEffect(() => {
    if (!visible) return;
    setSaving(false);
    setNow(Date.now());
    // Start is the field a correction almost always lands on — a forgotten
    // fast is "I started at eight", and a running one has nothing else to
    // edit — so it opens expanded and the common case needs no aiming tap.
    setField('start');
    if (startedMs != null && (mode === 'edit' || mode === 'running')) {
      setStart(new Date(startedMs));
      if (mode === 'edit' && endedMs != null) setEnd(new Date(endedMs));
      return;
    }
    const anchor = floorTo5(anchorMs != null ? new Date(anchorMs) : new Date());
    setEnd(anchor);
    setStart(new Date(anchor.getTime() - PREFILL_MS));
  }, [visible, mode, startedMs, endedMs, anchorMs]);

  const effectiveEnd = mode === 'running' ? new Date(now) : end;
  const storable = isStorableFast(start, effectiveEnd);
  const conflicts = storable ? overlappingFasts(fasts, start, effectiveEnd, editing?.id) : [];

  /**
   * **A collision only blocks a write that would CREATE one.**
   *
   * A running fast is one scalar on the profile, not a document — correcting
   * its start writes `fastStartedAt` and nothing else, so it cannot produce an
   * overlapping row no matter what time is chosen. Blocking it was a shipped
   * bug and a bad one: a user whose running fast already overlapped a stored
   * one found Save permanently disabled, with the offending fast not even
   * visible on that screen. The sheet was a dead end reached by an ordinary
   * mistake, which is the worst shape a guard can take.
   *
   * The conflict is still worth SAYING in that mode — ending the fast will
   * write the overlapping row — so it is reported as a note rather than
   * swallowed. It just does not hold the door shut.
   */
  const blocking = mode === 'running' ? [] : conflicts;
  const valid = storable && blocking.length === 0 && !saving;
  const parts = fastHoursParts(
    Math.max(0, effectiveEnd.getTime() - start.getTime()) / HOUR_MS,
  );

  function stamp(d: Date): string {
    const day = formatDate(d, locale, { weekday: 'short', month: 'short', day: 'numeric' });
    return `${day} · ${formatTime(d, locale)}`;
  }

  /**
   * The line under the fields, in priority order: an impossible interval first,
   * because a user who has put the start after the end needs to be told THAT
   * rather than which other fast it now happens to touch.
   *
   * `tone` separates "this cannot be saved" from "you should know this" — they
   * are different claims and colouring both red taught the reader nothing.
   */
  function notice(): { text: string; tone: 'error' | 'note' } | null {
    if (effectiveEnd.getTime() <= start.getTime()) {
      return {
        text: mode === 'running' ? t('fast.errFuture') : t('fast.errOrder'),
        tone: 'error',
      };
    }
    if (effectiveEnd.getTime() - start.getTime() > MAX_FAST_MS) {
      return {
        text: t('fast.errTooLong', { n: formatNumber(MAX_FAST_MS / DAY_MS, locale) }),
        tone: 'error',
      };
    }
    if (!conflicts.length) return null;
    const tone = mode === 'running' ? 'note' : 'error';
    if (conflicts.length === 1) {
      const c = conflicts[0];
      const day = formatDate(c.endedAt, locale, { month: 'short', day: 'numeric' });
      const when = `${day} · ${formatTime(c.startedAt, locale)}–${formatTime(c.endedAt, locale)}`;
      return {
        text: tone === 'note' ? t('fast.noteOverlap', { when }) : t('fast.errOverlap', { when }),
        tone,
      };
    }
    const n = formatNumber(conflicts.length, locale);
    return {
      text: tone === 'note' ? t('fast.noteOverlapMany', { n }) : t('fast.errOverlapMany', { n }),
      tone,
    };
  }

  /**
   * Commit, and close on the LOCAL write rather than the server's answer.
   *
   * This awaited the round trip until a device pass on the LG G6 showed what
   * that costs. Firestore is local-first: by the time `onSave` returns its
   * promise the value is already in the cache and every listener on the device
   * has it, so the corrected fast is visible on the row BEHIND the sheet. The
   * radio then dropped the Write stream (`RPC 'Write' stream transport
   * errored`, once a minute), the promise settled late, and the sheet sat open
   * over a change the user could already see — saying nothing, with Save live
   * again as though the tap had missed.
   *
   * Waiting on the server also cannot buy what it looks like it buys. The one
   * failure the user can act on — an impossible interval — is checked by
   * `valid` before this runs, so it can never reach the write. What is left is
   * a rules rejection or a dead network, and neither is fixed by staring at a
   * sheet.
   *
   * The rejection is still SURFACED rather than swallowed: a write that truly
   * fails rolls the local cache back, so the fast would quietly revert, and a
   * silent revert is exactly the data-loss shape this feature exists to end.
   * Handling it here also keeps it off the unhandled-rejection path, which has
   * reported as a crash in this app before (OTA 80).
   */
  async function save() {
    if (!valid) return;
    setSaving(true);
    let written: Promise<void>;
    try {
      written = Promise.resolve(onSave(start, effectiveEnd));
    } catch {
      // A synchronous throw — the ledger refusing an interval `valid` should
      // already have caught. Keep the sheet open; nothing was written.
      setSaving(false);
      return;
    }
    haptics.success();
    onClose();
    try {
      await written;
    } catch {
      Alert.alert(t('fast.errSaveTitle'), t('fast.errSaveBody'));
    }
  }

  const note = notice();
  const editingStart = mode === 'running' || field === 'start';

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

      {/* The duration is the number the user came here for — every field on
          this sheet exists to move it — so it is the biggest thing on the
          panel and it updates on every keystroke. */}
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
          selected={editingStart}
          // A single-field sheet has nothing to select BETWEEN, so the row is
          // inert rather than a header that looks tappable and does nothing.
          onPress={mode === 'running' ? undefined : () => { haptics.tap(); setField('start'); }}
          testID="fast-start-row"
        />
        {editingStart ? (
          // Keyed by field so switching rows REMOUNTS the editor: its text
          // state is seeded from the value once, at mount, which is what keeps
          // a half-typed hour from being overwritten on every keystroke.
          <TimeField
            key="start"
            value={start}
            onChange={setStart}
            locale={locale}
            testIDPrefix="fast-start"
          />
        ) : null}

        {mode === 'running' ? (
          <Text style={styles.runningNote}>{t('fast.runningNote')}</Text>
        ) : (
          <>
            <FieldRow
              label={t('fast.ended')}
              value={stamp(end)}
              selected={field === 'end'}
              onPress={() => { haptics.tap(); setField('end'); }}
              testID="fast-end-row"
            />
            {field === 'end' ? (
              <TimeField
                key="end"
                value={end}
                onChange={setEnd}
                locale={locale}
                testIDPrefix="fast-end"
              />
            ) : null}
          </>
        )}
      </View>

      {note ? (
        <Text
          style={[styles.notice, note.tone === 'error' ? styles.noticeError : styles.noticeNote]}
          testID="fast-warning"
        >
          {note.text}
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

/**
 * Set one instant: the day it fell on, and the time on that day.
 *
 * The day is stepped and the time is typed, which is not an inconsistency —
 * it is the shape of the two questions. "Which day" has three plausible
 * answers (today, yesterday, the day before) and a stepper answers it in one
 * tap; "what time" has 1,440 and only typing answers it.
 */
function TimeField({
  value,
  onChange,
  locale,
  testIDPrefix,
}: {
  value: Date;
  onChange: (next: Date) => void;
  locale: Locale;
  testIDPrefix: string;
}) {
  const t = useT();
  const styles = useThemedStyles(createStyles);
  const { colors } = useTheme();
  const tag = localeTag(locale);
  const hour12 = localeUses12Hour(tag);
  const minuteRef = useRef<TextInput>(null);

  const isPm = value.getHours() >= 12;
  const [hourText, setHourText] = useState(() =>
    hour12 ? String(((value.getHours() + 11) % 12) + 1) : String(value.getHours()),
  );
  const [minuteText, setMinuteText] = useState(() =>
    String(value.getMinutes()).padStart(2, '0'),
  );

  /**
   * An out-of-range hour is REFUSED, not displayed.
   *
   * The first cut accepted the text and simply declined to commit it, so a
   * stray keystroke could leave `50` sitting in the hour box while the row
   * above still read 5:10 PM — the field and the value disagreeing, with
   * nothing to say which one was real. Seen on a device within minutes.
   *
   * Dropping the keystroke instead is what every clamped numeric field does,
   * and it costs nothing: `12` still types fine, because it is in range at
   * both one digit and two.
   */
  function commitHour(raw: string) {
    const digits = raw.replace(/[^0-9]/g, '').slice(0, 2);
    if (digits === '') {
      // Clearing is allowed — it is mid-edit, not a wrong value. The stored
      // time is left alone until a real one is typed.
      setHourText('');
      return;
    }
    const n = Number(digits);
    if (hour12 ? n < 1 || n > 12 : n > 23) return;
    setHourText(digits);
    onChange(withTime(value, hour12 ? (n % 12) + (isPm ? 12 : 0) : n, value.getMinutes()));
    // Two digits means the hour is finished — move on, so setting a time is
    // one continuous type rather than type-tap-type.
    if (digits.length === 2) minuteRef.current?.focus();
  }

  function commitMinute(raw: string) {
    const digits = raw.replace(/[^0-9]/g, '').slice(0, 2);
    if (digits === '') {
      setMinuteText('');
      return;
    }
    const n = Number(digits);
    if (n > 59) return;
    setMinuteText(digits);
    onChange(withTime(value, value.getHours(), n));
  }

  function setPeriod(nextPm: boolean) {
    if (nextPm === isPm) return;
    haptics.tap();
    onChange(withTime(value, value.getHours() + (nextPm ? 12 : -12), value.getMinutes()));
  }

  function stepDay(delta: number) {
    haptics.tap();
    onChange(addDays(value, delta));
  }

  return (
    <View style={styles.editor}>
      <View style={styles.dayRow}>
        <PressScale
          scaleTo={0.9}
          style={styles.dayBtn}
          onPress={() => stepDay(-1)}
          accessibilityRole="button"
          accessibilityLabel={t('fast.dayEarlier')}
          testID={`${testIDPrefix}-day-prev`}
        >
          <Ionicons name="chevron-back" size={18} color={colors.ink} />
        </PressScale>
        <Text style={styles.dayText} testID={`${testIDPrefix}-day`}>
          {formatDate(value, locale, { weekday: 'short', month: 'short', day: 'numeric' })}
        </Text>
        <PressScale
          scaleTo={0.9}
          style={styles.dayBtn}
          onPress={() => stepDay(1)}
          accessibilityRole="button"
          accessibilityLabel={t('fast.dayLater')}
          testID={`${testIDPrefix}-day-next`}
        >
          <Ionicons name="chevron-forward" size={18} color={colors.ink} />
        </PressScale>
      </View>

      <View style={styles.timeRow}>
        <TextInput
          style={styles.timeInput}
          value={hourText}
          onChangeText={commitHour}
          keyboardType="number-pad"
          maxLength={2}
          selectTextOnFocus
          returnKeyType="next"
          placeholder={hour12 ? '12' : '00'}
          placeholderTextColor={colors.faint}
          accessibilityLabel={t('fast.hour')}
          testID={`${testIDPrefix}-hour`}
        />
        <Text style={styles.colon}>:</Text>
        <TextInput
          ref={minuteRef}
          style={styles.timeInput}
          value={minuteText}
          onChangeText={commitMinute}
          keyboardType="number-pad"
          maxLength={2}
          selectTextOnFocus
          returnKeyType="done"
          placeholder="00"
          placeholderTextColor={colors.faint}
          accessibilityLabel={t('fast.minute')}
          testID={`${testIDPrefix}-minute`}
        />
        {hour12 ? (
          <View style={styles.periods}>
            {[false, true].map((pm) => (
              <PressScale
                key={pm ? 'pm' : 'am'}
                scaleTo={0.92}
                style={[styles.period, isPm === pm && styles.periodOn]}
                onPress={() => setPeriod(pm)}
                accessibilityRole="button"
                accessibilityState={{ selected: isPm === pm }}
                testID={`${testIDPrefix}-${pm ? 'pm' : 'am'}`}
              >
                <Text style={[styles.periodText, isPm === pm && styles.periodTextOn]}>
                  {dayPeriodLabel(tag, pm ? 13 : 9)}
                </Text>
              </PressScale>
            ))}
          </View>
        ) : null}
      </View>
    </View>
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
    marginTop: space.sm,
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
    // keep the same weight and only one of them reads as open.
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
  editor: { gap: space.sm, paddingHorizontal: space.xs },
  dayRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  dayBtn: {
    paddingHorizontal: space.md,
    paddingVertical: space.xs,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.line,
  },
  dayText: { fontSize: font.body, color: colors.ink, fontWeight: '700' },
  timeRow: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  timeInput: {
    flex: 1,
    textAlign: 'center',
    backgroundColor: colors.inputBg,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    paddingVertical: space.md,
    fontSize: font.h2,
    fontWeight: '700',
    color: colors.ink,
  },
  colon: { fontSize: font.h2, fontWeight: '800', color: colors.ink },
  periods: { flexDirection: 'row', gap: space.xs, marginLeft: space.xs },
  period: {
    paddingHorizontal: space.md,
    paddingVertical: space.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.line,
  },
  periodOn: { backgroundColor: colors.ink, borderColor: colors.ink },
  periodText: { fontSize: font.small, color: colors.muted, fontWeight: '700' },
  periodTextOn: { color: colors.onInk },
  notice: { fontSize: font.small, marginTop: space.md, textAlign: 'center' },
  noticeError: { color: colors.danger },
  // A note is something to know, not something blocking the button. Colouring
  // it like an error taught the reader that red means nothing in particular.
  noticeNote: { color: colors.muted },
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
