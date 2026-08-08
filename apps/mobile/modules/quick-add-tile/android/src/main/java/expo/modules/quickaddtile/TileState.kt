package expo.modules.quickaddtile

import android.content.Context
import android.content.SharedPreferences

/**
 * The one piece of state the tile and JS share, and the only reason this native
 * module exists at all.
 *
 * A `TileService` runs before any JS does, so it cannot ask the app what the
 * user's first quick-add preset is called — and the tile must be labelled with
 * that name, because a Quick Settings tap is blind: there is no list, no
 * confirmation and nothing on screen to read. An unlabelled tile that writes a
 * meal is the one shape of this feature that would be indefensible.
 *
 * `AsyncStorage` is not readable from here — on Android it is a SQLite database
 * (`RKStorage`) with its own schema, not `SharedPreferences` — so JS mirrors just
 * these two values across on every change. Deliberately a mirror and not a
 * source of truth: if it is stale or absent the tile falls back to a generic
 * label and, when there is no preset at all, to opening the app.
 */
internal object TileState {
  private const val PREFS = "ignia.quickAddTile"
  private const val KEY_LABEL = "label"
  private const val KEY_ENABLED = "enabled"

  private fun prefs(context: Context): SharedPreferences =
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

  fun write(context: Context, label: String?, enabled: Boolean) {
    prefs(context).edit()
      .putString(KEY_LABEL, label)
      .putBoolean(KEY_ENABLED, enabled)
      .apply()
  }

  fun label(context: Context): String? = prefs(context).getString(KEY_LABEL, null)

  /** False also covers "JS has never run on this device", which is why the
   *  default is false rather than true: a tile that claims to log something
   *  before the app has ever said what is worse than an inert one. */
  fun enabled(context: Context): Boolean = prefs(context).getBoolean(KEY_ENABLED, false)
}
