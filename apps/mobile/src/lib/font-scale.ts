import {
  createContext,
  createElement,
  Fragment,
  type ReactElement,
  type ReactNode,
  useContext,
  useState,
  useSyncExternalStore,
} from 'react';
import { type TextProps, useWindowDimensions, type ViewStyle } from 'react-native';
import { isAnySheetActive, onSheetsIdle } from '@/lib/sheet-portal';
import { headerTitle } from '@/theme';

/**
 * Font scale (iOS Dynamic Type / Android font size) — the two things the rest
 * of the app cannot do on its own: lay out again when the setting CHANGES under
 * a running app, and keep a screen's title the biggest text on it at the
 * largest sizes.
 *
 * # 1. Relayout on a text-size change (S21, iOS 26 simulator)
 *
 * Changing the text size while the app was backgrounded left Today, Trends,
 * Body and Train with glyphs cut in half and the hero number clipped to
 * "2,26" — until a cold restart, after which everything laid out correctly.
 *
 * ## Why (read out of `react-native@0.86` — nothing here is guessed)
 *
 * RN does try. `RCTFabricSurface` observes `UIContentSizeCategoryDidChange`,
 * pushes the new `fontSizeMultiplier` into the surface's `LayoutContext`, and
 * `SurfaceHandler::constraintLayout` commits a CLONE of the tree with every
 * text node dirtied (`enableFontScaleChangesUpdatingLayout`, on by default).
 * That commit is correct, and on its own it would be enough.
 *
 * It does not survive the next React commit. React builds each commit from the
 * shadow nodes IT holds, and `updateRuntimeShadowNodeReferencesOnCommit` — the
 * flag that would hand React the natively re-dirtied clones — is OFF by
 * default. So the first render after returning to the app (an AppState
 * listener, a snapshot, the clock) commits React's own copies of every subtree
 * it did not re-render: clean nodes whose layout was measured, and whose
 * `ParagraphShadowNode::content_` was cached, at the OLD multiplier. Meanwhile
 * state progression hands the mounted text views the NEW state — the attributed
 * string built at the new size. New-size glyphs drawn into old-size frames is
 * exactly "cut in half", and an old-width box around a wider number is
 * exactly "2,26". The React Compiler makes the stale share large, not small:
 * almost every component is memoized, so almost nothing re-renders on its own.
 * A cold start has no old nodes, which is why it "fixed" it.
 *
 * Re-rendering is NOT enough: a host node whose props did not change is
 * reused as-is (the stale one). Only NEW host nodes are measured afresh. A
 * native fix (that flag, or a newer RN) needs a binary; this has to ship OTA.
 *
 * ## What this does instead
 *
 * {@link RelayoutProvider} counts font-scale changes into a `generation`, and
 * {@link RelayoutBoundary} keys a screen's content on it — mounted by the
 * navigators' `screenLayout` (root stack and tabs), BELOW the navigators. So a
 * change remounts each screen's tree (fresh nodes, measured at the new size)
 * while the NavigationContainer, every navigator and their state stay put: the
 * current tab, the pushed stack, the route params all survive. The tab shell
 * (`AppTabsLayout` — the OTA auto-apply, the app-open count, the health
 * import) is not remounted either; only the content under it.
 *
 * What a remount costs is the screen's own `useState`, so it is withheld where
 * that is the user's work:
 *
 * - **While any native sheet is up** (`isAnySheetActive`) the whole generation
 *   waits for the sheets to go (`onSheetsIdle`). A sheet's content lives in the
 *   root `sheet` route but its owner (Today's `sheetOpen`, the meal being
 *   typed) lives in the screen; remounting either would drop a half-typed
 *   entry, which `EntrySheet` keeps only in state.
 * - **A held route never remounts while mounted** (`hold`): the forms whose
 *   input is unsaved state (onboarding, sign-in, feedback, coach, the targets
 *   screens, scan), and the routes that are nested navigators (`(app)`,
 *   `history`) — their screens are remounted by their own navigator, or not at
 *   all. They are fresh on the next visit. Any node they re-render still lays
 *   out right, so the next step of a form is correct.
 * - **Train during a workout** is held, and catches up only once it is no
 *   longer the visible tab: a remount would cancel the running rest timer and
 *   its notification (`useRestTimer`'s unmount), and finishing a workout is a
 *   sheet the Train screen owns. The workout itself is durable either way
 *   (`active-session-journal.ts`, `pending-logs.ts`, `scan-draft.ts`).
 *
 * `fontscale-s21-relayout.test.tsx` pins the re-key, the holds and the sheet
 * gate.
 *
 * # 2. Large titles at accessibility sizes (S21)
 *
 * Page titles were capped at `headerTitle.maxFontScale` (1.1×, the measured
 * limit of Today's header row) while body copy grows to RN's 3.57× at AX5, so
 * at the largest sizes the BODY outgrew the screen's own name. Below
 * {@link ACCESSIBILITY_FONT_SCALE} nothing changes (the 1.1 cap and its
 * `header-title-fit.test.ts` measurement stand). From there the header row
 * WRAPS: the title takes the whole first line, capped at
 * {@link LARGE_TITLE_MAX_SCALE} — at or above uncapped body text at AX5 — and
 * shrinks to fit rather than clipping a long locale's word; the icons wrap to
 * the line below, right-aligned.
 */

// ── 1. Relayout ───────────────────────────────────────────────────────────────

/** The font scale last turned into a generation, and how many there were. */
export interface RelayoutState {
  scale: number;
  generation: number;
}

/**
 * The generation after a render that saw `fontScale`. Pure — the provider and
 * the test both run it. A change while a sheet is up is NOT counted yet; the
 * render after the sheets go idle counts it (and a change that was undone in
 * the meantime is never counted at all).
 */
export function nextRelayout(state: RelayoutState, fontScale: number, sheetsUp: boolean): RelayoutState {
  if (fontScale === state.scale || sheetsUp) return state;
  return { scale: fontScale, generation: state.generation + 1 };
}

/** A route's own view of the generation: what it last remounted for, and
 *  whether it owes a remount it was holding off. */
export interface BoundaryState {
  applied: number;
  deferred: boolean;
}

/**
 * Whether a route remounts for `generation` now. Pure.
 *
 * - Not held → take it now, even in view: that is the case being fixed.
 * - Held → owe it (`deferred`).
 * - Released while still in view → keep owing it until the user leaves: the
 *   moment a hold lifts (a workout just finished) is the moment a remount
 *   would tear down what the user is looking at (the finish sheet).
 */
export function nextBoundary(
  state: BoundaryState,
  input: { generation: number; hold: boolean; focused: boolean },
): BoundaryState {
  if (state.applied === input.generation) return state.deferred ? { applied: state.applied, deferred: false } : state;
  if (input.hold) return state.deferred ? state : { applied: state.applied, deferred: true };
  if (state.deferred && input.focused) return state;
  return { applied: input.generation, deferred: false };
}

const RelayoutContext = createContext(0);

/** Re-armed after every idle, so it notifies on each "sheets went away". */
function subscribeSheetsIdle(notify: () => void): () => void {
  let off = () => {};
  const arm = () => {
    off = onSheetsIdle(() => {
      notify();
      arm();
    });
  };
  arm();
  return () => off();
}

/** Counts font-scale changes for {@link RelayoutBoundary}. Mount once, above
 *  every navigator (root `_layout.tsx`). */
export function RelayoutProvider({ children }: { children: ReactNode }): ReactElement {
  const { fontScale } = useWindowDimensions();
  // A store read, not a plain call: `useSyncExternalStore` reads the snapshot
  // on every render, so the compiler cannot cache a stale "no sheet is up".
  const sheetsUp = useSyncExternalStore(subscribeSheetsIdle, isAnySheetActive, isAnySheetActive);
  const [state, setState] = useState<RelayoutState>({ scale: fontScale, generation: 0 });
  // Adjusted during render (React's "state from a changed prop" pattern, as
  // `useGaveUpWaiting` does) — an effect would paint one more stale frame.
  const next = nextRelayout(state, fontScale, sheetsUp);
  if (next !== state) setState(next);
  return createElement(RelayoutContext.Provider, { value: next.generation }, children);
}

/** How many font-scale changes this app has laid out again for. */
export function useRelayoutGeneration(): number {
  return useContext(RelayoutContext);
}

/**
 * A screen's content, remounted when the font scale changes (see the module
 * comment). Rendered by a navigator's `screenLayout` around the screen.
 */
export function RelayoutBoundary({
  generation,
  hold = false,
  focused = true,
  children,
}: {
  generation: number;
  /** Never remount now — the screen holds unsaved work. */
  hold?: boolean;
  /** Whether the route is the one on screen; a released hold waits for blur. */
  focused?: boolean;
  children: ReactNode;
}): ReactElement {
  const [state, setState] = useState<BoundaryState>({ applied: generation, deferred: false });
  const next = nextBoundary(state, { generation, hold, focused });
  if (next !== state) setState(next);
  return createElement(Fragment, { key: next.applied }, children);
}

/**
 * Root routes that never remount for a font-scale change while mounted. The
 * forms hold unsaved typed input in `useState`; `(app)` and `history` are
 * nested navigators (the tabs re-key their own screens; History's stack is
 * left alone); `sheet` is gated by `isAnySheetActive` already and listed so a
 * sheet route can never be torn down from here.
 */
export const RELAYOUT_HOLD_ROUTES: ReadonlySet<string> = new Set([
  '(app)',
  'history',
  'sheet',
  'onboarding',
  'sign-in',
  'verify-email',
  'feedback',
  'coach',
  'daily-targets',
  'refine-targets',
  'scan',
]);

// ── 2. Large titles ───────────────────────────────────────────────────────────

/**
 * From this font scale up the large-title header switches to its stacked
 * layout. 1.5 is Android's "largest" pre-14 step and sits just under iOS's
 * first accessibility size (AX1 = 1.786 in RN's table), so every accessibility
 * size gets it and no standard size does.
 */
export const ACCESSIBILITY_FONT_SCALE = 1.5;

/**
 * The title cap in the stacked layout. RN scales body text up to 3.571× at
 * AX5 (`RCTFontSizeMultiplier`), i.e. 17 → 60.7pt; `font.h1` (30) × 2.1 = 63pt
 * keeps the screen's name at or above it. Android tops out at 2.0×, under it.
 */
export const LARGE_TITLE_MAX_SCALE = 2.1;

/** The smallest a stacked title shrinks to fit a long word ("Tendências") on a
 *  narrow phone — still well above body size at that scale. */
const LARGE_TITLE_MIN_FIT = 0.6;

export interface LargeTitle {
  /** True at {@link ACCESSIBILITY_FONT_SCALE} and up. */
  stacked: boolean;
  /** Spread onto the title `<Text>`. */
  titleProps: Pick<TextProps, 'maxFontSizeMultiplier' | 'numberOfLines' | 'adjustsFontSizeToFit' | 'minimumFontScale'>;
  /** Added to the header row. */
  rowStyle: Pick<ViewStyle, 'flexWrap'> | undefined;
  /** Added to the title (or the block that holds it): the whole first line. */
  titleStyle: Pick<ViewStyle, 'width'> | undefined;
  /** Added to a trailing icon cluster that has no `marginLeft: 'auto'` of its
   *  own, so it sits right on its own line. */
  trailingStyle: Pick<ViewStyle, 'marginLeft'> | undefined;
}

// Module constants so the objects are the same identity render to render.
const INLINE: LargeTitle = {
  stacked: false,
  titleProps: { maxFontSizeMultiplier: headerTitle.maxFontScale },
  rowStyle: undefined,
  titleStyle: undefined,
  trailingStyle: undefined,
};
const STACKED: LargeTitle = {
  stacked: true,
  titleProps: {
    maxFontSizeMultiplier: LARGE_TITLE_MAX_SCALE,
    numberOfLines: 1,
    adjustsFontSizeToFit: true,
    minimumFontScale: LARGE_TITLE_MIN_FIT,
  },
  rowStyle: { flexWrap: 'wrap' },
  titleStyle: { width: '100%' },
  trailingStyle: { marginLeft: 'auto' },
};

/** The large-title layout for a font scale. Pure. */
export function largeTitleFor(fontScale: number): LargeTitle {
  return fontScale >= ACCESSIBILITY_FONT_SCALE ? STACKED : INLINE;
}

/** The large-title layout for the current font scale (Today, Trends, Body,
 *  Train headers). */
export function useLargeTitle(): LargeTitle {
  return largeTitleFor(useWindowDimensions().fontScale);
}
