import { type ReactNode, useCallback, useSyncExternalStore } from 'react';

/**
 * The bridge between a `BottomSheet native` and the root `sheet` route that
 * presents it as a real `UISheetPresentationController` (UX_AUDIT S20).
 *
 * ## Why a portal and not a route per sheet
 *
 * The meal sheet is driven by its screen: Today owns `sheetOpen`, `editing`,
 * the presets, the library, the receipts. Moving that into a route would mean
 * threading a dozen callbacks through navigation params, which cannot carry
 * functions. Instead the screen keeps rendering `<EntrySheet>` exactly as it
 * did, and `BottomSheet` — when `native` — publishes its children here every
 * render. The `sheet` route, pushed as a `formSheet` on the root stack, reads
 * them back and renders them. Hooks inside the children run in the route's
 * tree, so everything they read from context must be provided at or above the
 * root stack (theme, i18n, auth, toasts — `app/_layout.tsx`).
 *
 * ## Lifecycle
 *
 * `BottomSheet` pushes the route when `visible` turns true and the route marks
 * itself presented on mount. Three ways out:
 *
 *   1. **The caller closes** (`visible` → false): `BottomSheet` calls the
 *      route's registered `dismiss`, which pops exactly that route.
 *   2. **The user swipes it down / taps the dimmed area / presses back** and
 *      the sheet is not `guarded`: the route is gone before anyone is asked,
 *      so it reports `onUserDismissed` and the caller's `onRequestClose`
 *      (or `onClose`) catches up.
 *   3. **Same gesture on a `guarded` sheet** (typed content): the native
 *      dismissal is refused, the route asks `requestClose`, and the caller
 *      decides — usually a "Discard this entry?" confirm drawn inside the
 *      sheet.
 */

/** Which dismissal the user made without aiming at a button. */
export type PortalCloseVia = 'backdrop' | 'drag' | 'back';

export interface SheetPortalEntry {
  node: ReactNode;
  /** Ask the owner whether the sheet may close. `false` keeps it open. */
  requestClose: (via: PortalCloseVia) => boolean;
  /** Refuse a native dismissal and route it through `requestClose`. */
  guarded: boolean;
  /** Host toasts and confirms inside the sheet. */
  overlays: boolean;
  /** The owner's `visible`. A route that mounts after its owner already
   *  closed (a fast open-then-close) dismisses itself on sight. */
  visible: boolean;
  testID?: string;
}

interface Presenter {
  /** Pop this sheet's route. */
  dismiss: () => void;
}

const entries = new Map<string, SheetPortalEntry>();
const presenters = new Map<string, Presenter>();
const closing = new Set<string>();
/** Per-id subscribers: a sheet republishing on every render of its owner must
 *  not re-render every other open sheet route. */
const listeners = new Map<string, Set<() => void>>();

function emit(id: string) {
  for (const l of listeners.get(id) ?? []) l();
}

/** Publish (or replace) what the sheet `id` renders. */
export function setSheetPortal(id: string, entry: SheetPortalEntry): void {
  entries.set(id, entry);
  emit(id);
}

/** Forget the sheet `id`'s content (after it has fully dismissed). */
export function clearSheetPortal(id: string): void {
  if (!entries.delete(id)) return;
  emit(id);
}

export function getSheetPortal(id: string): SheetPortalEntry | undefined {
  return entries.get(id);
}

/** The live entry for `id`, re-rendering whenever that sheet republishes. */
export function useSheetPortal(id: string | undefined): SheetPortalEntry | undefined {
  const subscribe = useCallback(
    (listener: () => void) => {
      if (!id) return () => {};
      let set = listeners.get(id);
      if (!set) listeners.set(id, (set = new Set()));
      set.add(listener);
      return () => {
        set.delete(listener);
        if (set.size === 0) listeners.delete(id);
      };
    },
    [id],
  );
  const read = () => (id ? entries.get(id) : undefined);
  return useSyncExternalStore(subscribe, read, read);
}

/** Called by the route on mount; the returned function on unmount. */
export function registerPresenter(id: string, presenter: Presenter): () => void {
  presenters.set(id, presenter);
  closing.delete(id);
  return () => {
    if (presenters.get(id) === presenter) presenters.delete(id);
    closing.delete(id);
  };
}

export function isPresented(id: string): boolean {
  return presenters.has(id);
}

/** True between a programmatic dismiss and the route actually unmounting. */
export function isClosing(id: string): boolean {
  return closing.has(id);
}

/** Pop the sheet's route because its owner closed it. No-op when not up. */
export function dismissSheet(id: string): void {
  const p = presenters.get(id);
  if (!p || closing.has(id)) return;
  closing.add(id);
  p.dismiss();
}

/** Test seam. */
export function __resetSheetPortal(): void {
  entries.clear();
  presenters.clear();
  closing.clear();
  listeners.clear();
}
