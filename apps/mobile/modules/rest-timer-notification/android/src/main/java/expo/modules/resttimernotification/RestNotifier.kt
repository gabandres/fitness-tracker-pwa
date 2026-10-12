package expo.modules.resttimernotification

import android.Manifest
import android.app.ActivityManager
import android.app.AlarmManager
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import org.json.JSONArray
import org.json.JSONObject

/**
 * Everything the rest notification draws and every lock-screen action does,
 * in one place, so the JS-facing module ({@link RestTimerNotificationModule})
 * and the action receiver ({@link RestActionReceiver}) cannot drift.
 *
 * ## Two modes
 *
 * - **Legacy** (only `start`/`update`/`end` were called): exactly the vc 48
 *   notification — a countdown that removes itself at the deadline, no actions.
 * - **Workout** (JS called `workout(json)`, S23-8): the notification lives for
 *   the whole workout. During a rest it counts down with **−30 s / +30 s /
 *   Skip**; between rests it names the next planned set
 *   ("Bench · Set 3 of 4 · 80 kg × 8") with **Done set**. Every action moves
 *   the notification HERE, natively — the receipt the lifter sees — and leaves
 *   an inbox entry for JS (`modules/intent-inbox`), the same hand-off the iOS
 *   Live Activity buttons use (`targets/_shared/LiveActivityIntents.swift`).
 *
 * ## Android 16 Live Update (R64)
 *
 * The notification asks to be promoted (`android.requestPromotedOngoing`, the
 * extra `NotificationCompat.setRequestPromotedOngoing` writes) and meets the
 * promotable shape: ongoing, a title, no custom RemoteViews, no colorize, no
 * group summary, standard style. The manifest declares
 * `POST_PROMOTED_NOTIFICATIONS` (install-time; unknown and ignored below 16).
 * Older versions get the same ongoing countdown with the same actions, just not
 * the status-bar chip.
 *
 * ## At the deadline (round 2b, review P1-2 / P2-3)
 *
 * The rest face is posted with `setTimeoutAfter(remaining)` and a delete
 * intent: the SYSTEM removes it at the deadline — exactly, with no exact-alarm
 * permission (Play restricts those) — so it never shows a countdown run into
 * negative, and the delete intent ({@link RestActionReceiver.ACTION_TIMEOUT})
 * turns the face into "next set" at once. An inexact alarm
 * ({@link RestActionReceiver.ACTION_DEADLINE}) is the backstop for a system
 * that does not send it. Whichever comes first ends the rest; the other finds
 * nothing to do.
 *
 * **Inside a workout native owns the "Rest over" buzz** (JS skips its
 * expo-notifications schedule — `nativeOwnsRestAlert` in
 * `src/lib/rest-timer-activity.ts`). It is posted at that same deadline, once
 * per rest, and not while the app is in the foreground (the in-app bar buzzes
 * there). One owner is what lets −30 s / +30 s / Skip move it with the process
 * dead: there is no JS alarm left behind at the old deadline.
 *
 * ## Abandoned workouts (review P2-8)
 *
 * The between-sets face times out {@link ABANDON_MS} after the app last
 * touched it; every sync re-posts it, and a real workout syncs on every set.
 * Mirrors `RestActivityStore.abandonAfter` on iOS.
 */
internal object RestNotifier {
  const val CHANNEL_ID = "rest-timer-ongoing"
  const val ALERT_CHANNEL_ID = "rest-timer-alert"
  const val NOTIFICATION_ID = 7301
  const val ALERT_ID = 7302
  private const val PREFS = "ignia_rest_timer_notification"
  const val KEY_ENDS_AT = "endsAt"
  const val KEY_STARTED_AT = "startedAt"
  const val KEY_TITLE = "title"
  const val KEY_BODY = "body"
  const val KEY_CHANNEL = "channel"
  const val KEY_WORKOUT = "workout"
  const val KEY_REST_NAME = "restName"
  const val KEY_ALERT_BODY = "alertBody"
  /** The deadline whose "Rest over" was already handled (posted or skipped). */
  const val KEY_ALERTED = "alerted"
  /** Newest JS picture applied (`seq`, review P2-10). */
  const val KEY_SEQ = "seq"
  /** The idle face's lifetime without a sync — see the header. */
  const val ABANDON_MS = 3 * 60 * 60 * 1000L
  /** `NotificationCompat.EXTRA_REQUEST_PROMOTED_ONGOING` (androidx.core 1.17). */
  private const val EXTRA_REQUEST_PROMOTED_ONGOING = "android.requestPromotedOngoing"
  private const val STEP_MS = 30_000L

  private val lock = Any()

  fun prefs(context: Context) = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

  fun manager(context: Context) = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

  fun canPost(context: Context): Boolean {
    if (Build.VERSION.SDK_INT >= 33 &&
      context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
    ) {
      return false
    }
    return manager(context).areNotificationsEnabled()
  }

  // ── JS → native ─────────────────────────────────────────────────────────

  /** Legacy start/update. `title`/`body`/`channel` null = keep stored. */
  fun startLegacy(context: Context, endsAtMs: Long, title: String?, body: String?, channel: String?): String? =
    synchronized(lock) {
      val p = prefs(context)
      if (title == null && p.getString(KEY_TITLE, null) == null && p.getString(KEY_WORKOUT, null) == null) {
        return@synchronized "not-running"
      }
      val e = p.edit()
        .putLong(KEY_ENDS_AT, endsAtMs)
        .putLong(KEY_STARTED_AT, System.currentTimeMillis())
      if (title != null) e.putString(KEY_TITLE, title)
      if (body != null) e.putString(KEY_BODY, body)
      if (channel != null) e.putString(KEY_CHANNEL, channel)
      e.commit()
      render(context)
    }

  /**
   * The whole picture from JS (`src/lib/rest-timer-activity.ts` `syncNative`):
   * `{ sessionId, locale, rest: { startedAtMs, endsAtMs, title } | null,
   *    upcoming: [PlannedSet], copy: { … } }`. Nothing to show → removed.
   */
  fun workout(context: Context, json: String): String? = synchronized(lock) {
    val payload = try {
      JSONObject(json)
    } catch (e: Exception) {
      return@synchronized "bad-payload"
    }
    // Calls can reach here out of order; an older picture is dropped.
    val seq = payload.optLong("seq", 0L)
    val p = prefs(context)
    if (seq > 0 && seq < p.getLong(KEY_SEQ, 0L)) return@synchronized "stale"
    val rest = payload.optJSONObject("rest")
    val e = p.edit()
      .putString(KEY_WORKOUT, payload.toString())
      .putLong(KEY_SEQ, seq)
    if (rest != null) {
      e.putLong(KEY_ENDS_AT, rest.optLong("endsAtMs", 0L))
        .putLong(KEY_STARTED_AT, rest.optLong("startedAtMs", System.currentTimeMillis()))
        .putString(KEY_REST_NAME, rest.optString("title", ""))
        .putString(KEY_ALERT_BODY, rest.optString("alertBody", ""))
    } else {
      e.putLong(KEY_ENDS_AT, 0L)
    }
    e.commit()
    render(context)
  }

  fun end(context: Context): String? = synchronized(lock) {
    try {
      manager(context).cancel(NOTIFICATION_ID)
      cancelDeadline(context)
      prefs(context).edit().clear().commit()
      null
    } catch (e: Exception) {
      e.toString()
    }
  }

  /** `running:<endsAt>` (a rest, maybe past its deadline), `idle` (between
   *  sets), `stopped`, `disabled`, `unavailable`. */
  fun status(context: Context): String = try {
    if (!canPost(context)) {
      "disabled"
    } else {
      val showing = manager(context).activeNotifications.any { it.id == NOTIFICATION_ID }
      val endsAt = prefs(context).getLong(KEY_ENDS_AT, 0L)
      when {
        showing && endsAt > 0 -> "running:$endsAt"
        showing -> "idle"
        else -> "stopped"
      }
    }
  } catch (e: Exception) {
    "unavailable"
  }

  // ── Lock-screen actions (RestActionReceiver) ─────────────────────────────

  fun onAction(context: Context, action: String, extraEndsAt: Long) = synchronized(lock) {
    val p = prefs(context)
    val workout = p.getString(KEY_WORKOUT, null)?.let { runCatching { JSONObject(it) }.getOrNull() }
    val now = System.currentTimeMillis()
    val endsAt = p.getLong(KEY_ENDS_AT, 0L)
    when (action) {
      RestActionReceiver.ACTION_ADD -> {
        if (workout == null) return@synchronized
        val base = if (endsAt > now) endsAt else now
        val next = base + STEP_MS
        val e = p.edit().putLong(KEY_ENDS_AT, next)
        // +30 s on a rest that already ran out is a fresh 30 s from now.
        if (endsAt <= now) e.putLong(KEY_STARTED_AT, now)
        e.commit()
        postInbox(context, JSONObject().put("kind", "rest").put("atMs", now).put("endsAtMs", next))
      }
      RestActionReceiver.ACTION_SUB -> {
        if (workout == null || endsAt <= now) return@synchronized
        val next = endsAt - STEP_MS
        // Below a second left is a stop, as the in-app −30 s past zero is.
        val stored = if (next - now < 1_000L) 0L else next
        p.edit().putLong(KEY_ENDS_AT, stored).commit()
        postInbox(context, JSONObject().put("kind", "rest").put("atMs", now).put("endsAtMs", stored))
      }
      RestActionReceiver.ACTION_SKIP -> {
        p.edit().putLong(KEY_ENDS_AT, 0L).commit()
        // `endsAtMs: 0` is the inbox's word for "skipped" (silent).
        postInbox(context, JSONObject().put("kind", "rest").put("atMs", now).put("endsAtMs", 0))
      }
      RestActionReceiver.ACTION_DONE_SET -> {
        if (workout == null) return@synchronized
        val upcoming = workout.optJSONArray("upcoming") ?: return@synchronized
        val head = upcoming.optJSONObject(0) ?: return@synchronized
        val rest = JSONArray()
        for (i in 1 until upcoming.length()) rest.put(upcoming.get(i))
        workout.put("upcoming", rest)
        val restSec = head.optDouble("restSec", 0.0)
        val restEnds = if (restSec > 0) now + (restSec * 1000).toLong() else 0L
        p.edit()
          .putString(KEY_WORKOUT, workout.toString())
          .putLong(KEY_ENDS_AT, restEnds)
          .putLong(KEY_STARTED_AT, now)
          .putString(KEY_REST_NAME, head.optString("name", ""))
          // A rest native started: the default "Rest over" text.
          .putString(KEY_ALERT_BODY, "")
          .commit()
        val entry = JSONObject()
          .put("kind", "set")
          .put("atMs", now)
          .put("sessionId", workout.optString("sessionId", ""))
          .put("exerciseId", head.optString("exerciseId", ""))
          .put("exerciseIndex", head.optInt("exerciseIndex", -1))
          .put("setIndex", head.optInt("setIndex", -1))
          .put("endsAtMs", restEnds)
        for (k in listOf("weight", "reps", "durationSec", "setKind", "group", "setCount")) {
          if (head.has(k)) entry.put(k, head.get(k))
        }
        postInbox(context, entry)
      }
      RestActionReceiver.ACTION_DEADLINE, RestActionReceiver.ACTION_TIMEOUT -> {
        // Only for the rest still showing (a moved rest re-armed its own), and
        // only once it is really over: a delete intent before the deadline is
        // the lifter swiping the face away, which is theirs to do.
        if (workout == null || endsAt <= 0 || extraEndsAt != endsAt || now < endsAt - 1_500L) {
          return@synchronized
        }
        p.edit().putLong(KEY_ENDS_AT, 0L).commit()
        if (p.getLong(KEY_ALERTED, 0L) != endsAt) {
          p.edit().putLong(KEY_ALERTED, endsAt).commit()
          if (!appInForeground()) {
            alertRestOver(context, workout.optJSONObject("copy"), p.getString(KEY_ALERT_BODY, "") ?: "")
          }
        }
      }
      else -> return@synchronized
    }
    render(context)
  }

  // ── Drawing ──────────────────────────────────────────────────────────────

  /** Post (or remove) the notification for what is stored. `null` = posted. */
  fun render(context: Context): String? {
    return try {
      if (!canPost(context)) return "disabled"
      val p = prefs(context)
      val workout = p.getString(KEY_WORKOUT, null)?.let { runCatching { JSONObject(it) }.getOrNull() }
      if (workout == null) renderLegacy(context) else renderWorkout(context, workout)
    } catch (e: Exception) {
      e.toString()
    }
  }

  private fun renderLegacy(context: Context): String? {
    val p = prefs(context)
    val endsAt = p.getLong(KEY_ENDS_AT, 0L)
    val title = p.getString(KEY_TITLE, null) ?: return "not-running"
    val remaining = endsAt - System.currentTimeMillis()
    if (remaining <= 0) {
      manager(context).cancel(NOTIFICATION_ID)
      return "past"
    }
    ensureChannel(context, p.getString(KEY_CHANNEL, "") ?: "")
    val n = base(context)
      .setContentTitle(title)
      .setContentText(p.getString(KEY_BODY, "") ?: "")
      .setShowWhen(true)
      .setWhen(endsAt)
      .setUsesChronometer(true)
      .setChronometerCountDown(true)
      .setTimeoutAfter(remaining)
      .build()
    manager(context).notify(NOTIFICATION_ID, n)
    return null
  }

  private fun renderWorkout(context: Context, workout: JSONObject): String? {
    val p = prefs(context)
    val copy = workout.optJSONObject("copy") ?: JSONObject()
    val now = System.currentTimeMillis()
    val endsAt = p.getLong(KEY_ENDS_AT, 0L)
    val head = workout.optJSONArray("upcoming")?.optJSONObject(0)
    val m = manager(context)
    ensureChannel(context, copy.optString("channel", ""))

    if (endsAt > now) {
      val name = p.getString(KEY_REST_NAME, "") ?: ""
      val title = copy.optString("restTitle", "{name}").replace("{name}", name)
      val text = head?.let { copy.optString("nextLine", "{label}").replace("{label}", it.optString("label")) }
        ?: copy.optString("body", "")
      val b = base(context)
        .setContentTitle(title)
        .setContentText(text)
        .setShowWhen(true)
        .setWhen(endsAt)
        .setUsesChronometer(true)
        .setChronometerCountDown(true)
        .addAction(action(context, RestActionReceiver.ACTION_SUB, copy.optString("sub30", "−30 s")))
        .addAction(action(context, RestActionReceiver.ACTION_ADD, copy.optString("add30", "+30 s")))
        .addAction(action(context, RestActionReceiver.ACTION_SKIP, copy.optString("skip", "Skip")))
        // The system removes it AT the deadline — no countdown into negative
        // — and the delete intent flips it to the next set (header).
        .setTimeoutAfter(endsAt - now)
        .setDeleteIntent(timeoutIntent(context, endsAt))
      m.notify(NOTIFICATION_ID, b.build())
      scheduleDeadline(context, endsAt)
      return null
    }

    cancelDeadline(context)
    // A rest that ran out is over: `status` then says `idle`, not a past
    // `running:` that JS's reconcile would read as an orphan to end.
    if (endsAt > 0) p.edit().putLong(KEY_ENDS_AT, 0L).commit()
    if (head == null) {
      // Between sets with nothing plannable left: nothing true to show.
      m.cancel(NOTIFICATION_ID)
      return "nothing-next"
    }
    val b = base(context)
      .setContentTitle(copy.optString("upNext", "Up next"))
      .setContentText(head.optString("label"))
      .setShowWhen(false)
      .setTimeoutAfter(ABANDON_MS)
      .addAction(action(context, RestActionReceiver.ACTION_DONE_SET, copy.optString("doneSet", "Done set")))
    if (Build.VERSION.SDK_INT >= 36) {
      val chip = copy.optString("upNext", "")
      if (chip.isNotEmpty()) b.setShortCriticalText(chip)
    }
    m.notify(NOTIFICATION_ID, b.build())
    return null
  }

  /** What every face shares: silent, ongoing, public, promotable. */
  private fun base(context: Context): Notification.Builder {
    val b = Notification.Builder(context, CHANNEL_ID)
      .setSmallIcon(R.drawable.ignia_rest_timer)
      .setCategory(Notification.CATEGORY_STOPWATCH)
      .setOngoing(true)
      .setOnlyAlertOnce(true)
      .setColorized(false)
      .setVisibility(Notification.VISIBILITY_PUBLIC)
    launchIntent(context)?.let { b.setContentIntent(it) }
    // R64: ask for promotion. Harmless where the extra means nothing.
    b.extras.putBoolean(EXTRA_REQUEST_PROMOTED_ONGOING, true)
    return b
  }

  private fun ensureChannel(context: Context, name: String) {
    val m = manager(context)
    if (m.getNotificationChannel(CHANNEL_ID) == null || name.isNotBlank()) {
      m.createNotificationChannel(
        NotificationChannel(CHANNEL_ID, name.ifBlank { "Rest timer" }, NotificationManager.IMPORTANCE_LOW).apply {
          setShowBadge(false)
          enableVibration(false)
          setSound(null, null)
        },
      )
    }
  }

  private fun launchIntent(context: Context): PendingIntent? {
    val launch = context.packageManager.getLaunchIntentForPackage(context.packageName)?.apply {
      addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP)
    } ?: return null
    return PendingIntent.getActivity(
      context,
      NOTIFICATION_ID,
      launch,
      PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
    )
  }

  private fun action(context: Context, name: String, label: String): Notification.Action {
    val intent = Intent(context, RestActionReceiver::class.java).setAction(name)
    val pi = PendingIntent.getBroadcast(
      context,
      RestActionReceiver.requestCode(name),
      intent,
      PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
    )
    return Notification.Action.Builder(null, label, pi).build()
  }

  private fun timeoutIntent(context: Context, endsAt: Long): PendingIntent {
    val intent = Intent(context, RestActionReceiver::class.java)
      .setAction(RestActionReceiver.ACTION_TIMEOUT)
      .putExtra(RestActionReceiver.EXTRA_ENDS_AT, endsAt)
    return PendingIntent.getBroadcast(
      context,
      RestActionReceiver.requestCode(RestActionReceiver.ACTION_TIMEOUT),
      intent,
      PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
    )
  }

  /** The app is on screen: its own bar buzzes and announces the rest's end. */
  private fun appInForeground(): Boolean = try {
    val info = ActivityManager.RunningAppProcessInfo()
    ActivityManager.getMyMemoryState(info)
    info.importance <= ActivityManager.RunningAppProcessInfo.IMPORTANCE_FOREGROUND
  } catch (e: Exception) {
    false
  }

  private fun deadlineIntent(context: Context, endsAt: Long): PendingIntent {
    val intent = Intent(context, RestActionReceiver::class.java)
      .setAction(RestActionReceiver.ACTION_DEADLINE)
      .putExtra(RestActionReceiver.EXTRA_ENDS_AT, endsAt)
    return PendingIntent.getBroadcast(
      context,
      RestActionReceiver.requestCode(RestActionReceiver.ACTION_DEADLINE),
      intent,
      PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
    )
  }

  private fun scheduleDeadline(context: Context, endsAt: Long) {
    try {
      val am = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
      val pi = deadlineIntent(context, endsAt)
      if (Build.VERSION.SDK_INT < 31 || am.canScheduleExactAlarms()) {
        am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, endsAt, pi)
      } else {
        am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, endsAt, pi)
      }
    } catch (e: Exception) {
      // No alarm: the face stays on its countdown until JS next syncs.
    }
  }

  private fun cancelDeadline(context: Context) {
    try {
      val am = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
      am.cancel(deadlineIntent(context, 0L))
    } catch (e: Exception) {
      // Nothing scheduled, or not cancellable: a stale alarm re-checks its
      // deadline against the stored one and does nothing.
    }
  }

  /** The "Rest over" buzz, which native owns inside a workout (header).
   *  `body` is the running rest's own text (a superset's next station), else
   *  the default. */
  private fun alertRestOver(context: Context, copy: JSONObject?, body: String) {
    try {
      if (!canPost(context)) return
      val m = manager(context)
      if (m.getNotificationChannel(ALERT_CHANNEL_ID) == null) {
        m.createNotificationChannel(
          NotificationChannel(
            ALERT_CHANNEL_ID,
            copy?.optString("alertChannel", "")?.ifBlank { null } ?: "Rest over",
            NotificationManager.IMPORTANCE_HIGH,
          ),
        )
      }
      val b = Notification.Builder(context, ALERT_CHANNEL_ID)
        .setSmallIcon(R.drawable.ignia_rest_timer)
        .setContentTitle(copy?.optString("restOverTitle", "Rest over") ?: "Rest over")
        .setContentText(body.ifBlank { copy?.optString("restOverBody", "") ?: "" })
        .setCategory(Notification.CATEGORY_REMINDER)
        .setAutoCancel(true)
        .setTimeoutAfter(5 * 60_000L)
      launchIntent(context)?.let { b.setContentIntent(it) }
      m.notify(ALERT_ID, b.build())
    } catch (e: Exception) {
      // A lost buzz, not a lost set.
    }
  }

  /**
   * Hand an entry to the intent inbox. **The class name, action and extra are
   * a contract with `modules/intent-inbox/android/…/IntentInboxStore.kt`**
   * (`IntentInboxPostReceiver`) — another Gradle module, so not importable;
   * `src/__tests__/live-activity-contracts.test.ts` greps both.
   */
  private fun postInbox(context: Context, entry: JSONObject) {
    try {
      val intent = Intent()
        .setClassName(context.packageName, INBOX_RECEIVER)
        .setAction(INBOX_ACTION_POST)
        .putExtra(INBOX_EXTRA_ENTRY, entry.toString())
      context.sendBroadcast(intent)
    } catch (e: Exception) {
      // The notification already moved; the app re-syncs it on the next drain.
    }
  }

  private const val INBOX_RECEIVER = "expo.modules.intentinbox.IntentInboxPostReceiver"
  private const val INBOX_ACTION_POST = "fit.ignia.intentInbox.POST"
  private const val INBOX_EXTRA_ENTRY = "entry"
}
