package expo.modules.quickaddtile

import android.content.ComponentName
import android.service.quicksettings.TileService
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * The JS→native half of the Quick Settings tile (ADR-0020): a mirror write and a
 * nudge, and nothing else.
 *
 * It deliberately holds no domain logic. Which preset occupies slot 1, whether
 * one is designated at all, and what the label should say are all decided in
 * `@macrolog/core`/`src/lib/quick-add.ts`; this only carries the answer across a
 * boundary `AsyncStorage` cannot cross. Keeping it that thin is what stops the
 * tile from becoming a second, silently-diverging copy of the quick-add rules —
 * the same reason `modules/watch-link` never learns the snapshot contract.
 */
class QuickAddTileModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("QuickAddTile")

    /**
     * Mirror the tile's label and whether it should be tappable.
     *
     * `requestListeningState` asks the platform to call `onStartListening` on a
     * tile that is currently visible, which is what makes a rename in Settings
     * show up in the shade without waiting for the user to reopen it. It is a
     * request, not a guarantee — the tile also relabels itself every time it
     * becomes visible, so a dropped nudge costs nothing.
     */
    AsyncFunction("setTileState") { label: String?, enabled: Boolean ->
      val context = appContext.reactContext ?: return@AsyncFunction
      TileState.write(context, label, enabled)
      try {
        TileService.requestListeningState(
          context,
          ComponentName(context, QuickAddTileService::class.java),
        )
      } catch (e: Exception) {
        // Throws on some OEM builds when no tile is placed. Not a failure: the
        // mirror is written, which is the part that has to survive.
      }
    }
  }
}
