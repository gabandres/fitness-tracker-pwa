# Dev environment & Ignia production runbook

Two things live here: (1) the **local dev environment** (Firebase Emulator
Suite — how to stop testing against prod), and (2) the **owner runbook** for the
`ignia.fit` cutover + production hardening (console/DNS/CLI steps the code can't
do). Decisions behind this: grilled 2026-07-05, see `project_ignia_prod_cutover`
memory + ADR-0015.

---

## 0. The emulator needs JDK 21 — and this machine defaults to 17

`firebase-tools` refuses to start any emulator on a JDK older than 21:

```
Error: firebase-tools no longer supports Java version before 21.
```

**Both JDKs are already installed** — `C:\Program Files\Microsoft\jdk-17.0.20.8-hotspot`
and `jdk-21.0.11.10-hotspot`. `java` on `PATH` resolves to **17**, so every
emulator-backed suite (`npm run test:rules`, `npm run test:ledger`, `npm run dev`,
`npm run seed`) fails until 21 is put in front of it, per shell:

```sh
export JAVA_HOME="/c/Program Files/Microsoft/jdk-21.0.11.10-hotspot"
export PATH="$JAVA_HOME/bin:$PATH"
```

**`scripts/require-java21.mjs` now runs ahead of `test:rules` and `test:ledger`
and prints exactly that**, because this section was still missed on 2026-08-09
and the miss produced a written claim that the rules suite "cannot run on this
machine" plus a wrong test count. It only warns — it never picks a JDK or edits
`PATH`, since a hardcoded install path in committed config works on one machine
and lies on every other. **On `ignia-mac` the JDK to use is Homebrew
`openjdk@26`** (`/opt/homebrew/opt/openjdk@26/libexec/openjdk.jdk/Contents/Home`);
its default `java` is 11, and `firebase` is not on that machine's PATH, so
invoke the emulator through `npx --yes firebase-tools`.

Note the **msys path form** (`/c/…`, not `C:/…`) — a Windows-style path in
`PATH` is silently ignored by Git Bash and `java -version` keeps reporting 17,
which reads exactly like the export failing to apply.

**Do not "fix" this by setting `JAVA_HOME` globally.** The Android release build
(`gradlew assembleRelease` — the command lives in **`STATUS.md` §7**, not in this
file, which has no §7) runs against the 17 toolchain; flipping the
machine default to 21 to save two lines here trades a documented per-shell
export for an undocumented break in the Android path. Set it in the shell that
runs the emulator, and nowhere else.

---

## 1. Local dev = Firebase Emulator Suite

**Why:** previously `ng serve` (dev) wrote to **prod Firestore** — every local
test polluted real user data. Dev now targets the local Emulator Suite
(Firestore + Auth + Storage), fully isolated, `$0`. Cloud staging is deferred
until there's a concrete need for a shareable URL.

### First-time bootstrap (once)
```sh
npm run seed        # boots emulators, seeds a test user + sample logs,
                    # writes ./​.emulator-data (gitignored)
```

### Daily dev
```sh
npm run dev         # boots auth+firestore+storage emulators (imports the
                    # seeded ./.emulator-data), then `ng serve`. State is
                    # re-exported on Ctrl+C, so your data persists.
```
- App: <http://localhost:4200>  ·  Emulator UI: <http://localhost:4000>
- Sign in with the seeded account: **e2e@test.com / UserTest123**.
- Working on a Cloud Function? Use `npm run dev:functions` (adds the Functions
  emulator — heavier, rebuilds functions each boot). Functions are opt-in on
  purpose; most UI work never needs them.
- `npm run emulators` runs just the emulators (no `ng serve`) — use it when
  driving the **mobile** app or Playwright against the emulators.
- `npm run seed:emulators` re-seeds while emulators are already running.

**How the switch works:** `environment.development.ts` sets `useEmulators: true`;
`app.config.ts` calls `connect{Firestore,Auth,Storage,Functions}Emulator` when
that flag is set. Prod (`environment.ts`) has `useEmulators: false`, so
`npm run build` / deploys always hit the real project. Ports: Firestore 8080,
Auth 9099, Storage 9199, Functions 5001, UI 4000 (see `firebase.json`).

### Mobile against emulators (opt-in)
Expo Go on a **physical device** can't reach the dev machine's `localhost`, so
mobile emulator use is opt-in and needs your machine's LAN IP:
```sh
# terminal 1
npm run emulators
# terminal 2 (LAN IP of THIS machine, e.g. 192.168.1.20)
EXPO_PUBLIC_USE_EMULATORS=1 EXPO_PUBLIC_EMULATOR_HOST=192.168.1.20 npx expo start
```
On the web target or a simulator on the same machine, `localhost` works and you
can omit `EXPO_PUBLIC_EMULATOR_HOST`. Without `EXPO_PUBLIC_USE_EMULATORS=1`,
mobile talks to the real project as before.

> ⚠️ The emulators must be running before you `npm run dev` — the app is wired
> to the emulator ports in dev, so if they're down, Firebase calls fail. Run
> `npm run seed` first if `./.emulator-data` doesn't exist yet.

---

## 2. Owner runbook — `ignia.fit` cutover + prod hardening

Code side is done (rename, flame brand, URL migration to `ignia.fit`, emulator
dev env). Most infra was then done via CLI as the owner (`gcloud`/`gsutil`,
2026-07-05):

| Item | Status |
|------|--------|
| Project display name → **Ignia** | ✅ (already renamed) |
| Storage CORS += `https://ignia.fit` | ✅ `gsutil cors set` |
| Gemini client key referrers += `ignia.fit`/`www` | ✅ (kept existing) |
| Firestore **PITR** (7-day) | ✅ enabled |
| **Billing budget** $50/mo + 50/90/100% alerts | ✅ (adjust amount to taste) |
| Auth **email-enumeration protection** | ✅ enabled |
| **Custom domain `ignia.fit` connect + DNS** | ⬜ **owner** — no CLI/Cloudflare token (steps below) |
| Final `firebase deploy` of ignia.fit canonicals | ⬜ after domain resolves |
| **App Check** | ⬜ deferred (own pass) |

Remaining steps that genuinely can't be scripted here:

### A. Point `ignia.fit` at the app (no migration — same prod project)
1. **Firebase Console → Hosting → site `macrolog` → Add custom domain** →
   `ignia.fit` (and `www.ignia.fit`; set `www` to redirect to the apex).
2. At the **ignia.fit registrar**, add the records Firebase shows (a TXT to
   verify ownership, then the A/AAAA records or CNAME it provides).
3. Wait for Firebase to verify + provision the SSL cert (minutes–24h).
4. Keep `macrolog.web.app` serving — **no root 301 yet** (avoids breaking
   installed PWAs + existing links). Promote to a 301 later once traffic there
   is negligible. `macronautapp.web.app` already 302s to `ignia.fit`.
5. **Rename the project display name** → "Ignia" (Project settings → general).
   The project *ID* stays `fitness-tracker-gb-1775407101` forever — it's
   permanent and invisible to users behind the custom domain.

### B. Config that must follow the domain move
- **Gemini client key** — GCP Console → APIs & Services → Credentials → the
  browser key → HTTP referrers → add `https://ignia.fit/*` (keep
  `macrolog.web.app/*` during the overlap). Otherwise the AI coach/consultation
  call breaks on the new domain.
- **Storage CORS** — `gsutil cors set storage-cors.json gs://<storage-bucket>`
  (`storage-cors.json` already lists `ignia.fit` + `macrolog.web.app`). Lets
  progress photos load on the new domain.
- **Then tell the assistant** → it runs `npm run build && firebase deploy` to
  ship the `ignia.fit` canonicals + redeploy functions with the new links.

### C. Production hardening (cheap, high-leverage — do now)
- **Billing budget + alert** — Cloud Billing → Budgets & alerts → set a monthly
  cap + 50/90/100% email alerts. Your worst case is a runaway Gemini/functions
  bill; it's currently **uncapped**.
- **BigQuery billing export — ALREADY ON, and it does not live in this
  project.** Detailed usage cost has been exporting since ~2026-04 into
  **`citafy-6129184.billing_export`**, a *different* GCP project on the same
  billing account (`010F4E-5E97BC-6B83D0`, "Firebase Payment"). `bq ls` inside
  `fitness-tracker-gb-1775407101` shows nothing and reads as "no export
  configured" — it is not. Query the billing account's data there:

  ```sh
  bq query --project_id=citafy-6129184 --use_legacy_sql=false \
  'SELECT service.description AS service,
          ROUND(SUM(cost),2) AS gross_usd,
          ROUND(SUM(cost) + SUM(IFNULL((SELECT SUM(c.amount) FROM UNNEST(credits) c),0)),2) AS net_usd
   FROM `citafy-6129184.billing_export.gcp_billing_export_resource_v1_010F4E_5E97BC_6B83D0`
   WHERE usage_start_time >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 30 DAY)
   GROUP BY service ORDER BY net_usd DESC'
  ```

  **Read `net_usd`, not `cost`** — Cloud Run Functions bills $3.04 gross and
  $0.00 net, because the free tier arrives as a credit rather than as an
  absent charge. Ignoring credits triples the apparent bill.
- **Secret Manager version storage is the whole bill, not Gemini.** Lifetime
  net spend to 2026-08-04 is **~$7.85**, of which Secret Manager is **$5.91**
  and the **Gemini API is $0.08**. The SKU is *secret version replica
  storage*, billed per active version per unit time — so cost scales with
  versions you forgot to destroy, not with traffic. It peaked at ~46 billable
  version-months in June ($2.75) and fell to ~10 in July once versions were
  cleaned up. **That is what the May/June invoices were** ($3.44 + $3.66).
  Currently 9 active versions, 6 free → ~$0.18/mo. The standing rule in
  `CLAUDE.md` (destroy superseded versions after rotating) is not hygiene
  advice, it is the single biggest line on this account.
- **Cost data is delayed** — the console has carried a banner since
  2026-08-01 about GCP-wide cost-data delays affecting both the Billing
  console and BigQuery exports. A near-zero current month may be lag, not
  savings.
- **Firestore PITR** — Firestore → enable Point-in-Time Recovery (7-day). One
  toggle, cheap insurance on top of the existing weekly backup CF.
- **Auth** — enable email-enumeration protection; confirm the password policy.

### D. Deferred (own focused pass)
- **App Check** — not wired anywhere yet; biggest remaining gap (bots can hit
  the public config + burn Gemini quota). Needs web reCAPTCHA Enterprise keys +
  a monitor-then-enforce rollout, and mobile providers that only work in a
  dev/store build. Schedule as its own effort, web first.
- **Cloud staging project** — add only when you need a shareable hosted dev URL.

---

## 3. macOS runbook — iOS builds without spending EAS quota

**Why this exists.** EAS Build is a *hosted* service and the plan allowance meters
**their** workers (`account:usage` counts by `platform` × `resourceClass`). A build
that runs on your own machine uses no worker. On Windows there is no local iOS
path at all — `npx expo prebuild -p ios` refuses outright (SDK 54 prints
*"Run npx expo prebuild again from macOS or Linux"* and exits non-zero) — which is
why every iOS build so far cost a slot and a queue, and why the widget's missing
`ExtensionStorage` pod could only be found by shipping a binary and reading a
runtime probe. A Mac removes that whole class of blindness.

Target machine: the MacBook Air M1. **iOS only, as of 2026-08-17.**

> **CORRECTION (2026-08-18).** This section used to say the Mac was the *only*
> machine that could build Android, because Windows hits the `MAX_PATH` wall on
> RN's New Architecture C++. That is stale: Android's build host moved to
> **Windows** on 2026-08-17 and vc 32, 33 and 34 were all built there. MAX_PATH
> is cleared by keeping the SDK on a **short path** — `Z:\packagesndroid-sdk`,
> not the `%LOCALAPPDATA%\Android\Sdk` default.
>
> Two traps follow from that, and together they cost three failed starts on
> 2026-08-18. The workstation's exported `ANDROID_HOME` still points at the
> **non-existent** default; and `npx expo prebuild -p android --clean` deletes
> `android/local.properties`, which is machine-local and never committed. With
> both true, Gradle stops at `SDK location not found`, which reads exactly like
> a missing SDK install. Recreate it:
>
> ```sh
> printf 'sdk.dir=Z:/packages/android-sdk
' > apps/mobile/android/local.properties
> ```
>
> Forward slashes deliberately — a Java properties file eats `\p` and `` as
> invalid escapes, so the Windows-style path has to be double-escaped or avoided.

**iOS QA builds on this machine: pass `DEBUG_INFORMATION_FORMAT=dwarf`.** The
Air's data volume sat at 194 GB of 228 GB used on 2026-08-18 (most of it the
owner's own files, not ours), and *three* separate iOS builds died on
`lipo: can't write to output file … (No space left on device)` — generating the
dSYM, the very last step, after all the C++. Debug symbols are worthless for a
simulator run and cost several GB at the worst possible moment.

Two more measured that day, both of which look like app bugs:

- **A Release build ignores `expo-dev-client`.** Loading fresh JS into an
  already-installed Release build over Metro does not work — it keeps its
  embedded bundle — so a JS change there needs a rebuild, not a reconnect.
- **A Debug build returns to the dev LAUNCHER on `launchApp`**, not to the app,
  which breaks every Maestro flow that starts with one. Drive a dev-client
  build where it stands (no `launchApp`), after opening
  `exp+macro-log://expo-development-client/?url=http%3A%2F%2Flocalhost%3A8081`
  — **`localhost`, not the LAN IP**: the simulator shares the host's network
  stack and the LAN address fails with "Failed to load app from …".

### 3.1 Prerequisites

```sh
xcode-select --install                 # Command Line Tools
# Xcode itself from the App Store, then launch it once to accept the licence
sudo xcodebuild -runFirstLaunch
sudo gem install cocoapods             # or: brew install cocoapods
```

Node: this repo has no `engines` pin and no `.nvmrc`; Windows runs **v24**. Match
the major version rather than guessing — a different major silently changes how
npm resolves the workspaces.

### 3.2 Clone and install

```sh
git clone https://github.com/gabandres/fitness-tracker-pwa.git
cd fitness-tracker-pwa
npm ci                                 # root = the Angular PWA + npm workspaces
```

`functions/` is **not** a workspace and installs independently (`npm --prefix functions ci`).
You do not need it for an iOS build.

### 3.3 The files git does not carry — this is the actual work

Cloning gets you none of these. Copy them across (AirDrop or a USB key; do **not**
email the `.p8` or the keystore):

| File | Needed for | Notes |
|---|---|---|
| `.env.local` (repo root) | every ASC script, `npm run doctor` | holds `ASC_ISSUER_ID` and `SENTRY_AUTH_TOKEN` |
| `AuthKey_47Z9RY8MT5.p8` | ASC reads/writes, `eas build` credential validation | put it anywhere stable, e.g. `~/keys/` |
| `CLAUDE.local.md` (repo root) | knowing where everything lives | git-ignored by design; it is the index to the rest |
| `apps/mobile/credentials.json` + `credentials/` | **Android only** | skip on an iOS-only Mac |

**The trap: `scripts/asc-client.mjs` defaults `ASC_KEY_PATH` to a Windows path**
(`C:/Users/gabri/Downloads/AuthKey_…p8`). On macOS it is not overridden by anything,
so every ASC script fails until you add the path to `.env.local`:

```
ASC_ISSUER_ID=<the uuid — see CLAUDE.local.md>
ASC_KEY_PATH=/Users/<you>/keys/AuthKey_47Z9RY8MT5.p8
SENTRY_AUTH_TOKEN=<the sntryu_… token>
```

Verify before building anything:

```sh
npm run doctor          # groups 2 and 3 exercise ASC + the Sentry token
```

### 3.4 Build iOS locally

`ios/` is **git-ignored** — the project is CNG, so the Xcode project is generated,
never committed. Regenerate it whenever native config changes:

```sh
cd apps/mobile
npx expo prebuild -p ios          # generates ios/ + runs pod install
```

That produces **four** targets — the app, the widget, the watch app and the watch
complication (`targets/{widget,watch,watch-widget}` via `@bacons/apple-targets`,
plus `plugins/withModularHeaders.js`). All four must appear in the scheme; if one
is missing, autolinking or a target config is wrong, and **that is now checkable
locally instead of by shipping**.

Two ways to build, and they differ in how signing is handled:

```sh
# A. EAS pipeline, on your machine. Reuses EAS-managed credentials, so signing
#    Just Works. Same eas.json profile and same artifact as a cloud build.
npx eas build -p ios --profile production --local

# B. Raw Xcode. Fastest iteration, but you manage signing yourself.
open ios/Ignia.xcworkspace     # scheme name = app.json expo.name ("Ignia"), then Product > Archive
```

Prefer **A** for anything destined for TestFlight, **B** for iterating.

**Submitting is unaffected and never costs build quota:**

```sh
npx eas submit -p ios --path <the .ipa>
```

### 3.5 The watchOS simulator — what the Mac unlocks beyond quota

Issue **#46** (the 40mm/46mm complication layouts, in both locales) has been open
purely because no simulator existed on Windows. Xcode ships one. This is the
cheapest open item on the board once the Mac is set up.

### 3.6 Unmeasured: does `--local` consume plan quota?

Raw Xcode obviously does not — it never contacts EAS. For `eas build --local` the
inference is strong (the counter meters worker runs by resource class) but it is
**not confirmed from Expo's primary docs**. Settle it empirically the first time
you run one, the same way the errored-build behaviour was settled on 2026-08-06:

```sh
cd apps/mobile && npx eas-cli account:usage gabandres --non-interactive   # before
# ...run the local build...
cd apps/mobile && npx eas-cli account:usage gabandres --non-interactive   # after
```

Then record the answer here and delete this subsection.

### 3.7 Do not "fix" these

- **`apps/mobile/index.js` is the entry point, not `expo-router/entry`.** It
  registers the Android widget task handler at module scope. See `apps/mobile/AGENTS.md`.
- **Nothing but routes in `apps/mobile/src/app/`** — a stray `*.test.tsx` there gets
  bundled and breaks the build. Same file.
- **`ios/` and `android/` are generated.** Never commit them; never hand-edit them
  expecting the change to survive the next `prebuild`.

### 3.8 Driving the Mac from the Windows box over SSH

Carrying the laptop over for every build is the actual cost, not the build. Xcode's
whole toolchain is CLI (`xcodebuild`, `pod`, `eas build --local`), so the Mac can be
driven headless and never has to be in the room.

**A shared drive is the wrong tool and will waste your time.** A share gives file
access, not execution — you cannot run Xcode across one — and sharing `node_modules`
or `ios/` between the two machines breaks on platform-specific binaries, symlinks and
xattrs. Git is already the sync mechanism: push here, `git pull` there.

**The key is already generated on the Windows box** (2026-08-06), dedicated to this
one purpose so it can be revoked without touching anything else:

- private: `~/.ssh/id_ed25519_ignia_mac` — **no passphrase**, so builds can run
  unattended. The tradeoff is real: anyone who gets that file can log into the Mac as
  you. It is a LAN key to your own laptop, which is why it is acceptable here; do not
  reuse it for anything that matters more.
- public: `~/.ssh/id_ed25519_ignia_mac.pub`

```
ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIMvWPFwbcvYTHl3rPeVI46d7pcqk7GkssktbQyzhMnBa ignia-build@windows
```

**On the Mac, once:**

```sh
# System Settings > General > Sharing > Remote Login: ON
mkdir -p ~/.ssh && chmod 700 ~/.ssh
echo 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIMvWPFwbcvYTHl3rPeVI46d7pcqk7GkssktbQyzhMnBa ignia-build@windows' >> ~/.ssh/authorized_keys
chmod 600 ~/.ssh/authorized_keys
scutil --get LocalHostName        # the <name> in <name>.local
```

**On Windows, define the host once** in `~/.ssh/config` so the address lives in
exactly one place (done 2026-08-06):

```
Host ignia-mac
    HostName Stephanies-MacBook-Air.local
    User stephaniecastillozambrana
    IdentityFile ~/.ssh/id_ed25519_ignia_mac
    IdentitiesOnly yes
    ServerAliveInterval 30
    ServerAliveCountMax 6
    TCPKeepAlive yes
```

The keepalives are not decoration: docking the Air switches it between Wi-Fi and
Ethernet and the session drops without them. Then everything is short:

```sh
ssh ignia-mac "sw_vers && xcodebuild -version"

ssh ignia-mac "cd ~/fitness-tracker-pwa && git pull && cd apps/mobile &&   caffeinate -dims npx eas build -p ios --profile production --local"
```

**Three failure modes, in the order they will actually happen:**

1. **`User interaction is not allowed` from `codesign`.** The classic. An SSH session
   has no GUI, and the login keychain is locked, so signing cannot reach the private
   key. Unlock it first in the same shell:
   ```sh
   security unlock-keychain -p '<login password>' ~/Library/Keychains/login.keychain-db
   ```
   `eas build --local` is less exposed to this than raw `xcodebuild`, because it
   provisions credentials into a temporary keychain of its own — another reason to
   prefer it for anything headed to TestFlight.
2. **The Air sleeps and drops off the network mid-build.** `caffeinate -dims` (above)
   holds it awake for the command's lifetime; also set it not to sleep on power.
3. **`<name>.local` only resolves on the same LAN** — it is mDNS. If the Mac lives in
   another room on another network, or you are away, install **Tailscale** (free) on
   both machines and use the Tailscale name instead. Nothing else changes.

**When this becomes routine, stop using SSH.** Put a **self-hosted GitHub Actions
runner** on the Mac and let a push or a manual dispatch trigger the iOS build with
nobody present. It also sidesteps failure mode 1 outright, because the runner executes
as a logged-in GUI user with an unlocked keychain. More setup; correct destination.

### 3.9 Making it permanent — measured state, 2026-08-06

**What is installed and verified on the Air** (`ignia-mac`): Xcode **26.6** —
which is what makes SDK 55+ possible at all, since 55 raised the Xcode floor to
26 — Node **22.23.2** (deliberately not the 26.7 Homebrew default), npm 10.9.8,
and this is **left alone on purpose**: it is someone else's laptop, RN 0.86
accepts `^22.13.0`, and only the Windows workstation may rewrite
`package-lock.json` (the Air runs `npm ci` and nothing else — see
`docs/build-infrastructure.md`). CocoaPods
**1.17.0** on its own Homebrew Ruby 4.0.6 — the system Ruby is 2.6.10 with a broken
`ffi`, so never use it. `LANG`/`LC_ALL` are set in `~/.zprofile` because CocoaPods
warns and can fail without UTF-8.

**Proven 2026-08-06:** `npx expo prebuild -p ios` generates all **four** targets —
`Ignia`, `Today` (widget), `IgniaWatch`, `IgniaWatchComplication` — and `pod install`
completes. Only three schemes exist; `Today` is an extension target built as a
dependency of `Ignia`, which is normal and not a fault.

**Addressing is SOLVED — via Tailscale, 2026-08-06.** `~/.ssh/config` on Windows
points `ignia-mac` at the **Tailscale MagicDNS name** `stephanies-macbook-air-3`.
Use the name, never an address: `.local` is LAN-only and failed transiently twice
during setup, the docked Air holds two LAN addresses at once and the Wi-Fi one timed
out mid-session during a handover, and **the Tailscale IP itself changed** (`100.122…`
→ `100.64…`) when the Mac re-registered. The MagicDNS name survived all three.

Both machines must be on the **same tailnet**. The first attempt was not: the Mac
signed in as an auto-generated `ghc9gdwv4g@` while Windows was `gabandres@`, so
neither could see the other — a clean install that simply cannot reach the peer, which
reads like a firewall problem and is not. Check with `tailscale status` on both; every
row must show the same account.

Installing Tailscale needs `sudo` on macOS (it is a `.pkg`) and admin on Windows, so
neither half can be done over SSH:

```sh
# on the Mac, once — asks for the login password
brew install --cask tailscale-app     # then open Tailscale.app and sign in
# on Windows: tailscale.com/download/windows, sign in with the SAME account
```

**`~/.zshenv` on the Mac is load-bearing.** Non-interactive SSH does **not** source
`~/.zprofile`, so `ssh ignia-mac "node -v"` returns *command not found* even with Node
installed. `.zshenv` is sourced for every zsh invocation; it carries the Homebrew PATH
and the UTF-8 locale CocoaPods needs. Without it every remote command needs a manual
`export PATH=/opt/homebrew/bin:$PATH`.

The toolchain answers:

```sh
$ ssh ignia-mac "node -v; npm -v; pod --version; xcodebuild -version | head -1"
v22.23.2
10.9.8
1.17.0
Xcode 26.6
```

**That check proves prebuilding, NOT archiving — do not read it as end-to-end.**
It was labelled "verified working end to end" until 2026-08-07, when the first real
`eas build --local` failed three times in a row on prerequisites none of the four
commands above can see. Prebuild and `pod install` exercise Node, npm and CocoaPods;
an **archive** additionally needs fastlane and two Xcode platform components, and each
one only surfaces after the previous is fixed. See §3.10.

**It is Stephanie's machine and her account.** Everything above lives under her home
directory. A shippable build needs the **Sentry token** there (`~/fitness-tracker-pwa/
.env.local`, mode `600` — validate with a Sentry API call, not by eyeballing the file)
and an **EAS session** (`~/.expo/state.json`). It does **not** need the ASC `.p8` —
see §3.10. That is a deliberate decision to make, not a default to drift into; a
separate macOS user for builds would isolate it, at the cost of redoing Homebrew and
Xcode paths.

**Do not poll a remote build by testing whether a process is gone.** An SSH failure
and a finished process look identical to `if ! ssh … pgrep`, so a network blip reports
success. Have the remote command print an explicit sentinel and treat anything else,
including no output, as "still unknown".

### 3.10 Archiving on the Air — first green build, 2026-08-07

**First successful `eas build --local` for iOS: 15m57s, `build-<ts>.ipa` at 29 MB,
version 1.1.0 build 23.** All four targets nested correctly, which is the thing to
verify rather than trusting the exit code:

```
Ignia.app
├── PlugIns/Today.appex                           ← iOS widget
└── Watch/IgniaWatch.app
    └── PlugIns/IgniaWatchComplication.appex      ← complication
```

Signed to team `AE6TTXW92K` with profile `*[expo] fit.ignia.app AppStore`,
`MinimumOSVersion` 16.4.

**Three prerequisites that §3.9's toolchain check cannot see.** Each surfaced only
after the previous was fixed, so expect to fix them in this order:

1. **fastlane is not installed by anything else.** `eas build --local` drives the
   archive through fastlane gym; without it the build dies in ~35 s with
   `Fastlane is not available` / `spawn fastlane ENOENT`. Install via Homebrew, not
   the gem — the system Ruby 2.6.10 has the broken `ffi` from §3.9:
   ```sh
   brew install fastlane        # 2.237.0 → /opt/homebrew/bin/fastlane
   ```
2. **The iOS platform component**, ~8.5 GB:
   ```sh
   sudo xcodebuild -downloadPlatform iOS
   ```
   **`xcodebuild -showsdks` listing `iOS 26.5` does NOT mean the platform is
   installed.** Xcode 26 tracks platforms as separately-downloaded components, and
   the SDK directory is not what it checks — so the SDK is present, `iPhoneOS.platform`
   is on disk, prebuild and `pod install` and compilation all succeed, and the archive
   then fails at destination resolution:
   ```
   xcodebuild: error: Unable to find a destination matching the provided destination specifier:
     { platform:iOS, name:Any iOS Device,
       error:iOS 26.5 is not installed. Please download and install the platform
             from Xcode > Settings > Components. }
   ```
   **The cheap tell is `xcrun simctl list runtimes` returning nothing** — an empty
   runtime list means the platform component is missing, and it is *not* "irrelevant
   because we only build for device". `sudo xcodebuild -runFirstLaunch` does **not**
   fix this; it is a silent no-op here. Confirm the fix with
   `xcodebuild -showdestinations -scheme Ignia`: the `Any iOS Device` line must come
   back with **no `error:` clause attached**.
3. **The watchOS platform component**, ~3 GB:
   ```sh
   sudo xcodebuild -downloadPlatform watchOS
   ```
   Required because the `Ignia` scheme **embeds the watch app**, so this is not
   optional even when you only care about the phone:
   ```
   This scheme builds an embedded Apple Watch app.
   watchOS 26.5 must be installed in order to archive the scheme
   ```

**Budget ~18 GB of disk for the two downloads plus an archive.** Measured: 45 GB free
→ 27 GB after both platforms and one successful build.

#### When the Air runs out of disk — where it actually goes (2026-08-10)

The Air reached **4.0 GB free**, which blocks both platforms (Android's §3.11 wants
20 GB, iOS wants ~17). It cost `vc 28`, which died mid-CMake on
`No space left on device`. Measure before deleting anything; three of the four
obvious answers are wrong here.

**`df -h /` is not the number you want.** `/` is the sealed System snapshot
(`disk3s1s1`) and reports ~12 GB used against a 228 GB size, which reads like the
disk is nearly empty. The real volume is the Data one, and both draw on the same
APFS container:

```sh
df -h /System/Volumes/Data          # the number that matters
diskutil apfs list | grep -A2 'Capacity'
```

**The most-recommended fix on the internet does not apply.** Purgeable space held
by Time Machine local snapshots is the usual culprit, and there are none here —
`tmutil listlocalsnapshots /` and `… /System/Volumes/Data` both return empty, so
`tmutil thinlocalsnapshots` has nothing to thin. The space is genuinely used.

**Where it actually is** — `/Library/Developer/CoreSimulator` was **30 GB** against
11.6 GB of live runtime images. `Volumes/` are **mounted read-only APFS volumes**
(`mount | grep -i coresim`), so `rm -rf` on them frees nothing; the supported
removal is `xcrun simctl runtime delete <id>`.

What was reclaimed, 4.0 GB → **20 GB**, none of it personal data:

| Freed | What | Reversible by |
|---|---|---|
| 5.6 GB | `/Library/Developer/CoreSimulator/Caches/dyld` | regenerates |
| ~5 GB | all simulator **devices** (`simctl delete all`) | `simctl create`, or Xcode on next launch |
| 1.0 GB | `~/Library/Developer/Xcode/Archives/*` | the `.ipa`/`.aab` are the artifacts, not these |
| ~0.9 GB | CocoaPods / node-gyp / Homebrew / npm caches | re-download |

**DO NOT delete the watchOS simulator runtime. It is REQUIRED to archive.**
`simctl runtime delete` on watchOS frees ~8 GB and then the next iOS build dies
at *Run fastlane* with the exact error §3.10 already documents:

```
xcodebuild: error: Failed to build workspace Ignia with scheme Ignia.:
  This scheme builds an embedded Apple Watch app.
  watchOS 26.5 must be installed in order to archive the scheme
```

The scheme embeds `IgniaWatch.app`, so archiving needs the **watchOS platform**,
and the runtime image is part of it. Recover with
`sudo xcodebuild -downloadPlatform watchOS` (~4 GB download, ~8 GB installed).

**Two checks that look authoritative here and are NOT.** This was deleted on
2026-08-10 on the strength of both, and it cost build 43:

- `xcodebuild -showsdks` still lists **both** watchOS SDKs afterwards. The SDK
  headers live in Xcode.app and survive; the archive needs the platform, which
  does not.
- `xcodebuild -showdestinations -scheme Ignia` still resolves `Any iOS Device`
  with no `not installed` line. It reports the *iOS* destination and says
  nothing about the embedded watch target.

**The check that IS authoritative is the one §3.10 already gave**, one platform
over: `xcrun simctl list runtimes` must list **watchOS as well as iOS**. Two
runtimes, not one. If watchOS is missing, the iOS archive will fail no matter
what the SDK list says.

**Do NOT delete `apps/mobile/ios/`** to save its ~480 MB. `ios` is a **fingerprint
source** (it appears in `sources` as a `dir`), so removing it moves the runtime
version and strands every OTA. Verified after this cleanup that both fingerprints
were byte-identical to the shipped artifacts (`1d89fedf…` / `ca2dc124…`).

**What is left and what it costs.** Below the caches, the remaining large items are
`~/Library/Android` (8.2 GB) and `~/.gradle` (5.5 GB) — both needed by §3.11, both
re-downloadable at the price of a much slower next Android build — and then the
machine owner's own data (Pictures 12 GB, Messages 6.4 GB, Movies 5.4 GB). **That
last group is not ours to touch**; if 20 GB stops being enough, the honest options
are to sacrifice the Gradle caches or to ask the owner.

#### It happened again, and the answer is now "this disk is done" — 2026-08-17

Back to **9.5 GB free**, below both thresholds, so neither platform could build.
A second reclaim recovered **9.5 → 23 GB**, all reversible, no personal data:
simulator *devices* (`simctl delete all`), Xcode `Archives` + `DerivedData`, the
`CoreSimulator/Caches/dyld` cache (3 GB, needs `sudo`), the npm / Homebrew /
CocoaPods / ReactNative / node-gyp caches, two stray `build-*.ipa` in
`apps/mobile`, and **6.3 GB of regenerable `ios/` in `~/tracker-app`** — a
*different* project (`gabandres/agenda-app`), gitignored there with zero tracked
files, so `expo prebuild` restores it.

Two measurement traps cost time and are worth not repeating. `du -sh` on
`/Library/Developer/CoreSimulator/Volumes` reported **16 GB against one 7.9 GB
runtime** — it is a read-only APFS mount and `du` overcounts it, so "orphaned
runtimes" was a phantom; trust `simctl runtime list`, not `du`, and note this is
the same class of error as `df /`. And `~/.gradle` was **already gone**, which
means the next Android build re-downloads it — conveniently making it a genuine
cold measurement for `scripts/time-mobile-builds.mjs`.

**The watchOS runtime was missing too**, so iOS could not have archived at any
disk size (§3.10). `sudo xcodebuild -downloadPlatform watchOS` restored it —
verified `watchOS 26.5 (23T570) … (Ready)` in `simctl runtime list` and
`-sdk watchos26.5` in `xcodebuild -showsdks`. It cost ~7 GB, taking the volume
from 23 GB free back to **16 GB**, so budget the platform as part of the disk
requirement and not on top of a number that already looked sufficient.

**Net after everything: 16 GB free.** That clears iOS (~17 GB is the archive
figure, and the watchOS platform is now already installed rather than pending)
but stays under Android's 20 GB. So as of this date the Air is an **iOS-only**
build host in practice.

**The conclusion is structural, not a cleanup to repeat.** After every
dev-owned byte was reclaimed, the remaining ~183 GB is essentially all the machine
owner's: `Pictures` 14 GB, `Application Support/Google` 8.4 GB, `Messages` 6.4 GB,
`mediaanalysisd` 6.2 GB, WhatsApp 5.2 GB, `Movies` 5.4 GB, `/private/var` 16 GB.
A 228 GB disk shared with someone's real life cannot host two mobile toolchains;
the third reclaim will find nothing left that is ours. Move the build host to a
machine with its own storage rather than running this pass again.

**`--local` does NOT hit the ASC 401.** `CLAUDE.local.md` documents
`eas build -p ios --non-interactive` failing credential validation against EAS's own
stored App Store Connect key, needing `EXPO_ASC_KEY_PATH` / `EXPO_ASC_KEY_ID` /
`EXPO_ASC_ISSUER_ID` as a workaround. **That is the cloud build path only.** A local
build printed `All credentials are ready to build` for all four bundle identifiers
with no overrides, so **the ASC `.p8` never has to be copied to the Mac** — one fewer
credential on someone else's laptop. `eas submit -p ios` likewise uses its own working
EAS-held key.

**`autoIncrement: true` burns a build number per ATTEMPT, including failures.** It
runs before the archive, so the three failed runs consumed 20, 21 and 22; the first
green build was 23, while build 19 sat in App Review. Harmless — ASC only requires
build numbers to increase — but the gaps are real and are not a mystery to chase.

**Power, and the failure mode that is not sleep.** The Air is configured to never
sleep on AC (`sudo pmset -c sleep 0 disksleep 0 displaysleep 0`) with battery settings
left at stock, plus a `caffeinate -s` LaunchDaemon at
`/Library/LaunchDaemons/fit.ignia.nosleep.plist` (`RunAtLoad` + `KeepAlive`) as a
backstop that asserts **only on AC**, so it cannot hold the machine awake unplugged.
Do not use `pmset -a disablesleep 1` — it is global and blocks battery sleep too.

The real hazard is upstream of any of that: **the dock can stop delivering power while
still working as a dock.** On 2026-08-06 the SMC logged
`ExternalPowerChange(0x71010100)` at 22:40 and the DisplayLink dock's USB-C PD
contract dropped — video, keyboard and mouse all kept working, so nothing looked
wrong, while the Air ran down from 80% to 62% overnight. Diagnose with
`pmset -g batt` and `pmset -g ac` (`No adapter attached` is unambiguous), and read the
history with `pmset -g log | grep -E 'Using (AC|Batt)'`, which collapses to one line
per real transition. Because a PD drop puts the machine on battery where sleep *is*
allowed, **keep wrapping long builds in `caffeinate -dims`** — the pmset config alone
does not cover a build that starts on AC and continues on battery.


### 3.11 Android is NOT built on the Air any more — 2026-08-17

**Android's build host is the Windows workstation, permanently.** This section
used to be a ~150-line runbook for `eas build --local -p android` on the Air,
resting on the claim that Windows *could not* compile an AAB at all. Both halves
are now void:

- **Windows can.** `./gradlew bundleRelease` on the Snapdragon X Elite produced a
  signed, verifier-green, OTA-capable AAB in **10m12s** — that is vc 31, live on
  the Play alpha track. The `MAX_PATH` / `CMAKE_OBJECT_PATH_MAX` finding that
  drove the old conclusion is a **warning, not a fatal error**; CMake declines to
  *guarantee* object placement, which is an argument for device QA, not against
  building.
- **The Air no longer can.** Its Android toolchain was deleted the same day —
  `~/Library/Android` (3.3 GB), `~/.gradle`, `~/.android` (2.9 GB), both
  `android/` directories, and Homebrew's `openjdk@17` (319 MB, the JDK AGP
  needed) — to get the disk back over the ~17 GB iOS floor. The Air is an
  **iOS-only** host by choice now, so the runbook is not deprecated, it is
  unrunnable. **iOS builds need no Java at all**, which is why removing it costs
  nothing here.

  What deliberately stayed: Homebrew `openjdk` 26 (`bundletool` depends on it)
  and the two system JDKs in `/Library/Java/JavaVirtualMachines` —
  `microsoft-11` is the machine's **default** JDK and `temurin-8` is legacy.
  Both need `sudo` and neither is ours; this is someone else's laptop.

  **`credentials/dev.keystore` and `credentials.json` must survive every
  cleanup** — verified `mode 600` after this one. That keystore is
  `fit.ignia.app`'s only Play identity, it has no recovery path, and the Mac
  copy is the sole off-site backup of the Windows original.

**The current Android procedure lives in the `build-android` skill**, not here:
`./gradlew --stop` → `expo prebuild` → `scripts/patch-android-release.mjs` →
`./gradlew bundleRelease` → `verify-mobile-artifact.mjs` (must exit 0).
`patch-android-release.mjs` is therefore **not obsolete** — the line in this file
that called it "kept only as the record of what a raw-Gradle build has to fake"
was true only while EAS Build did the faking for us. It now supplies the three
things raw Gradle omits, each of which fails **silently**: the EAS Update
channel in `AndroidManifest.xml` (its absence shipped as vc 10 and is why vc 11
exists), release signing (the template points `release` at the *debug* keystore),
and the versionCode (`appVersionSource: "remote"` leaves it at `1`).

Two facts from the deleted runbook are worth keeping, because they are not
macOS-specific:

- **Gradle has no default socket timeout.** A dropped connection to Google's
  Maven once left a build hung for **19 minutes** looking exactly like slow
  compilation. The tell: the log stops advancing, `app/build` gets zero writes,
  the Java processes sit near 0% CPU. Set
  `-Dorg.gradle.internal.http.socketTimeout=60000` and the matching
  `connectionTimeout` in `GRADLE_OPTS`.
- **Heap and metaspace belong in `apps/mobile/plugins/withGradleJvmArgs.js`**,
  not in a hand-typed env var. That plugin exists because a release build died on
  `OutOfMemoryError: Metaspace` in
  `:react-native-health-connect:lintVitalAnalyzeRelease`, and
  `expo-build-properties` exposes no option for Gradle JVM args.

**Do not re-litigate the Windows question from the old text.** For the record, so
nobody re-derives it: `MAX_PATH` is a common React Native bug and would break an
x86 Windows box identically; what ARM64 removes is the standard *workaround*,
because WSL2 here is `aarch64` and Google ships the Android SDK/NDK for
`linux-x86_64` only ([tracker 227219818](https://issuetracker.google.com/issues/227219818),
with "[no current plans](https://github.com/android/ndk/discussions/1692)" for
`linux-arm64`). None of that stops the native Windows build, which is what we
actually use.

See the `build-android` skill for the OTA-vs-build decision that comes first.


---

### 3.12 Maestro on the Air — the two things that stop it dead

Both were hit on 2026-08-22, the first time the suite ran on this machine since
Maestro 2.x, and neither says what it means.

**1. Maestro needs Java 17+ and this Mac defaults to 11.** The message is
`ERROR: Java 17 or higher is required.` and `/usr/libexec/java_home -V` lists
only Microsoft 11 and Temurin 8 — so it reads like "install a JDK". A modern one
is already here, from Homebrew, just not on `PATH`:

```sh
export JAVA_HOME=/opt/homebrew/opt/openjdk        # 26.0.2
export PATH="$JAVA_HOME/bin:$HOME/.maestro/bin:$PATH"
```

Do NOT set it globally — the same trap as §0 in the other direction. Xcode and
Gradle are happy where they are.

**2. `maestro test .maestro/regression/` runs ONE flow and reports success.**
Maestro 2.x does not resolve this repo's workspace `config.yaml` the way 1.x
did: it prints `Requested 1 shards, but it cannot be higher than the number of
flows (0)`, runs `01-today` alone, and exits 0. A suite that silently shrank to
one flow and passed is worse than one that fails.

Until the config is ported, drive the documented order explicitly and key on the
**exit code** — `[Passed]` is printed only in workspace mode, so grepping for it
marks every single-file run as failed:

```sh
for f in 01-today 02-add-sheet … 20-units-metric; do
  maestro test .maestro/regression/$f.yaml && echo "PASS $f" || echo "FAIL $f"
done
```

`config.yaml`'s `flowsOrder` is still the source of truth for the ORDER, and the
order still matters: 11→12→13 share one diary row, and 09/10/20 flip account or
device state they restore in their own tails.

**3. A fresh install opens the guided tour, and the tour covers Today.** The
suite died at its first scroll with `No visible element found: "Water"`, which
reads exactly like a metrics-card regression. `.maestro/android-signin.yaml`
dismisses the tour now, guarded by `runFlow: when:` so a device that has already
seen it is unaffected.

### 3.13 Building the app for the SIMULATOR — do not pass `-sdk`

```sh
xcodebuild -workspace ios/Ignia.xcworkspace -scheme Ignia -configuration Release   -destination 'platform=iOS Simulator,id=<SIM-UDID>' build
```

**`-sdk iphonesimulator` fails the build**, and the error names an asset
catalog rather than the flag:

```
targets/watch/Assets.xcassets: error: The stickers icon set, app icon set, or
icon stack named "AppIcon" did not have any applicable content.
```

The Ignia scheme embeds `IgniaWatch`. `-sdk` forces EVERY target in the scheme
onto that SDK, so the watch app is built against the iOS simulator SDK, and its
`AppIcon` is `platform: watchos` only — correctly. `-destination` lets each
target choose its own SDK and the watch builds for watchsimulator as it should.

Set `SENTRY_DISABLE_AUTO_UPLOAD=true` as well, or the bundle step fails on
`Auth token is required`.

The resulting `.app` is at
`~/Library/Developer/Xcode/DerivedData/Ignia-*/Build/Products/Release-iphonesimulator/Ignia.app`
and is installed with `xcrun simctl install <UDID> <path>`.

**A simulator build carries no `expo-channel-name`**, so it cannot receive an
OTA — `Expo.plist` has `EXUpdatesURL` and no request headers. Verified
2026-08-22. That is why verifying a JS change on the sim means rebuilding, not
publishing.

## 4. Owner runbook — move `bermudezsystems.com` mail into the `bermudezpr.com` Microsoft 365 tenant

> **DONE — verified in public DNS 2026-08-23.** Keep the runbook for the record
> and for the next domain, but the cutover has happened. Measured from
> `dns.google`: MX is `1 bermudezsystems-com.mail.protection.outlook.com`, SPF
> is `v=spf1 include:spf.protection.outlook.com -all`, `autodiscover` CNAMEs to
> `autodiscover.outlook.com`, and the `MS=ms93273856` tenant-verification TXT is
> present. The Northwest MX, the Northwest SPF and the
> forwarding-to-Gmail mechanism are all gone.
>
> Two things survived the cutover and both are deliberate: the site still
> answers on `A 199.36.158.100` (Northwest hosting — §4.1 says to leave it),
> and `google-site-verification=1EYLbXKH66lt3XNRVrp3o066X7NqEeKBhMwWO64P57U` is
> still there, which is what Play's org website verification rides on.
>
> **One loose end:** `_dmarc.bermudezsystems.com` still reads
> `p=quarantine; rua=mailto:bounce@dmarc.businessidentity.llc`, so aggregate
> reports go to Northwest's collector rather than to anyone who reads them.
> Not breaking — SPF aligns under Microsoft — but repoint `rua`/`ruf` when
> convenient.

Replaces the Northwest "Business Identity" free mail suite with a real
Exchange mailbox, and retires forwarding-to-Gmail as a mechanism. **Cost $0** —
the tenant already exists, holds multiple domains, and an unlicensed shared
mailbox is free up to 50 GB. The address `gabriel@bermudezsystems.com` does not
change; only where its mail lands.

### 4.0 Measured starting state (2026-08-22, public DNS)

| Domain | Nameservers | MX | Notes |
|---|---|---|---|
| `bermudezsystems.com` | `ns1/ns2.hosting.businessidentity.llc` (Northwest) | `10 mailserver.businessidentity.llc`, **TTL 60** | site `A 199.36.158.100`, `hosting-site=` and `google-site-verification=` TXT, SPF `v=spf1 a mx include:spf.postal.businessidentity.llc ~all`, **DMARC `p=quarantine`** |
| `bermudezpr.com` | `ns1-4.bdm.microsoftonline.com` (**Microsoft-managed**) | `0 bermudezpr-com.mail.protection.outlook.com` | the live tenant; SPF `include:spf.protection.outlook.com -all`, `autodiscover` CNAME present, **no DMARC** |

TTL on every record that changes is **60 seconds**, so both the cutover and the
rollback are ~1 minute. There is no multi-hour window to schedule around.

### 4.1 The record changes

Change only these three; **everything else at Northwest stays exactly as it is.**

| Record | From | To |
|---|---|---|
| `MX @` | `10 mailserver.businessidentity.llc` | `0 bermudezsystems-com.mail.protection.outlook.com` |
| `TXT @` (SPF) | `v=spf1 a mx include:spf.postal.businessidentity.llc ~all` | `v=spf1 include:spf.protection.outlook.com -all` |
| `CNAME autodiscover` | *(none)* | `autodiscover.outlook.com` |

Add, then delete after verification: `TXT @` = `MS=ms……` (the wizard prints it).
Add for DKIM: `CNAME selector1._domainkey` and `selector2._domainkey` →
the two `…-bermudezsystems-com._domainkey.<tenant>.onmicrosoft.com` targets the
admin center prints. **Copy those from the wizard, never from a guide.**

**Do NOT touch:** the `A @` record (the site — Apple's org-website
precondition), `TXT google-site-verification=1EYLbXKH66lt…` (the Play org
account's website verification rides on it — deleting it un-verifies the
developer account), or `TXT hosting-site=gabrielbermudez`.

### 4.2 Order of operations

1. **Read the backlog first.** Northwest webmail
   (`accounts.northwestregisteredagent.com` → Services → Email) holds mail that
   exists nowhere else — the first real in-app feedback was found sitting
   there. It stays readable after the cutover, but do not delete the mailbox
   until it is empty of anything wanted. Do **not** try to forward the backlog
   out: the free suite caps sends at **5/day**.
2. **M365 admin center** (`admin.microsoft.com`) → **Settings → Domains →
   Add domain** → `bermudezsystems.com`. **Sign in as `andres@bermudezpr.com`,
   NOT `gabriel@bermudezpr.com`** — measured 2026-08-22, the tenant has exactly
   **one** Global Administrator and it is `andres@`. `gabriel@` is a lesser
   admin, and the console does not explain itself: the **Add domain** button is
   simply absent and Billing collapses to *Licenses* only, which reads like a
   plan limitation rather than a permission. The role panel states it outright
   — *"Only Global admins can … Add and manage domains"*. While signed in as
   `andres@`, consider granting `gabriel@` **Domain Name Administrator** (least
   privilege for exactly this) so the next DNS change does not need the other
   account. **A tenant with one Global Admin is its own risk** — Microsoft
   recommends 2–4; if `andres@` is locked out, nobody can administer it.
3. Verification: choose **"Add a TXT record instead"**, copy the `MS=ms……`
   value, add it as a `TXT @` at Northwest, then **Verify**.
4. When asked how to connect: **"More options → Add your own DNS records"**.
   **Never let the wizard take over the nameservers** — the site and the GSC TXT
   live at Northwest and would go with them.
5. Tick **Exchange / Exchange Online Protection only**. Skip the Teams/Skype
   and Intune/MDM records; nothing here uses them.
6. Apply the three changes in §4.1 at Northwest, then **Continue** so the
   wizard re-checks.
7. **Create the mailbox** → **Teams & groups → Shared mailboxes → Add a shared
   mailbox**, name `Bermudez Systems LLC`, address
   `gabriel@bermudezsystems.com`. Add `gabriel@bermudezpr.com` as a member with
   **Read and manage** *and* **Send as**. It appears as its own folder tree in
   the existing Outlook within ~15 min — no second license, no second login.
   *(Alternative: add the address as an alias on the `bermudezpr.com` user —
   also free, but LLC mail then lands mixed into the personal-business inbox.)*
8. **The MX write fails silently at priority 0 — use 1.** Measured 2026-08-22,
   and this cost three wasted attempts: Northwest's DNS panel **rejects an MX
   record with priority `0`** — Edit-then-Save and Add-new-row both revert the
   form with **no error and no success toast** (TXT and CNAME writes on the
   same page toast green and apply instantly, so it reads as an MX-specific
   lock). It is not a lock and it is **not** related to the Northwest mail
   service being active: the identical record at **priority 1** saved on the
   first try. Microsoft's own instructions say priority 0; this panel treats 0
   as empty. Add the Microsoft record at priority 1 first — it then outranks
   Northwest's 10 immediately — then delete the old row and Save.
   **Do not disable the Northwest mail service to “unblock” MX. It was never
   the cause, and disabling it destroys the old mailbox.**
9. **DKIM**: `security.microsoft.com` → Email & collaboration → Policies &
   rules → Threat policies → **DKIM** → select the domain → the two CNAME
   targets → add at Northwest → **Enable**.

### 4.3 The trap that bites if steps are split across days

`bermudezsystems.com` publishes **DMARC `p=quarantine`** today. The moment MX
points at Microsoft while SPF still names Northwest, mail *sent* from the new
mailbox fails SPF against a quarantine policy — it does not bounce, it lands in
recipients' spam, silently. **Change MX and SPF in the same sitting, and do
DKIM before relying on the address with Apple or Google.** Also: only **one**
SPF TXT record may exist per domain — replace the Northwest one, never add a
second.

The DMARC record's `rua`/`ruf` point at `dmarc.businessidentity.llc`. Harmless
to leave; repoint to a mailbox actually read if aggregate reports are wanted.

### 4.4 Verify — and do not accept "it is configured" as evidence

```sh
Resolve-DnsName -Server 8.8.8.8 -Type MX  bermudezsystems.com
Resolve-DnsName -Server 8.8.8.8 -Type TXT bermudezsystems.com
```

Then send a real message **from the personal Gmail to
`gabriel@bermudezsystems.com`** and watch it arrive in Outlook; reply from the
shared mailbox and open *Show original* in Gmail — expect `spf=pass`,
`dkim=pass`, `dmarc=pass`. This is the check the previous arrangement never
got: the forward was recorded as "owner to configure", was never configured,
and delivery looked fine the whole time.

### 4.5 What this does and does not change

- The Play **org developer account login** is the Google account on this
  address. A shared mailbox has no password and cannot be signed into — that is
  fine, the Google account is unaffected; its recovery and verification mail
  simply arrives in Outlook instead of Northwest webmail.
- It does **not** address the real risk: the **domain's auto-renew is OFF** and
  the free Northwest year lapses **~July 2027**, taking the developer-account
  login, Apple's org-website precondition and the GSC TXT with it. Mail hosting
  moving to Microsoft does not renew the registration. See `STATUS.md` §
  `bermudezsystems.com` items ① and ②, which outrank this one.
- Optional afterwards: `MACROLOG_FEEDBACK_TO` (`functions/src/feedback-notify.ts`)
  can point back at the LLC address once a test has been watched to arrive.

### 3.14 The watchOS simulator — reading the watch faces at 40mm and 46mm

Done 2026-08-23 to close #46. The whole run, and the four things that are not
obvious.

**Disk first.** A clean watch build peaked with the Air at **2.9 GiB free** and
it started at 7.0. Clear our own DerivedData before starting — it was 12 GB and
it is entirely ours (one directory, `Ignia-<hash>`; nothing of the machine
owner's is in there):

```sh
rm -rf ~/Library/Developer/Xcode/DerivedData/Ignia-*
```

**Create the two sizes.** The runtime ships with no watch devices at all:

```sh
xcrun simctl create Ignia-W40 com.apple.CoreSimulator.SimDeviceType.Apple-Watch-SE-40mm-2nd-generation com.apple.CoreSimulator.SimRuntime.watchOS-26-5
xcrun simctl create Ignia-W46 com.apple.CoreSimulator.SimDeviceType.Apple-Watch-Series-10-46mm       com.apple.CoreSimulator.SimRuntime.watchOS-26-5
```

**Build with `-destination`, never `-sdk`** — the same rule as §3.13, and the
scheme is `IgniaWatch` (the complication is `IgniaWatchComplication`). It needs
a full `expo prebuild -p ios --clean` first, WITH pods; the watch scheme pulls
the main app's pod graph, so the first build is long even though the watch code
is a few hundred lines of SwiftUI.

```sh
xcodebuild -workspace ios/Ignia.xcworkspace -scheme IgniaWatch -configuration Debug   -destination 'generic/platform=watchOS Simulator'   -derivedDataPath /tmp/wdd CODE_SIGNING_ALLOWED=NO build
```

**The watch is NOT localised through `.lproj`, and this is the part that wastes
an hour.** Both string sets are compiled into `targets/_shared/Glance.swift` and
chosen by the `locale` field of the snapshot the phone pushes. So setting
`AppleLanguages` on the simulator does nothing, and a watch with no paired phone
renders the empty state in one language forever. Seed the App Group instead:

```sh
J='{"v":1,"dateKey":"2026-08-23","kcalConsumed":1450,"kcalTarget":2323,"proteinConsumed":92,"proteinTarget":145,"updatedMs":1787537748000,"locale":"es-PR"}'
xcrun simctl spawn Ignia-W40 defaults write group.fit.ignia.app ignia.widget.snapshot.v1 -string "$J"
xcrun simctl terminate Ignia-W40 fit.ignia.app.watchkitapp
xcrun simctl launch    Ignia-W40 fit.ignia.app.watchkitapp
xcrun simctl io        Ignia-W40 screenshot /tmp/w40-es.png
```

**`-string` is load-bearing.** Without it `defaults` tries to parse the JSON as
a plist, prints *"Could not parse: … Try single-quoting it"* to stderr, and
writes **nothing** — the app then renders its empty state and the screenshots
come out identical across locales, which looks like the app ignoring the
locale rather than the seed never landing. Read it back (`defaults read`) before
trusting a capture.

**Tear the sims down afterwards**, same reasoning as the Android AVD in
`.maestro/README.md`: they are disposable and this is not our laptop.

```sh
for S in Ignia-W40 Ignia-W46; do xcrun simctl shutdown $S; xcrun simctl delete $S; done
rm -rf /tmp/wdd ~/Library/Developer/Xcode/DerivedData/Ignia-*
```

**Also worth killing on sight:** several `zsh -c until ! pgrep -f xcodebuild …`
watcher processes from earlier sessions were found still running. Their own
command line contains `xcodebuild`, so their `pgrep` matches themselves and they
can never exit. Four of them had accumulated.
