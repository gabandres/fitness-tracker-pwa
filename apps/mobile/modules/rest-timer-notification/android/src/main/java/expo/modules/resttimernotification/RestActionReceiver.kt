package expo.modules.resttimernotification

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/**
 * The rest notification's lock-screen buttons (−30 s, +30 s, Skip, Done set),
 * its delete intent (the system timing the rest face out at the deadline) and
 * its backstop deadline alarm — the Android counterpart of the iOS Live Activity's
 * `LiveActivityIntents.swift`. Runs without the JS runtime (the process may
 * have been started just for this), does its work in {@link RestNotifier}, and
 * returns at once: a few SharedPreferences writes and one `notify`.
 *
 * Declared `exported="false"` in this module's manifest; every PendingIntent
 * that reaches it is explicit and immutable.
 */
class RestActionReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    val action = intent.action ?: return
    try {
      RestNotifier.onAction(context.applicationContext, action, intent.getLongExtra(EXTRA_ENDS_AT, 0L))
    } catch (e: Exception) {
      // A button that throws must not crash the app's process in the background.
    }
  }

  companion object {
    const val ACTION_SUB = "fit.ignia.rest.SUB30"
    const val ACTION_ADD = "fit.ignia.rest.ADD30"
    const val ACTION_SKIP = "fit.ignia.rest.SKIP"
    const val ACTION_DONE_SET = "fit.ignia.rest.DONE_SET"
    const val ACTION_DEADLINE = "fit.ignia.rest.DEADLINE"
    /** The rest face's delete intent: the system timed it out at the deadline
     *  (or the lifter swiped it away — `RestNotifier` tells the two apart). */
    const val ACTION_TIMEOUT = "fit.ignia.rest.TIMEOUT"
    const val EXTRA_ENDS_AT = "endsAt"

    /** One PendingIntent slot per action, so FLAG_UPDATE_CURRENT on one never
     *  rewrites another. */
    fun requestCode(action: String): Int = when (action) {
      ACTION_SUB -> 7311
      ACTION_ADD -> 7312
      ACTION_SKIP -> 7313
      ACTION_DONE_SET -> 7314
      ACTION_DEADLINE -> 7315
      ACTION_TIMEOUT -> 7316
      else -> 7310
    }
  }
}
