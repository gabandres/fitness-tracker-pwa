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
(§7's `gradlew assembleRelease`) runs against the 17 toolchain; flipping the
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
