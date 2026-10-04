import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  type LayoutChangeEvent,
  Linking,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import {
  LOG_NOTE_MAX,
  MEAL_TYPES,
  type CustomFood,
  type DailyLog,
  type FoodSource,
  type LogEntry,
  type MealPreset,
  type MealType,
  buildCustomFood,
  buildMealPreset,
  macroEnergyMismatch,
  mealTypeAfterRetime,
  parseTimeOfDay,
  scaleCustomFood,
  setTimeOfDay,
  shiftTimeOfDay,
} from '@macrolog/core';
import { BarcodeScanner, type BarcodeEstimate } from '@/components/BarcodeScanner';
import { BottomSheet, type SheetCloseVia } from '@/components/BottomSheet';
import { confirm } from '@/components/ConfirmSheet';
import { MicButton } from './MicButton';
import {
  FoodSearch,
  type LibraryItem,
  type SearchSnapshot,
} from '@/components/FoodSearch';
import { KeyboardBar, useDoneKeyProps, useKeyboardBarProps } from '@/components/KeyboardBar';
import { showToast } from '@/components/Toast';
import { MealText } from '@/components/MealText';
import { RecipeBuilder } from '@/components/RecipeBuilder';
import { RecipeImport } from '@/components/RecipeImport';
import { useLocale, useT } from '@/i18n';
import { starterFoods } from '@/lib/starterFoods';
import { productFromLibrary, setScanLibrary } from '@/lib/barcode';
import { normalizeName } from '@/lib/libraryMatch';
import { type GramBasis, parseGrams, rescaleFromBasis } from '@/lib/grams-rescale';
import { useA11yFocus } from '@/lib/use-a11y-focus';
import { useDeferredFocus } from '@/lib/use-deferred-focus';
import { FEATURES } from '@/lib/features';
import * as haptics from '@/lib/haptics';
import { captureError } from '@/lib/sentry';
import { clearLogTimer, startLogTimer } from '@/lib/log-timer';
import type { EntryPrefill } from '@/lib/entry-prefill';
import { useTheme, useThemedStyles, type Theme } from '@/lib/theme-context';
import { font, radius, space } from '@/theme';
import { formatDate, formatNumber, formatTime } from '@/lib/date-format';

interface Props {
  visible: boolean;
  /** The row being edited, or null when adding. */
  editing: DailyLog | null;
  onSave: (entry: LogEntry) => Promise<void> | void;
  /** Several rows in one gesture ("Add all" from a described meal). When
   *  given, the screen writes them and shows ONE receipt with one Undo for the
   *  set; without it each row goes through `onSave` (and its own receipt). */
  onSaveMany?: (entries: LogEntry[]) => Promise<void> | void;
  onDelete?: () => Promise<void> | void;
  /**
   * The caller offers Undo after a delete (a toast that re-adds the row with
   * `addLogWithId`), so the Delete button fires at once. When false — the
   * default — Delete goes through the confirm sheet instead. One of the two,
   * never both: a confirm in front of an undoable action charges every
   * intentional delete a step to guard against a mis-tap it can already
   * reverse (UX_AUDIT S18-6 names either as sufficient).
   */
  deleteUndoable?: boolean;
  onClose: () => void;
  presets?: MealPreset[];
  recentEntries?: DailyLog[];
  onSavePreset?: (preset: Omit<MealPreset, 'id'>) => Promise<void> | void;
  onDeletePreset?: (id: string) => Promise<void> | void;
  onHideRecent?: (label: string) => Promise<void> | void;
  /** Saved food library (My Foods, ADR-0013). */
  customFoods?: CustomFood[];
  onSaveCustomFood?: (food: Omit<CustomFood, 'id'>) => Promise<void> | void;
  onDeleteCustomFood?: (id: string) => Promise<void> | void;
  /** Portion-display preference for the food-search serving sort. */
  unitSystem?: 'us' | 'metric';
  /** When set (and NOT editing), a new/relogged entry is stamped to local
   *  noon on this YYYY-MM-DD instead of "now" — for adding food to a past
   *  day from the day-detail screen. */
  dateKey?: string;
  /** A draft to open ON, in the manual form, instead of the browse view —
   *  the scan screen's repeat suggestion lands here (ADR-0029, settled
   *  2026-09-08: a repeat is reviewed, never logged silently). Applied each
   *  time the sheet opens for an ADD while set; the owner clears it on close. */
  initialPrefill?: EntryPrefill | null;
}

/** The time row's four steppers, earliest first. Hour and five-minute steps:
 *  12:00 → 4:15 PM is seven taps, where a single 15-minute step took
 *  seventeen. JS only on purpose — a native picker would move the runtime
 *  fingerprint and cost a store build for one control. */
const TIME_STEPS = [
  { minutes: -60, label: 'entry.timeMinusHour', a11y: 'entry.timeEarlierHourA11y', testID: 'entry-time-minus-hour' },
  { minutes: -5, label: 'entry.timeMinusMin', a11y: 'entry.timeEarlierMinA11y', testID: 'entry-time-minus-min' },
  { minutes: 5, label: 'entry.timePlusMin', a11y: 'entry.timeLaterMinA11y', testID: 'entry-time-plus-min' },
  { minutes: 60, label: 'entry.timePlusHour', a11y: 'entry.timeLaterHourA11y', testID: 'entry-time-plus-hour' },
] as const;

/** The scale row's one-tap factors. Label and spoken name are built per locale
 *  at render — "1,5×" in es-PR / pt-BR, not "1.5×" — and the name carries the
 *  number, since "½×" reads as "one half times" at best. */
const SCALE_STEPS = [
  { f: 0.5 },
  { f: 1.5 },
  { f: 2 },
] as const;

/** Local noon on a YYYY-MM-DD. Noon (not midnight) so a backdated entry can't
 *  bleed into the previous day under a negative UTC offset — matches the CSV
 *  import default. */
function noonOf(dateKey: string): Date {
  const [y, m, d] = dateKey.split('-').map(Number);
  return new Date(y, m - 1, d, 12, 0, 0);
}

function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/** Keep numeric fields as raw strings so partial input ("12.", "1.5")
 *  binds cleanly; parse only on save (see the decimal-input gotcha). */
function numOrUndef(s: string): number | undefined {
  // A comma is a decimal point here, not a rejection: pt-BR keyboards (and
  // iOS decimal pads under a Brazilian region) type `12,5`, and `Number()`
  // reads that as NaN. Same normalisation core's unit parsers already do.
  const t = s.trim().replace(',', '.');
  if (t === '') return undefined;
  const n = Number(t);
  // Negative macros are typeable (Android's numeric keypad has a minus) and
  // firestore.rules rejects them, which surfaced as a lost row, not an error.
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

/** Grams-first save context carried from a search/scan pick (ADR-0013).
 *  Mirrors the web MacroEstimate.serving. */
type ServingCtx = {
  grams?: number;
  source: FoodSource;
  barcode?: string;
  brand?: string;
  name?: string;
  /** The food at its picked weight, unscaled — what the grams field rescales
   *  FROM (`lib/grams-rescale.ts`). Never rewritten after the pick. */
  basis?: GramBasis;
};

/** The serving context as the form holds it (see `pendingServing`). */
type PendingServing = { ctx: ServingCtx; appliedCalories: number | null };

/** The numbers a typed Scale factor multiplies, as they were when it opened. */
type ScaleBase = { cal: string; p: string; c: string; f: string; ps: PendingServing | null };

/** The typed fields of the form as one comparable string. The sheet asks
 *  before discarding only when this differs from what the form opened with —
 *  a pick that was reviewed and not touched is not "typed content". */
function formSig(...fields: string[]): string {
  return fields.join('\u0001');
}

/** Scale one macro string by `f`, leaving blank or unreadable text alone.
 *  Kcal rounds to whole numbers; a macro keeps one decimal under 10 g (½ × 3 g
 *  of fat is 1.5, not 2) and whole grams above, matching how labels print. */
function scaleField(s: string, f: number): string {
  const n = numOrUndef(s);
  if (n == null) return s;
  const v = n * f;
  return String(v >= 10 ? Math.round(v) : Math.round(v * 10) / 10);
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/** A typed Scale factor (1.25, 0,75), or null when it is not one yet or is
 *  outside 0.1–20 — past that it is a typo, not a portion. */
function parseFactor(text: string): number | null {
  const raw = text.trim().replace(',', '.');
  if (raw === '') return null;
  const f = Number(raw);
  return Number.isFinite(f) && f >= 0.1 && f <= 20 ? f : null;
}

/** The form's numeric fields, for the iOS keyboard bar and scroll-into-view. */
type NumField = 'calories' | 'protein' | 'carbs' | 'fat' | 'grams' | 'scale';
/** The ‹ › order of the iOS keyboard bar (`KeyboardBar`). Grams and the Scale
 *  factor sit outside it: they are a different question ("how much") from the
 *  four numbers, and a Next from fat into a weight field would be a surprise.
 *  They get a localized Done only (`useDoneKeyProps`). */
const MACRO_CHAIN = ['calories', 'protein', 'carbs', 'fat'] as const;
type MacroField = (typeof MACRO_CHAIN)[number];
/** One bar PER field — an accessory links to a single input (KeyboardBar.tsx). */
const kbId = (f: MacroField) => `entry-kb-${f}`;

/** Search-first add-food sheet, on a plain RN <Modal> (animationType "slide"
 *  is OS-driven, so it doesn't stutter while typing — unlike the old custom
 *  Animated translateY). Adding opens on a BROWSE view (search + recents +
 *  scan/recipe icons); the manual macro form is a secondary CUSTOM mode
 *  (also used when editing). Search portion / recipe / barcode prefill CUSTOM
 *  for review. Recents/presets are one-tap relog. */
/** How many rows the merged browse list shows. Recents used to cap at 5 and
 *  sat beside three other sections; one ranked list can afford more. */
const BROWSE_ROW_CAP = 12;
/** Rows of the browse list held for My Foods however many recents there are.
 *  Recents fill first and used to take all twelve, so a user who logs a lot
 *  never saw a saved food again without typing its name. */
const MY_FOODS_RESERVED = 4;

export function EntrySheet({
  visible,
  editing,
  onSave,
  onSaveMany,
  onDelete,
  deleteUndoable = false,
  onClose,
  presets = [],
  recentEntries = [],
  onSavePreset,
  onDeletePreset,
  onHideRecent,
  customFoods = [],
  onSaveCustomFood,
  onDeleteCustomFood,
  unitSystem = 'us',
  dateKey,
  initialPrefill,
}: Props) {
  const t = useT();
  const locale = useLocale();
  const styles = useThemedStyles(createStyles);
  const { colors, scheme } = useTheme();
  // Which date a saved/relogged entry lands on: the edited row's own date,
  // else local noon on `dateKey` (past-day add), else undefined ("now").
  const forDate = editing?.date ?? (dateKey ? noonOf(dateKey) : undefined);
  const [label, setLabel] = useState('');
  const [calories, setCalories] = useState('');
  const [protein, setProtein] = useState('');
  const [carbs, setCarbs] = useState('');
  const [fat, setFat] = useState('');
  const [mealType, setMealType] = useState<MealType | undefined>(undefined);
  const [note, setNote] = useState('');
  // Editable entry date — lets the user MOVE an entry to another day (shown
  // only when editing or adding to a specific past day). Plain today-adds hide
  // the date row.
  const [entryDate, setEntryDate] = useState<Date>(new Date());
  const showDateRow = editing != null || dateKey != null;
  // The TIME row shows on every form, today-adds included (2026-10-03: a day
  // logged at night stamped breakfast at 22:00, and fixing it was an add, an
  // edit and 22 stepper taps). A today-add whose time was never touched still
  // saves at the moment of Save, not the moment the sheet opened.
  const [timeTouched, setTimeTouched] = useState(false);
  // The typed-time field's text while it is open; null when the label shows.
  const [timeDraft, setTimeDraft] = useState<string | null>(null);
  // Whether the meal chips were tapped in THIS sheet. A time edit re-derives
  // a clock-defaulted slot (`mealTypeAfterRetime`); once the user has picked
  // one by hand, the clock no longer gets a say.
  const [mealTouched, setMealTouched] = useState(false);
  // The slot and time the entry OPENED with. Each time step is judged against
  // these, not against the previous step: stepping 12:00 → 6 PM an hour at a
  // time passes through the snack band, and a per-step rule would turn a
  // deliberate noon Snack into Dinner on the way.
  const [retimeOrigin, setRetimeOrigin] = useState<{ mealType?: MealType; at: Date }>({ at: new Date() });
  const [busy, setBusy] = useState(false);
  const [manage, setManage] = useState(false);
  const [mode, setMode] = useState<'browse' | 'custom' | 'recipe' | 'recipeImport' | 'meal'>('browse');
  // The search as the user left it, handed back to FoodSearch when browse
  // remounts — "back" from reviewing a pick used to land on an empty box.
  const searchSnap = useRef<SearchSnapshot | undefined>(undefined);
  // FoodSearch's own step-back (portion picker → results), for Android back.
  const searchBack = useRef<(() => boolean) | null>(null);
  // What the form opened with (see `formSig`), and whether the recipe / meal
  // text sub-modes hold typed input — together, whether a close should ask.
  const [baseline, setBaseline] = useState('');
  const [subDirty, setSubDirty] = useState(false);
  // Inline, not a toast: a failed save leaves the user on the form with a
  // decision to make (Toast.tsx — errors the user must act on are inline).
  const [formError, setFormError] = useState<string | null>(null);
  // Save-to-library state: in flight, and the form values last saved, so a
  // second tap on the same values cannot write a duplicate.
  const [libBusy, setLibBusy] = useState<'preset' | 'food' | null>(null);
  const [libSaved, setLibSaved] = useState<{ preset?: string; food?: string }>({});
  // The typed scale factor's text while its field is open, and the numbers it
  // multiplies (snapshotted when the field opened; see `onScaleDraftChange`).
  const [scaleDraft, setScaleDraft] = useState<string | null>(null);
  const scaleBase = useRef<ScaleBase | null>(null);
  // The typed grams while that field is being edited; null shows the context's
  // own weight (which tracks Scale taps too).
  const [gramsDraft, setGramsDraft] = useState<string | null>(null);
  // The write-it-yourself form opened BLANK (not a reviewed pick, not an edit):
  // the one case where the next thing the user does is type a number. See the
  // Calories field.
  const [blankOpen, setBlankOpen] = useState(false);
  // Return-key focus chain through the form's numbers. Calories doubles as the
  // blank form's first stop: focused after the sheet settles, via the shared
  // deferred-focus helper rather than `autoFocus` — the keyboard must not open
  // on the same frames as the sheet spring (the jank `use-deferred-focus`
  // documents; the launch-time keyboard hang of 3c06c8de is the same subsystem,
  // which is why nothing here focuses before the sheet is up).
  const calRef = useDeferredFocus(visible && mode === 'custom' && blankOpen && !editing);
  const proteinRef = useRef<TextInput>(null);
  const carbsRef = useRef<TextInput>(null);
  const fatRef = useRef<TextInput>(null);
  const macroRefs = { calories: calRef, protein: proteinRef, carbs: carbsRef, fat: fatRef };
  // Which numeric field holds the keyboard, so it stays in view while the
  // keyboard shrinks the form (`revealField`). Nothing renders from it.
  const kbFieldRef = useRef<NumField | null>(null);
  const kbBarProps = {
    calories: useKeyboardBarProps(kbId('calories')),
    protein: useKeyboardBarProps(kbId('protein')),
    carbs: useKeyboardBarProps(kbId('carbs')),
    fat: useKeyboardBarProps(kbId('fat')),
  };
  const doneKeyProps = useDoneKeyProps();
  const formScrollRef = useRef<ScrollView>(null);
  const formScroll = useRef({ y: 0, h: 0 });
  const fieldBoxes = useRef<Partial<Record<'calories' | 'macros' | 'scale', { y: number; height: number }>>>({});
  // Raised by MicButton; rendered full-width under the search row rather than
  // beside the field, which used to collapse it. See MicButton.onFailedChange.
  const [micFailed, setMicFailed] = useState(false);
  /** The collapsed "more ways to log" list. Closed by default — that is the point. */
  const [moreOpen, setMoreOpen] = useState(false);
  /** Dictated text, routed by `routeTranscript` to whichever surface fits. */
  const [searchSeed, setSearchSeed] = useState<string | undefined>(undefined);
  const [voiceSeed, setVoiceSeed] = useState<string | undefined>(undefined);
  const [scannerOpen, setScannerOpen] = useState(false);
  // Camera permanently denied: the scanner can't prompt again, so we say so
  // here — in the app's own UI, not as a gate in front of an OS prompt
  // (App Review 5.1.1(iv), submission 5ba1c7f5).
  const [cameraDenied, setCameraDenied] = useState(false);
  // Serving context from the last search/scan prefill + the calories it
  // produced. If the user later edits calories the context is stale (a
  // different portion) → fall back to a manual serving:1 save.
  // `appliedCalories: null` = valid whatever the calories (a label-typed
  // product carrying only its barcode, no gram weight to go stale).
  const [pendingServing, setPendingServing] = useState<PendingServing | null>(null);

  // The mount-through-exit animation, the fade-in-place backdrop, the
  // drag-to-dismiss handle and the keyboard padding all live in
  // `<BottomSheet>` now. This file is where all four were invented — the
  // shared component was modelled on it — and keeping a second copy here is
  // how the two drift. It already had: the copy that stayed behind kept its
  // own `Keyboard` listeners and applied `paddingBottom: kbHeight || 32`,
  // which omits `insets.bottom` at rest. That is the exact expression that
  // put Save under the LG VS988's 48dp navigation bar and cost it taps near
  // its lower edge; `useKeyboardSheetPadding` has carried the fix since
  // 2026-08-22 and this sheet was not on it.

  // Reset form + mode whenever the sheet (re)opens.
  useEffect(() => {
    if (!visible) return;
    setLabel(editing?.mealLabel ?? '');
    setCalories(editing?.calories != null ? String(editing.calories) : '');
    setProtein(editing?.protein != null ? String(editing.protein) : '');
    setCarbs(editing?.carbs != null ? String(editing.carbs) : '');
    setFat(editing?.fat != null ? String(editing.fat) : '');
    setMealType(editing?.mealType);
    setNote(editing?.note ?? '');
    setMealTouched(false);
    setTimeTouched(false);
    setTimeDraft(null);
    const openedAt = editing?.date ?? (dateKey ? noonOf(dateKey) : new Date());
    setEntryDate(openedAt);
    setRetimeOrigin({ mealType: editing?.mealType, at: openedAt });
    setBusy(false);
    setManage(false);
    setPendingServing(null);
    setMode(editing ? 'custom' : 'browse');
    searchSnap.current = undefined;
    // A seed dictated in the last session must not re-run in this one.
    setSearchSeed(undefined);
    setSubDirty(false);
    setFormError(null);
    setLibBusy(null);
    setLibSaved({});
    setScaleDraft(null);
    scaleBase.current = null;
    setGramsDraft(null);
    setBlankOpen(false);
    setBaseline(
      formSig(
        editing?.mealLabel ?? '',
        editing?.calories != null ? String(editing.calories) : '',
        editing?.protein != null ? String(editing.protein) : '',
        editing?.carbs != null ? String(editing.carbs) : '',
        editing?.fat != null ? String(editing.fat) : '',
        editing?.note ?? '',
      ),
    );
    // A carried-in draft wins over the empty add form, never over an edit.
    if (!editing && initialPrefill) {
      const draft = [
        initialPrefill.mealLabel ?? '',
        String(initialPrefill.calories),
        initialPrefill.protein != null ? String(initialPrefill.protein) : '',
        initialPrefill.carbs != null ? String(initialPrefill.carbs) : '',
        initialPrefill.fat != null ? String(initialPrefill.fat) : '',
      ] as const;
      setLabel(draft[0]);
      setCalories(draft[1]);
      setProtein(draft[2]);
      setCarbs(draft[3]);
      setFat(draft[4]);
      setBaseline(formSig(...draft, ''));
      setMode('custom');
    }
  }, [visible, editing, dateKey, initialPrefill]);

  // The recipe / meal-text dirty flag belongs to the sub-mode that raised it.
  useEffect(() => {
    if (mode !== 'recipe' && mode !== 'recipeImport' && mode !== 'meal') setSubDirty(false);
  }, [mode]);

  // Seconds-per-log stopwatch (`lib/log-timer.ts`): runs while the sheet is
  // open for an ADD, read by `useLogWrites.addEntry`. An edit is not a log
  // and must not leave a running clock for the next add to inherit.
  useEffect(() => {
    if (visible && !editing) startLogTimer();
    else clearLogTimer();
  }, [visible, editing]);

  /** Shift the editable entry date by whole days (move-to-date), keeping the
   *  time-of-day. Clamped so you can't push an entry into the future. */
  function shiftEntryDate(deltaDays: number) {
    haptics.tap();
    setEntryDate((prev) => {
      const next = new Date(prev);
      next.setDate(next.getDate() + deltaDays);
      return next.getTime() > Date.now() ? prev : next;
    });
  }

  /**
   * Move the entry's time of day (2026-10-02: a bar eaten ~4:15 PM sat at
   * the 12:00 a past-day add stamps, with no way to fix it). Stays on the
   * date row's day and out of the future (`shiftTimeOfDay`), and carries a
   * clock-defaulted meal slot along — 12:00 Lunch → 4:15 PM Snack — so the
   * entry re-files where the diary would have put it. A slot picked by hand,
   * here or when it was logged, stays put.
   */
  function shiftEntryTime(deltaMinutes: number) {
    applyEntryTime(shiftTimeOfDay(entryDate, deltaMinutes, new Date()));
  }

  function applyEntryTime(next: Date) {
    setTimeTouched(true);
    if (next.getTime() === entryDate.getTime()) return;
    haptics.tap();
    if (!mealTouched) setMealType(mealTypeAfterRetime(retimeOrigin.mealType, retimeOrigin.at, next));
    setEntryDate(next);
  }

  /** Commit the typed time (`parseTimeOfDay`: 8:15, 815, 6:30pm). Unreadable
   *  text is dropped with a warning haptic and the label comes back unchanged —
   *  the label then shows what WAS understood, which is the confirmation. */
  function commitTypedTime() {
    if (timeDraft == null) return;
    const text = timeDraft;
    setTimeDraft(null);
    if (text.trim() === '') return;
    const parsed = parseTimeOfDay(text);
    if (!parsed) {
      haptics.warning();
      return;
    }
    applyEntryTime(setTimeOfDay(entryDate, parsed.hours, parsed.minutes, new Date()));
  }

  /** Prefill the manual form from an estimate (search portion, recipe,
   *  barcode) and move to CUSTOM for review before saving. */
  const prefill = useCallback(
    (src: {
      calories: number;
      protein?: number;
      carbs?: number;
      fat?: number;
      mealLabel?: string;
      serving?: ServingCtx;
    }) => {
      haptics.tap();
      const draft = [
        src.mealLabel ?? '',
        String(src.calories),
        src.protein != null ? String(src.protein) : '',
        src.carbs != null ? String(src.carbs) : '',
        src.fat != null ? String(src.fat) : '',
      ] as const;
      setLabel(draft[0]);
      setCalories(draft[1]);
      setProtein(draft[2]);
      setCarbs(draft[3]);
      setFat(draft[4]);
      setBaseline(formSig(...draft, ''));
      setFormError(null);
      setScaleDraft(null);
      scaleBase.current = null;
      setGramsDraft(null);
      // A reviewed pick: the numbers are there, Add is the next tap, and a
      // keyboard sliding up over them would be in the way.
      setBlankOpen(false);
      setMealType(undefined);
      setNote('');
      // Remember the grams-first context so "Save to My Foods" can store a
      // gram-weighted, barcode-deduped food. Tied to these calories so a later
      // edit invalidates it (see saveAsCustomFood). The grams field's basis is
      // the picker's unscaled portion when it sent one, else the pick itself.
      const sv = src.serving;
      const basis: GramBasis | undefined =
        sv?.basis ??
        (sv?.grams != null && sv.grams > 0
          ? { grams: sv.grams, kcal: src.calories, protein: src.protein, carbs: src.carbs, fat: src.fat }
          : undefined);
      setPendingServing(sv ? { ctx: { ...sv, basis }, appliedCalories: src.calories } : null);
      setMode('custom');
    },
    [],
  );

  /** One-tap relog: log a known entry (recent / preset) and close. On a past
   *  day, restamp it to that day rather than keeping the source's date. */
  function quickLog(entry: LogEntry) {
    // A tap, not a success: the screen's `onSave` buzzes success when the row
    // lands, and two successes for one tap read as two logs.
    haptics.tap();
    // Fire-and-forget by design (the sheet closes on the tap), but never
    // unhandled: the write path queues offline, so a rejection is a real
    // fault worth a report rather than a silent vanish.
    Promise.resolve(onSave(forDate ? { ...entry, timestamp: forDate } : entry)).catch((e) => {
      haptics.warning();
      captureError(e, { where: 'entry.quickLog' });
    });
    onClose();
  }

  const calNum = numOrUndef(calories);
  const canSave = calNum != null && calNum > 0;
  // Calories vs macros, reconciled live. A note, never a gate: partial macro
  // logging is legitimate, and a number typed on purpose must save.
  const macroMiss = macroEnergyMismatch({
    kcal: calNum,
    protein: numOrUndef(protein),
    carbs: numOrUndef(carbs),
    fat: numOrUndef(fat),
  });
  const canSavePreset = onSavePreset != null && label.trim().length > 0 && calNum != null;
  const canSaveCustomFood = onSaveCustomFood != null && label.trim().length > 0 && calNum != null;

  async function save() {
    if (!canSave || busy) return;
    setBusy(true);
    // A typed time still open counts. Add is outside the form's scroll area,
    // so tapping it does not blur the time field and `commitTypedTime` never
    // ran: the entry saved at the old time while the field showed the new one.
    let at = entryDate;
    let slot = mealType;
    let retimed = timeTouched;
    const typed = timeDraft != null && timeDraft.trim() !== '' ? parseTimeOfDay(timeDraft) : null;
    if (typed) {
      at = setTimeOfDay(entryDate, typed.hours, typed.minutes, new Date());
      retimed = true;
      if (!mealTouched && at.getTime() !== entryDate.getTime()) {
        slot = mealTypeAfterRetime(retimeOrigin.mealType, retimeOrigin.at, at);
      }
    }
    const entry: LogEntry = {
      calories: calNum!,
      protein: numOrUndef(protein),
      carbs: numOrUndef(carbs),
      fat: numOrUndef(fat),
      mealLabel: label.trim() || undefined,
      mealType: slot,
      // Always passed, empty or not: on an edit, absent CLEARS the stored note
      // (`toLogPatch`), which is what emptying the field means.
      note: note.trim() || undefined,
      timestamp: showDateRow || retimed ? at : forDate,
    };
    setFormError(null);
    try {
      await onSave(entry);
      onClose();
    } catch (e) {
      // The sheet stays open with the typed values, so the user can retry.
      // The haptic alone said "the tap did not land" only to someone holding
      // the phone with haptics on; the line above the button says it to
      // everyone, and is spoken.
      haptics.warning();
      setFormError(t('entry.saveFailed'));
      captureError(e, { where: 'entry.save' });
    } finally {
      setBusy(false);
    }
  }

  // The values a library save would store; equal to `libSaved.*` once saved.
  const currentSig = formSig(label.trim(), calories, protein, carbs, fat);

  /**
   * Run one save-to-library write with the guard every such tap needs: it
   * was silent on success, wrote a duplicate on a double tap, and an awaited
   * rejection went nowhere. Now one write at a time, a receipt on success, the
   * same values cannot be saved twice, and a failure says so inline.
   */
  async function saveToLibrary(kind: 'preset' | 'food', write: () => Promise<void> | void) {
    if (libBusy || libSaved[kind] === currentSig) return;
    haptics.tap();
    setLibBusy(kind);
    setFormError(null);
    try {
      await write();
      setLibSaved((s) => ({ ...s, [kind]: currentSig }));
      showToast(t(kind === 'preset' ? 'entry.presetSaved' : 'entry.myFoodSaved'));
    } catch (e) {
      haptics.warning();
      setFormError(t('entry.librarySaveFailed'));
      captureError(e, { where: kind === 'preset' ? 'entry.savePreset' : 'entry.saveCustomFood' });
    } finally {
      setLibBusy(null);
    }
  }

  function saveAsPreset() {
    if (!onSavePreset || !label.trim() || calNum == null) return;
    // buildMealPreset clamps into the isValidPreset rule bounds. Writing the
    // raw values here is what produced permission-denied in prod (Sentry
    // IGNIA-MOBILE-9): the rule rejects and the preset is silently lost.
    const preset = buildMealPreset({
      name: label.trim(),
      calories: calNum,
      protein: numOrUndef(protein),
      carbs: numOrUndef(carbs),
      fat: numOrUndef(fat),
    });
    void saveToLibrary('preset', () => onSavePreset(preset));
  }

  /** Save the current custom form as a reusable CustomFood. Grams-first +
   *  barcode-dedup when a search/scan supplied a gram weight (and the user
   *  hasn't edited the calories it produced); otherwise a manual serving:1
   *  save. Mirrors the PWA entry-form-manager.confirmSaveCustomFood.
   *  (customFoodDocId — the barcode-as-doc-id de-dup — is applied by the
   *  onSaveCustomFood handler in the hook.) */
  function saveAsCustomFood() {
    if (!onSaveCustomFood || !label.trim() || calNum == null) return;
    const name = label.trim();
    const p = numOrUndef(protein);
    const c = numOrUndef(carbs);
    const f = numOrUndef(fat);
    // The context is only valid if the calories still match the picked
    // portion — editing them means a different amount, so drop to manual.
    const ctx =
      pendingServing &&
      (pendingServing.appliedCalories == null || pendingServing.appliedCalories === calNum)
        ? pendingServing.ctx
        : null;

    let food: Omit<CustomFood, 'id'>;
    if (ctx?.grams != null) {
      // Grams-first: store the picked portion's gram weight + its macros.
      food = buildCustomFood(
        {
          name,
          brand: ctx.brand,
          barcode: ctx.barcode,
          source: ctx.source,
          serving: { grams: ctx.grams, calories: calNum, protein: p, carbs: c, fat: f },
        },
        new Date(),
      );
    } else {
      // No gram weight (manual entry, or a scan/search food whose DB lacked a
      // serving weight). Omitting `grams` is what selects the honest
      // serving:1 save; source/barcode/brand are kept so even a weightless
      // scan still de-dups by barcode. It goes through buildCustomFood so the
      // isValidCustomFood bounds are applied — hand-building this object
      // skipped them, Firestore rejected the write, and the food was silently
      // lost (Sentry IGNIA-MOBILE-A).
      food = buildCustomFood(
        {
          name,
          brand: ctx?.brand,
          barcode: ctx?.barcode,
          source: ctx?.source ?? 'manual',
          serving: { calories: calNum, protein: p, carbs: c, fat: f },
        },
        new Date(),
      );
    }
    void saveToLibrary('food', () => onSaveCustomFood(food));
  }

  /** Open the manual form. `name` prefills the label — used when the user
   *  arrives from a search miss, where they have already typed what the food
   *  is called and retyping it is pure loss. */
  function openCustomBlank(name = '', ctx?: ServingCtx) {
    haptics.tap();
    setLabel(name);
    setCalories('');
    setProtein('');
    setCarbs('');
    setFat('');
    setMealType(undefined);
    setNote('');
    // A label typed in after a barcode miss carries that barcode, so "Save to
    // My Foods" stores it under the barcode (`customFoodDocId`) and the next
    // scan of the same product matches it (`productFromLibrary`).
    setPendingServing(ctx ? { ctx, appliedCalories: null } : null);
    setBaseline(formSig(name, '', '', '', '', ''));
    setFormError(null);
    setScaleDraft(null);
    scaleBase.current = null;
    setGramsDraft(null);
    setBlankOpen(true);
    setMode('custom');
  }

  /**
   * The form's numbers times `f`, computed FROM `base` — never from whatever
   * the fields hold now, so the typed factor below can re-run on every
   * keystroke without compounding. The grams-first save context scales with
   * them, so a scaled pick still saves to My Foods at its real weight rather
   * than dropping to a weightless `serving:1`.
   */
  function applyScaleFrom(base: ScaleBase, f: number) {
    const baseCal = numOrUndef(base.cal);
    if (baseCal == null) return;
    if (f === 1) {
      // Exactly what was there: `scaleField(…, 1)` would round "1.25" to "1.3".
      setCalories(base.cal);
      setProtein(base.p);
      setCarbs(base.c);
      setFat(base.f);
      setPendingServing(base.ps);
      return;
    }
    const nextCal = Math.round(baseCal * f);
    setCalories(String(nextCal));
    setProtein(scaleField(base.p, f));
    setCarbs(scaleField(base.c, f));
    setFat(scaleField(base.f, f));
    const ps = base.ps;
    setPendingServing(
      ps && ps.appliedCalories === baseCal
        ? {
            ctx: { ...ps.ctx, grams: ps.ctx.grams != null ? round1(ps.ctx.grams * f) : undefined },
            appliedCalories: nextCal,
          }
        : ps,
    );
  }

  /** "I had half of that", "two of them" — a Scale chip, instead of retyping
   *  four numbers. A typed factor still open is settled first (as typed), so
   *  the chip multiplies what the user can see. */
  function scaleForm(f: number) {
    if (!(f > 0) || calNum == null) return;
    haptics.tap();
    setGramsDraft(null);
    if (scaleBase.current) {
      scaleBase.current = null;
      setScaleDraft(null);
    }
    applyScaleFrom({ cal: calories, p: protein, c: carbs, f: fat, ps: pendingServing }, f);
  }

  function openScaleDraft() {
    scaleBase.current = { cal: calories, p: protein, c: carbs, f: fat, ps: pendingServing };
    setScaleDraft('');
  }

  /**
   * The typed factor (1.25, 0,75) applies LIVE, from the snapshot taken when
   * the field opened. It used to apply only on blur — and on an iPhone the
   * decimal pad has no Return key, so the natural next tap was Add, which does
   * not blur the field: the entry saved unscaled. Text that is not yet a
   * factor ("", "0.") shows the unscaled numbers until it is.
   */
  function onScaleDraftChange(text: string) {
    setScaleDraft(text);
    const base = scaleBase.current;
    if (!base) return;
    applyScaleFrom(base, parseFactor(text) ?? 1);
  }

  /** Close the typed factor. A readable one is already applied; unreadable or
   *  out-of-range text puts the numbers back with a warning haptic, like the
   *  typed time. Guarded on the snapshot, not the draft state, because a Scale
   *  chip can settle the draft in the same frame this blur fires. */
  function commitScale() {
    const base = scaleBase.current;
    if (!base) return;
    scaleBase.current = null;
    const raw = (scaleDraft ?? '').trim();
    setScaleDraft(null);
    if (raw === '' || parseFactor(raw) != null) return;
    haptics.warning();
    applyScaleFrom(base, 1);
  }

  /**
   * Keep the focused numeric field on screen. With the keyboard up on a
   * 667pt iPhone the form's scroll area is ~220pt, and the macro row starts at
   * ~170 — so kcal → Next → protein put protein half under the pinned Add
   * button. Runs on focus, and again on every layout of the scroll area while a
   * field is focused: the area shrinks as the keyboard rises AFTER the focus.
   */
  function revealField(f: NumField, animated: boolean) {
    const box = fieldBoxes.current[f === 'calories' ? 'calories' : f === 'grams' || f === 'scale' ? 'scale' : 'macros'];
    const { y, h } = formScroll.current;
    if (!box || h <= 0) return;
    const top = box.y - space.sm;
    const bottom = box.y + box.height + space.sm;
    if (top < y) formScrollRef.current?.scrollTo({ y: Math.max(0, top), animated });
    else if (bottom > y + h) formScrollRef.current?.scrollTo({ y: bottom - h, animated });
  }

  function onNumFocus(f: NumField) {
    kbFieldRef.current = f;
    revealField(f, true);
  }
  function onNumBlur(f: NumField) {
    if (kbFieldRef.current === f) kbFieldRef.current = null;
  }


  /** A macro field's bar, ‹ › to its neighbours in MACRO_CHAIN. Rendered
   *  straight after its input (KeyboardBar.tsx says why the order matters). */
  function macroBar(f: MacroField) {
    const i = MACRO_CHAIN.indexOf(f);
    const prev = MACRO_CHAIN[i - 1];
    const next = MACRO_CHAIN[i + 1];
    return (
      <KeyboardBar
        nativeID={kbId(f)}
        onPrev={prev ? () => macroRefs[prev].current?.focus() : undefined}
        onNext={next ? () => macroRefs[next].current?.focus() : undefined}
      />
    );
  }

  // The gram context is live only while the calories are still the ones it
  // produced — the same test "Save to My Foods" applies. A hand-edited kcal
  // means a different amount, so the grams field steps aside rather than
  // offering a weight that no longer describes the numbers.
  const gramCtx =
    pendingServing && pendingServing.ctx.basis && pendingServing.ctx.grams != null && pendingServing.appliedCalories === calNum
      ? pendingServing.ctx
      : null;

  /**
   * Typed grams → all four numbers, rescaled on every keystroke FROM THE
   * BASIS (`rescaleFromBasis`), never from the current fields: "1" → "15" →
   * "150" must land where typing "150" in one go lands, not drift through
   * three rounded intermediates. Text that is not yet a weight ("", "0", "0.")
   * leaves the form alone until it is.
   */
  function onGramsChange(text: string) {
    setGramsDraft(text);
    const basis = gramCtx?.basis;
    const g = parseGrams(text);
    if (!basis || g == null) return;
    const next = rescaleFromBasis(basis, g);
    if (!next) return;
    const str = (n: number | undefined, prev: string) => (n != null ? String(n) : prev);
    setCalories(String(next.calories));
    setProtein((v) => str(next.protein, v));
    setCarbs((v) => str(next.carbs, v));
    setFat((v) => str(next.fat, v));
    setPendingServing((ps) =>
      ps ? { ctx: { ...ps.ctx, grams: Math.round(g * 10) / 10 }, appliedCalories: next.calories } : ps,
    );
  }

  /**
   * A scanned product lands on the review form at ONE serving — or at 100 g
   * when the label gave no serving size — and nowhere else. + → barcode → Add
   * is three taps for every product.
   *
   * A product reporting both a serving and per-100 g used to open the portion
   * picker first (four taps), to choose between two bases the form can already
   * express: the grams field below the macros is pre-filled with the serving's
   * weight and rescales all four numbers as you type (`onGramsChange`), and the
   * Scale row covers "half of it" / "two of them". So the other basis is one
   * edit away, and the common case — one of the thing in your hand — costs no
   * decision at all. A product with no weight at all lands without the grams
   * field; Scale still works.
   *
   * Searched foods keep the picker when they offer more than one portion
   * (FoodSearch): "1 cup" vs "1 tbsp" vs "1 medium" is a choice of UNIT that a
   * weight field cannot make for you, where serving-vs-100 g is only a choice
   * of number.
   */
  function openBarcodeReview(est: BarcodeEstimate) {
    const g = est.serving?.grams;
    const weighed = g != null && g > 0;
    prefill({
      calories: Math.round(est.calories),
      protein: est.protein != null ? round1(est.protein) : undefined,
      carbs: est.carbs != null ? round1(est.carbs) : undefined,
      fat: est.fat != null ? round1(est.fat) : undefined,
      mealLabel: est.mealLabel,
      serving: {
        grams: weighed ? g : undefined,
        source: est.serving?.source ?? 'barcode',
        barcode: est.serving?.barcode,
        brand: est.serving?.brand,
        name: est.mealLabel,
        // Unrounded, so typed grams rescale from the label, not from the form.
        basis: weighed
          ? { grams: g, kcal: est.calories, protein: est.protein, carbs: est.carbs, fat: est.fat }
          : undefined,
      },
    });
  }

  // While the scanner is open the user's own library answers first
  // (lib/barcode.ts explains the registration). Re-registered when My Foods
  // changes.
  useEffect(() => {
    if (!scannerOpen) return;
    return setScanLibrary({ resolveLocal: (code) => productFromLibrary(customFoods, code) });
  }, [scannerOpen, customFoods]);

  // Photo scan's doors — "Scan meal" in More ways and the camera in the search
  // field — open only on Today: the scan screen logs to today, so from a past
  // day it would put the meal on the wrong date.
  const photoScanDoor = FEATURES.photoScan && Platform.OS !== 'web' && !dateKey;
  function openPhotoScan() {
    haptics.tap();
    setMoreOpen(false);
    onClose();
    router.navigate('/scan');
  }

  function openScanner() {
    haptics.tap();
    setMoreOpen(false);
    if (!cameraDenied) setScannerOpen(true);
  }

  function backToBrowse() {
    setVoiceSeed(undefined);
    setMode('browse');
  }

  // Mode switches happen in place, inside one Modal — move the screen reader
  // to the new mode's heading (`useA11yFocus`). Not for the blank form: its
  // Calories field takes focus itself, and two moves would fight.
  const modeTitleRef = useA11yFocus(mode, visible && !(mode === 'custom' && blankOpen && !editing));

  const formDirty =
    mode === 'custom' && formSig(label, calories, protein, carbs, fat, note) !== baseline;
  const dirty =
    formDirty || ((mode === 'recipe' || mode === 'recipeImport' || mode === 'meal') && subDirty);

  /**
   * Every dismissal the user did not aim at a button — backdrop tap, drag,
   * Android back — comes through here instead of closing outright.
   *
   * Android back steps back first: out of the search's portion picker, out of
   * a sub-mode to browse. And a close that would throw away typed content asks
   * before it does — one stray tap on the dimmed area cost a whole hand-typed
   * entry. Returns false when the sheet stays open (BottomSheet then settles
   * a drag back into place).
   */
  function askDiscard(then: () => void) {
    confirm({
      title: t('entry.discardConfirm'),
      confirmText: t('entry.discard'),
      destructive: true,
      onConfirm: then,
    });
  }

  /**
   * Every on-screen way back to browse — the form's chevron, the recipe and
   * meal-text Cancel — goes through the same dirty check Android back does.
   * The chevron used to drop a hand-typed entry silently while the hardware
   * key, one gesture over, asked first.
   */
  function stepBackToBrowse() {
    if (dirty) askDiscard(backToBrowse);
    else backToBrowse();
  }

  function requestClose(via: SheetCloseVia): boolean {
    if (via === 'back') {
      if (mode === 'browse' && searchBack.current?.()) return false;
      if (mode !== 'browse' && !editing) {
        stepBackToBrowse();
        return false;
      }
    }
    if (dirty) {
      askDiscard(onClose);
      return false;
    }
    onClose();
    return true;
  }

  /**
   * One ranked list, not four labelled sections.
   *
   * Browse used to stack Recent / My foods / Quick add / Suggested as four
   * peers, each with its own header, so nothing was ranked and the screen read
   * as a wall. The pattern every leading tracker converged on is a single
   * recency-ordered list with search pinned above it — and recency is the most
   * predictive signal for what someone is about to log.
   *
   * Recent and My foods are the same *intent* ("a food I have had before") and
   * differ only in provenance, so they merge, tagged. **Quick add stays a
   * separate pinned strip**: it is a genuinely different action — one tap, no
   * confirmation — and it is the same slot list the home-screen widget and the
   * Quick Settings tile fire, so demoting it would contradict surfaces already
   * shipped.
   *
   * `Suggested` starters still appear, but only when there is nothing else —
   * they are onboarding, not a competing section.
   */
  // Through a ref: `quickLog` is a fresh function every render, and as a memo
  // dependency it rebuilt the whole browse list on each one.
  const quickLogRef = useRef(quickLog);
  quickLogRef.current = quickLog;
  const browseRows = useMemo(() => {
    type Row = {
      key: string;
      name: string;
      kcal: number;
      protein?: number;
      tag?: string;
      onLog: () => void;
      onRemove?: () => void;
    };
    const recentRows: Row[] = [];
    const foodRows: Row[] = [];
    for (const r of recentEntries) {
      recentRows.push({
        key: `recent-${r.id}`,
        name: r.mealLabel ?? '',
        kcal: r.calories,
        protein: r.protein ?? undefined,
        // All four macros, not just kcal+protein. A recent row IS a DailyLog
        // and carries carbs and fat; dropping them here logged a row the user
        // believed was a copy of the original, under-reported the carb and fat
        // rings, and mirrored the same gap to Apple Health. The My Foods branch
        // below always passed all four — this one did not. Fixed 2026-09-22.
        onLog: () =>
          quickLogRef.current({
            calories: r.calories,
            protein: r.protein ?? undefined,
            carbs: r.carbs ?? undefined,
            fat: r.fat ?? undefined,
            mealLabel: r.mealLabel ?? undefined,
          }),
        onRemove: r.mealLabel && onHideRecent ? () => onHideRecent(r.mealLabel as string) : undefined,
      });
    }
    for (const f of customFoods) {
      const m = scaleCustomFood(f, 1);
      foodRows.push({
        key: `customfood-${f.id}`,
        name: f.name,
        kcal: m.calories,
        protein: m.protein,
        tag: t('entry.myFoods'),
        onLog: () =>
          quickLogRef.current({ calories: m.calories, protein: m.protein, carbs: m.carbs, fat: m.fat, mealLabel: f.name }),
        // Removing a saved food is destructive and one tap away in Manage mode,
        // so it goes through the confirm sheet (S18-6). Hiding a recent is not
        // — it is a list preference, and the food itself is still in the diary.
        onRemove:
          f.id && onDeleteCustomFood
            ? () =>
                confirm({
                  title: t('entry.foodDeleteConfirm'),
                  body: f.name,
                  confirmText: t('common.remove'),
                  destructive: true,
                  onConfirm: () => void onDeleteCustomFood(f.id as string),
                })
            : undefined,
      });
    }
    // Recency still leads, but My Foods keep their reserved rows (see
    // MY_FOODS_RESERVED); any of the cap recents leave unused goes to them too.
    const recentsShown = recentRows.slice(0, BROWSE_ROW_CAP - Math.min(foodRows.length, MY_FOODS_RESERVED));
    return [...recentsShown, ...foodRows.slice(0, BROWSE_ROW_CAP - recentsShown.length)];
  }, [recentEntries, customFoods, onHideRecent, onDeleteCustomFood, t]);

  /**
   * The same foods, offered to SEARCH. Typing a saved food's name found
   * nothing before — search asked only the bundled database. My Foods come
   * first so a name that is both a saved food and a recent shows once, as the
   * saved food; a tap is the same one-tap log the browse row does.
   */
  // Through a ref so the memo below can key on the data alone and still log
  // with this render's onSave / onClose / date.
  const libraryItems = useMemo<LibraryItem[]>(() => {
    const seen = new Set<string>();
    const out: LibraryItem[] = [];
    for (const f of customFoods) {
      const m = scaleCustomFood(f, 1);
      seen.add(normalizeName(f.name));
      out.push({
        key: `customfood-${f.id ?? f.name}`,
        name: f.name,
        kcal: m.calories,
        protein: m.protein,
        tag: t('entry.myFoods'),
        onPick: () =>
          quickLogRef.current({ calories: m.calories, protein: m.protein, carbs: m.carbs, fat: m.fat, mealLabel: f.name }),
      });
    }
    for (const r of recentEntries) {
      if (!r.mealLabel) continue;
      const k = normalizeName(r.mealLabel);
      if (seen.has(k)) continue;
      seen.add(k);
      out.push({
        key: `recent-${r.id ?? r.mealLabel}`,
        name: r.mealLabel,
        kcal: r.calories,
        protein: r.protein ?? undefined,
        tag: t('entry.recent'),
        onPick: () =>
          quickLogRef.current({
            calories: r.calories,
            protein: r.protein ?? undefined,
            carbs: r.carbs ?? undefined,
            fat: r.fat ?? undefined,
            mealLabel: r.mealLabel ?? undefined,
          }),
      });
    }
    return out;
  }, [customFoods, recentEntries, t]);

  const browseEmpty = (
    <View style={styles.browse}>
      {/* Quick add — pinned, one tap, no confirmation. */}
      {presets.length > 0 ? (
        <View style={styles.group}>
          <View style={styles.groupHead}>
            <Text style={styles.groupLabel} accessibilityRole="header">{t('entry.quickAdd')}</Text>
            {onDeletePreset ? (
              <TouchableOpacity
                onPress={() => setManage((m) => !m)}
                style={styles.manageBtn}
                hitSlop={{ left: 12, right: 12 }}
                accessibilityRole="button"
                accessibilityState={{ selected: manage }}
              >
                <Text style={[styles.manageText, manage && styles.manageOn]}>
                  {manage ? t('common.done') : t('common.manage')}
                </Text>
              </TouchableOpacity>
            ) : null}
          </View>
          <View style={styles.presetStrip}>
            {presets.map((p) => (
              <TouchableOpacity
                key={p.id}
                style={styles.presetChip}
                testID={`preset-${p.id}`}
                accessibilityRole="button"
                accessibilityLabel={
                  manage
                    ? `${t('common.remove')}: ${p.name}`
                    : [p.name, `${formatNumber(p.calories, locale)} ${t('today.kcal')}`, p.protein != null ? t('entry.proteinAmount', { n: p.protein }) : null]
                        .filter(Boolean)
                        .join(', ')
                }
                onPress={() =>
                  manage
                    ? p.id &&
                      confirm({
                        title: t('entry.presetDeleteConfirm'),
                        body: p.name,
                        confirmText: t('common.remove'),
                        destructive: true,
                        onConfirm: () => void onDeletePreset?.(p.id as string),
                      })
                    : quickLog({ calories: p.calories, protein: p.protein, carbs: p.carbs, fat: p.fat, mealLabel: p.name })
                }
              >
                <Text style={styles.presetName} numberOfLines={1}>{p.name}</Text>
                {manage ? (
                  <Ionicons name="close" size={font.tiny + 2} color={colors.onInk} style={{ opacity: 0.7 }} />
                ) : (
                  // Protein beside kcal: this app tracks the two together, and a
                  // chip that showed one left the user guessing the other.
                  <Text style={styles.presetKcal}>
                    {p.calories}
                    {p.protein != null ? ` · ${t('entry.proteinAmount', { n: p.protein })}` : ''}
                  </Text>
                )}
              </TouchableOpacity>
            ))}
          </View>
        </View>
      ) : null}

      {/* Everything you have logged or saved, most recent first. */}
      {browseRows.length > 0 ? (
        <View style={styles.group}>
          <View style={styles.groupHead}>
            <Text style={styles.groupLabel} accessibilityRole="header">{t('entry.recent')}</Text>
            {onHideRecent || onDeleteCustomFood ? (
              <TouchableOpacity
                onPress={() => setManage((m) => !m)}
                style={styles.manageBtn}
                hitSlop={{ left: 12, right: 12 }}
                accessibilityRole="button"
                accessibilityState={{ selected: manage }}
              >
                <Text style={[styles.manageText, manage && styles.manageOn]}>
                  {manage ? t('common.done') : t('common.manage')}
                </Text>
              </TouchableOpacity>
            ) : null}
          </View>
          {browseRows.map((row) => (
            <TouchableOpacity
              key={row.key}
              style={styles.row}
              testID={row.key}
              accessibilityRole="button"
              accessibilityLabel={
                manage && row.onRemove
                  ? `${t('common.remove')}: ${row.name}`
                  : // A bare "101" was all the number said; name the unit.
                    [row.name, row.tag, `${formatNumber(row.kcal, locale)} ${t('today.kcal')}`, row.protein != null ? t('entry.proteinAmount', { n: row.protein }) : null]
                      .filter(Boolean)
                      .join(', ')
              }
              onPress={() => (manage ? row.onRemove?.() : row.onLog())}
            >
              <Text style={styles.rowName} numberOfLines={1}>{row.name}</Text>
              {row.tag ? <Text style={styles.rowTag}>{row.tag}</Text> : null}
              {manage && row.onRemove ? (
                <Ionicons name="close" size={font.body} color={colors.danger} />
              ) : (
                <View style={styles.rowNums}>
                  <Text style={styles.rowKcal}>{row.kcal}</Text>
                  {row.protein != null ? (
                    <Text style={styles.rowProtein}>{t('entry.proteinAmount', { n: row.protein })}</Text>
                  ) : null}
                </View>
              )}
            </TouchableOpacity>
          ))}
        </View>
      ) : null}

      {browseRows.length === 0 && presets.length === 0 ? (
        <View style={styles.group}>
          <Text style={styles.groupLabel} accessibilityRole="header">{t('entry.suggested')}</Text>
          <View style={styles.starterWrap}>
            {starterFoods(locale).map((f) => (
              <TouchableOpacity
                key={f.label}
                style={styles.starterChip}
                testID={`starter-${f.label}`}
                accessibilityRole="button"
                accessibilityLabel={`${f.label}, ${formatNumber(f.calories, locale)} ${t('today.kcal')}`}
                onPress={() => prefill({ calories: f.calories, protein: f.protein, mealLabel: f.label })}
              >
                <Text style={styles.starterLabel} numberOfLines={1}>{f.label}</Text>
                <Text style={styles.starterKcal}>{f.calories}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      ) : null}
    </View>
  );

  const headerIcons = (
    <>
    <View style={styles.iconRow}>
      {/* A plus, not a pencil. `create-outline` is Ionicons' pencil-on-a-square,
          and testers read it as "edit something that exists" — but this button
          opens a blank entry, which is the most common way into the sheet. A
          bare plus is the affordance people already expect for "jot one down".
          The label stays "Write it in": the icon carries the action, the words
          carry which of the four ways in this is. `testID` is unchanged on
          purpose — four Maestro flows and a unit test drive this button by it. */}
      <TouchableOpacity style={styles.primaryBtn} onPress={() => openCustomBlank()} accessibilityRole="button" testID="open-manual">
        <Ionicons name="add" size={20} color={colors.ink} />
        <Text style={styles.primaryBtnText}>{t('entry.writeItYourself')}</Text>
      </TouchableOpacity>
      <TouchableOpacity
        style={styles.primaryBtn}
        onPress={() => { haptics.tap(); setMoreOpen((v) => !v); }}
        accessibilityRole="button"
        accessibilityState={{ expanded: moreOpen }}
        testID="open-more"
      >
        <Ionicons name={moreOpen ? 'chevron-up' : 'ellipsis-horizontal'} size={18} color={colors.ink} />
        <Text style={styles.primaryBtnText}>{t('entry.moreWays')}</Text>
      </TouchableOpacity>
    </View>
    {moreOpen ? (
      <View style={styles.moreList}>
        {/* Photo scan's second door. Since the + went tap-to-search
            (UX_AUDIT S18-18) the only other way in is a long-press on it,
            which nothing on screen shows. See `photoScanDoor`. */}
        {photoScanDoor ? (
          <TouchableOpacity
            style={styles.moreRow}
            onPress={openPhotoScan}
            accessibilityRole="button"
            testID="open-scan"
          >
            <Ionicons name="camera-outline" size={20} color={colors.ink} />
            <Text style={styles.moreRowText}>{t('log.scan')}</Text>
          </TouchableOpacity>
        ) : null}
        <TouchableOpacity style={styles.moreRow} onPress={() => { haptics.tap(); setMoreOpen(false); setMode('meal'); }} accessibilityRole="button" testID="open-mealtext">
          <Ionicons name="chatbubble-ellipses-outline" size={20} color={colors.ink} />
          <Text style={styles.moreRowText}>{t('entry.describeMeal')}</Text>
        </TouchableOpacity>
        {Platform.OS !== 'web' ? (
          <TouchableOpacity style={styles.moreRow} onPress={openScanner} accessibilityRole="button" testID="open-barcode">
            <Ionicons name="barcode-outline" size={20} color={colors.ink} />
            <Text style={styles.moreRowText}>{t('entry.scanBarcode')}</Text>
          </TouchableOpacity>
        ) : null}
        <TouchableOpacity style={styles.moreRow} onPress={() => { haptics.tap(); setMoreOpen(false); setMode('recipe'); }} accessibilityRole="button" testID="open-recipe">
          <Ionicons name="calculator-outline" size={20} color={colors.ink} />
          <Text style={styles.moreRowText}>{t('entry.recipeBuilder')}</Text>
        </TouchableOpacity>
        {Platform.OS !== 'web' ? (
          <TouchableOpacity style={styles.moreRow} onPress={() => { haptics.tap(); setMoreOpen(false); setMode('recipeImport'); }} accessibilityRole="button" testID="open-recipe-import">
            <Ionicons name="link-outline" size={20} color={colors.ink} />
            <Text style={styles.moreRowText}>{t('entry.importRecipe')}</Text>
          </TouchableOpacity>
        ) : null}
      </View>
    ) : null}
    {cameraDenied ? (
      <View style={styles.camDenied}>
        <Text style={styles.camDeniedText}>{t('barcode.permNeeded')}</Text>
        <TouchableOpacity onPress={() => Linking.openSettings()} style={styles.camDeniedBtn} accessibilityRole="button" testID="barcode-perm-settings">
          <Text style={styles.camDeniedLink}>{t('barcode.openSettings')}</Text>
        </TouchableOpacity>
      </View>
    ) : null}
    </>
  );

  return (
    <BottomSheet visible={visible} onClose={onClose} onRequestClose={requestClose} backdropTestID="entry-backdrop">
            {/* UX_AUDIT F4: this sheet had no title at all. Every other mode
                below announces itself ("Add food", "Edit entry"); the one most
                people land on opened with a bare search field and left them to
                infer what they were looking at. */}
            {mode === 'browse' ? (
              <>
              <Text ref={modeTitleRef} style={styles.browseTitle} accessibilityRole="header">{t('entry.browseTitle')}</Text>
              <FoodSearch
                unitSystem={unitSystem}
                seedQuery={searchSeed}
                initial={searchSnap.current}
                onSnapshot={(snap) => {
                  searchSnap.current = snap;
                }}
                backHandlerRef={searchBack}
                libraryItems={libraryItems}
                // Gone once the camera is denied for good: the notice under the
                // buttons explains why, and a door that opens onto nothing is worse.
                onScanBarcode={Platform.OS !== 'web' && !cameraDenied ? openScanner : undefined}
                // Not gated on `cameraDenied`: that is the barcode scanner's
                // permission verdict, and the scan screen asks for itself.
                onScanMeal={photoScanDoor ? openPhotoScan : undefined}
                micMessage={
                  micFailed ? (
                    <Text style={styles.micFailed} testID="mic-failed">
                      {t('voice.failed')}
                    </Text>
                  ) : null
                }
                micSlot={
                  <MicButton
                    onFailedChange={setMicFailed}
                    onSearch={(text) => setSearchSeed(text)}
                    onMeal={(text) => { setVoiceSeed(text); setMode('meal'); }}
                  />
                }
                headerRight={headerIcons}
                emptyContent={browseEmpty}
                onPick={(est) => prefill(est)}
                onCreateFromQuery={(q) => openCustomBlank(q)}
              />
              </>
            ) : mode === 'recipe' ? (
              <RecipeBuilder onCancel={stepBackToBrowse} onApply={(est) => prefill(est)} onDirtyChange={setSubDirty} />
            ) : mode === 'recipeImport' ? (
              <RecipeImport onCancel={stepBackToBrowse} onApply={(est) => prefill(est)} onDirtyChange={setSubDirty} />
            ) : mode === 'meal' ? (
              <MealText
                forDate={forDate}
                seedText={voiceSeed}
                onDirtyChange={setSubDirty}
                onCancel={stepBackToBrowse}
                onAddMany={async (entries) => {
                  if (onSaveMany) await onSaveMany(entries);
                  else for (const entry of entries) await onSave(entry);
                  onClose();
                }}
              />
            ) : (
              <View style={styles.customWrap}>
                <View style={styles.customHead}>
                  {!editing ? (
                    // Icon-only, so its name is free to say where it goes —
                    // back to the search the user came from, which is kept.
                    <TouchableOpacity
                      onPress={stepBackToBrowse}
                      style={styles.backBtn}
                      testID="custom-back"
                      accessibilityRole="button"
                      accessibilityLabel={t('common.back')}
                    >
                      <Ionicons name="chevron-back" size={22} color={colors.ink} />
                    </TouchableOpacity>
                  ) : (
                    <View style={styles.backSpacer} />
                  )}
                  <Text ref={modeTitleRef} style={styles.title} accessibilityRole="header">{editing ? t('entry.editTitle') : t('entry.addTitle')}</Text>
                  <View style={styles.backSpacer} />
                </View>

                {/* Scrolls so the fields can never push Save/Delete out of the
                    sheet when the keyboard is up — the actions row below stays
                    pinned and reachable. */}
                <ScrollView
                  ref={formScrollRef}
                  style={styles.formScroll}
                  contentContainerStyle={styles.form}
                  keyboardShouldPersistTaps="handled"
                  showsVerticalScrollIndicator={false}
                  scrollEventThrottle={32}
                  onScroll={(e) => {
                    formScroll.current.y = e.nativeEvent.contentOffset.y;
                  }}
                  onLayout={(e) => {
                    formScroll.current.h = e.nativeEvent.layout.height;
                    // Unanimated: this fires frame by frame as the keyboard
                    // rises, and the field should ride its top edge, not chase it.
                    if (kbFieldRef.current) revealField(kbFieldRef.current, false);
                  }}
                >
                  {/* Each input carries its own label: the visible caption is a
                      sibling Text, so without it a screen reader announced the
                      placeholder — "0, text field" — for all four numbers.
                      Return walks name → kcal → protein → carbs → fat. */}
                  <Field label={t('entry.name')} labelled>
                    <TextInputBase
                      placeholder={t('entry.namePlaceholder')}
                      value={label}
                      onChangeText={setLabel}
                      accessibilityLabel={t('entry.name')}
                      returnKeyType="next"
                      submitBehavior="submit"
                      onSubmitEditing={() => calRef.current?.focus()}
                      testID="entry-label"
                    />
                  </Field>

                  <Field
                    label={t('entry.calories')}
                    labelled
                    onLayout={(e) => (fieldBoxes.current.calories = e.nativeEvent.layout)}
                  >
                    <TextInputBase
                      ref={calRef}
                      placeholder="0"
                      keyboardType="numeric"
                      value={calories}
                      onChangeText={setCalories}
                      accessibilityLabel={t('entry.calories')}
                      returnKeyType="next"
                      submitBehavior="submit"
                      onSubmitEditing={() => proteinRef.current?.focus()}
                      {...kbBarProps.calories}
                      onFocus={() => onNumFocus('calories')}
                      onBlur={() => onNumBlur('calories')}
                      testID="entry-calories"
                    />
                    {macroBar('calories')}
                  </Field>

                  <View style={styles.row3} onLayout={(e) => (fieldBoxes.current.macros = e.nativeEvent.layout)}>
                    <Field label={t('entry.proteinG')} style={styles.third} labelled>
                      <TextInputBase
                        ref={proteinRef}
                        placeholder="0"
                        keyboardType="numeric"
                        value={protein}
                        onChangeText={setProtein}
                        accessibilityLabel={t('entry.proteinG')}
                        returnKeyType="next"
                        submitBehavior="submit"
                        onSubmitEditing={() => carbsRef.current?.focus()}
                        {...kbBarProps.protein}
                        onFocus={() => onNumFocus('protein')}
                        onBlur={() => onNumBlur('protein')}
                        testID="entry-protein"
                      />
                      {macroBar('protein')}
                    </Field>
                    <Field label={t('entry.carbsG')} style={styles.third} labelled>
                      <TextInputBase
                        ref={carbsRef}
                        placeholder="0"
                        keyboardType="numeric"
                        value={carbs}
                        onChangeText={setCarbs}
                        accessibilityLabel={t('entry.carbsG')}
                        returnKeyType="next"
                        submitBehavior="submit"
                        onSubmitEditing={() => fatRef.current?.focus()}
                        {...kbBarProps.carbs}
                        onFocus={() => onNumFocus('carbs')}
                        onBlur={() => onNumBlur('carbs')}
                        testID="entry-carbs"
                      />
                      {macroBar('carbs')}
                    </Field>
                    <Field label={t('entry.fatG')} style={styles.third} labelled>
                      <TextInputBase
                        ref={fatRef}
                        placeholder="0"
                        keyboardType="numeric"
                        value={fat}
                        onChangeText={setFat}
                        accessibilityLabel={t('entry.fatG')}
                        returnKeyType="done"
                        {...kbBarProps.fat}
                        onFocus={() => onNumFocus('fat')}
                        onBlur={() => onNumBlur('fat')}
                        testID="entry-fat"
                      />
                      {macroBar('fat')}
                    </Field>
                  </View>
                  {/* `|| gramCtx`: typing a tiny weight can round kcal to 0, and
                      the row (with the field being typed in) must not vanish. */}
                  {(calNum != null && calNum > 0) || gramCtx ? (
                    <View style={styles.scaleRow} onLayout={(e) => (fieldBoxes.current.scale = e.nativeEvent.layout)}>
                      <Text style={styles.fieldLabel}>{t('entry.scale')}</Text>
                      {SCALE_STEPS.map((st) => (
                        <TouchableOpacity
                          key={st.f}
                          style={styles.scaleChip}
                          onPress={() => scaleForm(st.f)}
                          accessibilityRole="button"
                          accessibilityLabel={t('entry.scaleBy', { n: formatNumber(st.f, locale) })}
                          testID={`entry-scale-${st.f}`}
                        >
                          <Text style={styles.scaleChipText}>
                            {st.f === 0.5 ? '½' : formatNumber(st.f, locale)}×
                          </Text>
                        </TouchableOpacity>
                      ))}
                      {scaleDraft != null ? (
                        <TextInput
                          style={[styles.scaleChip, styles.scaleInput]}
                          value={scaleDraft}
                          onChangeText={onScaleDraftChange}
                          {...doneKeyProps}
                          onFocus={() => onNumFocus('scale')}
                          // Applied live (`onScaleDraftChange`); blur only
                          // settles it — Done, the bar's Done, or a tap away.
                          onBlur={() => {
                            onNumBlur('scale');
                            commitScale();
                          }}
                          autoFocus
                          keyboardType="decimal-pad"
                          returnKeyType="done"
                          maxLength={5}
                          placeholder={formatNumber(1.25, locale)}
                          placeholderTextColor={colors.faint}
                          maxFontSizeMultiplier={1.4}
                          accessibilityLabel={t('entry.scaleTypeA11y')}
                          keyboardAppearance={scheme}
                          testID="entry-scale-input"
                        />
                      ) : (
                        <TouchableOpacity
                          style={styles.scaleChip}
                          onPress={openScaleDraft}
                          accessibilityRole="button"
                          accessibilityLabel={t('entry.scaleTypeA11y')}
                          testID="entry-scale-other"
                        >
                          <Text style={styles.scaleChipText}>{t('entry.scaleOther')}</Text>
                        </TouchableOpacity>
                      )}
                      {/* Edit in grams — only when the pick came with a weight
                          and the numbers still describe it (`gramCtx`). The
                          field rescales as you type; see `onGramsChange`. */}
                      {gramCtx ? (
                        <View style={styles.gramsBox}>
                          <TextInput
                            style={[styles.scaleChip, styles.scaleInput, styles.gramsInput]}
                            value={gramsDraft ?? String(gramCtx.grams)}
                            onChangeText={onGramsChange}
                            {...doneKeyProps}
                            onFocus={() => {
                              setGramsDraft(String(gramCtx.grams));
                              onNumFocus('grams');
                            }}
                            onBlur={() => {
                              setGramsDraft(null);
                              onNumBlur('grams');
                            }}
                            selectTextOnFocus
                            keyboardType="decimal-pad"
                            returnKeyType="done"
                            maxLength={6}
                            maxFontSizeMultiplier={1.4}
                            accessibilityLabel={t('entry.gramsA11y')}
                            keyboardAppearance={scheme}
                            testID="entry-grams"
                          />
                          <Text style={styles.gramsUnit} importantForAccessibility="no" accessibilityElementsHidden>
                            g
                          </Text>
                        </View>
                      ) : null}
                    </View>
                  ) : null}
                  {macroMiss ? (
                    <Text style={styles.macroNote} testID="entry-macro-note">
                      {t('entry.macroMismatch', { kcal: macroMiss.estimateKcal, entered: calNum ?? 0 })}
                    </Text>
                  ) : null}

                  <Field label={t('entry.meal')}>
                    <View style={styles.chips}>
                      {MEAL_TYPES.map((mt) => {
                        const on = mealType === mt;
                        return (
                          <TouchableOpacity
                            key={mt}
                            style={[styles.chip, on && styles.chipOn]}
                            onPress={() => {
                              setMealTouched(true);
                              setMealType(on ? undefined : mt);
                            }}
                            // 40dp chip + 4 slop = 48 (S18-15; Android's 48dp too); chips sit 8dp apart.
                            hitSlop={4}
                            accessibilityRole="button"
                            accessibilityState={{ selected: on }}
                            testID={`meal-type-${mt}`}
                          >
                            <Text style={[styles.chipText, on && styles.chipTextOn]}>{t(`meal.${mt}`)}</Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  </Field>

                  {showDateRow ? (
                    <Field label={t('entry.date')}>
                      <View style={styles.dateRow}>
                        <TouchableOpacity style={styles.dateStep} onPress={() => shiftEntryDate(-1)} hitSlop={2} accessibilityRole="button" accessibilityLabel={t('settings.earlier')} testID="entry-date-prev">
                          <Text style={styles.dateStepText}>−</Text>
                        </TouchableOpacity>
                        <Text style={styles.dateLabel} testID="entry-date">
                          {formatDate(entryDate, locale, { weekday: 'short', month: 'short', day: 'numeric' })}
                        </Text>
                        <TouchableOpacity
                          style={[styles.dateStep, isSameDay(entryDate, new Date()) && styles.dateStepDisabled]}
                          onPress={() => shiftEntryDate(1)}
                          disabled={isSameDay(entryDate, new Date())}
                          hitSlop={2}
                          accessibilityRole="button"
                          accessibilityLabel={t('settings.later')}
                          accessibilityState={{ disabled: isSameDay(entryDate, new Date()) }}
                          testID="entry-date-next"
                        >
                          <Text style={styles.dateStepText}>+</Text>
                        </TouchableOpacity>
                      </View>
                    </Field>
                  ) : null}

                  <Field label={t('entry.time')}>
                    <View style={styles.dateRow}>
                      {TIME_STEPS.slice(0, 2).map((st) => (
                        <TouchableOpacity
                          key={st.minutes}
                          style={[styles.dateStep, styles.timeStep]}
                          onPress={() => shiftEntryTime(st.minutes)}
                          hitSlop={2}
                          accessibilityRole="button"
                          accessibilityLabel={t(st.a11y)}
                          testID={st.testID}
                        >
                          <Text style={styles.timeStepText}>{t(st.label)}</Text>
                        </TouchableOpacity>
                      ))}
                      {timeDraft != null ? (
                        <TextInput
                          style={[styles.dateLabel, styles.timeInput]}
                          value={timeDraft}
                          onChangeText={setTimeDraft}
                          // Done blurs a single-line field (`blurOnSubmit`),
                          // so blur is the one commit — both would apply twice.
                          onBlur={commitTypedTime}
                          autoFocus
                          selectTextOnFocus
                          placeholder={t('entry.timeTypePlaceholder')}
                          placeholderTextColor={colors.faint}
                          keyboardType={Platform.OS === 'ios' ? 'numbers-and-punctuation' : 'default'}
                          autoCorrect={false}
                          autoCapitalize="none"
                          returnKeyType="done"
                          maxLength={10}
                          maxFontSizeMultiplier={1.4}
                          accessibilityLabel={t('entry.timeTypeA11y')}
                          keyboardAppearance={scheme}
                          testID="entry-time-input"
                        />
                      ) : (
                        <TouchableOpacity
                          style={styles.timeLabelTap}
                          onPress={() => setTimeDraft('')}
                          accessibilityRole="button"
                          accessibilityLabel={formatTime(entryDate, locale)}
                          accessibilityHint={t('entry.timeTypeA11y')}
                          testID="entry-time-tap"
                        >
                          <Text style={[styles.dateLabel, styles.timeLabelText]} testID="entry-time">
                            {formatTime(entryDate, locale)}
                          </Text>
                          <Text style={styles.timeTapHint}>{t('entry.timeTapHint')}</Text>
                        </TouchableOpacity>
                      )}
                      {TIME_STEPS.slice(2).map((st) => (
                        <TouchableOpacity
                          key={st.minutes}
                          style={[styles.dateStep, styles.timeStep]}
                          onPress={() => shiftEntryTime(st.minutes)}
                          hitSlop={2}
                          accessibilityRole="button"
                          accessibilityLabel={t(st.a11y)}
                          testID={st.testID}
                        >
                          <Text style={styles.timeStepText}>{t(st.label)}</Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  </Field>

                  <Field label={t('entry.note')} labelled>
                    <TextInputBase
                      style={[styles.input, styles.noteInput]}
                      accessibilityLabel={t('entry.note')}
                      placeholder={t('entry.notePlaceholder')}
                      value={note}
                      onChangeText={setNote}
                      multiline
                      maxLength={LOG_NOTE_MAX}
                      testID="entry-note"
                    />
                  </Field>

                  {canSavePreset ? (
                    <TouchableOpacity
                      style={[styles.savePreset, (libBusy != null || libSaved.preset === currentSig) && styles.savePresetDone]}
                      onPress={saveAsPreset}
                      disabled={libBusy != null || libSaved.preset === currentSig}
                      accessibilityRole="button"
                      accessibilityState={{ disabled: libBusy != null || libSaved.preset === currentSig, busy: libBusy === 'preset' }}
                      testID="save-preset"
                    >
                      <Ionicons
                        name={libSaved.preset === currentSig ? 'checkmark' : 'star-outline'}
                        size={font.small + 2}
                        color={colors.teal}
                      />
                      <Text style={styles.savePresetText}>
                        {libSaved.preset === currentSig ? t('entry.presetSaved') : t('entry.savePreset')}
                      </Text>
                    </TouchableOpacity>
                  ) : null}

                  {canSaveCustomFood ? (
                    <TouchableOpacity
                      style={[styles.savePreset, (libBusy != null || libSaved.food === currentSig) && styles.savePresetDone]}
                      onPress={saveAsCustomFood}
                      disabled={libBusy != null || libSaved.food === currentSig}
                      accessibilityRole="button"
                      accessibilityState={{ disabled: libBusy != null || libSaved.food === currentSig, busy: libBusy === 'food' }}
                      testID="save-customfood"
                    >
                      <Ionicons
                        name={libSaved.food === currentSig ? 'checkmark' : 'add'}
                        size={font.small + 2}
                        color={colors.teal}
                      />
                      <Text style={styles.savePresetText}>
                        {libSaved.food === currentSig ? t('entry.myFoodSaved') : t('entry.saveMyFood')}
                      </Text>
                    </TouchableOpacity>
                  ) : null}
                </ScrollView>

                {formError ? (
                  <Text style={styles.formError} accessibilityRole="alert" accessibilityLiveRegion="polite" testID="entry-form-error">
                    {formError}
                  </Text>
                ) : null}
                <View style={styles.actions}>
                  {editing && onDelete ? (
                    // Guarded one way or the other (S18-6): this button sits
                    // beside Save at the bottom of a keyboard-driven form, which
                    // is where a thumb lands by habit. Screens that offer Undo
                    // pass `deleteUndoable` and the tap fires at once; the rest
                    // get the confirm sheet. `ConfirmHost` is mounted in the tab
                    // layout; with no host the confirm performs nothing, which
                    // is the safe failure.
                    <TouchableOpacity
                      style={styles.delete}
                      onPress={() =>
                        deleteUndoable
                          ? void onDelete()
                          : confirm({
                              title: t('entry.deleteConfirm'),
                              body: label.trim() || undefined,
                              confirmText: t('entry.delete'),
                              destructive: true,
                              onConfirm: () => void onDelete(),
                            })
                      }
                      accessibilityRole="button"
                      testID="entry-delete"
                    >
                      <Text style={styles.deleteText}>{t('entry.delete')}</Text>
                    </TouchableOpacity>
                  ) : null}
                  <TouchableOpacity style={[styles.save, !canSave && styles.saveDisabled]} onPress={save} disabled={!canSave || busy} accessibilityRole="button" testID="entry-save">
                    <Text style={styles.saveText}>{editing ? t('common.save') : t('entry.add')}</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}

      {/* Stays INSIDE the sheet, as it always was: a `<Modal>` renders in its
          own native view and takes no part in the parent's layout, and on iOS
          presenting one from within another is the supported way to stack
          them. Hoisting it to a sibling would change that for no gain. */}
      {scannerOpen ? (
        <BarcodeScanner
          visible={scannerOpen}
          onClose={() => setScannerOpen(false)}
          onDenied={() => {
            setScannerOpen(false);
            setCameraDenied(true);
          }}
          onPick={(est) => {
            setScannerOpen(false);
            openBarcodeReview(est);
          }}
          // The scan worked; the database simply lacks the product. The label
          // in the user's hand has every number the form needs, and the
          // barcode rides into the form so "Save to My Foods" stores it under
          // that code (`customFoodDocId`) and the next scan of it is a hit.
          onEnterFromLabel={(code) => {
            setScannerOpen(false);
            openCustomBlank('', { source: 'barcode', barcode: code });
          }}
        />
      ) : null}
    </BottomSheet>
  );
}

/** Plain text input styled to the sheet — shared look for the custom form. */
// `ref` is a plain prop under React 19 and rides through the spread — the
// form's return-key focus chain needs it.
function TextInputBase(props: React.ComponentProps<typeof TextInput> & { ref?: React.Ref<TextInput> }) {
  const styles = useThemedStyles(createStyles);
  const { colors, scheme } = useTheme();
  // Dynamic Type is honoured here, up to a cap.
  //
  // This used to be `allowFontScaling={false}`, which fixed a real bug the
  // wrong way: a large iOS text setting scaled the placeholder past the field's
  // fixed 52pt height and clipped it. Turning scaling off cured the clipping by
  // ignoring the accessibility setting entirely — in the app's most-used input,
  // for exactly the users who need it most.
  //
  // The field now grows instead (`minHeight`, see `input` below), and the
  // multiplier is capped at 1.4: past that the number pad and the macro grid
  // stop fitting side by side on a small phone, and a form that cannot be
  // completed is worse for the same user than one with slightly small text.
  return (
    <TextInput
      style={styles.input}
      placeholderTextColor={colors.faint}
      maxFontSizeMultiplier={1.4}
      // The app's scheme, not the OS one: the macro fields' keyboard bar is
      // painted from the palette (KeyboardBar), and every field in the form
      // should bring up the same keyboard.
      keyboardAppearance={scheme}
      {...props}
    />
  );
}

/** A captioned form row. `labelled` says the child input already carries
 *  `label` as its accessibilityLabel, so the caption is hidden from screen
 *  readers rather than read twice; rows of chips or steppers keep it. */
function Field({
  label,
  children,
  style,
  labelled = false,
  onLayout,
}: {
  label: string;
  children: React.ReactNode;
  style?: object;
  labelled?: boolean;
  onLayout?: (e: LayoutChangeEvent) => void;
}) {
  const styles = useThemedStyles(createStyles);
  return (
    <View style={[{ gap: space.xs }, style]} onLayout={onLayout}>
      <Text
        style={styles.fieldLabel}
        importantForAccessibility={labelled ? 'no' : 'auto'}
        accessibilityElementsHidden={labelled}
      >
        {label}
      </Text>
      {children}
    </View>
  );
}

const createStyles = ({ scheme, colors, shadow }: Theme) => StyleSheet.create({
  fill: { flex: 1 },
  // backdrop / sheetWrap / sheet / grabZone / handle all moved to
  // `<BottomSheet>`, which this file's originals were copied into. Its
  // defaults are these values byte for byte, so the swap changes nothing here
  // except which file owns them.
  // browse
  browseTitle: { fontSize: font.h2, fontWeight: '800', color: colors.ink, marginBottom: space.sm },
  browse: { gap: space.lg, paddingTop: space.sm },
  group: { gap: space.xs },
  groupHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  groupLabel: { fontSize: font.tiny, color: colors.muted, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
  manageText: { fontSize: font.tiny, color: colors.muted, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
  manageOn: { color: colors.danger },
  // A 44-tall target around tiny caps text; the negative margin keeps the
  // section header the height it was (hitSlop alone left a ~38pt target).
  manageBtn: { minHeight: 48, justifyContent: 'center', marginVertical: -space.md },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.card,
    borderRadius: radius.md,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    minHeight: 48,
  },
  // Full width, unclamped, no numberOfLines — the whole point of moving it
  // out of the search row is that the sentence gets to finish.
  micFailed: { fontSize: font.small, color: colors.muted, paddingHorizontal: space.xs, paddingBottom: space.xs },
  // minHeight 48: these two were ~36 tall, under both platforms' target.
  primaryBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.xs, paddingVertical: space.sm, minHeight: 48, borderRadius: radius.md, borderWidth: 1, borderColor: colors.lineStrong, backgroundColor: colors.card },
  primaryBtnText: { fontSize: font.small, fontWeight: '600', color: colors.ink },
  moreList: { marginTop: space.xs, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.card, overflow: 'hidden' },
  moreRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingVertical: space.md, paddingHorizontal: space.md, minHeight: 48 },
  moreRowText: { fontSize: font.body, color: colors.ink },
  presetStrip: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  // 44 tall (was ~33): a one-tap log is the last control to make small.
  presetChip: { flexDirection: 'row', alignItems: 'center', gap: space.xs, paddingVertical: space.sm, paddingHorizontal: space.md, minHeight: 44, borderRadius: radius.pill, backgroundColor: colors.ink },
  presetName: { fontSize: font.small, fontWeight: '600', color: colors.onInk, maxWidth: 150 },
  presetKcal: { fontSize: font.tiny, color: colors.onInk, opacity: 0.7 },
  rowTag: { fontSize: font.tiny, color: colors.muted, marginRight: space.sm },
  rowName: { fontSize: font.body, color: colors.ink, fontWeight: '600', flex: 1, marginRight: space.md },
  rowKcal: { fontSize: font.body, color: colors.muted, fontWeight: '700' },
  rowNums: { alignItems: 'flex-end' },
  rowProtein: { fontSize: font.tiny, color: colors.muted },
  rowRemove: { fontSize: font.body, color: colors.danger, fontWeight: '700' },
  customLink: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingVertical: space.md },
  customLinkText: { fontSize: font.body, color: colors.teal, fontWeight: '700' },
  starterWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  starterChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderColor: colors.lineStrong,
    borderRadius: radius.pill,
    paddingHorizontal: space.md,
    paddingVertical: space.xs,
    minHeight: 44,
    backgroundColor: colors.inputBg,
    maxWidth: '100%',
  },
  starterLabel: { fontSize: font.small, color: colors.ink, fontWeight: '600', flexShrink: 1 },
  starterKcal: { fontSize: font.tiny, color: colors.muted },
  iconRow: { flexDirection: 'row', gap: space.xs },
  iconBtn: {
    width: 42,
    height: 42,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.line,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.inputBg,
  },
  // Camera-denied notice (shown in place, after the scan icon bows out).
  camDenied: { marginTop: space.sm, gap: 2 },
  camDeniedText: { fontSize: font.tiny, color: colors.muted },
  camDeniedBtn: { alignSelf: 'flex-start', minHeight: 44, justifyContent: 'center' },
  camDeniedLink: { fontSize: font.tiny, color: colors.ink, fontWeight: '700', textDecorationLine: 'underline' },
  // custom
  customWrap: { flexShrink: 1 },
  customHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: space.sm },
  // 44 square: a 22pt chevron with 8 of slop was a 38pt target.
  backBtn: { width: 48, height: 48, alignItems: 'flex-start', justifyContent: 'center' },
  backSpacer: { width: 48 },
  title: { fontSize: font.h2, fontWeight: '800', color: colors.ink },
  formScroll: { flexShrink: 1 },
  form: { gap: space.md, paddingBottom: space.md },
  row3: { flexDirection: 'row', gap: space.sm },
  third: { flex: 1 },
  macroNote: { color: colors.danger, fontSize: font.small, marginTop: -space.xs, marginBottom: space.sm },
  fieldLabel: { fontSize: font.small, color: colors.muted, fontWeight: '600' },
  input: {
    backgroundColor: colors.inputBg,
    borderWidth: 1,
    // `lineStrong`: a field's edge has to clear 3:1 (WCAG 1.4.11); `line` is ~1.2:1.
    borderColor: colors.lineStrong,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    // `minHeight`, not `height`: the field has to be able to grow when Dynamic
    // Type scales its text (see TextInputBase). The floor keeps iOS centring the
    // placeholder deterministically at the default size, which is the RN quirk
    // the fixed height was originally working around.
    minHeight: 52,
    fontSize: font.body,
    color: colors.ink,
    textAlignVertical: 'center',
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  chip: {
    borderWidth: 1,
    borderColor: colors.lineStrong,
    borderRadius: radius.pill,
    paddingHorizontal: space.md,
    paddingVertical: space.xs,
    backgroundColor: colors.inputBg,
    minHeight: 40,
    justifyContent: 'center',
  },
  chipOn: { backgroundColor: colors.ink, borderColor: colors.ink },
  chipText: { fontSize: font.small, color: colors.muted, textTransform: 'capitalize' },
  chipTextOn: { color: colors.onInk },
  savePreset: { alignSelf: 'flex-start', minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: space.xs },
  savePresetDone: { opacity: 0.7 },
  scaleRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: space.sm, marginTop: -space.xs },
  scaleChip: {
    minHeight: 48, minWidth: 48, paddingHorizontal: space.md, borderRadius: radius.md, borderWidth: 1,
    borderColor: colors.lineStrong, backgroundColor: colors.inputBg, alignItems: 'center', justifyContent: 'center',
  },
  scaleChipText: { fontSize: font.small, fontWeight: '700', color: colors.ink },
  scaleInput: { minWidth: 72, fontSize: font.body, color: colors.ink, textAlign: 'center', paddingVertical: 0 },
  gramsBox: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  gramsInput: { minWidth: 80 },
  gramsUnit: { fontSize: font.small, fontWeight: '700', color: colors.muted },
  formError: { color: colors.danger, fontSize: font.small, paddingTop: space.sm },
  savePresetText: { fontSize: font.small, color: colors.teal, fontWeight: '700' },
  dateRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.md },
  // Wider than the date row's ± so "+5 min" fits on one line.
  timeStep: { width: undefined, minWidth: 52, paddingHorizontal: space.xs },
  timeStepText: { fontSize: font.small, fontWeight: '700', color: colors.ink },
  // 44 + the 2dp hitSlop on each = 48.
  dateStep: { width: 44, height: 44, borderRadius: radius.md, borderWidth: 1, borderColor: colors.lineStrong, alignItems: 'center', justifyContent: 'center' },
  dateStepDisabled: { opacity: 0.4 },
  dateStepText: { fontSize: font.h3, color: colors.ink, fontWeight: '700' },
  dateLabel: { flex: 1, textAlign: 'center', fontSize: font.body, color: colors.ink, fontWeight: '700' },
  timeLabelTap: { flex: 1, alignItems: 'center', minHeight: 48, justifyContent: 'center' },
  timeLabelText: { flex: 0 },
  timeTapHint: { fontSize: font.tiny, color: colors.faint },
  timeInput: { minHeight: 44, borderWidth: 1, borderColor: colors.lineStrong, borderRadius: radius.md, backgroundColor: colors.inputBg, paddingVertical: 0 },
  noteInput: { minHeight: 72, paddingTop: space.sm, paddingBottom: space.sm, textAlignVertical: 'top' },
  actions: { flexDirection: 'row', gap: space.md, paddingTop: space.md, alignItems: 'center' },
  delete: { minHeight: 48, justifyContent: 'center', paddingHorizontal: space.lg, paddingVertical: space.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.danger },
  deleteText: { color: colors.danger, fontWeight: '700', fontSize: font.body },
  save: { flex: 1, backgroundColor: colors.ink, borderRadius: radius.md, paddingVertical: space.lg, alignItems: 'center' },
  saveDisabled: { opacity: 0.4 },
  saveText: { color: colors.onInk, fontWeight: '700', fontSize: font.h3 },
});
