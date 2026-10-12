package expo.modules.intentinbox

import android.content.Context
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.lang.ref.WeakReference

/**
 * The JS side of the Android intent inbox — the counterpart of
 * `ios/IntentInboxModule.swift`, with the same three functions so
 * `modules/intent-inbox/index.ts` needs no platform branch: `take`, `peek` and
 * the `onChange` doorbell. Storage and its lock live in
 * {@link IntentInboxStore}; read its header for why Android has an inbox.
 *
 * ## The doorbell
 *
 * iOS rings through a Darwin notification. Here the writer runs in this same
 * process (a BroadcastReceiver), so the store calls {@link ring} directly,
 * which forwards to the module instance that is observing — if any. A ring with
 * nobody listening is lost, which is fine: the list is the source of truth and
 * JS also drains on mount and on foreground.
 */
class IntentInboxModule : Module() {
  private val context: Context
    get() = requireNotNull(appContext.reactContext) { "React context is not available" }

  override fun definition() = ModuleDefinition {
    Name("IntentInbox")

    Events("onChange")

    OnStartObserving {
      live = WeakReference(this@IntentInboxModule)
    }

    OnStopObserving {
      if (live?.get() === this@IntentInboxModule) live = null
    }

    OnDestroy {
      if (live?.get() === this@IntentInboxModule) live = null
    }

    AsyncFunction("take") { kinds: List<String> ->
      try {
        IntentInboxStore.transact(context, kinds.toSet(), remove = true)
      } catch (e: Exception) {
        "[]"
      }
    }

    /** Remove entries of these kinds with exactly these `atMs` — after the app
     *  applied them (peek → apply → remove, S23-8 round 2b). */
    AsyncFunction("remove") { kinds: List<String>, atMs: List<Double> ->
      try {
        IntentInboxStore.remove(context, kinds.toSet(), atMs.map { Math.round(it) }.toSet()).toString()
      } catch (e: Exception) {
        "0"
      }
    }

    AsyncFunction("peek") { kinds: List<String> ->
      try {
        IntentInboxStore.transact(context, kinds.toSet(), remove = false)
      } catch (e: Exception) {
        "[]"
      }
    }
  }

  companion object {
    @Volatile
    private var live: WeakReference<IntentInboxModule>? = null

    /** Tell a listening JS runtime the inbox changed. Never throws. */
    fun ring() {
      try {
        live?.get()?.sendEvent("onChange", emptyMap<String, Any>())
      } catch (e: Exception) {
        // A doorbell is latency, not data.
      }
    }
  }
}
