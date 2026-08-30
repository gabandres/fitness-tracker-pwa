# Audit the docs — find contradictions, kill stale claims

Sweep every tracked `.md` in this repo for claims that have expired, contradict
each other, or contradict the code and the live services. **Correct or delete
them.** Reading is not the deliverable; a smaller, truer set of docs is.

Use for "are the docs consistent", "check the docs are on the same page", after
any release, or when a doc has just been caught lying.

## The failure this exists to stop

Docs here do not rot by going blank. They rot by staying **confident**. A row
that says the App Store is on `1.0, build 7` does not read as old — it reads as
authoritative, and it outranks the file that was right. `CLAUDE.md` states the
rule: **if another file disagrees with `STATUS.md`, the other file is stale —
fix or delete it.**

Measured on the 2026-08-15 audit, the damage is never in the obscure files:

| Doc | Claimed | Truth |
|---|---|---|
| `README.md` | "Pro is $3/mo or $24/yr" | no purchasable product exists; a sweep on 08-13 removed exactly this from the live site and missed the repo's front page |
| `docs/go-to-market.md` | photo scan `false`, Apple Watch "not built" | both shipped — the file forbade marketing two headline features during a launch push |
| `docs/app-store-metadata.md` | 1.1.0 `PREPARE_FOR_SUBMISSION`, never submitted | approved and released a week earlier |
| `STATUS.md` §5 | photo scan "deferred to a paid tier" | on and free since ADR-0017 — in the one list whose job is to stop re-proposals |
| `.github/copilot-instructions.md` | code lives in `fitness-tracker-pwa\`, root is not a git repo | both false; it also mandated retired pre-pivot branding |

Every one is a **high-traffic** file. Audit those first; the obscure ones cost
little when wrong.

## Ground truth, in order

Never resolve a contradiction from memory or from another doc. Ask the system
that owns the fact:

| Claim | Authority |
|---|---|
| Live App Store version / build / review state | ASC API via `scripts/asc-client.mjs` |
| Which Android versionCode ships, and its signing cert | `androidpublisher` API — never the Play console page |
| Runtime fingerprint of a binary | the artifact itself (`.ipa`/`.aab`), never `fingerprint:generate` |
| Feature flags | the source: `apps/mobile/src/lib/features.ts` and `apps/mobile/src/lib/subscription.ts` (the web copies were deleted with the web logging app, ADR-0036 — a doc citing `src/app/utils/features.ts` is stale) |
| Deployed function env / secrets | `gcloud run services describe` |
| Sending domain, DNS | Resend API, `nslookup` against `1.1.1.1` |
| What is true right now, everything else | `STATUS.md` §1 |

`STATUS.md` outranks other docs — but it is not exempt. It carried a stale App
Store row and a wrong §5 entry into this audit.

## Method

1. **Inventory.** `find . -name "*.md"` minus `node_modules`, `dist`, `.git`,
   `_attic`. Note line counts; the big high-traffic ones are the targets.
2. **Establish ground truth first**, from the table above, before reading prose.
   Write the facts down; you will compare many files against them.
3. **Grep for claim shapes, not words.** The reliable patterns:
   - version/build literals — `build \d+`, `vc \d+`, `1\.\d\.\d`
   - review/release states — `PREPARE_FOR_SUBMISSION`, `READY_FOR_SALE`, `in App Review`
   - flag claims — `photoScan`, `PRO_ENABLED`, `FEATURES\.`
   - negations, which age worst — `not built`, `never run`, `not in a binary`,
     `deferred`, `blocked on`, `awaiting`, `coming`, `not launched`
   - prices and tiers — `\$\d`, `/mo`, `Pro`
   - paths — a doc naming a directory that no longer exists
4. **Classify each hit** before touching it:
   - **Stale state** → delete it and point at the authority. State does not
     belong in a reference doc; that is why it rotted.
   - **Durable fact** (how ASC behaves, why a design exists) → keep.
   - **History that explains a decision** → keep, but frame it in the past
     explicitly ("was true when written", "ALL RESOLVED"). Present tense is what
     makes history read as status.
   - **Superseded plan** → delete per `CLAUDE.md` housekeeping: outcome to
     `CHANGELOG.md`, reasoning to an ADR, state to `STATUS.md`. Git keeps it.
5. **Fix, and say what was wrong.** A silent correction teaches nobody and gets
   re-broken. One line: what it said, why it was false, when it stopped being
   true.
6. **Verify the fix against the authority again**, not against your edit.
7. **Commit with the contradictions named** in the message.

## What to delete outright

- Snapshots of state in files that do not own state. Replace with the re-check
  command, not a fresher snapshot — a fresher snapshot expires too.
- Duplicated project descriptions. `.github/copilot-instructions.md` drifted for
  exactly this reason; it is now a pointer to `CLAUDE.md` plus the owner's own
  protocol, and nothing else.
- Plan docs whose work shipped.
- Correction stacks. When a file carries "Correction 4" on top of "superseded
  twice in one day", the section is the problem — cut it and leave a pointer.

## What NOT to delete

- **Unrun tests and open protocols.** `docs/activity-tdee-validation-protocol.md`
  had an expired *premise* ("the importer has never run on a device") and a
  still-valid *purpose*. Correct the premise; keep the protocol.
- Research `VERDICT` blocks. `CLAUDE.md` says cite them, do not re-derive.
- ADRs. They are dated decisions; a superseded one gets an amendment note, never
  a deletion. Check for an amending ADR before calling one wrong — 0015 looks
  false about photo scan until you find 0017.
- Durable traps and runbooks, however old. The Play signing-key notes and the
  Swift nested-comment trap are worth more than most current status.

## Traps

- **A correction can be stale too.** `app-store-metadata.md` held a correction
  saying "that table is history twice over" — itself written before the release
  it described.
- **`_attic/`, `dist/` and gitignored chat logs are not docs.** Check
  `git ls-files` before spending effort; untracked local files are not yours to
  delete.
- **Do not "fix" a live object to match a doc.** 1.2.0 was found waiting for
  review with `usesIdfa: null` against a doc claiming that blocks submission.
  The doc was wrong about the consequence, and editing a waiting submission
  risks more than the field is worth. Record the discrepancy; fix it next cycle.
- **Line numbers in prose go stale silently.** When a doc cites
  `file.ts:256`, re-grep the symbol rather than trusting the number.
- **Both `es-PR` and `es-MX` exist** — mobile/web i18n use `es-PR`, the App
  Store listing uses `es-MX`. Neither is a typo for the other.
