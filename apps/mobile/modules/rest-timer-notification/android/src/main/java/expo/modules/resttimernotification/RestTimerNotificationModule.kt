package expo.modules.resttimernotification

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
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
 */
class RestTimerNotificationModule : Module() {
  private val context: Context
    get() = requireNotNull(appContext.reactContext) { "React context is not available" }

  override fun definition() = ModuleDefinition {
    Name("RestTimerNotification")

    AsyncFunction("start") { endsAtMs: Double, title: String, body: String, channelName: String ->
      prefs().edit()
        .putLong(KEY_ENDS_AT, endsAtMs.toLong())
        .putString(KEY_TITLE, title)
        .putString(KEY_BODY, body)
        .putString(KEY_CHANNEL, channelName)
        .apply()
      post(endsAtMs.toLong(), title, body, channelName)
    }

    AsyncFunction("update") { endsAtMs: Double ->
      val p = prefs()
      val title = p.getString(KEY_TITLE, null) ?: return@AsyncFunction "not-running"
      p.edit().putLong(KEY_ENDS_AT, endsAtMs.toLong()).apply()
      post(endsAtMs.toLong(), title, p.getString(KEY_BODY, "") ?: "", p.getString(KEY_CHANNEL, "") ?: "")
    }

    AsyncFunction("end") {
      try {
        manager().cancel(NOTIFICATION_ID)
        prefs().edit().clear().apply()
        null
      } catch (e: Exception) {
        e.toString()
      }
    }

    AsyncFunction("status") {
      try {
        if (!canPost()) return@AsyncFunction "disabled"
        val showing = manager().activeNotifications.any { it.id == NOTIFICATION_ID }
        val endsAt = prefs().getLong(KEY_ENDS_AT, 0L)
        if (showing && endsAt > 0) "running:$endsAt" else "stopped"
      } catch (e: Exception) {
        "unavailable"
      }
    }
  }

  private fun prefs() = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

  private fun manager() = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

  private fun canPost(): Boolean {
    if (Build.VERSION.SDK_INT >= 33 &&
      context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
    ) {
      return false
    }
    return manager().areNotificationsEnabled()
  }

  private fun post(endsAtMs: Long, title: String, body: String, channelName: String): String? {
    return try {
      if (!canPost()) return "disabled"
      val remaining = endsAtMs - System.currentTimeMillis()
      if (remaining <= 0) {
        manager().cancel(NOTIFICATION_ID)
        return "past"
      }
      val m = manager()
      if (m.getNotificationChannel(CHANNEL_ID) == null || channelName.isNotBlank()) {
        m.createNotificationChannel(
          NotificationChannel(
            CHANNEL_ID,
            channelName.ifBlank { "Rest timer" },
            NotificationManager.IMPORTANCE_LOW,
          ).apply {
            setShowBadge(false)
            enableVibration(false)
            setSound(null, null)
          },
        )
      }
      val launch = context.packageManager.getLaunchIntentForPackage(context.packageName)?.apply {
        addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP)
      }
      val tap = launch?.let {
        PendingIntent.getActivity(
          context,
          NOTIFICATION_ID,
          it,
          PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
      }
      val notification = Notification.Builder(context, CHANNEL_ID)
        .setSmallIcon(R.drawable.ignia_rest_timer)
        .setContentTitle(title)
        .setContentText(body)
        .setCategory(Notification.CATEGORY_STOPWATCH)
        .setOngoing(true)
        .setOnlyAlertOnce(true)
        .setShowWhen(true)
        .setWhen(endsAtMs)
        .setUsesChronometer(true)
        .setChronometerCountDown(true)
        .setTimeoutAfter(remaining)
        .setVisibility(Notification.VISIBILITY_PUBLIC)
        .apply { if (tap != null) setContentIntent(tap) }
        .build()
      m.notify(NOTIFICATION_ID, notification)
      null
    } catch (e: Exception) {
      e.toString()
    }
  }

  companion object {
    private const val CHANNEL_ID = "rest-timer-ongoing"
    private const val NOTIFICATION_ID = 7301
    private const val PREFS = "ignia_rest_timer_notification"
    private const val KEY_ENDS_AT = "endsAt"
    private const val KEY_TITLE = "title"
    private const val KEY_BODY = "body"
    private const val KEY_CHANNEL = "channel"
  }
}
