# Sign in with Microsoft (Expo app)

Mirrors the Google flow in `src/lib/auth.tsx`: `expo-auth-session` runs the
Azure AD v2.0 authorization-code + PKCE flow, we exchange the code for an
`id_token`, then `signInWithCredential(OAuthProvider('microsoft.com'))`.

## What's already done (in code)
- `signInWithMicrosoft` + `microsoftAvailable` in `AuthProvider` (`src/lib/auth.tsx`).
- "Continue with Microsoft" button on the sign-in screen (renders only when
  `microsoftAvailable` — hidden in Expo Go, like Google/Apple).
- `app.json` → `expo.extra.microsoftAuth.clientId` =
  `80eaaf29-9de3-4912-a08a-7f0c6009e310` (the **same** public Azure client the
  PWA's Firebase Microsoft provider already uses — public, safe to commit,
  ADR-0002). Reusing it means the mobile `id_token` audience matches Firebase's
  configured provider, so no new Firebase setup is needed.
- Firebase Auth **Microsoft provider is already enabled** (verified via Identity
  Platform: `defaultSupportedIdpConfigs/microsoft.com`, `enabled: true`,
  `clientId: 80eaaf29…`). Nothing to do there.

## Owner-gated step (ONE thing, Azure portal) ⚠️
The mobile OAuth redirect must be registered on the Azure app registration, or
the flow dead-ends after the Microsoft consent screen.

1. Azure Portal → **App registrations** → the **Macro Log** app
   (client `80eaaf29-9de3-4912-a08a-7f0c6009e310`).
2. **Authentication** → **Add a platform** → **Mobile and desktop applications**.
3. Add this custom-scheme redirect URI:
   ```
   ignia://auth
   ```
   (This is what `makeRedirectUri({ scheme: 'ignia', path: 'auth' })` produces in
   a standalone / dev-client build. If a future build changes the app scheme,
   update both this URI and the `scheme` arg in `auth.tsx`.)
4. Save. Allow a minute to propagate.

The app is already multi-tenant + personal accounts (tenant `common` in
`auth.tsx`), so no tenant restriction needs changing.

## Testing
- **Not** available in Expo Go (no stable redirect scheme — the button is hidden
  there, same as Google/Apple). Needs a dev-client or production build.
- After a build: tap **Continue with Microsoft** → consent → lands signed in.
  A cancel shows the localized "cancelled" message; other failures show the
  generic sign-in error (`errorKey` reuses the Google/Apple codes).

## Notes
- No new dependency — `expo-auth-session` was already used by Google.
- Web parity: the PWA already offers Microsoft sign-in via Firebase
  `signInWithPopup`; this brings the Expo app to parity (ADR-0012).
