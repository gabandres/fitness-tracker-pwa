# STATUS — what is true right now

**Updated:** 2026-08-07 · **Owns:** current state only. Not history (`CHANGELOG.md`),
not rationale (`docs/adr/`), not vocabulary (`CONTEXT.md`).

If a statement here conflicts with any other file in this repo, **this file wins** —
or the other file is stale and should be deleted. Every claim below has a
verification command; if you are about to scope work off a claim, run the command
first. Three separate times this project scoped already-shipped features as new
work because a plan doc was read as a status doc.

---

## 1. Live right now

| Surface | State | Verify |
|---|---|---|
| Web PWA `ignia.fit` | **Live**, bilingual (EN + es-PR), **105** prerendered pages (en 52 / es 53), 114-URL sitemap | `npm run build` prints both counts |
| **Store-update banner** | **LIVE 2026-08-07, and it has a manual step that will rot silently.** `public/app-version.json` on the hosting site is the source of truth for "what is the newest binary"; `UpdateBanner` on Today compares it to the running versionCode and links to the store. **The number is DERIVED from the live Play tracks, not hand-written** — `node scripts/app-version-sync.mjs` rewrites it from `androidpublisher` (the same authority the signing-cert check uses), and `npm run doctor` fails on drift (*app-version.json matches what Play ships*). That guard exists because the failure is otherwise invisible: no error, no warning, every install quietly believing it is current, indistinguishable from the feature not existing. Deploying is still a separate act — `firebase deploy --only hosting`, or the corrected file reaches nobody. Currently `android.latestVersionCode: 11` (= what is live on alpha, so no tester is prompted) and `ios.latestBuild: 0`, which **disables** the iOS prompt on purpose — TestFlight (build 24) runs ahead of the App Store, so it must be set to the live *App Store* build, never the TestFlight one, if it is ever turned on | `curl -s https://ignia.fit/app-version.json` |
| **OTA (EAS Update)** | **LIVE — the first update was published 2026-08-07.** `expo-updates` + `runtimeVersion: {"policy":"fingerprint"}` (deliberately *not* the `appVersion` default `eas update:configure` writes — `appVersion` would force new binaries on both platforms at every version bump). Channels match the build profiles. **Both enabling binaries have now SHIPPED** — iOS build **24** (`VALID` on TestFlight 2026-08-07) and Android **vc 11** (live on alpha), each verified to carry `expo-channel-name: production`. **Remaining gate is the testers themselves**: a device is only OTA-capable once it is RUNNING one of those binaries, so everyone must install from TestFlight/Play once. After that, JS/TS fixes ship in seconds with no build, no queue, no review — delivered on the launch AFTER the one that downloads them. **The first update WAS published 2026-08-07** (`b8306f9f`, branch `production`, groups `4a1795b2` Android / `f07df985` iOS), and it published under runtime versions `c0b85c15…` and `781be0c8…`. **Those were WINDOWS-generated fingerprints, and no verified binary carries them** — see below. It carries `UpdateBanner`, which is what makes every *subsequent* update visible: before it, an OTA applied silently on the next cold start and a resident app never noticed one at all. Free tier is 1,000 MAU; tester base is single digits.<br><br>**THE FINGERPRINT IS MACHINE-DEPENDENT HERE — publish from `ignia-mac`, never from Windows.** The same commit fingerprints `5758fe4f…`/`6c756c19…` on the Mac and `c0b85c15…`/`781be0c8…` on the Windows workstation. Causes are commit-independent: a gitignored `apps/mobile/android/` prebuild dir that exists only on Windows, CRLF-vs-LF in tracked files, and divergent `node_modules` (516 fingerprint sources vs 286). **Every binary is built on the Mac**, so the Mac's value is the one they carry — read out of the artifacts on 2026-08-07: vc 13's `.aab` (`base/assets/fingerprint`) holds `5758fe4f…` and build 25's `.ipa` (`Payload/*.app/EXUpdates.bundle/fingerprint`) holds `6c756c19…`. **All three OTAs published earlier that day used the Windows numbers and therefore reached neither verified binary.** The 22:00 update (`c3a7333a`, the ledger `already-exists` fix) is **the first published from the Mac and the first that provably matches a shipped binary** — groups `75705c93` android @ `5758fe4f…` / `1212ce21` ios @ `6c756c19…`. Ground truth is the file inside the artifact, never a locally generated hash | `ssh ignia-mac "cd ~/fitness-tracker-pwa/apps/mobile && npx expo-updates fingerprint:generate --platform android"` |
| iOS App Store | **1.0.0, build 7** (uploaded 2026-07-20, `READY_FOR_SALE`), from commit `168e0394` | ASC command below |
| **iOS build 25** | **UPLOADED TO TESTFLIGHT 2026-08-07**, built locally on `ignia-mac` (`eas build --local`, **zero EAS quota**), submitted with `eas submit`. Version 1.1.0, build 25. All four targets verified nested in the `.ipa` (`Ignia.app`, `Today.appex`, `IgniaWatch.app`, `IgniaWatchComplication.appex`), not inferred from exit 0. **It is NOT attached to the App Review submission** — Apple is reviewing **build 24**, and changing that needs a new submission, so do not describe 25 as "in review". It is the first binary built from `a7c568a4`, so it **embeds** photo-scan, the update banner and the current What's New copy rather than relying on the OTA. **Its runtime fingerprint is `6c756c19b3e35948b85e42a3b337eec588128d3c`, read out of the `.ipa` itself** (`Payload/*.app/EXUpdates.bundle/fingerprint`) — and it is the runtime the 22:00 OTA of 2026-08-07 was published under. Build 24's `781be0c8…` is a **Windows-generated, unverified** number; the earlier "the fleet is split across two runtime versions" claim rested on comparing it against this Mac-generated one, and is withdrawn (see the OTA row) | ASC command below |
| iOS 1.1.0 | **RE-SUBMITTED TO APP REVIEW 2026-08-07 with BUILD 24 — state `WAITING_FOR_REVIEW`.** Review submission `93c329b1`, build **24** attached (`VALID`), verified live via the ASC API. `releaseType` is `AFTER_APPROVAL`, so it ships on approval without a second action. **The original submission `e4d32c0e` (02:15Z, build 19) was CANCELLED to do this, forfeiting ~19 h of queue position** — build 19 predates `expo-updates`, so every App Store user it reached would have needed a full review cycle for any JS fix, and it also lacked `ebf60dcb` (writing a food in yourself). Release notes were extended by exactly one bullet in both locales to match, and re-verified on the live version. **The swap is not an edit** — a submitted version's build is frozen, so it is cancel → re-point → resubmit, via `scripts/asc-swap-review-build.mjs`; the cancel is irreversible and the first run failed between those steps, leaving 1.1.0 cancelled-and-unsubmitted until it was resumed (`057a03f1` fixed both the resume path and the 409 transition race). This is the first App Review submission since 1.0 build 7 (2026-07-20) and carries 54 mobile/core commits. **It does NOT contain the Android widget fix or manual food entry** — both were merged after `fdcd92ed`. **Build 23 (2026-08-07, `VALID` on TestFlight) is now the newest iOS binary and DOES contain both.** It is **not** attached to the review submission — Apple is reviewing **19**, and changing that requires a new submission, so do not describe 23 as "in review". Build 23 is also **the first iOS binary built locally on the Mac** (`ignia-mac`, `eas build --local`, **zero EAS quota**, 15m57s — see `docs/DEV_ENVIRONMENT.md` §3.10 and the `build-ios` skill) and **the first iOS binary with mobile Sentry in testers' hands** (Sentry existed only in `f3e5daaf`, which was never submitted). Its four targets were verified nested correctly in the `.ipa`, not inferred from exit 0. **Build 24 (2026-08-07, `VALID` on TestFlight) supersedes it** — same contents plus `expo-updates`, so it is the first iOS binary that can receive over-the-air updates (`EXUpdatesRuntimeVersion = file:fingerprint` confirmed in its `Expo.plist`); also built locally, also four targets verified. Submitted via the ASC API (`POST /v1/reviewSubmissions` → `POST /v1/reviewSubmissionItems` → `PATCH …{submitted:true}`), not the console. Note `eas submit` printed *"Something went wrong when submitting your app to Apple App Store Connect"* for build 19 and the upload had in fact **succeeded**; a re-run then failed as a duplicate. Trust ASC, not the CLI exit — `/v1/builds?filter[app]=…&sort=-uploadedDate`. Build 16 (`6415fca7`, commit `cfc19a06`, 2026-08-03) is the predecessor. **Build 16 is the first binary anywhere that contains the Apple Watch app and complication** (`IgniaWatch.app` + `IgniaWatchComplication.appex`, both signed in its build log). It passing Apple's processing as `VALID` also settles the open **ITMS-90717** question: the watch app icon's alpha channel did **not** get it rejected. Build 13 (`5949a3ea`, commit `458d60db`) is the predecessor — first binary to actually carry the widget's `ExtensionStorage` pod, and the one the iPhone widget was verified from on a physical device | ASC command below |
| **Android vc 13** | **LIVE ON THE ALPHA TRACK 2026-08-07** — `status=completed, versionCodes=["13"]`, verified via the `androidpublisher` edits→tracks API (not the CLI). Built locally on `ignia-mac` with `eas build --local` at **zero EAS quota**, 89 MB `.aab`. Verified before submitting: signed `CN=Macro Log Dev` SHA-1 `3C:E1:5E:…:E4:D5` (the real upload key, **not** the debug cert) and `{"expo-channel-name":"production"}` present in `AndroidManifest.xml`, so it **can** receive OTA updates. Built from `a7c568a4`, so photo-scan, the update banner and current What's New are **embedded**, not OTA-dependent. Runtime fingerprint `5758fe4f232d5e6fe1ca369299512cfec0d39e13`, **read out of the `.aab` itself** (`base/assets/fingerprint`), and the runtime the 22:00 OTA of 2026-08-07 was published under. vc 11's `c0b85c15…` is a **Windows-generated, unverified** number — see the machine-dependence note in the OTA row and `apps/mobile/AGENTS.md`. **vc 12 does not exist**: `autoIncrement` burns a number per *attempt* and the first attempt failed in 23 s on an unset `ANDROID_HOME` (`DEV_ENVIRONMENT.md` §3.11 trap 3). `public/app-version.json` is synced to 13 and **hosting is deployed**, so older installs now see the update banner | `node scripts/app-version-sync.mjs` (fails the doctor on drift) |
| Android / Play | **Not launched.** Play Console account exists, **developer verification complete** and `fit.ignia.app` **package name registered** (both 2026-07-31), proven with an APK signed by `apps/mobile/credentials/dev.keystore` (alias `macrolog-dev`, SHA-256 `75:4B:03:19:…:F6:D8`) — **that keystore is load-bearing app identity; it is git-ignored and now exists in TWO places** (this machine and `ignia-mac`, both mode `600` — locations and disposal list in `CLAUDE.local.md`). **vc 11 (2026-08-07) is LIVE on the alpha track** (`status=completed, versionCodes=["11"]`, verified via the androidpublisher API) — built with `eas build --local` on the Mac at **zero EAS quota**, signed with the real upload key, and the first Android binary that can actually receive OTA updates (channel `{"expo-channel-name":"production"}` confirmed in its `AndroidManifest.xml`). **vc 10 is superseded and is an OTA dead end** — it was built with raw `./gradlew bundleRelease`, which omits the channel silently; do not point testers at it — plain `./gradlew bundleRelease` on the Mac, 1m51s incremental, **zero EAS quota**, signed with the real upload key and verified via `keytool -printcert` (`CN=Macro Log Dev`, not the debug cert Expo's template defaults to). It is also the first Android binary carrying `expo-updates`. The EAS remote versionCode was set to 10 by hand — a local Gradle build neither reads nor increments it, and skipping that step makes the next cloud build re-mint a colliding number. App entry created (`4975181896468259775`). **The first AAB is uploaded and the whole app is IN REVIEW at Google** as of 2026-08-02 — versionName 1.1.0 / **versionCode 4**, EAS build `2d36d121`, on the **Closed testing - Alpha** track (id `4699799777678836720`), 177 countries, signed by that same key (verified with `keytool -printcert -jarfile`). 14 changes went in one submission because it is the app's first: store listing, content rating, data safety, health declaration, the release itself. Reviews are quoted at up to 7 days. **vc 6 superseded it on 2026-08-03** — EAS build `d238d43f`, commit `87aee43b`, submitted with `eas submit` and **verified live on the alpha track by the Play Developer API: `status=completed, versionCodes=["6"]`**. `completed` means rolled out to the tester list, not a draft awaiting a console promote — that is `eas.json`'s `releaseStatus: "completed"` (from `87aee43b`) working. **vc 6 is the first Android binary containing Sentry and the Google sign-in diagnostics**, so Alejandro's `DEVELOPER_ERROR`-vs-`no-token` question is now answerable from Sentry rather than from guesswork — and on 2026-08-05 it was answered: `DEVELOPER_ERROR`, from a real Play split-APK install of vc 6 (see the sign-in row in §8). **The app is out of review**: the console shows the 1.1.0 release as *Available to selected testers*, released Aug 3 8:41 PM, and the opt-in link `https://play.google.com/apps/testing/fit.ignia.app` is live for the listed testers (it renders "App not available" for any account not on the list, including the developer's own — that is not a fault). Tester list `Ignia Beta Testers` holds **7 emails; 12 are required** — **personal developer account → production access requires closed testing with 12 testers opted in 14 CONTINUOUS days** ([policy](https://support.google.com/googleplay/android-developer/answer/14151465)). **Resolved 2026-08-05: Play's own production-access checklist (app Dashboard) reads "8 testers currently opted-in"** (4 → 6 → 8 over the course of that one day — it moves, so re-read it rather than trusting any number written down here). So opt-ins are real and the earlier "Installed audience 0" was a lag, not a dead track. **Updated 2026-08-07 by the owner from the Dashboard: 12 testers are now opted in — the threshold is MET.** That started the 14-day continuous clock, which runs from the **12th** person's opt-in (the policy is per-tester, not a group timer), so the earliest production-access application is ~2026-08-21 provided nobody drops out and rejoins — interrupted periods do not add up. The number climbed 4 → 6 → 8 → 12 across 2026-08-05..07, which is exactly why it must be re-read from the Dashboard rather than trusted from this file. **Play publishes no per-tester data at all** — not who opted in, not when. The Dashboard aggregate is the entire dataset: the `androidpublisher` `testers` resource covers only Google Groups, and Statistics → *Installed audience* returns "Data unavailable" at this volume. Firebase Auth can prove a *negative* (no account = that person never signed in anywhere) but cannot distinguish a web sign-in from an Android one, because the mobile app deliberately writes the same doc shapes as the PWA. To learn who is actually in, ask them for a screenshot of the opt-in URL — it states each person's own status back to them. **The 14 days are per-tester, not a group timer**: [policy](https://support.google.com/googleplay/android-developer/answer/14151465) requires that at application time ≥12 testers have each been opted in for *the last 14 days continuously*, and states that someone who opts in, tests under 14 days, opts out and rejoins does **not** get to add the periods up. So the 6 are already banking days; the earliest apply date is 14 days after the **12th** opt-in, because that person has the least time banked. Play exposes no per-tester breakdown — the aggregate on the Dashboard is the only number | Track state: the `androidpublisher` edits→tracks API with `credentials/play-service-account.json` (see `CLAUDE.local.md`) |
| Cloud Functions / rules | Deployed, project `fitness-tracker-gb-1775407101`. **`firestore.rules` redeployed 2026-08-04** to allow + range-validate the new `proteinFloor` profile field (`> 0 && < 1000`); deployed **before** any client writes it, per the standing rule | `firebase deploy --only functions --dry-run` |

**Food search runs on a BUNDLED USDA database as of 2026-08-07** (ADR-0018).
`functions/data/usda-foods.json` — 13,272 foods, 3.6 MB, committed, generated by
`node scripts/ingest-usda.mjs` (which downloads and caches its own inputs; the
"multi-GB, owner-run" blocker in the old scoping doc was wrong — the three
archives total ~13 MB). `functions/src/usda-db.ts` loads it once per instance and
serves `searchFoods`/`getFoodDetail` with **no network call**. The live FDC API
is gone: no key, no 1,000 req/hour ceiling, no upstream outage. Open Food Facts
is unchanged and still serves branded + the whole barcode path.

**The wire contract did not change**, so this is a **functions-only** deploy —
both frontends and `packages/core` are untouched and no client release is
needed. Search-cache keys moved to `v3`; a stale `v2` page could name a Branded
`fdcId` the new backend cannot resolve.

**`USDA_FDC_API_KEY` is dead code but STILL BOUND — do not delete it.** No
function reads it any more, but the binding survives on the deployed revisions,
so destroying the secret would stop `searchFoods`/`getFoodDetail` booting
(gen2 resolves bindings at instance start). The count stays at **8 active
versions**, not 7. Two routes were tried on 2026-08-07 and both failed:

- `firebase deploy --only functions` (full, all functions) **does not prune**
  secret bindings — the source no longer declares the secret and the revision
  still carries it. Verified after both a targeted and a full deploy.
- `gcloud run services update <svc> --remove-secrets=USDA_FDC_API_KEY` crashes:
  `ValueError: Invalid secret path … in annotation` — gcloud cannot parse the
  annotation firebase-tools writes.

What is left to try: patch the Cloud Run service through the Admin REST API,
removing the secret env var **and** the `run.googleapis.com/secrets` annotation
together. Verify a search still returns hits, and only then
`gcloud secrets delete USDA_FDC_API_KEY`. Worth ~$0.06/mo — do it when
something else is already touching functions, not on its own.

```sh
gcloud functions describe searchFoods --region=us-central1 --gen2 \
  --format="value(serviceConfig.secretEnvironmentVariables)"   # empty == unbound
```

**Still open:** photo-scan does NOT yet resolve its recognized items against this
DB — the model still emits macros directly, so ADR-0015's split vision
architecture remains half-done. That is now a small change, not a blocked one.

```sh
cd functions && node -e "const{loadFoods,searchUsda}=require('./lib/usda-db.js');console.log(searchUsda(loadFoods(),'chicken breast',1))"
```

**Photo-scan is LIVE and free for everyone, both platforms, since 2026-08-07**
(ADR-0017). Web deployed at commit `01803846` (release stamp verified live on
`ignia.fit`); mobile published as an **OTA**, update group `93132738…`
(Android) / `bf5f9163…` (iOS). The meal-photo→macros loop was built, deployed
and fully guarded on the server all along — **only the clients were dark**. Two
flags changed and nothing else: web `FEATURES.photoScan` → `true`, mobile
`FEATURES.photoScan` → a **hardcoded `true`** replacing its
`process.env.EXPO_PUBLIC_FEATURE_PHOTO_SCAN` read.

**`eas.json` was deliberately NOT touched, and the OTA gate is why.** Deleting
that env key was tried first and reverted: `eas.json` is hashed into the EAS
Update fingerprint, so it moved Android `c0b85c15…` → `30043793…` — an update
that publishes successfully and **reaches nobody**, and that would have forced
new binaries plus a resubmission of iOS build 24 mid-App-Review. JS source is
not hashed. The published runtime versions were confirmed identical to the
**Windows-generated** fingerprints (`c0b85c15e6631d99e8ccef61867d937389094ae6`
android, `781be0c885005e1d02bcf41408988c6622ff222e` ios) — which, as of
2026-08-07 22:00, is known **not** to be the same thing as matching the shipped
binaries; see the OTA row above. The `c0b85c15… → 30043793…` movement is still a
valid demonstration that `eas.json` is hashed and JS source is not; only the
"lands on vc 11 and build 24" conclusion is withdrawn. **The rule that
generalizes: an env-var flag is a build-gated switch
(hours); a hardcoded constant is an OTA-gated one (seconds) — for a kill
switch, use the constant.** A now-inert `EXPO_PUBLIC_FEATURE_PHOTO_SCAN: "0"`
still sits in `eas.json`'s `production` + `preview` profiles; **nothing reads
it**, and it is flagged in `apps/mobile/src/lib/features.ts` for deletion
alongside the next change that needs a native build anyway.

**No Cloud Function change was needed** — `analyzePhoto` was already deployed
with `PHOTO_REQUIRES_PAID = false` and the guards already in the right order:
`spendCeiling.check("photo")` before the per-user reserve, `dailyQuota.reserve`
(**3/day free · 30/day paid**), `spendCeiling.record` immediately after the
request leaves. ~$0.0015/scan on `gemini-2.5-flash`, so ~$0.14/user/month at
the free cap, and the ceiling bounds the worst *day* across all users at 2,000
scans ≈ $3. Functions were redeployed only for welcome-email copy ("three ways
to log a meal" → four, both locales). This **amends ADR-0015's paid gate**
("5 lifetime free scans, then Pro"), which never shipped and was incoherent
while `PRO_ENABLED` is false — `isPaid()` is forced `true`, so a client-side
paid check unlocks the feature for everyone. **The client flags are a kill
switch, not a cost control**; the cost control is server-side and cannot be
bypassed.

**Not yet verified end-to-end by a human**: no signed-in photo→macros round
trip has been run against production since the flip. One scan on `review@` or a
real account confirms it.

```sh
curl -s https://ignia.fit/index.html | grep -o '__MACROLOG_RELEASE__[^;]*'   # web build live
cd apps/mobile && npx eas update:list --branch production --limit 3           # OTA groups
```

**The `1.1.0` trap.** `app.json` says 1.1.0 and ASC has a 1.1.0 version page, but
**EAS has never built a 1.1.0 iOS binary**. Anything a doc describes as "shipped in
1.1.0" shipped in **1.0** or has not shipped at all. Do not trust a version number
in prose; ask ASC:

```sh
node -e "import('./scripts/asc-client.mjs').then(async({api,APP_ID})=>{const r=await api('GET','/v1/apps/'+APP_ID+'/appStoreVersions?limit=5&fields[appStoreVersions]=versionString,appStoreState');r.data.forEach(v=>console.log(v.attributes.versionString,v.attributes.appStoreState))})"
```

**The last step of `npm run build` is load-bearing — do not reorder or drop it**
(2026-08-04). `scripts/sentry-release.mjs` mutates `dist` *after* `ng build` has
already hashed it: `sentry-cli sourcemaps inject` rewrites every minified `.js`
to embed a debug ID, and the map-strip deletes files. `ngsw.json` pins a SHA1
per file, so it is **regenerated as the final step**; shipping the stale one
gives every returning user a service worker whose hashes do not match what the
server serves. The script exits non-zero rather than leave that dist behind.
Same reason the release stamp is injected there and not into `src/`. Verify a
build before deploying — 133/133 matched on 2026-08-04:

```sh
node -e "const{createHash}=require('crypto'),{readFileSync,existsSync}=require('fs'),{join}=require('path');const D='dist/fitness-tracker-pwa/browser',t=JSON.parse(readFileSync(join(D,'ngsw.json'),'utf8')).hashTable;let b=0;for(const[u,h]of Object.entries(t)){const f=join(D,u.slice(1));if(!existsSync(f)||createHash('sha1').update(readFileSync(f)).digest('hex')!==h){console.log('BAD',u);b++}}console.log(b?b+' BAD':Object.keys(t).length+' ok')"
```

**Web Sentry releases are per-commit as of 2026-08-04.** Before that nothing set
`__MACROLOG_RELEASE__` (despite a code comment claiming this script did), so the
app reported release `dev` and every web error since 2026-04-13 grouped under a
single `dev` release; the About screen and feedback emails showed `dev` too.
Builds now stamp the commit SHA into all 110 emitted HTML pages and create the
release via the API. Source maps were **not** broken by this — debug IDs match
frames to maps without a release — so do not read the old `dev` grouping as
"symbolication was down". `SENTRY_ORG` / `SENTRY_PROJECT` were **deleted as
GitHub Actions secrets**; both now default in `sentry-release.mjs`
(`gabriel-bermudez` / `ignia-web`, confirmed against the Sentry API). Re-adding
either secret overrides the default — only do that if the project is renamed
again. `SENTRY_AUTH_TOKEN` remains the one required credential, read from
`.env.local` on a workstation and from the Actions secret in CI.

## 2. Written, merged, and not yet in front of the public

All of this is on `main`. Do not re-scope anything here as new work.

**THE CUTLINE, updated 2026-08-07 — read this before the bullets, which are older
than it.** iOS build 19 and Android vc 8 were cut from `fdcd92ed` and submitted
(TestFlight + Play alpha, both verified at the destination). Since then **iOS
build 23 and Android vc 9 have shipped to testers**, and between them they close
the last gap for everything merged up to that point.

**Amended later on 2026-08-07 — photo-scan was turned on and SHIPPED the same
day**, web and mobile both (see §1). It never sat in this section. Every bullet
below remains in testers' hands on both platforms.

What is still pending is a different thing, and it is the one that matters:

| Audience | Has | Missing |
|---|---|---|
| TestFlight testers | **everything in §2** (build 23) | — |
| Play alpha testers | **everything in §2** (vc 9) | — |
| **App Review** | build **24** — everything through `ebf60dcb` | the update banner (`b8306f9f`), which landed after 24 was uploaded and reaches these users over the air instead |
| **Public App Store** | **1.0, build 7** (`168e0394`, uploaded 2026-07-20) | **54 mobile/core commits** — i.e. all of §2 |
| Play production | nothing — not launched | — |

So the gap is not a build, it is a **submission**: `1.1.0` has sat at
`PREPARE_FOR_SUBMISSION` since it was created and **has never gone to App
Review**. Cutting another build does not move that; submitting does. Verify
with the ASC command in §1.

- **Manual food entry is a first-class logging method on mobile** (2026-08-06,
  `ebf60dcb`). **LIVE ON ANDROID in vc 9** (2026-08-06) **and ON iOS in build 23**
  (2026-08-07) — so it is now in testers' hands on both platforms. It rode along
  with the widget fix exactly as intended when the owner declined to spend a build
  on it alone. Writing a food in yourself was
  a text link at the *bottom* of the Add-food browse list, under Recent + My
  Foods + Quick add; My Foods is uncapped, so the link sank further with every
  food saved through it, and typing two characters removed it entirely (the
  browse list only renders in the search's idle phase). A search miss was a dead
  end that discarded the typed name. Now: a `create-outline` icon leads the
  header icon row, and a no-results search offers to add the food with the query
  already in the name field. Diagnosis, the options not taken, and the still-open
  item **E** (cap the uncapped My Foods / presets lists) are in
  `docs/research/mobile-manual-food-entry.md`. The web needed no change — its
  sheet already opens on a Manual segment.

- **Mobile template editor reached parity with the web one** (2026-08-06).
  **In testers' hands** (iOS build 19+, Android vc 8+ — see the cutline). The
  first attempt — iOS 18 (`e8f0d86f`), Android vc 7
  (`e6d97826`), both from `e47fd366` — ERRORED in *Bundle JavaScript*, for a
  reason unrelated to this fix: colocated `*.test.tsx` files inside `src/app/`
  get swept into Expo Router's route `require.context` and bundled (see
  `apps/mobile/AGENTS.md`). That break landed 2026-08-05 with the first Expo
  tests and lay dormant because no EAS build ran in between. Tests moved to
  `src/__tests__/`. **The second attempt, from `fdcd92ed`, FINISHED on both
  platforms in 32 min: iOS build 19 (`4527017a`) and Android vc 8
  (`5584f181`). **BOTH SUBMITTED 2026-08-06 and verified at the destination,
  not from the CLI**: iOS 19 is `VALID` in App Store Connect (the submit CLI
  reported a failure that had actually uploaded — see §1), and Play's
  `androidpublisher` edits→tracks API reports the alpha track at
  `status=completed, versionCodes=["8"]`, i.e. rolled out to the tester list.
  **Those two binaries carry the template fix ONLY**: they were cut from
  `fdcd92ed`, before the food-entry work above, so testers have this and not
  that.** The mobile
  editor modelled an exercise's sets as a *count*, and `updateTemplate` writes
  `exercises` as a full overwrite, so opening a template authored on the web and
  tapping Save rewrote every cluster (activation/mini/mini) as N flat `working`
  sets and deleted `cues` and `progression` outright. It also could not see
  `restMiniSec`/`restClusterSec`. It now edits real `PlannedSet`s with derived
  cluster numbering (`normalizeClusterGroups`, same invariant as the PWA), plus
  cues, auto-progression and both rest timers; a failed save shows an error
  instead of looking like a no-op. **The owner's three templates are all
  cluster-format, so anyone on a current build should edit templates on the web
  until this ships.** Pinned by `apps/mobile/src/app/(app)/train.template-editor.test.tsx`
  (round-trip a cluster template unedited; renumber on append).

- **Account linking — "Sign-in methods"** (2026-08-05). **The web half is LIVE**
  (hosting deployed 2026-08-05); the mobile half is on `main` and **in no
  binary**. A user who signed up with email + password can now connect Google,
  Apple (mobile) or Microsoft (web) to the *same* account from Settings, and the
  mobile sign-in screen finally completes the collision flow the PWA already had
  (capture the credential, verify with the owning provider, `linkWithCredential`).
  **The Settings path is not a nicety — it is the only mechanism that covers
  Apple's Hide My Email**, whose `@privaterelay.appleid.com` address never
  collides with the password account and so silently creates a second account.
  Unlink refuses to remove the last provider. Note the mobile provider-hint code
  it replaces was already dead: this project has
  `emailPrivacyConfig.enableImprovedEmailPrivacy = true`, so
  `fetchSignInMethodsForEmail` returns `[]` unconditionally — **do not write new
  logic that branches on its result.**
- **Body-measurement fixes — mobile, in testers' hands** (2026-08-05; iOS build
  19+, Android vc 8+). Three, from
  tester report: (1) typed digits were invisible — `styles.input` carries
  `flex: 1` for the weight sheet's *row*, and reusing it inside the measurement
  *column* made `flexBasis: 0` collapse the box to its padding, so values saved
  but never appeared; (2) saved rows could not be edited at all —
  `toMeasurementPatch` existed in `@macrolog/core` but only the PWA called it,
  so mobile now has `updateMeasurement` and the sheet prefills and edits every
  site, not just waist; (3) nothing explained what a tape measurement was *for*,
  so both apps now carry the same intro plus a "How to measure" panel. Deletion
  moved from a hidden long-press to an explicit trash icon, matching the PWA's
  per-row pencil/trash controls.

- **The daily-target safety floors, and the onboarding shadow bug** (2026-08-04).
  **The web half is LIVE** (hosting deployed 2026-08-04); the mobile half is **in
  testers' hands** (iOS build 19+, Android vc 8+). Three defects, one seam:
  1. **`calorieFloor` was clamped on only two of the four branches that can
     produce a target** — `tdee.ts` measured and formula. The manual
     onboarding heuristic and the seed fallback bypassed it, so a user with
     `calorieFloor: 1850` was shown 1760 (their `manualCaloriesTarget`, =
     weight × 11) and 1800 (`SEED_RESULT`) respectively. Fixed with **one exit
     clamp in `dailyTargets`** (`packages/core/src/targets.ts`) rather than
     three patched return sites; `calorieFloor` is now exported from `tdee.ts`
     instead of duplicated. **`calculateTdee` arithmetic is untouched and
     `tdee.test.ts` is byte-identical green** — `Math.max` is idempotent, so
     measured/formula values that were already clamped upstream pass through
     unchanged (two guard tests assert exactly that).
  2. **Protein had no floor at all.** New **opt-in** `proteinFloor` (grams) with
     **no numeric default** — unset behaves exactly as before. Type, rules,
     writers on both clients, `LEDGER_PORT` + in-memory adapter, and a settings
     stepper on web and mobile in both locales, where "off" is a real state and
     stepping below the band minimum clears the field.
  3. **`saveOnboardingV2` could shadow the formula target forever.**
     `saveRefinedTargets` deletes the manual targets and stamps
     `targetsRefinedAt`; re-running onboarding restored a manual target and left
     the stamp, and manual outranks formula — so a refined user who changed
     their goal was pinned to a heuristic number derived from a pace they had
     already replaced. Both adapters hand-wrote that patch and had drifted, so
     the patch shape moved into **`toOnboardingV2Patch`** in
     `packages/core/src/firestore-writers.ts` (the module that exists to stop
     exactly this) and now clears the stamp. Invariant, unit-tested:
     **`targetsRefinedAt` present ⟺ manual targets absent.** Clearing it also
     re-shows the Refine Targets card, which is correct — the user is back on
     the heuristic and should be re-invited to refine.
  **One behaviour change wider than the bug report**, called out deliberately: a
  manual target below 1500 with no configured floor now lifts to
  `MIN_DAILY_TARGET`. Reachable — the `lose` heuristic is weight × 11, so anyone
  under ~136 lb onboards below 1500 (a 100 lb user goes 1100 → 1500). That is
  the floor doing its job on a branch that had been skipping it, but it does move
  existing users' numbers. **Verified 2026-08-04: `npm run test:rules` is green,
  161/161**, and `proteinFloor` now has four emulator specs of its own (in-range
  accepted, over-ceiling rejected, `0` rejected — "off" is an *absent* field, not
  a zero — and absent accepted). An earlier version of this entry claimed the
  suite could not run here because firebase-tools needs **Java 21+**; JDK 21 is
  installed, it is just not the PATH default. Export it first, per §7.
- **Photo-scan is provider-switchable, and gated paid server-side**
  (2026-08-04). On `main`, deployed nowhere. `analyze-photo.ts` now has two
  interchangeable adapters behind one `MacroDraft` contract, chosen by the
  `PHOTO_PROVIDER` constant:
  - `"gemini"` — `gemini-2.5-flash`, **the active default**. Has a real free
    tier, which is why photo-scan has cost approximately nothing to date.
  - `"anthropic"` — `claude-haiku-4-5`. **No free tier**: metered from the
    first request at ~$0.004/scan. Better structured-output guarantees, plus
    explicit refusal and truncation handling Gemini's path doesn't need.

  **It stays on Gemini until Pro launches** — v1 is free, so every scan today
  is unfunded. Flipping is a one-word change; both adapters compile and both
  secrets are declared on the callable, so switching is not a change to the
  deployment contract. Everything downstream of the dispatch (normalize,
  clamp, client response shape) is shared, which is what stops the two paths
  drifting into different numbers for the same photo.
  **`ANTHROPIC_API_KEY` exists** in Secret Manager as of 2026-08-04 (v1,
  enabled) and was verified live against `/v1/models`. Both it and
  `GEMINI_API_KEY` must exist to deploy, whichever provider is active.
  **The feature is still hidden** (web `FEATURES.photoScan: false`, mobile
  `EXPO_PUBLIC_FEATURE_PHOTO_SCAN=0` in the prod build) — this is plumbing,
  not a launch.
  **Photo-scan is freemium, not Pro-only** — `PHOTO_REQUIRES_PAID = false`,
  and the tiering is the daily caps in `daily-quota.ts`: **3/day free, 30/day
  paid**, which is what the freemium table always promised. Costed before
  opening it: on Gemini a free user maxing 3/day *every day* is ~$0.14/month,
  and the `photo` ceiling bounds the worst possible day at 2,000 scans ≈ $3.
  **The earlier "30/day loses money" worry was Haiku-specific and is void on
  Gemini** — 30/day × 30 days × $0.0015 = $1.35/mo against $3.00/mo of
  revenue. Re-run that math before flipping `PHOTO_PROVIDER`, where the same
  usage costs ~2.7×; do not carry the conclusion across providers.
  **The gate, if it is ever re-closed, must stay server-side.** The client
  cannot express "Pro": `isPaid()` is forced `true` for everyone while
  `PRO_ENABLED === false`, so a client-side paid check unlocks the feature for
  the entire free tier. `caller.tier` reads the Stripe claim and ignores that
  flag.
  **Required before the Anthropic path ships to users:** it adds a new
  subprocessor, so the privacy policy's `dontShare` list (both locales), the
  Play **Data safety** form (which cleared Photos *because* photo-scan was
  off), and the App Store privacy labels all need updating.
  `functions/test/email-templates.spec.ts:132` asserts the welcome email does
  not advertise photo scanning; that assertion is deliberate and outlives all
  of this.
- **Input validation on four unguarded write paths** (2026-08-04). The web half
  is live; the mobile half is **in testers' hands** (iOS build 19+, Android vc
  8+). All four rules were
  shared in `packages/core` and mirrored in `firestore.rules` where rules can
  express them.
  - **RIR** was a bare `number` written straight from a numeric text input on
    both clients (a set was stored with `rir: 8`). Now a 0–5 integer via
    `clampRir`. **Rules cannot help here** — Firestore rules have no way to
    iterate a list, so individual sets inside `exercises[]` are unvalidated by
    construction and the clamp *has* to be client-side. Scale chosen 2026-08-04;
    nothing in the repo had ever defined one.
  - **Measurements** had ONE range for every field (`> 0 && < 200`), which is
    why a 15in chest stored fine — 15 is absurd for a chest and ordinary for a
    neck, and no single range can tell them apart. Per-field bands now, in
    `packages/core/src/measurement-bounds.ts` **and mirrored in the rules —
    keep the two in step.**
  - **Weigh-in dates** were never bounded, only weights were. A mistyped year
    plants a row decades from the series, and because the measured-TDEE window
    is bounded by ENTRY COUNT it stays in the regression indefinitely with
    maximum leverage on the slope. Rejected at the write path now. **The window
    semantics are deliberately unchanged** — a known, separately-scoped issue;
    do not "fix" it without deciding to move every sparse logger's target.
  - **Exercise duplicates** differing only by case/spacing now reuse the
    existing catalog entry instead of minting a second doc id (progression is
    keyed by `exerciseId`, so a duplicate splits the chart permanently).
  **The rules got STRICTER, and clients in the wild predate the client-side
  checks.** A user on App Store 1.0.0 (or a stale web tab) who enters an
  out-of-band measurement now gets a permission-denied instead of a friendly
  message. That is the intended enforcement, but it lands as a generic error
  until the next mobile binary ships. **Deliberately NOT done:** surfacing
  `tdee.outliersDropped` — it is computed on every TDEE run and read by no UI on
  either client, so the user still cannot see which weigh-in was discarded.
- **Sentry + Google sign-in diagnostics (mobile)** — **Live on Android in vc 6
  (alpha track, 2026-08-03 — §1). Still in no iOS binary**: build `f3e5daaf`
  contains it but has not been submitted to TestFlight. Originally: the Expo app had no error
  reporting of any kind, which is why the Play sign-in break below took a day to
  find. Sentry project **`ignia-mobile`** (org `gabriel-bermudez`, id
  `4511848397996032`); DSN wired into `apps/mobile/app.json`, ingestion verified
  end-to-end with a test event 2026-08-03. Google sign-in failures now carry the
  native code (`DEVELOPER_ERROR`, `PLAY_SERVICES_NOT_AVAILABLE`, …) instead of
  collapsing to one sentence.
  The web Sentry project was renamed `macrolog` → **`ignia-web`** in the same
  pass; its project id and DSN are unchanged, so `src/environments/environment.ts`
  needed no edit.
- **Home-screen widget — Android half was BROKEN in every shipped binary; fix
  shipped in Android vc 9** (`apps/mobile/src/widgets/`). Placed on a
  home screen for the first time on 2026-08-06 (vc 8) and it rendered an **empty
  transparent box**. Cause: `app.json` sets `experiments.reactCompiler: true`,
  and the React Compiler rewrites `TodayWidget` — PascalCase, returns JSX — to
  call `useMemoCache`. `react-native-android-widget` never mounts widgets in a
  React renderer; `buildWidgetTree` calls the component as a raw function, so
  the injected hook throws `Invalid Hook Call detected in TodayWidget` and
  nothing is drawn. Fixed with `'use no memo';` at the top of the widget file,
  enforced by `src/__tests__/widget-no-memo.test.ts`.
  **This was invisible to every gate we have** — tsc, jest and `expo export` all
  pass, and the widget appears in the picker and places normally. It surfaced
  only in **Sentry**, from the throw inside the widget task handler, which is
  the concrete payoff of vc 6 being the first Android binary with Sentry. **The
  Android widget never worked in vc 4, 6 or 8.** **The fix shipped in Android
  vc 9** (EAS `56a1af79`, commit `f3adeb83`), submitted 2026-08-06 and verified
  on the alpha track by the `androidpublisher` API:
  `status=completed, versionCodes=["9"]`.
  **VERIFIED ON A HOME SCREEN 2026-08-07 — a tester (Alejandro) confirmed the
  widget draws on his own device from a Play install.** That closes the check
  and, with it, the standing instruction not to describe the widget to testers:
  it is now fair to name in release copy and What's New. Two supporting signals,
  neither of which was sufficient alone: `IGNIA-MOBILE-3`
  (*"Invalid Hook Call detected in TodayWidget"*, 3 events, 1 user) last fired
  2026-08-06 22:24 from vc 8 and has not fired since vc 9 shipped — but silence
  also looks like "nobody has a widget placed", which is exactly why a human
  eye on a real home screen was the gate. If it ever fires from vc 9 or later,
  the fix did not take after all.
  **The device was on vc 11** (reported by the tester as "v11, I think" — the
  alpha track serves 11, so this is consistent, but it is a recollection and not
  a reading off the device). **It worked after simply updating the app**, with
  no report of having to remove and re-place the widget.
  That is one data point against the standing caveat, not a repeal of it. The
  caveat exists because Android caches the RemoteViews from the failed render,
  so a widget placed under vc 8 can keep drawing the blank frame after the
  binary is fixed. This case suggests it self-heals on update — but nobody
  confirmed that his widget pre-dated the update rather than being placed
  fresh afterwards, and those two stories are indistinguishable from the report
  as given. So: **if a widget is blank after updating, remove and re-add it**
  — as a remedy that is known to work, not as a step everyone must take.
  iOS is unaffected — its widget is SwiftUI and was never touched by this, and
  it was verified working on a physical iPhone from TestFlight build 13
  (2026-08-03), including refresh after a meal.
- **The Apple Watch complication and its transport** — the watch app
  (`targets/watch/`), the face complication (`targets/watch-widget/`), the
  three iOS **Lock Screen** accessory families, one shared Swift contract
  (`targets/_shared/Glance.swift`), and the repo's first custom Expo Module
  (`modules/watch-link/`) carrying the snapshot over
  `WCSession.updateApplicationContext`. **On TestFlight in build 16** (`VALID`, 2026-08-03) and **tested on a real Apple Watch 2026-08-04. Result: the transport works, the auto-refresh does not.** The mirror screen and the complication both render real kcal-left and protein numbers, which proves the whole delivery chain plus the App Group, the entitlement, the shared decoder and `_shared` at runtime. **But the face does not move after a meal is logged** — it only catches up when the watch app is launched fresh. Two fixes shipped in TestFlight build 19 and **the auto-refresh is CONFIRMED WORKING on the paired watch, 2026-08-06 — the face now updates after a meal without launching the watch app.** That closes the one defect the 2026-08-04 hardware test found. The fixes: `8cc2ba39` (the complication's `.atEnd` timeline meant one render decided the whole day — confirmed by remove/re-add restoring it) and `360662eb` (**the actual cure**: the `.backgroundTask(.watchConnectivity)` handler called `refresh()`, which re-reads but never *stores*, so no reload was ever requested — and it returned before activation completed). **The "log, then open the watch app" workaround is retired — stop telling testers to do it.** What remains unproven is only the layouts at 40mm/46mm in both locales (#46, needs a simulator). What is still unproven beyond that: the layouts at 40mm/46mm in both locales (#46, needs a simulator). What *was* verified locally: `tsc` clean, both `expo-target.config.js`
  files evaluate to the right entitlements, and
  `expo-modules-autolinking search -p apple` resolves `watch-link` →
  `WatchLinkModule` (the check that would have caught the `ExtensionStorage`
  disappearance in §3). **Credentials and compile are both cleared** — all four
  targets have App Store profiles, and #47 closed on the build rather than on a
  borrowed Mac. What is left needs hardware nobody can substitute for: a
  simulator for #46's layout readout, and a paired watch for the transport.
- **Health activity import** (steps / active energy → `dailyActivity`). Import +
  display only; deliberately does **not** feed measured-mode TDEE.
- **Per-meal reminder settings** (fixes the un-silenceable 1:30pm lunch nudge).
- **In-app rating prompt** (`84898243`).
- **Date localization** — dates followed the phone's locale, not the app's, so a
  Spanish user saw English weekday and month names throughout (`5028a9e8`).
- **Weigh-in outlier rejection** — one stray reading could rewrite the whole weight
  trend and drag the measured target to the floor (`946e7250`).
- **The Refine Targets catch** (`4f91b1f0`). Only the client half is pending: the
  `dailyWeights` index that commit added is *deployed*, and it already repaired
  Refine Targets for users on 1.0 without an app update.

Verify anything in this list with `git log 168e0394..HEAD -- <path>` — that range is
exactly "merged since the live binary". For a single commit, the sharper test is
`git merge-base --is-ancestor <sha> 168e0394` (exit 0 = it is *in* the live binary).

**Three items were wrongly listed here on 2026-07-29** and are called out so the
mistake is not re-made: the **recipe-URL import UI**, the **mobile verify-email
gate** (`a0049b84`), and **the App Review fixes from the two 1.0 rejections**
(`97662575`, `eb922813`, `04f30dcc`) are all **in 1.0**. The last of those is
provable without git: 1.0 is `READY_FOR_SALE`, and it only got there by passing the
review those commits fixed.

## 3. Builds: no longer the binding constraint

**As of 2026-08-07 this section is largely historical.** Both platforms now build
**locally on the MacBook Air (`ignia-mac`) at zero EAS quota**, and JS-only
changes need no build at all. The ceilings below still apply to cloud builds, but
cloud builds are now the fallback, not the default.

- **iOS: `eas build --local` on the Mac.** 15m57s cold, ~11m warm. Four targets
  verified nested in the `.ipa`. See `DEV_ENVIRONMENT.md` §3.10 + the `build-ios`
  skill. It also sidesteps the ASC 401 that breaks non-interactive *cloud* builds,
  so the ASC `.p8` never has to leave this machine.
- **Android: `./gradlew bundleRelease` on the Mac.** 10m36s cold, **1m51s
  incremental**, signed with the real upload key (`3C:E1:5E:…:E4:D5`, verified
  with `keytool -printcert`). See §3.11 + the `build-android` skill. **The Mac is
  the ONLY machine here that can do this**: Windows cannot compile RN's New
  Architecture C++ at all (260-char `MAX_PATH` vs a 350-char object path; upstream
  react-native-keyboard-controller#1247, open), and WSL2 cannot either because
  this is an ARM64 box and Google ships the NDK for `linux-x86_64` only.
- **Most fixes need NO build.** EAS Update ships JS/TS changes over the air in
  seconds — see the OTA row in §1. Run the fingerprint gate first
  (`apps/mobile/AGENTS.md`): an update published against a changed fingerprint
  succeeds and reaches **nobody**.
- The Mac holds `dev.keystore`, `credentials.json`, the Sentry token and an EAS
  session (locations + disposal list in `CLAUDE.local.md`).

### The cloud-build ceilings (fallback path only)

- iOS builds come from **EAS cloud, free tier**: 15 iOS builds/month, low-priority
  queue, 1 concurrent, 45-minute timeout. There are **two** ceilings, not one —
  a **30/month account total** and a **15/month per platform** sub-cap. Read
  both; the account total is the one that runs out first if the two platforms
  are used unevenly.
- **iOS 8/15, Android 5/15, account 13/30 for the 2026-08-01 → 2026-09-01
  period — measured 2026-08-06 from the API.** The counter is not the
  constraint this period. **Do NOT assume a failed build is free.** Measured
  2026-08-06 by reconciling `build:list` against `account:usage`: **six** Android
  builds were created this period and **five** were counted. The uncounted one is
  vc 7, which died early, in *Bundle JavaScript*. But vc 5 **also** errored — at
  the Gradle/Sentry-upload step, deep into the native build — and it **was**
  counted. So the exemption tracks how far the build got on the worker, not
  whether it succeeded; an earlier revision of this line claimed errors are
  always free, which was a generalisation from one observation and is wrong.
  Treat every queued build as a slot spent. The local bundle gate
  (`npx expo export`, see `apps/mobile/AGENTS.md`) therefore saves quota as well
  as the ~2h Android queue wait.
- **A duplicate build is the cheapest way to lose a slot, and it is silent.**
  On 2026-08-03 one `eas build -p ios` invocation produced TWO builds a minute
  apart on the same commit (`f3e5daaf` vc15 and `6415fca7` vc16, both
  `cfc19a06`, both finished). `autoIncrement` gives them different version
  codes, so nothing looks wrong in `build:list` — only the usage counter
  notices. After any `--no-wait` build, check `build:list --limit 2` before
  walking away. Note this is NOT the credential failure: that one genuinely
  cost nothing, exactly as this section claims.
- **The queue is the real cost, and it is not metered.** An Android build on
  2026-08-03 waited **2h05m** for a worker, ran Gradle for five minutes, and
  died on an HTTP 401 from Sentry's source-map upload. Both the build and the
  afternoon were gone. **Anything knowable before submitting must be checked
  before submitting** — `npm run doctor` now validates `SENTRY_AUTH_TOKEN`
  against the Sentry API for exactly this reason.

```sh
cd apps/mobile && npx eas-cli account:usage gabandres --non-interactive
```

  That command is the only authoritative source — `build:list` counts builds
  *started*, which over-counts (it includes errored builds) and cannot show the
  limit or the period boundary. It is easy to miss because it does not appear in
  `eas-cli --help`, which lists only the `account` topic.
- Android **APKs** build locally and free, via Gradle directly — *not* through
  `eas build --local`, which refuses to run on Windows. See §7. **Android AABs do
  not build here at all** — see the `bundleRelease` note in §4; they come from EAS,
  which has its own 15/month Android allowance.
- **Credentials are issued, `production` included — that blocker is fully gone
  as of 2026-08-03.** The scheme now has **four** targets and every one of them
  has an active App Store provisioning profile, all sharing one distribution
  certificate:

  | Target | Bundle id | Profile |
  |---|---|---|
  | Ignia | `fit.ignia.app` | `4N7B4FLGN4` |
  | Today | `fit.ignia.app.widget` | `S3KXW76C96` |
  | IgniaWatch | `fit.ignia.app.watchkitapp` | `534KZZ4G6U` |
  | IgniaWatchComplication | `fit.ignia.app.watchkitapp.watchkitextension` | `GTRBXF4G5D` |

  Distribution certificate `D48CC6237D` (serial `164DA7AA…`), expires
  **2027-07-07** — the same one that signed live 1.0 and TestFlight build 13.
  Targets **share** the cert and need **separate profiles**; do not mint a
  second cert, Apple caps them at 2 per account.

  Both watch targets reported `Synced capabilities: Enabled: App Groups` and
  `Linked: group.fit.ignia.app`. That is the explicit entitlement declaration in
  the two `expo-target.config.js` files doing its job — the plugin's
  `appGroupsByDefault` flag does **not** cover watch targets, and without those
  blocks the complication would ship unable to read what the watch app writes.

  **`.complication` is an unusable App ID suffix.** Apple's portal refuses any
  identifier whose final segment is `complication` — verified three times
  against the ASC API under two different parents, while `.watchkitextension`,
  `.face` and `.glance` all registered fine. The error says *"is not available.
  Please enter a different string"*, which reads like the name is taken and is
  not. Registering the parent first does not help.

  Run **once per distribution type** without `--non-interactive` and answer the
  Apple prompts. **ad-hoc** done 2026-08-01, **App Store** done 2026-08-03.
  EAS cannot mint credentials unattended: it refuses in non-interactive mode,
  *before* creating the build, so failed attempts cost no quota. Setting the ASC
  API key env vars does **not** help either — a `development`/`preview` build is
  **internal distribution**, which needs an ad-hoc profile, which needs a human
  to pick devices.

  The 2026-08-02 `production` failure at
  `Failed to register bundle identifier fit.ignia.app.widget` is what this pass
  cleared.

  That failure is **not** an ASC key problem, and the key's role is not the
  explanation (`47Z9RY8MT5` is Admin, and it answers ASC version queries fine —
  checked the same day). The failing call is a **Developer Portal** write, where
  EAS falls back to Apple ID session auth and asks for `EXPO_APPLE_ID` + 2FA. No
  API key covers that step. Credential failures cost **no build quota** — they
  happen before the build is created. `device:list` still needs
  `--apple-team-id AE6TTXW92K` when non-interactive.
- One iPhone is registered for ad-hoc distribution (UDID `00008140-0016199614C3801C`).
- **Two `development` builds exist.** `c539ab49` (commit `bb80759b`) was the first
  time the widget Swift ever compiled. **`de8fabd0` (commit `2a50e6e2`) is the one
  to install** — it carries the widget fix below. Install page:
  `https://expo.dev/accounts/gabandres/projects/macro-log/builds/de8fabd0-597c-4ebd-8f61-ccc75ec59dc5`

  These are dev-client builds, so the app shell needs `npx expo start --dev-client`
  to load JS; the widget itself is native and renders without Metro once the app has
  written data.
- **RESOLVED 2026-08-03 — kept because the trap is subtle and will be re-hit.**
  The widget now works on a physical iPhone from build 13; the fix below is what
  did it. Read this if autolinking ever drops a pod again.

  **The widget was dead because `ExtensionStorage`'s pod never reached the Podfile
  on EAS — and `ios.appleTeamId` was NOT the cause.** That earlier diagnosis was
  wrong; `2f7d0b0e` fixed a real warning but not this. Proven 2026-08-02 by
  grepping the build logs: `ExtensionStorage` appears **zero times** in the entire
  `INSTALL_PODS` phase of both `de8fabd0` (expo 54.0.35) and `f897f42f`
  (54.0.36), while ~34 other Expo module pods install normally. The device probe
  agrees — 42 native modules registered, that one absent.

  **The cause is a deployment-target mismatch, found 2026-08-02.**
  `ExtensionStorage.podspec` declares `s.platform = :ios, '16.4'`; the app was on
  SDK 54's default **15.1**. Expo's autolinking **silently drops** modules whose
  podspec floor is above the app's deployment target — no warning, no build
  failure, the pod simply never exists. Forcing the pod in explicitly is what
  finally made it speak: `CocoaPods could not find compatible versions for pod
  "ExtensionStorage" … they required a higher minimum deployment target`
  (build `ab70e74f`, the only one that has ever failed here).

  Fix: `ios.deploymentTarget: "16.4"` in `expo-build-properties`. **This raises the
  App Store minimum** — iPhone 6s / 7 / SE-1 cap out at iOS 15 and will no longer
  be offered updates. Accepted by the owner 2026-08-02 as the cost of the widget.
  The temporary force-link plugin was **deleted** in the same commit: with the
  target raised, autolinking adds the pod itself, and a second explicit `pod` line
  would be a duplicate declaration.

  Also settled by that build, so nobody re-investigates: the package resolves from
  the **monorepo root** `node_modules` on the worker (the plugin logged the path),
  so hoisting was never involved. Likewise not involved: `appleTeamId`, the App
  Group entitlement, the legacy `"ios"` config key, the pod cache, and the expo
  patch version — 54.0.35 and 54.0.36 fail identically.

  The general trap stands: this package fails *silently and completely* rather
  than throwing, which is why the `__DEV__` probes in `src/lib/widget.ts` are kept.
  They report, on first launch, which of "native module missing" / "not entitled to
  the App Group" / "wrote fine" is true — three different fixes that otherwise look
  identical. Reading them cost one build and settled what two builds of guessing
  had not.
- The build archive is **7.5 MB**, not 172 MB — see `.easignore`, added 2026-08-01.
  EAS keeps `.git` in the archive unless explicitly ignored, and this repo's history
  carries ~138 MB of committed-then-deleted `node_modules` binaries. **Editing that
  file is dangerous:** once it exists, EAS stops reading `.gitignore` entirely, so
  every pattern must be repeated there or the directory starts uploading.
- Budget **two** builds for the next release: one `development` for device QA (spent,
  above), one `production`. Shipping never-executed Swift straight to review is how
  the last two rejections happened, and each rejection cost a build anyway.

```sh
cd apps/mobile && npx eas-cli build:list --platform ios --limit 5   # what exists
```

## 4. Open work, and what each is actually blocked on

| # | Work | Blocked on |
|---|---|---|
| — | Next iOS binary (everything in §2) | Nothing structural. Build 13 exists, is on TestFlight, and its widget is verified on device — the device-QA gate this row used to name is **cleared**. What remains is submitting the 1.1.0 version page to App Review (it is still `PREPARE_FOR_SUBMISSION`), or cutting a newer build first if more of §2 should ride along. Quota and credentials are both resolved |
| — | Verify the **Android** widget on a device | Nobody has put it on an Android home screen. It is in Play vc 4, and its task handler registers through the custom `index.js` — a path no device has exercised. The iOS half is **done**: verified on a real iPhone 2026-08-03 from TestFlight build 13, kcal left + protein left, **and the numbers moved after a logged meal**, which proves the whole chain rather than the render alone |
| #46 | Read the watch layouts on a simulator | **a Mac with Xcode** (currently: borrow one). Its stated precondition — "the build session has written the watch Swift" — is now **met**: the real layouts exist, so the sitting is the readout it was designed to be |
| — | Compile the watch targets — **the compile gate, closed 2026-08-03** | **DONE — 2026-08-03, and it did NOT need a Mac.** An EAS iOS build *is* macOS running Xcode. Build `f3e5daaf` (commit `cfc19a06`) compiled, signed and packaged both `IgniaWatch.app` and `IgniaWatchComplication.appex`. **The load-bearing question is answered: `targets/_shared/Glance.swift` DOES resolve from the watch target** — the compiler read `Glance.strings(snap.locale)` at `targets/watch/index.swift:160` and emitted only an unrelated unused-binding warning. Had `_shared` not been linked in, that line would have been a hard "cannot find in scope" and the build would have failed. So the one-Swift-mirror design holds; the shared-contract plan needs no other vehicle. Also proven in the same build: `ViewThatFits` compiles at the watchOS `10.0` pin; the custom Expo module autolinks (`Installing WatchLink (1.0.0)` → `libWatchLink.a`); `ExtensionStorage` still installs alongside it, so no regression to the shipped iPhone widget. **One warning in the entire build** (an unused `protein` binding), since fixed |
| — | App Store screenshots | owner, on device (`store-assets/README.md`) |
| — | Play launch — **first AAB** | **DONE** (2026-08-02). Local `bundleRelease` is **permanently dead on this machine**: `LongPathsEnabled=1` and a reboot changed nothing, because the cap is **ninja**, not the registry — the SDK's `cmake/3.22.1/bin/ninja.exe` is not long-path-aware, and the `react-native-keyboard-controller` object path is 348 chars. Relocating `.cxx` cannot save it (the CMake target-dir prefix alone is 105 chars). **AABs come from EAS.** `eas.json` `production` now sets `android.credentialsSource: "local"` so EAS signs with `credentials/dev.keystore` instead of minting a new upload key — **that line is load-bearing; removing it silently changes app identity.** Artifact: EAS build `4b513a00`, vc 3, signer SHA-256 `75:4B:03:19:…:F6:D8` |
| — | Play launch — **upload the AAB to a closed track** | **DONE** (2026-08-02). vc 4 is on Closed testing - Alpha and submitted; the app is in Google review. Play does not accept an app's *first* upload through the Developer API, so this one went through the console UI. **vc 3 was discarded, not shipped** — it declared three health READ permissions the app never requests, and Play's health declaration demands a written justification per read permission. `07ce8e99` removed them; vc 4 declares 11 health permissions (5 read, 6 write). Do not resurrect vc 3 |
| — | Play launch — **the health declaration** | **DONE**, and it is per-permission prose that will need editing whenever the health permission set changes. Declared features: Activity and fitness, Nutrition and weight management, Sleep management — no Medical, no research. Each of the 5 read permissions has a justification stating the in-app surface, that data stays in the user's own account, and that it is never sold, shared, or used for ads. Active calories and steps additionally state they are display-only and excluded from the calorie target, which is true and is the honest answer to "why do you read activity" |
| — | Play launch — **`eas submit` for every upload after the first** | **DONE 2026-08-03 — the service account works** (`play-check` returns HTTP 200 on `applications/fit.ignia.app/reviews`). `eas.json` `submit.production.android` points at `apps/mobile/credentials/play-service-account.json` — **track `alpha` (= closed), `releaseStatus: "draft"`, so a submit uploads without rolling out to testers; it still has to be promoted in the console.** **Google DELETED the "Setup → API access" page** — do not go looking for it, and ignore any doc that says to link a Google Cloud project, [that requirement is gone](https://developers.google.com/android-publisher/getting_started). The only steps are: enable `androidpublisher.googleapis.com` on the GCP project (done), then **Users and permissions → Invite user** with the service-account email. Granted: app-scoped to Ignia, *Release apps to testing tracks* + *Manage testing tracks and edit tester lists*; deliberately **not** production release or financial data. Took effect immediately, not the documented 24h |
| — | Play launch — **Google Sign-In was broken for 100% of Play installs** | **STILL BROKEN after the 2026-08-03 fix; a second, different cause was found and fixed 2026-08-05 — see the row below.** The 08-03 diagnosis was correct but incomplete. Original writeup: **FIXED 2026-08-03, server-side, no build.** `fit.ignia.app` is enrolled in **Play App Signing**: Google strips the upload signature and re-signs every AAB with its own key before distribution. Android Google Sign-In authorizes the caller by *package name + signing-certificate SHA-1*, so a Play install presents **`8261e9d8c06a85725d84a5f53e24326e81a83cd4`** — which was not registered in Firebase. Play Services rejected the call with `DEVELOPER_ERROR` before it ever reached Firebase Auth, and the app rendered that as "Could not sign in. Please try again." Fixed by `firebase apps:android:sha:create` on app `1:647810616435:android:a6f4c5f9e200b3332c2e06`. **The trap: this is invisible to every build you test locally**, because those carry the upload key (`3ce15e38…`), which *was* registered — it breaks only for people who install from the store. It looked like a per-user bug for a day: one tester failed, another had "succeeded", but that second account was created 2026-08-01, a day before any AAB existed on Play, so he was never on a Play-signed build at all. **Whenever the signing key changes — key rotation, a new upload key, a second app — re-check `firebase apps:android:sha:list` against Play Console → Protected with Play → Play Store protection → Manage Play app signing** (the old "App integrity" page now just redirects there; the real URL is `.../app/<appId>/keymanagement`) |
| — | Play launch — **Google Sign-In broke a second time: the SHA-1 registered on 08-03 is not the key that signs the shipped APKs** | **FIXED 2026-08-05, server-side, no build — awaiting confirmation from a tester.** Sentry caught `DEVELOPER_ERROR` at `signInWithGoogle.picker` on 2026-08-05 03:00:17Z from a real Play split-APK install of **vc 6** (Samsung SM-S942U, Android 16, `is_split_apks: true`), **31.5 h after** the 08-03 SHA fix (audit log: `CreateShaCertificate` at 2026-08-03T19:32:13Z), so propagation delay is ruled out. The tester fell back to a password login 2 min later (Firebase Auth, 03:02:15Z), and **no `google.com` account has ever been created or signed in from a Play install** — the last Google sign-in anywhere is 2026-08-01, a day before the first AAB existed. **Cause, established from the `androidpublisher` API rather than inferred**: `GET applications/fit.ignia.app/generatedApks/6` returns exactly ONE signing-key group, `certificateSha256Hash = 37:5D:D3:E6:…:70:FE` — and that hash is **not** the app signing key the console shows as *In use* (`72:E8:39…` / SHA-1 `8261e9d8…`, the one registered on 08-03). It is the **Previous app signing keys** row, first used 1 Aug 2026 01:14, SHA-1 **`1483ddc326f972896e03d8db45ba4edd1d621da4`**. The console's own **Digital Asset Links JSON** snippet on the same page names `37:5D:D3:E6…` as the app's cert, confirming it. In other words the Play app signing key was **changed after vc 4/vc 6 were generated** (the *In use* key shows 0.0% install base), so the fingerprint the console shows first is the one that will sign the NEXT release, while every binary a tester can install today is signed by the previous one. Registering `8261e9d8…` on 08-03 was therefore a no-op for the installed app. **Registered 2026-08-05:** `1483ddc326f972896e03d8db45ba4edd1d621da4` (→ OAuth client `…h4j12fvoic0d3…`) — **this is the fix** — plus, forward-looking, the post-quantum cert `1106505210026f5c9c7fbba13c2b058375910ff4` (→ `…vearntjrg4dkj7…`), since Play App Signing here is enrolled in **Quantum-ready (beta)** and [Google's guidance](https://support.google.com/googleplay/android-developer/answer/9842756) is to register the classical, PQC, and older-device fingerprints with every API provider. All five confirmed in `firebase apps:sdkconfig ANDROID`. **Do not diagnose this from the App signing page alone**: its fingerprints sit behind copy-to-clipboard chips (not selectable text, absent from the DOM), the *Previous* key's SHA-1 hides behind the row's ⋮ menu, and the page gives no hint which key signs an existing release. **Ask the API which cert ships, per versionCode** | `node scratch: GET androidpublisher …/generatedApks/<vc>` → `certificateSha256Hash` must match a registered cert; and `npx firebase apps:android:sha:list 1:647810616435:android:a6f4c5f9e200b3332c2e06 --project fitness-tracker-gb-1775407101` must list **5** hashes |
| — | Play launch — **tester feedback URL** | **DONE — saved on the track, nothing pending.** Verified in the console 2026-08-05: the Testers tab holds `https://ignia.fit/support` with Save greyed out, and Publishing overview lists no changes awaiting review. Previously: **Saved but NOT submitted.** `https://ignia.fit/support` (same page the App Store listing uses) is staged on the closed track as "Change feedback channel", showing under *Changes not yet submitted for review*. Held back deliberately: the app's first review was already in flight, and whether a second submission joins that review or restarts it is not established. Submit it after approval — one click on **Submit 1 change for review** |
| — | Play launch — **12 testers × 14 consecutive days** | **owner, and this is now the only thing left.** **THE 12-TESTER REQUIREMENT IS MET — Google ticked it itself, verified on the app Dashboard 2026-08-06.** The *Apply for access to production* checklist now reads: ~~Publish a closed testing release~~ ✓ · ~~Have at least 12 testers opted-in to your closed test~~ ✓ · **Run your closed test with at least 12 testers, for at least 14 days** ← the only unticked item. *Apply for production* is still greyed out. The twelfth was `gabyfi0311@gmail.com` (Gabriel Figueroa), added 2026-08-06; he already had an Ignia account from the web (Firebase Auth, 2026-04-13), which is not itself evidence of an Android opt-in. **Do not compute the apply date by hand and do not trust one written here** — Google owns the 14-day clock and will tick the third box; the count is no longer the thing to watch, that box is. Naively it lands ~2026-08-20 (14 days from the twelfth opt-in), and it slips if anyone drops below 12 in the meantime, which is precisely why the checklist and not a calendar is the source. The prior reading was **11 currently opted-in** (Dashboard, 2026-08-05 ~20:40Z; it was 8 that morning), so this moved 8 → 11 → 12 in about 36 hours. Earlier the same day the email list `Ignia Beta Testers` held 10 of 12 invited — three of those accepted during the day, so the invited list itself now needs at least one more name. **Play reports the count and nothing else**: there is no per-tester opt-in status in the console, and none in the `androidpublisher` API either (`edits/{id}/testers/{track}` returns `{}` for all three tracks — email lists and opt-in state are simply not exposed). The only per-person evidence available is a Firebase Auth account, which proves *sign-in*, a strictly later step than opt-in. **Invited ≠ opted-in**: only the second number moves the checklist, and it is the one on the app Dashboard under *Apply for access to production*. **Recruit the remaining testers in one batch** — the group is gated by the last person through the door, so a straggler pushes the earliest apply date out by however late they join. **Tell testers that uninstalling the app is NOT the same as opting out**: opting out is an explicit *Leave the program* action on the opt-in URL or the app's Play listing, and only that resets their 14 days ([tester-side doc](https://support.google.com/googleplay/answer/15654751)). Uninstalling leaves the opt-in intact — but it also leaves no engagement, and Google asks what testers actually did with the app when you apply. **Opt in, install and sign in are three separate steps** and only the first moves the counter — `narvaezheydie@gmail.com` opted in on 2026-08-05 and still had no Firebase account afterwards, so she was counted while never having opened the app. **Measured engagement, 2026-08-05 20:40Z** (Firebase Auth × per-user Firestore subcollection counts, not a dashboard): of the four accounts created that day, `emmanuelpagan.16@` has 5 dailyLogs + 1 custom food + a workout session + sleep, `kcruz423@` has 7 dailyLogs + 3 custom foods, `christian.alicea24@` has a weight and a workout session, and `ignia@crna.casa` (Matt Salinas, password sign-up 20:26Z) finished onboarding in 74 s with nothing logged yet. `benrupr@` and `juanllanos13@` have accounts and zero rows. So roughly half of the people who sign in actually log something on day one — thin, but not the empty test the opt-in counter alone would suggest. Re-run that check before answering Google's "what did your testers do" questions. **A tester sent the link over WhatsApp will usually open it in WhatsApp's in-app browser, which does not share Chrome's Google session and shows "App not available" no matter what the list says** — tell them to open it in Chrome, signed in as the invited address. That, plus the propagation delay after an address is added (she was told to try 12 minutes later, and it failed), accounts for every "I'm not on the list" report so far. The build is **approved and live** — the opt-in link `https://play.google.com/apps/testing/fit.ignia.app` works for listed testers today. Personal account, so production access is gated on 12 testers staying opted in 14 CONTINUOUS days |
| — | Play launch — **Data safety form** | **DONE** (2026-08-01, filled directly in the console). Declares Personal info (Name, Email, User IDs) + Health and fitness (Health info, Fitness info); collected, **not shared**, required, App functionality + Account management. Nothing else. The saved draft had over-declared Photos, Crash logs, Device IDs, User-generated content and Other personal info — all cleared, each checked against the Android app (no analytics/crash SDK, no push token, photo-scan flag-off, RevenueCat is iOS-gated so it never configures on Android). CSV import was tried twice and failed with a generic "Couldn't upload"; the console UI worked |
| — | Play launch — **Advertising ID declaration** | **DONE** — declared **No**. App content now reads "You're all caught up" |
| — | Play launch — **delete-account URL** | **DONE and LIVE.** Verified 2026-08-01 and it *failed* — signed out, the page said only "sign in first to delete your account". `fb7d24d1` adds an unconditional "How to delete your account" section (iOS path, web path, and an email path for users who can't sign in) plus what is erased vs. what survives in backups, both locales. Deployed to `ignia.fit/privacy` and confirmed in a browser |
| — | Play launch — **store listing graphics** | **DONE.** `scripts/play-store-assets.mjs` generates all of them from artwork already in the repo → `store-assets/play/`. Play needs 16:9 or 9:16 and the captures are 1:2.17, so each is fitted onto a 1080×1920 canvas in the brand panel colour (the art already sits on that colour, so the letterboxing is invisible). Icon 512², feature graphic 1024×500, five phone screenshots — all uploaded and saved |

**Apple glanceable surfaces (map #31).** 14 of its 16 tickets are **closed** —
transport, staleness, layouts, tap targets, review surface and sign-out privacy
were decided first, and the on-device widget verification closed 2026-08-03. What remains is
**#46 alone — the layout readout, which needs a simulator.** The compile gate
closed on an EAS build: an EAS iOS build IS macOS running Xcode, so the compile half never
needed the borrowed machine and the map is down to one hardware-gated item.

The building is done. `apps/mobile/targets/` now holds `_shared`, `widget`,
`watch` and `watch-widget`, plus `apps/mobile/modules/watch-link` for the phone
half of the transport. **What is unproven is narrow and specific: none of that
Swift has ever been through a compiler.** Do not read "written" as "works" — the
iPhone widget was written, merged, and silently broken for two builds because a
pod never linked.

**The credentials gate is real and is not the Mac.** The scheme gains **two new
bundle ids** (`fit.ignia.app.watchkitapp` and
`fit.ignia.app.watchkitapp.complication`), neither of which exists in the Apple
portal. §3 already records that EAS cannot mint those unattended — it refuses in
non-interactive mode, and the failing call is a Developer Portal write where EAS
falls back to Apple ID session auth and asks for `EXPO_APPLE_ID` + 2FA, which no
ASC API key covers. `production` still has not had its interactive pass; this
adds two more ids to it. Credential failures cost **no build quota** — they
happen before the build is created.

## 5. Decided and deliberately not happening

Do not re-propose these without new information; the reasoning is in the linked ADR
or research note.

- **Pro tier / IAP / Stripe** — dormant, flag-gated off. v1 is free. (ADR-0015)
- **AI photo-scan** — deferred to a paid tier; runtime cost gate. (ADR-0015)
- **App Intents / Siri Shortcuts** — decided **no** for this batch, 2026-07-23.
- **Watch app reading Firestore directly** — structurally unavailable; no watchOS
  Firestore client. (`docs/research/watch-complication-transport.md`)
- **Activity feeding measured-mode TDEE** — would double-count. Formula mode only.
- **Shared subscription cache in mobile** — per-hook subscriptions are intentional.
  (ADR-0016)
- **A 4th scheduled Cloud Function** — Cloud Scheduler's free 3 jobs are spent; fold
  into `hourly-tasks.ts`.

## 6. App Store submission — standing rules

Carried over from the two 1.0 rejections. These are permanent, not a checklist to
do once.

- **Accounts are Individual, not an entity** — Apple Developer Individual ($99/yr,
  no D-U-N-S) and Play Individual ($25 one-time), decided 2026-07-07 after dropping
  the Wyoming-LLC plan. The owner's legal name shows publicly as seller. Known
  accepted risk: guideline 5.1.1(ix) prefers a legal entity for health apps that
  touch HealthKit; enforcement is inconsistent and a reviewer *can* raise it.
- **Always hand Apple `review@ignia.fit`** in the Demo Account fields — it is
  pre-verified and seeded. A fresh account is walled out by the email-verification
  gate, and 2.1 demo-account failures are Apple's largest rejection bucket. Never
  point them at `demo@ignia.fit` (screenshots only). Confirm it can still write
  before submitting.
- **Notes for Review must name the specific changes.** Generic text gets rejected
  under 2.3.1.
- **`supportsTablet` stays `false`.** Apple reviews on iPad anyway (that is how the
  1.0 layout clipping surfaced), but flipping it true obliges an iPad design pass
  *and* iPad screenshots — more rejection surface, not less.
- **Keep `NSPhotoLibraryUsageDescription`** even though photo-scan is unreachable:
  `expo-image-picker` is still linked, and a *missing* purpose string is an
  automated ITMS-90683 rejection. An extra one is never punished.
- **Privacy labels must match reality** — health data + email, no Photos.

## 7. Commands that answer questions faster than reading

**The emulator suites (`test:ledger`, `test:rules`) need JDK 21+.** `firebase-tools`
dropped Java <21, and this machine's PATH `java` is 17, so both suites fail with
`firebase-tools no longer supports Java version before 21` — a toolchain error that
reads like a broken test. JDK 21 **is** installed; just point at it first:

```sh
export PATH="/c/Program Files/Microsoft/jdk-21.0.11.10-hotspot/bin:$PATH"
```

Run the two suites **separately**, not back to back — the second one inherits the
first's emulator port before it is released and reports a phantom failed file.


```sh
npm start                  # web dev (emulators: npm run dev)
npm test                   # web unit tests
npm --prefix packages/core test
cd apps/mobile && npx expo start

# Android release APK on Windows (free, unlimited).
# `bundleRelease` does NOT work here — ninja's 260-char cap, see §4. AABs: EAS.
cd apps/mobile && npx expo prebuild -p android --no-install
cd android && ./gradlew.bat assembleRelease --no-daemon \
  -Pandroid.injected.signing.store.file=<abs path to credentials/dev.keystore> ...
```

**`npx expo prebuild -p ios` does NOT work on Windows** — SDK 54 skips it outright
(`Skipping generating the iOS native project files. Run npx expo prebuild again
from macOS or Linux`, then exits non-zero). An earlier version of this file claimed
it ran here and proved the Xcode project generates; it does not, and there is no
local way to inspect the generated Podfile or verify iOS autolinking. That is why
the widget's missing native module could only be caught by shipping a build and
reading a runtime probe.

## 8. Where things live (and what gets deleted)

| Question | File |
|---|---|
| What is this repo, how do I work in it | `CLAUDE.md` |
| What does this word mean | `CONTEXT.md` |
| **What is true right now** | **this file** |
| Why is it built this way | `docs/adr/` |
| What shipped, when | `CHANGELOG.md` (+ `CHANGELOG-archive.md`) |
| What did we research | `docs/research/` — each file opens with its verdict |
| What's still wrong in the UX | `UX_AUDIT.md` |
| Store listing field values | `docs/app-store-metadata.md` |
| Machine-local credential paths | `CLAUDE.local.md` (git-ignored) |

**The rule that keeps this from happening again: a plan document is deleted the day
its work ships.** Its outcome belongs in `CHANGELOG.md`, its reasoning in an ADR, its
current state here. Git keeps the original forever; `git log --diff-filter=D
--name-only` finds it. Never leave a shipped plan in the tree with a "CORRECTION"
block on top — that is how a status doc and a wish list become indistinguishable.
