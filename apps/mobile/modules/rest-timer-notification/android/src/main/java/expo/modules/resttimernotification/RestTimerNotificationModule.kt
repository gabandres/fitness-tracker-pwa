package expo.modules.resttimernotification

import android.content.Context
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * The Android half of the rest countdown outside the app (iOS draws it as a
 * Live Activity, `modules/rest-timer-activity`). Android has no Live Activity;
 * what Strong and Hevy show instead is an ongoing notification whose header
 * counts down — `setUsesChronometer` + `setChronometerCountDown` with `when`
 * set to the deadline. The SYSTEM ticks it, so it keeps counting while the JS
 * runtime is suspended, exactly as the Live Activity does.
 *
 * Silent by construction (an IMPORTANCE_LOW channel, `setOnlyAlertOnce`): the
 * buzz at the end of a rest is still the separate local "Rest over"
 * notification `useRestTimer` schedules. This one only shows the time LEFT,
 * and removes itself at the deadline (`setTimeoutAfter`) so it never sits at
 * "-0:12".
 *
 * Every function resolves with `null` on success or a reason string, and none
 * throws — a countdown that fails must not be able to fail a ticked set.
 * Strings arrive from JS already localised (`src/lib/rest-timer-activity.ts`).
 *
 * Since S23-8 the drawing and the lock-screen actions live in
 * {@link RestNotifier} (shared with {@link RestActionReceiver}); this class is
 * only the JS bridge. `workout(json)` is new in that binary — JS checks for it
 * before calling, so an older binary keeps the four functions above.
 */
class RestTimerNotificationModule : Module() {
  private val context: Context
    get() = requireNotNull(appContext.reactContext) { "React context is not available" }

  override fun definition() = ModuleDefinition {
    Name("RestTimerNotification")

    AsyncFunction("start") { endsAtMs: Double, title: String, body: String, channelName: String ->
      RestNotifier.startLegacy(context, endsAtMs.toLong(), title, body, channelName)
    }

    AsyncFunction("update") { endsAtMs: Double ->
      RestNotifier.startLegacy(context, endsAtMs.toLong(), null, null, null)
    }

    AsyncFunction("end") {
      RestNotifier.end(context)
    }

    AsyncFunction("status") {
      RestNotifier.status(context)
    }

    /** The whole workout picture (S23-8) — see `RestNotifier.workout`. */
    AsyncFunction("workout") { json: String ->
      RestNotifier.workout(context, json)
    }
  }
}
