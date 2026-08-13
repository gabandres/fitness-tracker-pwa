'use no memo';

import { FlexWidget, TextWidget } from 'react-native-android-widget';
import type { WidgetView } from '@macrolog/core';
import { QUICK_ADD_ACTION } from './actions';
import { groupDigits, widgetStrings } from './strings';

/**
 * Android home-screen widget UI (`react-native-android-widget` renders these
 * primitives into a native `RemoteViews` tree — they are NOT React Native
 * components, so only the documented props exist and there is no StyleSheet).
 *
 * ## Why `'use no memo'` is load-bearing at the top of this file
 * `app.json` sets `experiments.reactCompiler: true`. The React Compiler treats
 * any PascalCase function returning JSX as a component and rewrites it to call
 * `useMemoCache` — a hook. But this library does not mount widgets in a React
 * renderer: `buildWidgetTree` calls the component as a **raw function** to walk
 * it into RemoteViews, so any hook call throws
 * `Invalid Hook Call detected in TodayWidget` and the widget renders **nothing
 * at all** — a transparent, empty box on the home screen.
 *
 * That is not hypothetical: it is what shipped in vc 4/6/8, and it was
 * invisible until someone actually placed the widget on a home screen
 * (2026-08-06). It cannot be caught by `tsc`, by jest, or by `expo export` —
 * the bundle builds perfectly. Sentry caught it only because the throw happens
 * inside the widget task handler at render time.
 *
 * **Every widget component in this folder needs the directive**, which is what
 * `src/__tests__/widget-no-memo.test.ts` enforces.
 *
 * Locked design (see `WIDGET.md` §"Open decisions"): **text-first**, kcal
 * remaining over protein remaining. No ring — that's the fast-follow once the
 * snapshot seam is proven on a device.
 *
 * ## Why this is dark in both themes
 * It reuses the `heroPanel` family rather than the theme-reactive `paper`/`ink`
 * tokens. Those are deliberate (ADR-0014): the hero panel is dark in light mode
 * too, so the brand reads identically day or night. A widget also has no
 * reliable way to follow our in-app theme — it sits on the user's wallpaper,
 * and the OS theme it *can* see is not the app's. One fixed brand face is both
 * simpler and more correct here. Values are copied from `src/theme.ts`; they
 * can't be imported because that module pulls in RN `Appearance`.
 */

const COLORS = {
  panel: '#161412', // theme.ts heroPanel — brand anchor, dark in both themes
  text: '#f3f1ec', // heroText
  muted: '#a39c91', // heroMuted
  kcal: '#ff6a3d', // ring — the calorie coral
  protein: '#34d399', // protein green (dark-theme variant; reads on the panel)
  // Quick-add button fill. A lifted panel tone rather than the coral: the
  // button is a secondary affordance on a face whose point is the number, and
  // an accent-filled pill reads as the primary thing on it.
  button: '#2b2825',
} as const;

/** Deep link into the Today screen with the add-entry sheet already open —
 *  the same `?openAdd` param the in-app FAB route uses. The widget is meant to
 *  drive logging, not just display it. */
const ADD_ENTRY_URI = 'ignia://?openAdd=1';

/** Longest button caption drawn before it is elided. A `RemoteViews` row does
 *  not wrap or auto-shrink, so an over-long preset name would push the "+" out
 *  of a 2×2 cell instead of truncating. Measured against the narrowest cell a
 *  2×2 gets on a 4-column launcher. */
const MAX_BUTTON_LABEL = 14;

function buttonLabel(name: string): string {
  const trimmed = name.trim();
  return trimmed.length > MAX_BUTTON_LABEL ? `${trimmed.slice(0, MAX_BUTTON_LABEL - 1)}…` : trimmed;
}

/**
 * Width in dp at or above which the wide face is drawn.
 *
 * A 2×2 cell lands around 110–160dp on common launchers, and a 4×2 around
 * 250–330dp. 220 sits in the gap: comfortably above any square cell, below any
 * genuinely wide one, so a user dragging the handle gets a clean switch rather
 * than a layout that flickers between faces mid-drag.
 */
const WIDE_MIN_DP = 220;

export function TodayWidget({ view, width }: { view: WidgetView; width?: number }) {
  const wide = (width ?? 0) >= WIDE_MIN_DP;
  // Both states carry a locale now. This used to force 'en' for the empty
  // state, so a Spanish user's home screen read "Open Ignia to start".
  const s = widgetStrings(view.locale);
  // `quickAdd` is only ever populated on `ready` — an empty face is declining to
  // describe the day, so it must not offer to log into it.
  //
  // A 2×2 cell has room for one button under two numbers, which is why the
  // narrow face has always shown slot 1 alone. The wide face is the three-button
  // row ADR-0020 deferred; it is the same set of slots, just enough room to draw
  // them.
  const slots = view.state === 'ready' ? view.quickAdd.slice(0, wide ? 3 : 1) : [];

  return (
    <FlexWidget
      clickAction="OPEN_URI"
      clickActionData={{ uri: ADD_ENTRY_URI }}
      style={{
        height: 'match_parent',
        width: 'match_parent',
        backgroundColor: COLORS.panel,
        borderRadius: 24,
        paddingHorizontal: 14,
        paddingVertical: 12,
        flexDirection: 'column',
        justifyContent: 'center',
      }}
    >
      {view.state === 'empty' ? (
        <TextWidget text={s.empty} style={{ fontSize: 13, color: COLORS.muted }} />
      ) : (
        // Wide splits numbers from actions along the long axis. Letting the
        // narrow column layout simply stretch would leave a band of empty panel
        // exactly where the extra width is, which is the whole thing the user
        // widened the widget to fill.
        <FlexWidget
          style={{
            flexDirection: wide ? 'row' : 'column',
            width: 'match_parent',
            alignItems: wide ? 'center' : 'flex-start',
          }}
        >
          <FlexWidget style={{ flexDirection: 'column', flex: 1 }}>
            <TextWidget
              text={groupDigits(view.kcal.value)}
              style={{ fontSize: wide ? 38 : 34, color: COLORS.kcal, fontWeight: '700' }}
            />
            <TextWidget
              text={`${s.kcal} ${view.kcal.over ? s.over : s.left}`}
              style={{ fontSize: 12, color: COLORS.muted }}
            />
            <TextWidget
              text={`${groupDigits(view.protein.value)}g ${s.protein} ${
                view.protein.over ? s.over : s.left
              }`}
              style={{ fontSize: 13, color: COLORS.protein, marginTop: 8 }}
            />
          </FlexWidget>

          {slots.length > 0 ? (
            <FlexWidget
              style={{
                flexDirection: 'column',
                alignItems: wide ? 'flex-end' : 'flex-start',
              }}
            >
              {slots.map((slot, i) => (
                // Each chip carries its own clickAction, so it beats the face's
                // OPEN_URI: the inner PendingIntent wins for taps inside its
                // bounds. That is why the chip keeps the tighter hit area and the
                // face keeps the rest — a mis-hit opens the app, which is
                // recoverable, rather than logging a meal nobody asked for.
                //
                // `slot: i` and not a hardcoded 0. The narrow face only ever drew
                // index 0, so a constant was indistinguishable from correct; on
                // the wide face it would log the first preset three times.
                <FlexWidget
                  key={slot.presetId}
                  clickAction={QUICK_ADD_ACTION}
                  clickActionData={{ slot: i }}
                  accessibilityLabel={`${s.quickAddA11y} ${slot.name}`}
                  style={{
                    marginTop: i === 0 && !wide ? 10 : i === 0 ? 0 : 6,
                    paddingHorizontal: 10,
                    paddingVertical: 6,
                    borderRadius: 999,
                    backgroundColor: COLORS.button,
                    flexDirection: 'row',
                    alignItems: 'center',
                  }}
                >
                  <TextWidget
                    text={`+ ${buttonLabel(slot.name)}`}
                    style={{ fontSize: 12, color: COLORS.text, fontWeight: '600' }}
                  />
                </FlexWidget>
              ))}
            </FlexWidget>
          ) : null}
        </FlexWidget>
      )}
    </FlexWidget>
  );
}
