package expo.modules.blockstore

import com.google.android.gms.auth.blockstore.Blockstore
import com.google.android.gms.auth.blockstore.BlockstoreClient
import com.google.android.gms.auth.blockstore.DeleteBytesRequest
import com.google.android.gms.auth.blockstore.RetrieveBytesRequest
import com.google.android.gms.auth.blockstore.StoreBytesData
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Block Store — Play Services' backup-and-restore key/value store.
 *
 * ## Why this exists rather than the Restore Credentials API
 *
 * Play's Zero-Tap Sign-In requirement (April 2027) names the Restore Credentials
 * API, which is WebAuthn end to end: its own docs list "set up a relying party
 * server" as a PREREQUISITE, and Ignia has no app server by design — the whole
 * access-control layer is `firestore.rules` plus Firebase Auth.
 *
 * Google accepts a Block Store integration as compliant instead, on one
 * condition: it must be **completed and in production on or before 30 September
 * 2026**. After that date only Restore Credentials counts. Block Store needs no
 * server at all, so this is a fraction of the work — see issue #107 for the
 * comparison and the delivery risk.
 *
 * ## What it actually does
 *
 * Bytes written here are backed up by Google alongside the device backup and
 * handed back when the user restores onto a new Android device. Nothing here
 * talks to Ignia's own infrastructure.
 *
 * Limits, from the Play Services docs: **16 entries, 4 KB each**. The caller is
 * expected to stay well inside that — see `session-restore.ts`, which strips the
 * expiring access token specifically so the payload does not approach 4 KB.
 *
 * ## Everything is best-effort on purpose
 *
 * Every method resolves rather than rejects on failure. Block Store is absent on
 * devices without Play Services and can decline for reasons the app cannot fix
 * or usefully report, and this whole feature is an OPTIMISATION: if it does
 * nothing, the user signs in the way they always have. A rejection here would
 * surface inside the boot gate, which is the one place an exception must never
 * reach.
 */
class BlockStoreModule : Module() {
  private val client: BlockstoreClient by lazy { Blockstore.getClient(appContext.reactContext!!) }

  override fun definition() = ModuleDefinition {
    Name("BlockStore")

    /** Store one UTF-8 string under `key`. Resolves false if it could not. */
    AsyncFunction("storeBytes") { key: String, value: String, promise: Promise ->
      try {
        val request = StoreBytesData.Builder()
          .setBytes(value.toByteArray(Charsets.UTF_8))
          .setKeys(listOf(key))
          // Ask for end-to-end encryption where the device supports it (Android
          // 9+ with a screen lock). This is a REQUEST, not a guarantee — Play
          // Services falls back to its normal backup encryption otherwise, which
          // is why `isE2eeAvailable` is exposed separately for the caller to
          // decide what it is willing to store.
          .setShouldBackupToCloud(true)
          .build()
        client.storeBytes(request)
          .addOnSuccessListener { promise.resolve(true) }
          .addOnFailureListener { promise.resolve(false) }
      } catch (_: Throwable) {
        promise.resolve(false)
      }
    }

    /** Read the string stored under `key`, or null when there is none. */
    AsyncFunction("retrieveBytes") { key: String, promise: Promise ->
      try {
        val request = RetrieveBytesRequest.Builder().setKeys(listOf(key)).build()
        client.retrieveBytes(request)
          .addOnSuccessListener { response ->
            val entry = response.blockstoreDataMap[key]
            promise.resolve(entry?.bytes?.toString(Charsets.UTF_8))
          }
          .addOnFailureListener { promise.resolve(null) }
      } catch (_: Throwable) {
        promise.resolve(null)
      }
    }

    /** Forget `key`. Called on sign-out and on account deletion. */
    AsyncFunction("deleteBytes") { key: String, promise: Promise ->
      try {
        val request = DeleteBytesRequest.Builder().setKeys(listOf(key)).build()
        client.deleteBytes(request)
          .addOnSuccessListener { promise.resolve(true) }
          .addOnFailureListener { promise.resolve(false) }
      } catch (_: Throwable) {
        promise.resolve(false)
      }
    }

    /**
     * Whether this device can end-to-end encrypt the backup — Android 9+ with a
     * screen lock. Reported so the caller can refuse to store a refresh token on
     * a device that would back it up without it.
     */
    AsyncFunction("isE2eeAvailable") { promise: Promise ->
      try {
        client.isEndToEndEncryptionAvailable
          .addOnSuccessListener { available -> promise.resolve(available) }
          .addOnFailureListener { promise.resolve(false) }
      } catch (_: Throwable) {
        promise.resolve(false)
      }
    }
  }
}
