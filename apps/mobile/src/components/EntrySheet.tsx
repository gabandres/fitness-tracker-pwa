import Ionicons from '@expo/vector-icons/Ionicons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { router } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  type AccessibilityActionEvent,
  ActivityIndicator,
  type LayoutChangeEvent,
  Linking,
  Platform,
  Pressable,
  type PressableProps,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from 'react-native';
import Animated from 'react-native-reanimated';
import { SheetTextInput } from '@/components/SheetTextInput';
import {
  LOG_LABEL_MAX,
  LOG_NOTE_MAX,
  cleanLogLabel,
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
import { CONTEXT_MENUS, ContextMenu, type ContextMenuAction } from '@/components/ContextMenu';
import { MealSlotChips, TimeOfDayRow } from '@/components/EntryWhen';
import { Glyph } from '@/components/Glyph';
import { MenuButton, hasNativeMenuButton, type MenuButtonAction } from '@/components/MenuButton';
import { NativeDateField, hasNativeDateField } from '@/components/NativeDatePicker';
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
import { type Locale, useLocale, useT } from '@/i18n';
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
import {
  formatDecimal,
  kcalOutOfRange,
  lastTimeGrams,
  LOG_KCAL_LIMIT,
  LOG_MACRO_LIMIT,
  macroOutOfRange,
  moveToDay,
  parseDecimal,
  settleWithin,
} from '@/lib/entry-input';
import { isAnySheetActive, onSheetsIdle } from '@/lib/sheet-portal';
import type { AddReceipt } from '@/hooks/useLogWrites';
import { CountUpText, rippleClip, usePulse } from '@/lib/motion';
import { useTheme, useThemedStyles, type Theme } from '@/lib/theme-context';
import { font, radius, space, TARGET } from '@/theme';
import { formatDate, formatNumber } from '@/lib/date-format';

/** What a screen's `onSave` may answer with: the durable write's receipt.
 *  Optional — a screen that resolves `void` is read as "landed". */
type SaveOutcome = Pick<AddReceipt, 'outcome'>;

interface Props {
  visible: boolean;
  /** The row being edited, or null when adding. */
  editing: DailyLog | null;
  /** Resolve with the add's receipt to let a server refusal keep the form
   *  open (re-score bug 2); resolving `void` means the write landed. */
  onSave: (entry: LogEntry) => Promise<void | SaveOutcome> | void;
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

/** Past this Dynamic Type scale the three macro fields stop fitting side by
 *  side on a 375pt phone, and they stack (A1). */
const STACK_FONT_SCALE = 1.35;

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
function scaleField(s: string, f: number, locale: Locale): string {
  const n = parseDecimal(s, locale);
  if (n == null) return s;
  const v = n * f;
  return formatDecimal(v >= 10 ? Math.round(v) : Math.round(v * 10) / 10, locale);
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/** A typed Scale factor (1.25, 0,75), or null when it is not one yet or is
 *  outside 0.1–20 — past that it is a typo, not a portion. */
function parseFactor(text: string, locale: Locale): number | null {
  const f = parseDecimal(text, locale);
  return f != null && f >= 0.1 && f <= 20 ? f : null;
}

/** The form's numeric fields, for the iOS keyboard bar and scroll-into-view. */
type NumField = 'calories' | 'protein' | 'carbs' | 'fat' | 'grams' | 'scale';
/** The ‹ › order of the iOS keyboard bar (`KeyboardBar`). Grams and the Scale
 *  factor sit outside it: they are a different question ("how much") from the
 *  four numbers, and a Next from fat into a weight field would be a surprise.
 *  They get a localized Done only (`useDoneKeyProps`). The Name field above
 *  Calories is the chain's first stop for ‹ (A7) but has no bar of its own —
 *  a text keyboard has a Return key. */
const MACRO_CHAIN = ['calories', 'protein', 'carbs', 'fat'] as const;
type MacroField = (typeof MACRO_CHAIN)[number];
/** One bar PER field — an accessory links to a single input (KeyboardBar.tsx). */
const kbId = (f: MacroField) => `entry-kb-${f}`;

/** How many rows the merged browse list shows. Recents used to cap at 5 and
 *  sat beside three other sections; one ranked list can afford more. */
const BROWSE_ROW_CAP = 12;
/** Rows of the browse list held for My Foods however many recents there are.
 *  Recents fill first and used to take all twelve, so a user who logs a lot
 *  never saw a saved food again without typing its name. */
const MY_FOODS_RESERVED = 4;

/** The "keep open after adding" choice, per device. A habit, not a setting
 *  anyone goes looking for, so it lives where it is used (the browse list)
 *  and is remembered rather than asked each time. */
const KEEP_OPEN_KEY = 'ignia.entry.keepOpen.v1';

/** How long the barcode scanner's own Modal takes to slide away. A library
 *  hit logs at once, but the sheet under the scanner waits this long to close:
 *  dismissing the native sheet while the Modal it presents is still leaving
 *  asks UIKit to tear down both in one tick, and it can refuse one of them. */
const SCANNER_EXIT_MS = 400;

/** The longest the photo-scan door waits for this sheet to finish leaving
 *  before it presents the scan screen anyway (see `openPhotoScan`) — a stuck
 *  dismissal must not swallow the tap. Body's sheet handoff uses the same. */
const PHOTO_SCAN_HANDOFF_MAX_MS = 1200;

/**
 * The browse rows, the chips and the More-ways list (S21): iOS keeps
 * `TouchableOpacity`'s dim exactly as it was; Android gets the Material ink
 * ripple, which is what a Material user reads as "this is a button" — the
 * Impeccable audit found none on these custom rows. The same neutral ink
 * `PressScale` uses, drawn in the foreground so it shows over a filled chip.
 * Not `PressScale` itself: a full-width row that springs smaller reads as
 * the list jumping.
 */
const ROW_RIPPLE = { color: 'rgba(128, 128, 128, 0.22)', foreground: true } as const;
function Tappable(props: React.ComponentProps<typeof TouchableOpacity>) {
  // A button unless the caller says otherwise — every use here passes its
  // own role, and the default keeps an omission from going silent.
  if (Platform.OS !== 'android') return <TouchableOpacity accessibilityRole="button" {...props} />;
  const { activeOpacity: _activeOpacity, style, ...rest } = props;
  return <Pressable accessibilityRole="button" android_ripple={ROW_RIPPLE} style={[style, rippleClip(style)]} {...(rest as PressableProps)} />;
}

/** The food rows' context-menu preview (iOS): width, and the text scale it
 *  grows to — its size is fixed before it renders, so the text is capped at
 *  the same scale the box was sized for (MealEntries' preview, same rule). */
const PREVIEW_WIDTH = 320;
const PREVIEW_MAX_SCALE = 1.3;

/** A refusal the screen reported through its receipt (see `SaveOutcome`). */
function refused(v: unknown): boolean {
  return (v as SaveOutcome | undefined)?.outcome === 'rejected';
}

/**
 * Search-first add-food sheet, presented natively on iOS (a formSheet through
 * the root `sheet` route, `BottomSheet native`) and as the JS sheet elsewhere.
 * Adding opens on a BROWSE view (search + recents + the in-field doors); the
 * manual macro form is a secondary CUSTOM mode (also used when editing).
 * Search portion / recipe / barcode prefill CUSTOM for review. Recents and
 * presets are one-tap relog, with "Edit before logging" in their menus.
 */
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
  const { fontScale } = useWindowDimensions();
  // Typed numbers are read, and prefilled ones written, the way the user's
  // locale writes them (B5): an English `1,250` was 1.25, and a pt-BR form
  // showed `12.5` beside a `1,5×` chip.
  const num = (s: string) => parseDecimal(s, locale);
  const fmt = (n: number) => formatDecimal(n, locale);
  // A slot the sheet was opened FOR — a per-slot "Add to Lunch" row on Today.
  // Read defensively: the field joins `EntryPrefill` with that row.
  const presetSlot = (initialPrefill as (EntryPrefill & { mealType?: MealType }) | null | undefined)?.mealType;
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
  // One per section (B6): a single flag put Quick add AND Recent into remove
  // mode together, from a button that named neither.
  const [manageQuick, setManageQuick] = useState(false);
  const [manageRecent, setManageRecent] = useState(false);
  const [mode, setMode] = useState<'browse' | 'custom' | 'recipe' | 'recipeImport' | 'meal'>('browse');
  // The search as the user left it, handed back to FoodSearch when browse
  // remounts — "back" from reviewing a pick used to land on an empty box.
  const searchSnap = useRef<SearchSnapshot | undefined>(undefined);
  // FoodSearch's own step-back (portion picker → results), for Android back.
  const searchBack = useRef<(() => boolean) | null>(null);
  // …and whether it has one to take, which the native sheet must know up front.
  const [searchCanStep, setSearchCanStep] = useState(false);
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
  const nameRef = useRef<TextInput>(null);
  const proteinRef = useRef<TextInput>(null);
  const carbsRef = useRef<TextInput>(null);
  const fatRef = useRef<TextInput>(null);
  const macroRefs = { calories: calRef, protein: proteinRef, carbs: carbsRef, fat: fatRef };
  // Which numeric field holds the keyboard, so it stays in view while the
  // keyboard shrinks the form (`revealField`). Nothing renders from it.
  const kbFieldRef = useRef<NumField | 'note' | null>(null);
  const kbBarProps = {
    calories: useKeyboardBarProps(kbId('calories')),
    protein: useKeyboardBarProps(kbId('protein')),
    carbs: useKeyboardBarProps(kbId('carbs')),
    fat: useKeyboardBarProps(kbId('fat')),
  };
  const doneKeyProps = useDoneKeyProps();
  const formScrollRef = useRef<ScrollView>(null);
  const formScroll = useRef({ y: 0, h: 0 });
  const fieldBoxes = useRef<Partial<Record<'calories' | 'macros' | 'scale' | 'note', { y: number; height: number }>>>({});
  // Raised by MicButton; rendered full-width under the search row rather than
  // beside the field, which used to collapse it. See MicButton.onFailedChange.
  const [micFailed, setMicFailed] = useState(false);
  /** The collapsed "more ways to log" list. Closed by default — that is the point. */
  const [moreOpen, setMoreOpen] = useState(false);
  /** Dictated text, routed by `routeTranscript` to whichever surface fits. */
  const [searchSeed, setSearchSeed] = useState<string | undefined>(undefined);
  const [voiceSeed, setVoiceSeed] = useState<string | undefined>(undefined);
  const [scannerOpen, setScannerOpen] = useState(false);
  // Bumped by the scanner's "Search by name" (U8) to put the keyboard back up.
  const [searchFocus, setSearchFocus] = useState(0);
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
  // Multi-add (re-score: a 4-item meal cost 8 taps against 6, because every
  // one-tap log closed the sheet). With `keepOpen` on, an add from browse or
  // the review form comes back to the search and `added` keeps the running
  // tally the pinned bar shows; Done (or a swipe) closes. Off by default: one
  // food per visit is still the common case, and it stays two taps.
  const [keepOpen, setKeepOpen] = useState(false);
  const [added, setAdded] = useState({ n: 0, kcal: 0 });
  // The tally's bounce on each add (re-score gap 15): the count-up said the
  // total moved; this says "got it" where the eye already is. No haptic of its
  // own — the screen's `onSave` already plays the add's success.
  const [addedPulse, triggerAddedPulse] = usePulse(1.04);
  // Bumped after a keep-open add, so the search clears for the next food.
  const [searchReset, setSearchReset] = useState(0);
  useEffect(() => {
    let alive = true;
    AsyncStorage.getItem(KEEP_OPEN_KEY)
      .then((v) => {
        if (alive && v === '1') setKeepOpen(true);
      })
      .catch(() => {
        /* Unreadable: the default (close after adding) stands. */
      });
    return () => {
      alive = false;
    };
  }, []);
  function toggleKeepOpen() {
    haptics.selection();
    const next = !keepOpen;
    setKeepOpen(next);
    AsyncStorage.setItem(KEEP_OPEN_KEY, next ? '1' : '0').catch(() => {
      /* Not remembered across launches; this visit still honours it. */
    });
  }

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

  // A dismissal — a swipe, the scrim, back, an add — leaves nothing behind
  // for the next open (S21). The open-reset below clears the search snapshot
  // too, but in an effect: the first render of a reopen still carried the
  // last visit's query into the search's `initial`. And the More-ways list
  // was never reset at all (it is now, below) — the simulator reopened on
  // the old menu, and a new search typed onto the old text ("greek greek
  // yogurtgreek yogurt"). Cleared at close, there is nothing stale to read
  // at open.
  useEffect(() => {
    if (!visible) searchSnap.current = undefined;
  }, [visible]);

  // Reset form + mode whenever the sheet (re)opens.
  useEffect(() => {
    if (!visible) return;
    const opened = {
      label: editing?.mealLabel ?? '',
      calories: editing?.calories != null ? fmt(editing.calories) : '',
      protein: editing?.protein != null ? fmt(editing.protein) : '',
      carbs: editing?.carbs != null ? fmt(editing.carbs) : '',
      fat: editing?.fat != null ? fmt(editing.fat) : '',
    };
    setLabel(opened.label);
    setCalories(opened.calories);
    setProtein(opened.protein);
    setCarbs(opened.carbs);
    setFat(opened.fat);
    // An edit keeps its own slot; an add opened from a slot's row starts on
    // that slot, and counts as picked — the clock does not re-file it.
    const slot = editing ? editing.mealType : presetSlot;
    setMealType(slot);
    setNote(editing?.note ?? '');
    setMealTouched(!editing && presetSlot != null);
    setTimeTouched(false);
    setTimeDraft(null);
    const openedAt = editing?.date ?? (dateKey ? noonOf(dateKey) : new Date());
    setEntryDate(openedAt);
    setRetimeOrigin({ mealType: slot, at: openedAt });
    setBusy(false);
    setManageQuick(false);
    setManageRecent(false);
    setPendingServing(null);
    setMode(editing ? 'custom' : 'browse');
    setMoreOpen(false);
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
    setAdded({ n: 0, kcal: 0 });
    setBaseline(formSig(opened.label, opened.calories, opened.protein, opened.carbs, opened.fat, editing?.note ?? ''));
    // A carried-in draft wins over the empty add form, never over an edit. A
    // prefill that carries only a slot (no numbers) opens the search instead.
    if (!editing && initialPrefill && typeof initialPrefill.calories === 'number') {
      const draft = [
        cleanLogLabel(initialPrefill.mealLabel) ?? '',
        fmt(initialPrefill.calories),
        initialPrefill.protein != null ? fmt(initialPrefill.protein) : '',
        initialPrefill.carbs != null ? fmt(initialPrefill.carbs) : '',
        initialPrefill.fat != null ? fmt(initialPrefill.fat) : '',
      ] as const;
      setLabel(draft[0]);
      setCalories(draft[1]);
      setProtein(draft[2]);
      setCarbs(draft[3]);
      setFat(draft[4]);
      // A draft coming BACK (a refused add) brings its note and its time —
      // the reopen used to drop both and re-stamp the entry "now".
      const draftNote = initialPrefill.note ?? '';
      setNote(draftNote);
      if (initialPrefill.at != null) {
        const at = new Date(initialPrefill.at);
        setEntryDate(at);
        setRetimeOrigin({ mealType: slot, at });
        setTimeTouched(true);
      }
      setBaseline(formSig(...draft, draftNote));
      setMode('custom');
    }
    // `fmt`/`presetSlot` derive from `locale`/`initialPrefill`, both listed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, editing, dateKey, initialPrefill, locale]);

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
    haptics.selection();
    setEntryDate((prev) => {
      const next = new Date(prev);
      next.setDate(next.getDate() + deltaDays);
      return next.getTime() > Date.now() ? prev : next;
    });
  }

  /** The date picker's day (re-score gap 10), the time of day kept and never
   *  in the future (`moveToDay`). */
  function applyEntryDay(day: Date) {
    if (Platform.OS !== 'ios') haptics.selection();
    setEntryDate((prev) => moveToDay(prev, day, new Date()));
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

  /** `ticked`: the change came from the iOS picker, which plays its own
   *  selection tick (`NativeDateField`) — a second one here made every turn of
   *  the wheel buzz twice (re-score bug 3). */
  function applyEntryTime(next: Date, ticked = false) {
    setTimeTouched(true);
    if (next.getTime() === entryDate.getTime()) return;
    // Stepping through values, not pressing a button (D1).
    if (!ticked) haptics.selection();
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

  /**
   * A new pick starts at the time the sheet would have opened with, and on
   * the clock's slot rule again (re-score bug 4): a time set on an abandoned
   * "Write it in" form stamped the next search pick. Not with keep-open on —
   * a multi-add is one meal, and its time carries from food to food on
   * purpose. Adds only: an edit never reaches `prefill`/`openCustomBlank`.
   */
  function resetWhenFor(keep: boolean) {
    if (keep) return;
    const at = dateKey ? noonOf(dateKey) : new Date();
    setEntryDate(at);
    setTimeTouched(false);
    setTimeDraft(null);
    setMealTouched(presetSlot != null);
    setRetimeOrigin({ mealType: presetSlot, at });
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
      // The name is capped where it is shown, not only where it is written:
      // 619 bundled food names run past the rules' 100 (B1), and a field
      // holding more than its `maxLength` cannot be edited down sensibly.
      const draft = [
        cleanLogLabel(src.mealLabel) ?? '',
        formatDecimal(src.calories, locale),
        src.protein != null ? formatDecimal(src.protein, locale) : '',
        src.carbs != null ? formatDecimal(src.carbs, locale) : '',
        src.fat != null ? formatDecimal(src.fat, locale) : '',
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
      setMealType(presetSlot);
      setNote('');
      resetWhenFor(keepOpen);
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
    // `resetWhenFor` reads only `dateKey` and `presetSlot` besides setters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [locale, presetSlot, keepOpen, dateKey],
  );

  /**
   * Write one known entry without the form. Fire-and-forget by design (the
   * sheet has already closed), but never unhandled — and never silent: the
   * write path queues offline, so a rejection here is a real fault, and the
   * user is told with a way to try again (B7). A warning haptic alone reached
   * nobody without haptics on, after the sheet that could have said so was gone.
   */
  function logNow(entry: LogEntry) {
    Promise.resolve(onSave(entry)).catch((e) => reportLateFailure(entry, e, 'entry.quickLog'));
  }

  /** A write that failed after the sheet stopped waiting for it — closed, or
   *  back on the search. Said in a toast with Retry, since the form that could
   *  have said it inline is gone. */
  function reportLateFailure(entry: LogEntry, e: unknown, where: string) {
    haptics.warning();
    captureError(e, { where });
    const label = entry.mealLabel?.trim();
    showToast(label ? t('entry.quickLogFailedNamed', { label }) : t('entry.quickLogFailed'), {
      action: { label: t('common.retry'), onPress: () => logNow(entry) },
      testID: 'toast-quicklog-failed',
    });
  }

  /**
   * An ADD went out (one-tap, the review form, "Add all"). Normally the sheet
   * closes. With keep-open on it comes back to a fresh search instead, and
   * the pinned bar counts what this visit has added; an edit always closes.
   */
  function afterAdd(entries: readonly LogEntry[]) {
    if (!keepOpen || editing) {
      onClose();
      return;
    }
    setAdded((a) => ({ n: a.n + entries.length, kcal: a.kcal + entries.reduce((sum, e) => sum + e.calories, 0) }));
    triggerAddedPulse();
    searchSnap.current = undefined;
    setSearchReset((n) => n + 1);
    setMoreOpen(false);
    setVoiceSeed(undefined);
    setMode('browse');
  }

  /** The pinned bar's Done. */
  function finishAdding() {
    haptics.tap();
    onClose();
  }

  /** One-tap relog: log a known entry (recent / preset / search ⊕ / typed
   *  kcal) and close — or stay, with keep-open on (`afterAdd`). On a past day,
   *  restamp it to that day rather than keeping the source's date; opened from
   *  a slot's row, file it in that slot. `deferClose` holds a close back by
   *  that many ms (see SCANNER_EXIT_MS). */
  function quickLog(entry: LogEntry, deferClose = 0) {
    // Not a success of its own: the screen's `onSave` buzzes success when the
    // row lands, and two successes for one tap read as two logs. The press
    // plays only if that outcome is slow to come (`tapThenOutcome`).
    haptics.tapThenOutcome();
    const out: LogEntry = {
      ...entry,
      mealLabel: cleanLogLabel(entry.mealLabel),
      ...(forDate ? { timestamp: forDate } : {}),
      ...(entry.mealType == null && presetSlot ? { mealType: presetSlot } : {}),
    };
    logNow(out);
    if (deferClose > 0 && (!keepOpen || editing)) {
      setTimeout(onClose, deferClose);
      return;
    }
    afterAdd([out]);
  }

  const calNum = num(calories);
  const proteinNum = num(protein);
  const carbsNum = num(carbs);
  const fatNum = num(fat);
  // The rules' ceilings, said on the field (B1) — a refused write used to be
  // parked as "Saved offline" and dropped at the queue's TTL.
  const kcalTooHigh = kcalOutOfRange(calNum);
  const macrosTooHigh = (
    [
      ['protein', proteinNum],
      ['carbs', carbsNum],
      ['fat', fatNum],
    ] as const
  ).filter(([, v]) => macroOutOfRange(v));
  const outOfRange = kcalTooHigh || macrosTooHigh.length > 0;
  // Zero calories is a real entry once it is named (U7) — black coffee, a
  // diet soda, water with a note. Unnamed, it would be an empty row.
  const named = label.trim().length > 0;
  const canSave = calNum != null && (calNum > 0 || named) && !outOfRange;
  // Why Save is off, for the button's hint (A6) — a disabled button that gave
  // no reason was a dead end to a screen reader and a puzzle to everyone else.
  const saveBlocker = canSave
    ? null
    : outOfRange
      ? t('entry.saveHintRange')
      : calNum === 0
        ? t('entry.saveHintZero')
        : t('entry.saveHintCalories');
  // Calories vs macros, reconciled live. A note, never a gate: partial macro
  // logging is legitimate, and a number typed on purpose must save.
  const macroMiss = macroEnergyMismatch({
    kcal: calNum,
    protein: proteinNum,
    carbs: carbsNum,
    fat: fatNum,
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
      protein: proteinNum,
      carbs: carbsNum,
      fat: fatNum,
      mealLabel: cleanLogLabel(label),
      mealType: slot,
      // Always passed, empty or not: on an edit, absent CLEARS the stored note
      // (`toLogPatch`), which is what emptying the field means.
      note: note.trim() || undefined,
      timestamp: showDateRow || retimed ? at : forDate,
    };
    setFormError(null);
    try {
      // Up to SAVE_WAIT_MS for the write's answer, then on regardless (re-score
      // bug 4): `addEntry` waits up to 8 s on a weak signal, and the button
      // spun for all of it while a one-tap log had long since closed. A fast
      // failure still lands inline below; a late one comes back as a toast
      // with Retry (`reportLateFailure`), and the receipt reports the rest.
      const write = Promise.resolve(onSave(entry));
      const early = await settleWithin(write);
      if (!early.settled) void write.catch((e) => reportLateFailure(entry, e, 'entry.saveLate'));
      else if (refused(early.value)) {
        // Refused inside the wait (re-score bug 2): the form stays, holding
        // what was typed, and says why above Add. The receipt has already
        // played the warning, so no second haptic here.
        setFormError(t('entry.rejected'));
        return;
      }
      afterAdd([entry]);
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
      protein: proteinNum,
      carbs: carbsNum,
      fat: fatNum,
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
    const p = proteinNum;
    const c = carbsNum;
    const f = fatNum;
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
  function openCustomBlank(query = '', ctx?: ServingCtx) {
    haptics.tap();
    const name = cleanLogLabel(query) ?? '';
    setLabel(name);
    setCalories('');
    setProtein('');
    setCarbs('');
    setFat('');
    setMealType(presetSlot);
    setNote('');
    resetWhenFor(keepOpen);
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
    const baseCal = num(base.cal);
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
    setCalories(fmt(nextCal));
    setProtein(scaleField(base.p, f, locale));
    setCarbs(scaleField(base.c, f, locale));
    setFat(scaleField(base.f, f, locale));
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
    haptics.selection();
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
    applyScaleFrom(base, parseFactor(text, locale) ?? 1);
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
    if (raw === '' || parseFactor(raw, locale) != null) return;
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
  function revealField(f: NumField | 'note', animated: boolean) {
    const box =
      fieldBoxes.current[f === 'calories' || f === 'note' ? f : f === 'grams' || f === 'scale' ? 'scale' : 'macros'];
    const { y, h } = formScroll.current;
    if (!box || h <= 0) return;
    const top = box.y - space.sm;
    const bottom = box.y + box.height + space.sm;
    if (top < y) formScrollRef.current?.scrollTo({ y: Math.max(0, top), animated });
    else if (bottom > y + h) formScrollRef.current?.scrollTo({ y: bottom - h, animated });
  }

  function onNumFocus(f: NumField | 'note') {
    kbFieldRef.current = f;
    revealField(f, true);
  }
  function onNumBlur(f: NumField | 'note') {
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
        // ‹ from Calories goes up to Name (A7): it was greyed out with the
        // Name field sitting right above it.
        onPrev={prev ? () => macroRefs[prev].current?.focus() : () => nameRef.current?.focus()}
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
    // Read in the user's locale first; `parseGrams` keeps the range rule.
    const typed = num(text);
    const g = typed != null ? parseGrams(String(typed)) : null;
    if (!basis || g == null) return;
    const next = rescaleFromBasis(basis, g);
    if (!next) return;
    const str = (n: number | undefined, prev: string) => (n != null ? fmt(n) : prev);
    setCalories(fmt(next.calories));
    setProtein((v) => str(next.protein, v));
    setCarbs((v) => str(next.carbs, v));
    setFat((v) => str(next.fat, v));
    setPendingServing((ps) =>
      ps ? { ctx: { ...ps.ctx, grams: Math.round(g * 10) / 10 }, appliedCalories: next.calories } : ps,
    );
  }

  // "Last time · 180 g" (re-score gap 15): the same food logged before at
  // another portion, offered as one tap on the weight it implies. Read from the
  // recents by name — a log row keeps its kcal, not its grams — through the
  // pick's basis (`lastTimeGrams`). Reviewing a weighed pick only, never an edit.
  const lastSame =
    !editing && gramCtx && label.trim()
      ? recentEntries.find((r) => r.mealLabel && normalizeName(r.mealLabel) === normalizeName(label))
      : undefined;
  const usualGrams =
    lastSame && gramCtx?.basis ? lastTimeGrams(gramCtx.basis, lastSame.calories, gramCtx.grams) : null;
  const usual = usualGrams != null && lastSame ? { grams: usualGrams, kcal: lastSame.calories } : null;

  function applyUsual() {
    if (!usual) return;
    haptics.selection();
    onGramsChange(fmt(usual.grams));
    // The field shows the context's own weight again, now the chosen one.
    setGramsDraft(null);
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
  /**
   * Closes this sheet, THEN presents the scan screen (re-score gap 3). Both in
   * one tick asked iOS to present a full-screen modal from a formSheet that
   * was being dismissed — the race SCANNER_EXIT_MS and MENU_DISMISS_MS already
   * paid for. So the navigation waits for the portal to report the last sheet
   * gone, with a ceiling.
   *
   * On BOTH platforms since S21: Android has presented this sheet natively
   * too since `2cee36b7` (`NATIVE_SHEETS`), so it registers with the portal
   * like iOS's and pushing /scan over a sheet still popping off the same
   * stack is the same race. Only a JS sheet (tests, web) is absent from the
   * portal, and then `isAnySheetActive()` is false and it navigates at once.
   */
  function openPhotoScan() {
    haptics.tap();
    setMoreOpen(false);
    const sheetUp = isAnySheetActive();
    onClose();
    if (!sheetUp) {
      router.navigate('/scan');
      return;
    }
    let done = false;
    const go = () => {
      if (done) return;
      done = true;
      off();
      clearTimeout(timer);
      router.navigate('/scan');
    };
    const off = onSheetsIdle(go);
    const timer = setTimeout(go, PHOTO_SCAN_HANDOFF_MAX_MS);
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
    const name = label.trim();
    // The body names what goes (C2), and the way out says it keeps the work —
    // "Cancel" beside "Discard" left it unclear which of the two cancels what.
    confirm({
      title: t('entry.discardConfirm'),
      body: mode === 'custom' && name ? t('entry.discardBodyNamed', { label: name }) : t('entry.discardBody'),
      confirmText: t('entry.discard'),
      cancelText: t('entry.keepEditing'),
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
  // dependency it rebuilt the whole browse list on each one. Written in an
  // effect, not during render — a render-time ref write makes the React
  // Compiler skip the component (Today's `diaryRef`, review #1). The ref is
  // only read from a row's press, which runs after the commit.
  const quickLogRef = useRef(quickLog);
  useEffect(() => {
    quickLogRef.current = quickLog;
  });
  const browseRows = useMemo(() => {
    type Row = {
      key: string;
      name: string;
      kcal: number;
      protein?: number;
      carbs?: number;
      fat?: number;
      tag?: string;
      /** A saved food's portion ("150 g"), for the context-menu preview. */
      serving?: string;
      onLog: () => void;
      /** "Edit before logging" — the same food on the review form, for the
       *  day it was a bigger bowl. */
      onEditFirst: () => void;
      onRemove?: () => void;
      /** What `onRemove` does, as its menu item says it. */
      removeLabel?: string;
    };
    const recentRows: Row[] = [];
    const foodRows: Row[] = [];
    for (const r of recentEntries) {
      recentRows.push({
        key: `recent-${r.id}`,
        name: r.mealLabel ?? '',
        kcal: r.calories,
        protein: r.protein ?? undefined,
        carbs: r.carbs ?? undefined,
        fat: r.fat ?? undefined,
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
        onEditFirst: () =>
          prefill({
            calories: r.calories,
            protein: r.protein ?? undefined,
            carbs: r.carbs ?? undefined,
            fat: r.fat ?? undefined,
            mealLabel: r.mealLabel ?? undefined,
          }),
        onRemove: r.mealLabel && onHideRecent ? () => onHideRecent(r.mealLabel as string) : undefined,
        removeLabel: t('entry.hideRecent'),
      });
    }
    for (const f of customFoods) {
      const m = scaleCustomFood(f, 1);
      foodRows.push({
        key: `customfood-${f.id}`,
        name: f.name,
        kcal: m.calories,
        protein: m.protein,
        carbs: m.carbs,
        fat: m.fat,
        tag: t('entry.myFoods'),
        serving: f.servingUnit === 'g' && f.servingSize ? t('unit.grams', { n: formatNumber(f.servingSize, locale) }) : undefined,
        onLog: () =>
          quickLogRef.current({ calories: m.calories, protein: m.protein, carbs: m.carbs, fat: m.fat, mealLabel: f.name }),
        // On the form with its weight, when it was saved by weight, so the
        // grams field can say "I had 180 g, not 150".
        onEditFirst: () =>
          prefill({
            calories: m.calories,
            protein: m.protein,
            carbs: m.carbs,
            fat: m.fat,
            mealLabel: f.name,
            serving:
              f.servingUnit === 'g'
                ? { grams: f.servingSize, source: f.source, barcode: f.barcode, brand: f.brand, name: f.name }
                : undefined,
          }),
        removeLabel: t('entry.removeMyFood'),
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
  }, [recentEntries, customFoods, onHideRecent, onDeleteCustomFood, prefill, t, locale]);

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

  /**
   * A food's other commands, beyond the one-tap log: "Edit before logging"
   * and its removal. iOS gets them in the system context menu (long-press,
   * the gesture Today's diary rows use), over a preview of the food; every
   * platform gets them as screen-reader actions. On Android a browse row
   * carries a ⋯ that opens the same list as the platform's anchored menu
   * (`MenuButton`, re-score gap 8) — long-press alone went straight to the
   * edit, a command nothing on screen showed; it still does, as a shortcut.
   * Manage mode stays as the visible way to remove.
   */
  function foodCommands(f: {
    name: string;
    kcal?: number;
    protein?: number;
    carbs?: number;
    fat?: number;
    tag?: string;
    serving?: string;
    onLog: () => void;
    onEditFirst: () => void;
    onRemove?: () => void;
    removeLabel?: string;
  }) {
    const menu: ContextMenuAction[] = [
      { key: 'log', title: t('entry.add'), icon: 'plus.circle', onPress: f.onLog },
      { key: 'edit', title: t('entry.editFirst'), icon: 'pencil', onPress: f.onEditFirst },
      ...(f.onRemove && f.removeLabel
        ? [{ key: 'remove', title: f.removeLabel, icon: 'trash', destructive: true, onPress: f.onRemove }]
        : []),
    ];
    const a11y = {
      accessibilityActions: [
        { name: 'editFirst', label: t('entry.editFirst') },
        ...(f.onRemove && f.removeLabel ? [{ name: 'remove', label: f.removeLabel }] : []),
      ],
      onAccessibilityAction: (e: AccessibilityActionEvent) => {
        if (e.nativeEvent.actionName === 'editFirst') f.onEditFirst();
        else if (e.nativeEvent.actionName === 'remove') f.onRemove?.();
      },
    };
    const onLongPress = CONTEXT_MENUS
      ? undefined
      : () => {
          haptics.tap();
          f.onEditFirst();
        };
    const nativeMenu: MenuButtonAction[] = menu.map((a) => ({
      key: a.key,
      title: a.title,
      sfSymbol: a.icon,
      destructive: a.destructive,
      onPress: a.onPress ?? (() => {}),
    }));
    // The preview: the row opened up — every macro, which the row has no room
    // for. Tapping it is "Edit before logging", the menu's own next step.
    const preview =
      f.kcal != null ? (
        <FoodPreview
          name={f.name}
          kcal={f.kcal}
          protein={f.protein}
          carbs={f.carbs}
          fat={f.fat}
          caption={[f.tag, f.serving].filter(Boolean).join(' · ') || undefined}
        />
      ) : undefined;
    const previewSize = {
      width: PREVIEW_WIDTH,
      height: Math.round(176 * Math.min(Math.max(fontScale, 1), PREVIEW_MAX_SCALE)),
    };
    return { menu, nativeMenu, a11y, onLongPress, preview, previewSize };
  }

  const browseEmpty = (
    <View style={styles.browse}>
      {/* Quick add — pinned, one tap, no confirmation. */}
      {presets.length > 0 ? (
        <View style={styles.group}>
          <View style={styles.groupHead}>
            <Text style={styles.groupLabel} accessibilityRole="header" maxFontSizeMultiplier={2.2}>{t('entry.quickAdd')}</Text>
            {onDeletePreset ? (
              <TouchableOpacity
                onPress={() => {
                  haptics.selection();
                  setManageQuick((m) => !m);
                }}
                style={styles.manageBtn}
                hitSlop={{ left: 12, right: 12 }}
                accessibilityRole="button"
                // Named for its section (B6): two buttons both called "Manage".
                accessibilityLabel={manageQuick ? t('entry.manageQuickAddDone') : t('entry.manageQuickAdd')}
                accessibilityState={{ selected: manageQuick }}
                testID="manage-quick-add"
              >
                <Text style={[styles.manageText, manageQuick && styles.manageOn]} maxFontSizeMultiplier={2.2}>
                  {manageQuick ? t('common.done') : t('common.manage')}
                </Text>
              </TouchableOpacity>
            ) : null}
          </View>
          <View style={styles.presetStrip}>
            {presets.map((p) => {
              const entry = { calories: p.calories, protein: p.protein, carbs: p.carbs, fat: p.fat, mealLabel: p.name };
              const remove =
                p.id && onDeletePreset
                  ? () =>
                      confirm({
                        title: t('entry.presetDeleteConfirm'),
                        body: p.name,
                        confirmText: t('common.remove'),
                        destructive: true,
                        onConfirm: () => void onDeletePreset(p.id as string),
                      })
                  : undefined;
              const cmd = foodCommands({
                name: p.name,
                kcal: p.calories,
                protein: p.protein,
                carbs: p.carbs,
                fat: p.fat,
                tag: t('entry.quickAdd'),
                onLog: () => quickLog(entry),
                onEditFirst: () => prefill(entry),
                onRemove: remove,
                removeLabel: t('entry.removePreset'),
              });
              return (
                <ContextMenu
                  key={p.id}
                  title={p.name}
                  actions={cmd.menu}
                  preview={cmd.preview}
                  previewSize={cmd.previewSize}
                  onPreviewPress={() => prefill(entry)}
                >
                  <Tappable
                    style={styles.presetChip}
                    testID={`preset-${p.id}`}
                    accessibilityRole="button"
                    accessibilityLabel={
                      manageQuick
                        ? `${t('common.remove')}: ${p.name}`
                        : [
                            p.name,
                            t('entry.caloriesA11y', { n: formatNumber(p.calories, locale) }),
                            p.protein != null ? t('entry.proteinAmount', { n: formatNumber(p.protein, locale) }) : null,
                          ]
                            .filter(Boolean)
                            .join(', ')
                    }
                    {...(manageQuick ? null : cmd.a11y)}
                    onLongPress={manageQuick ? undefined : cmd.onLongPress}
                    onPress={() => (manageQuick ? remove?.() : quickLog(entry))}
                  >
                    <Text style={styles.presetName} numberOfLines={1} maxFontSizeMultiplier={2.2}>{p.name}</Text>
                    {manageQuick ? (
                      <Ionicons name="close" size={font.tiny + 2} color={colors.onInk} />
                    ) : (
                      // Protein beside kcal: this app tracks the two together, and a
                      // chip that showed one left the user guessing the other.
                      <Text style={styles.presetKcal} numberOfLines={1} maxFontSizeMultiplier={2.2}>
                        {formatNumber(p.calories, locale)} {t('today.kcal')}
                        {p.protein != null ? ` · ${t('entry.proteinAmount', { n: formatNumber(p.protein, locale) })}` : ''}
                      </Text>
                    )}
                  </Tappable>
                </ContextMenu>
              );
            })}
          </View>
        </View>
      ) : null}

      {/* Everything you have logged or saved, most recent first. */}
      {browseRows.length > 0 ? (
        <View style={styles.group}>
          <View style={styles.groupHead}>
            <Text style={styles.groupLabel} accessibilityRole="header" maxFontSizeMultiplier={2.2}>{t('entry.recent')}</Text>
            {onHideRecent || onDeleteCustomFood ? (
              <TouchableOpacity
                onPress={() => {
                  haptics.selection();
                  setManageRecent((m) => !m);
                }}
                style={styles.manageBtn}
                hitSlop={{ left: 12, right: 12 }}
                accessibilityRole="button"
                accessibilityLabel={manageRecent ? t('entry.manageRecentsDone') : t('entry.manageRecents')}
                accessibilityState={{ selected: manageRecent }}
                testID="manage-recents"
              >
                <Text style={[styles.manageText, manageRecent && styles.manageOn]} maxFontSizeMultiplier={2.2}>
                  {manageRecent ? t('common.done') : t('common.manage')}
                </Text>
              </TouchableOpacity>
            ) : null}
          </View>
          {browseRows.map((row) => {
            const cmd = foodCommands(row);
            // A row with nothing to remove (an unnamed recent: hiding is by
            // name) is inert while managing, and looks it — it used to keep its
            // normal look and swallow the tap.
            const inert = manageRecent && !row.onRemove;
            // Android's ⋯ (see `foodCommands`); not while managing, where the
            // row itself is the remove button.
            const withMore = !CONTEXT_MENUS && hasNativeMenuButton && !manageRecent;
            const body = (
            <Tappable
              style={withMore ? styles.rowInner : [styles.row, inert && styles.rowInert]}
              testID={row.key}
              accessibilityRole="button"
              disabled={inert}
              accessibilityState={{ disabled: inert }}
              accessibilityLabel={
                manageRecent && row.onRemove
                  ? `${t('common.remove')}: ${row.name}`
                  : // A bare "101" was all the number said; name the unit —
                    // as a word, since "kcal" is read letter by letter (A5).
                    [
                      row.name,
                      row.tag,
                      t('entry.caloriesA11y', { n: formatNumber(row.kcal, locale) }),
                      row.protein != null ? t('entry.proteinAmount', { n: formatNumber(row.protein, locale) }) : null,
                    ]
                      .filter(Boolean)
                      .join(', ')
              }
              {...(manageRecent ? null : cmd.a11y)}
              onLongPress={manageRecent ? undefined : cmd.onLongPress}
              onPress={() => (manageRecent ? row.onRemove?.() : row.onLog())}
            >
              <Text style={styles.rowName} numberOfLines={1} maxFontSizeMultiplier={2.2}>{row.name}</Text>
              {row.tag ? <Text style={styles.rowTag} maxFontSizeMultiplier={2.2}>{row.tag}</Text> : null}
              {manageRecent && row.onRemove ? (
                <Ionicons name="close" size={font.body} color={colors.danger} />
              ) : (
                <View style={styles.rowNums}>
                  {/* The unit beside the number (V3): "101" alone was a count
                      of nothing in particular. */}
                  <Text style={styles.rowKcal} maxFontSizeMultiplier={2.2}>
                    {formatNumber(row.kcal, locale)} <Text style={styles.rowUnit}>{t('today.kcal')}</Text>
                  </Text>
                  {row.protein != null ? (
                    <Text style={styles.rowProtein} maxFontSizeMultiplier={2.2}>
                      {t('entry.proteinAmount', { n: formatNumber(row.protein, locale) })}
                    </Text>
                  ) : null}
                </View>
              )}
            </Tappable>
            );
            if (withMore) {
              return (
                <View key={row.key} style={styles.rowCard}>
                  {body}
                  <MenuButton
                    style={styles.rowMore}
                    title={row.name}
                    actions={cmd.nativeMenu}
                    accessibilityLabel={t('entry.foodMenuA11y', { name: row.name })}
                    testID={`${row.key}-more`}
                    iconSize={20}
                    iconColor={colors.muted}
                    onFallbackPress={row.onEditFirst}
                  />
                </View>
              );
            }
            return (
            <ContextMenu
              key={row.key}
              title={row.name}
              actions={cmd.menu}
              preview={cmd.preview}
              previewSize={cmd.previewSize}
              onPreviewPress={row.onEditFirst}
            >
              {body}
            </ContextMenu>
            );
          })}
        </View>
      ) : null}

      {browseRows.length === 0 && presets.length === 0 ? (
        <View style={styles.group}>
          <Text style={styles.groupLabel} accessibilityRole="header" maxFontSizeMultiplier={2.2}>{t('entry.suggested')}</Text>
          <View style={styles.starterWrap}>
            {starterFoods(locale).map((f) => (
              <Tappable
                key={f.label}
                style={styles.starterChip}
                testID={`starter-${f.label}`}
                accessibilityRole="button"
                accessibilityLabel={`${f.label}, ${t('entry.caloriesA11y', { n: formatNumber(f.calories, locale) })}`}
                onPress={() => prefill({ calories: f.calories, protein: f.protein, mealLabel: f.label })}
              >
                <Text style={styles.starterLabel} numberOfLines={1} maxFontSizeMultiplier={2.2}>{f.label}</Text>
                <Text style={styles.starterKcal} maxFontSizeMultiplier={2.2}>
                  {formatNumber(f.calories, locale)} {t('today.kcal')}
                </Text>
              </Tappable>
            ))}
          </View>
        </View>
      ) : null}

      {/* Multi-add's switch (see `keepOpen`). At the foot of the list: it is
          a habit set once, not a step in logging. */}
      <TouchableOpacity
        style={styles.keepOpen}
        onPress={toggleKeepOpen}
        accessibilityRole="switch"
        accessibilityState={{ checked: keepOpen }}
        testID="entry-keep-open"
      >
        <Ionicons
          name={keepOpen ? 'checkmark-circle' : 'ellipse-outline'}
          size={font.body + 2}
          color={keepOpen ? colors.teal : colors.muted}
        />
        <Text style={styles.keepOpenText} maxFontSizeMultiplier={2.2}>{t('entry.keepOpen')}</Text>
      </TouchableOpacity>
    </View>
  );

  const moreIcon = (sf: Parameters<typeof Glyph>[0]['sf'], ion: Parameters<typeof Glyph>[0]['ion']) => (
    <Glyph sf={sf} ion={ion} size={20} color={colors.ink} />
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
      <TouchableOpacity
        style={styles.primaryBtn}
        onPress={() => openCustomBlank()}
        accessibilityRole="button"
        accessibilityLabel={t('entry.writeItYourself')}
        testID="open-manual"
      >
        <Glyph sf="plus" ion="add" size={20} color={colors.ink} />
        <Text style={styles.primaryBtnText} maxFontSizeMultiplier={2.2}>{t('entry.writeItYourself')}</Text>
      </TouchableOpacity>
      <TouchableOpacity
        style={styles.primaryBtn}
        onPress={() => { haptics.tap(); setMoreOpen((v) => !v); }}
        accessibilityRole="button"
        accessibilityLabel={t('entry.moreWays')}
        accessibilityState={{ expanded: moreOpen }}
        testID="open-more"
      >
        <Glyph sf={moreOpen ? 'chevron.up' : 'ellipsis'} ion={moreOpen ? 'chevron-up' : 'ellipsis-horizontal'} size={18} color={colors.ink} />
        <Text style={styles.primaryBtnText} maxFontSizeMultiplier={2.2}>{t('entry.moreWays')}</Text>
      </TouchableOpacity>
    </View>
    {moreOpen ? (
      <View style={styles.moreList}>
        {/* Photo scan's second door. Since the + went tap-to-search
            (UX_AUDIT S18-18) the only other way in is a long-press on it,
            which nothing on screen shows. See `photoScanDoor`. */}
        {photoScanDoor ? (
          <Tappable
            style={styles.moreRow}
            onPress={openPhotoScan}
            accessibilityRole="button"
            testID="open-scan"
          >
            {moreIcon('camera', 'camera-outline')}
            <Text style={styles.moreRowText} maxFontSizeMultiplier={2.2}>{t('log.scan')}</Text>
          </Tappable>
        ) : null}
        <Tappable style={styles.moreRow} onPress={() => { haptics.tap(); setMoreOpen(false); setMode('meal'); }} accessibilityRole="button" testID="open-mealtext">
          {moreIcon('text.bubble', 'chatbubble-ellipses-outline')}
          <Text style={styles.moreRowText} maxFontSizeMultiplier={2.2}>{t('entry.describeMeal')}</Text>
        </Tappable>
        {Platform.OS !== 'web' ? (
          <Tappable style={styles.moreRow} onPress={openScanner} accessibilityRole="button" testID="open-barcode">
            {moreIcon('barcode.viewfinder', 'barcode-outline')}
            <Text style={styles.moreRowText} maxFontSizeMultiplier={2.2}>{t('entry.scanBarcode')}</Text>
          </Tappable>
        ) : null}
        <Tappable style={styles.moreRow} onPress={() => { haptics.tap(); setMoreOpen(false); setMode('recipe'); }} accessibilityRole="button" testID="open-recipe">
          {moreIcon('list.bullet.clipboard', 'calculator-outline')}
          <Text style={styles.moreRowText} maxFontSizeMultiplier={2.2}>{t('entry.recipeBuilder')}</Text>
        </Tappable>
        {Platform.OS !== 'web' ? (
          <Tappable style={styles.moreRow} onPress={() => { haptics.tap(); setMoreOpen(false); setMode('recipeImport'); }} accessibilityRole="button" testID="open-recipe-import">
            {moreIcon('link', 'link-outline')}
            <Text style={styles.moreRowText} maxFontSizeMultiplier={2.2}>{t('entry.importRecipe')}</Text>
          </Tappable>
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

  /**
   * A scanned product. One the user saved to My Foods under this barcode is
   * logged straight away (+ → barcode → done, two taps): it is their own
   * number, already reviewed once, and the receipt carries Edit and Undo for
   * the time it is not right. Anything else lands on the review form.
   */
  function onBarcodePick(est: BarcodeEstimate) {
    setScannerOpen(false);
    const code = est.serving?.barcode;
    if (code && customFoods.some((f) => f.barcode === code)) {
      // Logged now; the sheet's own close waits for the scanner to leave
      // (SCANNER_EXIT_MS) — on iOS both dismissing in one tick can strand one.
      quickLog(
        {
          calories: Math.round(est.calories),
          protein: est.protein != null ? round1(est.protein) : undefined,
          carbs: est.carbs != null ? round1(est.carbs) : undefined,
          fat: est.fat != null ? round1(est.fat) : undefined,
          mealLabel: est.mealLabel,
        },
        Platform.OS === 'ios' ? SCANNER_EXIT_MS : 0,
      );
      return;
    }
    openBarcodeReview(est);
  }

  // The form's title says which of its two jobs it is doing (C2): typing an
  // entry from nothing, or checking a pick. Both used to say "Add food", the
  // same as the search view behind it.
  const formTitle = editing
    ? t('entry.editTitle')
    : blankOpen
      ? t('entry.writeItYourself')
      : t('entry.reviewTitle');
  const stackMacros = fontScale > STACK_FONT_SCALE;
  const macroRangeLines = macrosTooHigh.map(([k]) =>
    t('entry.macroTooHigh', {
      macro: t(k === 'protein' ? 'history.protein' : k === 'carbs' ? 'today.carbs' : 'today.fat'),
      max: formatNumber(LOG_MACRO_LIMIT - 1, locale),
    }),
  );

  return (
    <BottomSheet
      native
      // Full height from the first frame (re-score bug 1). The search field
      // takes focus as the sheet opens, and at the default 0.6 detent the
      // keyboard left about 100pt of sheet above it — the title and the field,
      // with the browse list and the live results underneath the keyboard. A
      // full-height iOS 26 sheet is also opaque, so the small muted labels are
      // read against `paper`, not against whatever the glass shows through.
      detents={[1]}
      guarded={dirty}
      // Android back steps out of a sub-screen (the form, a recipe, the
      // search's portion picker) before it closes the sheet — the behaviour
      // the JS sheet always had.
      backSteps={mode !== 'browse' || searchCanStep}
      visible={visible}
      onClose={onClose}
      onRequestClose={requestClose}
      backdropTestID="entry-backdrop"
      // The JS sheet (Android, and anywhere the native one is not used): in
      // dark mode `paper` over the 0.6 black scrim measured 1.05:1, so the
      // panel's edge was a guess. `card` plus a hairline gives it one (V1).
      contentStyle={scheme === 'dark' ? styles.sheetDark : undefined}
    >
            {/* UX_AUDIT F4: this sheet had no title at all. Every other mode
                below announces itself ("Write it in", "Edit entry"); the one
                most people land on opened with a bare search field and left
                them to infer what they were looking at. */}
            {mode === 'browse' ? (
              <>
              <Text ref={modeTitleRef} style={styles.browseTitle} accessibilityRole="header" maxFontSizeMultiplier={1.6}>
                {t('entry.browseTitle')}
              </Text>
              <FoodSearch
                unitSystem={unitSystem}
                seedQuery={searchSeed}
                initial={searchSnap.current}
                onSnapshot={(snap) => {
                  searchSnap.current = snap;
                  // Typing is the answer to "which way?": More ways folds
                  // away so the results own the space above the keyboard.
                  // Open, its five rows sat over the list and left ONE result
                  // visible (S21, simulator). A no-op when it is closed.
                  if (snap.query.trim() !== '') setMoreOpen(false);
                }}
                resetSignal={searchReset}
                backHandlerRef={searchBack}
                onBackStepChange={setSearchCanStep}
                libraryItems={libraryItems}
                // The keyboard comes up with the sheet (U2): typing a food is
                // what most opens are for, and a tap into the field first was
                // a tap spent on nothing. Never over an edit or a carried-in
                // draft — those open on the form, not here.
                autoFocus={visible && !editing}
                focusSignal={searchFocus}
                onQuickLog={(est) =>
                  quickLog({ calories: est.calories, protein: est.protein, carbs: est.carbs, fat: est.fat, mealLabel: est.mealLabel })
                }
                onQuickAdd={(q) => quickLog({ calories: q.calories, protein: q.protein, carbs: q.carbs, fat: q.fat })}
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
              {keepOpen && added.n > 0 ? (
                // The running tally of this visit (multi-add), pinned under
                // the list, with the way out. Each add still gets its own
                // receipt and Undo; this is the total the receipts do not sum.
                <Animated.View style={[styles.addedBar, addedPulse]} testID="entry-added-bar">
                  <View
                    style={styles.addedMain}
                    accessible
                    accessibilityLabel={t('entry.addedBarA11y', {
                      n: formatNumber(added.n, locale),
                      kcal: formatNumber(Math.round(added.kcal), locale),
                    })}
                  >
                    <Text style={styles.addedCount} maxFontSizeMultiplier={1.6} testID="entry-added-count">
                      {t('entry.addedCount', { n: formatNumber(added.n, locale) })}
                    </Text>
                    <View style={styles.addedKcalRow}>
                      <CountUpText value={Math.round(added.kcal)} style={styles.addedKcal} testID="entry-added-kcal" />
                      <Text style={styles.addedUnit} maxFontSizeMultiplier={1.6}> {t('today.kcal')}</Text>
                    </View>
                  </View>
                  <TouchableOpacity
                    style={styles.addedDone}
                    onPress={finishAdding}
                    accessibilityRole="button"
                    testID="entry-added-done"
                  >
                    <Text style={styles.addedDoneText} maxFontSizeMultiplier={1.6}>{t('common.done')}</Text>
                  </TouchableOpacity>
                </Animated.View>
              ) : null}
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
                  // The same bounded wait as the form's Add (bug 4). A failure
                  // inside it propagates to MealText as it always did; a later
                  // one is a toast.
                  const write = (async () => {
                    if (onSaveMany) await onSaveMany(entries);
                    else for (const entry of entries) await onSave(entry);
                  })();
                  const early = await settleWithin(write);
                  if (!early.settled) {
                    void write.catch((e) =>
                      reportLateFailure({ calories: entries.reduce((sum, x) => sum + x.calories, 0) }, e, 'entry.addManyLate'),
                    );
                  }
                  afterAdd(entries);
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
                  <Text ref={modeTitleRef} style={styles.title} accessibilityRole="header" maxFontSizeMultiplier={1.6} numberOfLines={2}>
                    {formTitle}
                  </Text>
                  <View style={styles.backSpacer} />
                </View>

                {/* Scrolls so the fields can never push Save/Delete out of the
                    sheet when the keyboard is up — the actions row below stays
                    pinned and reachable. `revealField` keeps the focused
                    number in view; KeyboardAwareScrollView was weighed for it
                    (F3) and left out, because it pads for the keyboard itself
                    and the native sheet's container already does — two
                    paddings for one keyboard. */}
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
                      ref={nameRef}
                      placeholder={t('entry.namePlaceholder')}
                      value={label}
                      onChangeText={setLabel}
                      accessibilityLabel={t('entry.name')}
                      // The rules' own cap (B1). Typing stops at it; a longer
                      // pick or query is cut to it on the way in.
                      maxLength={LOG_LABEL_MAX}
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
                      // `decimal`, not `numeric`: Android's numeric keypad can
                      // drop the comma a pt-BR user types (B10).
                      inputMode="decimal"
                      value={calories}
                      onChangeText={setCalories}
                      accessibilityLabel={t('entry.calories')}
                      returnKeyType="next"
                      submitBehavior="submit"
                      onSubmitEditing={() => proteinRef.current?.focus()}
                      {...kbBarProps.calories}
                      onFocus={() => onNumFocus('calories')}
                      onBlur={() => onNumBlur('calories')}
                      style={[styles.input, kcalTooHigh && styles.inputInvalid]}
                      testID="entry-calories"
                    />
                    {macroBar('calories')}
                    {kcalTooHigh ? (
                      <Text style={styles.fieldError} accessibilityRole="alert" accessibilityLiveRegion="polite" testID="entry-kcal-error">
                        {t('entry.kcalTooHigh', { max: formatNumber(LOG_KCAL_LIMIT - 1, locale) })}
                      </Text>
                    ) : null}
                  </Field>

                  <View
                    style={[styles.row3, stackMacros && styles.row3Stacked]}
                    onLayout={(e) => (fieldBoxes.current.macros = e.nativeEvent.layout)}
                  >
                    {(
                      [
                        ['protein', t('entry.proteinG'), protein, setProtein, proteinRef],
                        ['carbs', t('entry.carbsG'), carbs, setCarbs, carbsRef],
                        ['fat', t('entry.fatG'), fat, setFat, fatRef],
                      ] as const
                    ).map(([f, caption, value, setValue, ref]) => {
                      const next = MACRO_CHAIN[MACRO_CHAIN.indexOf(f) + 1];
                      const invalid = macrosTooHigh.some(([k]) => k === f);
                      return (
                        <Field key={f} label={caption} style={stackMacros ? undefined : styles.third} labelled>
                          <TextInputBase
                            ref={ref}
                            placeholder="0"
                            inputMode="decimal"
                            value={value}
                            onChangeText={setValue}
                            accessibilityLabel={caption}
                            returnKeyType={next ? 'next' : 'done'}
                            {...(next
                              ? { submitBehavior: 'submit' as const, onSubmitEditing: () => macroRefs[next].current?.focus() }
                              : {})}
                            {...kbBarProps[f]}
                            onFocus={() => onNumFocus(f)}
                            onBlur={() => onNumBlur(f)}
                            style={[styles.input, invalid && styles.inputInvalid]}
                            testID={`entry-${f}`}
                          />
                          {macroBar(f)}
                        </Field>
                      );
                    })}
                  </View>
                  {macroRangeLines.length ? (
                    <Text style={styles.fieldError} accessibilityRole="alert" accessibilityLiveRegion="polite" testID="entry-macro-error">
                      {macroRangeLines.join('\n')}
                    </Text>
                  ) : null}
                  {/* `|| gramCtx`: typing a tiny weight can round kcal to 0, and
                      the row (with the field being typed in) must not vanish. */}
                  {(calNum != null && calNum > 0) || gramCtx ? (
                    <View style={styles.scaleRow} onLayout={(e) => (fieldBoxes.current.scale = e.nativeEvent.layout)}>
                      <Text style={styles.fieldLabel} maxFontSizeMultiplier={2.2}>{t('entry.scale')}</Text>
                      {SCALE_STEPS.map((st) => (
                        <Tappable
                          key={st.f}
                          style={styles.scaleChip}
                          onPress={() => scaleForm(st.f)}
                          accessibilityRole="button"
                          accessibilityLabel={t('entry.scaleBy', { n: formatNumber(st.f, locale) })}
                          testID={`entry-scale-${st.f}`}
                        >
                          <Text style={styles.scaleChipText} maxFontSizeMultiplier={2.2}>
                            {st.f === 0.5 ? '½' : formatNumber(st.f, locale)}×
                          </Text>
                        </Tappable>
                      ))}
                      {scaleDraft != null ? (
                        <SheetTextInput
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
                        <Tappable
                          style={styles.scaleChip}
                          onPress={openScaleDraft}
                          accessibilityRole="button"
                          accessibilityLabel={t('entry.scaleTypeA11y')}
                          testID="entry-scale-other"
                        >
                          <Text style={styles.scaleChipText} maxFontSizeMultiplier={2.2}>{t('entry.scaleOther')}</Text>
                        </Tappable>
                      )}
                      {/* Edit in grams — only when the pick came with a weight
                          and the numbers still describe it (`gramCtx`). The
                          field rescales as you type; see `onGramsChange`. */}
                      {gramCtx ? (
                        <View style={styles.gramsBox}>
                          <SheetTextInput
                            style={[styles.scaleChip, styles.scaleInput, styles.gramsInput]}
                            value={gramsDraft ?? fmt(gramCtx.grams ?? 0)}
                            onChangeText={onGramsChange}
                            {...doneKeyProps}
                            onFocus={() => {
                              setGramsDraft(fmt(gramCtx.grams ?? 0));
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
                      {usual ? (
                        <Tappable
                          style={styles.scaleChip}
                          onPress={applyUsual}
                          accessibilityRole="button"
                          accessibilityLabel={t('entry.usualPortionA11y', {
                            g: formatNumber(usual.grams, locale),
                            kcal: formatNumber(usual.kcal, locale),
                          })}
                          testID="entry-usual-portion"
                        >
                          <Text style={styles.scaleChipText} maxFontSizeMultiplier={2.2}>
                            {t('entry.usualPortion', { g: formatNumber(usual.grams, locale) })}
                          </Text>
                        </Tappable>
                      ) : null}
                    </View>
                  ) : null}
                  {macroMiss ? (
                    // Information, not an error (V2): the line says "you can
                    // still save", and red said the opposite.
                    <View style={styles.macroNoteRow}>
                      <Ionicons name="information-circle-outline" size={16} color={colors.muted} />
                      <Text style={styles.macroNote} testID="entry-macro-note" maxFontSizeMultiplier={2.2}>
                        {t('entry.macroMismatch', {
                          kcal: formatNumber(macroMiss.estimateKcal, locale),
                          entered: formatNumber(calNum ?? 0, locale),
                        })}
                      </Text>
                    </View>
                  ) : null}

                  <Field label={t('entry.meal')}>
                    <MealSlotChips
                      value={mealType}
                      onChange={(next) => {
                        setMealTouched(true);
                        setMealType(next);
                      }}
                    />
                  </Field>

                  {showDateRow ? (
                    <Field label={t('entry.date')}>
                      <View style={[styles.dateRow, fontScale > STACK_FONT_SCALE && styles.dateRowWrap]}>
                        <TouchableOpacity style={styles.dateStep} onPress={() => shiftEntryDate(-1)} hitSlop={2} accessibilityRole="button" accessibilityLabel={t('entry.datePrevA11y')} testID="entry-date-prev">
                          <Text style={styles.dateStepText} maxFontSizeMultiplier={1.6}>−</Text>
                        </TouchableOpacity>
                        {/* The system date picker where the binary has one (re-score
                            gap 10) — a day last week is one pick, not seven
                            taps — with ±1 either side for the common
                            yesterday, as the weigh-in day does. */}
                        {hasNativeDateField ? (
                          <NativeDateField
                            mode="date"
                            value={entryDate}
                            onChange={applyEntryDay}
                            maximumDate={new Date()}
                            accessibilityLabel={t('entry.date')}
                            testID="entry-date-native"
                            style={styles.dateNative}
                          />
                        ) : (
                          <Text style={styles.dateLabel} testID="entry-date" maxFontSizeMultiplier={2.2}>
                            {formatDate(entryDate, locale, { weekday: 'short', month: 'short', day: 'numeric' })}
                          </Text>
                        )}
                        <TouchableOpacity
                          style={[styles.dateStep, isSameDay(entryDate, new Date()) && styles.dateStepDisabled]}
                          onPress={() => shiftEntryDate(1)}
                          disabled={isSameDay(entryDate, new Date())}
                          hitSlop={2}
                          accessibilityRole="button"
                          accessibilityLabel={t('entry.dateNextA11y')}
                          accessibilityState={{ disabled: isSameDay(entryDate, new Date()) }}
                          testID="entry-date-next"
                        >
                          <Text style={styles.dateStepText} maxFontSizeMultiplier={1.6}>+</Text>
                        </TouchableOpacity>
                      </View>
                    </Field>
                  ) : null}

                  <Field label={t('entry.time')}>
                    <TimeOfDayRow
                      at={entryDate}
                      draft={timeDraft}
                      onDraftChange={setTimeDraft}
                      onStep={shiftEntryTime}
                      onCommit={commitTypedTime}
                      onSet={(next) => applyEntryTime(next, Platform.OS === 'ios')}
                    />
                  </Field>

                  {/* The last field in the form, so the one the keyboard
                      covers first: it rides `revealField` like the numbers
                      (Android QA, UX_AUDIT S22 — "Check and add" left it
                      under the keyboard). */}
                  <Field label={t('entry.note')} labelled onLayout={(e) => (fieldBoxes.current.note = e.nativeEvent.layout)}>
                    <TextInputBase
                      style={[styles.input, styles.noteInput]}
                      accessibilityLabel={t('entry.note')}
                      placeholder={t('entry.notePlaceholder')}
                      value={note}
                      onChangeText={setNote}
                      onFocus={() => onNumFocus('note')}
                      onBlur={() => onNumBlur('note')}
                      multiline
                      maxLength={LOG_NOTE_MAX}
                      testID="entry-note"
                    />
                  </Field>

                  {canSavePreset ? (
                    <TouchableOpacity
                      style={[styles.savePreset, libBusy != null && libSaved.preset !== currentSig && styles.savePresetBusy]}
                      onPress={saveAsPreset}
                      disabled={libBusy != null || libSaved.preset === currentSig}
                      accessibilityRole="button"
                      accessibilityState={{ disabled: libBusy != null || libSaved.preset === currentSig, busy: libBusy === 'preset' }}
                      testID="save-preset"
                    >
                      {/* The saved state is a check at full strength (B8) — at
                          0.7 opacity the light theme's teal fell to 2.99:1.
                          The flash is Quick add's glyph wherever it appears
                          (the diary row's menu draws the same one). */}
                      <Ionicons
                        name={libSaved.preset === currentSig ? 'checkmark-circle' : 'flash-outline'}
                        size={font.small + 2}
                        color={colors.teal}
                      />
                      <Text style={styles.savePresetText} maxFontSizeMultiplier={2.2}>
                        {libSaved.preset === currentSig ? t('entry.presetSaved') : t('entry.savePreset')}
                      </Text>
                    </TouchableOpacity>
                  ) : null}

                  {canSaveCustomFood ? (
                    <TouchableOpacity
                      style={[styles.savePreset, libBusy != null && libSaved.food !== currentSig && styles.savePresetBusy]}
                      onPress={saveAsCustomFood}
                      disabled={libBusy != null || libSaved.food === currentSig}
                      accessibilityRole="button"
                      accessibilityState={{ disabled: libBusy != null || libSaved.food === currentSig, busy: libBusy === 'food' }}
                      testID="save-customfood"
                    >
                      <Ionicons
                        name={libSaved.food === currentSig ? 'checkmark-circle' : 'add'}
                        size={font.small + 2}
                        color={colors.teal}
                      />
                      <Text style={styles.savePresetText} maxFontSizeMultiplier={2.2}>
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
                      <Text style={styles.deleteText} maxFontSizeMultiplier={1.6}>{t('entry.delete')}</Text>
                    </TouchableOpacity>
                  ) : null}
                  <TouchableOpacity
                    style={[styles.save, !canSave && styles.saveDisabled]}
                    onPress={save}
                    disabled={!canSave || busy}
                    accessibilityRole="button"
                    accessibilityState={{ disabled: !canSave || busy, busy }}
                    accessibilityHint={saveBlocker ?? undefined}
                    testID="entry-save"
                  >
                    {busy ? (
                      <ActivityIndicator color={colors.onInk} testID="entry-save-busy" />
                    ) : (
                      <Text style={styles.saveText} maxFontSizeMultiplier={1.6}>{editing ? t('common.save') : t('entry.add')}</Text>
                    )}
                  </TouchableOpacity>
                </View>
                {/* Zero calories is the one rule nobody can guess (U7), so it
                    is the one reason drawn as well as spoken. */}
                {!canSave && calNum === 0 && !outOfRange ? (
                  <Text style={styles.saveHint} testID="entry-save-hint" maxFontSizeMultiplier={2.2}>
                    {saveBlocker}
                  </Text>
                ) : null}
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
          onPick={onBarcodePick}
          // The scan worked; the database simply lacks the product. The label
          // in the user's hand has every number the form needs, and the
          // barcode rides into the form so "Save to My Foods" stores it under
          // that code (`customFoodDocId`) and the next scan of it is a hit.
          onEnterFromLabel={(code) => {
            setScannerOpen(false);
            openCustomBlank('', { source: 'barcode', barcode: code });
          }}
          // …or the product is in the database under its name (U8): back to
          // the search, keyboard up.
          onSearchByName={() => {
            setScannerOpen(false);
            setMode('browse');
            setSearchFocus((n) => n + 1);
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
    <SheetTextInput
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

/**
 * A browse food's context-menu preview (iOS, re-score gap 11): the row opened
 * up — the full name, the calories large and all three macros, which the row
 * has room only for protein of. Where it came from (Recent, My Foods, Quick
 * add) and a saved food's portion ride above the name.
 */
function FoodPreview({
  name,
  kcal,
  protein,
  carbs,
  fat,
  caption,
}: {
  name: string;
  kcal: number;
  protein?: number;
  carbs?: number;
  fat?: number;
  caption?: string;
}) {
  const t = useT();
  const locale = useLocale();
  const styles = useThemedStyles(createStyles);
  const macros = [
    { key: 'p', label: t('history.protein'), value: protein },
    { key: 'c', label: t('today.carbs'), value: carbs },
    { key: 'f', label: t('today.fat'), value: fat },
  ];
  return (
    <View style={styles.preview} testID="entry-food-preview">
      {caption ? (
        <Text style={styles.previewCaption} numberOfLines={1} maxFontSizeMultiplier={PREVIEW_MAX_SCALE}>
          {caption}
        </Text>
      ) : null}
      <Text style={styles.previewLabel} numberOfLines={2} maxFontSizeMultiplier={PREVIEW_MAX_SCALE}>
        {name}
      </Text>
      <Text style={styles.previewKcal} maxFontSizeMultiplier={PREVIEW_MAX_SCALE}>
        {formatNumber(kcal, locale)}
        <Text style={styles.previewUnit}> {t('today.kcal')}</Text>
      </Text>
      <View style={styles.previewMacros}>
        {macros.map((m) => (
          <View key={m.key} style={styles.previewMacro}>
            <Text style={styles.previewMacroValue} maxFontSizeMultiplier={PREVIEW_MAX_SCALE}>
              {m.value != null ? t('unit.grams', { n: formatNumber(m.value, locale) }) : '—'}
            </Text>
            <Text style={styles.previewMacroLabel} maxFontSizeMultiplier={PREVIEW_MAX_SCALE}>{m.label}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const createStyles = ({ scheme, colors, shadow }: Theme) => StyleSheet.create({
  fill: { flex: 1 },
  // The JS sheet's panel in dark mode (V1) — see the `contentStyle` above.
  sheetDark: { backgroundColor: colors.card, borderTopWidth: StyleSheet.hairlineWidth, borderColor: colors.lineStrong },
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
    // `card` on `paper` is 1.06–1.09:1 — the rows ran together (V3). A
    // `lineStrong` hairline gives each one an edge.
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.lineStrong,
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
  // TARGET tall (was ~33): a one-tap log is the last control to make small.
  presetChip: { flexDirection: 'row', alignItems: 'center', gap: space.xs, paddingVertical: space.sm, paddingHorizontal: space.md, minHeight: TARGET, maxWidth: '100%', borderRadius: radius.pill, backgroundColor: colors.ink },
  // No fixed `maxWidth` (A1): 150pt cut a name to "Chi…" at a large text
  // size. The chip caps at the row, and the name gives way to the numbers.
  // The NAME keeps its room and the numbers give way: in Spanish ("g de
  // proteína") the macro line was long enough to cut the meal's own name to
  // "Chicken + rice (meal pr…" (Maestro 09). Capped so a very long name still
  // leaves the kcal visible.
  presetName: { fontSize: font.small, fontWeight: '600', color: colors.onInk, flexShrink: 0, maxWidth: '72%' },
  presetKcal: { fontSize: font.tiny, color: colors.onInk, opacity: 0.7, flexShrink: 1 },
  rowTag: { fontSize: font.tiny, color: colors.muted, marginRight: space.sm },
  rowName: { fontSize: font.body, color: colors.ink, fontWeight: '600', flex: 1, marginRight: space.md },
  rowKcal: { fontSize: font.body, color: colors.muted, fontWeight: '700' },
  rowUnit: { fontSize: font.tiny, fontWeight: '600' },
  rowNums: { alignItems: 'flex-end' },
  rowProtein: { fontSize: font.tiny, color: colors.muted },
  rowRemove: { fontSize: font.body, color: colors.danger, fontWeight: '700' },
  // Manage mode, a row with nothing to remove (see `inert`).
  rowInert: { opacity: 0.4 },
  // Android's row with a ⋯ (gap 8): the card is the wrapper, so the tap
  // target and the menu button share one edge; `row`'s look, split in two.
  rowCard: {
    flexDirection: 'row',
    alignItems: 'stretch',
    backgroundColor: colors.card,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.lineStrong,
    minHeight: 48,
    overflow: 'hidden',
  },
  rowInner: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingLeft: space.lg,
    paddingVertical: space.md,
    minHeight: 48,
  },
  rowMore: { width: 48, minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  // The context-menu preview (iOS) — MealEntries' EntryPreview, for a food.
  preview: { flex: 1, backgroundColor: colors.paper, padding: space.xl, gap: space.xs },
  previewCaption: { fontSize: font.small, color: colors.muted, fontWeight: '600' },
  previewLabel: { fontSize: font.h3, fontWeight: '800', color: colors.ink },
  previewKcal: { fontSize: font.h1, fontWeight: '800', color: colors.ink, marginTop: space.xs },
  previewUnit: { fontSize: font.body, fontWeight: '600', color: colors.muted },
  previewMacros: { flexDirection: 'row', gap: space.lg, marginTop: space.sm },
  previewMacro: { gap: 2 },
  previewMacroValue: { fontSize: font.body, fontWeight: '700', color: colors.ink },
  previewMacroLabel: { fontSize: font.small, color: colors.muted },
  keepOpen: { flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: 48, alignSelf: 'flex-start' },
  keepOpenText: { fontSize: font.small, color: colors.ink, fontWeight: '600' },
  // The multi-add tally: the form's Save colours, so Done reads as the way out.
  addedBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    marginTop: space.sm,
    paddingVertical: space.sm,
    paddingLeft: space.lg,
    paddingRight: space.sm,
    borderRadius: radius.md,
    backgroundColor: colors.ink,
  },
  addedMain: { flex: 1 },
  addedCount: { fontSize: font.small, color: colors.onInk, fontWeight: '700' },
  addedKcalRow: { flexDirection: 'row', alignItems: 'baseline' },
  addedKcal: { fontSize: font.h3, color: colors.onInk, fontWeight: '800', padding: 0 },
  addedUnit: { fontSize: font.small, color: colors.onInk, opacity: 0.8 },
  addedDone: { minHeight: 48, minWidth: 72, justifyContent: 'center', alignItems: 'center', paddingHorizontal: space.lg, borderRadius: radius.md, backgroundColor: colors.paper },
  addedDoneText: { fontSize: font.body, color: colors.ink, fontWeight: '700' },
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
    minHeight: TARGET,
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
  camDeniedBtn: { alignSelf: 'flex-start', minHeight: TARGET, justifyContent: 'center' },
  camDeniedLink: { fontSize: font.tiny, color: colors.ink, fontWeight: '700', textDecorationLine: 'underline' },
  // custom
  customWrap: { flexShrink: 1 },
  customHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: space.sm },
  // 44 square: a 22pt chevron with 8 of slop was a 38pt target.
  backBtn: { width: 48, height: 48, alignItems: 'flex-start', justifyContent: 'center' },
  backSpacer: { width: 48 },
  title: { flexShrink: 1, textAlign: 'center', fontSize: font.h2, fontWeight: '800', color: colors.ink },
  formScroll: { flexShrink: 1 },
  form: { gap: space.md, paddingBottom: space.md },
  row3: { flexDirection: 'row', gap: space.sm },
  // Past STACK_FONT_SCALE: one field per line, full width (A1).
  row3Stacked: { flexDirection: 'column', gap: space.md },
  third: { flex: 1 },
  // Muted with an info glyph, not danger red (V2): it says "you can still save".
  macroNoteRow: { flexDirection: 'row', alignItems: 'flex-start', gap: space.xs, marginTop: -space.xs, marginBottom: space.sm },
  macroNote: { flex: 1, color: colors.muted, fontSize: font.small },
  // A number past the rules' ceiling (B1): the field's edge and a line under it.
  inputInvalid: { borderColor: colors.danger, borderWidth: 2 },
  fieldError: { color: colors.danger, fontSize: font.small },
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
  savePreset: { alignSelf: 'flex-start', minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: space.xs },
  // While a library write is in flight only — the SAVED state stays at full
  // strength (B8).
  savePresetBusy: { opacity: 0.7 },
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
  // A large text size lets the day wrap under its steppers instead of
  // squeezing them (A1).
  dateRowWrap: { flexWrap: 'wrap' },
  // 44 + the 2dp hitSlop on each = 48.
  dateStep: { width: TARGET, height: TARGET, borderRadius: radius.md, borderWidth: 1, borderColor: colors.lineStrong, alignItems: 'center', justifyContent: 'center' },
  dateStepDisabled: { opacity: 0.4 },
  dateStepText: { fontSize: font.h3, color: colors.ink, fontWeight: '700' },
  dateLabel: { flex: 1, textAlign: 'center', fontSize: font.body, color: colors.ink, fontWeight: '700' },
  // The native date pill between the steppers, centred where the label was.
  dateNative: { flex: 1 },
  noteInput: { minHeight: 72, paddingTop: space.sm, paddingBottom: space.sm, textAlignVertical: 'top' },
  actions: { flexDirection: 'row', gap: space.md, paddingTop: space.md, alignItems: 'center' },
  delete: { minHeight: 48, justifyContent: 'center', paddingHorizontal: space.lg, paddingVertical: space.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.danger },
  deleteText: { color: colors.danger, fontWeight: '700', fontSize: font.body },
  // `minHeight` so the busy spinner (A6) does not shrink the button under the thumb.
  save: { flex: 1, minHeight: 56, backgroundColor: colors.ink, borderRadius: radius.md, paddingVertical: space.lg, alignItems: 'center', justifyContent: 'center' },
  saveDisabled: { opacity: 0.4 },
  saveText: { color: colors.onInk, fontWeight: '700', fontSize: font.h3 },
  saveHint: { color: colors.muted, fontSize: font.small, textAlign: 'center', paddingTop: space.xs },
});
