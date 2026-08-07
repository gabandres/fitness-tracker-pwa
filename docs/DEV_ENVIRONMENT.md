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

Target machine: the MacBook Air M1. **iOS only** — Android stays on Windows/EAS
(see §4 of `STATUS.md` for the ninja path-length wall).

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

**From Windows, to verify:**

```sh
ssh -i ~/.ssh/id_ed25519_ignia_mac <user>@<name>.local "sw_vers && xcodebuild -version"
```

Then a build is one line:

```sh
ssh -i ~/.ssh/id_ed25519_ignia_mac <user>@<name>.local   "cd ~/fitness-tracker-pwa && git pull && cd apps/mobile &&    caffeinate -dims npx eas build -p ios --profile production --local"
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


---
