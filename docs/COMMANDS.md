# Commands that answer questions faster than reading

Every claim in `STATUS.md` is meant to be re-derivable. This file holds the
commands that do it, so `STATUS.md` can cite one instead of carrying it.

**Read a number from the authority, never from a doc.** ASC for iOS state, the
`androidpublisher` API for Play, the artifact itself for fingerprints. A number
written down here or in `STATUS.md` is a cache, and caches go stale.

## Everyday

```sh
npm start                  # web shell dev (emulators: npm run dev)
npm test                   # web shell unit tests
npm run build              # prod build — the last step is load-bearing, see below
npm run doctor             # config-drift + copy guard + secret-version audit
npm --prefix packages/core test
cd apps/mobile && npx expo start
```

## The emulator suites find their own JDK

`firebase-tools` dropped Java <21. This machine's `JAVA_HOME` points at 17 while
JDK 21 sits installed beside it, so both suites used to fail with
`firebase-tools no longer supports Java version before 21` — a toolchain error
that reads like a broken test, and was twice written down as one.

`scripts/require-java21.mjs` is a **launcher**, not a warning: it locates a
JDK 21+, puts it first on PATH with a matching `JAVA_HOME`, and runs the command.
`npm run test:rules` goes through it, so **no PATH export is needed**. It prints which JDK it picked.

Nothing in its candidate list is trusted: each path is a place to *look*, and a
JDK is used only after `<candidate>/bin/java -version` reports 21+. That is what
makes it safe on a machine that is not this one. macOS asks
`/usr/libexec/java_home -v 21+` first.

As a preflight it never could have worked — a child process cannot change its
parent's PATH, so printing advice was the only thing it was capable of. It
printed the correct fix for four days while the suites kept not running.

```sh
npm run test:rules         # ALL functions specs incl. firestore.rules
```

**Run them separately, never back to back** — the second inherits the first's
emulator port before it is released and reports a phantom failed file.

## iOS state — ask App Store Connect

```sh
# version + review state + whether approval auto-publishes
node -e "import('./scripts/asc-client.mjs').then(async({api,APP_ID})=>{const r=await api('GET','/v1/apps/'+APP_ID+'/appStoreVersions?limit=5&fields[appStoreVersions]=versionString,appStoreState,releaseType');r.data.forEach(v=>console.log(v.attributes.versionString,v.attributes.appStoreState,v.attributes.releaseType))})"

# which build is attached to a version (a submitted version's build is FROZEN)
node -e "import('./scripts/asc-client.mjs').then(async({api,APP_ID})=>{const v=await api('GET','/v1/apps/'+APP_ID+'/appStoreVersions?limit=1&filter[versionString]=1.2.0');const b=await api('GET','/v1/appStoreVersions/'+v.data[0].id+'/build');console.log(b.data?.attributes?.version)})"
```

**A TestFlight build reaches external testers only after Beta App Review —
uploading is not shipping.** Builds sat at `READY_FOR_BETA_SUBMISSION` for four
days once, installable by nobody but the internal group, which is why several
features read as "unverified" when they were in fact undeliverable:

```sh
# externalBuildState per build
node -e "import('./scripts/asc-client.mjs').then(async({api})=>{const r=await api('GET','/v1/builds/<id>/buildBetaDetail');console.log(r.data.attributes)})"

# put a build in front of external testers: group add + beta review, state before/after
node scripts/asc-testflight-external.mjs --build 64            # dry run
node scripts/asc-testflight-external.mjs --build 64 --commit
```

**Only the newest UNRELEASED version's build can go external.** A build of a
version already `READY_FOR_SALE` is refused with *"This version and prior
versions are closed for beta review submission"* (build 63, 2026-09-05) and
sits in the group at `READY_FOR_BETA_SUBMISSION` forever.

**Trust ASC, not the CLI exit.** `eas submit` has printed *"Something went wrong
when submitting"* for an upload that had in fact succeeded; the re-run then
failed as a duplicate.

## Android state — ask Play

Track state comes from the `androidpublisher` edits→tracks API with
`apps/mobile/credentials/play-service-account.json` (see `CLAUDE.local.md`).
Read the versionCode from **Play**, never from the build log — the log describes
the remote counter advancing for the *next* build.

```sh
node scripts/app-version-sync.mjs --check     # report drift, write nothing (what doctor runs)
node scripts/app-version-sync.mjs             # rewrite both numbers from the APIs
```

**Both platforms are derived** (since 2026-08-15) — android from the
androidpublisher tracks API, ios from the ASC version in `READY_FOR_SALE`. Never
hand-edit either number. A change reaches nobody until
`npm run build && firebase deploy --only hosting`.

**Which cert signs a given release** — never read this off the App signing page,
which shows the key that will sign the *next* release:

```sh
# GET androidpublisher/v3/applications/fit.ignia.app/generatedApks/<versionCode>
# → generatedApks[].certificateSha256Hash
npx firebase apps:android:sha:list 1:647810616435:android:a6f4c5f9e200b3332c2e06 \
  --project fitness-tracker-gb-1775407101      # expect 8 hashes
```

**Eight, not five** — re-counted against the API on 2026-08-29, and this line
said five until then. Five SHA-1 (upload key, previous Play signing key, Play
classical, Play post-quantum, a stray EAS keystore) plus three SHA-256 (the three
Play signing certs; the upload key has none). Fewer than 8 means someone rotated
a key or the list was never re-read. Google Sign-In authorizes by *package name +
signing-certificate SHA-1*, and the failure is structurally invisible on a
locally-built install. Full key table and the two bugs it caused:
`CLAUDE.local.md`.

### Is the app actually LIVE on Play?

The production track holding a release is **not** the same as the app being
installable, and there is **no API for review status** — checked against the
whole `androidpublisher` v3 resource list on 2026-08-29. The only honest reads
are the Play Console and the public store URL, and the URL is the one that
matches what a user sees:

```sh
curl -s -o /dev/null -w "%{http_code}\n" \
  "https://play.google.com/store/apps/details?id=fit.ignia.app&gl=US"
# 404 = not published (in review, or not released)   200 = live
```

Compare against a known-live app from the same client before believing a 404 —
`com.spotify.music` returns 200. **Do not build a probe on
`changesInReviewBehavior=ERROR_IF_IN_REVIEW`**: one was written and disproved the
same day, because an empty edit has nothing to reconcile so the check never fires
and it reports NOT IN REVIEW while the app is in review. The reasoning is in the
header of `scripts/play-production-release.mjs`.

### Where does the app ship, and is it still pinned?

```sh
node scripts/play-production-release.mjs --availability   # read the track's countries
node scripts/play-production-release.mjs --check-source   # diff against App Store Connect
```

`--availability` names every missing/extra territory. The target is **128**, not
the 145 the ASC mirror holds: Play's picker offers 176 territories and does not
offer 17 that iOS ships to, and the EU 27 + GB/IS/NO are held back deliberately
until Play's own DSA trader declaration is filed. Country availability is
**Console-only** — `edits.countryavailability` has `get` and nothing else.

## OTA — the fingerprint gate

An update published against a changed fingerprint **succeeds and reaches
nobody**, which is indistinguishable from a working update. Gate first, on the
machine that **builds that platform** — the hash is machine-dependent, and since
2026-08-17 the hosts are split: **Android on Windows, iOS on `ignia-mac`**. A
hash generated on the other machine matches no binary.

```sh
# iOS — on the Mac
ssh ignia-mac "cd ~/fitness-tracker-pwa/apps/mobile && npx expo-updates fingerprint:generate --platform ios"
# Android — here
cd apps/mobile && npx expo-updates fingerprint:generate --platform android

cd apps/mobile && npx eas update:list --branch production --limit 3
```

Publishing is likewise per-platform and per-host, and since Expo SDK 55 needs
`--environment` (eas-cli: *"Required for projects using Expo SDK 55 or greater"*).
Bare `eas update` publishes both platforms and is correct on neither machine;
`.claude/hooks/guard_eas_update.py` blocks it, along with each platform from the
wrong host and any publish missing `--environment`.

Ground truth is the fingerprint file **inside the artifact**
(`base/assets/fingerprint` in an `.aab`, `Payload/*.app/EXUpdates.bundle/fingerprint`
in an `.ipa`), never a locally generated hash. The current table lives in
`apps/mobile/AGENTS.md`.

## How long a local build takes — on THIS machine

Build times in `build-infrastructure.md` were all measured on the **M1 Air**, so
on any other Mac they are not a baseline. Re-measure rather than assume, and
paste the emitted line back into that file with the machine named.

```sh
ssh ignia-mac "cd ~/fitness-tracker-pwa && git pull && node scripts/time-mobile-builds.mjs --dry-run"
ssh ignia-mac "cd ~/fitness-tracker-pwa && node scripts/time-mobile-builds.mjs"   # ~40min on an M1
```

`--dry-run` first: it prints the chip/cores/RAM, checks the **Data** volume has
the ~20 GB §3.11 needs, and reports which caches are present — before spending
the wall-clock. A run below that threshold dies mid-CMake on `No space left on
device`, which is how `vc 28` was lost.

**A genuinely cold number is measurable once per machine.** `eas build --local`
stages its prebuild outside `apps/mobile/{ios,android}` (neither directory exists
on `ignia-mac`, and both platforms ship from it), so warmth lives in `~/.gradle`
and `~/Library/Caches/CocoaPods`, not in the working tree — deleting native dirs
does not manufacture cold. On a new laptop, run this before anything else warms
those caches. The script never runs the two platforms concurrently: they share
one working tree, `node_modules` and Metro cache, so parallel means corrupted
output, not a faster build.

## Web build + deploy

**The last step of `npm run build` is load-bearing — do not reorder or drop it.**
`scripts/sentry-release.mjs` mutates `dist` *after* `ng build` has hashed it
(sourcemap debug IDs, map strip), checks that `public/ngsw-worker.js` — the
safety worker that unregisters every old PWA install (ADR-0036) — reached dist,
and writes **`build-info.json` last**. That file is what
`.claude/hooks/guard_firebase_deploy.py` checks before a hosting deploy: it must
exist, say `production: true`, and be newer than every file under `src/`.

```sh
# what the deploy guard checks, by hand
node -e "const{readFileSync,existsSync}=require('fs');const D='dist/fitness-tracker-pwa/browser';const b=JSON.parse(readFileSync(D+'/build-info.json','utf8'));console.log(b, 'sitemap', existsSync(D+'/sitemap.xml'), 'safety worker', existsSync(D+'/ngsw-worker.js'))"

curl -s https://ignia.fit/index.html | grep -o '__MACROLOG_RELEASE__[^;]*'   # which commit is live
curl -s -o /dev/null -w '%{http_code}\n' https://ignia.fit/app             # 200, and the body is the "moved" page, not a log
```

**Read the deployed artifact back, don't infer from the deploy exit.** Several
ships were confirmed by fetching the served chunk and grepping it, and one was
caught wrong that way.

## Photo-scan

```sh
node scripts/smoke-photo-scan.mjs <image.jpg>   # ~20s: throwaway user, scan, provenance, delete
```

Read the `-> matched description` column, not the calories — a wrong food looks
perfectly reasonable as a number.

Local check on the compiled resolution path, no network:

```sh
cd functions && node -e "const{loadFoods}=require('./lib/usda-db.js');const{resolveItems,totalsOf}=require('./lib/photo-resolve.js');console.log(JSON.stringify(totalsOf(resolveItems(loadFoods(),[{name:'grilled chicken breast',grams:150,state:'cooked'},{name:'white rice',grams:180,state:'cooked'},{name:'black beans',grams:120,state:'cooked'}]))))"
# → {"calories":640,"protein":52.9,"carbs":66.2,"fat":16.9}
```

## Cost

```sh
# what the Cost page models — same meters, by hand
gcloud secrets list --project fitness-tracker-gb-1775407101 --format="value(name)" | wc -l   # secrets (free tier: 6 active VERSIONS per billing account)
gcloud scheduler jobs list --location us-central1 --project fitness-tracker-gb-1775407101      # jobs (free tier: 3 per billing account)
bq ls --project_id=fitness-tracker-gb-1775407101 billing                                        # billing export table appears here once enabled
node scripts/usage-report.mjs --days 30 --json | node -e "process.stdin.on('data',d=>console.log(JSON.parse(d).totals))"
```

The list prices live in `functions/src/cost-model.ts` (`PRICES`). Re-read them off
the Cloud Billing Catalog API (`GET https://cloudbilling.googleapis.com/v1/services/<id>/skus`)
when `PRICES.asOf` is older than a quarter; the page prints the date.

## Product measurement

```sh
node scripts/usage-report.mjs --days 30      # `platforms.web` reads 0 from 2026-08-30 on — the web writes no usageEvents (ADR-0036)
node scratchpad/tester-engagement.mjs        # Firebase Auth × per-user Firestore count()
```

**Do not read `lastSignInTime` as retention.** Firebase only updates it on an
actual sign-in event and sessions persist, so "last sign-in = created" is an
artefact, not a churned user. Row counts are the honest signal.

## Cost / config drift

```sh
npm run doctor                                # fails on drift; audited secret-version floor is 7
gcloud run services list --format="value(metadata.name, spec.template.metadata.annotations)" | grep -i <SECRET>
```

Scan for secret bindings in **one** call, never a per-service loop — a loop-based
scan that silently fails every read reports "nothing binds it", and deleting on
that evidence once would have stopped `searchFoods` booting.

**Order matters when removing a bound secret**: gen2 resolves bindings at
instance start, so unbind → redeploy → verify → *then* `gcloud secrets delete`.

## Git — is this commit in the live binary?

```sh
git merge-base --is-ancestor <sha> <live-build-sha>   # exit 0 = it IS in the live binary
```
