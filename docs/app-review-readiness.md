# App Review readiness — Ignia iOS v1.0

Written 2026-07-20 after the **second** rejection (submission `5ba1c7f5`, reviewed on iPad Air 11-inch M3 / iPadOS 26.5.2). Audited against the live [App Store Review Guidelines](https://developer.apple.com/app-store/review/guidelines/).

Two rejections in a row happened because each pass only surfaced what that reviewer happened to touch. This document exists so the third submission is checked against the whole guideline surface, not just the last rejection letter.

---

## 1. Fixed in code

| # | Guideline | Problem | Fix |
|---|-----------|---------|-----|
| 1 | **4** Design | Google button clipped off-screen on iPad — sign-in centred content in a non-scrolling `flex:1` box; sign-up mode overflowed | `ScrollView` + `flexGrow`, `maxWidth: 480`. Same shape fixed in `onboarding.tsx` and the `EntrySheet` custom form |
| 2 | **5.1.1(iv)** Camera pre-prompt | The denied-state screen inside the scanner modal still had "Open Settings" + "Cancel" — the exact pattern named in the rejection | `BarcodeScanner` renders only a spinner or the live camera; permanent denial reports via `onDenied` and `EntrySheet` explains it inline, no exit button |
| 3 | **1.5** Support URL | ASC pointed at the marketing landing; `/support` was a 302 to Ko-fi | Real support page at `/support`; Ko-fi moved to `/tip` |
| 4 | **1.5** Support URL | Cloudflare Scrape Shield rewrote the contact email into a placeholder behind a JS decoder | Wrapped in `<!--email_off-->` |
| 5 | **5.1.1(v)** Account deletion | **Mobile had NO in-app deletion** — Settings opened `ignia.fit/privacy#delete` in Safari. Linking out does not satisfy the guideline | `lib/deleteAccount.ts` calls the existing `deleteAccount` callable; two-step destructive confirm in Settings, then local sign-out |
| 6 | **5.1.1(i)** Privacy policy in app | No privacy/terms link existed anywhere in the mobile app | New **Legal** section in mobile Settings: Privacy, Terms, Help & support |
| 7 | **5.1.3** HealthKit disclosure | App ships HealthKit read+write; the privacy policy never mentioned health data | New "Apple Health & Health Connect" clause (en + es-PR), rendered on `/privacy` |
| 8 | **1.4.1** Medical disclaimer | Mobile had only "General guidance, not medical advice" on the coach screen | Explicit "not a medical device / talk to a doctor" in Settings → Legal |
| 9 | **5.2.2** Third-party data | Open Food Facts is **ODbL — attribution is a licence obligation** — and was credited nowhere | Credit in mobile Settings, web footer, and the support page |
| 10 | **5.1.1(ii)** Purpose strings | `expo-image-picker` overwrote `NSCameraUsageDescription` with *"scan your meals"* — describing a feature disabled in production builds | Both plugins now say *"scan food barcodes"* |
| — | (not a guideline) | Sign-up silently failed: client checked "a letter", server requires upper+lower+digit | Checklists mirror the policy on both platforms |
| 11 | **2.1** Completeness | Mobile email/password signup dead-ended at onboarding with "Could not save. Check your connection" — the rules block writes until the email is verified, and mobile had no verify flow (web did). A reviewer signing up fresh would see a broken-looking app | Ported the web verify-email gate to mobile (`apps/mobile/src/app/verify-email.tsx` + AuthGate + `reloadUser`); onboarding now maps permission-denied to a "verify your email" message |

Web changes are **built, tested (182 passing) and deployed**. Mobile changes are committed but **need a new build** — they are not in any binary yet.

---

## 2. Owner actions before resubmitting

These cannot be done from the codebase.

1. **Set the ASC Support URL to `https://ignia.fit/support`.** Currently `https://ignia.fit`. This is rejection #3 if left alone.
2. **Provide a working demo account in App Review Notes (Guideline 2.1).** The app requires login and a backend; Apple explicitly requires demo credentials. The reviewer was sitting on the **Sign Up** screen when they hit the clipping bug — plausibly because they were creating an account and hit the password failure. Give them credentials that already have data in them, and verify the login works before submitting.
3. **Describe the changes specifically in Notes for Review (2.3.1).** Generic text is rejected. Name the three findings and what changed.
4. **Rebuild and submit.** The three tip IAPs auto-resubmit with the app.
5. **Confirm the privacy nutrition labels** in ASC match what the app actually collects — including health data if HealthKit ships.

---

## 3. Residual risks, ranked

### ~~HIGH — HealthKit never device-tested~~ RESOLVED 2026-07-20
Owner confirms HealthKit works on his iPhone. **Apple did not reject on HealthKit — it was never in the rejection letter**; this was a precautionary audit flag, now retired. Keep the plugin as-is. iPad was only relevant to the layout clipping (Guideline 4), not to HealthKit. The privacy policy covers Health regardless.

### MEDIUM — `supportsTablet: false`, but Apple reviews on iPad anyway
The app is iPhone-only and runs letterboxed/resizable on iPadOS 26, which is how the clipping surfaced. **Recommendation: leave it `false`.** Flipping to `true` obliges a genuine iPad design pass *and* iPad screenshots in ASC (2.3.3) — that is more rejection surface, not less. The scroll fixes make the app robust at any window height, which is what Guideline 4 actually asks for here.

### MEDIUM — Photo-library permission is declared but unused in production
`expo-image-picker` is reached only by photo-scan (`mealScan.ts`), which both EAS profiles disable via `EXPO_PUBLIC_FEATURE_PHOTO_SCAN=0`. So the shipped build asks for a photo-library string it can never use. Apple sometimes queries permissions with no corresponding feature. Cleanest fix is deleting the `expo-image-picker` plugin block from `app.json` before submitting — **not done here** because it changes native build wiring and could not be verified without an EAS build.

### LOW — `/scan` route still mounts unguarded
`scan.tsx` has no `FEATURES.photoScan` check of its own; the gate lives upstream in `LogSpeedDial` and the hidden tab. Unreachable through the UI, but a deep link would mount it. Worth an in-route guard when photo-scan returns.

### MEDIUM — verification email lands in spam (deliverability)
Firebase Auth sends the verification email from its default sender, which frequently lands in **junk/spam**. The verify-email screen now tells users to check their spam folder (the honest interim fix), but real deliverability needs sender-domain authentication (SPF/DKIM/DMARC on `ignia.fit`) and ideally a custom Firebase Auth email action-handler domain. Owner infra task, not code. Until then: a user who never checks spam can't verify → can't use the app. Worth prioritising soon after launch.

### LOW — screenshots must show the app in use (2.3.3)
Screenshots may not be login or splash screens, and must not imply features that need purchase. Verify the current ASC set shows real logging screens.

---

## 4. Pre-submission self-review checklist

Run these on the **iPad Air M3** — it is the review device. Do not substitute the mini; it is a different size class.

- [ ] **Sign-UP** mode, portrait *and* landscape — every button visible, including Google
- [ ] Sign up with a fresh email and a policy-compliant password (e.g. `PasswordQa12`) — succeeds
- [ ] Full onboarding on the new account — CTA reachable on every step
- [ ] **Camera set to Off** in iOS Settings → Ignia, then open the barcode scanner — inline note + Settings link, never a full-screen gate with Cancel
- [ ] Settings → Legal → Privacy, Terms, Help all open
- [ ] Settings → Delete account → completes **in-app** and returns to sign-in
- [ ] Tip jar shows StoreKit sheets, never an external link, on iOS
- [ ] Split View / Stage Manager — nothing clips at a small window height
