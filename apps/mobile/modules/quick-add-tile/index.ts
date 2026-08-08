import { requireOptionalNativeModule } from 'expo';

/**
 * QuickAddTile — the TS face of the Android Quick Settings tile
 * (`android/src/main/java/expo/modules/quickaddtile/`, ADR-0020).
 *
 * `requireOptionalNativeModule` rather than `requireNativeModule`: this module is
 * Android-only and absent from the iOS binary, from Expo Go and from the web
 * bundle. An optional require makes every call below a silent no-op there — the
 * same shape `modules/watch-link` and `src/lib/widget.ts` use for native surfaces
 * that do not exist on every runtime.
 *
 * One direction only. The tile never reports back: what it did lands in Firestore
 * and reaches the app through the listener every other write uses.
 */

interface QuickAddTileNativeModule {
  setTileState(label: string | null, enabled: boolean): Promise<void>;
}

const native = requireOptionalNativeModule<QuickAddTileNativeModule>('QuickAddTile');

/** True when the tile is present in this binary. */
export const isQuickAddTileAvailable = native != null;

/**
 * Mirror what the tile should say, and whether tapping it should log.
 *
 * Pass `null`/`false` to make the tile inert — that is the correct state for a
 * signed-out device and for a user with no quick-add slots, and it is what makes
 * the tap fall through to opening the app instead of writing something unnamed.
 *
 * Never rejects: a tile that cannot be relabelled is cosmetic, and letting it
 * throw would surface inside whatever wrote a log.
 */
export async function setTileState(label: string | null, enabled: boolean): Promise<void> {
  try {
    await native?.setTileState(label, enabled);
  } catch {
    /* best-effort, same as the widget reload */
  }
}
