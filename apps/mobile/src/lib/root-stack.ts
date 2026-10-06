/**
 * Root stack reconciliation — what keeps the root `<Stack>` from holding
 * screens that `<Slot>` used to hide.
 *
 * ## Why this exists
 *
 * Until 2026-09-28 the root layout rendered `<Slot />`: a stack ROUTER whose
 * view mounts only the focused route. Every root-level navigation in this app
 * was written against that model — `tour`, `whats-new` and `onboarding` all
 * leave with `router.replace('/(app)')`, and the auth gate swaps to `/sign-in`
 * with `replace` too. React Navigation's REPLACE swaps the focused entry and
 * nothing else, so those calls leave `[(app), (app)]` or `[(app), sign-in]`
 * in root state. Under `<Slot>` nobody could tell.
 *
 * Coach and Milestones now push over the tabs on a NATIVE stack (UX_AUDIT
 * S18-14: no tab bar, swipe-back on iOS, hardware back on Android) — and so,
 * since S21-1, do Settings and the screens it opens (`DETAIL_ROUTES`). A native
 * stack mounts every entry, so those stale entries would become a second
 * `AppTabsLayout` running its hooks under the live one, and a swipe-back from
 * Today into another Today. The call sites are not this module's to change;
 * this states the two rules that make the stack safe for them instead:
 *
 *   1. **One `(app)`.** Everything before the LAST `(app)` is dropped — the
 *      last one is the entry a `replace('/(app)')` just built, so it carries
 *      the intended target (`/settings`, `/feedback`, an `openAdd` nonce).
 *      Routes pushed over it (`tour`, `whats-new`, `coach`, `milestones`,
 *      `onboarding` opened from Settings) keep it beneath them, which is what
 *      hardware back and swipe-back return to.
 *   2. **Signed-out routes stand alone.** `sign-in` and `verify-email` never
 *      keep an `(app)` under them: nothing should be reachable by going back
 *      from the sign-in screen, and a mounted tab shell with no user would
 *      run its hooks for nobody.
 *   3. **One copy of a pushed route.** A focused route whose name is already
 *      on the stack beneath it replaces that copy and everything above it.
 *      Settings → Redo setup pushes `onboarding` over Settings, and onboarding
 *      leaves with `replace('/settings')` (written for the tab-era Settings),
 *      which would otherwise stack a second Settings over the first — and
 *      back from it would land on a stale Settings instead of Today.
 *
 * `reconcileRootRoutes` is pure so the rules are testable without a navigator;
 * `AuthGate` in `app/_layout.tsx` applies its answer with `resetRoot`,
 * handing back the surviving route objects (and their keys) so React
 * Navigation leaves them mounted rather than remounting them.
 */

/** Root routes that are pushed OVER `(app)` and animate as a native push.
 *  History joined Coach and Milestones on 2026-10-04 (UX_AUDIT Today review
 *  P1): as a hidden tab it had no back button, no edge-swipe and no hardware
 *  back. It is a directory route (`history/_layout.tsx` + its own stack).
 *
 *  Settings, Daily targets, Refine targets and Feedback followed on
 *  2026-10-06 (S21-1) for the same reason: as hidden TABS they had no
 *  edge-swipe, drew the tab bar with no tab selected, and back — hardware or
 *  `router.back()` — went to the tab navigator's first route, Today, so
 *  Settings → Daily targets → Save landed on Today rather than Settings. */
export const DETAIL_ROUTES: ReadonlySet<string> = new Set([
  'coach',
  'milestones',
  'history',
  'scan',
  'connected-apps',
  'settings',
  'daily-targets',
  'refine-targets',
  'feedback',
]);

/** The detail routes that show the shared native stack header (back button,
 *  title, swipe-back) from the root layout. History draws its own (its day
 *  screen turns the header on inside History's stack) and Scan is a
 *  full-screen camera, so both are absent. */
export const HEADER_ROUTES: ReadonlySet<string> = new Set([
  'coach',
  'milestones',
  'connected-apps',
  'settings',
  'daily-targets',
  'refine-targets',
  'feedback',
]);

/** Root routes that never keep an `(app)` beneath them. */
export const STANDALONE_ROUTES: ReadonlySet<string> = new Set(['sign-in', 'verify-email']);

/** The root screen every pushed route sits on. */
export const APP_ROUTE = '(app)';

/**
 * The routes the root stack should hold given what it holds now, or `null`
 * when it already holds exactly that. Route objects are returned by identity —
 * never copied — so the caller can hand them straight back to `resetRoot`.
 * The focused route is always the last entry of the result.
 */
export function reconcileRootRoutes<R extends { name: string }>(
  routes: readonly R[],
  index: number,
): R[] | null {
  const focused = routes[index];
  if (!focused) return null;

  let keep: R[];
  if (STANDALONE_ROUTES.has(focused.name)) {
    keep = [focused];
  } else {
    let start = 0;
    for (let i = index; i >= 0; i--) {
      if (routes[i].name === APP_ROUTE) {
        start = i;
        break;
      }
    }
    keep = routes.slice(start, index + 1);
    // Rule 3: one copy of a pushed route. `(app)` is already handled above.
    if (focused.name !== APP_ROUTE) {
      const dup = keep.findIndex((r, i) => i < keep.length - 1 && r.name === focused.name);
      if (dup >= 0) keep = [...keep.slice(0, dup), focused];
    }
  }

  const unchanged = keep.length === routes.length && keep.every((r, i) => r === routes[i]);
  return unchanged ? null : keep;
}
