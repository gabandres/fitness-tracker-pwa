import Ionicons from '@expo/vector-icons/Ionicons';
import {
  type MutableRefObject, type ReactNode, startTransition, useDeferredValue, useEffect, useMemo, useRef, useState,
} from 'react';
import {
  AccessibilityInfo,
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SheetTextInput } from '@/components/SheetTextInput';
import type { FoodSource } from '@macrolog/core';
import { queryNamesRestaurantChain, trustForDataType } from '@macrolog/core';
import {
  type FoodSearchHit,
  type ServingOption,
  getFoodDetail,
  searchFoods,
  sortServings,
  warmFoodIndex,
} from '@/lib/foodSearch';
import type { GramBasis } from '@/lib/grams-rescale';
import { Glyph } from '@/components/Glyph';
import { useDoneKeyProps } from '@/components/KeyboardBar';
import { matchLibrary } from '@/lib/libraryMatch';
import { announce } from '@/lib/a11y';
import { isOffline } from '@/lib/connectivity';
import { formatDecimal, parseDecimal, parseQuickAddQuery, type QuickAddQuery } from '@/lib/entry-input';
import { useA11yFocus } from '@/lib/use-a11y-focus';
import { useDeferredFocus } from '@/lib/use-deferred-focus';
import { type I18nKey, type Locale, useLocale, useT } from '@/i18n';
import { formatNumber } from '@/lib/date-format';
import * as haptics from '@/lib/haptics';
import { useTheme, useThemedStyles, type Theme } from '@/lib/theme-context';
import { font, radius, space } from '@/theme';

/** What the user picked — prefills the manual entry form. */
export interface FoodEstimate {
  calories: number;
  protein?: number;
  carbs?: number;
  fat?: number;
  mealLabel: string;
  /** Grams-first save context (ADR-0013). Search results resolve as
   *  `source:'text'` with the picked portion's gram weight — no barcode (the
   *  barcode path is the scanner), so a saved search food auto-ids. */
  serving?: {
    grams?: number;
    source: FoodSource;
    barcode?: string;
    brand?: string;
    name?: string;
    /** The picked portion UNSCALED (before the quantity multiplier and before
     *  rounding), so the review form's grams field can rescale from the food
     *  itself rather than from rounded numbers (`lib/grams-rescale.ts`). */
    basis?: GramBasis;
  };
}

/** One of the user's own foods (My Foods or a recent entry), offered above the
 *  database results when its name matches the query. `onPick` is the same
 *  one-tap log the browse row runs — finding it by typing must not be a
 *  different action from finding it by scrolling. */
export interface LibraryItem {
  key: string;
  name: string;
  kcal: number;
  protein?: number;
  /** "My Foods" / "Recent" — provenance, shown on the row. */
  tag: string;
  onPick: () => void;
}

/** The part of a search worth restoring when the user comes back to it. */
export interface SearchSnapshot {
  query: string;
  hits: FoodSearchHit[];
}

interface Props {
  unitSystem?: 'us' | 'metric';
  onPick: (estimate: FoodEstimate) => void;
  /** Optional explicit "Cancel" affordance. Omit when the search panel is
   *  the sheet's root (the sheet's own drag-to-dismiss replaces it). */
  onCancel?: () => void;
  /** Rendered to the right of the search field — e.g. scan / recipe icons. */
  headerRight?: ReactNode;
  /** Rendered INSIDE the search row, beside the keyboard-driven input — the
   *  mic is a peer of typing, not a sixth way to log. */
  micSlot?: ReactNode;
  /** Rendered BELOW the search row, full width — the mic's failure message.
   *  It lives here rather than inside the row because an in-row sibling
   *  collapsed the field by 34% and truncated itself (2026-09-22). */
  micMessage?: ReactNode;
  /** Text dictated into the mic that resolved to a plain food search. */
  seedQuery?: string;
  /** Rendered below the search field when the query is empty (idle), instead
   *  of the "type 2 characters" hint — used to host recents / quick-add. */
  emptyContent?: ReactNode;
  /** Offered when a search returns nothing, with the text the user typed.
   *  A miss is the strongest signal someone wants to write the food
   *  themselves — and their name for it is already in the box, so making
   *  them clear the query and retype it is pure loss. */
  onCreateFromQuery?: (query: string) => void;
  /** Offered beside `onCreateFromQuery` on a miss: a packaged food the index
   *  does not know usually has a barcode on it, and that is fewer keystrokes
   *  than typing its label. */
  onScanBarcode?: () => void;
  /** Photo scan ("Scan meal"), offered as a camera button in the empty search
   *  field beside the barcode one. Omit to hide it (flag off, past day). */
  onScanMeal?: () => void;
  /** The user's own foods, matched locally and ranked above the database. */
  libraryItems?: LibraryItem[];
  /**
   * Restored ONCE, at mount. The sheet unmounts this component when the user
   * moves on to review a pick, so without it "back" from the review form
   * landed on an empty box and the query had to be typed again.
   */
  initial?: SearchSnapshot;
  /** Hears every query/results change, so the owner can hand it back in `initial`. */
  onSnapshot?: (snapshot: SearchSnapshot) => void;
  /** Set to a function the owner calls on Android back: it steps the portion
   *  picker back to the results and returns true, or returns false when there
   *  is nothing inside this component to step back from. */
  backHandlerRef?: MutableRefObject<(() => boolean) | null>;
  /**
   * Put the keyboard up on open (U2), deferred past the sheet's own entrance
   * like the blank form's Calories field (`use-deferred-focus` says why not
   * `autoFocus`). Only when the box opens empty: a search restored on the way
   * back from a review has results to look at, and a keyboard over them is in
   * the way.
   */
  autoFocus?: boolean;
  /** Bump to focus the field again — "Search by name" from a barcode miss. */
  focusSignal?: number;
  /** Bump to empty the box (and keep the keyboard): the sheet stayed open
   *  after an add (multi-add), and the next food starts from nothing. A typed
   *  "350" left in the box would be one Return from logging twice. */
  resetSignal?: number;
  /**
   * The ⊕ on a result row (U3): log the hit's default portion in one tap,
   * skipping the portion step and the review form. The receipt that follows
   * carries Edit and Undo, which is the review for the minority who need it.
   * Omit to hide the button.
   */
  onQuickLog?: (estimate: FoodEstimate) => void;
  /**
   * A number-only query ("350", "350 40p") offered as "Log 350 kcal" above the
   * results (U4), and logged by Return. Omit to search numbers as text only.
   */
  onQuickAdd?: (entry: QuickAddQuery) => void;
}

type Phase = 'idle' | 'searching' | 'results' | 'detail-loading' | 'portion-pick' | 'error';

/** The picker's input: a title and the portions to choose between. */
interface PortionDetail {
  description: string;
  brand?: string;
  servings: ServingOption[];
}

/**
 * Debounce in front of a CHAIN-restaurant query only: it pays a real round
 * trip (`lib/foodSearch.ts`), so it waits rather than firing a callable per
 * keystroke. A local query has no timer at all (F2): the bundled index answers
 * in ~30 ms, and it runs off `useDeferredValue(query)` instead — React renders
 * the keystroke first and the search when it is idle, skipping intermediate
 * values when typing outruns it, which is what the old 100 ms timer
 * approximated with a fixed guess.
 */
const CHAIN_DEBOUNCE_MS = 350;

/** How long results must sit unchanged before their count is spoken (A3) —
 *  long enough that a typing screen-reader user hears one count, not five. */
const ANNOUNCE_SETTLE_MS = 700;

/** Global food-database search, mirroring the PWA food-search component:
 *  type ≥2 chars → debounced searchFoods → tap result → getFoodDetail →
 *  pick a serving (× multiplier) → emit a FoodEstimate the sheet bounces
 *  back into the manual form for review. */
export function FoodSearch({
  unitSystem = 'us',
  onPick,
  onCancel,
  headerRight,
  micSlot,
  micMessage,
  seedQuery,
  emptyContent,
  onCreateFromQuery,
  onScanBarcode,
  onScanMeal,
  libraryItems,
  initial,
  onSnapshot,
  backHandlerRef,
  autoFocus = false,
  focusSignal,
  resetSignal,
  onQuickLog,
  onQuickAdd,
}: Props) {
  const t = useT();
  const locale = useLocale();
  const styles = useThemedStyles(createStyles);
  const { colors } = useTheme();
  const [query, setQuery] = useState(initial?.query ?? '');
  const inputRef = useDeferredFocus(autoFocus && !initial?.query);
  useEffect(() => {
    if (!focusSignal) return;
    // Past the scanner's own dismissal, for the reason the open focus waits.
    const timer = setTimeout(() => {
      // Not over a field the user already tapped (see `useDeferredFocus`).
      if (!TextInput.State.currentlyFocusedInput()) inputRef.current?.focus();
    }, 350);
    return () => clearTimeout(timer);
  }, [focusSignal, inputRef]);
  useEffect(() => {
    if (!resetSignal) return;
    onChange('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetSignal]);
  // A dictated bare food name arrives here rather than in the meal draft — see
  // `routeTranscript`. Keyed on the seed VALUE so typing afterwards is never
  // fought with. A restored search (`initial`) already contains whatever the
  // seed did, so a remount must not re-apply a stale seed over it.
  const seedApplied = useRef(initial ? seedQuery : undefined);
  useEffect(() => {
    if (!seedQuery || seedQuery === seedApplied.current) return;
    seedApplied.current = seedQuery;
    onChange(seedQuery);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seedQuery]);
  const [phase, setPhase] = useState<Phase>(
    initial && initial.query.trim().length >= 2 ? 'results' : 'idle',
  );
  const [hits, setHits] = useState<FoodSearchHit[]>(initial?.hits ?? []);
  const [detail, setDetail] = useState<PortionDetail | null>(null);
  const [errorMsg, setErrorMsg] = useState('');
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Guard against a slow earlier query resolving after a newer keystroke —
  // AND against a slow `getFoodDetail` landing after the user has typed a new
  // query or tapped a different hit. One counter for both: any search or
  // detail request bumps it, and a response only applies if it is still the
  // newest thing asked for. Before this the detail path had no guard, so a
  // 3 s cold callable could replace a newer query's results with a portion
  // picker for a food the user had moved on from.
  const reqId = useRef(0);
  // Which query the hits on screen answer, and which one is still being asked
  // (debouncing or in flight). Results stay up while the next query runs — see
  // `onChange` — and for a chain-restaurant query that is 350 ms plus a real
  // round trip, long enough to tap a hit for the PREVIOUS query. The pair is
  // what lets the list say so (`staleHits`).
  const [hitsQuery, setHitsQuery] = useState(initial?.query.trim() ?? '');
  const [pendingQuery, setPendingQuery] = useState<string | null>(null);
  // The local search runs off this (see CHAIN_DEBOUNCE_MS). `lastRun` stops a
  // restored search re-running on mount, and a chain query running twice.
  const deferredQuery = useDeferredValue(query);
  const lastRun = useRef(initial?.query.trim() ?? '');
  // The first row of whatever the list shows — Return moves a screen reader
  // there (A3), since Return has nothing else to do on a live search.
  const firstRowRef = useRef<View>(null);

  useEffect(() => {
    return () => {
      if (debounce.current) clearTimeout(debounce.current);
    };
  }, []);

  // Decode the bundled food index while the user is still reaching for the
  // field. Search is on-device now (Tier D), and the one-time decode is
  // ~70–140 ms on the LG G6 — small, but it would otherwise land on the first
  // keystroke, which is the one moment the user is watching. Deliberately here
  // and not at app start: this component mounts only when a search surface
  // opens, so a user who never searches never pays it.
  useEffect(() => {
    warmFoodIndex();
  }, []);

  const onSnapshotRef = useRef(onSnapshot);
  onSnapshotRef.current = onSnapshot;
  useEffect(() => {
    onSnapshotRef.current?.({ query, hits });
  }, [query, hits]);

  // Android back steps out of the picker before it closes anything.
  useEffect(() => {
    if (!backHandlerRef) return;
    backHandlerRef.current = () => {
      if (phase !== 'portion-pick' && phase !== 'detail-loading') return false;
      reqId.current++;
      setPhase('results');
      return true;
    };
    return () => {
      backHandlerRef.current = null;
    };
  }, [backHandlerRef, phase]);

  // The user's own foods, matched on every keystroke with no debounce: a few
  // hundred names compare in well under a frame.
  const libraryHits = useMemo(
    () => matchLibrary(query, libraryItems ?? []),
    [query, libraryItems],
  );

  // Say how many results there are once the list settles (A3). Sighted users
  // see the list change under the field; a screen-reader user typing heard
  // nothing at all until they went looking. Once per answered query.
  const announcedFor = useRef('');
  useEffect(() => {
    if (phase !== 'results' || pendingQuery != null) return;
    const q = hitsQuery;
    if (!q || q === announcedFor.current) return;
    const n = hits.length + libraryHits.length;
    const timer = setTimeout(() => {
      announcedFor.current = q;
      announce(n === 0 ? t('food.noMatches') : n === 1 ? t('food.resultsOne') : t('food.resultsCount', { n }));
    }, ANNOUNCE_SETTLE_MS);
    return () => clearTimeout(timer);
  }, [phase, pendingQuery, hitsQuery, hits.length, libraryHits.length, t]);

  function onChange(text: string) {
    setQuery(text);
    if (debounce.current) clearTimeout(debounce.current);
    const q = text.trim();
    if (q.length < 2) {
      // A response still in flight for the longer query must not land on the
      // browse list this just restored.
      reqId.current++;
      lastRun.current = '';
      setPhase('idle');
      setHits([]);
      setPendingQuery(null);
      return;
    }
    setPendingQuery(q);
    // Results already on screen STAY on screen while the next query runs. The
    // old flip to a spinner on every keystroke blanked the list ten times a
    // word for a search that finishes before the next key lands.
    setPhase((p) => (p === 'results' ? 'results' : 'searching'));
    if (queryNamesRestaurantChain(q)) {
      debounce.current = setTimeout(() => {
        lastRun.current = q;
        void runSearch(q);
      }, CHAIN_DEBOUNCE_MS);
    }
  }

  // The local search, off the deferred query (F2). A chain query is the
  // debounce's; a query under two characters is `onChange`'s reset.
  useEffect(() => {
    const q = deferredQuery.trim();
    if (q.length < 2 || q === lastRun.current || queryNamesRestaurantChain(q)) return;
    lastRun.current = q;
    void runSearch(q);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deferredQuery]);

  async function runSearch(q: string) {
    const id = ++reqId.current;
    try {
      const results = await searchFoods(q);
      if (id !== reqId.current) return; // stale
      // A transition: the list is the non-urgent half of a keystroke, and the
      // field must never wait on it.
      startTransition(() => {
        setHits(results);
        setHitsQuery(q);
        setPendingQuery(null);
        setPhase('results');
      });
    } catch (e) {
      if (id !== reqId.current) return;
      setPendingQuery(null);
      // Offline is said as offline (C3): "didn't work, try again" invites the
      // retry that cannot work until the connection is back.
      setErrorMsg(t(messageKey(e, isOffline() ? 'food.failedOffline' : 'food.failed')));
      setPhase('error');
    }
  }

  /**
   * Open the portion step — unless there is only one portion, which leaves it
   * nothing to ask: that was a tap on the sole row and then the form. The form
   * already has the "how much" controls (Scale, and the grams field when the
   * portion has a weight), so a one-portion food goes straight there, at the
   * same three taps a scanned product takes. Two or more portions keep the
   * picker: "1 cup" vs "1 medium" is a choice of unit, not of number.
   */
  function showPortions(d: PortionDetail) {
    if (d.servings.length === 1) {
      onPick(estimateFor(d.servings[0], 1, d.description, d.brand, { source: 'text' }));
      return;
    }
    setDetail(d);
    setPhase('portion-pick');
  }

  async function openDetail(hit: FoodSearchHit) {
    haptics.tap();

    // Fast path: the search response already carried the portion picker, so the
    // picker opens with no network at all. `getFoodDetail` is a separate
    // callable and therefore separately cold — measured 2.83–3.79 s, paid on
    // every tap because it fires exactly once and never warms.
    if (hit.servings?.length) {
      showPortions({ description: hit.description, brand: hit.brand, servings: hit.servings });
      return;
    }

    // Slow path, and it must stay: hits served from a pre-existing search cache
    // entry, or by a functions deploy older than this bundle, carry no servings.
    const id = ++reqId.current;
    setPhase('detail-loading');
    try {
      const d = await getFoodDetail(hit.source, hit.id);
      if (id !== reqId.current) return; // stale: a newer query or tap won
      showPortions(d);
    } catch (e) {
      if (id !== reqId.current) return;
      // This one IS a network call (an Open Food Facts product, or a hit that
      // arrived without servings), so "check your connection" is honest here —
      // and when the app already knows it is offline, it says that instead.
      setErrorMsg(t(messageKey(e, isOffline() ? 'food.detailFailedOffline' : 'food.detailFailed')));
      setPhase('error');
    }
  }

  // ── Portion picker ──
  if (phase === 'portion-pick' && detail) {
    return (
      <PortionPicker
        title={detail.description}
        brand={detail.brand}
        servings={sortServings(detail.servings, unitSystem)}
        backLabel={t('food.results')}
        onBack={() => setPhase('results')}
        context={{ source: 'text' }}
        onPick={onPick}
      />
    );
  }

  const typed = query.trim();
  // Only a chain query is slow enough to matter: the bundled index answers a
  // local one in ~30 ms off a deferred render, and dimming the list for that
  // would flicker on every keystroke. Library rows are matched synchronously
  // against what is typed, so they are never stale and stay live.
  const staleHits =
    phase === 'results' &&
    pendingQuery != null &&
    pendingQuery !== hitsQuery &&
    queryNamesRestaurantChain(pendingQuery);
  // "350" / "350 40p" — a calorie count typed into the search (U4).
  const quick = onQuickAdd ? parseQuickAddQuery(typed, locale) : null;
  // Whichever row the list leads with takes `firstRowRef` (A3).
  const showLibrary = typed.length >= 2 && libraryHits.length > 0;
  const first: 'quick' | 'library' | 'hit' = quick ? 'quick' : showLibrary ? 'library' : 'hit';

  const quickRow = quick && onQuickAdd ? (
    <Pressable
      ref={firstRowRef}
      style={({ pressed }) => [styles.quickRow, pressed && styles.pressed]}
      // The owner's log plays the haptic (its outcome, or a late tap).
      onPress={() => onQuickAdd(quick)}
      accessibilityRole="button"
      accessibilityLabel={[
        t('food.quickAddA11y', { n: formatNumber(quick.calories, locale) }),
        ...macroWords(quick, locale, t),
      ].join(', ')}
      testID="search-quick-add"
    >
      <Glyph sf="plus.circle.fill" ion="add-circle" size={24} color={colors.teal} />
      <View style={styles.quickMain}>
        <Text style={styles.quickTitle} maxFontSizeMultiplier={2.2}>
          {t('food.quickAddRow', { n: formatNumber(quick.calories, locale) })}
        </Text>
        {macroWords(quick, locale, t).length ? (
          <Text style={styles.hitServing} maxFontSizeMultiplier={2.2}>{macroWords(quick, locale, t).join(' · ')}</Text>
        ) : null}
      </View>
    </Pressable>
  ) : null;

  const libraryRows = showLibrary ? (
    <View testID="search-library">
      {libraryHits.map((item, i) => (
        <Pressable
          key={item.key}
          ref={first === 'library' && i === 0 ? firstRowRef : undefined}
          style={({ pressed }) => [styles.hit, pressed && styles.pressed]}
          // `onPick` is the sheet's one-tap log, which plays its own haptic.
          onPress={item.onPick}
          accessibilityRole="button"
          accessibilityLabel={[
            item.name,
            item.tag,
            t('entry.caloriesA11y', { n: formatNumber(item.kcal, locale) }),
            item.protein != null ? t('entry.proteinAmount', { n: formatNumber(item.protein, locale) }) : null,
          ].filter(Boolean).join(', ')}
          testID={`search-lib-${item.key}`}
        >
          <View style={styles.libRow}>
            <Text style={[styles.hitDesc, styles.libName]} numberOfLines={1} maxFontSizeMultiplier={2.2}>{item.name}</Text>
            <Text style={styles.libKcal} maxFontSizeMultiplier={2.2}>{formatNumber(item.kcal, locale)} {t('today.kcal')}</Text>
          </View>
          <View style={styles.hitMeta}>
            <Text style={styles.libTag} maxFontSizeMultiplier={2.2}>{item.tag}</Text>
            {item.protein != null ? (
              <Text style={styles.hitServing} maxFontSizeMultiplier={2.2}>
                {t('entry.proteinAmount', { n: formatNumber(item.protein, locale) })}
              </Text>
            ) : null}
          </View>
        </Pressable>
      ))}
    </View>
  ) : null;

  // A miss is the moment to offer the other ways in, with the typed name
  // carried along — see `onCreateFromQuery` and `onScanBarcode`.
  const missActions = (
    <View style={styles.center}>
      {libraryHits.length === 0 && !quick ? <Text style={styles.muted}>{t('food.noMatches')}</Text> : null}
      {onCreateFromQuery ? (
        <TouchableOpacity
          style={styles.createFromQuery}
          onPress={() => onCreateFromQuery(typed)}
          accessibilityRole="button"
          testID="create-from-query"
        >
          <Ionicons name="create-outline" size={18} color={colors.accent} />
          <Text style={styles.createFromQueryText} numberOfLines={2}>
            {t('food.addYourself', { query: typed })}
          </Text>
        </TouchableOpacity>
      ) : null}
      {onScanBarcode ? (
        <TouchableOpacity
          style={styles.createFromQuery}
          onPress={onScanBarcode}
          accessibilityRole="button"
          testID="scan-from-miss"
        >
          <Glyph sf="barcode.viewfinder" ion="barcode-outline" size={18} color={colors.accent} />
          <Text style={styles.createFromQueryText} numberOfLines={2}>
            {t('food.scanInstead')}
          </Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );

  // The in-field doors show only while the box is EMPTY (see the JSX), and
  // the field's right padding makes room for exactly the ones shown.
  const empty = query.length === 0;
  const showScanIcon = onScanBarcode != null && empty;
  const showMealIcon = onScanMeal != null && empty;
  const inFieldCount = (showScanIcon ? 1 : 0) + (showMealIcon ? 1 : 0);

  /**
   * Return on the search field. A typed calorie count logs (U4: "350" ⏎ is
   * the two-tap quick add). Otherwise there is nothing to submit — results are
   * live — so a screen reader is moved onto the first result (A3) instead of
   * being left on a field whose keyboard just went away.
   */
  function onSubmit() {
    if (quick && onQuickAdd) {
      onQuickAdd(quick);
      return;
    }
    try {
      if (firstRowRef.current) AccessibilityInfo.sendAccessibilityEvent(firstRowRef.current, 'focus');
    } catch {
      // A renderer without native handles (tests, web) has nothing to focus.
    }
  }

  // Drag the list to put the keyboard away (B2): on iOS the keyboard follows
  // the finger, on Android a drag dismisses it.
  const dismissMode = Platform.OS === 'ios' ? 'interactive' : 'on-drag';

  // ── Search + results ──
  return (
    <View style={styles.wrap}>
      <View style={styles.searchRow}>
        <View style={styles.searchBox}>
          <SheetTextInput
            ref={inputRef}
            // Where a typed number logs as kcal, the placeholder says so
            // (re-score gap 2): the hint below reached screen readers only.
            placeholder={t(onQuickAdd ? 'food.placeholderQuick' : 'food.placeholder')}
            placeholderTextColor={colors.faint}
            value={query}
            onChangeText={onChange}
            onSubmitEditing={onSubmit}
            autoCorrect={false}
            returnKeyType={quick ? 'done' : 'search'}
            // iOS draws its own clear button; Android gets the one below.
            clearButtonMode="while-editing"
            accessibilityRole="search"
            accessibilityLabel={t('food.searchA11y')}
            accessibilityHint={onQuickAdd ? t('food.searchHint') : undefined}
            testID="food-search-input"
            // Capped like the form's fields: past 1.4× the placeholder no
            // longer fits beside two 44pt doors on a 360dp phone.
            maxFontSizeMultiplier={1.4}
            style={[styles.search, inFieldCount > 0 && { paddingRight: IN_FIELD_BTN * inFieldCount + space.xs }]}
          />
          {/* The barcode door, in the field itself (2026-10-04). It sat two
              levels down — + → More ways → Scan a barcode — so a packaged food
              cost five taps to log; here it is + → this → Add. Shown while the
              box is EMPTY only: that is when someone holding a package reaches
              for it, and once text is typed the right edge belongs to the clear
              control (iOS draws its own there, which ignores our padding). A
              miss still offers "Scan its barcode" below. */}
          {/* The camera beside it (2026-10-04) is photo scan's door — the
              same "Scan meal" as More ways, two levels up. Barcode keeps the
              edge it already had, so nobody's thumb has to relearn it. */}
          {inFieldCount > 0 ? (
            <View style={styles.inFieldRow}>
              {showMealIcon ? (
                <TouchableOpacity
                  style={styles.inFieldBtn}
                  onPress={onScanMeal}
                  accessibilityRole="button"
                  accessibilityLabel={t('log.scan')}
                  testID="search-scan-meal"
                >
                  <Glyph sf="camera" ion="camera-outline" size={22} color={colors.ink} />
                </TouchableOpacity>
              ) : null}
              {showScanIcon ? (
                <TouchableOpacity
                  style={styles.inFieldBtn}
                  onPress={onScanBarcode}
                  accessibilityRole="button"
                  accessibilityLabel={t('entry.scanBarcode')}
                  testID="search-scan-barcode"
                >
                  <Glyph sf="barcode.viewfinder" ion="barcode-outline" size={22} color={colors.ink} />
                </TouchableOpacity>
              ) : null}
            </View>
          ) : null}
          {Platform.OS === 'android' && query.length > 0 ? (
            <TouchableOpacity
              style={styles.clear}
              onPress={() => onChange('')}
              accessibilityRole="button"
              accessibilityLabel={t('food.clearSearch')}
              testID="food-search-clear"
            >
              <Ionicons name="close-circle" size={20} color={colors.muted} />
            </TouchableOpacity>
          ) : null}
        </View>
        {micSlot}
        {onCancel ? (
          <TouchableOpacity onPress={onCancel} hitSlop={12} accessibilityRole="button">
            <Text style={styles.cancel}>{t('common.cancel')}</Text>
          </TouchableOpacity>
        ) : null}
      </View>
      {micMessage}
      {/* Below the row, full width, and ALWAYS rendered — including while the
          user is typing. `docs/research/mobile-manual-food-entry.md` is settled
          that a query removing the write-it-yourself affordance is a defect:
          typing is the strongest signal someone wants to write their own food.
          Only the mic goes inside the row, where it reads as a peer of the
          keyboard. */}
      {headerRight}

      {phase === 'detail-loading' ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.accent} accessibilityLabel={t('food.loadingFood')} testID="food-detail-loading" />
        </View>
      ) : phase === 'error' ? (
        <ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode={dismissMode} style={styles.scroll}>
          {quickRow}
          {libraryRows}
          <View style={styles.center}>
            <Text style={styles.error} accessibilityRole="alert">{errorMsg}</Text>
            {typed.length >= 2 ? (
              <TouchableOpacity style={styles.retryBtn} onPress={() => void runSearch(typed)} accessibilityRole="button" testID="food-search-retry">
                <Text style={styles.retry}>{t('common.retry')}</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        </ScrollView>
      ) : phase === 'searching' || phase === 'results' ? (
        <ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode={dismissMode} style={styles.scroll}>
          {quickRow}
          {libraryRows}
          {staleHits ? (
            // Slim and inline, above the rows it is about: the list stays put
            // (no blanking), but it no longer looks like the answer.
            <View
              style={styles.staleBar}
              accessibilityLiveRegion="polite"
              accessibilityRole="progressbar"
              testID="food-search-pending"
            >
              <ActivityIndicator size="small" color={colors.accent} />
              <Text style={styles.staleText}>{t('food.searchingChain')}</Text>
            </View>
          ) : null}
          {phase === 'searching' ? (
            <View style={styles.center}>
              <ActivityIndicator color={colors.accent} accessibilityLabel={t('food.searching')} />
            </View>
          ) : hits.length === 0 ? (
            missActions
          ) : (
            hits.map((h, i) => {
              const s = defaultServing(h, unitSystem);
              const serving = s ? servingLine(s, locale, t) : null;
              return (
                <View key={`${h.source}-${h.id}`} style={styles.hitRow}>
                  <Pressable
                    ref={first === 'hit' && i === 0 ? firstRowRef : undefined}
                    // Dimmed and inert while they answer the previous query: a
                    // tap there used to open a food the user had typed past.
                    style={({ pressed }) => [styles.hitMain, staleHits && styles.hitStale, pressed && styles.pressed]}
                    onPress={() => openDetail(h)}
                    disabled={staleHits}
                    accessibilityRole="button"
                    accessibilityState={{ disabled: staleHits }}
                    accessibilityLabel={[h.description, h.brand, s ? servingA11y(s, locale, t) : null, t(trustLabelKey(h))]
                      .filter(Boolean)
                      .join(', ')}
                    testID={`search-hit-${h.source}-${h.id}`}
                  >
                    <Text style={styles.hitDesc} numberOfLines={2} maxFontSizeMultiplier={2.2}>{h.description}</Text>
                    {/* The default portion's numbers, when the hit already carries
                        them (every bundled-index hit does). A row that would need
                        a detail fetch to say this simply doesn't. */}
                    {serving ? <Text style={styles.hitServing} numberOfLines={1} maxFontSizeMultiplier={2.2}>{serving}</Text> : null}
                    <View style={styles.hitMeta}>
                      {h.brand ? <Text style={styles.hitBrand} maxFontSizeMultiplier={2.2}>{h.brand}</Text> : null}
                      {/* Where the number came from. Two databases feed this list —
                          lab-analyzed USDA rows and crowd-entered Open Food Facts
                          products — and until now they were indistinguishable, so a
                          measured value and a stranger's typo looked equally
                          authoritative. Cronometer sells "verified, not
                          crowdsourced" as its whole pitch; saying it plainly is
                          free, and it lets a user who cares choose. */}
                      <Text style={[styles.hitTrust, trustStyle(h, styles)]} maxFontSizeMultiplier={2.2}>{t(trustLabelKey(h))}</Text>
                    </View>
                  </Pressable>
                  {/* ⊕ — the default portion, logged now (U3). Only where the
                      hit carries its portions: a hit that needs a detail fetch
                      has no number to log without one. */}
                  {onQuickLog && s ? (
                    <Pressable
                      style={({ pressed }) => [styles.hitAdd, staleHits && styles.hitStale, pressed && styles.pressed]}
                      onPress={() => onQuickLog(estimateFor(s, 1, h.description, h.brand, { source: 'text' }))}
                      disabled={staleHits}
                      accessibilityRole="button"
                      accessibilityState={{ disabled: staleHits }}
                      accessibilityLabel={t('food.quickLogA11y', { name: h.description, serving: servingA11y(s, locale, t) })}
                      testID={`search-hit-add-${h.source}-${h.id}`}
                    >
                      <Glyph sf="plus.circle" ion="add-circle-outline" size={26} color={colors.teal} />
                    </Pressable>
                  ) : null}
                </View>
              );
            })
          )}
        </ScrollView>
      ) : emptyContent != null ? (
        <ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode={dismissMode} style={styles.scroll}>
          {emptyContent}
        </ScrollView>
      ) : (
        <View style={styles.center}><Text style={styles.muted}>{t('food.typeMore')}</Text></View>
      )}
    </View>
  );
}

/** A hit's first portion in the user's preferred order, or null when the hit
 *  carries no portions (it would need a detail fetch to say). */
function defaultServing(h: FoodSearchHit, unitSystem: 'us' | 'metric'): ServingOption | null {
  if (!h.servings?.length) return null;
  return sortServings(h.servings, unitSystem)[0] ?? null;
}

/** "1 cup (160 g) · 104 kcal · 1 g protein" — localized number, localized unit. */
function servingLine(s: ServingOption, locale: Locale, t: ReturnType<typeof useT>): string {
  return `${s.label} · ${formatNumber(s.kcal, locale)} ${t('today.kcal')} · ${t('entry.proteinAmount', { n: Math.round(s.protein) })}`;
}

/** The same, for a screen reader: "calories" spoken as a word (A5) — "kcal"
 *  was read letter by letter. */
function servingA11y(s: ServingOption, locale: Locale, t: ReturnType<typeof useT>): string {
  return [
    s.label,
    t('entry.caloriesA11y', { n: formatNumber(s.kcal, locale) }),
    t('entry.proteinAmount', { n: Math.round(s.protein) }),
  ].join(', ');
}

/** "40 g protein", "30 g carbs", "12 g fat" — whichever a quick add carries. */
function macroWords(q: QuickAddQuery, locale: Locale, t: ReturnType<typeof useT>): string[] {
  return [
    q.protein != null ? t('entry.proteinAmount', { n: formatNumber(q.protein, locale) }) : null,
    q.carbs != null ? t('entry.carbsAmount', { n: formatNumber(q.carbs, locale) }) : null,
    q.fat != null ? t('entry.fatAmount', { n: formatNumber(q.fat, locale) }) : null,
  ].filter((w): w is string => w != null);
}

/** Width of one in-field door: the platform minimum target (44pt iOS, 48dp
 *  Android) — the height is the field's own, ≥48. With both doors and the mic
 *  a 360dp phone keeps ~140dp of text; the padding guarantees typed text and
 *  the placeholder never run under a door (a long placeholder truncates). */
const IN_FIELD_BTN = Platform.OS === 'android' ? 48 : 44;

/** Round a quantity multiplier to two places — enough for "⅓" typed as 0.33. */
const roundQty = (n: number) => Math.round(n * 100) / 100;
const QTY_MIN = 0.1;
const QTY_MAX = 99;

/** A typed quantity (1.5, 0,25), or null when unreadable or out of range.
 *  Read in the user's locale (`parseDecimal`), like the form's numbers. */
function parseQty(text: string, locale: Locale): number | null {
  const n = parseDecimal(text, locale);
  return n != null && n >= QTY_MIN && n <= QTY_MAX ? roundQty(n) : null;
}

/** One portion × `m` as the estimate the review form opens on. */
function estimateFor(
  s: ServingOption,
  m: number,
  title: string,
  brand: string | undefined,
  context: { source: FoodSource; barcode?: string },
): FoodEstimate {
  return {
    calories: Math.round(s.kcal * m),
    protein: s.protein != null ? Math.round(s.protein * m) : undefined,
    carbs: s.carbs != null ? Math.round(s.carbs * m) : undefined,
    fat: s.fat != null ? Math.round(s.fat * m) : undefined,
    mealLabel: title,
    // Grams-first context: the picked portion's gram weight × multiplier is
    // the eaten weight the emitted macros correspond to.
    serving: {
      grams: s.grams > 0 ? Math.round(s.grams * m * 10) / 10 : undefined,
      source: context.source,
      barcode: context.barcode,
      brand,
      name: title,
      basis: s.grams > 0 ? { grams: s.grams, kcal: s.kcal, protein: s.protein, carbs: s.carbs, fat: s.fat } : undefined,
    },
  };
}

/**
 * The portion step: choose a serving and how many of it, then go on to review.
 *
 * Shared by a database hit (opened from the results) and a barcode hit (opened
 * by the add sheet straight from the scanner), so a scanned product gets the
 * same "how much did you eat" step as a searched one instead of landing on the
 * form at a single fixed basis.
 */
export function PortionPicker({
  title,
  brand,
  servings,
  backLabel,
  onBack,
  context,
  onPick,
}: {
  title: string;
  brand?: string;
  servings: ServingOption[];
  /** Visible text of the back control; it is also the control's name (WCAG 2.5.3). */
  backLabel: string;
  onBack: () => void;
  /** Where the food came from, carried into the save context (ADR-0013). */
  context: { source: FoodSource; barcode?: string };
  onPick: (estimate: FoodEstimate) => void;
}) {
  const t = useT();
  const locale = useLocale();
  const styles = useThemedStyles(createStyles);
  const { colors } = useTheme();
  const [multiplier, setMultiplier] = useState(1);
  // The typed-quantity field's text while open; null shows the value label.
  const [qtyDraft, setQtyDraft] = useState<string | null>(null);
  // The picker replaces the list in place; say where the user now is.
  const titleRef = useA11yFocus(title);

  // A tick per step (D1) — the most-tapped control here gave no feedback at all.
  const stepDown = () => {
    haptics.selection();
    setMultiplier((m) => Math.max(Math.min(m, 0.5), roundQty(m - 0.5)));
  };
  const stepUp = () => {
    haptics.selection();
    setMultiplier((m) => Math.min(QTY_MAX, roundQty(m + 0.5)));
  };

  /** Commit the typed quantity. Unreadable or out-of-range text keeps the old
   *  value with a warning haptic; the label then shows what stands. */
  function commitQty() {
    if (qtyDraft == null) return;
    const raw = qtyDraft.trim();
    setQtyDraft(null);
    if (raw === '') return;
    const n = parseQty(raw, locale);
    if (n == null) {
      haptics.warning();
      return;
    }
    setMultiplier(n);
  }

  // A quantity still being typed counts. The rows sit in a
  // `keyboardShouldPersistTaps="handled"` list, so tapping one does not blur
  // the field first — and an iPhone decimal pad has no Return key — so the
  // pick used to go out at the OLD quantity while the field showed the new one.
  // The rows preview it too, for the same reason.
  const liveQty = (qtyDraft != null ? parseQty(qtyDraft, locale) : null) ?? multiplier;

  function pickServing(s: ServingOption) {
    // A tap: the success buzz belongs to the add that follows, not the pick.
    haptics.tap();
    onPick(estimateFor(s, liveQty, title, brand, context));
  }

  // Localized: "1,5×" in es-PR / pt-BR, not "1.5×".
  const qtyText = `${formatNumber(multiplier, locale)}×`;
  // A localized Done above the iOS decimal pad (KeyboardBar.tsx, note 1):
  // the field autoFocuses, which rules out a custom bar.
  const doneKeyProps = useDoneKeyProps();

  return (
    <View style={styles.wrap}>
      <TouchableOpacity onPress={onBack} style={styles.back} accessibilityRole="button" testID="portion-back">
        <Ionicons name="chevron-back" size={18} color={colors.muted} />
        <Text style={styles.backText}>{backLabel}</Text>
      </TouchableOpacity>
      <Text ref={titleRef} style={styles.detailTitle} numberOfLines={2} maxFontSizeMultiplier={1.6} accessibilityRole="header">{title}</Text>
      {brand ? <Text style={styles.brand} maxFontSizeMultiplier={2.2}>{brand}</Text> : null}

      <View style={styles.multRow}>
        <Text style={styles.multLabel} importantForAccessibility="no" accessibilityElementsHidden>
          {t('food.quantity')}
        </Text>
        <View style={styles.stepper}>
          <TouchableOpacity
            style={styles.step}
            onPress={stepDown}
            accessibilityRole="button"
            accessibilityLabel={t('food.fewerServings')}
            // 44 circle + 2 slop = 48 (Android's target).
            hitSlop={2}
            testID="food-qty-minus"
          >
            <Text style={styles.stepText}>−</Text>
          </TouchableOpacity>
          {qtyDraft != null ? (
            <SheetTextInput
              style={[styles.multValue, styles.multInput]}
              value={qtyDraft}
              onChangeText={setQtyDraft}
              // Done blurs a single-line field, so blur is the one commit.
              onBlur={commitQty}
              autoFocus
              selectTextOnFocus
              keyboardType="decimal-pad"
              {...doneKeyProps}
              maxLength={5}
              maxFontSizeMultiplier={1.4}
              accessibilityLabel={t('food.quantityType')}
              testID="food-qty-input"
            />
          ) : (
            // The value is the adjustable control: VoiceOver/TalkBack swipe it
            // up and down, and a tap opens a field to type any amount — 0.5
            // steps could not say "a third of the bag" or "3.25 servings".
            <TouchableOpacity
              style={styles.multTap}
              onPress={() => setQtyDraft(formatDecimal(multiplier, locale))}
              accessibilityRole="adjustable"
              accessibilityLabel={t('food.quantity')}
              accessibilityValue={{ text: qtyText }}
              accessibilityHint={t('food.quantityType')}
              accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }, { name: 'activate' }]}
              onAccessibilityAction={(e) => {
                if (e.nativeEvent.actionName === 'increment') stepUp();
                else if (e.nativeEvent.actionName === 'decrement') stepDown();
                else if (e.nativeEvent.actionName === 'activate') setQtyDraft(formatDecimal(multiplier, locale));
              }}
              testID="food-qty-value"
            >
              <Text style={styles.multValue}>{qtyText}</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity
            style={styles.step}
            onPress={stepUp}
            accessibilityRole="button"
            accessibilityLabel={t('food.moreServings')}
            // 44 circle + 2 slop = 48 (Android's target).
            hitSlop={2}
            testID="food-qty-plus"
          >
            <Text style={styles.stepText}>+</Text>
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
        style={styles.scroll}
      >
        {servings.map((s, i) => {
          const kcal = formatNumber(Math.round(s.kcal * liveQty), locale);
          const protein = t('entry.proteinAmount', { n: Math.round(s.protein * liveQty) });
          return (
            <Pressable
              key={`${s.label}-${i}`}
              style={({ pressed }) => [styles.serving, pressed && styles.pressed]}
              onPress={() => pickServing(s)}
              accessibilityRole="button"
              // "calories" as a word (A5); the visible line keeps "kcal".
              accessibilityLabel={[s.label, t('entry.caloriesA11y', { n: kcal }), protein, t('food.review')].join(', ')}
              testID={`portion-${i}`}
            >
              <View style={styles.servingMain}>
                <Text style={styles.servingLabel} maxFontSizeMultiplier={2.2}>{s.label}</Text>
                {/* Words, not "P 12g" (S18-17), same as the diary rows. */}
                <Text style={styles.servingMacros} maxFontSizeMultiplier={2.2}>
                  {kcal} {t('today.kcal')} · {protein}
                </Text>
              </View>
              {/* "Review", not "Add": this tap opens the form, whose own button
                  is the one that adds. Two "Add"s in a row read as a double log. */}
              <Text style={styles.servingPick} maxFontSizeMultiplier={2.2}>{t('food.review')}</Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

/** Badge copy for a hit's provenance. `suspect` wins over the source: a flagged
 *  number deserves a caveat even when USDA supplied it. */
function trustLabelKey(h: { dataType?: string; suspect?: boolean }): I18nKey {
  if (h.suspect) return 'food.trustCheck';
  switch (trustForDataType(h.dataType)) {
    case 'lab':
      return 'food.trustLab';
    case 'reference':
      return 'food.trustUsda';
    default:
      return 'food.trustCommunity';
  }
}

function trustStyle(
  h: { dataType?: string; suspect?: boolean },
  styles: ReturnType<typeof createStyles>,
) {
  if (h.suspect) return styles.hitTrustSuspect;
  return trustForDataType(h.dataType) === 'community' ? styles.hitTrustCommunity : styles.hitTrustGood;
}

/** Map a callable error to a user message. The functions attach an
 *  ErrorCode in details; surface the not-configured case specifically since
 *  it's an operator action, not retryable. */
function messageKey(e: unknown, fallback: I18nKey): I18nKey {
  const code = (e as { details?: { code?: string } })?.details?.code;
  return code === 'food_api_not_configured' ? 'food.notConfigured' : fallback;
}

const createStyles = ({ colors }: Theme) => StyleSheet.create({
  // `flexShrink`, no floor and no cap on the list below (B2): a fixed 320
  // floor plus a 360 cap put the bottom of the results under the keyboard
  // padding on a small phone. The sheet's container is the one height that
  // matters; this shrinks into it and the list scrolls.
  wrap: { flexShrink: 1, gap: space.sm },
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  searchBox: { flex: 1, justifyContent: 'center' },
  search: {
    backgroundColor: colors.inputBg,
    borderWidth: 1,
    // `lineStrong`, not `line`: a field's edge is what says "type here", and
    // `line` is ~1.2:1 against the sheet (WCAG 1.4.11 asks 3:1).
    borderColor: colors.lineStrong,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    paddingVertical: space.md,
    fontSize: font.body,
    color: colors.ink,
    minHeight: 48,
  },
  // Android's clear control, inside the field's right edge; 48dp, Android's target.
  clear: { position: 'absolute', right: 0, width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  cancel: { fontSize: font.small, color: colors.muted, fontWeight: '700' },
  scroll: { flexShrink: 1 },
  center: { alignItems: 'center', justifyContent: 'center', paddingVertical: space.xl, gap: space.sm },
  muted: { fontSize: font.small, color: colors.muted },
  error: { fontSize: font.small, color: colors.danger, textAlign: 'center' },
  retry: { fontSize: font.small, color: colors.accent, fontWeight: '700' },
  retryBtn: { minHeight: 44, minWidth: 64, alignItems: 'center', justifyContent: 'center', paddingHorizontal: space.md },
  // The in-field doors, pinned to the field's right edge and centred on it.
  inFieldRow: { position: 'absolute', right: 0, top: 0, bottom: 0, flexDirection: 'row', alignItems: 'center' },
  // A full-height target per door (the field is ≥48 tall); see IN_FIELD_BTN.
  inFieldBtn: { width: IN_FIELD_BTN, minHeight: 48, alignSelf: 'stretch', alignItems: 'center', justifyContent: 'center' },
  staleBar: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingVertical: space.xs },
  staleText: { fontSize: font.tiny, color: colors.muted },
  hitStale: { opacity: 0.4 },
  // Press feedback for the Pressable rows, which otherwise give none.
  pressed: { opacity: 0.6 },
  // The create-it-yourself escape hatch on a search miss. Sized like a real
  // button, not a hint: on a miss it is usually the action the user wants.
  createFromQuery: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    borderWidth: 1,
    // A control's edge: `lineStrong` clears 3:1 (WCAG 1.4.11), `line` does not.
    borderColor: colors.lineStrong,
    borderRadius: radius.md,
    backgroundColor: colors.inputBg,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    marginTop: space.xs,
    maxWidth: '100%',
    minHeight: 48,
  },
  createFromQueryText: { flexShrink: 1, fontSize: font.small, color: colors.teal, fontWeight: '700' },
  hit: {
    paddingVertical: space.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  // A database hit: the row opens the portion step, the ⊕ beside it logs.
  hitRow: { flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: colors.line },
  hitMain: { flex: 1, paddingVertical: space.md },
  // 48 square, the row's full height at least: a one-tap log is the last
  // control to make small.
  hitAdd: { width: 48, minHeight: 48, alignSelf: 'stretch', alignItems: 'center', justifyContent: 'center', marginRight: -space.sm },
  quickRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingVertical: space.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
    minHeight: 48,
  },
  quickMain: { flex: 1, gap: 2 },
  quickTitle: { fontSize: font.body, color: colors.teal, fontWeight: '700' },
  hitDesc: { fontSize: font.body, color: colors.ink, fontWeight: '600' },
  hitServing: { fontSize: font.small, color: colors.muted, marginTop: 2 },
  libRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  libName: { flex: 1 },
  libKcal: { fontSize: font.body, color: colors.muted, fontWeight: '700' },
  libTag: { fontSize: font.tiny, color: colors.teal, fontWeight: '700', marginTop: 2 },
  hitBrand: { fontSize: font.tiny, color: colors.muted, marginTop: 2 },
  hitMeta: { flexDirection: 'row', alignItems: 'center', gap: space.sm, flexWrap: 'wrap' },
  hitTrust: { fontSize: font.tiny, fontWeight: '600', marginTop: 2 },
  hitTrustGood: { color: colors.muted },
  hitTrustCommunity: { color: colors.faint },
  // Not `danger`: a flagged number is worth a second look, not an alarm, and the
  // calm positioning (UX_AUDIT §S12) rules out red for anything the user did
  // not do wrong.
  hitTrustSuspect: { color: colors.accent },
  // 44 tall: the back control was a 20pt line of text with 8 of slop.
  back: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: 2, minHeight: 48, paddingRight: space.md },
  backText: { fontSize: font.small, color: colors.muted, fontWeight: '700' },
  detailTitle: { fontSize: font.h3, color: colors.ink, fontWeight: '800' },
  brand: { fontSize: font.small, color: colors.muted },
  multRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: space.sm },
  multLabel: { fontSize: font.small, color: colors.muted, fontWeight: '600' },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  // 44, not 36: the quantity stepper is the most-tapped control in the picker
  // and 36 is under both platforms' minimum target (S18-15).
  step: {
    width: 44, height: 44, borderRadius: 22, borderWidth: 1, borderColor: colors.lineStrong,
    alignItems: 'center', justifyContent: 'center', backgroundColor: colors.inputBg,
  },
  stepText: { fontSize: font.h3, color: colors.ink, fontWeight: '700' },
  multValue: { fontSize: font.body, color: colors.ink, fontWeight: '700', minWidth: 44, textAlign: 'center' },
  multTap: { minHeight: 48, minWidth: 56, alignItems: 'center', justifyContent: 'center', borderBottomWidth: 1, borderBottomColor: colors.lineStrong },
  multInput: {
    minHeight: 44, minWidth: 64, borderWidth: 1, borderColor: colors.lineStrong, borderRadius: radius.md,
    backgroundColor: colors.inputBg, paddingVertical: 0,
  },
  serving: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: space.md, borderBottomWidth: 1, borderBottomColor: colors.line,
  },
  servingMain: { flex: 1, gap: 2 },
  servingLabel: { fontSize: font.body, color: colors.ink, fontWeight: '600' },
  servingMacros: { fontSize: font.small, color: colors.muted },
  servingPick: { fontSize: font.small, color: colors.teal, fontWeight: '700', marginLeft: space.md },
});
