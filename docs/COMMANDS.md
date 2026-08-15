# Commands that answer questions faster than reading

Every claim in `STATUS.md` is meant to be re-derivable. This file holds the
commands that do it, so `STATUS.md` can cite one instead of carrying it.

**Read a number from the authority, never from a doc.** ASC for iOS state, the
`androidpublisher` API for Play, the artifact itself for fingerprints. A number
written down here or in `STATUS.md` is a cache, and caches go stale.

## Everyday

```sh
npm start                  # web dev (emulators: npm run dev)
npm test                   # web unit tests
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
`npm run test:rules` and `npm run test:ledger` both go through it, so **no PATH
export is needed**. It prints which JDK it picked.

Nothing in its candidate list is trusted: each path is a place to *look*, and a
JDK is used only after `<candidate>/bin/java -version` reports 21+. That is what
makes it safe on a machine that is not this one. macOS asks
`/usr/libexec/java_home -v 21+` first.

As a preflight it never could have worked — a child process cannot change its
parent's PATH, so printing advice was the only thing it was capable of. It
printed the correct fix for four days while the suites kept not running.

```sh
npm run test:rules         # ALL functions specs incl. firestore.rules
npm run test:ledger        # FirestoreLedgerCore against the emulator
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
```

**Trust ASC, not the CLI exit.** `eas submit` has printed *"Something went wrong
when submitting"* for an upload that had in fact succeeded; the re-run then
failed as a duplicate.

## Android state — ask Play

Track state comes from the `androidpublisher` edits→tracks API with
`apps/mobile/credentials/play-service-account.json` (see `CLAUDE.local.md`).
Read the versionCode from **Play**, never from the build log — the log describes
the remote counter advancing for the *next* build.

```sh
node scripts/app-version-sync.mjs --check     # public/app-version.json vs what Play ships
```

**Which cert signs a given release** — never read this off the App signing page,
which shows the key that will sign the *next* release:

```sh
# GET androidpublisher/v3/applications/fit.ignia.app/generatedApks/<versionCode>
# → generatedApks[].certificateSha256Hash
npx firebase apps:android:sha:list 1:647810616435:android:a6f4c5f9e200b3332c2e06 \
  --project fitness-tracker-gb-1775407101      # expect 5 hashes
```

Fewer than 5 means someone rotated a key or the list was never re-read. Google
Sign-In authorizes by *package name + signing-certificate SHA-1*, and the failure
is structurally invisible on a locally-built install. Full key table and the two
bugs it caused: `CLAUDE.local.md`.

## OTA — the fingerprint gate

An update published against a changed fingerprint **succeeds and reaches
nobody**, which is indistinguishable from a working update. Gate first, and
generate the fingerprint on the Mac — it is machine-dependent, and every binary
is built there.

```sh
ssh ignia-mac "cd ~/fitness-tracker-pwa/apps/mobile && npx expo-updates fingerprint:generate --platform ios"
cd apps/mobile && npx eas update:list --branch production --limit 3
```

Ground truth is the fingerprint file **inside the artifact**
(`base/assets/fingerprint` in an `.aab`, `Payload/*.app/EXUpdates.bundle/fingerprint`
in an `.ipa`), never a locally generated hash. The current table lives in
`apps/mobile/AGENTS.md`.

## Web build + deploy

**The last step of `npm run build` is load-bearing — do not reorder or drop it.**
`scripts/sentry-release.mjs` mutates `dist` *after* `ng build` has hashed it:
`sentry-cli sourcemaps inject` rewrites every minified `.js` to embed a debug ID,
and the map-strip deletes files. `ngsw.json` pins a SHA1 per file, so it is
regenerated as the final step; shipping the stale one gives every returning user
a service worker whose hashes do not match what the server serves.

```sh
# verify ngsw.json against the dist it describes
node -e "const{createHash}=require('crypto'),{readFileSync,existsSync}=require('fs'),{join}=require('path');const D='dist/fitness-tracker-pwa/browser',t=JSON.parse(readFileSync(join(D,'ngsw.json'),'utf8')).hashTable;let b=0;for(const[u,h]of Object.entries(t)){const f=join(D,u.slice(1));if(!existsSync(f)||createHash('sha1').update(readFileSync(f)).digest('hex')!==h){console.log('BAD',u);b++}}console.log(b?b+' BAD':Object.keys(t).length+' ok')"

curl -s https://ignia.fit/index.html | grep -o '__MACROLOG_RELEASE__[^;]*'   # which commit is live
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

## Product measurement

```sh
node scripts/usage-report.mjs --days 30      # `platforms` decides the web-retirement question (ADR-0022)
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
