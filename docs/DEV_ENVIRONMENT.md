# Dev environment & Ignia production runbook

Two things live here: (1) the **local dev environment** (Firebase Emulator
Suite — how to stop testing against prod), and (2) the **owner runbook** for the
`ignia.fit` cutover + production hardening (console/DNS/CLI steps the code can't
do). Decisions behind this: grilled 2026-07-05, see `project_ignia_prod_cutover`
memory + ADR-0015.

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
- **BigQuery billing export — dataset is created, the switch is not thrown.**
  `bq://fitness-tracker-gb-1775407101.billing_export` exists (US, created
  2026-08-04). Enabling the export itself is **console-only** — the Cloud
  Billing API has no method for it, which is why this is a runbook step and
  not a script. Cloud Billing → **Billing export** → *BigQuery export* tab →
  **Edit settings** on **Detailed usage cost**, pick this project and the
  `billing_export` dataset, save. Do the same for *Standard usage cost* if you
  want the cheaper coarse table too.
  **It is not retroactive** — it captures usage from the moment you enable it
  forward, so it will never explain an invoice you already received. Those
  stay at Billing → **Documents**. Data starts landing within ~24h in a table
  named `gcp_billing_export_resource_v1_<BILLING_ACCOUNT_ID_with_underscores>`
  (account `010F4E-5E97BC-6B83D0` → `..._010F4E_5E97BC_6B83D0`).
  Cost of the export itself is effectively zero — a few MB/month against
  BigQuery's 10 GB free storage and 1 TB free query tier. Once rows exist,
  cost-by-service for the last 30 days is:

  ```sh
  bq query --use_legacy_sql=false \
  'SELECT service.description AS service, ROUND(SUM(cost),2) AS usd
   FROM `fitness-tracker-gb-1775407101.billing_export.gcp_billing_export_resource_v1_010F4E_5E97BC_6B83D0`
   WHERE usage_start_time >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 30 DAY)
   GROUP BY service ORDER BY usd DESC'
  ```
- **Firestore PITR** — Firestore → enable Point-in-Time Recovery (7-day). One
  toggle, cheap insurance on top of the existing weekly backup CF.
- **Auth** — enable email-enumeration protection; confirm the password policy.

### D. Deferred (own focused pass)
- **App Check** — not wired anywhere yet; biggest remaining gap (bots can hit
  the public config + burn Gemini quota). Needs web reCAPTCHA Enterprise keys +
  a monitor-then-enforce rollout, and mobile providers that only work in a
  dev/store build. Schedule as its own effort, web first.
- **Cloud staging project** — add only when you need a shareable hosted dev URL.
