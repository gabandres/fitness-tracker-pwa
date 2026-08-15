# Email deliverability — DKIM / SPF / DMARC for `ignia.fit`

**Status:** **Done.** `mail.ignia.fit` is verified, the Resend sender is flipped
and deployed (2026-08-14), and Firebase Auth's own verification mail — the half
this document was originally blind to, and the one a user actually reported in
junk — now goes through our `sendVerificationEmail` callable instead of
Firebase's sender (2026-08-15, §6). Every message Ignia sends is now
DMARC-aligned on `mail.ignia.fit`. What remains is measurement, not work: §4.6
(read the headers of a real send) and the DMARC ramp in §4.5.
**Last verified:** 2026-08-15

> **The three-week gap this document caused.** The domain verified on
> 2026-07-24, hours after these records were published — and §4.4 was never
> done, so every welcome, password-reset and weekly-digest mail kept going out
> from `onboarding@resend.dev` until 2026-08-14. The doc read "awaiting
> verification" the whole time, which is indistinguishable from "blocked" at a
> glance. **A runbook whose status line describes a poll you have to re-run is
> a runbook that will rot.** Re-read the live state before believing this file:
> `node scripts/resend-domain-setup.mjs --verify`.

This is the runbook for getting Ignia's transactional mail out of the junk
folder. It records what was measured, what was changed in code, and the exact
remaining steps — which cannot be completed from a shell alone.

---

## 1. Diagnosis — why mail lands in junk today

Measured against the live Resend account and the repo, not inferred:

| Finding | Evidence |
|---|---|
| Every Resend email ships from `onboarding@resend.dev` | `MACROLOG_EMAIL_FROM` is set nowhere in the repo or the functions runtime, so `resend-client.ts` uses its sandbox fallback. |
| `ignia.fit` is not a sending domain in Resend at all | `GET /domains` returns exactly one domain: `citafy.app`. |
| Password reset came from a fourth-party domain | Firebase Auth sends `noreply@<project>.firebaseapp.com`. |
| No plain-text alternative on any template | `email-templates.ts` returned `{subject, html}` only. |
| No inbox preview text | No preheader block, so clients scraped `"Hi there,"`. |

The dominant term is the first one. `onboarding@resend.dev` is Resend's
**shared sandbox domain** — its reputation is the aggregate of every developer
testing on it. While the `From:` domain is not ours:

- DMARC alignment is impossible by construction. Alignment compares the
  `From:` domain against the DKIM `d=` and the SPF `MAIL FROM`. A perfect
  DMARC record on `ignia.fit` changes nothing about mail sent from
  `resend.dev`.
- **Nothing published in Cloudflare improves delivery until the sender moves.**
  Doing the DNS work first is wasted effort.

For contrast, here is a correctly-configured send (headers from Resend's own
marketing mail, `Authentication-Results`):

```
spf=pass    smtp.mailfrom=bounces.updates.resend.com
dkim=pass   header.d=updates.resend.com
dkim=pass   header.d=amazonses.com
dmarc=pass  header.from=updates.resend.com
```

Note it sends from a **subdomain** (`updates.resend.com`), with the bounce
domain under that same subdomain. That is the shape we replicate.

---

## 2. The domain slot — resolved 2026-07-24

The free plan allows exactly one domain, and it was spent on **`citafy.app`**
(verified 2026-03-11, unrelated project). On the owner's explicit instruction
that slot was reclaimed for Ignia:

```
DELETE /domains/00a67c9f-2ee7-4e9e-8205-f6c58dba0dbd   → {"deleted": true}
POST   /domains  {"name":"mail.ignia.fit", ...}        → id 426e86ae-6518-4f5f-9667-5c9bb34c32d4
```

**Consequences to be aware of:**

- **`citafy.app` can no longer send through Resend.** Any API key still
  pointing at it now fails. This was accepted deliberately, not overlooked.
- Its config is archived at `scratchpad/citafy-domain-backup.json` for the
  record, but that is **documentation, not a restore point** — recreating the
  domain mints a *new* DKIM keypair, so the old `resend._domainkey` TXT record
  in citafy.app's DNS would have to be replaced, not reused.
- The `citafy.app` DNS records were **not** touched. They are now inert and can
  be deleted from that zone whenever convenient.

---

## 3. What is already done (code)

- **`functions/src/email-templates.ts`** — rewritten. Templates are authored
  once as structural `Block`s and rendered to **both** HTML and a real
  `text/plain` part, so the two can never drift. Adds a preheader, dark-mode
  via `prefers-color-scheme`, a bulletproof (table-based) button, Ignia's
  live palette, and a new `passwordResetEmail()` in `en` + `es-PR`.
- **`functions/src/password-reset.ts`** — new `sendPasswordReset` callable.
  Generates the action link with `generatePasswordResetLink()` and delivers it
  through Resend from our own domain. Enumeration-safe and rate-limited (see
  its header comment for the three security properties).
- **`functions/src/resend-client.ts`** — split header sets: lifecycle mail
  keeps RFC 8058 one-click unsubscribe; transactional mail drops it and adds
  `Auto-Submitted`. `FROM_EMAIL` and `REPLY_TO` are both env-driven.
- **Both clients** now call the callable instead of Firebase's
  `sendPasswordResetEmail` (`src/app/services/auth.service.ts`,
  `apps/mobile/src/lib/auth.tsx`).
- **`firestore.rules`** — `emailRateLimits` explicitly denied to all clients.
- Content fixes: the welcome email no longer advertises photo scanning
  (`FEATURES.photoScan` is `false` in shipped v1 on both platforms) and no
  longer carries the pre-pivot "macro log · personal calibration" eyebrow.

---

## 4. Remaining steps (in order)

### 4.1 Create the sending domain — ✅ done

Already created (§2). `scripts/resend-domain-setup.mjs` is idempotent — re-run
`--create` any time to reprint the record table:

```sh
RESEND_API_KEY=re_xxx node scripts/resend-domain-setup.mjs --create
```

It prints the DNS records Resend generates. Equivalent by hand:

```sh
curl -X POST https://api.resend.com/domains \
  -H "Authorization: Bearer $RESEND_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{"name":"mail.ignia.fit","region":"us-east-1","custom_return_path":"bounces"}'
```

Notes on those parameters:

- **`mail.ignia.fit`, not the apex.** Reputation for app mail stays isolated
  from `ignia.fit` itself, so a bad send can never poison the apex domain.
- **`custom_return_path: "bounces"`** puts the Return-Path at
  `bounces.mail.ignia.fit`, matching the reference send's shape.
- **Do not enable open/click tracking.** Click tracking rewrites every URL
  through a redirect domain — actively harmful for a password-reset link, both
  for user trust and for filters.

The Resend API key must be **`full_access`**; a `sending_access` key cannot
create domains.

### 4.2 Publish the DNS records in Cloudflare — ✅ done 2026-07-24

Published via `scripts/cloudflare-publish-dns.mjs --apply` and independently
confirmed resolving against `1.1.1.1`. The zone had no prior MX, SPF or DMARC
record, so nothing was overwritten.

Zone `ignia.fit` = `f4fad5b1f2462ff734960681ac407f95`. The three records Resend
generated for `mail.ignia.fit`:

| Type | Name | Value | Priority |
|---|---|---|---|
| `TXT` | `resend._domainkey.mail` | `p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQCsTOunBv0S110jABD4mQHNQotPiEvdApmesC7zV3u4FiIWhy9I5w2ryolec6TTcr3+WJOCmLT/fQ90Yil/96I2oHwpZRLBpY1Kj6aLOEjGjvbO2aOtg2elyyoHxdNk7nNeHMom0zgxKIIhw9ofTBOLDqocJMdth82uSBz2GAHtCQIDAQAB` | — |
| `MX` | `bounces.mail` | `feedback-smtp.us-east-1.amazonses.com` | `10` |
| `TXT` | `bounces.mail` | `v=spf1 include:amazonses.com ~all` | — |

Preferred — one command, no transcription:

```sh
RESEND_API_KEY=re_xxx CLOUDFLARE_API_TOKEN=xxx \
  node scripts/cloudflare-publish-dns.mjs --dry-run   # then --apply
```

It pulls the values straight from Resend, upserts by name+type (safe to re-run),
and triggers verification.

⚠️ **Cloudflare specifics:**
- Set every one of these to **DNS only** (grey cloud) if adding by hand.
  Proxying a mail record breaks it.
- Adding by hand, Cloudflare appends the zone — enter `resend._domainkey.mail`,
  **not** `resend._domainkey.mail.ignia.fit`, or you get `…ignia.fit.ignia.fit`.
  (The script sends absolute names, which the API takes verbatim.)
- **Token scope.** DNS work needs **Zone · DNS · Edit** on `ignia.fit`. Two
  tokens were tried on 2026-07-24: an account-scoped one (`cfat_…`, issued
  alongside R2 storage keys) which could list zones but returned
  `10000 Authentication error` on `/dns_records`, and a user token (`cfut_…`,
  Edit Zone) which worked.
- **Testing a token:** account-owned tokens (`cfat_…`) return
  `Invalid API Token` from `/user/tokens/verify` **even when healthy** — verify
  those at `/accounts/{account_id}/tokens/verify` instead. User tokens
  (`cfut_…`) use the `/user/` endpoint. Getting this backwards makes a working
  token look dead.

### 4.3 Verify

```sh
RESEND_API_KEY=re_xxx node scripts/resend-domain-setup.mjs --verify
```

Poll until `status: "verified"`.

⚠️ **Do not hammer this immediately after publishing the records.** The zone's
SOA minimum — the negative-cache TTL — is **1800s**. If a verification is
triggered before the records exist (or in the same breath as creating them),
Resend's resolver caches the `NXDOMAIN` and will keep answering from that cache
for up to 30 minutes no matter how many times you re-ask. That is exactly what
happened on 2026-07-24: 20 consecutive `pending` results over 10 minutes while
the records were already live and byte-correct.

Confirm the records independently before blaming Resend:

```sh
# PowerShell
Resolve-DnsName resend._domainkey.mail.ignia.fit -Type TXT -Server 1.1.1.1
Resolve-DnsName bounces.mail.ignia.fit          -Type MX  -Server 1.1.1.1
```

If those resolve, the DNS is done — wait out the window and re-verify once.

### 4.4 Flip the sender — ✅ done 2026-08-14

**Not** via an env var in the end. `functions/.env` would be a fourth place to
forget, and the sandbox default had already been forgotten once for three
weeks, so the **tracked default moved instead**: `FROM_FALLBACK` in
`functions/src/resend-client.ts` is now `Ignia <hello@mail.ignia.fit>`.
`MACROLOG_EMAIL_FROM` still overrides for staging or a domain change, and
`IS_SANDBOX_SENDER` now compares against a separate `SANDBOX_SENDER` constant
so it keeps meaning what its name says.

Deployed to the three functions that send mail:

```sh
npm --prefix functions run build
firebase deploy --only functions:sendWelcomeEmail,functions:sendPasswordReset,functions:hourlyTasks
```

(`hourlyTasks` is the one that carries the weekly digest — there is no separate
digest function, per the 3-job Cloud Scheduler ceiling in `CLAUDE.md`.)

**`MACROLOG_EMAIL_REPLY_TO` was deliberately NOT changed to `hello@ignia.fit`.**
The apex publishes no MX record, so that address black-holes every reply — a
reply-to that bounces is worse for reputation than the personal Gmail that
works. Moving it needs inbound mail to exist first.

Sending from an unverified domain fails loudly — Resend rejects it — rather
than silently junking everything. That is the intended failure mode; do not add
a sandbox fallback back in.

### 4.5 DMARC — published at `p=none` 2026-07-24

```
_dmarc.ignia.fit  TXT  "v=DMARC1; p=none"
```

`p=none` is monitor-only: it changes nothing about delivery. It is published
now because it is the required first rung, and because some filters treat the
*absence* of a DMARC record as a mild negative signal.

**It deliberately carries no `rua=`.** Two dead ends to know about before
adding one:

- `rua=mailto:dmarc@ignia.fit` **cannot work.** The apex has no MX, so there is
  nowhere for reports to land. (An earlier draft of this doc recommended
  exactly that — it was wrong.)
- `rua=mailto:you@gmail.com` **also cannot work.** RFC 7489 §7.1 requires the
  *receiving* domain to authorise external reporting by publishing
  `ignia.fit._report._dmarc.gmail.com`. You cannot add records to `gmail.com`,
  and Google and Microsoft both enforce this check, so reports are silently
  dropped.

**Recommended: a free DMARC digest service** — Postmark's DMARC Digests or
dmarcian's free tier. They issue you a reporting address and publish the
`_report._dmarc` authorisation themselves, so it is a signup plus a one-line
record edit, with no MX and no XML parsing. Then:

```sh
# update the record in place
curl -X PUT "https://api.cloudflare.com/client/v4/zones/$ZONE/dns_records/$ID" \
  -H "Authorization: Bearer $CF_TOKEN" -H 'Content-Type: application/json' \
  -d '{"type":"TXT","name":"_dmarc","content":"v=DMARC1; p=none; rua=mailto:<issued>; fo=1","ttl":1}'
```

Only after **two weeks** of reports showing every legitimate source aligned:

```
p=none  →  p=quarantine; pct=25  →  p=quarantine  →  p=reject
```

⚠️ Going straight to `p=reject` before alignment is confirmed will blackhole
real mail. There is no upside to rushing this, and ramping blind — tightening
without ever having read a report — is the same mistake with extra steps.

### 4.6 After the first real send

- Register `ignia.fit` in **Google Postmaster Tools** for domain reputation.
- Send one test to a Gmail address and one to an Outlook address; on each,
  open *Show original* / *View message source* and confirm all three of
  `spf=pass`, `dkim=pass`, `dmarc=pass` with `header.from=mail.ignia.fit`.
- Confirm the message renders in both light and dark mode, and that the
  text/plain part is present (Gmail: *Show original* → two MIME parts).

---

## 5. Operational notes

- **Firestore TTL.** `emailRateLimits` docs carry an `expiresAt` field. Point a
  Firestore TTL policy at it so the collection self-evicts instead of growing
  forever. Not urgent at current volume, but it is unbounded without one.
- **Secret Manager free tier is 6 active versions.** After rotating
  `RESEND_API_KEY`, `gcloud secrets versions destroy` the superseded ones.
- **Logs must never contain email addresses.** `password-reset.ts` logs a
  truncated SHA-256 tag instead; preserve that in anything new.
- **`REPLY_TO` is currently a personal Gmail** committed to the repo. Moving it
  to a domain address is **not** a tidy-up — see §4.4 for why `hello@ignia.fit`
  would black-hole every reply.

---

## 6. Firebase Auth's own mail — the half this document missed

**Everything above concerns mail Ignia sends through Resend. The email
verification a new signup depends on is not one of those.** Both clients call
Firebase's `sendEmailVerification` directly:

- `src/app/services/auth.service.ts:256,337`
- `apps/mobile/src/lib/auth.tsx:719,782`

That is sent by Google, not by us. Live config, read 2026-08-14 from
`identitytoolkit.googleapis.com/admin/v2/projects/<project>/config`:

```
notification.sendEmail.method  = DEFAULT
                → From: noreply@fitness-tracker-gb-1775407101.firebaseapp.com
dnsInfo.customDomainState      = NOT_STARTED
callbackUri                    = https://fitness-tracker-gb-1775407101.firebaseapp.com/__/auth/action
```

**No DNS record on `ignia.fit` can help this.** DMARC alignment compares the
`From:` domain against the DKIM `d=` — the same argument §1 makes about
`resend.dev`, applying identically to `firebaseapp.com`. The action link in the
body pointing at a `firebaseapp.com` URL is a second, independent signal.

This matters more than the Resend half: **email verification is the signup
wall** (`STATUS.md` §6 — a fresh account is walled out until it verifies), so a
junked verification mail is a failed activation, not a missed newsletter.

### The obvious fix does not work on this project

Firebase Auth supports a custom SMTP relay and Resend exposes one, so the
expected fix was `smtp.resend.com:587` in **Authentication → Templates → SMTP
settings**. **Every write to that config is refused**, tried 2026-08-15:

```
PATCH .../config?updateMask=notification.sendEmail.method,…smtp,…callbackUri
→ 400 INVALID_ARGUMENT  EMAIL_TEMPLATE_UPDATE_NOT_ALLOWED
```

It is not a malformed payload. A single-field write of nothing but
`notification.sendEmail.callbackUri` is refused identically. The cause is
`emailPrivacyConfig.enableImprovedEmailPrivacy: true` — **email-enumeration
protection standardizes Auth's mail and locks the template and sender config
against edits.**

**Do not "fix" this by turning that flag off.** It is a real security property
this app depends on (it is why `fetchSignInMethodsForEmail` returns `[]` — see
`STATUS.md`), and the callable below delivers the same result without trading
anything for it.

### What shipped instead — `sendVerificationEmail`

A callable mirroring `sendPasswordReset` exactly:
`generateEmailVerificationLink()` server-side, delivered through Resend from
`hello@mail.ignia.fit`, using the `Block`-rendered HTML + `text/plain` pair in
`email-templates.ts` (`verifyEmailEmail`, `en` + `es-PR`).

- `functions/src/verify-email.ts` — the callable. **Authenticated**, unlike the
  reset path: the address is read from the auth token, never the request body,
  which makes enumeration structurally impossible. Rate limited per uid
  (`MAX_PER_USER = 5`/hour) via the same `withinBudget` helper. An
  already-verified caller is a no-op. Failures **surface** rather than
  resolving to a cheerful `ok:true` — a user at the verification wall needs to
  know the mail did not go out.
- `functions/src/auth-links.ts` — `brandActionLink()`. Firebase mints links on
  `<project>.firebaseapp.com`; `ignia.fit` serves the *same* OOB handler
  (response bodies compared 2026-08-15: byte-identical, both booting
  `fireauth.oob.OobHandler`), so the origin is swapped and the `oobCode`
  preserved. Unknown hosts pass through untouched. **Applied to password-reset
  links too** — they had the same mismatched host.
- Clients call it instead of the SDK: `src/app/services/auth.service.ts`
  (`sendVerificationEmail()`, used by sign-up and the resend banner) and
  `apps/mobile/src/lib/auth.tsx` (`sendOwnedVerificationEmail`). Both pass a
  locale, because `I18nProvider` mounts inside the auth provider on mobile.

⚠️ **Resend's free plan is 100 emails/day, 3,000/month, and verification mail
now shares that budget with the welcome, reset and digest mail.** Fine at
current volume; worth remembering the day a promotion lands.

**Verify** (§4.6 applies here too): sign up a fresh account, open *Show
original* in Gmail, and confirm `spf=pass`, `dkim=pass`, `dmarc=pass` with
`header.from=mail.ignia.fit` — not `firebaseapp.com`.
