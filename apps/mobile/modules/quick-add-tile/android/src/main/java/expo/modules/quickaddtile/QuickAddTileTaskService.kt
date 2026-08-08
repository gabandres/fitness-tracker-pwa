package expo.modules.quickaddtile

import android.content.Intent
import com.facebook.react.HeadlessJsTaskService
import com.facebook.react.bridge.Arguments
import com.facebook.react.jstasks.HeadlessJsTaskConfig

/**
 * Starts the JS that actually writes the log.
 *
 * The whole point of routing a Kotlin tile through headless JS is that the write
 * then reuses `src/lib/ledger.ts` — auth persists through AsyncStorage, so a JS
 * context woken with no UI still has the signed-in session (ADR-0020). Doing it
 * natively would mean a second Firestore client in a codebase whose one hard rule
 * is a single SDK copy, for a write JS can already do.
 *
 * `allowedInForeground = true`: the app is very often already running when a tile
 * is tapped, and the default (false) silently drops the task in exactly that
 * case — a tile that works only while the app is closed.
 *
 * The 15s timeout is generous for one `setDoc`, and it has to cover a cold JS
 * context start (bundle load) plus the auth rehydrate the write waits on.
 */
class QuickAddTileTaskService : HeadlessJsTaskService() {
  override fun getTaskConfig(intent: Intent?): HeadlessJsTaskConfig =
    HeadlessJsTaskConfig(
      TASK_NAME,
      Arguments.fromBundle(intent?.extras ?: android.os.Bundle()),
      15_000,
      true,
    )

  companion object {
    /** Must equal the name `index.js` registers with `registerHeadlessTask`. A
     *  mismatch is silent: the service starts, finds no task, and stops. */
    const val TASK_NAME = "IgniaQuickAddTile"
  }
}
