'use no memo';

import { FlexWidget, TextWidget } from 'react-native-android-widget';
import type { WidgetView } from '@macrolog/core';
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
} as const;

/** Deep link into the Today screen with the add-entry sheet already open —
 *  the same `?openAdd` param the in-app FAB route uses. The widget is meant to
 *  drive logging, not just display it. */
const ADD_ENTRY_URI = 'ignia://?openAdd=1';

export function TodayWidget({ view }: { view: WidgetView }) {
  // Both states carry a locale now. This used to force 'en' for the empty
  // state, so a Spanish user's home screen read "Open Ignia to start".
  const s = widgetStrings(view.locale);

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
        <FlexWidget style={{ flexDirection: 'column' }}>
          <TextWidget
            text={groupDigits(view.kcal.value)}
            style={{ fontSize: 34, color: COLORS.kcal, fontWeight: '700' }}
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
      )}
    </FlexWidget>
  );
}
