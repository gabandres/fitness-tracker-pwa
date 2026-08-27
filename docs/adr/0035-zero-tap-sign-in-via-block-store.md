# ADR-0035: Zero-Tap Sign-In rides Block Store, not the API Play names

- **Status:** **accepted** 2026-08-27 — implemented on `feat/zero-tap-block-store`,
  **not merged**. It moves the Android fingerprint, so merging shuts the Android
  OTA channel until vc 40 ships. Compliance depends on a delivery deadline that
  is not ours to control; see *Consequences*.
- **Date:** 2026-08-27
- **Touches:** `apps/mobile/modules/block-store/` (new Android-only Expo module),
  `apps/mobile/src/lib/session-restore.ts`, `firebase-config.ts` (new, split out
  of `firebase.ts`), the sign-out path in `auth.tsx`, `deleteAccount.ts`. It
  deliberately touches **no** Cloud Function, **no** `firestore.rules`, and adds
  **no** secret.

## Context

Google Play's technical quality requirements add **Zero-Tap Sign-In** from
**April 2027**: any app with sign-in — optional or mandatory — must restore the
user's signed-in state when they move to a new Android device. Missing it costs
"reduced app visibility and publishing capabilities", applied to existing apps
and all new releases. Games are exempt; Ignia is not.

The announcement names the **Android Restore Credentials API**, and that API
turns out to be WebAuthn end to end. Its own implementation guide lists as a
prerequisite:

> Set up a relying party server similar to the server for passkeys.

The server issues the `PublicKeyCredentialCreationOptions` challenge, stores the
resulting public key, and verifies the assertion the new device returns.
AndroidX's own sample calls `fidoAuthenticateWithServer(responseJson)` before it
can sign anyone in.

**Ignia has no app server.** That is not an oversight — it is the shape of the
product (`CLAUDE.md`): `firestore.rules` plus Firebase Auth are the entire
access-control layer, and there is no tier of the stack where a FIDO relying
party would naturally live. Building one means challenge issuance with replay
protection, a public-key store, assertion verification, and custom-token minting
through the Admin SDK — a new, security-sensitive surface, plus a new Firestore
collection whose validation would land in a rules file already at Firestore's
**1,000-expression limit** (#100).

## The thing that changes the decision

Google accepts a **Block Store** integration as compliant instead — with a
condition, in their words:

> An integration with Block Store may be considered compliant **but only if the
> integration was completed and in production on or before September 30, 2026**.
> Other integration types, or those completed after the cutoff date, are not
> considered compliant.

Block Store is Play Services' own backup/restore key-value store: 16 entries,
4 KB each, backed up with the device and handed back on restore. **No relying
party, no WebAuthn library, no new secret, no new collection.**

That is roughly a day of work against several, and it avoids every part of the
Restore Credentials path that this codebase is badly shaped for.

## Decision

**1. Implement Zero-Tap Sign-In with Block Store, before 30 September 2026.**
If the deadline is missed, fall back to the Restore Credentials build for April
2027 — the backend half of which is unblocked and testable today, since
`functions/` is not a fingerprint source (see decision 5).

**2. Store Firebase's own persistence blob, with the access token blanked.**
Firebase's React Native persistence already writes the session to AsyncStorage.
What travels is that blob minus `stsTokenManager.accessToken`. Two reasons: an
ID token expires in an hour and is worthless by the time a restore happens, and
dropping it takes the payload from ~2 KB to under 1 KB against the 4 KB ceiling.

**3. A refresh token is a credential, and is treated as one.**

- Stored **only** when Play Services reports the backup will be end-to-end
  encrypted (Android 9+ with a screen lock). Otherwise the feature does nothing
  and the user signs in exactly as before. A refresh token backed up under
  Google's key rather than the user's is not worth one saved tap.
- **Deleted on sign-out**, before `fbSignOut`, while there is still a session to
  reason about — a sold or shared phone must not carry the account onward.
- **Deleted on account deletion** as well. A credential for a deleted account
  sitting in Google's cloud backup is exactly the residue #99 is about, and
  relying on every caller remembering to sign out is not a control.

**4. Restoring costs one reload, and that is accepted rather than worked
around.** `initializeAuth` reads AsyncStorage once, at import time in
`firebase.ts`, and never re-reads. Writing the blob afterwards would be ignored;
racing it is not something to build an auth path on. So a found payload is
written and the app reloads **once**, guarded by a one-shot flag written
*before* the blob — if the write or the reload then fails, the next launch takes
the already-attempted path instead of looping forever.

That reload lands on exactly one launch: the first after a device migration,
when the user is already sitting in a restore flow. The alternative is asking
them to sign in, which is the thing the requirement exists to remove.

`firebase-config.ts` exists for this and for nothing else: `session-restore.ts`
needs the auth storage key **without** importing `firebase.ts`, because
importing it is what starts the clock it has to beat.

**5. The native dependency lives in `modules/`, never in `app.json`.** Measured
on the branch:

| Platform | before | after |
|---|---|---|
| Android | `ae526937…` | **`5facf778…`** |
| iOS | `7b347b0f…` | **`7b347b0f…`** |

`app.json` is hashed as a whole, so an Android-only key there moves the **iOS**
runtime too — that is the `READ_EXERCISE` failure of 2026-08-25, which shut the
iOS channel for most of a day while build 60 was public on the App Store. A
module directory confines the move to Android. The same measurement is why the
Restore Credentials fallback is not blocked: `functions/`, `firestore.rules` and
`assetlinks.json` are not fingerprint sources at all.

## Consequences

**It cannot ship by OTA.** The Android fingerprint moves, so this needs vc 40,
and merging it to `main` shuts the Android OTA channel until that binary is on
the track. It stays on a branch for exactly that reason.

**Engineering is not the risk; delivery is.** To use the grandfather clause the
integration must be *in production* by 30 September, which needs three things
this project does not yet have: Play **production access** (applied 2026-08-26,
pending), a route through the **Health-apps declaration deadlock** that killed
vc 38 and blocks vc 39, and **two physical devices** for a real restore test.

**One question is unresolved and decides the plan:** whether "in production"
means the production track specifically. Ignia has never shipped there. Worth
asking Play support directly rather than inferring — the answer decides between
sprinting at this and planning the WebAuthn build for April 2027.

**The restore leg is unverified and cannot be verified here.** It only fires on
a genuine Android-to-Android migration. Every failure path is written to degrade
to the existing sign-in, and 13 tests pin the guards — no storage without E2EE,
never overwrite a live session, one-shot, sub-1 KB payload, sign-out clears —
but a passing guard is not a demonstrated restore, and this ADR should not be
read as claiming one.

**If Block Store is ever removed, compliance goes with it.** The grandfather
clause is tied to the integration existing continuously in production. Ripping
it out later without shipping Restore Credentials first would silently return
the app to non-compliant.
