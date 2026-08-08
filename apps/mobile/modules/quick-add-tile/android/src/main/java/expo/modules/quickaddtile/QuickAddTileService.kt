package expo.modules.quickaddtile

import android.content.Intent
import android.net.Uri
import android.os.Build
import android.service.quicksettings.Tile
import android.service.quicksettings.TileService
import com.facebook.react.HeadlessJsTaskService

/**
 * The Quick Settings tile: one tap logs the user's first quick-add preset
 * (ADR-0020).
 *
 * ## Why the label matters more than the icon
 * A tile tap is blind — no list, no sheet, no confirmation. So `onStartListening`
 * always relabels from the mirrored state before the user can touch it, and the
 * label names the preset ("Log Protein shake"). With nothing designated the tile
 * goes `STATE_INACTIVE` and its tap opens the app instead of writing; an inert
 * tile that explains itself beats a live one that logs something unnamed.
 *
 * ## The one failure this cannot design away
 * `startService` from a background app throws on Android 8+. A tapped tile is
 * usually enough of a foreground signal for the platform to allow it, but that is
 * not contractual, so the throw is caught and the tap degrades to a deep link
 * that opens the app with the same intent (`ignia://?quickAddSlot=0`). That is
 * slower and it is not what the feature promises — but it logs, and it is visible.
 * A swallowed exception here would be a tile that does nothing at all, which is
 * the exact failure mode the Android widget shipped with for a month.
 */
class QuickAddTileService : TileService() {

  override fun onStartListening() {
    super.onStartListening()
    val tile = qsTile ?: return
    val label = TileState.label(this)
    val ready = TileState.enabled(this) && !label.isNullOrBlank()

    tile.label = if (ready) label else FALLBACK_LABEL
    tile.state = if (ready) Tile.STATE_ACTIVE else Tile.STATE_INACTIVE
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      tile.subtitle = if (ready) null else SETUP_SUBTITLE
    }
    tile.updateTile()
  }

  override fun onClick() {
    super.onClick()
    val ready = TileState.enabled(this) && !TileState.label(this).isNullOrBlank()
    if (!ready) {
      openApp()
      return
    }

    try {
      val intent = Intent(this, QuickAddTileTaskService::class.java)
      intent.putExtra(EXTRA_SLOT, 0)
      // Covers the window between `startService` and the JS context actually
      // running, so a tap made on a dozing or locked device is not dropped when
      // the CPU idles. Called on `HeadlessJsTaskService` itself, NOT on our
      // subclass: this is a Java static, and Kotlin does not inherit Java statics
      // into a subclass's scope — `QuickAddTileTaskService.acquireWakeLockNow`
      // compiles nowhere and fails as an unresolved reference.
      HeadlessJsTaskService.acquireWakeLockNow(this)
      startService(intent)
    } catch (e: Exception) {
      // Background-start refused, or the JS host could not be reached. Fall back
      // rather than lose the tap.
      openApp()
    }
  }

  /**
   * Open the app carrying the same request. `startActivityAndCollapse` is what
   * closes the shade — without it the activity launches behind Quick Settings and
   * the user appears to have tapped nothing.
   */
  private fun openApp() {
    val intent = Intent(Intent.ACTION_VIEW, Uri.parse(DEEP_LINK)).apply {
      addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    }
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
      // Android 14 replaced the Intent overload with a PendingIntent one and
      // throws `UnsupportedOperationException` on the old signature.
      startActivityAndCollapse(
        android.app.PendingIntent.getActivity(
          this,
          0,
          intent,
          android.app.PendingIntent.FLAG_IMMUTABLE or android.app.PendingIntent.FLAG_UPDATE_CURRENT,
        ),
      )
    } else {
      @Suppress("DEPRECATION")
      startActivityAndCollapse(intent)
    }
  }

  companion object {
    const val EXTRA_SLOT = "slot"

    /** Seen only before JS has ever mirrored a label — including a fresh install
     *  and a signed-out device. Brand, not a sentence, because the device locale
     *  decides this string and it may not be the app's language. */
    private const val FALLBACK_LABEL = "Ignia"
    private const val SETUP_SUBTITLE = "Set up in Ignia"

    /** Handled by the app's router, which logs slot 0 and opens Today. */
    private const val DEEP_LINK = "ignia://?quickAddSlot=0"
  }
}
