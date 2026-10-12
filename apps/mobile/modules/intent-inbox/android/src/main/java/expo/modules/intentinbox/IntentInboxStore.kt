package expo.modules.intentinbox

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import org.json.JSONArray
import org.json.JSONObject

/**
 * The Android half of the intent inbox (S23-8): what a lock-screen action left
 * for the React Native app — the same list, the same shape and the same rules
 * as `targets/_shared/IntentInbox.swift`, so the one JS reader
 * (`modules/intent-inbox/index.ts`) serves both platforms.
 *
 * ## Why an inbox at all on Android
 *
 * The rest notification's −30 s / +30 s / Skip / Done set run in a
 * BroadcastReceiver (`modules/rest-timer-notification`), natively, while JS may
 * be paused or the process cold. They move the notification themselves — the
 * user's receipt — but the in-app rest bar and the ticked set are JS state, so
 * each one also leaves an entry here that `ActiveSession` applies: at once when
 * the JS runtime is listening (the doorbell, {@link IntentInboxModule.ring}),
 * else on the next mount / foreground drain.
 *
 * ## Storage
 *
 * A JSON array in app-private SharedPreferences, `commit()`ed so a receiver
 * whose process dies right after `onReceive` has still written. Every read and
 * write goes through this object under one lock, so a JS `take` and a
 * receiver's `post` cannot interleave and lose an entry — which is why the
 * writer in the other module does not write the preferences itself but
 * broadcasts to {@link IntentInboxPostReceiver}.
 */
object IntentInboxStore {
  /** Preferences file. Private to this module; the writer never opens it. */
  private const val PREFS = "ignia_intent_inbox"
  /** Same key name as `IntentInbox.key` on iOS, for grep-ability. */
  private const val KEY = "ignia.intentInbox.v1"
  /** Bounded, oldest first out — as on iOS. */
  private const val MAX = 20
  /** Kinds that only ever mean "the latest state" (`IntentInbox.latestWins`). */
  private val LATEST_WINS = setOf("rest")

  private val lock = Any()

  /**
   * Append one entry (a JSON object string carrying at least `kind` and
   * `atMs`) and ring the doorbell. Malformed input is dropped, never thrown.
   */
  fun post(context: Context, entryJson: String) {
    synchronized(lock) {
      val entry = try {
        JSONObject(entryJson)
      } catch (e: Exception) {
        return
      }
      val kind = entry.optString("kind", "")
      if (kind.isEmpty()) return
      if (!entry.has("atMs")) entry.put("atMs", System.currentTimeMillis())
      val list = read(context)
      val kept = JSONArray()
      for (i in 0 until list.length()) {
        val o = list.optJSONObject(i) ?: continue
        if (kind in LATEST_WINS && o.optString("kind") == kind) continue
        kept.put(o)
      }
      kept.put(entry)
      val start = (kept.length() - MAX).coerceAtLeast(0)
      val bounded = JSONArray()
      for (i in start until kept.length()) bounded.put(kept.get(i))
      write(context, bounded)
    }
    IntentInboxModule.ring()
  }

  /** Remove (or only read) the entries whose kind is in `kinds`, as a JSON
   *  array string; `"[]"` when there are none. */
  fun transact(context: Context, kinds: Set<String>, remove: Boolean): String {
    synchronized(lock) {
      val list = read(context)
      val matching = JSONArray()
      val rest = JSONArray()
      for (i in 0 until list.length()) {
        val o = list.optJSONObject(i) ?: continue
        if (o.optString("kind") in kinds) matching.put(o) else rest.put(o)
      }
      if (remove && matching.length() > 0) write(context, rest)
      return matching.toString()
    }
  }

  /** Remove the entries of `kinds` whose `atMs` is in `atMs`; how many went. */
  fun remove(context: Context, kinds: Set<String>, atMs: Set<Long>): Int {
    synchronized(lock) {
      val list = read(context)
      val keep = JSONArray()
      for (i in 0 until list.length()) {
        val o = list.optJSONObject(i) ?: continue
        val match = o.optString("kind") in kinds && Math.round(o.optDouble("atMs", -1.0)) in atMs
        if (!match) keep.put(o)
      }
      val removed = list.length() - keep.length()
      if (removed > 0) write(context, keep)
      return removed
    }
  }

  private fun read(context: Context): JSONArray {
    val raw = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY, null) ?: return JSONArray()
    return try {
      JSONArray(raw)
    } catch (e: Exception) {
      JSONArray()
    }
  }

  private fun write(context: Context, list: JSONArray) {
    val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
    if (list.length() == 0) prefs.remove(KEY) else prefs.putString(KEY, list.toString())
    prefs.commit()
  }
}

/**
 * The writer's door into {@link IntentInboxStore}. Another Gradle module cannot
 * see this one's classes (the same wall `IntentInboxModule.swift` documents for
 * CocoaPods), so a writer sends an explicit broadcast:
 *
 * ```
 * Intent().setClassName(context, "expo.modules.intentinbox.IntentInboxPostReceiver")
 *   .setAction(ACTION_POST).putExtra(EXTRA_ENTRY, json)
 * ```
 *
 * **The class name, action and extra are a contract with
 * `RestActionReceiver.kt`** — `src/__tests__/live-activity-contracts.test.ts`
 * greps both. Declared `exported="false"` in this module's manifest.
 */
class IntentInboxPostReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    if (intent.action != ACTION_POST) return
    val entry = intent.getStringExtra(EXTRA_ENTRY) ?: return
    IntentInboxStore.post(context.applicationContext, entry)
  }

  companion object {
    const val ACTION_POST = "fit.ignia.intentInbox.POST"
    const val EXTRA_ENTRY = "entry"
  }
}
